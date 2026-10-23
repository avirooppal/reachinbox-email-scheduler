import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { SendersService } from "./senders.service.js";
import { logger } from "../../config/logger.js";

export const sendersRouter = Router();

sendersRouter.use(requireAuth);

const createSenderSchema = z.object({
  name: z.string().min(1, "Name is required"),
  fromEmail: z.string().email("Invalid fromEmail address"),
  smtpHost: z.string().min(1, "SMTP Host is required"),
  smtpPort: z.coerce.number().min(1).max(65535),
  smtpUser: z.string().min(1, "SMTP User is required"),
  smtpPass: z.string().min(1, "SMTP Pass is required"),
  hourlyLimit: z.coerce.number().min(1).optional(),
  minDelayMs: z.coerce.number().min(0).optional()
});

const updateSenderSchema = z.object({
  name: z.string().min(1).optional(),
  hourlyLimit: z.coerce.number().min(1).nullable().optional(),
  minDelayMs: z.coerce.number().min(0).nullable().optional(),
  isActive: z.boolean().optional()
});

/**
 * List all senders for authenticated user.
 */
sendersRouter.get("/", async (req: Request, res: Response) => {
  try {
    const senders = await SendersService.listUserSenders(req.user!.id);
    return res.status(200).json({ senders });
  } catch (err) {
    (req.log || logger).error({ err }, "Failed to list senders");
    return res.status(500).json({ error: "Failed to list senders" });
  }
});

/**
 * Create custom SMTP sender.
 */
sendersRouter.post("/", async (req: Request, res: Response) => {
  const parseResult = createSenderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parseResult.error.format()
    });
  }

  try {
    const sender = await SendersService.createCustomSender(req.user!.id, parseResult.data);
    return res.status(201).json({ sender });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create sender";
    (req.log || logger).error({ err }, "Create sender failed");
    return res.status(400).json({ error: message });
  }
});

/**
 * Auto-generate and register an Ethereal test account sender.
 */
sendersRouter.post("/ethereal", async (req: Request, res: Response) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : undefined;
    const sender = await SendersService.createEtherealSender(req.user!.id, name);
    return res.status(201).json({ sender });
  } catch (err) {
    (req.log || logger).error({ err }, "Create Ethereal sender failed");
    return res.status(500).json({ error: "Failed to create Ethereal test account" });
  }
});


/**
 * Update sender config / status.
 */
sendersRouter.patch("/:id", async (req: Request, res: Response) => {
  const parseResult = updateSenderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: parseResult.error.format()
    });
  }

  try {
    const updated = await SendersService.updateSender(req.user!.id, req.params.id as string, parseResult.data);
    return res.status(200).json({ sender: updated });
  } catch (err) {
    return res.status(404).json({ error: (err as Error).message });
  }
});

/**
 * Delete a sender.
 */
sendersRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const result = await SendersService.deleteSender(req.user!.id, req.params.id as string);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(404).json({ error: (err as Error).message });
  }
});
