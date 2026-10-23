import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false
  });

  client.on("error", (err) => {
    logger.error({ err }, "Redis connection error");
  });

  return client;
}

export const redis = createRedisClient();
