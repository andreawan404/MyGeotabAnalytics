import assert from 'node:assert';
import { deriveSeverity } from './rule-severity';

// Built-in Geotab rule ids — matched on the id, with a LOCALIZED name that no
// English keyword table would ever hit. This is the production bug in one line.
assert.strictEqual(deriveSeverity('RuleHarshBrakingId', 'Pengereman Mendadak'), 'high');
assert.strictEqual(deriveSeverity('RuleSeatbeltId', 'Sabuk Pengaman Tidak Dipakai'), 'high');
assert.strictEqual(deriveSeverity('RuleSpeedingId', ''), 'high', 'id alone is enough — no name needed');
assert.strictEqual(deriveSeverity('RuleIdlingId', 'Mesin Menyala Terlalu Lama'), 'medium');
assert.strictEqual(deriveSeverity('RuleAfterHoursId', ''), 'medium', 'id substring match');

// Customer-defined rule: opaque id, so the name is all there is.
assert.strictEqual(deriveSeverity('b1A2', 'Masuk Zona Terlarang'), 'medium', 'name keyword fallback');
assert.strictEqual(deriveSeverity('x7Y8', 'Harsh Braking - Custom'), 'high', 'name keyword fallback');

// Nothing matches -> low (and the caller warns once so the id table can be seeded).
assert.strictEqual(deriveSeverity('c3D4', 'Perawatan Terjadwal'), 'low');
assert.strictEqual(deriveSeverity('', ''), 'low');

console.log('rule-severity.check.ts: PASS');
