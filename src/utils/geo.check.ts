import assert from 'node:assert';
import { pointInPolygon, haversineKm } from './geo';

// A 0.01 deg square around Kemayoran (same region as dev/fixtures.ts).
const square = [
  { lat: -6.15, lon: 106.83 },
  { lat: -6.15, lon: 106.84 },
  { lat: -6.16, lon: 106.84 },
  { lat: -6.16, lon: 106.83 },
];

assert.strictEqual(pointInPolygon({ lat: -6.155, lon: 106.835 }, square), true, 'centre is inside');
assert.strictEqual(pointInPolygon({ lat: -6.2, lon: 106.9 }, square), false, 'far away is outside');
// Just outside on one axis only — the case a bounding-box shortcut gets right
// but a broken ray cast typically gets wrong.
assert.strictEqual(pointInPolygon({ lat: -6.155, lon: 106.85 }, square), false, 'east of the square is outside');
assert.strictEqual(pointInPolygon({ lat: -6.155, lon: 106.835 }, []), false, 'empty polygon contains nothing');

// Monas (Jakarta) -> Bekasi city centre: ~20.5 km great-circle.
const monas = { lat: -6.1754, lon: 106.8272 };
const bekasi = { lat: -6.2383, lon: 107.0011 };
const d = haversineKm(monas, bekasi);
assert.ok(d > 18 && d < 25, `Jakarta->Bekasi should be ~20-25km, got ${d.toFixed(2)}km`);
assert.strictEqual(haversineKm(monas, monas), 0, 'zero distance to self');
assert.ok(Math.abs(haversineKm(bekasi, monas) - d) < 1e-9, 'symmetric');

console.log('geo.check.ts: PASS');
