// Dev-only fake GeotabApi so `npm run dev` renders the real dashboard against
// fixture data in a plain browser tab (no real MyGeotab database available in
// this dev environment). Sits at the api boundary: everything downstream
// (initGeotabClient -> callApi/multiCall -> fetchers -> normalize -> components)
// runs unmodified, exactly as it would against a real database.

import type { GeotabApi } from '../src/api/geotabClient';
import {
  rawTrips,
  rawLogRecords,
  rawDeviceStatusInfo,
  rawExceptionEvents,
  rawZones,
  rawDevices,
  rawGroups,
  rawRules,
  rawDiagnostics,
  rawStatusData,
  rawFaultData,
  rawFuelTransactions,
  rawDrivers,
  rawDvirLogs,
  rawMediaFiles,
} from './fixtures';

const FIXTURES_BY_TYPE_NAME: Record<string, any[]> = {
  Trip: rawTrips,
  LogRecord: rawLogRecords,
  DeviceStatusInfo: rawDeviceStatusInfo,
  ExceptionEvent: rawExceptionEvents,
  Zone: rawZones,
  Device: rawDevices,
  Group: rawGroups,
  Rule: rawRules,
  Diagnostic: rawDiagnostics,
  StatusData: rawStatusData,
  FaultData: rawFaultData,
  FuelTransaction: rawFuelTransactions,
  User: rawDrivers,
  DVIRLog: rawDvirLogs,
  MediaFile: rawMediaFiles,
};

// ponytail: params.search is ignored — dev mode returns the full fixture set for
// the requested typeName regardless of date-range/group/zone filters. Fine for
// visual/structural testing; filter-logic correctness is covered by
// src/api/fetchers/fetchers.check.ts. Add real filtering here only if a scenario
// needs to see fewer results.
//
// The ONE exception is StatusData's diagnosticSearch. StatusData is always queried
// per-diagnostic, and probeDiagnostics() decides a diagnostic is "available" by
// asking whether its result array is non-empty. Ignoring the filter would return
// every diagnostic's rows for every probe, so everything would look available and
// the auto-detection would be silently meaningless in dev.
function resolve(method: string, params: any): any[] {
  if (method !== 'Get') return [];
  const typeName = params?.typeName as string | undefined;
  const rows = (typeName && FIXTURES_BY_TYPE_NAME[typeName]) || [];

  // Device menghormati search.groups, seperti MyGeotab sungguhan. Trip dan
  // kawan-kawan SENGAJA tetap mengabaikan deviceSearch.groups — itu perilaku
  // server yang membuat memilih satu grup tetap memunculkan seluruh armada,
  // dan mock yang tidak menirunya membuat bug itu mustahil ditangkap di sini.
  const groupId = params?.search?.groups?.[0]?.id;
  if (typeName === 'Device' && groupId) {
    return rows.filter((r) => (r.groups ?? []).some((g: any) => g.id === groupId));
  }

  const diagnosticId = params?.search?.diagnosticSearch?.id;
  if (typeName === 'StatusData' && diagnosticId) {
    const matched = rows.filter((r) => r.diagnostic?.id === diagnosticId);
    return params.resultsLimit ? matched.slice(0, params.resultsLimit) : matched;
  }
  return rows;
}

const LATENCY_MS = 50;

// Simulasi keadaan MediaFile, disetel dari konsol atau skrip uji:
//   window.__FA_MEDIA_MODE__ = 'denied' | 'empty'
//
// Ada karena panel diagnostik rekaman punya TIGA vonis berbeda (ditolak /
// database kosong / rentangnya saja yang kosong), dan tanpa cara memicunya di
// dev, dua di antaranya hanya bisa "diyakini benar dari kode" — persis jenis
// keyakinan yang membuat bug filter grup lolos berbulan-bulan.
declare global {
  interface Window {
    __FA_MEDIA_MODE__?: 'denied' | 'empty' | 'outofrange';
  }
}

function mediaMode(): 'denied' | 'empty' | 'outofrange' | undefined {
  return typeof window === 'undefined' ? undefined : window.__FA_MEDIA_MODE__;
}

export function createMockApi(): GeotabApi {
  return {
    call(method, params, cb, errCb) {
      const mode = mediaMode();
      if ((params as any)?.typeName === 'MediaFile' && mode) {
        if (mode === 'denied') {
          setTimeout(() => errCb?.({ name: 'InvalidUserException', message: 'no rights to MediaFile' }), LATENCY_MS);
          return;
        }
        if (mode === 'outofrange') {
          // Ada isinya HANYA saat ditanya tanpa search (probe akses); permintaan
          // yang membawa rentang tanggal mengembalikan kosong.
          const hasSearch = !!(params as any)?.search;
          setTimeout(() => cb(hasSearch ? [] : rawMediaFiles.slice(0, 3)), LATENCY_MS);
          return;
        }
        setTimeout(() => cb([]), LATENCY_MS); // 'empty'
        return;
      }
      setTimeout(() => cb(resolve(method, params)), LATENCY_MS);
    },
    multiCall(calls, cb) {
      setTimeout(() => cb(calls.map(([method, params]) => resolve(method, params))), LATENCY_MS);
    },
  };
}

export const mockState = { database: 'dev-demo' };
