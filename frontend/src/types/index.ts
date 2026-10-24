export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  googleId?: string | null;
}

export interface Sender {
  id: string;
  userId: string;
  name: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  hourlyLimit?: number | null;
  minDelayMs?: number | null;
  isActive: boolean;
  health: "HEALTHY" | "DEGRADED" | "OPEN";
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export type EmailStatus = "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";

export interface Email {
  id: string;
  campaignId: string;
  userId: string;
  senderId: string;
  toEmail: string;
  toName?: string | null;
  subject: string;
  body: string;
  snippet?: string;
  seq: number;
  plannedAt: string;
  scheduledAt: string;
  status: EmailStatus;
  attempts: number;
  isStarred: boolean;
  isArchived: boolean;
  messageId?: string | null;
  previewUrl?: string | null;
  lastError?: string | null;
  sentAt?: string | null;
  createdAt: string;
  sender?: {
    id: string;
    name: string;
    fromEmail: string;
  };
  campaign?: {
    id: string;
    subject: string;
  };
  attachments?: Attachment[];
  attachmentCount?: number;
}

export interface TimelineEvent {
  id: string;
  emailId: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface EmailTimeline {
  emailId: string;
  summary: string;
  events: TimelineEvent[];
}

export interface EmailCounts {
  scheduled: number;
  sent: number;
}
