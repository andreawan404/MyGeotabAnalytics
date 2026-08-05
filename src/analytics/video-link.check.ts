import assert from 'node:assert';
import {
  resolveVideoPage,
  videoPageParams,
  VIDEO_PAGE_CANDIDATES,
  CONFIRMED_VIDEO_PAGE,
  ALL_CATEGORIES,
} from './video-link';

// --- resolveVideoPage -------------------------------------------------------
//
// Nama halaman Video tidak ada di dokumentasi publik. Yang menentukan bukan
// tebakan kita, melainkan jawaban host — dan kalau host tidak mengenali satu
// pun, tombolnya harus HILANG, bukan muncul lalu gagal saat ditekan.
assert.equal(resolveVideoPage(() => true), VIDEO_PAGE_CANDIDATES[0], 'ambil kandidat pertama yang diterima');

// Kandidat pertama HARUS yang terkonfirmasi: urutan itu load-bearing, bukan
// selera. Halaman Video adalah add-in Marketplace (awalan "addin-"), dan
// kelima tebakan awal yang bernama seperti halaman bawaan tidak pernah cocok.
assert.equal(VIDEO_PAGE_CANDIDATES[0], CONFIRMED_VIDEO_PAGE);
assert.match(CONFIRMED_VIDEO_PAGE, /^addin-/);

// Host menolak semuanya. Untuk halaman bawaan itu jawaban akhir; untuk halaman
// ADD-IN belum tentu — hasAccessToPage mendokumentasikan halaman MyGeotab, dan
// add-in Marketplace bisa saja tidak terdaftar di sana. Hanya halaman yang
// keberadaannya DIPASTIKAN yang boleh lolos.
assert.equal(resolveVideoPage(() => false), CONFIRMED_VIDEO_PAGE, 'penolakan menyeluruh -> halaman terkonfirmasi');

// Tebakan TIDAK mendapat keistimewaan itu: tanpa halaman terkonfirmasi di
// daftar, penolakan menyeluruh tetap berarti tombolnya hilang.
assert.equal(resolveVideoPage(() => false, ['videoEvents', 'video']), null, 'tebakan saja -> tetap null');

// Tanpa hasAccessToPage sama sekali (host lama / harness dev), pakai yang
// terkonfirmasi — menyembunyikan tombol di situ berarti menghukum pengguna
// karena host-nya pelit informasi.
assert.equal(resolveVideoPage(undefined), CONFIRMED_VIDEO_PAGE);
assert.equal(resolveVideoPage(null as any), CONFIRMED_VIDEO_PAGE);
assert.equal(resolveVideoPage(undefined, []), null, 'daftar kosong tetap null');

// Kandidat kedua dipakai kalau yang pertama ditolak.
assert.equal(
  resolveVideoPage((p) => p === VIDEO_PAGE_CANDIDATES[1]),
  VIDEO_PAGE_CANDIDATES[1]
);

// Host boleh MELEMPAR untuk nama yang tidak dikenalnya. Itu jawaban "tidak
// ada" — bukan alasan menjatuhkan sisa daftarnya.
const asked: string[] = [];
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
//
// Bentuknya epoch milidetik (from/to), BUKAN dateRange ISO. Percobaan pertama
// memakai bentuk halaman bawaan MyGeotab dan diabaikan sepenuhnya oleh add-in
// Video — chip tanggalnya tetap "Last 7 days".
{
  const at = Date.parse('2026-08-04T10:00:00.000Z');
  const p = videoPageParams({ deviceId: 'b1A8', at: '2026-08-04T10:00:00.000Z' })!;
  assert.ok(p, 'input sah harus menghasilkan parameter');
  assert.equal(typeof p.from, 'number', 'epoch ms, bukan string ISO');
  assert.equal(typeof p.to, 'number');

  // Jendela ±15 menit, berpusat tepat pada insiden: klip dan ExceptionEvent
  // distempel jalur berbeda, jadi meminta pada detik yang persis sama hampir
  // pasti kosong.
  assert.equal(p.from, at - 15 * 60000);
  assert.equal(p.to, at + 15 * 60000);
  assert.equal((p.to - p.from) / 60000, 30);

  // deviceIds SENGAJA tidak ada: nilai aslinya id internal layanan video
  // (185354), bukan id MyGeotab, dan tidak bisa diturunkan dari API.
  assert.ok(!('deviceIds' in p), 'jangan kirim deviceIds yang tidak bisa dipetakan');
  assert.ok(!('dateRange' in p), 'bentuk lama yang diabaikan harus hilang');
  assert.ok(!('selectedEntities' in p), 'bentuk lama yang diabaikan harus hilang');

  const wide = videoPageParams({ deviceId: 'b1A8', at: '2026-08-04T10:00:00.000Z', windowMin: 60 })!;
  assert.equal((wide.to - wide.from) / 60000, 120);

  // Nilai harus bulat: pecahan milidetik di URL tidak berguna dan bikin ribut.
  assert.ok(Number.isInteger(p.from) && Number.isInteger(p.to));

  // Kategori WAJIB dikirim. Tanpa ini nilainya menempel dari kunjungan
  // sebelumnya, dan insiden benturan bisa mendarat di tab Tailgating lalu
  // tampak tidak punya rekaman padahal klipnya ada.
  assert.equal(p.visibleCategoryId, ALL_CATEGORIES);
  assert.equal(ALL_CATEGORIES, 0, 'tab "All" = 0, dari address bar pelanggan');

  // Klip yang sudah di-dismiss orang lain tetap bukti. Dengan false, pengguna
  // akan menyimpulkan "tidak ada rekaman" padahal ada.
  assert.equal(p.showDismissed, true);
}

// Input rusak menghasilkan null, bukan rentang 1970 yang mengantar pengguna ke
// halaman kosong tanpa penjelasan.
assert.equal(videoPageParams({ deviceId: 'b1A8', at: 'entah' }), null);
assert.equal(videoPageParams({ deviceId: '', at: '2026-08-04T10:00:00.000Z' }), null);

console.log('video-link.check.ts: PASS');
