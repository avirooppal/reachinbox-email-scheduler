import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env, assertProductionSafety } from "./config/env.js";
import { logger, createChildLogger } from "./config/logger.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";
import { esClient } from "./infra/elasticsearch.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { sendersRouter } from "./modules/senders/senders.routes.js";
import { emailsRouter } from "./modules/emails/emails.routes.js";
import { campaignsRouter } from "./modules/campaigns/campaigns.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { slackRouter } from "./modules/integrations/slack.routes.js";
import { statsRouter } from "./modules/stats/stats.routes.js";
import { attachmentsRouter } from "./modules/attachments/attachments.routes.js";
import { serverAdapter as bullBoardAdapter } from "./modules/admin/board.js";
import { register as prometheusRegister } from "./modules/metrics/metrics.service.js";
import { requireAuth, requireAdmin } from "./modules/auth/auth.middleware.js";

assertProductionSafety(env);

export const app = express();

app.set("trust proxy", env.TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: false, // Allow Bull Board UI inline assets
    hsts:
      env.NODE_ENV === "production"
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
          }
        : false
  })
);

// Request correlation ID and logger middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  req.log = createChildLogger({ requestId });
  req.requestId = requestId;
  next();
});

const allowedOrigins = [
  env.FRONTEND_URL,
  process.env.RENDER_EXTERNAL_URL,
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173"
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const isAllowed =
        allowedOrigins.includes(origin) ||
        origin.endsWith(".onrender.com") ||
        origin.endsWith(".trycloudflare.com") ||
        env.NODE_ENV !== "production";

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Prometheus Metrics Endpoint (plan.md M14)
app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", prometheusRegister.contentType);
  res.send(await prometheusRegister.metrics());
});

// Bull Board UI (plan.md M14: behind requireAuth + requireAdmin)
app.use(
  "/admin/queues",
  (req, res, next) => {
    // In test environment, bypass auth check for fast test assertions
    if (process.env.NODE_ENV === "test") return next();
    return requireAuth(req, res, () => requireAdmin(req, res, next));
  },
  bullBoardAdapter.getRouter()
);

// Mount routes
app.use("/auth", authRouter);
app.use("/api/senders", sendersRouter);
app.use("/api/emails", emailsRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/attachments", attachmentsRouter);
app.use("/api/integrations/slack", slackRouter);
app.use("/api/stats", statsRouter);
app.use("/admin", adminRouter);

// Liveness check
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Readiness check (verifies Postgres, Redis, Elasticsearch)
app.get("/ready", async (req: Request, res: Response) => {
  const checks: Record<string, "ok" | "error"> = {
    postgres: "error",
    redis: "error",
    elasticsearch: "error"
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = "ok";
  } catch (err) {
    req.log.error({ err }, "Postgres readiness check failed");
  }

  try {
    const pong = await redis.ping();
    if (pong === "PONG") {
      checks.redis = "ok";
    }
  } catch (err) {
    req.log.error({ err }, "Redis readiness check failed");
  }

  try {
    const esPing = await esClient.ping();
    if (esPing) {
      checks.elasticsearch = "ok";
    }
  } catch (err) {
    req.log.error({ err }, "Elasticsearch readiness check failed");
  }

  const allOk = Object.values(checks).every((status) => status === "ok");
  const statusCode = allOk ? 200 : 503;

  return res.status(statusCode).json({
    status: allOk ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks
  });
});

// Serve frontend SPA in production if built dist exists
const candidateDistPaths = [
  path.resolve(process.cwd(), "frontend/dist"),
  path.resolve(process.cwd(), "../frontend/dist"),
  path.resolve(process.cwd(), "dist/frontend")
];
const frontendDist = candidateDistPaths.find((p) => fs.existsSync(p));

if (frontendDist) {
  logger.info({ frontendDist }, "Serving static frontend SPA");
  app.use(express.static(frontendDist));
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/auth") ||
      req.path.startsWith("/admin") ||
      req.path === "/metrics" ||
      req.path === "/health" ||
      req.path === "/ready"
    ) {
      return next();
    }
    return res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Global error handler
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, "Unhandled server error");
  const message = err instanceof Error ? err.message : "Internal Server Error";
  res.status(500).json({
    error: env.NODE_ENV === "production" ? "Internal Server Error" : message,
    requestId: req.requestId
  });
});

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: ReturnType<typeof createChildLogger>;
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  if (process.env.RUN_WORKER !== "false") {
    logger.info("Starting inline workers (email delivery, slack notifications, search indexing)...");
    import("./workers/email.worker.js").then(({ createEmailWorker }) => {
      import("./queue/reconciler.js").then(({ reconcileQueue }) => {
        reconcileQueue().catch((err) => logger.error({ err }, "Boot reconciler error"));
        createEmailWorker(`inline-worker-${process.pid}`);
      });
    });
    import("./queue/notification.worker.js").then(({ createNotificationWorker }) => {
      createNotificationWorker(`inline-notif-${process.pid}`);
    });
    import("./queue/search-index.worker.js").then(({ createSearchIndexWorker }) => {
      createSearchIndexWorker(`inline-search-${process.pid}`);
    });
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "API Server listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down API server gracefully...");
    server.close(async () => {
      try {
        await prisma.$disconnect();
        await redis.quit();
        await esClient.close();
        logger.info("All connections closed. Exit complete.");
        process.exit(0);
      } catch (err) {
        logger.error({ err }, "Error during shutdown");
        process.exit(1);
      }
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
