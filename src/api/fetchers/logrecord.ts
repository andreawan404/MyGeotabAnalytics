import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { LogRecordDTO } from './types';
import { groupDeviceSearch } from './search';

const TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000; // hard ceiling regardless of what the caller asks for — LogRecord volume can hang the browser

function toDTO(raw: any): LogRecordDTO {
  return {
    deviceId: raw.device?.id ?? '',
    dateTime: raw.dateTime,
    lat: raw.latitude ?? 0,
    lon: raw.longitude ?? 0,
    speedKmh: raw.speed ?? 0,
  };
}

export async function fetchLogRecords(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
  resultsLimit?: number;
}): Promise<LogRecordDTO[]> {
  if (!params.fromDate || !params.toDate) {
    // Never fetch LogRecord unbounded — millions of rows, hangs the browser (root CLAUDE.md rule).
    throw new Error('fetchLogRecords requires both fromDate and toDate');
  }

  const resultsLimit = Math.min(params.resultsLimit || DEFAULT_LIMIT, MAX_LIMIT);
  const key = buildCacheKey(params.database, 'logrecord', params.fromDate, params.toDate, params.groupId ?? '', resultsLimit);
  const cached = await getCached<LogRecordDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'LogRecord',
    search: { fromDate: params.fromDate, toDate: params.toDate, ...groupDeviceSearch(params.groupId) },
    resultsLimit,
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
