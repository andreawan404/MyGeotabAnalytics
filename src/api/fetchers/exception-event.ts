import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { ExceptionEventDTO } from './types';
import { parseIsoDurationSec } from './parseDuration';

const TTL_MS = 5 * 60 * 1000;

// severity isn't a real MyGeotab field — keyword-match the rule name.
// Small lookup table, not a scoring engine; tune the lists as real rule
// names from a live database come in.
const HIGH_KEYWORDS = ['harsh', 'speeding', 'collision', 'seatbelt'];
const MEDIUM_KEYWORDS = ['idle', 'idling', 'stop', 'zone'];

function deriveSeverity(ruleName: string): 'low' | 'medium' | 'high' {
  const n = ruleName.toLowerCase();
  if (HIGH_KEYWORDS.some((k) => n.includes(k))) return 'high';
  if (MEDIUM_KEYWORDS.some((k) => n.includes(k))) return 'medium';
  return 'low';
}

function toDTO(raw: any): ExceptionEventDTO {
  const ruleName = raw.rule?.name ?? '';
  return {
    id: raw.id,
    deviceId: raw.device?.id ?? '',
    ruleId: raw.rule?.id ?? '',
    ruleName,
    severity: deriveSeverity(ruleName),
    start: raw.activeFrom,
    stop: raw.activeTo ?? null,
    durationSec: parseIsoDurationSec(raw.duration),
  };
}

export async function fetchExceptionEvents(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
}): Promise<ExceptionEventDTO[]> {
  const key = buildCacheKey(params.database, 'exception-event', params.fromDate, params.toDate, params.groupId ?? '');
  const cached = await getCached<ExceptionEventDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'ExceptionEvent',
    search: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      groupSearch: params.groupId ? [{ id: params.groupId }] : undefined,
    },
  });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
