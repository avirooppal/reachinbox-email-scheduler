import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "ioredis";
import { Limiter, ReserveSlotParams, LimiterResult } from "../core/ports.js";
import { redis as defaultRedis } from "../infra/redis.js";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXED_LUA = fs.readFileSync(path.join(__dirname, "lua/fixed.lua"), "utf8");
const SLIDING_LUA = fs.readFileSync(path.join(__dirname, "lua/sliding.lua"), "utf8");

const ONE_HOUR_MS = 60 * 60 * 1000;

export class RedisLimiter implements Limiter {
  constructor(private redisClient: Redis = defaultRedis) {}

  async reserve(params: ReserveSlotParams): Promise<LimiterResult> {
    const { senderId, now, limit, gapMs, mode = env.RATE_LIMIT_MODE } = params;
    const windowMs = ONE_HOUR_MS;

    if (mode === "sliding") {
      const keys = [`srl:${senderId}`, `gap:${senderId}`];
      const args = [now, limit, gapMs, windowMs];

      const res = (await this.redisClient.eval(SLIDING_LUA, keys.length, ...keys, ...args)) as [
        number,
        number,
        number,
        number
      ];

      const [status, retryOrReservedAt, limitReached, count] = res;

      if (status === 0) {
        return {
          allowed: true,
          reservedAt: retryOrReservedAt,
          limitReachedNow: limitReached === 1,
          windowCount: count
        };
      }

      return {
        allowed: false,
        reason: status === 1 ? "LIMITED" : "TOO_SOON",
        retryAt: retryOrReservedAt
      };
    }

    // Default 'fixed' window strategy
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const keys = [`rl:${senderId}:${windowStart}`, `gap:${senderId}`, `spill:${senderId}:${windowStart}`];
    const args = [now, limit, gapMs, windowMs, windowStart];

    const res = (await this.redisClient.eval(FIXED_LUA, keys.length, ...keys, ...args)) as [
      number,
      number,
      number,
      number
    ];

    const [status, retryOrReservedAt, limitReached, count] = res;

    if (status === 0) {
      return {
        allowed: true,
        reservedAt: retryOrReservedAt,
        limitReachedNow: limitReached === 1,
        windowCount: count
      };
    }

    return {
      allowed: false,
      reason: status === 1 ? "LIMITED" : "TOO_SOON",
      retryAt: retryOrReservedAt
    };
  }
}

export const redisLimiter = new RedisLimiter();
