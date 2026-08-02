import assert from 'node:assert';
import { resolveZone, buildJourneys, summariseUnmatched } from './trip-report';
import type { TripDTO, ZoneDTO, DeviceLite } from '../api/fetchers/types';

function square(id: string, name: string, lat: number, lon: number, half: number): ZoneDTO {
  return {
    id,
    name,
    points: [
      { lat: lat - half, lon: lon - half },
      { lat: lat - half, lon: lon + half },
      { lat: lat + half, lon: lon + half },
      { lat: lat + half, lon: lon - half },
    ],
    centerLat: lat,
    centerLon: lon,
  };
}

// A big city zone with a small depot inside it — the overlap case.
const city = square('z-city', 'Jakarta', -6.2, 106.8, 0.5);
const depot = square('z-depot', 'Depot Cikarang', -6.2, 106.8, 0.02);
const port = square('z-port', 'Tanjung Priok', -6.1, 106.88, 0.03);
const zones = [city, depot, port];

const devices: DeviceLite[] = [{ id: 'd1', name: 'Truck Alpha' }];

function trip(over: Partial<TripDTO> & Pick<TripDTO, 'id' | 'start' | 'stop'>): TripDTO {
  return {
    deviceId: 'd1',
    distanceKm: 10,
    drivingDurationSec: 0,
    idlingDurationSec: 0,
    startLat: -6.2,
    startLon: 106.8,
    stopLat: -6.1,
    stopLon: 106.88,
    ...over,
  };
}

// --- resolveZone -------------------------------------------------------------
assert.strictEqual(
  resolveZone({ lat: -6.2, lon: 106.8 }, zones)?.id,
  'z-depot',
  'overlapping zones must resolve to the SMALLEST, or every journey reads Jakarta -> Jakarta'
);
assert.strictEqual(resolveZone({ lat: -6.1, lon: 106.88 }, zones)?.id, 'z-port');
assert.strictEqual(resolveZone({ lat: 0, lon: 0 }, zones), null, 'outside every zone -> null');
assert.strictEqual(resolveZone({ lat: -6.2, lon: 106.8 }, []), null, 'no zones -> null');

// --- buildJourneys: a short stop must NOT split a journey ---------------------
{
  const trips = [
    trip({
      id: 't1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0, distanceKm: 30,
    }),
    trip({
      id: 't2', start: '2026-08-01T09:10:00.000Z', stop: '2026-08-01T10:00:00.000Z',
      startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88, distanceKm: 20,
    }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 1, 'a 10-minute stop is shorter than the 15-minute dwell -> one journey');
  assert.strictEqual(rows[0].fromZone.id, 'z-depot');
  assert.strictEqual(rows[0].toZone.id, 'z-port');
  assert.strictEqual(rows[0].departAt, '2026-08-01T08:00:00.000Z');
  assert.strictEqual(rows[0].arriveAt, '2026-08-01T10:00:00.000Z');
  assert.strictEqual(rows[0].durationSec, 7200, 'arrive - depart, INCLUDING the stop in between');
  assert.strictEqual(rows[0].distanceKm, 50);
  assert.strictEqual(rows[0].stops, 1);
  assert.deepStrictEqual(rows[0].tripIds, ['t1', 't2']);
  assert.strictEqual(rows[0].isRoundTrip, false);
  assert.strictEqual(rows[0].deviceName, 'Truck Alpha');
}

// --- a long dwell inside a zone CLOSES the journey ----------------------------
{
  const trips = [
    trip({
      id: 'a1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: -6.2, startLon: 106.8, stopLat: -6.1, stopLon: 106.88,
    }),
    trip({
      id: 'a2', start: '2026-08-01T11:00:00.000Z', stop: '2026-08-01T12:00:00.000Z',
      startLat: -6.1, startLon: 106.88, stopLat: -6.2, stopLon: 106.8,
    }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 2);
  // Sorted newest first, so the later journey comes first.
  assert.strictEqual(rows[1].toZone.id, 'z-port');
  assert.strictEqual(rows[0].fromZone.id, 'z-port');
  assert.strictEqual(rows[0].toZone.id, 'z-depot');
}

// --- round trip: depot -> unregistered -> depot -------------------------------
{
  const trips = [
    trip({
      id: 'r1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0,
    }),
    trip({
      id: 'r2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
      startLat: 0, startLon: 0, stopLat: -6.2, stopLon: 106.8,
    }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].isRoundTrip, true, 'depot -> depot is a real delivery run');
  assert.strictEqual(rows[0].fromZone.id, 'z-depot');
  assert.strictEqual(rows[0].toZone.id, 'z-depot');
}

// --- a chain whose origin is unknown is NOT emitted ---------------------------
{
  const trips = [
    trip({
      id: 'u1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88, distanceKm: 40,
    }),
  ];
  const rows = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.deepStrictEqual(rows, [], 'origin outside every zone -> no row');

  const unmatched = summariseUnmatched(trips, rows);
  assert.strictEqual(unmatched.trips, 1, 'a dropped chain must still be counted');
  assert.strictEqual(unmatched.distanceKm, 40);
}

// --- fuel: any missing leg makes the whole journey null -----------------------
{
  const trips = [
    trip({
      id: 'f1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0,
    }),
    trip({
      id: 'f2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
      startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88,
    }),
  ];
  const both = buildJourneys(trips, zones, devices, { dwellMinutes: 15, fuelByTrip: { f1: 3, f2: 4 } });
  assert.strictEqual(both[0].fuelL, 7, 'legs summed when every leg is measured');

  const partial = buildJourneys(trips, zones, devices, { dwellMinutes: 15, fuelByTrip: { f1: 3, f2: null } });
  assert.strictEqual(partial[0].fuelL, null, 'a partial sum understates consumption and must not be shown');

  const none = buildJourneys(trips, zones, devices, { dwellMinutes: 15 });
  assert.strictEqual(none[0].fuelL, null, 'no fuel data at all -> null, never 0');
}

// --- devices are independent: trips must not chain across vehicles ------------
{
  const trips = [
    trip({
      id: 'x1', deviceId: 'd1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0,
    }),
    trip({
      id: 'x2', deviceId: 'd2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
      startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88,
    }),
  ];
  const rows = buildJourneys(trips, zones, [...devices, { id: 'd2', name: 'Van Bravo' }], { dwellMinutes: 15 });
  assert.deepStrictEqual(rows, [], 'two different vehicles never form one journey');
}

// --- unsorted input, unknown device, empty input ------------------------------
{
  const trips = [
    trip({
      id: 's2', start: '2026-08-01T09:05:00.000Z', stop: '2026-08-01T10:00:00.000Z',
      startLat: 0, startLon: 0, stopLat: -6.1, stopLon: 106.88,
    }),
    trip({
      id: 's1', start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:00:00.000Z',
      startLat: -6.2, startLon: 106.8, stopLat: 0, stopLon: 0,
    }),
  ];
  const rows = buildJourneys(trips, zones, [], { dwellMinutes: 15 });
  assert.strictEqual(rows.length, 1, 'input order must not matter');
  assert.deepStrictEqual(rows[0].tripIds, ['s1', 's2']);
  assert.strictEqual(rows[0].deviceName, 'd1', 'unknown device falls back to its id');
}

assert.deepStrictEqual(buildJourneys([], zones, devices, { dwellMinutes: 15 }), []);
assert.deepStrictEqual(summariseUnmatched([], []), { trips: 0, distanceKm: 0 });

console.log('trip-report.check.ts: PASS');
