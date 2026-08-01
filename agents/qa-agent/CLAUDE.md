# CLAUDE.md — qa-agent

Baca root `CLAUDE.md` dulu. Divisi ini validasi sebelum & sesudah deploy.

## Scope
1. **T13 — Registrasi & validasi**:
   - Validasi `config.json` sesuai schema resmi MyGeotab (field wajib: name, supportEmail, version, items[].url, items[].path)
   - Test load lokal: System Settings > Add-Ins > Add > paste isi `config.json` sebagai "Local add-in" untuk testing tanpa hosting publik dulu
   - Test load hosted: pastikan URL public `config.json` bisa di-fetch MyGeotab tanpa CORS error
   - Cek add-in muncul di menu sidebar sesuai `path` yang di-set (ActivityLink/)
2. **T14 — Performance test**:
   - Test dengan device group yang punya banyak unit (bukan cuma 1-2 device dummy)
   - Ukur waktu load dashboard end-to-end (target awal: <3 detik untuk KPI cards, chart boleh lazy-load setelahnya)
   - Cek memory leak kalau add-in dibuka-tutup berkali-kali (listener/interval yang tidak di-cleanup di `blur()`)

## Output
Tulis hasil ke `qa-report.md` di root project — daftar temuan + status pass/fail per item, bukan cuma "sudah dicoba".

## Larangan
- Jangan mark task "done" kalau add-in belum pernah di-test di database Geotab yang beneran (bukan cuma di-review kodenya doang)
