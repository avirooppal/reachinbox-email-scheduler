import { prisma } from "./infra/prisma.js";
import { SendersService } from "./modules/senders/senders.service.js";
import { logger } from "./config/logger.js";

async function main() {
  logger.info("Starting seed process...");

  // Create demo user
  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      googleId: "google_demo_user_id",
      email: "demo@example.com",
      name: "Demo User",
      avatarUrl: "https://lh3.googleusercontent.com/a/default-user"
    }
  });

  logger.info({ userId: user.id }, "Demo user ensured");

  // Check existing senders
  const existingSenders = await prisma.sender.findMany({
    where: { userId: user.id }
  });

  if (existingSenders.length >= 3) {
    logger.info({ count: existingSenders.length }, "Senders already exist. Skipping seed.");
    return;
  }

  const toCreate = 3 - existingSenders.length;
  logger.info({ toCreate }, "Creating Ethereal SMTP test senders...");

  for (let i = 1; i <= toCreate; i++) {
    const sender = await SendersService.createEtherealSender(
      user.id,
      `Primary Outreach ${existingSenders.length + i}`
    );
    logger.info({ senderId: sender.id, fromEmail: sender.fromEmail }, "Ethereal sender created");
  }

  logger.info("Seed completed successfully!");
}

main()
  .catch((err) => {
    logger.error({ err }, "Seed script failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
