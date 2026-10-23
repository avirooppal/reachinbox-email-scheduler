import { getDeterministicJitter } from "./jitter.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface PlannerSender {
  id: string;
  name?: string;
  health: "HEALTHY" | "DEGRADED" | "OPEN";
  isActive?: boolean;
  hourlyLimit?: number | null;
  minDelayMs?: number | null;
}

export interface AllocateParams {
  startAt: Date | number;
  delayMs: number;
  hourlyLimit: number;
  jitterPct: number;
  senders: PlannerSender[];
  occupied?: Map<string, number[]>; // senderId -> sorted array of epoch ms
  count: number;
  seed?: string;
}

export interface PlannedSlot {
  seq: number;
  senderId: string;
  plannedAt: Date;
}

/**
 * PURE CAPACITY PLANNER
 * First-fit placement on per-sender timelines.
 * Strictly respects clock-hour caps and minimum inter-email gaps.
 */
export function allocate(params: AllocateParams): PlannedSlot[] {
  const {
    startAt,
    delayMs,
    hourlyLimit,
    jitterPct,
    senders,
    occupied = new Map<string, number[]>(),
    count,
    seed = "default-seed"
  } = params;

  if (count <= 0) {
    return [];
  }

  // Filter healthy, active senders (skip OPEN or inactive senders)
  const availableSenders = senders.filter(
    (s) => s.health !== "OPEN" && s.isActive !== false
  );

  if (availableSenders.length === 0) {
    throw new Error("No healthy senders available for scheduling");
  }

  const startMs = typeof startAt === "number" ? startAt : startAt.getTime();

  // Create local copies of occupied timelines per sender
  const timelineMap = new Map<string, number[]>();
  for (const s of availableSenders) {
    const existing = occupied.get(s.id) || [];
    timelineMap.set(s.id, [...existing].sort((a, b) => a - b));
  }

  const result: PlannedSlot[] = [];

  for (let seq = 0; seq < count; seq++) {
    // Round-robin assignment across available senders
    const sender = availableSenders[seq % availableSenders.length]!;
    const senderTimeline = timelineMap.get(sender.id)!;

    // Effective limits: sender override takes precedence over campaign
    const effectiveLimit = sender.hourlyLimit || hourlyLimit;
    const effectiveBaseGap = sender.minDelayMs !== undefined && sender.minDelayMs !== null
      ? sender.minDelayMs
      : delayMs;

    // Calculate deterministic jitter (only adds to the gap)
    const jitter = getDeterministicJitter(seed, seq, effectiveBaseGap, jitterPct);
    const requiredGap = effectiveBaseGap + jitter;

    // Start looking from startMs
    let candidate = startMs;

    // If sender already has planned slots, candidate cannot be before last planned + gap
    if (senderTimeline.length > 0) {
      const lastPlanned = senderTimeline[senderTimeline.length - 1]!;
      candidate = Math.max(candidate, lastPlanned + requiredGap);
    }

    // First-fit slot search
    while (true) {
      // 1. Enforce hourly cap in current clock hour window
      const hourStart = Math.floor(candidate / ONE_HOUR_MS) * ONE_HOUR_MS;
      const hourEnd = hourStart + ONE_HOUR_MS;

      // Count existing slots in this clock-hour
      let countInHour = 0;
      for (let i = senderTimeline.length - 1; i >= 0; i--) {
        const t = senderTimeline[i]!;
        if (t >= hourStart && t < hourEnd) {
          countInHour++;
        } else if (t < hourStart) {
          break; // Since timeline is sorted
        }
      }

      if (countInHour >= effectiveLimit) {
        // Hour is full, jump candidate to start of next hour
        candidate = hourEnd;
        continue;
      }

      // 2. Check collision with any pre-occupied slot around candidate
      // Find position of candidate in senderTimeline
      let collision = false;
      let nextValidTime = candidate;

      // Binary search or linear search for closest neighbors
      for (let i = 0; i < senderTimeline.length; i++) {
        const t = senderTimeline[i]!;
        // If candidate is too close to an existing slot t
        if (Math.abs(candidate - t) < requiredGap) {
          collision = true;
          nextValidTime = Math.max(nextValidTime, t + requiredGap);
        } else if (t > candidate) {
          break;
        }
      }

      if (collision) {
        candidate = nextValidTime;
        continue;
      }

      // Valid slot found!
      senderTimeline.push(candidate);
      // Keep timeline sorted (it is almost always added to the end)
      if (senderTimeline.length > 1 && senderTimeline[senderTimeline.length - 1]! < senderTimeline[senderTimeline.length - 2]!) {
        senderTimeline.sort((a, b) => a - b);
      }

      result.push({
        seq,
        senderId: sender.id,
        plannedAt: new Date(candidate)
      });
      break;
    }
  }

  return result;
}
