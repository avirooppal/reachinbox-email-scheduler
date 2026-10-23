import { reconcileQueue } from "../../src/queue/reconciler.js";
import { prisma } from "../../src/infra/prisma.js";
import { redis } from "../../src/infra/redis.js";

async function main() {
  console.log("=== DEMO: Crash & Restart Reconciler ===");

  const scheduled = await prisma.email.count({ where: { status: "SCHEDULED" } });
  console.log(`Current SCHEDULED emails in database: ${scheduled}`);

  console.log("Triggering reconciler to scan and sync state across PostgreSQL and Redis BullMQ...");
  const result = await reconcileQueue();
  console.log("Reconciliation finished:", result);

  await prisma.$disconnect();
  await redis.quit();
}

main().catch(console.error);
