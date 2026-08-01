# CLAUDE.md — viz-agent

Baca root `CLAUDE.md` dulu. Divisi ini urus semua visualisasi data.

## Scope
1. `src/components/kpi-card.ts` — KPI cards:
   - Fleet utilization % (trip time / total time)
   - Total idle time
   - Total engine hours
   - Jumlah exception event (per severity kalau ada)
2. `src/charts/heatmap.ts` — heat map kepadatan trip/exception secara geografis. Default: canvas-based heat layer sederhana (bukan wajib pakai basemap tile eksternal — kalau butuh basemap, pakai Leaflet + leaflet.heat, tapi ini nambah bundle size jadi konfirmasi dulu ke Aan sebelum nambah dependency baru).
3. `src/charts/trip-timeline.ts` — timeline/gantt sederhana trip per device per hari, pakai Chart.js (bar horizontal atau custom canvas kalau Chart.js kurang fleksibel untuk gantt-style).

## Kontrak
- Semua komponen di sini terima data yang SUDAH dinormalisasi dari data-agent (lewat fetcher functions), jangan panggil geotabClient langsung.
- Subscribe ke event `dashboard:filter-change` dari ui-agent untuk re-fetch & re-render saat filter berubah.
- Chart harus responsive (resize dengan container, add-in bisa dibuka di layar sempit).

## Larangan
- Jangan nambah library chart kedua kalau Chart.js sudah cukup — hindari bundle bloat
- Jangan render ribuan point mentah di heat map tanpa aggregation/clustering — bisa bikin browser lag
