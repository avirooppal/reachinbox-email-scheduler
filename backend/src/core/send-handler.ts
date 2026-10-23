import { PrismaClient } from "@prisma/client";
import { Clock, Limiter, Transport, EventLog, SenderRecord } from "./ports.js";
import { classifySmtpError } from "./errors.js";

export interface SendHandlerContext {
  clock: Clock;
  prisma: PrismaClient;
  limiter: Limiter;
  transportFactory: (sender: SenderRecord) => Promise<Transport>;
  eventLog: EventLog;
  workerId?: string;
  maxAttempts?: number;
  rateLimitMode?: "fixed" | "sliding";
  onLimitReached?: (senderId: string, limit: number, windowCount: number) => Promise<void>;
  onEmailSent?: (emailId: string) => Promise<void>;
}

export type SendOutcome =
  | { outcome: "SENT"; messageId: string; previewUrl?: string }
  | { outcome: "RESCHEDULED"; retryAt: number; reason: "RATE_LIMIT" | "MIN_GAP" | "SENDER_OPEN" }
  | { outcome: "ALREADY_TERMINAL"; status: string }
  | { outcome: "CLAIM_LOST" }
  | { outcome: "FAILED"; reason: string };

/**
 * PURE DOMAIN SEND HANDLER
 * The single source of truth for email delivery.
 * Zero external framework imports (No Express, BullMQ, Nodemailer).
 */
export async function handleSend(
  emailId: string,
  ctx: SendHandlerContext
): Promise<SendOutcome> {
  const {
    clock,
    prisma,
    limiter,
    transportFactory,
    eventLog,
    workerId = "worker-1",
    maxAttempts = 3,
    rateLimitMode = "fixed",
    onLimitReached,
    onEmailSent
  } = ctx;

  const nowMs = clock.nowMs();
  const nowDate = clock.now();

  // 1. Load email with campaign and sender
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: {
      campaign: true,
      sender: true
    }
  });

  if (!email) {
    return { outcome: "ALREADY_TERMINAL", status: "NOT_FOUND" };
  }

  // Idempotency: If already terminal, exit immediately
  if (email.status === "SENT" || email.status === "FAILED") {
    return { outcome: "ALREADY_TERMINAL", status: email.status };
  }

  const sender = email.sender;
  const campaign = email.campaign;

  // 2. Check Sender Health (Circuit Breaker status)
  if (sender.health === "OPEN") {
    // If sender is OPEN, reschedule 60 seconds into the future
    const retryAt = nowMs + 60000;
    await prisma.$transaction(async (tx) => {
      await tx.email.update({
        where: { id: emailId },
        data: { scheduledAt: new Date(retryAt) }
      });
      await eventLog.append(tx, {
        emailId,
        campaignId: campaign.id,
        senderId: sender.id,
        type: "RESCHEDULED",
        data: {
          from: email.scheduledAt.toISOString(),
          to: new Date(retryAt).toISOString(),
          reason: "SENDER_OPEN"
        }
      });
    });
    return { outcome: "RESCHEDULED", retryAt, reason: "SENDER_OPEN" };
  }

  // 3. Rate Limit & Gap Check via Atomic Lua Limiter
  const effectiveLimit = sender.hourlyLimit || campaign.hourlyLimit;
  const effectiveGap = sender.minDelayMs !== null ? sender.minDelayMs : campaign.delayMs;

  const reservation = await limiter.reserve({
    senderId: sender.id,
    now: nowMs,
    limit: effectiveLimit,
    gapMs: effectiveGap,
    mode: rateLimitMode
  });

  if (!reservation.allowed) {
    // Denied by limiter: update scheduled_at, append RESCHEDULED, DO NOT consume retry attempt
    const retryAt = reservation.retryAt;
    await prisma.$transaction(async (tx) => {
      await tx.email.update({
        where: { id: emailId },
        data: { scheduledAt: new Date(retryAt) }
      });
      await eventLog.append(tx, {
        emailId,
        campaignId: campaign.id,
        senderId: sender.id,
        type: "RESCHEDULED",
        data: {
          from: email.scheduledAt.toISOString(),
          to: new Date(retryAt).toISOString(),
          reason: reservation.reason
        }
      });
    });
    return { outcome: "RESCHEDULED", retryAt, reason: reservation.reason };
  }

  // Slot was reserved: record SLOT_RESERVED event
  await prisma.$transaction(async (tx) => {
    await eventLog.append(tx, {
      emailId,
      campaignId: campaign.id,
      senderId: sender.id,
      type: "SLOT_RESERVED",
      data: {
        reservedAt: reservation.reservedAt,
        limit: effectiveLimit,
        gapMs: effectiveGap,
        windowCount: reservation.windowCount,
        mode: rateLimitMode
      }
    });
  });

  // If hourly limit was reached at this exact send, notify Slack callback
  if (reservation.limitReachedNow && onLimitReached) {
    onLimitReached(sender.id, effectiveLimit, reservation.windowCount).catch(() => {});
  }

  // 4. Atomic Claim: UPDATE ... WHERE status = 'SCHEDULED' RETURNING *
  const claimResult = await prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string; attempts: number }>>`
      UPDATE emails
      SET status = 'PROCESSING',
          claimed_at = ${nowDate},
          attempts = attempts + 1
      WHERE id = ${emailId} AND status = 'SCHEDULED'
      RETURNING id, attempts
    `;

    if (!updated || updated.length === 0) {
      return null;
    }

    const currentAttempt = updated[0]!.attempts;

    await eventLog.append(tx, {
      emailId,
      campaignId: campaign.id,
      senderId: sender.id,
      type: "CLAIMED",
      data: {
        attempt: currentAttempt,
        workerId
      }
    });

    return { attempts: currentAttempt };
  });

  if (!claimResult) {
    return { outcome: "CLAIM_LOST" };
  }

  // 5. Deliver Email via Transport with Deterministic Message-ID
  const fromDomain = sender.fromEmail.split("@")[1] || "outbox.local";
  const deterministicMessageId = `<${emailId}@${fromDomain}>`;

  try {
    const transport = await transportFactory(sender as unknown as SenderRecord);
    const sendResult = await transport.send({
      from: sender.fromEmail,
      to: email.toEmail,
      subject: email.subject,
      body: email.body,
      messageId: deterministicMessageId
    });

    // 6. Mark SENT + Append SENT event in one transaction
    const sentDate = clock.now();
    await prisma.$transaction(async (tx) => {
      await tx.email.update({
        where: { id: emailId },
        data: {
          status: "SENT",
          messageId: sendResult.messageId,
          previewUrl: sendResult.previewUrl || null,
          sentAt: sentDate
        }
      });

      await eventLog.append(tx, {
        emailId,
        campaignId: campaign.id,
        senderId: sender.id,
        type: "SENT",
        at: sentDate,
        data: {
          messageId: sendResult.messageId,
          previewUrl: sendResult.previewUrl
        }
      });
    });

    if (onEmailSent) {
      onEmailSent(emailId).catch(() => {});
    }

    return {
      outcome: "SENT",
      messageId: sendResult.messageId,
      previewUrl: sendResult.previewUrl
    };
  } catch (err) {
    // 7. Error Classification & Handling
    const classification = classifySmtpError(err);
    const isLastAttempt = claimResult.attempts >= maxAttempts;

    await prisma.$transaction(async (tx) => {
      await eventLog.append(tx, {
        emailId,
        campaignId: campaign.id,
        senderId: sender.id,
        type: "SMTP_ERROR",
        data: {
          code: classification.code,
          transient: classification.isTransient,
          message: classification.message
        }
      });

      if (classification.isTransient && !isLastAttempt) {
        // Transient error: release status back to SCHEDULED for BullMQ retry
        await tx.email.update({
          where: { id: emailId },
          data: {
            status: "SCHEDULED",
            lastError: classification.message
          }
        });
      } else {
        // Permanent error or final attempt exhausted: mark FAILED
        await tx.email.update({
          where: { id: emailId },
          data: {
            status: "FAILED",
            lastError: classification.message
          }
        });

        await eventLog.append(tx, {
          emailId,
          campaignId: campaign.id,
          senderId: sender.id,
          type: "FAILED",
          data: {
            reason: classification.message
          }
        });
      }
    });

    if (classification.isTransient && !isLastAttempt) {
      // Re-throw so BullMQ initiates backoff
      throw err;
    }

    return {
      outcome: "FAILED",
      reason: classification.message
    };
  }
}
