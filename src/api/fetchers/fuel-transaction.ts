import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { FuelTransactionDTO } from './types';
import { groupDeviceSearch } from './search';

const TTL_MS = 30 * 60 * 1000;
const RESULTS_LIMIT = 50000;

function toDTO(raw: any): FuelTransactionDTO {
  return {
    id: raw.id,
    deviceId: raw.device?.id ?? '',
    dateTime: raw.dateTime,
    volumeL: raw.volume ?? 0,
    cost: raw.cost ?? null,
    currency: raw.currencyCode ?? null,
    odometerKm: raw.odometer ?? null,
  };
}

// OPTIONAL entity: most databases have no fuel-card integration at all, and a
// user without the FuelTransaction right gets a hard rejection. Neither is a
// reason to take a whole module down — degrade to empty. One warn per session,
// not per call, or a dashboard refresh loop floods the console.
let warned = false;

export async function fetchFuelTransactions(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
}): Promise<FuelTransactionDTO[]> {
  const key = buildCacheKey(params.database, 'fuel-transaction', params.fromDate, params.toDate, params.groupId ?? '');
  const cached = await getCached<FuelTransactionDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'FuelTransaction',
    search: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...groupDeviceSearch(params.groupId),
    },
    resultsLimit: RESULTS_LIMIT,
  }).catch((err) => {
    if (!warned) {
      warned = true;
      console.warn('fetchFuelTransactions: FuelTransaction unavailable, treating as empty', err);
    }
    return [] as any[];
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
