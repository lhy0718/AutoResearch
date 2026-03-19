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


def fail(message: str, buffer_text: str) -> None:
    print(message)
    if buffer_text:
        print("---- recent buffer ----")
        print(buffer_text[-4000:])
        print("-----------------------")
    raise SystemExit(1)


def wait_for(fd: int, pattern: str, timeout: float, buffer_text: str) -> str:
    deadline = time.time() + timeout
    regex = re.compile(pattern, re.MULTILINE)
    chunks = [buffer_text]
    joined = buffer_text
    while time.time() < deadline:
      remaining = max(0.1, deadline - time.time())
      ready, _, _ = select.select([fd], [], [], remaining)
      if not ready:
          continue
      try:
          data = os.read(fd, 4096)
      except OSError:
          break
      if not data:
          break
      text = data.decode("utf-8", errors="ignore")
      chunks.append(text)
      joined = "".join(chunks)
      if regex.search(joined):
          return joined
    fail(f"FAIL: pattern not found: {pattern}", joined)
    return joined


def send_line(fd: int, text: str) -> None:
    os.write(fd, text.encode("utf-8") + b"\n")


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: pending_smoke_without_expect.py <workdir> <run_id>")
        return 2

    workdir = Path(sys.argv[1]).resolve()
    query = "최근 5년 관련도 순으로 100개 수집해줘"
    expected_label = r"Collect papers \(limit=100, lastYears=5\)"
    repo_root = Path(__file__).resolve().parents[2]
    dist_main = repo_root / "dist" / "cli" / "main.js"
    if not dist_main.exists():
        print(f"FAIL: expected built CLI at {dist_main}")
        return 1

    env = os.environ.copy()
    env["COLUMNS"] = "220"
    env["LINES"] = "40"

    master_fd, slave_fd = pty.openpty()
    proc = subprocess.Popen(
        ["node", str(dist_main)],
        cwd=str(workdir),
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        preexec_fn=os.setsid,
        close_fds=True
    )
    os.close(slave_fd)

    try:
        buffer_text = ""
        buffer_text = wait_for(
            master_fd,
            r"(Research Brief workflow is ready|Add steering, or wait for the next run or approval\.|collect_papers pending)",
            40,
            buffer_text
        )
        send_line(master_fd, query)
        buffer_text = wait_for(master_fd, re.escape(f"Natural query: {query}"), 20, buffer_text)
        buffer_text = wait_for(master_fd, rf"Next step ready: {expected_label}\.", 20, buffer_text)
        send_line(master_fd, "n")
        buffer_text = wait_for(master_fd, rf"Canceled pending command: {expected_label}", 20, buffer_text)
        send_line(master_fd, "/quit")
        wait_for(master_fd, r"Bye", 10, buffer_text)
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
