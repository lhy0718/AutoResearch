import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import {
  appendEvalHarnessHistoryEntry,
  generateEvalHarnessReport,
  readEvalHarnessHistoryEntries,
  renderEvalHarnessSummary,
  resolveEvalHarnessHistoryPath,
  writeEvalHarnessReport
} from "../src/core/evaluation/evalHarness.js";
import { runEvalHarnessCli } from "../src/cli/evalHarness.js";
import { RunStore } from "../src/core/runs/runStore.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("eval harness", () => {
  it("aggregates implementation, verifier, objective, and artifact signals from saved runs", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-eval-harness-"));
    tempDirs.push(workspace);
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);

    const runStore = new RunStore(paths);
    const runA = await runStore.createRun({
      title: "Run A",
      topic: "agent reasoning",
      constraints: ["recent"],
      objectiveMetric: "accuracy >= 0.9"
    });
    const runB = await runStore.createRun({
      title: "Run B",
      topic: "agent robustness",
      constraints: ["recent"],
      objectiveMetric: "accuracy >= 0.9"
    });
    const runC = await runStore.createRun({
      title: "Run C",
      topic: "agent safety",
      constraints: ["recent"],
      objectiveMetric: "accuracy >= 0.9"
    });

    await writeRunArtifacts(paths.runsDir, runA.id, {
      implement_result: {
        verify_report: { status: "pass", summary: "Local verification passed." },
        attempt_count: 2,
        changed_files: ["src/runner.py", "src/helper.py"],
        auto_handoff_to_run_experiments: true
      },
      implement_attempts: { attempts: [{}, {}] },
      verify_report: { status: "pass" },
      branch_search_result: { branches: [{}, {}] },
      run_verifier: {
        source: "run_experiments",
        status: "pass",
        trigger: "auto_handoff",
        stage: "success",
        summary: "Objective metric met: accuracy=0.93 >= 0.9.",
        recorded_at: "2026-03-10T00:00:00.000Z"
      },
      objective_evaluation: {
        status: "met",
        summary: "Objective metric met: accuracy=0.93 >= 0.9."
      },
      result_analysis: {
        overview: {
          objective_status: "met",
          selected_design_title: "Accuracy benchmark"
        }
      },
      paper_main: "\\section{Results}\n"
    });

    await writeRunArtifacts(paths.runsDir, runB.id, {
      implement_result: {
        verify_report: { status: "not_run", summary: "Local verification deferred to run_experiments." },
        attempt_count: 1,
        changed_files: ["src/broken.py"],
        auto_handoff_to_run_experiments: true
      },
      implement_attempts: { attempts: [{}] },
      verify_report: { status: "not_run" },
      branch_search_result: { branches: [{}] },
      run_verifier: {
        source: "run_experiments",
        status: "fail",
        trigger: "auto_handoff",
        stage: "policy",
        summary: "Policy blocked command. rule=remote_script_pipe. piping a remote script directly into a shell is blocked",
        policy_rule_id: "remote_script_pipe",
        suggested_next_action: "Replace the blocked run command with a policy-compliant command before retrying.",
        recorded_at: "2026-03-10T00:00:00.000Z"
      }
    });

    await writeRunArtifacts(paths.runsDir, runC.id, {
      implement_result: {
        verify_report: {
          status: "fail",
          summary: "Policy blocked test command. rule=network_fetch_disabled. network fetch/install commands are disabled by the current experiment policy",
          failure_type: "policy",
          policy_rule_id: "network_fetch_disabled"
        },
        attempt_count: 1,
        changed_files: ["src/install_wrapper.py"],
        auto_handoff_to_run_experiments: false
      },
      implement_attempts: { attempts: [{}] },
      verify_report: {
        status: "fail",
        summary: "Policy blocked test command. rule=network_fetch_disabled.",
        failure_type: "policy",
        policy_rule_id: "network_fetch_disabled"
      },
      branch_search_result: { branches: [{}] }
    });

    const report = await generateEvalHarnessReport({
      cwd: workspace,
      limit: 10
    });

    expect(report.aggregate.run_count).toBe(3);
    expect(report.aggregate.implementation_pass_rate).toBe(0.3333);
    expect(report.aggregate.run_verifier_pass_rate).toBe(0.3333);
    expect(report.aggregate.objective_met_rate).toBe(0.3333);
    expect(report.aggregate.implementation_policy_block_rate).toBe(0.3333);
    expect(report.aggregate.run_verifier_policy_block_rate).toBe(0.3333);
    expect(report.aggregate.policy_blocked_run_rate).toBe(0.6667);
    expect(report.aggregate.auto_handoff_rate).toBe(0.6667);
    expect(report.aggregate.avg_implement_attempts).toBe(1.3333);
    expect(report.aggregate.avg_branch_count).toBe(1.3333);
    expect(report.aggregate.policy_rule_counts).toEqual([
      { rule_id: "network_fetch_disabled", count: 1 },
      { rule_id: "remote_script_pipe", count: 1 }
    ]);

    const first = report.runs.find((run) => run.run_id === runA.id);
    const second = report.runs.find((run) => run.run_id === runB.id);
    const third = report.runs.find((run) => run.run_id === runC.id);
    expect(first?.statuses.implement).toBe("pass");
    expect(first?.statuses.run_verifier).toBe("pass");
    expect(first?.statuses.objective).toBe("met");
    expect(first?.metrics.changed_file_count).toBe(2);
    expect(first?.scores.overall).toBeGreaterThan(0.9);

    expect(second?.statuses.implement).toBe("deferred");
    expect(second?.statuses.run_verifier).toBe("fail");
    expect(second?.statuses.objective).toBe("missing");
    expect(second?.metrics.run_verifier_stage).toBe("policy");
    expect(second?.metrics.run_verifier_policy_rule_id).toBe("remote_script_pipe");
    expect(second?.metrics.policy_blocked).toBe(true);
    expect(second?.findings.some((item) => item.includes("Run verifier blocked by policy"))).toBe(true);
    expect(second?.missing_artifacts).toContain("objective_evaluation.json");

    expect(third?.statuses.implement).toBe("fail");
    expect(third?.metrics.implement_failure_type).toBe("policy");
    expect(third?.metrics.implement_policy_rule_id).toBe("network_fetch_disabled");
    expect(third?.metrics.policy_blocked).toBe(true);
    expect(third?.findings.some((item) => item.includes("Implement verifier blocked by policy"))).toBe(true);

    const summary = renderEvalHarnessSummary(report);
    expect(summary).toContain("Eval harness completed for 3 run(s).");
    expect(summary).toContain("Implementation pass rate: 33.3%");
    expect(summary).toContain("Policy-blocked run rate: 66.7%");
    expect(summary).toContain("Top policy rules: network_fetch_disabled (1), remote_script_pipe (1)");

    const written = await writeEvalHarnessReport(report, path.join(workspace, "outputs", "eval-harness", "latest.json"));
    expect(path.basename(written.jsonPath)).toBe("latest.json");
    expect(path.basename(written.markdownPath)).toBe("latest.md");
  });

  it("appends eval-harness history entries across multiple executions", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-eval-harness-history-"));
    tempDirs.push(workspace);
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);

    const runStore = new RunStore(paths);
    const run = await runStore.createRun({
      title: "History Run",
      topic: "history checks",
      constraints: ["recent"],
      objectiveMetric: "accuracy >= 0.9"
    });

    await writeRunArtifacts(paths.runsDir, run.id, {
      implement_result: {
        verify_report: { status: "pass", summary: "Local verification passed." },
        attempt_count: 1,
        changed_files: ["src/runner.py"],
        auto_handoff_to_run_experiments: true
      },
      implement_attempts: { attempts: [{}] },
      verify_report: { status: "pass" },
      branch_search_result: { branches: [{}] },
      run_verifier: {
        source: "run_experiments",
        status: "pass",
        trigger: "auto_handoff",
        stage: "success",
        summary: "Objective metric met.",
        recorded_at: "2026-03-10T00:00:00.000Z"
      },
      objective_evaluation: {
        status: "met",
        summary: "Objective metric met."
      },
      result_analysis: {
        overview: {
          objective_status: "met",
          selected_design_title: "History benchmark"
        }
      },
      paper_main: "\\section{Results}\n"
    });

    await runEvalHarnessCli({
      cwd: workspace,
      runIds: [run.id],
      limit: 20
    });
    await runEvalHarnessCli({
      cwd: workspace,
      runIds: [run.id],
      limit: 20
    });

    const historyPath = resolveEvalHarnessHistoryPath(workspace);
    const historyRaw = await readFile(historyPath, "utf8");
    const lines = historyRaw.trim().split(/\r?\n/u);
    expect(lines).toHaveLength(2);
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.every((entry) => entry.run_id === run.id)).toBe(true);
    expect(entries.every((entry) => typeof entry.timestamp === "string")).toBe(true);
    expect(entries[0].results.selection.evaluated_run_ids).toEqual([run.id]);
  });

  it("skips history append when requested and returns latest 20 history entries", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-eval-harness-read-history-"));
    tempDirs.push(workspace);
    const paths = resolveAppPaths(workspace);
    await ensureScaffold(paths);

    const report = await generateEvalHarnessReport({
      cwd: workspace,
      limit: 1
    });
    await appendEvalHarnessHistoryEntry(workspace, report, "run-a");
    await appendEvalHarnessHistoryEntry(workspace, report, "run-b");

    await runEvalHarnessCli({
      cwd: workspace,
      runIds: [],
      limit: 1,
      noHistory: true
    });

    const entries = await readEvalHarnessHistoryEntries(workspace, 20);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.run_id)).toEqual(["run-a", "run-b"]);
  });
});

async function writeRunArtifacts(
  runsDir: string,
  runId: string,
  data: {
    implement_result?: unknown;
    implement_attempts?: unknown;
    verify_report?: unknown;
    branch_search_result?: unknown;
    run_verifier?: unknown;
    objective_evaluation?: unknown;
    result_analysis?: unknown;
    paper_main?: string;
  }
): Promise<void> {
  const runDir = path.join(runsDir, runId);
  await mkdir(path.join(runDir, "paper"), { recursive: true });

  if (data.implement_result) {
    await writeFile(path.join(runDir, "implement_result.json"), `${JSON.stringify(data.implement_result, null, 2)}\n`, "utf8");
  }
  if (data.implement_attempts) {
    await writeFile(path.join(runDir, "implement_attempts.json"), `${JSON.stringify(data.implement_attempts, null, 2)}\n`, "utf8");
  }
  if (data.verify_report) {
    await writeFile(path.join(runDir, "verify_report.json"), `${JSON.stringify(data.verify_report, null, 2)}\n`, "utf8");
  }
  if (data.branch_search_result) {
    await writeFile(path.join(runDir, "branch_search_result.json"), `${JSON.stringify(data.branch_search_result, null, 2)}\n`, "utf8");
  }
  if (data.run_verifier) {
    await writeFile(path.join(runDir, "run_experiments_verify_report.json"), `${JSON.stringify(data.run_verifier, null, 2)}\n`, "utf8");
  }
  if (data.objective_evaluation) {
    await writeFile(path.join(runDir, "objective_evaluation.json"), `${JSON.stringify(data.objective_evaluation, null, 2)}\n`, "utf8");
  }
  if (data.result_analysis) {
    await writeFile(path.join(runDir, "result_analysis.json"), `${JSON.stringify(data.result_analysis, null, 2)}\n`, "utf8");
  }
  if (data.paper_main) {
    await writeFile(path.join(runDir, "paper", "main.tex"), data.paper_main, "utf8");
  }
}
