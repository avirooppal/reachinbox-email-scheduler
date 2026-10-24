import { describe, it, expect } from "vitest";
import request from "supertest";
import { assertProductionSafety, Env } from "../src/config/env.js";
import { app } from "../src/server.js";

describe("Production Readiness & Safety Invariants", () => {
  it("BOOT SAFETY: refuses to boot in production if ENABLE_FAULT_INJECTION is true", () => {
    const dangerousConfig: Env = {
      DATABASE_URL: "postgresql://app:pass@localhost:5432/scheduler",
      REDIS_URL: "redis://localhost:6379",
      ELASTICSEARCH_URL: "http://localhost:9200",
      PORT: 4000,
      NODE_ENV: "production",
      TRUST_PROXY: 1,
      UPLOAD_DIR: "/opt/scheduler/uploads",
      WORKER_CONCURRENCY: 5,
      MIN_DELAY_BETWEEN_EMAILS_MS: 2000,
      MAX_EMAILS_PER_HOUR_PER_SENDER: 200,
      MAX_EMAILS_PER_HOUR_GLOBAL: 0,
      RATE_LIMIT_MODE: "fixed",
      JITTER_PCT: 15,
      JOB_ATTEMPTS: 3,
      JOB_BACKOFF_MS: 5000,
      STALE_PROCESSING_MS: 120000,
      BREAKER_FAILURES: 5,
      BREAKER_WINDOW_MS: 60000,
      BREAKER_COOLDOWN_MS: 120000,
      ENABLE_FAULT_INJECTION: true, // Dangerous kill-switch turned ON in production
      JWT_SECRET: "super-secure-production-secret-key-32chars",
      ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      FRONTEND_URL: "https://app.example.com",
      ADMIN_EMAILS: ["admin@example.com"],
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "https://app.example.com/auth/google/callback",
      SLACK_CLIENT_ID: "id",
      SLACK_CLIENT_SECRET: "secret",
      SLACK_REDIRECT_URI: "https://app.example.com/api/integrations/slack/callback"
    };

    expect(() => assertProductionSafety(dangerousConfig)).toThrow(
      /ENABLE_FAULT_INJECTION is true in production/
    );
  });

  it("BOOT SAFETY: assertProductionSafety succeeds when production kill-switches are OFF", () => {
    const safeConfig: Env = {
      DATABASE_URL: "postgresql://app:pass@localhost:5432/scheduler",
      REDIS_URL: "redis://localhost:6379",
      ELASTICSEARCH_URL: "http://localhost:9200",
      PORT: 4000,
      NODE_ENV: "production",
      TRUST_PROXY: 1,
      UPLOAD_DIR: "/opt/scheduler/uploads",
      WORKER_CONCURRENCY: 5,
      MIN_DELAY_BETWEEN_EMAILS_MS: 2000,
      MAX_EMAILS_PER_HOUR_PER_SENDER: 200,
      MAX_EMAILS_PER_HOUR_GLOBAL: 0,
      RATE_LIMIT_MODE: "fixed",
      JITTER_PCT: 15,
      JOB_ATTEMPTS: 3,
      JOB_BACKOFF_MS: 5000,
      STALE_PROCESSING_MS: 120000,
      BREAKER_FAILURES: 5,
      BREAKER_WINDOW_MS: 60000,
      BREAKER_COOLDOWN_MS: 120000,
      ENABLE_FAULT_INJECTION: false, // Properly turned OFF
      JWT_SECRET: "super-secure-production-secret-key-32chars",
      ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      FRONTEND_URL: "https://app.example.com",
      ADMIN_EMAILS: ["admin@example.com"],
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "https://app.example.com/auth/google/callback",
      SLACK_CLIENT_ID: "id",
      SLACK_CLIENT_SECRET: "secret",
      SLACK_REDIRECT_URI: "https://app.example.com/api/integrations/slack/callback"
    };

    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => assertProductionSafety(safeConfig)).not.toThrow();
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it("LIVENESS & READINESS: /health returns 200 ok and /ready returns checks", async () => {
    const healthRes = await request(app).get("/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("ok");

    const readyRes = await request(app).get("/ready");
    expect([200, 503]).toContain(readyRes.status);
    expect(readyRes.body.checks).toBeDefined();
    expect(readyRes.body.checks.postgres).toBeDefined();
    expect(readyRes.body.checks.redis).toBeDefined();
  });
});
