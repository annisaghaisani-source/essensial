const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const outDir = path.resolve(__dirname, '..', 'diagnostics', 'data-entry-import-video');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1498, height: 838 },
    recordVideo: { dir: outDir, size: { width: 1498, height: 838 } },
  });
  const page = await context.newPage();

  async function stable() {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await page.goto('https://dev-essensial.assist.id/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').fill('anisasecondacc23@gmail.com');
  await page.locator('input[name="password"]').fill('12345678');
  await page.locator('button[data-test="login-btn"]').click();
  await stable();

  if (!(await page.locator('body').innerText()).includes('Kennedy [Clinica Pro]')) {
    await page.locator('[data-test="change-account-button-arrow"]').click({ force: true });
    await page.getByText('001532 - Kennedy [Clinica Pro]', { exact: false }).click({ force: true });
    await stable();
  }

  await page.goto('https://dev-essensial.assist.id/settings', { waitUntil: 'domcontentloaded' });
  await stable();
  await page.getByText('CLOSE', { exact: true }).click({ force: true }).catch(() => {});
  await page.getByRole('button', { name: /^Data Entry$/i }).click({ force: true });
  await stable();

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const labelButton = buttons.find((button) => /Import Data Pasien/i.test(button.innerText || button.textContent || ''));
    let row = labelButton?.parentElement;
    while (row && row.querySelectorAll('button').length < 2) row = row.parentElement;
    const rowButtons = row ? Array.from(row.querySelectorAll('button')) : [];
    (rowButtons[rowButtons.length - 1] || labelButton)?.click();
  });
  await page.getByText('Import Data Pasien', { exact: true }).last().click({ force: true });
  await stable();
  await page.waitForTimeout(4000);

  const video = page.video();
  await context.close();
  await browser.close();
  console.log(await video.path());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
