// Runnable with: npx tsx src/analytics/trip-detail.check.ts
import assert from 'node:assert';
import {
  engineOnSec,
  fuelPerTrip,
  buildTripDetails,
  formatDurationId,
  formatTripTooltip,
} from './trip-detail';
import type { TripDTO, DeviceLite, StatusDataDTO } from '../api/fetchers/types';

function trip(over: Partial<TripDTO> & Pick<TripDTO, 'id' | 'deviceId' | 'start' | 'stop'>): TripDTO {
  return {
    distanceKm: 0,
    drivingDurationSec: 0,
    idlingDurationSec: 0,
    startLat: 0,
    startLon: 0,
    stopLat: 0,
    stopLon: 0,
    ...over,
  };
}

function row(deviceId: string, dateTime: string, value: number): StatusDataDTO {
  return { deviceId, diagnosticId: 'fuelUsed', dateTime, value };
}

// --- engineOnSec -------------------------------------------------------------
// A Geotab trip spans ignition-on -> ignition-off, so this is stop - start.
const t1 = trip({
  id: 't1',
  deviceId: 'd1',
  start: '2026-08-01T08:00:00.000Z',
  stop: '2026-08-01T10:15:00.000Z',
  distanceKm: 12.4,
});
assert.strictEqual(engineOnSec(t1), 8100, '2h15m -> 8100s');

assert.strictEqual(
  engineOnSec(trip({ id: 'x', deviceId: 'd1', start: 'not-a-date', stop: '2026-08-01T10:00:00.000Z' })),
  0,
  'invalid start -> 0, never NaN'
);
assert.strictEqual(
  engineOnSec(trip({ id: 'x', deviceId: 'd1', start: '2026-08-01T10:00:00.000Z', stop: '' })),
  0,
  'invalid stop -> 0'
);
assert.strictEqual(
  engineOnSec(trip({ id: 'x', deviceId: 'd1', start: '2026-08-01T10:00:00.000Z', stop: '2026-08-01T09:00:00.000Z' })),
  0,
  'reversed dates clamp to 0, never negative'
);

// --- fuelPerTrip -------------------------------------------------------------
// Normal delta: counter reads 100 before the trip, 103.2 by the end.
{
  const rows = [
    row('d1', '2026-08-01T07:50:00.000Z', 100),
    row('d1', '2026-08-01T09:00:00.000Z', 101.5),
    row('d1', '2026-08-01T10:10:00.000Z', 103.2),
  ];
  const fuel = fuelPerTrip([t1], rows);
  assert.ok(Math.abs((fuel.t1 as number) - 3.2) < 1e-9, `normal delta -> 3.2, got ${fuel.t1}`);
}

// Unsorted input must produce the identical answer — Geotab promises no order.
{
  const rows = [
    row('d1', '2026-08-01T10:10:00.000Z', 103.2),
    row('d1', '2026-08-01T07:50:00.000Z', 100),
    row('d1', '2026-08-01T09:00:00.000Z', 101.5),
  ];
  const fuel = fuelPerTrip([t1], rows);
  assert.ok(Math.abs((fuel.t1 as number) - 3.2) < 1e-9, `unsorted input -> same 3.2, got ${fuel.t1}`);
}

// Counter reset / ECU swap: the value DROPS across the trip -> null, not a negative.
{
  const fuel = fuelPerTrip([t1], [
    row('d1', '2026-08-01T07:50:00.000Z', 5000),
    row('d1', '2026-08-01T10:10:00.000Z', 12),
  ]);
  assert.strictEqual(fuel.t1, null, 'counter reset -> null');
}

// No reading at or before the trip start -> no baseline -> null.
{
  const fuel = fuelPerTrip([t1], [
    row('d1', '2026-08-01T09:00:00.000Z', 101),
    row('d1', '2026-08-01T10:10:00.000Z', 103),
  ]);
  assert.strictEqual(fuel.t1, null, 'no baseline before start -> null');
}

// A reading only BEFORE the trip bounds both ends: nothing measured the trip
// itself, so null — reporting 0 L would fabricate a measurement.
{
  const fuel = fuelPerTrip([t1], [row('d1', '2026-08-01T07:50:00.000Z', 100)]);
  assert.strictEqual(fuel.t1, null, 'no reading inside the trip -> null, not 0');
}

// Another device's readings must never leak into this trip.
{
  const fuel = fuelPerTrip([t1], [
    row('d2', '2026-08-01T07:50:00.000Z', 100),
    row('d2', '2026-08-01T10:10:00.000Z', 999),
  ]);
  assert.strictEqual(fuel.t1, null, 'rows from another device -> null');
}

// --- formatDurationId --------------------------------------------------------
assert.strictEqual(formatDurationId(0), '0m');
assert.strictEqual(formatDurationId(-5), '0m', 'negative clamps, never "-1m"');
assert.strictEqual(formatDurationId(NaN), '0m', 'NaN never reaches the tooltip');
assert.strictEqual(formatDurationId(45), '45dtk');
assert.strictEqual(formatDurationId(75 * 60), '1j 15m', '75 minutes rolls into hours');
assert.strictEqual(formatDurationId(8100), '2j 15m');
assert.strictEqual(formatDurationId(30 * 60), '30m', 'under an hour -> minutes only');

// --- buildTripDetails + formatTripTooltip ------------------------------------
const devices: DeviceLite[] = [{ id: 'd1', name: 'Truck 1' }];

{
  const fuel = fuelPerTrip([t1], [
    row('d1', '2026-08-01T07:50:00.000Z', 100),
    row('d1', '2026-08-01T10:10:00.000Z', 103.2),
  ]);
  const [d] = buildTripDetails([t1], devices, fuel);
  assert.strictEqual(d.tripId, 't1');
  assert.strictEqual(d.deviceName, 'Truck 1');
  assert.strictEqual(d.engineOnSec, 8100);

  const lines = formatTripTooltip(d);
  assert.strictEqual(lines[0], 'Mesin menyala: 2j 15m');
  assert.strictEqual(lines[1], 'Jarak: 12,4 km', 'id-ID decimal comma');
  assert.strictEqual(lines[2], 'BBM: 3,2 L');
  assert.ok(lines[3].startsWith('Waktu: '), `time span line, got ${lines[3]}`);
  assert.ok(lines[3].includes('–'), 'start and stop separated by an en dash');
  assert.ok(!lines.join(' ').includes('NaN'), 'no NaN anywhere in the tooltip');
  // The bug being fixed: no raw epoch-ms may survive into the tooltip.
  assert.ok(!/\d{10,}/.test(lines.join(' ')), 'no raw epoch milliseconds in the tooltip');
  console.log('  WITH fuel:', JSON.stringify(lines));
}

// Unknown device id falls back to the raw id, same as tripsToFloatingBars.
{
  const t2 = trip({ id: 't2', deviceId: 'ghost', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T08:45:00.000Z', distanceKm: 3 });
  const [d] = buildTripDetails([t2], devices, fuelPerTrip([t2], []));
  assert.strictEqual(d.deviceName, 'ghost');
  assert.strictEqual(d.fuelL, null);

  const lines = formatTripTooltip(d);
  assert.strictEqual(lines[0], 'Mesin menyala: 45m');
  assert.strictEqual(lines[1], 'Jarak: 3,0 km');
  assert.strictEqual(lines[2], 'BBM: — (tidak dilaporkan unit ini)', 'null fuel -> em dash + reason, never 0 L');
  console.log('  WITHOUT fuel:', JSON.stringify(lines));
}

// Order is a contract: details[i] must describe trips[i] (Chart.js dataIndex).
{
  const a = trip({ id: 'a', deviceId: 'd1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z' });
  const b = trip({ id: 'b', deviceId: 'ghost', start: '2026-08-01T10:00:00.000Z', stop: '2026-08-01T11:00:00.000Z' });
  const details = buildTripDetails([a, b], devices, {});
  assert.deepStrictEqual(details.map((d) => d.tripId), ['a', 'b'], 'never reordered, never filtered');
}

// A trip whose dates are junk still yields a renderable, NaN-free tooltip.
{
  const bad = trip({ id: 'bad', deviceId: 'd1', start: 'nope', stop: 'nope', distanceKm: NaN });
  const [d] = buildTripDetails([bad], devices, {});
  const lines = formatTripTooltip(d);
  assert.strictEqual(lines[0], 'Mesin menyala: 0m');
  assert.strictEqual(lines[1], 'Jarak: 0,0 km');
  assert.strictEqual(lines[3], 'Waktu: —');
  assert.ok(!lines.join(' ').includes('NaN'), 'invalid dates never render NaN');
}

// --- empty input everywhere --------------------------------------------------
assert.deepStrictEqual(fuelPerTrip([], []), {});
assert.deepStrictEqual(fuelPerTrip([], [row('d1', '2026-08-01T08:00:00.000Z', 1)]), {});
assert.deepStrictEqual(buildTripDetails([], [], {}), []);
assert.deepStrictEqual(buildTripDetails([], devices, {}), []);

// --- ignition-off grace window ----------------------------------------------
// "Total fuel used" is written AT ignition-off, and that record's timestamp
// lands a moment AFTER trip.stop. Without a grace window the closing reading is
// missed and every trip reads as unmeasured — which is exactly what MyGeotab's
// own Fuel Usage report contradicted on real data.
{
  const t = trip({ id: 'grace', deviceId: 'd9', start: '2026-07-31T09:54:00Z', stop: '2026-07-31T10:58:00Z' });
  const rows = [
    row('d9', '2026-07-31T09:50:00Z', 1000), // previous ignition-off = baseline
    row('d9', '2026-07-31T10:58:41Z', 1004.1), // this trip's ignition-off, 41s LATE
  ];
  const got = fuelPerTrip([t], rows)['grace'];
  assert.ok(got !== null, 'a reading just after trip.stop must still close the trip');
  assert.ok(Math.abs((got as number) - 4.1) < 1e-9, `expected 4.1 L, got ${got}`);
}

// The window must not be so wide that the NEXT trip's ignition-off record gets
// counted into this trip.
{
  const t = trip({ id: 'nogreed', deviceId: 'd9', start: '2026-07-31T09:00:00Z', stop: '2026-07-31T09:30:00Z' });
  const rows = [
    row('d9', '2026-07-31T08:55:00Z', 500),
    row('d9', '2026-07-31T09:31:00Z', 502), // this trip's close
    row('d9', '2026-07-31T10:40:00Z', 599), // a LATER trip's close, far outside the window
  ];
  const got = fuelPerTrip([t], rows)['nogreed'];
  assert.strictEqual(got, 2, `expected only this trip's 2 L, got ${got}`);
}

console.log('trip-detail.check.ts: PASS');
