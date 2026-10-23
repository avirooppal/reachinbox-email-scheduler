import { Worker, Job, DelayedError } from "bullmq";
import { EMAIL_QUEUE_NAME, EmailJobData } from "../adapters/queue.bullmq.js";
import { redis } from "../infra/redis.js";
import { prisma } from "../infra/prisma.js";
import { systemClock } from "../adapters/clock.system.js";
import { redisLimiter } from "../adapters/limiter.redis.js";
import { eventLog } from "../adapters/eventlog.prisma.js";
import { NodemailerTransportAdapter } from "../adapters/transport.nodemailer.js";
import { decrypt } from "../utils/crypto.js";
import { handleSend } from "../core/send-handler.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { CircuitBreaker } from "../core/breaker.js";
import { SenderRecord } from "../core/ports.js";

export function createEmailWorker(workerId = `worker-${process.pid}`): Worker<EmailJobData> {
  const breaker = new CircuitBreaker(redis, prisma);

  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>, token?: string) => {
      const emailId = job.data.emailId;
      const jobLogger = logger.child({ jobId: job.id, emailId, workerId });

      jobLogger.debug("Processing email job");

      const outcome = await handleSend(emailId, {
        clock: systemClock,
        prisma,
        limiter: redisLimiter,
        transportFactory: async (sender: SenderRecord) => {
          const pass = decrypt(sender.smtpPassEnc);
          return new NodemailerTransportAdapter(sender.id, {
            host: sender.smtpHost,
            port: sender.smtpPort,
            user: sender.smtpUser,
            pass
          });
        },
        eventLog,
        breaker,
        workerId,
        maxAttempts: env.JOB_ATTEMPTS,
        rateLimitMode: env.RATE_LIMIT_MODE,
        onLimitReached: async (senderId, limit, count) => {
          jobLogger.warn({ senderId, limit, count }, "Sender reached hourly rate limit");
        },
        onEmailSent: async (sentEmailId) => {
          jobLogger.info({ sentEmailId }, "Email successfully dispatched");
        }
      });

      if (outcome.outcome === "RESCHEDULED") {
        jobLogger.info(
          { retryAt: new Date(outcome.retryAt).toISOString(), reason: outcome.reason },
          "Job postponed by rate limiter"
        );

        if (token) {
          await job.moveToDelayed(outcome.retryAt, token);
          throw new DelayedError();
        }
      }

      return outcome;
    },
    {
      connection: redis,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: 30000,
      stalledInterval: 30000
    }
  );

  worker.on("failed", (job, err) => {
    if (err instanceof DelayedError) {
      // Normal expected BullMQ delayed error on rate limit reschedule
      return;
    }
    logger.error({ jobId: job?.id, err }, "Worker job failed");
  });

  worker.on("error", (err) => {
    logger.error({ err }, "BullMQ Worker error");
  });

  return worker;
}
