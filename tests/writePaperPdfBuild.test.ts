import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { LLMClient, LLMCompleteOptions, MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createWritePaperNode, validateCompiledPdfPageBudget } from "../src/core/nodes/writePaper.js";
import { buildPublicAnalysisDir, buildPublicPaperDir, buildPublicRunManifestPath } from "../src/core/publicArtifacts.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

class SequencedLLMClient extends MockLLMClient implements LLMClient {
  private index = 0;

  constructor(private readonly responses: string[]) {
    super();
  }

  override async complete(_prompt: string, _opts?: LLMCompleteOptions): Promise<{ text: string }> {
    const text = this.responses[Math.min(this.index, this.responses.length - 1)] ?? "";
    this.index += 1;
    return { text };
  }
}

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "PDF-backed Paper Writer",
    topic: "agent collaboration",
    constraints: [],
    objectiveMetric: "",
    status: "running",
    currentNode: "write_paper",
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

async function seedRun(root: string, run: RunRecord): Promise<string> {
  const runDir = path.join(root, ".autolabos", "runs", run.id);
  await mkdir(path.join(runDir, "memory"), { recursive: true });
  await writeFile(
    path.join(runDir, "memory", "run_context.json"),
    JSON.stringify({ version: 1, items: [] }),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "paper_summaries.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Schema Bench",
      source_type: "full_text",
      summary: "Persistent state improves revisability.",
      key_findings: ["Persistent state improves revisability."],
      limitations: [],
      datasets: ["AgentBench-mini"],
      metrics: ["reproducibility_score"],
      novelty: "Thread-backed drafting",
      reproducibility_notes: ["Includes repeated drafting runs."]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "evidence_store.jsonl"),
    `${JSON.stringify({
      evidence_id: "ev_1",
      paper_id: "paper_1",
      claim: "Persistent state improves revisability.",
      method_slot: "thread-backed drafting",
      result_slot: "higher revision stability",
      limitation_slot: "small benchmark",
      dataset_slot: "AgentBench-mini",
      metric_slot: "reproducibility_score",
      evidence_span: "Repeated drafting runs remained stable across revisions.",
      source_type: "full_text",
      confidence: 0.92,
      confidence_reason: "The evidence comes from one benchmark, so external validity remains limited."
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "hypotheses.jsonl"),
    `${JSON.stringify({
      hypothesis_id: "h_1",
      text: "Thread-backed drafting improves revisability.",
      evidence_links: ["ev_1"]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "corpus.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Schema Bench",
      abstract: "Persistent state improves revisability.",
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
      '  title: "Thread-backed drafting benchmark"',
      '  summary: "Compare persistent drafting support across repeated revisions."'
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "result_analysis.json"),
    JSON.stringify(
      {
        overview: {
          objective_status: "observed",
          selected_design_title: "Thread-backed drafting benchmark"
        },
        execution_summary: {
          observation_count: 1
        },
        statistical_summary: {
          notes: ["Stability remained consistent across repeated runs."]
        }
      },
      null,
      2
    ),
    "utf8"
  );
  return runDir;
}

function buildSessionResponses(): string[] {
  const outline = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract_focus: ["persistent drafting", "revisability"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["Thread-backed drafting improves revisability."],
    citation_plan: ["paper_1"]
  });
  const draft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with PDF compilation and repair support.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: ["Persistent drafting support improved revision stability in repeated runs."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["PDF build feedback turns the writer into a submission-ready agent."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent and grounded.",
    revision_notes: ["Keep the PDF-compilation framing explicit."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  return [outline, draft, review, draft];
}

function buildValidationRepairResponses(): string[] {
  const outline = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract_focus: ["persistent drafting", "revisability"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["Thread-backed drafting improves revisability."],
    citation_plan: ["paper_1"]
  });
  const flawedDraft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with validation-aware repair support.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: [
          {
            text: "Persistent drafting support improved revision stability in repeated runs.",
            evidence_ids: [],
            citation_paper_ids: []
          }
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Validation-aware repair makes the writer more self-correcting."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: [],
        citation_paper_ids: []
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent but should make evidence links explicit.",
    revision_notes: ["Keep the PDF-compilation framing explicit."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: ["Results"]
  });
  const repairedDraft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with validation-aware repair support.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: [
          {
            text: "Persistent drafting support improved revision stability in repeated runs.",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Validation-aware repair makes the writer more self-correcting."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  return [outline, flawedDraft, review, flawedDraft, repairedDraft];
}

function buildRelatedWorkScoutResponses(): string[] {
  const outline = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract_focus: ["persistent drafting", "related work coverage"],
    section_headings: ["Introduction", "Related Work", "Method", "Results", "Conclusion"],
    key_claim_themes: ["Thread-backed drafting improves revisability."],
    citation_plan: ["paper_1", "paper_scout_1"]
  });
  const draft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with related-work scouting support.",
    keywords: ["agent collaboration", "paper writing", "related work"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Related Work",
        paragraphs: [
          {
            text: "Recent related-work scouting highlights complementary literature on revision stability and related evidence synthesis.",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1", "paper_scout_1", "paper_scout_2"]
          }
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_scout_1", "paper_scout_2"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: ["Persistent drafting support improved revision stability in repeated runs."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Scoped literature scouting helps the writer place results in context."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_scout_1", "paper_scout_2"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent and now cites related work more explicitly.",
    revision_notes: ["Keep the related-work framing concise."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  return [outline, draft, review, draft];
}

function buildSubmissionValidationFailureResponses(): string[] {
  const manuscript = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A submission draft that should fail validation before PDF build.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paragraph incorrectly exposes ev_1 inside the submission manuscript."]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."]
      },
      {
        heading: "Results",
        paragraphs: ["Persistent drafting support improved revision stability in repeated runs."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Validation should stop PDF generation when the manuscript leaks raw trace tokens."]
      }
    ]
  });
  return [...buildSessionResponses(), manuscript];
}

async function overwriteRunArtifacts(run: RunRecord, files: Record<string, string>): Promise<void> {
  const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(runDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
}

async function writeLatestResults(run: RunRecord, payload: Record<string, unknown>): Promise<void> {
  const analysisDir = buildPublicAnalysisDir(process.cwd(), run);
  await mkdir(analysisDir, { recursive: true });
  await writeFile(path.join(analysisDir, "latest_results.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildWeakScientificResponses(): string[] {
  const outline = JSON.stringify({
    title: "Weak Benchmark Note",
    abstract_focus: ["weak evidence", "cautious benchmark framing"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["The benchmark suggests a small positive delta."],
    citation_plan: ["paper_1"]
  });
  const draft = JSON.stringify({
    title: "Weak Benchmark Note",
    abstract: "A short benchmark note.",
    keywords: ["benchmark"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["We study a small benchmark run."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["We compare two workflows on one public dataset."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: ["The method demonstrates significant improvement."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The benchmark is promising."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "The method demonstrates significant improvement.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is cautious but still terse.",
    revision_notes: ["Keep the benchmark framing explicit."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  const manuscript = JSON.stringify({
    title: "Weak Benchmark Note",
    abstract: "This study demonstrates significant improvement on the benchmark.",
    keywords: ["benchmark"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["We study a small benchmark run."]
      },
      {
        heading: "Method",
        paragraphs: ["We compare two workflows on one public dataset."]
      },
      {
        heading: "Results",
        paragraphs: ["The benchmark suggests a positive delta under this benchmark."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The evidence remains limited but encouraging."]
      }
    ]
  });
  return [outline, draft, review, manuscript];
}

function buildMediumScientificResponses(): string[] {
  const outline = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract_focus: ["nested evaluation", "resource-aware results", "appendix-aware paper"],
    section_headings: ["Introduction", "Related Work", "Method", "Results", "Discussion", "Limitations", "Conclusion"],
    key_claim_themes: ["The benchmark suggests small positive deltas under repeated evaluation."],
    citation_plan: ["paper_1", "paper_2", "paper_3"]
  });
  const sharedParagraph =
    "The manuscript keeps claims scoped to the available repeated-evaluation artifacts while still describing protocol choices, resource measurements, and dataset-specific behavior in enough detail for a full paper.";
  const draft = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract: "A richer benchmark manuscript with appendix-aware reporting.",
    keywords: ["benchmark", "tabular", "reproducibility"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [
          "We study repeated tabular benchmarking under constrained compute settings.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2"]
      },
      {
        heading: "Related Work",
        paragraphs: [
          "Prior work spans nested validation, CPU-only tree baselines, and reproducibility notes for repeated evaluation.",
          "The closest prior work reports smaller empirical scopes, while the present study emphasizes cautious positioning rather than broad novelty."
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2", "paper_3"]
      },
      {
        heading: "Method",
        paragraphs: [
          "We evaluate breast_cancer and iris with explicit preprocessing, nested cross-validation, and fixed seeds.",
          "The protocol fits preprocessing within each fold and records runtime and peak memory for the compared workflows.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2"]
      },
      {
        heading: "Results",
        paragraphs: [
          "The strongest workflow yields a small positive macro-F1 delta over logistic regression.",
          "Dataset-level behavior varies, so the study reports uncertainty, runtime, and memory together with the main score.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_3"]
      },
      {
        heading: "Discussion",
        paragraphs: [
          "The outcome is best framed as a benchmark note with bounded empirical scope.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_3"]
      },
      {
        heading: "Limitations",
        paragraphs: ["The dataset scope is narrow and repeated CV does not justify broad inferential language."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_3"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The paper keeps its central logic in the main body while routing detailed repeat-level artifacts to the appendix."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2", "paper_3"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "The strongest workflow suggests a small positive delta under repeated evaluation.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_3"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is grounded and uses the appendix appropriately.",
    revision_notes: ["Keep the discussion cautious and preserve the main-body result table."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  const manuscript = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract: "A richer benchmark manuscript with appendix-aware reporting.",
    keywords: ["benchmark", "tabular", "reproducibility"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [
          "We study repeated tabular benchmarking under constrained compute settings.",
          sharedParagraph
        ]
      },
      {
        heading: "Related Work",
        paragraphs: [
          "Prior work spans nested validation, CPU-only tree baselines, and reproducibility notes for repeated evaluation.",
          "The closest prior work reports smaller empirical scopes, while the present study emphasizes cautious positioning rather than broad novelty."
        ]
      },
      {
        heading: "Method",
        paragraphs: [
          "We evaluate breast_cancer and iris with explicit preprocessing, nested cross-validation, and fixed seeds.",
          "The protocol fits preprocessing within each fold and records runtime and peak memory for the compared workflows.",
          sharedParagraph
        ]
      },
      {
        heading: "Results",
        paragraphs: [
          "The strongest workflow yields a small positive macro-F1 delta over logistic regression.",
          "Dataset-level behavior varies, so the study reports uncertainty, runtime, and memory together with the main score.",
          sharedParagraph
        ]
      },
      {
        heading: "Discussion",
        paragraphs: [
          "The outcome is best framed as a benchmark note with bounded empirical scope.",
          sharedParagraph
        ]
      },
      {
        heading: "Limitations",
        paragraphs: ["The dataset scope is narrow and repeated CV does not justify broad inferential language."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The paper keeps its central logic in the main body while routing detailed repeat-level artifacts to the appendix."]
      }
    ]
  });
  return [outline, draft, review, manuscript];
}

function buildInconsistentScientificResponses(): string[] {
  const base = buildMediumScientificResponses();
  const inconsistentManuscript = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract: "We improve macro-F1 by 0.2 across 8 datasets.",
    keywords: ["benchmark", "tabular", "reproducibility"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["We study repeated tabular benchmarking under constrained compute settings."]
      },
      {
        heading: "Method",
        paragraphs: ["We evaluate 2 datasets with outer 5-fold CV, inner 3-fold tuning, and 3 repeats."]
      },
      {
        heading: "Results",
        paragraphs: ["The strongest workflow yields a macro-F1 delta of 0.026 across 2 datasets."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The study shows significant improvement across 8 datasets."]
      }
    ]
  });
  return [...base.slice(0, 3), inconsistentManuscript];
}

function buildMediumResultAnalysis(): Record<string, unknown> {
  return {
    objective_metric: {
      evaluation: {
        summary: "Observed a small positive macro-F1 delta over logistic regression on the strongest workflow."
      },
      profile: {
        preferred_metric_keys: ["macro_f1_delta_vs_logreg"]
      }
    },
    metric_table: [
      { key: "macro_f1_delta_vs_logreg", value: 0.026 },
      { key: "pairwise_ranking_agreement", value: 0.885 },
      { key: "runtime_seconds_mean", value: 1.05 },
      { key: "peak_memory_mb_mean", value: 149 }
    ],
    primary_findings: [
      "The strongest workflow suggests a small positive macro-F1 delta over logistic regression.",
      "Runtime and memory remain close across the compared workflows."
    ],
    limitations: [
      "The delta is small and varies by dataset.",
      "Repeated CV does not justify strong inferential language."
    ],
    statistical_summary: {
      notes: [
        "Dispersion across repeated runs is moderate rather than negligible.",
        "Heterogeneity remains visible across datasets."
      ],
      confidence_intervals: [
        {
          metric_key: "macro_f1_delta_vs_logreg",
          label: "Macro-F1 delta",
          lower: 0.015,
          upper: 0.036,
          level: 0.95,
          source: "metrics",
          summary: "The 95% interval for the macro-F1 delta spans 0.015 to 0.036."
        }
      ],
      effect_estimates: [
        {
          comparison_id: "non_nested_vs_nested",
          metric_key: "macro_f1_delta_vs_logreg",
          delta: 0.026,
          direction: "positive",
          summary: "The estimated macro-F1 delta remains positive but modest."
        }
      ]
    },
    figure_specs: [
      {
        id: "delta_overview",
        title: "Dataset-level macro-F1 deltas",
        path: "figures/delta.svg",
        metric_keys: ["macro_f1_delta_vs_logreg"],
        summary: "Dataset-level macro-F1 deltas with uncertainty-aware interpretation."
      }
    ],
    synthesis: {
      source: "fallback",
      discussion_points: [
        "The observed gain is consistent with a benchmark note rather than a broad method claim."
      ],
      failure_analysis: [],
      follow_up_actions: [],
      confidence_statement: "Confidence is moderate because repeated evaluations exist, but dataset scope remains narrow."
    }
  };
}

function buildMediumLatestResults(): Record<string, unknown> {
  return {
    protocol: {
      dataset_source: "OpenML",
      datasets: ["breast_cancer", "iris"],
      models: ["logreg", "extra_trees"],
      workflows: ["nested", "non_nested"],
      repeats: 3,
      seed_schedule: [100, 101, 102],
      n_samples: 569,
      n_features: 30,
      n_classes: 2
    },
    dataset_summaries: [
      {
        dataset: "breast_cancer",
        workflows: {
          non_nested: {
            models: {
              logreg: { mean_test_macro_f1: 0.91 },
              extra_trees: { mean_test_macro_f1: 0.944, mean_delta_vs_logreg: 0.034 }
            },
            pairwise_ranking_agreement: 0.9,
            winner_consistency: 1,
            runtime_seconds_mean: 0.95,
            peak_memory_mb_mean: 151
          }
        }
      },
      {
        dataset: "iris",
        workflows: {
          non_nested: {
            models: {
              logreg: { mean_test_macro_f1: 0.89 },
              extra_trees: { mean_test_macro_f1: 0.918, mean_delta_vs_logreg: 0.028 }
            },
            pairwise_ranking_agreement: 0.88,
            winner_consistency: 1,
            runtime_seconds_mean: 0.82,
            peak_memory_mb_mean: 150
          }
        }
      }
    ],
    repeat_records: [
      {
        repeat_index: 0,
        datasets: [
          {
            dataset: "breast_cancer",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.91 },
                  extra_trees: { test_macro_f1: 0.945 }
                }
              }
            }
          },
          {
            dataset: "iris",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.89 },
                  extra_trees: { test_macro_f1: 0.919 }
                }
              }
            }
          }
        ]
      },
      {
        repeat_index: 1,
        datasets: [
          {
            dataset: "breast_cancer",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.91 },
                  extra_trees: { test_macro_f1: 0.944 }
                }
              }
            }
          },
          {
            dataset: "iris",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.89 },
                  extra_trees: { test_macro_f1: 0.918 }
                }
              }
            }
          }
        ]
      },
      {
        repeat_index: 2,
        datasets: [
          {
            dataset: "breast_cancer",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.91 },
                  extra_trees: { test_macro_f1: 0.943 }
                }
              }
            }
          },
          {
            dataset: "iris",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.89 },
                  extra_trees: { test_macro_f1: 0.917 }
                }
              }
            }
          }
        ]
      }
    ]
  };
}

async function seedMediumScientificRun(run: RunRecord): Promise<void> {
  await overwriteRunArtifacts(run, {
    "paper_summaries.jsonl": [
      {
        paper_id: "paper_1",
        title: "Nested Validation for Tabular Baselines",
        source_type: "full_text",
        summary: "Nested validation stabilizes model selection in small tabular benchmarks.",
        key_findings: ["Nested validation reduces selection optimism."],
        limitations: ["Compute cost rises with repeated evaluation."],
        datasets: ["breast_cancer", "iris"],
        metrics: ["macro_f1"],
        novelty: "Evaluation and benchmarking for small tabular datasets",
        reproducibility_notes: ["Explicit seeds and folds are reported."]
      },
      {
        paper_id: "paper_2",
        title: "CPU-Only Tree Baselines",
        source_type: "full_text",
        summary: "Tree ensembles offer small gains over logistic regression on public datasets.",
        key_findings: ["Extra trees produce small positive deltas on some datasets."],
        limitations: ["Gains vary by dataset."],
        datasets: ["breast_cancer", "iris"],
        metrics: ["macro_f1_delta_vs_logreg"],
        novelty: "Classical model comparison under CPU-only constraints",
        reproducibility_notes: ["OpenML datasets and seed schedules are listed."]
      },
      {
        paper_id: "paper_3",
        title: "Reproducibility Notes for Repeated CV",
        source_type: "full_text",
        summary: "Repeated CV supports cautious, not universal, claims about ranking stability.",
        key_findings: ["Repeated evaluation exposes heterogeneity."],
        limitations: ["Repeated CV does not justify strong inferential language."],
        datasets: ["OpenML tabular suites"],
        metrics: ["pairwise_ranking_agreement"],
        novelty: "Reproducibility framing for repeated evaluation",
        reproducibility_notes: ["Intervals and heterogeneity are emphasized."]
      }
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "corpus.jsonl": [
      {
        paper_id: "paper_1",
        title: "Nested Validation for Tabular Baselines",
        abstract: "Nested validation stabilizes model selection in small tabular benchmarks.",
        authors: ["Alice Doe"],
        year: 2025,
        venue: "ACL Findings"
      },
      {
        paper_id: "paper_2",
        title: "CPU-Only Tree Baselines",
        abstract: "Tree ensembles offer small gains over logistic regression on public datasets.",
        authors: ["Bob Doe"],
        year: 2024,
        venue: "EMNLP"
      },
      {
        paper_id: "paper_3",
        title: "Reproducibility Notes for Repeated CV",
        abstract: "Repeated CV supports cautious, not universal, claims about ranking stability.",
        authors: ["Cara Doe"],
        year: 2024,
        venue: "TMLR"
      }
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "experiment_plan.yaml": [
      "selected_design:",
      '  title: "Repeated CPU-only tabular baseline comparison"',
      "  datasets:",
      '    - "breast_cancer"',
      '    - "iris"',
      "  metrics:",
      '    - "macro_f1_delta_vs_logreg"',
      '    - "pairwise_ranking_agreement"',
      "  baselines:",
      '    - "logistic regression"',
      '    - "extra trees"',
      "  implementation_notes:",
      '    - "OpenML datasets with 569 samples, 30 features, and 2 classes are used."',
      '    - "Standardize numeric columns, impute missing values, and fit preprocessing within each fold."',
      '    - "Class imbalance is tracked explicitly."',
      "  evaluation_steps:",
      '    - "Run outer 5-fold CV with inner 3-fold tuning."',
      '    - "Use stratified splits and repeat each workflow across fixed random seeds."',
      "  resource_notes:",
      '    - "Hyperparameter grid includes max_depth, n_estimators, and C."'
    ].join("\n"),
    "result_analysis.json": `${JSON.stringify(buildMediumResultAnalysis(), null, 2)}\n`
  });
  await writeLatestResults(run, buildMediumLatestResults());
}

function createPdfBuildAci(options?: { failFirstCompile?: boolean; failAllCompiles?: boolean; pdfPageCount?: number }) {
  const commands: string[] = [];
  let firstCompileFailed = false;

  return {
    commands,
    api: {
      async runCommand(command: string, cwd?: string) {
        commands.push(command);
        if (!cwd) {
          throw new Error("Expected cwd for paper compilation.");
        }
        if (options?.failAllCompiles && command.startsWith("pdflatex")) {
          return {
            status: "error" as const,
            stdout: "",
            stderr: "main.tex:42: Undefined control sequence \\badcommand",
            exit_code: 1,
            duration_ms: 5
          };
        }
        if (options?.failFirstCompile && !firstCompileFailed && command.startsWith("pdflatex")) {
          firstCompileFailed = true;
          return {
            status: "error" as const,
            stdout: "",
            stderr: "main.tex:42: Undefined control sequence \\badcommand",
            exit_code: 1,
            duration_ms: 5
          };
        }
        if (command.startsWith("pdflatex")) {
          await writeFile(path.join(cwd, "main.pdf"), "%PDF-1.4 mock\n", "utf8");
          return {
            status: "ok" as const,
            stdout: "Output written on main.pdf",
            stderr: "",
            exit_code: 0,
            duration_ms: 5
          };
        }
        if (command === "bibtex main") {
          return {
            status: "ok" as const,
            stdout: "This is BibTeX, Version 0.99d",
            stderr: "",
            exit_code: 0,
            duration_ms: 2
          };
        }
        if (command === "pdfinfo main.pdf") {
          return {
            status: "ok" as const,
            stdout: `Title: mock\nPages: ${options?.pdfPageCount ?? 8}\n`,
            stderr: "",
            exit_code: 0,
            duration_ms: 1
          };
        }
        return {
          status: "error" as const,
          stdout: "",
          stderr: `Unexpected command: ${command}`,
          exit_code: 1,
          duration_ms: 1
        };
      }
    }
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("writePaper PDF build", () => {
  it("runs a related-work scout and allows the writer to cite scout-only papers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-related-work-scout-"));
    process.chdir(root);

    const run = makeRun("run-paper-related-work-scout");
    const runDir = await seedRun(root, run);
    const requests: Array<{ query: string; limit: number }> = [];
    const semanticScholar = {
      async searchPapers(request: { query: string; limit: number }) {
        requests.push({ query: request.query, limit: request.limit });
        const paperIndex = requests.length;
        return [
          {
            paperId: `paper_scout_${paperIndex}`,
            title: paperIndex === 1 ? "Scout Results for Related Work" : "Coverage Backfill for Related Work",
            abstract: "A lightweight scouting pass can expand related-work coverage during drafting.",
            year: 2024,
            venue: paperIndex === 1 ? "EMNLP" : "NAACL",
            authors: ["Sam Scout"],
            citationCount: 17 + paperIndex,
            url: `https://example.org/scout-results-${paperIndex}`,
            openAccessPdfUrl: `https://example.org/scout-results-${paperIndex}.pdf`
          }
        ];
      }
    };

    const node = createWritePaperNode({
      config: {
        providers: {
          llm_mode: "openai_api"
        },
        paper: {
          build_pdf: false
        },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildRelatedWorkScoutResponses()),
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: semanticScholar as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async ({ pdfUrl }: { pdfUrl: string }) => ({
          text: JSON.stringify({
            summary: `Full-text summary for ${pdfUrl}.`,
            key_findings: ["Full-text related-work analysis recovered a grounded positioning signal."],
            limitations: ["The PDF analysis focuses on related-work positioning rather than experimental reproduction."],
            datasets: ["AgentBench-mini"],
            metrics: ["reproducibility_score"],
            novelty: "Full-text scout enrichment for related work",
            reproducibility_notes: ["The PDF source was read directly during write_paper."],
            evidence_items: [
              {
                claim: "The paper frames revision stability as a coordination problem.",
                method_slot: "related-work framing",
                result_slot: "positioning evidence",
                limitation_slot: "bounded enrichment",
                dataset_slot: "AgentBench-mini",
                metric_slot: "reproducibility_score",
                evidence_span: "The full paper highlights revision stability and coordination tradeoffs.",
                confidence: 0.78,
                confidence_reason: "The enrichment is grounded in the full PDF input."
              }
            ]
          })
        })
      } as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.query).toContain("agent collaboration");
    expect(requests[0]?.query).toContain("Thread-backed drafting benchmark");
    expect(requests[1]?.query).toContain("agent collaboration");

    const scoutRequest = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "request.json"), "utf8")
    ) as { query: string; planned_queries: Array<{ id: string }> };
    expect(scoutRequest.query).toContain("agent collaboration");
    expect(scoutRequest.planned_queries.length).toBeGreaterThanOrEqual(2);

    const scoutPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "plan.json"), "utf8")
    ) as { planned_queries: Array<{ id: string }> };
    expect(scoutPlan.planned_queries.length).toBeGreaterThanOrEqual(2);

    const scoutResult = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "result.json"), "utf8")
    ) as { status: string; paper_count: number };
    expect(scoutResult).toMatchObject({
      status: "collected",
      paper_count: 2
    });

    const coverageAudit = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "coverage_audit.json"), "utf8")
    ) as { status: string; executed_queries: Array<{ query: string }>; stop_reason: string };
    expect(coverageAudit.status).toBe("sufficient");
    expect(coverageAudit.executed_queries).toHaveLength(2);
    expect(coverageAudit.stop_reason).toMatch(/venue diversity|citation gap|target additional paper count/i);

    expect(await exists(path.join(runDir, "paper", "related_work_scout", "corpus.jsonl"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "related_work_scout", "bibtex.bib"))).toBe(true);
    const enrichmentResult = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "enrichment_result.json"), "utf8")
    ) as { status: string; analyzed_paper_count: number; full_text_count: number };
    expect(enrichmentResult).toMatchObject({
      status: "completed",
      analyzed_paper_count: 2,
      full_text_count: 2
    });
    const enrichmentSummaries = await readFile(
      path.join(runDir, "paper", "related_work_scout", "enrichment_summaries.jsonl"),
      "utf8"
    );
    expect(enrichmentSummaries).toContain('"paper_id":"paper_scout_1"');
    expect(enrichmentSummaries).toContain('"source_type":"full_text"');

    const relatedWorkNotes = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_notes.json"), "utf8")
    ) as { note_count: number; comparison_axes: string[]; paragraph_plan: Array<{ role: string }> };
    expect(relatedWorkNotes.note_count).toBeGreaterThanOrEqual(3);
    expect(relatedWorkNotes.comparison_axes.length).toBeGreaterThan(0);
    expect(relatedWorkNotes.paragraph_plan).toHaveLength(2);

    const draft = JSON.parse(await readFile(path.join(runDir, "paper", "draft.json"), "utf8")) as {
      sections: Array<{ heading: string; paragraphs: Array<{ text: string }>; citation_paper_ids: string[] }>;
    };
    const relatedWorkSection = draft.sections.find((section) => section.heading === "Related Work");
    expect(relatedWorkSection?.citation_paper_ids).toContain("paper_scout_1");
    expect(relatedWorkSection?.paragraphs.length).toBe(2);
    expect(relatedWorkSection?.paragraphs[1]?.text).toMatch(/current study|present study/i);

    const references = await readFile(path.join(runDir, "paper", "references.bib"), "utf8");
    expect(references).toContain("Scout Results for Related Work");
    expect(references).toContain("Coverage Backfill for Related Work");

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.cited_paper_ids")).toContain("paper_scout_1");
    expect(await memory.get("write_paper.related_work_scout")).toMatchObject({
      status: "collected",
      paper_count: 2,
      planned_query_count: 3,
      executed_query_count: 2,
      coverage_status: "sufficient"
    });
    expect(await memory.get("write_paper.related_work_notes")).toMatchObject({
      note_count: 3
    });
    expect(await memory.get("write_paper.related_work_enrichment")).toMatchObject({
      analyzed_paper_count: 2,
      full_text_count: 2
    });
  });

  it("runs one validation repair pass before rendering when warnings accumulate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-validation-repair-"));
    process.chdir(root);

    const run = makeRun("run-paper-validation-repair");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildValidationRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("after one automatic validation repair (1 -> 0)");

    const validation = JSON.parse(await readFile(path.join(runDir, "paper", "validation.json"), "utf8")) as {
      issues: Array<{ message: string }>;
    };
    expect(validation.issues).toHaveLength(0);

    const repairReport = JSON.parse(
      await readFile(path.join(runDir, "paper", "validation_repair_report.json"), "utf8")
    ) as {
      attempted: boolean;
      applied: boolean;
      initial_warning_count: number;
      final_warning_count: number;
    };
    expect(repairReport).toMatchObject({
      attempted: true,
      applied: true,
      initial_warning_count: 1,
      final_warning_count: 0
    });

    const traceRaw = await readFile(path.join(runDir, "paper", "session_trace.json"), "utf8");
    expect(traceRaw).toContain('"stage": "validation_repair"');

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.validation_repair")).toMatchObject({
      attempted: true,
      applied: true,
      initial_warning_count: 1,
      final_warning_count: 0
    });
  });

  it("builds a paper PDF and publishes the compiled artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-success");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci();

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          latex_engine: "auto_install"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("PDF: built successfully");
    expect(aci.commands).toEqual([
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "bibtex main",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdfinfo main.pdf"
    ]);

    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compile_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "traceability.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "submission_validation.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compiled_page_validation.json"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "build.log"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "manuscript.json"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "traceability.json"))).toBe(true);

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ status: string }>;
    };
    expect(report.status).toBe("success");
    expect(report.repaired).toBe(false);
    expect(report.attempts).toHaveLength(1);
    const submissionValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "submission_validation.json"), "utf8")
    ) as { ok: boolean; issues: unknown[] };
    expect(submissionValidation.ok).toBe(true);
    expect(submissionValidation.issues).toHaveLength(0);
    const compiledPageValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "compiled_page_validation.json"), "utf8")
    ) as { status: string; compiled_pdf_page_count: number; main_page_limit: number };
    expect(compiledPageValidation.status).toBe("pass");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(8);
    expect(compiledPageValidation.main_page_limit).toBe(8);

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("success");
    expect(await memory.get("write_paper.pdf_path")).toBe(
      path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
    );
  });

  it("fails before PDF build when submission validation catches raw evidence ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-submission-validation-"));
    process.chdir(root);

    const run = makeRun("run-paper-submission-validation");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci();

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: true
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSubmissionValidationFailureResponses()),
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("submission-quality validation failed");
    expect(result.error).toContain("raw evidence identifier");
    expect(aci.commands).toHaveLength(0);
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(false);

    const submissionValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "submission_validation.json"), "utf8")
    ) as { ok: boolean; issues: Array<{ kind: string; value?: string }> };
    expect(submissionValidation.ok).toBe(false);
    expect(
      submissionValidation.issues.some(
        (issue) => issue.kind === "evidence_id" && issue.value?.includes("ev_1")
      )
    ).toBe(true);

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe(null);
    expect(await memory.get("write_paper.pdf_path")).toBe(null);
  });

  it("omits auto-generated visuals when metrics are uninformative", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-visual-gate-"));
    process.chdir(root);

    const run = makeRun("run-paper-visual-gate");
    const runDir = await seedRun(root, run);
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify(
        {
          objective_metric: {
            evaluation: {
              summary: "Objective metric met: reproducibility_score=1.0."
            }
          },
          metric_table: [
            { key: "confirmatory_metrics.json", value: 1 },
            { key: "quick_check_metrics.json", value: 1 },
            { key: "metrics.json", value: 1 }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).not.toContain("\\begin{table}[t]");
    expect(tex).not.toContain("\\begin{figure}[t]");
  });

  it("repairs LaTeX once after a failed compile and retries the PDF build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-repair-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-repair");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci({ failFirstCompile: true });
    const llm = new SequencedLLMClient([
      ...buildSessionResponses(),
      "\\documentclass{article}\n\\begin{document}\nRepaired paper draft.\n\\end{document}\n"
    ]);

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          latex_engine: "auto_install"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("after one automatic repair");
    expect(aci.commands).toEqual([
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "bibtex main",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdfinfo main.pdf"
    ]);

    const repairedTex = await readFile(path.join(runDir, "paper", "latex_repair.tex"), "utf8");
    expect(repairedTex).toContain("Repaired paper draft.");
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(true);
    expect(await readFile(path.join(buildPublicPaperDir(root, run), "main.tex"), "utf8")).toContain(
      "\\documentclass{article}"
    );

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ repaired: boolean; status: string }>;
    };
    expect(report.status).toBe("repaired_success");
    expect(report.repaired).toBe(true);
    expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0]).toMatchObject({ repaired: false, status: "failed" });
    expect(report.attempts[1]).toMatchObject({ repaired: true, status: "success" });

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("repaired_success");
    expect(await memory.get("write_paper.pdf_path")).toBe(
      path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
    );
    const manifest = JSON.parse(await readFile(buildPublicRunManifestPath(root, run), "utf8")) as {
      generated_files: string[];
      sections?: {
        paper?: {
          generated_files: string[];
        };
      };
    };
    expect(manifest.generated_files).toEqual(
      expect.arrayContaining(["paper/main.tex", "paper/references.bib", "paper/evidence_links.json", "paper/main.pdf"])
    );
    expect(manifest.sections?.paper?.generated_files).toEqual(
      expect.arrayContaining(["paper/main.tex", "paper/references.bib", "paper/evidence_links.json", "paper/main.pdf"])
    );
  });

  it("warns in default mode when the compiled PDF remains below main_page_limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-short-default-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-short-default");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci({ pdfPageCount: 3 });

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const compiledPageValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "compiled_page_validation.json"), "utf8")
    ) as { status: string; outcome: string; compiled_pdf_page_count: number; main_page_limit: number; message: string };
    expect(compiledPageValidation.status).toBe("warn");
    expect(compiledPageValidation.outcome).toBe("under_limit");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(3);
    expect(compiledPageValidation.main_page_limit).toBe(8);
    expect(compiledPageValidation.message).toContain("below the configured main_page_limit");
    expect(await exists(path.join(buildPublicPaperDir(root, run), "compiled_page_validation.json"))).toBe(true);
  });

  it("fails compiled page-budget validation in strict-paper mode when the PDF remains below main_page_limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-short-strict-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-short-strict");
    const compiledPageValidation = await validateCompiledPdfPageBudget({
      deps: {
        aci: {
          async runCommand(command: string) {
            expect(command).toBe("pdfinfo main.pdf");
            return {
              status: "ok" as const,
              stdout: "Title: mock\nPages: 0\n",
              stderr: "",
              exit_code: 0,
              duration_ms: 1
            };
          }
        }
      } as any,
      run,
      compileResult: {
        enabled: true,
        status: "success",
        repaired: false,
        toolCallsUsed: 0,
        attempts: [],
        warnings: [],
        pdf_path: path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
      },
      validationMode: "strict_paper",
      mainPageLimit: 1
    });

    expect(compiledPageValidation.status).toBe("fail");
    expect(compiledPageValidation.outcome).toBe("under_limit");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(0);
    expect(compiledPageValidation.main_page_limit).toBe(1);
  });

  it("fails the node when PDF compilation still fails after repair", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-fail-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-fail");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci({ failAllCompiles: true });
    const eventStream = new InMemoryEventStream();
    const llm = new SequencedLLMClient([
      ...buildSessionResponses(),
      "\\documentclass{article}\n\\begin{document}\nStill broken.\n\\end{document}\n"
    ]);

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          latex_engine: "auto_install"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("configured PDF build failed");
    expect(result.error).toContain("Undefined control sequence");
    expect(aci.commands).toEqual([
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex"
    ]);

    expect(await exists(path.join(runDir, "paper", "main.tex"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compile_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(false);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(false);

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ repaired: boolean; status: string; error?: string }>;
    };
    expect(report.status).toBe("failed");
    expect(report.repaired).toBe(true);
    expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0]).toMatchObject({ repaired: false, status: "failed" });
    expect(report.attempts[1]).toMatchObject({ repaired: true, status: "failed" });

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("failed");
    expect(await memory.get("write_paper.pdf_path")).toBe(null);
    expect(await memory.get("write_paper.last_error")).toMatch(/configured PDF build failed/i);

    expect(eventStream.history().some((event) => event.type === "NODE_COMPLETED")).toBe(false);
    expect(eventStream.history().some((event) => event.type === "TEST_FAILED")).toBe(true);
  });

  it("surfaces weak scientific results as a warning in default mode and rewrites strong claims", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-weak-default-"));
    process.chdir(root);

    const run = makeRun("run-paper-weak-default");
    const runDir = await seedRun(root, run);
    await overwriteRunArtifacts(run, {
      "experiment_plan.yaml": [
        "selected_design:",
        '  title: "Small benchmark note"',
        "  datasets:",
        '    - "AgentBench-mini"'
      ].join("\n"),
      "result_analysis.json": JSON.stringify(
        {
          objective_metric: {
            evaluation: {
              summary: "Observed a small positive delta on a single benchmark artifact."
            }
          },
          metric_table: [{ key: "macro_f1_delta_vs_logreg", value: 0.01 }],
          statistical_summary: {
            notes: ["Only a single weak artifact is available."]
          }
        },
        null,
        2
      ) + "\n"
    });
    await writeLatestResults(run, {
      protocol: {
        datasets: ["AgentBench-mini"],
        models: ["baseline", "method"]
      },
      dataset_summaries: [
        {
          dataset: "AgentBench-mini",
          models: {
            baseline: { macro_f1: 0.71 },
            method: { macro_f1: 0.72, macro_f1_delta_vs_logreg: 0.01 }
          }
        }
      ]
    });

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["per_fold_results", "environment_dump"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildWeakScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("Scientific gate: warn");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      status: string;
      issues: Array<{ code: string; message: string; outcome?: string }>;
      evidence_summary: { blocked_by_evidence_insufficiency: boolean; thin_sections: string[] };
    };
    expect(gateDecision.status).toBe("warn");
    expect(gateDecision.issues.some((issue) => issue.code.includes("page_budget"))).toBe(true);
    expect(gateDecision.evidence_summary.blocked_by_evidence_insufficiency).toBe(true);
    expect(gateDecision.evidence_summary.thin_sections.length).toBeGreaterThan(0);
    const scientificValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "scientific_validation.json"), "utf8")
    ) as {
      auto_repairs: { claim_rewrite_count: number };
      evidence_diagnostics: { blocked_by_evidence_insufficiency: boolean; missing_evidence_categories: string[] };
    };
    expect(scientificValidation.auto_repairs.claim_rewrite_count).toBeGreaterThanOrEqual(0);
    expect(scientificValidation.evidence_diagnostics.blocked_by_evidence_insufficiency).toBe(true);
    expect(scientificValidation.evidence_diagnostics.missing_evidence_categories.length).toBeGreaterThan(0);
    const manuscript = JSON.parse(await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8")) as {
      abstract: string;
      sections: Array<{ heading: string; paragraphs: string[] }>;
    };
    expect(manuscript.abstract).not.toMatch(/significant improvement/i);
    expect(manuscript.sections.find((section) => section.heading === "Results")?.paragraphs.join(" ")).not.toMatch(/significant improvement/i);
  });

  it("fails weak scientific results in strict-paper mode while preserving artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-weak-strict-"));
    process.chdir(root);

    const run = makeRun("run-paper-weak-strict");
    const runDir = await seedRun(root, run);
    await overwriteRunArtifacts(run, {
      "experiment_plan.yaml": [
        "selected_design:",
        '  title: "Small benchmark note"',
        "  datasets:",
        '    - "AgentBench-mini"'
      ].join("\n")
    });
    await writeLatestResults(run, {
      protocol: {
        datasets: ["AgentBench-mini"],
        models: ["baseline", "method"]
      },
      dataset_summaries: []
    });

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "strict_paper"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["per_fold_results", "environment_dump"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildWeakScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("scientific quality gate failed");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      mode: string;
      status: string;
      failure_reasons: string[];
      evidence_summary: { blocked_by_evidence_insufficiency: boolean };
    };
    expect(gateDecision.mode).toBe("strict_paper");
    expect(gateDecision.status).toBe("fail");
    expect(gateDecision.failure_reasons.length).toBeGreaterThan(0);
    expect(gateDecision.evidence_summary.blocked_by_evidence_insufficiency).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "provenance_map.json"))).toBe(true);
  });

  it("routes medium-quality runs through main paper plus appendix without failing the default gate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-medium-quality-"));
    process.chdir(root);

    const run = makeRun("run-paper-medium-quality");
    const runDir = await seedRun(root, run);
    await seedMediumScientificRun(run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["hyperparameter_grids", "per_fold_results", "environment_dump", "extended_error_analysis"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildMediumScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      status: string;
      classification_summary: { auto_repair_count: number };
    };
    expect(gateDecision.status).not.toBe("fail");
    expect(gateDecision.classification_summary.auto_repair_count).toBeGreaterThan(0);
    const manuscript = JSON.parse(await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8")) as {
      sections: Array<{ heading: string; paragraphs: string[] }>;
      appendix_sections?: Array<{ heading: string }>;
    };
    expect(manuscript.sections.find((section) => section.heading === "Method")?.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(manuscript.sections.find((section) => section.heading === "Results")?.paragraphs.length).toBeGreaterThanOrEqual(4);
    expect((manuscript.appendix_sections || []).length).toBeGreaterThan(0);
    const traceability = JSON.parse(await readFile(path.join(runDir, "paper", "traceability.json"), "utf8")) as {
      paragraphs: Array<{ source_refs?: Array<{ kind: string; id: string }> }>;
    };
    expect(traceability.paragraphs.some((paragraph) => (paragraph.source_refs || []).length > 0)).toBe(true);
    const provenanceMap = JSON.parse(await readFile(path.join(runDir, "paper", "provenance_map.json"), "utf8")) as {
      paragraph_anchors: Array<{ anchor_id: string; numeric_fact_ids: string[] }>;
      numeric_anchors: Array<{ support_status: string }>;
    };
    expect(provenanceMap.paragraph_anchors.length).toBeGreaterThan(0);
    expect(provenanceMap.numeric_anchors.some((anchor) => anchor.support_status === "supported")).toBe(true);
  });

  it("hard-fails inconsistent manuscripts when abstract/results/conclusion numbers diverge", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-inconsistent-"));
    process.chdir(root);

    const run = makeRun("run-paper-inconsistent");
    const runDir = await seedRun(root, run);
    await seedMediumScientificRun(run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["hyperparameter_grids", "per_fold_results", "environment_dump", "extended_error_analysis"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildInconsistentScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("scientific quality gate failed");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      status: string;
      failure_reasons: string[];
      classification_summary: { contradiction_count: number };
    };
    expect(gateDecision.status).toBe("fail");
    expect(gateDecision.failure_reasons.some((message) => /structured results|datasets|significant improvement/i.test(message))).toBe(true);
    expect(gateDecision.classification_summary.contradiction_count).toBeGreaterThan(0);
    const consistency = JSON.parse(await readFile(path.join(runDir, "paper", "consistency_lint.json"), "utf8")) as {
      manuscript: { issues: Array<{ kind: string; involved_sections?: string[] }> };
    };
    expect(consistency.manuscript.issues.some((issue) => issue.kind === "numeric_inconsistency")).toBe(true);
    expect(consistency.manuscript.issues.some((issue) => issue.kind === "count_inconsistency")).toBe(true);
    expect(
      consistency.manuscript.issues.some(
        (issue) => issue.kind === "numeric_inconsistency" && (issue.involved_sections || []).length > 0
      )
    ).toBe(true);
  });
});
