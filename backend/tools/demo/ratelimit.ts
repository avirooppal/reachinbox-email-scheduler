import { redis } from "../../src/infra/redis.js";
import { RedisLimiter } from "../../src/adapters/limiter.redis.js";

async function main() {
  console.log("=== DEMO: Atomic Redis Rate Limiter & Minimum Delay ===");

  const limiter = new RedisLimiter(redis);
  const senderId = `demo-limiter-${Date.now()}`;
  const now = Date.now();

  console.log("Simulating burst of 5 rapid requests against limit=3, gap=2000ms:");

  for (let i = 0; i < 5; i++) {
    const res = await limiter.reserve({
      senderId,
      now: now + i * 200, // 200ms apart (violates 2000ms gap)
      limit: 3,
      gapMs: 2000,
      mode: "fixed"
    });

    console.log(`Request #${i + 1}: allowed=${res.allowed}, reason=${res.reason || "NONE"}, retryAt=${new Date(res.retryAt).toISOString()}`);
  }

  await redis.quit();
}

main().catch(console.error);
