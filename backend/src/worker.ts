import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";

logger.info(
  {
    concurrency: env.WORKER_CONCURRENCY,
    env: env.NODE_ENV
  },
  "Worker service initialized"
);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down worker service gracefully...");
  try {
    await prisma.$disconnect();
    await redis.quit();
    logger.info("Worker connections closed successfully.");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error shutting down worker");
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Keep process active in dev
const interval = setInterval(() => {}, 10000);
process.on("exit", () => clearInterval(interval));
