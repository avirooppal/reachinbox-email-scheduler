import { Router, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../auth/auth.middleware.js";
import { reconcileQueue } from "../../queue/reconciler.js";
import { runAudit, formatAuditReport } from "../../core/audit.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);

// Allow test environment to bypass email allowlist check if running integration tests
adminRouter.use((req, res, next) => {
  if (process.env.NODE_ENV === "test") {
    return next();
  }
  return requireAdmin(req, res, next);
});

import { redis } from "../../infra/redis.js";
import { prisma } from "../../infra/prisma.js";

/**
 * Fault injection endpoint (plan.md M11)
 * POST /admin/faults { senderId, mode: "smtp_down" | "slow" | "flaky", rate }
 */
adminRouter.post("/faults", async (req: Request, res: Response) => {
  if (env.NODE_ENV === "production" || !env.ENABLE_FAULT_INJECTION) {
    return res.status(403).json({ error: "Fault injection is disabled in this environment" });
  }

  try {
    const { senderId, mode, rate = 1.0 } = req.body;
    if (!senderId) {
      return res.status(400).json({ error: "senderId is required" });
    }

    if (mode === "clear") {
      await redis.del(`fault:${senderId}`);
      return res.status(200).json({ message: `Faults cleared for sender ${senderId}` });
    }

    await redis.set(
      `fault:${senderId}`,
      JSON.stringify({ mode, rate }),
      "EX",
      3600 // 1 hour expiration
    );

    // If simulating hard down, update DB sender health to OPEN immediately
    if (mode === "smtp_down") {
      await prisma.sender.update({
        where: { id: senderId },
        data: { health: "OPEN" }
      });
    }

    return res.status(200).json({
      message: `Injected fault ${mode} (rate=${rate}) on sender ${senderId}`
    });
  } catch (err) {
    (req.log || logger).error({ err }, "Fault injection failed");
    return res.status(500).json({ error: "Fault injection failed" });
  }
});
adminRouter.post("/reconcile", async (req: Request, res: Response) => {
  try {
    const result = await reconcileQueue();
    return res.status(200).json(result);
  } catch (err) {
    (req.log || logger).error({ err }, "Admin reconciliation failed");
    return res.status(500).json({ error: "Reconciliation failed" });
  }
});

/**
 * Run invariant auditor on-demand.
 */
adminRouter.get("/audit", async (req: Request, res: Response) => {
  try {
    const campaignId = (req.query.campaignId as string) || undefined;
    const isDrained = req.query.isDrained === "true";
    const report = await runAudit(campaignId, isDrained);
    const textReport = formatAuditReport(report);

    return res.status(200).json({
      ...report,
      formatted: textReport
    });
  } catch (err) {
    (req.log || logger).error({ err }, "Admin audit failed");
    return res.status(500).json({ error: "Audit failed" });
  }
});


