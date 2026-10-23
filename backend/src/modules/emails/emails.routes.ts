import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../infra/prisma.js";
import { generateTimelineSummary, StoredEvent } from "./ledger.helper.js";

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

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
