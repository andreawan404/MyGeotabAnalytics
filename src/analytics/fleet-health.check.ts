import assert from 'node:assert';
import {
  isCriticalLamp,
  activeFaults,
  pendingFaults,
  topFaultCodes,
  rankVehiclesByFault,
  healthSummary,
  faultsForDevices,
} from './fleet-health';
import type { FaultDataDTO, DiagnosticDTO, DeviceLite } from '../api/fetchers/types';

function fault(over: Partial<FaultDataDTO>): FaultDataDTO {
  return {
    id: 'f',
    deviceId: 'b1',
    diagnosticId: 'DiagX',
    dateTime: '2026-07-30T10:00:00.000Z',
    faultState: 'Active',
    severity: 'Unknown',
    count: 1,
    dismissDateTime: null,
    failureModeId: null,
    faultLampState: null,
    riskOfBreakdown: null,
    controllerName: null,
    ...over,
  };
}

const devices: DeviceLite[] = [
  { id: 'b1', name: 'Truk 01' },
  { id: 'b2', name: 'Truk 02' },
  { id: 'b3', name: 'Truk 03' },
];

const diagnostics: DiagnosticDTO[] = [
  { id: 'DiagX', name: 'Engine Coolant Temperature' },
  { id: 'DiagY', name: 'Brake Circuit Pressure' },
];

// --- isCriticalLamp: MIL / red-stop only, amber is advisory ------------------
assert.strictEqual(isCriticalLamp('MalfunctionLamp'), true);
assert.strictEqual(isCriticalLamp('RedStopLamp'), true);
assert.strictEqual(isCriticalLamp('red_stop'), true, 'snake_case variant');
assert.strictEqual(isCriticalLamp('redstoplamp'), true, 'case-insensitive');
assert.strictEqual(isCriticalLamp('AmberWarningLamp'), false, 'amber is NOT critical');
assert.strictEqual(isCriticalLamp('ProtectLamp'), false);
assert.strictEqual(isCriticalLamp(null), false, 'null must not throw');
assert.strictEqual(isCriticalLamp(''), false);

// --- activeFaults: drops dismissed and already-cleared rows ------------------
const mixed = [
  fault({ id: 'a', faultState: 'Active' }),
  fault({ id: 'p', faultState: 'Pending' }),
  fault({ id: 'i', faultState: 'Inactive' }),
  fault({ id: 'n', faultState: 'None' }),
  fault({ id: 'd', faultState: 'Active', dismissDateTime: '2026-07-31T00:00:00.000Z' }),
];
assert.deepStrictEqual(
  activeFaults(mixed).map((f) => f.id),
  ['a'],
  'only undismissed Active survives — Pending is NOT active'
);

// --- pendingFaults: disjoint from active, and dismissed rows drop out too -----
// OBD-II "Pending" = seen once, unconfirmed. Counting it as active inflates the
// workshop list with faults that may clear on their own.
assert.deepStrictEqual(
  pendingFaults(mixed).map((f) => f.id),
  ['p'],
  'only undismissed Pending survives'
);
{
  const withDismissedPending = [
    fault({ id: 'p1', faultState: 'Pending' }),
    fault({ id: 'p2', faultState: 'Pending', dismissDateTime: '2026-07-31T00:00:00.000Z' }),
  ];
  assert.deepStrictEqual(
    pendingFaults(withDismissedPending).map((f) => f.id),
    ['p1'],
    'a dismissed Pending is neither pending nor active'
  );
  assert.strictEqual(activeFaults(withDismissedPending).length, 0);
}

// The two sets must never overlap, or the KPI cards double count.
{
  const ids = new Set(activeFaults(mixed).map((f) => f.id));
  assert.ok(
    pendingFaults(mixed).every((f) => !ids.has(f.id)),
    'activeFaults and pendingFaults must be disjoint'
  );
}

// --- topFaultCodes: sums count across rows, resolves names, honours limit ----
const forCodes = [
  fault({ deviceId: 'b1', diagnosticId: 'DiagX', count: 5 }),
  fault({ deviceId: 'b2', diagnosticId: 'DiagX', count: 3 }),
  fault({ deviceId: 'b1', diagnosticId: 'DiagY', count: 0 }), // count 0 -> counts as 1
  fault({ deviceId: 'b2', diagnosticId: 'DiagZ', count: 2 }), // not in the catalogue
];
const tallies = topFaultCodes(forCodes, diagnostics);
assert.strictEqual(tallies[0].diagnosticId, 'DiagX', 'sorted by occurrences desc');
assert.strictEqual(tallies[0].occurrences, 8, '5 + 3 summed across rows');
assert.strictEqual(tallies[0].deviceCount, 2, 'distinct devices, not rows');
assert.strictEqual(tallies[0].name, 'Engine Coolant Temperature', 'name resolved from catalogue');

const unknown = tallies.find((t) => t.diagnosticId === 'DiagZ')!;
assert.strictEqual(unknown.name, 'DiagZ', 'unknown diagnostic falls back to the raw id');
assert.strictEqual(unknown.occurrences, 2);

const zeroCount = tallies.find((t) => t.diagnosticId === 'DiagY')!;
assert.strictEqual(zeroCount.occurrences, 1, 'count 0 must not erase the code');

assert.strictEqual(topFaultCodes(forCodes, diagnostics, 2).length, 2, 'limit respected');
assert.deepStrictEqual(topFaultCodes([], diagnostics), [], 'no faults -> no rows');

// --- rankVehiclesByFault: critical lamps outrank raw volume ------------------
const forRank = [
  // b2: one critical lamp, low volume — must still come first.
  fault({ deviceId: 'b2', faultLampState: 'RedStopLamp', dateTime: '2026-07-28T00:00:00.000Z' }),
  // b1: five active amber faults, zero critical lamps.
  ...Array.from({ length: 5 }, (_, i) =>
    fault({ deviceId: 'b1', faultLampState: 'AmberWarningLamp', dateTime: `2026-07-3${i % 2}T00:00:00.000Z` })
  ),
  // b3: one active fault, most recent of all — recency alone must not win.
  fault({ deviceId: 'b3', dateTime: '2026-07-31T23:00:00.000Z' }),
];
const ranked = rankVehiclesByFault(forRank, devices);
assert.deepStrictEqual(
  ranked.map((r) => r.deviceId),
  ['b2', 'b1', 'b3'],
  'critical lamps first, then active count, then recency'
);
assert.strictEqual(ranked[0].deviceName, 'Truk 02', 'device name resolved');
assert.strictEqual(ranked[0].criticalLamps, 1);
assert.strictEqual(ranked[1].activeCount, 5);
assert.strictEqual(ranked[1].lastFaultAt, '2026-07-31T00:00:00.000Z', 'latest fault instant kept');
assert.strictEqual(
  rankVehiclesByFault(forRank, devices).length,
  3,
  'devices with no faults are excluded (fleet has 3, all 3 have faults here)'
);
assert.deepStrictEqual(rankVehiclesByFault([], devices), [], 'no faults -> nobody needs attention');

const unknownDevice = rankVehiclesByFault([fault({ deviceId: 'ghost' })], devices);
assert.strictEqual(unknownDevice[0].deviceName, 'ghost', 'unknown device falls back to the raw id');

// --- healthSummary: empty input returns zeros, never NaN ---------------------
const empty = healthSummary([], []);
assert.strictEqual(empty.devicesWithActiveFaults, 0);
assert.strictEqual(empty.totalDevices, 0);
assert.strictEqual(empty.pctAffected, 0, 'divide-by-zero guarded');
assert.ok(!Number.isNaN(empty.pctAffected), 'pctAffected must never be NaN');
assert.strictEqual(empty.criticalLampCount, 0);
assert.deepStrictEqual(empty.byState, {});

assert.strictEqual(healthSummary([], devices).pctAffected, 0, 'no faults on a real fleet -> 0%');

const summary = healthSummary(
  [
    fault({ deviceId: 'b1', faultState: 'Active', faultLampState: 'MalfunctionLamp' }),
    fault({ deviceId: 'b1', faultState: 'Active' }), // same device, not double counted
    fault({ deviceId: 'b2', faultState: 'Inactive', faultLampState: 'RedStopLamp' }),
    fault({ deviceId: 'b3', faultState: 'Active', faultLampState: 'RedStopLamp', dismissDateTime: '2026-08-01T00:00:00.000Z' }),
  ],
  devices
);
assert.strictEqual(summary.devicesWithActiveFaults, 1, 'b2 inactive, b3 dismissed');
assert.strictEqual(summary.totalDevices, 3);
assert.ok(Math.abs(summary.pctAffected - 33.333) < 0.01);
assert.strictEqual(summary.criticalLampCount, 1, 'cleared and dismissed red lamps do not count');
assert.deepStrictEqual(summary.byState, { Active: 3, Inactive: 1 }, 'histogram spans dismissed rows too');
assert.strictEqual(summary.pendingCount, 0, 'no Pending rows in this fixture');

// --- the three KPI buckets must partition the rows exactly -------------------
// Aktif + Perlu Dipantau + Ditolak/Selesai are rendered as three cards; if they
// ever overlap or leave a gap, one of them silently lies.
{
  const rows = [
    fault({ id: '1', faultState: 'Active' }),
    fault({ id: '2', faultState: 'Active', faultLampState: 'RedStopLamp' }),
    fault({ id: '3', faultState: 'Pending' }),
    fault({ id: '4', faultState: 'Inactive' }),
    fault({ id: '5', faultState: 'None' }),
    fault({ id: '6', faultState: 'Active', dismissDateTime: '2026-08-01T00:00:00.000Z' }),
    fault({ id: '7', faultState: 'Pending', dismissDateTime: '2026-08-01T00:00:00.000Z' }),
  ];
  const s = healthSummary(rows, devices);
  assert.strictEqual(s.activeCount, 2);
  assert.strictEqual(s.pendingCount, 1);
  assert.strictEqual(s.resolvedCount, 4, 'Inactive + None + both dismissed rows');
  assert.strictEqual(
    s.activeCount + s.pendingCount + s.resolvedCount,
    rows.length,
    'the three cards must sum to the total row count'
  );
  assert.ok(s.resolvedCount >= 0, 'resolvedCount must never go negative');
  assert.strictEqual(s.criticalLampCount, 1, 'red lamp on an active row only');
}

// An all-active fleet leaves nothing resolved — the subtraction must not underflow.
{
  const s = healthSummary([fault({ faultState: 'Active' })], devices);
  assert.strictEqual(s.resolvedCount, 0);
}

// --- faultsForDevices: what the expandable row shows -------------------------
{
  const rows = [
    fault({ deviceId: 'b1', diagnosticId: 'DiagX', faultState: 'Active', dateTime: '2026-07-30T08:00:00.000Z' }),
    fault({ deviceId: 'b1', diagnosticId: 'DiagY', faultState: 'Active', dateTime: '2026-07-31T09:00:00.000Z', faultLampState: 'RedStopLamp' }),
    fault({ deviceId: 'b1', diagnosticId: 'DiagZ', faultState: 'Pending', dateTime: '2026-08-01T10:00:00.000Z' }),
    fault({ deviceId: 'b1', faultState: 'Inactive' }), // cleared -> not shown
    fault({ deviceId: 'b1', faultState: 'Active', dismissDateTime: '2026-08-01T00:00:00.000Z' }), // triaged away
    fault({ deviceId: 'b2', diagnosticId: 'DiagX', faultState: 'Pending' }),
  ];
  const byDevice = faultsForDevices(rows, diagnostics);

  assert.strictEqual(byDevice['b1'].length, 3, 'Inactive and dismissed rows are excluded');
  assert.deepStrictEqual(
    byDevice['b1'].map((d) => d.state),
    ['active', 'active', 'pending'],
    'active first, pending last — the work comes before the watchlist'
  );
  assert.strictEqual(
    byDevice['b1'][0].diagnosticId,
    'DiagY',
    'within active, newest first'
  );
  assert.strictEqual(byDevice['b1'][0].name, 'Brake Circuit Pressure', 'name resolved from the catalogue');
  assert.strictEqual(byDevice['b1'][0].criticalLamp, true);
  assert.strictEqual(byDevice['b1'][2].criticalLamp, false);

  // An unknown diagnostic stays visible as its raw id rather than a blank line.
  const unknownDiag = faultsForDevices([fault({ deviceId: 'b9', diagnosticId: 'DiagUnknown' })], diagnostics);
  assert.strictEqual(unknownDiag['b9'][0].name, 'DiagUnknown');

  // count 0 is a row that still happened at least once.
  const zero = faultsForDevices([fault({ deviceId: 'b9', count: 0 })], diagnostics);
  assert.strictEqual(zero['b9'][0].count, 1);

  // A device whose only faults are cleared/dismissed gets no entry at all.
  const noneOpen = faultsForDevices(
    [fault({ deviceId: 'b3', faultState: 'Inactive' }), fault({ deviceId: 'b3', faultState: 'None' })],
    diagnostics
  );
  assert.strictEqual(noneOpen['b3'], undefined);

  assert.deepStrictEqual(faultsForDevices([], diagnostics), {}, 'empty input -> empty map');
}

console.log('fleet-health.check.ts: PASS');
