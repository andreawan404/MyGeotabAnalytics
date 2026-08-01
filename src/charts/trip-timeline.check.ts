import assert from 'node:assert';
import { tripsToFloatingBars } from './trip-timeline';
import type { TripDTO, DeviceLite } from '../api/fetchers/types';

const devices: DeviceLite[] = [{ id: 'd1', name: 'Truck 1' }];

const trips: TripDTO[] = [
  {
    id: 't1', deviceId: 'd1',
    start: '2026-08-01T08:00:00.000Z', stop: '2026-08-01T09:30:00.000Z',
    distanceKm: 10, drivingDurationSec: 5400, idlingDurationSec: 0,
    startLat: 0, startLon: 0, stopLat: 0, stopLon: 0,
  },
  {
    // deviceId with no matching device -> falls back to raw deviceId as label
    id: 't2', deviceId: 'd2',
    start: '2026-08-01T10:00:00.000Z', stop: '2026-08-01T10:15:00.000Z',
    distanceKm: 2, drivingDurationSec: 900, idlingDurationSec: 0,
    startLat: 0, startLon: 0, stopLat: 0, stopLon: 0,
  },
];

const bars = tripsToFloatingBars(trips, devices);

assert.deepStrictEqual(bars[0], {
  x: [Date.parse('2026-08-01T08:00:00.000Z'), Date.parse('2026-08-01T09:30:00.000Z')],
  y: 'Truck 1',
});
assert.deepStrictEqual(bars[1], {
  x: [Date.parse('2026-08-01T10:00:00.000Z'), Date.parse('2026-08-01T10:15:00.000Z')],
  y: 'd2',
});

console.log('trip-timeline.check.ts: PASS');
