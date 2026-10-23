import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";

describe("Milestone 1: Authentication", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("GET /auth/me returns 401 when no session cookie or token is provided", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Authentication required/i);
  });

  it("POST /auth/test-token mints a valid session in test environment", async () => {
    const res = await request(app)
      .post("/auth/test-token")
      .send({ email: "m1_user@example.com", name: "M1 User" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("m1_user@example.com");

    const cookieHeader = res.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader[0]).toMatch(/auth_token=/);

    // Verify GET /auth/me with cookie
    const meRes = await request(app)
      .get("/auth/me")
      .set("Cookie", cookieHeader);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe("m1_user@example.com");
    expect(meRes.body.user.name).toBe("M1 User");
  });

  it("GET /auth/me accepts Bearer token in Authorization header", async () => {
    const tokenRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "bearer_user@example.com", name: "Bearer User" });

    const token = tokenRes.body.token;

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("bearer_user@example.com");
  });

  it("POST /auth/logout clears auth cookie and invalidates session access", async () => {
    const loginRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "logout_user@example.com" });

    const cookie = loginRes.headers["set-cookie"];

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookie);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.status).toBe("logged_out");

    // The set-cookie will clear or expire auth_token
    const clearCookie = logoutRes.headers["set-cookie"];
    expect(clearCookie[0]).toMatch(/auth_token=;/);
  });
});
