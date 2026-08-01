// The one place date ranges are built. Pure — no DOM, no deps — so it runs
// under plain `tsx` (see date-range.check.ts).
//
// Two rules drive everything here:
//   1. `<input type="date">` / `<input type="datetime-local">` values are LOCAL.
//      `toISOString()` reports a UTC day, which for a Jakarta (UTC+7) user is the
//      WRONG day for the first 7 hours of every day.
//   2. A bare calendar day is INCLUSIVE at both ends. "01 Aug -> 01 Aug" means the
//      whole of 1 August, not a zero-length instant — and Geotab reads a bare
//      "YYYY-MM-DD" toDate as 00:00:00Z, which silently truncates the final day.
//      So for a date-only upper bound the exclusive instant is local midnight of
//      the day AFTER dateTo.
//
// DUAL FORMAT — `toUtcRange` accepts BOTH, and the difference is deliberate.
// Do NOT "simplify" the date-only branch away: every consumer passes the raw
// string from the filter, and the filter used to emit (and callers may still
// emit, e.g. saved/bookmarked state) bare days.
//   "YYYY-MM-DD"        -> whole inclusive local day(s); upper bound = next local
//                          midnight after dateTo.
//   "YYYY-MM-DDTHH:mm"  -> exact local instants; upper bound used AS GIVEN
//                          (exclusive, no +1 day). This is what lets a user ask
//                          for "07:00–17:00 yesterday".
// The two ends are judged independently, so a mixed pair works too.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local "YYYY-MM-DDTHH:mm" — the value shape of `<input type="datetime-local">`. */
function localDateTime(d: Date): string {
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Local instant for "YYYY-MM-DD" (midnight) or "YYYY-MM-DDTHH:mm".
 *  `new Date("YYYY-MM-DD")` would parse as UTC, hence the manual split. */
function parseLocal(value: string): Date {
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart ? timePart.split(':').map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

export function todayLocal(): string {
  return localDay(new Date());
}

/** Now, to the minute, local. */
export function nowLocal(): string {
  return localDateTime(new Date());
}

/** Trailing 7 days: 7 days ago at 00:00 local -> now. */
export function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  return { dateFrom: localDateTime(from), dateTo: nowLocal() };
}

export type PresetId = 'today' | 'last24h' | 'last7d' | 'last30d' | 'thisMonth';

/** Quick ranges for the filter bar. All LOCAL, all "YYYY-MM-DDTHH:mm", all ending now. */
export function presetRange(id: PresetId): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now);
  switch (id) {
    case 'today':
      from.setHours(0, 0, 0, 0);
      break;
    case 'last24h':
      from.setHours(from.getHours() - 24);
      break;
    case 'last7d':
      from.setDate(from.getDate() - 7);
      from.setHours(0, 0, 0, 0);
      break;
    case 'last30d':
      from.setDate(from.getDate() - 30);
      from.setHours(0, 0, 0, 0);
      break;
    case 'thisMonth':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
  }
  return { dateFrom: localDateTime(from), dateTo: nowLocal() };
}

/** Local range -> the UTC instants to send to MyGeotab, plus the real elapsed
 *  seconds those instants span (the utilization denominator).
 *  See the DUAL FORMAT note at the top of this file for the two input shapes. */
export function toUtcRange(
  dateFrom: string,
  dateTo: string
): { fromIso: string; toIso: string; periodSec: number } {
  const from = parseLocal(dateFrom);
  const to = parseLocal(dateTo);
  // Date-only upper bound is an inclusive DAY -> push to the next local midnight.
  // A timed upper bound is already the exclusive instant the user asked for.
  if (DATE_ONLY.test(dateTo)) to.setDate(to.getDate() + 1);

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    periodSec: Math.max(0, (to.getTime() - from.getTime()) / 1000),
  };
}
