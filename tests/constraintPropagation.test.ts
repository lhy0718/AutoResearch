import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createDesignExperimentsNode } from "../src/core/nodes/designExperiments.js";
import { createWritePaperNode } from "../src/core/nodes/writePaper.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

class CountingJsonLLMClient extends MockLLMClient {
  calls = 0;
  private index = 0;

  constructor(private readonly responses: string[]) {
    super();
  }

  override async complete(): Promise<{ text: string }> {
    this.calls += 1;
    const response = this.responses[Math.min(this.index, this.responses.length - 1)] ?? "";
    this.index += 1;
    return { text: response };
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
      runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

describe("constraint propagation", () => {
  it("writes run constraints into experiment_plan.yaml", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-design-constraints-"));
    process.chdir(root);

    const runId = "run-design-constraints";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autoresearch", "runs", runId);
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
  });

  it("writes writing constraints into paper/main.tex", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-paper-constraints-"));
    process.chdir(root);

    const runId = "run-paper-constraints";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autoresearch", "runs", runId);
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

    expect(result.status).toBe("success");
    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("\\title{Multi-Agent Collaboration}");
    expect(tex).toContain("Target venue: ACL.");
    expect(tex).toContain("Tone: formal academic.");
    expect(tex).toContain("Length target: short paper.");
    expect(tex).toContain("- last 5 years");
  });

  it("drops weak reproducibility hypotheses before experiment design", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-design-filter-"));
    process.chdir(root);

    const runId = "run-design-filter";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autoresearch", "runs", runId);
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
    expect(plan).toContain('    - "run_to_run_variance"');
    expect(plan).toContain('    - "reproducibility"');
    expect(plan).toContain('    - "free_form_chat_baseline"');
  });

  it("reuses one llm-derived constraint profile across design and write nodes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-constraint-profile-cache-"));
    process.chdir(root);

    const runId = "run-constraint-profile-cache";
    const run = makeRun(root, runId);
    run.constraints = [
      "Use open-access papers from the past seven years.",
      "Write this as an EMNLP tutorial-style paper around 10-12 pages.",
      "Focus evaluation on robustness and failure recovery."
    ];
    const runDir = path.join(root, ".autoresearch", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    await writeFile(path.join(runDir, "hypotheses.jsonl"), `${JSON.stringify({ text: "Hypothesis A" })}\n`, "utf8");

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
            budget_notes: ["Stay within the configured local execution budget."]
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
    expect(llm.calls).toBe(3);

    const plan = await readFile(path.join(runDir, "experiment_plan.yaml"), "utf8");
    expect(plan).toContain("last_years: 7");
    expect(plan).toContain("open_access_pdf: true");
    expect(plan).toContain('target_venue: "EMNLP"');
    expect(plan).toContain('tone_hint: "tutorial"');
    expect(plan).toContain('length_hint: "10-12 pages"');
    expect(plan).toContain('    - "Prefer robustness-oriented ablations."');
    expect(plan).toContain('    - "Measure recovery after tool or browser failures."');

    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("Target venue: EMNLP.");
    expect(tex).toContain("Tone: tutorial.");
    expect(tex).toContain("Length target: 10-12 pages.");
    expect(tex).toContain("Design guidance:");
    expect(tex).toContain("- Prefer robustness-oriented ablations.");
    expect(tex).toContain("Constraint assumptions:");
  });
});
