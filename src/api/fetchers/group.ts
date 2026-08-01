import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DeviceLite } from './types';

const TTL_MS = 30 * 60 * 1000;

export async function fetchGroups(params: { database: string }): Promise<DeviceLite[]> {
  const key = buildCacheKey(params.database, 'group');
  const cached = await getCached<DeviceLite[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', { typeName: 'Group' });
  const dtos: DeviceLite[] = raw.map((g) => ({ id: g.id, name: g.name }));
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
