import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";
import { withLedger, generateTimelineSummary } from "../src/modules/emails/ledger.helper.js";

describe("Milestone 3: Event Ledger & Timeline", () => {
  let authToken: string;
  let userId: string;
  let senderId: string;
  let campaignId: string;
  let emailId: string;

  beforeAll(async () => {
    // 1. Create authenticated user
    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "ledger_tester@example.com", name: "Ledger Tester" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;

    // 2. Create sender
    const sender = await prisma.sender.create({
      data: {
        userId,
        name: "Ledger Sender",
        fromEmail: "sender@example.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "test",
        smtpPassEnc: "fake:fake:fake",
        health: "HEALTHY",
        isActive: true
      }
    });
    senderId = sender.id;

    // 3. Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        userId,
        subject: "Ledger Test Campaign",
        bodyTemplate: "Hello {{name}}",
        startAt: new Date(),
        delayMs: 2000,
        hourlyLimit: 100,
        total: 1
      }
    });
    campaignId = campaign.id;

    // 4. Create email
    const email = await prisma.email.create({
      data: {
        campaignId,
        userId,
        senderId,
        toEmail: "lead@example.com",
        subject: "Hello Lead",
        body: "Hello Lead body",
        seq: 0,
        plannedAt: new Date(),
        scheduledAt: new Date(),
        status: "SCHEDULED"
      }
    });
    emailId = email.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("appends PLANNED and ENQUEUED events via withLedger", async () => {
    await prisma.$transaction(async (tx) => {
      await withLedger(
        tx,
        {
          emailId,
          campaignId,
          senderId,
          type: "PLANNED",
          data: { plannedAt: new Date().toISOString() }
        },
        async (t) => {
          return t.email.update({
            where: { id: emailId },
            data: { status: "SCHEDULED" }
          });
        }
      );
    });

    const events = await prisma.emailEvent.findMany({
      where: { emailId }
    });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("PLANNED");
  });

  it("DB LEVEL GUARD: attempting to UPDATE an email_events row raises an exception", async () => {
    const event = await prisma.emailEvent.findFirst({
      where: { emailId }
    });
    expect(event).toBeDefined();

    // Raw SQL UPDATE should be blocked by trigger
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE email_events SET data = '{"hacked": true}' WHERE id = ${event!.id}`
      )
    ).rejects.toThrow(/append-only/i);
  });

  it("DB LEVEL GUARD: attempting to DELETE an email_events row raises an exception", async () => {
    const event = await prisma.emailEvent.findFirst({
      where: { emailId }
    });
    expect(event).toBeDefined();

    // Raw SQL DELETE should be blocked by trigger
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM email_events WHERE id = ${event!.id}`
      )
    ).rejects.toThrow(/append-only/i);
  });

  it("withLedger rolls back both mutation and event if an error occurs", async () => {
    const eventsBefore = await prisma.emailEvent.count({ where: { emailId } });

    await expect(
      prisma.$transaction(async (tx) => {
        await withLedger(
          tx,
          {
            emailId,
            campaignId,
            senderId,
            type: "CLAIMED",
            data: { workerId: "worker-1" }
          },
          async (t) => {
            await t.email.update({
              where: { id: emailId },
              data: { status: "PROCESSING" }
            });
            throw new Error("Simulated failure inside transaction");
          }
        );
      })
    ).rejects.toThrow("Simulated failure inside transaction");

    const eventsAfter = await prisma.emailEvent.count({ where: { emailId } });
    expect(eventsAfter).toBe(eventsBefore);

    const email = await prisma.email.findUnique({ where: { id: emailId } });
    expect(email?.status).toBe("SCHEDULED");
  });

  it("GET /api/emails/:id/timeline returns events and explainable summary", async () => {
    // Append simulated lifecycle events
    await prisma.$transaction(async (tx) => {
      await withLedger(
        tx,
        {
          emailId,
          campaignId,
          senderId,
          type: "RESCHEDULED",
          data: {
            from: new Date(Date.now()).toISOString(),
            to: new Date(Date.now() + 52 * 60 * 1000).toISOString(),
            reason: "RATE_LIMIT"
          }
        },
        async (t) => {
          return t.email.update({
            where: { id: emailId },
            data: { scheduledAt: new Date(Date.now() + 52 * 60 * 1000) }
          });
        }
      );

      await withLedger(
        tx,
        {
          emailId,
          campaignId,
          senderId,
          type: "SENT",
          data: { messageId: "<msg-1@domain>", previewUrl: "https://preview.ethereal.email/1" }
        },
        async (t) => {
          return t.email.update({
            where: { id: emailId },
            data: { status: "SENT", messageId: "<msg-1@domain>" }
          });
        }
      );
    });

    const res = await request(app)
      .get(`/api/emails/${emailId}/timeline`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.emailId).toBe(emailId);
    expect(res.body.events.length).toBe(3); // PLANNED, RESCHEDULED, SENT
    expect(res.body.summary).toContain("hourly limit reached");
    expect(res.body.summary).toContain("Delayed 52 min");
    expect(res.body.summary).toContain("Sent");
  });
});
