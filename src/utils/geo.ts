// Pure geometry. No DOM, no Leaflet, no fetchers — must run under plain `tsx`
// (zone/geofence aggregation happens during data prep, not at render time).

/** Ray casting. Points exactly on an edge are undefined-but-stable; that's fine
 * for geofence attribution, where a vehicle sitting precisely on a boundary
 * line is not a case anyone can distinguish from GPS noise anyway. */
export function pointInPolygon(
  point: { lat: number; lon: number },
  polygon: { lat: number; lon: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    // Half-open vertical test (one strict, one not) — the standard way to avoid
    // double-counting a vertex that two edges share.
    if (
      a.lat > point.lat !== b.lat > point.lat &&
      point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance. Uses the haversine form rather than the shorter
 * spherical law of cosines because the latter loses precision on the short
 * (sub-km) hops that dominate breadcrumb data. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}
