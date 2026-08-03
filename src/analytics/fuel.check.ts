import assert from 'node:assert';
import {
  sortFuelRows,
  topByEfficiency,
  type FuelRow,
  pickFuelSource,
  consumptionFromCumulative,
  consumptionFromLevel,
  estimateFromDistance,
  litresPer100Km,
  kmPerLitre,
  fleetKmPerLitre,
  economyByDevice,
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

// --- kmPerLitre ---------------------------------------------------------------
// Source of truth: MyGeotab's own "Fuel and EV Energy Usage" report, unit
// "BRV SMA" — 83 km, 7.40 L, fuel economy 11.23 km/L. Our figure must land on
// the same number (their 11.23 vs our 11.2162 is their rounding of the litres,
// not a different formula: distance / fuel used).
assert.ok(
  Math.abs((kmPerLitre(83, 7.4) as number) - 11.22) < 0.01,
  `83 km over 7.40 L must match the Geotab report's 11.2 km/L, got ${kmPerLitre(83, 7.4)}`
);
assert.strictEqual(kmPerLitre(83, 0), null, 'zero litres is null, NOT Infinity');
assert.strictEqual(kmPerLitre(0, 0), null, 'nothing over nothing is null, NOT NaN');
assert.strictEqual(kmPerLitre(83, -5), null, 'negative litres is null, never a negative economy');
assert.strictEqual(kmPerLitre(0, 10), 0, 'no distance on real fuel is a real 0 (idled all range)');

// --- fleetKmPerLitre: TOTAL km / TOTAL litres, never the average of ratios ----
// v1 did the work: 1000 km on 100 L = 10 km/L. v2 barely moved: 2 km on 1 L =
// 2 km/L. Total-over-total = 1002/101 = 9.92 — the fleet really did get ~10
// km/L. Averaging the two ratios would print (10+2)/2 = 6, letting a vehicle
// that contributed 0.2% of the distance drag the headline down by a third.
const fleet = fleetKmPerLitre({ v1: 1000, v2: 2 }, { v1: 100, v2: 1 }) as number;
assert.ok(Math.abs(fleet - 1002 / 101) < 1e-9, `total over total, got ${fleet}`);
assert.ok(fleet > 9.9, `must not collapse toward the average-of-ratios 6, got ${fleet}`);
assert.notStrictEqual(fleet, 6, 'average of per-vehicle ratios is the wrong answer');

// --- economyByDevice ----------------------------------------------------------
assert.deepStrictEqual(
  economyByDevice({ v1: 150, v2: 100, v3: 0 }, { v1: 15, v2: 0, v4: 5 }),
  { v1: 10, v2: null, v3: null, v4: 0 },
  'a 0-litre device is null; the union of both maps is keyed, never a missing key'
);

// --- empty input: null / {}, no NaN ------------------------------------------
assert.strictEqual(fleetKmPerLitre({}, {}), null, 'empty fleet is null, NOT NaN');
assert.strictEqual(fleetKmPerLitre({ v1: 100 }, {}), null, 'km with no litres is null, NOT Infinity');
assert.deepStrictEqual(economyByDevice({}, {}), {}, 'no devices -> no rows');
for (const v of Object.values(economyByDevice({ v1: 0 }, { v1: 0 }))) {
  assert.ok(v === null || Number.isFinite(v), `economy is null or finite, got ${v}`);
}

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


// --- pengurutan & pemilihan baris tabel ------------------------------------
{
  const r = (
    name: string,
    km: number,
    litres: number,
    efficiency: number | null,
    economy: number | null,
    cost: number | null = null
  ): FuelRow => ({ id: name, name, km, litres, efficiency, economy, cost });

  const rows = [
    r('B 9374 TFY', 1200, 300, 25, 4),
    r('A 9828 RA', 800, 360, 45, 2.2),
    r('MHC001', 0, 0, null, null),        // tidak pernah jalan: laju tak diketahui
    r('B 9875 UEX', 2000, 240, 12, 8.3),
  ];

  // Menurun pada angka.
  assert.deepStrictEqual(
    sortFuelRows(rows, 'litres', -1).map((x) => x.name),
    ['A 9828 RA', 'B 9374 TFY', 'B 9875 UEX', 'MHC001']
  );

  // Sel kosong SELALU di bawah, ke arah mana pun. Kalau null diperlakukan nol,
  // unit tanpa data akan memuncaki daftar "paling irit" — pujian untuk unit
  // yang sebenarnya tidak terukur sama sekali.
  assert.equal(sortFuelRows(rows, 'efficiency', 1)[0].name, 'B 9875 UEX');
  assert.equal(sortFuelRows(rows, 'efficiency', 1).at(-1)!.name, 'MHC001', 'null harus tetap di bawah saat menaik');
  assert.equal(sortFuelRows(rows, 'efficiency', -1).at(-1)!.name, 'MHC001', 'null harus tetap di bawah saat menurun');
  assert.equal(sortFuelRows(rows, 'economy', 1).at(-1)!.name, 'MHC001');

  // Nama: urutan natural, bukan leksikal.
  assert.deepStrictEqual(
    sortFuelRows(rows, 'name', 1).map((x) => x.name),
    ['A 9828 RA', 'B 9374 TFY', 'B 9875 UEX', 'MHC001']
  );

  // Tidak mengubah array aslinya — render dipanggil berkali-kali dari sumber
  // yang sama, dan sort in-place akan membuat urutannya menetap diam-diam.
  const before = rows.map((x) => x.name);
  sortFuelRows(rows, 'km', 1);
  assert.deepStrictEqual(rows.map((x) => x.name), before, 'sortFuelRows harus mengembalikan salinan');

  // --- grafik: "terhemat" adalah UNIT LAIN, bukan daftar yang dibalik -------
  const boros = topByEfficiency(rows, 'boros', 2).map((x) => x.name);
  const hemat = topByEfficiency(rows, 'hemat', 2).map((x) => x.name);
  assert.deepStrictEqual(boros, ['A 9828 RA', 'B 9374 TFY']);
  assert.deepStrictEqual(hemat, ['B 9875 UEX', 'B 9374 TFY']);
  assert.notDeepStrictEqual(boros, [...hemat].reverse(), 'terhemat bukan sekadar terboros yang dibalik');

  // Unit tanpa efisiensi terukur tidak pernah masuk grafik: batang nol terbaca
  // sebagai "tidak membakar apa-apa".
  assert.ok(!topByEfficiency(rows, 'hemat', 10).some((x) => x.name === 'MHC001'));
  assert.equal(topByEfficiency([], 'boros', 20).length, 0);
}

console.log('fuel.check.ts: PASS');
