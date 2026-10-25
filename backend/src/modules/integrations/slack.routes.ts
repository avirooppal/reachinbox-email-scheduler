import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../infra/prisma.js";
import { encrypt } from "../../utils/crypto.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export const slackRouter = Router();

/**
 * Slack OAuth callback endpoint.
 * Exchanges authorization code at oauth.v2.access, encrypts webhook, and marks CONNECTED.
 * State token contains verified userId signed with JWT_SECRET.
 * GET /api/integrations/slack/callback?code=&state=
 */
slackRouter.get("/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  try {
    const decoded = jwt.verify(state, env.JWT_SECRET) as { userId: string };
    const userId = decoded.userId;

    let webhookUrl: string;
    let channel: string;
    let teamName: string;

    // Test mode bypass for CI/testing without external Slack credentials
    if (process.env.NODE_ENV === "test" && code.startsWith("test_code_")) {
      webhookUrl = "http://localhost:9999/fake-slack-webhook";
      channel = "#outbox-alerts";
      teamName = "Test Workspace";
    } else {
      if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
        return res.status(400).json({
          error: "Slack credentials (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET) not configured"
        });
      }

      const computedRedirectUri = process.env.RENDER_EXTERNAL_URL
        ? `${process.env.RENDER_EXTERNAL_URL}/api/integrations/slack/callback`
        : env.SLACK_REDIRECT_URI;

      const params = new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: computedRedirectUri
      });

      const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      const data: any = await tokenRes.json();

      if (!data.ok) {
        return res.status(400).json({ error: data.error || "Slack OAuth failed" });
      }

      webhookUrl = data.incoming_webhook.url;
      channel = data.incoming_webhook.channel;
      teamName = data.team?.name || "Slack Team";
    }

    const encryptedWebhook = encrypt(webhookUrl);

    await prisma.slackIntegration.upsert({
      where: { userId },
      update: {
        channel,
        webhookUrlEnc: encryptedWebhook,
        status: "CONNECTED"
      },
      create: {
        userId,
        teamName,
        channel,
        webhookUrlEnc: encryptedWebhook,
        status: "CONNECTED"
      }
    });

    // Send immediate confirmation message to verified Slack channel
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🚀 *ReachInbox Email Scheduler Connected!*\nHourly rate limit alerts will be posted here to #${channel}.`
        })
      });
    } catch {}

    const frontendBaseUrl = process.env.RENDER_EXTERNAL_URL || env.FRONTEND_URL;
    return res.redirect(`${frontendBaseUrl}/scheduled?slack=connected`);
  } catch (err) {
    (req.log || logger).error({ err }, "Slack OAuth callback failed");
    return res.status(400).json({ error: "Invalid or expired state" });
  }
});

// Authenticate all remaining Slack routes
slackRouter.use(requireAuth);

/**
 * Initiate Slack OAuth connect flow.
 * GET /api/integrations/slack/connect
 */
slackRouter.get("/connect", (req: Request, res: Response) => {
  const userId = req.user!.id;
  // Sign state token with user ID and 10m expiry to prevent CSRF
  const state = jwt.sign({ userId, nonce: Math.random().toString(36) }, env.JWT_SECRET, {
    expiresIn: "10m"
  });

  const clientId = env.SLACK_CLIENT_ID || "mock_slack_client_id";
  const computedRedirectUri = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/api/integrations/slack/callback`
    : env.SLACK_REDIRECT_URI || "http://localhost:3000/api/integrations/slack/callback";
  const redirectUri = encodeURIComponent(computedRedirectUri);
  const scope = encodeURIComponent("incoming-webhook");

  const authorizeUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&state=${state}`;

  if (req.query.redirect === "true" || req.headers.accept?.includes("text/html")) {
    return res.redirect(authorizeUrl);
  }

  return res.status(200).json({
    authorizeUrl,
    state
  });
});

/**
 * Get current user Slack integration status.
 * GET /api/integrations/slack
 */
slackRouter.get("/", async (req: Request, res: Response) => {
  const integration = await prisma.slackIntegration.findUnique({
    where: { userId: req.user!.id },
    select: {
      teamName: true,
      channel: true,
      status: true,
      connectedAt: true,
      updatedAt: true
    }
  });

  return res.status(200).json({
    connected: integration?.status === "CONNECTED",
    integration: integration || null
  });
});

/**
 * Disconnect Slack integration.
 * DELETE /api/integrations/slack
 */
slackRouter.delete("/", async (req: Request, res: Response) => {
  await prisma.slackIntegration.updateMany({
    where: { userId: req.user!.id },
    data: { status: "DISCONNECTED" }
  });

  return res.status(200).json({ message: "Slack integration disconnected" });
});

/**
 * Dispatch test rate limit alert to verified Slack channel.
 * POST /api/integrations/slack/test
 */
slackRouter.post("/test", async (req: Request, res: Response) => {
  const integration = await prisma.slackIntegration.findUnique({
    where: { userId: req.user!.id }
  });

  if (!integration || integration.status !== "CONNECTED" || !integration.webhookUrlEnc) {
    return res.status(400).json({ error: "No connected Slack integration found. Connect Slack first." });
  }

  const { decrypt } = await import("../../utils/crypto.js");
  const webhookUrl = decrypt(integration.webhookUrlEnc);

  const payload = {
    text: `⚠️ *Hourly Rate Limit Reached* for sender *Demo Sender (demo@ethereal.email)*`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "⚠️ Sender Hourly Limit Exceeded",
          emoji: true
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Sender:*\nDemo Sender (demo@ethereal.email)` },
          { type: "mrkdwn", text: `*Hourly Quota:*\n10 emails/hour` },
          { type: "mrkdwn", text: `*Observed Sends:*\n10 emails dispatched` },
          { type: "mrkdwn", text: `*Next Available Slot:*\nRescheduled into next clock hour` }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `ReachInbox Email Scheduler • Verified live webhook alert at ${new Date().toLocaleTimeString()}`
          }
        ]
      }
    ]
  };

  const slackRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!slackRes.ok) {
    return res.status(502).json({ error: "Slack rejected webhook payload" });
  }

  return res.status(200).json({
    success: true,
    message: `Test rate-limit alert sent to Slack #${integration.channel}`
  });
});
