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

  override async complete(_prompt: string): Promise<{ text: string }> {
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
      runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
    }
  };
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
  });

  it("writes writing constraints into paper/main.tex", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-constraints-"));
    process.chdir(root);

    const runId = "run-paper-constraints";
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

    expect(result.status).toBe("success");
    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("\\title{Multi-Agent Collaboration}");
    expect(tex).toContain("Target venue: ACL.");
    expect(tex).toContain("Tone: formal academic.");
    expect(tex).toContain("Length target: short paper.");
    expect(tex).toContain("- last 5 years");
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
    expect(llm.calls).toBe(7);

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
    expect(tex).toContain("Target venue: EMNLP.");
    expect(tex).toContain("Tone: tutorial.");
    expect(tex).toContain("Length target: 10-12 pages.");
    expect(tex).toContain("Design guidance:");
    expect(tex).toContain("- Prefer robustness-oriented ablations.");
    expect(tex).toContain("Constraint assumptions:");
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
    expect(llm.calls).toBe(6);

    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("\\section{Introduction}");
    expect(tex).toContain("Structured coordination is a promising way to stabilize multi-agent workflows.");
    expect(tex).toContain("Structured coordination is a promising way to stabilize multi-agent workflows. \\cite{");
    expect(tex).toContain("\\textit{(Evidence anchors: \\texttt{ev\\_paper\\_1\\_1}.)}");

    const references = await readFile(path.join(runDir, "paper", "references.bib"), "utf8");
    expect(references).toContain("Deep Coordination Baseline");
    expect(references).not.toContain("AutoLabOS generated reference");

    const evidenceLinks = await readFile(path.join(runDir, "paper", "evidence_links.json"), "utf8");
    expect(evidenceLinks).toContain('"sections"');
    expect(evidenceLinks).toContain('"paragraph_index": 0');
    expect(evidenceLinks).toContain('"claim_id": "c1"');
    expect(evidenceLinks).toContain('"ev_paper_1_1"');
    expect(evidenceLinks).toContain('"claim_id": "c2"');

    const draft = await readFile(path.join(runDir, "paper", "draft.json"), "utf8");
    expect(draft).toContain("Schema-Grounded Coordination Draft");
    expect(draft).toContain("Tentative claim: The method generalizes to every benchmark; direct supporting evidence is currently limited");

    const validation = await readFile(path.join(runDir, "paper", "validation.json"), "utf8");
    expect(validation).toContain('"claim_id": "c2"');
    expect(validation).toContain("no direct supporting evidence remained after validation");
  });
});
