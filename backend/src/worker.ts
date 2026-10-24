import { env, assertProductionSafety } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";
import { createEmailWorker } from "./workers/email.worker.js";
import { reconcileQueue } from "./queue/reconciler.js";

async function main() {
  assertProductionSafety(env);
  const workerId = `worker-${process.pid}`;
  logger.info(
    {
      workerId,
      concurrency: env.WORKER_CONCURRENCY,
      env: env.NODE_ENV
    },
    "Email Worker Service booting up..."
  );

  // Run boot reconciler before processing
  await reconcileQueue().catch((err) => {
    logger.error({ err }, "Boot reconciler encountered an error");
  });

  const worker = createEmailWorker(workerId);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down worker service gracefully...");
    try {
      await worker.close();
      await prisma.$disconnect();
      await redis.quit();
      logger.info("Worker closed cleanly. Exiting.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error shutting down worker");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start worker");
  process.exit(1);
});
