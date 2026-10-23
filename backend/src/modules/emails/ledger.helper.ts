import { Prisma } from "@prisma/client";
import { EventRecord } from "../../core/ports.js";
import { eventLog } from "../../adapters/eventlog.prisma.js";

type PrismaTx = Prisma.TransactionClient;

/**
 * Atomic mutation + event logger helper.
 * Applies the given mutation function and writes the corresponding EmailEvent
 * inside the exact same database transaction.
 */
export async function withLedger<T>(
  tx: PrismaTx,
  event: EventRecord,
  mutation: (tx: PrismaTx) => Promise<T>
): Promise<T> {
  const result = await mutation(tx);
  await eventLog.append(tx, event);
  return result;
}

export interface StoredEvent {
  id: string | bigint;
  emailId: string;
  type: string;
  at: Date | string;
  data: Record<string, unknown>;
}

/**
 * Generates a plain-English explainability summary from ordered email events.
 * Example: "Planned for 10:00. Delayed 52 min: hourly limit reached. Sent 10:52."
 */
export function generateTimelineSummary(events: StoredEvent[]): string {
  if (!events || events.length === 0) {
    return "No events recorded for this email.";
  }

  const parts: string[] = [];

  for (const ev of events) {
    const timeStr = new Date(ev.at).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });

    switch (ev.type) {
      case "PLANNED": {
        const plannedAt = ev.data?.plannedAt
          ? new Date(ev.data.plannedAt as string).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false
            })
          : timeStr;
        parts.push(`Planned for ${plannedAt}.`);
        break;
      }
      case "ENQUEUED": {
        const delayMs = Number(ev.data?.delayMs || 0);
        if (delayMs > 0) {
          const delaySec = Math.round(delayMs / 1000);
          parts.push(`Enqueued with ${delaySec}s delay.`);
        } else {
          parts.push(`Enqueued for immediate delivery.`);
        }
        break;
      }
      case "RESCHEDULED": {
        const reason = ev.data?.reason || "RATE_LIMIT";
        const from = ev.data?.from ? new Date(ev.data.from as string).getTime() : 0;
        const to = ev.data?.to ? new Date(ev.data.to as string).getTime() : 0;
        const diffMin = Math.max(1, Math.round((to - from) / 60000));
        const reasonText =
          reason === "RATE_LIMIT"
            ? "hourly limit reached"
            : reason === "MIN_GAP"
            ? "minimum gap spacing"
            : reason === "SENDER_OPEN"
            ? "sender circuit breaker open"
            : String(reason);
        parts.push(`Delayed ${diffMin} min: ${reasonText}.`);
        break;
      }
      case "SLOT_RESERVED": {
        parts.push(`Slot reserved at ${timeStr}.`);
        break;
      }
      case "CLAIMED": {
        parts.push(`Claimed by worker at ${timeStr}.`);
        break;
      }
      case "FAILOVER": {
        parts.push(`Failed over to backup sender.`);
        break;
      }
      case "SENT": {
        parts.push(`Sent ${timeStr}.`);
        break;
      }
      case "SMTP_ERROR": {
        const msg = ev.data?.message || "Transient error";
        parts.push(`SMTP error encountered at ${timeStr}: ${msg}.`);
        break;
      }
      case "RECOVERED": {
        parts.push(`Stale processing job recovered at ${timeStr}.`);
        break;
      }
      case "FAILED": {
        const reason = ev.data?.reason || "Unknown";
        parts.push(`Failed permanently at ${timeStr} (${reason}).`);
        break;
      }
    }
  }

  return parts.join(" ");
}
