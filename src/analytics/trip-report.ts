// Journeys between registered geofences. PURE: no DOM, no Chart.js, no fetchers
// — that is the only reason trip-report.check.ts runs under plain `tsx`.
//
// A Geotab Trip is ignition-on -> ignition-off, so one journey Cikarang -> Priok
// with a refuelling stop is THREE trips, two of which begin and end nowhere in
// particular. Reading raw trips answers no operational question, so consecutive
// trips are chained until the vehicle actually stops somewhere registered.

import type { TripDTO, ZoneDTO, DeviceLite } from '../api/fetchers/types';
import { pointInPolygon } from '../utils/geo';

export interface ZoneRef {
  id: string;
  name: string;
}

export interface JourneyRow {
  deviceId: string;
  deviceName: string;
  fromZone: ZoneRef;
  toZone: ZoneRef;
  departAt: string;
  arriveAt: string;
  /** arrive - depart, INCLUDING intermediate stops: that is the elapsed time
   *  operations actually feels. */
  durationSec: number;
  distanceKm: number;
  /** null when any leg is unmeasured — a partial sum understates consumption
   *  while looking like a measurement. */
  fuelL: number | null;
  stops: number;
  tripIds: string[];
  isRoundTrip: boolean;
}

/** Bounding-box area. Enough to rank "more specific" without computing real
 *  polygon area, which buys nothing here. */
function zoneArea(zone: ZoneDTO): number {
  if (zone.points.length === 0) return Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of zone.points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return (maxLat - minLat) * (maxLon - minLon);
}

/**
 * SMALLEST containing zone wins, not the first match. A depot usually sits
 * inside a city-sized zone; taking the first hit would label every journey
 * "Jakarta -> Jakarta" and the whole report would say nothing.
 */
export function resolveZone(point: { lat: number; lon: number }, zones: ZoneDTO[]): ZoneRef | null {
  let best: ZoneDTO | null = null;
  let bestArea = Infinity;
  for (const z of zones) {
    if (z.points.length < 3) continue; // not a polygon
    if (!pointInPolygon(point, z.points)) continue;
    const area = zoneArea(z);
    if (area < bestArea) {
      best = z;
      bestArea = area;
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

export interface BuildOptions {
  dwellMinutes: number;
  /** tripId -> litres, or null when that trip has no reading. */
  fuelByTrip?: Record<string, number | null>;
}

export function buildJourneys(
  trips: TripDTO[],
  zones: ZoneDTO[],
  devices: DeviceLite[],
  opts: BuildOptions
): JourneyRow[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  const dwellMs = Math.max(0, opts.dwellMinutes) * 60_000;

  const byDevice = new Map<string, TripDTO[]>();
  for (const t of trips) {
    if (!Number.isFinite(Date.parse(t.start)) || !Number.isFinite(Date.parse(t.stop))) continue;
    const list = byDevice.get(t.deviceId);
    if (list) list.push(t);
    else byDevice.set(t.deviceId, [t]);
  }

  const out: JourneyRow[] = [];
  for (const [deviceId, list] of byDevice) {
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    let chain: TripDTO[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      chain.push(t);

      const endZone = resolveZone({ lat: t.stopLat, lon: t.stopLon }, zones);
      const next = list[i + 1];
      // Last trip of this vehicle counts as settled: there is no later movement
      // to tell us otherwise.
      const dwelled = !next || Date.parse(next.start) - Date.parse(t.stop) >= dwellMs;

      if (!endZone || !dwelled) continue;

      const first = chain[0];
      const startZone = resolveZone({ lat: first.startLat, lon: first.startLon }, zones);
      if (startZone) {
        let fuelL: number | null = 0;
        for (const leg of chain) {
          const litres = opts.fuelByTrip?.[leg.id];
          if (typeof litres !== 'number') {
            fuelL = null;
            break;
          }
          fuelL += litres;
        }

        out.push({
          deviceId,
          deviceName: nameById.get(deviceId) ?? deviceId,
          fromZone: startZone,
          toZone: endZone,
          departAt: first.start,
          arriveAt: t.stop,
          durationSec: Math.max(0, (Date.parse(t.stop) - Date.parse(first.start)) / 1000),
          distanceKm: chain.reduce((sum, x) => sum + (Number.isFinite(x.distanceKm) ? x.distanceKm : 0), 0),
          fuelL,
          stops: chain.length - 1,
          tripIds: chain.map((x) => x.id),
          isRoundTrip: startZone.id === endZone.id,
        });
      }
      chain = [];
    }
  }

  return out.sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt));
}

/** Trips that made it into no row at all — including chains dropped because an
 *  endpoint was outside every zone. Without this, journeys vanish silently and
 *  nobody learns they need more geofences. */
export function summariseUnmatched(
  trips: TripDTO[],
  journeys: JourneyRow[]
): { trips: number; distanceKm: number } {
  const used = new Set(journeys.flatMap((j) => j.tripIds));
  let count = 0;
  let distanceKm = 0;
  for (const t of trips) {
    if (used.has(t.id)) continue;
    count++;
    distanceKm += Number.isFinite(t.distanceKm) ? t.distanceKm : 0;
  }
  return { trips: count, distanceKm };
}
