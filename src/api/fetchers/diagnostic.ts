import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DiagnosticDTO } from './types';

const TTL_MS = 24 * 60 * 60 * 1000; // diagnostics are a near-static catalogue
const RESULTS_LIMIT = 50000;

function toDTO(raw: any): DiagnosticDTO {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    unitOfMeasureId: raw.unitOfMeasure?.id,
  };
}

/** The id -> name/unit catalogue every StatusData/FaultData consumer needs to
 * make its numbers readable. No group filter: Diagnostic is not device-scoped. */
export async function fetchDiagnostics(params: { database: string }): Promise<DiagnosticDTO[]> {
  const key = buildCacheKey(params.database, 'diagnostic');
  const cached = await getCached<DiagnosticDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', { typeName: 'Diagnostic', resultsLimit: RESULTS_LIMIT });

  const dtos = raw.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}

/** Resolve a diagnostic by NAME rather than a hardcoded id — the ids for
 * anything outside Geotab's confirmed well-known set (see probe.ts) vary per
 * database, so "total fuel used" has to be found, not assumed. First match wins;
 * null when the database has no such diagnostic (a normal, handleable case). */
export function findDiagnosticIdByName(diagnostics: DiagnosticDTO[], pattern: RegExp): string | null {
  return diagnostics.find((d) => pattern.test(d.name))?.id ?? null;
}
