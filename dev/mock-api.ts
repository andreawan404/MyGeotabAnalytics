// Dev-only fake GeotabApi so `npm run dev` renders the real dashboard against
// fixture data in a plain browser tab (no real MyGeotab database available in
// this dev environment). Sits at the api boundary: everything downstream
// (initGeotabClient -> callApi/multiCall -> fetchers -> normalize -> components)
// runs unmodified, exactly as it would against a real database.

import type { GeotabApi } from '../src/api/geotabClient';
import { rawTrips, rawLogRecords, rawDeviceStatusInfo, rawExceptionEvents, rawZones, rawDevices, rawGroups } from './fixtures';

const FIXTURES_BY_TYPE_NAME: Record<string, any[]> = {
  Trip: rawTrips,
  LogRecord: rawLogRecords,
  DeviceStatusInfo: rawDeviceStatusInfo,
  ExceptionEvent: rawExceptionEvents,
  Zone: rawZones,
  Device: rawDevices,
  Group: rawGroups,
};

// ponytail: params.search is ignored entirely — dev mode always returns the
// full fixture set for the requested typeName regardless of date-range/group/
// zone filters. Fine for visual/structural testing; filter-logic correctness
// is already covered by src/api/fetchers/fetchers.check.ts. Add real filtering
// here if a scenario needs to see fewer results, not more coverage.
function resolve(method: string, params: any): any[] {
  if (method !== 'Get') return [];
  const typeName = params?.typeName as string | undefined;
  return (typeName && FIXTURES_BY_TYPE_NAME[typeName]) || [];
}

const LATENCY_MS = 50;

export function createMockApi(): GeotabApi {
  return {
    call(method, params, cb) {
      setTimeout(() => cb(resolve(method, params)), LATENCY_MS);
    },
    multiCall(calls, cb) {
      setTimeout(() => cb(calls.map(([method, params]) => resolve(method, params))), LATENCY_MS);
    },
  };
}

export const mockState = { database: 'dev-demo' };
