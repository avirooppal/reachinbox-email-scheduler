import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { CircuitBreaker } from "../src/core/breaker.js";
import { handleSend } from "../src/core/send-handler.js";
import { SystemClock } from "../src/adapters/clock.system.js";
import { RedisLimiter } from "../src/adapters/limiter.redis.js";
import { MockTransport } from "../src/adapters/transport.mock.js";
import { eventLog } from "../src/adapters/eventlog.prisma.js";

describe("M11: Circuit Breaker & Failover", () => {
  let user: { id: string };
  let primarySender: { id: string };
  let fallbackSender: { id: string };

  beforeAll(async () => {
    const testEmail = `m11-${Date.now()}@example.com`;
    user = await prisma.user.create({
      data: {
        googleId: `m11-google-${Date.now()}`,
        email: testEmail,
        name: "M11 Tester"
      }
    });

    primarySender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Primary Sender",
        fromEmail: "primary@domain.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "u1",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 100,
        minDelayMs: 10,
        health: "HEALTHY",
        isActive: true
      }
    });

    fallbackSender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Fallback Sender",
        fromEmail: "fallback@domain.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "u2",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 100,
        minDelayMs: 10,
        health: "HEALTHY",
        isActive: true
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("trips breaker from HEALTHY to OPEN after threshold failures", async () => {
    const breaker = new CircuitBreaker(redis, prisma, {
      windowMs: 5000,
      failureThreshold: 3,
      cooldownMs: 2000
    });

    const s1 = await breaker.checkHealth(primarySender.id);
    expect(s1).toBe("HEALTHY");

    await breaker.recordFailure(primarySender.id, "Connection refused");
    await breaker.recordFailure(primarySender.id, "Connection timeout");
    const tripped = await breaker.recordFailure(primarySender.id, "Host unreachable");
    expect(tripped).toBe(true);

    const s2 = await breaker.checkHealth(primarySender.id);
    expect(s2).toBe("OPEN");

    const dbSender = await prisma.sender.findUnique({ where: { id: primarySender.id } });
    expect(dbSender?.health).toBe("OPEN");
  });

  it("fails over to healthy sibling sender when assigned sender is OPEN", async () => {
    const breaker = new CircuitBreaker(redis, prisma);
    const clock = new SystemClock();
    const limiter = new RedisLimiter(redis);
    const mockTransport = new MockTransport();

    // Create campaign and email assigned to primarySender (which is now OPEN)
    const campaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        subject: "Failover Test",
        bodyTemplate: "Body",
        startAt: new Date(),
        delayMs: 10,
        hourlyLimit: 100,
        total: 1,
        plannedFinishAt: new Date()
      }
    });

    const email = await prisma.email.create({
      data: {
        campaignId: campaign.id,
        userId: user.id,
        senderId: primarySender.id,
        toEmail: "target@client.com",
        subject: "Failover Notice",
        body: "Hello",
        seq: 0,
        plannedAt: new Date(),
        scheduledAt: new Date(),
        status: "SCHEDULED"
      }
    });

    const outcome = await handleSend(email.id, {
      clock,
      prisma,
      limiter,
      transportFactory: async () => mockTransport,
      eventLog,
      breaker
    });

    expect(outcome.outcome).toBe("SENT");

    // Check DB: email senderId must now be fallbackSender
    const updatedEmail = await prisma.email.findUnique({ where: { id: email.id } });
    expect(updatedEmail?.senderId).toBe(fallbackSender.id);
    expect(updatedEmail?.status).toBe("SENT");

    // Verify FAILOVER event recorded
    const failoverEvent = await prisma.emailEvent.findFirst({
      where: { emailId: email.id, type: "FAILOVER" }
    });
    expect(failoverEvent).toBeDefined();
    expect((failoverEvent?.data as any).fromSenderId).toBe(primarySender.id);
    expect((failoverEvent?.data as any).toSenderId).toBe(fallbackSender.id);
  });

  it("recovers circuit breaker to HEALTHY on success", async () => {
    const breaker = new CircuitBreaker(redis, prisma);
    await breaker.recordSuccess(primarySender.id);

    const health = await breaker.checkHealth(primarySender.id);
    expect(health).toBe("HEALTHY");
  });
});
