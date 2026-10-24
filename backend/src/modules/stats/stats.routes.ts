import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../infra/prisma.js";
import { redis } from "../../infra/redis.js";
import { emailQueue } from "../../adapters/queue.bullmq.js";
import { searchIndexQueue } from "../../queue/search-index.worker.js";
import { notificationQueue } from "../../queue/notification.worker.js";

export const statsRouter = Router();

statsRouter.use(requireAuth);

/**
 * System and sender operations dashboard stats.
 * GET /api/stats
 */
statsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // 1. BullMQ Queue Counts
    const [emailCounts, searchCounts, notifCounts] = await Promise.all([
      emailQueue.getJobCounts("delayed", "waiting", "active", "completed", "failed"),
      searchIndexQueue.getJobCounts("delayed", "waiting", "active", "completed", "failed"),
      notificationQueue.getJobCounts("delayed", "waiting", "active", "completed", "failed")
    ]);

    // 2. Senders health & usage
    const senders = await prisma.sender.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        fromEmail: true,
        health: true,
        hourlyLimit: true,
        minDelayMs: true,
        isActive: true
      }
    });

    const now = new Date();
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);

    const senderStats = await Promise.all(
      senders.map(async (s) => {
        // Query Redis usage for current hour window
        const currentHourKey = `limit:${s.id}:${Math.floor(Date.now() / 3600000)}`;
        const redisUsageStr = await redis.get(currentHourKey);
        const currentHourSent = redisUsageStr ? parseInt(redisUsageStr, 10) : 0;

        return {
          ...s,
          currentHourSent,
          hourlyLimit: s.hourlyLimit,
          remainingCapacity: Math.max(0, (s.hourlyLimit ?? 0) - currentHourSent)
        };
      })
    );

    // 3. Next scheduled send
    const nextEmail = await prisma.email.findFirst({
      where: {
        userId,
        status: "SCHEDULED"
      },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true, id: true, subject: true }
    });

    return res.status(200).json({
      queues: {
        emailDelivery: emailCounts,
        searchIndex: searchCounts,
        notifications: notifCounts
      },
      senders: senderStats,
      nextScheduledSend: nextEmail || null,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    req.log.error({ err }, "Error retrieving stats");
    return res.status(500).json({ error: "Failed to retrieve stats" });
  }
});
