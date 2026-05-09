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
  experimentArtifactLoader,
  materializeScientificManuscript,
  pageBudgetManager,
  resolvePaperProfile,
  strengthenPaperScaleManuscript
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
  estimated_words_per_page: 650
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
    expect(profile.estimated_words_per_page).toBe(650);
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
    expect(report.target_main_words).toBe(6500);
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
    const relatedText = manuscript.manuscript.sections.find((section) => section.heading === "Related Work")?.paragraphs.join(" ") || "";
    expect(relatedText).toContain("Nested Validation for Tabular Baselines");
    expect(relatedText).toContain("CPU-Only Tree Baselines");
    expect(relatedText).toMatch(/positioning anchors rather than direct condition-matched baselines/i);
    const conclusionText = manuscript.manuscript.sections.find((section) => section.heading === "Conclusion")?.paragraphs.join(" ") || "";
    expect(conclusionText).toMatch(/Brief execution-coverage and supplementary-metric summaries/i);
    expect(conclusionText).not.toMatch(/Detailed protocol and repeat-level evidence/i);
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

  it("uses LM benchmark evidence instead of tabular CV requirements when latest_results is absent", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout repeated-seed benchmark";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = undefined as any;
    bundle.experimentPlan = {
      selectedTitle: "5-seed high-rank dropout stability against locked baseline",
      selectedSummary: "Compare repeated LoRA rank/dropout cells on ARC-Challenge and HellaSwag.",
      rawText: [
        "selected_design:",
        '  title: "5-seed high-rank dropout stability against locked baseline"',
        "  datasets:",
        '    - "Alpaca Clean subset"',
        '    - "ARC-Challenge"',
        '    - "HellaSwag"',
        "  metrics:",
        '    - "average_accuracy"',
        '    - "accuracy_delta_vs_baseline"',
        '    - "arc_challenge_accuracy"',
        '    - "hellaswag_accuracy"',
        "  baselines:",
        '    - "rank=8 dropout=0.0 locked baseline"',
        "  implementation_notes:",
        '    - "Use Qwen/Qwen2.5-1.5B as the base model with LoRA adapters."',
        '    - "Hold optimizer, token budget, data order, and evaluation harness constant."',
        '    - "Training dataset is Alpaca Clean with max_train_samples=10000 examples."',
        "  evaluation_steps:",
        '    - "Execute 25 train-plus-eval runs total across repeated seeded rank/dropout cells."',
        '    - "Use training seeds [42,43,44,45,46] and report failed runs."',
        "  resource_notes:",
        '    - "Hyperparameter grid covers LoRA rank and dropout."'
      ].join("\n")
    };
    bundle.relatedWorkNotes = [
      {
        paper_id: "qlora",
        title: "QLoRA: Efficient Finetuning of Quantized LLMs",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "adapter fine-tuning",
        problem_focus: "LoRA-based fine-tuning of language models.",
        setting_focus: "LLM adaptation.",
        contribution_focus: "Quantized LLM fine-tuning with LoRA adapters.",
        limitation_or_caveat: "Not a rank/dropout repeated-seed audit.",
        relation_to_study: "Provides a nearby comparison point for the current study objective.",
        year: 2023
      },
      {
        paper_id: "maple",
        title: "MAPLE: Multilingual Evaluation of Parameter Efficient Finetuning",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "evaluation and benchmarking",
        problem_focus: "PEFT benchmark design for language models.",
        setting_focus: "Benchmark evaluation.",
        contribution_focus: "Evaluation breadth for PEFT.",
        limitation_or_caveat: "Different task mix.",
        relation_to_study: "Supports positioning of benchmark scope.",
        year: 2024
      },
      {
        paper_id: "vblora",
        title: "VB-LoRA",
        source_type: "analyzed_paper",
        comparison_role: "background",
        method_family: "alternative parameterization",
        problem_focus: "Parameter-efficient LoRA variants.",
        setting_focus: "LLM adaptation.",
        contribution_focus: "Alternative adapter parameterization.",
        limitation_or_caveat: "Not the same locked-baseline audit.",
        relation_to_study: "Background for rank-sensitive adapter choices.",
        year: 2024
      }
    ];
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "accuracy_delta_vs_baseline", value: 0.0448 },
        { key: "arc_challenge_accuracy", value: 0.6417 },
        { key: "hellaswag_accuracy", value: 0.3133 },
        { key: "average_accuracy", value: 0.4775 },
        { key: "run_accuracy_delta_vs_baseline_std", value: 0.0748 },
        { key: "run_accuracy_delta_vs_baseline_ci95", value: 0.0293 },
        { key: "wall_clock_runtime_s", value: 244.2 },
        { key: "peak_vram_bytes_mean", value: 4946062049 },
        { key: "completed_run_count", value: 25 }
      ],
      condition_comparisons: [
        {
          id: "rank32_drop005_vs_baseline",
          label: "rank 32 dropout 0.05 vs rank 8 dropout 0.0",
          source: "metrics.condition_summaries",
          summary: "Rank 32 dropout 0.05 improves average accuracy relative to the locked baseline.",
          metrics: [{ key: "accuracy_delta_vs_baseline_mean", value: 0.0667 }]
        }
      ],
      statistical_summary: {
        total_trials: 25,
        executed_trials: 25,
        cached_trials: 0,
        confidence_intervals: [
          {
            metric_key: "accuracy_delta_vs_baseline",
            label: "Accuracy delta",
            lower: 0.0155,
            upper: 0.0741,
            level: 0.95,
            source: "metrics",
            summary: "The repeated-seed 95% interval for the accuracy delta remains positive."
          }
        ],
        stability_metrics: [{ key: "run_accuracy_delta_vs_baseline_std", value: 0.0748 }],
        effect_estimates: [
          {
            comparison_id: "rank32_drop005_vs_baseline",
            metric_key: "accuracy_delta_vs_baseline",
            delta: 0.0667,
            direction: "positive",
            summary: "The best nonbaseline cell has a positive mean delta."
          }
        ],
        notes: ["Seed-level dispersion is reported across the repeated benchmark runs."]
      },
      figure_specs: [
        {
          id: "performance",
          title: "LoRA benchmark performance",
          path: "figures/performance.svg",
          metric_keys: ["accuracy_delta_vs_baseline"],
          summary: "Repeated-seed LoRA benchmark comparison with task accuracies."
        }
      ],
      primary_findings: [
        "All 25 planned runs executed.",
        "The best nonbaseline cell shows a positive directional accuracy delta."
      ],
      limitations: ["The small LLM preflight does not establish a general stability law."],
      synthesis: {
        source: "fallback",
        discussion_points: ["The evidence supports a narrow benchmark signal, not a universal LoRA prescription."],
        failure_analysis: [],
        follow_up_actions: [],
        confidence_statement: "Confidence is moderate because repeated runs and intervals are available."
      }
    } as any;

    const context = experimentArtifactLoader({ bundle });
    expect(context.protocol_kind).toBe("lm_benchmark");

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });

    expect(scientific.method_completeness.status).toBe("complete");
    expect(scientific.method_completeness.present).toContain("model/backbone");
    expect(scientific.method_completeness.missing).not.toContain("#classes");
    expect(scientific.method_completeness.missing).not.toContain("outer folds");
    expect(scientific.results_richness.status).toBe("complete");
    expect(scientific.related_work_richness.status).toBe("complete");
  });

  it("sanitizes reader-facing manuscript prose and promotes executed method details from run artifacts", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout repeated-seed benchmark";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.experimentPlan = {
      selectedTitle: "5-seed high-rank dropout stability against locked baseline",
      selectedSummary: "Compare repeated LoRA rank/dropout cells on ARC-Challenge and HellaSwag.",
      rawText: [
        "selected_design:",
        '  title: "5-seed high-rank dropout stability against locked baseline"',
        "  datasets:",
        '    - "Alpaca Clean subset"',
        '    - "ARC-Challenge"',
        '    - "HellaSwag"',
        "  implementation_notes:",
        '    - "Use Qwen/Qwen2.5-1.5B as the base model with LoRA adapters."',
        '    - "Hold optimizer, token budget, data order, and evaluation harness constant."',
        "  evaluation_steps:",
        '    - "Use training seeds [42,43,44,45,46] and report failed runs."'
      ].join("\n")
    };
    bundle.latestResults = {
      selected_model: "Qwen/Qwen2.5-1.5B",
      condition_summaries: [
        {
          condition_marker: "rank_32_dropout_0_05",
          seed_results: [
            {
              train_metadata: {
                model_name: "Qwen/Qwen2.5-1.5B",
                selected_target_modules: ["q_proj", "k_proj", "v_proj", "o_proj"],
                num_train_samples: 32,
                train_dataset_token_count: 5068,
                trainer_state: {
                  learning_rate: 0.0002,
                  per_device_train_batch_size: 1,
                  gradient_accumulation_steps: 4,
                  weight_decay: 0,
                  max_grad_norm: 1,
                  optimizer_steps: 6
                }
              }
            }
          ]
        }
      ]
    };

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated-Seed LoRA Dropout Benchmark",
      abstract: "The study-level average-accuracy improvement was 0.04479166666666667, and the strongest exposed comparison was rank 32 with dropout 0.05, with mean delta 0.0667.",
      keywords: ["LoRA", "instruction tuning"],
      sections: [
        {
          heading: "Introduction",
          paragraphs: [
            "QLoRA [doi:10.48550/arxiv.2305.14314] motivates memory-aware adaptation, and adapter variants [15a1c2d8eb2c55e3ceb9ce9f72b3446ac1eb183a] motivate careful comparison.",
            "The emphasis on benchmark accuracy rather than judge-based preference scoring is also compatible with prior warnings that chatbot evaluation can be noisy and order sensitive.",
            "The first P6 run uses a cached, locally runnable small LLM target so the validation focuses on real training, result-table integrity, review gating, and paper-readiness audit rather than on new model access. Objective metric met: accuracy_delta_vs_baseline=0.04479166666666667 >= 0.01."
          ]
        },
        {
          heading: "Related Work",
          paragraphs: [
            "QLoRA is the closest prior reference because it links LoRA adaptation to local feasibility, but QLoRA is repeated here mostly as a self-positioning anchor.",
            "Because several of these latter sources are available only through partial extraction in the present evidence base, they are used here for framing rather than detailed quantitative comparison."
          ]
        },
        {
          heading: "Method",
          paragraphs: [
            "This narrowing follows the same resource-conscious logic emphasized in prior PEFT work, where fixed memory and runtime budgets make selective comparison preferable to shallow coverage of every configuration.",
            "The protocol compares high-rank LoRA conditions under fixed data order.",
            "Training used an Alpaca Clean subset capped at 10,000 examples.",
            "The implementation notes indicate that optimizer settings and LoRA target modules were held constant, although the compact study summary does not surface their exact numeric values in the manuscript-facing record.",
            "To isolate rank and dropout as much as the budget allowed, the protocol held the optimizer, learning-rate schedule, LoRA target modules, effective batch size, token budget, and capped training set constant across cells."
          ]
        },
        {
          heading: "Results",
          paragraphs: [
            "The rank 32 dropout 0.05 condition has the strongest exposed mean delta. Direct supporting evidence is currently limited",
            "The same aggregate comparison remains narrow; direct supporting evidence is currently limited",
            "Optimization and efficiency evidence is present but incomplete in the compact release.",
            "The compact results summary does not expose condition-level runtime or memory aggregates.",
            "Accordingly, the Results section limits its quantitative interpretation rather than inferring finer-grained per-task or compute trade-offs from tables that are not shown."
          ]
        },
        {
          heading: "Discussion",
          paragraphs: [
            "The compact release foregrounds mean deltas and selected confidence intervals more clearly than variance-ratio summaries or CI-width ratios."
          ]
        },
        {
          heading: "Conclusion",
          paragraphs: [
            "Within the released summary of this fixed-budget local benchmark, the study supports a cautious preflight conclusion.",
            "The main outcome is therefore twofold: a limited but encouraging empirical signal for high-rank moderate-dropout tuning in this setting, and a practical benchmark template for later larger-scale experiments."
          ]
        }
      ]
    };

    const result = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });
    const manuscript = result.manuscript;

    const allText = [
      manuscript.abstract,
      ...manuscript.sections.flatMap((section) => section.paragraphs)
    ].join(" ");
    const methodText = manuscript.sections.find((section) => section.heading === "Method")?.paragraphs.join(" ") || "";
    const relatedText = manuscript.sections.find((section) => section.heading === "Related Work")?.paragraphs.join(" ") || "";
    expect(allText).not.toMatch(/doi:|15a1c2d8eb2c55e3ceb9ce9f72b3446ac1eb183a/);
    expect(allText).not.toMatch(/arXiv:\d{4}\.\d{4,5}/i);
    expect(allText).not.toMatch(/direct supporting evidence is currently limited/i);
    expect(allText).not.toMatch(/present evidence base|compact release|released summary|reader-visible paper|prior warnings|prior PEFT work|P6 run|review gating|paper-readiness audit|Objective metric met/i);
    expect(allText).not.toMatch(/compact results summary|compact artifact record|compact report|compact summary|compact bundle|manuscript-process/i);
    expect(allText).not.toMatch(/tables that are not shown/i);
    expect(allText).not.toMatch(/practical benchmark template/i);
    expect(allText).toMatch(/evaluator-noise variable/i);
    expect(allText).toMatch(/reported analyses foreground/i);
    expect(allText).toMatch(/available records do not support condition-level runtime or memory efficiency rankings/i);
    expect(allText).toMatch(/scoped protocol illustration/i);
    expect(relatedText).toMatch(/memory-efficiency axis/i);
    expect(relatedText).toMatch(/evaluation-axis/i);
    expect(relatedText).toMatch(/mechanism axis/i);
    expect(relatedText).not.toMatch(/closest prior reference because.*closest prior reference because/i);
    expect(methodText).toMatch(/Qwen\/Qwen2\.5-1\.5B/);
    expect(methodText).toMatch(/learning rate 0\.0002/);
    expect(methodText).toMatch(/gradient accumulation 4/);
    expect(methodText).toMatch(/optimizer steps/);
    expect(methodText).toMatch(/budget ceiling rather than as the number consumed by every run/);
    expect(methodText).toMatch(/preserved artifacts do not independently verify identical consumed token counts/i);
    expect(methodText).not.toMatch(/executable run metadata|released study summary|released comparison table|run metadata records/i);
    expect(methodText).not.toMatch(/token budget,\s*and capped training set constant across cells/i);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          ["numeric_inconsistency", "numeric_unverifiable"].includes(issue.kind)
          && /percentage point|training examples|train dataset tokens|training-token count|data budget/i.test(JSON.stringify(issue.normalized_facts || []))
      )
    ).toHaveLength(0);
    expect(methodText).not.toMatch(/5068 train dataset tokens|5068 dataset tokens/i);
    expect(methodText).toMatch(/training-token count of 5068/i);
  });

  it("prefers the deterministic condition-level table and preserves condition figures for paper render audit", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout repeated-seed benchmark";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      baseline_marker: "rank_8_dropout_0_0",
      condition_summaries: [
        {
          condition_marker: "rank_8_dropout_0_0",
          lora_rank: 8,
          lora_dropout: 0,
          completed_seed_count: 5,
          average_accuracy_mean: 0.4417,
          accuracy_delta_vs_baseline_mean: 0,
          accuracy_delta_vs_baseline_ci95: 0
        },
        {
          condition_marker: "rank_16_dropout_0_0",
          lora_rank: 16,
          lora_dropout: 0,
          completed_seed_count: 5,
          average_accuracy_mean: 0.4667,
          average_accuracy_ci95: 0.0586,
          accuracy_delta_vs_baseline_mean: 0.025,
          accuracy_delta_vs_baseline_ci95: 0.0841
        },
        {
          condition_marker: "rank_16_dropout_0_05",
          lora_rank: 16,
          lora_dropout: 0.05,
          completed_seed_count: 5,
          average_accuracy_mean: 0.4583,
          average_accuracy_ci95: 0.0542,
          accuracy_delta_vs_baseline_mean: 0.0167,
          accuracy_delta_vs_baseline_ci95: 0.051
        },
        {
          condition_marker: "rank_32_dropout_0_0",
          lora_rank: 32,
          lora_dropout: 0,
          completed_seed_count: 5,
          average_accuracy_mean: 0.5125,
          accuracy_delta_vs_baseline_mean: 0.0708,
          accuracy_delta_vs_baseline_ci95: 0.071
        },
        {
          condition_marker: "rank_32_dropout_0_05",
          lora_rank: 32,
          lora_dropout: 0.05,
          completed_seed_count: 5,
          average_accuracy_mean: 0.5083,
          accuracy_delta_vs_baseline_mean: 0.0667,
          accuracy_delta_vs_baseline_ci95: 0.0638
        }
      ]
    };

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated-Seed LoRA Dropout Benchmark",
      abstract: "A conservative repeated-seed benchmark.",
      keywords: ["LoRA", "instruction tuning"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      })),
      tables: [
        {
          caption: "Key quantitative outcomes.",
          rows: [
            { label: "Conditions analyzed", value: 5 },
            { label: "Study delta", value: 0.0448 }
          ]
        }
      ],
      figures: [
        {
          caption: "Study summary bars.",
          bars: [
            { label: "Accuracy delta vs baseline", value: 0.0448 },
            { label: "Average accuracy", value: 0.4775 }
          ]
        }
      ]
    };
    candidate.sections = candidate.sections.map((section) =>
      section.heading === "Results"
        ? {
            ...section,
            paragraphs: [
              "Mean average accuracy rises from 0.4417 for the locked baseline at rank 8 and dropout 0.0 to 0.4667 for rank 16 with dropout 0.0, 0.4583 for rank 16 with dropout 0.05, 0.5125 for rank 32 with dropout 0.0, and 0.5083 for rank 32 with dropout 0.05.",
              "The absolute mean-accuracy intervals were similarly close for rank 16: [0.4081, 0.5253] without dropout and [0.4125, 0.5209] with dropout 0.05.",
              "The protocol tracked runtime, training loss, and peak memory, and the full 25-run workload completed under the workstation budget with planned parallelism.",
              ...section.paragraphs
            ]
          }
        : section.heading === "Related Work"
          ? {
              ...section,
              paragraphs: [
                "Adapter-variant studies instead modify the adapter mechanism itself, so their gains speak more directly to alternative PEFT parameterizations than to whether standard LoRA at rank 16 or 32 benefits from modest dropout in a local preflight.",
                "QLoRA shows memory-efficient adaptation (QLoRA, arXiv:2305.14314), while MAPLE compares broader PEFT settings (MAPLE, arXiv:2403.14608).",
                ...section.paragraphs
              ]
            }
        : section
    );

    const result = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });
    const manuscript = result.manuscript;

    expect(manuscript.tables?.[0]?.caption).toMatch(/Condition-level mean accuracy/i);
    expect(manuscript.tables?.[0]?.rows).toHaveLength(5);
    expect(manuscript.tables?.[0]?.rows.map((row) => row.label).join(" ")).toMatch(/rank 32 \/ dropout 0\.05/);
    expect(manuscript.tables?.[0]?.rows.map((row) => row.label).join(" ")).toMatch(/n=5/);
    expect(manuscript.tables?.[0]?.rows.map((row) => row.label).join(" ")).not.toMatch(/delta/);
    expect(manuscript.tables?.[0]?.rows.map((row) => row.label).join(" ")).not.toMatch(/Conditions analyzed/);
    expect(manuscript.figures?.length ?? 0).toBeGreaterThan(0);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && issue.severity === "error"
          && (issue.involved_sections || []).some((section) => section.startsWith("Figure"))
      )
    ).toHaveLength(0);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && issue.severity === "error"
          && (issue.involved_sections || []).includes("Results")
          && /0\.4417|0\.4667|0\.4583|0\.5125|0\.5083/.test(issue.message)
      )
    ).toHaveLength(0);
    expect(
      result.consistency_lint.issues.some(
        (issue) =>
          (issue.normalized_facts || []).some(
            (fact) => fact.source === "results" && fact.value === 0.05 && fact.raw_text.includes("dropout 0.05")
          )
      )
    ).toBe(false);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && issue.severity === "error"
          && /0\.4081|0\.5253|0\.4125|0\.5209/.test(issue.message)
      )
    ).toHaveLength(0);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && issue.severity === "error"
          && /peak memory mb/i.test(issue.message)
      )
    ).toHaveLength(0);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          /peak memory mb/i.test(issue.message)
          && /2305\.143|2403\.146/i.test(JSON.stringify(issue.normalized_facts || []))
      )
    ).toHaveLength(0);
    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && issue.severity === "error"
          && /0\.04479|0\.0667/.test(issue.message)
      )
    ).toHaveLength(0);
  });

  it("does not parse comma-separated seed-resampling counts as manuscript repeat counts", () => {
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
      sections: scientific.draft.sections.map((section) =>
        section.heading === "Method"
          ? {
              heading: section.heading,
              paragraphs: [
                "We evaluate 2 datasets with outer 5-fold CV and inner 3-fold tuning.",
                "Uncertainty is summarized with bootstrap intervals over 10,000 seed resamples."
              ]
            }
          : {
              heading: section.heading,
              paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
            }
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

    expect(
      manuscript.consistency_lint.issues.some(
        (issue) =>
          issue.kind === "count_inconsistency"
          && (issue.normalized_facts || []).some(
            (fact) => fact.raw_text === "000 seed" || fact.raw_text === "10,000 seed" || fact.value === 0 || fact.value === 10000
          )
      )
    ).toBe(false);
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

  it("fills an evidence-rich terse draft to the six-page strict-paper floor without LLM repair", () => {
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle: makeRichBundle(),
      profile: {
        ...PAPER_PROFILE,
        target_main_pages: 6,
        minimum_main_pages: 6,
        main_page_limit: 6
      }
    });
    const validation = buildScientificValidationArtifact(scientific);

    expect(scientific.page_budget.status).toBe("ok");
    expect(scientific.page_budget.estimated_main_words).toBeGreaterThanOrEqual(
      scientific.page_budget.minimum_main_words
    );
    expect(validation.issues.some((issue) => issue.code === "page_budget_warning")).toBe(false);
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

  it("does not treat uncertainty summaries as conflicting accuracy-delta means", () => {
    const bundle = makeRichBundle();
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "accuracy_delta_vs_baseline", value: 0.0448 },
        { key: "best_nonbaseline_accuracy_delta_vs_baseline_mean", value: 0.0667 }
      ]
    } as any;
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "LoRA Rank-Dropout Preflight",
      abstract: "The study-level delta relative to baseline was +0.0448.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study a repeated-seed LoRA rank/dropout comparison."] },
        { heading: "Method", paragraphs: ["We compare a locked rank-8 dropout-0.0 baseline with higher-rank cells."] },
        {
          heading: "Results",
          paragraphs: [
            "The strongest cell achieved a mean accuracy delta of +0.0667, or 6.67 percentage points. Its maximum observed seed-level delta was +0.1667 and its minimum was -0.0208, while the reported standard deviation was 0.0728 and the standard error was 0.0325."
          ]
        },
        { heading: "Conclusion", paragraphs: ["The result supports a narrow follow-up candidate."] }
      ]
    };
    const result = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    const blockingUncertaintyErrors = result.consistency_lint.issues.filter(
      (issue) =>
        issue.kind === "numeric_inconsistency"
        && issue.severity === "error"
        && /0\.0728|0\.0325/.test(JSON.stringify(issue.normalized_facts || []))
    );
    expect(blockingUncertaintyErrors).toHaveLength(0);
  });

  it("does not headline the study-level objective check as a conflicting condition delta", () => {
    const bundle = makeRichBundle();
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "accuracy_delta_vs_baseline", value: 0.04479166666666667 },
        { key: "best_nonbaseline_accuracy_delta_vs_baseline_mean", value: 0.0667 }
      ]
    } as any;
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "LoRA Rank-Dropout Preflight",
      abstract:
        "The study-level objective was met: the available summary reports accuracy_delta_vs_baseline = 0.0448. The strongest summarized condition was rank 32 with dropout 0.05, with a mean delta of 0.0667.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study a repeated-seed LoRA rank/dropout comparison."] },
        { heading: "Method", paragraphs: ["We compare a locked rank-8 dropout-0.0 baseline with higher-rank cells."] },
        {
          heading: "Results",
          paragraphs: [
            "At the study level, the primary metric was accuracy_delta_vs_baseline = 0.04479166666666667, which exceeded the predeclared target of 0.01.",
            "The strongest cell achieved a mean accuracy delta of +0.0667, or 6.67 percentage points."
          ]
        },
        { heading: "Conclusion", paragraphs: ["The result supports a narrow follow-up candidate."] }
      ]
    };
    const result = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    const blockingDeltaErrors = result.consistency_lint.issues.filter(
      (issue) =>
        issue.kind === "numeric_inconsistency"
        && issue.severity === "error"
        && /0\.0448|0\.0667/.test(JSON.stringify(issue.normalized_facts || []))
    );
    expect(blockingDeltaErrors).toHaveLength(0);
    expect(result.manuscript.abstract).not.toContain("accuracy_delta_vs_baseline = 0.0448");
  });

  it("can re-apply evidence-grounded paper-scale strengthening after manuscript repair", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout repeated-seed benchmark";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      baseline_marker: "rank_8_dropout_0_0",
      condition_summaries: [
        {
          condition_marker: "rank_8_dropout_0_0",
          lora_rank: 8,
          lora_dropout: 0,
          completed_seed_count: 5,
          average_accuracy_mean: 0.4417,
          accuracy_delta_vs_baseline_mean: 0
        },
        {
          condition_marker: "rank_32_dropout_0_05",
          lora_rank: 32,
          lora_dropout: 0.05,
          completed_seed_count: 5,
          average_accuracy_mean: 0.5084,
          accuracy_delta_vs_baseline_mean: 0.0667
        }
      ]
    } as any;
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "accuracy_delta_vs_baseline", value: 0.0448 },
        { key: "completed_run_count", value: 25 }
      ],
      statistical_summary: {
        effect_estimates: [
          {
            comparison_id: "rank32_drop005_vs_baseline",
            metric_key: "accuracy_delta_vs_baseline",
            delta: 0.0667,
            direction: "positive",
            summary: "The best nonbaseline cell has a positive mean delta."
          }
        ],
        notes: ["Seed-level dispersion remains visible."]
      },
      synthesis: {
        discussion_points: ["The evidence supports a narrow benchmark signal, not a universal LoRA prescription."],
        failure_analysis: [],
        follow_up_actions: ["Carry rank 32 dropout 0.05 into a larger scale-up."],
        confidence_statement: "Confidence is moderate."
      },
      limitations: ["The small LLM preflight does not establish a general stability law."]
    } as any;
    const context = experimentArtifactLoader({ bundle });
    const repaired: PaperManuscript = {
      title: "Repeated-Seed LoRA Dropout Benchmark",
      abstract: "The study-level delta relative to baseline was +0.0448.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study LoRA rank and dropout under a fixed local budget."] },
        { heading: "Related Work", paragraphs: ["QLoRA and PEFT benchmarks motivate the local adapter question."] },
        { heading: "Method", paragraphs: ["The protocol uses a rank-8 no-dropout baseline and a higher-rank comparison."] },
        { heading: "Results", paragraphs: ["The rank 32 dropout 0.05 cell had the strongest mean delta."] },
        { heading: "Discussion", paragraphs: ["The result is a follow-up signal rather than a broad conclusion."] },
        { heading: "Limitations", paragraphs: ["The study is a small-backbone preflight."] },
        { heading: "Conclusion", paragraphs: ["The strongest cell merits follow-up."] }
      ]
    };

    const strengthened = strengthenPaperScaleManuscript(repaired, context);
    const resultsWords = strengthened.sections
      .find((section) => section.heading === "Results")
      ?.paragraphs.join(" ").split(/\s+/u).length || 0;

    expect(resultsWords).toBeGreaterThan(150);
    expect(strengthened.sections.find((section) => section.heading === "Limitations")?.paragraphs.length).toBeGreaterThan(1);
  });

  it("sanitizes reader-facing manuscript residue that blocks final manuscript-quality review", () => {
    const context = experimentArtifactLoader({ bundle: makeRichBundle() });
    const manuscript: PaperManuscript = {
      title: "Repeated-Seed Evaluation",
      abstract: "A short abstract.",
      keywords: ["lora"],
      sections: [
        {
          heading: "Method",
          paragraphs: [
            "The preserved manuscript bundle identifies the executed study only as a small-backbone local preflight and does not cleanly disambiguate whether the as-run model was the planned Qwen/Qwen2.5-1.5B backbone or the TinyLlama/TinyLlama-1.1B-Chat-v1.0 fallback.",
            "The preferred backbone was Qwen/Qwen2.5-1.5B [Qwen2.5], with TinyLlama/TinyLlama-1.1B-Chat-v1.0 [TinyLlama] reserved as a fallback. Supervised instruction tuning used an Alpaca Clean subset capped at 10,000 examples [Alpaca Clean]. Evaluation used ARC-Challenge and HellaSwag [ARC-Challenge; HellaSwag].",
            "The fixed search space includes LoRA target modules were q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, and down_proj., Fixed training settings included learning rate 0.0002, per-device train batch size 1, gradient accumulation 4, weight decay 0, max gradient norm 1, and 6 optimizer steps., and The inspected seed-level record reports 32 training examples and 5068 train dataset tokens for the inspected seed-level record."
          ]
        },
        {
          heading: "Limitations",
          paragraphs: [
            "condition summaries / rank 16 dropout 0 0 / accuracy delta vs baseline 95% CI [-0.0591, 0.1091] over n=5."
          ]
        },
        {
          heading: "Discussion",
          paragraphs: [
            "The first P6 run uses a cached, locally runnable small LLM target so the validation focuses on real training, result-table integrity, review gating, and paper-readiness audit rather than on new model access."
          ]
        },
        {
          heading: "Results",
          paragraphs: [
            "raw result study summary run train loss std=0.1064. raw result study summary run runtime sec variance=0.0603. raw result study summary run peak vram bytes variance=271517912275551970.",
            "Objective metric met: accuracy_delta_vs_baseline=0.04479166666666667 >= 0.01."
          ]
        },
        {
          heading: "Conclusion",
          paragraphs: [
            "This repeated-seed preflight provides conservative evidence that higher-rank LoRA with moderate dropout can be competitive under a strict local instruction-tuning budget.",
            "Brief execution-coverage and supplementary-metric summaries are routed to the appendix, while the main paper carries the central interpretation.",
            "The audit trail matters for this interpretation because the paper-ready claim depends on alignment between executed runs, result tables, captions, and the claim-evidence map. If a later run changes the baseline, hides failed executions, or moves numeric support out of the main table, the same text should be downgraded rather than reused as a stronger manuscript."
          ]
        }
      ]
    };

    const strengthened = strengthenPaperScaleManuscript(manuscript, context);
    const text = strengthened.sections.flatMap((section) => section.paragraphs).join(" ");

    expect(text).toContain("Qwen/Qwen2.5-1.5B as the selected small-backbone model");
    expect(text).toContain("rank-16, dropout-0.0 condition");
    expect(text).toContain("best observed higher-rank LoRA cell is worth testing");
    expect(text).toContain("local small-model preflight");
    expect(text).toContain("secondary diagnostics rather than as a condition-level efficiency ranking");
    expect(text).toContain("main text carries the central interpretation");
    expect(text).toContain("condition-level values in Table 1 provide the main numeric support");
    expect(text).toContain("One inspected seed-level record reports 32 training examples");
    expect(text).toContain("Future extensions should re-check that alignment");
    expect(text).not.toMatch(/manuscript bundle|manuscript-facing bundle|condition summaries \//i);
    expect(text).not.toMatch(/can be competitive under a strict local instruction-tuning budget/i);
    expect(text).not.toMatch(/\[(?:Qwen2?\.?5?|TinyLlama|Alpaca Clean|ARC-Challenge|HellaSwag)/i);
    expect(text).not.toMatch(/Objective metric met|includes LoRA target modules were|for the inspected seed-level record|paper-ready claim/i);
    expect(text).not.toMatch(/P6 run|review gating|paper-readiness audit|raw result study summary|routed to the appendix/i);
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
