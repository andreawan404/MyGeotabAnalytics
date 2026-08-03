// Helpers yang sebelumnya disalin ulang di tiap view: esc() ada 7 salinan dengan
// 3 implementasi berbeda, clamp() 4 salinan, Intl.NumberFormat('id-ID') dibuat
// ulang di 5+ tempat. Satu sumber, supaya perbedaan perilaku tidak bisa muncul
// lagi diam-diam.

const ESCAPE_RE = /[&<>"']/g;

/** Nama device, rule, zona dan diagnostic adalah teks bebas milik pelanggan yang
 *  masuk ke innerHTML. Entity numerik dipakai (bukan tabel &amp;/&lt;) karena itu
 *  versi paling ketat dari tujuh salinan sebelumnya — satu-satunya yang ikut
 *  meng-escape kutip tunggal, yang penting untuk atribut ber-quote tunggal. */
export function esc(value: string): string {
  return String(value).replace(ESCAPE_RE, (c) => `&#${c.charCodeAt(0)};`);
}

/** Nilai di luar rentang ATAU non-finite jatuh ke fallback. Dipakai semua knob
 *  localStorage: nilai korup dari private mode tidak boleh jadi NaN di layar. */
export function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Armada kosong / rentang nol detik tidak boleh pernah mencetak "NaN" atau "∞"
 *  di depan pelanggan. Semua formatter di bawah lewat sini dulu. */
export function fin(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

const nfInt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nfUpto1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const nf1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const int = (n: number): string => nfInt.format(fin(n));
/** Desimal wajib — kolom angka rata dan tidak "loncat" antar baris. */
export const one = (n: number): string => nf1.format(fin(n));
export const two = (n: number): string => nf2.format(fin(n));
/** Desimal hanya kalau ada — "12 km", bukan "12,0 km". */
export const upto1 = (n: number): string => nfUpto1.format(fin(n));

/** Chart.js dan Leaflet butuh string warna konkret, tidak bisa membaca CSS var.
 *  Baca token dari dashboard.css supaya tidak ada biru kedua yang hidup sendiri. */
export function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback; // check file jalan di tsx, tanpa DOM
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Urutan nomor polisi. `numeric` yang menentukan: tanpa itu "B 10000 XX" jatuh
 * sebelum "B 9374 TFY" karena "1" < "9" secara leksikal.
 *
 * Nama unit adalah teks bebas yang diketik pelanggan di MyGeotab, jadi isinya
 * campur — plat Indonesia ("B 9875 UEX") berdampingan dengan nomor rangka
 * ("MHCFVR34USJ001916"). Perbandingan natural menangani keduanya tanpa perlu
 * mem-parse format plat, yang toh akan gagal pada armada yang menamai unitnya
 * dengan cara lain.
 */
export function comparePlates(a: string, b: string): number {
  return a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' });
}

/**
 * Pencocokan pencarian unit: abaikan besar-kecil huruf DAN semua karakter bukan
 * huruf/angka, sehingga "b9875" dan "B 9875" sama-sama menemukan "B 9875 UEX".
 * Orang mengetik plat tanpa spasi; memaksa mereka menebak spasinya membuat
 * kolom pencarian terasa rusak.
 */
export function matchesPlate(name: string, query: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const q = norm(query);
  return q === '' || norm(name).includes(q);
}

/** Durasi ringkas ala Indonesia: "3j 20m". Detik negatif diperlakukan nol. */
export function durationHm(totalSec: number): string {
  const s = Math.max(0, fin(totalSec));
  return `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
}
