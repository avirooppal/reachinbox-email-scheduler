import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { esClient } from "../src/infra/elasticsearch.js";

describe("Milestone 0: Foundations", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
    await esClient.close();
  });

  it("GET /health responds with 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });

  it("GET /ready checks Postgres, Redis, and Elasticsearch", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.checks).toEqual({
      postgres: "ok",
      redis: "ok",
      elasticsearch: "ok"
    });
  });
});
