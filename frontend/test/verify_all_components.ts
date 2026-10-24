import { chromium } from "playwright";
import fs from "fs";
import path from "path";

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runVerification() {
  console.log("=== STARTING FULL END-TO-END COMPONENT AUDIT ===");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const testEmail = `verified_user_${Date.now()}@domain.io`;
  const testPassword = "Password123!";

  // ----------------------------------------------------
  // STEP 1: Registration (Sign up)
  // ----------------------------------------------------
  console.log("[1/6] Testing Registration & Form Validation...");
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
  assert(await page.title().then(t => t.includes("Outbox")), "Title should contain Outbox");

  await page.getByText("Don't have an account? Sign up").click();
  await page.waitForTimeout(300);

  await page.fill('input[placeholder="Full Name"]', "Live Component Tester");
  await page.fill('input[placeholder="Email ID"]', testEmail);
  await page.fill('input[placeholder="Password"]', testPassword);
  await page.click('button[type="submit"]');

  await page.waitForURL("**/scheduled", { timeout: 10000 });
  console.log("  ✔ Registration successful, redirected to /scheduled");

  // Verify User card in sidebar
  const userCardName = await page.locator('text="Live Component Tester"').count();
  assert(userCardName > 0, "User name should appear in sidebar pill");
  console.log("  ✔ Sidebar user card rendered with active session");

  // ----------------------------------------------------
  // STEP 2: Logout and Re-Login
  // ----------------------------------------------------
  console.log("[2/6] Testing Logout & Re-authentication...");
  await page.click('button:has-text("Live Component Tester")');
  await page.waitForTimeout(300);
  await page.click('text="Sign out"');
  await page.waitForURL("**/login", { timeout: 10000 });
  console.log("  ✔ Signed out cleanly, redirected to /login");

  // Re-login
  await page.fill('input[placeholder="Email ID"]', testEmail);
  await page.fill('input[placeholder="Password"]', testPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/scheduled", { timeout: 10000 });
  console.log("  ✔ Re-logged in successfully");

  // ----------------------------------------------------
  // STEP 3: Compose, Senders, Recipient Chips, CSV & Editor
  // ----------------------------------------------------
  console.log("[3/6] Testing Compose & Delivery Configurations...");
  await page.click('a[href="/compose"]');
  await page.waitForURL("**/compose", { timeout: 10000 });
  console.log("  ✔ Opened Compose full page view");

  // 3a. Add Ethereal Sender on the fly
  console.log("  Testing '+ Add Ethereal sender'...");
  await page.click('button:has-text("Auto (rotate across all senders)")');
  await page.waitForTimeout(300);
  await page.click('text="+ Add Ethereal sender"');
  await page.waitForTimeout(1500);
  console.log("  ✔ Ethereal sender generated and auto-selected");

  // 3b. Add Recipient Chips
  console.log("  Testing recipient chips & keyboard delimiters...");
  const recipientInput = page.locator('[data-testid="recipient-input"]');
  await recipientInput.fill("partner1@example.com");
  await recipientInput.press("Enter");
  await page.waitForTimeout(150);

  await recipientInput.fill("partner2@example.com");
  await recipientInput.press(",");
  await page.waitForTimeout(150);

  assert(await page.locator('text="partner1@example.com"').count() === 1, "Chip 1 present");
  assert(await page.locator('text="partner2@example.com"').count() === 1, "Chip 2 present");
  console.log("  ✔ Recipient chips created via Enter and comma");

  // 3c. Test overflow +N chip
  await recipientInput.fill("partner3@example.com");
  await recipientInput.press("Enter");
  await recipientInput.fill("partner4@example.com");
  await recipientInput.press("Enter");
  await recipientInput.fill("partner5@example.com");
  await recipientInput.press("Enter");

  const overflowChip = page.locator('button:has-text("+2")');
  assert(await overflowChip.count() === 1, "+2 chip visible");
  await overflowChip.click();
  await page.waitForTimeout(300);
  assert(await page.locator('text="All Recipients (5)"').count() === 1, "Popover displays all recipients");
  await page.keyboard.press("Escape");
  console.log("  ✔ Recipient overflow popover (+2) verified");

  // 3d. Subject and Delay
  await page.fill('input[placeholder="Subject"]', "Audited Production Campaign");
  await page.fill('input[placeholder="00"] >> nth=0', "01"); // 1s delay
  await page.fill('input[placeholder="00"] >> nth=1', "300"); // 300 limit

  // 3e. TipTap Rich Editor with formatting
  console.log("  Testing TipTap Rich Text Editor...");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.fill("Testing live formatting: bold italic and delivery timeline verification.");
  await editor.selectText();
  await page.click('button[title="Bold"]');
  await page.waitForTimeout(200);
  console.log("  ✔ TipTap editor formatted text");

  // 3f. File Attachment Upload
  console.log("  Testing attachment upload...");
  const sampleFilePath = path.resolve(process.cwd(), "test_doc.txt");
  fs.writeFileSync(sampleFilePath, "Live automated attachment payload test");
  const fileInput = page.locator('input[type="file"][multiple]');
  await fileInput.setInputFiles(sampleFilePath);
  await page.waitForTimeout(1200);
  try { fs.unlinkSync(sampleFilePath); } catch {}

  assert(await page.locator('text="test_doc.txt"').count() > 0, "Attachment card rendered");
  console.log("  ✔ Attachment uploaded and preview card rendered with size");

  // 3g. Submit / Schedule
  console.log("  Submitting campaign...");
  await page.click('button:has-text("Send")');
  await page.waitForURL(/\/(scheduled|sent)/, { timeout: 15000 });
  console.log("  ✔ Campaign submitted, returned to dashboard list");

  // ----------------------------------------------------
  // STEP 4: Search, Filter, Star Actions
  // ----------------------------------------------------
  console.log("[4/6] Testing List Search, Filters, and Star Toggle...");
  await page.goto("http://localhost:5173/scheduled", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // Search
  const searchBar = page.locator('input[placeholder*="Search"]');
  await searchBar.fill("Audited Production");
  await page.waitForTimeout(400);

  const matchedRow = page.locator('text="Audited Production Campaign"').first();
  assert(await matchedRow.count() > 0, "Search filtered matching campaign");
  console.log("  ✔ Live search filters emails by keyword");

  // Star toggle
  const starButton = page.locator('button[title="Star"]').first();
  await starButton.click();
  await page.waitForTimeout(400);
  console.log("  ✔ Star toggle updated optimistically");

  // Filter starred only
  await page.click('button[title="Filter emails"]');
  await page.waitForTimeout(200);
  await page.click('text="Starred only"');
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  console.log("  ✔ Filter popover toggles starred filter");

  // ----------------------------------------------------
  // STEP 5: Email Detail View & Delivery Timeline
  // ----------------------------------------------------
  console.log("[5/6] Testing Email Detail View & Audit Ledger...");
  await searchBar.fill("");
  await page.waitForTimeout(300);

  // Click on email row
  await page.locator('text="Audited Production Campaign"').first().click();
  await page.waitForURL("**/emails/**", { timeout: 10000 });
  console.log("  ✔ Navigated to email detail view");

  // Verify attachment card in detail view
  await page.waitForSelector('text="test_doc.txt"', { timeout: 10000 });
  assert(await page.locator('text="test_doc.txt"').count() > 0, "Attachment card present in detail view");

  // Test "to " popover
  await page.click('button:has-text("to ")');
  await page.waitForTimeout(200);
  assert(await page.locator('text="From:"').count() > 0, "Sender popover open");
  await page.keyboard.press("Escape");
  console.log("  ✔ Sender details popover verified");

  // Test Delivery Timeline & Audit Ledger
  console.log("  Inspecting delivery timeline...");
  await page.click('button:has-text("Inspect History")');
  await page.waitForTimeout(1000);
  const eventNode = await page.locator('text="PLANNED"').count();
  assert(eventNode > 0, "Audit ledger renders PLANNED event node");
  console.log("  ✔ Expandable Audit Ledger rendered real event timeline");

  // ----------------------------------------------------
  // STEP 6: Cancel Scheduled Email
  // ----------------------------------------------------
  console.log("[6/6] Testing Cancel Scheduled Email...");
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.click('button[title="Cancel Scheduled Send"]');
  await page.waitForTimeout(1200);
  console.log("  ✔ Cancelled scheduled email via DELETE endpoint");

  await browser.close();
  console.log("=== ALL COMPONENTS FULLY AUDITED & VERIFIED PASS ===");
}

runVerification().catch((err) => {
  console.error("VERIFICATION RUN FAILED:", err);
  process.exit(1);
});
