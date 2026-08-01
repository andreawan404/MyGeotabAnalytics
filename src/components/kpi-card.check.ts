import assert from 'node:assert';
import { computeKpis } from './kpi-card';
import type { TripDTO, ExceptionEventDTO } from '../api/fetchers/types';

// Edge case: empty lists / zero devices must not produce NaN or Infinity.
const empty = computeKpis([], [], 0, 86400);
assert.strictEqual(empty.utilizationPct, 0, 'utilizationPct must be 0, not NaN, when deviceCount is 0');
assert.strictEqual(empty.idleSec, 0);
assert.strictEqual(empty.engineHoursApprox, 0);
assert.deepStrictEqual(empty.exceptionsBySeverity, { low: 0, medium: 0, high: 0 });

// Known case: 2 devices, 1-day period (86400s). Driving sum = 3600 + 1800 = 5400s.
const trips: TripDTO[] = [
  { id: 't1', deviceId: 'd1', start: '', stop: '', distanceKm: 0, drivingDurationSec: 3600, idlingDurationSec: 300, startLat: 0, startLon: 0, stopLat: 0, stopLon: 0 },
  { id: 't2', deviceId: 'd2', start: '', stop: '', distanceKm: 0, drivingDurationSec: 1800, idlingDurationSec: 600, startLat: 0, startLon: 0, stopLat: 0, stopLon: 0 },
];
const exceptions: ExceptionEventDTO[] = [
  { id: 'e1', deviceId: 'd1', ruleId: 'r1', ruleName: 'Speeding', severity: 'high', start: '', stop: null, durationSec: 0 },
  { id: 'e2', deviceId: 'd2', ruleId: 'r2', ruleName: 'Idling', severity: 'low', start: '', stop: null, durationSec: 0 },
];

const result = computeKpis(trips, exceptions, 2, 86400);
assert.strictEqual(result.idleSec, 900);
assert.strictEqual(result.engineHoursApprox, 5400 / 3600);
assert.strictEqual(result.utilizationPct, (5400 / (2 * 86400)) * 100);
assert.deepStrictEqual(result.exceptionsBySeverity, { low: 1, medium: 0, high: 1 });

console.log('kpi-card.check.ts: PASS');
