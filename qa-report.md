# QA Report — Fleet Analytics Dashboard

Status: **checklist only, tidak ada yang sudah dites di database Geotab asli.** Sesi ini tidak
punya akses ke database MyGeotab manapun, jadi semua item di bawah adalah langkah manual yang
perlu Aan jalankan sendiri sebelum menganggap add-in ini production-ready. Jangan tandai item
manapun "done" tanpa benar-benar menjalankannya.

Yang SUDAH diverifikasi di sesi ini (bukan live-database testing, tapi bukan nol juga):
- `npx tsc --noEmit` bersih di seluruh `src/` dan `dev/`.
- Semua `*.check.ts` (retry logic, cache TTL, DTO mapping, date-range guard, resultsLimit cap,
  heatmap point aggregation, trip-timeline bar mapping, KPI math, addin lifecycle cleanup) lolos
  lewat `npx tsx`, kecuali yang butuh browser (CSS import) — itu diverifikasi lewat browser real
  di bawah.
- `npm run build` sukses, `dist/` berisi `dashboard.html` + `assets/*` + `icon.svg`, path asset
  relatif (`./assets/...`).
- **Dashboard di-render beneran di headless Chromium (Playwright) lawan data dummy** (`dev/`
  harness) — KPI cards, heat map (basemap OSM + heat layer), trip timeline (floating bars per
  device), dan filter bar semuanya terbukti render dan tidak ada JS error di console. Satu bug
  runtime nyata ketemu & diperbaiki lewat verifikasi ini (`window.geotab` undefined di luar host
  MyGeotab — sudah di-guard) dan satu bug visual (`beginAtZero` bikin trip-timeline bar tidak
  kelihatan — sudah diperbaiki). Ini BUKAN pengganti test di database asli — data dummy tidak
  merepresentasikan skema/volume Geotab yang sebenarnya.

## 1. Validasi config.json

- [ ] `name`, `supportEmail`, `version`, `items[].url`, `items[].path`, `items[].icon` semua ada
      (self-check: sudah, lihat `config.json` di root — semua field wajib terisi).
- [ ] `items[0].path` = `"ActivityLink/"` — cek muncul di posisi menu yang benar (sejajar Bulk
      Edit, Heat Map, dll) setelah add-in ter-load.
- [ ] `items[0].url` (`dashboard.html`) dan `items[0].icon` (`icon.svg`) resolve dengan benar
      relatif terhadap `files` base URL setelah di-deploy.

## 2. Load sebagai Local Add-In (tanpa hosting)

- [ ] System Settings > Add-Ins > Add > paste isi `config.json` sebagai "Local add-in".
- [ ] Add-in muncul di sidebar dengan icon & nama yang benar.
- [ ] Buka add-in — pastikan tidak ada error console, dashboard render dengan data ASLI dari
      database (bukan dummy).
- [ ] KPI cards menampilkan angka yang masuk akal dibanding data asli (utilization, idle time,
      engine hours, exception count) — cross-check manual dengan laporan MyGeotab bawaan.
- [ ] Heat map menampilkan basemap + heat layer dengan titik yang sesuai wilayah operasi fleet
      asli.
- [ ] Trip timeline menampilkan bar per device yang cocok dengan trip asli di rentang tanggal
      default (7 hari terakhir).
- [ ] Filter bar: ganti date range / group / zone → semua komponen re-fetch & re-render.
- [ ] Buka/tutup menu add-in berkali-kali (focus/blur cycle) — cek tidak ada memory leak /
      listener menumpuk (DevTools Performance/Memory tab).

## 3. Load via hosted config.json (produksi)

- [ ] `dist/` + `config.json` sudah ter-deploy ke URL HTTPS publik (di luar scope sesi ini — lihat
      T12 di `tasks.json`, belum dikerjakan).
- [ ] URL `config.json` bisa di-fetch MyGeotab tanpa CORS error.
- [ ] Add-in ter-load dengan cara yang sama seperti local add-in di atas, tapi lewat URL hosted.
- [ ] Cek CSP MyGeotab iframe tidak memblokir fetch tile OSM
      (`https://{s}.tile.openstreetmap.org/...`) — kalau diblokir, heat map basemap tidak akan
      muncul meski data-nya ada.

## 4. Performa

- [ ] Target load awal: KPI cards tampil <3 detik dari `initialize()`.
- [ ] Test dengan device group yang punya banyak unit (bukan 2-3 device dummy) — device_status,
      trip, logrecord dalam volume nyata.
- [ ] `fetchLogRecords` sudah di-cap `resultsLimit` (default 1000, hard cap 5000) — kalau device
      group besar butuh lebih dari itu untuk heat map yang representatif, ini jadi trade-off yang
      perlu direview (naikkan cap vs. performa).
- [ ] Cek `src/utils/cache.ts` (IndexedDB, TTL per entity) benar-benar mengurangi jumlah request
      berulang dalam satu sesi (Network tab, buka menu dua kali dalam rentang TTL yang sama).

## Di luar scope sesi ini (langkah lanjutan Aan)

- **Deploy VPS** (T12 di `tasks.json`): host `dist/` + `config.json` di `jejakpantau.tech`
  (subdomain `addins.jejakpantau.tech`, Caddy static + CORS header). Belum dikerjakan.
- **Live QA di database Geotab asli** (semua item di atas): butuh akses database yang tidak
  tersedia di sesi kerja ini.
- **leaflet.heat / OSM tile usage policy**: untuk trafik produksi, review kebijakan penggunaan
  tile OSM (rate limit mereka) — kalau add-in ini dipakai banyak user, pertimbangkan tile provider
  berbayar.
