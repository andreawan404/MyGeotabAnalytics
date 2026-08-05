// Export tabel ke CSV yang benar-benar rapi saat dibuka Excel berbahasa
// Indonesia.
//
// Bukan .xlsx sungguhan: menulisnya butuh SheetJS/ExcelJS, dependensi terbesar
// yang pernah masuk proyek ini, sementara root CLAUDE.md menetapkan bundle di
// bawah 1 MB tanpa framework berat. CSV dibuka Excel tanpa dependensi apa pun.
//
// Angka memakai formatter id-ID yang sama dengan layar (utils/format.ts), jadi
// angka di Excel tidak akan pernah berbeda dari angka di dashboard.

/**
 * Titik koma, bukan koma.
 *
 * Angka di dashboard ini berformat id-ID (1.234,5). Dengan pemisah koma, Excel
 * memecah SETIAP angka jadi dua kolom. Titik koma juga yang memang dipakai
 * Excel pada Windows berbahasa Indonesia, sehingga berkasnya cukup dobel-klik.
 */
const SEP = ';';

/** Excel mengharapkan CRLF. */
const EOL = '\r\n';

/**
 * Tanpa BOM, Excel membaca berkas sebagai ANSI dan nama unit berkarakter
 * non-ASCII rusak. Ini penyebab nomor satu keluhan "CSV saya berantakan".
 */
const BOM = '﻿';

/**
 * Karakter pembuka yang membuat Excel memperlakukan sel sebagai RUMUS.
 *
 * Nama unit, nama zona, dan nama Rule semuanya teks bebas milik pelanggan yang
 * mengalir apa adanya ke berkas ini. Sebuah unit bernama `=cmd|' /C calc'!A0`
 * menjadikan berkas yang KITA hasilkan senjata di komputer penerimanya — dan
 * penerimanya bisa jadi klien tambang yang tidak pernah menyentuh dashboard ini.
 *
 * Penjagaan di batas kepercayaan, sederajat dengan esc() yang menjaga batas
 * innerHTML. Tidak boleh disederhanakan demi diff yang lebih pendek.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Satu sel. Mengembalikan teks yang aman diletakkan di antara pemisah.
 *
 * `null`/`undefined` jadi sel KOSONG, bukan 0. Nol adalah pengukuran, dan
 * "tidak terukur" bukan nol — pembedaan yang dijaga di seluruh dashboard ini
 * dan tidak boleh hilang begitu datanya diekspor.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  // Tanda kutip tunggal di depan: Excel menampilkan isinya apa adanya dan
  // berhenti menganggapnya rumus. Dilakukan SEBELUM pengutipan, supaya ikut
  // terbungkus kalau sel-nya juga perlu dikutip.
  if (FORMULA_START.test(text)) text = `'${text}`;

  // Pemisah, kutip, atau baris baru di dalam sel merusak seluruh baris kalau
  // dibiarkan. Nama unit adalah teks bebas — cepat atau lambat ada yang memuat
  // titik koma.
  if (text.includes(SEP) || text.includes('"') || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(SEP), ...rows.map((r) => r.map(csvCell).join(SEP))];
  return BOM + lines.join(EOL) + EOL;
}

/**
 * Nama berkas: `<halaman>_<dari>_<sampai>.csv`.
 *
 * Rentang tanggal ikut masuk supaya dua unduhan tidak bertabrakan di folder
 * Downloads, dan supaya isinya masih bisa dikenali sebulan kemudian.
 *
 * Tanggal filter berbentuk "YYYY-MM-DDTHH:mm" (datetime-local); yang diambil
 * hanya bagian tanggalnya. Karakter yang dilarang di nama berkas Windows
 * dibuang — nama halaman berasal dari kita, tapi memurnikannya di sini berarti
 * pemanggil tidak perlu memikirkannya.
 */
export function csvFilename(base: string, dateFrom?: string, dateTo?: string): string {
  const day = (v?: string) => (v ?? '').slice(0, 10);
  const safe = (v: string) => v.replace(/[\\/:*?"<>|]/g, '-').trim();
  return [safe(base), day(dateFrom), day(dateTo)].filter(Boolean).join('_') + '.csv';
}

/**
 * Memicu unduhan. Satu-satunya bagian yang menyentuh DOM.
 *
 * revokeObjectURL wajib: blob yang tidak dilepas menumpuk sepanjang sesi, dan
 * sebuah export bisa berukuran megabyte.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sebagian browser masih membaca blob-nya sesaat setelah click(); melepas di
  // frame berikutnya cukup, dan tetap dalam satu tarikan napas.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
