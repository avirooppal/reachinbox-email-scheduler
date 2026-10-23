import fs from "fs";
import path from "path";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { VirtualClock } from "../src/adapters/clock.virtual.js";
import { MockTransport } from "../src/adapters/transport.mock.js";
import { RedisLimiter } from "../src/adapters/limiter.redis.js";
import { eventLog } from "../src/adapters/eventlog.prisma.js";
import { allocate, PlannerSender } from "../src/core/planner/allocator.js";
import { handleSend } from "../src/core/send-handler.js";
import { runAudit, formatAuditReport } from "./audit.js";

class MinHeap<T> {
  private data: { priority: number; value: T }[] = [];

  push(priority: number, value: T) {
    this.data.push({ priority, value });
    this.bubbleUp(this.data.length - 1);
  }

  pop(): { priority: number; value: T } | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const bottom = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.bubbleDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(idx: number) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this.data[idx]!.priority >= this.data[parentIdx]!.priority) break;
      const tmp = this.data[idx]!;
      this.data[idx] = this.data[parentIdx]!;
      this.data[parentIdx] = tmp;
      idx = parentIdx;
    }
  }

  private bubbleDown(idx: number) {
    const len = this.data.length;
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = left + 1;

      if (left < len && this.data[left]!.priority < this.data[smallest]!.priority) {
        smallest = left;
      }
      if (right < len && this.data[right]!.priority < this.data[smallest]!.priority) {
        smallest = right;
      }
      if (smallest === idx) break;

      const tmp = this.data[idx]!;
      this.data[idx] = this.data[smallest]!;
      this.data[smallest] = tmp;
      idx = smallest;
    }
  }
}

async function main() {
  const outputLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    outputLines.push(msg);
  };

  log("===============================================================================");
  log("SIMULATOR: Deterministic Multi-Day Virtual-Clock Simulation");
  log("Core engine, real Redis limiter, real PostgreSQL, zero network sleep");
  log("===============================================================================");

  // Setup test user
  const user = await prisma.user.upsert({
    where: { email: "simulator@example.com" },
    update: {},
    create: {
      googleId: "google_simulator_id",
      email: "simulator@example.com",
      name: "Simulator Engine"
    }
  });

  // Create 3 senders
  const senders: PlannerSender[] = [];
  for (let i = 1; i <= 3; i++) {
    const s = await prisma.sender.create({
      data: {
        userId: user.id,
        name: `Sim Sender ${i}`,
        fromEmail: `sim_${i}@domain.com`,
        smtpHost: "localhost",
        smtpPort: 1025,
        smtpUser: "sim",
        smtpPassEnc: "fake:fake:fake",
        hourlyLimit: 60,
        minDelayMs: 2000,
        health: "HEALTHY",
        isActive: true
      }
    });
    senders.push({
      id: s.id,
      name: s.name,
      health: s.health,
      hourlyLimit: s.hourlyLimit,
      minDelayMs: s.minDelayMs
    });
  }

  // ===========================================================================
  // Scenario 1: 10,000 emails over 7 simulated days
  // ===========================================================================
  log("\n--- SCENARIO 1: 10,000 Emails across 3 Senders over 7 Simulated Days ---");
  const simStart = new Date("2026-10-23T08:00:00Z");
  const limiter = new RedisLimiter(redis);
  const mockTransport = new MockTransport();

  const slots = allocate({
    startAt: simStart,
    delayMs: 2000,
    hourlyLimit: 60,
    jitterPct: 15,
    senders,
    count: 10000,
    seed: "sim-10k-seed"
  });

  const finishAt = slots[slots.length - 1]!.plannedAt;
  const daysSpanned = ((finishAt.getTime() - simStart.getTime()) / (24 * 3600 * 1000)).toFixed(2);
  log(`Planned 10,000 emails. Start: ${simStart.toISOString()} -> Finish: ${finishAt.toISOString()} (${daysSpanned} days)`);

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      subject: "10k Simulation",
      bodyTemplate: "Sim body",
      startAt: simStart,
      delayMs: 2000,
      hourlyLimit: 60,
      total: 10000,
      plannedFinishAt: finishAt
    }
  });

  // Batch insert emails & events in DB
  const emailRows = slots.map((s, idx) => ({
    campaignId: campaign.id,
    userId: user.id,
    senderId: s.senderId,
    toEmail: `recipient_${idx}@sim.com`,
    subject: `Email #${idx}`,
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
    select: { id: true, plannedAt: true, seq: true },
    orderBy: { seq: "asc" }
  });

  // Group emails per sender to process strictly monotonically in virtual time
  log("Dispatching 10,000 emails through virtual clock engine (parallel per sender)...");
  const simWallStart = performance.now();
  let dispatched = 0;
  let lastLogTime = Date.now();

  const emailsBySender = new Map<string, typeof inserted>();
  for (const s of senders) {
    emailsBySender.set(s.id, []);
  }
  for (const s of slots) {
    const row = inserted[s.seq]!;
    emailsBySender.get(s.senderId)!.push(row);
  }

  // Each sender gets its own VirtualClock advancing through its sequence of slots
  const BATCH_SIZE = 50;
  await Promise.all(
    senders.map(async (s) => {
      const senderClock = new VirtualClock(simStart);
      const queue = emailsBySender.get(s.id)!;

      for (let i = 0; i < queue.length; i += BATCH_SIZE) {
        const batch = queue.slice(i, i + BATCH_SIZE);
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

            if (outcome.outcome === "SENT") {
              dispatched++;
              if (dispatched % 1000 === 0 || Date.now() - lastLogTime > 5000) {
                lastLogTime = Date.now();
                const pct = ((dispatched / 10000) * 100).toFixed(1);
                const elapsed = ((performance.now() - simWallStart) / 1000).toFixed(1);
                log(`Progress: ${dispatched}/10,000 sent (${pct}%) in ${elapsed}s (Virtual time: ${em.plannedAt.toISOString()})`);
              }
            }
          })
        );
      }
    })
  );

  const simWallElapsed = ((performance.now() - simWallStart) / 1000).toFixed(2);
  log(`Successfully processed ${dispatched} emails in ${simWallElapsed}s wall-clock time!`);

  // Run Auditor on Scenario 1
  log("\nRunning Invariant Auditor on 10,000-email simulation dataset...");
  const report = await runAudit(campaign.id, true);
  const formattedReport = formatAuditReport(report);
  log(formattedReport);

  // ===========================================================================
  // Scenario 2: Fixed vs Sliding Window Boundary Burst Analysis
  // ===========================================================================
  log("\n--- SCENARIO 2: Rate Limiter Trade-off Analysis (Fixed vs Sliding) ---");
  log("Submitting 50 emails at 10:59 followed by 50 emails at 11:01 (Limit: 50/hr)");

  const sFixed = `tradeoff-fixed-${Date.now()}`;
  const sSliding = `tradeoff-sliding-${Date.now()}`;
  const tBoundary = new Date("2026-10-23T10:59:00Z").getTime();
  const tNextHour = new Date("2026-10-23T11:01:00Z").getTime();

  let fixedBurstTotal = 0;
  let slidingBurstTotal = 0;

  // Window 1: 10:59:00
  for (let i = 0; i < 50; i++) {
    const r1 = await limiter.reserve({ senderId: sFixed, now: tBoundary + i * 20, limit: 50, gapMs: 10, mode: "fixed" });
    if (r1.allowed) fixedBurstTotal++;

    const r2 = await limiter.reserve({ senderId: sSliding, now: tBoundary + i * 20, limit: 50, gapMs: 10, mode: "sliding" });
    if (r2.allowed) slidingBurstTotal++;
  }

  // Window 2: 11:01:00 (Only 2 minutes later)
  for (let i = 0; i < 50; i++) {
    const r1 = await limiter.reserve({ senderId: sFixed, now: tNextHour + i * 20, limit: 50, gapMs: 10, mode: "fixed" });
    if (r1.allowed) fixedBurstTotal++;

    const r2 = await limiter.reserve({ senderId: sSliding, now: tNextHour + i * 20, limit: 50, gapMs: 10, mode: "sliding" });
    if (r2.allowed) slidingBurstTotal++;
  }

  log(`Fixed Mode: Allowed ${fixedBurstTotal}/100 sends in a 2-minute span (Boundary Burst allowed due to hour rollover).`);
  log(`Sliding Mode: Allowed ${slidingBurstTotal}/100 sends in the same 2-minute rolling window (Rolling Cap enforced).`);

  log("\n===============================================================================");
  log("SIMULATION SUMMARY: ALL SCENARIOS COMPLETED");
  log(`AUDIT RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  log("===============================================================================");

  // Save evidence output
  const evidencePath = path.resolve(process.cwd(), "docs/evidence/simulate.txt");
  fs.writeFileSync(evidencePath, outputLines.join("\n"), "utf8");
  log(`Evidence saved to ${evidencePath}`);

  await prisma.$disconnect();
  await redis.quit();
}

main().catch((err) => {
  console.error("Simulation run failed:", err);
  process.exit(1);
});
