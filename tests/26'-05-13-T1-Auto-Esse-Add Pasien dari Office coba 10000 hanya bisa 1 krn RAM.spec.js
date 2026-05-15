const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc23@gmail.com';
const PASSWORD = '12345678';
const BRANCH_NAME = 'Kennedy [Clinica Pro]';
const TARGET_PATIENT_COUNT = 10000;
const EXECUTED_PATIENT_COUNT = Number(process.env.PATIENT_CREATE_COUNT || 1);

test.describe('T1 - Auto Esse Add Pasien dari Office', () => {
  test(`coba ${TARGET_PATIENT_COUNT} pasien, aktual hanya ${EXECUTED_PATIENT_COUNT} karena limit RAM`, async ({
    page,
  }, testInfo) => {
    testInfo.annotations.push({
      type: 'actual-result',
      description:
        'Target create 10000 pasien dari Office > Pasien > Data Pasien. ' +
        'Eksekusi aktual dibatasi menjadi 1 pasien karena risiko RAM/load environment dev.',
    });

    const diagnostics = {
      targetPatientCount: TARGET_PATIENT_COUNT,
      executedPatientCount: EXECUTED_PATIENT_COUNT,
      branch: BRANCH_NAME,
      createdPatients: [],
      notes: [
        'Manual QA run pada 2026-05-13 berhasil membuat 1 pasien.',
        'Batch 10000 pasien tidak dijalankan via UI untuk menghindari beban RAM dan data pollution.',
      ],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
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

    await test.step('Login ke dev Essensial', async () => {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await waitForStablePage(page);

      await page.locator('input[name="username"], input[type="text"]').first().fill(USERNAME);
      await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
      await attachScreenshot(page, testInfo, '01-login-filled');

      await page.locator('button[data-test="login-btn"], button:has-text("Login")').first().click();
      await waitForStablePage(page);
      await attachScreenshot(page, testInfo, '02-after-login');
    });

    await test.step(`Pastikan cabang ${BRANCH_NAME}`, async () => {
      await ensureBranch(page, BRANCH_NAME);
      await waitForStablePage(page);

      const bodyText = await page.locator('body').innerText({ timeout: 10000 });
      expect(bodyText).toContain(BRANCH_NAME);
      await attachScreenshot(page, testInfo, '03-kennedy-branch');
    });

    await test.step('Buka Office > Pasien > Data Pasien', async () => {
      await page.goto(`${BASE_URL}office`, { waitUntil: 'domcontentloaded' });
      await waitForStablePage(page);
      await page.getByText('Pasien', { exact: true }).click({ force: true });
      await page.getByText('Data Pasien', { exact: true }).click({ force: true });
      await waitForStablePage(page);

      await expect(page).toHaveURL(/\/office/);
      await expect(page.getByText('Data Pasien', { exact: true })).toBeVisible();
      await attachScreenshot(page, testInfo, '04-office-data-pasien');
    });

    for (let index = 1; index <= EXECUTED_PATIENT_COUNT; index += 1) {
      const patient = buildPatient(index);

      await test.step(`Tambah pasien ${index}/${EXECUTED_PATIENT_COUNT}: ${patient.name}`, async () => {
        await openNewPatientModal(page);
        await fillRequiredPatientData(page, patient);
        await attachScreenshot(page, testInfo, `05-patient-${index}-filled`);

        await page.getByRole('button', { name: /simpan/i }).click({ force: true });
        await waitForStablePage(page);

        await expect(
          page.getByText(/Data pasien baru berhasil ditambahkan/i),
          'Toast sukses tambah pasien harus muncul'
        ).toBeVisible({ timeout: 30000 });

        await expect(page.getByText(patient.name, { exact: true })).toBeVisible({ timeout: 30000 });
        diagnostics.createdPatients.push(patient);
        await attachScreenshot(page, testInfo, `06-patient-${index}-created`);
      });
    }

    await testInfo.attach('add-pasien-office-result.json', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    });
  });
});

function buildPatient(index) {
  return {
    name: `KN-AI-Surya-${String(index).padStart(4, '0')}`,
    birthTown: 'Bandung',
    birthDate: '13/05/1976',
    address: 'Jl. Melati QA No. 13, Sukajadi',
    province: 'JAWA BARAT',
    city: 'KAB. BANDUNG',
    district: 'CIMENYAN',
    village: 'CIBURIAL',
    postalCode: '40161',
  };
}

async function fillRequiredPatientData(page, patient) {
  await page.locator('input[name="name"]').fill(patient.name);
  await page.locator('input[name="birthTown"]').fill(patient.birthTown);
  await page.locator('input[placeholder="DD/MM/YYYY"]').first().fill(patient.birthDate);

  await scrollModal(page, 700);
  await clickAndSelectOption(page, 'Metode Pembayaran', 'Lainnya');

  await scrollModal(page, 700);
  await fillAddressText(page, patient.address);
  await clickAndSelectOption(page, 'Provinsi', patient.province);
  await clickAndSelectOption(page, 'Kota / Kabupaten', patient.city);
  await clickAndSelectOption(page, 'Kecamatan', patient.district);
  await clickAndSelectOption(page, 'Kelurahan', patient.village);
  await page.locator('input[name="postcode"]').fill(patient.postalCode);
}

async function openNewPatientModal(page) {
  const newPatientButton = page.getByRole('button', { name: /\+\s*Pasien Baru/i });
  await newPatientButton.click({ force: true });
  await expect(page.getByText('Tambah Pasien Baru', { exact: true })).toBeVisible({ timeout: 30000 });
}

async function fillAddressText(page, address) {
  const addressLabel = page.getByText('Alamat Rumah', { exact: true });
  await addressLabel.scrollIntoViewIfNeeded();

  const modal = page.locator('[role="document"]').last();
  const addressInput = modal.locator('input:not([type="hidden"])').filter({ hasNotText: /./ }).nth(0);

  // Fallback coordinate is intentionally scoped to the visible modal layout used by this case.
  if (await addressInput.count()) {
    await page.mouse.click(380, 218);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(address);
    return;
  }

  await page.mouse.click(380, 218);
  await page.keyboard.type(address);
}

async function clickAndSelectOption(page, label, optionText) {
  const labelLocator = page.getByText(label, { exact: true });
  await labelLocator.scrollIntoViewIfNeeded();

  const box = await labelLocator.boundingBox();
  if (!box) throw new Error(`Label "${label}" tidak terlihat`);

  await page.mouse.click(box.x + box.width + 185, box.y + 28);
  const option = page.getByText(optionText, { exact: true });
  await option.waitFor({ state: 'visible', timeout: 30000 });
  await option.click({ force: true });
}

async function ensureBranch(page, branchName) {
  const currentBranch = page.getByText(branchName, { exact: false });
  if (await currentBranch.count()) return;

  await openBranchDropdown(page);
  const branchOption = page.getByText(branchName, { exact: false });
  await branchOption.waitFor({ state: 'visible', timeout: 30000 });
  await branchOption.click({ force: true });
}

async function openBranchDropdown(page) {
  const branchButton = page.locator('button:has-text("Klinik"), button:has-text("Clinic")').first();

  if (await branchButton.count()) {
    const box = await branchButton.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 18, box.y + box.height / 2);
      await page.waitForTimeout(800);
      return;
    }
  }

  await page.mouse.click(1095, 105);
  await page.waitForTimeout(800);
}

async function scrollModal(page, amount) {
  const modal = page.locator('[role="document"]').last();
  await modal.scrollIntoViewIfNeeded().catch(() => {});
  await page.mouse.wheel(0, amount);
  await page.waitForTimeout(500);
}

async function waitForStablePage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page
    .locator('.MuiCircularProgress-root, [role="progressbar"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1000);
}

async function attachScreenshot(page, testInfo, name) {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}
