import assert from 'node:assert/strict';
import { esc, clamp, fin, int, one, two, durationHm } from './format';

// esc — versi ketat: kutip tunggal ikut, dan & ganda tidak boleh double-encode
// jadi bentuk yang salah ("&amp;amp;"), karena '&' dipetakan sekali per karakter.
assert.equal(esc('a & b'), 'a &#38; b');
assert.equal(esc('<script>'), '&#60;script&#62;');
assert.equal(esc(`it's "x"`), 'it&#39;s &#34;x&#34;');
assert.equal(esc('&&'), '&#38;&#38;');
assert.equal(esc('aman'), 'aman');
// Nama device dari Geotab bisa saja bukan string kalau API berubah bentuk.
assert.equal(esc(null as unknown as string), 'null');

// clamp — batas inklusif, non-finite jatuh ke fallback (nilai korup di localStorage)
assert.equal(clamp(5, 1, 10, 3), 5);
assert.equal(clamp(1, 1, 10, 3), 1);
assert.equal(clamp(10, 1, 10, 3), 10);
assert.equal(clamp(0, 1, 10, 3), 3);
assert.equal(clamp(11, 1, 10, 3), 3);
assert.equal(clamp(NaN, 1, 10, 3), 3);
assert.equal(clamp(Infinity, 1, 10, 3), 3);

// fin + formatter — armada kosong tidak boleh mencetak NaN/∞ ke pelanggan
assert.equal(fin(NaN), 0);
assert.equal(fin(-Infinity), 0);
assert.equal(int(NaN), '0');
assert.equal(one(Infinity), '0,0');
assert.equal(two(NaN), '0,00');
// Locale id-ID: titik ribuan, koma desimal
assert.equal(int(1234567), '1.234.567');
assert.equal(one(1234.56), '1.234,6');
assert.equal(two(0.125), '0,13');

// durationHm
assert.equal(durationHm(0), '0j 0m');
assert.equal(durationHm(3600), '1j 0m');
assert.equal(durationHm(3660), '1j 1m');
assert.equal(durationHm(-500), '0j 0m');
assert.equal(durationHm(NaN), '0j 0m');

console.log('format.check.ts OK');
