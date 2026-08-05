// Tautan dari sebuah insiden ke halaman Video bawaan MyGeotab.
//
// KENAPA MENAUTKAN, BUKAN MEMUTAR SENDIRI:
// Probe MediaFile pada database sungguhan mengembalikan tiga baris — satu
// Image dari DisplayPictureSolutionId (foto profil) dan dua Application, semua
// tanpa unit, semua bertanggal 3,5 bulan di luar rentang yang dilihat. Nol
// Video. Sementara halaman Video Events MyGeotab menampilkan 41 klip pada
// rentang yang sama. Ditambah daftar object API Geotab yang tidak punya entity
// video/ADAS sama sekali, kesimpulannya: klip GO Focus hidup di layanan
// internal Geotab dan tidak diekspos ke API publik. Tidak ada pemutar yang bisa
// dibangun di atas itu — yang bisa hanyalah mengantar pengguna ke sana.
//
// MURNI: tanpa DOM, tanpa API, jadi video-link.check.ts jalan di bawah tsx.

/**
 * Nama halaman yang dicoba, berurutan.
 *
 * ponytail: daftar kandidat, bukan satu tebakan. Nama halaman Video TIDAK ADA
 * di dokumentasi URL publik MyGeotab (yang terdaftar hanya map, tripsHistory,
 * zones, users, dan sejenisnya), jadi satu nilai hardcode berarti menebak.
 * `hasAccessToPage` milik host yang memilih mana yang benar-benar ada — dan
 * kalau tidak satu pun ada, tombolnya TIDAK ditampilkan, bukan ditampilkan lalu
 * gagal saat ditekan.
 *
 * Tambahkan nama yang terlihat di address bar MyGeotab pelanggan ke urutan
 * PALING ATAS bila suatu saat diketahui.
 */
/**
 * Halaman yang keberadaannya DIPASTIKAN dari address bar pelanggan, bukan
 * ditebak. Statusnya berbeda dari kandidat lain, dan perbedaan itu penting di
 * resolveVideoPage.
 */
export const CONFIRMED_VIDEO_PAGE = 'addin-geotabvideo-events';

export const VIDEO_PAGE_CANDIDATES = [
  // TERKONFIRMASI dari address bar pelanggan:
  //   https://my.geotab.com/<db>/#addin-geotabvideo-events,visibleCategoryId:30
  // Awalan "addin-" itu yang penting: halaman Video adalah ADD-IN Marketplace,
  // bukan halaman bawaan MyGeotab. Kelima tebakan awal saya semuanya bernama
  // seperti halaman bawaan, jadi tidak satu pun bisa cocok.
  CONFIRMED_VIDEO_PAGE,
  // Sisanya tebakan, disimpan kalau database lain memakai nama berbeda.
  'videoEvents',
  'video',
  'videoEventList',
  'safetyVideo',
  'cameraEvents',
];

/** Halaman Video pertama yang benar-benar bisa dibuka pengguna ini. */
export function resolveVideoPage(
  hasAccess: ((page: string) => boolean) | undefined,
  candidates: string[] = VIDEO_PAGE_CANDIDATES
): string | null {
  // Host tidak menyediakan hasAccessToPage: pakai kandidat pertama, yang
  // TERKONFIRMASI ada di database pelanggan. Mengembalikan null di sini akan
  // menyembunyikan tombol pada host yang sebenarnya sanggup membuka halamannya
  // — menghukum pengguna karena host-nya pelit informasi, bukan karena
  // halamannya tidak ada.
  if (typeof hasAccess !== 'function') return candidates[0] ?? null;
  for (const page of candidates) {
    try {
      if (hasAccess(page)) return page;
    } catch {
      // Host boleh melempar untuk nama yang tidak dikenalnya. Itu jawaban
      // "tidak ada", bukan alasan menjatuhkan seluruh daftar.
    }
  }

  // Host menolak SEMUANYA. Untuk halaman bawaan, itu jawaban akhir. Untuk
  // halaman ADD-IN tidak: hasAccessToPage mendokumentasikan halaman MyGeotab,
  // dan add-in Marketplace belum tentu terdaftar di sana — penolakannya bisa
  // berarti "tidak saya kenali", bukan "tidak ada".
  //
  // Karena itu hanya halaman yang keberadaannya DIPASTIKAN dari address bar
  // pelanggan yang boleh lolos di sini. Tebakan tidak. Bedanya nyata: tombol
  // menuju halaman yang terbukti ada paling buruk membuka halaman yang tidak
  // dilisensikan (MyGeotab menampilkan pesannya sendiri), sementara tombol
  // menuju nama karangan pasti gagal.
  return candidates.includes(CONFIRMED_VIDEO_PAGE) ? CONFIRMED_VIDEO_PAGE : null;
}

/** Tab "All" pada halaman Video. Terkonfirmasi dari address bar pelanggan. */
export const ALL_CATEGORIES = 0;

export interface VideoLinkInput {
  deviceId: string;
  /** Waktu insiden, ISO. */
  at: string;
  /** Lebar jendela di sekitar insiden, dalam menit. */
  windowMin?: number;
}

/**
 * Parameter yang BENAR-BENAR dibaca add-in Video, dibaca dari address bar
 * setelah pengguna menyaring manual:
 *
 *   #addin-geotabvideo-events,visibleCategoryId:30,deviceIds:185354,
 *     from:1785344400000,to:1785517199999
 *
 * Percobaan pertama mengirim dateRange:(startDate,endDate) ISO dan
 * selectedEntities:!((id:b1)) — bentuk yang dipakai halaman BAWAAN MyGeotab.
 * Keduanya masuk ke URL dan diabaikan sepenuhnya: chip tanggal tetap membaca
 * "Last 7 days" dan filter Assets tetap kosong. Klip yang benar tetap muncul
 * waktu itu, tapi hanya karena kebetulan cuma ada satu Near Collision dalam
 * tujuh hari — bukan karena penyaringannya bekerja.
 */
export interface VideoPageParams {
  /** Epoch milidetik. Bukan ISO — add-in ini memakai angka. */
  from: number;
  to: number;
  /**
   * 0 = tab "All". Dibaca dari address bar pelanggan saat menekan tab itu:
   *   #addin-geotabvideo-events,visibleCategoryId:0,showDismissed:false
   *
   * WAJIB dikirim. Tanpa ini nilainya MENEMPEL dari kunjungan sebelumnya, jadi
   * insiden benturan bisa mendarat di tab Tailgating dan tampak tidak punya
   * rekaman padahal klipnya ada. Kegagalan yang diam seperti itu justru yang
   * paling berbahaya di halaman berisi insiden keselamatan.
   */
  visibleCategoryId: number;
  /**
   * true, dan ini berbeda dari default MyGeotab.
   *
   * Tujuan tombol ini memvalidasi insiden, dan klip yang sudah di-dismiss orang
   * lain tetap bukti. Dengan false, klip yang pernah di-dismiss tidak muncul —
   * dan pengguna akan menyimpulkan "tidak ada rekaman" padahal ada.
   */
  showDismissed: boolean;
}

/**
 * Parameter halaman: satu jendela di sekitar insiden, bukan satu titik.
 *
 * Halaman Video menyaring per rentang, dan stempel waktu klip datang dari jalur
 * berbeda dengan stempel waktu ExceptionEvent — memintanya pada detik yang
 * persis sama hampir pasti menghasilkan daftar kosong. ±15 menit cukup lebar
 * untuk menampung selisih itu, cukup sempit untuk tidak mengubur klip yang
 * dicari di antara klip sepanjang hari.
 */
export function videoPageParams(input: VideoLinkInput): VideoPageParams | null {
  const ms = Date.parse(input.at);
  if (Number.isNaN(ms) || !input.deviceId) return null;
  const pad = (input.windowMin ?? 15) * 60 * 1000;
  // deviceIds SENGAJA tidak dikirim. Nilai aslinya (185354) bukan id perangkat
  // MyGeotab — id Geotab berbentuk "b3"/"b1A8" — melainkan id internal layanan
  // video, dan tidak ada jalan menurunkannya dari API MyGeotab. Mengirim id
  // Geotab ke sana akan menyaring ke kendaraan yang salah atau ke nol hasil,
  // dan keduanya lebih buruk daripada menyaring waktu saja: nama unitnya sudah
  // tertulis di baris insiden, jadi pengguna tetap bisa mengenalinya.
  return { from: ms - pad, to: ms + pad, visibleCategoryId: ALL_CATEGORIES, showDismissed: true };
}
