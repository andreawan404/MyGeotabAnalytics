import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { ExceptionEventDTO } from './types';
import { parseDurationSec } from './parseDuration';
import { deriveSeverity } from './rule-severity';
import { fetchRules } from './rule';
import { groupDeviceSearch, restrictToGroup } from './search';

const TTL_MS = 5 * 60 * 1000;
const RESULTS_LIMIT = 50000;

// One warning per unknown rule id, not per event — a single unmapped rule can
// account for thousands of rows. These warnings are the seed list for
// SEVERITY_BY_RULE_ID in rule-severity.ts: real ids beat guessed ones.
const warnedRuleIds = new Set<string>();

// Get ExceptionEvent returns `rule` as a bare {id} — the name only exists on the
// Rule entity, hence the join.
function toDTO(raw: any, ruleNameById: Map<string, string>): ExceptionEventDTO {
  const ruleId = raw.rule?.id ?? '';
  const ruleName = ruleNameById.get(ruleId) ?? '';
  const severity = deriveSeverity(ruleId, ruleName);

  if (severity === 'low' && !warnedRuleIds.has(ruleId)) {
    warnedRuleIds.add(ruleId);
    console.warn('unmapped ruleId', ruleId, ruleName);
  }

  return {
    id: raw.id,
    deviceId: raw.device?.id ?? '',
    ruleId,
    ruleName,
    severity,
    start: raw.activeFrom,
    stop: raw.activeTo ?? null,
    durationSec: parseDurationSec(raw.duration),
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

  // 30-min cached, so this costs one extra call per session at most.
  const [raw, rules] = await Promise.all([
    callApi<any[]>('Get', {
      typeName: 'ExceptionEvent',
      search: {
        fromDate: params.fromDate,
        toDate: params.toDate,
        ...groupDeviceSearch(params.groupId),
      },
      resultsLimit: RESULTS_LIMIT,
    }),
    fetchRules({ database: params.database }),
  ]);

  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
  // Keanggotaan grup ditegakkan di klien: search-nya diabaikan server (search.ts).
  const scoped = await restrictToGroup(raw, params.database, params.groupId);
  const dtos = scoped.map((r) => toDTO(r, ruleNameById));
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
