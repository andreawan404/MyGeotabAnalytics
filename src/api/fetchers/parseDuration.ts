// Shared by trip.ts and exception-event.ts: MyGeotab returns durations as
// ISO 8601 duration strings (e.g. "PT1H2M3S"), not seconds. One real parser,
// not duplicated across both fetchers.

export function parseIsoDurationSec(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}
