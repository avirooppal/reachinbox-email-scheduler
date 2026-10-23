import { prisma } from "../../src/infra/prisma.js";
import { CampaignsService } from "../../src/modules/campaigns/campaigns.service.js";

async function main() {
  console.log("=== DEMO: Schedule Campaign ===");

  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found. Run npm run seed first.");

  const senders = await prisma.sender.findMany({ where: { userId: user.id } });
  console.log(`Using ${senders.length} active senders for user ${user.email}`);

  const startAt = new Date(Date.now() + 5000); // 5s from now
  const result = await CampaignsService.schedule(user.id, {
    subject: "Demo Campaign Announcement",
    body: "Hello {{name}}, welcome to the production demonstration of Outbox!",
    startAt,
    delayMs: 2000,
    hourlyLimit: 60,
    recipients: [
      { email: "lead_1@client.io", vars: { name: "Alice" } },
      { email: "lead_2@client.io", vars: { name: "Bob" } },
      { email: "lead_3@client.io", vars: { name: "Charlie" } }
    ]
  });

  console.log("Campaign successfully scheduled:", result);
  await prisma.$disconnect();
}

main().catch(console.error);
