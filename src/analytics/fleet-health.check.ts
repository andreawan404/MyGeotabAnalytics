import assert from 'node:assert';
import { isCriticalLamp, activeFaults, topFaultCodes, rankVehiclesByFault, healthSummary } from './fleet-health';
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
  ['a', 'p'],
  'only undismissed Active/Pending survive'
);

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

console.log('fleet-health.check.ts: PASS');
