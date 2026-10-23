import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { emailQueue } from "../src/adapters/queue.bullmq.js";

export interface InvariantResult {
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface AuditReport {
  campaignId?: string;
  totalEmails: number;
  sendersCount: number;
  timeWindow: string;
  invariants: {
    I1: InvariantResult;
    I2: InvariantResult;
    I3: InvariantResult;
    I4: InvariantResult;
    I5: InvariantResult;
    I6: InvariantResult;
    I7: InvariantResult;
  };
  passed: boolean;
}

/**
 * INVARIANT AUDITOR (Reads Postgres and event ledger)
 * Evaluates the 7 core delivery invariants against ground-truth data.
 */
export async function runAudit(campaignId?: string, isDrained = false): Promise<AuditReport> {
  const whereEmail = campaignId ? { campaignId } : {};
  const whereEvent = campaignId ? { campaignId } : {};

  const [emails, events, senders] = await Promise.all([
    prisma.email.findMany({ where: whereEmail }),
    prisma.emailEvent.findMany({ where: whereEvent, orderBy: { id: "asc" } }),
    prisma.sender.findMany()
  ]);

  const totalEmails = emails.length;
  const uniqueSenders = new Set(emails.map((e) => e.senderId));

  // Determine time window
  let windowStart = "N/A";
  let windowEnd = "N/A";
  if (events.length > 0) {
    windowStart = new Date(events[0]!.at).toISOString().split("T")[0]!;
    windowEnd = new Date(events[events.length - 1]!.at).toISOString().split("T")[0]!;
  }
  const timeWindow = `${windowStart}..${windowEnd}`;

  // ==========================================
  // I1: At most one send per email
  // ==========================================
  const sentEvents = events.filter((e) => e.type === "SENT");
  const emailSentCounts = new Map<string, number>();
  const messageIds = new Set<string>();
  let duplicateMessageIds = 0;

  for (const ev of sentEvents) {
    emailSentCounts.set(ev.emailId, (emailSentCounts.get(ev.emailId) || 0) + 1);
    const mid = (ev.data as Record<string, unknown>)?.messageId as string;
    if (mid) {
      if (messageIds.has(mid)) {
        duplicateMessageIds++;
      } else {
        messageIds.add(mid);
      }
    }
  }

  let duplicateSends = 0;
  for (const [, cnt] of emailSentCounts.entries()) {
    if (cnt > 1) duplicateSends += cnt - 1;
  }

  const i1Passed = duplicateSends === 0 && duplicateMessageIds === 0;
  const I1: InvariantResult = {
    passed: i1Passed,
    message: `${sentEvents.length} sends audited, ${duplicateSends} duplicate sends, ${duplicateMessageIds} duplicate message_ids`
  };

  // ==========================================
  // I2: Hourly cap never exceeded
  // ==========================================
  const slotReservedEvents = events.filter((e) => e.type === "SLOT_RESERVED");
  const senderHourlyCounts = new Map<string, { count: number; limit: number }>();
  let maxRateObserved = 0;
  let maxCapEncountered = 0;
  let i2Passed = true;

  for (const ev of slotReservedEvents) {
    const data = ev.data as Record<string, unknown>;
    const reservedAt = Number(data.reservedAt || new Date(ev.at).getTime());
    const limit = Number(data.limit || 200);
    const hourStart = Math.floor(reservedAt / 3600000);
    const key = `${ev.senderId}:${hourStart}`;

    const current = senderHourlyCounts.get(key) || { count: 0, limit };
    current.count++;
    senderHourlyCounts.set(key, current);

    maxRateObserved = Math.max(maxRateObserved, current.count);
    maxCapEncountered = Math.max(maxCapEncountered, limit);

    if (current.count > limit) {
      i2Passed = false;
    }
  }

  const I2: InvariantResult = {
    passed: i2Passed,
    message: `max ${maxRateObserved}/hr observed, cap ${maxCapEncountered} (${i2Passed ? "within limits" : "BREACH DETECTED"})`
  };

  // ==========================================
  // I3: Minimum gap respected
  // ==========================================
  const senderSlots = new Map<string, { reservedAt: number; gapMs: number }[]>();
  for (const ev of slotReservedEvents) {
    const data = ev.data as Record<string, unknown>;
    const reservedAt = Number(data.reservedAt || new Date(ev.at).getTime());
    const gapMs = Number(data.gapMs || 0);

    if (!senderSlots.has(ev.senderId)) senderSlots.set(ev.senderId, []);
    senderSlots.get(ev.senderId)!.push({ reservedAt, gapMs });
  }

  let i3Passed = true;
  let minObservedGap = Infinity;
  let requiredGapForMin = 0;

  for (const [, slots] of senderSlots.entries()) {
    slots.sort((a, b) => a.reservedAt - b.reservedAt);
    for (let i = 1; i < slots.length; i++) {
      const gap = slots[i]!.reservedAt - slots[i - 1]!.reservedAt;
      const req = slots[i]!.gapMs;
      if (gap < minObservedGap) {
        minObservedGap = gap;
        requiredGapForMin = req;
      }
      if (gap < req - 5) {
        // 5ms margin for clock jitter/rounding
        i3Passed = false;
      }
    }
  }

  if (minObservedGap === Infinity) minObservedGap = 0;
  const I3: InvariantResult = {
    passed: i3Passed,
    message: `min observed ${(minObservedGap / 1000).toFixed(2)}s, required ${(requiredGapForMin / 1000).toFixed(2)}s`
  };

  // ==========================================
  // I4: Nothing lost
  // ==========================================
  const terminalCount = emails.filter((e) => e.status === "SENT" || e.status === "FAILED").length;
  const stuckCount = emails.filter((e) => e.status === "PROCESSING").length;
  const scheduledCount = emails.filter((e) => e.status === "SCHEDULED").length;

  let i4Passed = true;
  let i4Message = `${sentEvents.length} sent, ${emails.filter((e) => e.status === "FAILED").length} failed, ${stuckCount} stuck`;
  if (isDrained) {
    i4Passed = terminalCount === totalEmails && stuckCount === 0;
    i4Message += i4Passed ? " (all drained)" : " (undrained jobs remain)";
  } else {
    // If not drained yet, having scheduled is valid, but stuck PROCESSING is flagged
    i4Passed = stuckCount === 0;
    i4Message += ` (${scheduledCount} pending)`;
  }

  const I4: InvariantResult = {
    passed: i4Passed,
    message: i4Message
  };

  // ==========================================
  // I5: Nothing sent early
  // ==========================================
  let earlySends = 0;
  for (const email of emails) {
    if (email.status === "SENT" && email.sentAt) {
      // Sent time must be >= scheduled_at (-1000ms clock skew allowance)
      if (email.sentAt.getTime() < email.scheduledAt.getTime() - 1000) {
        earlySends++;
      }
    }
  }

  const I5: InvariantResult = {
    passed: earlySends === 0,
    message: `${earlySends} early send violations detected`
  };

  // ==========================================
  // I6: Overflow order preserved
  // ==========================================
  const rescheduleEvents = events.filter((e) => e.type === "RESCHEDULED");
  const senderReschedules = new Map<string, number[]>();
  for (const ev of rescheduleEvents) {
    const data = ev.data as Record<string, unknown>;
    const to = new Date(data.to as string).getTime();
    if (!senderReschedules.has(ev.senderId)) senderReschedules.set(ev.senderId, []);
    senderReschedules.get(ev.senderId)!.push(to);
  }

  let i6Passed = true;
  for (const [, times] of senderReschedules.entries()) {
    for (let i = 1; i < times.length; i++) {
      if (times[i]! < times[i - 1]!) {
        i6Passed = false;
        break;
      }
    }
  }

  const I6: InvariantResult = {
    passed: i6Passed,
    message: i6Passed ? "monotonic" : "out-of-order overflow detected"
  };

  // ==========================================
  // I7: Stores agree
  // ==========================================
  const queuePrefix = `bull:${emailQueue.name}`;
  const [delayedIds, waitingIds, activeIds] = await Promise.all([
    redis.zrange(`${queuePrefix}:delayed`, 0, -1),
    redis.lrange(`${queuePrefix}:wait`, 0, -1),
    redis.lrange(`${queuePrefix}:active`, 0, -1)
  ]);
  const redisJobIds = new Set<string>([...delayedIds, ...waitingIds, ...activeIds]);

  let missingRedisJobs = 0;
  for (const email of emails) {
    if (email.status === "SCHEDULED" && !redisJobIds.has(email.id)) {
      missingRedisJobs++;
    }
  }

  const i7Passed = missingRedisJobs === 0;
  const I7: InvariantResult = {
    passed: i7Passed,
    message: `${missingRedisJobs} drift (missing Redis jobs for SCHEDULED rows)`
  };

  const allPassed = I1.passed && I2.passed && I3.passed && I4.passed && I5.passed && I6.passed && I7.passed;

  return {
    campaignId,
    totalEmails,
    sendersCount: uniqueSenders.size,
    timeWindow,
    invariants: { I1, I2, I3, I4, I5, I6, I7 },
    passed: allPassed
  };
}

export function formatAuditReport(report: AuditReport): string {
  const symbol = (p: boolean) => (p ? "✔" : "✖");
  const lines = [
    `AUDIT campaign=${report.campaignId || "ALL"}  emails=${report.totalEmails}  senders=${report.sendersCount}  window=${report.timeWindow}`,
    ` ${symbol(report.invariants.I1.passed)} I1 at-most-once        ${report.invariants.I1.message}`,
    ` ${symbol(report.invariants.I2.passed)} I2 hourly cap          ${report.invariants.I2.message}`,
    ` ${symbol(report.invariants.I3.passed)} I3 min gap             ${report.invariants.I3.message}`,
    ` ${symbol(report.invariants.I4.passed)} I4 nothing lost        ${report.invariants.I4.message}`,
    ` ${symbol(report.invariants.I5.passed)} I5 never early         ${report.invariants.I5.message}`,
    ` ${symbol(report.invariants.I6.passed)} I6 overflow order      ${report.invariants.I6.message}`,
    ` ${symbol(report.invariants.I7.passed)} I7 stores agree        ${report.invariants.I7.message}`,
    `RESULT: ${report.passed ? "PASS" : "FAIL"}`
  ];
  return lines.join("\n");
}

// CLI runner
async function cli() {
  const args = process.argv.slice(2);
  let campaignId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--campaign" && args[i + 1]) {
      campaignId = args[i + 1];
    }
  }

  const report = await runAudit(campaignId);
  console.log(formatAuditReport(report));

  await prisma.$disconnect();
  await redis.quit();

  if (!report.passed) {
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("audit.ts")) {
  cli().catch((err) => {
    console.error("Auditor failed:", err);
    process.exit(1);
  });
}
