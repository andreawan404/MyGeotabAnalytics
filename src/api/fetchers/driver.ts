import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DriverLite } from './types';

const TTL_MS = 30 * 60 * 1000;
const RESULTS_LIMIT = 50000;

// A MyGeotab User has no `name` field in most databases — it has firstName /
// lastName, and `name` is the login (an email). Prefer the human name, fall back
// to the login so a row is never blank in the UI.
function toDTO(raw: any): DriverLite {
  const fullName = `${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim();
  return {
    id: raw.id,
    name: fullName || raw.name || raw.id,
    phone: raw.phoneNumber ?? null,
  };
}

export async function fetchDrivers(params: { database: string }): Promise<DriverLite[]> {
  const key = buildCacheKey(params.database, 'driver');
  const cached = await getCached<DriverLite[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'User',
    search: { isDriver: true }, // without this it returns every admin/viewer account too
    resultsLimit: RESULTS_LIMIT,
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
