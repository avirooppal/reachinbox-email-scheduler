import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";
import { decrypt } from "../src/utils/crypto.js";

describe("Milestone 2: Senders & SMTP Management", () => {
  let authToken: string;
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    // Generate test user session
    const res = await request(app)
      .post("/auth/test-token")
      .send({ email: "sender_tester@example.com", name: "Sender Tester" });

    authToken = res.body.token;
    authCookie = res.headers["set-cookie"][0];
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("GET /api/senders returns 401 without auth", async () => {
    const res = await request(app).get("/api/senders");
    expect(res.status).toBe(401);
  });

  it("POST /api/senders/ethereal creates an active test sender", async () => {
    const res = await request(app)
      .post("/api/senders/ethereal")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Automated Test Ethereal" });

    expect(res.status).toBe(201);
    expect(res.body.sender).toBeDefined();
    expect(res.body.sender.name).toBe("Automated Test Ethereal");
    expect(res.body.sender.fromEmail).toContain("@ethereal.email");
    expect(res.body.sender.health).toBe("HEALTHY");
    expect(res.body.sender.isActive).toBe(true);

    // Verify secret is encrypted in PostgreSQL
    const rawSender = await prisma.sender.findUnique({
      where: { id: res.body.sender.id }
    });
    expect(rawSender).toBeDefined();
    expect(rawSender!.smtpPassEnc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

    const decrypted = decrypt(rawSender!.smtpPassEnc);
    expect(decrypted.length).toBeGreaterThan(0);
  }, 30000);

  it("GET /api/senders returns the user's senders without exposing passwords", async () => {
    const res = await request(app)
      .get("/api/senders")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.senders)).toBe(true);
    expect(res.body.senders.length).toBeGreaterThanOrEqual(1);
    expect(res.body.senders[0].smtpPassEnc).toBeUndefined();
    expect(res.body.senders[0].hasPassword).toBe(true);
  });

  it("POST /api/senders with invalid SMTP config returns a clear error", async () => {
    const res = await request(app)
      .post("/api/senders")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Broken SMTP",
        fromEmail: "broken@example.com",
        smtpHost: "127.0.0.1",
        smtpPort: 19999, // Unused port
        smtpUser: "wrong",
        smtpPass: "wrong"
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SMTP verification failed/i);
  }, 10000);

  it("PATCH /api/senders/:id updates sender limits", async () => {
    const listRes = await request(app)
      .get("/api/senders")
      .set("Authorization", `Bearer ${authToken}`);

    const senderId = listRes.body.senders[0].id;

    const res = await request(app)
      .patch(`/api/senders/${senderId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        hourlyLimit: 75,
        minDelayMs: 3500
      });

    expect(res.status).toBe(200);
    expect(res.body.sender.hourlyLimit).toBe(75);
    expect(res.body.sender.minDelayMs).toBe(3500);
  });
});
