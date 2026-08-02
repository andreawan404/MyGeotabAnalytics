// "Profil Operasi" — menyetel asumsi perhitungan sesuai jenis armada.
//
// Kenapa ini ada: nilai default add-in ini (10 jam/hari × 6 hari, servis 10.000
// km, shift 07:00, ambang berhenti 15 menit) cocok untuk satu jenis armada saja.
// Dipakai apa adanya di tambang yang beroperasi 24/7, Utilisasi Armada jadi
// salah lebih dari dua kali lipat dan "Pergerakan Tak Sah" menyala untuk setiap
// shift malam yang normal. Untuk distribusi FMCG, ambang 15 menit menelan drop
// di outlet — padahal justru itu yang mau dilihat.
//
// Yang TIDAK dilakukan modul ini, sengaja: tidak menambah metrik, tidak
// menambah view, tidak menyimpan format baru. Dia hanya menulis ke enam key
// localStorage yang SUDAH dipakai kelima view, lalu memberi tahu mereka.
//
// ponytail: profil tidak pernah menulis diam-diam. Memilih dari dropdown hanya
// menampilkan diff "sekarang → profil"; yang menulis adalah tombol Terapkan.
// Angka-angka ini adalah asumsi yang dipakai untuk menagih klien — menimpanya
// tanpa user lihat dulu adalah cara tercepat kehilangan kepercayaan pada
// seluruh dashboard.

import { esc, int, upto1 } from '../utils/format';

export type ProfileId = 'umum' | 'logistik' | 'fmcg' | 'tambang';

export interface ProfileSettings {
  working: { hoursPerDay: number; daysPerWeek: number };
  fuel: { litresPer100Km: number; litresPerIdleHour: number; tankLitres: number };
  service: { km: number; hours: number };
  security: { startHour: number; hoursPerDay: number };
  dwellMinutes: number;
}

export interface Profile {
  id: ProfileId;
  label: string;
  blurb: string;
  settings: ProfileSettings;
  /** Alasan angka-angka ini dipilih. Ditampilkan, bukan disembunyikan — user
   *  harus bisa menolak asumsi yang tidak cocok dengan armadanya. */
  notes: string[];
}

// Key-key ini dimiliki view lain (lihat KEY_OWNER di operating-profile.check.ts,
// yang memverifikasi tiap literal masih ada di file pemiliknya). Menulis lewat
// key yang sama berarti tidak ada format penyimpanan kedua yang bisa basi.
export const KEYS = {
  working: 'fleet-analytics:working-hours:',
  fuel: 'fleet-analytics:fuel-settings:',
  service: 'fleet-analytics:service-interval:',
  security: 'fleet-analytics:security-hours:',
  dwell: 'fleet-analytics:trip-report-dwell:',
  profile: 'fleet-analytics:profile:',
} as const;

export const PROFILES: Profile[] = [
  {
    id: 'umum',
    label: 'Umum',
    blurb: 'Campuran, jam kerja kantor',
    settings: {
      working: { hoursPerDay: 10, daysPerWeek: 6 },
      fuel: { litresPer100Km: 30, litresPerIdleHour: 2, tankLitres: 100 },
      service: { km: 10000, hours: 250 },
      security: { startHour: 7, hoursPerDay: 10 },
      dwellMinutes: 15,
    },
    notes: ['Nilai bawaan add-in. Pakai ini kalau armada Anda tidak condong ke salah satu profil di bawah.'],
  },
  {
    id: 'logistik',
    label: 'Logistik Jarak Jauh',
    blurb: 'Truk antar kota, perjalanan multi-hari',
    settings: {
      working: { hoursPerDay: 12, daysPerWeek: 6 },
      fuel: { litresPer100Km: 30, litresPerIdleHour: 2.5, tankLitres: 400 },
      service: { km: 20000, hours: 500 },
      security: { startHour: 5, hoursPerDay: 14 },
      dwellMinutes: 45,
    },
    notes: [
      'Ambang berhenti 45 menit: istirahat sopir dan antre timbangan tidak boleh memecah satu perjalanan jarak jauh jadi dua di Trip Report.',
      'Interval servis 20.000 km karena jarak terkumpul jauh lebih cepat daripada armada dalam kota.',
      'Shift 05:00–19:00 lebar, supaya berangkat subuh tidak dihitung sebagai pergerakan tak sah.',
    ],
  },
  {
    id: 'fmcg',
    label: 'Distribusi FMCG',
    blurb: 'Kendaraan ringan, banyak drop per hari',
    settings: {
      working: { hoursPerDay: 10, daysPerWeek: 6 },
      fuel: { litresPer100Km: 18, litresPerIdleHour: 1.5, tankLitres: 80 },
      service: { km: 10000, hours: 250 },
      security: { startHour: 6, hoursPerDay: 12 },
      dwellMinutes: 10,
    },
    notes: [
      'Ambang berhenti 10 menit: drop di outlet SENGAJA memecah perjalanan, karena tiap kunjungan itu justru yang mau dihitung.',
      'Rasio 18 L/100km mengasumsikan kendaraan ringan dalam kota, bukan truk besar.',
    ],
  },
  {
    id: 'tambang',
    label: 'Tambang / Site 24 Jam',
    blurb: 'Alat berat, operasi tidak berhenti',
    settings: {
      working: { hoursPerDay: 24, daysPerWeek: 7 },
      fuel: { litresPer100Km: 45, litresPerIdleHour: 4, tankLitres: 500 },
      service: { km: 5000, hours: 250 },
      security: { startHour: 0, hoursPerDay: 24 },
      dwellMinutes: 20,
    },
    notes: [
      'Shift 24 jam berarti KPI "Pergerakan Tak Sah" akan selalu 0. Itu benar untuk site yang beroperasi penuh — tidak ada jam yang bisa disebut di luar jam kerja. Persempit shift kalau site Anda sebenarnya punya jam tutup.',
      'Basis utilisasi 24 jam × 7 hari. Dengan basis kantor 10×6, unit yang bekerja normal di site 24 jam akan terlihat seolah utilisasinya di atas 100%.',
      'Interval servis 5.000 km karena jarak kecil tapi jam mesin tinggi — jam mesin yang lebih menentukan, bukan odometer.',
    ],
  },
];

export function profileById(id: string): Profile | undefined {
  return PROFILES.find((p) => p.id === id);
}

// --- persistence -----------------------------------------------------------

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — setelan cuma tidak persist */
  }
}

export function savedProfileId(database: string): ProfileId | null {
  const raw = read(KEYS.profile + database);
  return raw && profileById(raw) ? (raw as ProfileId) : null;
}

/** Menulis keenam key sekaligus. Dipanggil HANYA dari tombol Terapkan. */
export function applyProfile(database: string, p: Profile): void {
  const s = p.settings;
  write(KEYS.working + database, JSON.stringify(s.working));
  write(KEYS.fuel + database, JSON.stringify(s.fuel));
  write(KEYS.service + database, JSON.stringify(s.service));
  write(KEYS.security + database, JSON.stringify(s.security));
  write(KEYS.dwell + database, String(s.dwellMinutes));
  write(KEYS.profile + database, p.id);
}

// --- diff ------------------------------------------------------------------

export interface DiffRow {
  label: string;
  current: string;
  next: string;
  changed: boolean;
}

/** Nilai yang BERLAKU sekarang — bukan nilai profil tersimpan. User bisa saja
 *  sudah menyetel satu knob sendiri setelah menerapkan profil; diff harus
 *  menunjukkan angka yang benar-benar dipakai, supaya perubahan tidak
 *  mengejutkan. */
export function currentSettings(database: string): ProfileSettings {
  const fallback = PROFILES[0].settings;
  const json = <T>(key: string, def: T): T => {
    const raw = read(key + database);
    if (!raw) return def;
    try {
      return { ...def, ...JSON.parse(raw) };
    } catch {
      return def;
    }
  };
  const dwellRaw = Number(read(KEYS.dwell + database));
  return {
    working: json(KEYS.working, fallback.working),
    fuel: json(KEYS.fuel, fallback.fuel),
    service: json(KEYS.service, fallback.service),
    security: json(KEYS.security, fallback.security),
    dwellMinutes: Number.isFinite(dwellRaw) && dwellRaw > 0 ? dwellRaw : fallback.dwellMinutes,
  };
}

function shiftLabel(startHour: number, hours: number): string {
  if (hours >= 24) return '24 jam (tanpa jam tutup)';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(startHour)}:00–${pad((startHour + hours) % 24)}:00`;
}

export function diffSettings(current: ProfileSettings, next: ProfileSettings): DiffRow[] {
  const rows: Array<[string, string, string]> = [
    [
      'Jam kerja armada',
      `${int(current.working.hoursPerDay)} jam/hari × ${int(current.working.daysPerWeek)} hari`,
      `${int(next.working.hoursPerDay)} jam/hari × ${int(next.working.daysPerWeek)} hari`,
    ],
    [
      'Interval servis',
      `${int(current.service.km)} km / ${int(current.service.hours)} jam mesin`,
      `${int(next.service.km)} km / ${int(next.service.hours)} jam mesin`,
    ],
    [
      'Rasio BBM (estimasi jarak)',
      `${upto1(current.fuel.litresPer100Km)} L/100km`,
      `${upto1(next.fuel.litresPer100Km)} L/100km`,
    ],
    [
      'Konsumsi idle',
      `${upto1(current.fuel.litresPerIdleHour)} L/jam`,
      `${upto1(next.fuel.litresPerIdleHour)} L/jam`,
    ],
    ['Kapasitas tangki', `${int(current.fuel.tankLitres)} L`, `${int(next.fuel.tankLitres)} L`],
    [
      'Shift kerja',
      shiftLabel(current.security.startHour, current.security.hoursPerDay),
      shiftLabel(next.security.startHour, next.security.hoursPerDay),
    ],
    ['Ambang berhenti', `${int(current.dwellMinutes)} menit`, `${int(next.dwellMinutes)} menit`],
  ];
  return rows.map(([label, c, n]) => ({ label, current: c, next: n, changed: c !== n }));
}

// --- DOM -------------------------------------------------------------------

export function initOperatingProfile(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  let active: ProfileId = savedProfileId(ctx.database) ?? 'umum';
  /** Profil yang sedang dilihat pratinjaunya tapi BELUM ditulis. */
  let pending: ProfileId | null = null;

  const wrap = document.createElement('div');
  wrap.className = 'fa-profile';
  container.appendChild(wrap);

  function render(): void {
    const selected = pending ?? active;
    const profile = profileById(selected)!;
    const rows = pending ? diffSettings(currentSettings(ctx.database), profile.settings) : [];
    const changed = rows.filter((r) => r.changed);

    wrap.innerHTML = `
      <label class="fa-profile-pick">
        <span>Profil operasi</span>
        <select id="fa-profile-select">
          ${PROFILES.map(
            (p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.label)}</option>`
          ).join('')}
        </select>
      </label>
      ${pending ? panel(profile, rows, changed.length) : ''}
    `;
  }

  function panel(profile: Profile, rows: DiffRow[], changedCount: number): string {
    return `
      <div class="fa-profile-panel" role="region" aria-label="Pratinjau perubahan profil operasi">
        <p class="fa-profile-blurb">${esc(profile.blurb)}</p>
        <p class="fa-note">Ini hanya menyetel <strong>asumsi perhitungan</strong>. Data dari MyGeotab tidak berubah, dan tidak ada angka MyGeotab yang ditimpa.</p>
        ${
          changedCount === 0
            ? '<p class="fa-empty">Semua setelan Anda sudah sama dengan profil ini — tidak ada yang berubah.</p>'
            : `<table class="fa-table fa-profile-diff">
                 <caption>${int(changedCount)} dari ${int(rows.length)} setelan akan berubah.</caption>
                 <thead><tr><th scope="col">Setelan</th><th scope="col">Sekarang</th><th scope="col">Jadi</th></tr></thead>
                 <tbody>
                   ${rows
                     .map(
                       (r) => `<tr${r.changed ? ' class="fa-profile-changed"' : ''}>
                         <th scope="row">${esc(r.label)}</th>
                         <td>${esc(r.current)}</td>
                         <td>${r.changed ? `<strong>${esc(r.next)}</strong>` : esc(r.next)}</td>
                       </tr>`
                     )
                     .join('')}
                 </tbody>
               </table>`
        }
        <ul class="fa-profile-notes">${profile.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        <div class="fa-profile-actions">
          <button type="button" class="fa-btn-primary" data-profile-act="apply">Terapkan</button>
          <button type="button" data-profile-act="cancel">Batal</button>
        </div>
        <p class="fa-note">Tiap angka tetap bisa Anda ubah satu per satu di halamannya masing-masing. Setelan disimpan di browser ini, per database.</p>
      </div>`;
  }

  function onChange(e: Event): void {
    const el = e.target as HTMLSelectElement | null;
    if (el?.id !== 'fa-profile-select') return;
    pending = el.value === active ? null : (el.value as ProfileId);
    render();
  }

  function onClick(e: Event): void {
    const act = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-profile-act]')?.dataset.profileAct;
    if (!act) return;
    if (act === 'apply' && pending) {
      const profile = profileById(pending)!;
      applyProfile(ctx.database, profile);
      active = profile.id;
      pending = null;
      render();
      // location.reload() TIDAK dipakai: add-in ini hidup di dalam iframe
      // MyGeotab. View yang mendengar event ini membaca ulang knob-nya dari
      // localStorage dan render ulang tanpa fetch baru.
      ctx.rootEl.dispatchEvent(new CustomEvent('dashboard:profile-change', { detail: { profileId: profile.id } }));
      return;
    }
    pending = null;
    render();
  }

  wrap.addEventListener('change', onChange);
  wrap.addEventListener('click', onClick);
  render();

  return () => {
    wrap.removeEventListener('change', onChange);
    wrap.removeEventListener('click', onClick);
    wrap.remove();
  };
}
