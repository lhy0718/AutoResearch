#!/usr/bin/env python3
import os
import pty
import json
import re
import select
import signal
import subprocess
import sys
import time
from pathlib import Path


def wait_for(fd: int, pattern: str, timeout: float, buffer_text: str) -> str:
    deadline = time.time() + timeout
    regex = re.compile(pattern, re.MULTILINE)
    joined = buffer_text
    if regex.search(joined):
        return joined
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0.1, deadline - time.time()))
        if not ready:
            continue
        try:
            data = os.read(fd, 8192)
        except OSError:
            break
        if not data:
            break
        joined += data.decode("utf-8", errors="ignore")
        if regex.search(joined):
            return joined
    print(f"FAIL: pattern not found before timeout: {pattern}")
    if joined:
        print("---- recent buffer ----")
        print(joined[-6000:])
        print("-----------------------")
    raise SystemExit(1)


def send_line(fd: int, text: str) -> None:
    os.write(fd, text.encode("utf-8") + b"\n")


def load_run_record(workspace: Path, run_id: str) -> dict:
    record_path = workspace / ".autolabos" / "runs" / run_id / "run_record.json"
    try:
        return json.loads(record_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"FAIL: could not inspect run record for expected run id: {exc}")
        raise SystemExit(1)


def current_node(record: dict) -> str:
    return str(record.get("currentNode") or record.get("graph", {}).get("currentNode") or "")


def node_status(record: dict, node: str) -> str:
    return str(record.get("graph", {}).get("nodeStates", {}).get(node, {}).get("status", ""))


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    default_workspace = repo_root.parent / ".autolabos-validation" / "p6-paper-ready-live"
    workspace = Path(os.environ.get("AUTOLABOS_P6_WORKSPACE", str(default_workspace))).resolve()
    output_dir = Path(os.environ.get("AUTOLABOS_P6_PREFLIGHT_OUT", str(repo_root / "outputs" / "p6-preflight"))).resolve()
    expected_run_id = os.environ.get("AUTOLABOS_P6_RUN_ID", "").strip()
    dist_main = repo_root / "dist" / "cli" / "main.js"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not workspace.exists():
        print(f"FAIL: workspace does not exist: {workspace}")
        return 1
    if not dist_main.exists():
        print(f"FAIL: expected built CLI at {dist_main}; run npm run build first")
        return 1
    if expected_run_id:
        runs_json = workspace / ".autolabos" / "runs" / "runs.json"
        try:
            if expected_run_id not in runs_json.read_text(encoding="utf-8"):
                print(f"FAIL: expected run id not present in run store: {expected_run_id}")
                return 1
        except Exception as exc:
            print(f"FAIL: could not inspect run store for expected run id: {exc}")
            return 1
        record = load_run_record(workspace, expected_run_id)
        node = current_node(record)
        if record.get("status") == "running" and node_status(record, node) == "running":
            output_path = output_dir / "p6-resume-check-output.txt"
            output_path.write_text(
                f"SKIP_TUI_ACTIVE_RUNNING run={expected_run_id} node={node}\n",
                encoding="utf-8"
            )
            print(
                "PASS: P6 run is actively running; skipped opening a TUI resume-check so the live node is not interrupted."
            )
            return 0

    env = os.environ.copy()
    env["COLUMNS"] = "220"
    env["LINES"] = "40"

    master_fd, slave_fd = pty.openpty()
    proc = subprocess.Popen(
        ["node", str(dist_main)],
        cwd=str(workspace),
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=os.setsid,
        close_fds=True,
    )
    os.close(slave_fd)

    buffer_text = ""
    try:
        node_pattern = (
            r"(collect_papers|analyze_papers|generate_hypotheses|design_experiments|"
            r"implement_experiments|run_experiments|analyze_results|figure_audit|review|write_paper)"
        )
        ready_pattern = (
            rf"({node_pattern} (needs_approval|pending|completed|failed)|"
            r"Add steering, or wait for the next (?:run or )?approval\.|Research Brief workflow is ready)"
        )
        buffer_text = wait_for(master_fd, ready_pattern, 40, buffer_text)
        send_line(master_fd, "/doctor")
        buffer_text = wait_for(master_fd, r"\[(OK|ATTN)\] readiness:", 60, buffer_text)
        buffer_text = wait_for(master_fd, r"\[(OK|FAIL)\] harness-validation:", 60, buffer_text)
        send_line(master_fd, "/quit")
        buffer_text = wait_for(master_fd, r"Bye", 20, buffer_text)
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        try:
            os.close(master_fd)
        except OSError:
            pass

    output_path = output_dir / "p6-resume-check-output.txt"
    output_path.write_text(buffer_text, encoding="utf-8")
    if "[ATTN] readiness:" in buffer_text or "[FAIL] harness-validation:" in buffer_text:
        print(f"FAIL: resumed /doctor completed with attention/fail status; see {output_path}")
        return 1
    print(f"PASS: P6 resumed session and /doctor completed; output={output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
