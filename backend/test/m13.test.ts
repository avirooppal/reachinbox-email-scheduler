import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import http from "http";
import { app } from "../src/server.js";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { createNotificationWorker, notificationQueue } from "../src/queue/notification.worker.js";

describe("M13: Slack OAuth & Limit Notifications", () => {
  let authToken: string;
  let userId: string;
  let fakeSlackServer: http.Server;
  let receivedWebhooks: any[] = [];
  let notifWorker: any;

  beforeAll(async () => {
    notifWorker = createNotificationWorker("test-notif-worker");

    // Start local fake Slack webhook server on port 9999
    receivedWebhooks = [];
    fakeSlackServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          receivedWebhooks.push(JSON.parse(body));
        } catch {
          receivedWebhooks.push(body);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => fakeSlackServer.listen(9999, resolve));

    const authRes = await request(app)
      .post("/auth/test-token")
      .send({ email: "slack-tester@example.com", name: "Slack Tester" });

    authToken = authRes.body.token;
    userId = authRes.body.user.id;
  });

  afterAll(async () => {
    if (notifWorker) await notifWorker.close();
    await new Promise<void>((resolve) => fakeSlackServer.close(() => resolve()));
    await prisma.$disconnect();
    await redis.quit();
  });

  it("connects Slack integration via OAuth flow and verifies status", async () => {
    // 1. Get connect URL and signed state
    const connectRes = await request(app)
      .get("/api/integrations/slack/connect")
      .set("Authorization", `Bearer ${authToken}`);

    expect(connectRes.status).toBe(200);
    expect(connectRes.body.authorizeUrl).toContain("slack.com/oauth/v2/authorize");
    const state = connectRes.body.state;

    // 2. Simulate OAuth callback with test code
    const callbackRes = await request(app)
      .get(`/api/integrations/slack/callback?code=test_code_123&state=${state}`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.status).toBe("CONNECTED");
    expect(callbackRes.body.channel).toBe("#outbox-alerts");

    // 3. Verify status endpoint
    const statusRes = await request(app)
      .get("/api/integrations/slack")
      .set("Authorization", `Bearer ${authToken}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.connected).toBe(true);
    expect(statusRes.body.integration.channel).toBe("#outbox-alerts");
  });

  it("dispatches notification to Slack webhook when rate limit job is enqueued", async () => {
    await notificationQueue.add("test-limit-hit", {
      userId,
      senderId: "test-sender-uuid",
      limit: 50,
      count: 50,
      windowOpensAt: "12:00:00 UTC"
    });

    // Wait for worker to post webhook
    await new Promise((r) => setTimeout(r, 1200));

    expect(receivedWebhooks.length).toBeGreaterThanOrEqual(1);
    const webhook = receivedWebhooks[0];
    expect(webhook.text).toContain("Hourly Rate Limit Reached");
  });

  it("disconnects Slack integration cleanly", async () => {
    const delRes = await request(app)
      .delete("/api/integrations/slack")
      .set("Authorization", `Bearer ${authToken}`);

    expect(delRes.status).toBe(200);

    const statusRes = await request(app)
      .get("/api/integrations/slack")
      .set("Authorization", `Bearer ${authToken}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.connected).toBe(false);
  });
});
