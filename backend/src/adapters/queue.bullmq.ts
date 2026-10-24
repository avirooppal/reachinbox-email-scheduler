import { Queue } from "bullmq";
import { redis } from "../infra/redis.js";
import { env } from "../config/env.js";

export const EMAIL_QUEUE_NAME = "email-delivery";

export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: env.JOB_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: env.JOB_BACKOFF_MS
    },
    removeOnComplete: false,
    removeOnFail: false
  }
});

export interface BulkJobInput {
  emailId: string;
  delayMs: number;
}

/**
 * Enqueues email jobs into BullMQ with jobId = emailId and calculated delay.
 * Batched in chunks of 500 to keep memory flat.
 */
export async function enqueueBulkEmailJobs(jobs: BulkJobInput[], chunkSize = 500): Promise<void> {
  for (let i = 0; i < jobs.length; i += chunkSize) {
    const chunk = jobs.slice(i, i + chunkSize);
    const bulkPayload = chunk.map((job) => ({
      name: "send-email",
      data: { emailId: job.emailId },
      opts: {
        jobId: job.emailId, // Idempotency at queue level
        delay: Math.max(0, job.delayMs)
      }
    }));
    await emailQueue.addBulk(bulkPayload);
  }
}

/**
 * Removes an email job from BullMQ queue by emailId.
 */
export async function removeEmailJob(emailId: string): Promise<boolean> {
  try {
    const job = await emailQueue.getJob(emailId);
    if (job) {
      await job.remove();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
