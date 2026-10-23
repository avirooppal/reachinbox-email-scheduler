import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";
import { RedisLimiter } from "../src/adapters/limiter.redis.js";
import { handleSend, SendHandlerContext } from "../src/core/send-handler.js";
import { eventLog } from "../src/adapters/eventlog.prisma.js";
import { SystemClock } from "../src/adapters/clock.system.js";
import { Transport } from "../src/core/ports.js";

describe("Milestones 6 & 7: Send Handler, Worker, and Atomic Lua Limiter", () => {
  const limiter = new RedisLimiter(redis);
  let userId: string;
  let senderId: string;
  let campaignId: string;

  beforeAll(async () => {
    // Clean test keys
    const keys = await redis.keys("rl:test-*");
    if (keys.length > 0) await redis.del(...keys);

    const user = await prisma.user.create({
      data: {
        googleId: `google_m6m7_${Date.now()}`,
        email: `m6m7_${Date.now()}@test.com`,
        name: "M6M7 Tester"
      }
    });
    userId = user.id;

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: "Test Limiter Sender",
        fromEmail: "limiter@example.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "test",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 50,
        minDelayMs: 200,
        health: "HEALTHY",
        isActive: true
      }
    });
    senderId = sender.id;

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        subject: "M6/M7 Campaign",
        bodyTemplate: "Test body",
        startAt: new Date(),
        delayMs: 200,
        hourlyLimit: 50,
        total: 100
      }
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("ATOMIC LUA LIMITER: 500 parallel reserve calls at limit 100 allow exactly 100", async () => {
    const testSenderId = `test-limit-${Date.now()}`;
    const now = Date.now();
    const limit = 100;
    const gapMs = 10;

    const promises = [];
    for (let i = 0; i < 500; i++) {
      promises.push(
        limiter.reserve({
          senderId: testSenderId,
          now: now + i * 20, // Spread out past gapMs
          limit,
          gapMs,
          mode: "fixed"
        })
      );
    }

    const results = await Promise.all(promises);
    const allowed = results.filter((r) => r.allowed);
    const limited = results.filter((r) => !r.allowed && r.reason === "LIMITED");

    expect(allowed.length).toBe(100);
    expect(limited.length).toBe(400);

    // Verify limitReachedNow was true exactly once
    const flags = allowed.filter((r) => r.allowed && r.limitReachedNow);
    expect(flags.length).toBe(1);
  });

  it("ATOMIC LUA LIMITER: Enforces min delay gapMs between consecutive reservations", async () => {
    const testSenderId = `test-gap-${Date.now()}`;
    const now = 1700000000000;
    const gapMs = 2000;

    // Call 1: Allowed at now
    const res1 = await limiter.reserve({
      senderId: testSenderId,
      now,
      limit: 10,
      gapMs,
      mode: "fixed"
    });
    expect(res1.allowed).toBe(true);

    // Call 2: Arrives 500ms later (too soon! must wait for now + 2000)
    const res2 = await limiter.reserve({
      senderId: testSenderId,
      now: now + 500,
      limit: 10,
      gapMs,
      mode: "fixed"
    });
    expect(res2.allowed).toBe(false);
    if (!res2.allowed) {
      expect(res2.reason).toBe("TOO_SOON");
      expect(res2.retryAt).toBe(now + gapMs);
    }
  });

  it("ATOMIC DB CLAIM: Two concurrent workers claiming the same email - only ONE wins", async () => {
    const email = await prisma.email.create({
      data: {
        campaignId,
        userId,
        senderId,
        toEmail: "claim_race@test.com",
        subject: "Claim race",
        body: "Race body",
        seq: 0,
        plannedAt: new Date(),
        scheduledAt: new Date(),
        status: "SCHEDULED"
      }
    });

    const mockTransport: Transport = {
      send: async () => ({ messageId: "<race@test.com>" })
    };

    const ctx = (workerId: string): SendHandlerContext => ({
      clock: new SystemClock(),
      prisma,
      limiter: {
        reserve: async () => ({
          allowed: true,
          limitReachedNow: false,
          reservedAt: Date.now(),
          windowCount: 1
        })
      },
      transportFactory: async () => mockTransport,
      eventLog,
      workerId
    });

    // Run two workers simultaneously
    const [outcome1, outcome2] = await Promise.all([
      handleSend(email.id, ctx("worker-A")),
      handleSend(email.id, ctx("worker-B"))
    ]);

    const outcomes = [outcome1.outcome, outcome2.outcome];
    expect(outcomes).toContain("SENT");
    expect(outcomes).toContain("CLAIM_LOST");

    const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
    expect(updatedEmail?.status).toBe("SENT");
    expect(updatedEmail?.attempts).toBe(1); // Only 1 attempt claimed!
  });

  it("RESCHEDULE BEHAVIOR: Rate limit denial postpones email without consuming retry attempts", async () => {
    const email = await prisma.email.create({
      data: {
        campaignId,
        userId,
        senderId,
        toEmail: "reschedule_test@test.com",
        subject: "Reschedule test",
        body: "Reschedule body",
        seq: 1,
        plannedAt: new Date(),
        scheduledAt: new Date(),
        status: "SCHEDULED",
        attempts: 0
      }
    });

    const futureRetry = Date.now() + 3600000;
    const mockDenyingLimiter = {
      reserve: async () => ({
        allowed: false as const,
        reason: "RATE_LIMIT" as const,
        retryAt: futureRetry
      })
    };

    const outcome = await handleSend(email.id, {
      clock: new SystemClock(),
      prisma,
      limiter: mockDenyingLimiter,
      transportFactory: async () => ({ send: async () => ({ messageId: "fake" }) }),
      eventLog
    });

    expect(outcome.outcome).toBe("RESCHEDULED");
    if (outcome.outcome === "RESCHEDULED") {
      expect(outcome.retryAt).toBe(futureRetry);
      expect(outcome.reason).toBe("RATE_LIMIT");
    }

    const updated = await prisma.email.findUnique({ where: { id: email.id } });
    expect(updated?.status).toBe("SCHEDULED"); // Still SCHEDULED!
    expect(updated?.attempts).toBe(0);         // No attempts consumed!
    expect(updated?.scheduledAt.getTime()).toBe(futureRetry);

    const events = await prisma.emailEvent.findMany({ where: { emailId: email.id } });
    expect(events.some((e) => e.type === "RESCHEDULED")).toBe(true);
  });
});
