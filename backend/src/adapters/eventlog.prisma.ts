import { Prisma, PrismaClient } from "@prisma/client";
import { EventLog, EventRecord } from "../core/ports.js";
import { prisma as defaultPrisma } from "../infra/prisma.js";

type PrismaTx = Prisma.TransactionClient;

export class PrismaEventLogAdapter implements EventLog {
  async append(tx: unknown, event: EventRecord): Promise<void> {
    const client = (tx as PrismaTx) || defaultPrisma;

    await client.emailEvent.create({
      data: {
        emailId: event.emailId,
        campaignId: event.campaignId,
        senderId: event.senderId,
        type: event.type,
        at: event.at || new Date(),
        data: event.data as Prisma.InputJsonValue
      }
    });
  }
}

export const eventLog = new PrismaEventLogAdapter();
