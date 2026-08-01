import assert from 'node:assert';
import {
  pickFuelSource,
  consumptionFromCumulative,
  consumptionFromLevel,
  estimateFromDistance,
  litresPer100Km,
  idleFuelWaste,
  groupByDay,
  dayKey,
  sumValues,
} from './fuel';
import type { StatusDataDTO, TripDTO } from '../api/fetchers/types';

function sd(deviceId: string, dateTime: string, value: number): StatusDataDTO {
  return { deviceId, diagnosticId: 'd', dateTime, value };
}

function trip(deviceId: string, distanceKm: number, idlingDurationSec = 0, start = '2026-07-01T08:00:00Z'): TripDTO {
  return {
    id: `${deviceId}-${start}`,
    deviceId,
    start,
    stop: start,
    distanceKm,
    drivingDurationSec: 3600,
    idlingDurationSec,
    startLat: 0,
    startLon: 0,
    stopLat: 0,
    stopLon: 0,
  };
}

// --- pickFuelSource: strict precedence, best -> worst -------------------------
assert.strictEqual(
  pickFuelSource({ transactions: true, cumulative: true, level: true, distance: true }),
  'transactions',
  'fuel card wins over everything'
);
assert.strictEqual(
  pickFuelSource({ transactions: false, cumulative: true, level: true, distance: true }),
  'cumulative',
  'engine counter beats tank level'
);
assert.strictEqual(
  pickFuelSource({ transactions: false, cumulative: false, level: true, distance: true }),
  'level',
  'tank level beats a typed-in ratio'
);
assert.strictEqual(
  pickFuelSource({ transactions: false, cumulative: false, level: false, distance: true }),
  'distance',
  'distance is the last resort'
);
assert.strictEqual(
  pickFuelSource({ transactions: false, cumulative: false, level: false, distance: false }),
  'none',
  'nothing available -> none, never a silent zero'
);

// --- consumptionFromCumulative ------------------------------------------------
const climb = consumptionFromCumulative([
  sd('v1', '2026-07-01T08:00:00Z', 1000),
  sd('v1', '2026-07-01T12:00:00Z', 1040),
  sd('v1', '2026-07-02T08:00:00Z', 1075),
]);
assert.strictEqual(climb.v1, 75, 'normal increase = last - first');

// Rows deliberately out of order: the function must sort before differencing.
const shuffled = consumptionFromCumulative([
  sd('v1', '2026-07-02T08:00:00Z', 1075),
  sd('v1', '2026-07-01T08:00:00Z', 1000),
]);
assert.strictEqual(shuffled.v1, 75, 'unordered rows still give the same climb');

const single = consumptionFromCumulative([sd('v1', '2026-07-01T08:00:00Z', 1000)]);
assert.strictEqual(single.v1, 0, 'a single reading is 0 consumption, not the counter value');

const reset = consumptionFromCumulative([
  sd('v1', '2026-07-01T08:00:00Z', 1000),
  sd('v1', '2026-07-01T12:00:00Z', 1050), // +50
  sd('v1', '2026-07-02T08:00:00Z', 10), // counter reset — ignored, not -1040
  sd('v1', '2026-07-02T12:00:00Z', 30), // +20
]);
assert.strictEqual(reset.v1, 70, 'a counter reset is skipped, never negative');
assert.ok(reset.v1 >= 0, 'never negative');

const twoDevices = consumptionFromCumulative([
  sd('v1', '2026-07-01T08:00:00Z', 100),
  sd('v2', '2026-07-01T08:00:00Z', 500),
  sd('v1', '2026-07-02T08:00:00Z', 130),
  sd('v2', '2026-07-02T08:00:00Z', 505),
]);
assert.deepStrictEqual(twoDevices, { v1: 30, v2: 5 }, 'devices are kept apart');

// --- consumptionFromLevel -----------------------------------------------------
const level = consumptionFromLevel([
  sd('v1', '2026-07-01T08:00:00Z', 90),
  sd('v1', '2026-07-01T12:00:00Z', 60), // -30 burnt
  sd('v1', '2026-07-01T18:00:00Z', 95), // +35 refuel — ignored
  sd('v1', '2026-07-02T08:00:00Z', 75), // -20 burnt
]);
assert.strictEqual(level.v1, 50, 'only the drops count; the refuel jump is ignored');

const levelLitres = consumptionFromLevel(
  [
    sd('v1', '2026-07-01T08:00:00Z', 90),
    sd('v1', '2026-07-01T12:00:00Z', 60),
  ],
  200
);
assert.strictEqual(levelLitres.v1, 60, '30 percent of a 200 L tank = 60 L');

const levelSingle = consumptionFromLevel([sd('v1', '2026-07-01T08:00:00Z', 90)]);
assert.strictEqual(levelSingle.v1, 0, 'a single reading has no delta');

const refuelOnly = consumptionFromLevel([
  sd('v1', '2026-07-01T08:00:00Z', 20),
  sd('v1', '2026-07-01T12:00:00Z', 95),
]);
assert.strictEqual(refuelOnly.v1, 0, 'a refuel alone is 0 consumption, never negative');

// --- estimateFromDistance -----------------------------------------------------
assert.deepStrictEqual(
  estimateFromDistance([trip('v1', 100), trip('v1', 50), trip('v2', 200)], 30),
  { v1: 45, v2: 60 },
  '150 km at 30 L/100km = 45 L'
);

// --- litresPer100Km -----------------------------------------------------------
assert.strictEqual(litresPer100Km(45, 150), 30, '45 L over 150 km = 30 L/100km');
assert.strictEqual(litresPer100Km(45, 0), null, 'zero km is null, NOT Infinity');
assert.strictEqual(litresPer100Km(0, 0), null, 'nothing over nothing is null, NOT NaN');
assert.strictEqual(litresPer100Km(0, 100), 0, 'no fuel over real distance is a real 0');

// --- idleFuelWaste ------------------------------------------------------------
assert.deepStrictEqual(
  idleFuelWaste([trip('v1', 10, 3600), trip('v1', 10, 1800), trip('v2', 10, 7200)], 2),
  { v1: 3, v2: 4 },
  '1.5 idle hours at 2 L/jam = 3 L'
);

// --- day bucketing ------------------------------------------------------------
const buckets = groupByDay(
  [sd('v1', '2026-07-01T08:00:00Z', 1), sd('v1', '2026-07-01T09:00:00Z', 2), sd('v1', '2026-07-03T08:00:00Z', 3)],
  (r) => r.dateTime
);
assert.strictEqual(Object.keys(buckets).length, 2, 'two distinct days');
assert.strictEqual(buckets[dayKey('2026-07-01T08:00:00Z')].length, 2, 'same day rows land together');
assert.deepStrictEqual(groupByDay([sd('v1', 'not-a-date', 1)], (r) => r.dateTime), {}, 'unparseable dates are dropped');

// --- sumValues ----------------------------------------------------------------
assert.strictEqual(sumValues({ v1: 10, v2: 2.5 }), 12.5, 'totals add up');
assert.strictEqual(sumValues({}), 0, 'empty total is 0');

// --- empty input everywhere: empty/zero, never NaN ----------------------------
assert.deepStrictEqual(consumptionFromCumulative([]), {}, 'no rows -> no devices');
assert.deepStrictEqual(consumptionFromLevel([]), {}, 'no rows -> no devices');
assert.deepStrictEqual(consumptionFromLevel([], 200), {}, 'no rows -> no devices even with a tank size');
assert.deepStrictEqual(estimateFromDistance([], 30), {}, 'no trips -> no devices');
assert.deepStrictEqual(idleFuelWaste([], 2), {}, 'no trips -> no devices');
assert.strictEqual(sumValues(estimateFromDistance([], 30)), 0, 'empty estimate totals 0');
for (const [name, value] of [
  ['cumulative', sumValues(consumptionFromCumulative([]))],
  ['level', sumValues(consumptionFromLevel([]))],
  ['distance', sumValues(estimateFromDistance([], 30))],
  ['idle', sumValues(idleFuelWaste([], 2))],
] as [string, number][]) {
  assert.ok(Number.isFinite(value), `${name} on empty input is finite, got ${value}`);
}

// A zero rate must not poison the arithmetic either.
assert.strictEqual(sumValues(estimateFromDistance([trip('v1', 100)], 0)), 0, 'a 0 ratio gives 0 L, not NaN');

console.log('fuel.check.ts: PASS');
