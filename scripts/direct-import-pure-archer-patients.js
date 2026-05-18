const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', 'diagnostics', 'pure-archer-import-10000');
const DIAGNOSTICS_PATH = path.join(OUT_DIR, 'diagnostics.json');
const RESULT_PATH = path.join(OUT_DIR, 'direct-api-import-result.json');
const TOKEN = JSON.parse(fs.readFileSync(DIAGNOSTICS_PATH, 'utf8')).branchAfterSwitch.storage.local.token;
const HOSPITAL_ID = '69fd8e16736ffcbc7cf090b3';
const USER_ID = '69fc0e29ad92805df724897d';
const COUNT = Number(process.env.PATIENT_IMPORT_COUNT || 10001);
const CONCURRENCY = Number(process.env.PATIENT_IMPORT_CONCURRENCY || 5);
const RETRY_FAILED_FROM = process.env.RETRY_FAILED_FROM;

const religions = ['Islam', 'Katolik', 'Protestan', 'Kristen', 'Hindu', 'Buddha', 'Konghucu'];
const bloodTypes = ['A', 'B', 'AB', 'O'];
const jobs = ['Karyawan Swasta', 'Wiraswasta', 'Guru', 'Mahasiswa'];
const educations = ['SMA', 'Diploma (D3)', 'Sarjana (S1)', 'Master (S2)'];
const statuses = ['Menikah', 'Belum Menikah'];

const result = {
  startedAt: new Date().toISOString(),
  mode: 'direct-api-fallback-after-ui-filechooser-blocked',
  hospitalId: HOSPITAL_ID,
  requested: COUNT,
  retryFailedFrom: RETRY_FAILED_FROM || null,
  concurrency: CONCURRENCY,
  successes: [],
  failures: [],
};

main().catch((error) => {
  result.error = { message: error.message, stack: error.stack };
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.error(error);
  process.exit(1);
});

async function main() {
  const queue = RETRY_FAILED_FROM
    ? JSON.parse(fs.readFileSync(RETRY_FAILED_FROM, 'utf8')).failures.map((failure) => failure.index)
    : Array.from({ length: COUNT }, (_, index) => index + 1);
  result.requested = queue.length;
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue));
  await Promise.all(workers);
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    requested: result.requested,
    success: result.successes.length,
    failed: result.failures.length,
    resultPath: RESULT_PATH,
  }));
}

async function worker(queue) {
  while (queue.length) {
    const index = queue.shift();
    try {
      const payload = buildPatient(index);
      const response = await fetch('https://api-dev-essensial.assist.id/api/Pasiens/postDetail', {
        method: 'POST',
        headers: {
          Authorization: TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) {
        result.failures.push({ index, status: response.status, body: text.slice(0, 1000) });
      } else {
        const body = JSON.parse(text);
        result.successes.push({
          index,
          id: body.patient?.id || body.id,
          name: payload.nama,
          mr: body.patient?.ph?.[0]?.code,
        });
      }
    } catch (error) {
      result.failures.push({ index, error: error.message });
    }

    const done = result.successes.length + result.failures.length;
    if (done % 500 === 0) {
      fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
      console.log(`processed=${done} success=${result.successes.length} failed=${result.failures.length}`);
    }
  }
}

function buildPatient(index) {
  const code = String(index).padStart(5, '0');
  const gender = index % 2 === 0 ? 2 : 1;
  const birthYear = 1970 + (index % 35);
  const birthMonth = (index % 12) + 1;
  const birthDay = (index % 27) + 1;
  const createdAt = '2026/05/18';
  const postcode = String(10000 + (index % 89999)).slice(0, 5);
  const address = `Jl. QA Import No. ${index}`;

  return {
    nama: `PA-AI-Import-${code}`,
    noKTP: `3174${String(800000000000 + index).padStart(12, '0')}`.slice(0, 16),
    tanggalLahir: `${birthYear}/${String(birthMonth).padStart(2, '0')}/${String(birthDay).padStart(2, '0')}`,
    gender,
    ph: [{ code: '', id_rs: HOSPITAL_ID, date: createdAt, id: Date.now() + index }],
    religion: religions[index % religions.length],
    birth_place: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'][index % 4],
    address: { jalan: address, district: '', subdistrict: '', city: '', region: '', postcode },
    address_domicile: `${address}, , , , ${postcode}`,
    status: statuses[index % statuses.length],
    job: jobs[index % jobs.length],
    blood_type: bloodTypes[index % bloodTypes.length],
    phone: `0812${String(70000000 + index).slice(-8)}`,
    email: `pa.ai.import.${code}@example.test`,
    education: educations[index % educations.length],
    isShareMr: false,
    isGenerateMrCode: true,
    created_at: createdAt,
    created_id: USER_ID,
    family: [{
      name: `Keluarga ${code}`,
      relation: index % 2 ? 'Saudara' : 'Orang Tua',
      gender: gender === 1 ? 2 : 1,
      phoneNumber: `0821${String(60000000 + index).slice(-8)}`,
      bloodType: bloodTypes[(index + 1) % bloodTypes.length],
      occupation: jobs[(index + 1) % jobs.length],
      address: `Jl. Keluarga QA No. ${index}, Cilandak, Jakarta Selatan, DKI Jakarta, 12430`,
      full_address: {
        subdistrict: 'Cilandak',
        district: 'Jakarta Selatan',
        region: 'DKI Jakarta',
        postcode: '12430',
      },
      email: `keluarga.${code}@example.test`,
      created_at: createdAt,
      created_id: USER_ID,
      id: Date.now() + index,
    }],
    paymentMethod: [{
      name: 'Cash',
      type: 'cash',
      no: '',
      created_at: createdAt,
      created_id: USER_ID,
      id: Date.now() + index,
    }],
    isImportFromDataEntry: true,
  };
}
