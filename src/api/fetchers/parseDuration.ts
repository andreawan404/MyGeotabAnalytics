// Shared by trip.ts and exception-event.ts.
//
// MyGeotab serializes TimeSpan the .NET way — "00:15:30", "01:02:03", and
// "1.02:03:04" once it passes 24h — NOT ISO-8601. The original ISO-only parser
// therefore returned 0 for every duration a real database sent, which is what
// zeroed Total Idle Time / Engine Hours / Fleet Utilization in production.
// ISO-8601 is still accepted because some endpoints/exports do use it.

// [-][d.]HH:MM:SS[.fffffff]
const TIMESPAN_RE = /^(-)?(?:(\d+)\.)?(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/;
// P[nD]T[nH][nM][nS] — the D part is real and the old regex could not match it.
const ISO_RE = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

// One warning per DISTINCT bad value: a single bad rule can produce tens of
// thousands of rows (5436 exceptions in one real database) and an unthrottled
// console.warn would drown the console and stall the tab.
const warnedValues = new Set<string>();

export function parseDurationSec(value: string | number | null | undefined): number {
  if (!value) return 0; // nullish, "" and 0 all mean "no duration"
  if (typeof value === 'number') return value; // already seconds

  const ts = TIMESPAN_RE.exec(value);
  if (ts) {
    const [, sign, days, h, m, s] = ts;
    const total = (Number(days) || 0) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
    return sign ? -total : total;
  }

  const iso = ISO_RE.exec(value);
  if (iso && iso.slice(1).some((g) => g !== undefined)) {
    const [, d, h, m, s] = iso;
    return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
  }

  if (!warnedValues.has(value)) {
    warnedValues.add(value);
    console.warn(`parseDurationSec: unrecognized duration ${JSON.stringify(value)} -> 0`);
  }
  return 0;
}
