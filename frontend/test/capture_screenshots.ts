import { chromium } from "playwright";
import path from "path";
import fs from "fs";

async function main() {
  const evidenceDir = path.resolve(process.cwd(), "../docs/frontend-evidence");
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log("1. Capturing 01-login.png...");
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(evidenceDir, "01-login.png") });

  console.log("Logging in...");
  await page.fill('input[type="email"]', "oliver.brown@domain.io");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');

  await page.waitForURL("**/scheduled", { timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log("2. Capturing 02-scheduled.png...");
  await page.screenshot({ path: path.join(evidenceDir, "02-scheduled.png") });

  console.log("3. Capturing 04-sent.png...");
  await page.click('a[href="/sent"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, "04-sent.png") });

  console.log("4. Capturing 06-email-detail.png...");
  await page.getByText("Oliver, hello there!").first().click();
  await page.waitForURL("**/emails/**", { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, "06-email-detail.png") });

  console.log("5. Capturing 07-compose-recipients.png...");
  await page.goto("http://localhost:5173/compose", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // Add 7 recipients to trigger +4 badge
  const toInput = page.locator('[data-testid="recipient-input"]');
  const emailsToAdd = [
    "tame@jmail.com",
    "lame@jmail.com",
    "dame@jmail.com",
    "john@domain.io",
    "anna@domain.io",
    "bill@domain.io",
    "claire@domain.io"
  ];

  for (const em of emailsToAdd) {
    await toInput.fill(em);
    await toInput.press("Enter");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(evidenceDir, "07-compose-recipients.png") });

  console.log("6. Capturing 05-compose-attachment.png...");
  const sampleImagePath = path.resolve(process.cwd(), "../backend/uploads/tennis_coach.png");
  if (fs.existsSync(sampleImagePath)) {
    const fileInput = page.locator('input[type="file"][multiple]');
    await fileInput.setInputFiles(sampleImagePath);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(evidenceDir, "05-compose-attachment.png") });

  console.log("7. Capturing 03-compose-send-later.png...");
  await page.click('button[title="Send Later"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(evidenceDir, "03-compose-send-later.png") });

  console.log("All screenshots captured successfully at 1440x900!");
  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot capture error:", err);
  process.exit(1);
});
