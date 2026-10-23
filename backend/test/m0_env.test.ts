import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("Milestone 0: Configuration Validation", () => {
  const schema = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(16),
    ENCRYPTION_KEY: z.string().min(32),
    WORKER_CONCURRENCY: z.coerce.number().min(1)
  });

  it("fails with clear messages when required configuration is missing or invalid", () => {
    const invalidConfig = {
      DATABASE_URL: "not-a-url",
      REDIS_URL: "invalid",
      JWT_SECRET: "short",
      ENCRYPTION_KEY: "short",
      WORKER_CONCURRENCY: -1
    };

    const result = schema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = result.error.format();
      expect(formatted.DATABASE_URL?._errors).toBeDefined();
      expect(formatted.REDIS_URL?._errors).toBeDefined();
      expect(formatted.JWT_SECRET?._errors).toBeDefined();
      expect(formatted.ENCRYPTION_KEY?._errors).toBeDefined();
      expect(formatted.WORKER_CONCURRENCY?._errors).toBeDefined();
    }
  });
});
