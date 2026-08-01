import assert from 'node:assert';
import { todayLocal, nowLocal, defaultDateRange, presetRange, toUtcRange, type PresetId } from './date-range';

// --- date-only format: the ORIGINAL behaviour, unchanged. These are the
// regression guard for every consumer that still passes a bare "YYYY-MM-DD".
// Mid-June: no timezone on earth transitions DST here, so the day lengths below
// are exactly 86400s wherever this runs. Expectations are still built from local
// Date objects rather than hardcoded ISO strings.
const single = toUtcRange('2026-06-10', '2026-06-10');
assert.strictEqual(single.periodSec, 86400, 'a single selected day is a whole day, not zero');
assert.strictEqual(single.fromIso, new Date(2026, 5, 10).toISOString(), 'fromIso = local midnight of dateFrom');
assert.strictEqual(single.toIso, new Date(2026, 5, 11).toISOString(), 'toIso = local midnight of the day AFTER dateTo');

const week = toUtcRange('2026-06-10', '2026-06-16');
assert.strictEqual(week.periodSec, 604800, '7 inclusive days = 7 * 86400');
assert.strictEqual(week.toIso, new Date(2026, 5, 17).toISOString());

// todayLocal must be the LOCAL day. toISOString().slice(0,10) is the UTC day,
// which differs from the local day for part of every day east/west of UTC.
const now = new Date();
assert.strictEqual(todayLocal(), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);

// --- timed format: exact local instants, upper bound used AS GIVEN.
const workday = toUtcRange('2026-08-01T07:00', '2026-08-01T17:00');
assert.strictEqual(workday.periodSec, 36000, '07:00 -> 17:00 is 10 hours, not a whole day');
assert.strictEqual(workday.fromIso, new Date(2026, 7, 1, 7, 0).toISOString(), 'fromIso = 07:00 LOCAL');
assert.strictEqual(workday.toIso, new Date(2026, 7, 1, 17, 0).toISOString(), 'toIso = 17:00 LOCAL, NOT next midnight');

// A timed range that happens to span a whole day must NOT get the +1 day bump.
const timedFullDay = toUtcRange('2026-06-10T00:00', '2026-06-11T00:00');
assert.strictEqual(timedFullDay.periodSec, 86400, 'timed midnight-to-midnight is exactly one day');
assert.strictEqual(timedFullDay.toIso, new Date(2026, 5, 11).toISOString());

// nowLocal is the datetime-local value shape, and its date half is today.
assert.match(nowLocal(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'nowLocal = "YYYY-MM-DDTHH:mm"');
assert.strictEqual(nowLocal().slice(0, 10), todayLocal(), 'nowLocal starts with the LOCAL day');

// The default range is a week of real seconds — the utilization denominator.
const def = defaultDateRange();
assert.match(def.dateFrom, /^\d{4}-\d{2}-\d{2}T00:00$/, 'default range starts at local midnight');
assert.strictEqual(def.dateTo.slice(0, 10), todayLocal(), 'default range ends today');
const defRange = toUtcRange(def.dateFrom, def.dateTo);
assert.ok(defRange.periodSec >= 604800, 'default range spans at least 7 full days');
assert.ok(defRange.periodSec < 604800 + 86400, 'default range spans less than 8 days');

// Every preset: well-ordered, timed format, non-negative window. "today" and
// "thisMonth" are legitimately zero-length in the first minute of the period,
// so >= 0 rather than > 0 — a flaky midnight assert is worse than no assert.
const presets: PresetId[] = ['today', 'last24h', 'last7d', 'last30d', 'thisMonth'];
for (const id of presets) {
  const r = presetRange(id);
  assert.match(r.dateFrom, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `${id}: dateFrom is "YYYY-MM-DDTHH:mm"`);
  assert.match(r.dateTo, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `${id}: dateTo is "YYYY-MM-DDTHH:mm"`);
  assert.ok(r.dateFrom <= r.dateTo, `${id}: dateFrom must not be after dateTo`);
  assert.ok(toUtcRange(r.dateFrom, r.dateTo).periodSec >= 0, `${id}: never a negative window`);
  assert.strictEqual(r.dateTo.slice(0, 10), todayLocal(), `${id}: ends today`);
}

// The three fixed-length presets are always a positive window of roughly the
// advertised size. Bounds are ±1 day loose because the from-instant is wall-clock
// arithmetic: a DST day is 23 or 25 hours long, and last7d/last30d also carry
// however much of today has already elapsed.
const DAY = 86400;
function presetSec(id: PresetId): number {
  const r = presetRange(id);
  return toUtcRange(r.dateFrom, r.dateTo).periodSec;
}
assert.ok(presetSec('last24h') > 22 * 3600 && presetSec('last24h') < 26 * 3600, 'last24h ~= 24h');
assert.ok(presetSec('last7d') > 7 * DAY - 3600 && presetSec('last7d') < 9 * DAY, 'last7d ~= 7-8 days');
assert.ok(presetSec('last30d') > 30 * DAY - 3600 && presetSec('last30d') < 32 * DAY, 'last30d ~= 30-31 days');

console.log('date-range.check.ts: PASS');
