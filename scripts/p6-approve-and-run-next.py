#!/usr/bin/env python3
import os
import pty
import json
import re
import select
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


STOP_PATTERN = (
    r"(Run paused:|Research stopped:|Research finished:|Human input required:|"
    r"Node [a-z_]+ failed:|Node [a-z_]+ finished:|Research continued:|"
    r"Use /approve to continue|No pending approval)"
)
STOP_READY_AFTER_STATUS_ERROR_PATTERN = (
    r"Add steering, or wait for the next (?:run or )?approval\."
)
LIVE_INTERACTIVE_PROMPT_PATTERN = (
    r"(?:Add steering, or wait for the next (?:run or )?approval\.|"
    r"Add steering to redirect the current run\.)"
)
READY_PATTERN = (
    r"(needs_approval|running|pending|Canceled by user|"
    r"Add steering, or wait for the next (?:run or )?approval\.|"
    r"Research Brief workflow is ready)"
)
DOCTOR_READY_PATTERN = r"(\[(OK|ATTN)\] readiness:|runs-dir-write:|codex-research-backend-model:|workspace-config:)"
STOP_BOUNDARY_STABLE_SECONDS = 2.0
HANDOFF_GRACE_SECONDS = 5.0


class WaitTimeout(Exception):
    def __init__(self, pattern: str, transcript: str):
        super().__init__(pattern)
        self.pattern = pattern
        self.transcript = transcript


def wait_for(fd: int, pattern: str, timeout: float, buffer_text: str, *, search_existing: bool = True) -> str:
    deadline = time.time() + timeout
    regex = re.compile(pattern, re.MULTILINE)
    joined = buffer_text
    searchable = buffer_text if search_existing else ""
    if search_existing and regex.search(searchable):
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
        chunk = data.decode("utf-8", errors="ignore")
        joined += chunk
        searchable += chunk
        if regex.search(searchable):
            return joined
    print(f"FAIL: pattern not found before timeout: {pattern}")
    if joined:
        print("---- recent buffer ----")
        print(joined[-6000:])
        print("-----------------------")
    raise WaitTimeout(pattern, joined)


def send_line(fd: int, text: str) -> None:
    os.write(fd, text.encode("utf-8") + b"\n")


def stop_pattern_for_node(node: str) -> str:
    escaped = re.escape(node)
    return (
        r"(Run paused:|Research stopped:|Research finished:|Human input required:|"
        rf"Node {escaped} failed:|Node {escaped} finished:|Research continued:|"
        r"Use /approve to continue|No pending approval)"
    )


def node_status_error_pattern(node: str) -> str:
    return rf"x Status:\s+{re.escape(node)} error:"


def has_node_status_error_stop_text(text: str, node: str) -> bool:
    status_match = re.search(node_status_error_pattern(node), text, re.MULTILINE)
    if not status_match:
        return False
    return bool(re.search(
        STOP_READY_AFTER_STATUS_ERROR_PATTERN,
        text[status_match.end():],
        re.MULTILINE
    ))


def load_run_record(workspace: Path, run_id: str) -> dict:
    record_path = workspace / ".autolabos" / "runs" / run_id / "run_record.json"
    try:
        return json.loads(record_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"FAIL: could not read run record: {record_path}: {exc}")
        raise SystemExit(1)


def try_load_run_record(workspace: Path, run_id: str) -> dict | None:
    record_path = workspace / ".autolabos" / "runs" / run_id / "run_record.json"
    try:
        return json.loads(record_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def node_status(record: dict, node: str) -> str:
    return str(record.get("graph", {}).get("nodeStates", {}).get(node, {}).get("status", ""))


def node_state(record: dict, node: str) -> dict:
    state = record.get("graph", {}).get("nodeStates", {}).get(node, {})
    return state if isinstance(state, dict) else {}


def node_has_persisted_failure(record: dict, node: str) -> bool:
    state = node_state(record, node)
    return bool(str(state.get("lastError") or "").strip())


def current_node(record: dict) -> str:
    return str(record.get("currentNode") or record.get("graph", {}).get("currentNode") or "")


def is_active_running(record: dict) -> bool:
    current = current_node(record)
    return (
        bool(current)
        and record.get("status") == "running"
        and node_status(record, current) == "running"
        and not node_has_persisted_failure(record, current)
    )


def is_target_node_running(record: dict | None, node: str) -> bool:
    if not record:
        return False
    return (
        record.get("status") == "running"
        and current_node(record) == node
        and node_status(record, node) == "running"
        and not node_has_persisted_failure(record, node)
    )


def active_running_node(record: dict | None) -> str:
    if not record or not is_active_running(record):
        return ""
    return current_node(record)


def running_node_after_fresh_handoff(record: dict | None) -> str:
    if not record or record.get("status") != "running":
        return ""
    current = current_node(record)
    if current and node_status(record, current) == "running":
        return current
    return ""


def running_handoff_node(record: dict | None) -> str:
    active_node = active_running_node(record)
    if active_node:
        return active_node
    return running_node_after_fresh_handoff(record)


def wait_for_running_handoff(
    workspace: Path,
    run_id: str,
    previous_node: str,
    grace_seconds: float = HANDOFF_GRACE_SECONDS
) -> str:
    deadline = time.time() + max(0.0, grace_seconds)
    while time.time() < deadline:
        active_node = running_handoff_node(try_load_run_record(workspace, run_id))
        if active_node and active_node != previous_node:
            return active_node
        time.sleep(0.25)
    return ""


def should_observe_active_running(record: dict, *, force_run_active: bool) -> bool:
    if force_run_active:
        return False
    return is_active_running(record)


def has_record_stop_boundary(record: dict, node: str) -> bool:
    status = node_status(record, node)
    if status in {"needs_approval", "completed", "failed"}:
        return True
    current = current_node(record)
    if current != node or record.get("status") not in {"paused", "completed", "failed"}:
        return False
    # A manual /agent run can first persist a force-jump state such as
    # currentNode=<target>, run.status=paused, node.status=pending, then start
    # the node moments later. The caller requires a stable boundary grace
    # interval before quitting, so a pending paused target can be accepted when
    # it remains stable instead of keeping the helper open indefinitely after a
    # completed backtrack.
    return status != "running"


def record_boundary_signature(record: dict, node: str) -> tuple[str, str, str, str]:
    node_state = record.get("graph", {}).get("nodeStates", {}).get(node, {})
    updated_at = ""
    if isinstance(node_state, dict):
        updated_at = str(node_state.get("updatedAt") or "")
    return (str(record.get("status") or ""), current_node(record), node_status(record, node), updated_at)


def has_fresh_record_stop_boundary(
    record: dict | None,
    node: str,
    initial_signature: tuple[str, str, str, str] | None
) -> bool:
    if not record or not has_record_stop_boundary(record, node):
        return False
    if initial_signature is None:
        return True
    return record_boundary_signature(record, node) != initial_signature


def fresh_record_stop_boundary_signature(
    record: dict | None,
    node: str,
    initial_signature: tuple[str, str, str, str] | None
) -> tuple[str, str, str, str] | None:
    if has_fresh_record_stop_boundary(record, node, initial_signature):
        return record_boundary_signature(record, node)
    return None


def stable_stop_boundary_ready(
    signature: tuple[str, str, str, str] | None,
    candidate_signature: tuple[str, str, str, str] | None,
    candidate_seen_at: float,
    now: float,
    stable_seconds: float
) -> bool:
    return bool(
        signature
        and candidate_signature == signature
        and candidate_seen_at > 0
        and now - candidate_seen_at >= stable_seconds
    )


def should_accept_text_stop_boundary(
    record: dict | None,
    node: str,
    initial_signature: tuple[str, str, str, str] | None
) -> bool:
    # Resumed TUI sessions can replay older "Node X failed" lines.  Text is
    # only authoritative when persisted state is unavailable or confirms a
    # fresh boundary for the target node.
    if record is None:
        return True
    return has_fresh_record_stop_boundary(record, node, initial_signature)


def should_accept_node_status_error_text(
    record: dict | None,
    node: str,
    initial_signature: tuple[str, str, str, str] | None
) -> bool:
    return should_accept_text_stop_boundary(record, node, initial_signature)


def build_continue_command(record: dict, run_id: str, next_node: str, node_args: str) -> str:
    current = current_node(record)
    current_status = node_status(record, current)
    target_status = node_status(record, next_node)

    if current == next_node and node_has_persisted_failure(record, current):
        return f"/agent retry {next_node} {run_id}"

    if current == next_node and current_status in {"pending", "running", "failed"}:
        command = f"/agent run {next_node} {run_id}"
        if node_args:
            command = f"{command} {node_args}"
        return command

    if current == next_node and current_status == "needs_approval":
        return "/approve"

    if current_status == "needs_approval":
        return "/approve"

    if target_status in {"running", "failed"} and node_has_persisted_failure(record, next_node):
        return f"/agent retry {next_node} {run_id}"

    if target_status in {"pending", "running", "failed"}:
        command = f"/agent run {next_node} {run_id}"
        if node_args:
            command = f"{command} {node_args}"
        return command

    return f"/agent status {run_id}"


def expand_command_override(raw_command: str, run_id: str, next_node: str) -> str:
    return raw_command.replace("{run_id}", run_id).replace("{next_node}", next_node)


def pending_transition_target(record: dict) -> str:
    transition = record.get("graph", {}).get("pendingTransition")
    if not isinstance(transition, dict):
        return ""
    return str(transition.get("targetNode") or "")


def node_to_observe_after_command(record: dict, next_node: str, command: str) -> str:
    if command == "/approve":
        target = pending_transition_target(record)
        if target:
            return target
        return next_node
    return next_node


def wait_for_stop_boundary(
    fd: int,
    pattern: str,
    timeout: float,
    buffer_text: str,
    *,
    workspace: Path,
    run_id: str,
    node: str,
    initial_signature: tuple[str, str, str, str] | None = None,
    stable_seconds: float = STOP_BOUNDARY_STABLE_SECONDS
) -> str:
    deadline = time.time() + timeout
    regex = re.compile(pattern, re.MULTILINE)
    joined = buffer_text
    searchable = ""
    searchable_after_target_running = ""
    candidate_signature: tuple[str, str, str, str] | None = None
    candidate_seen_at = 0.0
    observed_target_running = False
    while time.time() < deadline:
        record = try_load_run_record(workspace, run_id)
        if is_target_node_running(record, node) and not observed_target_running:
            observed_target_running = True
            searchable_after_target_running = ""
        signature = fresh_record_stop_boundary_signature(record, node, initial_signature)
        now = time.time()
        if signature:
            if signature != candidate_signature:
                candidate_signature = signature
                candidate_seen_at = now
            elif stable_stop_boundary_ready(
                signature,
                candidate_signature,
                candidate_seen_at,
                now,
                stable_seconds
            ):
                return joined
        else:
            candidate_signature = None
            candidate_seen_at = 0.0
        ready, _, _ = select.select([fd], [], [], min(1.0, max(0.1, deadline - time.time())))
        if not ready:
            continue
        try:
            data = os.read(fd, 8192)
        except OSError:
            break
        if not data:
            break
        chunk = data.decode("utf-8", errors="ignore")
        joined += chunk
        searchable += chunk
        if observed_target_running:
            searchable_after_target_running += chunk
        if observed_target_running and has_node_status_error_stop_text(searchable_after_target_running, node):
            record = try_load_run_record(workspace, run_id)
            if should_accept_node_status_error_text(record, node, initial_signature):
                return joined
        if observed_target_running and re.search(LIVE_INTERACTIVE_PROMPT_PATTERN, searchable_after_target_running, re.MULTILINE):
            return joined
        if regex.search(searchable):
            record = try_load_run_record(workspace, run_id)
            if is_target_node_running(record, node) and not observed_target_running:
                observed_target_running = True
                searchable_after_target_running = ""
            if record is None and should_accept_text_stop_boundary(record, node, initial_signature):
                return joined
            signature = fresh_record_stop_boundary_signature(record, node, initial_signature)
            now = time.time()
            if signature:
                if signature != candidate_signature:
                    candidate_signature = signature
                    candidate_seen_at = now
                elif stable_stop_boundary_ready(
                    signature,
                    candidate_signature,
                    candidate_seen_at,
                    now,
                    stable_seconds
                ):
                    return joined
    print(f"FAIL: pattern or persisted stop boundary not found before timeout: {pattern}")
    if joined:
        print("---- recent buffer ----")
        print(joined[-6000:])
        print("-----------------------")
    raise WaitTimeout(pattern, joined)


def run_selftest() -> int:
    run_id = "run-p6"
    args = "--top-n 12"
    analyze_running = {
        "status": "running",
        "currentNode": "analyze_papers",
        "graph": {"nodeStates": {"analyze_papers": {"status": "running"}}},
    }
    analyze_running_with_error = {
        "status": "running",
        "currentNode": "analyze_papers",
        "graph": {"nodeStates": {"analyze_papers": {"status": "running", "lastError": "previous failure"}}},
    }
    collect_needs_approval = {
        "currentNode": "collect_papers",
        "graph": {
            "nodeStates": {
                "collect_papers": {"status": "needs_approval"},
                "analyze_papers": {"status": "pending"},
            }
        },
    }
    analyze_needs_approval = {
        "currentNode": "analyze_papers",
        "graph": {"nodeStates": {"analyze_papers": {"status": "needs_approval"}}},
    }

    expectations = [
        (
            build_continue_command(analyze_running, run_id, "analyze_papers", args),
            "/agent run analyze_papers run-p6 --top-n 12",
        ),
        (
            build_continue_command(analyze_running_with_error, run_id, "analyze_papers", args),
            "/agent retry analyze_papers run-p6",
        ),
        (build_continue_command(collect_needs_approval, run_id, "analyze_papers", args), "/approve"),
        (build_continue_command(analyze_needs_approval, run_id, "analyze_papers", args), "/approve"),
    ]
    for actual, expected in expectations:
        if actual != expected:
            print(f"FAIL: expected {expected!r}, got {actual!r}")
            return 1
    if not is_active_running(analyze_running):
        print("FAIL: active-running run was not detected")
        return 1
    if active_running_node(analyze_running) != "analyze_papers":
        print("FAIL: active-running node was not projected")
        return 1
    if running_node_after_fresh_handoff(analyze_running) != "analyze_papers":
        print("FAIL: fresh handoff running node was not projected")
        return 1
    if running_node_after_fresh_handoff(analyze_running_with_error) != "analyze_papers":
        print("FAIL: fresh handoff ignored a running node that still carries prior lastError")
        return 1
    if not is_target_node_running(analyze_running, "analyze_papers"):
        print("FAIL: target-node running state was not detected")
        return 1
    if is_active_running(analyze_running_with_error):
        print("FAIL: running node with a persisted failure was incorrectly treated as active")
        return 1
    if is_target_node_running(analyze_running_with_error, "analyze_papers"):
        print("FAIL: target-node running state ignored a persisted failure marker")
        return 1
    if is_target_node_running(analyze_running, "collect_papers"):
        print("FAIL: unrelated node was incorrectly detected as running")
        return 1
    if active_running_node(analyze_needs_approval):
        print("FAIL: stopped node was incorrectly projected as active-running")
        return 1
    if running_handoff_node(analyze_running) != "analyze_papers":
        print("FAIL: running handoff node was not detected")
        return 1
    if running_handoff_node(analyze_needs_approval):
        print("FAIL: stopped run was incorrectly treated as a running handoff")
        return 1
    with tempfile.TemporaryDirectory() as temp_dir:
        workspace = Path(temp_dir)
        delayed_run_id = "delayed-handoff"
        record_dir = workspace / ".autolabos" / "runs" / delayed_run_id
        record_dir.mkdir(parents=True)
        (record_dir / "run_record.json").write_text(json.dumps({
            "status": "paused",
            "currentNode": "implement_experiments",
            "graph": {
                "nodeStates": {
                    "implement_experiments": {"status": "completed"},
                    "run_experiments": {"status": "pending"},
                }
            },
        }), encoding="utf-8")

        def write_delayed_handoff() -> None:
            time.sleep(0.2)
            (record_dir / "run_record.json").write_text(json.dumps({
                "status": "running",
                "currentNode": "run_experiments",
                "graph": {
                    "nodeStates": {
                        "implement_experiments": {"status": "completed"},
                        "run_experiments": {"status": "running", "updatedAt": "later"},
                    }
                },
            }), encoding="utf-8")

        handoff_writer = threading.Thread(target=write_delayed_handoff)
        handoff_writer.start()
        try:
            if wait_for_running_handoff(workspace, delayed_run_id, "implement_experiments", 2.0) != "run_experiments":
                print("FAIL: delayed running handoff was not detected during grace wait")
                return 1
        finally:
            handoff_writer.join(timeout=1.0)
    if not should_observe_active_running(analyze_running, force_run_active=False):
        print("FAIL: active-running run was not selected for observation")
        return 1
    if should_observe_active_running(analyze_running, force_run_active=True):
        print("FAIL: force-run-active should bypass observation of a stale running record")
        return 1
    if is_active_running(analyze_needs_approval):
        print("FAIL: needs_approval run was incorrectly detected as active-running")
        return 1
    if not has_record_stop_boundary(analyze_needs_approval, "analyze_papers"):
        print("FAIL: needs_approval run was not detected as a stop boundary")
        return 1
    if has_record_stop_boundary(analyze_running, "analyze_papers"):
        print("FAIL: running run was incorrectly detected as a stop boundary")
        return 1
    jumped_pending = {
        "status": "paused",
        "currentNode": "implement_experiments",
        "graph": {"nodeStates": {"implement_experiments": {"status": "pending", "updatedAt": "later"}}},
    }
    if not has_record_stop_boundary(jumped_pending, "implement_experiments"):
        print("FAIL: paused pending target was not exposed as a stabilizable stop boundary")
        return 1
    if record_boundary_signature(analyze_needs_approval, "analyze_papers") == record_boundary_signature(
        analyze_running,
        "analyze_papers"
    ):
        print("FAIL: distinct run states produced the same stop-boundary signature")
        return 1
    initial_running_signature = record_boundary_signature(analyze_running, "analyze_papers")
    if has_fresh_record_stop_boundary(analyze_running, "analyze_papers", initial_running_signature):
        print("FAIL: unchanged running record was incorrectly treated as a fresh stop boundary")
        return 1
    if fresh_record_stop_boundary_signature(analyze_running, "analyze_papers", initial_running_signature):
        print("FAIL: unchanged running record produced a fresh stop-boundary signature")
        return 1
    if should_accept_text_stop_boundary(analyze_running, "analyze_papers", initial_running_signature):
        print("FAIL: stale replay text would be accepted while persisted state is still running")
        return 1
    if should_accept_node_status_error_text(analyze_running, "analyze_papers", initial_running_signature):
        print("FAIL: stale node-status error text would be accepted while persisted state is still running")
        return 1
    advanced_record = {
        "status": "paused",
        "currentNode": "analyze_papers",
        "graph": {"nodeStates": {"analyze_papers": {"status": "needs_approval", "updatedAt": "later"}}},
    }
    if not should_accept_text_stop_boundary(advanced_record, "analyze_papers", initial_running_signature):
        print("FAIL: fresh persisted stop boundary was not accepted")
        return 1
    if not should_accept_node_status_error_text(advanced_record, "analyze_papers", initial_running_signature):
        print("FAIL: fresh persisted stop boundary did not accept node-status error text")
        return 1
    advanced_signature = fresh_record_stop_boundary_signature(
        advanced_record,
        "analyze_papers",
        initial_running_signature
    )
    if advanced_signature != record_boundary_signature(advanced_record, "analyze_papers"):
        print("FAIL: fresh persisted stop boundary did not expose its signature")
        return 1
    if stable_stop_boundary_ready(advanced_signature, advanced_signature, 100.0, 101.0, 2.0):
        print("FAIL: stop boundary stabilized before the required grace interval")
        return 1
    if not stable_stop_boundary_ready(advanced_signature, advanced_signature, 100.0, 102.1, 2.0):
        print("FAIL: stop boundary did not stabilize after the required grace interval")
        return 1
    if stable_stop_boundary_ready(None, advanced_signature, 100.0, 102.1, 2.0):
        print("FAIL: missing signature was treated as a stable boundary")
        return 1
    existing = "+ [OK] readiness: ok\n+ [OK] harness-validation: 0 issue(s), 0 run(s) checked\n"
    if wait_for(-1, r"harness-validation:", 0.01, existing) != existing:
        print("FAIL: wait_for did not match an already-buffered doctor line")
        return 1
    if "Node [a-z_]+ finished:" not in STOP_PATTERN:
        print("FAIL: stop pattern does not include expected node-finished boundary")
        return 1
    design_stop = stop_pattern_for_node("design_experiments")
    if re.search(design_stop, "Node implement_experiments finished: stale replay"):
        print("FAIL: node-specific stop pattern matched an unrelated node")
        return 1
    if not re.search(design_stop, "Node design_experiments finished: expected boundary"):
        print("FAIL: node-specific stop pattern did not match the target node")
        return 1
    if re.search(design_stop, "x Status: design_experiments error: stale projection"):
        print("FAIL: node-specific stop pattern matched a node-local status projection")
        return 1
    design_status_error = node_status_error_pattern("design_experiments")
    if not re.search(design_status_error, "x Status: design_experiments error: expected boundary"):
        print("FAIL: node-local status-error pattern did not match the target node")
        return 1
    if re.search(design_status_error, "x Status: run_experiments error: unrelated boundary"):
        print("FAIL: node-local status-error pattern matched an unrelated node")
        return 1
    if not has_node_status_error_stop_text(
        "x Status: design_experiments error: expected boundary\n"
        "Add steering, or wait for the next approval.",
        "design_experiments",
    ):
        print("FAIL: node-local status-error stop text did not match the stopped prompt")
        return 1
    if has_node_status_error_stop_text(
        "x Status: design_experiments error: stale replay\n"
        "Add steering to redirect the current run.",
        "design_experiments",
    ):
        print("FAIL: node-local status-error stop text matched an active-run prompt")
        return 1
    if not re.search(LIVE_INTERACTIVE_PROMPT_PATTERN, "Add steering, or wait for the next approval."):
        print("FAIL: live interactive prompt pattern did not match current guidance")
        return 1
    if not re.search(LIVE_INTERACTIVE_PROMPT_PATTERN, "Add steering, or wait for the next run or approval."):
        print("FAIL: live interactive prompt pattern did not preserve older guidance")
        return 1
    if not re.search(LIVE_INTERACTIVE_PROMPT_PATTERN, "Add steering to redirect the current run."):
        print("FAIL: live interactive prompt pattern did not match active-run steering guidance")
        return 1
    if "Approved [a-z_]+\\. Next node is" in STOP_PATTERN:
        print("FAIL: approval handoff should not be treated as a stop boundary")
        return 1
    if not re.search(READY_PATTERN, "Add steering, or wait for the next approval."):
        print("FAIL: ready pattern did not match current paused/failure guidance")
        return 1
    if not re.search(READY_PATTERN, "Add steering, or wait for the next run or approval."):
        print("FAIL: ready pattern did not preserve older paused/failure guidance")
        return 1
    if not re.search(DOCTOR_READY_PATTERN, "+ [OK] codex-research-backend-model: configured"):
        print("FAIL: doctor ready pattern did not match current doctor output")
        return 1
    if not re.search(DOCTOR_READY_PATTERN, "+ [OK] runs-dir-write: Run store write probe succeeded"):
        print("FAIL: doctor ready pattern did not match run-store write output")
        return 1
    try:
        raise WaitTimeout("Bye", "boundary transcript")
    except WaitTimeout as exc:
        if exc.transcript != "boundary transcript":
            print("FAIL: cleanup timeout did not preserve transcript")
            return 1
    if pending_transition_target({
        "graph": {"pendingTransition": {"targetNode": "generate_hypotheses"}}
    }) != "generate_hypotheses":
        print("FAIL: pending transition target was not detected")
        return 1
    if node_to_observe_after_command(collect_needs_approval, "analyze_papers", "/approve") != "analyze_papers":
        print("FAIL: approve without transition target should observe the requested next node")
        return 1
    if node_to_observe_after_command({
        "currentNode": "analyze_papers",
        "graph": {
            "pendingTransition": {"targetNode": "generate_hypotheses"},
            "nodeStates": {"analyze_papers": {"status": "needs_approval"}},
        },
    }, "analyze_papers", "/approve") != "generate_hypotheses":
        print("FAIL: approve handoff should observe the pending transition target")
        return 1
    if expand_command_override("/agent retry {next_node} {run_id}", run_id, "implement_experiments") != (
        "/agent retry implement_experiments run-p6"
    ):
        print("FAIL: command override placeholders were not expanded")
        return 1
    if expand_command_override("Steer {next_node} for {run_id}", run_id, "implement_experiments") != (
        "Steer implement_experiments for run-p6"
    ):
        print("FAIL: text command override placeholders were not expanded")
        return 1
    print("PASS: p6 continue command selection self-test")
    return 0


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    default_workspace = repo_root.parent / ".autolabos-validation" / "p6-paper-ready-live"
    workspace = Path(os.environ.get("AUTOLABOS_P6_WORKSPACE", str(default_workspace))).resolve()
    output_dir = Path(os.environ.get("AUTOLABOS_P6_PREFLIGHT_OUT", str(repo_root / "outputs" / "p6-preflight"))).resolve()
    run_id = os.environ.get("AUTOLABOS_P6_RUN_ID", "").strip()
    next_node = os.environ.get("AUTOLABOS_P6_NEXT_NODE", "analyze_papers").strip()
    default_node_args = "--top-n 12" if next_node == "analyze_papers" else ""
    node_args = os.environ.get("AUTOLABOS_P6_NEXT_NODE_ARGS", default_node_args).strip()
    command_override = os.environ.get("AUTOLABOS_P6_COMMAND", "").strip()
    timeout = float(os.environ.get("AUTOLABOS_P6_NEXT_TIMEOUT_SEC", "3600"))
    handoff_grace_seconds = float(os.environ.get("AUTOLABOS_P6_HANDOFF_GRACE_SEC", str(HANDOFF_GRACE_SECONDS)))
    dist_main = repo_root / "dist" / "cli" / "main.js"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"p6-continue-{next_node}-output.txt"

    if not run_id:
        print("FAIL: AUTOLABOS_P6_RUN_ID is required")
        return 1
    if not workspace.exists():
        print(f"FAIL: workspace does not exist: {workspace}")
        return 1
    if not dist_main.exists():
        print(f"FAIL: expected built CLI at {dist_main}; run npm run build first")
        return 1
    record_before = load_run_record(workspace, run_id)
    force_run_active = os.environ.get("AUTOLABOS_P6_FORCE_RUN_ACTIVE", "") == "1"
    active_running_before = should_observe_active_running(record_before, force_run_active=force_run_active)
    if force_run_active and is_active_running(record_before):
        next_node = current_node(record_before) or next_node

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
            READY_PATTERN,
            40,
            buffer_text,
        )
        record_after_attach = load_run_record(workspace, run_id)
        active_running_after_attach = should_observe_active_running(
            record_after_attach,
            force_run_active=force_run_active
        )
        if active_running_before or active_running_after_attach:
            wait_node = current_node(record_after_attach) or current_node(record_before) or next_node
            initial_signature = record_boundary_signature(record_after_attach, wait_node)
            if command_override:
                command = expand_command_override(command_override, run_id, wait_node)
                send_line(master_fd, command)
                print(f"INFO: {wait_node} is already running; sent command override and observing until the next stop boundary.")
            else:
                print(f"INFO: {wait_node} is already running; observing until the next stop boundary.")
        else:
            if not force_run_active:
                send_line(master_fd, "/doctor")
                buffer_text = wait_for(master_fd, DOCTOR_READY_PATTERN, 60, buffer_text)
                buffer_text = wait_for(master_fd, r"\[(OK|FAIL)\] harness-validation:", 60, buffer_text)
            record_before_command = load_run_record(workspace, run_id)
            command = (
                expand_command_override(command_override, run_id, next_node)
                if command_override
                else build_continue_command(record_before_command, run_id, next_node, node_args)
            )
            wait_node = node_to_observe_after_command(record_before_command, next_node, command)
            initial_signature = record_boundary_signature(record_before_command, wait_node)
            send_line(master_fd, command)
        buffer_text = wait_for_stop_boundary(
            master_fd,
            stop_pattern_for_node(wait_node),
            timeout,
            buffer_text,
            workspace=workspace,
            run_id=run_id,
            node=wait_node,
            initial_signature=initial_signature
        )
        observed_handoffs = 0
        while observed_handoffs < 3:
            record_after_boundary = try_load_run_record(workspace, run_id)
            active_node = running_handoff_node(record_after_boundary)
            if not active_node:
                active_node = wait_for_running_handoff(
                    workspace,
                    run_id,
                    wait_node,
                    handoff_grace_seconds
                )
            if not active_node:
                break
            observed_handoffs += 1
            wait_node = active_node
            record_after_boundary = try_load_run_record(workspace, run_id)
            initial_signature = (
                record_boundary_signature(record_after_boundary, wait_node)
                if record_after_boundary
                else None
            )
            print(f"INFO: {wait_node} is already running after the prior boundary; observing the handoff.")
            buffer_text = wait_for_stop_boundary(
                master_fd,
                stop_pattern_for_node(wait_node),
                timeout,
                buffer_text,
                workspace=workspace,
                run_id=run_id,
                node=wait_node,
                initial_signature=initial_signature
            )
        send_line(master_fd, "/quit")
        try:
            buffer_text = wait_for(master_fd, r"Bye", 20, buffer_text)
        except WaitTimeout as exc:
            # The requested node boundary has already been observed. Some live
            # TUI states do not emit a Bye line after /quit, so keep the
            # transcript and let process cleanup in finally terminate the PTY.
            buffer_text = exc.transcript
    except WaitTimeout as exc:
        output_path.write_text(exc.transcript, encoding="utf-8")
        print(f"FAIL: P6 continue timed out waiting for {exc.pattern}; output={output_path}")
        return 1
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

    output_path.write_text(buffer_text, encoding="utf-8")
    print(f"PASS: P6 approved current gate and attempted {next_node}; output={output_path}")
    return 0


if __name__ == "__main__":
    if os.environ.get("AUTOLABOS_P6_CONTINUE_SELFTEST") == "1":
        raise SystemExit(run_selftest())
    raise SystemExit(main())
