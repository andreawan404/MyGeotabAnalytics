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

/** Resolve a diagnostic by NAME. Only a fallback — see
 * resolveCumulativeFuelDiagnosticId for why ids come first. First match wins;
 * null when the database has no such diagnostic (a normal, handleable case). */
export function findDiagnosticIdByName(diagnostics: DiagnosticDTO[], pattern: RegExp): string | null {
  return diagnostics.find((d) => pattern.test(d.name))?.id ?? null;
}

/** Name fallback. Matches both word orders and Indonesian, because Geotab
 * localizes diagnostic names ("Total fuel used" / "Bahan bakar terpakai"). */
const CUMULATIVE_FUEL_NAME = /(fuel|bahan\s*bakar).*(used|units|total|terpakai|digunakan)|(total|used|terpakai)\s.*(fuel|bahan\s*bakar)/i;

/**
 * The one place the cumulative "total fuel used" counter is resolved — used by
 * both the BBM view and the trip timeline tooltip so they can never disagree.
 *
 * ID FIRST. Diagnostic names are localized, so a name-only lookup returns null
 * on a non-English database even when the counter is right there — which is
 * exactly why fuel read as "not reported" while MyGeotab's own Fuel Usage
 * report showed litres for the same vehicles and dates.
 *
 * Returns null only when the database genuinely has no such diagnostic; the
 * caller still has to PROBE the returned id, since presence in the catalogue
 * does not mean this fleet's hardware actually reports it.
 */
export function resolveCumulativeFuelDiagnosticId(diagnostics: DiagnosticDTO[]): string | null {
  const byId = diagnostics.find((d) => d.id === WELL_KNOWN_DEVICE_TOTAL_FUEL_ID);
  if (byId) return byId.id;

  const byName = findDiagnosticIdByName(diagnostics, CUMULATIVE_FUEL_NAME);
  if (byName) return byName;

  // Neither worked: name the candidates we DID see, so the next round is not
  // another guess. Cheap, once per load, and only when something is wrong.
  const candidates = diagnostics.filter((d) => /fuel|bahan\s*bakar/i.test(d.name)).slice(0, 15);
  console.warn(
    'fuel: no cumulative "total fuel used" diagnostic resolved. Fuel-ish diagnostics present in this database:',
    candidates.map((d) => `${d.id} = ${d.name}`)
  );
  return null;
}

/** Kept local to avoid importing probe.ts (which imports status-data.ts) into
 * every consumer of this catalogue — it is the same string as
 * WELL_KNOWN_DIAGNOSTICS.deviceTotalFuel. */
const WELL_KNOWN_DEVICE_TOTAL_FUEL_ID = 'DiagnosticDeviceTotalFuelId';
