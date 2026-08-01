# CLAUDE.md — Shared Context: MyGeotab Analytics Dashboard Add-In

Ini adalah context layer utama. SEMUA subagent (di `agents/*/CLAUDE.md`) wajib membaca file ini dulu sebelum eksekusi task apapun. Jangan kontradiksi keputusan arsitektur di sini.

## Apa yang dibangun
Add-In analytics dashboard untuk MyGeotab (my.geotab.com), muncul sebagai menu item baru di sidebar (sejajar dengan Bulk Edit, Heat Map, IOX Output, Ride View, dst — lihat screenshot referensi). Fungsinya: agregasi & visualisasi data fleet (trip, engine hours, fuel, exceptions, zone/geofence) dalam satu dashboard custom yang tidak tersedia di reporting bawaan MyGeotab.

Konteks bisnis: Aan adalah Geotab reseller (JPT), sudah punya integrasi Geotab lain (Apps Script → Google Sheets, Python middleware ke Unilever Digilog). Add-in ini untuk internal ops / value-add ke klien fleet.

## Keputusan arsitektur (JANGAN diubah tanpa approval eksplisit)
1. **Client-side only add-in** — mengikuti pola resmi MyGeotab Add-In (JS/HTML/CSS, load via `config.json`, jalan di iframe dalam MyGeotab UI). TIDAK ada backend custom untuk versi awal — semua fetch data langsung via `geotab.api` yang di-inject oleh host MyGeotab lewat `addin.js` lifecycle. Kalau nanti butuh heavy computation/caching lintas sesi, itu jadi task terpisah (opsi: proxy via backend NestJS FMS-TMS yang sudah ada — TIDAK dikerjakan di scope ini).
2. **Build tool**: Vite (vanilla TS, bukan framework berat) — output single bundle ke `dist/`, di-reference di `config.json`.
3. **Auth**: tidak ada login terpisah. Session/credentials diteruskan otomatis oleh MyGeotab host lewat parameter `api` pada `initialize(api, state, callback)`. Add-in TIDAK boleh menyimpan credential sendiri.
4. **Data source**: MyGeotab JS API (`api.call()` / `api.multiCall()`) — entity utama: `Trip`, `LogRecord`, `DeviceStatusInfo`, `ExceptionEvent`, `Zone`, `Device`, `Diagnostic`.
5. **Visualisasi**: Chart.js untuk chart standar (bar/line/KPI card), custom SVG/Canvas untuk heat map (opsional pakai leaflet.heat kalau butuh basemap).
6. **Rate limit awareness**: MyGeotab API punya limit request. WAJIB pakai `multiCall` untuk batching, dan cache hasil di `IndexedDB`/`localStorage` scoped per database name (bukan per user) untuk hindari re-fetch data yang sama berkali-kali dalam satu sesi.
7. **Menu placement**: `path: "ActivityLink/"` di config.json (menempel di menu utama kiri, sama seperti add-in bawaan lain).

## Convention penamaan
- File: kebab-case (`trip-summary-card.ts`)
- Komponen render function: camelCase, prefix `render` (`renderTripSummaryCard`)
- Semua komunikasi ke MyGeotab API lewat satu wrapper module: `src/api/geotabClient.ts` — subagent lain TIDAK boleh panggil `api.call` langsung, harus lewat wrapper ini.

## Divisi subagent
- `data-agent` — geotabClient wrapper, entity fetchers, data normalization
- `integration-agent` — addin.js lifecycle, state handling, caching layer
- `ui-agent` — layout shell, filter bar, theming sesuai MyGeotab
- `viz-agent` — chart components, KPI card, heat map, trip timeline
- `devops-agent` — Vite config, build, deploy ke VPS (Caddy, subdomain `jejakpantau.tech`)
- `qa-agent` — validasi config.json, test loading di MyGeotab, performance test

## Referensi resmi
- MyGeotab Add-In SDK docs: https://developers.geotab.com/myGeotab/addIns/developingAddIns
- API reference: https://developers.geotab.com/myGeotab/apiReference/objects/

## Definition of Done (project level)
- [ ] Add-in bisa di-load lokal via System Settings > Add-Ins > "Local add-in" (testing tanpa hosting)
- [ ] Add-in bisa di-load via hosted config.json (production)
- [ ] Dashboard render KPI utama + heat map + trip timeline dengan data real dari minimal 1 database Geotab
- [ ] Tidak ada API call di luar `geotabClient.ts`
- [ ] Build size wajar (<1MB bundle, tanpa framework berat)
