import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { RuleDTO, RuleThreshold } from './types';

// Rules change rarely and the whole table is small — one call per session.
const TTL_MS = 30 * 60 * 1000;

/**
 * Flattens a Rule's `condition` tree.
 *
 * Geotab documents `condition` as "the hierarchical tree of Condition(s)
 * defining the logic of a rule", where each node carries a `conditionType`
 * (operators like >, <, ==, AND, OR, NOT), an optional `diagnostic` — "the
 * Diagnostic to compare the value of" — and `value`, "the specified value to
 * evaluate against". That `value` IS the threshold shown in the UI.
 *
 * Only nodes with a numeric value are kept: the AND/OR plumbing carries no
 * threshold. The nearest diagnostic at or above the node is attached, because a
 * comparison and the diagnostic it compares are often separate nodes.
 */
function walkConditions(
  node: any,
  inheritedDiagnosticId: string | null,
  out: { thresholds: RuleThreshold[]; diagnosticIds: Set<string> }
): void {
  if (!node || typeof node !== 'object') return;

  const diagnosticId: string | null = node.diagnostic?.id ?? inheritedDiagnosticId;
  if (node.diagnostic?.id) out.diagnosticIds.add(node.diagnostic.id);

  const value = typeof node.value === 'number' ? node.value : Number(node.value);
  if (Number.isFinite(value) && node.value !== null && node.value !== undefined && node.value !== '') {
    out.thresholds.push({ diagnosticId, conditionType: node.conditionType ?? '', value });
  }

  for (const child of Array.isArray(node.children) ? node.children : []) {
    walkConditions(child, diagnosticId, out);
  }
}

function toDTO(raw: any): RuleDTO {
  const acc = { thresholds: [] as RuleThreshold[], diagnosticIds: new Set<string>() };
  walkConditions(raw.condition, null, acc);
  return {
    id: raw.id,
    name: raw.name ?? '',
    baseType: raw.baseType ?? null,
    diagnosticIds: [...acc.diagnosticIds],
    thresholds: acc.thresholds,
  };
}

/** Every Rule in the database. Needed because Get ExceptionEvent returns `rule`
 *  as a bare {id} with no name — and because the condition tree is the only
 *  place the firing threshold is recorded. */
export async function fetchRules(params: { database: string }): Promise<RuleDTO[]> {
  const key = buildCacheKey(params.database, 'rule');
  const cached = await getCached<RuleDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', { typeName: 'Rule' });
  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
