import assert from 'node:assert';
import { aggregatePoints } from './heatmap';

const buckets = aggregatePoints([
  { lat: 1.00001, lon: 2.00001 },
  { lat: 1.00002, lon: 2.00002 },
  { lat: 5, lon: 5 },
]);

assert.strictEqual(buckets.length, 2, 'expected 2 buckets (nearby points merged, far point separate)');

const nearby = buckets.find(([lat, lon]) => Math.abs(lat - 1) < 0.001 && Math.abs(lon - 2) < 0.001);
assert.ok(nearby, 'expected a bucket near (1,2)');
assert.strictEqual(nearby![2], 2, 'expected merged weight of 2');

const far = buckets.find(([lat, lon]) => lat === 5 && lon === 5);
assert.ok(far, 'expected a separate bucket at (5,5)');
assert.strictEqual(far![2], 1, 'expected weight of 1');

console.log('heatmap.check.ts: PASS');
