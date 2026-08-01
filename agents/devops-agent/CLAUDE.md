# CLAUDE.md — devops-agent

Baca root `CLAUDE.md` dulu. Divisi ini urus scaffold, build, dan deploy.

## Scope
1. **T1 — Scaffold**: Vite + TypeScript project vanilla (bukan template React/Vue). Setup `vite.config.ts` dengan output single-file bundle kalau memungkinkan (pakai `vite-plugin-singlefile` opsional) supaya `dashboard.html` self-contained dan gampang di-host statis.
2. **T11 — Build**: `npm run build` -> `tsc && vite build` -> hasil di `dist/`. Pastikan `dashboard.html` di dalam `dist/` reference asset dengan path relatif (bukan absolute) karena add-in bisa di-host di subpath manapun.
3. **T12 — Deploy**: Host `dist/` + `config.json` statis di VPS existing (sudah ada Docker Compose + Caddy untuk FMS-TMS di `jejakpantau.tech`). Tambahkan subdomain baru `addins.jejakpantau.tech` dengan Caddy static file server block, HTTPS otomatis via Caddy. `config.json` "files" field harus point ke URL public HTTPS ini.

## Larangan
- Jangan pakai framework berat (Next.js dll) — ini SPA kecil yang jalan di iframe, overhead framework besar tidak perlu
- Jangan taruh secret/API key apapun di repo — add-in ini tidak butuh API key (auth lewat host MyGeotab)

## Catatan hosting
MyGeotab mensyaratkan `config.json` "files" URL harus HTTPS dan CORS-friendly kalau add-in di-load dari domain berbeda dengan MyGeotab. Pastikan Caddy config set header CORS yang sesuai untuk asset di subdomain ini.
