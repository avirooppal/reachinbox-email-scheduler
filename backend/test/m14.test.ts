import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";

describe("M14: Operations & Observability", () => {
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "ops-tester@example.com", name: "Ops Tester" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it("GET /metrics responds with Prometheus metrics format", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("outbox_emails_sent_total");
    expect(res.text).toContain("outbox_queue_depth");
  });

  it("GET /api/stats returns queue depths, sender capacity, and next scheduled send", async () => {
    const res = await request(app)
      .get("/api/stats")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.queues).toBeDefined();
    expect(res.body.queues.emailDelivery).toBeDefined();
    expect(res.body.senders).toBeDefined();
    expect(res.body.serverTime).toBeDefined();
  });

  it("GET /api/emails lists paginated emails for dashboard", async () => {
    const res = await request(app)
      .get("/api/emails?page=1&limit=10")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.emails)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(typeof res.body.total).toBe("number");
  });

  it("GET /admin/queues mounts Bull Board dashboard", async () => {
    const res = await request(app).get("/admin/queues/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Bull Dashboard");
  });
});
