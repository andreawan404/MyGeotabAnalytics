#!/usr/bin/env python3
"""
orchestrator.py — Level 3 orchestration queue engine untuk mygeotab-analytics-addin.

Pola sama dengan orchestrator FMS-TMS: baca tasks.json, cari task yang semua
dependency-nya "done", dispatch ke Claude Code CLI dengan system prompt gabungan
(root CLAUDE.md + CLAUDE.md milik agent terkait), tunggu selesai, update status,
lanjut ke task berikutnya.

Requirement: Claude Code CLI ("claude") sudah terinstall & authenticated di
environment ini (jalankan dari VS Code integrated terminal).

Usage:
    python orchestrator.py             # jalankan semua task yang ready, berurutan
    python orchestrator.py --task T3   # jalankan satu task spesifik
    python orchestrator.py --dry-run   # tampilkan urutan eksekusi tanpa dispatch
"""

import json
import subprocess
import sys
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent
TASKS_FILE = ROOT / "tasks.json"
ROOT_CONTEXT = ROOT / "CLAUDE.md"
AGENTS_DIR = ROOT / "agents"
LOG_FILE = ROOT / "orchestrator.log"


def log(msg: str):
    line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def load_tasks() -> dict:
    with open(TASKS_FILE) as f:
        return json.load(f)


def save_tasks(data: dict):
    with open(TASKS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def get_ready_tasks(data: dict) -> list:
    """Task 'pending' yang semua depends_on-nya sudah 'done'."""
    status_map = {t["id"]: t["status"] for t in data["tasks"]}
    ready = []
    for t in data["tasks"]:
        if t["status"] != "pending":
            continue
        if all(status_map.get(dep) == "done" for dep in t["depends_on"]):
            ready.append(t)
    return ready


def build_prompt(task: dict) -> str:
    agent_context_path = AGENTS_DIR / task["agent"] / "CLAUDE.md"
    root_ctx = ROOT_CONTEXT.read_text()
    agent_ctx = agent_context_path.read_text() if agent_context_path.exists() else ""

    prompt = f"""Kamu adalah subagent "{task['agent']}" dalam project mygeotab-analytics-addin.

=== SHARED CONTEXT (root CLAUDE.md) ===
{root_ctx}

=== AGENT CONTEXT ({task['agent']}/CLAUDE.md) ===
{agent_ctx}

=== TASK ===
ID: {task['id']}
Judul: {task['title']}
Output yang diharapkan: {', '.join(task['output'])}

Kerjakan task ini SESUAI convention & keputusan arsitektur di shared context.
Jangan keluar dari scope task. Setelah selesai, ringkas perubahan file yang dibuat/diubah.
"""
    return prompt


def dispatch_task(task: dict) -> bool:
    """Panggil Claude Code CLI (headless print mode) untuk mengerjakan satu task.
    Return True kalau exit code 0 (dianggap sukses — tetap review manual outputnya)."""
    prompt = build_prompt(task)
    prompt_file = ROOT / f".task_{task['id']}_prompt.txt"
    prompt_file.write_text(prompt)

    log(f"Dispatch {task['id']} -> agent={task['agent']} :: {task['title']}")

    # Claude Code headless mode: `claude -p "<prompt>"` dijalankan dari root project
    # dir supaya file relative path konsisten dengan struktur di config.json.
    cmd = ["claude", "-p", "--", prompt]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)

    log(result.stdout[-2000:] if result.stdout else "(no stdout)")
    if result.returncode != 0:
        log(f"ERROR {task['id']}: {result.stderr[-1000:]}")
        return False
    return True


def run(target_task_id: str | None, dry_run: bool):
    data = load_tasks()

    while True:
        ready = get_ready_tasks(data)
        if target_task_id:
            ready = [t for t in ready if t["id"] == target_task_id]

        if not ready:
            remaining = [t["id"] for t in data["tasks"] if t["status"] == "pending"]
            if remaining:
                log(f"Tidak ada task ready. Masih pending (nunggu dependency): {remaining}")
            else:
                log("Semua task selesai.")
            break

        for task in ready:
            if dry_run:
                log(f"[DRY-RUN] would dispatch {task['id']} ({task['agent']}): {task['title']}")
                task["status"] = "done"  # simulate for dry-run ordering only
                continue

            task["status"] = "in_progress"
            save_tasks(data)

            success = dispatch_task(task)
            task["status"] = "done" if success else "failed"
            save_tasks(data)

            if not success:
                log(f"STOP: {task['id']} gagal. Perbaiki manual lalu jalankan ulang orchestrator.")
                return

        if target_task_id:
            break

    if dry_run:
        # jangan simpan perubahan status simulasi dry-run
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", help="Jalankan satu task ID spesifik (mis. T3)")
    parser.add_argument("--dry-run", action="store_true", help="Tampilkan urutan eksekusi tanpa dispatch")
    args = parser.parse_args()

    run(target_task_id=args.task, dry_run=args.dry_run)
