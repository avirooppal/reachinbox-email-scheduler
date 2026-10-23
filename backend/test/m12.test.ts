import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient, EMAIL_INDEX_NAME, initElasticsearchIndex } from "../src/infra/elasticsearch.js";
import { createSearchIndexWorker } from "../src/queue/search-index.worker.js";

describe("M12: Elasticsearch Integration", () => {
  let authToken: string;
  let userId: string;
  let senderId: string;
  let esWorker: any;

  beforeAll(async () => {
    await initElasticsearchIndex();
    esWorker = createSearchIndexWorker("test-es-worker");

    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "es-tester@example.com", name: "ES Tester" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: "ES Sender",
        fromEmail: "es@domain.com",
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "u",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 50,
        minDelayMs: 10,
        health: "HEALTHY",
        isActive: true
      }
    });
    senderId = sender.id;
  });

  afterAll(async () => {
    if (esWorker) await esWorker.close();
    await prisma.$disconnect();
    await redis.quit();
  });

  it("indexes scheduled emails and supports full-text search with highlights", async () => {
    // Schedule a campaign with distinctive keywords
    const scheduleRes = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        subject: "Hyperdrive Quantum Propulsion Announcement",
        body: "We are pleased to introduce the graviton warp accelerator.",
        startAt: new Date().toISOString(),
        recipients: [{ email: "starlight@astral.org" }]
      });

    expect(scheduleRes.status).toBe(201);

    // Wait a brief moment for worker to process indexing job
    await new Promise((r) => setTimeout(r, 1200));
    await esClient.indices.refresh({ index: EMAIL_INDEX_NAME });

    // Search via /api/emails/search
    const searchRes = await request(app)
      .get("/api/emails/search?q=graviton")
      .set("Authorization", `Bearer ${authToken}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.total).toBeGreaterThanOrEqual(1);
    expect(searchRes.body.emails[0].subject).toContain("Hyperdrive Quantum");
    expect(searchRes.body.emails[0].highlights.body).toBeDefined();
    expect(searchRes.body.emails[0].highlights.body[0]).toContain("<em>graviton</em>");
  });
});
