/**
 * PURE DOMAIN PORTS
 * No Express, BullMQ, or Nodemailer imports allowed.
 */

export interface Clock {
  now(): Date;
  nowMs(): number;
}

export interface SendMailParams {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

export interface SendMailResult {
  messageId: string;
  previewUrl?: string;
}

export interface Transport {
  send(params: SendMailParams): Promise<SendMailResult>;
}

export type LimiterResult =
  | {
      allowed: true;
      limitReachedNow: boolean;
      reservedAt: number;
      windowCount: number;
    }
  | {
      allowed: false;
      reason: "LIMITED" | "TOO_SOON";
      retryAt: number;
    };

export interface ReserveSlotParams {
  senderId: string;
  now: number;
  limit: number;
  gapMs: number;
  mode?: "fixed" | "sliding";
}

export interface Limiter {
  reserve(params: ReserveSlotParams): Promise<LimiterResult>;
}

export interface EventRecord {
  emailId: string;
  campaignId: string;
  senderId: string;
  type:
    | "PLANNED"
    | "ENQUEUED"
    | "RESCHEDULED"
    | "SLOT_RESERVED"
    | "CLAIMED"
    | "SENT"
    | "SMTP_ERROR"
    | "FAILOVER"
    | "RECOVERED"
    | "FAILED";
  at?: Date;
  data: Record<string, unknown>;
}

export interface EventLog {
  append(tx: unknown, event: EventRecord): Promise<void>;
}

export interface EmailRecord {
  id: string;
  campaignId: string;
  userId: string;
  senderId: string;
  toEmail: string;
  subject: string;
  body: string;
  seq: number;
  plannedAt: Date;
  scheduledAt: Date;
  status: "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED";
  attempts: number;
  messageId: string | null;
  previewUrl: string | null;
  lastError: string | null;
  claimedAt: Date | null;
  sentAt: Date | null;
}

export interface SenderRecord {
  id: string;
  userId: string;
  name: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassEnc: string;
  hourlyLimit: number | null;
  minDelayMs: number | null;
  isActive: boolean;
  health: "HEALTHY" | "DEGRADED" | "OPEN";
  healthChangedAt: Date;
}

export interface CampaignRecord {
  id: string;
  userId: string;
  subject: string;
  bodyTemplate: string;
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
  total: number;
  idempotencyKey: string | null;
  plannedFinishAt: Date | null;
}
