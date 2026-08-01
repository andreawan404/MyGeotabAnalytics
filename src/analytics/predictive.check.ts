import assert from 'node:assert';
import {
  latestValuePerDevice,
  kmUntilService,
  chronicFaults,
  faultTrendRatio,
  flagsForDevice,
  monthlyFaultCounts,
  TREND_NO_BASELINE,
} from './predictive';
import type { FaultDataDTO, DvirDefectDTO, StatusDataDTO } from '../api/fetchers/types';

const status = (deviceId: string, dateTime: string, value: number): StatusDataDTO => ({
  deviceId,
  diagnosticId: 'DiagnosticOdometerId',
  dateTime,
  value,
});

const fault = (deviceId: string, dateTime: string, extra: Partial<FaultDataDTO> = {}): FaultDataDTO => ({
  id: `${deviceId}:${dateTime}:${Math.random()}`,
  deviceId,
  diagnosticId: 'DiagX',
  dateTime,
  faultState: 'Active',
  severity: 'Unknown',
  count: 1,
  dismissDateTime: null,
  failureModeId: null,
  faultLampState: null,
  riskOfBreakdown: null,
  controllerName: null,
  ...extra,
});

const defect = (deviceId: string, repairStatus: string | null): DvirDefectDTO => ({
  id: `${deviceId}:${repairStatus}`,
  deviceId,
  dateTime: '2026-07-01T00:00:00Z',
  defectName: 'Rem',
  severity: null,
  repairStatus,
});

// --- latestValuePerDevice: newest wins regardless of input order -------------
const latest = latestValuePerDevice([
  status('b1', '2026-07-10T00:00:00Z', 500),
  status('b1', '2026-07-31T00:00:00Z', 900), // newest for b1, arrives before the older row below
  status('b1', '2026-07-20T00:00:00Z', 700),
  status('b2', '2026-07-05T00:00:00Z', 120),
]);
assert.strictEqual(latest.b1.value, 900, 'picks the newest reading, not the last one seen');
assert.strictEqual(latest.b1.dateTime, '2026-07-31T00:00:00Z');
assert.strictEqual(latest.b2.value, 120);
assert.deepStrictEqual(latestValuePerDevice([]), {}, 'empty in, empty out');

// --- kmUntilService ---------------------------------------------------------
assert.strictEqual(kmUntilService(29_800, 10_000), 200, '29 800 km is 200 km short of the third nominal service');
assert.strictEqual(kmUntilService(10_000, 10_000), 10_000, 'exactly on a boundary = a full interval remains');
assert.strictEqual(kmUntilService(0, 10_000), 10_000);
// The guard that matters: a user who clears the interval input must not get NaN
// on screen, and must not divide the fleet by zero.
assert.strictEqual(kmUntilService(24_800, 0), 0, 'interval 0 => 0, not NaN');
assert.strictEqual(kmUntilService(24_800, -5), 0, 'negative interval => 0');
assert.strictEqual(kmUntilService(NaN, 10_000), 0, 'missing odometer => 0, not NaN');
assert.strictEqual(kmUntilService(Infinity, 10_000), 0);
for (const v of [kmUntilService(24_800, 0), kmUntilService(NaN, NaN)]) {
  assert.ok(Number.isFinite(v), 'kmUntilService never returns NaN/Infinity');
}

// --- chronicFaults: DISTINCT days, not raw rows -----------------------------
const sameDay = chronicFaults([
  fault('b1', '2026-07-01T01:00:00Z'),
  fault('b1', '2026-07-01T02:00:00Z'),
  fault('b1', '2026-07-01T03:00:00Z'),
]);
assert.deepStrictEqual(sameDay, [], '3 rows on ONE day is one bad afternoon, not a chronic fault');

const threeDays = chronicFaults([
  fault('b1', '2026-07-01T01:00:00Z'),
  fault('b1', '2026-07-01T09:00:00Z'), // second row, same day
  fault('b1', '2026-07-05T01:00:00Z'),
  fault('b1', '2026-07-19T01:00:00Z'),
  fault('b2', '2026-07-01T01:00:00Z'), // b2 only ever fires once
]);
assert.strictEqual(threeDays.length, 1, 'only b1 qualifies');
assert.strictEqual(threeDays[0].deviceId, 'b1');
assert.strictEqual(threeDays[0].distinctDays, 3);
assert.strictEqual(threeDays[0].occurrences, 4, 'occurrences still counts every row');

// Same device, DIFFERENT diagnostic => separate series, neither reaches 3 days.
assert.deepStrictEqual(
  chronicFaults([
    fault('b1', '2026-07-01T01:00:00Z', { diagnosticId: 'A' }),
    fault('b1', '2026-07-02T01:00:00Z', { diagnosticId: 'A' }),
    fault('b1', '2026-07-03T01:00:00Z', { diagnosticId: 'B' }),
  ]),
  [],
  'chronic is per (device, diagnostic), not per device'
);
assert.deepStrictEqual(chronicFaults([]), [], 'empty in, empty out');

// --- faultTrendRatio --------------------------------------------------------
const now = '2026-08-01T00:00:00Z';
const trend = faultTrendRatio(
  [
    // b1: 4 in the last 30d, 2 in the prior 30d => 2.0
    fault('b1', '2026-07-20T00:00:00Z'),
    fault('b1', '2026-07-21T00:00:00Z'),
    fault('b1', '2026-07-22T00:00:00Z'),
    fault('b1', '2026-07-23T00:00:00Z'),
    fault('b1', '2026-06-20T00:00:00Z'),
    fault('b1', '2026-06-21T00:00:00Z'),
    // b2: brand new problem, nothing in the prior window
    fault('b2', '2026-07-25T00:00:00Z'),
    // b3: only history, nothing recent => improving
    fault('b3', '2026-06-25T00:00:00Z'),
    fault('b3', '2026-06-26T00:00:00Z'),
    // outside both windows entirely — must be ignored
    fault('b4', '2026-01-01T00:00:00Z'),
  ],
  now
);
assert.strictEqual(trend.b1, 2, 'doubling => 2.0');
assert.strictEqual(trend.b2, TREND_NO_BASELINE, 'zero prior + recent faults => finite sentinel, not Infinity');
assert.ok(Number.isFinite(trend.b2), 'the sentinel is finite so the UI can sort and format it');
assert.strictEqual(trend.b3, 0, 'faults stopped => 0');
assert.ok(!('b4' in trend), 'faults older than 60 days do not create a trend row');
assert.deepStrictEqual(faultTrendRatio([], now), {}, 'empty in, empty out');
assert.deepStrictEqual(faultTrendRatio([fault('b1', now)], 'not-a-date'), {}, 'unparseable now => empty, not NaN');

// --- flagsForDevice: sorted by flag count -----------------------------------
const devices = [
  { id: 'b1', name: 'Truk 01' },
  { id: 'b2', name: 'Truk 02' },
  { id: 'b3', name: 'Truk 03' },
];
const ranked = flagsForDevice({
  devices,
  odometerKm: { b1: 9_900, b2: 3_000, b3: 5_000 }, // only b1 is within 500 km of 10 000
  intervalKm: 10_000,
  intervalHours: 250,
  chronic: [{ deviceId: 'b1', diagnosticId: 'A', distinctDays: 4, occurrences: 9 }],
  trend: { b1: 3, b2: 2 },
  defects: [defect('b1', 'NotRepaired'), defect('b3', 'Repaired')],
  faults: [fault('b1', now, { riskOfBreakdown: 0.4 })],
});
assert.deepStrictEqual(
  ranked.map((r) => r.deviceName),
  ['Truk 01', 'Truk 02', 'Truk 03'],
  'sorted by flag count desc'
);
assert.strictEqual(ranked[0].flags.length, 5, 'b1 trips every signal');
assert.strictEqual(ranked[0].serviceDueKm, 100);
assert.strictEqual(ranked[0].riskOfBreakdown, 0.4, "Geotab's own value is surfaced unchanged");
assert.strictEqual(ranked[0].openDefects, 1);
assert.deepStrictEqual(ranked[1].flags, ['Tren memburuk'], 'b2 only trends');
assert.deepStrictEqual(ranked[2].flags, [], 'a Repaired defect is not an open one');
assert.strictEqual(ranked[2].riskOfBreakdown, undefined, 'no risk data => undefined, so the column can hide');

// No odometer diagnostic on this database: the service signal disappears
// entirely rather than defaulting to 0 km and flagging the whole fleet.
const noOdo = flagsForDevice({
  devices,
  intervalKm: 10_000,
  intervalHours: 250,
  chronic: [],
  trend: {},
  defects: [],
  faults: [],
});
assert.ok(
  noOdo.every((r) => r.serviceDueKm === undefined && !r.flags.includes('Servis jatuh tempo')),
  'no odometer => no service flag, not a fleet-wide false positive'
);

assert.deepStrictEqual(
  flagsForDevice({ devices: [], intervalKm: 0, intervalHours: 0, chronic: [], trend: {}, defects: [], faults: [] }),
  [],
  'empty in, empty out'
);

// --- monthlyFaultCounts -----------------------------------------------------
assert.deepStrictEqual(
  monthlyFaultCounts([
    fault('b1', '2026-07-02T00:00:00Z'),
    fault('b1', '2026-06-30T00:00:00Z'),
    fault('b2', '2026-07-15T00:00:00Z'),
  ]),
  [
    { month: '2026-06', count: 1 },
    { month: '2026-07', count: 2 },
  ],
  'grouped per month, ascending'
);
assert.deepStrictEqual(monthlyFaultCounts([]), [], 'no faults => no chart data, never a zero-filled series');

console.log('predictive.check.ts: PASS');
