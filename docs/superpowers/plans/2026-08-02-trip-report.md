# Trip Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Trip Report" view listing journeys between registered geofences — departure zone and time, arrival zone and time, duration, distance and fuel.

**Architecture:** One pure module (`src/analytics/trip-report.ts`) chains consecutive `Trip` records per device until the vehicle stops inside a registered `Zone` for at least a dwell threshold; one view module fetches and renders. Zone attribution reuses the existing `pointInPolygon`. No new fetcher — zones, trips, devices and the fuel ladder all already exist.

**Tech Stack:** TypeScript, Vite, vanilla DOM (no framework), `node:assert` + `tsx` for checks. No new npm dependencies.

## Global Constraints

- **No new npm dependencies.** Chart.js and Leaflet are installed; this view needs neither.
- **All UI copy in Bahasa Indonesia.**
- **`src/analytics/*` must stay pure** — no DOM, no Chart.js, no Leaflet, no fetcher imports. That is the only reason `*.check.ts` runs under plain `tsx`.
- **Never call `api.call` or import `geotabClient`** outside `src/api/`. Views use fetchers only.
- **Never loop a fetcher per device or per trip.** Real fleet, real rate limit.
- **Escape all customer free text** before `innerHTML` (device names, zone names).
- **Colors come from the existing `--fa-*` custom properties** in `dashboard.css`. No new hex values, no restyling shared classes.
- **Locale formatting is `id-ID`.**
- Every view returns a cleanup function that removes every listener it added.

---

### Task 1: Pure journey builder

**Files:**
- Create: `src/analytics/trip-report.ts`
- Test: `src/analytics/trip-report.check.ts`
- Modify: `package.json` (append the new check to the `check` script)

**Interfaces:**
- Consumes: `TripDTO`, `ZoneDTO`, `DeviceLite` from `src/api/fetchers/types`; `pointInPolygon` from `src/utils/geo`.
- Produces: `ZoneRef`, `JourneyRow`, `resolveZone`, `buildJourneys`, `summariseUnmatched` — all imported by Task 2.

`TripDTO` fields used: `id`, `deviceId`, `start`, `stop`, `distanceKm`, `startLat`, `startLon`, `stopLat`, `stopLon`.
`ZoneDTO` fields used: `id`, `name`, `points` (`{lat, lon}[]`).
`DeviceLite`: `{ id, name }`.

- [ ] **Step 1: Write the failing test**

Create `src/analytics/trip-report.check.ts`:

```ts
import assert from 'node:assert';
import { resolveZone, buildJourneys, summariseUnmatched } from './trip-report';
import type { TripDTO, ZoneDTO, DeviceLite } from '../api/fetchers/types';

function square(id: string, name: string, lat: number, lon: number, half: number): ZoneDTO {
  return {
    id, name,
    points: [
      { lat: lat - half, lon: lon - half },
      { lat: lat - half, lon: lon + half },
      { lat: lat + half, lon: lon + half },
      { lat: lat + half, lon: lon - half },
    ],
    centerLat: lat, centerLon: lon,
  };
}

// A big city zone with a small depot inside it — the overlap case.
const city = square('z-city', 'Jakarta', -6.2, 106.8, 0.5);
const depot = square('z-depot', 'Depot Cikarang', -6.2, 106.8, 0.02);
const port = square('z-port', 'Tanjung Priok', -6.1, 106.88, 0.03);
const zones = [city, depot, port];

const devices: DeviceLite[] = [{ id: 'd1', name: 'Truck Alpha' }];

function trip(over: Partial<TripDTO> & Pick<TripDTO, 'id' | 'start' | 'stop'>): TripDTO {
  return {
    deviceId: 'd1', distanceKm: 10, drivingDurationSec: 0, idlingDurationSec: 0,
    startLat: -6.2, startLon: 106.8, stopLat: -6.1, stopLon: 106.88, ...over,
  } as TripDTO;
}

// --- resolveZone -------------------------------------------------------------
assert.strictEqual(resolveZone({ lat: -6.2, lon: 106.8 }, zones)?.id, 'z-depot',
  'overlapping zones must resolve to the SMALLEST, or every journey reads Jakarta -> Jakarta');
assert.strictEqual(resolveZone({ lat: -6.1, lon: 106.88 }, zones)?.id, 'z-port');
assert.strictEqual(resolveZone({ lat: 0, lon: 0 }, zones), null, 'outside every zone -> null');
assert.strictEqual(resolveZone({ lat: -6.2, lon: 106.8 }, []), null, 'no zones -> null');

// --- buildJourneys: a short stop must NOT split a journey ---------------------
{
  const trips = [
    // depot -> nowhere, 08:00-09:00
    trip({ id: 't1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0, distanceKm: 30 }),
    // 10 minute refuelling gap, then nowhere -> port, 09:10-10:00
    trip({ id: 't2', start: '2026-08-01T09:10:00.000Z', stop: '2026-08-01T10:00:00.000Z',
           startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88, distanceKm: 20 }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 1, 'a 10-minute stop is shorter than the 15-minute dwell -> one journey');
  assert.strictEqual(rows[0].fromZone.id, 'z-depot');
  assert.strictEqual(rows[0].toZone.id, 'z-port');
  assert.strictEqual(rows[0].departAt, '2026-08-01T08:00:00.000Z');
  assert.strictEqual(rows[0].arriveAt, '2026-08-01T10:00:00.000Z');
  assert.strictEqual(rows[0].durationSec, 7200, 'arrive - depart, INCLUDING the stop in between');
  assert.strictEqual(rows[0].distanceKm, 50);
  assert.strictEqual(rows[0].stops, 1);
  assert.deepStrictEqual(rows[0].tripIds, ['t1', 't2']);
  assert.strictEqual(rows[0].isRoundTrip, false);
  assert.strictEqual(rows[0].deviceName, 'Truck Alpha');
}

// --- a long dwell inside a zone CLOSES the journey ----------------------------
{
  const trips = [
    trip({ id: 'a1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: -6.2, startLon: 106.8, stopLat: -6.1, stopLon: 106.88 }),
    // resumes 2 hours later -> the first journey already ended at the port
    trip({ id: 'a2', start: '2026-08-01T11:00:00.000Z', stop: '2026-08-01T12:00:00.000Z',
           startLat: -6.1, startLon: 106.88, stopLat: -6.2, stopLon: 106.8 }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].toZone.id, 'z-port');
  assert.strictEqual(rows[1].fromZone.id, 'z-port');
  assert.strictEqual(rows[1].toZone.id, 'z-depot');
}

// --- round trip: depot -> unregistered -> depot -------------------------------
{
  const trips = [
    trip({ id: 'r1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0 }),
    trip({ id: 'r2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
           startLat: 0, startLon: 0, stopLat: -6.2, stopLon: 106.8 }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].isRoundTrip, true, 'depot -> depot is a real delivery run');
  assert.strictEqual(rows[0].fromZone.id, 'z-depot');
  assert.strictEqual(rows[0].toZone.id, 'z-depot');
}

// --- a chain whose origin is unknown is NOT emitted ---------------------------
{
  const trips = [
    trip({ id: 'u1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88, distanceKm: 40 }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.deepStrictEqual(rows, [], 'origin outside every zone -> no row');

  const unmatched = summariseUnmatched(trips, rows);
  assert.strictEqual(unmatched.trips, 1, 'a dropped chain must still be counted');
  assert.strictEqual(unmatched.distanceKm, 40);
}

// --- fuel: any missing leg makes the whole journey null -----------------------
{
  const trips = [
    trip({ id: 'f1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0 }),
    trip({ id: 'f2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
           startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88 }),
  ];
  const both = buildJourneys(trips, zones, devices, { dwellMinutes: 15, fuelByTrip: { f1: 3, f2: 4 } });
  assert.strictEqual(both[0].fuelL, 7, 'legs summed when every leg is measured');

  const partial = buildJourneys(trips, zones, devices, { dwellMinutes: 15, fuelByTrip: { f1: 3, f2: null } });
  assert.strictEqual(partial[0].fuelL, null, 'a partial sum understates consumption and must not be shown');

  const none = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(none[0].fuelL, null, 'no fuel data at all -> null, never 0');
}

// --- devices are independent: trips must not chain across vehicles ------------
{
  const trips = [
    trip({ id: 'x1', deviceId: 'd1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0 }),
    trip({ id: 'x2', deviceId: 'd2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
           startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88 }),
  ];
  const rows = buildJourneys(trips, zones, [...devices, { id: 'd2', name: 'Van Bravo' }], { dwellMinutes: 15 });
  assert.deepStrictEqual(rows, [], 'two different vehicles never form one journey');
}

// --- unsorted input, unknown device, empty input ------------------------------
{
  const trips = [
    trip({ id: 's2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
           startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88 }),
    trip({ id: 's1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
           startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0 }),
  ];
  const rows = buildJourneys(trips, zones, [], { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 1, 'input order must not matter');
  assert.deepStrictEqual(rows[0].tripIds, ['s1', 's2']);
  assert.strictEqual(rows[0].deviceName, 'd1', 'unknown device falls back to its id');
}

assert.deepStrictEqual(buildJourneys([], zones, devices, { dwellMinutes: 15 }), []);
assert.deepStrictEqual(summariseUnmatched([], []), { trips: 0, distanceKm: 0 });

console.log('trip-report.check.ts: PASS');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/analytics/trip-report.check.ts`
Expected: FAIL — `Cannot find module './trip-report'`

- [ ] **Step 3: Write minimal implementation**

Create `src/analytics/trip-report.ts`:

```ts
// Journeys between registered geofences. PURE: no DOM, no Chart.js, no fetchers
// — that is the only reason trip-report.check.ts runs under plain `tsx`.
//
// A Geotab Trip is ignition-on -> ignition-off, so one journey Cikarang -> Priok
// with a refuelling stop is THREE trips, two of which begin and end nowhere in
// particular. Reading raw trips answers no operational question, so consecutive
// trips are chained until the vehicle actually stops somewhere registered.

import type { TripDTO, ZoneDTO, DeviceLite } from '../api/fetchers/types';
import { pointInPolygon } from '../utils/geo';

export interface ZoneRef {
  id: string;
  name: string;
}

export interface JourneyRow {
  deviceId: string;
  deviceName: string;
  fromZone: ZoneRef;
  toZone: ZoneRef;
  departAt: string;
  arriveAt: string;
  /** arrive - depart, INCLUDING intermediate stops: that is the elapsed time
   *  operations actually feels. */
  durationSec: number;
  distanceKm: number;
  /** null when any leg is unmeasured — a partial sum understates consumption
   *  while looking like a measurement. */
  fuelL: number | null;
  stops: number;
  tripIds: string[];
  isRoundTrip: boolean;
}

/** Bounding-box area. Enough to rank "more specific" without computing real
 *  polygon area, which buys nothing here. */
function zoneArea(zone: ZoneDTO): number {
  if (zone.points.length === 0) return Infinity;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of zone.points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return (maxLat - minLat) * (maxLon - minLon);
}

/**
 * SMALLEST containing zone wins, not the first match. A depot usually sits
 * inside a city-sized zone; taking the first hit would label every journey
 * "Jakarta -> Jakarta" and the whole report would say nothing.
 */
export function resolveZone(point: { lat: number; lon: number }, zones: ZoneDTO[]): ZoneRef | null {
  let best: ZoneDTO | null = null;
  let bestArea = Infinity;
  for (const z of zones) {
    if (z.points.length < 3) continue; // not a polygon
    if (!pointInPolygon(point, z.points)) continue;
    const area = zoneArea(z);
    if (area < bestArea) {
      best = z;
      bestArea = area;
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export interface BuildOptions {
  dwellMinutes: number;
  /** tripId -> litres, or null when that trip has no reading. */
  fuelByTrip?: Record<string, number | null>;
}

export function buildJourneys(
  trips: TripDTO[],
  zones: ZoneDTO[],
  devices: DeviceLite[],
  opts: BuildOptions
): JourneyRow[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  const dwellMs = Math.max(0, opts.dwellMinutes) * 60_000;

  const byDevice = new Map<string, TripDTO[]>();
  for (const t of trips) {
    if (!Number.isFinite(Date.parse(t.start)) || !Number.isFinite(Date.parse(t.stop))) continue;
    const list = byDevice.get(t.deviceId);
    if (list) list.push(t);
    else byDevice.set(t.deviceId, [t]);
  }

  const out: JourneyRow[] = [];
  for (const [deviceId, list] of byDevice) {
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    let chain: TripDTO[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      chain.push(t);

      const endZone = resolveZone({ lat: t.stopLat, lon: t.stopLon }, zones);
      const next = list[i + 1];
      // Last trip of this vehicle counts as settled: there is no later movement
      // to tell us otherwise.
      const dwelled = !next || Date.parse(next.start) - Date.parse(t.stop) >= dwellMs;

      if (!endZone || !dwelled) continue;

      const first = chain[0];
      const startZone = resolveZone({ lat: first.startLat, lon: first.startLon }, zones);
      if (startZone) {
        let fuelL: number | null = 0;
        for (const leg of chain) {
          const litres = opts.fuelByTrip?.[leg.id];
          if (typeof litres !== 'number') { fuelL = null; break; }
          fuelL += litres;
        }

        out.push({
          deviceId,
          deviceName: nameById.get(deviceId) ?? deviceId,
          fromZone: startZone,
          toZone: endZone,
          departAt: first.start,
          arriveAt: t.stop,
          durationSec: Math.max(0, (Date.parse(t.stop) - Date.parse(first.start)) / 1000),
          distanceKm: chain.reduce((sum, x) => sum + (Number.isFinite(x.distanceKm) ? x.distanceKm : 0), 0),
          fuelL,
          stops: chain.length - 1,
          tripIds: chain.map((x) => x.id),
          isRoundTrip: startZone.id === endZone.id,
        });
      }
      chain = [];
    }
  }

  return out.sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt));
}

/** Trips that made it into no row at all — including chains dropped because an
 *  endpoint was outside every zone. Without this, journeys vanish silently and
 *  nobody learns they need more geofences. */
export function summariseUnmatched(
  trips: TripDTO[],
  journeys: JourneyRow[]
): { trips: number; distanceKm: number } {
  const used = new Set(journeys.flatMap((j) => j.tripIds));
  let count = 0;
  let distanceKm = 0;
  for (const t of trips) {
    if (used.has(t.id)) continue;
    count++;
    distanceKm += Number.isFinite(t.distanceKm) ? t.distanceKm : 0;
  }
  return { trips: count, distanceKm };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/analytics/trip-report.check.ts`
Expected: `trip-report.check.ts: PASS`

- [ ] **Step 5: Register the check and verify the whole suite**

In `package.json`, append to the end of the `check` script value:

```
 && tsx src/analytics/trip-report.check.ts
```

Run: `npm run check`
Expected: 20 checks, all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/analytics/trip-report.ts src/analytics/trip-report.check.ts package.json
git commit -m "feat: pure zone-to-zone journey builder for Trip Report"
```

---

### Task 2: Trip Report view, registered in the menu

**Files:**
- Create: `src/views/trip-report.ts`
- Create: `src/styles/trip-report.css`
- Modify: `src/views/registry.ts` (one row, immediately after `overview`)
- Modify: `dev/fixtures.ts` (zones must actually contain some trip endpoints)

**Interfaces:**
- Consumes: `resolveZone`, `buildJourneys`, `summariseUnmatched`, `JourneyRow` from Task 1; `fetchZones`, `fetchTrips`, `fetchDevices`, `fetchDiagnostics`, `resolveCumulativeFuelDiagnosticId`, `probeDiagnostics`, `fetchStatusData`, `fuelPerTrip`, `toUtcRange`, `getCurrentFilter`, `onFilterChangeVisible`.
- Produces: `initTripReportView: ViewInit` — the registry's only entry point.

Existing signatures this task depends on (do not redefine them):
- `fetchZones({ database }): Promise<ZoneDTO[]>`
- `fetchTrips({ database, fromDate, toDate, groupId? }): Promise<TripDTO[]>`
- `fetchDevices({ database, groupId?, fromDate?, toDate? }): Promise<DeviceLite[]>`
- `fetchDiagnostics({ database }): Promise<DiagnosticDTO[]>`
- `resolveCumulativeFuelDiagnosticId(diagnostics: DiagnosticDTO[]): string | null`
- `probeDiagnostics({ database, diagnosticIds, toIso, groupId? }): Promise<Record<string, boolean>>`
- `fetchStatusData({ database, diagnosticId, fromDate, toDate, groupId? }): Promise<StatusDataDTO[]>`
- `fuelPerTrip(trips: TripDTO[], rows: StatusDataDTO[]): Record<string, number | null>` (from `src/analytics/trip-detail`)
- `toUtcRange(dateFrom, dateTo): { fromIso, toIso, periodSec }`
- `onFilterChangeVisible(rootEl, el, load): () => void`

- [ ] **Step 1: Make the fixtures able to produce a journey**

`dev/fixtures.ts` already defines `rawZones` and `TRIP_SPECS`. The trip endpoints are Jakarta-area constants (`KEMAYORAN`, `TG_PRIOK`, `CIKARANG`, `BSD`, `SUDIRMAN`, `KELAPA_GADING`, `TANGERANG`). Replace the `rawZones` array so three zones are small squares centred exactly on trip endpoints, plus one deliberately large overlapping zone:

```ts
// Squares centred on real trip endpoints so dev mode actually produces
// zone-to-zone journeys. `big` overlaps the others on purpose: resolveZone must
// pick the SMALLEST match, or every row would read "Jabodetabek -> Jabodetabek".
function zoneSquare(id: string, name: string, c: { lat: number; lon: number }, half: number) {
  return {
    id,
    name,
    points: [
      { x: c.lon - half, y: c.lat - half },
      { x: c.lon + half, y: c.lat - half },
      { x: c.lon + half, y: c.lat + half },
      { x: c.lon - half, y: c.lat + half },
    ],
  };
}

export const rawZones = [
  zoneSquare('zone-kemayoran', 'Depot Kemayoran', KEMAYORAN, 0.02),
  zoneSquare('zone-priok', 'Tanjung Priok', TG_PRIOK, 0.02),
  zoneSquare('zone-cikarang', 'Gudang Cikarang', CIKARANG, 0.02),
  zoneSquare('zone-big', 'Jabodetabek', { lat: -6.2, lon: 106.85 }, 0.9),
];
```

Keep the Geotab `{x: lon, y: lat}` point shape — `zone.ts`'s `toDTO` reads `p.y` as latitude.

- [ ] **Step 2: Write the view**

Create `src/views/trip-report.ts`:

```ts
// "Trip Report" — journeys between registered geofences.
//
// A Geotab Trip is ignition-on -> ignition-off, so the chaining that turns three
// raw trips into one Cikarang -> Priok journey lives in analytics/trip-report.ts
// (pure, self-checked). This file only fetches, renders and cleans up.
//
// Cost: zones + trips + devices (all cached and shared with other views), and
// the fuel ladder only when the database actually reports a cumulative counter.

import '../styles/trip-report.css';
import { fetchZones } from '../api/fetchers/zone';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import { fetchDiagnostics, resolveCumulativeFuelDiagnosticId } from '../api/fetchers/diagnostic';
import { probeDiagnostics } from '../api/fetchers/probe';
import { fetchStatusData } from '../api/fetchers/status-data';
import { fuelPerTrip } from '../analytics/trip-detail';
import { buildJourneys, summariseUnmatched, type JourneyRow } from '../analytics/trip-report';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import type { ViewCtx } from './registry';
import type { TripDTO, ZoneDTO, DeviceLite, FilterChangeDetail } from '../api/fetchers/types';

const DEFAULT_DWELL_MINUTES = 15;
const STORAGE_PREFIX = 'fleet-analytics:trip-report-dwell:';
const MAX_ROWS = 200; // a worklist, not an export

const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function loadDwell(database: string): number {
  const n = Number(localStorage.getItem(STORAGE_PREFIX + database));
  return Number.isFinite(n) && n >= 0 && n <= 720 ? n : DEFAULT_DWELL_MINUTES;
}

function formatDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

interface Snapshot {
  trips: TripDTO[];
  zones: ZoneDTO[];
  devices: DeviceLite[];
  fuelByTrip: Record<string, number | null>;
}

export function initTripReportView(container: HTMLElement, ctx: ViewCtx): () => void {
  let dwellMinutes = loadDwell(ctx.database);
  let snapshot: Snapshot | null = null;
  let seq = 0;

  async function load(filter: FilterChangeDetail): Promise<void> {
    const run = ++seq;
    container.innerHTML = '<p class="fa-empty">Memuat laporan perjalanan…</p>';
    const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
    const groupId = filter.groupId;

    try {
      const [trips, zones, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchZones({ database: ctx.database }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
      ]);
      if (run !== seq) return;

      const fuelByTrip = await loadFuel(trips, fromIso, toIso, groupId);
      if (run !== seq) return;

      snapshot = { trips, zones, devices, fuelByTrip };
      render();
    } catch (err) {
      if (run !== seq) return;
      console.error('trip-report: load failed', err);
      container.innerHTML =
        '<p class="fa-empty fa-error">Gagal memuat laporan perjalanan. Periksa koneksi atau hak akses, lalu ubah filter untuk mencoba lagi.</p>';
    }
  }

  /** Same ladder as the trip timeline tooltip: resolve the cumulative counter by
   *  id, probe it, and only then pull StatusData. Unavailable -> no extra call. */
  async function loadFuel(
    trips: TripDTO[], fromIso: string, toIso: string, groupId?: string
  ): Promise<Record<string, number | null>> {
    if (trips.length === 0) return {};
    try {
      const diagnostics = await fetchDiagnostics({ database: ctx.database });
      const diagnosticId = resolveCumulativeFuelDiagnosticId(diagnostics);
      if (!diagnosticId) return {};
      const probe = await probeDiagnostics({ database: ctx.database, diagnosticIds: [diagnosticId], toIso, groupId });
      if (probe[diagnosticId] !== true) return {};
      const rows = await fetchStatusData({ database: ctx.database, diagnosticId, fromDate: fromIso, toDate: toIso, groupId });
      return fuelPerTrip(trips, rows);
    } catch (err) {
      // Fuel is a column, not the report. Losing it must not lose the journeys.
      console.warn('trip-report: fuel unavailable', err);
      return {};
    }
  }

  function render(): void {
    if (!snapshot) return;
    const { trips, zones, devices, fuelByTrip } = snapshot;

    if (zones.length === 0) {
      container.innerHTML =
        '<p class="fa-empty">Belum ada geofence/zona terdaftar di database ini. Buat zona dulu di MyGeotab — laporan ini menyusun perjalanan dari zona ke zona.</p>';
      return;
    }
    if (trips.length === 0) {
      container.innerHTML = '<p class="fa-empty">Tidak ada perjalanan pada rentang tanggal ini.</p>';
      return;
    }

    const rows = buildJourneys(trips, zones, devices, { dwellMinutes, fuelByTrip });
    const unmatched = summariseUnmatched(trips, rows);
    const anyFuel = rows.some((r) => r.fuelL !== null);

    if (rows.length === 0) {
      container.innerHTML = `
        ${controls()}
        <p class="fa-empty">Ada ${nf0.format(trips.length)} perjalanan pada rentang ini, tapi tidak ada yang berawal DAN berakhir di zona terdaftar
        (total ${nf1.format(unmatched.distanceKm)} km). Tambahkan geofence di lokasi yang sering dikunjungi agar muncul di sini.</p>`;
      return;
    }

    const shown = rows.slice(0, MAX_ROWS);
    container.innerHTML = `
      ${controls()}
      <div class="tr-tablewrap">
        <table class="fa-table tr-table">
          <thead><tr>
            <th>Unit</th><th>Dari</th><th>Ke</th>
            <th class="tr-num">Durasi</th><th class="tr-num">Jarak (km)</th>
            ${anyFuel ? '<th class="tr-num">BBM (L)</th>' : ''}
            <th class="tr-num">Berhenti</th>
          </tr></thead>
          <tbody>${shown.map((r) => row(r, anyFuel)).join('')}</tbody>
        </table>
      </div>
      ${rows.length > shown.length ? `<p class="tr-note">Menampilkan ${nf0.format(shown.length)} dari ${nf0.format(rows.length)} perjalanan.</p>` : ''}
      ${
        unmatched.trips > 0
          ? `<p class="tr-note">${nf0.format(unmatched.trips)} perjalanan lain berakhir di luar zona terdaftar (total ${nf1.format(unmatched.distanceKm)} km) — tidak muncul di tabel ini.</p>`
          : ''
      }
      ${
        anyFuel
          ? ''
          : '<p class="tr-note">Kolom BBM disembunyikan: database ini tidak melaporkan counter bahan bakar mesin, jadi konsumsi per perjalanan tidak terukur.</p>'
      }`;
  }

  function row(r: JourneyRow, anyFuel: boolean): string {
    return `
      <tr>
        <td>${esc(r.deviceName)}</td>
        <td>
          <div class="tr-zone">${esc(r.fromZone.name)}</div>
          <div class="tr-when">${esc(formatWhen(r.departAt))}</div>
        </td>
        <td>
          <div class="tr-zone">${esc(r.toZone.name)}${r.isRoundTrip ? '<span class="tr-badge">pulang-pergi</span>' : ''}</div>
          <div class="tr-when">${esc(formatWhen(r.arriveAt))}</div>
        </td>
        <td class="tr-num">${esc(formatDur(r.durationSec))}</td>
        <td class="tr-num">${nf1.format(r.distanceKm)}</td>
        ${anyFuel ? `<td class="tr-num">${r.fuelL === null ? '<span class="tr-na">—</span>' : nf1.format(r.fuelL)}</td>` : ''}
        <td class="tr-num">${nf0.format(r.stops)}</td>
      </tr>`;
  }

  function controls(): string {
    return `
      <div class="tr-controls">
        <label class="tr-field">Ambang berhenti (menit)
          <input type="number" id="tr-dwell" min="0" max="720" step="5" value="${dwellMinutes}">
        </label>
        <span class="tr-hint">Berhenti lebih singkat dari ini dianggap masih satu perjalanan — mis. mampir isi BBM tidak memecah perjalanan jadi dua.</span>
      </div>`;
  }

  // Changing the dwell threshold only re-chains data we already hold — no refetch.
  function onInput(e: Event): void {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.id !== 'tr-dwell') return;
    const n = Number(el.value);
    if (!Number.isFinite(n) || n < 0 || n > 720) return;
    dwellMinutes = n;
    try {
      localStorage.setItem(STORAGE_PREFIX + ctx.database, String(n));
    } catch {
      /* private mode — the setting just will not persist */
    }
    render();
  }

  container.addEventListener('change', onInput);
  const stopFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  void load(getCurrentFilter());

  return () => {
    seq++; // in-flight loads become stale and will not paint
    container.removeEventListener('change', onInput);
    stopFilter();
  };
}
```

- [ ] **Step 3: Write the stylesheet**

Create `src/styles/trip-report.css`:

```css
/* Trip Report. Only tr-* classes; every colour is an existing --fa-* property
   so there is no second palette to keep in sync. */

.tr-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.tr-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: var(--fa-muted);
}

.tr-field input {
  font: inherit;
  min-height: 44px; /* touch target */
  width: 6rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--fa-border);
  border-radius: 6px;
  background: var(--fa-surface);
  color: var(--fa-text);
}

.tr-field input:focus-visible {
  outline: 2px solid var(--fa-accent);
  outline-offset: -2px;
}

.tr-hint {
  font-size: 0.72rem;
  color: var(--fa-muted);
  max-width: 46ch;
  line-height: 1.5;
}

/* Wide table on a narrow add-in iframe scrolls in its own box, never the page. */
.tr-tablewrap {
  overflow-x: auto;
}

.tr-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tr-zone {
  font-size: 0.85rem;
  color: var(--fa-text);
  overflow-wrap: anywhere;
}

.tr-when {
  font-size: 0.72rem;
  color: var(--fa-muted);
  font-variant-numeric: tabular-nums;
}

.tr-badge {
  margin-left: 0.4rem;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--fa-low-bg);
  color: var(--fa-low-fg);
  white-space: nowrap;
}

.tr-na {
  color: var(--fa-muted);
}

.tr-note {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--fa-muted);
  line-height: 1.55;
}
```

- [ ] **Step 4: Register the view**

In `src/views/registry.ts`, insert this row **immediately after** the `overview` row:

```ts
  { id: 'trip-report', label: 'Trip Report', load: () => import('./trip-report').then((m) => m.initTripReportView) },
```

- [ ] **Step 5: Verify types and checks**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npm run check`
Expected: 20 checks, all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/trip-report.ts src/styles/trip-report.css src/views/registry.ts dev/fixtures.ts
git commit -m "feat: Trip Report view — zone-to-zone journeys"
```

---

### Task 3: Verify in a real browser, then ship

**Files:** none created; this task proves the previous two work.

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for `http://localhost:5173/dev/dev-dashboard.html` to answer 200.

- [ ] **Step 2: Drive the view with Playwright**

Confirm, against `dev/dev-dashboard.html`:
1. A **"Trip Report"** menu item exists and sits **immediately below "Ringkasan"**.
2. Opening it renders a table with at least one row.
3. Every row's "Dari" and "Ke" show a **zone name**, never a coordinate or blank.
4. At least one row's zone is a small zone (`Depot Kemayoran` / `Tanjung Priok` / `Gudang Cikarang`) and **not** `Jabodetabek` — proving `resolveZone` picked the smallest of the overlapping zones.
5. Raising **Ambang berhenti** from 15 to 120 changes the row count **without any new network request** (record `page.on('request')` counts before and after).
6. `console` reports no `pageerror`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0, bundle under 1 MB.

- [ ] **Step 4: Commit and deploy**

```bash
git add -A
git commit -m "test: verify Trip Report in browser"
git push origin main
```

Then wait for Vercel to serve the new bundle hash and re-run the live host-simulation check (`geotab.addin[<filename>]` resolves, all seven views render, zero console errors).

---

## Self-Review

**Spec coverage:**
- Journey chaining with dwell threshold → Task 1, Steps 1/3
- Round trips → Task 1 test "round trip"
- Smallest-zone resolution → Task 1 `resolveZone` + its assertion; browser-verified in Task 3 Step 2.4
- Zone-to-zone only, with unmatched summary → Task 1 `summariseUnmatched`, Task 2 `render()`
- Fuel measured-only, null on partial → Task 1 fuel test, Task 2 `loadFuel` + hidden column
- Three empty states → Task 2 `render()`
- Adjustable dwell, persisted, re-render without refetch → Task 2 `controls()`/`onInput`, verified Task 3 Step 2.5
- Menu position below Ringkasan → Task 2 Step 4, verified Task 3 Step 2.1
- No expandable rows / CSV / map (explicitly out of scope) → not implemented anywhere

**Placeholder scan:** none — every step carries the real code or the exact command.

**Type consistency:** `JourneyRow`, `ZoneRef`, `BuildOptions` defined in Task 1 are used with the same field names in Task 2. `fuelByTrip` is `Record<string, number | null>` in both `BuildOptions` and `fuelPerTrip`'s return type. `resolveZone` is exported and asserted in Task 1 though the view does not call it directly — `buildJourneys` uses it internally.
