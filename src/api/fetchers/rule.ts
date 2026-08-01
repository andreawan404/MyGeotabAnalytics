import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { RuleDTO } from './types';

// Rules change rarely and the whole table is small — one call per session.
const TTL_MS = 30 * 60 * 1000;

/** Every Rule in the database. Needed because Get ExceptionEvent returns `rule`
 *  as a bare {id} with no name. */
export async function fetchRules(params: { database: string }): Promise<RuleDTO[]> {
  const key = buildCacheKey(params.database, 'rule');
  const cached = await getCached<RuleDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', { typeName: 'Rule' });
  const dtos: RuleDTO[] = raw.map((r) => ({ id: r.id, name: r.name ?? '' }));
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
