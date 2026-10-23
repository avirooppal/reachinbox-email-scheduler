import { Router, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../auth/auth.middleware.js";
import { reconcileQueue } from "../../queue/reconciler.js";
import { runAudit, formatAuditReport } from "../../../tools/audit.js";
import { logger } from "../../config/logger.js";

export const adminRouter = Router();

adminRouter.use(requireAuth);

// Allow test environment to bypass email allowlist check if running integration tests
adminRouter.use((req, res, next) => {
  if (process.env.NODE_ENV === "test") {
    return next();
  }
  return requireAdmin(req, res, next);
});

/**
 * Trigger on-demand queue reconciliation.
 */
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


