import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createRunExperimentsNode } from "../src/core/nodes/runExperiments.js";
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
                    name: "mean_zero_shot_accuracy_arc_challenge_hellaswag",
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
});
