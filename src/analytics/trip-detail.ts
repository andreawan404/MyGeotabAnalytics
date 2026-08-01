// Per-trip detail for the trip-timeline tooltip. PURE — no DOM, no Chart.js, no
// fetchers — so it runs under plain `tsx` (see trip-detail.check.ts).
//
// Why this module exists: the timeline tooltip used to print Chart.js's raw
// floating-bar payload — `Trips: [1785029489000, 1785029895000]` — two epoch-ms
// numbers, which tell a dispatcher nothing. What they actually want per bar is
// how long the engine ran, how far the unit went, and how much fuel it burnt.

import type { TripDTO, DeviceLite, StatusDataDTO } from '../api/fetchers/types';

export interface TripDetail {
  tripId: string;
  deviceName: string;
  startMs: number;
  stopMs: number;
  engineOnSec: number;
  distanceKm: number;
  /** Litres, or null when this unit does not measure fuel. null is NOT zero and
   *  is never a distance x ratio estimate — see fuelPerTrip. The tooltip renders
   *  it as "—" with the reason. */
  fuelL: number | null;
}

/**
 * A Geotab Trip spans ignition-on -> ignition-off, so engine-on time IS
 * `stop - start`.
 *
 * `drivingDurationSec + idlingDurationSec` is a near-equal alternative but not
 * an identical one — it excludes any stopped-with-ignition-on tail Geotab
 * classifies as neither — so the trip boundaries are the truth here.
 *
 * Invalid, missing or reversed dates -> 0. Never NaN.
 */
export function engineOnSec(trip: TripDTO): number {
  const start = Date.parse(trip.start);
  const stop = Date.parse(trip.stop);
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return 0;
  return Math.max(0, Math.round((stop - start) / 1000));
}

/** Sorted list -> index of the last reading at or before `ms`, or -1. The list
 *  is chronological, so the first reading past `ms` ends the walk. */
function lastIndexAtOrBefore(list: StatusDataDTO[], ms: number): number {
  let idx = -1;
  for (let i = 0; i < list.length; i++) {
    if (Date.parse(list[i].dateTime) <= ms) idx = i;
    else break;
  }
  return idx;
}

/** See the closing-boundary comment in fuelForTrip. */
const IGNITION_OFF_GRACE_MS = 5 * 60 * 1000;

function fuelForTrip(trip: TripDTO, list: StatusDataDTO[] | undefined): number | null {
  if (!list || list.length === 0) return null;

  const startMs = Date.parse(trip.start);
  const stopMs = Date.parse(trip.stop);
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return null;

  const a = lastIndexAtOrBefore(list, startMs);
  // Grace window on the closing boundary: "Total fuel used" is written AT
  // ignition-off, and that record's timestamp routinely lands a moment AFTER
  // trip.stop. Looking only at/before trip.stop misses the very reading that
  // closes the trip, so every trip reads as unmeasured. The window stays small
  // enough that it cannot reach the next trip's own ignition-off record.
  const b = lastIndexAtOrBefore(list, stopMs + IGNITION_OFF_GRACE_MS);

  // a < 0: the counter has no reading at or before this trip started, so there
  // is no baseline to subtract from.
  // b <= a: the same reading bounds both ends — the counter never reported
  // anything INSIDE the trip, so nothing here measures it. Returning 0 would be
  // inventing a measurement out of an absence of data, which is the whole thing
  // this module refuses to do.
  if (a < 0 || b <= a) return null;

  const delta = list[b].value - list[a].value;
  // A decrease means an ECU swap or a counter reset, not negative fuel.
  if (!Number.isFinite(delta) || delta < 0) return null;
  return delta;
}

/**
 * Litres burnt per trip, from a CUMULATIVE "total fuel used" counter: the delta
 * between the last reading at/before `trip.stop` and the last at/before
 * `trip.start`.
 *
 * Rows arrive in no promised order and mix every device together, so they are
 * grouped per device and sorted chronologically first — both boundary lookups
 * are meaningless otherwise. Returns null (never NaN, never a negative) for any
 * trip the counter does not actually cover.
 */
export function fuelPerTrip(trips: TripDTO[], rows: StatusDataDTO[]): Record<string, number | null> {
  const byDevice = new Map<string, StatusDataDTO[]>();
  for (const r of rows) {
    if (!Number.isFinite(Date.parse(r.dateTime)) || !Number.isFinite(r.value)) continue;
    const list = byDevice.get(r.deviceId);
    if (list) list.push(r);
    else byDevice.set(r.deviceId, [r]);
  }
  for (const list of byDevice.values()) {
    list.sort((x, y) => Date.parse(x.dateTime) - Date.parse(y.dateTime));
  }

  const out: Record<string, number | null> = {};
  for (const trip of trips) out[trip.id] = fuelForTrip(trip, byDevice.get(trip.deviceId));
  return out;
}

/** One TripDetail per trip, in the SAME ORDER as the input trips. That ordering
 *  is a contract: trip-timeline.ts indexes this array with Chart.js's
 *  `dataIndex`, which addresses `tripsToFloatingBars(trips, ...)` — also a
 *  straight `trips.map`. Neither may filter. */
export function buildTripDetails(
  trips: TripDTO[],
  devices: DeviceLite[],
  fuelByTrip: Record<string, number | null>
): TripDetail[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  return trips.map((t) => ({
    tripId: t.id,
    deviceName: nameById.get(t.deviceId) ?? t.deviceId,
    startMs: Date.parse(t.start),
    stopMs: Date.parse(t.stop),
    engineOnSec: engineOnSec(t),
    distanceKm: Number.isFinite(t.distanceKm) ? t.distanceKm : 0,
    fuelL: fuelByTrip[t.id] ?? null,
  }));
}

/** "2j 15m" / "15m" / "45dtk" / "0m". Single-token units so the parts read as
 *  one value, Indonesian throughout (j = jam, m = menit, dtk = detik). */
export function formatDurationId(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  const total = Math.floor(sec);
  if (total < 60) return `${total}dtk`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

const nf1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "01 Agu 08.00 – 09.30", carrying the date on both ends only when the trip
 *  crosses local midnight (the visible range is often a week, so a bare clock
 *  time would be ambiguous on the start side regardless). */
function formatSpan(startMs: number, stopMs: number): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return '—';
  const start = new Date(startMs);
  const stop = new Date(stopMs);
  const sameDay = start.toDateString() === stop.toDateString();
  return `${dateTimeFmt.format(start)} – ${sameDay ? timeFmt.format(stop) : dateTimeFmt.format(stop)}`;
}

/** The tooltip body, one string per line. All copy Bahasa Indonesia, all numbers
 *  id-ID formatted (decimal comma). */
export function formatTripTooltip(d: TripDetail): string[] {
  return [
    `Mesin menyala: ${formatDurationId(d.engineOnSec)}`,
    `Jarak: ${nf1.format(Number.isFinite(d.distanceKm) ? d.distanceKm : 0)} km`,
    d.fuelL === null || !Number.isFinite(d.fuelL)
      ? 'BBM: — (tidak dilaporkan unit ini)'
      : `BBM: ${nf1.format(d.fuelL)} L`,
    `Waktu: ${formatSpan(d.startMs, d.stopMs)}`,
  ];
}
