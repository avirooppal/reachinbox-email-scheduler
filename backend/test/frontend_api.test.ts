import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";

describe("Frontend API Extensions", () => {
  let authToken = "";
  let userEmail = `frontend_test_${Date.now()}@example.com`;
  let userId = "";

  beforeAll(async () => {
    // 1. Test registration
    const res = await request(app)
      .post("/auth/register")
      .send({
        email: userEmail,
        password: "secretPassword123",
        name: "Frontend Test User"
      });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(userEmail);
    expect(res.body.token).toBeDefined();
    authToken = res.body.token;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    try {
      await prisma.email.deleteMany({ where: { userId } });
      await prisma.campaign.deleteMany({ where: { userId } });
      await prisma.attachment.deleteMany({ where: { userId } });
      await prisma.sender.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    } catch {}
  });

  it("authenticates via POST /auth/login with valid password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({
        email: userEmail,
        password: "secretPassword123"
      });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(userEmail);
    expect(res.body.token).toBeDefined();
  });

  it("rejects POST /auth/login with incorrect password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({
        email: userEmail,
        password: "wrongPassword"
      });

    expect(res.status).toBe(401);
  });

  it("returns email counts via GET /api/emails/counts", async () => {
    const res = await request(app)
      .get("/api/emails/counts")
      .set("Authorization", `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.scheduled).toBe("number");
    expect(typeof res.body.sent).toBe("number");
  });

  it("supports file uploads via POST /api/attachments", async () => {
    const res = await request(app)
      .post("/api/attachments")
      .set("Authorization", `Bearer ${authToken}`)
      .attach("files", Buffer.from("dummy attachment content"), "test_file.txt");

    expect(res.status).toBe(201);
    expect(res.body.attachments).toHaveLength(1);
    const attachmentId = res.body.attachments[0].id;

    // Download attachment
    const downloadRes = await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.text).toBe("dummy attachment content");
  });
});
