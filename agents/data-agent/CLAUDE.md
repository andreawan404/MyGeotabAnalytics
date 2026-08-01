# CLAUDE.md — data-agent

Baca root `CLAUDE.md` dulu. Ini context tambahan khusus divisi data.

## Scope
Semua interaksi ke MyGeotab API. Tanggung jawab:
1. `src/api/geotabClient.ts` — wrapper tunggal di atas `api.call()` / `api.multiCall()`.
   - Export function `callApi(method, params)` dan `multiCall(calls[])`
   - Handle error MyGeotab (format: `{ name, message, errors }`) — jangan biarkan unhandled promise rejection
   - Retry sederhana (max 2x) untuk error transient (timeout/network), TIDAK retry untuk error validasi
2. `src/api/fetchers/*.ts` — satu file per entity:
   - `trip.ts` — Get Trip by device + date range
   - `logrecord.ts` — Get LogRecord (breadcrumb GPS) — HATI-HATI volume besar, selalu pakai date range + resultsLimit
   - `device-status.ts` — Get DeviceStatusInfo (real-time status per device)
   - `exception-event.ts` — Get ExceptionEvent (speeding, harsh braking, dll)
   - `zone.ts` — Get Zone (geofence)
3. Normalisasi output ke shape internal yang konsisten (jangan expose raw MyGeotab response ke viz-agent, buat DTO sederhana per entity)

## Larangan
- Jangan panggil `api.call` di luar `geotabClient.ts`
- Jangan fetch LogRecord tanpa batasan tanggal — bisa jutaan row dan bikin browser hang
- Jangan hardcode credential/database name

## Referensi
- Entity reference: https://developers.geotab.com/myGeotab/apiReference/objects/Trip (dan entity lain sejenis)
- multiCall docs: https://developers.geotab.com/myGeotab/guides/multicallSample
