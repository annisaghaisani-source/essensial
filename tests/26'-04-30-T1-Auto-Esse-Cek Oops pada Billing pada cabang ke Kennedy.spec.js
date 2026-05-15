const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc23@gmail.com';
const PASSWORD = '12345678';
const BRANCH_NAME = 'Kennedy [Clinica Pro]';

test.describe('Essensial - Login, Switch Branch, Open Billing', () => {
  test('login sampai submenu Billing', async ({ page }, testInfo) => {
    const diagnostics = {
      urls: [],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      capturedResponses: [],
      notes: [],
    };

    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) {
        diagnostics.consoleErrors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location(),
        });
      }
    });

    page.on('pageerror', (error) => {
      diagnostics.pageErrors.push({
        message: error.message,
        stack: error.stack,
      });
    });

    page.on('requestfailed', (request) => {
      diagnostics.failedRequests.push({
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText,
      });
    });

    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      const important =
        status >= 400 ||
        /billing|billings|setting|settings|subscription|invoice|hospital|branch/i.test(url);

      if (!important) return;

      let body = '';
      try {
        const contentType = response.headers()['content-type'] || '';
        if (/json|text|html/i.test(contentType)) {
          body = (await response.text()).slice(0, 3000);
        }
      } catch (_) {
        body = '<body unavailable>';
      }

      diagnostics.capturedResponses.push({
        status,
        method: response.request().method(),
        url,
        body,
      });
    });

    await test.step('Login ke Essensial', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await waitForStablePage(page);
      diagnostics.urls.push({ step: 'login-page', url: page.url() });
      await attachScreenshot(page, testInfo, '01-login-page');

      await page.locator('input[name="username"]').first().fill(USERNAME);
      await page.locator('input[name="password"]').first().fill(PASSWORD);
      await attachScreenshot(page, testInfo, '02-login-filled');

      await page.locator('button[data-test="login-btn"]').first().click();
      await waitForStablePage(page);
      diagnostics.urls.push({ step: 'after-login', url: page.url() });
      await attachScreenshot(page, testInfo, '03-after-login');
    });

    await test.step('Pilih cabang Kennedy melalui icon panah bawah', async () => {
      await openBranchDropdown(page);
      await attachScreenshot(page, testInfo, '04-branch-dropdown-open');

      const branchOption = page.getByText(BRANCH_NAME, { exact: false });
      await branchOption.waitFor({ state: 'visible', timeout: 30000 });
      await branchOption.click({ force: true });

      await waitForStablePage(page);
      diagnostics.urls.push({ step: 'after-branch-click', url: page.url() });
      await attachScreenshot(page, testInfo, '05-after-branch-click');

      if (await isFullscreenLoader(page)) {
        diagnostics.notes.push(
          `Setelah memilih "${BRANCH_NAME}", aplikasi masih fullscreen loading. ` +
            'Test lanjut paksa ke /settings agar bisa memeriksa Billing.'
        );
        await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded' });
        await waitForStablePage(page);
      }
    });

    await test.step('Masuk ke Setting', async () => {
      if (!page.url().includes('/settings')) {
        await openSettings(page);
        await waitForStablePage(page);
      }

      if (await isFullscreenLoader(page)) {
        diagnostics.notes.push('Halaman Setting masih fullscreen loading. Reload /settings sekali.');
        await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded' });
        await waitForStablePage(page);
      }

      await closeTutorialPopup(page);
      diagnostics.urls.push({ step: 'settings', url: page.url() });
      await attachScreenshot(page, testInfo, '06-settings');
    });

    await test.step('Klik submenu Billing', async () => {
      await closeTutorialPopup(page);

      const billing = page.getByText('Billing', { exact: true });
      await billing.waitFor({ state: 'visible', timeout: 30000 });
      await billing.click({ force: true });

      await waitForStablePage(page);
      await closeTutorialPopup(page);

      diagnostics.urls.push({ step: 'billing', url: page.url() });
      await attachScreenshot(page, testInfo, '07-billing');
    });

    await test.step('Validasi halaman Billing', async () => {
      const visibleText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
      diagnostics.billingTextSnippet = visibleText.slice(0, 3000);
      diagnostics.hasOops = /oops|something went wrong|terjadi kesalahan/i.test(visibleText);
      diagnostics.finishedAt = new Date().toISOString();

      await testInfo.attach('billing-diagnostics.json', {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: 'application/json',
      });

      expect(diagnostics.hasOops, 'Halaman Billing menampilkan Oops/error screen').toBe(false);
      expect(visibleText, 'Halaman Billing kosong atau masih loader').toContain('Billing');
    });
  });
});

async function attachScreenshot(page, testInfo, name) {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

async function waitForStablePage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});

  await page
    .locator('.MuiCircularProgress-root, [role="progressbar"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 15000 })
    .catch(() => {});

  await page.waitForTimeout(1200);
}

async function isFullscreenLoader(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return bodyText.trim().length === 0;
}

async function openBranchDropdown(page) {
  const arrowButton = page
    .locator(
      [
        'button:has-text("Klinik") + button',
        'button:has-text("Clinic") + button',
        '[role="button"]:has-text("Klinik") + button',
        '[role="button"]:has-text("Clinic") + button',
      ].join(', ')
    )
    .first();

  if (await arrowButton.count()) {
    await arrowButton.click({ force: true });
    await page.waitForTimeout(800);
    return;
  }

  const branchButton = page
    .locator(
      [
        'button:has-text("Klinik")',
        'button:has-text("Clinic")',
        '[role="button"]:has-text("Klinik")',
        '[role="button"]:has-text("Clinic")',
      ].join(', ')
    )
    .first();

  if (await branchButton.count()) {
    const box = await branchButton.boundingBox();
    if (box) {
      // Fallback: klik sedikit di kanan button nama cabang, area button panah bawah.
      await page.mouse.click(box.x + box.width + 18, box.y + box.height / 2);
      await page.waitForTimeout(800);
      return;
    }
  }

  // Fallback untuk viewport 1440x900.
  await page.mouse.click(1264, 58);
  await page.waitForTimeout(800);
}

async function openSettings(page) {
  const settingLocators = [
    page.getByText('Settings', { exact: false }),
    page.getByText('Setting', { exact: false }),
    page.getByText('Pengaturan', { exact: false }),
    page.locator('[href*="settings"], [href*="setting"]'),
    page.locator('[data-test*="setting"], [data-testid*="setting"]'),
  ];

  for (const locator of settingLocators) {
    if (await locator.count()) {
      await locator.first().click({ force: true });
      return;
    }
  }

  // Fallback: icon gear Setting di sidebar kiri untuk viewport 1440x900.
  await page.mouse.click(36, 812);
}

async function closeTutorialPopup(page) {
  for (const label of ['CLOSE', 'Close', 'Tutup']) {
    const closeButton = page.getByText(label, { exact: true });
    if (await closeButton.count()) {
      await closeButton.first().click({ force: true });
      await page.waitForTimeout(500);
      return true;
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  return false;
}
