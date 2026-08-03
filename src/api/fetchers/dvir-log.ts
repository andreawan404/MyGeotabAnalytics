import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DvirDefectDTO } from './types';
import { groupDeviceSearch, restrictToGroup } from './search';

const TTL_MS = 30 * 60 * 1000;
const RESULTS_LIMIT = 50000;

// A DVIRLog is a whole inspection; the unit consumers care about is the defect.
// One log with three defects is three rows.
function toDTOs(log: any): DvirDefectDTO[] {
  const deviceId = log.device?.id ?? '';
  return (log.defects ?? []).map((d: any, i: number) => ({
    id: d.id ?? `${log.id}:${i}`, // defect records are not always individually identified
    deviceId,
    dateTime: log.dateTime,
    defectName: d.defect?.name ?? d.defect?.id ?? 'Unknown defect',
    severity: d.defect?.severity ?? d.severity ?? null,
    repairStatus: d.repairStatus ?? null,
  }));
}

// OPTIONAL entity — see the same note in fuel-transaction.ts. DVIR is a US/CA
// compliance feature most Indonesian databases never populate.
let warned = false;

export async function fetchDvirDefects(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
}): Promise<DvirDefectDTO[]> {
  const key = buildCacheKey(params.database, 'dvir-defect', params.fromDate, params.toDate, params.groupId ?? '');
  const cached = await getCached<DvirDefectDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'DVIRLog',
    search: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...groupDeviceSearch(params.groupId),
    },
    resultsLimit: RESULTS_LIMIT,
  }).catch((err) => {
    if (!warned) {
      warned = true;
      console.warn('fetchDvirDefects: DVIRLog unavailable, treating as empty', err);
    }
    return [] as any[];
  });

  // Keanggotaan grup ditegakkan di klien: search-nya diabaikan server (search.ts).
  const scoped = await restrictToGroup(raw, params.database, params.groupId);
  const dtos = scoped.flatMap(toDTOs);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
