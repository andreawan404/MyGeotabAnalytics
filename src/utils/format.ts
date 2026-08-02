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

/** Durasi ringkas ala Indonesia: "3j 20m". Detik negatif diperlakukan nol. */
export function durationHm(totalSec: number): string {
  const s = Math.max(0, fin(totalSec));
  return `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
}
