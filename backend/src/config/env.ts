import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

// Load .env explicitly
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });

const envSchema = z.object({
  // Infrastructure
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid redis connection URL"),
  ELASTICSEARCH_URL: z.string().url("ELASTICSEARCH_URL must be a valid URL"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Worker & Scheduler Configuration
  WORKER_CONCURRENCY: z.coerce.number().min(1).default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().min(1).default(200),
  MAX_EMAILS_PER_HOUR_GLOBAL: z.coerce.number().min(0).default(0),
  RATE_LIMIT_MODE: z.enum(["fixed", "sliding"]).default("fixed"),
  JITTER_PCT: z.coerce.number().min(0).max(100).default(15),

  // Job retry & timeout
  JOB_ATTEMPTS: z.coerce.number().min(1).default(3),
  JOB_BACKOFF_MS: z.coerce.number().min(0).default(5000),
  STALE_PROCESSING_MS: z.coerce.number().min(1000).default(120000),

  // Circuit breaker
  BREAKER_FAILURES: z.coerce.number().min(1).default(5),
  BREAKER_WINDOW_MS: z.coerce.number().min(1000).default(60000),
  BREAKER_COOLDOWN_MS: z.coerce.number().min(1000).default(120000),
  ENABLE_FAULT_INJECTION: z.coerce.boolean().default(false),

  // Security
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters (AES-256)"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_EMAILS: z
    .string()
    .transform((val) => val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
    .default(""),

  // OAuth Integrations
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4000/auth/google/callback"),
  SLACK_CLIENT_ID: z.string().default(""),
  SLACK_CLIENT_SECRET: z.string().default(""),
  SLACK_REDIRECT_URI: z.string().default("http://localhost:4000/api/integrations/slack/callback")
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("FATAL: Environment configuration validation failed:");
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
