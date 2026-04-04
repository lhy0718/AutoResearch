import { describe, expect, it } from "vitest";

import type { PaperDraft, PaperWritingBundle } from "../src/core/analysis/paperWriting.js";
import {
  AUTHORED_MAIN_FIGURE_SOURCE_REF_ID,
  AUTHORED_MAIN_TABLE_SOURCE_REF_ID,
  type PaperManuscript
} from "../src/core/analysis/paperManuscript.js";
import {
  applyScientificWritingPolicy,
  buildScientificValidationArtifact,
  buildWritePaperGateDecision,
  materializeScientificManuscript,
  pageBudgetManager,
  resolvePaperProfile
} from "../src/core/analysis/scientificWriting.js";

const PAPER_PROFILE = {
  target_main_pages: 8,
  minimum_main_pages: 8,
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
  it("keeps internal manuscript defaults minimal when brief and template policy are absent", () => {
    const profile = resolvePaperProfile(undefined);
    expect(profile.column_count).toBe(2);
    expect(profile.appendix_format).toBe("double_column");
    expect(profile.prefer_appendix_for).toEqual([]);
    expect(profile.estimated_words_per_page).toBe(420);
  });

  it("derives single-column layout defaults without inventing appendix routing preferences", () => {
    const profile = resolvePaperProfile({ column_count: 1 });
    expect(profile.column_count).toBe(1);
    expect(profile.appendix_format).toBe("single_column");
    expect(profile.prefer_appendix_for).toEqual([]);
    expect(profile.estimated_words_per_page).toBe(700);
  });

  it("uses target_main_pages for word budgets while preserving a separate minimum_main_pages floor", () => {
    const report = pageBudgetManager({
      draft: makeTerseDraft(),
      profile: {
        ...PAPER_PROFILE,
        target_main_pages: 10,
        minimum_main_pages: 8,
        main_page_limit: 8
      }
    });

    expect(report.target_main_pages).toBe(10);
    expect(report.minimum_main_pages).toBe(8);
    expect(report.main_page_limit).toBe(8);
    expect(report.target_main_words).toBe(4200);
    expect(report.warnings[0]).toContain("10-page target budget");
  });

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
    expect(manuscript.provenance_map.paragraph_anchors.length).toBeGreaterThan(0);
    expect(manuscript.provenance_map.numeric_anchors.some((anchor) => anchor.support_status === "supported")).toBe(true);
  });

  it("records auto-repair recheck state after expanding thin sections", () => {
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle: makeRichBundle(),
      profile: PAPER_PROFILE
    });

    expect(scientific.auto_repairs.expansion_recheck.attempted).toBe(true);
    expect(scientific.auto_repairs.expanded_sections.length).toBeGreaterThan(0);
    expect(
      scientific.auto_repairs.expansion_recheck.resolved_headings.length
      + scientific.auto_repairs.expansion_recheck.unresolved_headings.length
    ).toBe(scientific.auto_repairs.expanded_sections.length);
  });

  it("does not flag equivalent numeric formatting as a contradiction", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const baseSections = scientific.draft.sections.map((section) => ({
      heading: section.heading,
      paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
    }));
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: baseSections.map((section) =>
        section.heading === "Results"
          ? {
              ...section,
              paragraphs: ["The observed macro-F1 delta vs logistic regression is 0.0260 across 2 datasets."]
            }
          : section
      )
    };

    const manuscript = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "numeric_inconsistency")).toBe(false);
    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "numeric_unverifiable")).toBe(false);
  });

  it("does not treat objective threshold text as a measured result fact", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "The writing objective remains macro_f1_delta_vs_logreg >= 0.02.",
      keywords: ["tabular"],
      sections: [
        {
          heading: "Introduction",
          paragraphs: ["The paper positions itself around macro_f1_delta_vs_logreg >= 0.02 while keeping claims cautious."]
        },
        {
          heading: "Method",
          paragraphs: ["We evaluate 2 datasets with outer 5-fold CV and inner 3-fold tuning."]
        },
        {
          heading: "Results",
          paragraphs: ["The observed macro-F1 delta vs logistic regression is 0.026 across 2 datasets."]
        },
        {
          heading: "Conclusion",
          paragraphs: ["The empirical claim remains narrow."]
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

    expect(
      manuscript.consistency_lint.issues.some(
        (issue) =>
          ["numeric_inconsistency", "numeric_unverifiable"].includes(issue.kind)
          && (issue.involved_sections || []).some((section) => ["Abstract", "Introduction"].includes(section))
      )
    ).toBe(false);
  });

  it("maps mixed delta metrics to their own keys instead of attributing all values to accuracy", () => {
    const bundle = makeRichBundle();
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "accuracy_delta", value: 0.07 },
        { key: "f1_delta", value: 0.09 },
        { key: "reproducibility_delta", value: 0.16 }
      ]
    } as any;

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: [
        {
          heading: "Introduction",
          paragraphs: ["This benchmark studies repeated tabular evaluation."]
        },
        {
          heading: "Method",
          paragraphs: ["We evaluate repeated treatment and baseline runs with the reported metrics."]
        },
        {
          heading: "Results",
          paragraphs: ["Shared state vs free form: accuracy_delta=0.07, f1_delta=0.09, reproducibility_delta=0.16."]
        },
        {
          heading: "Conclusion",
          paragraphs: ["The aggregate result remains modest."]
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

    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "numeric_inconsistency")).toBe(false);
  });

  it("distinguishes aggregate metrics from per-dataset values when checking numeric consistency", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "Average across datasets, the macro-F1 delta vs logistic regression is 0.012.",
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
          paragraphs: ["The observed macro-F1 delta vs logistic regression is 0.026 across 2 datasets."]
        },
        {
          heading: "Conclusion",
          paragraphs: ["The aggregate result remains modest."]
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

    const numericIssue = manuscript.consistency_lint.issues.find((issue) => issue.kind === "numeric_inconsistency");
    expect(numericIssue).toBeTruthy();
    expect(numericIssue?.involved_sections).toContain("Abstract");
    expect(numericIssue?.reason).toMatch(/structured numeric facts disagree|main-manuscript sections|scope\/key mismatch|metric-key mismatch/i);
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
    expect(defaultDecision.evidence_summary.blocked_by_evidence_insufficiency).toBe(false);
    expect(defaultDecision.evidence_summary.expandable_from_existing_evidence).toBe(true);
    expect(defaultDecision.classification_summary.repairable_count).toBeGreaterThan(0);
    expect(scientificValidation.evidence_diagnostics.thin_sections.length).toBeGreaterThan(0);
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
    expect(
      manuscript.consistency_lint.issues.some(
        (issue) => issue.kind === "numeric_inconsistency" && (issue.involved_sections || []).includes("Abstract")
      )
    ).toBe(true);
  });

  it("sanitizes internal-token captions before consistency linting", () => {
    const bundle = makeRichBundle();
    bundle.latestResults = {} as any;
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [],
      figure_specs: []
    };
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      })),
      figures: [
        {
          caption: "Objective metric not met: metrics.tui_full_cycle_consistent_success_count=0 does not satisfy >= 1.",
          bars: [{ label: "breast_cancer", value: 0 }]
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

    expect(manuscript.manuscript.figures?.[0]?.caption).toBe(
      "Dataset-level outcome summary with uncertainty-aware interpretation retained in the main paper."
    );
    expect(manuscript.consistency_lint.issues.some((issue) => issue.kind === "caption_internal_name")).toBe(false);
  });

  it("preserves authored main-paper visuals so manuscript-quality repair can inspect them later", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      })),
      tables: [
        {
          caption: "Exact numeric comparison for revision stability.",
          rows: [
            { label: "Stateless baseline", value: 0.71 },
            { label: "Thread-backed drafting", value: 0.76 }
          ],
          source_refs: [{ kind: "artifact", id: AUTHORED_MAIN_TABLE_SOURCE_REF_ID }]
        }
      ],
      figures: [
        {
          caption: "A redundant authored figure that still needs manuscript-level review.",
          bars: [
            { label: "Stateless baseline", value: 0.71 },
            { label: "Thread-backed drafting", value: 0.76 }
          ],
          source_refs: [{ kind: "artifact", id: AUTHORED_MAIN_FIGURE_SOURCE_REF_ID }]
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

    expect(manuscript.manuscript.tables?.[0]?.caption).toBe("Exact numeric comparison for revision stability.");
    expect(manuscript.manuscript.figures?.[0]?.caption).toBe(
      "A redundant authored figure that still needs manuscript-level review."
    );
    expect(manuscript.manuscript.figures?.length).toBe(1);
  });

  it("still prunes redundant unmarked figures that originate from automatic fallback visuals", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      })),
      tables: [
        {
          caption: "Selected reported metrics from the structured results analysis.",
          rows: [
            { label: "Accuracy", value: 0.91 },
            { label: "Replication Success Rate", value: 0.94 },
            { label: "F1", value: 0.88 }
          ]
        }
      ],
      figures: [
        {
          caption: "Objective metric met: accuracy=0.91 >= 0.9.",
          bars: [
            { label: "Accuracy", value: 0.91 },
            { label: "Replication Success Rate", value: 0.94 },
            { label: "F1", value: 0.88 }
          ]
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

    expect(manuscript.manuscript.tables?.length).toBe(1);
    expect(manuscript.manuscript.figures?.length || 0).toBe(0);
  });

  it("downgrades numeric_inconsistency to warning when values differ by >50% (likely metric-key mismatch)", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    // Manuscript quotes a Brier score value (0.08) while structured results only have macro_f1 (0.026).
    // With bad metric_key assignment, both get key "macro_f1_delta_vs_logreg" and get compared.
    // The >50% delta heuristic should downgrade from error to warning.
    const candidate: PaperManuscript = {
      title: "Repeated Tabular Benchmark",
      abstract: "The overall macro-F1 delta is 0.026.",
      keywords: ["tabular"],
      sections: [
        { heading: "Introduction", paragraphs: ["This benchmark studies repeated tabular evaluation."] },
        { heading: "Method", paragraphs: ["We evaluate 2 datasets with outer 5-fold CV and inner 3-fold tuning."] },
        {
          heading: "Results",
          paragraphs: [
            "The observed macro_f1_delta_vs_logreg is 0.026 on the strongest workflow.",
            "The Brier score macro_f1_delta_vs_logreg was 0.0008 for the calibrated model."
          ]
        },
        { heading: "Conclusion", paragraphs: ["The aggregate result remains modest."] }
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

    const inconsistencyIssues = manuscript.consistency_lint.issues.filter(
      (issue) => issue.kind === "numeric_inconsistency"
    );
    // The 0.0008 vs 0.026 comparison (>50% delta) should be warning, not error
    const errorIssues = inconsistencyIssues.filter((i) => i.severity === "error");
    const warningIssues = inconsistencyIssues.filter((i) => i.severity === "warning");
    // If any comparison triggers, the large-delta ones should be warnings
    if (inconsistencyIssues.length > 0) {
      const largeGapIssues = inconsistencyIssues.filter(
        (i) => i.message.includes("0.0008") || i.message.includes("0.026")
      );
      for (const issue of largeGapIssues) {
        // 0.0008 vs 0.026 differ by >50%, so should be downgraded
        if (issue.message.includes("0.0008")) {
          expect(issue.severity).toBe("warning");
        }
      }
    }
  });

  it("does not flag CI bounds reported consistently across sections as a contradiction", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    // Simulate the real false-positive scenario: Abstract and Results both
    // report the same mean and CI interval, but the drift checker was
    // treating the CI lower and upper bounds as two distinct "conflicting"
    // values for the same metric key.
    const candidate: PaperManuscript = {
      title: "Calibration Benchmark",
      abstract:
        "The best overall configuration achieves mean macro-F1 0.790455 " +
        "with a 95% confidence interval from 0.757351 to 0.819898.",
      keywords: ["calibration"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study calibration effects on tabular classification."] },
        { heading: "Method", paragraphs: ["We evaluate 5 datasets with repeated nested 5x3 CV."] },
        {
          heading: "Results",
          paragraphs: [
            "The best aggregate configuration is sigmoid-calibrated RBF-SVM. " +
            "Its mean macro-F1 is 0.790455, and the benchmark summary reports " +
            "a 95% interval from 0.757351 to 0.819898 for that configuration."
          ]
        },
        { heading: "Conclusion", paragraphs: ["Calibration consistently improves ranking stability."] }
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

    // CI bound values (0.757351, 0.819898) must NOT produce a blocking error
    // when the same interval appears identically in Abstract and Results.
    const blockingErrors = manuscript.consistency_lint.issues.filter(
      (issue) =>
        issue.kind === "numeric_inconsistency" &&
        issue.severity === "error" &&
        (issue.normalized_facts || []).some(
          (f) => f.unit === "ci_lower" || f.unit === "ci_upper"
        )
    );
    expect(blockingErrors).toHaveLength(0);
  });

  it("LV-016: comma-separated numbers (e.g. 20,789) are not split into phantom matches", () => {
    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    // Manuscript text mentions "20,789 tokens" — previously the regex split
    // this into "20" and "789", and "789" was close enough to runtime_seconds
    // (828.56) to produce a blocking "contradiction" error.
    const candidate: PaperManuscript = {
      title: "Token Count Study",
      abstract: "The adaptive condition generated 20,789 tokens total.",
      keywords: ["test-time compute"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study adaptive inference."] },
        { heading: "Method", paragraphs: ["We evaluate 2 datasets with outer 5-fold CV and inner 3-fold tuning."] },
        {
          heading: "Results",
          paragraphs: [
            "The adaptive condition generated 20,789 tokens in total, " +
            "while the baseline generated 19,002 tokens. " +
            "Average latency rose from 736.84 ms to 828.56 ms."
          ]
        },
        { heading: "Conclusion", paragraphs: ["Token savings remain modest."] }
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

    // "789" must NOT appear as a standalone extracted numeric fact
    const phantomFact = manuscript.consistency_lint.issues.find(
      (issue) =>
        issue.kind === "numeric_inconsistency" &&
        (issue.normalized_facts || []).some((f) => f.value === 789)
    );
    expect(phantomFact).toBeUndefined();

    // "20789" (the correct parsed value) should not produce a blocking error either
    const blockingFromComma = manuscript.consistency_lint.issues.filter(
      (issue) =>
        issue.kind === "numeric_inconsistency" &&
        issue.severity === "error" &&
        (issue.normalized_facts || []).some((f) => f.value === 20789 || f.value === 19002)
    );
    expect(blockingFromComma).toHaveLength(0);
  });
});
