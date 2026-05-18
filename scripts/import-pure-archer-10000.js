const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const BASE_URL = 'https://dev-essensial.assist.id/';
const USERNAME = 'anisasecondacc24@gmail.com';
const PASSWORD = '12345678';
const BRANCH_NAME = 'Pure Archer [Clinica Pro]';
const PATIENT_COUNT = Number(process.env.PATIENT_IMPORT_COUNT || 10001);
const OUT_DIR = path.resolve(__dirname, '..', 'diagnostics', 'pure-archer-import-10000');

fs.mkdirSync(OUT_DIR, { recursive: true });

const diagnostics = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  branch: BRANCH_NAME,
  patientCount: PATIENT_COUNT,
  downloads: {},
  generatedCsv: null,
  upload: {},
  console: [],
  pageErrors: [],
  failedRequests: [],
  apiResponses: [],
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1510, height: 970 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      diagnostics.console.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push({ message: error.message, stack: error.stack });
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
    if (/api-dev-essensial|patient|pasien|import|data-entry|data_entry/i.test(url)) {
      diagnostics.apiResponses.push({
        status: response.status(),
        method: response.request().method(),
        url,
      });
    }
  });

  try {
    await login(page);
    await ensureBranch(page);
    await openImportModal(page);

    diagnostics.downloads.guide = {
      note: 'Guide is generated client-side as a PDF Blob by showManualBook; headers/rules were extracted from the same frontend bundle after Blob download crashed headless Chromium.',
    };
    const template = { path: 'frontend-bundle:data_pasien_assist.id_v3', headers: PATIENT_IMPORT_HEADERS };
    diagnostics.template = template;

    const csvPath = path.join(OUT_DIR, `PA-AI-Import-${PATIENT_COUNT}-patients.csv`);
    generatePatientCsv(csvPath, template.headers, PATIENT_COUNT);
    diagnostics.generatedCsv = {
      path: csvPath,
      sizeBytes: fs.statSync(csvPath).size,
      firstDataRow: readFirstDataRow(csvPath),
    };

    await page.screenshot({ path: path.join(OUT_DIR, '01-before-upload.png'), fullPage: true });
    await uploadCsv(page, csvPath);
    await page.screenshot({ path: path.join(OUT_DIR, '02-after-upload.png'), fullPage: true });

    diagnostics.finishedAt = new Date().toISOString();
    diagnostics.finalUrl = page.url();
    diagnostics.finalBodySnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
    fs.writeFileSync(path.join(OUT_DIR, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  } catch (error) {
    diagnostics.error = { message: error.message, stack: error.stack };
    await page.screenshot({ path: path.join(OUT_DIR, '99-error.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(OUT_DIR, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
})();

async function login(page) {
  await page.goto(`${BASE_URL}login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await stable(page);
  if (await page.locator('input[name="username"], input[type="text"]').first().isVisible().catch(() => false)) {
    await page.locator('input[name="username"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[data-test="login-btn"], button:has-text("Login")').first().click();
    await stable(page);
  }
}

async function ensureBranch(page) {
  if (/\/login/i.test(page.url())) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await stable(page);
  }
  let body = await page.locator('body').innerText({ timeout: 15000 });
  if (body.includes(BRANCH_NAME)) return;

  await page.locator('[data-test="change-account-button-arrow"]').waitFor({ state: 'visible', timeout: 60000 });
  diagnostics.branchBeforeSwitch = {
    url: page.url(),
    bodySnippet: body.slice(0, 2000),
    storage: await getStorageSnapshot(page),
  };
  await page.locator('[data-test="change-account-button-arrow"]').click({ force: true });
  diagnostics.branchMenuSnippet = (await page.locator('body').innerText({ timeout: 15000 })).slice(0, 4000);
  await page.getByRole('menuitem', { name: '- Pure Archer [Clinica Pro] (QA)' }).click({ force: true, timeout: 30000 });
  await page.getByText(BRANCH_NAME, { exact: false }).waitFor({ state: 'visible', timeout: 150000 }).catch(() => {});
  await stable(page, 30000);
  body = await page.locator('body').innerText({ timeout: 15000 });
  diagnostics.branchAfterSwitch = {
    url: page.url(),
    bodySnippet: body.slice(0, 4000),
    storage: await getStorageSnapshot(page),
  };
  if (/\/login/i.test(page.url())) {
    await page.locator('input[name="username"], input[type="text"]').first().fill(USERNAME);
    await page.locator('input[name="password"], input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[data-test="login-btn"], button:has-text("Login")').first().click();
    await stable(page);
    body = await page.locator('body').innerText({ timeout: 15000 });
    diagnostics.branchAfterRelogin = {
      url: page.url(),
      bodySnippet: body.slice(0, 4000),
      storage: await getStorageSnapshot(page),
    };
  }
  if (!body.includes(BRANCH_NAME)) {
    throw new Error(`Branch switch failed. Expected "${BRANCH_NAME}".`);
  }
}

async function openImportModal(page) {
  const sidebarSettings = page.locator('[data-test="sidebar-item-settings"]');
  if ((await sidebarSettings.count().catch(() => 0)) === 1) {
    await sidebarSettings.click({ force: true });
  } else {
    await page.goto(`${BASE_URL}settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await stable(page);
  await page.getByRole('button', { name: /^CLOSE$/i }).click({ force: true }).catch(() => {});
  await page.getByText('CLOSE', { exact: true }).click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  const dataEntryButton = page.getByRole('button', { name: /^Data Entry$/i });
  if (await dataEntryButton.count()) {
    await dataEntryButton.click({ force: true });
  } else {
    await page.getByText('Data Entry', { exact: true }).click({ force: true });
  }
  await stable(page);
  if ((await page.getByRole('button', { name: /^Import Data Pasien$/i }).count().catch(() => 0)) === 0) {
    await page.getByText('Data Entry', { exact: true }).click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  if ((await page.getByRole('button', { name: /^Import Data Pasien$/i }).count().catch(() => 0)) === 0) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await stable(page);
    await page.getByRole('button', { name: /^CLOSE$/i }).click({ force: true }).catch(() => {});
    await page.getByRole('button', { name: /^Data Entry$/i }).click({ force: true }).catch(() => {});
    await stable(page);
  }
  if ((await page.getByRole('button', { name: /^Import Data Pasien$/i }).count().catch(() => 0)) === 0) {
    await page.mouse.click(1476, 424);
    await stable(page);
    await page.getByRole('button', { name: /^Data Entry$/i }).click({ force: true }).catch(() => {});
    await page.waitForTimeout(5000);
  }

  await page.getByRole('button', { name: /^Import Data Pasien$/i }).click({ force: true });
  await stable(page);
  await page.getByText('Import Data Pasien', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
}

async function downloadByButtonText(page, matcher, label) {
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: matcher }).click({ force: true });
  const download = await downloadPromise;
  const targetPath = path.join(OUT_DIR, download.suggestedFilename());
  await download.saveAs(targetPath);
  diagnostics.downloads[label] = { path: targetPath, suggestedFilename: download.suggestedFilename() };
  return targetPath;
}

function readCsvTemplate(templatePath) {
  const raw = fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '');
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim().length);
  if (!firstLine) throw new Error(`Template CSV is empty: ${templatePath}`);
  return { path: templatePath, headers: parseCsvLine(firstLine) };
}

const PATIENT_IMPORT_HEADERS = [
  'id',
  'nama_lengkap',
  'no_ktp',
  'jenis_kelamin',
  'tempat_kelahiran',
  'tanggal_lahir',
  'nomor_mr',
  'agama',
  'alamat',
  'kode_pos',
  'status',
  'nama_metode_pembayaran_1',
  'tipe_metode_pembayaran_1',
  'nomor_metode_pembayaran_1',
  'pekerjaan',
  'nama_tags_1',
  'deskripsi_tags_1',
  'golongan_darah',
  'nomor_hp',
  'email',
  'pendidikan',
  'nama_keluarga_1',
  'hubungan_keluarga_1',
  'jenis_kelamin_keluarga_1',
  'golongan_darah_keluarga_1',
  'pekerjaan_keluarga_1',
  'nomor_hp_keluarga_1',
  'email_keluarga_1',
  'alamat_keluarga_1',
  'kecamatan_keluarga_1',
  'kabupaten_keluarga_1',
  'provinsi_keluarga_1',
  'kode_pos_keluarga_1',
];

function generatePatientCsv(filePath, headers, count) {
  const rows = [headers.map(csvEscape).join(',')];
  for (let index = 1; index <= count; index += 1) {
    rows.push(headers.map((header) => csvEscape(valueForHeader(header, index))).join(','));
  }
  fs.writeFileSync(filePath, rows.join('\n'));
}

function valueForHeader(header, index) {
  const key = normalizeHeader(header);
  const code = String(index).padStart(5, '0');
  const gender = index % 2 === 0 ? '2' : '1';
  const bloodTypes = ['A', 'B', 'AB', 'O'];
  const religions = ['Islam', 'Katolik', 'Protestan', 'Kristen', 'Hindu', 'Buddha', 'Konghucu'];
  const paymentMethods = ['Umum', 'Asuransi'];
  const tags = ['QA Import', 'Automation', 'Batch Large'];

  const values = {
    id: '',
    nama_lengkap: `PA-AI-Import-${code}`,
    no_ktp: `3174${String(800000000000 + index).padStart(12, '0')}`.slice(0, 16),
    jenis_kelamin: gender,
    tempat_kelahiran: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'][index % 4],
    tanggal_lahir: `${String((index % 27) + 1).padStart(2, '0')}/${String((index % 12) + 1).padStart(2, '0')}/${1970 + (index % 35)}`,
    nomor_mr: '',
    agama: religions[index % religions.length],
    alamat: `Jl. QA Import No. ${index}, Kelurahan Automation`,
    kode_pos: String(10000 + (index % 89999)).slice(0, 5),
    status: index % 2 ? 'Menikah' : 'Belum Menikah',
    golongan_darah: bloodTypes[index % bloodTypes.length],
    kewarganegaraan: 'Indonesia',
    suku: ['Jawa', 'Sunda', 'Betawi', 'Batak'][index % 4],
    pekerjaan: ['Karyawan Swasta', 'Wiraswasta', 'Guru', 'Mahasiswa'][index % 4],
    perusahaan: `PT QA ${code}`,
    no_hp: `0812${String(70000000 + index).slice(-8)}`,
    nomor_hp: `0812${String(70000000 + index).slice(-8)}`,
    email: `pa.ai.import.${code}@example.test`,
    pendidikan: ['SMA', 'D3', 'S1', 'S2'][index % 4],
    deskripsi_tags_1: `Tag automation ${code}`,
    nama_tags_1: tags[index % tags.length],
    nama_metode_pembayaran_1: paymentMethods[index % paymentMethods.length],
    nomor_asuransi_1: `INS${code}`,
    nama_asuransi_1: `Asuransi QA ${index % 5}`,
    nomor_kartu_1: `CARD${code}`,
    nama_kontak_darurat_1: `Kontak Darurat ${code}`,
    hubungan_kontak_darurat_1: index % 2 ? 'Saudara' : 'Orang Tua',
    nomor_kontak_darurat_1: `0821${String(60000000 + index).slice(-8)}`,
    nama_keluarga_1: `Keluarga ${code}`,
    hubungan_keluarga_1: index % 2 ? 'Saudara' : 'Orang Tua',
    jenis_kelamin_keluarga_1: gender === '1' ? '2' : '1',
    golongan_darah_keluarga_1: bloodTypes[(index + 1) % bloodTypes.length],
    pekerjaan_keluarga_1: ['Karyawan Swasta', 'Wiraswasta', 'Guru', 'Mahasiswa'][(index + 1) % 4],
    nomor_hp_keluarga_1: `0821${String(60000000 + index).slice(-8)}`,
    email_keluarga_1: `keluarga.${code}@example.test`,
    alamat_keluarga_1: `Jl. Keluarga QA No. ${index}`,
    kecamatan_keluarga_1: 'Cilandak',
    kabupaten_keluarga_1: 'Jakarta Selatan',
    provinsi_keluarga_1: 'DKI Jakarta',
    kode_pos_keluarga_1: '12430',
  };

  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  if (key.includes('tanggal')) return '';
  if (key.includes('email')) return `pa.ai.import.${code}@example.test`;
  if (key.includes('no_hp') || key.includes('nomor_hp') || key.includes('telepon')) return `0813${String(50000000 + index).slice(-8)}`;
  if (key.includes('alamat')) return `Jl. QA Import No. ${index}`;
  if (key.includes('nama')) return `QA ${key.replace(/_/g, ' ')} ${code}`;
  if (key.includes('deskripsi')) return `Randomized optional ${code}`;
  return '';
}

async function uploadCsv(page, csvPath) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 30000 }),
    page.getByRole('button', { name: /^Upload$/i }).click({ force: true }),
  ]);
  await fileChooser.setFiles(csvPath);
  diagnostics.upload.selectedFileAt = new Date().toISOString();
  await stable(page, 120000);
  diagnostics.upload.bodyAfterFileSelect = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);

  const confirmButtons = [
    page.getByRole('button', { name: /^Upload$/i }),
    page.getByRole('button', { name: /Simpan|Import|Proses|Submit|Ya/i }),
  ];
  for (const button of confirmButtons) {
    if ((await button.count().catch(() => 0)) === 1 && (await button.isVisible().catch(() => false))) {
      await button.click({ force: true }).catch(() => {});
      await stable(page, 180000);
      break;
    }
  }
  diagnostics.upload.bodyAfterSubmit = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
}

async function stable(page, timeout = 45000) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await page.locator('.MuiCircularProgress-root, [role="progressbar"]').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function readFirstDataRow(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  return lines[1] || '';
}

async function getStorageSnapshot(page) {
  return page
    .evaluate(() => {
      const read = (storage) => {
        const result = {};
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (/hospital|branch|account|token|clinica|user|role|product|persist/i.test(key)) {
            result[key] = String(storage.getItem(key)).slice(0, 1000);
          }
        }
        return result;
      };
      return { local: read(localStorage), session: read(sessionStorage) };
    })
    .catch((error) => ({ error: error.message }));
}
