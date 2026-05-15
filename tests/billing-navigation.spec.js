const { test, expect } = require('@playwright/test');

const USERNAME = 'anisasecondacc23@gmail.com';
const PASSWORD = '12345678';
const TARGET_BRANCH = 'Kennedy [Clinica Pro]';

test.describe('Setting Billing Navigation', () => {
  test('login, switch to Kennedy branch, open Setting > Billing', async ({ page }, testInfo) => {
    const diagnostics = {
      console: [],
      pageErrors: [],
      failedRequests: [],
      apiResponses: [],
      urls: [],
    };

    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        diagnostics.console.push({
          type: message.type(),
          text: message.text(),
          location: message.location(),
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
      const shouldCapture =
        status >= 400 ||
        /billing|billings|setting|settings|subscription|invoice|hospital|branch/i.test(url);

      if (!shouldCapture) return;

      let body = '';
      try {
        const contentType = response.headers()['content-type'] || '';
        if (/json|text|html/i.test(contentType)) {
          body = (await response.text()).slice(0, 3000);
        }
      } catch (_) {
        body = '<body unavailable>';
      }

      diagnostics.apiResponses.push({
        status,
        method: response.request().method(),
        url,
        body,
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    diagnostics.urls.push({ step: 'login-page', url: page.url() });
    await screenshot(page, testInfo, '01-login-page');

    await page.locator('input[name="username"]').first().fill(USERNAME);
    await page.locator('input[name="password"]').first().fill(PASSWORD);
    await screenshot(page, testInfo, '02-login-filled');

    await page.locator('button[data-test="login-btn"]').first().click();
    await waitForAppReady(page);
    diagnostics.urls.push({ step: 'after-login', url: page.url() });
    await screenshot(page, testInfo, '03-after-login');

    await openBranchDropdown(page);
    await screenshot(page, testInfo, '04-branch-dropdown');

    await selectBranch(page, TARGET_BRANCH);
    await waitForAppReady(page);
    diagnostics.urls.push({ step: 'after-branch-selected', url: page.url() });
    await screenshot(page, testInfo, '05-after-branch-selected');

    if (await isFullscreenLoader(page)) {
      throw new Error(
        `Setelah memilih cabang "${TARGET_BRANCH}", aplikasi masih stuck di fullscreen loader. ` +
          'Settings/Billing belum bisa dibuka.'
      );
    }

    await openSettings(page);
    await waitForAppReady(page);
    await closeTutorialIfExists(page);
    diagnostics.urls.push({ step: 'settings', url: page.url() });
    await screenshot(page, testInfo, '06-settings');

    await openBillingSubmenu(page);
    await waitForAppReady(page);
    await closeTutorialIfExists(page);
    diagnostics.urls.push({ step: 'billing', url: page.url() });
    await screenshot(page, testInfo, '07-billing');

    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    diagnostics.billingTextSnippet = bodyText.slice(0, 3000);
    diagnostics.hasOops = /oops|something went wrong|terjadi kesalahan/i.test(bodyText);

    await testInfo.attach('billing-diagnostics.json', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    });

    expect(diagnostics.hasOops, 'Halaman Billing menampilkan Oops/error screen').toBe(false);
    await expect(page.getByText('Billing', { exact: false })).toBeVisible();
  });
});

async function screenshot(page, testInfo, name) {
  const image = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${name}.png`, {
    body: image,
    contentType: 'image/png',
  });
}

async function waitForAppReady(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  await page
    .locator('.MuiCircularProgress-root, [role="progressbar"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 30000 })
    .catch(() => {});

  await page.waitForTimeout(1500);
}

async function isFullscreenLoader(page) {
  const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return text.trim().length === 0;
}

async function openBranchDropdown(page) {
  const branchButton = page
    .locator('button:has-text("Klinik"), button:has-text("Clinic"), [role="button"]:has-text("Klinik"), [role="button"]:has-text("Clinic")')
    .first();

  if (await branchButton.count()) {
    const box = await branchButton.boundingBox();
    if (box) {
      // Klik icon panah bawah di sisi kanan tombol cabang, bukan teks cabang.
      await page.mouse.click(box.x + box.width - 18, box.y + box.height / 2);
      await page.waitForTimeout(1000);
      return;
    }
  }

  // Fallback untuk viewport default 1440x900.
  await page.mouse.click(1264, 58);
  await page.waitForTimeout(1000);
}

async function selectBranch(page, branchName) {
  const branchOption = page.getByText(branchName, { exact: false });
  await branchOption.waitFor({ state: 'visible', timeout: 30000 });
  await branchOption.click({ force: true });
}

async function closeTutorialIfExists(page) {
  for (const label of ['CLOSE', 'Close', 'Tutup']) {
    const button = page.getByText(label, { exact: true });
    if (await button.count()) {
      await button.first().click({ force: true });
      await page.waitForTimeout(500);
      return true;
    }
  }

  return false;
}

async function openSettings(page) {
  const candidates = [
    page.getByText('Setting', { exact: false }),
    page.getByText('Settings', { exact: false }),
    page.getByText('Pengaturan', { exact: false }),
    page.locator('[href*="setting"], [href*="settings"]'),
    page.locator('[data-test*="setting"], [data-testid*="setting"]'),
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) {
      await candidate.first().click({ force: true });
      return;
    }
  }

  // Fallback: icon gear Settings di sidebar kiri pada viewport default.
  await page.mouse.click(36, 812);
}

async function openBillingSubmenu(page) {
  await closeTutorialIfExists(page);

  const billing = page.getByText('Billing', { exact: true });
  await billing.waitFor({ state: 'visible', timeout: 30000 });
  await billing.click({ force: true });
}
