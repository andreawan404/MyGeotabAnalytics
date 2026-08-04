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
export const VIDEO_PAGE_CANDIDATES = [
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
  if (typeof hasAccess !== 'function') return null;
  for (const page of candidates) {
    try {
      if (hasAccess(page)) return page;
    } catch {
      // Host boleh melempar untuk nama yang tidak dikenalnya. Itu jawaban
      // "tidak ada", bukan alasan menjatuhkan seluruh daftar.
    }
  }
  return null;
}

export interface VideoLinkInput {
  deviceId: string;
  /** Waktu insiden, ISO. */
  at: string;
  /** Lebar jendela di sekitar insiden, dalam menit. */
  windowMin?: number;
}

export interface VideoPageParams {
  dateRange: { startDate: string; endDate: string };
  /** Bentuk yang dipakai halaman MyGeotab lain untuk menyorot entity. */
  selectedEntities: { id: string }[];
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
  return {
    dateRange: {
      startDate: new Date(ms - pad).toISOString(),
      endDate: new Date(ms + pad).toISOString(),
    },
    selectedEntities: [{ id: input.deviceId }],
  };
}
