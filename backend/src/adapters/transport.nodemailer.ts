import nodemailer, { Transporter } from "nodemailer";
import { Transport, SendMailParams, SendMailResult } from "../core/ports.js";
import { logger } from "../config/logger.js";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export class NodemailerTransportAdapter implements Transport {
  private static pools = new Map<string, Transporter>();

  /**
   * Gets or creates a pooled nodemailer Transporter for a sender.
   */
  public static getTransporter(senderId: string, config: SmtpConfig): Transporter {
    let pool = this.pools.get(senderId);
    if (!pool) {
      pool = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        auth: {
          user: config.user,
          pass: config.pass
        }
      });
      this.pools.set(senderId, pool);
    }
    return pool;
  }

  /**
   * Verifies SMTP connection credentials.
   */
  public static async verifyConfig(config: SmtpConfig): Promise<boolean> {
    const tempTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000
    });

    try {
      await tempTransport.verify();
      return true;
    } finally {
      tempTransport.close();
    }
  }

  constructor(private senderId: string, private config: SmtpConfig) {}

  async send(params: SendMailParams): Promise<SendMailResult> {
    const transporter = NodemailerTransportAdapter.getTransporter(this.senderId, this.config);

    const isHtml = params.html || params.body.includes("<");
    const mailOptions: nodemailer.SendMailOptions = {
      from: params.from,
      to: params.to,
      subject: params.subject,
      text: params.body.replace(/<[^>]+>/g, " ").trim() || params.body,
      headers: {
        "Message-ID": params.messageId
      }
    };

    if (isHtml) {
      mailOptions.html = params.html || params.body;
    }

    if (params.attachments && params.attachments.length > 0) {
      mailOptions.attachments = params.attachments.map((att) => ({
        filename: att.filename,
        path: att.path,
        content: att.content,
        contentType: att.contentType
      }));
    }

    const info = await transporter.sendMail(mailOptions);

    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

    return {
      messageId: params.messageId,
      previewUrl: previewUrl ? String(previewUrl) : undefined
    };
  }
}
