import { prisma } from "../../infra/prisma.js";
import { SendersService } from "../senders/senders.service.js";
import { allocate, PlannerSender } from "../../core/planner/allocator.js";
import { preview, PreviewResult } from "../../core/planner/preview.js";
import { enqueueBulkEmailJobs } from "../../adapters/queue.bullmq.js";
import { searchIndexQueue } from "../../queue/search-index.worker.js";
import { env } from "../../config/env.js";

export interface RecipientInput {
  email: string;
  name?: string;
  vars?: Record<string, string>;
}

export interface ScheduleCampaignInput {
  subject: string;
  body: string;
  startAt?: string | Date;
  senderId?: string;
  delayMs?: number;
  hourlyLimit?: number;
  jitterPct?: number;
  attachmentIds?: string[];
  recipients: RecipientInput[];
}

export class CampaignsService {
  /**
   * Validates and deduplicates recipients.
   * Strips whitespace, standardizes to lowercase, rejects malformed emails.
   */
  static normalizeRecipients(recipients: RecipientInput[]) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validMap = new Map<string, RecipientInput>();
    const invalid: string[] = [];
    let duplicatesRemoved = 0;

    for (const r of recipients) {
      const email = r.email.trim().toLowerCase();
      if (!emailRegex.test(email)) {
        invalid.push(r.email);
        continue;
      }
      if (validMap.has(email)) {
        duplicatesRemoved++;
      } else {
        validMap.set(email, { email, name: r.name, vars: r.vars || {} });
      }
    }

    return {
      validRecipients: Array.from(validMap.values()),
      invalid,
      duplicatesRemoved
    };
  }

  /**
   * Preview a campaign schedule without writing anything to DB or Redis.
   */
  static async previewCampaign(
    userId: string,
    input: ScheduleCampaignInput
  ): Promise<PreviewResult & { invalid: string[]; duplicatesRemoved: number }> {
    const { validRecipients, invalid, duplicatesRemoved } = this.normalizeRecipients(input.recipients);

    if (validRecipients.length === 0) {
      throw new Error("No valid recipients provided");
    }

    // Load user's healthy senders
    let dbSenders = await prisma.sender.findMany({
      where: {
        userId,
        isActive: true,
        ...(input.senderId ? { id: input.senderId } : {})
      }
    });

    if (dbSenders.length === 0) {
      const defaultSender = await SendersService.createEtherealSender(userId, "Default Ethereal Sender");
      dbSenders = [defaultSender as any];
    }

    const senders: PlannerSender[] = dbSenders.map((s) => ({
      id: s.id,
      name: s.name,
      health: s.health,
      isActive: s.isActive,
      hourlyLimit: s.hourlyLimit,
      minDelayMs: s.minDelayMs
    }));

    const startAt = input.startAt ? new Date(input.startAt) : new Date();

    // Read occupied timeline for these senders from startAt onwards
    const futureEmails = await prisma.email.findMany({
      where: {
        senderId: { in: senders.map((s) => s.id) },
        plannedAt: { gte: startAt },
        status: { in: ["SCHEDULED", "PROCESSING"] }
      },
      select: { senderId: true, plannedAt: true },
      orderBy: { plannedAt: "asc" }
    });

    const occupied = new Map<string, number[]>();
    for (const fe of futureEmails) {
      if (!occupied.has(fe.senderId)) occupied.set(fe.senderId, []);
      occupied.get(fe.senderId)!.push(fe.plannedAt.getTime());
    }

    const previewResult = preview({
      startAt,
      delayMs: input.delayMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS,
      hourlyLimit: input.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      jitterPct: input.jitterPct ?? env.JITTER_PCT,
      senders,
      occupied,
      count: validRecipients.length,
      seed: `${userId}:${startAt.toISOString()}`
    });

    return {
      ...previewResult,
      invalid,
      duplicatesRemoved
    };
  }

  /**
   * Schedules a campaign:
   * 1. Checks Idempotency-Key
   * 2. Serializes concurrent submissions via pg_advisory_xact_lock
   * 3. Plans slots and writes Campaign + Emails + PLANNED events in one transaction
   * 4. Enqueues BullMQ delayed jobs and appends ENQUEUED events
   */
  static async scheduleCampaign(
    userId: string,
    input: ScheduleCampaignInput,
    idempotencyKey?: string | null
  ) {
    // 1. Idempotency check
    if (idempotencyKey) {
      const existing = await prisma.campaign.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey
          }
        },
        include: {
          _count: { select: { emails: true } }
        }
      });

      if (existing) {
        return {
          campaignId: existing.id,
          accepted: existing._count.emails,
          duplicatesRemoved: 0,
          invalid: [],
          plannedFinishAt: existing.plannedFinishAt,
          idempotentReplay: true
        };
      }
    }

    const { validRecipients, invalid, duplicatesRemoved } = this.normalizeRecipients(input.recipients);
    if (validRecipients.length === 0) {
      throw new Error("No valid recipients provided");
    }

    let dbSenders = await prisma.sender.findMany({
      where: {
        userId,
        isActive: true,
        ...(input.senderId ? { id: input.senderId } : {})
      }
    });

    if (dbSenders.length === 0) {
      const defaultSender = await SendersService.createEtherealSender(userId, "Default Ethereal Sender");
      dbSenders = [defaultSender as any];
    }

    const senders: PlannerSender[] = dbSenders.map((s) => ({
      id: s.id,
      name: s.name,
      health: s.health,
      isActive: s.isActive,
      hourlyLimit: s.hourlyLimit,
      minDelayMs: s.minDelayMs
    }));

    if (senders.filter((s) => s.health !== "OPEN").length === 0) {
      throw new Error("No healthy senders available to schedule campaign");
    }

    const startAt = input.startAt ? new Date(input.startAt) : new Date();
    const delayMs = input.delayMs ?? env.MIN_DELAY_BETWEEN_EMAILS_MS;
    const hourlyLimit = input.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const jitterPct = input.jitterPct ?? env.JITTER_PCT;

    // 2. Transaction with Advisory Locks
    // Sort sender IDs to prevent deadlock between concurrent requests
    const sortedSenderIds = senders.map((s) => s.id).sort();

    const plannedResult = await prisma.$transaction(
      async (tx) => {
        // Take transaction-level advisory locks for each sender
        for (const sid of sortedSenderIds) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sid}))`;
        }

        // Read occupied slots inside the locked transaction
        const futureEmails = await tx.email.findMany({
          where: {
            senderId: { in: sortedSenderIds },
            plannedAt: { gte: startAt },
            status: { in: ["SCHEDULED", "PROCESSING"] }
          },
          select: { senderId: true, plannedAt: true },
          orderBy: { plannedAt: "asc" }
        });

        const occupied = new Map<string, number[]>();
        for (const fe of futureEmails) {
          if (!occupied.has(fe.senderId)) occupied.set(fe.senderId, []);
          occupied.get(fe.senderId)!.push(fe.plannedAt.getTime());
        }

        // Allocate slots
        const slots = allocate({
          startAt,
          delayMs,
          hourlyLimit,
          jitterPct,
          senders,
          occupied,
          count: validRecipients.length,
          seed: idempotencyKey || `${userId}:${startAt.toISOString()}`
        });

        const lastSlot = slots[slots.length - 1]!;

        // Create Campaign row
        const campaign = await tx.campaign.create({
          data: {
            userId,
            subject: input.subject,
            bodyTemplate: input.body,
            startAt,
            delayMs,
            hourlyLimit,
            total: validRecipients.length,
            idempotencyKey,
            plannedFinishAt: lastSlot.plannedAt
          }
        });

        // Prepare email rows and render templates
        const emailRows = [];
        const plannedEvents = [];

        for (let i = 0; i < validRecipients.length; i++) {
          const rec = validRecipients[i]!;
          const slot = slots[i]!;

          // Simple template rendering: replace {{var}} with vars[var]
          let renderedBody = input.body;
          if (rec.vars) {
            for (const [k, v] of Object.entries(rec.vars)) {
              renderedBody = renderedBody.replace(new RegExp(`{{${k}}}`, "g"), v);
            }
          }

          emailRows.push({
            campaignId: campaign.id,
            userId,
            senderId: slot.senderId,
            toEmail: rec.email,
            toName: rec.name || null,
            subject: input.subject,
            body: renderedBody,
            seq: slot.seq,
            plannedAt: slot.plannedAt,
            scheduledAt: slot.plannedAt,
            status: "SCHEDULED" as const
          });
        }

        // Chunked createMany for emails
        const CHUNK_SIZE = 500;
        const createdEmails = [];

        for (let i = 0; i < emailRows.length; i += CHUNK_SIZE) {
          const chunk = emailRows.slice(i, i + CHUNK_SIZE);
          await tx.email.createMany({
            data: chunk
          });
        }

        // Fetch inserted email IDs in seq order
        const inserted = await tx.email.findMany({
          where: { campaignId: campaign.id },
          select: { id: true, senderId: true, plannedAt: true, seq: true },
          orderBy: { seq: "asc" }
        });

        // Link attachments to campaign and inserted emails
        if (input.attachmentIds && input.attachmentIds.length > 0) {
          await tx.attachment.updateMany({
            where: { id: { in: input.attachmentIds }, userId },
            data: { campaignId: campaign.id }
          });

          // Also set emailId for the first email if single recipient
          if (inserted.length === 1 && inserted[0]) {
            await tx.attachment.updateMany({
              where: { id: { in: input.attachmentIds }, userId },
              data: { emailId: inserted[0].id }
            });
          }
        }

        // Insert PLANNED events
        for (const ins of inserted) {
          plannedEvents.push({
            emailId: ins.id,
            campaignId: campaign.id,
            senderId: ins.senderId,
            type: "PLANNED" as const,
            data: {
              plannedAt: ins.plannedAt.toISOString(),
              senderId: ins.senderId,
              jitterPct
            }
          });
        }

        for (let i = 0; i < plannedEvents.length; i += CHUNK_SIZE) {
          const chunk = plannedEvents.slice(i, i + CHUNK_SIZE);
          await tx.emailEvent.createMany({
            data: chunk
          });
        }

        return {
          campaign,
          insertedEmails: inserted
        };
      },
      { timeout: 30000 }
    );

    // 3. After transaction commits: enqueue to BullMQ with jobId = emailId
    const now = Date.now();
    const queueJobs = plannedResult.insertedEmails.map((e) => ({
      emailId: e.id,
      delayMs: Math.max(0, e.plannedAt.getTime() - now)
    }));

    await enqueueBulkEmailJobs(queueJobs);

    // Append ENQUEUED events
    const enqueuedEvents = plannedResult.insertedEmails.map((e) => ({
      emailId: e.id,
      campaignId: plannedResult.campaign.id,
      senderId: e.senderId,
      type: "ENQUEUED" as const,
      data: {
        delayMs: Math.max(0, e.plannedAt.getTime() - now)
      }
    }));

    for (let i = 0; i < enqueuedEvents.length; i += 500) {
      const chunk = enqueuedEvents.slice(i, i + 500);
      await prisma.emailEvent.createMany({
        data: chunk
      });
    }

    // Enqueue search indexing jobs asynchronously
    const indexJobs = plannedResult.insertedEmails.map((e) => ({
      name: "index-email",
      data: { emailId: e.id }
    }));
    searchIndexQueue.addBulk(indexJobs).catch(() => {});

    return {
      campaignId: plannedResult.campaign.id,
      accepted: plannedResult.insertedEmails.length,
      duplicatesRemoved,
      invalid,
      plannedFinishAt: plannedResult.campaign.plannedFinishAt
    };
  }
}
