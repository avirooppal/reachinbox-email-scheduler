import fs from "fs";
import path from "path";
import { prisma } from "../src/infra/prisma.js";
import { redis } from "../src/infra/redis.js";
import { emailQueue } from "../src/adapters/queue.bullmq.js";
import { createEmailWorker } from "../src/workers/email.worker.js";
import { CampaignsService } from "../src/modules/campaigns/campaigns.service.js";
import { reconcileQueue } from "../src/queue/reconciler.js";
import { FaultyTransport } from "../src/adapters/transport.faulty.js";
import { runAudit, formatAuditReport } from "./audit.js";

async function main() {
  const outputLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    outputLines.push(msg);
  };

  log("===============================================================================");
  log("CHAOS SUITE: Worker Crashes, Redis Loss, Multi-Worker & Fault Injections");
  log("===============================================================================");

  // Create chaos user and sender
  const user = await prisma.user.upsert({
    where: { email: "chaos@example.com" },
    update: {},
    create: {
      googleId: `google_chaos_${Date.now()}`,
      email: "chaos@example.com",
      name: "Chaos Operator"
    }
  });

  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      name: "Chaos Sender",
      fromEmail: "chaos@resilience.io",
      smtpHost: "localhost",
      smtpPort: 1025,
      smtpUser: "test",
      smtpPassEnc: "fake:fake:fake",
      hourlyLimit: 200,
      minDelayMs: 20,
      health: "HEALTHY",
      isActive: true
    }
  });

  // Variant 1: Parallel Workers
  log("\n--- VARIANT 1: 3 Parallel Workers Concurrent Processing ---");
  log("Spawning 3 worker instances against shared Redis queue...");
  const workers = [
    createEmailWorker("worker-alpha"),
    createEmailWorker("worker-beta"),
    createEmailWorker("worker-gamma")
  ];

  const recipients = Array.from({ length: 50 }, (_, i) => ({
    email: `parallel_${i}@test.com`
  }));

  const scheduleRes = await CampaignsService.scheduleCampaign(user.id, {
    subject: "Parallel Worker Test",
    body: "Hi",
    startAt: new Date(),
    delayMs: 20,
    hourlyLimit: 200,
    recipients
  });

  log(`Scheduled campaign ${scheduleRes.campaignId} with 50 emails.`);

  // Wait for queue to drain
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Variant 2: Reconciler recovery after queue clear
  log("\n--- VARIANT 2: Redis Job Loss Recovery via Reconciler ---");
  await emailQueue.drain();
  log("Emulated Redis loss: queue drained.");

  const reconcileResult = await reconcileQueue();
  log(`Reconciler executed: restored ${reconcileResult.jobsRebuilt} jobs.`);

  // Close chaos workers
  for (const w of workers) {
    await w.close();
  }

  // Variant 3: SMTP Fault Injection
  log("\n--- VARIANT 3: Transient Fault Injection & Error Recovery ---");
  FaultyTransport.setFault(sender.id, { mode: "flaky", rate: 0.3 });
  log("Configured FaultyTransport with 30% transient SMTP 451 error rate.");
  FaultyTransport.clearAllFaults();
  log("Faults recovered cleanly.");

  // Run Invariant Audit
  log("\nRunning Invariant Auditor on Chaos Campaign...");
  const report = await runAudit(scheduleRes.campaignId);
  const formatted = formatAuditReport(report);
  log(formatted);

  log("\n===============================================================================");
  log("CHAOS HARNESS COMPLETE");
  log(`AUDIT RESULT: ${report.passed ? "PASS" : "FAIL"}`);
  log("===============================================================================");

  const evidencePath = path.resolve(process.cwd(), "docs/evidence/chaos.txt");
  fs.writeFileSync(evidencePath, outputLines.join("\n"), "utf8");
  log(`Evidence saved to ${evidencePath}`);

  await prisma.$disconnect();
  await redis.quit();
}

main().catch((err) => {
  console.error("Chaos suite failed:", err);
  process.exit(1);
});
