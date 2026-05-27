import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createRunExperimentsNode } from "../src/core/nodes/runExperiments.js";
import { buildPublicSectionDir } from "../src/core/publicArtifacts.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { EXPERIMENT_GOVERNANCE_CONTRACT_KEY } from "../src/core/experimentGovernance.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Execution profile test",
    topic: "execution profile handling",
    constraints: [],
    objectiveMetric: "accuracy at least 0.9",
    status: "running",
    currentNode: "run_experiments",
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    graph: {
      ...createDefaultGraphState(),
      currentNode: "run_experiments"
    },
    memoryRefs: {
      runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

describe("run_experiments execution profile behavior", () => {
  it("skips code execution in plan_only mode and records a skipped verifier report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-profile-"));
    process.chdir(root);
    const run = makeRun("run-plan-only");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const aci = {
      runCommand: vi.fn(),
      runTests: vi.fn()
    };

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "plan_only",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: aci as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "plan_only_mode"
    });
    expect(aci.runCommand).not.toHaveBeenCalled();
    expect(aci.runTests).not.toHaveBeenCalled();

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; summary: string };
    expect(verifierReport.status).toBe("skipped");
    expect(verifierReport.summary).toContain("plan_only");

    const intermediateArtifacts = JSON.parse(
      await readFile(path.join(runDir, "run_experiments", "intermediate_artifacts.json"), "utf8")
    ) as {
      summary: { present: number; missing_required: number };
      entries: Array<{ artifact_id: string; status: string; parse_status: string; relative_path: string }>;
    };
    expect(intermediateArtifacts.summary.present).toBeGreaterThanOrEqual(1);
    expect(intermediateArtifacts.summary.missing_required).toBe(0);
    expect(intermediateArtifacts.entries).toContainEqual(
      expect.objectContaining({
        artifact_id: "run_experiments_verify_report",
        relative_path: "run_experiments_verify_report.json",
        status: "present",
        parse_status: "parseable"
      })
    );
  });

  it("treats remote bootstrap requirements as metadata instead of a hard policy stop", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-bootstrap-contract-"));
    process.chdir(root);
    const run = makeRun("run-bootstrap-blocked");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    const publicDir = path.join(root, "outputs", "experiment");
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await mkdir(publicDir, { recursive: true });
    await writeFile(
      path.join(publicDir, "bootstrap_contract.json"),
      JSON.stringify(
        {
          version: 1,
          requires_network: true,
          summary:
            "This run may fetch a public Hugging Face model/tokenizer on demand.",
          remediation: ["Prewarm the cache or allow network bootstrap."]
        },
        null,
        2
      ),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.public_dir", publicDir);

    const aci = {
      runCommand: vi.fn().mockResolvedValue({
        status: "error",
        stderr: "synthetic failure after bootstrap warning",
        exit_code: 1,
        duration_ms: 1
      }),
      runTests: vi.fn().mockResolvedValue({
        status: "error",
        stderr: "synthetic failure after bootstrap warning",
        exit_code: 1,
        duration_ms: 1
      })
    };

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: aci as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(String(result.error || "")).not.toContain("Offline execution cannot proceed");
    expect(aci.runCommand).not.toHaveBeenCalledWith(
      expect.stringContaining("Offline execution cannot proceed")
    );
  });

  it("fails verification when a successful command writes incomplete comparator metrics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-incomplete-comparator-"));
    process.chdir(root);
    const run = makeRun("run-incomplete-comparator");
    run.objectiveMetric = "accuracy_delta_vs_baseline";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, {
      version: 1,
      run_id: run.id,
      plan_id: "plan-incomplete-comparator",
      selected_hypothesis_ids: ["hypothesis-1"],
      objective_metric_name: run.objectiveMetric,
      baseline_first_required: true,
      baseline_candidate_ids: ["baseline"],
      comparison_mode: "baseline_first_locked",
      budget_profile: {
        mode: "single_run_locked",
        locked: true,
        timeout_sec: 7200
      },
      objective_profile: {
        source: "heuristic_fallback",
        raw: run.objectiveMetric,
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        direction: "maximize"
      },
      evaluator_contract_id: "eval-contract-incomplete-comparator",
      created_at: new Date().toISOString()
    });

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                summary: {
                  primary_metric: {
                    name: "mean_zero_shot_accuracy_benchmark_tasks",
                    baseline_value: null,
                    best_tuned_value: null,
                    best_tuned_delta_vs_baseline: null,
                    winner: "baseline"
                  }
                },
                study: {
                  aggregate: {
                    all_conditions_succeeded: false,
                    completed_condition_count: 1,
                    failed_condition_count: 3,
                    successful_tuned_condition_count: 0,
                    baseline_mean_accuracy: null,
                    best_tuned_mean_accuracy: null,
                    best_tuned_delta_vs_baseline: null
                  }
                }
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "experiment command completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment metrics contract failed");
    expect(result.error).toContain("No tuned comparator condition completed successfully");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("Study aggregate reports incomplete execution");

    const feedback = await runContext.get<{ status: string; stage: string; summary: string }>(
      "implement_experiments.runner_feedback"
    );
    expect(feedback).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
  });

  it("fails verification when planned brief conditions are under-executed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-under-executed-conditions-"));
    process.chdir(root);
    const run = makeRun("run-under-executed-conditions");
    run.objectiveMetric =
      "Primary metric: mean zero-shot accuracy. Meaningful improvement: at least +1.0 percentage point over the tuned baseline.";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await runContext.put(
      "run_brief.raw",
      [
        "# Research Brief",
        "## Minimum Acceptable Evidence",
        "- All planned conditions must execute successfully and report bootstrap confidence intervals.",
        "## Minimum Experiment Plan",
        "- one named tuned baseline run",
        "- three alternative recipe conditions"
      ].join("\n")
    );
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, {
      version: 1,
      run_id: run.id,
      plan_id: "plan-under-executed-conditions",
      selected_hypothesis_ids: ["hypothesis-1"],
      objective_metric_name: run.objectiveMetric,
      baseline_first_required: true,
      baseline_candidate_ids: ["standard_adapter_baseline"],
      comparison_mode: "baseline_first_locked",
      budget_profile: {
        mode: "single_run_locked",
        locked: true,
        timeout_sec: 7200
      },
      objective_profile: {
        source: "heuristic_fallback",
        raw: run.objectiveMetric,
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        direction: "maximize",
        comparator: ">=",
        targetValue: 0.01
      },
      evaluator_contract_id: "eval-contract-under-executed-conditions",
      created_at: new Date().toISOString()
    });

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                primary_metric: {
                  name: "accuracy_delta_vs_baseline",
                  value: 0.012,
                  target: 0.01,
                  met: true
                },
                conditions: [
                  {
                    name: "base_unmodified",
                    condition_type: "baseline_unmodified_checkpoint",
                    evaluation: { mean_zero_shot_accuracy: 0.4 }
                  },
                  {
                    name: "adapter_r8",
                    condition_type: "peft_adapter_instruction_tuned",
                    evaluation: { mean_zero_shot_accuracy: 0.412 }
                  },
                  {
                    name: "adapter_r16",
                    condition_type: "peft_adapter_instruction_tuned",
                    evaluation: { mean_zero_shot_accuracy: 0.411 }
                  }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "experiment command completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment metrics contract failed");
    expect(result.error).toContain("Planned condition coverage incomplete");
    expect(result.error).toContain("observed 2 successful tuned condition");
    expect(result.error).toContain("requires 4");
  });

  it("fails verification when a successful command writes top-level failed metrics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-failed-metrics-"));
    process.chdir(root);
    const run = makeRun("run-failed-metrics");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "failed",
                success: true,
                candidate_results: [],
                failure: {
                  type: "RuntimeError",
                  message: "No per-candidate execution/evaluation helper was materialized."
                }
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner wrote failed metrics",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment metrics payload reports failed status");
    expect(result.error).toContain("No per-candidate execution/evaluation helper was materialized");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("Experiment metrics payload reports failed status");

    const feedback = await runContext.get<{ status: string; stage: string; summary: string }>(
      "implement_experiments.runner_feedback"
    );
    expect(feedback).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
  });

  it("uses failed metrics payload as feedback when the command exits unsuccessfully", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-failed-command-metrics-"));
    process.chdir(root);
    const run = makeRun("run-failed-command-metrics");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(root, "study_failure.json"),
            JSON.stringify(
              {
                error: "TypeError: _build_model_load_kwargs() missing 1 required positional argument: 'local_files_only'",
                traceback: [
                  "Traceback (most recent call last):",
                  "  File \"experiment.py\", line 1, in <module>",
                  "TypeError: _build_model_load_kwargs() missing 1 required positional argument: 'local_files_only'"
                ].join("\n")
              },
              null,
              2
            ),
            "utf8"
          );
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "failed",
                primary_metric_key: "quality_delta",
                quality_delta: null,
                completed_condition_count: 0,
                required_condition_count: 8,
                observed_condition_count: 31,
                missing_required_condition_markers: ["baseline_condition", "candidate_condition_a"],
                condition_results_path: path.join(root, "condition_results.json"),
                condition_results: [
                  { condition_id: "baseline_condition", status: "missing", reason: "ok_without_condition_records" },
                  { condition_id: "candidate_condition_a", status: "missing", reason: "ok_without_condition_records" }
                ],
                evidence: [
                  {
                    kind: "orchestration_exception",
                    message: "Could not resolve run-plan construction helper from the current module state.",
                    traceback: "RuntimeError: Could not resolve run-plan construction helper from the current module state."
                  }
                ],
                error: {
                  type: "AttributeError",
                  message: "dict object has no attribute baseline_run"
                },
                error_messages: [
                  "TypeError: SyntheticRunSpec.__init__() missing required argument output_dir"
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "error" as const,
            stdout: "verbose model loading log",
            stderr: "status=failed | completed_conditions=0",
            exit_code: 1,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment metrics payload reports failed status");
    expect(result.error).toContain("completed_condition_count=0/8");
    expect(result.error).toContain("primary_metric_value=quality_delta:null");
    expect(result.error).toContain("condition_result_statuses=missing:2");
    expect(result.error).toContain("condition_result_reasons=ok_without_condition_records:2");
    expect(result.error).toContain("missing_required_condition_markers=baseline_condition,candidate_condition_a");
    expect(result.error).toContain("_build_model_load_kwargs()");
    expect(result.error).toContain("local_files_only");
    expect(result.error).toContain("metrics_evidence=orchestration_exception");
    expect(result.error).toContain("run-plan construction helper");
    expect(result.error).toContain("baseline_run");
    expect(result.error).toContain("metrics_error_messages=TypeError: SyntheticRunSpec.__init__()");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string; stderr_excerpt?: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("completed_condition_count=0/8");
    expect(verifierReport.summary).toContain("primary_metric_value=quality_delta:null");
    expect(verifierReport.summary).toContain("condition_result_statuses=missing:2");
    expect(verifierReport.summary).toContain("metrics_error=AttributeError");
    expect(verifierReport.summary).toContain("metrics_error_messages=TypeError: SyntheticRunSpec.__init__()");
    expect(verifierReport.summary).toContain("metrics_evidence=orchestration_exception");
    expect(verifierReport.summary).toContain("run-plan construction helper");

    const feedback = await runContext.get<{ status: string; stage: string; summary: string }>(
      "implement_experiments.runner_feedback"
    );
    expect(feedback).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(feedback?.summary).toContain("condition_result_reasons=ok_without_condition_records:2");
    expect(feedback?.summary).toContain("observed_condition_count=31");
    expect(feedback?.summary).toContain("_build_model_load_kwargs()");
    expect(feedback?.summary).toContain("baseline_run");
    expect(feedback?.summary).toContain("SyntheticRunSpec.__init__()");
    expect(feedback?.summary).toContain("run-plan construction helper");
  });

  it("restores the previous canonical metrics when a rejected rerun writes failed metrics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-restore-rejected-metrics-"));
    process.chdir(root);
    const run = makeRun("run-restore-rejected-metrics");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const previousMetrics = {
      status: "completed",
      accuracy_delta_vs_baseline: 0.04,
      completed_condition_count: 2,
      required_condition_count: 2,
      condition_results: [
        { condition_marker: "baseline_condition", status: "completed", average_accuracy: 0.5 },
        { condition_marker: "candidate_condition_a", status: "completed", average_accuracy: 0.54 }
      ]
    };
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify(previousMetrics, null, 2), "utf8");

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "node generated_runner.js");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "failed",
                completed_condition_count: 0,
                required_condition_count: 2,
                error: "No locked conditions are available to select from."
              },
              null,
              2
            ),
            "utf8"
          );
          return { status: "ok" as const, stdout: "", stderr: "", exit_code: 0, duration_ms: 5 };
        },
        runTests: async () => ({ status: "ok" as const, stdout: "", stderr: "", exit_code: 0, duration_ms: 1 })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("No locked conditions are available");
    const restoredMetrics = JSON.parse(await readFile(path.join(runDir, "metrics.json"), "utf8"));
    expect(restoredMetrics).toMatchObject(previousMetrics);
    const restoredPath = await runContext.get<string>("run_experiments.restored_previous_metrics_after_failure");
    expect(restoredPath).toContain("preexisting_metrics_");
  });

  it("surfaces string metrics error before stale failure artifact evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-string-metrics-error-"));
    process.chdir(root);
    const run = makeRun("run-string-metrics-error");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(root, "study_failure.json"),
            JSON.stringify({ error: "old stale failure" }, null, 2),
            "utf8"
          );
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "failed",
                error: "write_experiment_artifacts() missing 4 required positional arguments"
              },
              null,
              2
            ),
            "utf8"
          );
          return { status: "error" as const, stdout: "", stderr: "", exit_code: 1, duration_ms: 5 };
        },
        runTests: async () => ({ status: "ok" as const, stdout: "", stderr: "", exit_code: 0, duration_ms: 1 })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("write_experiment_artifacts()");
    expect(result.error).toContain("metrics_error=write_experiment_artifacts()");
    expect(result.error).toContain("old stale failure");
  });

  it("archives preexisting failure artifacts before running a fresh experiment command", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-clear-stale-failure-artifact-"));
    process.chdir(root);
    const run = makeRun("run-clear-stale-failure-artifact");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(root, "study_failure.json"), JSON.stringify({ error: "old stale failure" }), "utf8");

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "failed",
                completed_run_count: 0,
                completed_condition_count: 0,
                selected_model: null,
                per_seed_rows: [
                  {
                    condition_marker: "baseline_condition",
                    seed: 42,
                    status: "failed",
                    failure_reason: "missing_row_for_required_condition_seed"
                  }
                ],
                error: "fresh run produced no executable rows"
              },
              null,
              2
            ),
            "utf8"
          );
          return { status: "error" as const, stdout: "", stderr: "", exit_code: 1, duration_ms: 5 };
        },
        runTests: async () => ({ status: "ok" as const, stdout: "", stderr: "", exit_code: 0, duration_ms: 1 })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("fresh run produced no executable rows");
    expect(result.error).toContain("selected_model=null");
    expect(result.error).toContain("missing_row_for_required_condition_seed");
    expect(result.error).not.toContain("old stale failure");
    const backups = await runContext.get<string[]>("run_experiments.previous_failure_artifact_backups");
    expect(backups).toHaveLength(1);
    expect(backups?.[0]).toContain("preexisting_study_failure");
  });

  it("repairs runtime-resolved metrics payload builders before run_experiments execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-runtime-metrics-repair-"));
    process.chdir(root);
    const run = makeRun("run-runtime-metrics-repair");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const scriptPath = path.join(root, "experiment.py");
    await writeFile(
      scriptPath,
      [
        "import inspect",
        "from typing import Any, Optional, Sequence",
        "",
        "class Config:",
        "    dry_run = False",
        "",
        "def build_metrics_payload(*, config, run_context, data_summary, condition_results):",
        "    return {'condition_count': len(condition_results)}",
        "",
        "def _resolve_runtime_helper(candidate_names: Sequence[str]) -> Optional[Any]:",
        "    for candidate_name in candidate_names:",
        "        helper = globals().get(candidate_name)",
        "        if callable(helper):",
        "            return helper",
        "    return None",
        "",
        "def _filter_kwargs_for_helper(helper: Any, kwargs: dict[str, Any]) -> dict[str, Any]:",
        "    signature = inspect.signature(helper)",
        "    parameters = signature.parameters",
        "    accepts_var_keyword = any(parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values())",
        "    if accepts_var_keyword:",
        "        return kwargs",
        "    return {key: value for key, value in kwargs.items() if key in parameters}",
        "",
        "def _call_helper_variants(helper: Any, helper_name: str, call_variants):",
        "    for positional_args, keyword_args in call_variants:",
        "        filtered_keyword_args = _filter_kwargs_for_helper(helper, dict(keyword_args))",
        "        return helper(*positional_args, **filtered_keyword_args)",
        "    raise RuntimeError('no variant')",
        "",
        "def main() -> int:",
        "    config = Config()",
        "    raw_result = {'condition_results': [{'status': 'completed'}], 'run_context': {}, 'data_summary': {}}",
        "    normalized_result = dict(raw_result)",
        "    metrics_builder = _resolve_runtime_helper(('build_metrics_payload',))",
        "    _call_helper_variants(metrics_builder, 'build_metrics_payload', (((), {",
        "        'config': config,",
        "        'study_result': raw_result,",
        "        'result': raw_result,",
        "        'study_result_dict': normalized_result,",
        "    }),))",
        "    return 0",
        ""
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", `python3 ${JSON.stringify(scriptPath)}`);
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.script", scriptPath);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    let repairedBeforeExecution = false;
    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {
        experiments: {
          network_policy: "declared",
          network_purpose: "model_download"
        }
      } as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async (command: string) => {
          expect(command).toContain("AUTOLABOS_ALLOW_MODEL_DOWNLOAD=1 ");
          const repairedSource = await readFile(scriptPath, "utf8");
          repairedBeforeExecution = repairedSource.includes("_autolabos_main_metrics_payload_builder_call_marker");
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                success: true,
                primary_metric: {
                  name: "accuracy_delta_vs_baseline",
                  value: 0.02,
                  target: 0.01,
                  met: true
                },
                condition_results: [
                  {
                    condition_id: "baseline",
                    condition_type: "baseline",
                    status: "completed",
                    accuracy: 0.4
                  },
                  {
                    condition_id: "candidate",
                    condition_type: "candidate",
                    status: "completed",
                    accuracy: 0.42
                  }
                ],
                completed_condition_count: 2
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    await node.execute({ run, graph: run.graph });

    expect(repairedBeforeExecution).toBe(true);
    expect(await readFile(scriptPath, "utf8")).toContain("_autolabos_original_build_metrics_payload = build_metrics_payload");
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes("Wrapped generated build_metrics_payload calls")
      )
    ).toBe(true);
  });

  it("repairs public study top-level runner aliases before run_experiments execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-public-runner-alias-repair-"));
    process.chdir(root);
    const run = makeRun("run-public-runner-alias-repair");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const scriptPath = path.join(root, "experiment.py");
    await writeFile(
      scriptPath,
      [
        "import argparse",
        "from typing import Any, Optional, Sequence",
        "",
        "def build_arg_parser():",
        "    parser = argparse.ArgumentParser()",
        "    parser.add_argument('--timeout-sec', type=int, default=0)",
        "    return parser",
        "",
        "def _resolve_global_callable(candidate_names: Sequence[str]) -> Optional[Any]:",
        "    for candidate_name in candidate_names:",
        "        candidate = globals().get(candidate_name)",
        "        if callable(candidate):",
        "            return candidate",
        "    return None",
        "",
        "def _call_with_supported_kwargs(callable_obj, *args, **kwargs):",
        "    return callable_obj(*args, **kwargs)",
        "",
        "def prepare_runtime_context(args=None, **kwargs):",
        "    return {'args': args}",
        "",
        "def build_experiment_schedule(runtime=None, runtime_context=None, run_output_dir=None, **kwargs):",
        "    return [{'condition_id': 'baseline_condition'}]",
        "",
        "def execute_run_schedule(planned_runs=None, runtime_context=None, **kwargs):",
        "    return [{'condition_id': 'baseline_condition', 'status': 'completed'}]",
        "",
        "def main() -> int:",
        "    runner = _resolve_global_callable(('run_experiment', 'execute_experiment', 'run_study'))",
        "    if not callable(runner):",
        "        raise RuntimeError('No experiment runner callable was found in the script globals.')",
        "    return 0",
        ""
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", `python3 ${JSON.stringify(scriptPath)}`);
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.script", scriptPath);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    let repairedBeforeExecution = false;
    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {
        experiments: {
          timeout_sec: 43200,
          network_policy: "declared",
          network_purpose: "model_download"
        }
      } as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async (command: string) => {
          expect(command).toContain("AUTOLABOS_ALLOW_MODEL_DOWNLOAD=1 ");
          expect(command).toContain("--timeout-sec 43200");
          const repairedSource = await readFile(scriptPath, "utf8");
          repairedBeforeExecution =
            repairedSource.includes("_autolabos_public_study_top_level_runner_alias_marker") &&
            repairedSource.includes("run_experiment = _autolabos_public_study_top_level_runner");
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                success: true,
                primary_metric: {
                  name: "accuracy_delta_vs_baseline",
                  value: 0.02,
                  target: 0.01,
                  met: true
                },
                condition_results: [
                  {
                    condition_id: "baseline_condition",
                    condition_type: "baseline",
                    status: "completed",
                    accuracy: 0.4
                  },
                  {
                    condition_id: "candidate_condition_a",
                    condition_type: "candidate",
                    status: "completed",
                    accuracy: 0.42
                  }
                ],
                completed_condition_count: 2
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    await node.execute({ run, graph: run.graph });

    expect(repairedBeforeExecution).toBe(true);
    expect(await readFile(scriptPath, "utf8")).toContain(
      "_autolabos_public_study_top_level_runner_alias_marker"
    );
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes(
          "Added public study top-level runner alias in experiment.py before run_experiments execution."
        )
      )
    ).toBe(true);
  });

  it("repairs high-level workload context aliases before run_experiments execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-workload-context-alias-repair-"));
    process.chdir(root);
    const run = makeRun("run-workload-context-alias-repair");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const scriptPath = path.join(root, "experiment.py");
    const markerExpression = '"rank_" + "8" + "_dropout_" + "0_05"';
    await writeFile(
      scriptPath,
      [
        "import argparse",
        "import inspect",
        "from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple",
        "",
        "def build_arg_parser():",
        "    parser = argparse.ArgumentParser()",
        "    parser.add_argument('--metrics-path')",
        "    parser.add_argument('--timeout-sec', type=int, default=0)",
        "    return parser",
        "",
        "def execute_planned_runs(args: argparse.Namespace, context):",
        "    return {'status': 'completed', 'context': context}",
        "",
        "def _safe_int(value: Any, default=None):",
        "    return default if value is None else int(value)",
        "",
        "def _safe_float(value: Any, default=None):",
        "    return default if value is None else float(value)",
        "",
        "def _parse_condition_marker(marker: str):",
        "    return {'rank': 8, 'dropout': 0.05, 'condition_marker': marker}",
        "",
        `PLANNED_CONDITIONS = [{'condition_marker': ${markerExpression}}]`,
        "SEED_SCHEDULE = [42]",
        "",
        "def _global_value(*names, default=None):",
        "    for name in names:",
        "        if name in globals():",
        "            return globals()[name]",
        "    return default",
        "",
        "def get_planned_run_schedule() -> List[Dict[str, Any]]:",
        "    explicit_rows = _global_value('PLANNED_RUNS', default=None)",
        "    condition_rows = _global_value('PLANNED_CONDITIONS', default=None)",
        "    seeds = _global_value('SEED_SCHEDULE', default=[42])",
        "    schedule: List[Dict[str, Any]] = []",
        "    if isinstance(condition_rows, Sequence) and condition_rows:",
        "        for condition in condition_rows:",
        "            if not isinstance(condition, Mapping):",
        "                continue",
        "            rank = _safe_int(condition.get(\"rank\", condition.get(\"adapter_rank\", condition.get(\"r\"))), default=None)",
        "            dropout = _safe_float(condition.get(\"dropout\", condition.get(\"adapter_dropout\")), default=None)",
        "            marker = condition.get(\"condition_marker\") or condition.get(\"marker\")",
        "            if marker is None and rank is not None and dropout is not None:",
        "                marker = 'candidate'",
        "            for seed in seeds:",
        "                schedule.append({'condition_marker': str(marker), 'rank': rank, 'dropout': dropout, 'seed': int(seed)})",
        "    return schedule",
        "",
        "def _signature_compatible_kwargs(fn: Any, kwargs: Mapping[str, Any]) -> Optional[dict[str, Any]]:",
        "    signature = inspect.signature(fn)",
        "    filtered = {k: v for k, v in kwargs.items() if k in signature.parameters}",
        "    for name, parameter in signature.parameters.items():",
        "        if parameter.default is inspect._empty and name not in filtered:",
        "            return None",
        "    return filtered",
        "",
        "def _try_call_callable(fn: Any, kwarg_options: Sequence[Mapping[str, Any]]) -> Tuple[bool, Any, Optional[BaseException]]:",
        "    last_error = None",
        "    for kwargs in kwarg_options:",
        "        compatible = _signature_compatible_kwargs(fn, kwargs)",
        "        if compatible is None:",
        "            continue",
        "        try:",
        "            return True, fn(**compatible), None",
        "        except Exception as exc:",
        "            last_error = exc",
        "    return False, None, last_error",
        "",
        "def _run_workload_from_previous_sections(args, runtime_context, plan_metadata, backend, resolved_model):",
        "    high_level_fn = execute_planned_runs",
        "    ok, value, error = _try_call_callable(",
        "        high_level_fn,",
        "        [",
        "            {",
        "                \"args\": args,",
        "                \"runtime_context\": runtime_context,",
        "                \"planned_runs\": plan_metadata.get(\"planned_runs\"),",
        "                \"plan_metadata\": plan_metadata,",
        "                \"backend\": backend,",
        "                \"resolved_model\": resolved_model,",
        "            },",
        "            {\"args\": args, \"runtime_context\": runtime_context},",
        "            {\"runtime_context\": runtime_context, \"plan_metadata\": plan_metadata},",
        "        ],",
        "    )",
        "    if ok:",
        "        return value",
        "    raise RuntimeError(f\"High-level execution callable {high_level_fn.__name__} failed: {error}\")",
        ""
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", `python3 ${JSON.stringify(scriptPath)}`);
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.script", scriptPath);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    let repairedBeforeExecution = false;
    let recoveredScheduleParametersBeforeExecution = false;
    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {
        experiments: {
          timeout_sec: 43200,
          network_policy: "declared",
          network_purpose: "model_download"
        }
      } as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          const repairedSource = await readFile(scriptPath, "utf8");
          repairedBeforeExecution = repairedSource.includes('"context": runtime_context');
          recoveredScheduleParametersBeforeExecution = repairedSource.includes(
            "_autolabos_condition_schedule_marker_parameter_surface"
          );
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                success: true,
                primary_metric: {
                  name: "accuracy_delta_vs_baseline",
                  value: 0.02,
                  target: 0.01,
                  met: true
                },
                condition_results: [
                  { condition_id: "baseline_condition", status: "completed", accuracy: 0.4 },
                  { condition_id: "candidate_condition_a", status: "completed", accuracy: 0.42 }
                ],
                completed_condition_count: 2
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    await node.execute({ run, graph: run.graph });

    expect(repairedBeforeExecution).toBe(true);
    expect(recoveredScheduleParametersBeforeExecution).toBe(true);
    expect(await readFile(scriptPath, "utf8")).toContain('"context": runtime_context');
    expect(await readFile(scriptPath, "utf8")).toContain(
      "_autolabos_condition_schedule_marker_parameter_surface"
    );
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes(
          "Added context alias to high-level workload invocation in experiment.py"
        )
      )
    ).toBe(true);
  });

  it("does not let P6 harness timeout override runner timeout flags", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-timeout-env-separation-"));
    process.chdir(root);
    const run = makeRun("run-timeout-env-separation");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const scriptPath = path.join(root, "experiment.py");
    await writeFile(
      scriptPath,
      [
        "import argparse",
        "def main(argv=None):",
        "    parser = argparse.ArgumentParser()",
        "    parser.add_argument(\"--metrics-path\", default=\"metrics.json\")",
        "    parser.add_argument(\"--timeout-sec\", type=int, default=0)",
        "    return parser.parse_args(argv)",
        ""
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 " + JSON.stringify(scriptPath));
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.script", scriptPath);
    await runContext.put("implement_experiments.metrics_path", ".autolabos/runs/" + run.id + "/metrics.json");

    const originalP6Timeout = process.env.AUTOLABOS_P6_NEXT_TIMEOUT_SEC;
    process.env.AUTOLABOS_P6_NEXT_TIMEOUT_SEC = "9876";
    let observedCommand = "";
    try {
      const node = createRunExperimentsNode({
        config: {
          experiments: {
            timeout_sec: 1234,
            network_policy: "blocked"
          }
        } as any,
        executionProfile: "local",
        runStore: {} as any,
        eventStream: new InMemoryEventStream(),
        llm: new MockLLMClient(),
        experimentLlm: new MockLLMClient(),
        pdfTextLlm: new MockLLMClient(),
        codex: {} as any,
        aci: {
          runCommand: async (command: string) => {
            observedCommand = command;
            await writeFile(
              path.join(runDir, "metrics.json"),
              JSON.stringify(
                {
                  status: "completed",
                  success: true,
                  primary_metric: {
                    name: "accuracy_delta_vs_baseline",
                    value: 0.02,
                    target: 0.01,
                    met: true
                  },
                  condition_results: [
                    { condition_id: "baseline_condition", status: "completed", accuracy: 0.4 },
                    { condition_id: "candidate_condition_a", status: "completed", accuracy: 0.42 }
                  ],
                  completed_condition_count: 2
                },
                null,
                2
              ),
              "utf8"
            );
            return {
              status: "ok" as const,
              stdout: "runner completed",
              stderr: "",
              exit_code: 0,
              duration_ms: 10
            };
          },
          runTests: async () => ({
            status: "ok" as const,
            stdout: "",
            stderr: "",
            exit_code: 0,
            duration_ms: 1
          })
        } as any,
        semanticScholar: {} as any,
        openAlex: {} as any,
        crossref: {} as any,
        arxiv: {} as any,
        responsesPdfAnalysis: {} as any
      });

      await node.execute({ run, graph: run.graph });
    } finally {
      if (originalP6Timeout === undefined) {
        delete process.env.AUTOLABOS_P6_NEXT_TIMEOUT_SEC;
      } else {
        process.env.AUTOLABOS_P6_NEXT_TIMEOUT_SEC = originalP6Timeout;
      }
    }

    expect(observedCommand).toContain("--timeout-sec 1234");
    expect(observedCommand).not.toContain("--timeout-sec 9876");
  });

  it("does not append timeout flags only mentioned outside argparse", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-timeout-flag-source-mention-"));
    process.chdir(root);
    const run = makeRun("run-timeout-flag-source-mention");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const scriptPath = path.join(root, "experiment.py");
    await writeFile(
      scriptPath,
      [
        "import argparse",
        "TIMEOUT_FLAG = '--timeout-sec'",
        "def main(argv=None):",
        "    parser = argparse.ArgumentParser()",
        "    parser.add_argument('--output-dir', default='.')",
        "    parser.add_argument('--metrics-path', default='metrics.json')",
        "    return parser.parse_args(argv)",
        ""
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", `python3 ${JSON.stringify(scriptPath)}`);
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.script", scriptPath);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    let observedCommand = "";
    const node = createRunExperimentsNode({
      config: {
        experiments: {
          timeout_sec: 14400,
          network_policy: "blocked"
        }
      } as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async (command: string) => {
          observedCommand = command;
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                success: true,
                primary_metric: {
                  name: "accuracy_delta_vs_baseline",
                  value: 0.02,
                  target: 0.01,
                  met: true
                },
                condition_results: [
                  { condition_id: "baseline_condition", status: "completed", accuracy: 0.4 },
                  { condition_id: "candidate_condition_a", status: "completed", accuracy: 0.42 }
                ],
                completed_condition_count: 2
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    await node.execute({ run, graph: run.graph });

    expect(observedCommand).not.toContain("--timeout-sec 14400");
    expect(observedCommand).not.toContain("--budget-timeout-sec 14400");
  });

  it("promotes top-level primary_metric_key and primary_metric before objective contract validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-primary-metric-key-projection-"));
    process.chdir(root);
    const run = makeRun("run-primary-metric-key-projection");
    run.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, {
      version: 1,
      run_id: run.id,
      plan_id: "plan-primary-metric-key-projection",
      selected_hypothesis_ids: ["hypothesis-1"],
      objective_metric_name: run.objectiveMetric,
      baseline_first_required: true,
      baseline_candidate_ids: ["baseline"],
      comparison_mode: "baseline_first_locked",
      budget_profile: {
        mode: "single_run_locked",
        locked: true,
        timeout_sec: 1800
      },
      objective_profile: {
        source: "test",
        raw: run.objectiveMetric,
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        direction: "maximize",
        threshold: 0.01,
        thresholdOperator: ">="
      },
      created_at: new Date().toISOString()
    });

    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                success: true,
                primary_metric_key: "accuracy_delta_vs_baseline",
                primary_metric: -0.03125,
                completed_condition_count: 3,
                required_condition_count: 3,
                conditions: [
                  {
                    marker: "baseline_condition",
                    status: "completed",
                    average_accuracy: 0.28125,
                    accuracy_delta_vs_baseline: 0
                  },
                  {
                    marker: "candidate_condition_d",
                    status: "completed",
                    average_accuracy: 0.25,
                    accuracy_delta_vs_baseline: -0.03125
                  },
                  {
                    marker: "candidate_condition_f",
                    status: "completed",
                    average_accuracy: 0.21875,
                    accuracy_delta_vs_baseline: -0.0625
                  }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).not.toBe("failure");
    const metrics = JSON.parse(await readFile(path.join(runDir, "metrics.json"), "utf8")) as {
      accuracy_delta_vs_baseline?: number;
    };
    expect(metrics.accuracy_delta_vs_baseline).toBe(-0.03125);
    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; summary: string };
    expect(verifierReport.status).toBe("pass");
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes("Promoted primary metric accuracy_delta_vs_baseline=-0.03125")
      )
    ).toBe(true);
  });

  it("promotes aggregate metrics projection before objective contract validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-aggregate-metric-projection-"));
    process.chdir(root);
    const run = makeRun("run-aggregate-metric-projection");
    run.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, {
      version: 1,
      run_id: run.id,
      plan_id: "plan-aggregate-metric-projection",
      selected_hypothesis_ids: ["hypothesis-1"],
      objective_metric_name: run.objectiveMetric,
      baseline_first_required: true,
      baseline_candidate_ids: ["baseline_condition"],
      comparison_mode: "baseline_first_locked",
      budget_profile: {
        mode: "single_run_locked",
        locked: true,
        timeout_sec: 1800
      },
      objective_profile: {
        source: "test",
        raw: run.objectiveMetric,
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        direction: "maximize",
        threshold: 0.01,
        thresholdOperator: ">="
      },
      created_at: new Date().toISOString()
    });

    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "success",
                config: {
                  primary_metric_key: "accuracy_delta_vs_baseline",
                  required_condition_markers: [
                    "baseline_condition",
                    "candidate_condition_a",
                    "candidate_condition_b"
                  ],
                  seed_schedule: [11, 12]
                },
                aggregate: {
                  baseline_marker: "baseline_condition",
                  completed_run_count: 6,
                  completed_condition_count: 3,
                  failed_run_count: 0,
                  best_condition: {
                    marker: "candidate_condition_b",
                    mean_accuracy: 0.62,
                    accuracy_delta_vs_baseline: 0.02
                  },
                  condition_aggregates: [
                    {
                      marker: "baseline_condition",
                      mean_accuracy: 0.6,
                      accuracy_delta_vs_baseline: 0,
                      fully_completed: true
                    },
                    {
                      marker: "candidate_condition_a",
                      mean_accuracy: 0.61,
                      accuracy_delta_vs_baseline: 0.01,
                      fully_completed: true
                    },
                    {
                      marker: "candidate_condition_b",
                      mean_accuracy: 0.62,
                      accuracy_delta_vs_baseline: 0.02,
                      fully_completed: true
                    }
                  ]
                }
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).not.toBe("failure");
    const metrics = JSON.parse(await readFile(path.join(runDir, "metrics.json"), "utf8")) as {
      accuracy_delta_vs_baseline?: number;
      primary_metric_key?: string;
      primary_metric_value?: number;
      completed_run_count?: number;
      completed_condition_count?: number;
      required_run_count?: number;
      required_condition_count?: number;
      best_condition?: { marker?: string };
    };
    expect(metrics.accuracy_delta_vs_baseline).toBe(0.02);
    expect(metrics.primary_metric_key).toBe("accuracy_delta_vs_baseline");
    expect(metrics.primary_metric_value).toBe(0.02);
    expect(metrics.completed_run_count).toBe(6);
    expect(metrics.completed_condition_count).toBe(3);
    expect(metrics.required_run_count).toBe(6);
    expect(metrics.required_condition_count).toBe(3);
    expect(metrics.best_condition?.marker).toBe("candidate_condition_b");
    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; summary: string };
    expect(verifierReport.status).toBe("pass");
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes("Promoted aggregate metrics projection")
      )
    ).toBe(true);
  });
  it("prefers adjacent generated backend implementation over partial internal runner fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-adjacent-backend-discovery-"));
    process.chdir(root);
    const run = makeRun("run-adjacent-backend-discovery");
    run.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    const scriptPath = path.join(root, "experiment.py");
    const backendPath = path.join(root, "backend_experiment_impl.py");
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(
      scriptPath,
      [
        "from pathlib import Path",
        "import importlib.util",
        "import json",
        "import sys",
        "",
        "def discover_backend(explicit_module=None):",
        "    search_dir = Path(__file__).resolve().parent",
        "    candidates = []",
        "    candidates.extend(",
        "        [",
        "            search_dir / \"study_backend.py\",",
        "            search_dir / \"backend.py\",",
        "        ]",
        "    )",
        "    current_file = Path(__file__).resolve()",
        "    for candidate in candidates:",
        "        if not candidate.exists() or candidate.resolve() == current_file:",
        "            continue",
        "        spec = importlib.util.spec_from_file_location(f\"study_backend_{candidate.stem}\", candidate)",
        "        if spec is None or spec.loader is None:",
        "            continue",
        "        module = importlib.util.module_from_spec(spec)",
        "        spec.loader.exec_module(module)",
        "        for fn_name in (\"run_study\", \"run_experiment\", \"execute_study\"):",
        "            fn = getattr(module, fn_name, None)",
        "            if callable(fn):",
        "                return {\"callable\": fn, \"path\": str(candidate)}",
        "    return None",
        "",
        "def partial_internal_backend():",
        "    return {\"status\": \"partial_completed\", \"primary_metric_key\": \"accuracy_delta_vs_baseline\", \"completed_run_count\": 1, \"required_run_count\": 2, \"completed_condition_count\": 0, \"required_condition_count\": 2}",
        "",
        "def main():",
        "    metrics_path = Path(sys.argv[sys.argv.index(\"--metrics-path\") + 1])",
        "    backend = discover_backend(None)",
        "    result = backend[\"callable\"](<metrics_path=metrics_path>) if backend else partial_internal_backend()",
        "    metrics_path.parent.mkdir(parents=True, exist_ok=True)",
        "    metrics_path.write_text(json.dumps(result, indent=2), encoding=\"utf8\")",
        "    print(json.dumps({\"status\": result.get(\"status\"), \"completed_run_count\": result.get(\"completed_run_count\")}))",
        "    return 0",
        "",
        "if __name__ == \"__main__\":",
        "    raise SystemExit(main())"
      ].join("\n").replace("<metrics_path=metrics_path>", "metrics_path=metrics_path"),
      "utf8"
    );
    await writeFile(
      backendPath,
      [
        "import inspect",
        "from typing import Any, Dict, Mapping",
        "",
        "def _backend_call_with_supported_kwargs(func, **kwargs):",
        "    signature = inspect.signature(func)",
        "    filtered_kwargs = {key: value for key, value in kwargs.items() if key in signature.parameters}",
        "    return func(**filtered_kwargs)",
        "",
        "def _invoke_with_supported_kwargs(func: Any, kwargs: Mapping[str, Any]) -> Any:",
        "    signature = inspect.signature(func)",
        "    parameters = signature.parameters",
        "    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):",
        "        return func(**kwargs)",
        "    supported_kwargs: Dict[str, Any] = {}",
        "    for name, parameter in parameters.items():",
        "        if parameter.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.VAR_POSITIONAL):",
        "            continue",
        "        if name in kwargs:",
        "            supported_kwargs[name] = kwargs[name]",
        "    return func(**supported_kwargs)",
        "",
        "def aggregate_study_results(seed_rows, required_condition_markers=None, baseline_condition_marker=None):",
        "    return {",
        "        \"status\": \"success\",",
        "        \"primary_metric_key\": \"accuracy_delta_vs_baseline\",",
        "        \"primary_metric\": 0.02,",
        "        \"primary_metric_value\": 0.02,",
        "        \"accuracy_delta_vs_baseline\": 0.02,",
        "        \"completed_run_count\": len(seed_rows),",
        "        \"required_run_count\": 2,",
        "        \"completed_condition_count\": 2,",
        "        \"required_condition_count\": 2,",
        "        \"baseline_condition_marker\": \"baseline_condition\",",
        "        \"condition_summaries\": [",
        "            {\"condition_marker\": \"baseline_condition\", \"accuracy_delta_vs_baseline\": 0},",
        "            {\"condition_marker\": \"candidate_condition_a\", \"accuracy_delta_vs_baseline\": 0.02},",
        "        ],",
        "    }",
        "",
        "def summarize_payload_for_public_report(aggregate_payload):",
        "    best_condition_summary = {}",
        "    condition_summaries = list(aggregate_payload.get(\"condition_summaries\", []))",
        "    return [summary.get(\"accuracy_delta_vs_baseline\") for summary in condition_summaries]",
        "",
        "def normalize_execution_payload(execution_payload):",
        "    raw_seed_results = execution_payload.get(\"seed_results\")",
        "    if raw_seed_results is None:",
        "        raw_seed_results = execution_payload.get(\"raw_seed_results\")",
        "    if raw_seed_results is None:",
        "        raw_seed_results = execution_payload.get(\"results\")",
        "    return raw_seed_results",
        "",
        "def load_condition_model_bundle(**kwargs):",
        "    return None",
        "",
        "def prepare_single_seed_data_bundle(**kwargs):",
        "    return {\"train_examples\": [], \"eval_examples\": {}}",
        "",
        "def run_single_seed_training(*, condition, seed, model, tokenizer, train_examples, device, runtime_config=None):",
        "    return {\"status\": \"completed\"}",
        "",
        "def run_single_condition_seed(condition_dict, seed, runtime_context):",
        "    training_runner = run_single_seed_training",
        "    try:",
        "        raw_training_output = None",
        "        if training_runner is not None:",
        "            raw_training_output = _invoke_with_supported_kwargs(",
        "                training_runner,",
        "                condition=condition_dict,",
        "                seed=seed,",
        "                runtime_context=runtime_context,",
        "                output_dir=None,",
        "                device=runtime_context.get(\"device\"),",
        "            )",
        "        return raw_training_output",
        "    finally:",
        "        pass",
        "",
        "def run_experiment(metrics_path=None, output_dir=None, **kwargs):",
        "    seed_results = [",
        "        {\"condition_marker\": \"baseline_condition\", \"status\": \"completed\"},",
        "        {\"condition_marker\": \"candidate_condition_a\", \"status\": \"completed\"},",
        "    ]",
        "    return _invoke_with_supported_kwargs(",
        "        aggregate_study_results,",
        "        seed_results=seed_results,",
        "        raw_seed_results=seed_results,",
        "        results=seed_results,",
        "        baseline_condition_marker=\"baseline_condition\",",
        "        required_condition_markers=[\"baseline_condition\", \"candidate_condition_a\"],",
        "    )"
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", `python3 "${scriptPath}" --metrics-path "${path.join(runDir, "metrics.json")}"`);
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, {
      version: 1,
      run_id: run.id,
      plan_id: "plan-adjacent-backend-discovery",
      selected_hypothesis_ids: ["hypothesis-1"],
      objective_metric_name: run.objectiveMetric,
      baseline_first_required: true,
      baseline_candidate_ids: ["baseline_condition"],
      comparison_mode: "baseline_first_locked",
      budget_profile: { mode: "single_run_locked", locked: true, timeout_sec: 1800 },
      objective_profile: {
        source: "test",
        raw: run.objectiveMetric,
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        direction: "maximize",
        threshold: 0.01,
        thresholdOperator: ">="
      },
      created_at: new Date().toISOString()
    });

    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async (command: string) => {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);
          const match = command.match(/python3?\s+"([^"]+)"\s+--metrics-path\s+"([^"]+)"/u);
          if (!match) {
            throw new Error(`unexpected command: ${command}`);
          }
          const result = await execFileAsync("python3", [match[1], "--metrics-path", match[2]], { cwd: root });
          return {
            status: "ok" as const,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({ status: "ok" as const, stdout: "", stderr: "", exit_code: 0, duration_ms: 1 })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).not.toBe("failure");
    const metrics = JSON.parse(await readFile(path.join(runDir, "metrics.json"), "utf8")) as {
      accuracy_delta_vs_baseline?: number;
      completed_run_count?: number;
      completed_condition_count?: number;
    };
    expect(metrics.accuracy_delta_vs_baseline).toBe(0.02);
    expect(metrics.completed_run_count).toBe(2);
    expect(metrics.completed_condition_count).toBe(2);
    expect(await readFile(scriptPath, "utf8")).toContain("backend_experiment_impl.py");
    const backendSource = await readFile(backendPath, "utf8");
    expect(backendSource).toContain("raw_condition_summaries = aggregate_payload.get");
    expect(backendSource).toContain("kwargs: Any = None, **extra_kwargs: Any");
    expect(backendSource).toContain('execution_payload.get("seed_rows")');
    expect(backendSource).toContain("_autolabos_training_inputs_bridge_marker");
    expect(backendSource).toContain("train_examples=bridge_train_examples");
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes("Added adjacent backend_experiment_impl.py discovery")
      )
    ).toBe(true);
  });
  it("promotes condition summary primary metric when the top-level objective metric is null", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-condition-summary-metric-projection-"));
    process.chdir(root);
    const run = makeRun("run-condition-summary-metric-projection");
    run.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, {
      version: 1,
      run_id: run.id,
      plan_id: "plan-condition-summary-metric-projection",
      selected_hypothesis_ids: ["hypothesis-1"],
      objective_metric_name: run.objectiveMetric,
      baseline_first_required: true,
      baseline_candidate_ids: ["baseline"],
      comparison_mode: "baseline_first_locked",
      budget_profile: {
        mode: "single_run_locked",
        locked: true,
        timeout_sec: 1800
      },
      objective_profile: {
        source: "test",
        raw: run.objectiveMetric,
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline"],
        direction: "maximize",
        threshold: 0.01,
        thresholdOperator: ">="
      },
      created_at: new Date().toISOString()
    });

    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                primary_metric_key: "accuracy_delta_vs_baseline",
                primary_metric_value: null,
                accuracy_delta_vs_baseline: null,
                completed_run_count: 22,
                completed_condition_count: 4,
                baseline_condition_marker: "baseline_condition",
                condition_summaries: [
                  {
                    condition_marker: "baseline_condition",
                    completed_runs: 7,
                    accuracy_delta_vs_baseline: 0
                  },
                  {
                    condition_marker: "candidate_condition_a",
                    completed_runs: 5,
                    accuracy_delta_vs_baseline: 0
                  },
                  {
                    condition_marker: "candidate_condition_d",
                    completed_runs: 5,
                    accuracy_delta_vs_baseline: -0.0375
                  },
                  {
                    condition_marker: "candidate_condition_f",
                    completed_runs: 5,
                    accuracy_delta_vs_baseline: -0.0375
                  }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).not.toBe("failure");
    const metrics = JSON.parse(await readFile(path.join(runDir, "metrics.json"), "utf8")) as {
      accuracy_delta_vs_baseline?: number;
      primary_metric_value?: number;
    };
    expect(metrics.accuracy_delta_vs_baseline).toBe(0);
    expect(metrics.primary_metric_value).toBe(0);
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes("Promoted condition-summary primary metric accuracy_delta_vs_baseline=0")
      )
    ).toBe(true);
  });

  it("publishes canonical public summaries from accepted run metrics instead of stale runner summaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-public-summary-sync-"));
    process.chdir(root);
    const run = makeRun("run-public-summary-sync");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    const publicExperimentDir = buildPublicSectionDir(root, run, "experiment");
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await mkdir(publicExperimentDir, { recursive: true });
    await writeFile(
      path.join(publicExperimentDir, "summary.json"),
      JSON.stringify({ status: "failed", completed_run_count: 0, required_run_count: 24 }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(publicExperimentDir, "study_summary.json"),
      JSON.stringify({ status: "failed", completed_run_count: 0, required_run_count: 24 }, null, 2),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                accuracy: 0.95,
                completed_run_count: 24,
                required_run_count: 24,
                attempted_run_count: 24,
                failed_run_count: 0,
                completed_condition_count: 8,
                required_condition_count: 8,
                accuracy_delta_vs_baseline: 0,
                condition_summaries: [
                  {
                    condition_marker: "baseline_condition",
                    completed_runs: 3,
                    accuracy_delta_vs_baseline: 0
                  }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const publicSummary = JSON.parse(await readFile(path.join(publicExperimentDir, "summary.json"), "utf8")) as {
      source?: string;
      completed_run_count?: number;
      required_run_count?: number;
      failed_run_count?: number;
    };
    const publicStudySummary = JSON.parse(
      await readFile(path.join(publicExperimentDir, "study_summary.json"), "utf8")
    ) as {
      source?: string;
      completed_run_count?: number;
      required_run_count?: number;
      completed_condition_count?: number;
    };
    expect(publicSummary).toMatchObject({
      source: "run_experiments",
      completed_run_count: 24,
      required_run_count: 24,
      failed_run_count: 0
    });
    expect(publicStudySummary).toMatchObject({
      source: "run_experiments",
      completed_run_count: 24,
      required_run_count: 24,
      completed_condition_count: 8
    });
  });

  it("repairs _make_config_instance dataclass aliases before run_experiments execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-config-instance-alias-"));
    process.chdir(root);
    const run = makeRun("run-config-instance-alias");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const scriptPath = path.join(root, "experiment.py");
    await writeFile(
      scriptPath,
      [
        "from dataclasses import dataclass",
        "",
        "@dataclass(frozen=True)",
        "class ConditionSpec:",
        "    marker: str",
        "    adapter_rank: int",
        "    adapter_alpha: int",
        "    adapter_dropout: float",
        "",
        "def _make_config_instance(type_name, **kwargs):",
        "    cls = globals().get(type_name)",
        "    if cls is None:",
        "        payload = dict(kwargs)",
        "        payload.setdefault('_type', type_name)",
        "        return payload",
        "    try:",
        "        return cls(**kwargs)",
        "    except TypeError:",
        "        dataclass_fields = getattr(cls, '__dataclass_fields__', None)",
        "        if dataclass_fields:",
        "            filtered = {key: value for key, value in kwargs.items() if key in dataclass_fields}",
        "            return cls(**filtered)",
        "        payload = dict(kwargs)",
        "        payload.setdefault('_type', type_name)",
        "        return payload",
        "",
        "BASELINE_CONDITION_SPEC = _make_config_instance(",
        "    'ConditionSpec',",
        "    marker='baseline',",
        "    condition_id='baseline',",
        "    rank=8,",
        "    adapter_alpha=16,",
        "    adapter_dropout=0.0,",
        ")",
        ""
      ].join("\n"),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", `python3 ${JSON.stringify(scriptPath)}`);
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.script", scriptPath);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    let repairedBeforeExecution = false;
    const eventStream = new InMemoryEventStream();
    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          const repairedSource = await readFile(scriptPath, "utf8");
          repairedBeforeExecution = repairedSource.includes("_autolabos_config_instance_dataclass_field_alias_marker");
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                success: true,
                primary_metric: {
                  name: "accuracy_delta_vs_baseline",
                  value: 0.02,
                  target: 0.01,
                  met: true
                },
                condition_results: [
                  {
                    condition_id: "baseline",
                    condition_type: "baseline",
                    status: "completed",
                    accuracy: 0.4
                  },
                  {
                    condition_id: "candidate",
                    condition_type: "candidate",
                    status: "completed",
                    accuracy: 0.42
                  }
                ],
                completed_condition_count: 2
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner completed",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    await node.execute({ run, graph: run.graph });

    expect(repairedBeforeExecution).toBe(true);
    expect(await readFile(scriptPath, "utf8")).toContain("alias_values = dict(kwargs)");
    expect(
      eventStream.history().some((event) =>
        String(event.payload.text || "").includes("Added dataclass field aliases for _make_config_instance")
      )
    ).toBe(true);
  });

  it("classifies all-condition Hugging Face model load failures as dependency blockers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-model-dependency-blocker-"));
    process.chdir(root);
    const run = makeRun("run-model-dependency-blocker");
    run.objectiveMetric = "accuracy_delta_vs_baseline";
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "completed",
                condition_results: [
                  {
                    condition_id: "unmodified_base",
                    status: "failed",
                    error:
                      "OSError: Can't load the configuration of 'EleutherAI/pythia-410m'. If you were trying to load it from Hugging Face, make sure the model is available or cached locally."
                  },
                  {
                    condition_id: "vanilla_adapter",
                    status: "failed",
                    evidence: {
                      error_message:
                        "OSError: Can't load the configuration of 'EleutherAI/pythia-410m'. AutoModelForCausalLM.from_pretrained failed."
                    }
                  }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner wrote dependency-failed metrics",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment dependency blocker");
    expect(result.error).toContain("EleutherAI/pythia-410m");
    expect(result.error).toContain("No condition metrics were accepted as evidence");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string; suggested_next_action?: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("Experiment dependency blocker");
  });

  it("fails verification when comparator recipes report failed statuses inside otherwise ok metrics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-failed-recipes-"));
    process.chdir(root);
    const run = makeRun("run-failed-recipes");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "ok",
                primary_metric: {
                  name: "mean_zero_shot_accuracy",
                  absolute_improvement_over_baseline: 0
                },
                recipes: {
                  baseline: {
                    status: "ok",
                    evaluation: {
                      mean_zero_shot_accuracy: 0.4
                    }
                  },
                  adapter_r4: {
                    status: "failed",
                    error: "TrainingArguments.__init__() got an unexpected keyword argument 'overwrite_output_dir'"
                  }
                }
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner wrote partial metrics",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment metrics payload reports failed recipe(s)");
    expect(result.error).toContain("adapter_r4");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("Experiment metrics payload reports failed recipe(s)");
  });

  it("fails verification when a required run contract exits zero with no completed runs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-zero-completed-"));
    process.chdir(root);
    const run = makeRun("run-zero-completed");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "success",
                accuracy: 0.95,
                required_condition_count: 5,
                completed_condition_count: 0,
                required_run_count: 25,
                completed_run_count: 0,
                failure_count: 2,
                seed_results: [
                  {
                    status: "failed",
                    error_type: "RuntimeError",
                    error_stage: "execution",
                    error_message: "No seed execution helper was found in the current runner module."
                  },
                  {
                    status: "failed",
                    error_type: "RuntimeError",
                    error_stage: "execution",
                    error_message: "No seed execution helper was found in the current runner module."
                  }
                ],
                study_summary: {
                  status: "failed",
                  required_run_count: 25,
                  completed_run_count: 0
                }
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner exited zero after failed condition loop",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("No required experiment runs completed successfully");
    expect(result.error).toContain("No seed execution helper was found in the current runner module");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("No required experiment runs completed successfully");
    expect(verifierReport.summary).toContain("seed_failure_messages=RuntimeError: stage=execution");
  });

  it("surfaces nested backend discovery failures from rejected metrics payloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-nested-backend-failure-"));
    process.chdir(root);
    const run = makeRun("run-nested-backend-failure");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "failed",
                primary_metric: {
                  key: "accuracy_delta_vs_baseline",
                  value: null
                },
                aggregates: {
                  completed_run_count: 0,
                  failed_run_count: 2
                },
                backend: {
                  status: "not_found",
                  attempts: [
                    {
                      candidate: "backend_candidate_a",
                      error: "ModuleNotFoundError: No module named backend_candidate_a",
                      status: "failed"
                    }
                  ]
                },
                raw_results: [
                  {
                    condition_marker: "baseline_condition",
                    status: "failed",
                    error_message: "No supported backend module discovered: not_found"
                  }
                ],
                condition_summaries: [
                  {
                    marker: "baseline_condition",
                    completed_run_count: 0,
                    status: "failed",
                    seed_results: [
                      {
                        seed: 1,
                        status: "failed",
                        error_message: "No supported backend module discovered: not_found"
                      }
                    ]
                  }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner wrote failed metrics payload",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("No supported backend module discovered: not_found");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("metrics_error_messages=ModuleNotFoundError");
    expect(verifierReport.summary).toContain("seed_failure_messages=No supported backend module discovered: not_found");
  });

  it("fails verification when planned run coverage is contracted below the portfolio evidence floor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-run-contracted-coverage-"));
    process.chdir(root);
    const run = makeRun("run-contracted-coverage");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(
      path.join(runDir, "experiment_portfolio.json"),
      JSON.stringify(
        {
          version: 1,
          run_id: run.id,
          created_at: new Date().toISOString(),
          execution_model: "single_run",
          comparison_axes: ["rank"],
          primary_trial_group_id: "primary",
          trial_groups: [
            {
              id: "primary",
              label: "Primary repeated-seed rank sweep",
              role: "primary",
              group_kind: "aggregate",
              dataset_scope: ["Benchmark Task A", "Benchmark Task B"],
              metrics: ["accuracy_delta_vs_baseline"],
              baselines: ["Locked baseline condition"],
              notes: [
                "Paper-scale evidence floor: 4 ranks x 5 seeds = 20 fine-tune runs, plus 2 exact baseline reruns.",
                "Training budget is 22 runs total including exact baseline repeats."
              ]
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const runContext = new RunContextMemory(path.join(runDir, "memory", "run_context.json"));
    await runContext.put("implement_experiments.run_command", "python3 experiment.py");
    await runContext.put("implement_experiments.cwd", root);
    await runContext.put("implement_experiments.metrics_path", `.autolabos/runs/${run.id}/metrics.json`);

    const node = createRunExperimentsNode({
      config: {} as any,
      executionProfile: "local",
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: new MockLLMClient(),
      pdfTextLlm: new MockLLMClient(),
      codex: {} as any,
      aci: {
        runCommand: async () => {
          await writeFile(
            path.join(runDir, "metrics.json"),
            JSON.stringify(
              {
                status: "success",
                accuracy: 0.95,
                accuracy_delta_vs_baseline: 0,
                completed_run_count: 4,
                completed_condition_count: 4,
                condition_summaries: [
                  { condition_marker: "baseline_condition", completed_runs: 1 },
                  { condition_marker: "candidate_condition_a", completed_runs: 1 },
                  { condition_marker: "candidate_condition_d", completed_runs: 1 },
                  { condition_marker: "candidate_condition_f", completed_runs: 1 }
                ]
              },
              null,
              2
            ),
            "utf8"
          );
          return {
            status: "ok" as const,
            stdout: "runner exited zero with a smoke-scale contracted run",
            stderr: "",
            exit_code: 0,
            duration_ms: 10
          };
        },
        runTests: async () => ({
          status: "ok" as const,
          stdout: "",
          stderr: "",
          exit_code: 0,
          duration_ms: 1
        })
      } as any,
      semanticScholar: {} as any,
      openAlex: {} as any,
      crossref: {} as any,
      arxiv: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Experiment run coverage incomplete: completed_run_count=4/22");

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("completed_run_count=4/22");
  });
});
