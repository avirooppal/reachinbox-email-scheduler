import { Queue, Worker, Job } from "bullmq";
import { redis } from "../infra/redis.js";
import { prisma } from "../infra/prisma.js";
import { decrypt } from "../utils/crypto.js";
import { logger } from "../config/logger.js";

export const NOTIFICATIONS_QUEUE_NAME = "notifications";

export interface LimitNotificationJobData {
  userId: string;
  senderId: string;
  limit: number;
  count: number;
  windowOpensAt?: string;
}

export const notificationQueue = new Queue<LimitNotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000
    },
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});

/**
 * BullMQ Worker for dispatching rate limit notifications to Slack.
 */
export function createNotificationWorker(workerId = `notif-worker-${process.pid}`): Worker<LimitNotificationJobData> {
  const worker = new Worker<LimitNotificationJobData>(
    NOTIFICATIONS_QUEUE_NAME,
    async (job: Job<LimitNotificationJobData>) => {
      const { userId, senderId, limit, count, windowOpensAt } = job.data;
      const jobLogger = logger.child({ jobId: job.id, userId, senderId, workerId });

      // Look up user's active Slack integration
      const integration = await prisma.slackIntegration.findUnique({
        where: { userId }
      });

      if (!integration || integration.status !== "CONNECTED" || !integration.webhookUrlEnc) {
        jobLogger.debug("User has no connected Slack integration; skipping notification");
        return;
      }

      const sender = await prisma.sender.findUnique({
        where: { id: senderId },
        select: { name: true, fromEmail: true }
      });

      const senderLabel = sender ? `${sender.name} (${sender.fromEmail})` : senderId;
      const webhookUrl = decrypt(integration.webhookUrlEnc);

      const messagePayload = {
        text: `⚠️ *Hourly Rate Limit Reached* for sender *${senderLabel}*`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "⚠️ Rate Limit Reached",
              emoji: true
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Sender:*\n${senderLabel}`
              },
              {
                type: "mrkdwn",
                text: `*Limit / Sent:*\n${limit} / ${count} emails`
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: windowOpensAt
                  ? `Next window opens at: *${windowOpensAt}*. Overflow emails have been postponed without loss.`
                  : "Overflow emails are safely rescheduled with atomic delayed tokens."
              }
            ]
          }
        ]
      };

      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(messagePayload)
        });

        if (!res.ok) {
          if (res.status === 404 || res.status === 410) {
            jobLogger.warn({ status: res.status }, "Slack webhook revoked or dead; marking integration DISCONNECTED");
            await prisma.slackIntegration.update({
              where: { userId },
              data: { status: "DISCONNECTED" }
            });
            return;
          }
          throw new Error(`Slack webhook returned status ${res.status}`);
        }
        jobLogger.info("Slack rate limit notification posted successfully");
      } catch (err: any) {
        jobLogger.error({ err }, "Slack post failed; will retry via BullMQ backoff");
        throw err;
      }
    },
    {
      connection: redis as any,
      concurrency: 5
    }
  );

  return worker;
}
