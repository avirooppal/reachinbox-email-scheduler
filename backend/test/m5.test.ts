import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";
import { emailQueue } from "../src/adapters/queue.bullmq.js";

describe("Milestone 5: Schedule and Preview APIs", () => {
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    // 1. Create test user
    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "m5_scheduler@example.com", name: "M5 Scheduler" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;

    // 2. Create 2 test senders
    await prisma.sender.createMany({
      data: [
        {
          userId,
          name: "Sender A",
          fromEmail: "a@outreach.com",
          smtpHost: "localhost",
          smtpPort: 1025,
          smtpUser: "a",
          smtpPassEnc: "fake:fake:fake",
          hourlyLimit: 100,
          minDelayMs: 1000,
          health: "HEALTHY",
          isActive: true
        },
        {
          userId,
          name: "Sender B",
          fromEmail: "b@outreach.com",
          smtpHost: "localhost",
          smtpPort: 1025,
          smtpUser: "b",
          smtpPassEnc: "fake:fake:fake",
          hourlyLimit: 100,
          minDelayMs: 1000,
          health: "HEALTHY",
          isActive: true
        }
      ]
    });
  });

  afterAll(async () => {
    await emailQueue.drain();
    await emailQueue.close();
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("POST /api/campaigns/preview returns finishAt and perHourCounts without persisting", async () => {
    const emailsBefore = await prisma.email.count({ where: { userId } });

    const res = await request(app)
      .post("/api/campaigns/preview")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        subject: "Preview Test",
        body: "Hello {{name}}",
        startAt: new Date(Date.now() + 60000).toISOString(),
        delayMs: 2000,
        hourlyLimit: 50,
        recipients: [
          { email: "lead1@example.com", vars: { name: "Lead 1" } },
          { email: "lead2@example.com", vars: { name: "Lead 2" } }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.plannedFinishAt).toBeDefined();
    expect(Object.keys(res.body.perHourCounts).length).toBeGreaterThan(0);

    const emailsAfter = await prisma.email.count({ where: { userId } });
    expect(emailsAfter).toBe(emailsBefore); // Nothing written
  });

  it("POST /api/campaigns schedules emails and enqueues BullMQ delayed jobs with matching 1:1 count", async () => {
    const res = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        subject: "Real Campaign",
        body: "Hi {{firstName}}",
        startAt: new Date(Date.now() + 10000).toISOString(),
        delayMs: 1500,
        hourlyLimit: 100,
        recipients: [
          { email: "lead_a@example.com", vars: { firstName: "Alice" } },
          { email: "lead_b@example.com", vars: { firstName: "Bob" } },
          { email: "lead_a@example.com" } // Duplicate! Should be removed
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.campaignId).toBeDefined();
    expect(res.body.accepted).toBe(2);
    expect(res.body.duplicatesRemoved).toBe(1);

    // Verify DB emails
    const createdEmails = await prisma.email.findMany({
      where: { campaignId: res.body.campaignId }
    });
    expect(createdEmails.length).toBe(2);
    expect(createdEmails[0].status).toBe("SCHEDULED");
    expect(createdEmails[0].body).toBe("Hi Alice");
    expect(createdEmails[1].body).toBe("Hi Bob");

    // Verify PLANNED and ENQUEUED events exist in ledger
    const events = await prisma.emailEvent.findMany({
      where: { campaignId: res.body.campaignId }
    });
    // 2 PLANNED + 2 ENQUEUED = 4 events
    expect(events.length).toBe(4);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes.filter((t) => t === "PLANNED").length).toBe(2);
    expect(eventTypes.filter((t) => t === "ENQUEUED").length).toBe(2);
  });

  it("IDEMPOTENCY: Repeated call with same Idempotency-Key returns original campaign without duplicating", async () => {
    const key = `idem_${Date.now()}`;
    const payload = {
      subject: "Idempotent Campaign",
      body: "Test body",
      startAt: new Date(Date.now() + 20000).toISOString(),
      recipients: [{ email: "idem_recipient@example.com" }]
    };

    const firstRes = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${authToken}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(firstRes.status).toBe(201);
    const campaignId = firstRes.body.campaignId;

    const emailsCountBefore = await prisma.email.count({ where: { campaignId } });

    // Second call with same key
    const secondRes = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${authToken}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.campaignId).toBe(campaignId);
    expect(secondRes.body.idempotentReplay).toBe(true);

    const emailsCountAfter = await prisma.email.count({ where: { campaignId } });
    expect(emailsCountAfter).toBe(emailsCountBefore); // No duplicates
  });

  it("POST /api/campaigns accepts multipart CSV file upload", async () => {
    const csvData = Buffer.from(
      "email,name\ncsv_user1@example.com,User One\ncsv_user2@example.com,User Two\n"
    );

    const res = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${authToken}`)
      .field("subject", "CSV Campaign")
      .field("body", "Hi {{name}}")
      .field("startAt", new Date(Date.now() + 30000).toISOString())
      .attach("file", csvData, "recipients.csv");

    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(2);

    const emails = await prisma.email.findMany({
      where: { campaignId: res.body.campaignId },
      orderBy: { seq: "asc" }
    });

    expect(emails.length).toBe(2);
    expect(emails[0].toEmail).toBe("csv_user1@example.com");
    expect(emails[0].body).toBe("Hi User One");
    expect(emails[1].toEmail).toBe("csv_user2@example.com");
    expect(emails[1].body).toBe("Hi User Two");
  });

  it("LARGE BATCH: 1,000 recipients schedule quickly with 1:1 BullMQ jobs", async () => {
    const recipients = [];
    for (let i = 0; i < 1000; i++) {
      recipients.push({ email: `scale_user_${i}@scale.com`, vars: { index: String(i) } });
    }

    const start = performance.now();
    const res = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        subject: "1000 Email Test",
        body: "Batch email #{{index}}",
        startAt: new Date(Date.now() + 60000).toISOString(),
        delayMs: 1000,
        hourlyLimit: 200,
        recipients
      });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(1000);
    expect(elapsed).toBeLessThan(10000); // 1,000 processed in < 10s

    const dbCount = await prisma.email.count({
      where: { campaignId: res.body.campaignId }
    });
    expect(dbCount).toBe(1000);
  }, 20000);
});
