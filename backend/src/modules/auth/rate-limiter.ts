import { Request, Response, NextFunction } from "express";
import { redis } from "../../infra/redis.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Redis-backed rate limiter for authentication endpoints.
 * Prevents credential stuffing and brute-force attacks.
 * Limit: maxRequests within windowSeconds per IP.
 */
export function createAuthRateLimiter({
  windowSeconds = 60,
  maxRequests = 10
}: {
  windowSeconds?: number;
  maxRequests?: number;
} = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // In test environment, bypass rate limiting to prevent flaky test runs
    if (env.NODE_ENV === "test") {
      return next();
    }

    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      const key = `ratelimit:auth:${clientIp}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }

      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - current));

      if (current > maxRequests) {
        const ttl = await redis.ttl(key);
        res.setHeader("Retry-After", ttl > 0 ? ttl : windowSeconds);
        return res.status(429).json({
          error: "Too many authentication attempts. Please try again later.",
          retryAfterSeconds: ttl > 0 ? ttl : windowSeconds
        });
      }

      next();
    } catch (err) {
      logger.error({ err }, "Auth rate limiter Redis failure; failing open for safety");
      next();
    }
  };
}
