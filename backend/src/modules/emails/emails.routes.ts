import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../infra/prisma.js";
import { esClient, EMAIL_INDEX_NAME } from "../../infra/elasticsearch.js";
import { generateTimelineSummary, StoredEvent } from "./ledger.helper.js";
import { removeEmailJob } from "../../adapters/queue.bullmq.js";
import { eventLog } from "../../adapters/eventlog.prisma.js";

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

/**
 * Strip HTML tags to produce a clean plain-text snippet.
 */
function toSnippet(body: string, maxLen = 120): string {
  if (!body) return "";
  const plain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen).trim()}...`;
}

/**
 * Counts endpoint for sidebar badge metrics.
 * GET /api/emails/counts
 */
emailsRouter.get("/counts", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const [scheduled, sent] = await Promise.all([
      prisma.email.count({
        where: { userId, status: "SCHEDULED", deletedAt: null }
      }),
      prisma.email.count({
        where: { userId, status: "SENT", deletedAt: null }
      })
    ]);

    return res.status(200).json({ scheduled, sent });
  } catch (err) {
    req.log?.error?.({ err }, "Email counts error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to retrieve email counts" });
  }
});

/**
 * Full-text search endpoint powered by Elasticsearch (plan.md M12)
 * GET /api/emails/search?q=&status=&senderId=&from=&to=&page=&limit=
 */
emailsRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      q,
      status,
      senderId,
      from,
      to,
      page = "1",
      limit = "20"
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const fromOffset = (pageNum - 1) * limitNum;

    const mustFilters: any[] = [{ term: { userId } }];

    if (status) {
      mustFilters.push({ term: { status } });
    }
    if (senderId) {
      mustFilters.push({ term: { senderId } });
    }
    if (from || to) {
      const rangeFilter: any = {};
      if (from) rangeFilter.gte = from;
      if (to) rangeFilter.lte = to;
      mustFilters.push({ range: { plannedAt: rangeFilter } });
    }

    let searchQuery: any;
    if (q && q.trim().length > 0) {
      searchQuery = {
        bool: {
          must: [
            ...mustFilters,
            {
              multi_match: {
                query: q,
                fields: ["subject^2", "body", "toEmail"],
                fuzziness: "AUTO"
              }
            }
          ]
        }
      };
    } else {
      searchQuery = {
        bool: {
          must: mustFilters
        }
      };
    }

    const esResponse = await esClient.search({
      index: EMAIL_INDEX_NAME,
      from: fromOffset,
      size: limitNum,
      query: searchQuery,
      highlight: {
        fields: {
          subject: {},
          body: {}
        }
      }
    });

    const total =
      typeof esResponse.hits.total === "number"
        ? esResponse.hits.total
        : esResponse.hits.total?.value || 0;

    const emails = esResponse.hits.hits.map((hit: any) => ({
      ...hit._source,
      highlights: hit.highlight || {}
    }));

    return res.status(200).json({
      emails,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err: any) {
    req.log.error({ err }, "Elasticsearch query error");
    return res.status(500).json({ error: "Failed to search emails" });
  }
});

/**
 * List emails for dashboard with filtering, search, and pagination.
 * GET /api/emails?status=scheduled|sent|failed&starred=true&q=&page=&limit=
 */
emailsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      status,
      senderId,
      campaignId,
      starred,
      archived,
      q,
      page = "1",
      limit = "20"
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId,
      deletedAt: null
    };

    if (status) {
      const upper = status.toUpperCase();
      if (upper === "SCHEDULED") {
        where.status = "SCHEDULED";
      } else if (upper === "SENT") {
        where.status = "SENT";
      } else if (upper === "FAILED") {
        where.status = "FAILED";
      } else {
        where.status = upper;
      }
    }

    if (starred === "true") where.isStarred = true;
    if (starred === "false") where.isStarred = false;

    if (archived === "true") where.isArchived = true;
    else if (archived === "false" || !archived) where.isArchived = false;

    if (senderId) where.senderId = senderId;
    if (campaignId) where.campaignId = campaignId;

    if (q && q.trim().length > 0) {
      const term = q.trim();
      where.OR = [
        { subject: { contains: term, mode: "insensitive" } },
        { body: { contains: term, mode: "insensitive" } },
        { toEmail: { contains: term, mode: "insensitive" } },
        { toName: { contains: term, mode: "insensitive" } }
      ];
    }

    const isSentView = status && status.toLowerCase() === "sent";
    const orderBy = isSentView
      ? [{ sentAt: "desc" as const }, { plannedAt: "desc" as const }]
      : [{ plannedAt: "asc" as const }];

    const [total, rawEmails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        skip,
        take: limitNum,
        orderBy,
        include: {
          sender: { select: { id: true, name: true, fromEmail: true } },
          campaign: { select: { id: true, subject: true } },
          attachments: { select: { id: true, filename: true, sizeBytes: true, mimeType: true } }
        }
      })
    ]);

    const emails = rawEmails.map((e) => ({
      ...e,
      snippet: toSnippet(e.body),
      attachmentCount: e.attachments.length
    }));

    return res.status(200).json({
      emails,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    req.log?.error?.({ err }, "List emails error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to list emails" });
  }
});

/**
 * Get single email details.
 */
emailsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id, deletedAt: null },
      include: {
        campaign: {
          select: {
            id: true,
            subject: true,
            attachments: true
          }
        },
        sender: { select: { id: true, name: true, fromEmail: true } },
        attachments: true
      }
    });

    if (!email) {
      return res.status(404).json({ error: "Email not found" });
    }

    // Merge email-level attachments with campaign-level attachments
    const campaignAttachments = email.campaign?.attachments || [];
    const allAttachments = [
      ...email.attachments,
      ...campaignAttachments.filter((ca) => !email.attachments.some((ea) => ea.id === ca.id))
    ];

    return res.status(200).json({
      email: {
        ...email,
        attachments: allAttachments,
        snippet: toSnippet(email.body)
      }
    });
  } catch (err) {
    req.log?.error?.({ err }, "Get email error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to retrieve email" });
  }
});

/**
 * Toggle starred or archived flag.
 * PATCH /api/emails/:id
 */
emailsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { isStarred, isArchived } = req.body as { isStarred?: boolean; isArchived?: boolean };
    const email = await prisma.email.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id, deletedAt: null }
    });

    if (!email) {
      return res.status(404).json({ error: "Email not found" });
    }

    const updated = await prisma.email.update({
      where: { id: email.id },
      data: {
        ...(typeof isStarred === "boolean" ? { isStarred } : {}),
        ...(typeof isArchived === "boolean" ? { isArchived } : {})
      },
      include: {
        sender: { select: { id: true, name: true, fromEmail: true } },
        attachments: true
      }
    });

    return res.status(200).json({ email: updated });
  } catch (err) {
    req.log?.error?.({ err }, "Patch email error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to update email" });
  }
});

/**
 * Delete / Cancel email.
 * Scheduled -> CANCELLED (removed from BullMQ queue, CANCELLED event appended)
 * Sent / Failed -> Soft deleted (deletedAt set)
 * DELETE /api/emails/:id
 */
emailsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id, deletedAt: null }
    });

    if (!email) {
      return res.status(404).json({ error: "Email not found" });
    }

    if (email.status === "SCHEDULED") {
      // 1. Remove BullMQ scheduled job
      await removeEmailJob(email.id);

      // 2. Mark CANCELLED and log event
      await prisma.$transaction(async (tx) => {
        await tx.email.update({
          where: { id: email.id },
          data: { status: "CANCELLED" }
        });

        await eventLog.append(tx, {
          emailId: email.id,
          campaignId: email.campaignId,
          senderId: email.senderId,
          type: "CANCELLED",
          data: { cancelledAt: new Date().toISOString(), reason: "User cancelled" }
        });
      });

      return res.status(200).json({ status: "CANCELLED", message: "Scheduled email cancelled" });
    } else {
      // Sent / Failed / Cancelled -> soft-delete
      await prisma.email.update({
        where: { id: email.id },
        data: { deletedAt: new Date(), isArchived: true }
      });

      return res.status(200).json({ status: "DELETED", message: "Email deleted" });
    }
  } catch (err) {
    req.log?.error?.({ err }, "Delete email error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to delete email" });
  }
});

/**
 * Get email timeline with append-only ledger events and plain-English summary.
 */
emailsRouter.get("/:id/timeline", async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id }
    });

    if (!email) {
      return res.status(404).json({ error: "Email not found" });
    }

    const rawEvents = await prisma.emailEvent.findMany({
      where: { emailId: email.id },
      orderBy: { id: "asc" }
    });

    const events: StoredEvent[] = rawEvents.map((e) => ({
      id: e.id.toString(),
      emailId: e.emailId,
      type: e.type,
      at: e.at,
      data: (e.data as Record<string, unknown>) || {}
    }));

    const summary = generateTimelineSummary(events);

    return res.status(200).json({
      emailId: email.id,
      summary,
      events
    });
  } catch (err) {
    req.log.error({ err }, "Get email timeline error");
    return res.status(500).json({ error: "Failed to retrieve email timeline" });
  }
});
