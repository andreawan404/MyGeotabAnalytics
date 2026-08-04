import assert from 'node:assert';
import { resolveVideoPage, videoPageParams, VIDEO_PAGE_CANDIDATES } from './video-link';

// --- resolveVideoPage -------------------------------------------------------
//
// Nama halaman Video tidak ada di dokumentasi publik. Yang menentukan bukan
// tebakan kita, melainkan jawaban host — dan kalau host tidak mengenali satu
// pun, tombolnya harus HILANG, bukan muncul lalu gagal saat ditekan.
assert.equal(resolveVideoPage(() => true), VIDEO_PAGE_CANDIDATES[0], 'ambil kandidat pertama yang diterima');
assert.equal(resolveVideoPage(() => false), null, 'tidak satu pun dikenali -> null');
assert.equal(resolveVideoPage(undefined), null, 'tanpa host (dev/check) -> null');
assert.equal(resolveVideoPage(null as any), null);

// Kandidat kedua dipakai kalau yang pertama ditolak.
assert.equal(
  resolveVideoPage((p) => p === VIDEO_PAGE_CANDIDATES[1]),
  VIDEO_PAGE_CANDIDATES[1]
);

// Host boleh MELEMPAR untuk nama yang tidak dikenalnya. Itu jawaban "tidak
// ada" — bukan alasan menjatuhkan sisa daftarnya.
let asked: string[] = [];
const throwyHost = (p: string) => {
  asked.push(p);
  if (p !== 'cameraEvents') throw new Error('unknown page');
  return true;
};
assert.equal(resolveVideoPage(throwyHost), 'cameraEvents', 'lemparan tidak boleh menghentikan pencarian');
assert.equal(asked.length, VIDEO_PAGE_CANDIDATES.indexOf('cameraEvents') + 1);

// Semua kandidat harus unik dan tidak kosong — duplikat berarti host ditanya
// hal yang sama dua kali tanpa alasan.
assert.equal(new Set(VIDEO_PAGE_CANDIDATES).size, VIDEO_PAGE_CANDIDATES.length);
assert.ok(VIDEO_PAGE_CANDIDATES.every((p) => p.length > 0));

// --- videoPageParams --------------------------------------------------------
{
  const p = videoPageParams({ deviceId: 'b1A8', at: '2026-08-04T10:00:00.000Z' })!;
  assert.ok(p, 'input sah harus menghasilkan parameter');
  assert.deepStrictEqual(p.selectedEntities, [{ id: 'b1A8' }]);
  // Jendela ±15 menit: klip dan ExceptionEvent distempel oleh jalur yang
  // berbeda, jadi meminta pada detik yang persis sama hampir pasti kosong.
  assert.equal(p.dateRange.startDate, '2026-08-04T09:45:00.000Z');
  assert.equal(p.dateRange.endDate, '2026-08-04T10:15:00.000Z');

  const wide = videoPageParams({ deviceId: 'b1A8', at: '2026-08-04T10:00:00.000Z', windowMin: 60 })!;
  assert.equal(wide.dateRange.startDate, '2026-08-04T09:00:00.000Z');
  assert.equal(wide.dateRange.endDate, '2026-08-04T11:00:00.000Z');

  // Jendela melewati tengah malam harus tetap benar — tanggalnya ikut mundur.
  const midnight = videoPageParams({ deviceId: 'x', at: '2026-08-04T00:05:00.000Z' })!;
  assert.equal(midnight.dateRange.startDate, '2026-08-03T23:50:00.000Z');
}

// Input rusak menghasilkan null, bukan rentang 1970 yang mengantar pengguna ke
// halaman kosong tanpa penjelasan.
assert.equal(videoPageParams({ deviceId: 'b1A8', at: 'entah' }), null);
assert.equal(videoPageParams({ deviceId: '', at: '2026-08-04T10:00:00.000Z' }), null);

console.log('video-link.check.ts: PASS');
