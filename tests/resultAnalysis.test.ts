import { describe, expect, it } from "vitest";

import { buildAnalysisReport } from "../src/core/resultAnalysis.js";

describe("resultAnalysis", () => {
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
          dataset_scope: ["research_bench_alpha"],
          metrics: ["reproducibility_score"],
          baselines: ["free_form_chat baseline"],
          notes: ["Higher-budget confirmatory run."]
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
    expect(report.experiment_portfolio?.trial_groups).toEqual([
      expect.objectContaining({ id: "primary_standard", status: "pass", executed_trials: 48 }),
      expect.objectContaining({ id: "quick_check", status: "pass", executed_trials: 6 }),
      expect.objectContaining({ id: "confirmatory", status: "skipped" })
    ]);
    expect(report.supplemental_runs[0]?.portfolio).toMatchObject({
      trial_group_id: "quick_check",
      trial_group_label: "Quick-check managed replication",
      execution_model: "managed_bundle"
    });
    expect(report.primary_findings.some((line) => line.includes("Execution portfolio"))).toBe(true);
  });
});
