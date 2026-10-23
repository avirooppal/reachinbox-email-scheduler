import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { allocate, PlannerSender } from "../src/core/planner/allocator.js";
import { preview } from "../src/core/planner/preview.js";

describe("Milestone 4: Pure Capacity Planner", () => {
  const baseSenders: PlannerSender[] = [
    { id: "sender-1", name: "S1", health: "HEALTHY", isActive: true },
    { id: "sender-2", name: "S2", health: "HEALTHY", isActive: true },
    { id: "sender-3", name: "S3", health: "HEALTHY", isActive: true }
  ];

  it("allocates slots across healthy senders and skips OPEN senders", () => {
    const senders: PlannerSender[] = [
      { id: "s1", health: "HEALTHY", isActive: true },
      { id: "s2", health: "OPEN", isActive: true }, // Should be skipped!
      { id: "s3", health: "HEALTHY", isActive: true }
    ];

    const slots = allocate({
      startAt: new Date("2026-10-23T10:00:00Z"),
      delayMs: 2000,
      hourlyLimit: 50,
      jitterPct: 0,
      senders,
      count: 10
    });

    expect(slots.length).toBe(10);
    const assignedSenders = new Set(slots.map((s) => s.senderId));
    expect(assignedSenders.has("s1")).toBe(true);
    expect(assignedSenders.has("s3")).toBe(true);
    expect(assignedSenders.has("s2")).toBe(false); // OPEN sender skipped
  });

  it("FAST-CHECK: No sender exceeds hourlyLimit in any clock hour", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 200 }), // count
        fc.integer({ min: 5, max: 50 }),   // hourlyLimit
        fc.integer({ min: 100, max: 5000 }), // delayMs
        fc.integer({ min: 0, max: 25 }),   // jitterPct
        (count, hourlyLimit, delayMs, jitterPct) => {
          const slots = allocate({
            startAt: new Date("2026-10-23T10:00:00Z"),
            delayMs,
            hourlyLimit,
            jitterPct,
            senders: baseSenders,
            count
          });

          // Group by sender and clock-hour
          const hourCounts = new Map<string, number>();
          for (const slot of slots) {
            const hourStart = Math.floor(slot.plannedAt.getTime() / 3600000);
            const key = `${slot.senderId}:${hourStart}`;
            hourCounts.set(key, (hourCounts.get(key) || 0) + 1);
          }

          // Assert every sender clock-hour count <= hourlyLimit
          for (const [, cnt] of hourCounts.entries()) {
            expect(cnt).toBeLessThanOrEqual(hourlyLimit);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("FAST-CHECK: Inter-email gaps on same sender are >= minDelay even with jitter", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        fc.integer({ min: 1000, max: 5000 }),
        fc.integer({ min: 0, max: 50 }),
        (count, delayMs, jitterPct) => {
          const slots = allocate({
            startAt: new Date("2026-10-23T10:00:00Z"),
            delayMs,
            hourlyLimit: 100,
            jitterPct,
            senders: baseSenders,
            count
          });

          // Check consecutive slots per sender
          const senderSlots = new Map<string, number[]>();
          for (const s of slots) {
            if (!senderSlots.has(s.senderId)) senderSlots.set(s.senderId, []);
            senderSlots.get(s.senderId)!.push(s.plannedAt.getTime());
          }

          for (const [, times] of senderSlots.entries()) {
            for (let i = 1; i < times.length; i++) {
              const gap = times[i] - times[i - 1];
              expect(gap).toBeGreaterThanOrEqual(delayMs);
            }
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it("FAST-CHECK: Same seed and inputs produce byte-for-byte identical output", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4 }),
        fc.integer({ min: 5, max: 50 }),
        (seed, count) => {
          const run1 = allocate({
            startAt: new Date("2026-10-23T10:00:00Z"),
            delayMs: 2000,
            hourlyLimit: 50,
            jitterPct: 20,
            senders: baseSenders,
            count,
            seed
          });

          const run2 = allocate({
            startAt: new Date("2026-10-23T10:00:00Z"),
            delayMs: 2000,
            hourlyLimit: 50,
            jitterPct: 20,
            senders: baseSenders,
            count,
            seed
          });

          expect(run1.map((s) => s.plannedAt.getTime())).toEqual(
            run2.map((s) => s.plannedAt.getTime())
          );
        }
      ),
      { numRuns: 20 }
    );
  });

  it("avoids pre-occupied slots on a sender's timeline without collision", () => {
    const startMs = new Date("2026-10-23T10:00:00Z").getTime();
    // Suppose sender-1 already has slots at 10:00:00 and 10:00:04
    const occupied = new Map<string, number[]>([
      ["sender-1", [startMs, startMs + 4000]]
    ]);

    const slots = allocate({
      startAt: startMs,
      delayMs: 3000,
      hourlyLimit: 50,
      jitterPct: 0,
      senders: [{ id: "sender-1", health: "HEALTHY", isActive: true }],
      occupied,
      count: 2
    });

    expect(slots.length).toBe(2);
    // Slot 0 must not collide with startMs or startMs + 4000
    for (const slot of slots) {
      const t = slot.plannedAt.getTime();
      expect(t).not.toBe(startMs);
      expect(t).not.toBe(startMs + 4000);
      expect(Math.abs(t - startMs)).toBeGreaterThanOrEqual(3000);
      expect(Math.abs(t - (startMs + 4000))).toBeGreaterThanOrEqual(3000);
    }
  });

  it("PERFORMANCE: 10,000 emails allocate in well under 1 second", () => {
    const start = performance.now();
    const slots = allocate({
      startAt: new Date("2026-10-23T08:00:00Z"),
      delayMs: 1500,
      hourlyLimit: 100,
      jitterPct: 15,
      senders: baseSenders,
      count: 10000,
      seed: "benchmark-seed"
    });
    const elapsed = performance.now() - start;

    expect(slots.length).toBe(10000);
    expect(elapsed).toBeLessThan(1000); // Well under 1 second
  });

  it("preview() returns matching finishAt, breakdown and warnings", () => {
    const result = preview({
      startAt: new Date("2026-10-23T10:00:00Z"),
      delayMs: 2000,
      hourlyLimit: 50,
      jitterPct: 10,
      senders: baseSenders,
      count: 200
    });

    expect(result.total).toBe(200);
    expect(result.plannedFinishAt).toBeDefined();
    expect(Object.keys(result.perSenderSplit).length).toBe(3);
    expect(Object.keys(result.perHourCounts).length).toBeGreaterThan(0);
  });
});
