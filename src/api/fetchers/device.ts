import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DeviceLite } from './types';

const TTL_MS = 30 * 60 * 1000;

/**
 * Devices active at any point in the range. Without a date filter, Get Device
 * also returns historical/decommissioned units — which inflated the fleet
 * utilization DENOMINATOR (by up to ~3x on a long-lived database) and dragged
 * the headline percentage towards zero.
 *
 * The dates are sent in the search AND applied client-side: `search.groups` is
 * the documented DeviceSearch property, but the date behaviour is not, and
 * MyGeotab silently ignores search properties it does not recognise. Belt and
 * braces — decommissioned devices carry a past activeTo, live ones default to
 * 2050-01-01.
 */
export async function fetchDevices(params: {
  database: string;
  groupId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<DeviceLite[]> {
  const key = buildCacheKey(params.database, 'device', params.groupId ?? '', params.fromDate ?? '', params.toDate ?? '');
  const cached = await getCached<DeviceLite[]>(key);
  if (cached) return cached;

  // For Device the group filter is a top-level DeviceSearch property — NOT
  // nested under deviceSearch the way Trip/ExceptionEvent/LogRecord need it.
  const search = {
    ...(params.groupId ? { groups: [{ id: params.groupId }] } : {}),
    ...(params.fromDate ? { fromDate: params.fromDate } : {}),
    ...(params.toDate ? { toDate: params.toDate } : {}),
  };

  const raw = await callApi<any[]>('Get', {
    typeName: 'Device',
    search: Object.keys(search).length ? search : undefined,
  });

  const dtos: DeviceLite[] = raw
    .filter((d) => overlapsRange(d, params.fromDate, params.toDate))
    .map((d) => ({ id: d.id, name: d.name, activeFrom: d.activeFrom, activeTo: d.activeTo }));

  await setCached(key, dtos, TTL_MS);
  return dtos;
}

function overlapsRange(raw: any, fromIso?: string, toIso?: string): boolean {
  if (!fromIso || !toIso) return true;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const activeFrom = Date.parse(raw.activeFrom ?? '');
  const activeTo = Date.parse(raw.activeTo ?? '');
  // Unparseable/absent dates mean "no information" — keep the device rather than
  // silently shrinking the fleet.
  if (!Number.isNaN(activeTo) && activeTo <= from) return false;
  if (!Number.isNaN(activeFrom) && activeFrom >= to) return false;
  return true;
}
