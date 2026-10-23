import { Transport, SendMailParams, SendMailResult } from "../core/ports.js";

export type FaultMode = "normal" | "smtp_down" | "slow" | "flaky";

export interface FaultConfig {
  mode: FaultMode;
  rate?: number; // 0.0 to 1.0 (failure rate)
  latencyMs?: number;
}

/**
 * FAULT-INJECTION SMTP TRANSPORT
 * Simulates transient SMTP 421/451 errors, severe latency, and total outages for chaos engineering.
 */
export class FaultyTransport implements Transport {
  private static senderFaults = new Map<string, FaultConfig>();

  public static setFault(senderId: string, config: FaultConfig) {
    this.senderFaults.set(senderId, config);
  }

  public static clearFault(senderId: string) {
    this.senderFaults.delete(senderId);
  }

  public static clearAllFaults() {
    this.senderFaults.clear();
  }

  constructor(private senderId: string) {}

  async send(params: SendMailParams): Promise<SendMailResult> {
    const fault = FaultyTransport.senderFaults.get(this.senderId) || { mode: "normal" };

    if (fault.mode === "smtp_down") {
      const err = new Error("421 4.3.0 Service not available, closing transmission channel");
      (err as unknown as { responseCode: number }).responseCode = 421;
      throw err;
    }

    if (fault.mode === "slow" && fault.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, fault.latencyMs));
    }

    if (fault.mode === "flaky") {
      const failureRate = fault.rate ?? 0.5;
      if (Math.random() < failureRate) {
        const err = new Error("451 4.4.0 Temporary local problem, please try again later");
        (err as unknown as { responseCode: number }).responseCode = 451;
        throw err;
      }
    }

    return {
      messageId: params.messageId,
      previewUrl: `https://preview.fault-tolerant.io/${encodeURIComponent(params.messageId)}`
    };
  }
}
