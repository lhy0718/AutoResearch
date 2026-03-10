import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
import { ObjectiveMetricProfile, resolveObjectiveMetricProfile } from "../objectiveMetric.js";
import {
  designExperimentsFromHypotheses,
  DesignInputHypothesis,
  ExperimentDesignCandidate
} from "../analysis/researchPlanning.js";
import { supportsRealExecutionBundle } from "../experiments/realExecutionBundle.js";

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
      const filtered = filterDesignHypotheses(hypotheses, objectiveMetricProfile);
      if (filtered.dropped.length > 0) {
        emitLog(
          `Filtered ${filtered.dropped.length} weak hypothesis/hypotheses before experiment design; keeping ${filtered.kept.length}.`
        );
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
        candidateCount: 3,
        onProgress: emitLog
      });

      const planYaml = buildPlanYaml({
        run,
        hypotheses: filtered.kept,
        droppedHypotheses: filtered.dropped,
        selected: design.selected,
        candidates: design.candidates,
        constraintProfile,
        objectiveProfile: objectiveMetricProfile,
        source: design.source
      });

      const outputPath = await writeRunArtifact(run, "experiment_plan.yaml", planYaml);
      await fs.access(outputPath);
      await runContextMemory.put("design_experiments.primary", design.selected.title);
      await runContextMemory.put("design_experiments.source", design.source);
      await runContextMemory.put("design_experiments.summary", design.summary);
      await runContextMemory.put("design_experiments.hypothesis_count", filtered.kept.length);
      await runContextMemory.put("design_experiments.filtered_out_count", filtered.dropped.length);

      deps.eventStream.emit({
        type: "PLAN_CREATED",
        runId: run.id,
        node: "design_experiments",
        payload: {
          candidateCount: design.candidates.length,
          selectedId: design.selected.id,
          source: design.source,
          fallbackReason: design.fallbackReason
        }
      });

      emitLog(`Selected design "${design.selected.title}" from ${design.candidates.length} candidate(s) using ${design.source}.`);

      return {
        status: "success",
        summary: design.fallbackReason
          ? `${design.summary} Falling back after: ${design.fallbackReason}`
          : design.summary,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
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
          critique_summary: parsed.critique_summary
        };
      } catch {
        return undefined;
      }
    });
  return items.filter((item): item is DesignInputHypothesis => item !== undefined && Boolean(item.text));
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
    "  timeout_sec: 1800",
    "  budget:",
    "    max_tool_calls: 150"
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
    "    budget_notes:",
    ...renderYamlStringList(uniqueStrings(selected.budget_notes), 3)
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
    "  budget_notes:",
    ...renderYamlStringList(selected.budget_notes, 2)
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
  return text.replace(/"/g, "'");
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

function hasStructuredHypothesisReview(hypothesis: DesignInputHypothesis): boolean {
  return (
    typeof hypothesis.groundedness === "number" ||
    typeof hypothesis.causal_clarity === "number" ||
    typeof hypothesis.falsifiability === "number" ||
    typeof hypothesis.experimentability === "number" ||
    typeof hypothesis.reproducibility_specificity === "number" ||
    Boolean(hypothesis.measurement_hint) ||
    Boolean(hypothesis.critique_summary) ||
    (hypothesis.reproducibility_signals?.length ?? 0) > 0
  );
}
