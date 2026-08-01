import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { TripDTO } from './types';
import { parseIsoDurationSec } from './parseDuration';

const TTL_MS = 5 * 60 * 1000;

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
    drivingDurationSec: parseIsoDurationSec(raw.drivingDuration),
    idlingDurationSec: parseIsoDurationSec(raw.idlingDuration),
    startLat: raw.startLatitude ?? 0,
    startLon: raw.startLongitude ?? 0,
    stopLat: raw.stopLatitude ?? 0,
    stopLon: raw.stopLongitude ?? 0,
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
      groupSearch: params.groupId ? [{ id: params.groupId }] : undefined,
    },
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
