import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import { fetchStatusDataMulti } from './status-data';

const TTL_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000; // 2 days: long enough that a parked vehicle still reports

/** Confirmed Geotab system ids. DiagnosticFuelUnitsId is deliberately absent —
 * it is NOT confirmed; resolve "total fuel used" by name with
 * findDiagnosticIdByName (diagnostic.ts) instead of hardcoding a guess. */
export const WELL_KNOWN_DIAGNOSTICS = {
  odometer: 'DiagnosticOdometerId',
  odometerAdjustment: 'DiagnosticOdometerAdjustmentId',
  engineHours: 'DiagnosticEngineHoursId',
  fuelLevel: 'DiagnosticFuelLevelId',
} as const;

/** Which of these diagnostics does this database/group actually report?
 * Availability varies per vehicle and per OEM, so Fleet Health, Predictive
 * Maintenance and Fuel must all probe — and must all share THIS probe rather
 * than each firing its own. One multiCall (via fetchStatusDataMulti), cached 24h. */
export async function probeDiagnostics(params: {
  database: string;
  diagnosticIds: string[];
  toIso: string;
  groupId?: string;
}): Promise<Record<string, boolean>> {
  const ids = [...params.diagnosticIds].sort(); // sorted so caller ordering doesn't fragment the cache
  const key = buildCacheKey(params.database, 'diag-probe', ids.join(','), params.groupId ?? '');
  const cached = await getCached<Record<string, boolean>>(key);
  if (cached) return cached;

  const fromIso = new Date(new Date(params.toIso).getTime() - LOOKBACK_MS).toISOString();
  const byId = await fetchStatusDataMulti({
    database: params.database,
    diagnosticIds: ids,
    fromDate: fromIso,
    toDate: params.toIso,
    groupId: params.groupId,
    resultsLimit: 1, // presence only — never pull rows we're going to throw away
  });

  const available: Record<string, boolean> = {};
  for (const id of ids) available[id] = (byId[id]?.length ?? 0) > 0;

  await setCached(key, available, TTL_MS);
  return available;
}
