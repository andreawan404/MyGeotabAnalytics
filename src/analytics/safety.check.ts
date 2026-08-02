import assert from 'node:assert';
import {
  categorize,
  categoryBreakdown,
  configuredCategories,
  dailyTrend,
  driverAttributionRate,
  eventsPer100Km,
  rankDevices,
  rankDrivers,
  topCategoryByDevice,
  CATEGORIES,
} from './safety';
import type { ExceptionEventDTO, TripDTO } from '../api/fetchers/types';

function ev(deviceId: string, ruleId: string, start: string, ruleName = ''): ExceptionEventDTO {
  return { id: `e-${deviceId}-${start}`, deviceId, ruleId, ruleName, severity: 'high', start, stop: null, durationSec: 0 };
}

function trip(deviceId: string, distanceKm: number, extra: Record<string, unknown> = {}): TripDTO {
  return {
    id: `t-${deviceId}-${distanceKm}`,
    deviceId,
    start: '2026-06-10T01:00:00Z',
    stop: '2026-06-10T02:00:00Z',
    distanceKm,
    drivingDurationSec: 3600,
    idlingDurationSec: 0,
    startLat: 0,
    startLon: 0,
    stopLat: 0,
    stopLon: 0,
    ...extra,
  } as TripDTO;
}

// --- categorize: built-in ids win, and they are non-localized ----------------
assert.strictEqual(categorize('RuleHarshBrakingId', ''), 'harsh-braking');
assert.strictEqual(categorize('RuleHarshAccelerationId', ''), 'harsh-acceleration');
assert.strictEqual(categorize('RuleHarshCorneringId', ''), 'harsh-cornering');
assert.strictEqual(categorize('RuleSpeedingId', ''), 'speeding');
assert.strictEqual(categorize('RuleSeatbeltId', ''), 'seatbelt');
assert.strictEqual(categorize('RuleExcessiveIdlingId', ''), 'idling');

// The id must beat the name, or a localized/mislabelled name could hijack it.
assert.strictEqual(categorize('RuleHarshBrakingId', 'Kecepatan Berlebih'), 'harsh-braking');

// "HarshCornering" also contains "Harsh" — specific pattern must win.
assert.strictEqual(categorize('RuleHarshCorneringId', ''), 'harsh-cornering');

// --- categorize: Indonesian custom rules fall back to the name --------------
assert.strictEqual(categorize('b1A2', 'Pengereman Mendadak'), 'harsh-braking');
assert.strictEqual(categorize('b1A3', 'Kecepatan Berlebih > 80 km/j'), 'speeding');
assert.strictEqual(categorize('b1A4', 'Sabuk Pengaman Tidak Dipakai'), 'seatbelt');
assert.strictEqual(categorize('b1A5', 'Idle Berlebihan'), 'idling');
assert.strictEqual(categorize('b1A6', 'Akselerasi Mendadak'), 'harsh-acceleration');
assert.strictEqual(categorize('b1A7', 'Belok Tajam'), 'harsh-cornering');

// --- categorize: unknown is 'other', never a wrong bucket -------------------
assert.strictEqual(categorize('b9Z9', 'Masuk Zona Gudang'), 'other');
assert.strictEqual(categorize('', ''), 'other');

// --- eventsPer100Km: hand-computed -----------------------------------------
// A: 3 events / 150 km -> 2.0 per 100 km
// B: 5 events / 100 km -> 5.0 per 100 km   (worst, despite A and B both busy)
// C: 2 events /   0 km -> null             (parked, never Infinity)
// D: 0 events /  50 km -> 0.0              (clean baseline, still listed)
const rateEvents = [
  ev('A', 'RuleHarshBrakingId', '2026-06-10T01:00:00Z'),
  ev('A', 'RuleHarshBrakingId', '2026-06-10T02:00:00Z'),
  ev('A', 'RuleSpeedingId', '2026-06-10T03:00:00Z'),
  ...Array.from({ length: 5 }, (_, i) => ev('B', 'RuleSpeedingId', `2026-06-11T0${i}:00:00Z`)),
  ev('C', 'RuleSeatbeltId', '2026-06-12T01:00:00Z'),
  ev('C', 'RuleSeatbeltId', '2026-06-12T02:00:00Z'),
];
const rateTrips = [trip('A', 100), trip('A', 50), trip('B', 100), trip('D', 50)];
const rates = eventsPer100Km(rateEvents, rateTrips);

const byId = new Map(rates.map((r) => [r.deviceId, r]));
assert.strictEqual(byId.get('A')!.km, 150, 'km sums across a device\'s trips');
assert.strictEqual(byId.get('A')!.per100Km, 2, '3 events / 150 km = 2.0 per 100 km');
assert.strictEqual(byId.get('B')!.per100Km, 5, '5 events / 100 km = 5.0 per 100 km');
assert.strictEqual(byId.get('C')!.per100Km, null, '0 km must be null, not Infinity');
assert.ok(Number.isFinite(byId.get('C')!.per100Km as never) === false, 'no Infinity leaks out');
assert.strictEqual(byId.get('D')!.per100Km, 0, 'a clean unit with distance rates 0, not null');
assert.strictEqual(byId.get('D')!.events, 0);

// Ordering: worst-first, nulls LAST (a 0-km unit is unknown, not worst).
assert.deepStrictEqual(
  rates.map((r) => r.deviceId),
  ['B', 'A', 'D', 'C'],
  'sorted worst-first with nulls last'
);

// Empty input must not throw or produce phantom rows.
assert.deepStrictEqual(eventsPer100Km([], []), []);

// --- rankDevices: names attached, id fallback when unnamed ------------------
const ranked = rankDevices(rates, [{ id: 'A', name: 'Truk 01' }]);
assert.strictEqual(ranked.find((r) => r.deviceId === 'A')!.name, 'Truk 01');
assert.strictEqual(ranked.find((r) => r.deviceId === 'B')!.name, 'B', 'unnamed device falls back to its id');
assert.deepStrictEqual(ranked.map((r) => r.deviceId), ['B', 'A', 'D', 'C'], 'ranking order preserved');

// --- categoryBreakdown ------------------------------------------------------
const emptyBreakdown = categoryBreakdown([]);
assert.deepStrictEqual(
  Object.keys(emptyBreakdown).sort(),
  [...CATEGORIES].sort(),
  'every category is present even with no events'
);
assert.ok(
  Object.values(emptyBreakdown).every((n) => n === 0),
  'empty input -> all zeros, no undefined'
);

const breakdown = categoryBreakdown(rateEvents);
assert.strictEqual(breakdown['harsh-braking'], 2);
assert.strictEqual(breakdown.speeding, 6);
assert.strictEqual(breakdown.seatbelt, 2);
assert.strictEqual(breakdown.other, 0);

// --- topCategoryByDevice ----------------------------------------------------
const top = topCategoryByDevice(rateEvents);
assert.strictEqual(top.get('A'), 'harsh-braking', '2 braking beats 1 speeding');
assert.strictEqual(top.get('B'), 'speeding');
assert.strictEqual(top.get('D'), undefined, 'a device with no events has no top category');

// --- dailyTrend: local days, zero-event days included -----------------------
// Local midnight 10 Jun -> local midnight 13 Jun (exclusive) = days 10, 11, 12.
const from = new Date(2026, 5, 10).toISOString();
const to = new Date(2026, 5, 13).toISOString();
// Events pinned to local 09:00 so the assertion holds in any timezone.
const trendEvents = [
  ev('A', 'RuleSpeedingId', new Date(2026, 5, 10, 9).toISOString()),
  ev('A', 'RuleSpeedingId', new Date(2026, 5, 10, 17).toISOString()),
  ev('B', 'RuleSpeedingId', new Date(2026, 5, 12, 9).toISOString()),
];
const trend = dailyTrend(trendEvents, from, to);
assert.deepStrictEqual(
  trend,
  [
    { date: '2026-06-10', count: 2 },
    { date: '2026-06-11', count: 0 },
    { date: '2026-06-12', count: 1 },
  ],
  'every day in range is present, including the zero-event one'
);
assert.strictEqual(trend.length, 3, 'toIso is exclusive — 13 Jun is not a bucket');

// No events at all still yields a full spine of zeros (chart with a real x-axis).
assert.deepStrictEqual(
  dailyTrend([], from, to).map((d) => d.count),
  [0, 0, 0]
);

// A local-evening event must land on the LOCAL day. In Jakarta (UTC+7) an event
// at 23:00 local on 10 Jun is 16:00Z on 10 Jun; in UTC-5 it is 04:00Z on 11 Jun.
// Building the input from a local Date makes this assertion timezone-independent
// — and it is exactly the bucket a naive toISOString().slice(0,10) gets wrong.
const lateNight = dailyTrend([ev('A', 'RuleSpeedingId', new Date(2026, 5, 11, 23, 30).toISOString())], from, to);
assert.deepStrictEqual(lateNight.map((d) => d.count), [0, 1, 0], 'late-evening event stays on its local day');

// --- driverAttributionRate --------------------------------------------------
assert.strictEqual(driverAttributionRate([]), 0, 'empty input -> 0, not NaN');
assert.ok(!Number.isNaN(driverAttributionRate([])));

// TripDTO carries no driverId today, so the default accessor finds nothing.
assert.strictEqual(driverAttributionRate([trip('A', 10), trip('B', 20)]), 0, 'no driverId field -> 0');

// Mixed case, via the field the shared DTO may gain later.
const mixed = [
  trip('A', 10, { driverId: 'b1' }),
  trip('A', 10, { driverId: 'UnknownDriverId' }),
  trip('B', 10, { driverId: 'b2' }),
  trip('B', 10, { driverId: null }),
];
assert.strictEqual(driverAttributionRate(mixed), 0.5, '2 of 4 trips have a real driver');

// Geotab's sentinel is not a driver, and neither is empty string.
assert.strictEqual(driverAttributionRate([trip('A', 1, { driverId: 'UnknownDriverId' })]), 0);
assert.strictEqual(driverAttributionRate([trip('A', 1, { driverId: '' })]), 0);
assert.strictEqual(driverAttributionRate([trip('A', 1, { driverId: 'b1' })]), 1);

// An explicit accessor works for callers holding identity outside the DTO.
const sideChannel = new Map([['t-A-10', 'b7']]);
assert.strictEqual(driverAttributionRate([trip('A', 10), trip('B', 20)], (t) => sideChannel.get(t.id)), 0.5);

// --- rankDrivers: events joined to drivers through the trip window ----------
// Truck A: driver b1 drives 08:00-09:00 (100 km), driver b2 drives 10:00-11:00 (50 km).
const dTrips: TripDTO[] = [
  { ...trip('A', 100, { driverId: 'b1' }), start: new Date(2026, 5, 10, 8).toISOString(), stop: new Date(2026, 5, 10, 9).toISOString() },
  { ...trip('A', 50, { driverId: 'b2' }), start: new Date(2026, 5, 10, 10).toISOString(), stop: new Date(2026, 5, 10, 11).toISOString() },
];
const dEvents = [
  ev('A', 'RuleHarshBrakingId', new Date(2026, 5, 10, 8, 30).toISOString()), // b1
  ev('A', 'RuleSpeedingId', new Date(2026, 5, 10, 10, 30).toISOString()), // b2
  ev('A', 'RuleSpeedingId', new Date(2026, 5, 10, 10, 45).toISOString()), // b2
  ev('A', 'RuleSpeedingId', new Date(2026, 5, 10, 9, 30).toISOString()), // between trips -> nobody
];
const drivers = rankDrivers(dEvents, dTrips, [{ id: 'b1', name: 'Budi' }]);
const dById = new Map(drivers.map((d) => [d.driverId, d]));
assert.strictEqual(dById.get('b1')!.events, 1, 'event inside b1\'s trip window');
assert.strictEqual(dById.get('b1')!.name, 'Budi');
assert.strictEqual(dById.get('b1')!.per100Km, 1, '1 event / 100 km');
assert.strictEqual(dById.get('b2')!.events, 2, 'both events inside b2\'s window');
assert.strictEqual(dById.get('b2')!.name, 'b2', 'unnamed driver falls back to id');
assert.strictEqual(dById.get('b2')!.per100Km, 4, '2 events / 50 km = 4.0');
assert.deepStrictEqual(drivers.map((d) => d.driverId), ['b2', 'b1'], 'worst-first');
assert.strictEqual(
  drivers.reduce((n, d) => n + d.events, 0),
  3,
  'the engine-off event is attributed to nobody, not to the previous driver'
);

// Trips with no driver identity contribute no rows at all.
assert.deepStrictEqual(rankDrivers(dEvents, [trip('A', 100)], []), []);
assert.deepStrictEqual(rankDrivers([], [], []), []);

// --- configuredCategories: which categories this database can measure at all --
// An ExceptionEvent only exists because a Rule made it, so a category with no
// Rule can never report anything. Without this the UI shows 0 — the same number
// a genuinely safe fleet shows.
{
  const cov = configuredCategories([
    { id: 'RuleHarshBrakingId', name: 'Harsh Braking' },
    { id: 'RuleSpeedingId', name: 'Speeding' },
  ]);
  assert.strictEqual(cov['harsh-braking'], true);
  assert.strictEqual(cov.speeding, true);
  assert.strictEqual(cov['harsh-cornering'], false, 'no cornering rule -> not measurable');
  assert.strictEqual(cov.seatbelt, false);
  assert.strictEqual(cov.other, true, 'other is the catch-all, always available');
}

// A customer rule with an opaque id must still be detected through its name —
// the same fallback categorize() uses for events.
{
  const cov = configuredCategories([{ id: 'b1A2', name: 'Pengereman Mendadak' }]);
  assert.strictEqual(cov['harsh-braking'], true, 'Indonesian custom rule detected by name');
  assert.strictEqual(cov.speeding, false);
}

// No rules at all: every safety category unmeasurable, `other` still true.
{
  const cov = configuredCategories([]);
  for (const c of CATEGORIES) {
    assert.strictEqual(cov[c], c === 'other', `empty rule list -> ${c} should be ${c === 'other'}`);
  }
}

// Coverage MUST agree with how events are bucketed: whatever categorize() says a
// rule is, that category has to come back true. If these two ever diverged, a
// card could claim a rule exists while its events land in another bucket.
{
  const rules = [
    { id: 'RuleHarshCorneringId', name: '' },
    { id: 'b1A5', name: 'Idle Berlebihan' },
    { id: 'b9Z9', name: 'Masuk Zona Gudang' }, // -> other
  ];
  const cov = configuredCategories(rules);
  for (const r of rules) {
    assert.strictEqual(cov[categorize(r.id, r.name)], true, `categorize/coverage disagree for ${r.id}`);
  }
}

console.log('safety.check.ts: PASS');
