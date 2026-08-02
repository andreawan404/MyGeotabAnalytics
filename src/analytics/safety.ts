// Safety behaviour aggregation. PURE — no DOM, no Chart.js, no fetchers — so it
// runs under plain `tsx` (see safety.check.ts).
//
// WHY RULE IDS COME FIRST (same reasoning as rule-severity.ts): Geotab's
// built-in rule NAMES are localized. An Indonesian database returns "Pengereman
// Mendadak" for harsh braking, so matching English keywords against names
// silently buckets a whole fleet as 'other'. Rule IDS are stable, English and
// non-localized. Names are only a fallback for customer-defined rules, whose ids
// are opaque (e.g. "b1A2") — and those names are what the customer typed, in
// Indonesian.
//
// Severity is NOT re-derived here: rule-severity.ts already owns that, keyed off
// the same non-localized id. This module answers "what KIND of event", not "how
// bad" (see the durationSec caveat below).

import type { ExceptionEventDTO, TripDTO, DeviceLite } from '../api/fetchers/types';

export type Category =
  | 'harsh-braking'
  | 'harsh-acceleration'
  | 'harsh-cornering'
  | 'speeding'
  | 'seatbelt'
  | 'idling'
  | 'other';

export const CATEGORIES: Category[] = [
  'harsh-braking',
  'harsh-acceleration',
  'harsh-cornering',
  'speeding',
  'seatbelt',
  'idling',
  'other',
];

/** UI copy is Bahasa Indonesia project-wide. Data, not DOM — stays pure. */
export const CATEGORY_LABELS: Record<Category, string> = {
  'harsh-braking': 'Pengereman Mendadak',
  'harsh-acceleration': 'Akselerasi Mendadak',
  'harsh-cornering': 'Menikung Tajam',
  speeding: 'Kecepatan Berlebih',
  seatbelt: 'Sabuk Pengaman',
  idling: 'Idle Berlebih',
  other: 'Lainnya',
};

// Order matters: the first match wins, so the specific patterns sit above the
// general ones. "HarshCornering" would also match a bare /Harsh/ probe.
const ID_PATTERNS: [RegExp, Category][] = [
  [/HarshBrak/i, 'harsh-braking'],
  [/HarshAccel/i, 'harsh-acceleration'],
  [/HarshCorner|Cornering|HarshTurn/i, 'harsh-cornering'],
  [/Speeding|SpeedLimit|PostedSpeed/i, 'speeding'],
  [/Seatbelt|SeatBelt/i, 'seatbelt'],
  [/Idling|Idle/i, 'idling'],
];

// Name fallback for customer-defined rules only. Indonesian terms included
// because that is the language this reseller's customers name rules in.
// "mendadak" (sudden) is ambiguous on its own — it pairs with both braking and
// acceleration — so it is only ever read together with its verb.
const NAME_PATTERNS: [RegExp, Category][] = [
  [/harsh\s*brak|\bbrak(e|ing)\b|pengereman|rem\s*mendadak/i, 'harsh-braking'],
  [/harsh\s*accel|\baccel/i, 'harsh-acceleration'],
  [/akselerasi|percepatan|gas\s*mendadak/i, 'harsh-acceleration'],
  [/harsh\s*corner|cornering|menikung|belok\s*tajam|tikungan/i, 'harsh-cornering'],
  [/speed(ing)?|overspeed|kecepatan|ngebut|melaju/i, 'speeding'],
  [/seat\s*belt|seatbelt|sabuk/i, 'seatbelt'],
  [/idl(e|ing)|menganggur|diam\s*mesin|mesin\s*menyala/i, 'idling'],
];

export function categorize(ruleId: string, ruleName: string): Category {
  for (const [re, cat] of ID_PATTERNS) if (re.test(ruleId)) return cat;
  for (const [re, cat] of NAME_PATTERNS) if (re.test(ruleName)) return cat;
  return 'other';
}

/**
 * Which categories this database can actually measure.
 *
 * An ExceptionEvent only exists because a Rule produced it, so a category with
 * no Rule can never report anything. Without this, "Pengereman Mendadak: 0" is
 * indistinguishable from "nobody is measuring harsh braking" — the same number
 * for a safe fleet and an unmonitored one.
 *
 * Deliberately runs the SAME categorize() used to bucket the events. If coverage
 * were computed any other way the two could disagree, and a card could claim a
 * rule exists while its events land somewhere else entirely.
 *
 * `other` is always true: it is the catch-all bucket, not one specific rule.
 */
export function configuredCategories(rules: { id: string; name: string }[]): Record<Category, boolean> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, false])) as Record<Category, boolean>;
  out.other = true;
  for (const r of rules) out[categorize(r.id, r.name)] = true;
  return out;
}

export interface DeviceRate {
  deviceId: string;
  events: number;
  km: number;
  /** null when the unit logged 0 km — never Infinity, never NaN. */
  per100Km: number | null;
}

/**
 * The headline metric. Raw event counts just rank the busiest truck first, which
 * is useless for coaching — a unit doing 4000 km/week SHOULD out-count one doing
 * 200 km. Normalising per 100 km is what makes two drivers comparable.
 *
 * Units with 0 km in range (parked, or the trip fetch returned nothing for them)
 * get `per100Km: null` and sort last. Reporting them as Infinity — or worse,
 * dropping them silently — both lie.
 */
export function eventsPer100Km(events: ExceptionEventDTO[], trips: TripDTO[]): DeviceRate[] {
  const eventsById = new Map<string, number>();
  for (const e of events) eventsById.set(e.deviceId, (eventsById.get(e.deviceId) ?? 0) + 1);

  const kmById = new Map<string, number>();
  for (const t of trips) kmById.set(t.deviceId, (kmById.get(t.deviceId) ?? 0) + (t.distanceKm || 0));

  // Union: a unit with events but no trips still matters (that IS the 0-km case),
  // and a clean unit with distance is the baseline the ranking is measured against.
  const rows: DeviceRate[] = [];
  for (const deviceId of new Set([...eventsById.keys(), ...kmById.keys()])) {
    const count = eventsById.get(deviceId) ?? 0;
    const km = kmById.get(deviceId) ?? 0;
    rows.push({ deviceId, events: count, km, per100Km: km > 0 ? (count / km) * 100 : null });
  }

  return rows.sort((a, b) => {
    if (a.per100Km === null) return b.per100Km === null ? 0 : 1;
    if (b.per100Km === null) return -1;
    return b.per100Km - a.per100Km;
  });
}

export function categoryBreakdown(events: ExceptionEventDTO[]): Record<Category, number> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const e of events) out[categorize(e.ruleId, e.ruleName)]++;
  return out;
}

/** Worst category per unit, for the "kategori teratas" column. Ties break by
 *  CATEGORIES order, which is deterministic — not by Map insertion luck. */
export function topCategoryByDevice(events: ExceptionEventDTO[]): Map<string, Category> {
  const counts = new Map<string, Record<Category, number>>();
  for (const e of events) {
    let row = counts.get(e.deviceId);
    if (!row) {
      row = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
      counts.set(e.deviceId, row);
    }
    row[categorize(e.ruleId, e.ruleName)]++;
  }

  const out = new Map<string, Category>();
  for (const [deviceId, row] of counts) {
    let best: Category = 'other';
    for (const c of CATEGORIES) if (row[c] > row[best]) best = c;
    out.set(deviceId, best);
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar day, matching utils/date-range.ts. `toISOString().slice(0,10)`
 *  is the UTC day, which is the WRONG day for the first 7 hours in Jakarta. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Daily counts across the WHOLE range, including days with zero events — a line
 * chart built only from days that happened to have events draws a straight line
 * between two spikes and hides the quiet days between them.
 *
 * `fromIso`/`toIso` are the instants from toUtcRange: local midnight of dateFrom,
 * and local midnight of the day AFTER dateTo (exclusive), so iterating with
 * setDate(+1) lands on real local midnights and stays DST-safe.
 */
export function dailyTrend(
  events: ExceptionEventDTO[],
  fromIso: string,
  toIso: string
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const d = new Date(e.start);
    if (Number.isNaN(d.getTime())) continue;
    const day = localDay(d);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const from = new Date(fromIso);
  const end = new Date(toIso).getTime();
  const out: { date: string; count: number }[] = [];
  // Walk local midnights, not +86400000 ms — a DST day is 23 or 25 hours long.
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // ponytail: 366-day ceiling so a bad filter can't spin forever. Widen if the
  // date picker ever allows multi-year ranges.
  for (let guard = 0; cursor.getTime() < end && guard < 366; guard++) {
    const day = localDay(cursor);
    out.push({ date: day, count: counts.get(day) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Geotab's sentinel for "no driver was identified on this trip". */
const UNKNOWN_DRIVER_ID = 'UnknownDriverId';

/**
 * Fraction of trips (0..1) that carry a real driver identity.
 *
 * WHY THIS EXISTS: many Indonesian fleets run no NFC/iButton driver ID at all,
 * so every trip comes back as UnknownDriverId. A "driver leaderboard" built on
 * that is one row called Unknown Driver holding the whole fleet's violations —
 * worse than useless, because it looks authoritative. The view gates the
 * per-driver ranking on this number.
 *
 * TripDTO carries an optional driverId, already normalised by trip.ts so that
 * Geotab's UnknownDriverId sentinel arrives as undefined. The accessor stays
 * injectable for callers that hold driver identity somewhere else.
 */
export function driverAttributionRate(
  trips: TripDTO[],
  getDriverId: (t: TripDTO) => string | null | undefined = (t) =>
    (t as TripDTO & { driverId?: string | null }).driverId
): number {
  if (trips.length === 0) return 0; // 0, not 0/0 = NaN
  let known = 0;
  for (const t of trips) {
    const id = getDriverId(t);
    if (id && id !== UNKNOWN_DRIVER_ID) known++;
  }
  return known / trips.length;
}

export interface DriverRate extends DeviceRate {
  driverId: string;
  name: string;
}

/**
 * Per-driver rates. ExceptionEvent carries only a device, never a driver, so the
 * driver has to be joined through the trip that was running when the event
 * fired: same device, trip start <= event start < trip stop.
 *
 * Only call this when driverAttributionRate() clears the gate — on a fleet with
 * no NFC/iButton readers this collapses to a single "Unknown Driver" row holding
 * every violation, which reads as authoritative and is worthless.
 *
 * Trips are indexed per device and binary-searched, so a real range (5k+ events,
 * 10k+ trips) stays roughly n log n instead of a 50M-comparison nested scan.
 */
export function rankDrivers(
  events: ExceptionEventDTO[],
  trips: TripDTO[],
  drivers: { id: string; name: string }[],
  getDriverId: (t: TripDTO) => string | null | undefined = (t) =>
    (t as TripDTO & { driverId?: string | null }).driverId
): DriverRate[] {
  interface Window { start: number; stop: number; driverId: string }

  const windowsByDevice = new Map<string, Window[]>();
  const kmByDriver = new Map<string, number>();

  for (const t of trips) {
    const driverId = getDriverId(t);
    if (!driverId || driverId === UNKNOWN_DRIVER_ID) continue;
    const start = new Date(t.start).getTime();
    const stop = new Date(t.stop).getTime();
    if (Number.isNaN(start) || Number.isNaN(stop)) continue;

    let list = windowsByDevice.get(t.deviceId);
    if (!list) windowsByDevice.set(t.deviceId, (list = []));
    list.push({ start, stop, driverId });
    kmByDriver.set(driverId, (kmByDriver.get(driverId) ?? 0) + (t.distanceKm || 0));
  }
  for (const list of windowsByDevice.values()) list.sort((a, b) => a.start - b.start);

  const eventsByDriver = new Map<string, number>();
  for (const e of events) {
    const list = windowsByDevice.get(e.deviceId);
    if (!list) continue;
    const at = new Date(e.start).getTime();
    if (Number.isNaN(at)) continue;

    // Rightmost trip starting at or before the event.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= at) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // An event between two trips (engine off) belongs to no driver — skip it
    // rather than blaming whoever drove most recently.
    if (found >= 0 && at < list[found].stop) {
      const id = list[found].driverId;
      eventsByDriver.set(id, (eventsByDriver.get(id) ?? 0) + 1);
    }
  }

  const nameById = new Map(drivers.map((d) => [d.id, d.name]));
  const rows: DriverRate[] = [];
  for (const driverId of new Set([...eventsByDriver.keys(), ...kmByDriver.keys()])) {
    const count = eventsByDriver.get(driverId) ?? 0;
    const km = kmByDriver.get(driverId) ?? 0;
    rows.push({
      driverId,
      deviceId: driverId, // DeviceRate shape reuse; the table keys off driverId
      name: nameById.get(driverId) || driverId,
      events: count,
      km,
      per100Km: km > 0 ? (count / km) * 100 : null,
    });
  }

  return rows.sort((a, b) => {
    if (a.per100Km === null) return b.per100Km === null ? 0 : 1;
    if (b.per100Km === null) return -1;
    return b.per100Km - a.per100Km;
  });
}

export interface RankedDevice extends DeviceRate {
  name: string;
}

/** Attaches display names, falling back to the raw id so a row is never blank
 *  (a device deleted mid-range still has events attributed to it). Order is
 *  preserved — eventsPer100Km already sorted worst-first. */
export function rankDevices(perDevice: DeviceRate[], devices: DeviceLite[]): RankedDevice[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  return perDevice.map((r) => ({ ...r, name: nameById.get(r.deviceId) || r.deviceId }));
}
