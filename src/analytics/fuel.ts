// Fuel math. PURE — no DOM, no Chart.js, no fetchers — so it runs under plain
// `tsx` (see fuel.check.ts) and every number on the BBM view is testable
// without a browser or a Geotab session.
//
// The one thing this module exists for: a Geotab database may expose fuel in
// four different ways, or in none of them. Which one is in play changes what
// the numbers MEAN (measured litres vs a ratio someone typed in), so the
// choice is an explicit, testable function rather than an if-chain in a view.

import type { StatusDataDTO, TripDTO } from '../api/fetchers/types';

export type FuelSource = 'transactions' | 'cumulative' | 'level' | 'distance' | 'none';

export interface FuelAvailability {
  transactions: boolean;
  cumulative: boolean;
  level: boolean;
  distance: boolean;
}

/** Strict best -> worst precedence: measured litres from a fuel card beat a
 *  measured engine counter, which beats a tank level we have to differentiate,
 *  which beats km x a ratio the user typed. All four absent -> 'none', and the
 *  view must then say so instead of drawing zeros. */
export function pickFuelSource(a: FuelAvailability): FuelSource {
  if (a.transactions) return 'transactions';
  if (a.cumulative) return 'cumulative';
  if (a.level) return 'level';
  if (a.distance) return 'distance';
  return 'none';
}

/** Rows split per device and sorted chronologically — both delta walks below
 *  are meaningless if the readings arrive out of order, and Geotab does not
 *  promise an order. */
function byDeviceChronological(rows: StatusDataDTO[]): Map<string, StatusDataDTO[]> {
  const out = new Map<string, StatusDataDTO[]>();
  for (const r of rows) {
    const list = out.get(r.deviceId);
    if (list) list.push(r);
    else out.set(r.deviceId, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
  return out;
}

/**
 * Lifetime "total fuel used" counter -> litres burnt inside the range.
 *
 * Sums POSITIVE deltas rather than taking max-min directly. For a healthy
 * monotonic counter those are the same number, but summing deltas also
 * survives an ECU swap or counter reset (a decrease) without ever reporting
 * negative fuel — max-min would silently absorb the reset into the total.
 * A device with a single reading has no climb to measure: 0, not NaN.
 */
export function consumptionFromCumulative(rows: StatusDataDTO[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [deviceId, list] of byDeviceChronological(rows)) {
    let total = 0;
    for (let i = 1; i < list.length; i++) {
      const delta = list[i].value - list[i - 1].value;
      if (delta > 0) total += delta; // a drop is a reset, not negative consumption
    }
    out[deviceId] = total;
  }
  return out;
}

/**
 * Instantaneous tank level -> litres burnt. Fuel consumed is the sum of the
 * DROPS; a positive jump is a refuel and is ignored (deliberately not
 * subtracted — a refuel must never cancel out real consumption).
 *
 * Units are the readings' own. DiagnosticFuelLevelId is usually a PERCENTAGE,
 * so pass `tankLitres` to scale percent points into litres. Assumption: a
 * linear tank, 1% = tankLitres/100, which is not true of oddly shaped tanks —
 * one reason this source is always labelled "estimasi". Omit `tankLitres`
 * when the database already reports litres.
 */
export function consumptionFromLevel(rows: StatusDataDTO[], tankLitres?: number): Record<string, number> {
  const scale = tankLitres !== undefined && Number.isFinite(tankLitres) ? tankLitres / 100 : 1;
  const out: Record<string, number> = {};
  for (const [deviceId, list] of byDeviceChronological(rows)) {
    let drop = 0;
    for (let i = 1; i < list.length; i++) {
      const delta = list[i].value - list[i - 1].value;
      if (delta < 0) drop += -delta;
    }
    out[deviceId] = drop * scale;
  }
  return out;
}

/** Last-resort estimate: distance x a ratio the user owns. No measurement in
 *  here at all, which is exactly why the view shouts ESTIMASI over it. */
export function estimateFromDistance(trips: TripDTO[], rate: number): Record<string, number> {
  const safeRate = Number.isFinite(rate) ? rate : 0;
  const out: Record<string, number> = {};
  for (const t of trips) {
    out[t.deviceId] = (out[t.deviceId] ?? 0) + (t.distanceKm * safeRate) / 100;
  }
  return out;
}

/** The headline efficiency figure. `null` (never Infinity, never NaN) when
 *  there is no distance to divide by — a parked truck that burnt idle fuel has
 *  no L/100km, and the table must print "—" rather than a division artifact. */
export function litresPer100Km(litres: number, km: number): number | null {
  if (!Number.isFinite(km) || !Number.isFinite(litres) || km <= 0) return null;
  return (litres / km) * 100;
}

/** Distance per litre — the same figure MyGeotab's own "Fuel and EV Energy
 *  Usage" report prints as "Fuel economy" (83 km / 7.40 L = 11.2 km/L), so the
 *  two reports can be laid side by side. `null` (never Infinity, never NaN)
 *  when there is no fuel to divide by: a unit that logged distance but no
 *  litres has no economy, and the table must print "—". */
export function kmPerLitre(km: number, litres: number): number | null {
  if (!Number.isFinite(km) || !Number.isFinite(litres) || litres <= 0) return null;
  return km / litres;
}

/**
 * Fleet economy: TOTAL km / TOTAL litres.
 *
 * DO NOT "simplify" this into the average of economyByDevice(). Averaging
 * ratios gives a van that rolled 2 km exactly the same vote as a truck that
 * ran 2000, so one barely-moved vehicle with a freak ratio drags the fleet
 * headline around. Totalling first weights every kilometre equally — and it is
 * what MyGeotab's own report does, which is the point: our number has to
 * reconcile with theirs, not merely look plausible.
 */
export function fleetKmPerLitre(
  kmByDevice: Record<string, number>,
  litresByDevice: Record<string, number>
): number | null {
  return kmPerLitre(sumValues(kmByDevice), sumValues(litresByDevice));
}

/** Per-device economy for the table. Keyed by the UNION of both maps, so a
 *  device with litres but no trips (or the reverse) still gets an explicit
 *  `null` instead of a silently missing key the view would read as 0. */
export function economyByDevice(
  kmByDevice: Record<string, number>,
  litresByDevice: Record<string, number>
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const id of new Set([...Object.keys(kmByDevice), ...Object.keys(litresByDevice)])) {
    out[id] = kmPerLitre(kmByDevice[id] ?? 0, litresByDevice[id] ?? 0);
  }
  return out;
}

/** HEURISTIK, not a measurement: idle seconds x an assumed burn rate. Geotab
 *  reports idle time, never idle fuel, so the rate is a knob (default 2 L/jam,
 *  a typical light truck) the user is expected to tune per fleet. */
export function idleFuelWaste(trips: TripDTO[], litresPerIdleHour: number): Record<string, number> {
  const rate = Number.isFinite(litresPerIdleHour) ? litresPerIdleHour : 0;
  const out: Record<string, number> = {};
  for (const t of trips) {
    out[t.deviceId] = (out[t.deviceId] ?? 0) + (t.idlingDurationSec / 3600) * rate;
  }
  return out;
}

/** Local calendar day of an ISO instant — the same local-day rule date-range.ts
 *  applies to the picker, so a Jakarta user's trend buckets line up with the
 *  dates they selected. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bucket any dated rows per local day, so the daily trend can re-run the very
 *  same consumption function per day instead of inventing a second formula. */
export function groupByDay<T>(rows: T[], isoOf: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) {
    const key = dayKey(isoOf(row));
    if (!key) continue;
    (out[key] ??= []).push(row);
  }
  return out;
}

/** Sum of a per-device map — totals for the KPI strip. */
export function sumValues(byDevice: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(byDevice)) if (Number.isFinite(v)) total += v;
  return total;
}

// --- baris tabel: penyaringan dan pengurutan --------------------------------
//
// Murni dan diuji sendiri, karena inilah yang menentukan unit mana yang dilihat
// orang lebih dulu — dan urutan yang salah pada kolom yang punya sel kosong
// adalah jenis kerusakan yang tampak masuk akal sampai seseorang menagih klien
// berdasarkan urutan itu.

export interface FuelRow {
  id: string;
  name: string;
  km: number;
  litres: number;
  /** null bila jarak 0 — laju tidak diketahui, bukan nol. */
  efficiency: number | null;
  /** null bila liternya bukan hasil pengukuran (lihat economyBlocker). */
  economy: number | null;
  cost: number | null;
}

export type FuelSortKey = 'name' | 'km' | 'litres' | 'efficiency' | 'economy' | 'cost';

/**
 * Mengurutkan baris tabel. `dir` 1 menaik, -1 menurun.
 *
 * Sel kosong (null) SELALU di bawah, ke arah mana pun diurutkan. Memperlakukan
 * null sebagai nol akan menempatkan unit yang datanya tidak ada di puncak
 * daftar "paling irit" — pujian untuk unit yang sebenarnya tidak terukur.
 */
export function sortFuelRows(rows: FuelRow[], key: FuelSortKey, dir: 1 | -1): FuelRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }) * dir;
    const av = a[key];
    const bv = b[key];
    if (av === null || !Number.isFinite(av)) return bv === null || !Number.isFinite(bv) ? 0 : 1;
    if (bv === null || !Number.isFinite(bv)) return -1;
    return (av - bv) * dir;
  });
}

/**
 * Unit yang masuk grafik "Efisiensi per unit".
 *
 * `boros` mengambil L/100km TERTINGGI, `hemat` yang TERENDAH — dua kelompok
 * unit yang berbeda, bukan daftar yang sama dibalik. Itu yang membuat grafik
 * ini bisa dipakai menemukan patokan terbaik armada, bukan cuma yang terburuk.
 *
 * Unit tanpa efisiensi terukur dibuang, bukan digambar sebagai nol: batang nol
 * terbaca sebagai "tidak membakar apa-apa".
 */
export function topByEfficiency(rows: FuelRow[], dir: 'boros' | 'hemat', limit: number): FuelRow[] {
  const usable = rows.filter((r) => r.efficiency !== null && Number.isFinite(r.efficiency));
  const sorted = sortFuelRows(usable, 'efficiency', dir === 'boros' ? -1 : 1);
  return sorted.slice(0, limit);
}
