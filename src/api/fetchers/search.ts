// Membatasi hasil ke sebuah Group.
//
// SEJARAHNYA, karena ini sudah salah dua kali:
//
// 1. `groupSearch: [{id}]` bukan properti TripSearch/ExceptionEventSearch, dan
//    MyGeotab DIAM-DIAM MENGABAIKAN properti search yang tidak dikenalnya —
//    memilih Group di filter bar tidak menyaring apa pun.
// 2. Diganti ke `deviceSearch: { groups: [{id}] }` yang ada di dokumentasi SDK.
//    Ternyata masih diabaikan juga pada database sungguhan: memilih satu grup
//    tetap memunculkan 562 unit, dan sebagian besar barisnya berlabel id
//    perangkat mentah ("b1A8") — bukti bahwa Device tersaring sementara Trip
//    tidak, karena nama hanya bisa dipetakan dari daftar Device yang tersaring.
//
// Karena itu penyaringannya sekarang TIDAK boleh bergantung pada server.
// Properti search tetap dikirim (kalau dihormati, payload-nya mengecil), tapi
// keanggotaan grup ditegakkan lagi di sisi klien terhadap daftar Device grup
// itu. Pola yang sama sudah dipakai device.ts untuk rentang tanggal: kirim ke
// server, lalu terapkan sendiri.
//
// Ini bukan sekadar soal tampilan. Sebelum ini, memilih satu grup tetap
// memberi angka SELURUH armada di KPI utilisasi, Safety, BBM dan Keamanan —
// angka yang salah tanpa satu pun tanda bahwa ia salah.

import { fetchDevices } from './device';

export function groupDeviceSearch(groupId?: string): object {
  return groupId ? { deviceSearch: { groups: [{ id: groupId }] } } : {};
}

/**
 * Menyaring baris mentah Geotab ke perangkat yang benar-benar anggota grup.
 * Murni — tidak menyentuh jaringan, jadi bisa diuji sendiri.
 *
 * Baris tanpa perangkat dibuang saat grup dipilih: baris yang tidak bisa
 * dikaitkan ke unit mana pun tidak bisa dibuktikan anggota grup itu, dan
 * menahannya sama saja mengembalikan kebocoran yang sedang diperbaiki.
 */
export function filterByDeviceIds<T extends { device?: { id?: string } | null }>(
  rows: T[],
  allowed: Set<string>
): T[] {
  return rows.filter((r) => {
    const id = r.device?.id;
    return typeof id === 'string' && allowed.has(id);
  });
}

/**
 * Menegakkan keanggotaan grup pada hasil apa pun yang punya `device.id`.
 *
 * Tanpa groupId, baris dikembalikan apa adanya — tidak ada fetch tambahan.
 * Dengan groupId, daftar Device grup diambil TANPA rentang tanggal: yang
 * dibutuhkan hanya "unit ini anggota grup atau bukan". Menyaringnya per tanggal
 * justru akan membuang perjalanan sah milik unit yang sudah dinonaktifkan di
 * tengah rentang. Panggilannya di-cache 30 menit dan dipakai bersama seluruh
 * fetcher, jadi biayanya satu kali per (database, grup).
 */
export async function restrictToGroup<T extends { device?: { id?: string } | null }>(
  rows: T[],
  database: string,
  groupId?: string
): Promise<T[]> {
  if (!groupId) return rows;
  try {
    const devices = await fetchDevices({ database, groupId });
    // Grup kosong (atau Device yang juga tidak tersaring server) sengaja tidak
    // memicu penyaringan: mengembalikan nol baris di sini akan mengubah bug
    // "terlalu banyak data" jadi "halaman kosong tanpa sebab", yang lebih buruk.
    if (devices.length === 0) return rows;
    return filterByDeviceIds(rows, new Set(devices.map((d) => d.id)));
  } catch (err) {
    // Daftar Device gagal diambil: lebih baik menampilkan terlalu banyak
    // daripada tidak menampilkan apa-apa — asal tercatat.
    console.warn('restrictToGroup: daftar device grup gagal diambil, filter grup dilewati', err);
    return rows;
  }
}
