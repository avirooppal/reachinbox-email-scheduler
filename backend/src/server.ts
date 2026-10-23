import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { logger, createChildLogger } from "./config/logger.js";
import { prisma } from "./infra/prisma.js";
import { redis } from "./infra/redis.js";
import { esClient } from "./infra/elasticsearch.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { sendersRouter } from "./modules/senders/senders.routes.js";
import { emailsRouter } from "./modules/emails/emails.routes.js";
import { campaignsRouter } from "./modules/campaigns/campaigns.routes.js";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Mount routes
app.use("/auth", authRouter);
app.use("/api/senders", sendersRouter);
app.use("/api/emails", emailsRouter);
app.use("/api/campaigns", campaignsRouter);




// Request correlation ID and logger middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  res.setHeader("x-request-id", requestId);
  req.log = createChildLogger({ requestId });
  req.requestId = requestId;
  next();
});

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
