import assert from 'node:assert';
import {
  summarizeOverview,
  summarizeTripReport,
  summarizeFleetHealth,
  summarizePredictive,
  summarizeSecurity,
  summarizeSafety,
  summarizeFuel,
} from './summary';
import type { HealthSummary } from './fleet-health';
import type { DeviceSignals } from './predictive';

// Setiap ringkasan diuji tiga kondisi: normal, nol, dan data tidak tersedia.
// Kondisi kedua dan ketiga yang paling sering merusak ringkasan otomatis —
// "0 pelanggaran" dan "Rule tidak pernah dibuat" harus berbunyi berbeda.

const has = (s: string, ...bits: string[]) => bits.every((b) => s.includes(b));
/** Tidak boleh ada kalimat yang bocor NaN / Infinity / undefined ke pelanggan. */
const clean = (s: string) => {
  assert.ok(s.length > 0, 'ringkasan kosong');
  for (const bad of ['NaN', 'Infinity', 'undefined', 'null', '[object']) {
    assert.ok(!s.includes(bad), `ringkasan bocor "${bad}": ${s}`);
  }
  return s;
};

// --- Ringkasan --------------------------------------------------------------
{
  const base = {
    utilizationPct: 42.5,
    idleSec: 7200,
    engineHoursApprox: 20,
    exceptions: { low: 3, medium: 2, high: 1 },
    deviceCount: 12,
    tripCount: 88,
    hoursPerDay: 10,
    daysPerWeek: 6,
  };
  const normal = clean(summarizeOverview(base));
  assert.ok(has(normal, '12 unit', '42,5%'), normal);
  // Utilisasi heuristik: basisnya WAJIB disebut, kalau tidak angkanya terbaca resmi.
  assert.ok(has(normal, 'jam kerja yang Anda tetapkan'), normal);
  assert.ok(has(normal, 'tingkat tinggi'), normal);

  // Idle 2 jam dari 20 jam mesin = 10%, di bawah ambang → tidak disebut.
  assert.ok(!normal.includes('idle'), `idle 10% tidak perlu disebut: ${normal}`);
  const idler = clean(summarizeOverview({ ...base, idleSec: 36000 })); // 10j dari 20j
  assert.ok(has(idler, 'idle', '50%'), idler);

  const noExceptions = clean(summarizeOverview({ ...base, exceptions: { low: 0, medium: 0, high: 0 } }));
  assert.ok(has(noExceptions, 'Tidak ada pelanggaran'), noExceptions);

  // Nol trip harus dibedakan dari nol unit.
  const noTrips = clean(summarizeOverview({ ...base, tripCount: 0 }));
  assert.ok(has(noTrips, 'tidak ada perjalanan'), noTrips);
  const noDevices = clean(summarizeOverview({ ...base, deviceCount: 0 }));
  assert.ok(has(noDevices, 'Tidak ada unit'), noDevices);

  // Armada kosong / rentang nol tidak boleh mencetak NaN.
  clean(
    summarizeOverview({
      ...base,
      utilizationPct: NaN,
      engineHoursApprox: 0,
      idleSec: 0,
      deviceCount: 1,
      tripCount: 1,
    })
  );
}

// --- Laporan Perjalanan -----------------------------------------------------
{
  const base = {
    journeys: 40,
    roundTrips: 12,
    tripCount: 130,
    unmatchedTrips: 9,
    unmatchedKm: 412.5,
    zoneCount: 6,
    dwellMinutes: 15,
  };
  const normal = clean(summarizeTripReport(base));
  assert.ok(has(normal, '40 perjalanan', '130 trip', '15 menit', 'pulang-pergi'), normal);
  assert.ok(has(normal, 'tambahkan geofence'), normal);

  // Tanpa zona, angka apa pun mustahil — kalimatnya harus menyuruh bikin zona.
  const noZones = clean(summarizeTripReport({ ...base, zoneCount: 0 }));
  assert.ok(has(noZones, 'Belum ada zona'), noZones);

  // Ada trip tapi nol perjalanan: armadanya jalan, zonanya yang kurang.
  const noMatch = clean(summarizeTripReport({ ...base, journeys: 0, roundTrips: 0 }));
  assert.ok(has(noMatch, 'Armada Anda jalan'), noMatch);

  const noTrips = clean(summarizeTripReport({ ...base, tripCount: 0, journeys: 0 }));
  assert.ok(has(noTrips, 'Tidak ada perjalanan sama sekali'), noTrips);
}

// --- Kesehatan Armada -------------------------------------------------------
{
  const s = (o: Partial<HealthSummary>): HealthSummary => ({
    devicesWithActiveFaults: 7,
    totalDevices: 40,
    pctAffected: 17.5,
    criticalLampCount: 2,
    activeCount: 15,
    pendingCount: 4,
    resolvedCount: 20,
    byState: {},
    ...o,
  });

  const normal = clean(summarizeFleetHealth(s({})));
  assert.ok(has(normal, '7 dari 40 unit', 'lampu MIL', 'hari ini'), normal);
  assert.ok(has(normal, 'pending'), normal);

  // Tanpa lampu kritis: harus tetap mengatakan tidak ada yang perlu dikandangkan.
  const noLamp = clean(summarizeFleetHealth(s({ criticalLampCount: 0 })));
  assert.ok(has(noLamp, 'Tidak ada yang menyalakan lampu kritis'), noLamp);

  // Semua sudah selesai — ini nol yang sebenarnya, bukan data hilang.
  const allClear = clean(summarizeFleetHealth(s({ activeCount: 0, pendingCount: 0, devicesWithActiveFaults: 0 })));
  assert.ok(has(allClear, 'memang nol, bukan data yang hilang'), allClear);

  // Data fault tidak ada sama sekali — jangan sampai terbaca "armada sehat".
  const noData = clean(summarizeFleetHealth(null));
  assert.ok(has(noData, 'bukan berarti armada sehat'), noData);

  clean(summarizeFleetHealth(s({ totalDevices: 0, devicesWithActiveFaults: 0, pctAffected: NaN })));
}

// --- Prediksi Servis --------------------------------------------------------
{
  const row = (o: Partial<DeviceSignals>): DeviceSignals => ({
    deviceId: 'd1',
    deviceName: 'B 1234 XX',
    flags: [],
    chronicCount: 0,
    openDefects: 0,
    ...o,
  });
  const base = {
    rows: [
      row({ deviceId: 'a', deviceName: 'B 1 AA', flags: ['Servis jatuh tempo'] }),
      row({ deviceId: 'b', deviceName: 'B 2 BB', flags: ['Fault kronis', 'Tren memburuk', 'Servis jatuh tempo'] }),
      row({ deviceId: 'c', deviceName: 'B 3 CC' }),
    ],
    chronicSeries: 5,
    hasOdometer: true,
    hasFaults: true,
    hasDvir: false,
    intervalKm: 10000,
  };
  const normal = clean(summarizePredictive(base));
  // Unit dengan flag TERBANYAK yang harus disebut, bukan yang pertama di list.
  assert.ok(has(normal, '2 dari 3 unit', 'B 2 BB'), normal);
  assert.ok(has(normal, 'kronis'), normal);
  assert.ok(has(normal, '10.000 km'), normal);

  const noFlags = clean(summarizePredictive({ ...base, rows: [row({})], chronicSeries: 0 }));
  assert.ok(has(noFlags, 'Tidak ada unit yang tertandai'), noFlags);

  const noSignals = clean(
    summarizePredictive({ ...base, hasOdometer: false, hasFaults: false, hasDvir: false })
  );
  assert.ok(has(noSignals, 'tidak bisa diukur'), noSignals);

  clean(summarizePredictive({ ...base, rows: [] }));
}

// --- Keamanan & Darurat -----------------------------------------------------
{
  const base = {
    panic: 2,
    accident: 1,
    offHoursTrips: 6,
    geofence: 0,
    tripCount: 90,
    configured: { panic: true, accident: true, geofence: true },
    shiftLabel: '07:00–17:00',
    shiftHours: 10,
  };
  const normal = clean(summarizeSecurity(base));
  assert.ok(has(normal, '2 panik/SOS', '1 kecelakaan'), normal);
  // Pergerakan tak sah TIDAK boleh disajikan sebagai bukti pelanggaran.
  assert.ok(has(normal, 'bukan bukti pelanggaran'), normal);

  // Shift 24 jam (profil tambang): nol-nya harus dijelaskan, bukan dibiarkan.
  const mining = clean(summarizeSecurity({ ...base, shiftHours: 24, offHoursTrips: 0 }));
  assert.ok(has(mining, 'selalu 0'), mining);

  const nothingConfigured = clean(
    summarizeSecurity({ ...base, configured: { panic: false, accident: false, geofence: false }, panic: 0, accident: 0 })
  );
  assert.ok(has(nothingConfigured, 'tidak akan pernah menampilkan insiden'), nothingConfigured);

  const quiet = clean(summarizeSecurity({ ...base, panic: 0, accident: 0, offHoursTrips: 0 }));
  assert.ok(has(quiet, 'Tidak ada insiden panik'), quiet);

  const partial = clean(
    summarizeSecurity({ ...base, panic: 0, accident: 0, configured: { panic: false, accident: true, geofence: true } })
  );
  assert.ok(has(partial, 'belum dikonfigurasi'), partial);
}

// --- Perilaku Berkendara ----------------------------------------------------
{
  const base = {
    events: 120,
    totalKm: 4000,
    fleetPer100: 3,
    ranked: [
      { deviceId: 'a', name: 'B 9 ZZ', events: 60, km: 400, per100Km: 15 },
      { deviceId: 'b', name: 'B 8 YY', events: 60, km: 3600, per100Km: 1.7 },
    ],
    missingCategories: ['Sabuk Pengaman'],
    anyRuleConfigured: true,
    driverAttributionPct: 80,
  };
  const normal = clean(summarizeSafety(base));
  assert.ok(has(normal, '120 pelanggaran', 'B 9 ZZ'), normal);
  // Yang membuat halaman ini berguna: peringkat per 100 km, bukan jumlah mentah.
  assert.ok(has(normal, 'bukan dari unit dengan jumlah mentah terbanyak'), normal);
  assert.ok(has(normal, 'dikosongkan, bukan nol'), normal);

  const lowAttribution = clean(summarizeSafety({ ...base, driverAttributionPct: 12 }));
  assert.ok(has(lowAttribution, 'peringkat per sopir disembunyikan'), lowAttribution);

  // Nol pelanggaran DENGAN Rule aktif = nol sungguhan.
  const trueZero = clean(summarizeSafety({ ...base, events: 0 }));
  assert.ok(has(trueZero, 'nol yang sebenarnya'), trueZero);

  // Nol pelanggaran TANPA Rule = tidak pernah ada yang diukur. Harus beda bunyi.
  const noRules = clean(summarizeSafety({ ...base, events: 0, anyRuleConfigured: false }));
  assert.ok(has(noRules, 'Belum ada Rule keselamatan'), noRules);
  assert.notEqual(trueZero, noRules, 'nol-sungguhan dan tanpa-Rule tidak boleh berbunyi sama');

  const noDistance = clean(summarizeSafety({ ...base, totalKm: 0, fleetPer100: null, ranked: [] }));
  assert.ok(has(noDistance, 'belum bisa dihitung'), noDistance);
}

// --- Konsumsi BBM -----------------------------------------------------------
{
  const base = {
    source: 'transactions' as const,
    totalL: 1500,
    totalKm: 5000,
    avgLper100: 30,
    idleWasteL: 120,
    litresPer100Km: 30,
    litresPerIdleHour: 2,
  };
  const measured = clean(summarizeFuel(base));
  assert.ok(has(measured, '1.500 L', '5.000 km', 'transaksi kartu BBM'), measured);
  // Idle SELALU heuristik walau sumber liternya terukur.
  assert.ok(has(measured, 'bukan dari MyGeotab'), measured);

  // Level tangki = estimasi. Batasannya wajib disebut di kalimat yang sama,
  // bukan di catatan kaki yang bisa terlewat.
  const level = clean(summarizeFuel({ ...base, source: 'level' }));
  assert.ok(has(level, 'estimasi', 'diabaikan', 'kapasitas tangki'), level);

  // Sumber jarak bukan pengukuran sama sekali — tidak boleh terdengar temuan.
  const guessed = clean(summarizeFuel({ ...base, source: 'distance' }));
  assert.ok(has(guessed, 'BUKAN hasil pengukuran'), guessed);
  assert.ok(has(guessed, 'sama efisien'), guessed);
  assert.ok(!guessed.includes('boros'), `sumber tebakan tidak boleh menghakimi armada: ${guessed}`);

  const none = clean(summarizeFuel({ ...base, source: 'none' }));
  assert.ok(has(none, 'Tidak ada data BBM'), none);

  clean(summarizeFuel({ ...base, totalL: 0, totalKm: 0, avgLper100: null, idleWasteL: 0 }));
}

console.log('summary.check.ts OK');
