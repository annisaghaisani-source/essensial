const path = require('path');
const { chromium } = require('@playwright/test');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc23@gmail.com';
const PASSWORD = '12345678';
const BRANCH_NAME = '001532 - Kennedy [Clinica Pro]';
const DOWNLOAD_DIR = path.resolve(__dirname, '..', 'diagnostics', 'data-entry-import');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1498, height: 838 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  async function stable(timeout = 45000) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
    await page
      .locator('.MuiCircularProgress-root, [role="progressbar"]')
      .first()
      .waitFor({ state: 'hidden', timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1200);
  }

  async function login() {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('input[name="username"]').fill(USERNAME);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('button[data-test="login-btn"]').click();
    await stable();
  }

  async function switchBranch() {
    if ((await page.locator('body').innerText()).includes('Kennedy [Clinica Pro]')) return;
    await page.locator('[data-test="change-account-button-arrow"]').click({ force: true });
    await page.getByText(BRANCH_NAME, { exact: false }).click({ force: true });
    await stable();
  }

  async function openSettings() {
    await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await stable();
  }

  async function enableDataEntry() {
    await openSettings();
    console.log('enable settings url:', page.url());
    console.log('enable settings body:', (await page.locator('body').innerText()).slice(0, 4000));
    await page.getByText('CLOSE', { exact: true }).click({ force: true }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByText('General Settings', { exact: true }).click({ force: true }).catch(() => {});
    const emrCandidates = await page.locator('div,span,button').evaluateAll((els) =>
      els
        .map((el, i) => {
          const r = el.getBoundingClientRect();
          return {
            i,
            tag: el.tagName,
            text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '),
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
        .filter((x) => x.text === 'EMR' && x.w > 0 && x.h > 0)
    );
    console.log('emrCandidates:', JSON.stringify(emrCandidates, null, 2));
    const emrTarget = emrCandidates.find((candidate) => candidate.x > 250) || emrCandidates[0];
    if (!emrTarget) throw new Error('EMR menu item not found');
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(500);
    await page.mouse.click(emrTarget.x + emrTarget.w / 2, emrTarget.y + emrTarget.h / 2 - 420);
    await stable();
    console.log('after EMR click:', (await page.locator('body').innerText()).slice(0, 5000));
    const dataEntryHeader = page.getByText('Data Entry', { exact: true });
    await dataEntryHeader.scrollIntoViewIfNeeded();
    const label = page.getByText('Aktifkan modul data entry', { exact: false });
    const labelBox = await label.boundingBox();
    if (!labelBox) throw new Error('Data entry checkbox label not visible');
    const checkboxCandidates = await page.locator('input[type="checkbox"]').evaluateAll((els) =>
      els.map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          i,
          checked: el.checked,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      })
    );
    console.log('checkboxCandidates:', JSON.stringify(checkboxCandidates, null, 2));
    const checkbox = page.locator('input[type="checkbox"]').nth(0);
    const checked = await checkbox.isChecked().catch(() => false);
    console.log('data entry checkbox checked?', checked);
    console.log(
      'data entry checkbox html:',
      await page
        .locator('[data-test="checkbox-isDataEntry"]')
        .evaluate((el) => {
          const chain = [];
          let node = el;
          for (let i = 0; i < 5 && node; i += 1, node = node.parentElement) {
            chain.push(node.outerHTML.slice(0, 600));
          }
          return chain;
        })
        .catch((error) => error.message)
    );
    if (!checked) {
      await page.locator('label:has([data-test="checkbox-isDataEntry"])').click({ force: true });
      await page.waitForTimeout(500);
      console.log('after data entry checkbox click checked?', await checkbox.isChecked().catch(() => false));
      await page.getByRole('button', { name: /^Simpan$/i }).click({ force: true });
      await stable();
      console.log('after save body:', (await page.locator('body').innerText()).slice(0, 2500));
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await stable();
  }

  async function inspectImport() {
    await openSettings();
    const body = await page.locator('body').innerText();
    console.log('settings text snippet:', body.slice(0, 2500));
    const candidates = await page
      .locator('a,button,div,span,[role="button"]')
      .evaluateAll((els) =>
        els
          .map((el, i) => ({
            i,
            tag: el.tagName,
            text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
            role: el.getAttribute('role'),
            href: el.getAttribute('href'),
            test: el.getAttribute('data-test'),
            x: Math.round(el.getBoundingClientRect().x),
            y: Math.round(el.getBoundingClientRect().y),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
          }))
          .filter((x) => /Data Entry|Import|Pasien|Download|Upload|Petunjuk/i.test(x.text + ' ' + (x.href || '')))
          .slice(0, 200)
      );
    console.log('candidates:', JSON.stringify(candidates, null, 2));

    await page.getByText('Data Entry', { exact: true }).click({ force: true });
    await stable();
    console.log('after data entry click:', (await page.locator('body').innerText()).slice(0, 3000));
    await page.getByText('Import Data Pasien', { exact: false }).click({ force: true });
    await stable();
    console.log('after import click:', (await page.locator('body').innerText()).slice(0, 3000));

    const guideDownload = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: /Download\s+Petunjuk\s+Pengisian/i }).click({ force: true });
    const guide = await guideDownload;
    const guidePath = path.join(DOWNLOAD_DIR, guide.suggestedFilename());
    await guide.saveAs(guidePath);
    console.log('guidePath:', guidePath);

    const templateDownload = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: /^Download$/i }).click({ force: true });
    const template = await templateDownload;
    const templatePath = path.join(DOWNLOAD_DIR, template.suggestedFilename());
    await template.saveAs(templatePath);
    console.log('templatePath:', templatePath);
  }

  await login();
  await switchBranch();
  await enableDataEntry();
  await inspectImport();
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
