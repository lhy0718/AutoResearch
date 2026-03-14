import { describe, expect, it } from "vitest";

import type { PaperDraft, PaperWritingBundle } from "../src/core/analysis/paperWriting.js";
import type { PaperManuscript } from "../src/core/analysis/paperManuscript.js";
import {
  applyScientificWritingPolicy,
  buildScientificValidationArtifact,
  buildWritePaperGateDecision,
  materializeScientificManuscript
} from "../src/core/analysis/scientificWriting.js";

const PAPER_PROFILE = {
  venue_style: "acl_long",
  main_page_limit: 8,
  references_counted: false,
  appendix_allowed: true,
  appendix_format: "double_column" as const,
  prefer_appendix_for: [
    "hyperparameter_grids",
    "per_fold_results",
    "environment_dump",
    "extended_error_analysis"
  ],
  estimated_words_per_page: 420
};

function makeRichBundle(): PaperWritingBundle {
  return {
    runTitle: "Repeated Tabular Benchmark",
    topic: "resource-aware tabular baseline comparison",
    objectiveMetric: "macro_f1_delta_vs_logreg >= 0.02",
    constraints: ["ACL style", "evidence-first writing"],
    paperSummaries: [
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
    ],
    evidenceRows: [
      {
        evidence_id: "ev_1",
        paper_id: "paper_1",
        claim: "Nested evaluation lowers selection optimism.",
        method_slot: "nested and non-nested CPU-only workflows",
        result_slot: "lower optimism with small macro-F1 deltas",
        limitation_slot: "dataset-dependent gains",
        dataset_slot: "breast_cancer",
        metric_slot: "macro_f1_delta_vs_logreg",
        evidence_span: "Repeated evaluation exposes small but positive deltas on breast_cancer and iris.",
        source_type: "full_text",
        confidence: 0.91,
        confidence_reason: "Repeated evaluations and explicit datasets are available."
      }
    ],
    hypotheses: [
      {
        hypothesis_id: "h_1",
        text: "Non-nested extra trees may show a small positive macro-F1 delta over logistic regression on some public datasets.",
        evidence_links: ["ev_1"],
        rationale: "Positive deltas are plausible but should remain modest and dataset-dependent.",
        measurement_hint: "Track macro_f1_delta_vs_logreg, runtime, memory, and ranking stability."
      }
    ],
    corpus: [
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
    ],
    experimentPlan: {
      selectedTitle: "Repeated CPU-only tabular baseline comparison",
      selectedSummary: "Compare nested and non-nested workflows on OpenML datasets with runtime and memory tracking.",
      rawText: [
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
        '    - "Hyperparameter grid includes max_depth, n_estimators, and C."',
        "constraints:",
        "  implementation_notes:",
        '    - "OpenML dataset source and preprocessing order must be reported."',
        "  evaluation_notes:",
        '    - "Keep claims scoped to repeated evaluation artifacts and report runtime and memory."'
      ].join("\n")
    },
    resultAnalysis: {
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
      condition_comparisons: [
        {
          id: "non_nested_vs_nested",
          label: "non-nested vs nested",
          source: "metrics.condition_metrics",
          metrics: [],
          summary: "Non-nested extra trees show a small positive delta over nested logistic regression."
        }
      ],
      primary_findings: [
        "The strongest workflow suggests a small positive macro-F1 delta over logistic regression.",
        "Runtime and memory remain close across the two workflows."
      ],
      limitations: [
        "The delta is small and varies by dataset.",
        "Repeated CV does not justify strong inferential language."
      ],
      statistical_summary: {
        total_trials: 3,
        executed_trials: 3,
        cached_trials: 0,
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
        stability_metrics: [{ key: "pairwise_ranking_agreement", value: 0.885 }],
        effect_estimates: [
          {
            comparison_id: "non_nested_vs_nested",
            metric_key: "macro_f1_delta_vs_logreg",
            delta: 0.026,
            direction: "positive",
            summary: "The estimated macro-F1 delta remains positive but modest."
          }
        ],
        notes: [
          "Dispersion across repeated runs is moderate rather than negligible.",
          "Heterogeneity remains visible across datasets."
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
    } as any,
    latestResults: {
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
            nested: {
              models: {
                logreg: { mean_test_macro_f1: 0.91 },
                extra_trees: { mean_test_macro_f1: 0.922, mean_delta_vs_logreg: 0.012 }
              },
              pairwise_ranking_agreement: 0.86,
              winner_consistency: 0.8,
              runtime_seconds_mean: 1.3,
              peak_memory_mb_mean: 148
            },
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
            nested: {
              models: {
                logreg: { mean_test_macro_f1: 0.89 },
                extra_trees: { mean_test_macro_f1: 0.905, mean_delta_vs_logreg: 0.015 }
              },
              pairwise_ranking_agreement: 0.84,
              winner_consistency: 0.8,
              runtime_seconds_mean: 1.1,
              peak_memory_mb_mean: 146
            },
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
    },
    relatedWorkNotes: [
      {
        paper_id: "paper_1",
        title: "Nested Validation for Tabular Baselines",
        source_type: "analyzed_paper",
        comparison_role: "closest",
        method_family: "evaluation and benchmarking",
        problem_focus: "selection optimism in small tabular data",
        setting_focus: "public tabular datasets",
        contribution_focus: "nested validation baselines",
        limitation_or_caveat: "added compute cost",
        relation_to_study: "closest baseline for evaluation protocol"
      },
      {
        paper_id: "paper_2",
        title: "CPU-Only Tree Baselines",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "classical model baselines",
        problem_focus: "small positive deltas over logistic regression",
        setting_focus: "CPU-only public datasets",
        contribution_focus: "resource-aware tree baselines",
        limitation_or_caveat: "dataset-dependent gains",
        relation_to_study: "supports model comparison framing"
      },
      {
        paper_id: "paper_3",
        title: "Reproducibility Notes for Repeated CV",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "reproducibility and statistics",
        problem_focus: "heterogeneity under repeated evaluation",
        setting_focus: "repeated CV",
        contribution_focus: "cautious statistical framing",
        limitation_or_caveat: "does not justify strong inferential claims",
        relation_to_study: "supports cautious discussion framing"
      }
    ]
  };
}

function makeTerseDraft(): PaperDraft {
  return {
    title: "A Short Draft",
    abstract: "A short draft.",
    keywords: ["tabular baselines"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [{ text: "We compare tabular baselines.", evidence_ids: ["ev_1"], citation_paper_ids: ["paper_1"] }],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: [{ text: "We use a benchmark.", evidence_ids: ["ev_1"], citation_paper_ids: ["paper_1"] }],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: [{ text: "We observed improvement.", evidence_ids: ["ev_1"], citation_paper_ids: ["paper_1"] }],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: [{ text: "The benchmark is useful.", evidence_ids: ["ev_1"], citation_paper_ids: ["paper_1"] }],
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
  };
}

describe("scientificWriting", () => {
  it("expands a terse draft into a richer main paper and appendix when detailed artifacts exist", () => {
    const bundle = makeRichBundle();
    const draft = makeTerseDraft();

    const scientific = applyScientificWritingPolicy({
      draft,
      bundle,
      profile: PAPER_PROFILE
    });

    expect(scientific.method_completeness.status).toBe("complete");
    expect(scientific.results_richness.status).toBe("complete");
    expect(scientific.related_work_richness.status).toBe("complete");
    expect(scientific.discussion_richness.status).toBe("complete");
    expect(scientific.draft.sections.find((section) => section.heading === "Discussion")).toBeTruthy();
    expect(scientific.draft.sections.find((section) => section.heading === "Limitations")).toBeTruthy();
    expect(scientific.draft.sections.find((section) => section.heading === "Method")?.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(scientific.draft.sections.find((section) => section.heading === "Results")?.paragraphs.length).toBeGreaterThanOrEqual(4);
    expect(scientific.appendix_plan.sections.length).toBeGreaterThan(0);

    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      }))
    };

    const manuscript = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    expect(manuscript.manuscript.appendix_sections?.length).toBeGreaterThan(0);
    expect(manuscript.manuscript.sections.find((section) => section.heading === "Method")?.paragraphs.at(-1)).toMatch(/Appendix/i);
    expect(manuscript.manuscript.sections.find((section) => section.heading === "Results")?.paragraphs.at(-1)).toMatch(/Appendix/i);
    expect(manuscript.consistency_lint.ok).toBe(true);
    expect(manuscript.appendix_lint.ok).toBe(true);
  });

  it("rewrites over-strong performance claims when statistical support is missing", () => {
    const bundle = makeRichBundle();
    bundle.latestResults = {
      protocol: {
        datasets: ["breast_cancer"],
        models: ["logreg", "extra_trees"]
      },
      dataset_summaries: []
    };
    (bundle.resultAnalysis as any).statistical_summary.confidence_intervals = [];
    (bundle.resultAnalysis as any).statistical_summary.notes = [];

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });

    expect(scientific.claim_rewrite_report.rewrites.length).toBeGreaterThan(0);
    expect(scientific.draft.claims[0]?.statement).toMatch(/positive delta|suggests/i);
  });

  it("treats richness/page-budget issues as warn by default and fail in strict-paper mode", () => {
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle: makeRichBundle(),
      profile: PAPER_PROFILE
    });
    const scientificValidation = buildScientificValidationArtifact(scientific);
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      }))
    };
    const manuscript = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle: makeRichBundle(),
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    const defaultDecision = buildWritePaperGateDecision({
      mode: "default",
      scientificValidation,
      consistencyLint: manuscript.consistency_lint,
      appendixLint: manuscript.appendix_lint
    });
    const strictDecision = buildWritePaperGateDecision({
      mode: "strict_paper",
      scientificValidation,
      consistencyLint: manuscript.consistency_lint,
      appendixLint: manuscript.appendix_lint
    });

    expect(defaultDecision.status).toBe("warn");
    expect(strictDecision.status).toBe("fail");
    expect(strictDecision.failure_reasons.some((message) => /target budget|too thin|incomplete/i.test(message))).toBe(true);
  });

  it("flags numeric contradictions between abstract/conclusion and structured results", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "We improve macro-F1 by 0.2 across 8 datasets.",
      keywords: ["tabular"],
      sections: [
        {
          heading: "Introduction",
          paragraphs: ["This benchmark studies repeated tabular evaluation."]
        },
        {
          heading: "Method",
          paragraphs: ["We evaluate 2 datasets with outer 5-fold CV and inner 3-fold tuning."]
        },
        {
          heading: "Results",
          paragraphs: ["The observed macro-F1 delta is 0.026 on the strongest workflow across 2 datasets."]
        },
        {
          heading: "Conclusion",
          paragraphs: ["The study shows significant improvement across 8 datasets."]
        }
      ]
    };
    const manuscript = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    expect(manuscript.consistency_lint.ok).toBe(false);
    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "numeric_inconsistency")).toBe(true);
    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "count_inconsistency")).toBe(true);
    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "unsupported_strong_claim")).toBe(true);
  });
});
