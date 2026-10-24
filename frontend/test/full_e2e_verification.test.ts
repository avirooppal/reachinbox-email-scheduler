import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import fs from "fs";
import path from "path";

describe("Full End-to-End Component and Flow Verification", () => {
  let browser: Browser;
  let page: Page;
  const testEmail = `live_tester_${Date.now()}@domain.io`;
  const testPassword = "Password123!";

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    page = await context.newPage();
  }, 20000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it("1. Sign up new account from UI", async () => {
    await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
    expect(await page.title()).toContain("Outbox");

    // Click toggle to switch to registration
    await page.getByText("Don't have an account? Sign up").click();
    await page.waitForTimeout(300);

    await page.fill('input[placeholder="Full Name"]', "Live Verification User");
    await page.fill('input[placeholder="Email ID"]', testEmail);
    await page.fill('input[placeholder="Password"]', testPassword);

    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await page.waitForURL("**/scheduled", { timeout: 10000 });
    expect(page.url()).toContain("/scheduled");

    // Verify user card in sidebar
    await page.waitForSelector('text="Live Verification User"');
    expect(await page.locator('text="Live Verification User"').count()).toBeGreaterThan(0);
  });

  it("2. Logout and login with valid/invalid credentials", async () => {
    // Open user menu dropdown
    await page.click('button:has-text("Live Verification User")');
    await page.waitForTimeout(300);

    // Click Sign out
    await page.click('text="Sign out"');
    await page.waitForURL("**/login", { timeout: 10000 });
    expect(page.url()).toContain("/login");

    // Test invalid password
    await page.fill('input[placeholder="Email ID"]', testEmail);
    await page.fill('input[placeholder="Password"]', "wrongpassword");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/login");

    // Test valid password
    await page.fill('input[placeholder="Password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/scheduled", { timeout: 10000 });
    expect(page.url()).toContain("/scheduled");
  });

  it("3. Compose and schedule email with recipient chips, CSV, attachments & TipTap", async () => {
    // Click Compose button
    await page.click('a[href="/compose"]');
    await page.waitForURL("**/compose", { timeout: 10000 });

    // 1. Add Ethereal sender on the fly
    await page.click('button:has-text("Auto (rotate across all senders)")');
    await page.waitForTimeout(300);
    await page.click('text="+ Add Ethereal sender"');
    await page.waitForTimeout(1500);

    // 2. Add recipient chips
    const recipientInput = page.locator('[data-testid="recipient-input"]');
    await recipientInput.fill("alice@partner.com");
    await recipientInput.press("Enter");
    await page.waitForTimeout(200);

    await recipientInput.fill("bob@partner.com");
    await recipientInput.press("Enter");
    await page.waitForTimeout(200);

    // Check that 2 chips exist
    expect(await page.locator('text="alice@partner.com"').count()).toBe(1);
    expect(await page.locator('text="bob@partner.com"').count()).toBe(1);

    // 3. Add more recipients to test +N popover
    await recipientInput.fill("charlie@partner.com");
    await recipientInput.press("Enter");
    await recipientInput.fill("david@partner.com");
    await recipientInput.press("Enter");
    await recipientInput.fill("eva@partner.com");
    await recipientInput.press("Enter");

    // +2 chip should be visible
    const overflowChip = page.locator('button:has-text("+2")');
    expect(await overflowChip.count()).toBe(1);

    // Click +2 chip to inspect popover
    await overflowChip.click();
    await page.waitForTimeout(300);
    expect(await page.locator('text="All Recipients (5)"').count()).toBe(1);
    await page.keyboard.press("Escape");

    // 4. Set Subject
    await page.fill('input[placeholder="Subject"]', "Live Verified System Outreach");

    // 5. Fill body in TipTap Rich Text Editor
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await editor.fill("Hello team, this is a live end-to-end verified email delivery message.");

    // Test Bold button
    await editor.selectText();
    await page.click('button[title="Bold"]');
    await page.waitForTimeout(200);

    // 6. Test File Attachment
    const sampleFile = path.resolve(process.cwd(), "test/sample_attachment.txt");
    fs.writeFileSync(sampleFile, "E2E sample attachment verification payload");
    const fileInput = page.locator('input[type="file"][multiple]');
    await fileInput.setInputFiles(sampleFile);
    await page.waitForTimeout(1000);

    // Verify attachment preview card appeared
    expect(await page.locator('text="sample_attachment.txt"').count()).toBeGreaterThan(0);

    // 7. Click Send (Immediate queueing)
    await page.click('button:has-text("Send")');

    // Should redirect to /sent or /scheduled
    await page.waitForURL(/\/(scheduled|sent)/, { timeout: 15000 });
    await page.waitForTimeout(1000);
  }, 40000);

  it("4. Verify email in list, toggle star, search and open detail view", async () => {
    // Navigate to Scheduled
    await page.goto("http://localhost:5173/scheduled", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Search bar functionality
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill("Live Verified");
    await page.waitForTimeout(500);

    const matchRow = page.locator('text="Live Verified System Outreach"').first();
    expect(await matchRow.count()).toBeGreaterThan(0);

    // Click star icon
    const starBtn = page.locator('button[title="Star"]').first();
    await starBtn.click();
    await page.waitForTimeout(500);

    // Open email detail view
    await matchRow.click();
    await page.waitForURL("**/emails/**", { timeout: 10000 });
    expect(page.url()).toContain("/emails/");

    // Verify detail elements
    expect(await page.locator('text="Live Verified System Outreach"').count()).toBeGreaterThan(0);
    expect(await page.locator('text="sample_attachment.txt"').count()).toBeGreaterThan(0);

    // Click "to " popover
    await page.click('button:has-text("to ")');
    await page.waitForTimeout(300);
    expect(await page.locator('text="From:"').count()).toBeGreaterThan(0);

    // Expand delivery timeline & audit ledger
    await page.click('button:has-text("Inspect History")');
    await page.waitForTimeout(1000);
    expect(await page.locator('text="PLANNED"').count()).toBeGreaterThan(0);
  }, 30000);
});
