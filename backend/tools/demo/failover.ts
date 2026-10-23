import { prisma } from "../../src/infra/prisma.js";
import { redis } from "../../src/infra/redis.js";
import { CircuitBreaker } from "../../src/core/breaker.js";

async function main() {
  console.log("=== DEMO: Circuit Breaker & Automatic Sibling Failover ===");

  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found.");

  const senders = await prisma.sender.findMany({ where: { userId: user.id } });
  if (senders.length < 2) throw new Error("Need at least 2 senders for failover demo.");

  const primary = senders[0]!;
  const fallback = senders[1]!;

  console.log(`Primary sender: ${primary.name} (${primary.id})`);
  console.log(`Fallback sender: ${fallback.name} (${fallback.id})`);

  const breaker = new CircuitBreaker(redis, prisma, {
    windowMs: 5000,
    failureThreshold: 2,
    cooldownMs: 5000
  });

  console.log("Simulating 2 consecutive errors on Primary sender...");
  await breaker.recordFailure(primary.id, "Connection refused");
  const tripped = await breaker.recordFailure(primary.id, "Host unreachable");

  console.log(`Circuit breaker tripped to OPEN: ${tripped}`);
  const health = await breaker.checkHealth(primary.id);
  console.log(`Primary sender health in database: ${health}`);

  await prisma.$disconnect();
  await redis.quit();
}

main().catch(console.error);
