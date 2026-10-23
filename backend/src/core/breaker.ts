import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export interface CircuitBreakerOptions {
  windowMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  private windowMs: number;
  private threshold: number;
  private cooldownMs: number;

  constructor(
    private redis: Redis,
    private prisma: PrismaClient,
    options?: CircuitBreakerOptions
  ) {
    this.windowMs = options?.windowMs ?? env.BREAKER_WINDOW_MS;
    this.threshold = options?.failureThreshold ?? env.BREAKER_FAILURES;
    this.cooldownMs = options?.cooldownMs ?? env.BREAKER_COOLDOWN_MS;
  }

  private failureKey(senderId: string): string {
    return `breaker:failures:${senderId}`;
  }

  private cooldownKey(senderId: string): string {
    return `breaker:cooldown:${senderId}`;
  }

  /**
   * Record a send failure. If threshold reached, transition sender to OPEN.
   */
  async recordFailure(senderId: string, errorReason: string): Promise<boolean> {
    const key = this.failureKey(senderId);
    const failures = await this.redis.incr(key);
    if (failures === 1) {
      await this.redis.pexpire(key, this.windowMs);
    }

    if (failures >= this.threshold) {
      const cooldownKey = this.cooldownKey(senderId);
      await this.redis.set(cooldownKey, "OPEN", "PX", this.cooldownMs);
      await this.prisma.sender.update({
        where: { id: senderId },
        data: { health: "OPEN" }
      });
      logger.warn({ senderId, failures, threshold: this.threshold, errorReason }, "Circuit breaker tripped to OPEN");
      return true;
    }
    return false;
  }

  /**
   * Record a successful send. If sender was DEGRADED or OPEN, transition back to HEALTHY.
   */
  async recordSuccess(senderId: string): Promise<void> {
    const failureKey = this.failureKey(senderId);
    const cooldownKey = this.cooldownKey(senderId);
    await Promise.all([this.redis.del(failureKey), this.redis.del(cooldownKey)]);

    const sender = await this.prisma.sender.findUnique({
      where: { id: senderId },
      select: { health: true }
    });

    if (sender && sender.health !== "HEALTHY") {
      await this.prisma.sender.update({
        where: { id: senderId },
        data: { health: "HEALTHY" }
      });
      logger.info({ senderId }, "Circuit breaker restored to HEALTHY");
    }
  }

  /**
   * Determine sender health. If OPEN cooldown expired, transition to DEGRADED (half-open probe).
   */
  async checkHealth(senderId: string): Promise<"HEALTHY" | "DEGRADED" | "OPEN"> {
    const cooldownKey = this.cooldownKey(senderId);
    const isOpenInRedis = await this.redis.get(cooldownKey);

    const sender = await this.prisma.sender.findUnique({
      where: { id: senderId },
      select: { health: true }
    });

    if (!sender) return "OPEN";

    if (sender.health === "OPEN") {
      if (!isOpenInRedis) {
        // Cooldown expired, transition to DEGRADED
        await this.prisma.sender.update({
          where: { id: senderId },
          data: { health: "DEGRADED" }
        });
        logger.info({ senderId }, "Circuit breaker cooldown expired; transitioned to DEGRADED probe");
        return "DEGRADED";
      }
      return "OPEN";
    }

    return sender.health;
  }
}
