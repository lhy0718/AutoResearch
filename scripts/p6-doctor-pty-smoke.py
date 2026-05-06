#!/usr/bin/env python3
import os
import pty
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
    print(f"FAIL: pattern not found: {pattern}")
    if joined:
        print("---- recent buffer ----")
        print(joined[-6000:])
        print("-----------------------")
    raise SystemExit(1)


def send_line(fd: int, text: str) -> None:
    os.write(fd, text.encode("utf-8") + b"\n")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    default_workspace = repo_root.parent / ".autolabos-validation" / "p6-paper-ready-live"
    workspace = Path(os.environ.get("AUTOLABOS_P6_WORKSPACE", str(default_workspace))).resolve()
    output_dir = Path(os.environ.get("AUTOLABOS_P6_PREFLIGHT_OUT", str(repo_root / "outputs" / "p6-preflight"))).resolve()
    dist_main = repo_root / "dist" / "cli" / "main.js"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not workspace.exists():
        print(f"FAIL: workspace does not exist: {workspace}")
        return 1
    if not dist_main.exists():
        print(f"FAIL: expected built CLI at {dist_main}; run npm run build first")
        return 1

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
        buffer_text = wait_for(
            master_fd,
            r"(Research Brief workflow is ready|Start with /new to create a Research Brief\.|Add steering, or wait for the next (?:run or )?approval\.|collect_papers pending)",
            40,
            buffer_text,
        )
        send_line(master_fd, "/doctor")
        buffer_text = wait_for(master_fd, r"\[(OK|ATTN)\] readiness:", 40, buffer_text)
        buffer_text = wait_for(master_fd, r"\[(OK|FAIL)\] harness-validation:", 40, buffer_text)
        send_line(master_fd, "/quit")
        buffer_text = wait_for(master_fd, r"Bye", 10, buffer_text)
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

    output_path = output_dir / "doctor-pty-output.txt"
    output_path.write_text(buffer_text, encoding="utf-8")
    if "[ATTN] readiness:" in buffer_text or "[FAIL] harness-validation:" in buffer_text:
        print(f"FAIL: /doctor completed with attention/fail status; see {output_path}")
        return 1
    print(f"PASS: /doctor completed through Python PTY fallback; output={output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
