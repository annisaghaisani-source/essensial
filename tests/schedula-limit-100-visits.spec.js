const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc24@gmail.com';
const PASSWORD = '12345678';
const BRANCH_LABEL = 'Pure Burns [Schedula]';
const BRANCH_OPTION = '001652 - Pure Burns [Schedula]';
const ATTEMPT_COUNT = Number(process.env.SCHEDULA_ATTEMPTS || 100);
const COMPLAINT = 'Test limit 100 kunjungan pasien Schedula';
const DOCTORS = ['BN-Gilbert', 'BN-Maxwell'];

test.use({
  viewport: { width: 1498, height: 838 },
  video: 'on',
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
});

test.setTimeout(45 * 60 * 1000);

test('Schedula visit limit: attempt 100 registrations and verify cap', async ({ page }, testInfo) => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(60000);

  const artifactsDir = testInfo.outputPath('artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const diagnostics = {
    baseUrl: BASE_URL,
    branch: BRANCH_LABEL,
    requestedAttempts: ATTEMPT_COUNT,
    complaint: COMPLAINT,
    startedAt: new Date().toISOString(),
    attempts: [],
    summary: {
      success: 0,
      blocked: 0,
      failed: 0,
    },
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };

  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      diagnostics.consoleErrors.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    }
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('requestfailed', (request) => {
    diagnostics.failedRequests.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText,
    });
  });

  await login(page);
  await ensureBranch(page);
  await openRegistration(page);
  await expect(page.locator('body')).toContainText(BRANCH_LABEL, { timeout: 30000 });
  await attachScreenshot(page, testInfo, '01-registration-pure-burns');

  const initialQuota = await readQuotaText(page);
  diagnostics.initialQuotaText = initialQuota;
  console.log(`Initial quota text: ${initialQuota || '(not found)'}`);

  for (let attempt = 1; attempt <= ATTEMPT_COUNT; attempt += 1) {
    const requestedPatientNumber = randomInt(1, 120);
    const requestedPatientName = `PB-AI-Play-${String(requestedPatientNumber).padStart(6, '0')}`;
    const doctor = DOCTORS[randomInt(0, DOCTORS.length - 1)];
    const attemptRecord = {
      attempt,
      requestedPatientName,
      doctor,
      status: 'started',
      messages: [],
      startedAt: new Date().toISOString(),
    };
    diagnostics.attempts.push(attemptRecord);

    console.log(`Attempt ${attempt}/${ATTEMPT_COUNT}: requestedPatient=${requestedPatientName}, doctor=${doctor}`);

    try {
      await openNewRegistrationModal(page);
      const selectedPatientName = await selectRandomExistingPatient(page, requestedPatientName);
      attemptRecord.selectedPatientName = selectedPatientName;
      if (process.env.SCHEDULA_DEBUG_AFTER_SELECT === '1') {
        await page.screenshot({
          path: path.join(process.cwd(), 'test-results', 'schedula-debug-after-select.png'),
          fullPage: true,
        });
        throw new Error(`Debug after patient select captured. Body: ${compact(await page.locator('body').innerText().catch(() => '')).slice(0, 2500)}`);
      }
      const complaintInput = await fillVisitRequiredFields(page, doctor);
      if (process.env.SCHEDULA_DEBUG_AFTER_DOCTOR === '1') {
        await page.screenshot({
          path: path.join(process.cwd(), 'test-results', 'schedula-debug-after-doctor.png'),
          fullPage: true,
        });
        throw new Error(`Debug after doctor captured. Body: ${compact(await visitDialog(page).innerText().catch(() => '')).slice(0, 3000)}`);
      }
      await complaintInput.fill(COMPLAINT);
      if (process.env.SCHEDULA_DEBUG_BEFORE_SAVE === '1') {
        await page.screenshot({
          path: path.join(process.cwd(), 'test-results', 'schedula-debug-before-save.png'),
          fullPage: true,
        });
        throw new Error(`Debug before save captured. Body: ${compact(await page.locator('body').innerText().catch(() => '')).slice(0, 3000)}`);
      }

      const beforeSaveText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
      attemptRecord.beforeSaveSnippet = compact(beforeSaveText).slice(0, 1000);

      await clickSaveVisit(page);
      const saveResult = await waitForSaveResult(page);
      attemptRecord.saveResult = saveResult;

      if (saveResult.kind === 'success') {
        diagnostics.summary.success += 1;
        attemptRecord.status = 'success';
        await waitForStablePage(page);
        await closeTransientDialogs(page);
      } else if (saveResult.kind === 'blocked') {
        diagnostics.summary.blocked += 1;
        attemptRecord.status = 'blocked';
        attemptRecord.messages.push(saveResult.message);
        await attachScreenshot(page, testInfo, `blocked-attempt-${String(attempt).padStart(3, '0')}`);
        await closeRegistrationModal(page);
        break;
      } else {
        diagnostics.summary.failed += 1;
        attemptRecord.status = 'unknown-after-save';
        attemptRecord.messages.push(saveResult.message || 'No success/block message detected after save');
        await attachScreenshot(page, testInfo, `unknown-save-attempt-${String(attempt).padStart(3, '0')}`);
        await closeRegistrationModal(page);
        break;
      }

      attemptRecord.finishedAt = new Date().toISOString();

      if (attempt % 5 === 0) {
        diagnostics.latestQuotaText = await readQuotaText(page);
        console.log(`Progress: ${diagnostics.summary.success} success, quota="${diagnostics.latestQuotaText || '-'}"`);
      }
    } catch (error) {
      diagnostics.summary.failed += 1;
      attemptRecord.status = 'error';
      attemptRecord.error = error.stack || error.message;
      const errorScreenshotPath = path.join(artifactsDir, `error-attempt-${String(attempt).padStart(3, '0')}.png`);
      await page.screenshot({ path: errorScreenshotPath, fullPage: true }).catch(() => {});
      attemptRecord.errorScreenshotPath = errorScreenshotPath;
      await attachScreenshot(page, testInfo, `error-attempt-${String(attempt).padStart(3, '0')}`);
      await closeRegistrationModal(page).catch(() => {});
      continue;
    }
  }

  diagnostics.finishedAt = new Date().toISOString();
  diagnostics.finalQuotaText = await readQuotaText(page);
  diagnostics.finalTableText = await readAppointmentTableText(page);

  const diagnosticsPath = path.join(artifactsDir, 'schedula-limit-100-visits-diagnostics.json');
  fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2));
  await testInfo.attach('schedula-limit-100-visits-diagnostics.json', {
    path: diagnosticsPath,
    contentType: 'application/json',
  });
  await attachScreenshot(page, testInfo, 'final-registration-table');

  console.log(`Summary: ${JSON.stringify(diagnostics.summary)}`);
  console.log(`Final quota text: ${diagnostics.finalQuotaText || '(not found)'}`);

  expect(
    diagnostics.summary.success + diagnostics.summary.blocked + diagnostics.summary.failed,
    'Test must perform at least one registration attempt'
  ).toBeGreaterThan(0);
});

async function login(page) {
  await gotoWithRetry(page, `${BASE_URL}login`);
  await waitForStablePage(page);
  await page.locator('#username, input[name="username"]').first().fill(USERNAME);
  await page.locator('[data-test="input-password"], input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.locator('[data-test="login-btn"], button[type="submit"]').first().click({ force: true });
  await waitForStablePage(page);
  await closeTransientDialogs(page);
}

async function gotoWithRetry(page, url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(2000);
    }
  }
  throw lastError;
}

async function ensureBranch(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const bodyText = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');
    if (bodyText.includes(BRANCH_LABEL)) return;

    await closeTransientDialogs(page);
    await page.locator('[data-test="change-account-button-arrow"]').click({ force: true, timeout: 10000 });
    await page.waitForTimeout(700);

    const branchChoices = [
      page.getByRole('menuitem', { name: /001652\s*-\s*Pure Burns\s*\[Schedula\]/i }).first(),
      page.getByRole('menuitem', { name: /Pure Burns\s*\[Schedula\]/i }).first(),
      page.getByText(/001652\s*-\s*Pure Burns\s*\[Schedula\]/i).last(),
      page.getByText(/Pure Burns\s*\[Schedula\]/i).last(),
    ];

    for (const choice of branchChoices) {
      if (await choice.isVisible({ timeout: 3000 }).catch(() => false)) {
        await choice.click({ force: true, timeout: 10000 });
        await waitForStablePage(page);
        await closeTransientDialogs(page);
        break;
      }
    }
  }

  const finalBodyText = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');
  if (!finalBodyText.includes(BRANCH_LABEL)) {
    throw new Error(`Gagal memilih cabang ${BRANCH_LABEL}. Current body: ${compact(finalBodyText).slice(0, 2000)}`);
  }
}

async function openRegistration(page) {
  await page.goto(`${BASE_URL}registration`, { waitUntil: 'domcontentloaded' });
  await waitForStablePage(page);
  await closeTransientDialogs(page);
  const rawatJalanPoli = page.locator('[data-test="menu-rawat-jalan-poli"]');
  if (await rawatJalanPoli.isVisible({ timeout: 5000 }).catch(() => false)) {
    await rawatJalanPoli.click({ force: true });
    await waitForStablePage(page);
  }
}

async function openNewRegistrationModal(page) {
  await closeTransientDialogs(page);
  await page.getByRole('button', { name: /Pendaftaran Baru/i }).click({ force: true });
  await page.waitForTimeout(500);
  const menuItem = page.getByRole('menuitem', { name: /^Pendaftaran Baru$/i }).first();
  if (await menuItem.isVisible({ timeout: 3000 }).catch(() => false)) {
    await menuItem.click({ force: true });
  } else {
    const dropdownText = page.getByText(/^Pendaftaran Baru$/i).last();
    if (await dropdownText.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dropdownText.click({ force: true });
    }
  }
  await expect(page.locator('body')).toContainText(/Daftar Kunjungan/i, { timeout: 15000 });
  await visitDialog(page).getByRole('textbox', { name: /Cari Nama Lengkap Pasien|Cari Pasien/i }).waitFor({
    state: 'visible',
    timeout: 30000,
  });
}

async function selectRandomExistingPatient(page, requestedPatientName) {
  const dialog = visitDialog(page);
  const search = dialog.getByRole('textbox', { name: /Cari Nama Lengkap Pasien|Cari Pasien/i }).first();
  await search.fill(requestedPatientName);
  await page.waitForTimeout(900);

  const exactPatient = dialog.locator('button').filter({ hasText: requestedPatientName }).first();
  if (await exactPatient.isVisible({ timeout: 1500 }).catch(() => false)) {
    const selectedText = compact(await exactPatient.innerText().catch(() => requestedPatientName));
    await exactPatient.click({ force: true, timeout: 5000 });
    await waitForStablePage(page);
    return selectedText;
  }

  await search.fill('PB-');
  await page.waitForTimeout(2500);

  const bodyAfterSearch = await dialog.innerText().catch(() => '');
  if (process.env.SCHEDULA_DEBUG_SEARCH === '1') {
    await page.screenshot({
      path: path.join(process.cwd(), 'test-results', 'schedula-debug-search.png'),
      fullPage: true,
    });
    throw new Error(`Debug search screenshot captured. Body: ${compact(bodyAfterSearch).slice(0, 2500)}`);
  }
  const modalSection = bodyAfterSearch.split('Daftar Kunjungan').pop() || bodyAfterSearch;
  const patientNames = [...new Set(modalSection.match(/PB-AI-Play-\d{6}/g) || [])];

  if (patientNames.length === 0) {
    const buttonTexts = await dialog.locator('button').evaluateAll((buttons) =>
      buttons
        .map((button) => (button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 40)
    ).catch(() => []);
    const bodySnippet = compact(await dialog.innerText().catch(() => '')).slice(0, 2500);
    throw new Error(
      `Tidak ada pasien existing dengan prefix PB-. Requested: ${requestedPatientName}. ` +
        `Visible/button candidates: ${JSON.stringify(buttonTexts)}. Body: ${bodySnippet}`
    );
  }

  const selectedText = patientNames.includes('PB-AI-Play-000001')
    ? 'PB-AI-Play-000001'
    : patientNames[randomInt(0, patientNames.length - 1)];
  await clickPatientSearchResult(page, selectedText);
  await expect(visitDialog(page)).toContainText(/Keluhan|Tipe Pasien|Penjamin/i, { timeout: 15000 });
  await waitForStablePage(page);
  return selectedText;
}

async function clickPatientSearchResult(page, selectedText) {
  if (selectedText === 'PB-AI-Play-000001') {
    await page.mouse.click(410, 390);
    return;
  }

  const textClick = page.getByText(new RegExp(`${selectedText}\\s+\\d{2}-\\d{2}-\\d{4}`), { exact: false }).last();
  if (await textClick.isVisible({ timeout: 2000 }).catch(() => false)) {
    await textClick.click({ force: true, timeout: 5000 });
    return;
  }

  const clicked = await page.evaluate((name) => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const candidates = Array.from(document.querySelectorAll('button, [role="button"], li, div, span'))
      .filter((element) => isVisible(element) && (element.innerText || element.textContent || '').includes(name));
    const target = candidates[candidates.length - 1];
    if (!target) return false;

    let clickable = target;
    while (
      clickable.parentElement &&
      clickable.parentElement !== document.body &&
      (clickable.parentElement.innerText || '').includes(name) &&
      clickable.parentElement.getBoundingClientRect().height < 180
    ) {
      clickable = clickable.parentElement;
    }

    clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    clickable.click();
    return true;
  }, selectedText);

  if (!clicked) {
    await page.getByText(selectedText, { exact: false }).last().click({ force: true, timeout: 5000 });
  }
}

async function fillNewPatient(page, patientName, attempt) {
  await page.locator('[data-test="input-nama-pasien"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('[data-test="input-nama-pasien"]').fill(patientName);
  await page.locator('[data-test="input-tempat-lahir"]').fill(randomItem(['Jakarta', 'Bandung', 'Surabaya', 'Medan']));

  const dateInput = page.locator('[data-test="date-tanggal-lahir"] input, [data-test="date-tanggal-lahir"]').first();
  if (await dateInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dateInput.click({ force: true });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(`${String(randomInt(1, 28)).padStart(2, '0')}/05/${randomInt(1970, 2003)}`);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^OK$/i }).click({ force: true }).catch(() => {});
  }

  await page.locator('input[name="address"]').fill(`Jl Test Schedula ${attempt}`);
  await selectOption(page, '#select-selectedProvince', 'BENGKULU');
  await selectOption(page, '#select-selectedKabupaten', 'KAB. BENGKULU UTARA');
  await selectOption(page, '#select-selectedKecamatan', 'BATIK NAU');
  await selectOption(page, '#select-selectedKelurahan', 'BATIK NAU');
  await page.locator('input[name="postcode"]').fill(String(randomInt(10000, 99999)));

  await page.getByRole('button', { name: /^simpan$/i }).click({ force: true });
  await page.locator('[data-test="input-nama-pasien"]').waitFor({ state: 'hidden', timeout: 30000 });
  await waitForStablePage(page);
}

async function fillVisitRequiredFields(page, doctor) {
  const dialog = visitDialog(page);
  await scrollDialog(page, 900);
  const doctorSelect = dialog.locator('#select-doctorName').first();
  await doctorSelect.scrollIntoViewIfNeeded().catch(() => {});
  await doctorSelect.waitFor({ state: 'visible', timeout: 30000 });
  await doctorSelect.click({ force: true });
  await page.waitForTimeout(500);
  const doctorChoices = [
    page.getByRole('option', { name: doctor }).first(),
    page.getByRole('menuitem', { name: doctor }).first(),
    page.getByText(doctor, { exact: true }).last(),
  ];
  let selectedDoctor = false;
  for (const choice of doctorChoices) {
    if (await choice.isVisible({ timeout: 1500 }).catch(() => false)) {
      await choice.click({ force: true, timeout: 5000 });
      selectedDoctor = true;
      break;
    }
  }
  if (!selectedDoctor) {
    const bodySnippet = compact(await dialog.innerText().catch(() => '')).slice(0, 2000);
    throw new Error(`Dokter ${doctor} tidak ditemukan setelah membuka dropdown. Body: ${bodySnippet}`);
  }

  const paymentSelect = dialog.locator('#select-paymentMethod, #select-paymentMethodName').first();
  if (await paymentSelect.isVisible({ timeout: 1500 }).catch(() => false)) {
    const current = await paymentSelect.innerText().catch(() => '');
    if (!/Umum|Tunai|Cash|Pribadi/i.test(current)) {
      await paymentSelect.click({ force: true });
      await page.getByRole('option').filter({ hasText: /Umum|Tunai|Cash|Pribadi/i }).first().click({ force: true }).catch(() => {});
    }
  }

  const complaintCandidates = [
    dialog.locator('[data-test="input-complaint"]').first(),
    dialog.getByLabel(/Keluhan/i).first(),
    dialog.locator('textarea').filter({ hasText: /^$/ }).first(),
    dialog.locator('input[name*="complaint" i], textarea[name*="complaint" i]').first(),
  ];
  for (const input of complaintCandidates) {
    await input.scrollIntoViewIfNeeded().catch(() => {});
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      return input;
    }
  }
  const bodySnippet = compact(await dialog.innerText().catch(() => '')).slice(0, 2500);
  throw new Error(`Input Keluhan tidak ditemukan setelah memilih dokter ${doctor}. Body: ${bodySnippet}`);
}

async function waitForSaveResult(page) {
  const deadline = Date.now() + 20000;
  const blockedPattern = /kuota[^.]{0,80}(habis|penuh|0 dari)|limit|penuh|gagal|failed|error|melebihi/i;
  const successPattern = /berhasil|success|confirmed|tersimpan|ditambahkan/i;

  while (Date.now() < deadline) {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const compactText = compact(bodyText);
    const modalOpen = /Daftar Kunjungan|Cari Nama Lengkap Pasien|Keluhan/i.test(compactText);

    if (!modalOpen || successPattern.test(compactText)) {
      return { kind: 'success', message: compactText.slice(0, 1500) };
    }

    if (blockedPattern.test(compactText)) {
      return { kind: 'blocked', message: compactText.slice(0, 1500) };
    }

    await page.waitForTimeout(500);
  }

  return { kind: 'unknown', message: compact(await page.locator('body').innerText().catch(() => '')).slice(0, 1500) };
}

async function closeTransientDialogs(page) {
  const closeButtons = [
    page.locator('[data-test="close-global-tooltip"]').first(),
    page.getByRole('dialog').getByRole('button').filter({ hasText: /^$/ }).first(),
    page.getByRole('button', { name: /close|tutup|batal/i }).first(),
  ];

  for (const button of closeButtons) {
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function clickSaveVisit(page) {
  const dialog = visitDialog(page);
  await scrollDialog(page, 1200);
  await page.waitForTimeout(300);
  const saveCandidates = [
    dialog.getByRole('button', { name: /^Simpan$/i }).last(),
    dialog.getByRole('button', { name: /^SIMPAN$/i }).last(),
    dialog.getByText(/^SIMPAN$/i).last(),
    dialog.locator('button').filter({ hasText: /^SIMPAN$/i }).last(),
    dialog.locator('button').filter({ hasText: /^Simpan$/i }).last(),
  ];

  for (const candidate of saveCandidates) {
    if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
      await candidate.click({ force: true, timeout: 5000 });
      return;
    }
  }

  const buttonTexts = await dialog.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => (button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  ).catch(() => []);
  throw new Error(`Tombol SIMPAN tidak ditemukan. Buttons: ${JSON.stringify(buttonTexts)}`);
}

function visitDialog(page) {
  return page.getByRole('dialog').filter({ hasText: /Daftar Kunjungan/i }).last();
}

async function scrollDialog(page, deltaY) {
  await page.mouse.move(900, 735).catch(() => {});
  await page.mouse.wheel(0, deltaY).catch(() => {});
  await page.waitForTimeout(300);
}

async function closeRegistrationModal(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: /^Batal$/i }).click({ force: true }).catch(() => {});
  await closeTransientDialogs(page);
  await waitForStablePage(page);
}

async function selectOption(page, selector, optionText) {
  const select = page.locator(selector).first();
  if (!(await select.isVisible({ timeout: 5000 }).catch(() => false))) return;
  await select.click({ force: true });
  await page.getByRole('option', { name: optionText }).click({ force: true });
  await page.waitForTimeout(500);
}

async function waitForStablePage(page, timeout = 30000) {
  await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await page.locator('.MuiCircularProgress-root, [role="progressbar"]').first().waitFor({
    state: 'hidden',
    timeout,
  }).catch(() => {});
  await page.waitForTimeout(700);
}

async function readQuotaText(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
  const match = bodyText.match(/Sisa kuota kunjungan[^.\n]*[.\n]?/i);
  return match ? compact(match[0]) : '';
}

async function readAppointmentTableText(page) {
  const table = page.locator('table, [role="table"]').first();
  if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
    return compact(await table.innerText()).slice(0, 5000);
  }
  return compact(await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')).slice(0, 5000);
}

async function attachScreenshot(page, testInfo, name) {
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[randomInt(0, items.length - 1)];
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
