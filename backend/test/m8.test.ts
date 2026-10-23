import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";
import { emailQueue } from "../src/adapters/queue.bullmq.js";
import { reconcileQueue } from "../src/queue/reconciler.js";

describe("Milestone 8: Persistence and Reconciler", () => {
  let authToken: string;
  let userId: string;
  let senderId: string;
  let campaignId: string;

  beforeAll(async () => {
    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "m8_reconciler@example.com", name: "M8 Reconciler" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: "Reconcile Sender",
        fromEmail: "rec@test.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "test",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 50,
        health: "HEALTHY",
        isActive: true
      }
    });
    senderId = sender.id;

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        subject: "Reconcile Campaign",
        bodyTemplate: "Body",
        startAt: new Date(),
        delayMs: 2000,
        hourlyLimit: 50,
        total: 2
      }
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await emailQueue.drain();
    await emailQueue.close();
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("rebuilds missing BullMQ jobs from PostgreSQL after queue is drained", async () => {
    // 1. Create a SCHEDULED email in DB
    const email = await prisma.email.create({
      data: {
        campaignId,
        userId,
        senderId,
        toEmail: "lost_job@example.com",
        subject: "Lost Job",
        body: "Body",
        seq: 0,
        plannedAt: new Date(Date.now() + 60000),
        scheduledAt: new Date(Date.now() + 60000),
        status: "SCHEDULED"
      }
    });

    // Verify job is NOT in queue
    let job = await emailQueue.getJob(email.id);
    expect(job).toBeUndefined();

    // 2. Run reconciler
    const result = await reconcileQueue();
    expect(result.jobsRebuilt).toBeGreaterThanOrEqual(1);

    // 3. Verify job was re-created in BullMQ with jobId = emailId
    job = await emailQueue.getJob(email.id);
    expect(job).toBeDefined();
    expect(job!.id).toBe(email.id);
  }, 15000);

  it("reclaims stale PROCESSING emails and appends RECOVERED event", async () => {
    // Create an abandoned email stuck in PROCESSING
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const staleEmail = await prisma.email.create({
      data: {
        campaignId,
        userId,
        senderId,
        toEmail: "stale_processing@example.com",
        subject: "Stale Email",
        body: "Body",
        seq: 1,
        plannedAt: twoHoursAgo,
        scheduledAt: twoHoursAgo,
        status: "PROCESSING",
        claimedAt: twoHoursAgo,
        attempts: 1
      }
    });

    // Run reconciler
    const result = await reconcileQueue();
    expect(result.staleRecovered).toBeGreaterThanOrEqual(1);

    // Verify status was reverted to SCHEDULED
    const updated = await prisma.email.findUnique({
      where: { id: staleEmail.id }
    });
    expect(updated?.status).toBe("SCHEDULED");

    // Verify RECOVERED event in ledger
    const events = await prisma.emailEvent.findMany({
      where: { emailId: staleEmail.id }
    });
    const recoveredEvent = events.find((e) => e.type === "RECOVERED");
    expect(recoveredEvent).toBeDefined();
    expect((recoveredEvent?.data as Record<string, unknown>).reason).toBe("STALE");

    // Verify its BullMQ job was restored
    const job = await emailQueue.getJob(staleEmail.id);
    expect(job).toBeDefined();
  }, 15000);

  it("IDEMPOTENT DOUBLE-RUN: Running reconciler twice in a row does nothing extra", async () => {
    const run1 = await reconcileQueue();
    const run2 = await reconcileQueue();

    expect(run2.staleRecovered).toBe(0);
    expect(run2.jobsRebuilt).toBe(0);
  }, 15000);

  it("POST /admin/reconcile triggers reconciliation via admin endpoint", async () => {
    const res = await request(app)
      .post("/admin/reconcile")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.staleRecovered).toBeDefined();
    expect(res.body.jobsRebuilt).toBeDefined();
  }, 15000);
});
