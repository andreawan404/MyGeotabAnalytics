import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DeviceLite } from './types';

const TTL_MS = 30 * 60 * 1000;

export async function fetchDevices(params: { database: string; groupId?: string }): Promise<DeviceLite[]> {
  const key = buildCacheKey(params.database, 'device', params.groupId ?? '');
  const cached = await getCached<DeviceLite[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'Device',
    search: params.groupId ? { groupSearch: [{ id: params.groupId }] } : undefined,
  });

  const dtos: DeviceLite[] = raw.map((d) => ({ id: d.id, name: d.name }));
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
