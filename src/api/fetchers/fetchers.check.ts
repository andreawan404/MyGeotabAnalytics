import assert from 'node:assert';
import { initGeotabClient, type GeotabApi } from '../geotabClient';
import { fetchTrips } from './trip';
import { fetchExceptionEvents } from './exception-event';
import { fetchLogRecords } from './logrecord';

// Captures the last `search`/`resultsLimit` params seen by the mock `call`,
// so the resultsLimit-cap assertion can inspect the actual outgoing request.
let lastParams: any = null;

function mockApi(byTypeName: Record<string, any[]>): GeotabApi {
  return {
    call: (_method, params: any, cb) => {
      lastParams = params;
      cb(byTypeName[params.typeName] ?? []);
    },
    multiCall: (_calls, cb) => cb([]),
  };
}

async function run() {
  // fetchTrips: raw -> DTO mapping, including ISO8601 duration parsing.
  initGeotabClient(
    mockApi({
      Trip: [
        {
          id: 't1',
          device: { id: 'd1' },
          start: '2026-07-01T08:00:00.000Z',
          stop: '2026-07-01T08:30:00.000Z',
          distance: 12.5,
          drivingDuration: 'PT1H2M3S',
          idlingDuration: 'PT5M',
          startLatitude: 1.1,
          startLongitude: 2.2,
          stopLatitude: 3.3,
          stopLongitude: 4.4,
        },
      ],
    })
  );

  const trips = await fetchTrips({ database: 'checkdb1', fromDate: '2026-07-01', toDate: '2026-07-02' });
  assert.strictEqual(trips.length, 1);
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
  });

  // fetchExceptionEvents: severity heuristic — high/medium/low keyword buckets.
  initGeotabClient(
    mockApi({
      ExceptionEvent: [
        {
          id: 'e1',
          device: { id: 'd1' },
          rule: { id: 'r1', name: 'Harsh Braking' },
          activeFrom: '2026-07-01T08:00:00.000Z',
          activeTo: '2026-07-01T08:00:10.000Z',
          duration: 'PT10S',
        },
        {
          id: 'e2',
          device: { id: 'd1' },
          rule: { id: 'r2', name: 'Excessive Idling' },
          activeFrom: '2026-07-01T09:00:00.000Z',
          activeTo: null,
          duration: 'PT0S',
        },
        {
          id: 'e3',
          device: { id: 'd1' },
          rule: { id: 'r3', name: 'Custom Rule' },
          activeFrom: '2026-07-01T10:00:00.000Z',
          activeTo: '2026-07-01T10:01:00.000Z',
          duration: 'PT1M',
        },
      ],
    })
  );

  const events = await fetchExceptionEvents({ database: 'checkdb2', fromDate: '2026-07-01', toDate: '2026-07-02' });
  assert.strictEqual(events.find((e) => e.id === 'e1')?.severity, 'high', 'harsh braking -> high');
  assert.strictEqual(events.find((e) => e.id === 'e2')?.severity, 'medium', 'idling -> medium');
  assert.strictEqual(events.find((e) => e.id === 'e3')?.severity, 'low', 'unmatched rule -> low');
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

  console.log('fetchers.check.ts: PASS');
}

run().catch((err) => {
  console.error('fetchers.check.ts: FAIL', err);
  process.exit(1);
});
