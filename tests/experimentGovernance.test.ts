import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import {
  buildExperimentComparisonContract,
  buildExperimentImplementationContext,
  EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_ARTIFACT,
  EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT,
  freezeManagedBundleLock,
  storeExperimentGovernanceDecision
} from "../src/core/experimentGovernance.js";
import { MockLLMClient, LLMCompleteOptions } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createAnalyzeResultsNode } from "../src/core/nodes/analyzeResults.js";
import { createRunExperimentsNode } from "../src/core/nodes/runExperiments.js";
import { buildHeuristicObjectiveMetricProfile } from "../src/core/objectiveMetric.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

class AnalysisLlm extends MockLLMClient {
  override async complete(prompt: string, opts?: LLMCompleteOptions): Promise<{ text: string }> {
    if (opts?.systemPrompt?.includes("result analysis discussion agent")) {
      return {
        text: JSON.stringify({
          discussion_points: ["The primary condition met the absolute target but trailed the baseline."],
          failure_analysis: ["The locked baseline comparison should drive the next transition."],
          follow_up_actions: ["Revise the experiment design before another candidate run."],
          confidence_statement: "Confidence is moderate because the metric table is populated."
        })
      };
    }
    return super.complete(prompt, opts);
  }
}

function makeRun(runId: string, currentNode: RunRecord["currentNode"], objectiveMetric: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Governed Experiment Run",
    topic: "Baseline-aware experiment governance",
    constraints: [],
    objectiveMetric,
    status: "running",
    currentNode,
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    graph: createDefaultGraphState(),
    memoryRefs: {
      runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

function buildNodeDeps(overrides?: {
  aci?: Record<string, unknown>;
  llm?: MockLLMClient;
}) {
  return {
    config: {
      experiments: { runner: "local_python", timeout_sec: 1800, allow_network: false }
    },
    runStore: {},
    eventStream: new InMemoryEventStream(),
    llm: overrides?.llm || new AnalysisLlm(),
    pdfTextLlm: new MockLLMClient(),
    codex: {},
    aci:
      overrides?.aci ||
      ({
        runCommand: async () => ({ status: "ok", stdout: "", stderr: "", exit_code: 0, duration_ms: 0 }),
        runTests: async () => ({ status: "ok", stdout: "", stderr: "", exit_code: 0, duration_ms: 0 })
      } as Record<string, unknown>),
    semanticScholar: {},
    responsesPdfAnalysis: {}
  } as never;
}

describe("experiment governance", () => {
  it("writes a baseline snapshot and rejects candidates that do not beat the locked baseline", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-experiment-governance-analyze-"));
    process.chdir(root);

    const run = makeRun("run-governance-analyze", "analyze_results", "accuracy at least 0.8");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    const memoryDir = path.join(runDir, "memory");
    const publicDir = path.join(root, "public-experiment");
    await mkdir(memoryDir, { recursive: true });
    await mkdir(publicDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "implement_experiments.metrics_path",
            value: `.autolabos/runs/${run.id}/metrics.json`,
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.public_dir",
            value: publicDir,
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "metrics.json"),
      JSON.stringify(
        {
          accuracy: 0.85,
          primary_condition: "candidate_runner",
          baseline_condition: "baseline_runner",
          condition_metrics: {
            candidate_runner: { accuracy: 0.85 },
            baseline_runner: { accuracy: 0.87 }
          },
          sampling_profile: {
            name: "standard",
            total_trials: 6,
            executed_trials: 6
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "experiment_plan.yaml"),
      [
        "selected_hypothesis_ids:",
        '  - "h_1"',
        "selected_design:",
        '  id: "design_accuracy"',
        '  title: "Accuracy benchmark"',
        '  summary: "Compare candidate and baseline runners."',
        "  metrics:",
        '    - "accuracy"',
        "  baselines:",
        '    - "baseline_runner"',
        "  evaluation_steps:",
        '    - "Measure candidate vs baseline accuracy."',
        "  risks:",
        '    - "Absolute accuracy can hide baseline regressions."',
        "  resource_notes:",
        '    - "Standard profile only."'
      ].join("\n"),
      "utf8"
    );

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    const contract = buildExperimentComparisonContract({
      run,
      selectedDesign: {
        id: "design_accuracy",
        hypothesis_ids: ["h_1"],
        baselines: ["baseline_runner"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile(run.objectiveMetric),
      managedBundleSupported: false
    });
    const implementationContext = buildExperimentImplementationContext({
      contract,
      branchPlan: {
        branch_id: "search_primary",
        focus_files: ["experiments/run_accuracy.py"]
      },
      changedFiles: ["experiments/run_accuracy.py"],
      scriptPath: path.join(publicDir, "run_accuracy.py"),
      runCommand: `python3 ${JSON.stringify(path.join(publicDir, "run_accuracy.py"))}`,
      workingDir: publicDir
    });
    await storeExperimentGovernanceDecision(run, memory, {
      contract,
      implementationContext,
      entries: []
    });

    const analyzeNode = createAnalyzeResultsNode(buildNodeDeps());
    const result = await analyzeNode.execute({ run });

    expect(result.status).toBe("success");
    expect(result.transitionRecommendation).toMatchObject({
      action: "backtrack_to_design",
      targetNode: "design_experiments"
    });

    const baselineSnapshot = JSON.parse(
      await readFile(path.join(runDir, EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_ARTIFACT), "utf8")
    ) as {
      baseline_value: number;
      primary_value: number;
      baseline_condition: string;
      primary_condition: string;
    };
    expect(baselineSnapshot).toMatchObject({
      baseline_value: 0.87,
      primary_value: 0.85,
      baseline_condition: "baseline_runner",
      primary_condition: "candidate_runner"
    });

    const ledger = JSON.parse(
      await readFile(path.join(runDir, EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT), "utf8")
    ) as {
      entries: Array<{ candidate_id: string; verdict: string; rationale: string }>;
    };
    expect(ledger.entries.some((entry) => entry.candidate_id.includes(":baseline:") && entry.verdict === "keep")).toBe(
      true
    );
    expect(
      ledger.entries.some(
        (entry) => entry.candidate_id.endsWith(":primary") && entry.verdict === "discard" && /did not improve/u.test(entry.rationale)
      )
    ).toBe(true);
  });

  it("records crash verdicts in the ledger when run_experiments fails before metrics", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-experiment-governance-run-"));
    process.chdir(root);

    const run = makeRun("run-governance-run", "run_experiments", "accuracy at least 0.8");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    const memoryDir = path.join(runDir, "memory");
    const publicDir = path.join(root, "public-experiment");
    await mkdir(memoryDir, { recursive: true });
    await mkdir(publicDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "implement_experiments.run_command",
            value: "python3 missing_experiment.py",
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.cwd",
            value: root,
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.metrics_path",
            value: `.autolabos/runs/${run.id}/metrics.json`,
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.public_dir",
            value: publicDir,
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.pending_handoff_to_run_experiments",
            value: false,
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    const contract = buildExperimentComparisonContract({
      run,
      selectedDesign: {
        id: "design_accuracy",
        hypothesis_ids: ["h_1"],
        baselines: ["baseline_runner"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile(run.objectiveMetric),
      managedBundleSupported: false
    });
    const implementationContext = buildExperimentImplementationContext({
      contract,
      branchPlan: {
        branch_id: "search_primary",
        focus_files: ["missing_experiment.py"]
      },
      changedFiles: ["missing_experiment.py"],
      runCommand: "python3 missing_experiment.py",
      workingDir: root
    });
    await storeExperimentGovernanceDecision(run, memory, {
      contract,
      implementationContext,
      entries: []
    });

    const runNode = createRunExperimentsNode(
      buildNodeDeps({
        aci: {
          runCommand: async () => ({
            status: "error",
            stdout: "",
            stderr: "python3: can't open file 'missing_experiment.py'",
            exit_code: 2,
            duration_ms: 0
          }),
          runTests: async () => ({ status: "ok", stdout: "", stderr: "", exit_code: 0, duration_ms: 0 })
        }
      })
    );
    const result = await runNode.execute({ run });

    expect(result.status).toBe("failure");
    const executionPlan = JSON.parse(
      await readFile(path.join(runDir, "run_experiments_panel", "execution_plan.json"), "utf8")
    ) as {
      comparison_mode?: string;
      budget_profile?: { mode: string };
    };
    expect(executionPlan).toMatchObject({
      comparison_mode: "baseline_first_locked",
      budget_profile: { mode: "single_run_locked" }
    });

    const ledger = JSON.parse(
      await readFile(path.join(runDir, EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT), "utf8")
    ) as {
      entries: Array<{ candidate_id: string; verdict: string; rationale: string }>;
    };
    expect(
      ledger.entries.some(
        (entry) => entry.candidate_id.endsWith(":primary") && entry.verdict === "crash" && /missing_experiment/u.test(entry.rationale)
      )
    ).toBe(true);
  });

  it("rejects managed bundle candidates when immutable evaluator artifacts drift after the standard run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-experiment-governance-managed-"));
    process.chdir(root);

    const run = makeRun("run-governance-managed", "analyze_results", "accuracy at least 0.8");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    const memoryDir = path.join(runDir, "memory");
    const publicDir = path.join(root, "public-experiment");
    await mkdir(memoryDir, { recursive: true });
    await mkdir(publicDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "implement_experiments.metrics_path",
            value: `.autolabos/runs/${run.id}/metrics.json`,
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.public_dir",
            value: publicDir,
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "metrics.json"),
      JSON.stringify(
        {
          accuracy: 0.91,
          sampling_profile: {
            name: "standard",
            total_trials: 48,
            executed_trials: 48
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(path.join(runDir, "experiment_plan.yaml"), 'selected_design:\n  id: "design_managed"\n', "utf8");
    await writeFile(path.join(publicDir, "run_experiment.py"), "print('bundle')\n", "utf8");
    await writeFile(
      path.join(publicDir, "experiment_config.json"),
      JSON.stringify(
        {
          experiment_mode: "real_execution",
          llm_profile: {
            provider: "openai",
            model: "gpt-5.4",
            reasoning_effort: "medium",
            fast_mode: false
          },
          execution: {
            max_workers: 2,
            role_overrides: {
              planner: "gpt-5.4"
            }
          },
          sampling: {
            standard: {
              repeats: 2,
              prompt_count: 2,
              tasks_per_dataset: 2
            }
          },
          conditions: [
            { id: "baseline", label: "Baseline" },
            { id: "candidate", label: "Candidate" }
          ],
          token_limit: 4096,
          timeout_sec: 1800,
          allow_network: false
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(publicDir, "benchmark_tasks.json"),
      JSON.stringify([{ id: "task-1", prompt: "Solve task 1" }], null, 2),
      "utf8"
    );
    await writeFile(
      path.join(publicDir, "prompts.json"),
      JSON.stringify([{ id: "prompt-1", planner: "plan", solver: "solve" }], null, 2),
      "utf8"
    );
    await writeFile(
      path.join(publicDir, "evaluator_manifest.json"),
      JSON.stringify(
        {
          qa_metric: "exact_match",
          code_metric: "pass@1"
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(publicDir, "environment.lock.json"),
      JSON.stringify(
        {
          python: "3.11.8",
          platform: "Linux",
          implementation: "CPython",
          provider: "openai",
          model: "gpt-5.4",
          reasoning_effort: "medium",
          fast_mode: false,
          generated_at: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    const contract = buildExperimentComparisonContract({
      run,
      selectedDesign: {
        id: "design_managed",
        hypothesis_ids: ["h_1"],
        baselines: []
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile(run.objectiveMetric),
      managedBundleSupported: true
    });
    const implementationContext = buildExperimentImplementationContext({
      contract,
      branchPlan: {
        branch_id: "search_primary",
        focus_files: [path.join(publicDir, "run_experiment.py")]
      },
      changedFiles: [path.join(publicDir, "run_experiment.py")],
      scriptPath: path.join(publicDir, "run_experiment.py"),
      runCommand: `python3 ${JSON.stringify(path.join(publicDir, "run_experiment.py"))}`,
      workingDir: publicDir
    });
    const managedBundleLock = await freezeManagedBundleLock({
      contract,
      publicDir
    });
    expect(managedBundleLock).toBeTruthy();
    await storeExperimentGovernanceDecision(run, memory, {
      contract,
      implementationContext,
      managedBundleLock: managedBundleLock || undefined,
      entries: []
    });

    await writeFile(
      path.join(publicDir, "evaluator_manifest.json"),
      JSON.stringify(
        {
          qa_metric: "f1",
          code_metric: "pass@1"
        },
        null,
        2
      ),
      "utf8"
    );

    const analyzeNode = createAnalyzeResultsNode(buildNodeDeps());
    const result = await analyzeNode.execute({ run });

    expect(result.status).toBe("success");
    expect(result.transitionRecommendation).toMatchObject({
      action: "backtrack_to_implement",
      targetNode: "implement_experiments"
    });

    const ledger = JSON.parse(
      await readFile(path.join(runDir, EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT), "utf8")
    ) as {
      entries: Array<{ candidate_id: string; verdict: string; rationale: string }>;
    };
    expect(
      ledger.entries.some(
        (entry) =>
          entry.candidate_id.endsWith(":primary") &&
          entry.verdict === "discard" &&
          /immutable evaluator contract drifted/u.test(entry.rationale)
      )
    ).toBe(true);
  });
});
