const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc23@gmail.com';
const PASSWORD = '12345678';
const TARGET_BRANCH = 'Kennedy [Clinica Pro]';
const OUT_DIR = path.join(process.cwd(), 'diagnostics', 'billing-oops');

async function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function safeClick(locator, label) {
  const count = await locator.count();
  if (count === 0) throw new Error(`Tidak menemukan elemen: ${label}`);
  await locator.first().click();
}

async function clickByTexts(page, texts, label) {
  for (const text of texts) {
    const locator = page.getByText(text, { exact: false });
    if (await locator.count()) {
      await locator.first().click();
      return text;
    }
  }
  throw new Error(`Tidak menemukan menu: ${label}`);
}

async function clickBranchDropdown(page) {
  // Viewport script dibuat 1440x900. Area ini adalah icon panah bawah pada tombol cabang biru.
  await page.mouse.click(1264, 58);
  await page.waitForTimeout(1000);
  if (await page.getByText(TARGET_BRANCH, { exact: false }).count()) return;

  const button = page.locator('button:has-text("Klinik"), [role="button"]:has-text("Klinik")').first();
  if (await button.count()) {
    const box = await button.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 18, box.y + box.height / 2);
      return;
    }
  }

  // Fallback untuk viewport 1440x900: icon panah bawah di sisi kanan tombol cabang biru.
  await page.mouse.click(1266, 58);
}

async function chooseBranch(page) {
  const branch = page.getByText(TARGET_BRANCH, { exact: false });
  if (await branch.count()) {
    await branch.first().click();
    return true;
  }

  const search = page.locator('input[type="search"]:visible, input[placeholder*="Cari"]:visible, input[placeholder*="Search"]:visible');
  if (await search.count()) {
    await search.first().fill(TARGET_BRANCH);
    await page.waitForTimeout(1000);
    const filteredBranch = page.getByText(TARGET_BRANCH, { exact: false });
    if (await filteredBranch.count()) {
      await filteredBranch.first().click();
      return true;
    }
  }

  return false;
}

async function openSettings(page) {
  const candidates = [
    page.getByText('Setting', { exact: false }),
    page.getByText('Settings', { exact: false }),
    page.locator('[href*="setting"], [href*="settings"]'),
    page.locator('[data-test*="setting"], [data-testid*="setting"]'),
  ];

  for (const locator of candidates) {
    if (await locator.count()) {
      await locator.first().click();
      return;
    }
  }

  await page.mouse.click(36, 812);
}

async function closeBlockingOverlays(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  for (const label of ['CLOSE', 'Close', 'Tutup']) {
    const close = page.getByText(label, { exact: true });
    if (await close.count()) {
      await close.first().click({ force: true });
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function waitForAppReady(page) {
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page
    .locator('.MuiCircularProgress-root, [role="progressbar"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
}

async function isFullscreenLoader(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return bodyText.trim().length === 0;
}

(async () => {
  await ensureDir(OUT_DIR);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    slowMo: 250,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });

  const page = await context.newPage();
  const events = {
    startedAt: new Date().toISOString(),
    console: [],
    pageErrors: [],
    failedRequests: [],
    suspiciousResponses: [],
    urls: [],
  };

  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      events.console.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    }
  });

  page.on('pageerror', (error) => {
    events.pageErrors.push({ message: error.message, stack: error.stack });
  });

  page.on('requestfailed', (request) => {
    events.failedRequests.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText,
    });
  });

  page.on('response', async (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 || /billing|invoice|subscription|setting|branch|clinic/i.test(url)) {
      let body = '';
      try {
        const contentType = response.headers()['content-type'] || '';
        if (/json|text|html/i.test(contentType)) body = (await response.text()).slice(0, 3000);
      } catch (_) {
        body = '<body unavailable>';
      }
      events.suspiciousResponses.push({
        status,
        method: response.request().method(),
        url,
        body,
      });
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    events.urls.push({ step: 'opened-login', url: page.url() });
    await screenshot(page, '01-login-page');

    await page.locator('input[name="username"]').first().fill(USERNAME);
    await page.locator('input[name="password"]').first().fill(PASSWORD);
    await screenshot(page, '02-login-filled');
    await page.locator('button[data-test="login-btn"]').first().click();

    await waitForAppReady(page);
    events.urls.push({ step: 'after-login', url: page.url() });
    await screenshot(page, '03-after-login');

    await clickBranchDropdown(page);
    await page.waitForTimeout(1000);
    await screenshot(page, '04-branch-dropdown');

    const branchSelected = await chooseBranch(page);
    if (!branchSelected) {
      events.branchWarning = `Cabang "${TARGET_BRANCH}" tidak ditemukan/ tidak terbuka dari dropdown. Script lanjut memakai cabang aktif di UI.`;
    }
    await closeBlockingOverlays(page);
    await waitForAppReady(page);
    if (await isFullscreenLoader(page)) {
      events.branchLoadWarning = 'Setelah pilih cabang Kennedy, aplikasi masih stuck di fullscreen loader. Script coba lanjut langsung ke /settings.';
      await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForAppReady(page);
    }
    events.urls.push({ step: 'after-branch-check', url: page.url() });
    await screenshot(page, '05-after-branch-check');

    if (!page.url().includes('/settings')) {
      await openSettings(page);
      await waitForAppReady(page);
      if (await isFullscreenLoader(page)) {
        events.settingsLoadWarning = 'Klik Setting menghasilkan fullscreen loader. Script coba buka /settings langsung.';
        await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitForAppReady(page);
      }
    }
    await closeBlockingOverlays(page);
    events.urls.push({ step: 'settings', url: page.url() });
    await screenshot(page, '06-settings');

    await closeBlockingOverlays(page);
    await clickByTexts(page, ['Billing', 'Tagihan', 'Pembayaran'], 'Billing');
    await waitForAppReady(page);
    await closeBlockingOverlays(page);
    events.urls.push({ step: 'billing', url: page.url() });
    await screenshot(page, '07-billing');

    const visibleText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    events.visibleOops = /oops|something went wrong|terjadi kesalahan/i.test(visibleText);
    events.visibleTextSnippet = visibleText.slice(0, 3000);
  } catch (error) {
    events.scriptError = { message: error.message, stack: error.stack };
    await screenshot(page, '99-script-error').catch(() => {});
  } finally {
    events.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT_DIR, 'diagnosis.json'), JSON.stringify(events, null, 2));
    await context.close();
    await browser.close();
  }
})();
