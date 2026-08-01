import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { FaultDataDTO } from './types';
import { groupDeviceSearch } from './search';

const TTL_MS = 5 * 60 * 1000;
const RESULTS_LIMIT = 50000;

function toDTO(raw: any): FaultDataDTO {
  return {
    id: raw.id,
    deviceId: raw.device?.id ?? '',
    diagnosticId: raw.diagnostic?.id ?? '',
    dateTime: raw.dateTime,
    faultState: raw.faultState ?? 'None',
    // Geotab has moved this field around across versions: newer databases send
    // `severity`, older ones `faultSeverity`, and some only carry the severity of
    // the underlying diagnostic. Reading only one of them buckets everything wrong.
    severity: raw.severity ?? raw.faultSeverity ?? raw.diagnosticSeverity ?? 'Unknown',
    count: raw.count ?? 0,
    dismissDateTime: raw.dismissDateTime ?? null,
    failureModeId: raw.failureMode?.id ?? null,
    faultLampState: raw.faultLampState ?? null,
    riskOfBreakdown: raw.riskOfBreakdown ?? null,
    controllerName: raw.controller?.name ?? null,
  };
}

export async function fetchFaultData(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
}): Promise<FaultDataDTO[]> {
  const key = buildCacheKey(params.database, 'fault-data', params.fromDate, params.toDate, params.groupId ?? '');
  const cached = await getCached<FaultDataDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'FaultData',
    search: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...groupDeviceSearch(params.groupId),
    },
    resultsLimit: RESULTS_LIMIT,
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
