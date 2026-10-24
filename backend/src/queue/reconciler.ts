import { prisma } from "../infra/prisma.js";
import { emailQueue, enqueueBulkEmailJobs } from "../adapters/queue.bullmq.js";
import { eventLog } from "../adapters/eventlog.prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { redis } from "../infra/redis.js";

export interface ReconcileResult {
  staleRecovered: number;
  jobsRebuilt: number;
}

/**
 * BOOT RECONCILER (Runs once at worker startup or via POST /admin/reconcile)
 * Strictly non-periodic. Rebuilds Redis delivery jobs directly from PostgreSQL.
 */
export async function reconcileQueue(): Promise<ReconcileResult> {
  logger.info("Executing boot queue reconciler...");
  const now = Date.now();
  const staleThreshold = new Date(now - env.STALE_PROCESSING_MS);

  // 1. Recover stale PROCESSING emails (crashed worker recovery)
  const staleEmails = await prisma.email.findMany({
    where: {
      status: "PROCESSING",
      claimedAt: { lt: staleThreshold }
    }
  });

  let staleRecovered = 0;
  for (const st of staleEmails) {
    await prisma.$transaction(async (tx) => {
      await tx.email.update({
        where: { id: st.id },
        data: {
          status: "SCHEDULED"
        }
      });

      await eventLog.append(tx, {
        emailId: st.id,
        campaignId: st.campaignId,
        senderId: st.senderId,
        type: "RECOVERED",
        data: {
          from: "PROCESSING",
          reason: "STALE",
          previousClaimedAt: st.claimedAt?.toISOString()
        }
      });
    });
    staleRecovered++;
  }

  // 2. Clean dead failed and completed jobs so BullMQ jobId deduplication doesn't block re-enqueueing
  await Promise.all([
    emailQueue.clean(0, 0, "failed"),
    emailQueue.clean(0, 0, "completed")
  ]);

  // 3. Efficient bulk lookup of all active/delayed/waiting BullMQ job IDs
  // BullMQ stores delayed jobs in 'bull:<queue>:delayed' zset and waiting in 'bull:<queue>:wait' list
  const queuePrefix = `bull:${emailQueue.name}`;
  const [delayedIds, waitingIds, activeIds] = await Promise.all([
    redis.zrange(`${queuePrefix}:delayed`, 0, -1),
    redis.lrange(`${queuePrefix}:wait`, 0, -1),
    redis.lrange(`${queuePrefix}:active`, 0, -1)
  ]);

  const existingJobIds = new Set<string>([...delayedIds, ...waitingIds, ...activeIds]);

  // 4. Scan all SCHEDULED emails to ensure each has a corresponding BullMQ job
  const pendingEmails = await prisma.email.findMany({
    where: { status: "SCHEDULED" },
    select: { id: true, scheduledAt: true }
  });

  const jobsToRebuild: { emailId: string; delayMs: number }[] = [];

  for (const em of pendingEmails) {
    if (!existingJobIds.has(em.id)) {
      jobsToRebuild.push({
        emailId: em.id,
        delayMs: Math.max(0, em.scheduledAt.getTime() - now)
      });
    }
  }

  if (jobsToRebuild.length > 0) {
    await enqueueBulkEmailJobs(jobsToRebuild);
  }

  const result = {
    staleRecovered,
    jobsRebuilt: jobsToRebuild.length
  };

  logger.info(result, "Queue reconciliation finished");
  return result;
}
