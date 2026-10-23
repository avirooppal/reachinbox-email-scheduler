import { runAudit, formatAuditReport } from "../audit.js";
import { prisma } from "../../src/infra/prisma.js";

async function main() {
  console.log("=== DEMO: Invariant Auditor Report ===");

  const campaign = await prisma.campaign.findFirst({
    orderBy: { createdAt: "desc" }
  });

  if (!campaign) {
    console.log("No campaigns found. Running global audit...");
    const report = await runAudit();
    console.log(formatAuditReport(report));
  } else {
    console.log(`Auditing latest campaign ${campaign.subject} (${campaign.id})...`);
    const report = await runAudit(campaign.id);
    console.log(formatAuditReport(report));
  }

  await prisma.$disconnect();
}

main().catch(console.error);
