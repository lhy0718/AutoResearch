import { describe, expect, it } from "vitest";

import { buildResultsTableValidation } from "../src/core/nodes/analyzeResults.js";
import { buildAnalysisReport } from "../src/core/resultAnalysis.js";

describe("resultAnalysis", () => {
  it("projects node-owned metrics.results rows into baseline/comparator condition comparisons", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve mean zero-shot accuracy over the adapter baseline."
      },
      metrics: {
        accuracy_delta_vs_baseline: 0,
        baseline_mean_accuracy: 0.546875,
        best_mean_accuracy: 0.546875,
        best_recipe: "adapter_qv_r8",
        results: [
          {
            recipe: "baseline",
            peft_type: "none",
            status: "completed",
            mean_accuracy: 0.546875,
            benchmark_task_a_accuracy: 0.53125,
            benchmark_task_b_accuracy: 0.5625,
            accuracy_delta_vs_baseline: 0,
            wall_clock_seconds: 7.5
          },
          {
            recipe: "adapter_qv_r8",
            peft_type: "adapter",
            status: "completed",
            mean_accuracy: 0.546875,
            benchmark_task_a_accuracy: 0.53125,
            benchmark_task_b_accuracy: 0.5625,
            accuracy_delta_vs_baseline: 0,
            wall_clock_seconds: 24.0,
            peak_gpu_memory_allocated_bytes: 4477727232
          }
        ]
      },
      objectiveProfile: {
        source: "llm",
        raw: "Improve mean zero-shot accuracy over the adapter baseline.",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "mean_accuracy"],
        comparator: ">=",
        targetValue: 0.01,
        targetDescription: "Accuracy should improve by at least one point.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve mean zero-shot accuracy over the adapter baseline.",
        profileSource: "llm",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "mean_accuracy"],
        matchedMetricKey: "accuracy_delta_vs_baseline",
        comparator: ">=",
        targetValue: 0.01,
        observedValue: 0,
        status: "not_met",
        summary: "Objective metric not met: accuracy_delta_vs_baseline=0 does not satisfy >= 0.01."
      }
    });

    expect(report.condition_comparisons).toHaveLength(1);
    expect(report.condition_comparisons[0]).toMatchObject({
      id: "adapter_qv_r8_vs_baseline",
      source: "metrics.results"
    });
    expect(report.condition_comparisons[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "mean_accuracy",
          baseline_value: 0.546875,
          primary_value: 0.546875,
          value: 0
        }),
        expect.objectContaining({
          key: "accuracy_delta_vs_baseline",
          baseline_value: 0,
          primary_value: 0,
          value: 0
        })
      ])
    );
  });

  it("projects node-owned metrics.result_rows rows into locked-baseline comparisons", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve mean zero-shot accuracy over the locked adapter baseline."
      },
      metrics: {
        best_tuned_condition_id: "adapter_r16_attention_mlp",
        result_rows: [
          {
            condition_id: "reference_base_model",
            recipe_type: "reference",
            is_baseline_reference: true,
            mean_zero_shot_accuracy_benchmark_tasks: 0.27919,
            benchmark_task_b_accuracy: 0.312286,
            benchmark_task_a_accuracy: 0.246094
          },
          {
            condition_id: "locked_adapter_baseline_r8",
            recipe_type: "locked_baseline",
            is_locked_adapter_baseline: true,
            mean_zero_shot_accuracy_benchmark_tasks: 0.304353,
            benchmark_task_b_accuracy: 0.332559,
            benchmark_task_a_accuracy: 0.276147
          },
          {
            condition_id: "adapter_r16_attention_mlp",
            recipe_type: "candidate",
            mean_zero_shot_accuracy_benchmark_tasks: 0.313533,
            benchmark_task_b_accuracy: 0.342223,
            benchmark_task_a_accuracy: 0.284843
          }
        ]
      },
      objectiveProfile: {
        source: "llm",
        raw: "Improve mean zero-shot accuracy over the locked adapter baseline.",
        primaryMetric: "mean_zero_shot_accuracy_benchmark_tasks",
        preferredMetricKeys: ["mean_zero_shot_accuracy_benchmark_tasks"],
        comparator: ">=",
        targetValue: 0.01,
        targetDescription: "Accuracy should improve by at least one point.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve mean zero-shot accuracy over the locked adapter baseline.",
        profileSource: "llm",
        primaryMetric: "mean_zero_shot_accuracy_benchmark_tasks",
        preferredMetricKeys: ["mean_zero_shot_accuracy_benchmark_tasks"],
        matchedMetricKey: "mean_zero_shot_accuracy_benchmark_tasks",
        comparator: ">=",
        targetValue: 0.01,
        observedValue: 0.313533,
        status: "met",
        summary: "Objective metric met."
      }
    });

    expect(report.condition_comparisons[0]).toMatchObject({
      id: "adapter_r16_attention_mlp_vs_locked_adapter_baseline_r8",
      source: "metrics.result_rows"
    });
    expect(report.condition_comparisons[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "mean_zero_shot_accuracy_benchmark_tasks",
          baseline_value: 0.304353,
          primary_value: 0.313533,
          value: 0.0092
        })
      ])
    );
  });

  it("projects node-owned metrics.recipes rows into baseline/comparator condition comparisons", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve mean zero-shot accuracy over the adapter baseline."
      },
      metrics: {
        best_recipe: "baseline",
        best_improvement_over_baseline: 0,
        recipes: {
          baseline: {
            recipe: "baseline",
            evaluation: {
              mean_zero_shot_accuracy: 0.53125,
              per_benchmark_accuracy: {
                benchmark_task_a: 0.375,
                benchmark_task_b: 0.6875
              }
            },
            wall_time_sec: 1.4
          },
          adapter_r4: {
            recipe: "adapter_r4",
            evaluation: {
              mean_zero_shot_accuracy: 0.53125,
              per_benchmark_accuracy: {
                benchmark_task_a: 0.375,
                benchmark_task_b: 0.6875
              }
            },
            wall_time_sec: 8.6
          },
          adapter_r8: {
            recipe: "adapter_r8",
            evaluation: {
              mean_zero_shot_accuracy: 0.5,
              per_benchmark_accuracy: {
                benchmark_task_a: 0.3125,
                benchmark_task_b: 0.6875
              }
            },
            wall_time_sec: 17.4
          }
        }
      },
      objectiveProfile: {
        source: "llm",
        raw: "Improve mean zero-shot accuracy over the adapter baseline.",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "mean_zero_shot_accuracy_benchmark_tasks", "accuracy"],
        comparator: ">=",
        targetValue: 0.01,
        targetDescription: "Accuracy should improve by at least one point.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve mean zero-shot accuracy over the adapter baseline.",
        profileSource: "llm",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "mean_zero_shot_accuracy_benchmark_tasks", "accuracy"],
        matchedMetricKey: "best_improvement_over_baseline",
        comparator: ">=",
        targetValue: 0.01,
        observedValue: 0,
        status: "not_met",
        summary: "Objective metric not met: best_improvement_over_baseline=0 does not satisfy >= 0.01."
      }
    });

    expect(report.condition_comparisons[0]).toMatchObject({
      id: "adapter_r4_vs_baseline",
      source: "metrics.recipes"
    });
    expect(report.condition_comparisons[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "evaluation.mean_zero_shot_accuracy",
          baseline_value: 0.53125,
          primary_value: 0.53125,
          value: 0
        })
      ])
    );
  });

  it("projects metrics.conditions plus condition_summaries into baseline/comparator comparisons", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve mean zero-shot accuracy over the unmodified baseline."
      },
      metrics: {
        status: "completed",
        best_condition: {
          name: "base_unmodified",
          benchmark_task_a_accuracy: 0.296875,
          benchmark_task_b_accuracy: 0.5078125,
          mean_zero_shot_accuracy: 0.40234375,
          bootstrap_mean_ci: {
            ci_low: 0.296875,
            ci_high: 0.5078125,
            mean: 0.40234375
          }
        },
        condition_summaries: [
          {
            name: "base_unmodified",
            benchmark_task_a_accuracy: 0.296875,
            benchmark_task_b_accuracy: 0.5078125,
            mean_zero_shot_accuracy: 0.40234375,
            bootstrap_mean_ci: {
              ci_low: 0.296875,
              ci_high: 0.5078125,
              mean: 0.40234375
            },
            trainable_params: 0,
            training_wall_time_sec: 0
          },
          {
            name: "adapter_r8",
            benchmark_task_a_accuracy: 0.2734375,
            benchmark_task_b_accuracy: 0.5234375,
            mean_zero_shot_accuracy: 0.3984375,
            trainable_params: 6307840,
            training_wall_time_sec: 431.3
          }
        ],
        conditions: [
          {
            name: "base_unmodified",
            condition_type: "baseline_unmodified_checkpoint",
            evaluation: {
              benchmark_task_a: { accuracy: 0.296875 },
              benchmark_task_b: { accuracy: 0.5078125 }
            },
            training: { trainable_params: 0, wall_time_sec: 0 }
          },
          {
            name: "adapter_r8",
            condition_type: "peft_adapter_instruction_tuned",
            evaluation: {
              benchmark_task_a: { accuracy: 0.2734375 },
              benchmark_task_b: { accuracy: 0.5234375 }
            },
            training: { trainable_params: 6307840, wall_time_sec: 431.3 }
          }
        ]
      },
      objectiveProfile: {
        source: "llm",
        raw: "Improve mean zero-shot accuracy over the unmodified baseline.",
        primaryMetric: "mean_zero_shot_accuracy",
        preferredMetricKeys: ["mean_zero_shot_accuracy", "benchmark_task_a_accuracy", "benchmark_task_b_accuracy"],
        comparator: ">=",
        targetValue: 0.01,
        targetDescription: "Mean zero-shot accuracy should improve by at least one point.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve mean zero-shot accuracy over the unmodified baseline.",
        profileSource: "llm",
        primaryMetric: "mean_zero_shot_accuracy",
        preferredMetricKeys: ["mean_zero_shot_accuracy", "benchmark_task_a_accuracy", "benchmark_task_b_accuracy"],
        matchedMetricKey: "best_condition.benchmark_task_a_accuracy",
        comparator: ">=",
        targetValue: 0.01,
        observedValue: 0.296875,
        status: "met",
        summary: "Objective metric met."
      }
    });

    expect(report.condition_comparisons[0]).toMatchObject({
      id: "adapter_r8_vs_base_unmodified",
      source: "metrics.conditions",
      hypothesis_supported: false
    });
    expect(report.condition_comparisons[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "mean_zero_shot_accuracy",
          baseline_value: 0.402344,
          primary_value: 0.398438,
          value: -0.0039
        })
      ])
    );
    expect(
      report.statistical_summary.confidence_intervals.some((item) =>
        item.metric_key === "best_condition.mean_zero_shot_accuracy"
      )
    ).toBe(true);
    expect(report.failure_taxonomy.some((item) => item.id === "missing_confidence_intervals")).toBe(false);
  });

  it("projects P6 repeated-seed condition_summaries with a top-level baseline marker", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "accuracy_delta_vs_baseline >= 0.01"
      },
      experimentPlanRaw: [
        "selected_design:",
        "  title: 5-seed high-rank dropout stability against locked baseline",
        "  risks:",
        "    - The small backbone may make the effect unstable."
      ].join("\n"),
      metrics: {
        status: "completed",
        baseline_marker: "baseline_condition",
        required_run_count: 25,
        completed_run_count: 25,
        accuracy_delta_vs_baseline: 0.04479166666666667,
        condition_summaries: [
          {
            condition_marker: "baseline_condition",
            status: "completed",
            adapter_rank: 8,
            adapter_dropout: 0,
            completed_seed_count: 5,
            average_accuracy_mean: 0.4416666666666667,
            average_accuracy_ci95: 0.030006249349093926,
            average_accuracy_count: 5,
            accuracy_delta_vs_baseline_mean: 0,
            accuracy_delta_vs_baseline_ci95: 0,
            accuracy_delta_vs_baseline_count: 5,
            benchmark_task_a_accuracy_mean: 0.5666666666666667,
            benchmark_task_b_accuracy_mean: 0.31666666666666665
          },
          {
            condition_marker: "candidate_condition_d",
            status: "completed",
            adapter_rank: 16,
            adapter_dropout: 0,
            completed_seed_count: 5,
            average_accuracy_mean: 0.4666666666666667,
            average_accuracy_ci95: 0.0586068587188299,
            average_accuracy_count: 5,
            accuracy_delta_vs_baseline_mean: 0.025000000000000012,
            accuracy_delta_vs_baseline_ci95: 0.08408097948472716,
            accuracy_delta_vs_baseline_count: 5,
            benchmark_task_a_accuracy_mean: 0.6166666666666667,
            benchmark_task_b_accuracy_mean: 0.31666666666666665
          },
          {
            condition_marker: "candidate_condition_f5",
            status: "completed",
            adapter_rank: 32,
            adapter_dropout: 0.05,
            completed_seed_count: 5,
            average_accuracy_mean: 0.5083333333333333,
            average_accuracy_ci95: 0.04000833246545857,
            average_accuracy_count: 5,
            accuracy_delta_vs_baseline_mean: 0.06666666666666667,
            accuracy_delta_vs_baseline_ci95: 0.06378370568657102,
            accuracy_delta_vs_baseline_count: 5,
            benchmark_task_a_accuracy_mean: 0.6416666666666667,
            benchmark_task_b_accuracy_mean: 0.375
          }
        ]
      },
      objectiveProfile: {
        source: "llm",
        raw: "accuracy_delta_vs_baseline >= 0.01",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "average_accuracy", "benchmark_task_a_accuracy", "benchmark_task_b_accuracy"],
        comparator: ">=",
        targetValue: 0.01,
        targetDescription: "Accuracy delta should improve by at least one point.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "accuracy_delta_vs_baseline >= 0.01",
        profileSource: "llm",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "average_accuracy", "benchmark_task_a_accuracy", "benchmark_task_b_accuracy"],
        matchedMetricKey: "accuracy_delta_vs_baseline",
        comparator: ">=",
        targetValue: 0.01,
        observedValue: 0.04479166666666667,
        status: "met",
        summary: "Objective metric met."
      }
    });

    expect(report.condition_comparisons[0]).toMatchObject({
      id: "candidate_condition_f5_vs_baseline_condition",
      source: "metrics.condition_summaries",
      hypothesis_supported: true
    });
    expect(report.condition_comparisons[0]?.metrics[0]?.key).toBe("accuracy_delta_vs_baseline_mean");
    expect(report.condition_comparisons[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "accuracy_delta_vs_baseline_mean",
          baseline_value: 0,
          primary_value: 0.066667,
          value: 0.0667
        }),
        expect.objectContaining({
          key: "average_accuracy_mean",
          baseline_value: 0.441667,
          primary_value: 0.508333,
          value: 0.0667
        })
      ])
    );
    expect(report.overview.execution_runs).toBe(25);
    expect(report.statistical_summary.total_trials).toBe(25);
    expect(report.statistical_summary.executed_trials).toBe(25);
    expect(report.primary_findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("25 executed trial(s)")
      ])
    );
    expect(
      report.statistical_summary.confidence_intervals.some((item) =>
        item.metric_key === "condition_summaries.candidate_condition_f5.average_accuracy"
      )
    ).toBe(true);
    expect(report.failure_taxonomy.some((item) => item.id === "missing_confidence_intervals")).toBe(false);

    const validation = buildResultsTableValidation({ report });
    expect(validation.valid).toBe(true);
    expect(validation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "accuracy_delta_vs_baseline_mean",
          baseline: 0,
          comparator: 0.066667,
          delta: 0.0667
        })
      ])
    );
  });

  it("projects completed condition_aggregates into baseline/comparator tables", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "accuracy_delta_vs_baseline >= 0.01"
      },
      metrics: {
        status: "completed",
        baseline_condition_marker: "baseline_condition",
        required_run_count: 10,
        completed_run_count: 10,
        condition_aggregates: [
          {
            condition_marker: "baseline_condition",
            status: "completed",
            completed_seed_count: 5,
            mean_average_accuracy: 0.61,
            accuracy_delta_vs_baseline: 0,
            mean_task_a_accuracy: 0.75,
            mean_task_b_accuracy: 0.47
          },
          {
            condition_marker: "candidate_condition_a",
            status: "completed",
            completed_seed_count: 5,
            mean_average_accuracy: 0.64,
            accuracy_delta_vs_baseline: 0.03,
            mean_task_a_accuracy: 0.77,
            mean_task_b_accuracy: 0.51
          }
        ]
      },
      objectiveProfile: {
        source: "llm",
        raw: "accuracy_delta_vs_baseline >= 0.01",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "mean_average_accuracy"],
        comparator: ">=",
        targetValue: 0.01,
        targetDescription: "Accuracy delta should improve by at least one point.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "accuracy_delta_vs_baseline >= 0.01",
        profileSource: "llm",
        primaryMetric: "accuracy_delta_vs_baseline",
        preferredMetricKeys: ["accuracy_delta_vs_baseline", "mean_average_accuracy"],
        matchedMetricKey: "accuracy_delta_vs_baseline",
        comparator: ">=",
        targetValue: 0.01,
        observedValue: 0.03,
        status: "met",
        summary: "Objective metric met."
      }
    });

    expect(report.condition_comparisons[0]).toMatchObject({
      id: "candidate_condition_a_vs_baseline_condition",
      source: "metrics.condition_aggregates",
      hypothesis_supported: true
    });
    expect(report.condition_comparisons[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "accuracy_delta_vs_baseline",
          baseline_value: 0,
          primary_value: 0.03,
          value: 0.03
        }),
        expect.objectContaining({
          key: "mean_average_accuracy",
          baseline_value: 0.61,
          primary_value: 0.64,
          value: 0.03
        })
      ])
    );

    const validation = buildResultsTableValidation({ report });
    expect(validation.valid).toBe(true);
    expect(validation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: "accuracy_delta_vs_baseline",
          baseline: 0,
          comparator: 0.03,
          delta: 0.03
        })
      ])
    );
  });

  it("extracts a preset runtime guardrail from the experiment plan and removes the stale threshold warning", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve macro-F1 over a logistic regression baseline."
      },
      metrics: {
        value: 0.02,
        condition_metrics: {
          nested: {
            macro_f1_delta_vs_logreg: 0.02,
            runtime_seconds_mean: 11.0
          },
          non_nested: {
            macro_f1_delta_vs_logreg: 0.01,
            runtime_seconds_mean: 10.0
          }
        }
      },
      objectiveProfile: {
        source: "heuristic_fallback",
        raw: "Improve macro-F1 over a logistic regression baseline.",
        primaryMetric: "macro_f1_delta_vs_logreg",
        preferredMetricKeys: ["macro_f1_delta_vs_logreg", "value"],
        comparator: ">",
        targetValue: 0,
        targetDescription: "Macro-F1 should improve over logistic regression.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve macro-F1 over a logistic regression baseline.",
        profileSource: "heuristic_fallback",
        primaryMetric: "macro_f1_delta_vs_logreg",
        preferredMetricKeys: ["macro_f1_delta_vs_logreg", "value"],
        matchedMetricKey: "value",
        comparator: ">",
        targetValue: 0,
        observedValue: 0.02,
        status: "met",
        summary: "Objective metric met: value=0.02 > 0."
      },
      experimentPlanRaw: `
selected_design:
  title: "Variance Reduction"
  evaluation_steps:
    - "Declare support only if median runtime does not increase beyond a predefined practical threshold such as 25 percent."
  risks:
    - "A practical threshold on runtime increase must be specified before analysis to avoid post hoc interpretation."
`
    });

    expect(report.plan_context.selected_design?.runtime_guardrail_pct).toBe(25);
    expect(
      report.limitations.some((line) => /must be specified before analysis/u.test(line))
    ).toBe(false);
    expect(
      report.primary_findings.some((line) => line.includes("runtime-increase guardrail of 25"))
    ).toBe(true);
  });

  it("surfaces experiment portfolio trial groups and links supplemental runs back to the manifest", () => {
    const experimentPortfolio = {
      version: 1 as const,
      run_id: "run-portfolio",
      created_at: "2026-03-25T00:00:00.000Z",
      execution_model: "managed_bundle" as const,
      comparison_axes: ["runner_profile", "dataset", "repeat", "prompt_variant", "baseline"],
      primary_trial_group_id: "primary_standard",
      total_expected_trials: 126,
      trial_groups: [
        {
          id: "primary_standard",
          label: "Primary standard managed run",
          role: "primary" as const,
          profile: "standard",
          expected_trials: 48,
          dataset_scope: ["hotpotqa_mini", "gsm8k_mini", "humaneval_mini"],
          metrics: ["reproducibility_score"],
          baselines: ["free_form_chat baseline"],
          notes: ["Main comparison run."]
        },
        {
          id: "quick_check",
          label: "Quick-check managed replication",
          role: "supplemental" as const,
          profile: "quick_check",
          expected_trials: 6,
          dataset_scope: ["hotpotqa_mini", "gsm8k_mini", "humaneval_mini"],
          metrics: ["reproducibility_score"],
          baselines: ["free_form_chat baseline"],
          notes: ["Low-cost validation run."]
        },
        {
          id: "confirmatory",
          label: "Confirmatory extension",
          role: "supplemental" as const,
          profile: "confirmatory",
          expected_trials: 72,
          dataset_scope: ["hotpotqa_mini", "gsm8k_mini", "humaneval_mini"],
          metrics: ["reproducibility_score"],
          baselines: ["free_form_chat baseline"],
          notes: ["Higher-budget confirmatory run."]
        },
        {
          id: "primary_standard__hotpotqa_mini",
          label: "Primary standard managed run / hotpotqa_mini",
          role: "supplemental" as const,
          profile: "standard",
          group_kind: "matrix_slice" as const,
          source_trial_group_id: "primary_standard",
          matrix_axes: { runner_profile: "standard", dataset: "hotpotqa_mini" },
          expected_trials: 16,
          dataset_scope: ["hotpotqa_mini"],
          metrics: ["reproducibility_score"],
          baselines: ["free_form_chat baseline"],
          notes: ["Matrix slice for dataset hotpotqa_mini."]
        },
        {
          id: "quick_check__hotpotqa_mini",
          label: "Quick-check managed replication / hotpotqa_mini",
          role: "supplemental" as const,
          profile: "quick_check",
          group_kind: "matrix_slice" as const,
          source_trial_group_id: "quick_check",
          matrix_axes: { runner_profile: "quick_check", dataset: "hotpotqa_mini" },
          expected_trials: 2,
          dataset_scope: ["hotpotqa_mini"],
          metrics: ["reproducibility_score"],
          baselines: ["free_form_chat baseline"],
          notes: ["Matrix slice for dataset hotpotqa_mini."]
        }
      ]
    };
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve reproducibility score over the baseline."
      },
      metrics: {
        value: 0.12,
        sampling_profile: {
          total_trials: 48,
          executed_trials: 48,
          cached_trials: 0
        },
        condition_metrics: {
          baseline: {
            reproducibility_score: 0.72
          },
          treatment: {
            reproducibility_score: 0.84
          }
        }
      },
      objectiveProfile: {
        source: "heuristic_fallback",
        raw: "Improve reproducibility score over the baseline.",
        primaryMetric: "value",
        preferredMetricKeys: ["value", "reproducibility_score"],
        comparator: ">",
        targetValue: 0,
        targetDescription: "Reproducibility score should increase.",
        analysisFocus: [],
        paperEmphasis: [],
        assumptions: []
      },
      objectiveEvaluation: {
        rawObjectiveMetric: "Improve reproducibility score over the baseline.",
        profileSource: "heuristic_fallback",
        primaryMetric: "value",
        preferredMetricKeys: ["value", "reproducibility_score"],
        matchedMetricKey: "value",
        comparator: ">",
        targetValue: 0,
        observedValue: 0.12,
        status: "met",
        summary: "Objective metric met: value=0.12 > 0."
      },
      experimentPortfolio,
      runManifest: {
        version: 1,
        run_id: "run-portfolio",
        generated_at: "2026-03-25T00:01:00.000Z",
        execution_model: "managed_bundle",
        primary_command: "python3 run.py --profile standard",
        primary_metrics_path: ".autolabos/runs/run-portfolio/metrics.json",
        total_expected_trials: 126,
        executed_trials: 54,
        cached_trials: 0,
        portfolio: experimentPortfolio,
        trial_groups: [
          {
            ...experimentPortfolio.trial_groups[0],
            status: "pass",
            metrics_path: ".autolabos/runs/run-portfolio/metrics.json",
            summary: "Primary run passed.",
            objective_evaluation: {
              rawObjectiveMetric: "Improve reproducibility score over the baseline.",
              profileSource: "heuristic_fallback",
              primaryMetric: "value",
              preferredMetricKeys: ["value", "reproducibility_score"],
              matchedMetricKey: "value",
              comparator: ">",
              targetValue: 0,
              observedValue: 0.12,
              status: "met",
              summary: "Objective metric met: value=0.12 > 0."
            },
            sampling_profile: {
              name: "standard",
              total_trials: 48,
              executed_trials: 48,
              cached_trials: 0
            }
          },
          {
            ...experimentPortfolio.trial_groups[1],
            status: "pass",
            metrics_path: "quick_check_metrics.json",
            summary: "Quick-check passed.",
            sampling_profile: {
              name: "quick_check",
              total_trials: 6,
              executed_trials: 6,
              cached_trials: 0
            }
          },
          {
            ...experimentPortfolio.trial_groups[2],
            status: "skipped",
            metrics_path: "confirmatory_metrics.json",
            summary: "Confirmatory run skipped because quick_check did not justify escalation."
          },
          {
            ...experimentPortfolio.trial_groups[3],
            status: "pass",
            metrics_path: ".autolabos/runs/run-portfolio/trial_group_metrics/primary_standard__hotpotqa_mini.json",
            summary: "Matrix slice hotpotqa_mini (profile=standard) from Primary standard managed run. mean_task_score_delta=0.1200.",
            sampling_profile: {
              name: "standard",
              total_trials: 16,
              executed_trials: 16,
              cached_trials: 0
            }
          },
          {
            ...experimentPortfolio.trial_groups[4],
            status: "pass",
            metrics_path: ".autolabos/runs/run-portfolio/trial_group_metrics/quick_check__hotpotqa_mini.json",
            summary: "Matrix slice hotpotqa_mini (profile=quick_check) from Quick-check managed replication. mean_task_score_delta=0.0800.",
            sampling_profile: {
              name: "quick_check",
              total_trials: 2,
              executed_trials: 2,
              cached_trials: 0
            }
          }
        ]
      },
      supplementalMetrics: [
        {
          profile: "quick_check",
          path: "quick_check_metrics.json",
          metrics: {
            value: 0.08,
            sampling_profile: {
              name: "quick_check",
              total_trials: 6,
              executed_trials: 6,
              cached_trials: 0
            }
          }
        }
      ],
      supplementalExpectation: {
        applicable: true,
        profiles: ["quick_check", "confirmatory"]
      }
    });

    expect(report.experiment_portfolio).toMatchObject({
      execution_model: "managed_bundle",
      total_expected_trials: 126,
      executed_trials: 54
    });
    expect(report.experiment_portfolio?.trial_groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "primary_standard", status: "pass", executed_trials: 48 }),
      expect.objectContaining({ id: "quick_check", status: "pass", executed_trials: 6 }),
      expect.objectContaining({ id: "confirmatory", status: "skipped" }),
      expect.objectContaining({
        id: "primary_standard__hotpotqa_mini",
        group_kind: "matrix_slice",
        status: "pass",
        executed_trials: 16
      }),
      expect.objectContaining({
        id: "quick_check__hotpotqa_mini",
        group_kind: "matrix_slice",
        status: "pass",
        executed_trials: 2
      })
    ]));
    expect(report.supplemental_runs[0]?.portfolio).toMatchObject({
      trial_group_id: "quick_check",
      trial_group_label: "Quick-check managed replication",
      execution_model: "managed_bundle"
    });
    expect(report.primary_findings.some((line) => line.includes("Execution portfolio"))).toBe(true);
  });
});
