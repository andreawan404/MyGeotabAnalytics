import assert from 'node:assert';
import { parseDurationSec } from './parseDuration';

// .NET TimeSpan — the shape MyGeotab actually sends.
assert.strictEqual(parseDurationSec('00:15:30'), 930);
assert.strictEqual(parseDurationSec('01:02:03'), 3723);
assert.strictEqual(parseDurationSec('1.02:03:04'), 93784, 'd.HH:MM:SS past 24h');
assert.strictEqual(parseDurationSec('00:00:10.5'), 10.5, 'fractional seconds');
assert.strictEqual(parseDurationSec('-00:01:00'), -60, 'negative TimeSpan');

// ISO-8601 still parses, including the D part the old regex could not match.
assert.strictEqual(parseDurationSec('PT1H2M3S'), 3723);
assert.strictEqual(parseDurationSec('P1DT2H'), 93600);

// Empty / nullish / already-numeric.
assert.strictEqual(parseDurationSec(''), 0);
assert.strictEqual(parseDurationSec(null), 0);
assert.strictEqual(parseDurationSec(undefined), 0);
assert.strictEqual(parseDurationSec(3723), 3723, 'a number is already seconds');

// Unparseable -> 0, warned exactly once per distinct value however often it is
// seen (5436 exception rows must not emit 5436 warnings).
const realWarn = console.warn;
let warnCount = 0;
console.warn = () => {
  warnCount++;
};
try {
  assert.strictEqual(parseDurationSec('garbage'), 0);
  assert.strictEqual(parseDurationSec('garbage'), 0);
  assert.strictEqual(warnCount, 1, 'the same bad value must warn only once');
  parseDurationSec('other garbage');
  assert.strictEqual(warnCount, 2, 'a different bad value must still warn');
} finally {
  console.warn = realWarn;
}

console.log('parseDuration.check.ts: PASS');
