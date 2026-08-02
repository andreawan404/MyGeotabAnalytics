import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { PROFILES, KEYS, profileById, diffSettings, type ProfileSettings } from './operating-profile';

// --- 1. Key localStorage tidak boleh melenceng dari view pemiliknya ---------
//
// Profil menulis ke key yang dimiliki view lain. Kalau salah satu view mengganti
// prefix-nya, profil akan menulis ke key yatim dan diam-diam tidak berefek —
// gagal tanpa error, jenis kerusakan yang paling lama tidak ketahuan. Check ini
// membaca file pemiliknya dan memastikan literal-nya masih ada.
const KEY_OWNER: Array<[string, string]> = [
  [KEYS.working, 'src/components/kpi-card.ts'],
  [KEYS.fuel, 'src/views/fuel.ts'],
  [KEYS.service, 'src/views/predictive-maintenance.ts'],
  [KEYS.security, 'src/views/security.ts'],
  [KEYS.dwell, 'src/views/trip-report.ts'],
];
for (const [key, owner] of KEY_OWNER) {
  const src = readFileSync(owner, 'utf8');
  assert.ok(src.includes(key), `key "${key}" tidak ditemukan lagi di ${owner} — profil akan menulis ke key yatim`);
}

// --- 2. Tiap profil lengkap dan lolos clamp view penerimanya ----------------
//
// Nilai di luar rentang akan ditolak diam-diam oleh clamp() view dan jatuh ke
// default — user melihat "Terapkan" berhasil padahal angkanya tidak berubah.
const RANGES: Array<[string, (s: ProfileSettings) => number, number, number]> = [
  ['working.hoursPerDay', (s) => s.working.hoursPerDay, 1, 24],
  ['working.daysPerWeek', (s) => s.working.daysPerWeek, 1, 7],
  ['fuel.litresPer100Km', (s) => s.fuel.litresPer100Km, 1, 200],
  ['fuel.litresPerIdleHour', (s) => s.fuel.litresPerIdleHour, 0, 50],
  ['fuel.tankLitres', (s) => s.fuel.tankLitres, 1, 5000],
  ['service.km', (s) => s.service.km, 1, 1_000_000],
  ['service.hours', (s) => s.service.hours, 1, 100_000],
  ['security.startHour', (s) => s.security.startHour, 0, 23],
  ['security.hoursPerDay', (s) => s.security.hoursPerDay, 1, 24],
  ['dwellMinutes', (s) => s.dwellMinutes, 1, 720],
];

assert.equal(PROFILES.length, 4);
for (const p of PROFILES) {
  assert.ok(p.label && p.blurb && p.notes.length > 0, `${p.id}: label/blurb/notes wajib terisi`);
  for (const [name, pick, min, max] of RANGES) {
    const v = pick(p.settings);
    assert.ok(Number.isFinite(v), `${p.id}.${name} bukan angka`);
    assert.ok(v >= min && v <= max, `${p.id}.${name} = ${v} di luar clamp view (${min}..${max})`);
  }
}

// Profil pertama adalah nilai bawaan add-in — dipakai sebagai fallback di
// currentSettings(), jadi urutannya load-bearing.
assert.equal(PROFILES[0].id, 'umum');
assert.deepEqual(PROFILES[0].settings.working, { hoursPerDay: 10, daysPerWeek: 6 });

// --- 3. Karakter tiap profil yang tidak boleh hilang ------------------------
const tambang = profileById('tambang')!;
assert.equal(tambang.settings.working.hoursPerDay, 24);
assert.equal(tambang.settings.working.daysPerWeek, 7);
// Shift 24 jam => tidak ada trip yang bisa jatuh "di luar jam kerja".
assert.equal(tambang.settings.security.hoursPerDay, 24);
assert.ok(
  tambang.notes.some((n) => n.includes('Pergerakan Tak Sah')),
  'profil tambang wajib menjelaskan kenapa KPI Pergerakan Tak Sah jadi 0'
);

const fmcg = profileById('fmcg')!;
const logistik = profileById('logistik')!;
// Drop di outlet harus memecah perjalanan; istirahat sopir jarak jauh tidak boleh.
assert.ok(fmcg.settings.dwellMinutes < PROFILES[0].settings.dwellMinutes);
assert.ok(logistik.settings.dwellMinutes > PROFILES[0].settings.dwellMinutes);

assert.equal(profileById('tidak-ada'), undefined);

// --- 4. diff ---------------------------------------------------------------
const same = diffSettings(PROFILES[0].settings, PROFILES[0].settings);
assert.equal(same.length, 7);
assert.equal(same.filter((r) => r.changed).length, 0, 'profil yang sama tidak boleh melaporkan perubahan');

const toTambang = diffSettings(PROFILES[0].settings, tambang.settings);
assert.ok(toTambang.every((r) => r.changed), 'umum → tambang: ketujuh baris seharusnya berbeda');
const shift = toTambang.find((r) => r.label === 'Shift kerja')!;
assert.equal(shift.current, '07:00–17:00');
assert.equal(shift.next, '24 jam (tanpa jam tutup)', 'shift 24 jam harus dibaca manusia, bukan "00:00–00:00"');

// Angka diformat id-ID, bukan mentah — "10.000 km", bukan "10000 km".
const interval = toTambang.find((r) => r.label === 'Interval servis')!;
assert.ok(interval.current.startsWith('10.000 km'), interval.current);

console.log('operating-profile.check.ts OK');
