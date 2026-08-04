// Ringkasan probe MediaFile. MURNI — tanpa DOM, tanpa fetcher — supaya
// media-probe.check.ts jalan di bawah tsx seperti modul analytics lain.
//
// Tugas modul ini bukan menyembunyikan ketidaktahuan, tapi melaporkannya. Yang
// ingin dijawab: apakah GO Focus benar-benar menerbitkan klipnya ke MediaFile,
// dan kalau ya, apakah klip itu jatuh cukup dekat dengan insiden untuk dipakai
// memvalidasinya.
//
// Semua nilai enum dilaporkan APA ADANYA. Sebuah probe yang merapikan hasilnya
// lebih dulu tidak bisa memberi tahu apa yang sebenarnya ada di sana.

import type { MediaFileDTO } from '../api/fetchers/media-file';

/**
 * Jendela pencocokan insiden ke klip.
 *
 * ponytail: 30 detik adalah tebakan awal, bukan kebenaran. GO Focus umumnya
 * menyimpan beberapa detik sebelum dan sesudah pemicu, tapi stempel waktu klip
 * dan stempel waktu ExceptionEvent berasal dari dua jalur berbeda dan bisa
 * bergeser. Angka ini dilonggarkan setelah hasil probe terlihat.
 */
export const MATCH_WINDOW_SEC = 30;

export interface ProbeIncident {
  deviceId: string;
  at: string;
}

export interface MediaProbeResult {
  total: number;
  /** Berapa klip per nilai mediaType mentah. */
  byMediaType: Record<string, number>;
  byStatus: Record<string, number>;
  /** Tanpa solutionId dilaporkan sebagai '(tanpa solutionId)'. */
  bySolutionId: Record<string, number>;
  withThumbnail: number;
  deviceCount: number;
  /** Rentang waktu yang diliput seluruh klip — untuk melihat apakah medianya
   *  memang berada di rentang filter, atau jauh di luar. */
  earliest: string | null;
  latest: string | null;
  /** Insiden yang punya minimal satu klip dalam MATCH_WINDOW_SEC. */
  incidentsWithMedia: number;
  incidentsTotal: number;
}

function bump(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

/** Apakah klip meliput sebuah momen, dengan toleransi `windowSec` di kedua sisi.
 *  Klip punya durasi, jadi ini uji tumpang tindih rentang — bukan jarak dua titik. */
export function mediaCoversMoment(media: MediaFileDTO, atMs: number, windowSec: number): boolean {
  const from = Date.parse(media.fromDate);
  const to = Date.parse(media.toDate);
  if (Number.isNaN(from)) return false;
  // toDate rusak/absen: perlakukan klip sebagai satu titik di fromDate, jangan
  // jatuhkan seluruh baris hanya karena satu field hilang.
  const end = Number.isNaN(to) ? from : to;
  const pad = windowSec * 1000;
  return atMs >= from - pad && atMs <= end + pad;
}

export function summarizeMediaProbe(
  media: MediaFileDTO[],
  incidents: ProbeIncident[],
  windowSec = MATCH_WINDOW_SEC
): MediaProbeResult {
  const byMediaType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const bySolutionId: Record<string, number> = {};
  const devices = new Set<string>();
  let withThumbnail = 0;
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const m of media) {
    bump(byMediaType, m.mediaType || '(kosong)');
    bump(byStatus, m.status || '(kosong)');
    bump(bySolutionId, m.solutionId || '(tanpa solutionId)');
    if (m.deviceId) devices.add(m.deviceId);
    if (m.thumbnailCount > 0) withThumbnail++;

    const from = Date.parse(m.fromDate);
    const to = Date.parse(m.toDate);
    if (!Number.isNaN(from)) earliest = earliest === null ? from : Math.min(earliest, from);
    const end = Number.isNaN(to) ? from : to;
    if (!Number.isNaN(end)) latest = latest === null ? end : Math.max(latest, end);
  }

  // Dikelompokkan per unit lebih dulu: tanpa itu tiap insiden menyapu seluruh
  // daftar media, dan 100 insiden x ribuan klip jadi pemindaian sia-sia.
  const byDevice = new Map<string, MediaFileDTO[]>();
  for (const m of media) {
    if (!m.deviceId) continue;
    const list = byDevice.get(m.deviceId);
    if (list) list.push(m);
    else byDevice.set(m.deviceId, [m]);
  }

  let incidentsWithMedia = 0;
  for (const inc of incidents) {
    const atMs = Date.parse(inc.at);
    if (Number.isNaN(atMs)) continue;
    const list = byDevice.get(inc.deviceId);
    if (list?.some((m) => mediaCoversMoment(m, atMs, windowSec))) incidentsWithMedia++;
  }

  return {
    total: media.length,
    byMediaType,
    byStatus,
    bySolutionId,
    withThumbnail,
    deviceCount: devices.size,
    earliest: earliest === null ? null : new Date(earliest).toISOString(),
    latest: latest === null ? null : new Date(latest).toISOString(),
    incidentsWithMedia,
    incidentsTotal: incidents.length,
  };
}
