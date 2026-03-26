import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import { createDesignExperimentsNode } from "../src/core/nodes/designExperiments.js";
import { createWritePaperNode } from "../src/core/nodes/writePaper.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { buildPublicExperimentDir, buildPublicRunManifestPath } from "../src/core/publicArtifacts.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

class CountingJsonLLMClient extends MockLLMClient {
  calls = 0;
  private index = 0;

  constructor(private readonly responses: string[]) {
    super();
  }

  override async complete(_prompt: string): Promise<{ text: string }> {
    this.calls += 1;
    const response = this.responses[Math.min(this.index, this.responses.length - 1)] ?? "";
    this.index += 1;
    return { text: response };
  }
}

class ThrowingLLMClient extends MockLLMClient {
  constructor(private readonly message: string) {
    super();
  }

  override async complete(): Promise<{ text: string }> {
    throw new Error(this.message);
  }
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

function makeRun(root: string, runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Multi-Agent Collaboration",
    topic: "AI agent automation",
    constraints: ["last 5 years", "open access", "ACL style", "short paper", "formal tone"],
    objectiveMetric: "state-of-the-art reproducibility",
    status: "running",
    currentNode: "design_experiments",
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

async function seedWritePaperInputs(runDir: string): Promise<void> {
  await mkdir(path.join(runDir, "memory"), { recursive: true });
  await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
  await writeFile(
    path.join(runDir, "paper_summaries.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Coordination Benchmark",
      source_type: "full_text",
      summary: "Structured coordination improves reproducibility.",
      key_findings: ["Structured coordination improves reproducibility."],
      limitations: ["Benchmark coverage is limited."],
      datasets: ["AgentBench-mini"],
      metrics: ["reproducibility_score"],
      novelty: "Constraint-aware coordination",
      reproducibility_notes: ["Repeated runs are included."]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "evidence_store.jsonl"),
    `${JSON.stringify({
      evidence_id: "ev_1",
      paper_id: "paper_1",
      claim: "Structured coordination improves reproducibility.",
      method_slot: "shared state schema",
      result_slot: "higher reproducibility_score",
      limitation_slot: "limited benchmark coverage",
      dataset_slot: "AgentBench-mini",
      metric_slot: "reproducibility_score",
      evidence_span: "Repeated runs improved reproducibility_score.",
      source_type: "full_text",
      confidence: 0.9
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "hypotheses.jsonl"),
    `${JSON.stringify({
      hypothesis_id: "h_1",
      text: "Structured coordination improves reproducibility.",
      evidence_links: ["ev_1"]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "corpus.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Coordination Benchmark",
      abstract: "Structured coordination improves reproducibility.",
      authors: ["Alice Doe"],
      year: 2025,
      venue: "ACL"
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "experiment_plan.yaml"),
    [
      "selected_design:",
      '  title: "Constraint propagation benchmark"',
      '  summary: "Evaluate structured coordination with the configured writing constraints."'
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "result_analysis.json"),
    JSON.stringify(
      {
        overview: {
          objective_status: "observed",
          selected_design_title: "Constraint propagation benchmark"
        }
      },
      null,
      2
    ),
    "utf8"
  );
}

describe("constraint propagation", () => {
  it("writes run constraints into experiment_plan.yaml", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-constraints-"));
    process.chdir(root);

    const runId = "run-design-constraints";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      [
        JSON.stringify({ text: "Hypothesis A" }),
        JSON.stringify({ text: "Hypothesis B" })
      ].join("\n") + "\n",
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    expect(plan).toContain('    - "last 5 years"');
    expect(plan).toContain("    last_years: 5");
    expect(plan).toContain("    open_access_pdf: true");
    expect(plan).toContain('    target_venue: "ACL"');
    expect(plan).toContain('    tone_hint: "formal academic"');
    expect(plan).toContain('    length_hint: "short paper"');

    const publicPlanPath = path.join(buildPublicExperimentDir(root, run), "experiment_plan.yaml");
    expect(await readFile(publicPlanPath, "utf8")).toBe(plan);

    await writeFile(publicPlanPath, "stale plan\n", "utf8");
    const rerunResult = await node.execute({ run, graph: run.graph });
    expect(rerunResult.status).toBe("success");
    expect(await readFile(publicPlanPath, "utf8")).toBe(plan);

    const manifest = JSON.parse(await readFile(buildPublicRunManifestPath(root, run), "utf8")) as {
      generated_files: string[];
      sections?: {
        experiment?: {
          generated_files: string[];
        };
      };
    };
    expect(manifest.generated_files).toContain("experiment/experiment_plan.yaml");
    expect(manifest.sections?.experiment?.generated_files).toContain("experiment/experiment_plan.yaml");
  });

  it("fails fast when no hypotheses artifact is available for design", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-missing-hypotheses-"));
    process.chdir(root);

    const runId = "run-design-missing-hypotheses";
    const run = makeRun(root, runId);
    run.constraints = [];
    run.objectiveMetric = "";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("No valid hypotheses were found");
    await expect(readFile(path.join(runDir, "experiment_plan.yaml"), "utf8")).rejects.toThrow();
  });

  it("writes YAML-safe experiment plans when llm text spans multiple lines", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-yaml-safe-"));
    process.chdir(root);

    const runId = "run-design-yaml-safe";
    const run = makeRun(root, runId);
    run.constraints = [];
    run.objectiveMetric = "";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({ hypothesis_id: "h_1", text: "A hypothesis with multiline plan output." })}\n`,
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new CountingJsonLLMClient([
        JSON.stringify({
          summary: "Generated a multiline design.",
          candidates: [
            {
              id: "plan_1",
              title: "Plan line 1\nPlan line 2",
              hypothesis_ids: ["h_1"],
              plan_summary: "Summary line 1\nSummary line 2",
              datasets: ["Benchmark-A"],
              metrics: ["accuracy"],
              baselines: ["baseline"],
              implementation_notes: ["Step 1\nStep 2"],
              evaluation_steps: ["Measure line 1\nMeasure line 2"],
              risks: ["Risk line 1\nRisk line 2"],
              resource_notes: ["Resource line 1\nResource line 2"]
            }
          ],
          selected_id: "plan_1"
        })
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    const parsed = YAML.parse(plan) as {
      selected_design?: { title?: string; summary?: string; implementation_notes?: string[]; evaluation_steps?: string[] };
    };
    expect(parsed.selected_design?.title).toBe("Plan line 1\nPlan line 2");
    expect(parsed.selected_design?.summary).toBe("Summary line 1\nSummary line 2");
    expect(parsed.selected_design?.implementation_notes?.[0]).toBe("Step 1\nStep 2");
    expect(parsed.selected_design?.evaluation_steps?.[0]).toBe("Measure line 1\nMeasure line 2");
  });

  it("normalizes predefined runtime guardrails into explicit thresholds before persisting the plan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-threshold-normalization-"));
    process.chdir(root);

    const runId = "run-design-threshold-normalization";
    const run = makeRun(root, runId);
    run.topic = "Classical machine learning baselines for tabular classification on small public datasets.";
    run.objectiveMetric = "";
    run.constraints = [];
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({
        hypothesis_id: "h_1",
        text: "Strict fold-local nesting reduces macro-F1 variance without hurting lightweight CPU execution."
      })}\n`,
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new CountingJsonLLMClient([
        JSON.stringify({
          summary: "Generated a threshold-sensitive design.",
          candidates: [
            {
              id: "plan_1",
              title: "Variance-aware nested tabular benchmark",
              hypothesis_ids: ["h_1"],
              plan_summary:
                "Compare nested and non-nested pipelines while keeping runtime within a predefined practical threshold such as 25 percent.",
              datasets: ["adult sample"],
              metrics: ["macro_f1_delta_vs_logreg", "runtime_seconds"],
              baselines: ["logistic regression", "non-nested pipeline"],
              implementation_notes: ["Use compact sklearn-compatible datasets only."],
              evaluation_steps: [
                "Declare support if macro-F1 improves without increasing runtime or memory by more than a predefined practical threshold such as 25 percent."
              ],
              risks: [
                "A practical threshold on runtime increase must be specified before analysis to avoid post hoc interpretation."
              ],
              resource_notes: ["CPU-only execution on a single workstation."]
            }
          ],
          selected_id: "plan_1"
        })
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    expect(plan).toContain("25% relative to the matched baseline");
    expect(plan).not.toContain("must be specified before analysis");
    expect(plan).toContain("Pre-registered runtime and memory guardrail: no more than 25% above the matched baseline.");
  });

  it("prefers the best non-blocked design candidate and records panel selection artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-panel-selection-"));
    process.chdir(root);

    const runId = "run-design-panel-selection";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({ hypothesis_id: "h_1", text: "Structured schemas improve reproducibility." })}\n`,
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new CountingJsonLLMClient([
        JSON.stringify({
          summary: "Generated two candidate plans.",
          candidates: [
            {
              id: "plan_blocked",
              title: "Blocked plan",
              hypothesis_ids: ["h_1"],
              plan_summary: "Missing datasets makes this plan weak.",
              datasets: [],
              metrics: ["reproducibility_score"],
              baselines: [],
              implementation_notes: ["Implement the structured schema arm."],
              evaluation_steps: ["Measure reproducibility_score."],
              risks: ["Needs a concrete dataset."],
              resource_notes: ["Small execution limit."]
            },
            {
              id: "plan_selected",
              title: "Balanced plan",
              hypothesis_ids: ["h_1"],
              plan_summary: "Compare structured schemas against a free-form baseline.",
              datasets: ["AgentBench-mini"],
              metrics: ["reproducibility_score"],
              baselines: ["free_form_chat"],
              implementation_notes: ["Implement both schema and free-form coordination."],
              evaluation_steps: ["Measure reproducibility_score across repeated runs."],
              risks: ["Small benchmark coverage."],
              resource_notes: ["Fits the managed execution limits."]
            }
          ],
          selected_id: "plan_blocked"
        })
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");

    const plan = YAML.parse(await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8")) as {
      selected_design?: { title?: string };
    };
    expect(plan.selected_design?.title).toBe("Balanced plan");

    const selection = JSON.parse(
      await readFile(path.join(runDir, "design_experiments_panel", "selection.json"), "utf8")
    ) as {
      mode: string;
      selected_candidate_id: string;
    };
    expect(selection).toMatchObject({
      mode: "best_non_blocked",
      selected_candidate_id: "plan_selected"
    });

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("design_experiments.panel_selection")).toMatchObject({
      mode: "best_non_blocked",
      selected_candidate_id: "plan_selected"
    });
  });

  it("falls back deterministically when every design candidate is hard-blocked", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-panel-fallback-"));
    process.chdir(root);

    const runId = "run-design-panel-fallback";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({ hypothesis_id: "h_1", text: "Structured schemas improve reproducibility." })}\n`,
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new CountingJsonLLMClient([
        JSON.stringify({
          summary: "Generated blocked candidates only.",
          candidates: [
            {
              id: "plan_less_bad",
              title: "Least-bad blocked plan",
              hypothesis_ids: ["h_1"],
              plan_summary: "Usable except for the missing dataset.",
              datasets: [],
              metrics: ["reproducibility_score"],
              baselines: [],
              implementation_notes: ["Implement the schema arm."],
              evaluation_steps: ["Measure reproducibility_score."],
              risks: ["No dataset is wired yet."],
              resource_notes: ["Small execution limit."]
            },
            {
              id: "plan_bad",
              title: "Severely underspecified plan",
              hypothesis_ids: ["h_1"],
              plan_summary: "Too incomplete to execute cleanly.",
              datasets: [],
              metrics: [],
              baselines: [],
              implementation_notes: [],
              evaluation_steps: [],
              risks: ["Most execution details are missing."],
              resource_notes: []
            }
          ],
          selected_id: "plan_bad"
        })
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });
    expect(result.status).toBe("success");

    const plan = YAML.parse(await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8")) as {
      selected_design?: { title?: string };
    };
    expect(plan.selected_design?.title).toBe("Least-bad blocked plan");

    const selection = JSON.parse(
      await readFile(path.join(runDir, "design_experiments_panel", "selection.json"), "utf8")
    ) as {
      mode: string;
      selected_candidate_id: string;
    };
    expect(selection).toMatchObject({
      mode: "all_blocked_fallback",
      selected_candidate_id: "plan_less_bad"
    });
  });

  it("preserves prior bounded-run feedback when design retries after analyze_results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-retry-context-"));
    process.chdir(root);

    const runId = "run-design-retry-context";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({
        hypothesis_id: "h_1",
        text: "Adaptive stopping improves budget-aware reasoning quality.",
        reproducibility_signals: ["run_to_run_variance"],
        measurement_hint: "Compare accuracy_delta_vs_baseline across repeated bounded runs."
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify(
        {
          metrics: {
            scope: {
              pilot_size: 1,
              registered_pilot_size: 200,
              repeats: 1,
              registered_repeats: 5
            },
            primary_metric: {
              name: "accuracy_delta_vs_baseline",
              value: -1,
              baseline_name: "fixed_cot_256"
            }
          },
          plan_context: {
            selected_design: {
              title: "Adaptive stopping budget frontier"
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "transition_recommendation.json"),
      JSON.stringify(
        {
          action: "backtrack_to_design",
          targetNode: "design_experiments",
          reason: "Objective not met under the bounded local pilot.",
          evidence: [
            "Objective metric not met: accuracy_delta_vs_baseline=-1.",
            "Total recorded trials: 1."
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new ThrowingLLMClient("design llm unavailable"),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const retryContext = JSON.parse(
      await readFile(path.join(runDir, "design_experiments_panel", "retry_context.json"), "utf8")
    ) as {
      previous_pilot_size?: number;
      previous_repeats?: number;
      transition_action?: string;
      retry_directives?: string[];
    };
    expect(retryContext).toMatchObject({
      previous_pilot_size: 1,
      previous_repeats: 1,
      transition_action: "backtrack_to_design"
    });
    expect(retryContext.retry_directives).toContain("Do not repeat a bounded-local design with pilot_size=1 and repeats=1.");
    expect(retryContext.retry_directives).toContain(
      "Use at least tens of examples and repeated runs in the next bounded local pilot if the workstation budget allows it."
    );

    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    expect(plan).toContain("retry_context:");
    expect(plan).toContain("previous_pilot_size: 1");
    expect(plan).toContain("previous_repeats: 1");
    expect(plan).toContain('transition_action: "backtrack_to_design"');
    expect(plan).toContain('  - "Do not repeat a bounded-local design with pilot_size=1 and repeats=1."');
    expect(plan).toContain('  - "Use at least tens of examples and repeated runs in the next bounded local pilot if the workstation budget allows it."');
    expect(plan).toContain('  - "The next bounded local retry must materially exceed the previous scope (pilot_size=1, repeats=1) while staying locally runnable."');

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("design_experiments.retry_context")).toMatchObject({
      previous_pilot_size: 1,
      previous_repeats: 1,
      transition_action: "backtrack_to_design"
    });
  });

  it("renders a submission-style manuscript and traceability sidecar", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-constraints-"));
    process.chdir(root);

    const runId = "run-paper-constraints";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await seedWritePaperInputs(runDir);

    const node = createWritePaperNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("\\title{Constraint Propagation Benchmark: A Reproducibility Study of AI Agent Automation}");
    expect(tex).not.toContain("\\title{Multi-Agent Collaboration}");
    expect(tex).not.toContain("\\section{Writing Constraints}");
    expect(tex).not.toContain("\\section{Results Overview}");
    const manuscript = await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8");
    expect(manuscript).toContain('"title": "Constraint Propagation Benchmark: A Reproducibility Study of AI Agent Automation"');
    expect(manuscript).toContain('"heading": "Introduction"');
    expect(manuscript).toContain("configured writing constraints");
    const traceability = await readFile(path.join(runDir, "paper", "traceability.json"), "utf8");
    expect(traceability).toContain('"manuscript_section": "Introduction"');
    expect(traceability).toContain('"citation_paper_ids"');
    const submissionValidation = await readFile(
      path.join(runDir, "paper", "submission_validation.json"),
      "utf8"
    );
    expect(submissionValidation).toContain('"ok": true');
  });

  it("fails when required write_paper inputs are missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-missing-inputs-"));
    process.chdir(root);

    const runId = "run-paper-missing-inputs";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(runDir, { recursive: true });

    const node = createWritePaperNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("write_paper requires valid upstream artifacts before drafting");
    expect(result.error).toContain("paper_summaries.jsonl");
    expect(result.error).toContain("result_analysis.json");

    const inputValidation = await readFile(path.join(runDir, "paper", "input_validation.json"), "utf8");
    expect(inputValidation).toContain('"ok": false');
    expect(inputValidation).toContain('"artifact": "paper_summaries.jsonl"');
    expect(inputValidation).toContain('"artifact": "result_analysis.json"');
  });

  it("drops weak reproducibility hypotheses before experiment design", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-design-filter-"));
    process.chdir(root);

    const runId = "run-design-filter";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      [
        JSON.stringify({
          hypothesis_id: "h_1",
          text: "Typed message schemas will reduce run-to-run variance relative to free-form chat.",
          groundedness: 5,
          causal_clarity: 5,
          falsifiability: 5,
          experimentability: 5,
          reproducibility_specificity: 5,
          reproducibility_signals: ["run_to_run_variance", "failure_mode_stability"],
          measurement_hint: "Measure pass@1 variance and stable failure categories across repeated runs."
        }),
        JSON.stringify({
          hypothesis_id: "h_2",
          text: "More agent discussion will improve results.",
          groundedness: 2,
          causal_clarity: 2,
          falsifiability: 1,
          experimentability: 2,
          reproducibility_specificity: 1,
          reproducibility_signals: []
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    expect(plan).toContain('  retained_count: 1');
    expect(plan).toContain('  dropped_count: 1');
    expect(plan).toContain('    text: "More agent discussion will improve results."');
    expect(plan).toContain('    reason: "low groundedness; weak falsifiability; weak experimentability; reproducibility outcome is underspecified; no reproducibility signal; no reproducibility measurement hint; overall design quality below threshold"');
    expect(plan).toContain('  - "Typed message schemas will reduce run-to-run variance relative to free-form chat."');
    expect(plan).not.toContain('  - "More agent discussion will improve results."');
    expect(plan).toContain("  executable_design:");
    expect(plan).toContain('    runner: "managed_real_execution_bundle"');
    expect(plan).toContain("      total_trials: 48");
    expect(plan).toContain('      - "reproducibility_score"');
    expect(plan).toContain('      - "Prompt phrasing / coordination-style variation via neutral vs compressed collaboration instructions."');
    expect(plan).toContain("  confirmatory_extension:");
    expect(plan).toContain("        total_trials: 72");
    const portfolio = JSON.parse(await readFile(path.join(runDir, "experiment_portfolio.json"), "utf8")) as {
      execution_model: string;
      total_expected_trials?: number;
      trial_groups: Array<{ id: string; profile?: string; expected_trials?: number; group_kind?: string }>;
    };
    expect(portfolio.execution_model).toBe("managed_bundle");
    expect(portfolio.total_expected_trials).toBe(126);
    expect(portfolio.trial_groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "primary_standard", profile: "standard", expected_trials: 48 }),
      expect.objectContaining({ id: "quick_check", profile: "quick_check", expected_trials: 6 }),
      expect.objectContaining({ id: "confirmatory", profile: "confirmatory", expected_trials: 72 }),
      expect.objectContaining({
        id: "primary_standard__hotpotqa_mini",
        group_kind: "matrix_slice",
        expected_trials: 16
      }),
      expect.objectContaining({
        id: "quick_check__gsm8k_mini",
        group_kind: "matrix_slice",
        expected_trials: 2
      }),
      expect.objectContaining({
        id: "confirmatory__humaneval_mini",
        group_kind: "matrix_slice",
        expected_trials: 24
      })
    ]));
    const publicManifest = JSON.parse(await readFile(buildPublicRunManifestPath(root, run), "utf8")) as {
      sections?: { experiment?: { generated_files?: string[] } };
    };
    expect(publicManifest.sections?.experiment?.generated_files).toContain("experiment/experiment_portfolio.json");
  });

  it("reuses one llm-derived constraint profile across design and write nodes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-constraint-profile-cache-"));
    process.chdir(root);

    const runId = "run-constraint-profile-cache";
    const run = makeRun(root, runId);
    run.constraints = [
      "Use open-access papers from the past seven years.",
      "Write this as an EMNLP tutorial-style paper around 10-12 pages.",
      "Focus evaluation on robustness and failure recovery."
    ];
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await seedWritePaperInputs(runDir);
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({ hypothesis_id: "h_1", text: "Hypothesis A" })}\n`,
      "utf8"
    );

    const llm = new CountingJsonLLMClient([
      JSON.stringify({
        collect: {
          lastYears: 7,
          openAccessPdf: true
        },
        writing: {
          targetVenue: "EMNLP",
          toneHint: "tutorial",
          lengthHint: "10-12 pages"
        },
        experiment: {
          designNotes: ["Prefer robustness-oriented ablations."],
          implementationNotes: ["Keep browser task instrumentation explicit."],
          evaluationNotes: ["Measure recovery after tool or browser failures."]
        },
        assumptions: ["Use the run topic as the collect query unless the user overrides it."]
      }),
      JSON.stringify({
        summary: "Generated experiment designs.",
        candidates: [
          {
            id: "plan_1",
            title: "Robustness-first benchmark",
            hypothesis_ids: ["h_1"],
            plan_summary: "Test robustness-oriented recovery strategies against a baseline.",
            datasets: ["Computer Science"],
            metrics: ["state-of-the-art reproducibility"],
            baselines: ["current_best_baseline"],
            implementation_notes: ["Keep browser task instrumentation explicit."],
            evaluation_steps: ["Measure recovery after tool or browser failures."],
            risks: ["Evaluation scope may need narrowing."],
            resource_notes: ["Stay within the configured local execution limits."]
          }
        ],
        selected_id: "plan_1"
      }),
      JSON.stringify({
        primaryMetric: "state-of-the-art reproducibility",
        preferredMetricKeys: ["state-of-the-art reproducibility"],
        analysisFocus: ["Robustness and recovery"],
        paperEmphasis: ["Reproducibility improvements"],
        assumptions: ["Compare against the strongest available baseline."]
      }),
      JSON.stringify({
        title: "Robustness-First Benchmarking for Multi-Agent Collaboration",
        abstract_focus: ["robustness", "recovery"],
        section_headings: ["Introduction", "Method", "Results", "Conclusion"],
        key_claim_themes: ["Robustness-first benchmarking"],
        citation_plan: []
      }),
      JSON.stringify({
        title: "Robustness-First Benchmarking for Multi-Agent Collaboration",
        abstract: "We summarize the current workflow as a robustness-oriented benchmark draft.",
        keywords: ["multi-agent collaboration", "robustness"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["This draft frames the workflow as a robustness-oriented benchmark."],
            evidence_ids: [],
            citation_paper_ids: []
          },
          {
            heading: "Method",
            paragraphs: ["The method follows the selected experiment design and cached writing constraints."],
            evidence_ids: [],
            citation_paper_ids: []
          },
          {
            heading: "Results",
            paragraphs: ["The results section emphasizes reproducibility improvements and failure recovery."],
            evidence_ids: [],
            citation_paper_ids: []
          },
          {
            heading: "Conclusion",
            paragraphs: ["The draft remains aligned with the experiment plan and objective metric profile."],
            evidence_ids: [],
            citation_paper_ids: []
          }
        ],
        claims: [
          {
            claim_id: "c1",
            statement: "The benchmark prioritizes robustness and recovery.",
            section_heading: "Results",
            evidence_ids: [],
            citation_paper_ids: []
          }
        ]
      }),
      JSON.stringify({
        summary: "The draft is coherent but should keep unsupported claims conservative.",
        revision_notes: ["Preserve the robustness framing."],
        unsupported_claims: [],
        missing_sections: [],
        missing_citations: []
      }),
      JSON.stringify({
        title: "Robustness-First Benchmarking for Multi-Agent Collaboration",
        abstract: "We summarize the current workflow as a robustness-oriented benchmark draft.",
        keywords: ["multi-agent collaboration", "robustness"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["This draft frames the workflow as a robustness-oriented benchmark."],
            evidence_ids: [],
            citation_paper_ids: []
          },
          {
            heading: "Method",
            paragraphs: ["The method follows the selected experiment design and cached writing constraints."],
            evidence_ids: [],
            citation_paper_ids: []
          },
          {
            heading: "Results",
            paragraphs: ["The results section emphasizes reproducibility improvements and failure recovery."],
            evidence_ids: [],
            citation_paper_ids: []
          },
          {
            heading: "Conclusion",
            paragraphs: ["The draft remains aligned with the experiment plan and objective metric profile."],
            evidence_ids: [],
            citation_paper_ids: []
          }
        ],
        claims: [
          {
            claim_id: "c1",
            statement: "The benchmark prioritizes robustness and recovery.",
            section_heading: "Results",
            evidence_ids: [],
            citation_paper_ids: []
          }
        ]
      })
    ]);

    const deps = {
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    };

    const designNode = createDesignExperimentsNode(deps);
    const writeNode = createWritePaperNode(deps);

    const designResult = await designNode.execute({ run, graph: run.graph });
    const writeResult = await writeNode.execute({ run, graph: run.graph });

    expect(designResult.status).toBe("success");
    expect(writeResult.status).toBe("success");
    expect(llm.calls).toBe(10);

    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    expect(plan).toContain("last_years: 7");
    expect(plan).toContain("open_access_pdf: true");
    expect(plan).toContain('target_venue: "EMNLP"');
    expect(plan).toContain('tone_hint: "tutorial"');
    expect(plan).toContain('length_hint: "10-12 pages"');
    expect(plan).toContain('    - "Prefer robustness-oriented ablations."');
    expect(plan).toContain('    - "Measure recovery after tool or browser failures."');
    expect(plan).toContain("  executable_design:");
    expect(plan).toContain("  confirmatory_extension:");

    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("\\section{Method}");
    expect(tex).toContain("selected experiment design");
    expect(tex).not.toContain("\\section{Writing Constraints}");
    const manuscript = await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8");
    expect(manuscript).toContain("robustness-oriented benchmark");
    expect(manuscript).not.toContain("Results Overview");
  });

  it("renders llm-generated sections and corpus-backed references into paper artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-writer-"));
    process.chdir(root);

    const runId = "run-paper-writer";
    const run = makeRun(root, runId);
    run.constraints = ["ACL style", "formal tone"];
    run.currentNode = "write_paper";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      `${JSON.stringify({
        paper_id: "paper_1",
        title: "Deep Coordination Baseline",
        abstract: "A baseline for agent coordination.",
        authors: ["Alice Doe", "Bob Roe"],
        year: 2025,
        venue: "ACL Findings"
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "paper_summaries.jsonl"),
      `${JSON.stringify({
        paper_id: "paper_1",
        title: "Deep Coordination Baseline",
        source_type: "full_text",
        summary: "The paper studies coordination baselines for multi-agent systems.",
        key_findings: ["Structured coordination reduces variance."],
        limitations: ["Limited benchmark coverage."],
        datasets: ["AgentBench-mini"],
        metrics: ["reproducibility_score"],
        novelty: "It introduces a structured coordination baseline.",
        reproducibility_notes: ["The paper reports repeated trials."]
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      `${JSON.stringify({
        evidence_id: "ev_paper_1_1",
        paper_id: "paper_1",
        claim: "Structured coordination reduces run-to-run variance.",
        method_slot: "Shared state schema",
        result_slot: "Variance is reduced by 12 percent.",
        limitation_slot: "Benchmark count is small.",
        dataset_slot: "AgentBench-mini",
        metric_slot: "reproducibility_score",
        evidence_span: "Repeated trials show a 12 percent variance reduction.",
        source_type: "full_text",
        confidence: 0.91
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "hypotheses.jsonl"),
      `${JSON.stringify({
        hypothesis_id: "h_1",
        text: "Shared state schemas improve reproducibility.",
        evidence_links: ["ev_paper_1_1"],
        rationale: "The baseline reports reduced variance."
      })}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runDir, "experiment_plan.yaml"),
      [
        'selected_design:',
        '  title: "Coordination benchmark"',
        '  summary: "Evaluate shared schemas against free-form coordination."'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify({
        mean_score: 0.88,
        objective_metric: {
          evaluation: {
            summary: "Objective metric met: reproducibility_score=0.88 >= 0.8.",
            status: "met"
          }
        },
        plan_context: {
          selected_design: {
            title: "Coordination benchmark"
          }
        },
        primary_findings: ["Structured coordination improved reproducibility."],
        condition_comparisons: [{ summary: "schema vs baseline favors the schema condition" }],
        figure_specs: [{ title: "Coordination performance", path: "figures/performance.svg" }]
      }, null, 2),
      "utf8"
    );

    const llm = new CountingJsonLLMClient([
      JSON.stringify({
        writing: {
          targetVenue: "ACL",
          toneHint: "formal academic"
        },
        experiment: {
          designNotes: ["Focus on reproducibility-oriented claims."],
          implementationNotes: [],
          evaluationNotes: ["Report the observed reproducibility score."]
        },
        collect: {},
        assumptions: []
      }),
      JSON.stringify({
        primaryMetric: "reproducibility_score",
        preferredMetricKeys: ["reproducibility_score"],
        targetDescription: ">= 0.8",
        paperEmphasis: ["Highlight reproducibility improvements."],
        assumptions: []
      }),
      JSON.stringify({
        title: "Schema-Grounded Coordination Draft",
        abstract_focus: ["coordination", "reproducibility"],
        section_headings: ["Introduction", "Method", "Results", "Conclusion"],
        key_claim_themes: ["Schema-grounded coordination improves reproducibility."],
        citation_plan: ["paper_1"]
      }),
      JSON.stringify({
        title: "Schema-Grounded Coordination Draft",
        abstract: "We draft a paper about schema-grounded coordination for reproducibility.",
        keywords: ["coordination", "reproducibility"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["Structured coordination is a promising way to stabilize multi-agent workflows."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Method",
            paragraphs: ["We compare a schema-grounded coordination benchmark against a free-form baseline."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Results",
            paragraphs: ["The schema condition improves reproducibility and satisfies the configured threshold."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Conclusion",
            paragraphs: ["The draft highlights a traceable path from evidence to reproducibility claims."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          }
        ],
        claims: [
          {
            claim_id: "c1",
            statement: "Schema-grounded coordination improves reproducibility.",
            section_heading: "Results",
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            claim_id: "c2",
            statement: "The method generalizes to every benchmark.",
            section_heading: "Ablations",
            evidence_ids: ["ev_missing"],
            citation_paper_ids: ["paper_missing"]
          }
        ]
      }),
      JSON.stringify({
        summary: "One claim lacks direct evidence and should be weakened.",
        revision_notes: ["Keep c2 tentative unless new evidence is added."],
        unsupported_claims: [{ claim_id: "c2", reason: "Missing direct evidence." }],
        missing_sections: [],
        missing_citations: []
      }),
      JSON.stringify({
        title: "Schema-Grounded Coordination Draft",
        abstract: "We draft a paper about schema-grounded coordination for reproducibility.",
        keywords: ["coordination", "reproducibility"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["Structured coordination is a promising way to stabilize multi-agent workflows."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Method",
            paragraphs: ["We compare a schema-grounded coordination benchmark against a free-form baseline."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Results",
            paragraphs: ["The schema condition improves reproducibility and satisfies the configured threshold."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Conclusion",
            paragraphs: ["The draft highlights a traceable path from evidence to reproducibility claims."],
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          }
        ],
        claims: [
          {
            claim_id: "c1",
            statement: "Schema-grounded coordination improves reproducibility.",
            section_heading: "Results",
            evidence_ids: ["ev_paper_1_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            claim_id: "c2",
            statement: "The method generalizes to every benchmark.",
            section_heading: "Ablations",
            evidence_ids: ["ev_missing"],
            citation_paper_ids: ["paper_missing"]
          }
        ]
      })
    ]);

    const node = createWritePaperNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(llm.calls).toBe(9);

    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("\\section{Introduction}");
    expect(tex).toContain("Structured coordination is a promising way to stabilize multi-agent workflows.");
    expect(tex).toContain("Structured coordination is a promising way to stabilize multi-agent workflows. \\cite{");
    expect(tex).not.toContain("Evidence anchors");
    expect(tex).not.toContain("Claim Trace");

    const references = await readFile(path.join(runDir, "paper", "references.bib"), "utf8");
    expect(references).toContain("Deep Coordination Baseline");
    expect(references).not.toContain("AutoLabOS generated reference");

    const evidenceLinks = await readFile(path.join(runDir, "paper", "evidence_links.json"), "utf8");
    expect(evidenceLinks).toContain('"sections"');
    expect(evidenceLinks).toContain('"paragraph_index": 0');
    expect(evidenceLinks).toContain('"claim_id": "c1"');
    expect(evidenceLinks).toContain('"ev_paper_1_1"');
    expect(evidenceLinks).toContain('"claim_id": "c2"');
    const traceability = await readFile(path.join(runDir, "paper", "traceability.json"), "utf8");
    expect(traceability).toContain('"manuscript_section": "Introduction"');
    expect(traceability).toContain('"ev_paper_1_1"');
    expect(traceability).toContain('"claim_ids": [');

    const draft = await readFile(path.join(runDir, "paper", "draft.json"), "utf8");
    expect(draft).toContain("Schema-Grounded Coordination Draft");
    expect(draft).toContain("Tentative claim: The method generalizes to every benchmark; direct supporting evidence is currently limited");

    const validation = await readFile(path.join(runDir, "paper", "validation.json"), "utf8");
    expect(validation).toContain('"claim_id": "c2"');
    expect(validation).toContain('"issues": []');
    expect(validation).not.toContain("no direct supporting evidence remained after validation");
  });
});
