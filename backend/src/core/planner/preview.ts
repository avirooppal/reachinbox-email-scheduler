import { allocate, AllocateParams, PlannedSlot } from "./allocator.js";

export interface PreviewResult {
  total: number;
  plannedFinishAt: Date;
  durationMs: number;
  perHourCounts: Record<string, number>;
  perSenderSplit: Record<string, number>;
  warnings: string[];
  slots: PlannedSlot[];
}

export function preview(params: AllocateParams): PreviewResult {
  const slots = allocate(params);

  if (slots.length === 0) {
    const start = typeof params.startAt === "number" ? new Date(params.startAt) : params.startAt;
    return {
      total: 0,
      plannedFinishAt: start,
      durationMs: 0,
      perHourCounts: {},
      perSenderSplit: {},
      warnings: [],
      slots: []
    };
  }

  const firstSlot = slots[0]!;
  const lastSlot = slots[slots.length - 1]!;
  const startMs = typeof params.startAt === "number" ? params.startAt : params.startAt.getTime();
  const finishMs = lastSlot.plannedAt.getTime();
  const durationMs = finishMs - startMs;

  const perHourCounts: Record<string, number> = {};
  const perSenderSplit: Record<string, number> = {};

  for (const slot of slots) {
    // Clock-hour key format: "YYYY-MM-DD HH:00"
    const d = new Date(slot.plannedAt);
    const hourKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;

    perHourCounts[hourKey] = (perHourCounts[hourKey] || 0) + 1;
    perSenderSplit[slot.senderId] = (perSenderSplit[slot.senderId] || 0) + 1;
  }

  const warnings: string[] = [];

  // Warn if schedule duration exceeds 7 days
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (durationMs > SEVEN_DAYS_MS) {
    const days = Math.round(durationMs / (24 * 60 * 60 * 1000));
    warnings.push(`Campaign delivery will span over ${days} days at current rate limits.`);
  }

  // Warn if only 1 sender is carrying a large campaign (> 1000 emails)
  if (Object.keys(perSenderSplit).length === 1 && slots.length > 1000) {
    warnings.push("Only 1 healthy sender is configured. Consider adding more senders to parallelize throughput.");
  }

  return {
    total: slots.length,
    plannedFinishAt: lastSlot.plannedAt,
    durationMs,
    perHourCounts,
    perSenderSplit,
    warnings,
    slots
  };
}
