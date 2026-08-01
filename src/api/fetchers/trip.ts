import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { TripDTO } from './types';
import { parseDurationSec } from './parseDuration';
import { groupDeviceSearch } from './search';

const TTL_MS = 5 * 60 * 1000;
const RESULTS_LIMIT = 50000;

// ponytail: assuming raw Trip carries startLatitude/startLongitude/
// stopLatitude/stopLongitude (not spelled out in the public object docs).
// distance is assumed already in km (Geotab's default unit). Cheap to fix
// once checked against a real database response.
function toDTO(raw: any): TripDTO {
  return {
    id: raw.id,
    deviceId: raw.device?.id ?? '',
    start: raw.start,
    stop: raw.stop,
    distanceKm: raw.distance ?? 0,
    drivingDurationSec: parseDurationSec(raw.drivingDuration),
    idlingDurationSec: parseDurationSec(raw.idlingDuration),
    startLat: raw.startLatitude ?? 0,
    startLon: raw.startLongitude ?? 0,
    stopLat: raw.stopLatitude ?? 0,
    stopLon: raw.stopLongitude ?? 0,
    // Geotab reports an unidentified driver as the sentinel "UnknownDriverId".
    // Normalise that to undefined so callers can treat "no driver" uniformly —
    // this is what gates the per-driver ranking in the safety module.
    driverId: raw.driver?.id && raw.driver.id !== 'UnknownDriverId' ? raw.driver.id : undefined,
  };
}

export async function fetchTrips(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
}): Promise<TripDTO[]> {
  const key = buildCacheKey(params.database, 'trip', params.fromDate, params.toDate, params.groupId ?? '');
  const cached = await getCached<TripDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'Trip',
    search: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...groupDeviceSearch(params.groupId),
    },
    resultsLimit: RESULTS_LIMIT,
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
