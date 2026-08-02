// Satu kalimat di atas tiap halaman: apa angkanya, dan apa yang perlu ditindak.
//
// Kenapa perlu: setiap view menyajikan tabel dan chart, tapi tidak satu pun
// menyimpulkan. Kepala operasional yang membuka dashboard ini di pagi hari
// harus membaca lima tabel dulu sebelum tahu unit mana yang perlu dipanggil
// masuk bengkel hari itu. Ringkasan menjawab "jadi saya harus apa", bukan
// sekadar "ini angkanya".
//
// TIGA ATURAN YANG MENGIKAT SEMUA KALIMAT DI FILE INI:
//
// 1. Jangan mengarang sebab-akibat. Data ini bisa bilang sebuah unit mengerem
//    mendadak 40 kali; ia TIDAK bisa bilang sopirnya ugal-ugalan, dan tidak
//    bisa membedakannya dari rute yang memang padat.
//
// 2. Hormati tingkat keyakinan. Kalau angkanya heuristik atau estimasi,
//    kalimatnya harus menyebutnya. Menulis "armada boros BBM" ketika liternya
//    berasal dari rasio yang diketik user sendiri adalah cara tercepat membuat
//    orang memercayai angka yang tidak layak dipercaya.
//
// 3. Kasus nol dan kosong adalah bagian dari pekerjaan, bukan sisa. Di sinilah
//    ringkasan otomatis biasanya memalukan. "0 pelanggaran" punya dua arti yang
//    sangat berbeda — armada Anda bersih, atau Rule-nya tidak pernah dibuat —
//    dan kalimatnya wajib membedakan keduanya.
//
// Murni: tanpa DOM, tanpa fetch, supaya summary.check.ts jalan di bawah tsx.

import type { HealthSummary } from './fleet-health';
import type { DeviceSignals } from './predictive';
import type { RankedDevice } from './safety';
import type { FuelSource } from './fuel';

// Formatter lokal, bukan dari utils/format: modul analytics tidak boleh
// bergantung pada lapisan tampilan (kontrak yang sama dipakai modul analytics
// lain, dan itulah yang membuat check-nya bisa jalan headless).
const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const n0 = (n: number) => nf0.format(Number.isFinite(n) ? n : 0);
const n1 = (n: number) => nf1.format(Number.isFinite(n) ? n : 0);

function hours(sec: number): string {
  const h = Math.floor(Math.max(0, sec) / 3600);
  const m = Math.floor((Math.max(0, sec) % 3600) / 60);
  return h > 0 ? `${n0(h)} jam ${m} menit` : `${m} menit`;
}

// --- Ringkasan --------------------------------------------------------------

export interface OverviewSummaryInput {
  utilizationPct: number;
  idleSec: number;
  engineHoursApprox: number;
  exceptions: { low: number; medium: number; high: number };
  deviceCount: number;
  tripCount: number;
  hoursPerDay: number;
  daysPerWeek: number;
}

export function summarizeOverview(i: OverviewSummaryInput): string {
  if (i.deviceCount === 0) {
    return 'Tidak ada unit pada filter ini. Pilih grup lain, atau perlebar rentang tanggalnya.';
  }
  if (i.tripCount === 0) {
    return `${n0(i.deviceCount)} unit pada filter ini, tapi tidak ada perjalanan sama sekali di rentang tanggal yang dipilih — jadi tidak ada yang bisa dihitung. Perlebar rentangnya untuk melihat aktivitas.`;
  }

  const total = i.exceptions.low + i.exceptions.medium + i.exceptions.high;
  const parts: string[] = [];

  // Utilisasi selalu heuristik: penyebutnya adalah jam kerja yang user isi.
  parts.push(
    `${n0(i.deviceCount)} unit terpakai ${n1(i.utilizationPct)}% dari jam kerja yang Anda tetapkan ` +
      `(${n0(i.hoursPerDay)} jam × ${n0(i.daysPerWeek)} hari) — ubah angka itu dan persentasenya ikut berubah.`
  );

  // Idle disebut hanya kalau porsinya cukup besar untuk ditindak.
  const idleShare = i.engineHoursApprox > 0 ? i.idleSec / 3600 / i.engineHoursApprox : 0;
  if (idleShare >= 0.2) {
    parts.push(
      `${hours(i.idleSec)} habis untuk idle, sekitar ${n0(idleShare * 100)}% dari waktu mesin menyala — ` +
        `di situ biasanya penghematan BBM paling mudah didapat.`
    );
  }

  if (total === 0) {
    parts.push('Tidak ada pelanggaran tercatat pada rentang ini.');
  } else if (i.exceptions.high > 0) {
    parts.push(
      `${n0(total)} pelanggaran, ${n0(i.exceptions.high)} di antaranya tingkat tinggi — buka halaman Safety Behaviour untuk melihat unit mana.`
    );
  } else {
    parts.push(`${n0(total)} pelanggaran, tidak ada yang tingkat tinggi.`);
  }

  return parts.join(' ');
}

// --- Laporan Perjalanan -----------------------------------------------------

export interface TripReportSummaryInput {
  journeys: number;
  roundTrips: number;
  tripCount: number;
  unmatchedTrips: number;
  unmatchedKm: number;
  zoneCount: number;
  dwellMinutes: number;
}

export function summarizeTripReport(i: TripReportSummaryInput): string {
  if (i.zoneCount === 0) {
    return 'Belum ada zona terdaftar, jadi tidak ada perjalanan yang bisa disusun. Gambar geofence di lokasi yang sering dikunjungi — gudang, pabrik, outlet — lalu halaman ini akan terisi sendiri.';
  }
  if (i.tripCount === 0) {
    return 'Tidak ada perjalanan sama sekali pada rentang tanggal ini.';
  }
  if (i.journeys === 0) {
    return `Ada ${n0(i.tripCount)} perjalanan pada rentang ini (total ${n1(i.unmatchedKm)} km), tapi tidak satu pun yang berawal DAN berakhir di zona terdaftar. Armada Anda jalan; zonanya yang belum menutupi lokasi yang sebenarnya dikunjungi.`;
  }

  const parts = [
    `${n0(i.journeys)} perjalanan zona-ke-zona tersusun dari ${n0(i.tripCount)} trip mentah, ` +
      `digabung pada ambang berhenti ${n0(i.dwellMinutes)} menit.`,
  ];
  if (i.roundTrips > 0) {
    parts.push(`${n0(i.roundTrips)} di antaranya pulang-pergi ke zona yang sama.`);
  }
  // Bagian yang tidak masuk tabel adalah temuan, bukan sisa — di situlah zona
  // yang belum digambar terlihat.
  if (i.unmatchedTrips > 0) {
    parts.push(
      `${n0(i.unmatchedTrips)} perjalanan lain (${n1(i.unmatchedKm)} km) berakhir di luar zona terdaftar dan tidak muncul di tabel — ` +
        `tambahkan geofence di sana kalau lokasinya penting.`
    );
  }
  return parts.join(' ');
}

// --- Kesehatan Armada -------------------------------------------------------

export function summarizeFleetHealth(s: HealthSummary | null): string {
  if (!s) {
    return 'Tidak ada data fault pada rentang ini. Perangkat perlu tersambung ke OBD/J1939 dan kendaraannya harus melaporkan kode kerusakan — kosong di sini bukan berarti armada sehat.';
  }
  if (s.totalDevices === 0) {
    return 'Tidak ada unit pada filter ini.';
  }
  if (s.activeCount === 0 && s.pendingCount === 0) {
    return `Tidak ada fault yang masih terbuka di ${n0(s.totalDevices)} unit. Ada ${n0(s.resolvedCount)} fault pada rentang ini, tapi semuanya sudah selesai atau sudah di-dismiss — jadi ini memang nol, bukan data yang hilang.`;
  }

  const parts = [`${n0(s.devicesWithActiveFaults)} dari ${n0(s.totalDevices)} unit punya fault aktif.`];

  // Lampu kritis = "berhenti sekarang". Ini satu-satunya hal di halaman ini
  // yang layak disebut pekerjaan hari ini.
  if (s.criticalLampCount > 0) {
    parts.push(
      `${n0(s.criticalLampCount)} di antaranya menyalakan lampu MIL / stop merah dan perlu dicek hari ini.`
    );
  } else {
    parts.push('Tidak ada yang menyalakan lampu kritis, jadi tidak ada yang harus dikandangkan hari ini.');
  }

  if (s.pendingCount > 0) {
    parts.push(
      `${n0(s.pendingCount)} fault lain berstatus pending — ECU baru melihatnya sekali dan belum mengkonfirmasi, jadi pantau saja dulu, jangan kirim ke bengkel.`
    );
  }
  return parts.join(' ');
}

// --- Prediksi Servis --------------------------------------------------------

export interface PredictiveSummaryInput {
  rows: DeviceSignals[];
  chronicSeries: number;
  hasOdometer: boolean;
  hasFaults: boolean;
  hasDvir: boolean;
  intervalKm: number;
}

export function summarizePredictive(i: PredictiveSummaryInput): string {
  if (i.rows.length === 0) {
    return 'Tidak ada unit pada filter ini.';
  }
  if (!i.hasOdometer && !i.hasFaults && !i.hasDvir) {
    return `Tidak ada sinyal prediktif pada database ini: odometer tidak dilaporkan perangkat, tidak ada data fault, dan tidak ada defect DVIR dalam 90 hari terakhir. Halaman ini sengaja tidak menampilkan angka yang tidak bisa diukur.`;
  }

  const flagged = i.rows.filter((r) => r.flags.length > 0);
  if (flagged.length === 0) {
    return `Tidak ada unit yang tertandai dari ${n0(i.rows.length)} unit yang diperiksa — tidak ada servis jatuh tempo, tidak ada fault kronis, tidak ada tren memburuk.`;
  }

  // Yang paling banyak flag-nya adalah kandidat pertama untuk dipanggil masuk.
  const worst = [...flagged].sort((a, b) => b.flags.length - a.flags.length)[0];
  const parts = [
    `${n0(flagged.length)} dari ${n0(i.rows.length)} unit tertandai. ` +
      `Yang paling banyak sinyalnya: ${worst.deviceName} (${worst.flags.join(', ')}).`,
  ];

  if (i.chronicSeries > 0) {
    parts.push(
      `${n0(i.chronicSeries)} kerusakan tercatat kronis — berulang di hari yang berbeda, jadi ini pola, bukan insiden sekali lewat.`
    );
  }
  if (i.hasOdometer) {
    parts.push(
      `Jarak ke servis dihitung dengan asumsi tiap servis terjadi tepat pada kelipatan ${n0(i.intervalKm)} km; ` +
        `sesuaikan intervalnya kalau standar armada Anda berbeda.`
    );
  }
  return parts.join(' ');
}

// --- Keamanan & Darurat -----------------------------------------------------

export interface SecuritySummaryInput {
  panic: number;
  accident: number;
  offHoursTrips: number;
  geofence: number;
  tripCount: number;
  /** Kategori yang Rule-nya ADA di database ini. */
  configured: { panic: boolean; accident: boolean; geofence: boolean };
  shiftLabel: string;
  shiftHours: number;
}

export function summarizeSecurity(i: SecuritySummaryInput): string {
  const off = [
    !i.configured.panic ? 'panik/SOS' : '',
    !i.configured.accident ? 'deteksi benturan' : '',
    !i.configured.geofence ? 'aturan zona' : '',
  ].filter(Boolean);

  const urgent: string[] = [];
  if (i.configured.panic && i.panic > 0) urgent.push(`${n0(i.panic)} panik/SOS`);
  if (i.configured.accident && i.accident > 0) urgent.push(`${n0(i.accident)} kecelakaan/benturan`);

  const parts: string[] = [];
  if (urgent.length > 0) {
    parts.push(`${urgent.join(' dan ')} tercatat pada rentang ini — periksa daftar insiden di bawah lebih dulu.`);
  } else if (off.length === 3) {
    parts.push(
      'Tidak satu pun kategori keamanan dikonfigurasi di database ini, jadi halaman ini tidak akan pernah menampilkan insiden. Buat Rule panik, benturan, atau zona di MyGeotab dulu.'
    );
  } else {
    parts.push('Tidak ada insiden panik maupun benturan pada rentang ini.');
  }

  // Shift 24 jam (profil tambang) membuat KPI ini selalu nol. Katakan alasannya,
  // jangan biarkan nol-nya terbaca sebagai "aman".
  if (i.shiftHours >= 24) {
    parts.push(
      'Shift disetel 24 jam, jadi tidak ada perjalanan yang bisa disebut di luar jam kerja — KPI Pergerakan Tak Sah akan selalu 0. Persempit durasi shift kalau operasi Anda sebenarnya punya jam tutup.'
    );
  } else if (i.offHoursTrips > 0) {
    parts.push(
      `${n0(i.offHoursTrips)} dari ${n0(i.tripCount)} perjalanan mulai di luar ${i.shiftLabel}. Ini perbandingan jam, bukan bukti pelanggaran — lembur yang sah ikut terhitung di sini.`
    );
  }

  if (off.length > 0 && off.length < 3) {
    parts.push(`Kategori ${off.join(' dan ')} belum dikonfigurasi, jadi kejadiannya memang tidak akan pernah muncul.`);
  }
  return parts.join(' ');
}

// --- Perilaku Berkendara ----------------------------------------------------

export interface SafetySummaryInput {
  events: number;
  totalKm: number;
  fleetPer100: number | null;
  /** Sudah diurutkan terburuk lebih dulu (rankDevices mempertahankan urutan). */
  ranked: RankedDevice[];
  /** Kategori yang Rule-nya belum ada — tidak akan pernah muncul angkanya. */
  missingCategories: string[];
  anyRuleConfigured: boolean;
  driverAttributionPct: number;
}

export function summarizeSafety(i: SafetySummaryInput): string {
  if (!i.anyRuleConfigured) {
    return 'Belum ada Rule keselamatan di database ini, jadi MyGeotab tidak pernah menghasilkan pelanggaran untuk dihitung. Buat Rule pengereman mendadak, kecepatan, atau sabuk pengaman di MyGeotab — halaman ini akan langsung terisi.';
  }
  if (i.events === 0) {
    return i.totalKm > 0
      ? `Tidak ada pelanggaran pada rentang ini, padahal Rule keselamatan aktif dan armada menempuh ${n1(i.totalKm)} km — jadi ini nol yang sebenarnya, bukan data yang hilang.`
      : 'Tidak ada pelanggaran maupun perjalanan pada rentang tanggal ini. Coba perlebar rentangnya atau pilih grup lain.';
  }

  const parts: string[] = [];
  // Unit terburuk dipilih dari per100Km, bukan jumlah mentah — jumlah mentah
  // selalu menempatkan unit tersibuk di atas dan tidak berguna untuk coaching.
  const worst = i.ranked.find((r) => r.per100Km !== null);
  if (worst && i.fleetPer100 !== null) {
    parts.push(
      `${n0(i.events)} pelanggaran, rata-rata ${n1(i.fleetPer100)} per 100 km. ` +
        `Yang paling tinggi: ${worst.name} dengan ${n1(worst.per100Km!)} per 100 km — mulai coaching dari sana, bukan dari unit dengan jumlah mentah terbanyak.`
    );
  } else {
    parts.push(
      `${n0(i.events)} pelanggaran, tapi tidak ada unit dengan jarak tempuh tercatat sehingga peringkat per 100 km belum bisa dihitung.`
    );
  }

  if (i.driverAttributionPct < 50) {
    parts.push(
      `Hanya ${n0(i.driverAttributionPct)}% perjalanan punya identitas pengemudi, jadi peringkat per sopir disembunyikan — pakai peringkat per unit.`
    );
  }
  if (i.missingCategories.length > 0) {
    parts.push(
      `${i.missingCategories.join(', ')} belum punya Rule, jadi angkanya dikosongkan, bukan nol.`
    );
  }
  return parts.join(' ');
}

// --- Konsumsi BBM -----------------------------------------------------------

export interface FuelSummaryInput {
  source: FuelSource;
  totalL: number;
  totalKm: number;
  avgLper100: number | null;
  idleWasteL: number;
  litresPer100Km: number;
  litresPerIdleHour: number;
}

export function summarizeFuel(i: FuelSummaryInput): string {
  if (i.source === 'none') {
    return 'Tidak ada data BBM untuk periode ini: database ini tidak punya transaksi kartu BBM, tidak melaporkan diagnostik bahan bakar, dan tidak ada jarak tempuh yang bisa dipakai untuk estimasi.';
  }

  // Sumber "distance" bukan pengukuran sama sekali — jarak dikali tebakan.
  // Kalimatnya tidak boleh terdengar seperti temuan.
  if (i.source === 'distance') {
    return (
      `Database ini tidak melaporkan data bahan bakar apa pun, jadi ${n1(i.totalL)} L di bawah BUKAN hasil pengukuran — ` +
      `itu ${n0(i.totalKm)} km dikalikan rasio ${n1(i.litresPer100Km)} L/100km yang Anda isi sendiri. ` +
      `Semua unit akan terlihat sama efisien karena memang begitu cara angkanya dibuat. ` +
      `Untuk angka yang bisa dipakai menagih, aktifkan data kartu BBM atau diagnostik bahan bakar di MyGeotab.`
    );
  }

  const measured = i.source === 'transactions' || i.source === 'cumulative';
  const sourceName =
    i.source === 'transactions'
      ? 'transaksi kartu BBM'
      : i.source === 'cumulative'
        ? 'counter bahan bakar mesin'
        : 'level tangki';

  const parts = [
    `${n1(i.totalL)} L terpakai untuk ${n0(i.totalKm)} km` +
      (i.avgLper100 !== null ? `, rata-rata ${n1(i.avgLper100)} L/100km` : '') +
      `, dari ${sourceName}${measured ? '' : ' (estimasi — pengisian ulang diabaikan, dan kapasitas tangki dipakai sama rata untuk semua unit)'}.`,
  ];

  // Idle SELALU heuristik: MyGeotab tidak melaporkan liter saat idle.
  if (i.idleWasteL > 0) {
    const share = i.totalL > 0 ? (i.idleWasteL / i.totalL) * 100 : 0;
    parts.push(
      `Sekitar ${n1(i.idleWasteL)} L diperkirakan terbakar saat idle` +
        (share > 0 ? ` (±${n0(share)}% dari total)` : '') +
        `, dihitung dari jam idle × ${n1(i.litresPerIdleHour)} L/jam yang Anda isi — laju itu bukan dari MyGeotab, jadi periksa dulu sebelum dipakai menagih.`
    );
  }
  return parts.join(' ');
}
