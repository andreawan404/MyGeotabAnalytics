// The one place date ranges are built. Pure — no DOM, no deps — so it runs
// under plain `tsx` (see date-range.check.ts).
//
// Two rules drive everything here:
//   1. `<input type="date">` values are LOCAL calendar days. `toISOString()`
//      reports a UTC day, which for a Jakarta (UTC+7) user is the WRONG day for
//      the first 7 hours of every day.
//   2. Both ends of the picker are INCLUSIVE. "01 Aug -> 01 Aug" means the whole
//      of 1 August, not a zero-length instant — and Geotab reads a bare
//      "YYYY-MM-DD" toDate as 00:00:00Z, which silently truncates the final day.
// So the exclusive upper bound is local midnight of the day AFTER dateTo.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD day. `new Date("YYYY-MM-DD")` would parse as UTC. */
function startOfLocalDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayLocal(): string {
  return localDay(new Date());
}

/** Trailing 7 local days, inclusive of today. */
export function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { dateFrom: localDay(from), dateTo: todayLocal() };
}

/** Local inclusive day range -> the UTC instants to send to MyGeotab, plus the
 *  real elapsed seconds those instants span (the utilization denominator). */
export function toUtcRange(
  dateFrom: string,
  dateTo: string
): { fromIso: string; toIso: string; periodSec: number } {
  const from = startOfLocalDay(dateFrom);
  const to = startOfLocalDay(dateTo);
  to.setDate(to.getDate() + 1); // inclusive upper bound -> exclusive instant

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    periodSec: Math.max(0, (to.getTime() - from.getTime()) / 1000),
  };
}
