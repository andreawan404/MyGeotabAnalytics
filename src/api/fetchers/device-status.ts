import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DeviceStatusDTO } from './types';

const TTL_MS = 30 * 1000; // near-real-time data, keep it fresh

// ponytail: assuming raw DeviceStatusInfo.device carries an expanded {id,name}
// (falls back to id if the host only sends the bare reference).
function toDTO(raw: any): DeviceStatusDTO {
  return {
    deviceId: raw.device?.id ?? '',
    deviceName: raw.device?.name ?? raw.device?.id ?? '',
    isDriving: !!raw.isDriving,
    lat: raw.latitude ?? 0,
    lon: raw.longitude ?? 0,
    speedKmh: raw.speed ?? 0,
    dateTime: raw.dateTime,
  };
}

export async function fetchDeviceStatus(params: {
  database: string;
  deviceIds?: string[];
}): Promise<DeviceStatusDTO[]> {
  const key = buildCacheKey(params.database, 'device-status', (params.deviceIds ?? []).join(','));
  const cached = await getCached<DeviceStatusDTO[]>(key);
  if (cached) return cached;

  // deviceSearch is a SINGLE DeviceSearch object, not an array — an array is an
  // unknown search property and MyGeotab silently ignores it (returning the whole
  // fleet). Only one id can be pushed server-side; anything else is filtered here.
  const ids = params.deviceIds ?? [];
  const raw = await callApi<any[]>('Get', {
    typeName: 'DeviceStatusInfo',
    search: ids.length === 1 ? { deviceSearch: { id: ids[0] } } : undefined,
  });

  const wanted = new Set(ids);
  const dtos = raw.map(toDTO).filter((d) => wanted.size === 0 || wanted.has(d.deviceId));
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
