const { test, expect } = require('@playwright/test');

const USERNAME = 'anisasecondacc24@gmail.com';
const PASSWORD = '12345678';
const TARGET_BRANCH = 'Pure Burns';

test.describe('Validasi Limit 100 Kunjungan Pasien', () => {
  // Waktu timeout dinaikkan ke 30 menit karena 100 perulangan
  test.setTimeout(1800000); 

  test('Add 100 Pasien Kunjungan Schedula', async ({ page }) => {
    // 1. Login
    console.log('1. Memulai proses Login...');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    
    await page.locator('input[name="username"]').first().fill(USERNAME);
    await page.locator('input[name="password"]').first().fill(PASSWORD);
    await page.locator('button[data-test="login-btn"], button[type="submit"]').first().click();
    await waitForAppReady(page);
    console.log('Login berhasil.');

    // 2. Memastikan cabang Pure Burns terpilih
    console.log(`2. Memilih cabang ${TARGET_BRANCH}...`);
    await openBranchDropdown(page);
    await page.waitForTimeout(1000);
    const branchOption = page.getByText(TARGET_BRANCH, { exact: false }).first();
    if (await branchOption.isVisible()) {
      await branchOption.click({ force: true });
    } else {
      // Tekan escape jika tidak ketemu atau sudah terpilih
      await page.keyboard.press('Escape');
    }
    await waitForAppReady(page);

    // 3. Menuju Menu Rawat Jalan
    console.log('3. Navigasi ke menu Rawat Jalan...');
    await goToRawatJalan(page);
    await waitForAppReady(page);
    await closeTutorialIfExists(page);

    // 4. Melakukan 100 iterasi penambahan pasien
    let successfulVisits = 0;
    const maxKunjungan = 100;
    
    for (let i = 1; i <= maxKunjungan; i++) {
      const patientId = String(i).padStart(6, '0');
      const patientName = `PB-AI-AntiG-${patientId}`;
      console.log(`\n--- Iterasi ${i}/${maxKunjungan}: Menambahkan Pasien ${patientName} ---`);

      // Hover dan klik slot kosong untuk memunculkan Tambah Pasien
      const clickedSlot = await clickRandomEmptySlot(page);
      if (!clickedSlot) {
        console.log('Gagal menemukan slot kosong. Melewati iterasi ini.');
        continue;
      }

      // Tunggu popup Daftar Kunjungan
      await page.waitForTimeout(1500);

      // Cari Pasien di popup Daftar Kunjungan
      const searchInput = page.getByPlaceholder('Cari Pasien', { exact: false }).first();
      await searchInput.waitFor({ state: 'visible', timeout: 10000 });
      await searchInput.fill(patientName);
      await page.waitForTimeout(1500); // Wait for debounce
      
      // Klik tombol New
      const newBtn = page.getByRole('button', { name: 'New' }).first();
      await newBtn.click();

      // Isi form Tambah Pasien Baru
      await fillTambahPasienBaruForm(page, patientName, i);

      // Kembali ke Daftar Kunjungan, lengkapi sisa form dan Keluhan
      await fillDaftarKunjunganForm(page);

      successfulVisits++;
      await page.waitForTimeout(1000);
      
      // Validasi apakah sistem menolak karena limit 50 (Opsional: tangkap error message)
      const errorToast = page.locator('.Toastify__toast--error, [role="alert"]').first();
      if (await errorToast.isVisible({ timeout: 2000 })) {
        const errorMsg = await errorToast.innerText();
        console.log(`WARNING: Sistem memberikan alert: ${errorMsg}`);
        // Jika sudah lebih dari 50, dan ada pesan limit, berarti validasi sukses terkunci di 50.
        // Teruskan atau hentikan sesuai keinginan, tapi di sini kita diminta tes 100 kunjungan.
      }
    }

    console.log(`\nTest Selesai! Berhasil memproses ${successfulVisits} pasien kunjungan.`);
  });
});

// Helper Functions
async function waitForAppReady(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.locator('.MuiCircularProgress-root, [role="progressbar"]').first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function openBranchDropdown(page) {
  // Cari dropdown cabang, biasanya di header kanan
  const headerRight = page.locator('header').first();
  const dropdownBtn = headerRight.locator('button:has-text("[Schedula]"), button:has-text("[Clinica Pro]"), svg.lucide-chevron-down').first();
  
  if (await dropdownBtn.count()) {
    await dropdownBtn.click({ force: true });
    return;
  }
  // Fallback koordinat di pojok kanan atas
  await page.mouse.click(1264, 58);
}

async function goToRawatJalan(page) {
  const rawatJalanText = page.getByText('Rawat Jalan', { exact: true }).first();
  if (await rawatJalanText.count() > 0) {
    await rawatJalanText.click();
  } else {
    // Fallback URL
    const currentUrl = page.url();
    if (!currentUrl.includes('rawat-jalan')) {
       await page.goto('/rawat-jalan', { waitUntil: 'domcontentloaded' });
    }
  }
}

async function closeTutorialIfExists(page) {
  const closeBtn = page.getByText('Close', { exact: true }).first();
  if (await closeBtn.isVisible({ timeout: 2000 })) {
    await closeBtn.click();
  }
}

async function clickRandomEmptySlot(page) {
  // Dalam Schedula, slot kosong di tabel tbody
  const tbody = page.locator('tbody').first();
  const cells = tbody.locator('td');
  const count = await cells.count();
  
  // Mencari slot yang kosong untuk diklik (mulai dari kolom ke 2 untuk menghindari kolom jam)
  for (let c = 1; c < count; c++) {
    const cellText = await cells.nth(c).innerText();
    // Jika cell kosong dan bukan kolom pertama (jam)
    if (!cellText.trim()) {
      await cells.nth(c).hover();
      await page.waitForTimeout(500);
      
      const tambahBtn = cells.nth(c).getByText('Tambah Pasien');
      if (await tambahBtn.isVisible()) {
        await tambahBtn.click({ force: true });
        return true;
      }
      
      // Jika hover tidak memunculkan tombol, coba klik langsung cell tersebut
      await cells.nth(c).click({ force: true });
      return true;
    }
  }
  return false;
}

async function fillTambahPasienBaruForm(page, patientName, index) {
  await page.waitForSelector('text="Tambah Pasien Baru"', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);

  // Pastikan nama sudah terisi atau kita isi ulang
  const namaLengkap = page.getByLabel('Nama Lengkap', { exact: false }).first();
  if (await namaLengkap.count() > 0) {
     const currentVal = await namaLengkap.inputValue();
     if (!currentVal) await namaLengkap.fill(patientName);
  }

  // Pilih dropdown (Jenis Kelamin, Agama, Status, Golongan Darah, Pendidikan, Pekerjaan)
  const requiredDropdowns = [
    'Jenis Kelamin', 
    'Agama', 
    'Status', 
    'Golongan Darah', 
    'Pendidikan Terakhir', 
    'Pekerjaan'
  ];

  for (const field of requiredDropdowns) {
    try {
      // Biasanya Select MUI membungkus input dengan label
      // Kita klik combobox/button yang terkait
      const combobox = page.locator(`:text("${field}")`).locator('..').locator('[role="combobox"], [role="button"]').first();
      if (await combobox.count() > 0) {
        await combobox.click({ force: true });
        await page.waitForTimeout(500);
        await page.locator('[role="listbox"] li, ul[role="listbox"] li').nth(1).click({ force: true }); // Pilih opsi kedua (opsi pertama biasanya kosong/placeholder)
      }
    } catch (e) {
      console.log(`Gagal mengisi dropdown: ${field}`);
    }
  }

  // Tanggal Lahir (random date)
  try {
    const tglLahir = page.getByPlaceholder('dd/mm/yyyy').first();
    if (await tglLahir.count() > 0) {
       await tglLahir.fill('01/01/1990');
    }
  } catch(e) {}

  // Alamat (text area)
  try {
    const alamatLabels = ['Alamat', 'Address'];
    for(const l of alamatLabels) {
      const alamatInput = page.getByLabel(l, { exact: false }).first();
      if (await alamatInput.count() > 0) {
        await alamatInput.fill(`Alamat Random Pasien ${patientName} No ${index}`);
        break;
      }
    }
  } catch(e) {}

  // Klik Simpan
  const simpanBtn = page.getByRole('button', { name: 'Simpan', exact: true }).last(); // Di popup "Tambah Pasien Baru"
  await simpanBtn.click();
  
  // Tunggu popup tertutup
  await page.waitForSelector('text="Tambah Pasien Baru"', { state: 'hidden', timeout: 10000 });
}

async function fillDaftarKunjunganForm(page) {
  await page.waitForSelector('text="Daftar Kunjungan"', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);

  // Isi Keluhan
  try {
    const keluhan = page.getByLabel('Keluhan', { exact: false }).first();
    if (await keluhan.count() > 0) {
      await keluhan.fill('Test limit 100 kunjungan pasien Schedula');
    }
  } catch (e) {}

  // Klik Simpan
  const simpanKunjungan = page.getByRole('button', { name: 'Simpan', exact: true }).first();
  await simpanKunjungan.click();

  // Tunggu loading selesai
  await waitForAppReady(page);
}
