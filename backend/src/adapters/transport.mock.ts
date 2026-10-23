import { Transport, SendMailParams, SendMailResult } from "../core/ports.js";

/**
 * IN-MEMORY MOCK TRANSPORT
 * Instant delivery simulation with message tracking.
 */
export class MockTransport implements Transport {
  public sentMessages: SendMailParams[] = [];

  async send(params: SendMailParams): Promise<SendMailResult> {
    this.sentMessages.push(params);
    return {
      messageId: params.messageId,
      previewUrl: `https://mock.ethereal.email/${encodeURIComponent(params.messageId)}`
    };
  }

  reset(): void {
    this.sentMessages = [];
  }
}

export const mockTransport = new MockTransport();
