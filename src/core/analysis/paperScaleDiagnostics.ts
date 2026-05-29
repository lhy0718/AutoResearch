import type { AnalysisReport } from "../resultAnalysis.js";
import { GATE_THRESHOLDS } from "./paperGateThresholds.js";

export type PaperScaleDiagnosticSeverity = "blocking" | "warning";

export type PaperScaleDiagnosticCategory =
  | "evaluation_sample_size"
  | "statistical_adequacy"
  | "training_budget"
  | "related_work_depth"
  | "resource_claim";

export interface PaperScaleDiagnostic {
  id: string;
  severity: PaperScaleDiagnosticSeverity;
  category: PaperScaleDiagnosticCategory;
  source_node: string;
  target_node: string;
  summary: string;
  evidence: string;
  recommended_action: string;
  recheck_condition: string;
}

export interface PaperScaleDiagnosticSummary {
  generated_at: string;
  diagnostics: PaperScaleDiagnostic[];
  blocking_count: number;
  warning_count: number;
}

export function evaluatePaperScaleDiagnostics(input: {
  report: AnalysisReport;
  topic: string;
  bibliographyText?: string;
}): PaperScaleDiagnosticSummary {
  const diagnostics: PaperScaleDiagnostic[] = [];

  const evalSample = extractEvalSampleSummary(input.report);
  if (
    evalSample.minimumCount !== undefined
    && evalSample.minimumCount < GATE_THRESHOLDS.minEvaluationExamplesPerTaskForPaperScale
  ) {
    diagnostics.push({
      id: "tiny_eval_sample",
      severity: "blocking",
      category: "evaluation_sample_size",
      source_node: "run_experiments",
      target_node: "run_experiments",
      summary: "Evaluation sample size is too small for paper-scale claims.",
      evidence: `Minimum observed per-task evaluation count is ${evalSample.minimumCount}; task counts: ${formatTaskCounts(evalSample.taskCounts)}.`,
      recommended_action: "Expand each benchmark/task evaluation split before claiming a stable model or hyperparameter effect.",
      recheck_condition: `Every primary task reports at least ${GATE_THRESHOLDS.minEvaluationExamplesPerTaskForPaperScale} evaluation examples, or the manuscript is explicitly capped as a pilot note.`
    });
  }

  const seedSummary = extractSeedSummary(input.report);
  if (
    seedSummary.seedEvidencePresent &&
    seedSummary.distinctSeeds < GATE_THRESHOLDS.minDistinctSeedsForPaperScale
    && input.report.overview?.objective_status === "met"
  ) {
    diagnostics.push({
      id: "missing_seed_replication",
      severity: "blocking",
      category: "statistical_adequacy",
      source_node: "run_experiments",
      target_node: "run_experiments",
      summary: "Positive objective status has no repeated-seed support.",
      evidence: `Observed distinct seed count is ${seedSummary.distinctSeeds || 0}; seeds: ${seedSummary.seeds.join(", ") || "none"}.`,
      recommended_action: "Run repeated seeds for the baseline and leading condition, then report seed-level variance or paired uncertainty.",
      recheck_condition: `At least ${GATE_THRESHOLDS.minDistinctSeedsForPaperScale} distinct seeds are present for the comparison or the claim is downgraded.`
    });
  }

  const oneItemGain = detectOneItemGain(input.report);
  if (oneItemGain) {
    diagnostics.push({
      id: "single_item_gain",
      severity: "blocking",
      category: "statistical_adequacy",
      source_node: "analyze_results",
      target_node: "analyze_results",
      summary: "Headline improvement is consistent with a one-example accuracy change.",
      evidence: oneItemGain,
      recommended_action: "Report the result as a pilot screening signal and require a larger paired evaluation before claiming a condition-parameter effect.",
      recheck_condition: "The leading-vs-baseline delta is supported by more than a one-example change or by robust paired statistics."
    });
  }

  const stepSummary = extractOptimizerStepSummary(input.report);
  if (
    stepSummary.maximumSteps !== undefined
    && stepSummary.maximumSteps < GATE_THRESHOLDS.minOptimizerStepsForTuningClaim
  ) {
    diagnostics.push({
      id: "thin_training_budget",
      severity: "warning",
      category: "training_budget",
      source_node: "implement_experiments",
      target_node: "implement_experiments",
      summary: "Training budget is closer to a smoke test than a tuning experiment.",
      evidence: `Maximum observed optimizer steps is ${stepSummary.maximumSteps}; condition steps: ${stepSummary.stepValues.join(", ") || "none"}.`,
      recommended_action: "Increase the train budget or restrict claims to pipeline/preflight validation.",
      recheck_condition: `Optimizer steps are at least ${GATE_THRESHOLDS.minOptimizerStepsForTuningClaim} for paper-scale tuning claims, or the manuscript genre is downgraded.`
    });
  }

  const interactionRisk = detectWeakInteractionClaim(input.report);
  if (interactionRisk) {
    diagnostics.push({
      id: "weak_interaction_evidence",
      severity: "warning",
      category: "statistical_adequacy",
      source_node: "generate_hypotheses",
      target_node: "design_experiments",
      summary: "Interaction framing is stronger than the observed grid evidence.",
      evidence: interactionRisk,
      recommended_action: "Reframe as candidate screening or redesign the grid with enough samples and seeds to test interaction effects.",
      recheck_condition: "Interaction claims are supported by repeated cells, adequate samples, and multiple non-baseline deltas rather than one isolated condition."
    });
  }

  const canonicalReferenceGap = detectCanonicalReferenceGap(input.topic, input.report, input.bibliographyText);
  if (canonicalReferenceGap) {
    diagnostics.push({
      id: "canonical_method_references_missing",
      severity: "warning",
      category: "related_work_depth",
      source_node: "collect_papers",
      target_node: "collect_papers",
      summary: "Related work appears to miss canonical sources for a named method-family topic.",
      evidence: canonicalReferenceGap,
      recommended_action: "Collect and cite the original method-family papers before paper-scale review.",
      recheck_condition: "The bibliography includes canonical references when the topic or metrics center on a named method family."
    });
  }

  const resourceRisk = detectResourceClaimRisk(input.report);
  if (resourceRisk) {
    diagnostics.push({
      id: "resource_claim_unsupported",
      severity: "warning",
      category: "resource_claim",
      source_node: "analyze_results",
      target_node: "analyze_results",
      summary: "Resource measurements are present but not strong enough for efficiency claims.",
      evidence: resourceRisk,
      recommended_action: "Keep runtime/VRAM as diagnostics unless condition-level aggregates and repeated measurements are available.",
      recheck_condition: "Resource claims are backed by repeated condition-level runtime/memory summaries or removed from claim-level prose."
    });
  }

  return {
    generated_at: new Date().toISOString(),
    diagnostics,
    blocking_count: diagnostics.filter((diagnostic) => diagnostic.severity === "blocking").length,
    warning_count: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length
  };
}

function extractEvalSampleSummary(report: AnalysisReport): {
  taskCounts: Array<{ task: string; count: number }>;
  minimumCount?: number;
} {
  const taskCounts: Array<{ task: string; count: number }> = [];
  const metrics = asRecord(report.metrics);
  const data = asRecord(metrics.data);
  const evalData = asRecord(data.eval);
  for (const [task, value] of Object.entries(evalData)) {
    const count = asNumber(asRecord(value).count);
    if (count !== undefined) {
      taskCounts.push({ task, count });
    }
  }

  for (const condition of asArray(metrics.conditions)) {
    const marker = asString(asRecord(condition).marker) || "condition";
    const perTask = asRecord(asRecord(condition).per_task_metrics);
    for (const [task, value] of Object.entries(perTask)) {
      const total = asNumber(asRecord(value).total);
      if (total !== undefined) {
        taskCounts.push({ task: `${marker}:${task}`, count: total });
      }
    }
  }

  const counts = taskCounts.map((entry) => entry.count).filter((count) => Number.isFinite(count));
  return {
    taskCounts,
    minimumCount: counts.length > 0 ? Math.min(...counts) : undefined
  };
}

function extractSeedSummary(report: AnalysisReport): { seeds: string[]; distinctSeeds: number; seedEvidencePresent: boolean } {
  const seeds = new Set<string>();
  let seedEvidencePresent = false;
  const metrics = asRecord(report.metrics);
  seedEvidencePresent = addSeed(seeds, asRecord(metrics.run_config).seed) || seedEvidencePresent;
  for (const condition of asArray(metrics.conditions)) {
    const record = asRecord(condition);
    seedEvidencePresent = addSeed(seeds, record.seed) || seedEvidencePresent;
    seedEvidencePresent = addSeed(seeds, record.random_seed) || seedEvidencePresent;
  }
  for (const group of report.experiment_portfolio?.trial_groups ?? []) {
    for (const note of group.notes ?? []) {
      const matches = note.matchAll(/\bseed(?:s)?\s*[:=]\s*([0-9,\s-]+)/giu);
      for (const match of matches) {
        for (const seed of match[1]?.split(/[\s,]+/u) ?? []) {
          seedEvidencePresent = addSeed(seeds, seed) || seedEvidencePresent;
        }
      }
    }
  }
  return { seeds: Array.from(seeds), distinctSeeds: seeds.size, seedEvidencePresent };
}

function detectOneItemGain(report: AnalysisReport): string | undefined {
  const metrics = asRecord(report.metrics);
  const summary = asRecord(metrics.summary);
  const baselineMarker = asString(summary.baseline_condition_marker);
  const bestMarker = asString(summary.best_condition_marker);
  const conditions = asArray(metrics.conditions).map(asRecord);
  const baseline = conditions.find((condition) => asString(condition.marker) === baselineMarker);
  const best = conditions.find((condition) => asString(condition.marker) === bestMarker);
  if (!baseline || !best) {
    return undefined;
  }

  const deltas: string[] = [];
  let totalCorrectDelta = 0;
  let comparedTasks = 0;
  const baselineTasks = asRecord(baseline.per_task_metrics);
  const bestTasks = asRecord(best.per_task_metrics);
  for (const [task, baselineValue] of Object.entries(baselineTasks)) {
    const baselineCorrect = asNumber(asRecord(baselineValue).correct);
    const baselineTotal = asNumber(asRecord(baselineValue).total);
    const bestTask = asRecord(bestTasks[task]);
    const bestCorrect = asNumber(bestTask.correct);
    const bestTotal = asNumber(bestTask.total);
    if (
      baselineCorrect === undefined ||
      bestCorrect === undefined ||
      baselineTotal === undefined ||
      bestTotal === undefined ||
      baselineTotal !== bestTotal
    ) {
      continue;
    }
    const delta = bestCorrect - baselineCorrect;
    totalCorrectDelta += Math.abs(delta);
    comparedTasks += 1;
    deltas.push(`${task}: ${baselineCorrect}/${baselineTotal} -> ${bestCorrect}/${bestTotal} (delta ${delta})`);
  }

  if (comparedTasks === 0 || totalCorrectDelta > 1) {
    return undefined;
  }

  const headlineDelta =
    asNumber(summary.best_accuracy_delta_vs_baseline) ??
    asNumber(metrics.accuracy_delta_vs_baseline) ??
    report.overview?.observed_value;
  if (headlineDelta === undefined || headlineDelta <= 0) {
    return undefined;
  }

  return `Best condition ${bestMarker || "unknown"} differs from baseline ${baselineMarker || "unknown"} by ${totalCorrectDelta} total correct answer(s): ${deltas.join("; ")}. Headline delta=${headlineDelta}.`;
}

function extractOptimizerStepSummary(report: AnalysisReport): { stepValues: number[]; maximumSteps?: number } {
  const metrics = asRecord(report.metrics);
  const stepValues: number[] = [];
  const maxSteps = asNumber(asRecord(metrics.run_config).max_steps);
  if (maxSteps !== undefined) {
    stepValues.push(maxSteps);
  }
  for (const condition of asArray(metrics.conditions)) {
    const steps = asNumber(asRecord(condition).steps_completed);
    if (steps !== undefined) {
      stepValues.push(steps);
    }
  }
  return {
    stepValues,
    maximumSteps: stepValues.length > 0 ? Math.max(...stepValues) : undefined
  };
}

function detectWeakInteractionClaim(report: AnalysisReport): string | undefined {
  const metrics = asRecord(report.metrics);
  const conditions = asArray(metrics.conditions).map(asRecord);
  const ranks = new Set<string>();
  const dropouts = new Set<string>();
  let positiveDeltaCount = 0;
  for (const condition of conditions) {
    const rank = asNumber(condition.rank);
    const dropout = asNumber(condition.dropout);
    if (rank !== undefined) {
      ranks.add(String(rank));
    }
    if (dropout !== undefined) {
      dropouts.add(String(dropout));
    }
    const delta = asNumber(condition.accuracy_delta_vs_baseline);
    if (delta !== undefined && delta > 0) {
      positiveDeltaCount += 1;
    }
  }
  const text = [
    report.overview?.objective_summary,
    ...(report.primary_findings ?? []),
    ...(report.paper_claims ?? []).map((claim) => claim.claim)
  ].join(" ");
  if (ranks.size < 2 || dropouts.size < 2 || positiveDeltaCount !== 1 || !/\binteraction|rank|dropout\b/iu.test(text)) {
    return undefined;
  }
  return `Grid has ${ranks.size} rank value(s), ${dropouts.size} dropout value(s), and only ${positiveDeltaCount} positive-delta condition(s).`;
}

function detectCanonicalReferenceGap(topic: string, report: AnalysisReport, bibliographyText?: string): string | undefined {
  const text = [
    topic,
    report.overview?.objective_summary,
    ...(report.primary_findings ?? []),
    ...(report.paper_claims ?? []).map((claim) => claim.claim)
  ].join(" ");
  const methodMatch =
    text.match(/\b(?:canonical|original|seminal)\s+([A-Z][A-Za-z0-9-]{2,40})\b/u)
    || text.match(/\b([A-Z][A-Za-z0-9-]{2,40})\s+(?:method|model|algorithm|framework|family)\b/u);
  const methodName = (methodMatch?.[1] || "").replace(/[^A-Za-z0-9-]+/gu, "").trim();
  if (!methodName || /^(?:The|This|That|Prior|Original|Canonical|Related|Benchmark)$/u.test(methodName)) {
    return undefined;
  }
  const bibliography = (bibliographyText || "").toLowerCase();
  if (!bibliography) {
    return `No bibliography text was available for canonical-reference audit of ${methodName}.`;
  }
  if (bibliography.includes(methodName.toLowerCase())) {
    return undefined;
  }
  return `Canonical coverage may be missing for named method family: ${methodName}.`;
}

function detectResourceClaimRisk(report: AnalysisReport): string | undefined {
  const metrics = asRecord(report.metrics);
  const conditions = asArray(metrics.conditions).map(asRecord);
  const hasResourceValues = conditions.some(
    (condition) => asNumber(condition.runtime_sec) !== undefined || asNumber(condition.peak_cuda_memory_bytes) !== undefined
  );
  if (!hasResourceValues) {
    return undefined;
  }
  const stabilityMetricCount = report.statistical_summary?.stability_metrics?.length ?? 0;
  const totalTrials = report.statistical_summary?.total_trials ?? report.statistical_summary?.executed_trials ?? report.overview?.execution_runs;
  if (stabilityMetricCount > 0 && typeof totalTrials === "number" && totalTrials >= 3) {
    return undefined;
  }
  return `Runtime/VRAM values are present, but stability_metrics=${stabilityMetricCount} and total_trials=${totalTrials ?? "unknown"}.`;
}

function formatTaskCounts(taskCounts: Array<{ task: string; count: number }>): string {
  return taskCounts.slice(0, 8).map((entry) => `${entry.task}=${entry.count}`).join(", ") || "none";
}

function addSeed(target: Set<string>, value: unknown): boolean {
  const seed = asString(value);
  if (seed) {
    target.add(seed);
    return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
