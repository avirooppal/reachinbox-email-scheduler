import { prisma } from "./infra/prisma.js";
import { SendersService } from "./modules/senders/senders.service.js";
import { logger } from "./config/logger.js";
import { hashPassword } from "./utils/password.js";

async function main() {
  logger.info("Starting seed process...");

  const defaultPasswordHash = hashPassword("password123");

  // Create demo user
  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: {
      passwordHash: defaultPasswordHash
    },
    create: {
      googleId: "google_demo_user_id",
      email: "demo@example.com",
      passwordHash: defaultPasswordHash,
      name: "Oliver Brown",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces"
    }
  });

  // Also create Oliver Brown matching the Figma design screenshots
  const oliverUser = await prisma.user.upsert({
    where: { email: "oliver.brown@domain.io" },
    update: {
      passwordHash: defaultPasswordHash
    },
    create: {
      googleId: "google_oliver_brown_id",
      email: "oliver.brown@domain.io",
      passwordHash: defaultPasswordHash,
      name: "Oliver Brown",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces"
    }
  });

  logger.info({ userId: user.id, oliverId: oliverUser.id }, "Users ensured");

  // Check existing senders for both users
  for (const u of [user, oliverUser]) {
    const existingSenders = await prisma.sender.findMany({
      where: { userId: u.id }
    });

    if (existingSenders.length < 3) {
      const toCreate = 3 - existingSenders.length;
      logger.info({ userId: u.id, toCreate }, "Creating Ethereal SMTP test senders...");

      for (let i = 1; i <= toCreate; i++) {
        const sender = await SendersService.createEtherealSender(
          u.id,
          `${u.name.split(" ")[0]} Outreach ${existingSenders.length + i}`
        );
        logger.info({ senderId: sender.id, fromEmail: sender.fromEmail }, "Ethereal sender created");
      }
    }
  }

  // Seed demo campaigns and emails if none exist
  for (const u of [oliverUser, user]) {
    const emailCount = await prisma.email.count({ where: { userId: u.id } });
    if (emailCount === 0) {
      const senders = await prisma.sender.findMany({ where: { userId: u.id } });
      const sender = senders[0]!;

      // 1. Create Campaign for Scheduled Emails
      const scheduledCampaign = await prisma.campaign.create({
        data: {
          userId: u.id,
          subject: "Q4 Strategy & Partnerships Outreach",
          bodyTemplate: "Hi {{name}}, exploring synergies with your team this quarter.",
          startAt: new Date(Date.now() + 86400000),
          delayMs: 2000,
          hourlyLimit: 200,
          total: 12
        }
      });

      const names = [
        "John Smith", "Emma Watson", "Michael Chang", "Jessica Alba",
        "David Beckham", "Rachel Green", "Harvey Specter", "Donna Paulsen",
        "Mike Ross", "Louis Litt", "Jessica Pearson", "Robert Zane"
      ];

      for (let i = 0; i < 12; i++) {
        const planned = new Date(Date.now() + 86400000 + i * 180000);
        await prisma.email.create({
          data: {
            campaignId: scheduledCampaign.id,
            userId: u.id,
            senderId: sender.id,
            toEmail: `contact${i + 1}@enterprise.com`,
            toName: names[i],
            subject: i === 0 ? "Quarterly Strategy Sync & Proposal" : `Partnership Brief #${100 + i}`,
            body: `Hi ${names[i]}, looking forward to our quarterly sync. Here is the agenda and slide deck for your team.`,
            seq: i,
            plannedAt: planned,
            scheduledAt: planned,
            status: "SCHEDULED",
            isStarred: i % 4 === 0
          }
        });
      }

      // 2. Create Sent Emails including the detail email from 06-email-detail.png
      const sentCampaign = await prisma.campaign.create({
        data: {
          userId: u.id,
          subject: "Oliver, hello there! | MJWYT44 BM#52W01",
          bodyTemplate: "Hey Oliver, You've just RECEIVED something",
          startAt: new Date(Date.now() - 86400000 * 3),
          delayMs: 2000,
          hourlyLimit: 200,
          total: 5
        }
      });

      const detailHtml = `<p>Hey Oliver,</p>
<p>You've just RECEIVED something</p>
<div style="background-color: #FEF9C3; border-left: 4px solid #F59E0B; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
  <p style="margin: 0; font-weight: bold; color: #111827;">⚡ Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment ⚡</p>
  <p style="margin: 4px 0 0 0; color: #374151;">⚡ To explore securing your private transformation, simply reply right now with <strong>"FLY OUT FIX"</strong> .</p>
</div>
<p>Your coach for world-class performance,</p>
<p>Grant</p>
<p><em>P.S. Always remember that you can develop world class technique! 🚀</em></p>`;

      const detailEmail = await prisma.email.create({
        data: {
          campaignId: sentCampaign.id,
          userId: u.id,
          senderId: sender.id,
          toEmail: u.email,
          toName: "Oliver Brown",
          subject: "Oliver, hello there! | MJWYT44 BM#52W01",
          body: detailHtml,
          seq: 0,
          plannedAt: new Date(Date.now() - 86400000 * 2),
          scheduledAt: new Date(Date.now() - 86400000 * 2),
          sentAt: new Date(Date.now() - 86400000 * 2 + 1000),
          status: "SENT",
          isStarred: true,
          messageId: `<mjwyt44-${u.id}@domain.io>`
        }
      });

      // Attachments for detail email
      await prisma.attachment.createMany({
        data: [
          {
            userId: u.id,
            emailId: detailEmail.id,
            campaignId: sentCampaign.id,
            filename: "Tennis_Coach_Profile.png",
            mimeType: "image/png",
            sizeBytes: 1200000,
            storagePath: "uploads/tennis_coach.png"
          },
          {
            userId: u.id,
            emailId: detailEmail.id,
            campaignId: sentCampaign.id,
            filename: "Tennis_Coach_Profile2.png",
            mimeType: "image/png",
            sizeBytes: 1200000,
            storagePath: "uploads/tennis_coach.png"
          }
        ]
      });

      // Add a few more sent emails
      const sentRecipients = [
        { name: "Sarah Connor", email: "sarah@sky.net", sub: "Annual Infrastructure Assessment", failed: false },
        { name: "David Lee", email: "david.lee@techcorp.io", sub: "Product Roadmap Update & Next Steps", failed: false },
        { name: "Alex Ferguson", email: "alex@manutd.com", sub: "Coaching Framework Overview", failed: false },
        { name: "Invalid Host", email: "bounced@nonexistent.domain", sub: "Automated Dispatch Notice", failed: true }
      ];

      for (let j = 0; j < sentRecipients.length; j++) {
        const item = sentRecipients[j]!;
        await prisma.email.create({
          data: {
            campaignId: sentCampaign.id,
            userId: u.id,
            senderId: sender.id,
            toEmail: item.email,
            toName: item.name,
            subject: item.sub,
            body: `Hello ${item.name}, thank you for reviewing the attached materials. Let us know if you have any questions.`,
            seq: j + 1,
            plannedAt: new Date(Date.now() - 86400000 * (j + 1)),
            scheduledAt: new Date(Date.now() - 86400000 * (j + 1)),
            sentAt: item.failed ? null : new Date(Date.now() - 86400000 * (j + 1) + 1200),
            status: item.failed ? "FAILED" : "SENT",
            lastError: item.failed ? "SMTP 550: Host unreachable" : null,
            isStarred: j === 1
          }
        });
      }
    }
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
