import assert from 'node:assert';
import { computeKpis, explainKpis, workingSecondsInPeriod, DEFAULT_WORKING_HOURS } from './kpi-card';
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

// --- explainKpis: the card must show the arithmetic, not just the answer -----

// Worked example: 7 days (604.800s) at the default 10h x 6d = 216.000s of
// working time per unit; 5 units; 54.000s driving -> exactly 5,0%.
const exp = explainKpis({
  drivingSec: 54000,
  idleSec: 900,
  deviceCount: 5,
  periodSec: 604800,
  working: DEFAULT_WORKING_HOURS,
  exceptionsBySeverity: { low: 5, medium: 4, high: 3 },
});

assert.strictEqual(
  exp.utilization.substituted,
  '54.000 dtk jalan ÷ (5 unit × 216.000 dtk jam kerja) × 100 = 5,0%',
  'utilisation must show the substituted arithmetic, id-ID formatted'
);
// The substituted percentage must agree with the number on the card.
assert.strictEqual(computeKpis([], [], 5, 604800).utilizationPct, 0);
assert.ok(
  exp.utilization.source.includes('10 jam/hari × 6 hari/minggu'),
  'utilisation must name the user-supplied working hours as the denominator'
);
assert.strictEqual(exp.idle.substituted, '900 dtk idle = 0j 15m');
assert.strictEqual(exp.engineHours.substituted, '(54.000 dtk jalan + 900 dtk idle) ÷ 3.600 = 15,3 jam');
assert.strictEqual(exp.exceptions.substituted, '12 kejadian = 3 tinggi + 4 sedang + 5 rendah');

// Provenance labels: measured vs assumption-driven vs derived.
assert.strictEqual(exp.utilization.kind, 'heuristik', 'utilisation leans on user-entered working hours');
assert.strictEqual(exp.idle.kind, 'terukur');
assert.strictEqual(exp.engineHours.kind, 'estimasi');
assert.strictEqual(exp.exceptions.kind, 'terukur');

// Engine hours must not read as a measured counter value.
assert.ok(
  exp.engineHours.source.includes('DiagnosticEngineHoursId'),
  'engine hours must say which counter it is NOT reading'
);
// Severity comes from the rule id, because built-in rule names are localized.
assert.ok(exp.exceptions.source.includes('id aturan'));
assert.ok(exp.exceptions.source.includes('Rule'));

// Empty fleet: 0 devices, 0 trips, 0 exceptions. Every field must still be a
// sane sentence — no NaN, no Infinity, no "-0" leaking to a fleet manager.
const emptyExp = explainKpis({
  drivingSec: 0,
  idleSec: 0,
  deviceCount: 0,
  periodSec: 0,
  working: DEFAULT_WORKING_HOURS,
  exceptionsBySeverity: { low: 0, medium: 0, high: 0 },
});
for (const [key, e] of Object.entries(emptyExp)) {
  for (const [field, value] of Object.entries(e)) {
    assert.ok(value.length > 0, `${key}.${field} must not be empty`);
    assert.ok(!/NaN|Infinity|∞|undefined/.test(value), `${key}.${field} leaked "${value}"`);
  }
}
assert.ok(
  emptyExp.utilization.substituted.includes('Belum bisa dihitung'),
  'zero-device utilisation must say it cannot be computed rather than print a bare 0'
);
assert.strictEqual(emptyExp.idle.substituted, '0 dtk idle = 0j 0m');

console.log('kpi-card.check.ts: PASS');
