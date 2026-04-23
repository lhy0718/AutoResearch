import { describe, expect, it } from "vitest";

import { buildAnalysisReport } from "../src/core/resultAnalysis.js";

describe("resultAnalysis", () => {
  it("projects node-owned metrics.results rows into baseline/comparator condition comparisons", () => {
    const report = buildAnalysisReport({
      run: {
        objectiveMetric: "Improve mean zero-shot accuracy over the LoRA baseline."
      },
      metrics: {
        accuracy_delta_vs_baseline: 0,
        baseline_mean_accuracy: 0.546875,
        best_mean_accuracy: 0.546875,
        best_recipe: "lora_qv_r8",
        results: [
          {
            recipe: "baseline",
            peft_type: "none",
            status: "completed",
            mean_accuracy: 0.546875,
            arc_challenge_accuracy: 0.53125,
            hellaswag_accuracy: 0.5625,
            accuracy_delta_vs_baseline: 0,
            wall_clock_seconds: 7.5
          },
          {
            recipe: "lora_qv_r8",
            peft_type: "lora",
            status: "completed",
            mean_accuracy: 0.546875,
            arc_challenge_accuracy: 0.53125,
            hellaswag_accuracy: 0.5625,
            accuracy_delta_vs_baseline: 0,
            wall_clock_seconds: 24.0,
            peak_gpu_memory_allocated_bytes: 4477727232
          }
        ]
      },
      objectiveProfile: {
        source: "llm",
        raw: "Improve mean zero-shot accuracy over the LoRA baseline.",
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
        rawObjectiveMetric: "Improve mean zero-shot accuracy over the LoRA baseline.",
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
      id: "lora_qv_r8_vs_baseline",
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
