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
      baseline_candidate_ids: ["standard_lora_baseline"],
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
                    name: "lora_r8",
                    condition_type: "peft_lora_instruction_tuned",
                    evaluation: { mean_zero_shot_accuracy: 0.412 }
                  },
                  {
                    name: "lora_r16",
                    condition_type: "peft_lora_instruction_tuned",
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
                    condition_id: "vanilla_lora",
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
                  lora_r4: {
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
    expect(result.error).toContain("lora_r4");

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

    const verifierReport = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_verify_report.json"), "utf8")
    ) as { status: string; stage: string; summary: string };
    expect(verifierReport).toMatchObject({
      status: "fail",
      stage: "metrics"
    });
    expect(verifierReport.summary).toContain("No required experiment runs completed successfully");
  });
});
