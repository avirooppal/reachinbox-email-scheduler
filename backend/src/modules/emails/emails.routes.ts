import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../infra/prisma.js";
import { esClient, EMAIL_INDEX_NAME } from "../../infra/elasticsearch.js";
import { generateTimelineSummary, StoredEvent } from "./ledger.helper.js";

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

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
 * List emails for dashboard with filtering and pagination (plan.md M14)
 * GET /api/emails?status=scheduled|sent|failed&page=&limit=
 */
emailsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      status,
      senderId,
      campaignId,
      page = "1",
      limit = "20"
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { userId };
    if (status) where.status = status.toUpperCase();
    if (senderId) where.senderId = senderId;
    if (campaignId) where.campaignId = campaignId;

    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { plannedAt: "asc" },
        include: {
          sender: { select: { name: true, fromEmail: true } },
          campaign: { select: { subject: true } }
        }
      })
    ]);

    return res.status(200).json({
      emails,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    req.log.error({ err }, "List emails error");
    return res.status(500).json({ error: "Failed to list emails" });
  }
});

/**
 * Get single email details.
 */
emailsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
      include: {
        campaign: { select: { id: true, subject: true } },
        sender: { select: { id: true, name: true, fromEmail: true } }
      }
    });

    if (!email) {
      return res.status(404).json({ error: "Email not found" });
    }

    return res.status(200).json({ email });
  } catch (err) {
    req.log.error({ err }, "Get email error");
    return res.status(500).json({ error: "Failed to retrieve email" });
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
