// MediaFile — klip dan foto dari kamera (GO Focus dan integrasi kamera lain).
//
// ENTITY OPSIONAL, dengan dua lapis ketidakpastian sekaligus:
//
// 1. Hak akses. Sebagian besar database tidak punya lisensi video sama sekali,
//    dan `Get MediaFile` akan menolak. Itu keadaan normal, bukan kerusakan —
//    pola penanganannya sama persis dengan dvir-log.ts dan fuel-transaction.ts.
//
// 2. Apakah GO Focus benar-benar MENERBITKAN ke sini. Dokumentasi Geotab
//    memastikan entity dan pencariannya ada, tapi TIDAK memastikan kamera milik
//    Geotab sendiri mengisinya untuk pihak ketiga — halaman Video Events bawaan
//    MyGeotab bisa saja memakai jalur internal. Itulah yang sedang diuji modul
//    ini, dan kenapa DTO-nya sengaja tidak menormalkan apa pun.
//
// ponytail: mediaType/status/solutionId disimpan APA ADANYA sebagai string.
// Memetakannya ke enum rapi sekarang berarti menebak nilai yang belum pernah
// kita lihat, lalu membuang yang tidak cocok ke 'unknown' — persis cara sebuah
// probe berbohong. Normalkan setelah tahu nilai aslinya.

import { callApi } from '../geotabClient';
import { getCached, setCached, buildCacheKey } from '../../utils/cache';
import { groupDeviceSearch, restrictToGroup } from './search';

/** Media dibaca sekali per rentang untuk seluruh armada, jadi TTL-nya boleh
 *  sependek data yang cepat berubah — klip baru masuk sepanjang hari. */
const TTL_MS = 5 * 60 * 1000;
const RESULTS_LIMIT = 5000;

export interface MediaFileDTO {
  id: string;
  deviceId: string;
  /** Awal & akhir rentang waktu yang DILIPUT klip, bukan waktu unggahnya. */
  fromDate: string;
  toDate: string;
  /** Mentah: 'Video' | 'Image' | 'Application' | 'Unknown' — atau apa pun. */
  mediaType: string;
  /** Mentah. Status pemrosesan; klip yang belum terunggah tidak bisa diputar. */
  status: string;
  /** Penanda integrasi sumbernya. Inilah yang memberi tahu apakah GO Focus
   *  yang menerbitkan, atau kamera pihak ketiga. */
  solutionId: string | null;
  thumbnailCount: number;
}

function toDTO(raw: any): MediaFileDTO {
  return {
    id: String(raw?.id ?? ''),
    deviceId: raw?.device?.id ?? '',
    fromDate: raw?.fromDate ?? '',
    toDate: raw?.toDate ?? '',
    // String(...) bukan hiasan: beberapa entity Geotab mengembalikan enum
    // sebagai objek {id}, dan probe yang mencetak "[object Object]" tidak
    // memberi tahu apa pun.
    mediaType: raw?.mediaType?.id ?? (raw?.mediaType != null ? String(raw.mediaType) : ''),
    status: raw?.status?.id ?? (raw?.status != null ? String(raw.status) : ''),
    solutionId: raw?.solutionId != null ? String(raw.solutionId) : null,
    thumbnailCount: Array.isArray(raw?.thumbnails) ? raw.thumbnails.length : 0,
  };
}

// --- probe akses ------------------------------------------------------------
//
// fetchMediaFiles di bawah SENGAJA menelan error (pola entity opsional), dan
// itu benar untuk jalur render — halaman tidak boleh jatuh hanya karena
// database ini tidak punya video. Tapi untuk diagnosa, penelanan itu justru
// menghapus jawabannya: "hak akses ditolak" jadi terlihat persis sama dengan
// "memang tidak ada klip". Fungsi ini TIDAK menelan apa pun.

/** Berapa baris yang diminta saat menanyakan "ada MediaFile sama sekali?".
 *  Kecil karena yang dicari cuma ada/tidak ada, bukan datanya. */
const PROBE_LIMIT = 50;

export interface MediaAccessProbe {
  /** `denied` = API menolak (hak akses/lisensi). `ok` = panggilan berhasil,
   *  apa pun jumlah barisnya. */
  status: 'ok' | 'denied' | 'error';
  /** Jumlah MediaFile TANPA filter tanggal maupun grup — inilah yang memisahkan
   *  "rentangnya salah" dari "database ini memang tidak punya video". */
  anyCount: number;
  /** anyCount menyentuh plafon: bacalah sebagai "setidaknya sekian". */
  capped: boolean;
  errorName: string | null;
  errorMessage: string | null;
}

/** Nama exception Geotab yang berarti "boleh bertanya, tapi tidak berhak". */
const DENIED_RE = /InvalidUser|Security|Permission|NotAuthorized|Unauthorized/i;

export async function probeMediaAccess(params: { database: string }): Promise<MediaAccessProbe> {
  const key = buildCacheKey(params.database, 'media-access-probe');
  const cached = await getCached<MediaAccessProbe>(key);
  if (cached) return cached;

  let result: MediaAccessProbe;
  try {
    // Tanpa `search` sama sekali: pertanyaannya "apakah entity ini terisi di
    // database ini", bukan "apa yang terjadi pada rentang yang sedang dilihat".
    const raw = await callApi<any[]>('Get', { typeName: 'MediaFile', resultsLimit: PROBE_LIMIT });
    result = {
      status: 'ok',
      anyCount: Array.isArray(raw) ? raw.length : 0,
      capped: Array.isArray(raw) && raw.length >= PROBE_LIMIT,
      errorName: null,
      errorMessage: null,
    };
  } catch (err: any) {
    const name = String(err?.name ?? err?.constructor?.name ?? 'Error');
    result = {
      status: DENIED_RE.test(name) || DENIED_RE.test(String(err?.message ?? '')) ? 'denied' : 'error',
      anyCount: 0,
      capped: false,
      errorName: name,
      errorMessage: String(err?.message ?? err ?? '(tanpa pesan)'),
    };
  }

  await setCached(key, result, TTL_MS);
  return result;
}

let warned = false;

/**
 * SATU panggilan untuk seluruh rentang, tidak pernah per insiden.
 *
 * Feed insiden dibatasi 100 baris; memanggil per baris akan menembus rate limit
 * pada armada sungguhan (aturan 6 root CLAUDE.md). Penyambungan ke insiden
 * dikerjakan di klien dari satu daftar ini.
 */
export async function fetchMediaFiles(params: {
  database: string;
  fromDate: string;
  toDate: string;
  groupId?: string;
}): Promise<MediaFileDTO[]> {
  const key = buildCacheKey(params.database, 'media-file', params.fromDate, params.toDate, params.groupId ?? '');
  const cached = await getCached<MediaFileDTO[]>(key);
  if (cached) return cached;

  const raw = await callApi<any[]>('Get', {
    typeName: 'MediaFile',
    search: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...groupDeviceSearch(params.groupId),
    },
    resultsLimit: RESULTS_LIMIT,
  }).catch((err) => {
    if (!warned) {
      warned = true;
      console.warn('fetchMediaFiles: MediaFile tidak tersedia, dianggap kosong', err);
    }
    return [] as any[];
  });

  // Keanggotaan grup ditegakkan di klien: search-nya diabaikan server (search.ts).
  const scoped = await restrictToGroup(raw, params.database, params.groupId);
  const dtos = scoped.map(toDTO);
  await setCached(key, dtos, TTL_MS);
  return dtos;
}
