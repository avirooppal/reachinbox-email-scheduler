import nodemailer from "nodemailer";
import { prisma } from "../../infra/prisma.js";
import { encrypt } from "../../utils/crypto.js";
import { NodemailerTransportAdapter, SmtpConfig } from "../../adapters/transport.nodemailer.js";

export interface CreateSenderInput {
  name: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  hourlyLimit?: number;
  minDelayMs?: number;
}

export interface UpdateSenderInput {
  name?: string;
  hourlyLimit?: number | null;
  minDelayMs?: number | null;
  isActive?: boolean;
}

export class SendersService {
  /**
   * Lists all senders belonging to the user.
   */
  static async listUserSenders(userId: string) {
    const senders = await prisma.sender.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    return senders.map(({ smtpPassEnc, ...safeProps }) => ({
      ...safeProps,
      hasPassword: Boolean(smtpPassEnc)
    }));
  }

  /**
   * Retrieves a sender by ID, ensuring ownership.
   */
  static async getUserSender(userId: string, senderId: string) {
    const sender = await prisma.sender.findFirst({
      where: { id: senderId, userId }
    });

    if (!sender) return null;

    const { smtpPassEnc, ...safeProps } = sender;
    return {
      ...safeProps,
      hasPassword: Boolean(smtpPassEnc)
    };
  }

  /**
   * Verifies SMTP credentials and creates a sender in DB.
   */
  static async createCustomSender(userId: string, input: CreateSenderInput) {
    const config: SmtpConfig = {
      host: input.smtpHost,
      port: input.smtpPort,
      user: input.smtpUser,
      pass: input.smtpPass
    };

    // Verify SMTP connection
    try {
      await NodemailerTransportAdapter.verifyConfig(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`SMTP verification failed: ${msg}`);
    }

    const encryptedPass = encrypt(input.smtpPass);

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: input.name,
        fromEmail: input.fromEmail,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        smtpUser: input.smtpUser,
        smtpPassEnc: encryptedPass,
        hourlyLimit: input.hourlyLimit,
        minDelayMs: input.minDelayMs,
        health: "HEALTHY",
        isActive: true
      }
    });

    const { smtpPassEnc, ...safeProps } = sender;
    return safeProps;
  }

  /**
   * Programmatically creates an Ethereal SMTP test sender.
   */
  static async createEtherealSender(userId: string, name?: string) {
    const testAccount = await nodemailer.createTestAccount();

    const senderName = name || `Ethereal Sender (${testAccount.user.split("@")[0]})`;

    const encryptedPass = encrypt(testAccount.pass);

    const sender = await prisma.sender.create({
      data: {
        userId,
        name: senderName,
        fromEmail: testAccount.user,
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUser: testAccount.user,
        smtpPassEnc: encryptedPass,
        health: "HEALTHY",
        isActive: true
      }
    });

    const { smtpPassEnc, ...safeProps } = sender;
    return safeProps;
  }

  /**
   * Updates an existing sender.
   */
  static async updateSender(userId: string, senderId: string, input: UpdateSenderInput) {
    const existing = await prisma.sender.findFirst({
      where: { id: senderId, userId }
    });

    if (!existing) {
      throw new Error("Sender not found");
    }

    const updated = await prisma.sender.update({
      where: { id: senderId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.hourlyLimit !== undefined && { hourlyLimit: input.hourlyLimit }),
        ...(input.minDelayMs !== undefined && { minDelayMs: input.minDelayMs }),
        ...(input.isActive !== undefined && { isActive: input.isActive })
      }
    });

    const { smtpPassEnc, ...safeProps } = updated;
    return safeProps;
  }

  /**
   * Deletes a sender.
   */
  static async deleteSender(userId: string, senderId: string) {
    const existing = await prisma.sender.findFirst({
      where: { id: senderId, userId }
    });

    if (!existing) {
      throw new Error("Sender not found");
    }

    await prisma.sender.delete({
      where: { id: senderId }
    });

    return { status: "deleted", senderId };
  }
}
