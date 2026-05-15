const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc23@gmail.com';
const PASSWORD = '12345678';
const BRANCH_NAME = 'Kennedy [Clinica Pro]';
const BRANCH_OPTION = '001532 - Kennedy [Clinica Pro]';
const PATIENT_COUNT = Number(process.env.PATIENT_IMPORT_COUNT || 10000);
const BIRTH_DATE = '13/05/1976';

test.use({
  viewport: { width: 1498, height: 838 },
  acceptDownloads: true,
  video: 'on',
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
});

test.setTimeout(15 * 60 * 1000);

test('E2E import 10000 pasien via Settings > Data Entry > Import Data Pasien', async ({ page }, testInfo) => {
  const artifactsDir = testInfo.outputPath('artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const diagnostics = {
    branch: BRANCH_NAME,
    patientCount: PATIENT_COUNT,
    birthDate: BIRTH_DATE,
    downloadedGuide: null,
    downloadedTemplate: null,
    generatedCsv: null,
    uploadedCsv: null,
    notes: [],
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

  await test.step('Login dan pilih cabang Kennedy [Clinica Pro]', async () => {
    await login(page);
    await ensureBranch(page);
    await expect(page.locator('body')).toContainText(BRANCH_NAME, { timeout: 30000 });
    await attachScreenshot(page, testInfo, '01-kennedy-dashboard');
  });

  await test.step('Pastikan Settings > General Settings > EMR > Data Entry aktif', async () => {
    await openEmrSettings(page);
    const dataEntryCheckbox = page.locator('[data-test="checkbox-isDataEntry"], input[name="isDataEntry"]').first();
    await expect(dataEntryCheckbox, 'Checkbox Data Entry harus tersedia di EMR settings').toBeAttached({
      timeout: 30000,
    });

    if (!(await dataEntryCheckbox.isChecked())) {
      await page.locator('label:has([data-test="checkbox-isDataEntry"]), label:has(input[name="isDataEntry"])').click({
        force: true,
      });
      await page.waitForTimeout(700);
    }

    await expect(dataEntryCheckbox, 'Checkbox Aktifkan modul data entry harus tercentang').toBeChecked({
      timeout: 5000,
    });

    await page.getByRole('button', { name: /^Simpan$/i }).click({ force: true });
    await waitForStablePage(page);
    await expect(page.locator('body')).toContainText(/Data telah disimpan|berhasil/i, { timeout: 30000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForStablePage(page);
    await attachScreenshot(page, testInfo, '02-data-entry-enabled');
  });

  await test.step('Buka Data Entry > Import Data Pasien', async () => {
    await openDataEntry(page);
    await clickImportDataPasienAction(page);
    await page.getByText('Import Data Pasien', { exact: true }).last().click({ force: true });
    await expect(page.getByRole('button', { name: /Download\s+Petunjuk\s+Pengisian/i })).toBeVisible({
      timeout: 30000,
    });
    await attachScreenshot(page, testInfo, '03-import-data-pasien-modal');
  });

  let templatePath;
  let generatedCsvPath;

  await test.step('Download Petunjuk Pengisian dan Template CSV', async () => {
    const guideDownloadPromise = page.waitForEvent('download', { timeout: 45000 });
    await page.getByRole('button', { name: /Download\s+Petunjuk\s+Pengisian/i }).click({ force: true });
    const guideDownload = await guideDownloadPromise;
    const guidePath = path.join(artifactsDir, guideDownload.suggestedFilename());
    await guideDownload.saveAs(guidePath);
    diagnostics.downloadedGuide = guidePath;
    await closeBlockingDialogs(page);

    const templateDownloadPromise = page.waitForEvent('download', { timeout: 45000 });
    await page.getByRole('button', { name: /^Download$/i }).click({ force: true });
    const templateDownload = await templateDownloadPromise;
    templatePath = path.join(artifactsDir, templateDownload.suggestedFilename());
    await templateDownload.saveAs(templatePath);
    diagnostics.downloadedTemplate = templatePath;

    expect(fs.existsSync(guidePath), 'File petunjuk pengisian harus terdownload').toBe(true);
    expect(fs.existsSync(templatePath), 'Template CSV harus terdownload').toBe(true);
  });

  await test.step(`Generate CSV ${PATIENT_COUNT} pasien sesuai template`, async () => {
    generatedCsvPath = path.join(artifactsDir, `import-pasien-${PATIENT_COUNT}.csv`);
    const summary = generatePatientCsvFromTemplate(templatePath, generatedCsvPath, PATIENT_COUNT);
    diagnostics.generatedCsv = generatedCsvPath;
    diagnostics.csvSummary = summary;

    expect(summary.rowsWritten).toBe(PATIENT_COUNT);
    expect(fs.existsSync(generatedCsvPath), 'CSV 10000 pasien harus tersimpan di perangkat').toBe(true);
  });

  await test.step('Upload CSV 10000 pasien ke sistem', async () => {
    const uploadButton = page.getByRole('button', { name: /^Upload$/i });
    await expect(uploadButton).toBeVisible({ timeout: 30000 });

    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
    await uploadButton.click({ force: true });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(generatedCsvPath);
    diagnostics.uploadedCsv = generatedCsvPath;

    await waitForStablePage(page, 120000);
    await attachScreenshot(page, testInfo, '04-after-upload');

    const bodyText = await page.locator('body').innerText({ timeout: 30000 });
    diagnostics.uploadResultText = bodyText.slice(0, 5000);
    expect(bodyText, 'Upload/import pasien harus memberi indikasi berhasil, diproses, atau menampilkan hasil import').toMatch(
      /berhasil|sukses|success|diproses|import|pasien/i
    );
  });

  await test.step('Validasi pasien hasil import di Office > Pasien tab Pasien', async () => {
    await page.goto(`${BASE_URL}office`, { waitUntil: 'domcontentloaded' });
    await waitForStablePage(page);
    await page.getByText('Pasien', { exact: true }).click({ force: true });
    await waitForStablePage(page);
    await page.getByRole('button', { name: /^Data Pasien$/i }).click({ force: true }).catch(() => {});
    await page.getByPlaceholder(/Cari|Search/i).first().fill('KN-AI-').catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await waitForStablePage(page);

    const bodyText = await page.locator('body').innerText({ timeout: 30000 });
    diagnostics.officePatientText = bodyText.slice(0, 5000);
    await attachScreenshot(page, testInfo, '05-office-pasien-tab-pasien');
    expect(bodyText).toContain('KN-AI-');
  });

  await testInfo.attach('import-10000-pasien-diagnostics.json', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json',
  });
});

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForStablePage(page);
  await page.locator('input[name="username"], input[type="text"]').first().fill(USERNAME);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[data-test="login-btn"], button:has-text("Login")').first().click();
  await waitForStablePage(page);
}

async function ensureBranch(page) {
  if ((await page.locator('body').innerText({ timeout: 10000 })).includes(BRANCH_NAME)) return;
  await page.locator('[data-test="change-account-button-arrow"]').click({ force: true });
  await page.getByText(BRANCH_OPTION, { exact: false }).click({ force: true });
  await waitForStablePage(page);
}

async function openEmrSettings(page) {
  await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded' });
  await waitForStablePage(page);
  await closeTutorial(page);
  await page.getByText('General Settings', { exact: true }).click({ force: true }).catch(() => {});

  await clickSettingsSubmenu(page, 'EMR');
  await waitForStablePage(page);
  await expect(page.locator('body')).toContainText(/General Settings\s*>\s*EMR|Data Entry/i, { timeout: 30000 });
}

async function openDataEntry(page) {
  await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded' });
  await waitForStablePage(page);
  await closeTutorial(page);

  const hasDataEntry = await hasVisibleText(page, 'Data Entry');
  if (!hasDataEntry) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForStablePage(page);
  }

  const dataEntryButton = page.getByRole('button', { name: /^Data Entry$/i });
  await expect(dataEntryButton, 'Submenu Data Entry harus muncul setelah modul diaktifkan').toBeVisible({
    timeout: 30000,
  });
  await dataEntryButton.click({ force: true });
  await waitForStablePage(page);
}

async function clickSettingsSubmenu(page, text) {
  const clicked = await page.evaluate((targetText) => {
    const candidates = Array.from(document.querySelectorAll('div, span, button, a')).filter((element) => {
      const rect = element.getBoundingClientRect();
      return (
        (element.innerText || element.textContent || '').trim() === targetText &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x > 250
      );
    });
    const target = candidates[candidates.length - 1];
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.click();
    return true;
  }, text);

  if (!clicked) {
    throw new Error(`Settings submenu "${text}" tidak ditemukan`);
  }
}

async function hasVisibleText(page, text) {
  return page.evaluate((targetText) => {
    return Array.from(document.querySelectorAll('div, span, button, a')).some((element) => {
      const rect = element.getBoundingClientRect();
      return (element.innerText || element.textContent || '').trim() === targetText && rect.width > 0 && rect.height > 0;
    });
  }, text);
}

async function clickImportDataPasienAction(page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const labelButton = buttons.find((button) => /Import Data Pasien/i.test(button.innerText || button.textContent || ''));
    if (!labelButton) return false;
    let row = labelButton.parentElement;
    while (row && row.querySelectorAll('button').length < 2) {
      row = row.parentElement;
    }
    const rowButtons = row ? Array.from(row.querySelectorAll('button')) : [labelButton];
    const actionButton = rowButtons[rowButtons.length - 1] || labelButton;
    actionButton.click();
    return true;
  });

  if (!clicked) {
    throw new Error('Tombol action Import Data Pasien tidak ditemukan');
  }
}

async function closeTutorial(page) {
  for (const label of ['CLOSE', 'Close', 'Tutup']) {
    const button = page.getByText(label, { exact: true });
    if (await button.count()) {
      await button.first().click({ force: true });
      await page.waitForTimeout(500);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function closeBlockingDialogs(page) {
  const closeButtons = [
    page.locator('[role="dialog"] button').filter({ hasText: /^$/ }).first(),
    page.getByRole('button', { name: /close|tutup|×|x/i }).first(),
  ];

  for (const button of closeButtons) {
    if (await button.count()) {
      await button.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}


async function waitForStablePage(page, timeout = 45000) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
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

function generatePatientCsvFromTemplate(templatePath, outputPath, patientCount) {
  if (!/\.csv$/i.test(templatePath)) {
    throw new Error(`Template yang terdownload bukan CSV: ${templatePath}`);
  }

  const templateText = fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(templateText);
  const headerIndex = findHeaderRow(rows);
  const header = rows[headerIndex];
  const columnMap = mapColumns(header);
  const outputRows = rows.slice(0, headerIndex + 1);

  for (let index = 1; index <= patientCount; index += 1) {
    const patient = buildPatient(index);
    const row = new Array(header.length).fill('');
    setByAlias(row, columnMap, ['nama_lengkap', 'nama pasien', 'nama', 'patient name'], patient.name);
    setByAlias(row, columnMap, ['tanggal_lahir', 'tanggal lahir', 'tgl lahir', 'birth date', 'dob'], BIRTH_DATE);
    setByAlias(row, columnMap, ['tempat_kelahiran', 'tempat lahir', 'kota lahir'], patient.birthTown);
    setByAlias(row, columnMap, ['jenis kelamin', 'gender'], patient.gender);
    setByAlias(row, columnMap, ['alamat', 'alamat rumah', 'address'], patient.address);
    setByAlias(row, columnMap, ['provinsi', 'province'], patient.province);
    setByAlias(row, columnMap, ['kabupaten', 'kota / kabupaten', 'kota/kabupaten', 'city'], patient.city);
    setByAlias(row, columnMap, ['kecamatan', 'district'], patient.district);
    setByAlias(row, columnMap, ['kelurahan', 'village'], patient.village);
    setByAlias(row, columnMap, ['kode_pos', 'kode pos', 'postcode', 'postal code'], patient.postalCode);
    setByAlias(row, columnMap, ['nomor_hp', 'no hp', 'nomor hp', 'telepon', 'phone'], patient.phone);
    setByAlias(row, columnMap, ['agama'], 'Tidak Tahu');
    setByAlias(row, columnMap, ['pendidikan', 'pendidikan terakhir'], 'Lainnya');
    setByAlias(row, columnMap, ['pekerjaan'], 'Lainnya');
    setByAlias(row, columnMap, ['status pernikahan', 'status'], 'Belum Menikah');
    setByAlias(row, columnMap, ['nama_metode_pembayaran_1'], 'Lainnya');
    setByAlias(row, columnMap, ['tipe_metode_pembayaran_1'], 'lainnya');
    setByAlias(row, columnMap, ['golongan_darah'], 'Tidak Tahu');
    outputRows.push(row);
  }

  fs.writeFileSync(outputPath, stringifyCsv(outputRows), 'utf8');
  return {
    headerIndex,
    columnCount: header.length,
    rowsWritten: patientCount,
    mappedColumns: Object.fromEntries(Object.entries(columnMap).map(([key, value]) => [key, header[value]])),
  };
}

function buildPatient(index) {
  const areas = [
    ['JAWA BARAT', 'KAB. BANDUNG', 'CIMENYAN', 'CIBURIAL', '40198'],
    ['JAWA BARAT', 'KOTA BANDUNG', 'COBLONG', 'DAGO', '40135'],
    ['DKI JAKARTA', 'KOTA ADM. JAKARTA SELATAN', 'KEBAYORAN BARU', 'GUNUNG', '12120'],
    ['BANTEN', 'KOTA TANGERANG SELATAN', 'SERPONG', 'RAWA BUNTU', '15310'],
  ];
  const [province, city, district, village, postalCode] = areas[(index - 1) % areas.length];
  const suffix = String(index).padStart(4, '0');
  return {
    name: `KN-AI-Nama Random-${suffix}`,
    birthTown: city.replace(/^KAB\. |^KOTA |^KOTA ADM\. /, ''),
    gender: index % 2 === 0 ? 'Perempuan' : 'Laki-laki',
    address: `Jl. QA Import ${suffix} Blok ${String.fromCharCode(65 + ((index - 1) % 26))} No. ${1 + (index % 97)}`,
    province,
    city,
    district,
    village,
    postalCode,
    phone: `0812${String(50000000 + index).padStart(8, '0')}`,
  };
}

function findHeaderRow(rows) {
  const index = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell).includes('nama')) && row.length >= 3);
  if (index === -1) throw new Error('Header CSV tidak ditemukan. Tidak ada kolom nama pasien/nama.');
  return index;
}

function mapColumns(header) {
  const map = {};
  header.forEach((name, index) => {
    const normalized = normalizeHeader(name);
    if (normalized) map[normalized] = index;
  });
  return map;
}

function setByAlias(row, columnMap, aliases, value) {
  const index = aliases.map(normalizeHeader).map((alias) => columnMap[alias]).find((candidate) => candidate !== undefined);
  if (index !== undefined) row[index] = value;
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ''));
  rows.push(row);
  return rows.filter((csvRow) => csvRow.some((cell) => cell !== ''));
}

function stringifyCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
