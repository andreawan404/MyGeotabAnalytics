import assert from 'node:assert';
import { todayLocal, defaultDateRange, toUtcRange } from './date-range';

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

// The default range is a whole week of real seconds — the utilization denominator.
const def = defaultDateRange();
assert.strictEqual(def.dateTo, todayLocal(), 'default range ends today, inclusive');
assert.strictEqual(toUtcRange(def.dateFrom, def.dateTo).periodSec, 604800, 'default range spans 7 full days');

console.log('date-range.check.ts: PASS');
