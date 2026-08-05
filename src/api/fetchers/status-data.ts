import { callApi, multiCall } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { StatusDataDTO } from './types';
import { groupDeviceSearch, restrictToGroup, groupKey } from './search';

const TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 50000;

function toDTO(raw: any): StatusDataDTO {
  return {
    deviceId: raw.device?.id ?? '',
    diagnosticId: raw.diagnostic?.id ?? '',
    dateTime: raw.dateTime,
    value: raw.data ?? 0, // StatusData carries its number in `data`, not `value`
  };
}

interface Query {
  database: string;
  fromDate: string;
  toDate: string;
  groupIds?: string[];
  resultsLimit?: number;
}

function getParams(diagnosticId: string, q: Query): object {
  return {
    typeName: 'StatusData',
    search: {
      diagnosticSearch: { id: diagnosticId },
      fromDate: q.fromDate,
      toDate: q.toDate,
      ...groupDeviceSearch(q.groupIds),
    },
    resultsLimit: q.resultsLimit ?? DEFAULT_LIMIT,
  };
}

// resultsLimit is part of the key: probe.ts reuses this path with resultsLimit 1,
// and a 1-row cached result must never satisfy a real full-range fetch.
function cacheKey(diagnosticId: string, q: Query): string {
  return buildCacheKey(
    q.database,
    'status-data',
    diagnosticId,
    q.fromDate,
    q.toDate,
    groupKey(q.groupIds),
    q.resultsLimit ?? DEFAULT_LIMIT
  );
}

export async function fetchStatusData(params: Query & { diagnosticId: string }): Promise<StatusDataDTO[]> {
  const key = cacheKey(params.diagnosticId, params);
  const cached = await getCached<StatusDataDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', getParams(params.diagnosticId, params));

  // Keanggotaan grup ditegakkan di klien: search-nya diabaikan server (search.ts).
  const scoped = await restrictToGroup(raw, params.database, params.groupIds);
  const dtos = scoped.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}

/** N diagnostics in ONE round trip. Looping fetchStatusData (or worse, fanning
 * out per device) is what gets a real fleet throttled — root CLAUDE.md rule 6.
 * Shares fetchStatusData's per-diagnostic cache entries, so only the misses go
 * out on the wire. */
export async function fetchStatusDataMulti(
  params: Query & { diagnosticIds: string[] }
): Promise<Record<string, StatusDataDTO[]>> {
  const out: Record<string, StatusDataDTO[]> = {};
  const missing: string[] = [];

  for (const id of params.diagnosticIds) {
    const cached = await getCached<StatusDataDTO[]>(cacheKey(id, params));
    if (cached) out[id] = cached;
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  const results = await multiCall<any[][]>(missing.map((id) => ['Get', getParams(id, params)]));

  for (let i = 0; i < missing.length; i++) {
    // Jalur multiCall butuh penyaringan grup yang sama dengan fetchStatusData.
    // Melewatkannya di sini akan membuat odometer dan jam mesin tetap
    // fleet-wide sementara sisa halaman sudah tersaring — beda angka di satu
    // layar, jenis kesalahan yang paling lama tidak disadari.
    const scoped = await restrictToGroup(results[i] ?? [], params.database, params.groupIds);
    const dtos = scoped.map(toDTO);
    out[missing[i]] = dtos;
    await setCached(cacheKey(missing[i], params), dtos, TTL_MS);
  }
  return out;
}
