import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";
import { runAudit } from "../tools/audit.js";

describe("Milestone 9: Invariant Auditor", () => {
  let authToken: string;
  let userId: string;
  let senderId: string;
  let campaignId: string;

  beforeAll(async () => {
    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "auditor_tester@example.com", name: "Auditor Tester" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: "Audit Sender",
        fromEmail: "audit@test.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "test",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 50,
        minDelayMs: 2000,
        health: "HEALTHY",
        isActive: true
      }
    });
    senderId = sender.id;

    const campaign = await prisma.campaign.create({
      data: {
        userId,
        subject: "Audit Test Campaign",
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
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("passes all 7 invariants on clean valid campaign data", async () => {
    const email = await prisma.email.create({
      data: {
        campaignId,
        userId,
        senderId,
        toEmail: "clean_audit@test.com",
        subject: "Clean",
        body: "Body",
        seq: 0,
        plannedAt: new Date(1700000000000),
        scheduledAt: new Date(1700000000000),
        status: "SENT",
        messageId: "<clean-1@test.com>",
        sentAt: new Date(1700000002000)
      }
    });

    await prisma.emailEvent.createMany({
      data: [
        {
          emailId: email.id,
          campaignId,
          senderId,
          type: "PLANNED",
          at: new Date(1700000000000),
          data: { plannedAt: new Date(1700000000000).toISOString() }
        },
        {
          emailId: email.id,
          campaignId,
          senderId,
          type: "SLOT_RESERVED",
          at: new Date(1700000000000),
          data: { reservedAt: 1700000000000, limit: 50, gapMs: 2000, windowCount: 1 }
        },
        {
          emailId: email.id,
          campaignId,
          senderId,
          type: "SENT",
          at: new Date(1700000002000),
          data: { messageId: "<clean-1@test.com>" }
        }
      ]
    });

    const report = await runAudit(campaignId);
    expect(report.passed).toBe(true);
    expect(report.invariants.I1.passed).toBe(true);
    expect(report.invariants.I2.passed).toBe(true);
    expect(report.invariants.I3.passed).toBe(true);
    expect(report.invariants.I4.passed).toBe(true);
    expect(report.invariants.I5.passed).toBe(true);
    expect(report.invariants.I6.passed).toBe(true);
    expect(report.invariants.I7.passed).toBe(true);
  });

  it("CORRUPTION TEST (I1): Catches duplicate sends for the same email", async () => {
    // Inject a rogue duplicate SENT event for the same email
    const email = await prisma.email.findFirst({ where: { campaignId } });
    expect(email).toBeDefined();

    await prisma.emailEvent.create({
      data: {
        emailId: email!.id,
        campaignId,
        senderId,
        type: "SENT",
        at: new Date(),
        data: { messageId: "<duplicate@test.com>" }
      }
    });

    const report = await runAudit(campaignId);
    expect(report.passed).toBe(false);
    expect(report.invariants.I1.passed).toBe(false);
    expect(report.invariants.I1.message).toContain("duplicate sends");
  });

  it("CORRUPTION TEST (I2): Catches hourly limit breaches", async () => {
    const corruptCamp = await prisma.campaign.create({
      data: {
        userId,
        subject: "Cap Breach Campaign",
        bodyTemplate: "Body",
        startAt: new Date(),
        delayMs: 1000,
        hourlyLimit: 2, // Low cap of 2
        total: 3
      }
    });

    const email = await prisma.email.create({
      data: {
        campaignId: corruptCamp.id,
        userId,
        senderId,
        toEmail: "breach@test.com",
        subject: "Breach",
        body: "Body",
        seq: 0,
        plannedAt: new Date(),
        scheduledAt: new Date(),
        status: "SCHEDULED"
      }
    });

    // Inject 3 reservations in the same hour when limit is 2
    const now = 1700000000000;
    await prisma.emailEvent.createMany({
      data: [
        {
          emailId: email.id,
          campaignId: corruptCamp.id,
          senderId,
          type: "SLOT_RESERVED",
          at: new Date(now),
          data: { reservedAt: now, limit: 2, gapMs: 1000 }
        },
        {
          emailId: email.id,
          campaignId: corruptCamp.id,
          senderId,
          type: "SLOT_RESERVED",
          at: new Date(now + 1000),
          data: { reservedAt: now + 1000, limit: 2, gapMs: 1000 }
        },
        {
          emailId: email.id,
          campaignId: corruptCamp.id,
          senderId,
          type: "SLOT_RESERVED",
          at: new Date(now + 2000),
          data: { reservedAt: now + 2000, limit: 2, gapMs: 1000 }
        }
      ]
    });

    const report = await runAudit(corruptCamp.id);
    expect(report.passed).toBe(false);
    expect(report.invariants.I2.passed).toBe(false);
    expect(report.invariants.I2.message).toContain("BREACH DETECTED");
  });

  it("CORRUPTION TEST (I3): Catches minimum gap violations", async () => {
    const gapCamp = await prisma.campaign.create({
      data: {
        userId,
        subject: "Gap Campaign",
        bodyTemplate: "Body",
        startAt: new Date(),
        delayMs: 5000,
        hourlyLimit: 100,
        total: 1
      }
    });

    const email = await prisma.email.create({
      data: {
        campaignId: gapCamp.id,
        userId,
        senderId,
        toEmail: "gap_breach@test.com",
        subject: "Gap",
        body: "Body",
        seq: 0,
        plannedAt: new Date(),
        scheduledAt: new Date(),
        status: "SCHEDULED"
      }
    });

    // Required gap is 5000ms, but reservations are only 500ms apart!
    const t = 1700005000000;
    await prisma.emailEvent.createMany({
      data: [
        {
          emailId: email.id,
          campaignId: gapCamp.id,
          senderId,
          type: "SLOT_RESERVED",
          at: new Date(t),
          data: { reservedAt: t, limit: 100, gapMs: 5000 }
        },
        {
          emailId: email.id,
          campaignId: gapCamp.id,
          senderId,
          type: "SLOT_RESERVED",
          at: new Date(t + 500),
          data: { reservedAt: t + 500, limit: 100, gapMs: 5000 }
        }
      ]
    });

    const report = await runAudit(gapCamp.id);
    expect(report.passed).toBe(false);
    expect(report.invariants.I3.passed).toBe(false);
  });

  it("CORRUPTION TEST (I5): Catches early send violations", async () => {
    const earlyCamp = await prisma.campaign.create({
      data: {
        userId,
        subject: "Early Campaign",
        bodyTemplate: "Body",
        startAt: new Date(),
        delayMs: 1000,
        hourlyLimit: 100,
        total: 1
      }
    });

    // Scheduled for 10:00:00 but sent at 09:30:00!
    await prisma.email.create({
      data: {
        campaignId: earlyCamp.id,
        userId,
        senderId,
        toEmail: "early@test.com",
        subject: "Early",
        body: "Body",
        seq: 0,
        plannedAt: new Date("2026-10-23T10:00:00Z"),
        scheduledAt: new Date("2026-10-23T10:00:00Z"),
        status: "SENT",
        sentAt: new Date("2026-10-23T09:30:00Z")
      }
    });

    const report = await runAudit(earlyCamp.id);
    expect(report.passed).toBe(false);
    expect(report.invariants.I5.passed).toBe(false);
    expect(report.invariants.I5.message).toContain("1 early send violations");
  });

  it("GET /admin/audit responds with full audit report JSON and formatted string", async () => {
    const res = await request(app)
      .get(`/admin/audit?campaignId=${campaignId}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invariants).toBeDefined();
    expect(res.body.formatted).toContain("AUDIT");
  });
});
