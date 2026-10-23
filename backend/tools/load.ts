import fs from "fs";
import path from "path";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { SystemClock } from "../src/adapters/clock.system.js";
import { MockTransport } from "../src/adapters/transport.mock.js";
import { RedisLimiter } from "../src/adapters/limiter.redis.js";
import { eventLog } from "../src/adapters/eventlog.prisma.js";
import { allocate } from "../src/core/planner/allocator.js";
import { handleSend } from "../src/core/send-handler.js";
import { runAudit, formatAuditReport } from "./audit.js";

async function main() {
  const outputLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    outputLines.push(msg);
  };

  log("===============================================================================");
  log("LOAD TEST: 2,000 Emails at Same Instant (Limit: 50/hr)");
  log("===============================================================================");

  const user = await prisma.user.upsert({
    where: { email: "loadtester@example.com" },
    update: {},
    create: {
      googleId: `google_load_${Date.now()}`,
      email: "loadtester@example.com",
      name: "Load Tester"
    }
  });

  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      name: "Load Sender",
      fromEmail: "load@performance.io",
      smtpHost: "localhost",
      smtpPort: 1025,
      smtpUser: "test",
      smtpPassEnc: "fake:fake:fake",
      hourlyLimit: 50,
      minDelayMs: 2000,
      health: "HEALTHY",
      isActive: true
    }
  });

  const startAt = new Date("2026-10-23T10:00:00Z");
  log(`Scheduling 2,000 emails for sender ${sender.id} starting at ${startAt.toISOString()}...`);

  const slots = allocate({
    startAt,
    delayMs: 2000,
    hourlyLimit: 50,
    jitterPct: 15,
    senders: [{ id: sender.id, health: "HEALTHY", isActive: true }],
    count: 2000,
    seed: "load-seed-2000"
  });

  const plannedFinishAt = slots[slots.length - 1]!.plannedAt;
  const hoursRequired = ((plannedFinishAt.getTime() - startAt.getTime()) / 3600000).toFixed(1);
  log(`Planner spread 2,000 emails over ${hoursRequired} clock-hours (max 50/hr).`);

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      subject: "2000 Email Load Run",
      bodyTemplate: "Load body",
      startAt,
      delayMs: 2000,
      hourlyLimit: 50,
      total: 2000,
      plannedFinishAt
    }
  });

  const emailRows = slots.map((s, idx) => ({
    campaignId: campaign.id,
    userId: user.id,
    senderId: sender.id,
    toEmail: `load_lead_${idx}@load.com`,
    subject: `Load Email #${idx}`,
    body: `Body #${idx}`,
    seq: s.seq,
    plannedAt: s.plannedAt,
    scheduledAt: s.plannedAt,
    status: "SCHEDULED" as const
  }));

  for (let i = 0; i < emailRows.length; i += 500) {
    await prisma.email.createMany({ data: emailRows.slice(i, i + 500) });
  }

  const inserted = await prisma.email.findMany({
    where: { campaignId: campaign.id },
    select: { id: true, plannedAt: true },
    orderBy: { seq: "asc" }
  });

  log("Simulating delivery execution across all planned slots (concurrency=25)...");
  const limiter = new RedisLimiter(redis);
  const mockTransport = new MockTransport();

  let sent = 0;
  const BATCH_SIZE = 25;
  for (let i = 0; i < inserted.length; i += BATCH_SIZE) {
    const batch = inserted.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (em) => {
        const outcome = await handleSend(em.id, {
          clock: {
            now: () => em.plannedAt,
            nowMs: () => em.plannedAt.getTime()
          },
          prisma,
          limiter,
          transportFactory: async () => mockTransport,
          eventLog
        });
        if (outcome.outcome === "SENT") sent++;
      })
    );
  }

  log(`Completed sending ${sent}/2000 emails.`);

  // Group and print per-hour send counts
  const events = await prisma.emailEvent.findMany({
    where: { campaignId: campaign.id, type: "SLOT_RESERVED" }
  });

  const perHour = new Map<string, number>();
  for (const ev of events) {
    const t = Number((ev.data as Record<string, unknown>).reservedAt);
    const hour = new Date(t).toISOString().substring(0, 13) + ":00Z";
    perHour.set(hour, (perHour.get(hour) || 0) + 1);
  }

  log("\nObserved Per-Hour Send Distribution:");
  let maxRate = 0;
  for (const [hr, count] of Array.from(perHour.entries()).slice(0, 10)) {
    log(`  ${hr}: ${count} emails`);
    maxRate = Math.max(maxRate, count);
  }
  log(`  ... (${perHour.size} total hourly buckets)`);
  log(`Max Observed Hourly Rate: ${maxRate} emails/hr (Cap: 50)`);

  // Run auditor
  log("\nRunning Invariant Auditor on 2,000-Email Load Campaign...");
  const report = await runAudit(campaign.id, true);
  const formatted = formatAuditReport(report);
  log(formatted);

  log("\n===============================================================================");
  log("LOAD TEST COMPLETE");
  log(`AUDIT RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  log("===============================================================================");

  const evidencePath = path.resolve(process.cwd(), "docs/evidence/load.txt");
  fs.writeFileSync(evidencePath, outputLines.join("\n"), "utf8");
  log(`Evidence saved to ${evidencePath}`);

  await prisma.$disconnect();
  await redis.quit();
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
