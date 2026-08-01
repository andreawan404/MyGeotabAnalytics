import assert from 'node:assert';
import { initGeotabClient, type GeotabApi } from '../geotabClient';
import { fetchTrips } from './trip';
import { fetchExceptionEvents } from './exception-event';
import { fetchLogRecords } from './logrecord';
import { fetchFaultData } from './fault-data';
import { fetchStatusData, fetchStatusDataMulti } from './status-data';
import { probeDiagnostics } from './probe';
import { fetchDrivers } from './driver';
import { fetchFuelTransactions } from './fuel-transaction';
import { fetchDvirDefects } from './dvir-log';
import { fetchDiagnostics, findDiagnosticIdByName } from './diagnostic';

// Captures the last `search`/`resultsLimit` params seen by the mock `call`,
// so the resultsLimit-cap assertion can inspect the actual outgoing request.
let lastParams: any = null;
// Counts round trips, so "N diagnostics cost ONE multiCall" is asserted rather
// than assumed — the whole point of fetchStatusDataMulti.
let multiCallCount = 0;

// Mirrors dev/mock-api.ts: search is ignored EXCEPT StatusData's diagnosticSearch,
// without which every diagnostic would look present and probing would prove nothing.
function resolveFixture(byTypeName: Record<string, any[]>, params: any): any[] {
  const rows = byTypeName[params.typeName] ?? [];
  const diagnosticId = params?.search?.diagnosticSearch?.id;
  if (params.typeName === 'StatusData' && diagnosticId) {
    return rows.filter((r) => r.diagnostic?.id === diagnosticId);
  }
  return rows;
}

function mockApi(byTypeName: Record<string, any[]>): GeotabApi {
  return {
    call: (_method, params: any, cb) => {
      lastParams = params;
      cb(resolveFixture(byTypeName, params));
    },
    multiCall: (calls, cb) => {
      multiCallCount++;
      cb(calls.map(([, params]) => resolveFixture(byTypeName, params as any)));
    },
  };
}

/** Rejects everything — for the optional-entity degradation paths. */
function failingApi(): GeotabApi {
  return {
    call: (_method, _params, _cb, errCb) => errCb?.({ name: 'InvalidUserException', message: 'no rights' }),
    multiCall: (_calls, _cb, errCb) => errCb?.({ name: 'InvalidUserException', message: 'no rights' }),
  };
}

async function run() {
  // fetchTrips: raw -> DTO mapping. Durations arrive as .NET TimeSpan strings,
  // which is what MyGeotab actually sends (NOT ISO-8601).
  initGeotabClient(
    mockApi({
      Trip: [
        {
          id: 't1',
          device: { id: 'd1' },
          start: '2026-07-01T08:00:00.000Z',
          stop: '2026-07-01T08:30:00.000Z',
          distance: 12.5,
          drivingDuration: '01:02:03',
          idlingDuration: '00:05:00',
          startLatitude: 1.1,
          startLongitude: 2.2,
          stopLatitude: 3.3,
          stopLongitude: 4.4,
          driver: { id: 'driver-7' },
        },
        {
          // Geotab's sentinel for an unidentified driver — must normalise to
          // undefined, otherwise the safety module counts "UnknownDriverId" as
          // a real person and its attribution gate reads 100%.
          id: 't2',
          device: { id: 'd1' },
          start: '2026-07-01T09:00:00.000Z',
          stop: '2026-07-01T09:20:00.000Z',
          distance: 4,
          drivingDuration: '00:20:00',
          idlingDuration: '00:00:00',
          startLatitude: 1,
          startLongitude: 2,
          stopLatitude: 3,
          stopLongitude: 4,
          driver: { id: 'UnknownDriverId' },
        },
      ],
    })
  );

  const trips = await fetchTrips({ database: 'checkdb1', fromDate: '2026-07-01', toDate: '2026-07-02' });
  assert.strictEqual(trips.length, 2);
  assert.deepStrictEqual(trips[0], {
    id: 't1',
    deviceId: 'd1',
    start: '2026-07-01T08:00:00.000Z',
    stop: '2026-07-01T08:30:00.000Z',
    distanceKm: 12.5,
    drivingDurationSec: 3723,
    idlingDurationSec: 300,
    startLat: 1.1,
    startLon: 2.2,
    stopLat: 3.3,
    stopLon: 4.4,
    driverId: 'driver-7',
  });
  assert.strictEqual(trips[1].driverId, undefined, 'UnknownDriverId must normalise to undefined');

  // fetchExceptionEvents: `rule` arrives as a bare {id} with NO name, so the
  // name must be joined in from Get Rule and severity keyed off the rule id.
  initGeotabClient(
    mockApi({
      Rule: [
        { id: 'RuleHarshBrakingId', name: 'Pengereman Mendadak' },
        { id: 'RuleIdlingId', name: 'Mesin Menyala Terlalu Lama' },
        { id: 'z9Z9', name: 'Perawatan Terjadwal' },
      ],
      ExceptionEvent: [
        {
          id: 'e1',
          device: { id: 'd1' },
          rule: { id: 'RuleHarshBrakingId' },
          activeFrom: '2026-07-01T08:00:00.000Z',
          activeTo: '2026-07-01T08:00:10.000Z',
          duration: '00:00:10',
        },
        {
          id: 'e2',
          device: { id: 'd1' },
          rule: { id: 'RuleIdlingId' },
          activeFrom: '2026-07-01T09:00:00.000Z',
          activeTo: null,
          duration: '00:00:00',
        },
        {
          id: 'e3',
          device: { id: 'd1' },
          rule: { id: 'z9Z9' },
          activeFrom: '2026-07-01T10:00:00.000Z',
          activeTo: '2026-07-01T10:01:00.000Z',
          duration: '00:01:00',
        },
      ],
    })
  );

  const events = await fetchExceptionEvents({ database: 'checkdb2', fromDate: '2026-07-01', toDate: '2026-07-02' });
  assert.strictEqual(events.find((e) => e.id === 'e1')?.severity, 'high', 'harsh braking rule id -> high');
  assert.strictEqual(events.find((e) => e.id === 'e2')?.severity, 'medium', 'idling rule id -> medium');
  assert.strictEqual(events.find((e) => e.id === 'e3')?.severity, 'low', 'unmatched rule -> low');
  assert.strictEqual(
    events.find((e) => e.id === 'e1')?.ruleName,
    'Pengereman Mendadak',
    'rule name must be joined in from Get Rule'
  );
  assert.strictEqual(events.find((e) => e.id === 'e2')?.stop, null, 'missing activeTo -> null');
  assert.strictEqual(events.find((e) => e.id === 'e3')?.durationSec, 60);

  // fetchLogRecords: missing date range must reject (no unbounded fetch, ever).
  await assert.rejects(
    () => fetchLogRecords({ database: 'checkdb3', fromDate: '', toDate: '' }),
    'missing fromDate/toDate must reject before any API call'
  );

  // fetchLogRecords: resultsLimit is hard-capped at 5000 regardless of caller input.
  initGeotabClient(mockApi({ LogRecord: [] }));
  await fetchLogRecords({ database: 'checkdb4', fromDate: '2026-07-01', toDate: '2026-07-02', resultsLimit: 999999 });
  assert.ok(lastParams.resultsLimit <= 5000, `resultsLimit must be capped at 5000, got ${lastParams.resultsLimit}`);
  assert.strictEqual(lastParams.resultsLimit, 5000);

  // fetchFaultData: nested refs flattened, and severity coalesced across the
  // three keys different database versions use.
  initGeotabClient(
    mockApi({
      FaultData: [
        {
          id: 'f1',
          device: { id: 'd1' },
          diagnostic: { id: 'DiagnosticEngineCoolantTemperatureId' },
          dateTime: '2026-07-01T08:00:00.000Z',
          faultState: 'Active',
          severity: 'Critical',
          count: 3,
          dismissDateTime: null,
          failureMode: { id: 'fm-1' },
          faultLampState: 'RedStopLamp',
          riskOfBreakdown: 0.8,
          controller: { name: 'Engine #1' },
        },
        { id: 'f2', device: { id: 'd2' }, diagnostic: { id: 'x' }, dateTime: '2026-07-01T09:00:00.000Z', faultState: 'Pending', faultSeverity: 'Warning' },
        { id: 'f3', device: { id: 'd3' }, diagnostic: { id: 'x' }, dateTime: '2026-07-01T10:00:00.000Z', faultState: 'Inactive', diagnosticSeverity: 'Informational' },
        { id: 'f4', device: { id: 'd4' }, diagnostic: { id: 'x' }, dateTime: '2026-07-01T11:00:00.000Z' },
      ],
    })
  );

  const faults = await fetchFaultData({ database: 'checkdb5', fromDate: '2026-07-01', toDate: '2026-07-02' });
  assert.deepStrictEqual(faults[0], {
    id: 'f1',
    deviceId: 'd1',
    diagnosticId: 'DiagnosticEngineCoolantTemperatureId',
    dateTime: '2026-07-01T08:00:00.000Z',
    faultState: 'Active',
    severity: 'Critical',
    count: 3,
    dismissDateTime: null,
    failureModeId: 'fm-1',
    faultLampState: 'RedStopLamp',
    riskOfBreakdown: 0.8,
    controllerName: 'Engine #1',
  });
  assert.strictEqual(faults[1].severity, 'Warning', 'faultSeverity is the fallback');
  assert.strictEqual(faults[2].severity, 'Informational', 'diagnosticSeverity is the last fallback');
  assert.strictEqual(faults[3].severity, 'Unknown', 'no severity key at all -> Unknown, never undefined');
  assert.strictEqual(faults[3].faultState, 'None', 'missing faultState -> None');
  assert.strictEqual(faults[3].failureModeId, null);
  assert.strictEqual(faults[3].controllerName, null);

  // fetchStatusData / fetchStatusDataMulti: value comes off raw `data`, and N
  // diagnostics must cost exactly ONE round trip (never a callApi per diagnostic).
  const statusFixtures = {
    StatusData: [
      { device: { id: 'd1' }, diagnostic: { id: 'DiagnosticOdometerAdjustmentId' }, dateTime: '2026-07-01T08:00:00.000Z', data: 1000 },
      { device: { id: 'd1' }, diagnostic: { id: 'DiagnosticOdometerAdjustmentId' }, dateTime: '2026-07-01T14:00:00.000Z', data: 1041 },
      { device: { id: 'd1' }, diagnostic: { id: 'DiagnosticEngineHoursId' }, dateTime: '2026-07-01T08:00:00.000Z', data: 500.5 },
    ],
  };

  initGeotabClient(mockApi(statusFixtures));
  const single = await fetchStatusData({
    database: 'checkdb6',
    diagnosticId: 'DiagnosticEngineHoursId',
    fromDate: '2026-07-01',
    toDate: '2026-07-02',
  });
  assert.deepStrictEqual(single, [
    { deviceId: 'd1', diagnosticId: 'DiagnosticEngineHoursId', dateTime: '2026-07-01T08:00:00.000Z', value: 500.5 },
  ]);

  multiCallCount = 0;
  const byId = await fetchStatusDataMulti({
    database: 'checkdb7',
    diagnosticIds: ['DiagnosticOdometerAdjustmentId', 'DiagnosticEngineHoursId', 'DiagnosticFuelLevelId'],
    fromDate: '2026-07-01',
    toDate: '2026-07-02',
  });
  assert.strictEqual(multiCallCount, 1, '3 diagnostics must cost exactly ONE multiCall');
  assert.strictEqual(byId['DiagnosticOdometerAdjustmentId'].length, 2);
  assert.strictEqual(byId['DiagnosticOdometerAdjustmentId'][1].value, 1041, 'value is read off raw `data`');
  assert.deepStrictEqual(byId['DiagnosticFuelLevelId'], [], 'a diagnostic with no rows still gets a key');

  await fetchStatusDataMulti({
    database: 'checkdb7',
    diagnosticIds: ['DiagnosticOdometerAdjustmentId', 'DiagnosticEngineHoursId', 'DiagnosticFuelLevelId'],
    fromDate: '2026-07-01',
    toDate: '2026-07-02',
  });
  assert.strictEqual(multiCallCount, 1, 'a fully cached repeat must not hit the wire at all');

  // probeDiagnostics: availability is per database, so a diagnostic that reports
  // nothing must come back false — one multiCall for the whole probe.
  multiCallCount = 0;
  const available = await probeDiagnostics({
    database: 'checkdb8',
    diagnosticIds: ['DiagnosticEngineHoursId', 'DiagnosticOdometerId'],
    toIso: '2026-07-02T00:00:00.000Z',
  });
  assert.strictEqual(multiCallCount, 1, 'the whole probe is ONE multiCall');
  assert.deepStrictEqual(available, { DiagnosticEngineHoursId: true, DiagnosticOdometerId: false });

  // fetchDrivers: User has no person-name field — firstName+lastName, falling
  // back to the login. And the isDriver filter must actually be sent.
  initGeotabClient(
    mockApi({
      User: [
        { id: 'u1', name: 'budi@jpt.co.id', firstName: 'Budi', lastName: 'Santoso', phoneNumber: '+62812' },
        { id: 'u2', name: 'agus@jpt.co.id', firstName: 'Agus', lastName: 'Wijaya' },
        { id: 'u3', name: 'driver05@jpt.co.id', firstName: '', lastName: '' },
      ],
    })
  );
  const drivers = await fetchDrivers({ database: 'checkdb9' });
  assert.deepStrictEqual(drivers[0], { id: 'u1', name: 'Budi Santoso', phone: '+62812' });
  assert.strictEqual(drivers[1].phone, null, 'missing phoneNumber -> null, not undefined');
  assert.strictEqual(drivers[2].name, 'driver05@jpt.co.id', 'blank names fall back to the login');
  assert.strictEqual(lastParams.search.isDriver, true, 'isDriver filter must be sent');

  // Optional entities: a rejection must degrade to [] instead of taking the
  // whole module down. Required fetchers must still propagate.
  initGeotabClient(failingApi());
  const range = { database: 'checkdb10', fromDate: '2026-07-01', toDate: '2026-07-02' };
  assert.deepStrictEqual(await fetchFuelTransactions(range), [], 'unavailable FuelTransaction -> []');
  assert.deepStrictEqual(await fetchDvirDefects(range), [], 'unavailable DVIRLog -> []');
  await assert.rejects(() => fetchFaultData(range), 'a REQUIRED entity must still propagate its error');

  // fetchDvirDefects: one log with many defects flattens to one row per defect.
  initGeotabClient(
    mockApi({
      DVIRLog: [
        {
          id: 'dvir-1',
          device: { id: 'd1' },
          dateTime: '2026-07-01T08:00:00.000Z',
          defects: [
            { id: 'dd-1', defect: { id: 'def-brakes', name: 'Brakes', severity: 'Critical' }, repairStatus: 'NotRepaired' },
            { defect: { id: 'def-lights', name: 'Lights' }, repairStatus: null },
          ],
        },
        { id: 'dvir-2', device: { id: 'd2' }, dateTime: '2026-07-01T09:00:00.000Z', defects: [] },
      ],
    })
  );
  const defects = await fetchDvirDefects({ database: 'checkdb11', fromDate: '2026-07-01', toDate: '2026-07-02' });
  assert.strictEqual(defects.length, 2, 'a clean inspection contributes no rows');
  assert.deepStrictEqual(defects[0], {
    id: 'dd-1',
    deviceId: 'd1',
    dateTime: '2026-07-01T08:00:00.000Z',
    defectName: 'Brakes',
    severity: 'Critical',
    repairStatus: 'NotRepaired',
  });
  assert.strictEqual(defects[1].id, 'dvir-1:1', 'defect without its own id gets a synthesized one');
  assert.strictEqual(defects[1].severity, null);

  // findDiagnosticIdByName: the fuel module resolves "total fuel used" by name
  // because its id is database-specific (no confirmed well-known id).
  initGeotabClient(
    mockApi({
      Diagnostic: [
        { id: 'DiagnosticOdometerId', name: 'Odometer', unitOfMeasure: { id: 'UnitOfMeasureKilometersId' } },
        { id: 'a7B8', name: 'Total Fuel Used', unitOfMeasure: { id: 'UnitOfMeasureLitersId' } },
      ],
    })
  );
  const diagnostics = await fetchDiagnostics({ database: 'checkdb12' });
  assert.strictEqual(diagnostics[0].unitOfMeasureId, 'UnitOfMeasureKilometersId', 'unit is a nested {id} ref');
  assert.strictEqual(findDiagnosticIdByName(diagnostics, /total fuel used/i), 'a7B8');
  assert.strictEqual(findDiagnosticIdByName(diagnostics, /nonexistent/i), null, 'no match -> null, not undefined');

  console.log('fetchers.check.ts: PASS');
}

run().catch((err) => {
  console.error('fetchers.check.ts: FAIL', err);
  process.exit(1);
});
