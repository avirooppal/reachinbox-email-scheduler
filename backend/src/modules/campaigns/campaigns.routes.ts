import { Router, Request, Response } from "express";
import multer from "multer";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { CampaignsService, RecipientInput } from "./campaigns.service.js";
import { prisma } from "../../infra/prisma.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

const scheduleCampaignSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  startAt: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: "startAt must be a valid ISO date"
    })
    .optional(),
  senderId: z.string().optional(),
  delayMs: z.coerce.number().min(0).optional(),
  hourlyLimit: z.coerce.number().min(1).optional(),
  jitterPct: z.coerce.number().min(0).max(100).optional(),
  attachmentIds: z.array(z.string()).optional(),
  recipients: z
    .array(
      z.object({
        email: z.string(),
        name: z.string().optional(),
        vars: z.record(z.string()).optional()
      })
    )
    .optional()
});

/**
 * Helper to parse recipients either from JSON or uploaded CSV file.
 */
function parseRecipients(req: Request): RecipientInput[] {
  if (req.file) {
    const csvContent = req.file.buffer.toString("utf8");
    const records = parseCsv(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[];

    return records.map((record) => {
      // Look for 'email' or 'Email' column
      const email = record.email || record.Email || record.EMAIL || Object.values(record)[0] || "";
      const name = record.name || record.Name || record.NAME || record["Full Name"] || record.Recipient;
      const { email: _e, Email: _E, EMAIL: _EM, name: _n, Name: _N, ...vars } = record;
      return {
        email,
        name: name ? String(name).trim() : undefined,
        vars: {
          ...vars,
          ...(name ? { name: String(name).trim() } : {})
        }
      };
    });
  }

  return (req.body?.recipients as RecipientInput[]) || [];
}

/**
 * Preview campaign finish time, slot distribution, and warnings.
 */
campaignsRouter.post("/preview", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const recipients = parseRecipients(req);
    const parsed = scheduleCampaignSchema.safeParse({
      ...req.body,
      recipients
    });

    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
    }

    const preview = await CampaignsService.previewCampaign(req.user!.id, {
      ...parsed.data,
      recipients
    });

    return res.status(200).json(preview);
  } catch (err) {
    req.log.error({ err }, "Campaign preview failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Schedule a new campaign.
 */
campaignsRouter.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const recipients = parseRecipients(req);
    const parsed = scheduleCampaignSchema.safeParse({
      ...req.body,
      recipients
    });

    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
    }

    const idempotencyKey = (req.headers["idempotency-key"] as string) || null;

    const result = await CampaignsService.scheduleCampaign(
      req.user!.id,
      {
        ...parsed.data,
        recipients
      },
      idempotencyKey
    );

    return res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Campaign schedule failed");
    return res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * List campaigns for authenticated user.
 */
campaignsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { emails: true }
        }
      }
    });

    return res.status(200).json({ campaigns });
  } catch (err) {
    req.log.error({ err }, "List campaigns failed");
    return res.status(500).json({ error: "Failed to list campaigns" });
  }
});

/**
 * Get specific campaign by ID.
 */
campaignsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
      include: {
        _count: {
          select: { emails: true }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    return res.status(200).json({ campaign });
  } catch (err) {
    req.log.error({ err }, "Get campaign failed");
    return res.status(500).json({ error: "Failed to retrieve campaign" });
  }
});
