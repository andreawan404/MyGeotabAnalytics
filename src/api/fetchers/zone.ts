import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { ZoneDTO } from './types';

const TTL_MS = 30 * 60 * 1000; // geofences change rarely

// ponytail: Geotab's Point object is {x: longitude, y: latitude}.
function toDTO(raw: any): ZoneDTO {
  const points = (raw.points ?? []).map((p: any) => ({ lat: p.y ?? 0, lon: p.x ?? 0 }));
  const centerLat = points.length ? points.reduce((sum: number, p: { lat: number }) => sum + p.lat, 0) / points.length : 0;
  const centerLon = points.length ? points.reduce((sum: number, p: { lon: number }) => sum + p.lon, 0) / points.length : 0;
  return { id: raw.id, name: raw.name, points, centerLat, centerLon };
}

export async function fetchZones(params: { database: string }): Promise<ZoneDTO[]> {
  const key = buildCacheKey(params.database, 'zone');
  const cached = await getCached<ZoneDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', { typeName: 'Zone' });
  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
