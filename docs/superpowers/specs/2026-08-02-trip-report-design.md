# Trip Report — perjalanan antar-geofence

Tanggal: 2026-08-02
Status: disetujui Aan, siap masuk rencana implementasi

## Masalah

Dashboard sudah punya linimasa trip per unit, tapi tidak ada yang menjawab
pertanyaan operasional paling dasar: **unit ini berangkat dari mana, tiba di
mana, berapa lama, berapa jauh, dan habis berapa BBM.**

MyGeotab menyimpan `Trip` sebagai kontak ON → kontak OFF. Satu perjalanan
Cikarang → Tanjung Priok yang mampir isi BBM dan makan tercatat sebagai **tiga
trip terpisah**, dua di antaranya berawal dan berakhir bukan di geofence mana
pun. Membaca trip mentah tidak memberi gambaran perjalanan.

Tujuan: menu baru **"Trip Report"** tepat di bawah "Ringkasan", berisi tabel
perjalanan antar-zona terdaftar.

## Keputusan yang sudah diambil

| Pertanyaan | Keputusan |
|---|---|
| Satu baris mewakili apa | **Satu perjalanan antar-zona**, hasil merangkai beberapa Trip |
| Perjalanan yang tidak berujung di zona | **Tidak ditampilkan sebagai baris**, tapi diringkas satu baris ("N perjalanan lain berakhir di luar zona terdaftar, total X km") |
| Pulang-pergi (zona asal = zona tujuan) | **Ditampilkan** sebagai "Cikarang → Cikarang" — pola paling umum di armada distribusi |
| Ambang "tiba" | Berhenti **≥ 15 menit** di dalam zona; bisa diatur pengguna |
| Nilai BBM | Hanya bila benar-benar terukur; parsial → `—` |

## Pendekatan

**Dipilih: resolusi dari titik awal/akhir Trip.** `TripDTO` sudah membawa
`startLat/startLon` dan `stopLat/stopLon`; `ZoneDTO` sudah membawa poligonnya;
`pointInPolygon` di `src/utils/geo.ts` sudah ada dan sudah ter-check. **Tidak ada
fetcher baru sama sekali.**

Ditolak:
- **Telusuri breadcrumb `LogRecord`.** Akurat sampai bisa mendeteksi zona yang
  hanya dilewati, tapi `fetchLogRecords` dibatasi 5.000 baris (`MAX_LIMIT`);
  untuk armada nyata dalam 7 hari itu jauh dari cukup dan laporan akan terpotong
  diam-diam. Untuk "tiba di zona" yang dibutuhkan justru titik BERHENTI, dan itu
  persis `stopLat/stopLon`.
- **Rule `ZoneStop` MyGeotab.** Bergantung pelanggan membuat rule per zona.
  Halaman Safety baru saja membuktikan rule sering tidak ada. Terlalu rapuh.

## Arsitektur

Mengikuti pola modul lain di project ini: satu modul **murni** (bisa dijalankan
`tsx`) + satu view yang mengurus fetch/DOM.

```
fetchZones   (cache 30m) ─┐
fetchTrips   (rentang+grup)┼→ analytics/trip-report.ts  (MURNI)
fetchDevices              ┤     resolveZone(titik, zona)
[BBM opsional: probe +    ┘     buildJourneys(trips, zona, opsi)
 fetchStatusData +               summariseUnmatched(...)
 fuelPerTrip]                    → JourneyRow[]
```

### `src/analytics/trip-report.ts` (murni — tanpa DOM/Chart.js/fetcher)

```ts
export interface ZoneRef { id: string; name: string }

export interface JourneyRow {
  deviceId: string;
  deviceName: string;
  fromZone: ZoneRef;
  toZone: ZoneRef;
  departAt: string;      // ISO — mulai trip pertama rangkaian
  arriveAt: string;      // ISO — akhir trip terakhir rangkaian
  durationSec: number;   // arriveAt − departAt (TERMASUK berhenti di tengah)
  distanceKm: number;    // jumlah distance seluruh trip penyusun
  fuelL: number | null;  // null bila ada leg yang tidak terukur
  stops: number;         // jumlah berhenti antara berangkat dan tiba
  tripIds: string[];     // jejak audit
  isRoundTrip: boolean;  // fromZone.id === toZone.id
}

export function resolveZone(
  point: { lat: number; lon: number },
  zones: ZoneDTO[]
): ZoneRef | null;

export function buildJourneys(
  trips: TripDTO[],
  zones: ZoneDTO[],
  devices: DeviceLite[],
  opts: { dwellMinutes: number; fuelByTrip?: Record<string, number | null> }
): JourneyRow[];

/** Trip yang TIDAK menjadi bagian dari satu pun baris JourneyRow — termasuk
 *  rangkaian yang gugur karena zona asal atau tujuannya tidak diketahui. */
export function summariseUnmatched(
  trips: TripDTO[],
  journeys: JourneyRow[]
): { trips: number; distanceKm: number };
```

**`resolveZone` memilih zona TERKECIL yang memuat titik**, bukan yang pertama
ketemu. Depot sering berada di dalam zona kota; kalau ambil yang pertama, seluruh
laporan bisa terbaca "Jakarta → Jakarta". Ukuran dihitung dari luas bounding box
poligon — cukup untuk memilih yang lebih spesifik, tanpa perlu luas poligon asli.

**Aturan perangkaian `buildJourneys`:**
1. Kelompokkan trip per unit, urutkan menaik berdasarkan `start`.
2. Kumpulkan trip berurutan ke dalam satu rangkaian.
3. Rangkaian **ditutup** bila trip berhenti di dalam zona terdaftar **dan** jeda
   ke `start` trip berikutnya ≥ `dwellMinutes` (atau itu trip terakhir unit).
4. Zona asal = zona dari `start` trip **pertama** rangkaian.
5. Baris **hanya dikeluarkan** bila zona asal dan zona tujuan keduanya diketahui.
   Rangkaian yang gugur karena salah satunya tidak diketahui **tidak hilang
   diam-diam** — seluruh tripnya masuk hitungan `summariseUnmatched`, sehingga
   jumlah trip di tabel + ringkasan selalu sama dengan total trip pada rentang.
6. `fuelL` = jumlah `fuelByTrip` seluruh leg; **`null` bila ada satu leg pun yang
   `null`** — jumlah parsial akan terbaca sebagai hasil ukur padahal kurang.

### `src/views/trip-report.ts`

- Tabel: Unit · Dari (zona + jam) · Ke (zona + jam) · Durasi · Jarak (km) · BBM (L) · Berhenti.
- Diurutkan waktu berangkat terbaru dulu. Baris pulang-pergi diberi penanda halus.
- Input **ambang berhenti (menit)**, default 15, disimpan `localStorage` per
  database — mengubahnya **merender ulang tanpa fetch ulang** (pola yang sama
  dengan input rasio di modul BBM).
- Ringkasan di bawah tabel: "N perjalanan lain berakhir di luar zona terdaftar
  (total X km)".
- Refresh lewat `onFilterChangeVisible` (view tersembunyi tidak ikut fetch).
- Escape seluruh teks bebas (nama unit & nama zona berasal dari database pelanggan).

**Empty state — masing-masing menyebut sebabnya, bukan tabel kosong:**
| Kondisi | Pesan |
|---|---|
| Tidak ada zona terdaftar | "Belum ada geofence/zona terdaftar di database ini. Buat zona dulu di MyGeotab." |
| Ada zona, tidak ada trip | "Tidak ada perjalanan pada rentang tanggal ini." |
| Ada trip, tidak ada yang zona→zona | "Ada N perjalanan, tapi tidak ada yang berawal dan berakhir di zona terdaftar." |

### File lain yang tersentuh

- `src/views/registry.ts` — satu baris, ditaruh **setelah** `overview`.
- `src/styles/trip-report.css` — hanya custom property `--fa-*` yang sudah ada.
- `src/analytics/trip-report.check.ts` — check baru.
- `package.json` — daftarkan check baru ke script `check`.
- `dev/fixtures.ts` — zona yang dipakai fixture trip harus benar-benar memuat
  titik awal/akhir sebagian trip, jika tidak jalur zona→zona tidak pernah teruji.

## Yang sengaja TIDAK dibuat

- **Baris yang bisa dibuka** untuk melihat trip penyusunnya — Aan memilih opsi
  tanpa itu. `tripIds` tetap disimpan supaya bisa ditambahkan nanti tanpa
  mengubah bentuk data.
- Ekspor CSV, peta rute, dan deteksi zona yang hanya dilewati (bukan berhenti).

## Verifikasi

1. `npx tsc --noEmit` bersih.
2. `npm run check` — 20 check hijau, termasuk `trip-report.check.ts` yang menguji:
   - `resolveZone`: di dalam / di luar / **zona bertumpuk memilih yang terkecil**
   - rangkaian tidak putus oleh berhenti singkat, tapi putus saat ≥ ambang
   - pulang-pergi (A→A) muncul dan `isRoundTrip` bernilai true
   - perjalanan tanpa zona asal atau tujuan **tidak** dikeluarkan sebagai baris
   - `fuelL` menjadi `null` bila satu leg tidak terukur (bukan jumlah parsial)
   - input kosong → hasil kosong, tanpa NaN
3. Browser (Playwright) di `npm run dev`: menu **Trip Report** muncul tepat di
   bawah Ringkasan, tabel terisi, ubah ambang berhenti → jumlah baris berubah
   **tanpa request baru**, dan ketiga empty state bisa dipicu.
4. `npm run build`, deploy, verifikasi live seperti biasa.
