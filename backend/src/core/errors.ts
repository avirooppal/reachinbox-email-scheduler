export class DelayedRescheduleError extends Error {
  constructor(public retryAt: number, public reason: "RATE_LIMIT" | "MIN_GAP" | "SENDER_OPEN") {
    super(`Job rescheduled to ${new Date(retryAt).toISOString()} due to ${reason}`);
    this.name = "DelayedRescheduleError";
  }
}

export interface ErrorClassification {
  isTransient: boolean;
  code?: string | number;
  message: string;
}

/**
 * Classifies SMTP and network errors into transient (retryable) vs permanent (non-retryable).
 * Transient: 4xx codes, connection timeouts, network disconnects.
 * Permanent: 5xx codes, invalid mailbox, authentication rejected.
 */
export function classifySmtpError(error: unknown): ErrorClassification {
  if (!error) {
    return { isTransient: false, message: "Unknown error" };
  }

  const err = error as {
    responseCode?: number;
    code?: string | number;
    message?: string;
  };

  const responseCode = err.responseCode ? Number(err.responseCode) : undefined;
  const code = String(err.code || "");
  const message = err.message || String(error);

  // SMTP 4xx = Transient error (mail server busy, rate exceeded, temporary greylisting)
  if (responseCode && responseCode >= 400 && responseCode < 500) {
    return { isTransient: true, code: responseCode, message };
  }

  // Common transient network errors
  const transientCodes = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ESOCKETTIMEDOUT"];
  if (transientCodes.includes(code)) {
    return { isTransient: true, code, message };
  }

  // SMTP 5xx = Permanent rejection (user unknown, invalid domain, syntax error)
  if (responseCode && responseCode >= 500 && responseCode < 600) {
    return { isTransient: false, code: responseCode, message };
  }

  // Default: unclassified errors with network/timeout keywords treated as transient
  if (/timeout|temporar|try again|rate limit|busy/i.test(message)) {
    return { isTransient: true, code, message };
  }

  return { isTransient: false, code, message };
}
