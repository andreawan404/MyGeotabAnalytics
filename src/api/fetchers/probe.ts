import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import { fetchStatusDataMulti } from './status-data';
import { groupKey } from './search';

const TTL_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000; // 2 days: long enough that a parked vehicle still reports

/** Confirmed Geotab system ids.
 *
 * `deviceTotalFuel` is "Total fuel used (since telematics device install)" — the
 * counter MyGeotab's own Fuel Usage report is built on. It is written at every
 * ignition-off regardless of how the vehicle reports (OBD2 / J1708 / J1939),
 * which makes it the one fuel source worth trying first.
 *
 * Ids are used in preference to names because diagnostic names are LOCALIZED:
 * on an Indonesian database "Total fuel used" comes back as something else
 * entirely, and a name-only lookup silently finds nothing. This is the same
 * mistake that made every exception bucket as "low" (see rule-severity.ts).
 * DiagnosticFuelUnitsId stays out — it is a guess, never confirmed. */
export const WELL_KNOWN_DIAGNOSTICS = {
  odometer: 'DiagnosticOdometerId',
  odometerAdjustment: 'DiagnosticOdometerAdjustmentId',
  engineHours: 'DiagnosticEngineHoursId',
  fuelLevel: 'DiagnosticFuelLevelId',
  deviceTotalFuel: 'DiagnosticDeviceTotalFuelId',
} as const;

/** Which of these diagnostics does this database/group actually report?
 * Availability varies per vehicle and per OEM, so Fleet Health, Predictive
 * Maintenance and Fuel must all probe — and must all share THIS probe rather
 * than each firing its own. One multiCall (via fetchStatusDataMulti), cached 24h. */
export async function probeDiagnostics(params: {
  database: string;
  diagnosticIds: string[];
  toIso: string;
  groupIds?: string[];
}): Promise<Record<string, boolean>> {
  const ids = [...params.diagnosticIds].sort(); // sorted so caller ordering doesn't fragment the cache
  const key = buildCacheKey(params.database, 'diag-probe', ids.join(','), groupKey(params.groupIds));
  const cached = await getCached<Record<string, boolean>>(key);
  if (cached) return cached;

  const fromIso = new Date(new Date(params.toIso).getTime() - LOOKBACK_MS).toISOString();
  const byId = await fetchStatusDataMulti({
    database: params.database,
    diagnosticIds: ids,
    fromDate: fromIso,
    toDate: params.toIso,
    groupIds: params.groupIds,
    resultsLimit: 1, // presence only — never pull rows we're going to throw away
  });

  const available: Record<string, boolean> = {};
  for (const id of ids) available[id] = (byId[id]?.length ?? 0) > 0;

  await setCached(key, available, TTL_MS);
  return available;
}
