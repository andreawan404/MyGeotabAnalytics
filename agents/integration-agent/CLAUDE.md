# CLAUDE.md — integration-agent

Baca root `CLAUDE.md` dulu. Divisi ini menjembatani add-in dengan host MyGeotab.

## Scope
1. `src/addin.ts` — entrypoint wajib sesuai spec MyGeotab Add-In:
   ```ts
   geotab.addin.fleetAnalyticsDashboard = function () {
     return {
       initialize: function (api, state, callback) {
         // simpan `api` & `state` ke module-level context, render shell awal
         callback();
       },
       focus: function (api, state) {
         // dipanggil setiap kali user buka menu ini — refresh data kalau perlu
       },
       blur: function () {
         // cleanup: clear interval/timer, unsubscribe listener
       }
     };
   };
   ```
2. `src/utils/cache.ts` — caching layer pakai IndexedDB:
   - Key di-scope per `state.database` (bukan per user) supaya data tidak campur antar tenant/database
   - TTL default 5 menit untuk data agregat, TTL lebih pendek untuk DeviceStatusInfo (real-time-ish)
   - Expose `getCached(key)` / `setCached(key, value, ttlMs)`
3. State management ringan: simpan filter aktif (date range, device group) di memory + localStorage per database, supaya persist antar `focus()`.

## Larangan
- Jangan asumsikan add-in punya akses network selain lewat `api` yang diberikan host (add-in jalan di iframe sandboxed)
- Jangan simpan credential — `api` object dari `initialize()` sudah authenticated, cukup pakai itu
- Jangan lupa cleanup di `blur()` — interval yang tidak di-clear bisa numpuk kalau user bolak-balik menu

## Referensi
- Add-in lifecycle & config.json spec: https://developers.geotab.com/myGeotab/addIns/developingAddIns
