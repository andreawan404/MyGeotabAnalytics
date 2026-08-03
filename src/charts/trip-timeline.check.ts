import assert from 'node:assert';
import { tripsToFloatingBars, visibleDeviceNames } from './trip-timeline';
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

// Urutan dan pencocokan nomor polisi kini diuji di utils/format.check.ts —
// keduanya dipakai bersama halaman Konsumsi BBM, jadi tempatnya bukan lagi di
// sini. Yang tersisa di bawah adalah perakitan daftar barisnya.

// --- daftar baris yang tampil ----------------------------------------------
const rows = [{ y: 'B 9875 UEX' }, { y: 'A 9828 RA' }, { y: 'B 9875 UEX' }, { y: 'B 9374 TFY' }];
// Duplikat dihapus (satu unit banyak perjalanan = satu baris) lalu diurutkan.
assert.deepStrictEqual(visibleDeviceNames(rows, ''), ['A 9828 RA', 'B 9374 TFY', 'B 9875 UEX']);
assert.deepStrictEqual(visibleDeviceNames(rows, 'b98'), ['B 9875 UEX']);
assert.deepStrictEqual(visibleDeviceNames(rows, 'zzz'), [], 'tanpa hasil harus array kosong, bukan semua');
assert.deepStrictEqual(visibleDeviceNames([], 'b'), []);

// Posisi label sumbu waktu TIDAK diuji di sini: sejak strip membaca
// scales.x.getTicks() + getPixelForValue() milik Chart.js, tidak ada lagi
// perhitungan sendiri yang bisa meleset — kesejajarannya dengan gridline
// bersifat struktural, bukan hasil hitungan paralel yang perlu dicocokkan.

console.log('trip-timeline.check.ts: PASS');
