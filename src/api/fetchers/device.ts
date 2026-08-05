import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import type { DeviceLite } from './types';
import { normalizeGroupIds } from './search';

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
  groupIds?: string[];
  fromDate?: string;
  toDate?: string;
}): Promise<DeviceLite[]> {
  const groups = normalizeGroupIds(params.groupIds);

  // Beberapa grup: ambil per grup lalu GABUNGKAN. Sengaja lewat pemanggilan
  // satu-grup, bukan satu permintaan berisi semua grup, karena dengan begitu
  // tiap grup memakai entri cache-nya sendiri — menambah atau membuang satu
  // grup dari pilihan hanya membebani grup yang berubah, bukan seluruhnya.
  //
  // Penggabungan dilakukan di klien karena keanggotaan grup di MyGeotab
  // berbentuk pohon, dan server yang menyelesaikan pohonnya untuk SATU grup.
  if (groups.length > 1) {
    const lists = await Promise.all(
      groups.map((id) => fetchDevices({ ...params, groupIds: [id] }))
    );
    const byId = new Map<string, DeviceLite>();
    for (const list of lists) for (const d of list) byId.set(d.id, d);
    return [...byId.values()];
  }

  const groupId = groups[0];
  const key = buildCacheKey(params.database, 'device', groupId ?? '', params.fromDate ?? '', params.toDate ?? '');
  const cached = await getCached<DeviceLite[]>(key);
  if (cached) return cached;

  // For Device the group filter is a top-level DeviceSearch property — NOT
  // nested under deviceSearch the way Trip/ExceptionEvent/LogRecord need it.
  const search = {
    ...(groupId ? { groups: [{ id: groupId }] } : {}),
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
