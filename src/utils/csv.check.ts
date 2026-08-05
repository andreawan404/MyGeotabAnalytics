import assert from 'node:assert/strict';
import { csvCell, toCsv, csvFilename } from './csv';

const BOM = '﻿';

// --- CEGAH CSV INJECTION ----------------------------------------------------
//
// Yang paling penting di berkas ini. Sel yang diawali =, +, -, @, tab, atau CR
// dieksekusi Excel sebagai RUMUS. Nama unit, zona dan Rule semuanya teks bebas
// milik pelanggan yang mengalir apa adanya ke sini — dan berkasnya bisa berakhir
// di komputer klien yang tidak pernah menyentuh dashboard ini.
assert.equal(csvCell('=SUM(1+1)'), "'=SUM(1+1)");
assert.equal(csvCell('+62812'), "'+62812");
assert.equal(csvCell('-5'), "'-5");
assert.equal(csvCell('@here'), "'@here");
assert.equal(csvCell('\tawal tab'), "'\tawal tab");
// Kutip TUNGGAL tidak memicu pengutipan CSV — yang memicunya hanya pemisah,
// kutip GANDA, dan baris baru. Jadi di sini cukup rumusnya yang dilucuti.
assert.equal(csvCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
// Yang berbahaya DAN memuat pemisah harus kena keduanya.
assert.equal(csvCell('=A1;B2'), '"\'=A1;B2"', 'dilucuti rumusnya lalu dikutip');

// Angka NEGATIF juga diawali '-'. Melucutinya wajar: keamanan didahulukan, dan
// Excel tetap menampilkan angkanya. Yang tidak boleh adalah membiarkannya lewat.
assert.equal(csvCell('-1.234,5'), "'-1.234,5");

// Yang tidak berbahaya tidak boleh diutak-atik.
assert.equal(csvCell('B 9276 UXY'), 'B 9276 UXY');
assert.equal(csvCell('1.234,5'), '1.234,5');
assert.equal(csvCell('Truck (A-1)'), 'Truck (A-1)');

// --- pengutipan dan escape --------------------------------------------------
//
// Satu titik koma di dalam nama unit merusak SELURUH kolom di baris itu.
assert.equal(csvCell('Depo A; Depo B'), '"Depo A; Depo B"');
assert.equal(csvCell('Unit "Alpha"'), '"Unit ""Alpha"""', 'kutip di dalam digandakan');
assert.equal(csvCell('baris\nkedua'), '"baris\nkedua"');
assert.equal(csvCell('baris\r\nkedua'), '"baris\r\nkedua"');

// --- sel kosong TETAP kosong, bukan 0 ---------------------------------------
//
// Nol adalah pengukuran; "tidak terukur" bukan nol. Pembedaan itu dijaga di
// seluruh dashboard dan tidak boleh hilang begitu datanya diekspor — km/L yang
// tidak tersedia tidak boleh berubah jadi 0 di Excel lalu ikut terhitung
// dalam rata-rata.
assert.equal(csvCell(null), '');
assert.equal(csvCell(undefined), '');
assert.equal(csvCell(0), '0', 'nol yang SUNGGUHAN tetap nol');
assert.equal(csvCell(''), '');

// --- toCsv ------------------------------------------------------------------
{
  const csv = toCsv(
    ['Unit', 'Jarak (km)', 'km/L'],
    [
      ['B 9276 UXY', '1.679', '3,84'],
      ['B 9264 UXY', '0', null], // km/L tidak tersedia
    ]
  );

  assert.ok(csv.startsWith(BOM), 'BOM wajib, kalau tidak Excel merusak karakter non-ASCII');

  const lines = csv.split('\r\n');
  assert.equal(lines[0], BOM + 'Unit;Jarak (km);km/L', 'pemisah titik koma, bukan koma');
  assert.equal(lines[1], 'B 9276 UXY;1.679;3,84', 'angka id-ID lewat utuh');
  assert.equal(lines[2], 'B 9264 UXY;0;', 'sel kosong di akhir baris tetap kosong');
  assert.equal(lines[3], '', 'berkas diakhiri baris baru');

  assert.ok(csv.includes('\r\n'), 'CRLF, yang diharapkan Excel');
  assert.ok(!/[^\r]\n/.test(csv), 'tidak ada LF telanjang');

  // Judul kolom melewati jalur aman yang sama dengan sel data.
  const tricky = toCsv(['A;B'], [['x']]);
  assert.ok(tricky.includes('"A;B"'), 'judul kolom juga dikutip');
}

// Tabel kosong tetap menghasilkan berkas berisi judul kolom — lebih baik
// daripada berkas nol byte yang terbaca seperti unduhan gagal.
{
  const csv = toCsv(['Unit', 'Jarak'], []);
  assert.equal(csv, BOM + 'Unit;Jarak\r\n');
}

// --- nama berkas ------------------------------------------------------------
assert.equal(
  csvFilename('laporan-perjalanan', '2026-07-29T00:00', '2026-08-05T13:15'),
  'laporan-perjalanan_2026-07-29_2026-08-05.csv'
);
assert.equal(csvFilename('konsumsi-bbm'), 'konsumsi-bbm.csv', 'tanpa tanggal tetap sah');
// Karakter terlarang di nama berkas Windows harus hilang, kalau tidak
// unduhannya gagal diam-diam.
assert.equal(csvFilename('a/b:c*d?e"f<g>h|i', '2026-01-01T00:00', '2026-01-02T00:00'),
  'a-b-c-d-e-f-g-h-i_2026-01-01_2026-01-02.csv');

console.log('csv.check.ts OK');
