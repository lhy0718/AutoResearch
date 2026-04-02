import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
import { ObjectiveMetricProfile, resolveObjectiveMetricProfile } from "../objectiveMetric.js";
import {
  designExperimentsFromHypotheses,
  DesignInputHypothesis,
  DesignRetryContext,
  ExperimentDesignCandidate
} from "../analysis/researchPlanning.js";
import { supportsRealExecutionBundle } from "../experiments/realExecutionBundle.js";
import { buildExperimentPortfolioFromDesign } from "../experiments/experimentPortfolio.js";
import { runDesignExperimentsPanel } from "../designExperimentsPanel.js";
import {
  buildExperimentComparisonContract,
  storeExperimentGovernanceDecision
} from "../experimentGovernance.js";
import {
  buildExperimentContract,
  writeExperimentContract,
  validateExperimentContract
} from "../experiments/experimentContract.js";
import { checkBriefDesignConsistency } from "../experiments/briefDesignConsistency.js";
import { parseMarkdownRunBriefSections } from "../runs/runBriefParser.js";
import type { MarkdownRunBriefSections } from "../runs/runBriefParser.js";
import { BriefCompletenessArtifact, buildBriefCompletenessArtifact } from "../runs/researchBriefFiles.js";

interface FilteredHypothesis {
  hypothesis_id: string;
  text: string;
  reason: string;
}

const MANAGED_EXECUTABLE_DESIGN = {
  runner_id: "managed_real_execution_bundle",
  conditions: [
    "free_form_chat: planner, solver, and verifier hand off natural-language notes.",
    "shared_state_schema: planner, solver, and verifier hand off structured JSON shared state."
  ],
  standard_profile: {
    repeats: 2,
    prompt_variants: 2,
    tasks_per_dataset: 2,
    dataset_count: 3,
    total_trials: 48
  },
  quick_check_profile: {
    repeats: 1,
    prompt_variants: 1,
    tasks_per_dataset: 1,
    dataset_count: 3,
    total_trials: 6
  },
  confirmatory_profile: {
    repeats: 3,
    prompt_variants: 2,
    tasks_per_dataset: 2,
    dataset_count: 3,
    total_trials: 72
  },
  supported_dataset_ids: [
    "hotpotqa_mini",
    "gsm8k_mini",
    "humaneval_mini"
  ],
  supported_benchmarks: [
    "hotpotqa_mini (2 tasks in standard, 1 task in quick_check)",
    "gsm8k_mini (2 tasks in standard, 1 task in quick_check)",
    "humaneval_mini (2 tasks in standard, 1 task in quick_check)"
  ],
  execution_settings: {
    max_workers: 2,
    planner_reasoning_effort: "low",
    planner_fast_mode: true,
    solver_reasoning_effort: "medium",
    verifier_reasoning_effort: "medium"
  },
  implemented_perturbations: [
    "Prompt phrasing / coordination-style variation via neutral vs compressed collaboration instructions."
  ],
  supported_metrics: [
    "reproducibility_score",
    "replication_success_rate",
    "cross_run_variance",
    "run_to_run_variance",
    "seed_stability",
    "prompt_paraphrase_sensitivity",
    "slot_consistency",
    "artifact_availability",
    "artifact_consistency_rate",
    "environment_rebuild_success"
  ],
  supported_baselines: [
    "free_form_chat baseline",
    "shared_state_schema treatment arm",
    "recent-paper reproducibility comparison derived from the collected 2022-2026 corpus"
  ]
} as const;

export function createDesignExperimentsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "design_experiments",
    async execute({ run }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const emitLog = (text: string) => {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "design_experiments",
          payload: { text }
        });
      };

      const constraintProfile = await resolveConstraintProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "design_experiments"
      });
      const objectiveMetricProfile = await resolveObjectiveMetricProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "design_experiments"
      });

      const hypothesesPath = path.join(".autolabos", "runs", run.id, "hypotheses.jsonl");
      const hypotheses = parseHypotheses(await safeRead(hypothesesPath));
      if (hypotheses.length === 0) {
        const message =
          "No valid hypotheses were found for experiment design. Generate hypotheses first or repair hypotheses.jsonl.";
        emitLog(message);
        return {
          status: "failure",
          error: message,
          summary: message,
          toolCallsUsed: 0
        };
      }
      const filtered = filterDesignHypotheses(hypotheses, objectiveMetricProfile);
      if (filtered.dropped.length > 0) {
        emitLog(
          `Filtered ${filtered.dropped.length} weak hypothesis/hypotheses before experiment design; keeping ${filtered.kept.length}.`
        );
      }

      const retryContext = await loadDesignRetryContext(run.id);
      if (retryContext) {
        emitLog(
          `Loaded design retry context from prior results: pilot_size=${retryContext.previous_pilot_size ?? "unknown"}, repeats=${retryContext.previous_repeats ?? "unknown"}, objective_status=${retryContext.previous_objective_status ?? "unknown"}.`
        );
        await writeRunArtifact(
          run,
          "design_experiments_panel/retry_context.json",
          `${JSON.stringify(retryContext, null, 2)}\n`
        );
        await runContextMemory.put("design_experiments.retry_context", retryContext);
      }

      emitLog(`Designing experiments from ${filtered.kept.length} hypothesis/hypotheses.`);
      const design = await designExperimentsFromHypotheses({
        llm: deps.llm,
        runTitle: run.title,
        runTopic: run.topic,
        objectiveMetric: run.objectiveMetric,
        hypotheses: filtered.kept,
        constraintProfile,
        objectiveProfile: objectiveMetricProfile,
        retryContext,
        candidateCount: 3,
        onProgress: emitLog
      });
      const normalizedCandidates = design.candidates.map(normalizeCandidateProtocolGuardrails);
      const managedBundleSupported = supportsRealExecutionBundle({
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        constraints: run.constraints
      });
      const panelResult = runDesignExperimentsPanel({
        candidates: normalizedCandidates,
        objectiveProfile: objectiveMetricProfile,
        managedBundleSupported
      });

      const planYaml = buildPlanYaml({
        run,
        hypotheses: filtered.kept,
        droppedHypotheses: filtered.dropped,
        selected: panelResult.selected,
        candidates: normalizedCandidates,
        constraintProfile,
        objectiveProfile: objectiveMetricProfile,
        source: design.source,
        retryContext
      });

      const outputPath = await writeRunArtifact(run, "experiment_plan.yaml", planYaml);
      await fs.access(outputPath);
      await writeRunArtifact(
        run,
        "design_experiments_panel/candidates.json",
        `${JSON.stringify(normalizedCandidates, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "design_experiments_panel/reviews.json",
        `${JSON.stringify(panelResult.reviews, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "design_experiments_panel/selection.json",
        `${JSON.stringify(panelResult.selection, null, 2)}\n`
      );
      const comparisonContract = buildExperimentComparisonContract({
        run,
        selectedDesign: panelResult.selected,
        objectiveProfile: objectiveMetricProfile,
        managedBundleSupported
      });
      await storeExperimentGovernanceDecision(run, runContextMemory, {
        contract: comparisonContract,
        entries: []
      });
      const rawBrief = await runContextMemory.get<string>("run_brief.raw");
      const briefSections = rawBrief ? parseMarkdownRunBriefSections(rawBrief) : undefined;
      const briefCompleteness =
        (await runContextMemory.get<BriefCompletenessArtifact>("run_brief.completeness")) ??
        (rawBrief ? buildBriefCompletenessArtifact(rawBrief) : undefined);

      // --- Experiment contract: causal discipline artifact (Target 1+2) ---
      const selectedHypotheses = filtered.kept.filter(
        (h) => panelResult.selected.hypothesis_ids.includes(h.hypothesis_id)
      );
      const hypothesisText = selectedHypotheses.map((h) => h.text).join("; ") || run.objectiveMetric;
      const experimentContract = buildExperimentContract({
        run,
        hypothesis: hypothesisText,
        causalMechanism: panelResult.selected.plan_summary,
        singleChange: panelResult.selected.title,
        additionalChanges: panelResult.selected.baselines.length > 1
          ? panelResult.selected.baselines.slice(1).map((b) => `additional baseline: ${b}`)
          : [],
        expectedMetricEffect: `Improve ${run.objectiveMetric} relative to baseline(s): ${panelResult.selected.baselines.join(", ") || "none specified"}.`,
        abortCondition: panelResult.selected.risks.length > 0
          ? `Abort if: ${panelResult.selected.risks[0]}`
          : "Abort if primary metric degrades significantly or execution fails repeatedly.",
        keepOrDiscardRule: "Keep if objective metric improves over baseline; discard if no improvement or result is inconclusive.",
        baselines: panelResult.selected.baselines,
        metrics: panelResult.selected.metrics,
        resultsTableDirection: objectiveMetricProfile.direction === "minimize" ? "lower_better" : "higher_better",
        briefRequiredBaselineCount: deriveBriefRequiredBaselineCount(briefSections)
      });
      const contractValidation = validateExperimentContract(experimentContract);
      if (contractValidation.issues.length > 0) {
        emitLog(`Experiment contract notes: ${contractValidation.issues.join("; ")}`);
      }
      if (!experimentContract.results_table_schema || experimentContract.results_table_schema.length === 0) {
        const message =
          "Experiment contract is missing results_table_schema. Design must declare at least one metric and direction before execution.";
        emitLog(message);
        return {
          status: "failure",
          error: message,
          summary: message,
          toolCallsUsed: 0
        };
      }
      await writeExperimentContract(run, experimentContract);
      const experimentPortfolio = buildExperimentPortfolioFromDesign({
        runId: run.id,
        selectedDesign: panelResult.selected,
        managedConfig: managedBundleSupported
          ? {
              comparison_axes: ["runner_profile", "dataset", "repeat", "prompt_variant", "baseline"],
              primary: {
                id: "primary_standard",
                label: "Primary standard managed run",
                profile: "standard",
                expected_trials: MANAGED_EXECUTABLE_DESIGN.standard_profile.total_trials,
                dataset_scope: [...MANAGED_EXECUTABLE_DESIGN.supported_dataset_ids],
                metrics: [...MANAGED_EXECUTABLE_DESIGN.supported_metrics],
                baselines: [...MANAGED_EXECUTABLE_DESIGN.supported_baselines],
                notes: [
                  panelResult.selected.plan_summary,
                  ...MANAGED_EXECUTABLE_DESIGN.conditions,
                  ...panelResult.selected.evaluation_steps
                ]
              },
              supplemental: [
                {
                  id: "quick_check",
                  label: "Quick-check managed replication",
                  profile: "quick_check",
                  expected_trials: MANAGED_EXECUTABLE_DESIGN.quick_check_profile.total_trials,
                  dataset_scope: [...MANAGED_EXECUTABLE_DESIGN.supported_dataset_ids],
                  metrics: [...MANAGED_EXECUTABLE_DESIGN.supported_metrics],
                  baselines: [...MANAGED_EXECUTABLE_DESIGN.supported_baselines],
                  notes: [
                    "Low-cost validation run gated on the primary objective result.",
                    ...panelResult.selected.implementation_notes
                  ]
                },
                {
                  id: "confirmatory",
                  label: "Confirmatory extension",
                  profile: "confirmatory",
                  expected_trials: MANAGED_EXECUTABLE_DESIGN.confirmatory_profile.total_trials,
                  dataset_scope: [...MANAGED_EXECUTABLE_DESIGN.supported_dataset_ids],
                  metrics: panelResult.selected.metrics,
                  baselines: panelResult.selected.baselines,
                  notes: [
                    "Higher-budget confirmatory run gated on the quick_check outcome.",
                    ...panelResult.selected.evaluation_steps,
                    ...panelResult.selected.resource_notes
                  ]
                }
              ]
            }
          : undefined
      });
      await writeRunArtifact(
        run,
        "experiment_portfolio.json",
        `${JSON.stringify(experimentPortfolio, null, 2)}\n`
      );

      // --- Baseline summary artifact (for review gate) ---
      const baselineSummary = buildBaselineSummary({
        selected: panelResult.selected,
        comparisonContract,
        experimentContract,
        objectiveMetric: run.objectiveMetric
      });
      await writeRunArtifact(
        run,
        "baseline_summary.json",
        `${JSON.stringify(baselineSummary, null, 2)}\n`
      );

      await runContextMemory.put("design_experiments.experiment_contract", experimentContract);
      await runContextMemory.put("design_experiments.portfolio", experimentPortfolio);

      // --- Brief-vs-design consistency check (Target 2) ---
      if (briefCompleteness) {
        await writeRunArtifact(
          run,
          "design_experiments_panel/brief_completeness.json",
          `${JSON.stringify(briefCompleteness, null, 2)}\n`
        );
        await runContextMemory.put("design_experiments.brief_completeness", briefCompleteness);
      }
      const consistencyResult = checkBriefDesignConsistency({
        briefSections: briefSections ?? undefined,
        briefCompleteness: briefCompleteness ?? undefined,
        experimentContract,
        designTitle: panelResult.selected.title,
        designBaselines: panelResult.selected.baselines,
        designMetrics: panelResult.selected.metrics
      });
      await writeRunArtifact(
        run,
        "design_experiments_panel/brief_design_consistency.json",
        `${JSON.stringify(consistencyResult, null, 2)}\n`
      );
      await runContextMemory.put("design_experiments.brief_design_consistency", consistencyResult);
      if (consistencyResult.warnings.length > 0) {
        const errors = consistencyResult.warnings.filter((w) => w.severity === "error");
        const warns = consistencyResult.warnings.filter((w) => w.severity === "warning");
        if (errors.length > 0) {
          emitLog(`Brief-design consistency: ${errors.length} error(s) — ${errors.map((e) => e.code).join(", ")}`);
        }
        if (warns.length > 0) {
          emitLog(`Brief-design consistency: ${warns.length} warning(s) — ${warns.map((w) => w.code).join(", ")}`);
        }
      }
      await runContextMemory.put("design_experiments.paper_scale_blocked", consistencyResult.paper_scale_blocked);
      if (rawBrief && consistencyResult.paper_scale_blocked) {
        const blockingCodes = consistencyResult.warnings
          .filter((warning) => warning.severity === "error")
          .map((warning) => warning.code)
          .join(", ");
        const error = `Brief contract blocked design progression: ${blockingCodes || "brief governance requirements not met"}.`;
        emitLog(error);
        return {
          status: "failure",
          error,
          summary: error,
          toolCallsUsed: 1
        };
      }

      await runContextMemory.put("design_experiments.primary", panelResult.selected.title);
      await runContextMemory.put("design_experiments.source", design.source);
      await runContextMemory.put("design_experiments.summary", design.summary);
      await runContextMemory.put("design_experiments.hypothesis_count", filtered.kept.length);
      await runContextMemory.put("design_experiments.filtered_out_count", filtered.dropped.length);
      await runContextMemory.put("design_experiments.panel_selection", panelResult.selection);
      const publicOutputs = await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "design_experiments",
        runContext: runContextMemory,
        section: "experiment",
        files: [
          {
            sourcePath: outputPath,
            targetRelativePath: "experiment_plan.yaml"
          },
          {
            sourcePath: path.join(process.cwd(), ".autolabos", "runs", run.id, "experiment_portfolio.json"),
            targetRelativePath: "experiment_portfolio.json",
            optional: true
          },
          {
            sourcePath: path.join(process.cwd(), ".autolabos", "runs", run.id, "baseline_summary.json"),
            targetRelativePath: "baseline_summary.json",
            optional: true
          }
        ]
      });

      deps.eventStream.emit({
        type: "PLAN_CREATED",
        runId: run.id,
        node: "design_experiments",
        payload: {
          candidateCount: normalizedCandidates.length,
          selectedId: panelResult.selected.id,
          source: design.source,
          fallbackReason: design.fallbackReason
        }
      });

      emitLog(
        `Selected design "${panelResult.selected.title}" from ${normalizedCandidates.length} candidate(s) using ${design.source} with ${panelResult.selection.mode}.`
      );
      emitLog(`Public experiment outputs are available at ${publicOutputs.sectionDirRelative}.`);

      return {
        status: "success",
        summary: design.fallbackReason
          ? `${design.summary} Selected "${panelResult.selected.title}" via ${panelResult.selection.mode}. Falling back after: ${design.fallbackReason}. Public outputs: ${publicOutputs.outputRootRelative}.`
          : `${design.summary} Selected "${panelResult.selected.title}" via ${panelResult.selection.mode}. Public outputs: ${publicOutputs.outputRootRelative}.`,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

function deriveBriefRequiredBaselineCount(briefSections?: MarkdownRunBriefSections): number | undefined {
  const text = [briefSections?.baselineComparator, briefSections?.targetComparison]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  if (!text.trim()) {
    return undefined;
  }

  const numericMatches = [...text.matchAll(/\b(\d+)\s+(?:explicit\s+)?(?:baselines?|comparators?)\b/giu)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numericMatches.length > 0) {
    return Math.max(...numericMatches);
  }

  if (/\b(?:two|pair(?:ed)?|double)\b[\s\S]{0,24}\b(?:baselines?|comparators?)\b/iu.test(text)) {
    return 2;
  }

  return 1;
}

function parseHypotheses(raw: string): DesignInputHypothesis[] {
  const items: Array<DesignInputHypothesis | undefined> = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line) as DesignInputHypothesis;
        return {
          hypothesis_id: parsed.hypothesis_id || `h_${index + 1}`,
          text: parsed.text,
          score: parsed.score,
          evidence_links: parsed.evidence_links,
          groundedness: parsed.groundedness,
          causal_clarity: parsed.causal_clarity,
          falsifiability: parsed.falsifiability,
          experimentability: parsed.experimentability,
          reproducibility_specificity: parsed.reproducibility_specificity,
          reproducibility_signals: parsed.reproducibility_signals,
          measurement_hint: parsed.measurement_hint,
          boundary_condition: parsed.boundary_condition,
          limitation_reflection: parsed.limitation_reflection,
          measurement_readiness: parsed.measurement_readiness,
          critique_summary: parsed.critique_summary
        };
      } catch {
        return undefined;
      }
    });
  return items.filter((item): item is DesignInputHypothesis => item !== undefined && Boolean(item.text));
}

function normalizeCandidateProtocolGuardrails(candidate: ExperimentDesignCandidate): ExperimentDesignCandidate {
  const thresholdPercent = detectPracticalThresholdPercent(candidate);
  if (thresholdPercent === undefined) {
    return candidate;
  }

  const normalizedSummary = normalizePracticalThresholdLanguage(candidate.plan_summary, thresholdPercent);
  const normalizedEvaluationSteps = uniqueStrings(
    candidate.evaluation_steps.map((item) => normalizePracticalThresholdLanguage(item, thresholdPercent))
  );
  const normalizedRisks = uniqueStrings(
    candidate.risks.filter((item) => !isMissingPracticalThresholdRisk(item))
  );
  const normalizedResourceNotes = uniqueStrings([
    ...candidate.resource_notes,
    `Pre-registered runtime and memory guardrail: no more than ${thresholdPercent}% above the matched baseline.`
  ]);

  return {
    ...candidate,
    plan_summary: normalizedSummary,
    evaluation_steps: normalizedEvaluationSteps,
    risks: normalizedRisks,
    resource_notes: normalizedResourceNotes
  };
}

function detectPracticalThresholdPercent(candidate: ExperimentDesignCandidate): number | undefined {
  const sources = [candidate.plan_summary, ...candidate.evaluation_steps, ...candidate.risks, ...candidate.resource_notes];
  for (const source of sources) {
    const explicitMatch = source.match(/predefined practical threshold(?: such as)?\s+(\d+(?:\.\d+)?)\s*percent/iu);
    if (explicitMatch) {
      return Number(explicitMatch[1]);
    }
    const numericGuardrail = source.match(/runtime(?: or memory)? by more than\s+(\d+(?:\.\d+)?)\s*percent/iu);
    if (numericGuardrail) {
      return Number(numericGuardrail[1]);
    }
  }
  return undefined;
}

function normalizePracticalThresholdLanguage(text: string, thresholdPercent: number): string {
  return text
    .replace(
      /by more than a predefined practical threshold such as \d+(?:\.\d+)? percent/giu,
      `by more than ${thresholdPercent}% relative to the matched baseline`
    )
    .replace(
      /by more than a predefined practical threshold/giu,
      `by more than ${thresholdPercent}% relative to the matched baseline`
    )
    .replace(
      /predefined practical threshold such as \d+(?:\.\d+)? percent/giu,
      `${thresholdPercent}% relative to the matched baseline`
    )
    .replace(
      /predefined practical threshold/giu,
      `${thresholdPercent}% relative to the matched baseline`
    );
}

function isMissingPracticalThresholdRisk(text: string): boolean {
  return /practical threshold on runtime increase must be specified before analysis to avoid post hoc interpretation/iu.test(
    text
  );
}

function buildPlanYaml(args: {
  run: { id: string; topic: string; objectiveMetric: string; constraints: string[] };
  hypotheses: DesignInputHypothesis[];
  droppedHypotheses: FilteredHypothesis[];
  selected: ExperimentDesignCandidate;
  candidates: ExperimentDesignCandidate[];
  constraintProfile: Awaited<ReturnType<typeof resolveConstraintProfile>>;
  objectiveProfile: Awaited<ReturnType<typeof resolveObjectiveMetricProfile>>;
  source: "llm" | "fallback";
  retryContext?: DesignRetryContext;
}): string {
  const collectDefaults = args.constraintProfile.collect;
  const paperProfile = args.constraintProfile.writing;
  const useManagedExecutableSections = supportsRealExecutionBundle({
    topic: args.run.topic,
    objectiveMetric: args.run.objectiveMetric,
    constraints: args.run.constraints
  });

  return [
    `run_id: ${args.run.id}`,
    `topic: "${escapeQuote(args.run.topic)}"`,
    "objective:",
    `  metric: "${escapeQuote(args.run.objectiveMetric)}"`,
    `  primary_metric: "${escapeQuote(args.objectiveProfile.primaryMetric || "unspecified")}"`,
    `  target: "${escapeQuote(args.objectiveProfile.targetDescription || "observe and improve")}"`,
    "constraints:",
    "  raw:",
    ...renderYamlStringList(args.run.constraints, 2),
    "  collect_defaults:",
    ...renderYamlKeyValueObject(
      {
        last_years: collectDefaults.lastYears,
        open_access_pdf: collectDefaults.openAccessPdf,
        min_citation_count: collectDefaults.minCitationCount,
        publication_types: collectDefaults.publicationTypes
      },
      2
    ),
    "  writing_defaults:",
    ...renderYamlKeyValueObject(
      {
        target_venue: paperProfile.targetVenue,
        tone_hint: paperProfile.toneHint,
        length_hint: paperProfile.lengthHint
      },
      2
    ),
    "  experiment_guidance:",
    ...renderYamlKeyValueObject(
      {
        profile_source: args.constraintProfile.source,
        objective_profile_source: args.objectiveProfile.source,
        design_source: args.source
      },
      2
    ),
    "  design_notes:",
    ...renderYamlStringList(args.constraintProfile.experiment.designNotes, 2),
    "  implementation_notes:",
    ...renderYamlStringList(args.constraintProfile.experiment.implementationNotes, 2),
    "  evaluation_notes:",
    ...renderYamlStringList(args.constraintProfile.experiment.evaluationNotes, 2),
    "  assumptions:",
    ...renderYamlStringList(args.constraintProfile.assumptions, 2),
    "hypotheses:",
    ...args.hypotheses.map((item) => `  - "${escapeQuote(item.text)}"`),
    "hypothesis_filter:",
    `  retained_count: ${args.hypotheses.length}`,
    `  dropped_count: ${args.droppedHypotheses.length}`,
    `  objective_sensitive: ${isReproducibilityObjective(args.objectiveProfile) ? "true" : "false"}`,
    "dropped_hypotheses:",
    ...renderDroppedHypotheses(args.droppedHypotheses),
    "retry_context:",
    `  present: ${args.retryContext ? "true" : "false"}`,
    ...(args.retryContext
      ? renderYamlKeyValueObject(
          {
            previous_selected_design_title: args.retryContext.previous_selected_design_title,
            previous_pilot_size: args.retryContext.previous_pilot_size,
            previous_repeats: args.retryContext.previous_repeats,
            registered_pilot_size: args.retryContext.registered_pilot_size,
            registered_repeats: args.retryContext.registered_repeats,
            previous_primary_metric_name: args.retryContext.previous_primary_metric_name,
            previous_primary_metric_value: args.retryContext.previous_primary_metric_value,
            previous_baseline_name: args.retryContext.previous_baseline_name,
            previous_objective_status: args.retryContext.previous_objective_status,
            transition_action: args.retryContext.transition_action,
            transition_reason: args.retryContext.transition_reason
          },
          1
        )
      : []),
    "  retry_directives:",
    ...renderYamlStringList(args.retryContext?.retry_directives || [], 2),
    "selected_hypothesis_ids:",
    ...renderYamlStringList(args.selected.hypothesis_ids, 1),
    "selected_design:",
    `  id: "${escapeQuote(args.selected.id)}"`,
    `  title: "${escapeQuote(args.selected.title)}"`,
    `  summary: "${escapeQuote(args.selected.plan_summary)}"`,
    ...(useManagedExecutableSections
      ? renderManagedExecutableDesignSection(args.selected)
      : renderLegacySelectedDesignSection(args.selected)),
    "shortlisted_designs:",
    ...renderShortlistedDesigns(args.candidates),
    "execution:",
    "  container: local",
    "  timeout_sec: 1800"
  ].join("\n");
}

function renderManagedExecutableDesignSection(selected: ExperimentDesignCandidate): string[] {
  return [
    "  executable_design:",
    `    runner: "${MANAGED_EXECUTABLE_DESIGN.runner_id}"`,
    "    conditions:",
    ...renderYamlStringList([...MANAGED_EXECUTABLE_DESIGN.conditions], 3),
    "    standard_profile:",
    ...renderYamlKeyValueObject(
      {
        repeats: MANAGED_EXECUTABLE_DESIGN.standard_profile.repeats,
        prompt_variants: MANAGED_EXECUTABLE_DESIGN.standard_profile.prompt_variants,
        tasks_per_dataset: MANAGED_EXECUTABLE_DESIGN.standard_profile.tasks_per_dataset,
        dataset_count: MANAGED_EXECUTABLE_DESIGN.standard_profile.dataset_count,
        total_trials: MANAGED_EXECUTABLE_DESIGN.standard_profile.total_trials
      },
      3
    ),
    "    quick_check_profile:",
    ...renderYamlKeyValueObject(
      {
        repeats: MANAGED_EXECUTABLE_DESIGN.quick_check_profile.repeats,
        prompt_variants: MANAGED_EXECUTABLE_DESIGN.quick_check_profile.prompt_variants,
        tasks_per_dataset: MANAGED_EXECUTABLE_DESIGN.quick_check_profile.tasks_per_dataset,
        dataset_count: MANAGED_EXECUTABLE_DESIGN.quick_check_profile.dataset_count,
        total_trials: MANAGED_EXECUTABLE_DESIGN.quick_check_profile.total_trials
      },
      3
    ),
    "    benchmarks:",
    ...renderYamlStringList([...MANAGED_EXECUTABLE_DESIGN.supported_benchmarks], 3),
    "    execution_settings:",
    ...renderYamlKeyValueObject(
      {
        max_workers: MANAGED_EXECUTABLE_DESIGN.execution_settings.max_workers,
        planner_reasoning_effort: MANAGED_EXECUTABLE_DESIGN.execution_settings.planner_reasoning_effort,
        planner_fast_mode: MANAGED_EXECUTABLE_DESIGN.execution_settings.planner_fast_mode,
        solver_reasoning_effort: MANAGED_EXECUTABLE_DESIGN.execution_settings.solver_reasoning_effort,
        verifier_reasoning_effort: MANAGED_EXECUTABLE_DESIGN.execution_settings.verifier_reasoning_effort
      },
      3
    ),
    "    implemented_metrics:",
    ...renderYamlStringList([...MANAGED_EXECUTABLE_DESIGN.supported_metrics], 3),
    "    implemented_perturbations:",
    ...renderYamlStringList([...MANAGED_EXECUTABLE_DESIGN.implemented_perturbations], 3),
    "    supported_baselines:",
    ...renderYamlStringList([...MANAGED_EXECUTABLE_DESIGN.supported_baselines], 3),
    "  confirmatory_extension:",
    "    available_runner_profile:",
    "      confirmatory:",
    ...renderYamlKeyValueObject(
      {
        repeats: MANAGED_EXECUTABLE_DESIGN.confirmatory_profile.repeats,
        prompt_variants: MANAGED_EXECUTABLE_DESIGN.confirmatory_profile.prompt_variants,
        tasks_per_dataset: MANAGED_EXECUTABLE_DESIGN.confirmatory_profile.tasks_per_dataset,
        dataset_count: MANAGED_EXECUTABLE_DESIGN.confirmatory_profile.dataset_count,
        total_trials: MANAGED_EXECUTABLE_DESIGN.confirmatory_profile.total_trials
      },
      4
    ),
    "    research_scale_datasets:",
    ...renderYamlStringList(uniqueStrings(selected.datasets), 3),
    "    additional_metrics_and_protocol:",
    ...renderYamlStringList(uniqueStrings(selected.metrics), 3),
    "    additional_baselines:",
    ...renderYamlStringList(uniqueStrings(selected.baselines), 3),
    "    implementation_notes:",
    ...renderYamlStringList(uniqueStrings(selected.implementation_notes), 3),
    "    evaluation_steps:",
    ...renderYamlStringList(uniqueStrings(selected.evaluation_steps), 3),
    "    risks:",
    ...renderYamlStringList(uniqueStrings(selected.risks), 3),
    "    resource_notes:",
    ...renderYamlStringList(uniqueStrings(selected.resource_notes), 3)
  ];
}

function renderLegacySelectedDesignSection(selected: ExperimentDesignCandidate): string[] {
  return [
    "  datasets:",
    ...renderYamlStringList(selected.datasets, 2),
    "  metrics:",
    ...renderYamlStringList(selected.metrics, 2),
    "  baselines:",
    ...renderYamlStringList(selected.baselines, 2),
    "  implementation_notes:",
    ...renderYamlStringList(selected.implementation_notes, 2),
    "  evaluation_steps:",
    ...renderYamlStringList(selected.evaluation_steps, 2),
    "  risks:",
    ...renderYamlStringList(selected.risks, 2),
    "  resource_notes:",
    ...renderYamlStringList(selected.resource_notes, 2)
  ];
}

function renderShortlistedDesigns(candidates: ExperimentDesignCandidate[]): string[] {
  if (candidates.length === 0) {
    return ['  - "none"'];
  }
  const lines: string[] = [];
  for (const candidate of candidates) {
    lines.push(`  - id: "${escapeQuote(candidate.id)}"`);
    lines.push(`    title: "${escapeQuote(candidate.title)}"`);
    lines.push(`    summary: "${escapeQuote(candidate.plan_summary)}"`);
  }
  return lines;
}

async function loadDesignRetryContext(runId: string): Promise<DesignRetryContext | undefined> {
  const runDir = path.join(".autolabos", "runs", runId);
  const [resultRaw, transitionRaw] = await Promise.all([
    safeRead(path.join(runDir, "result_analysis.json")),
    safeRead(path.join(runDir, "transition_recommendation.json"))
  ]);
  if (!resultRaw && !transitionRaw) {
    return undefined;
  }

  const resultAnalysis = parseJsonRecord(resultRaw);
  const transition = parseJsonRecord(transitionRaw);
  const transitionAction = stringValue(transition?.action);
  const transitionTarget = stringValue(transition?.targetNode);
  if (transitionAction && transitionAction !== "backtrack_to_design" && transitionTarget && transitionTarget !== "design_experiments") {
    return undefined;
  }

  const metrics = recordValue(resultAnalysis?.metrics);
  const scope = recordValue(metrics?.scope);
  const primaryMetric = recordValue(metrics?.primary_metric);
  const objectiveMetric = recordValue(resultAnalysis?.objective_metric);
  const objectiveEvaluation = recordValue(objectiveMetric?.evaluation);
  const planContext = recordValue(resultAnalysis?.plan_context);
  const selectedDesign = recordValue(planContext?.selected_design);

  const context: DesignRetryContext = {
    previous_selected_design_title: stringValue(selectedDesign?.title),
    previous_pilot_size: numberValue(scope?.pilot_size),
    previous_repeats: numberValue(scope?.repeats),
    registered_pilot_size: numberValue(scope?.registered_pilot_size),
    registered_repeats: numberValue(scope?.registered_repeats),
    previous_primary_metric_name: stringValue(primaryMetric?.name),
    previous_primary_metric_value: numberValue(primaryMetric?.value),
    previous_baseline_name: stringValue(primaryMetric?.baseline_name),
    previous_objective_status: stringValue(objectiveEvaluation?.status) || inferObjectiveStatus(primaryMetric?.value),
    transition_action: transitionAction,
    transition_reason: stringValue(transition?.reason),
    transition_evidence: stringArrayValue(transition?.evidence),
    retry_directives: buildRetryDirectives({
      previousPilotSize: numberValue(scope?.pilot_size),
      previousRepeats: numberValue(scope?.repeats),
      registeredPilotSize: numberValue(scope?.registered_pilot_size),
      registeredRepeats: numberValue(scope?.registered_repeats),
      previousPrimaryMetricName: stringValue(primaryMetric?.name),
      previousPrimaryMetricValue: numberValue(primaryMetric?.value),
      previousBaselineName: stringValue(primaryMetric?.baseline_name)
    })
  };

  return context.retry_directives.length > 0 || context.transition_reason || context.transition_evidence?.length
    ? context
    : undefined;
}

function buildRetryDirectives(args: {
  previousPilotSize?: number;
  previousRepeats?: number;
  registeredPilotSize?: number;
  registeredRepeats?: number;
  previousPrimaryMetricName?: string;
  previousPrimaryMetricValue?: number;
  previousBaselineName?: string;
}): string[] {
  const directives: string[] = [];
  if (
    typeof args.previousPilotSize === "number" &&
    args.previousPilotSize <= 1 &&
    typeof args.previousRepeats === "number" &&
    args.previousRepeats <= 1
  ) {
    directives.push("Do not repeat a bounded-local design with pilot_size=1 and repeats=1.");
    directives.push("Use at least tens of examples and repeated runs in the next bounded local pilot if the workstation budget allows it.");
  }
  if (
    typeof args.registeredPilotSize === "number" &&
    typeof args.previousPilotSize === "number" &&
    args.registeredPilotSize > args.previousPilotSize
  ) {
    directives.push("Move the next bounded local branch materially closer to the registered pilot scope while keeping the run locally executable.");
  }
  if (
    typeof args.previousPrimaryMetricValue === "number" &&
    args.previousPrimaryMetricValue <= 0
  ) {
    directives.push(
      `Revise the treatment or stopping policy because the previous ${args.previousPrimaryMetricName || "primary metric"} did not improve over ${args.previousBaselineName || "the locked baseline"}.`
    );
  }
  directives.push("Keep the explicit comparator discipline and preserve the locked baselines unless there is direct evidence to replace them.");
  return uniqueStrings(directives);
}

function parseJsonRecord(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return recordValue(parsed);
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function inferObjectiveStatus(metricValue: unknown): string | undefined {
  if (typeof metricValue !== "number" || !Number.isFinite(metricValue)) {
    return undefined;
  }
  if (metricValue > 0) {
    return "met";
  }
  if (metricValue < 0) {
    return "not_met";
  }
  return "inconclusive";
}

function renderDroppedHypotheses(items: FilteredHypothesis[]): string[] {
  if (items.length === 0) {
    return ['  - "none"'];
  }
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  - id: "${escapeQuote(item.hypothesis_id)}"`);
    lines.push(`    reason: "${escapeQuote(item.reason)}"`);
    lines.push(`    text: "${escapeQuote(item.text)}"`);
  }
  return lines;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function escapeQuote(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"');
}

function renderYamlStringList(items: string[], indentLevel: number): string[] {
  const indent = "  ".repeat(indentLevel);
  if (items.length === 0) {
    return [`${indent}- "none"`];
  }
  return items.map((item) => `${indent}- "${escapeQuote(item)}"`);
}

function renderYamlKeyValueObject(
  obj: Record<string, string | number | boolean | string[] | undefined>,
  indentLevel: number
): string[] {
  const indent = "  ".repeat(indentLevel);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        lines.push(`${indent}  - "${escapeQuote(item)}"`);
      }
      continue;
    }
    if (typeof value === "boolean") {
      lines.push(`${indent}${key}: ${value ? "true" : "false"}`);
      continue;
    }
    if (typeof value === "number") {
      lines.push(`${indent}${key}: ${value}`);
      continue;
    }
    lines.push(`${indent}${key}: "${escapeQuote(value)}"`);
  }
  if (lines.length === 0) {
    return [`${indent}{}`];
  }
  return lines;
}

function filterDesignHypotheses(
  hypotheses: DesignInputHypothesis[],
  objectiveProfile: ObjectiveMetricProfile
): { kept: DesignInputHypothesis[]; dropped: FilteredHypothesis[] } {
  if (hypotheses.length <= 1) {
    return { kept: hypotheses, dropped: [] };
  }

  const scored = hypotheses.map((hypothesis) => {
    const qualityScore = computeHypothesisDesignQuality(hypothesis, objectiveProfile);
    const reason = explainHypothesisDrop(hypothesis, objectiveProfile, qualityScore);
    return { hypothesis, qualityScore, reason };
  });

  const kept = scored.filter((item) => !item.reason).map((item) => item.hypothesis);
  const dropped = scored
    .filter((item) => item.reason)
    .map((item) => ({
      hypothesis_id: item.hypothesis.hypothesis_id,
      text: item.hypothesis.text,
      reason: item.reason || "Dropped by quality gate."
    }));

  if (kept.length > 0) {
    return { kept, dropped };
  }

  const fallback = [...scored].sort((a, b) => b.qualityScore - a.qualityScore || a.hypothesis.hypothesis_id.localeCompare(b.hypothesis.hypothesis_id))[0];
  if (!fallback) {
    return { kept: hypotheses.slice(0, 1), dropped };
  }

  return {
    kept: [fallback.hypothesis],
    dropped: scored
      .filter((item) => item.hypothesis.hypothesis_id !== fallback.hypothesis.hypothesis_id)
      .map((item) => ({
        hypothesis_id: item.hypothesis.hypothesis_id,
        text: item.hypothesis.text,
        reason: item.reason || "Dropped because a stronger fallback hypothesis was retained."
      }))
  };
}

function computeHypothesisDesignQuality(
  hypothesis: DesignInputHypothesis,
  objectiveProfile: ObjectiveMetricProfile
): number {
  let score = (hypothesis.score ?? 0) / 2;
  score += hypothesis.groundedness ?? 0;
  score += hypothesis.causal_clarity ?? 0;
  score += hypothesis.falsifiability ?? 0;
  score += hypothesis.experimentability ?? 0;
  score += (hypothesis.reproducibility_specificity ?? 0) * (isReproducibilityObjective(objectiveProfile) ? 1.5 : 0.5);
  score += (hypothesis.reproducibility_signals?.length ?? 0) > 0 ? 1 : 0;
  score += hypothesis.measurement_hint ? 1 : 0;
  score += hypothesis.limitation_reflection ?? 0;
  score += hypothesis.measurement_readiness ?? 0;
  return score;
}

function explainHypothesisDrop(
  hypothesis: DesignInputHypothesis,
  objectiveProfile: ObjectiveMetricProfile,
  qualityScore: number
): string | undefined {
  if (!hasStructuredHypothesisReview(hypothesis)) {
    return undefined;
  }

  const issues: string[] = [];
  if ((hypothesis.groundedness ?? 3) < 3) {
    issues.push("low groundedness");
  }
  if ((hypothesis.falsifiability ?? 3) < 3) {
    issues.push("weak falsifiability");
  }
  if ((hypothesis.experimentability ?? 3) < 3) {
    issues.push("weak experimentability");
  }
  if (typeof hypothesis.limitation_reflection === "number" && hypothesis.limitation_reflection < 3) {
    issues.push("limitations or counterexamples are not reflected");
  }
  if (typeof hypothesis.measurement_readiness === "number" && hypothesis.measurement_readiness < 3) {
    issues.push("measurement plan is not operationalized");
  }

  if (isReproducibilityObjective(objectiveProfile)) {
    if ((hypothesis.reproducibility_specificity ?? 0) < 3) {
      issues.push("reproducibility outcome is underspecified");
    }
    if ((hypothesis.reproducibility_signals?.length ?? 0) === 0) {
      issues.push("no reproducibility signal");
    }
    if (!hypothesis.measurement_hint) {
      issues.push("no reproducibility measurement hint");
    }
  }

  if (qualityScore < (isReproducibilityObjective(objectiveProfile) ? 15 : 10)) {
    issues.push("overall design quality below threshold");
  }

  if (issues.length === 0) {
    return undefined;
  }

  return issues.join("; ");
}

function isReproducibilityObjective(profile: ObjectiveMetricProfile): boolean {
  return /reproduc|재현/u.test(profile.raw) || /reproduc|재현/u.test(profile.primaryMetric || "");
}

export interface BaselineSummary {
  baseline_conditions: Array<{ name: string; rationale: string }>;
  treatment_conditions: Array<{ name: string; description: string }>;
  comparison_metric: string;
  justification: string;
}

export function buildBaselineSummary(input: {
  selected: ExperimentDesignCandidate;
  comparisonContract: ReturnType<typeof buildExperimentComparisonContract>;
  experimentContract: ReturnType<typeof buildExperimentContract>;
  objectiveMetric: string;
}): BaselineSummary {
  const baselines = input.selected.baselines ?? [];
  const baselineConditions = baselines.length > 0
    ? baselines.map((b) => ({
        name: b,
        rationale: `Baseline condition from selected design: ${input.selected.title}`
      }))
    : [{
        name: "(no explicit baseline)",
        rationale: "Design did not specify an explicit baseline condition."
      }];

  const treatmentConditions = [{
    name: input.selected.title,
    description: input.selected.plan_summary || input.selected.title
  }];

  return {
    baseline_conditions: baselineConditions,
    treatment_conditions: treatmentConditions,
    comparison_metric: input.objectiveMetric,
    justification: input.experimentContract.expected_metric_effect
      || `Evaluate ${input.objectiveMetric} across baseline and treatment conditions.`
  };
}

function hasStructuredHypothesisReview(hypothesis: DesignInputHypothesis): boolean {
  return (
    typeof hypothesis.groundedness === "number" ||
    typeof hypothesis.causal_clarity === "number" ||
    typeof hypothesis.falsifiability === "number" ||
    typeof hypothesis.experimentability === "number" ||
    typeof hypothesis.reproducibility_specificity === "number" ||
    typeof hypothesis.limitation_reflection === "number" ||
    typeof hypothesis.measurement_readiness === "number" ||
    Boolean(hypothesis.measurement_hint) ||
    Boolean(hypothesis.critique_summary) ||
    (hypothesis.reproducibility_signals?.length ?? 0) > 0
  );
}
