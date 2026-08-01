import assert from 'node:assert';
import { computeKpis, workingSecondsInPeriod, DEFAULT_WORKING_HOURS } from './kpi-card';
import type { TripDTO, ExceptionEventDTO } from '../api/fetchers/types';

// Edge case: empty lists / zero devices must not produce NaN or Infinity.
const empty = computeKpis([], [], 0, 86400);
assert.strictEqual(empty.utilizationPct, 0, 'utilizationPct must be 0, not NaN, when deviceCount is 0');
assert.strictEqual(empty.idleSec, 0);
assert.strictEqual(empty.engineHoursApprox, 0);
assert.deepStrictEqual(empty.exceptionsBySeverity, { low: 0, medium: 0, high: 0 });

// A zero-length period must not divide by zero either.
assert.strictEqual(computeKpis([], [], 5, 0).utilizationPct, 0);

// Working-hours basis: one full week at 10h x 6d = 60 working hours per device.
assert.strictEqual(workingSecondsInPeriod(604800, DEFAULT_WORKING_HOURS), 60 * 3600);
assert.strictEqual(workingSecondsInPeriod(86400, { hoursPerDay: 24, daysPerWeek: 7 }), 86400, '24/7 basis = wall clock');

// Known case: 2 devices, 1-day period. Driving 3600 + 1800 = 5400s, idle 900s.
const trips: TripDTO[] = [
  { id: 't1', deviceId: 'd1', start: '', stop: '', distanceKm: 0, drivingDurationSec: 3600, idlingDurationSec: 300, startLat: 0, startLon: 0, stopLat: 0, stopLon: 0 },
  { id: 't2', deviceId: 'd2', start: '', stop: '', distanceKm: 0, drivingDurationSec: 1800, idlingDurationSec: 600, startLat: 0, startLon: 0, stopLat: 0, stopLon: 0 },
];
const exceptions: ExceptionEventDTO[] = [
  { id: 'e1', deviceId: 'd1', ruleId: 'RuleSpeedingId', ruleName: 'Melebihi Batas Kecepatan', severity: 'high', start: '', stop: null, durationSec: 0 },
  { id: 'e2', deviceId: 'd2', ruleId: 'c3D4', ruleName: 'Perawatan Terjadwal', severity: 'low', start: '', stop: null, durationSec: 0 },
];

const result = computeKpis(trips, exceptions, 2, 86400);
assert.strictEqual(result.idleSec, 900);
// Engine-on is driving PLUS idling, not driving alone.
assert.strictEqual(result.engineHoursApprox, (5400 + 900) / 3600);
assert.strictEqual(result.utilizationPct, (5400 / (2 * workingSecondsInPeriod(86400, DEFAULT_WORKING_HOURS))) * 100);
assert.deepStrictEqual(result.exceptionsBySeverity, { low: 1, medium: 0, high: 1 });

// The basis is configurable, and a wider basis means lower utilization.
const strict = computeKpis(trips, exceptions, 2, 86400, { hoursPerDay: 24, daysPerWeek: 7 });
assert.ok(strict.utilizationPct < result.utilizationPct, '24/7 basis must report lower utilization than a 10h/6d basis');

console.log('kpi-card.check.ts: PASS');
