# mygeotab-analytics-addin

Scaffold project + orchestration untuk MyGeotab Add-In "Fleet Analytics Dashboard", dikerjakan Claude Code secara multi-agent (Level 3 orchestration — sama pola dengan setup FMS-TMS).

## Struktur
```
mygeotab-analytics-addin/
├── CLAUDE.md              # shared context — WAJIB dibaca semua agent
├── tasks.json             # dependency-ordered task queue
├── orchestrator.py        # queue engine, dispatch task ke Claude Code CLI
├── config.json             # manifest MyGeotab Add-In
├── package.json
├── agents/
│   ├── data-agent/CLAUDE.md
│   ├── integration-agent/CLAUDE.md
│   ├── ui-agent/CLAUDE.md
│   ├── viz-agent/CLAUDE.md
│   ├── devops-agent/CLAUDE.md
│   └── qa-agent/CLAUDE.md
└── src/                    # akan diisi orchestrator sesuai tasks.json
    ├── api/
    ├── components/
    ├── charts/
    ├── styles/
    └── utils/
```

## Cara pakai di VS Code
1. Buka folder ini di VS Code, pastikan Claude Code CLI (`claude`) sudah login.
2. Cek urutan eksekusi dulu tanpa dispatch beneran:
   ```bash
   python orchestrator.py --dry-run
   ```
3. Jalankan full pipeline (task berjalan sesuai dependency di `tasks.json`):
   ```bash
   python orchestrator.py
   ```
4. Kalau mau kerjain satu task manual/re-run:
   ```bash
   python orchestrator.py --task T3
   ```
5. Status tiap task ke-update otomatis di `tasks.json` (`pending` -> `in_progress` -> `done`/`failed`). Kalau ada yang `failed`, orchestrator berhenti — review manual, fix, ubah status balik ke `pending`, jalankan ulang.

## Catatan
- `orchestrator.py` memanggil `claude -p` (headless/print mode) per task — kalau mau lebih interaktif (review tiap step), jalankan task satu-satu pakai `--task <ID>` dan buka Claude Code interactive session manual sambil ngasih prompt dari `agents/<agent>/CLAUDE.md` + task terkait.
- Sebelum mulai T1, install dependency dulu setelah scaffold ada: `npm install`.
- Testing add-in butuh akses ke database Geotab beneran (System Settings > Add-Ins) — tidak bisa di-test 100% offline.
