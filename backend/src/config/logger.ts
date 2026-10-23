import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname"
          }
        }
      : undefined,
  base: {
    env: env.NODE_ENV
  }
});

export interface LogContext {
  requestId?: string;
  jobId?: string;
  emailId?: string;
  senderId?: string;
  campaignId?: string;
  userId?: string;
}

export function createChildLogger(context: LogContext) {
  return logger.child(context);
}
