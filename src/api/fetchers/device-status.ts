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

  const raw = await callApi<any[]>('Get', {
    typeName: 'DeviceStatusInfo',
    search: params.deviceIds?.length ? { deviceSearch: params.deviceIds.map((id) => ({ id })) } : undefined,
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
