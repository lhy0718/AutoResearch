import { describe, expect, it } from "vitest";

import { choosePaperTitle, sanitizePaperNarrativeText, type PaperDraft, type PaperWritingBundle } from "../src/core/analysis/paperWriting.js";
import {
  AUTHORED_MAIN_FIGURE_SOURCE_REF_ID,
  AUTHORED_MAIN_TABLE_SOURCE_REF_ID,
  type PaperManuscript
} from "../src/core/analysis/paperManuscript.js";
import {
  applyScientificWritingPolicy,
  buildScientificValidationArtifact,
  buildWritePaperGateDecision,
  enforceManuscriptPageBudgetFloor,
  experimentArtifactLoader,
  materializeScientificManuscript,
  methodCompletenessValidator,
  pageBudgetManager,
  resolvePaperProfile,
  resultsRichnessValidator,
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
  it("removes paper-writing payload and unsupported repeated-seed phrasing from reader-facing prose", () => {
    const cleaned = sanitizePaperNarrativeText(
      "Because the executed model identifier is not exposed in the writing payload, the paper-writing payload exposes only one explicit condition-to-baseline comparison and a set of per-condition confidence intervals, not the full numeric table for every cell. The present payload cannot establish robustness. The payload also contains an internal inconsistency. The repeated-seed design is therefore used as a screening instrument. The main report marks the objective as met, with accuracy_delta_vs_baseline=0.083332 against the >= 0.01 target, and verifier feedback status is pass. rank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline by 0.0833. The surviving preflight materials do not unambiguously identify the backbone actually used in the analyzed execution, so the manuscript can report only the registered preferred and fallback options rather than a confirmed executed model. The surviving compact record specifies the manipulated rank/dropout factors and reported outcome metrics, but optimizer choice, learning rate, batch size, update count, prompt formatting, evaluation-harness specifics, and exact placement of dropout within LoRA modules are not available. We therefore interpret the experiment as a governed preflight rather than as a fully reproducible benchmark recipe. For a small language-model preflight, the strongest defensible use of the result is triage: it nominates a configuration worth retesting under larger data or broader tasks, but it does not establish a general adapter rule. Consistent with prior compute-constrained LoRA work and with the generalizability limits already noted in nearby resource-constrained studies, the conclusion remains narrow. Seed coverage is part of the evidence contract. The five repeated cells and five seeds per cell expose whether the observed mean gain is stable enough to motivate a larger run. The manuscript does not collapse this structure into a single best seed, and it keeps the baseline row visible so that later readers can audit the comparison unit. Hidden failures would invalidate this ceiling, but the run accounting used here reports scheduled and executed trials explicitly. That reading is consistent with prior PEFT work such as QLoRA and neighboring low-budget adaptation studies. QLoRA-scale efficiency work and broader benchmark papers such as MAPLE both suggest caution."
    );

    expect(cleaned).not.toMatch(/\b(?:writing payload|paper-writing payload|present payload|The payload|repeated-seed design|verifier feedback status|five repeated cells|five seeds per cell|unambiguously identify|optimizer choice|evidence contract|audit|Hidden failures|QLoRA|MAPLE)\b/i);
    expect(cleaned).toContain("not available in the reported summary");
    expect(cleaned).toContain("visible table preserves the condition-level reporting unit");
    expect(cleaned).toContain("reported interval summaries are therefore used as a screening instrument");
    expect(cleaned).toContain("positive screening result");
    expect(cleaned).toContain("Qwen/Qwen2.5-1.5B as the selected backbone");
    expect(cleaned).toContain("learning rate 0.0002");
    expect(cleaned).toContain("multi-seed replication as future work");
    expect(cleaned).toContain("Given the present run's generalizability limits");
  });

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
    expect(conclusionText).toMatch(/keeps execution coverage and supplementary metrics secondary/i);
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

  it("keeps related-work expansion from turning raw abstracts, authors, or metric bullets into prose", () => {
    const bundle = makeRichBundle();
    bundle.experimentPlan = {
      ...(bundle.experimentPlan || {}),
      selectedTitle: "LoRA rank and dropout under fixed budget instruction tuning",
      selectedSummary: "Compare LoRA rank and dropout cells on ARC-Challenge and HellaSwag with a Qwen instruction-tuning backbone.",
      rawText: [
        "selected_design:",
        '  title: "LoRA rank and dropout under fixed budget instruction tuning"',
        '  model: "Qwen/Qwen2.5-1.5B"',
        '  method: "LoRA PEFT instruction tuning"',
        "  datasets:",
        '    - "ARC-Challenge"',
        '    - "HellaSwag"'
      ].join("\n")
    };
    bundle.objectiveMetric = [
      "- Primary metric: average accuracy across ARC-Challenge and HellaSwag.",
      "- Secondary metrics: per-task accuracy, train loss, wall-clock runtime.",
      "- Meaningful improvement: at least +1.0 percentage point."
    ].join(" ");
    bundle.relatedWorkNotes = [
      {
        paper_id: "paper_1",
        title: "Chain-of-LoRA: Enhancing Instruction Fine-Tuning",
        source_type: "analyzed_paper",
        comparison_role: "closest",
        method_family: "prompting and control",
        problem_focus:
          "Recently, large language models with conversational-style interaction, such as ChatGPT and Claude, have gained significant importance in the advancement of artificial gen...",
        setting_focus: "instruction tuning",
        contribution_focus: "LoRA instruction tuning comparison",
        limitation_or_caveat: "Small empirical scope",
        relation_to_study: "Provides a nearby comparison point."
      },
      {
        paper_id: "paper_2",
        title: "From Base to Conversational: Japanese Instruction Dataset and Tuning Large Language Models",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "prompting and control",
        problem_focus:
          "From Base to Conversational: Japanese Instruction Dataset and Tuning Large Language Models Masahiro Suzuki Masanori Hirano Hiroki Sakaji The University of Tokyo The University o...",
        setting_focus: "instruction tuning",
        contribution_focus: "Instruction dataset construction",
        limitation_or_caveat: "Metadata-only support",
        relation_to_study: "Provides background."
      },
      {
        paper_id: "paper_3",
        title: "Abstract-only fallback for A review on genetic algorithm: past, present, and future",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "literature discovery and retrieval",
        problem_focus: "This paper proposes a low-cost educational advising LLM for study-abroad contexts.",
        setting_focus: "resource-constrained deployment",
        contribution_focus: "Resource-constrained LoRA application",
        limitation_or_caveat: "Different task setting",
        relation_to_study: "Provides background."
      },
      {
        paper_id: "paper_4",
        title: "GIFT: A Framework for Tool Coordination",
        source_type: "analyzed_paper",
        comparison_role: "supporting",
        method_family: "stateful coordination",
        problem_focus: "GIFT is a framework for stateful coordination across external tools.",
        setting_focus: "agent orchestration",
        contribution_focus: "Agent coordination",
        limitation_or_caveat: "Different task setting",
        relation_to_study: "Provides background."
      }
    ];
    bundle.relatedWorkScout = {
      query: "LoRA adapter rank",
      rationale: "Exercise bibliographic spillover filtering.",
      papers: [
        {
          paper_id: "paper_scout_1",
          title: "DELORA",
          summary:
            "Published as a conference paper at ICLR 2025 D E L O RA: D ECOUPLING A NGLES AND S TRENGTH IN L OW- RANK A DAPTATION Massimo Bini1,2,3,†, Leander.",
          source_type: "semantic_scholar_scout",
          venue: "ICLR",
          year: 2025,
          citation_count: 12
        }
      ]
    };

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const context = experimentArtifactLoader({ bundle });
    expect(context.related_work.clusters.length).toBeGreaterThanOrEqual(3);
    expect(context.related_work.clusters.join(" ")).not.toMatch(/literature discovery|stateful coordination|genetic algorithm/i);

    const relatedText = scientific.draft.sections.find((section) => section.heading === "Related Work")?.paragraphs
      .map((paragraph) => paragraph.text)
      .join(" ") || "";
    expect(relatedText).not.toContain("Masahiro Suzuki");
    expect(relatedText).not.toContain("The University of Tokyo");
    expect(relatedText).not.toContain("- Primary metric:");
    expect(relatedText).not.toMatch(/comparison axes concern Recently,/i);
    expect(relatedText).not.toMatch(/literature discovery|stateful coordination|GIFT is|genetic algorithm|Published as a conference paper|D E L O RA|Massimo Bini/i);
    expect(relatedText).toMatch(/method family|resource budget|evaluation scope|prompting and control/i);
  });

  it("restores scientific draft paragraphs when final manuscript repair compresses below the page floor", () => {
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
    const budgetParagraph =
      "The restored manuscript retains this evidence-grounded detail in the main body so that the compiled paper remains comparable to the page-budgeted scientific draft and does not collapse into a short summary after repair.";
    const draft = {
      ...scientific.draft,
      sections: scientific.draft.sections.map((section) =>
        ["Method", "Results", "Discussion"].includes(section.heading)
          ? {
              ...section,
              paragraphs: [
                ...section.paragraphs,
                ...Array.from({ length: 25 }, (_, index) => ({
                  text: `Restoration note ${index + 1} for ${section.heading}: ${budgetParagraph}`,
                  evidence_ids: section.evidence_ids,
                  citation_paper_ids: section.citation_paper_ids
                }))
              ]
            }
          : section
      )
    };
    const pageBudget = pageBudgetManager({
      draft,
      profile: {
        ...PAPER_PROFILE,
        target_main_pages: 6,
        minimum_main_pages: 6,
        main_page_limit: 6
      }
    });
    const compressed: PaperManuscript = {
      title: "Compressed manuscript",
      abstract: "A short abstract.",
      keywords: ["tabular"],
      sections: draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.slice(0, 1).map((paragraph) => paragraph.text)
      }))
    };

    const restored = enforceManuscriptPageBudgetFloor({
      manuscript: compressed,
      draft,
      pageBudget
    });

    const restoredWords = restored.manuscript.sections.reduce(
      (total, section) => total + section.paragraphs.join(" ").split(/\s+/u).filter(Boolean).length,
      0
    );
    expect(pageBudget.status).toBe("ok");
    expect(restored.applied).toBe(true);
    expect(restored.added_paragraph_count).toBeGreaterThan(0);
    expect(restoredWords).toBeGreaterThanOrEqual(pageBudget.minimum_main_words);
    expect(restored.added_sections).toEqual(expect.arrayContaining(["Method", "Results"]));
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

  it("recovers live LoRA method and dispersion evidence from execution metadata", () => {
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
        "  metrics:",
        '    - "average_accuracy"',
        '    - "accuracy_delta_vs_baseline"',
        "  implementation_notes:",
        '    - "Use Qwen/Qwen2.5-1.5B as the base model with LoRA adapters."',
        '    - "Hold optimizer, data order, and evaluation harness constant."',
        "  evaluation_steps:",
        '    - "Use training seeds [42,43,44] and report failed runs."',
        "  resource_notes:",
        '    - "Hyperparameter grid covers LoRA rank and dropout."'
      ].join("\n")
    };
    bundle.latestResults = {
      protocol: {
        datasets: ["Alpaca Clean"],
        seed_schedule: [42, 43, 44],
        repeats: 3
      },
      selected_model: "Qwen/Qwen2.5-1.5B",
      condition_summaries: [
        {
          condition_marker: "rank_8_dropout_0_0",
          label: "rank 8 dropout 0.0",
          is_baseline: true,
          completed_seed_count: 3,
          seed_results: [
            {
              train_metadata: {
                num_train_samples: 48,
                train_dataset_token_count: 8120,
                trainer_state: {
                  learning_rate: 0.0002,
                  per_device_train_batch_size: 1,
                  gradient_accumulation_steps: 4,
                  optimizer_steps: 6
                }
              }
            }
          ]
        },
        {
          condition_marker: "rank_32_dropout_0_05",
          label: "rank 32 dropout 0.05",
          completed_seed_count: 3,
          average_accuracy_mean: 0.4775,
          accuracy_delta_vs_baseline_mean: 0.083332
        }
      ],
      condition_results: [
        {
          marker: "rank_8_dropout_0_0",
          per_task_metrics: {
            arc_challenge: { accuracy: 0.5, correct: 3, total: 6 },
            hellaswag: { accuracy: 0.333333, correct: 2, total: 6 }
          }
        }
      ]
    } as any;
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "accuracy_delta_vs_baseline", value: 0.083332 },
        { key: "arc_challenge_accuracy", value: 0.6417 },
        { key: "hellaswag_accuracy", value: 0.3133 },
        { key: "average_accuracy", value: 0.4775 },
        { key: "runtime_seconds_mean", value: 244.2 },
        { key: "peak_vram_bytes_mean", value: 4946062049 }
      ],
      primary_findings: [
        "ARC-Challenge and HellaSwag task accuracies are reported for the LoRA benchmark.",
        "The rank 32 dropout 0.05 condition improves over the locked baseline."
      ],
      figure_specs: [
        {
          id: "condition_delta",
          title: "Condition-level accuracy deltas",
          path: "figures/condition_delta.svg",
          metric_keys: ["accuracy_delta_vs_baseline"],
          summary: "Repeated-seed condition deltas for the LoRA grid."
        }
      ],
      statistical_summary: {
        total_trials: 6,
        executed_trials: 6,
        cached_trials: 0,
        confidence_intervals: [
          {
            metric_key: "accuracy_delta_vs_baseline",
            label: "Accuracy delta",
            lower: -0.01,
            upper: 0.12,
            level: 0.95,
            source: "condition_summaries",
            summary: ""
          }
        ],
        notes: []
      }
    } as any;

    const context = experimentArtifactLoader({ bundle });
    expect(context.protocol_kind).toBe("lm_benchmark");
    expect(context.method.sample_size_notes.join(" ")).toContain("48 training examples");
    expect(context.method.sample_size_notes.join(" ")).toContain("6 evaluation examples");
    expect(methodCompletenessValidator(context).missing).not.toContain("#samples");
    expect(methodCompletenessValidator(context).missing).not.toContain("benchmark task names");
    expect(context.results.dispersion_notes.join(" ")).toContain("95% interval");
    expect(resultsRichnessValidator(context).missing).not.toContain("dispersion estimates");
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

  it("does not treat missing-setting prose as executed method detail coverage", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout fixed-budget pilot";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.experimentPlan = {
      selectedTitle: "LoRA rank/dropout grid under a fixed local budget",
      selectedSummary: "Compare LoRA rank/dropout cells on ARC-Challenge and HellaSwag.",
      rawText: [
        "selected_design:",
        '  title: "LoRA rank/dropout grid under a fixed local budget"',
        "  datasets:",
        '    - "Alpaca Clean subset"',
        '    - "ARC-Challenge"',
        '    - "HellaSwag"',
        "  implementation_notes:",
        '    - "Preferred base model: Qwen/Qwen2.5-1.5B."',
        '    - "LoRA conditions: rank in {4, 8, 16, 32} x dropout in {0.0, 0.05}."'
      ].join("\n")
    };
    bundle.latestResults = {};
    bundle.resultAnalysis = {
      metrics: {
        selected_model_id: "Qwen/Qwen2.5-1.5B",
        run_config: {
          learning_rate: 0.0002,
          per_device_batch_size: 1,
          gradient_accumulation_steps: 4,
          max_seq_length: 256,
          max_steps: 4,
          timeout_sec: 1800,
          train_samples: 48
        },
        data: {
          train: { count: 48 }
        }
      },
      metric_table: [{ key: "accuracy_delta_vs_baseline", value: 0.083332 }],
      condition_comparisons: [],
      primary_findings: [],
      limitations: [],
      statistical_summary: { confidence_intervals: [] }
    } as any;

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Benchmarking Rank-Dropout Tradeoffs in Parameter-Efficient Instruction Tuning Under a Fixed Local Budget",
      abstract: "This paper reports a fixed-budget pilot benchmark of how LoRA rank and dropout interacted during a realized local instruction-tuning run.",
      keywords: ["LoRA", "instruction tuning"],
      sections: [
        {
          heading: "Method",
          paragraphs: [
            "The intended training scope was an Alpaca Clean subset capped at 10,000 examples, with Qwen/Qwen2.5-1.5B named as the preferred base model and TinyLlama-1.1B-Chat as a fallback if preflight failed. The realized summary, however, documents a much smaller run: 48 training samples, maximum sequence length 256, and seed 17 instead of the design default of 42. The reported summary provided for writing does not disclose the instantiated checkpoint, optimizer, batch size, learning rate, epoch count, or LoRA target modules, so the paper treats the reported run as a pilot-scale realization of the design rather than as a fully specified benchmark reproduction."
          ]
        },
        {
          heading: "Results",
          paragraphs: [
            "The reader-visible summary identifies the realized run as 48 training samples, maximum sequence length 256, and seed 17, but it does not disclose the instantiated checkpoint, optimizer, batch size, learning rate, epoch count, or LoRA target modules; the comparison is therefore bounded to the executed pilot record rather than a fully specified benchmark reproduction."
          ]
        },
        {
          heading: "Limitations",
          paragraphs: [
            "The reader-visible summary does not identify the instantiated checkpoint or disclose optimizer configuration, batch size, learning rate, epoch count, or adapter target modules, so the study should be interpreted as a bounded pilot comparison rather than a fully specified benchmark reproduction."
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
    const allText = [
      result.manuscript.title,
      result.manuscript.abstract,
      ...result.manuscript.sections.flatMap((section) => section.paragraphs)
    ].join(" ");
    const methodText = result.manuscript.sections.find((section) => section.heading === "Method")?.paragraphs.join(" ") || "";

    expect(result.manuscript.title).toBe("A Fixed-Budget Pilot Study of LoRA Rank and Dropout for Local Instruction Tuning");
    expect(methodText).toMatch(/Qwen\/Qwen2\.5-1\.5B/);
    expect(methodText).toMatch(/learning rate 0\.0002/);
    expect(methodText).toMatch(/per-device train batch size 1/);
    expect(methodText).toMatch(/gradient accumulation 4/);
    expect(methodText).toMatch(/maximum sequence length 256/);
    expect(methodText).toMatch(/4 optimizer steps/);
    expect(allText).not.toMatch(/does not disclose the instantiated checkpoint/i);
    expect(allText).not.toMatch(/does not identify the instantiated checkpoint/i);
    expect(allText).not.toMatch(/Benchmarking Rank-Dropout Tradeoffs/i);
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

  it("recovers condition-level LoRA rows from live metrics conditions schema", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout live validation";
    bundle.topic = "LoRA rank and dropout under a fixed-budget instruction tuning sweep";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      summary: {
        baseline_condition_marker: "rank_8_dropout_0_0",
        completed_condition_count: 8,
        best_condition_marker: "rank_32_dropout_0_05",
        best_average_accuracy: 0.416666,
        best_accuracy_delta_vs_baseline: 0.083332
      },
      conditions: [
        {
          marker: "rank_8_dropout_0_0",
          rank: 8,
          dropout: 0,
          status: "ok",
          train_loss: 1.46211,
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          runtime_sec: 5.276,
          peak_cuda_memory_bytes: 2127520768,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_4_dropout_0_0",
          rank: 4,
          dropout: 0,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_4_dropout_0_05",
          rank: 4,
          dropout: 0.05,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_8_dropout_0_05",
          rank: 8,
          dropout: 0.05,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_16_dropout_0_0",
          rank: 16,
          dropout: 0,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_16_dropout_0_05",
          rank: 16,
          dropout: 0.05,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_32_dropout_0_0",
          rank: 32,
          dropout: 0,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.166667,
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_32_dropout_0_05",
          rank: 32,
          dropout: 0.05,
          status: "ok",
          arc_challenge_accuracy: 0.5,
          hellaswag_accuracy: 0.333333,
          average_accuracy: 0.416666,
          accuracy_delta_vs_baseline: 0.083332
        }
      ]
    };

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "LoRA Rank and Dropout under Fixed Budget",
      abstract: "A conservative fixed-budget rank/dropout sweep.",
      keywords: ["LoRA", "instruction tuning"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
      })),
      tables: [
        {
          caption: "Fallback authored summary.",
          rows: [{ label: "Completed Conditions In Sweep", value: 8 }]
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

    expect(result.manuscript.tables?.[0]?.caption).toMatch(/Condition-level mean accuracy/i);
    expect(result.manuscript.tables?.[0]?.rows).toHaveLength(8);
    const rowLabels = result.manuscript.tables?.[0]?.rows.map((row) => row.label).join(" ") || "";
    expect(rowLabels).toMatch(/rank 8 \/ dropout 0.*baseline/i);
    expect(rowLabels).toMatch(/rank 32 \/ dropout 0\.05/i);
    expect(rowLabels).not.toMatch(/ARC 0\.5/i);
    expect(rowLabels).not.toMatch(/HellaSwag 0\.3333/i);
    expect((rowLabels.match(/baseline/g) || [])).toHaveLength(1);
    expect(result.manuscript.tables?.[0]?.rows.map((row) => row.value)).toContain(0.416666);
    expect(result.manuscript.figures?.[0]?.caption).toMatch(/Task-level delta split/i);
    const figureLabels = result.manuscript.figures?.[0]?.bars.map((row) => row.label).join(" ") || "";
    expect(figureLabels).toMatch(/ARC-Challenge task accuracy delta/i);
    expect(figureLabels).toMatch(/HellaSwag task accuracy delta/i);
    expect(result.manuscript.figures?.[0]?.bars.map((row) => row.value)).toEqual([0, 0.166666]);
  });

  it("does not compare baseline and best-cell accuracies as contradictory table facts", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout live validation";
    bundle.topic = "LoRA rank and dropout under a fixed-budget instruction tuning sweep";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      summary: {
        baseline_condition_marker: "rank_8_dropout_0_0",
        completed_condition_count: 2,
        best_condition_marker: "rank_32_dropout_0_05",
        best_average_accuracy: 0.416666,
        best_accuracy_delta_vs_baseline: 0.083332
      },
      conditions: [
        {
          marker: "rank_8_dropout_0_0",
          rank: 8,
          dropout: 0,
          status: "ok",
          average_accuracy: 0.333334,
          accuracy_delta_vs_baseline: 0
        },
        {
          marker: "rank_32_dropout_0_05",
          rank: 32,
          dropout: 0.05,
          status: "ok",
          average_accuracy: 0.416666,
          accuracy_delta_vs_baseline: 0.083332
        }
      ]
    };
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "LoRA Rank and Dropout under Fixed Budget",
      abstract: "A conservative fixed-budget rank/dropout sweep.",
      keywords: ["LoRA", "instruction tuning"],
      sections: scientific.draft.sections.map((section) => ({
        heading: section.heading,
        paragraphs:
          section.heading === "Conclusion"
            ? [
                "In the main run, rank 32 with dropout 0.05 achieved the best observed average accuracy, improving from 0.3333 to 0.4167 over the locked baseline."
              ]
            : section.paragraphs.map((paragraph) => paragraph.text)
      }))
    };

    const result = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: scientific.appendix_plan,
      pageBudget: scientific.page_budget
    });

    expect(
      result.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && issue.severity === "error"
          && (issue.involved_sections || []).includes("Conclusion")
          && (issue.involved_sections || []).some((section) => /Table/i.test(section))
      )
    ).toHaveLength(0);
  });

  it("recovers LoRA condition rows from result analysis metrics when latest results are absent", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout live validation";
    bundle.topic = "LoRA rank and dropout under a fixed-budget instruction tuning sweep";
    delete bundle.latestResults;
    bundle.resultAnalysis = {
      metrics: {
        selected_model_id: "Qwen/Qwen2.5-1.5B",
        run_config: {
          learning_rate: 0.0002,
          per_device_batch_size: 1,
          gradient_accumulation_steps: 4,
          max_seq_length: 256,
          max_steps: 4,
          timeout_sec: 1800
        },
        data: {
          train: {
            count: 48
          }
        },
        summary: {
          baseline_condition_marker: "rank_8_dropout_0_0"
        },
        conditions: [
          {
            marker: "rank_8_dropout_0_0",
            rank: 8,
            dropout: 0,
            arc_challenge_accuracy: 0.5,
            hellaswag_accuracy: 0.166667,
            average_accuracy: 0.333334,
            accuracy_delta_vs_baseline: 0
          },
          {
            marker: "rank_32_dropout_0_05",
            rank: 32,
            dropout: 0.05,
            arc_challenge_accuracy: 0.5,
            hellaswag_accuracy: 0.333333,
            average_accuracy: 0.416666,
            accuracy_delta_vs_baseline: 0.083332
          }
        ]
      }
    } as any;

    const context = experimentArtifactLoader({ bundle });
    expect(context.method.model_names).toContain("Qwen/Qwen2.5-1.5B");
    expect(context.method.hyperparameter_notes.join(" ")).toMatch(/learning rate 0\.0002/i);
    expect(context.method.hyperparameter_notes.join(" ")).toMatch(/maximum sequence length 256/i);
    expect(context.method.hyperparameter_notes.join(" ")).toMatch(/1,?800-second timeout/i);

    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "LoRA Rank and Dropout under Fixed Budget",
      abstract: "A conservative fixed-budget rank/dropout sweep.",
      keywords: ["LoRA", "instruction tuning"],
      sections: scientific.draft.sections.map((section) =>
        section.heading === "Discussion"
          ? {
              heading: section.heading,
              paragraphs: [
                "The practical implication is incremental rather than prescriptive. Rank 32 with dropout 0.05 is a reasonable follow-up candidate because it produced the best observed average accuracy, but the present record does not justify treating it as a settled default.",
                "The current evidence is most actionable as a cautious benchmark note for this fixed-budget LoRA rank/dropout pilot, especially where the best observed cell clears the pre-specified screening threshold.",
                "For a small language-model preflight, the most defensible use of the result is triage: it nominates a configuration worth retesting under larger data or broader tasks, but it does not establish a general adapter rule.",
                "The claim ceiling is therefore central to the interpretation. Completion of the run, a positive mean difference, and a usable table jointly support a candidate-selection claim, while stronger statements about robustness, mechanism, or broad transfer remain outside the available evidence."
              ]
            }
          : {
              heading: section.heading,
              paragraphs: section.paragraphs.map((paragraph) => paragraph.text)
            }
      ),
      tables: [
        {
          caption: "Fallback authored summary.",
          rows: [{ label: "Reported Accuracy Delta Vs Baseline", value: 0.083332 }]
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

    expect(result.manuscript.tables?.[0]?.caption).toMatch(/Condition-level mean accuracy/i);
    const rowLabels = result.manuscript.tables?.[0]?.rows.map((row) => row.label).join(" ") || "";
    expect(rowLabels).not.toMatch(/ARC 0\.5/i);
    expect(rowLabels).not.toMatch(/HellaSwag 0\.3333/i);
    expect((rowLabels.match(/baseline/g) || [])).toHaveLength(1);
    const discussion = result.manuscript.sections.find((section) => section.heading === "Discussion");
    const discussionText = discussion?.paragraphs.join(" ") || "";
    expect(discussionText).not.toMatch(/The current evidence is most actionable as a cautious benchmark note/i);
    expect(discussionText).not.toMatch(/For a small language-model preflight/i);
    expect(discussionText).not.toMatch(/The claim ceiling is therefore central/i);
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

  it("does not treat seed and grid design values as measured metric facts", () => {
    const bundle = makeRichBundle();
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        ...(((bundle.resultAnalysis as any).metric_table || []) as Array<{ key: string; value: number }>),
        { key: "wall_clock_runtime_sec", value: 45.687 },
        { key: "peak_memory_mb_mean", value: 4280 }
      ]
    } as any;
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "LoRA Design Audit",
      abstract:
        "The protocol crossed ranks 4, 8, 16, and 32 with dropout values 0.0 and 0.05; the full 4 x 2 sweep completed in 45.7 s.",
      keywords: ["LoRA"],
      sections: [
        {
          heading: "Introduction",
          paragraphs: ["This manuscript keeps design settings separate from measured outcomes."]
        },
        {
          heading: "Method",
          paragraphs: [
            "The primary factorial plan specified seed 42 and compared LoRA rank and dropout settings under a fixed budget."
          ]
        },
        {
          heading: "Results",
          paragraphs: ["The wall-clock runtime was 45.7 s and peak memory was about 4280 MB."]
        },
        {
          heading: "Limitations",
          paragraphs: [
            "The design specification names seed 42, whereas the runtime summary reports seed 17; this is provenance context rather than a measured runtime value."
          ]
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
      manuscript.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && (issue.normalized_facts || []).some(
            (fact) =>
              fact.metric_key === "runtime_seconds"
              && [4, 8, 16, 32, 42, 17].includes(fact.value)
              && /rank|dropout|seed/i.test(fact.raw_text)
          )
      )
    ).toHaveLength(0);
    expect(
      manuscript.consistency_lint.issues.filter(
        (issue) =>
          issue.kind === "numeric_inconsistency"
          && (issue.normalized_facts || []).some(
            (fact) =>
              fact.metric_key === "accuracy"
              && [0, 0.05, 4, 8, 16, 32].includes(fact.value)
              && /rank|dropout|grid|sweep/i.test(fact.raw_text)
          )
      )
    ).toHaveLength(0);
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

  it("keeps baseline and best-condition accuracy targets separate in compact abstract comparisons", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout preflight";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      baseline_marker: "rank_8_dropout_0_0",
      condition_summaries: [
        {
          condition_marker: "rank_8_dropout_0_0",
          lora_rank: 8,
          lora_dropout: 0,
          completed_seed_count: 1,
          average_accuracy_mean: 0.333334,
          accuracy_delta_vs_baseline_mean: 0
        },
        {
          condition_marker: "rank_32_dropout_0_05",
          lora_rank: 32,
          lora_dropout: 0.05,
          completed_seed_count: 1,
          average_accuracy_mean: 0.416666,
          accuracy_delta_vs_baseline_mean: 0.083332
        }
      ]
    } as any;
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "average_accuracy", value: 0.416666 },
        { key: "accuracy_delta_vs_baseline", value: 0.083332 }
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
        "Within this realized run, the best exposed condition, rank 32 with dropout 0.05, raises mean accuracy from 0.333334 to 0.416666 relative to the baseline.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study a fixed-budget LoRA rank/dropout preflight."] },
        { heading: "Method", paragraphs: ["Rank 8 with dropout 0.0 served as the locked baseline."] },
        {
          heading: "Results",
          paragraphs: [
            "The reported results identifies rank 32 with dropout 0.05 as the strongest observed condition, with average accuracy 0.416666 compared with 0.333334 for the locked baseline at rank 8 and dropout 0.0."
          ]
        },
        { heading: "Discussion", paragraphs: ["The comparison supports a narrow follow-up candidate."] },
        { heading: "Conclusion", paragraphs: ["The result remains a local preflight signal."] }
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

    const targetErrors = result.consistency_lint.issues.filter(
      (issue) =>
        issue.kind === "numeric_inconsistency"
        && issue.severity === "error"
        && /accuracy_delta_vs_baseline|rank_32_dropout_0_05/.test(JSON.stringify(issue.normalized_facts || []))
        && /0\.333334/.test(JSON.stringify(issue.normalized_facts || []))
    );
    expect(targetErrors).toHaveLength(0);
    expect(
      result.consistency_lint.issues.filter(
        (issue) => issue.kind === "numeric_inconsistency" && issue.severity === "error"
      )
    ).toHaveLength(0);
  });

  it("keeps anaphoric best-condition accuracy separate from a following baseline comparison", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout preflight";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      baseline_marker: "rank_8_dropout_0_0",
      condition_summaries: [
        {
          condition_marker: "rank_8_dropout_0_0",
          lora_rank: 8,
          lora_dropout: 0,
          completed_seed_count: 1,
          average_accuracy_mean: 0.333334,
          accuracy_delta_vs_baseline_mean: 0
        },
        {
          condition_marker: "rank_32_dropout_0_05",
          lora_rank: 32,
          lora_dropout: 0.05,
          completed_seed_count: 1,
          average_accuracy_mean: 0.416666,
          accuracy_delta_vs_baseline_mean: 0.083332
        }
      ]
    } as any;
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "average_accuracy", value: 0.416666 },
        { key: "accuracy_delta_vs_baseline", value: 0.083332 }
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
        "The best reported condition combines rank 32 with dropout 0.05. Its average accuracy across ARC-Challenge and HellaSwag is 0.4167, compared with 0.3333 for the locked baseline at rank 8 and dropout 0.0.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study a fixed-budget LoRA rank/dropout preflight."] },
        { heading: "Method", paragraphs: ["Rank 8 with dropout 0.0 served as the locked baseline."] },
        {
          heading: "Results",
          paragraphs: [
            "Within that analyzed configuration, the best reported condition combines rank 32 with dropout 0.05.",
            "Its average accuracy across ARC-Challenge and HellaSwag is 0.4167, compared with 0.3333 for the locked baseline at rank 8 and dropout 0.0."
          ]
        },
        { heading: "Discussion", paragraphs: ["The comparison supports a narrow follow-up candidate."] },
        { heading: "Conclusion", paragraphs: ["The result remains a local preflight signal."] }
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

    const blockingErrors = result.consistency_lint.issues.filter(
      (issue) => issue.kind === "numeric_inconsistency" && issue.severity === "error"
    );
    expect(blockingErrors).toHaveLength(0);
  });

  it("keeps from-to accuracy values aligned with both named rank/dropout sides", () => {
    const bundle = makeRichBundle();
    bundle.runTitle = "LoRA rank-dropout preflight";
    bundle.topic = "LoRA rank and dropout interaction for a small LLM benchmark";
    bundle.objectiveMetric = "accuracy_delta_vs_baseline >= 0.01";
    bundle.latestResults = {
      baseline_marker: "rank_8_dropout_0_0",
      condition_summaries: [
        {
          condition_marker: "rank_8_dropout_0_0",
          lora_rank: 8,
          lora_dropout: 0,
          completed_seed_count: 1,
          average_accuracy_mean: 0.333334,
          accuracy_delta_vs_baseline_mean: 0
        },
        {
          condition_marker: "rank_32_dropout_0_05",
          lora_rank: 32,
          lora_dropout: 0.05,
          completed_seed_count: 1,
          average_accuracy_mean: 0.416666,
          accuracy_delta_vs_baseline_mean: 0.083332
        }
      ]
    } as any;
    bundle.resultAnalysis = {
      ...(bundle.resultAnalysis as any),
      metric_table: [
        { key: "average_accuracy", value: 0.416666 },
        { key: "accuracy_delta_vs_baseline", value: 0.083332 }
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
        "The explicit comparison is rank 32 with dropout 0.05 versus rank 8 with dropout 0.0, with average accuracy rising from 0.333334 to 0.416666.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We study a fixed-budget LoRA rank/dropout preflight."] },
        { heading: "Method", paragraphs: ["Rank 8 with dropout 0.0 served as the locked baseline."] },
        {
          heading: "Results",
          paragraphs: [
            "The explicit comparison reported in the summary is rank 32 with dropout 0.05 versus rank 8 with dropout 0.0, with average accuracy rising from 0.333334 to 0.416666."
          ]
        },
        { heading: "Discussion", paragraphs: ["The comparison supports a narrow follow-up candidate."] },
        { heading: "Conclusion", paragraphs: ["The result remains a local preflight signal."] }
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

    const blockingErrors = result.consistency_lint.issues.filter(
      (issue) => issue.kind === "numeric_inconsistency" && issue.severity === "error"
    );
    expect(blockingErrors).toHaveLength(0);
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

    expect(resultsWords).toBeGreaterThan(70);
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
            "The first P6 run uses a cached, locally runnable small LLM target so the validation focuses on real training, result-table integrity, review gating, and paper-readiness audit rather than on new model access.",
            "Accordingly, the present evidence is most useful as a cautious benchmark note for a fixed-budget pilot.",
            "The practical implication is limited but useful. The current evidence is most actionable as a cautious benchmark note for this fixed-budget LoRA rank/dropout pilot."
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
    expect((text.match(/cautious benchmark note/g) || [])).toHaveLength(1);
    expect(text).not.toMatch(/manuscript bundle|manuscript-facing bundle|condition summaries \//i);
    expect(text).not.toMatch(/can be competitive under a strict local instruction-tuning budget/i);
    expect(text).not.toMatch(/\[(?:Qwen2?\.?5?|TinyLlama|Alpaca Clean|ARC-Challenge|HellaSwag)/i);
    expect(text).not.toMatch(/Objective metric met|includes LoRA target modules were|for the inspected seed-level record|paper-ready claim/i);
    expect(text).not.toMatch(/P6 run|review gating|paper-readiness audit|raw result study summary|routed to the appendix/i);
  });

  it("rejects planning titles and drops internal appendix material during materialization", () => {
    expect(
      choosePaperTitle({
        candidateTitle:
          "Plan 1: Adding a Pre-Registered Result-Gating System That Enforces Benchmark-Ba...",
        runTitle: "LoRA rank and dropout under fixed budget instruction tuning",
        fallbackTitle: "Plan 2: Workflow audit for paper-readiness"
      })
    ).toBe("LoRA Rank and Dropout under Fixed-Budget Instruction Tuning");

    const bundle = makeRichBundle();
    const scientific = applyScientificWritingPolicy({
      draft: makeTerseDraft(),
      bundle,
      profile: PAPER_PROFILE
    });
    const candidate: PaperManuscript = {
      title: "Repeated-Seed Evaluation",
      abstract: "A short abstract.",
      keywords: ["LoRA"],
      sections: [
        { heading: "Introduction", paragraphs: ["We compare fixed-budget LoRA conditions."] },
        {
          heading: "Method",
          paragraphs: [
            "The protocol records Measure whether generated intermediate and final artifacts remain consistent across repeated runs. Runtime and memory are explicitly measured in the evaluation outputs.",
            "The fixed search space includes Artifact text references tuning.",
            "The reported study uses current_best_baseline as the trained backbone.",
            "The evaluation spans dataset_to_be_selected. Models or conditions include current_best_baseline.",
            "The task scope is fixed around dataset_to_be_selected. The method section therefore describes the executed comparison as a locked protocol rather than as an open-ended search. That distinction is necessary because paper-readiness depends on the reader being able to reconstruct which evidence was generated and which follow-up remains planned. The emphasis remains on evidence that is inspectable in the current run.",
            "The task scope is fixed around dataset_to_be_selected. The method section therefore describes the executed comparison as a locked protocol rather than as an open-ended search. That distinction is necessary because paper-readiness depends on the reader being able to reconstruct which evidence was generated and which follow-up remains planned. The same point would need to be revised if later artifacts changed the comparator, table, or execution status.",
            "Model selection and reporting focus on average accuracy, task-level accuracy, training loss, resource diagnostics, condition completion, failed-run visibility, and conservative downgrade correctness.",
            "Resource diagnostics are explicitly measured in the evaluation outputs.",
            "The fixed search space is the LoRA rank/dropout grid described above.",
            "The executed condition-level summaries are the comparison unit for this local preflight: means are compared against the locked baseline, while individual seed outcomes are used to expose variation rather than to select a favorable example. The preserved protocol notes, so the method description distinguishes the planned budget from the executed repeated comparison.",
            "Preprocessing follows this order:, and Artifact text references clean. Model selection and reporting focus on average_accuracy."
          ]
        },
        {
          heading: "Results",
          paragraphs: [
            "Objective metric met: accuracy_delta_vs_baseline=0.083332 >= 0.01.",
            "rank 32 dropout 0 05 vs rank 8 dropout 0 0 accuracy_delta_vs_baseline=0.083332 arc_challenge_accuracy=0.6417 hellaswag_accuracy=0.3133.",
            "rank 32 dropout 0 05 vs rank 8 dropout 0 0 improves accuracy delta vs baseline by 0.0833.",
            "The 95% interval for conditions rank 16 dropout 0 0 average accuracy spans 0.1381 to 0.6094. wall clock runtime sec=45.687. device cuda max memory allocated bytes=4278951936.",
            "The table and figure are therefore used as complementary checks: the table anchors the numeric values, while the figure is retained only when it shows a distinct pattern that is not already obvious from the rows.",
            "Across these summaries, the completed condition comparison is the relevant reporting unit rather than an isolated seed or anecdotal observation. The available results therefore support a provisional ordering of the recorded cells, but the combination of wide intervals and very limited evaluation size leaves that ordering uncertain."
          ]
        },
        {
          heading: "Discussion",
          paragraphs: [
            "The current evidence is most actionable as a cautious benchmark note for Study how LoRA rank and dropout interact during parameter-efficient instruction tuning under a fixed local compute budget. The study is framed as a local small-model preflight so that the evidence rests on executed training runs, result-table consistency, and a bounded claim ceiling rather than on access to a larger target model. A 7B-class run is a later scale-up target after preflight is clean., especially where small positive deltas repeat across datasets.",
            "Several bookkeeping tensions also need resolution: the plan capped training data at 10,000 examples but the analyzed run used 48 samples; the planning brief named seed 42 but the summary reports seed 17; and the surrounding materials mention both three executed trials and a narrower analyzed observation."
          ]
        },
        {
          heading: "Limitations",
          paragraphs: [
            "Specification may be underspecified and require narrower scope.",
            "conditions / rank 16 dropout 0 0 / average accuracy 95% CI [0.1381, 0.6094] over n=12 prediction(s)."
          ]
        },
        { heading: "Conclusion", paragraphs: ["The best observed cell merits larger-scale replication."] }
      ],
      tables: [
        {
          caption: "Selected reported metrics from metric_table.",
          rows: [
            { label: "Accuracy Delta Vs Baseline", value: 0.0833 },
            { label: "Summary Best Average Accuracy", value: 0.4167 },
            { label: "Summary Best Accuracy Delta Vs Baseline", value: 0.0833 }
          ]
        }
      ],
      figures: [
        {
          caption: "Dataset-level outcome summary with uncertainty-aware interpretation retained in the main paper.",
          bars: [
            { label: "Accuracy Delta Vs Baseline", value: 0.0833 },
            { label: "Summary Best Average Accuracy", value: 0.4167 },
            { label: "Device Cuda Max Memory Allocated Bytes", value: 4278951936 }
          ]
        }
      ],
      appendix_sections: [
        {
          heading: "Appendix: Gate Output",
          paragraphs: [
            "The appendix preserves the manuscript-quality gate output, PDF build report, and page-budget validation for paper-readiness review.",
            "Supplementary setup details report the repeated LoRA rank/dropout grid and the fixed evaluation harness."
          ]
        },
        {
          heading: "Supplementary Experimental Details",
          paragraphs: [
            "The manuscript therefore passes only as a paper-scale preflight record: it has a research question, a comparator, executed experiments, quantitative tables, uncertainty notes, and limitations, while still naming the larger replication required before a stronger paper claim would be justified.",
            "The released materials preserve condition-level comparisons and keep the baseline row visible so that readers can audit the comparison unit, but unresolved metadata inconsistencies mean the release should be treated as a reproducibility trace for a local preflight rather than as a fully sufficient standalone replication package.",
            "Resource measurements were collected as secondary diagnostics."
          ]
        }
      ],
      appendix_tables: [
        {
          caption: "Planned versus realized setup values referenced in the manuscript.",
          rows: [
            { label: "Planned Maximum Training Examples", value: 10000 },
            { label: "Realized Training Examples", value: 48 }
          ]
        },
        {
          caption: "Planned versus realized setup values referenced in the manuscript.",
          rows: [
            { label: "Planned Maximum Training Examples", value: 10000 },
            { label: "Realized Training Examples", value: 48 }
          ]
        }
      ]
    };

    const manuscript = materializeScientificManuscript({
      candidate,
      draft: scientific.draft,
      bundle,
      profile: PAPER_PROFILE,
      appendixPlan: { sections: [], tables: [], figures: [], cross_references: [] },
      pageBudget: scientific.page_budget
    }).manuscript;
    const allText = [
      manuscript.title,
      manuscript.sections.flatMap((section) => section.paragraphs).join(" "),
      (manuscript.appendix_sections || []).flatMap((section) => [section.heading, ...section.paragraphs]).join(" ")
    ].join(" ");

    expect(allText).toContain("Resource diagnostics are explicitly measured");
    expect(allText).toContain("LoRA rank/dropout grid");
    expect(allText).toContain("ARC-Challenge and HellaSwag");
    expect(allText).toContain("run-metadata task labels ARC-Challenge and HellaSwag");
    expect(allText).toContain("planned and realized execution records should be read conservatively");
    expect(allText).toContain("One reported condition-level 95% interval");
    expect(allText).toContain("local preflight");
    expect(allText).toContain("Figure 1 isolates the task-level contribution");
    expect(allText).toContain("Supplementary setup details");
    expect((manuscript.appendix_sections || []).filter((section) => section.heading === "Supplementary Experimental Details")).toHaveLength(1);
    expect((allText.match(/run-metadata task labels ARC-Challenge and HellaSwag/g) || [])).toHaveLength(1);
    expect(manuscript.tables?.[0]?.rows.filter((row) => /accuracy delta vs baseline/i.test(row.label))).toHaveLength(1);
    expect(manuscript.appendix_tables || []).toHaveLength(1);
    expect(allText).not.toMatch(/Plan 1|Plan 2|Objective metric met|Artifact text references|current_best_baseline|dataset_to_be_selected|manuscript-quality gate|PDF build report|page-budget validation|paper-readiness|paper-scale preflight|manuscript therefore passes|unresolved metadata inconsistencies|wall clock runtime sec|device cuda max memory allocated bytes|small positive deltas repeat across datasets|Across these summaries|Model selection and reporting focus on average accuracy|surrounding materials/i);
    expect(allText).not.toMatch(/accuracy_delta_vs_baseline=.*arc_challenge_accuracy=.*hellaswag_accuracy/i);
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
