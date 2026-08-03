import assert from 'node:assert/strict';
import { esc, clamp, fin, int, one, two, durationHm, comparePlates, matchesPlate } from './format';

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

// --- urutan nomor polisi ----------------------------------------------------
//
// Yang paling mudah rusak: tanpa `numeric`, "B 10000 XX" jatuh SEBELUM
// "B 9374 TFY" karena "1" < "9" secara leksikal. Terlihat benar sampai armada
// punya plat lima digit.
assert.ok(comparePlates('B 9374 TFY', 'B 10000 XX') < 0, 'urutan angka harus numerik, bukan leksikal');
assert.ok(comparePlates('A 9828 RA', 'B 9374 TFY') < 0);
assert.ok(comparePlates('B 9875 UEX', 'B 9890 TEZ') < 0);
assert.equal(comparePlates('B 9875 UEX', 'b 9875 uex'), 0, 'besar-kecil huruf tidak boleh mengubah urutan');

// Nama unit adalah teks bebas: plat dan nomor rangka hidup berdampingan di
// database yang sama, dan keduanya harus tetap terurut stabil.
assert.deepEqual(
  ['MHCFVR34USJ001916', 'B 9875 UEX', 'A 9828 RA', 'H 8762 OH', 'B 9374 TFY'].sort(comparePlates),
  ['A 9828 RA', 'B 9374 TFY', 'B 9875 UEX', 'H 8762 OH', 'MHCFVR34USJ001916']
);

// --- pencocokan pencarian ---------------------------------------------------
//
// Orang mengetik plat tanpa spasi. Kalau ini gagal, kolom pencarian terasa rusak
// padahal datanya ada.
assert.ok(matchesPlate('B 9875 UEX', 'b9875'), 'spasi harus diabaikan');
assert.ok(matchesPlate('B 9875 UEX', 'B 9875'));
assert.ok(matchesPlate('B 9875 UEX', 'uex'), 'huruf kecil harus cocok');
assert.ok(matchesPlate('B 9875 UEX', ''), 'kueri kosong menampilkan semua');
assert.ok(matchesPlate('B 9875 UEX', '   '), 'spasi saja sama dengan kueri kosong');
assert.ok(!matchesPlate('B 9875 UEX', 'B 9890'));

console.log('format.check.ts OK');
