import path from "node:path";
import { promises as fs } from "node:fs";

import { RunRecord } from "../../types.js";
import {
  buildSelfCritiqueRetryPromptVariant,
  getNodePromptPath,
  loadAnalyzeResultsPromptSections,
  loadDesignExperimentsPromptSections,
  loadGenerateHypothesesPromptSections,
  TUNABLE_NODE_NAMES,
  TunableNodeName
} from "../nodePrompts.js";
import {
  designExperimentsFromHypotheses,
  DesignInputHypothesis,
  generateHypothesesFromEvidence
} from "../analysis/researchPlanning.js";
import { AnalysisReport, AnalysisSynthesis } from "../resultAnalysis.js";
import { synthesizeAnalysisReport } from "../resultAnalysisSynthesis.js";
import { buildHeuristicConstraintProfile } from "../runConstraints.js";
import { buildHeuristicObjectiveMetricProfile } from "../objectiveMetric.js";
import { LLMClient, LLMCompletion } from "../llm/client.js";

export interface TuneNodeVariantScore {
  label: "original" | "mutant";
  score: number;
  notes: string[];
}

export interface TuneNodeReport {
  node: TunableNodeName;
  runId: string;
  promptPath: string;
  original: TuneNodeVariantScore;
  mutant: TuneNodeVariantScore;
  delta: number;
  recommendation: "keep" | "revert";
  lines: string[];
}

export interface TuneNodeRunnerInput {
  workspaceRoot: string;
  run: Pick<RunRecord, "id" | "title" | "topic" | "objectiveMetric" | "constraints">;
  node: TunableNodeName;
}

export interface TuneNodeRunner {
  run(input: TuneNodeRunnerInput): Promise<TuneNodeReport>;
}

export interface TuneNodeEvaluatorInput extends TuneNodeRunnerInput {
  variant: "original" | "mutant";
  systemPrompt: string;
}

export type TuneNodeEvaluator = (input: TuneNodeEvaluatorInput) => Promise<TuneNodeVariantScore>;

export class DefaultTuneNodeRunner implements TuneNodeRunner {
  constructor(private readonly evaluator: TuneNodeEvaluator = evaluateTuneNodeVariant) {}

  async run(input: TuneNodeRunnerInput): Promise<TuneNodeReport> {
    assertSupportedTunableNode(input.node);

    const originalPrompt = getPrimarySystemPrompt(input.node);
    const mutantPrompt = buildSelfCritiqueRetryPromptVariant(originalPrompt);
    const [original, mutant] = await Promise.all([
      this.evaluator({
        ...input,
        variant: "original",
        systemPrompt: originalPrompt
      }),
      this.evaluator({
        ...input,
        variant: "mutant",
        systemPrompt: mutantPrompt
      })
    ]);

    const delta = roundScore(mutant.score - original.score);
    const recommendation: "keep" | "revert" = delta > 0 ? "keep" : "revert";
    const lines = [
      `Tune-node report for ${input.node} on ${input.run.id}.`,
      `Prompt file: ${path.relative(input.workspaceRoot, getNodePromptPath(input.node)) || getNodePromptPath(input.node)}`,
      `ORIGINAL score: ${formatScore(original.score)}`,
      `MUTANT score: ${formatScore(mutant.score)}`,
      `DELTA: ${formatSignedScore(delta)}`,
      `RECOMMENDATION: ${recommendation}`,
      "This comparison is report-only. No prompt changes were applied."
    ];

    if (original.notes.length > 0) {
      lines.push(`Original notes: ${original.notes.join("; ")}`);
    }
    if (mutant.notes.length > 0) {
      lines.push(`Mutant notes: ${mutant.notes.join("; ")}`);
    }

    return {
      node: input.node,
      runId: input.run.id,
      promptPath: getNodePromptPath(input.node),
      original,
      mutant,
      delta,
      recommendation,
      lines
    };
  }
}

export async function evaluateTuneNodeVariant(input: TuneNodeEvaluatorInput): Promise<TuneNodeVariantScore> {
  switch (input.node) {
    case "generate_hypotheses":
      return evaluateGenerateHypothesesVariant(input);
    case "design_experiments":
      return evaluateDesignExperimentsVariant(input);
    case "analyze_results":
      return evaluateAnalyzeResultsVariant(input);
    default:
      assertNever(input.node);
  }
}

function assertSupportedTunableNode(node: string): asserts node is TunableNodeName {
  if (!(TUNABLE_NODE_NAMES as readonly string[]).includes(node)) {
    throw new Error(
      `Unsupported node for tune-node: ${node}. Allowed nodes: ${TUNABLE_NODE_NAMES.join(", ")}.`
    );
  }
}

function getPrimarySystemPrompt(node: TunableNodeName): string {
  if (node === "generate_hypotheses") {
    return loadGenerateHypothesesPromptSections().system;
  }
  if (node === "design_experiments") {
    return loadDesignExperimentsPromptSections().system;
  }
  return loadAnalyzeResultsPromptSections().system;
}

async function evaluateGenerateHypothesesVariant(
  input: TuneNodeEvaluatorInput
): Promise<TuneNodeVariantScore> {
  const evidenceSeeds = await readEvidenceSeeds(input.workspaceRoot, input.run.id);
  if (evidenceSeeds.length === 0) {
    return {
      label: input.variant,
      score: 0,
      notes: ["No evidence_store.jsonl items were available for generate_hypotheses."]
    };
  }

  const llm = new SyntheticTuneNodeLLM(input.node, input.variant === "mutant");
  const result = await generateHypothesesFromEvidence({
    llm,
    runTitle: input.run.title,
    runTopic: input.run.topic,
    objectiveMetric: input.run.objectiveMetric,
    evidenceSeeds,
    branchCount: 4,
    topK: 2,
    promptOverrides: {
      systemPrompt: input.systemPrompt
    }
  });

  const selected = result.selected;
  const avgEvidenceLinks =
    selected.length > 0
      ? selected.reduce((sum, item) => sum + item.evidence_links.length, 0) / selected.length
      : 0;
  const withMeasurementHints = selected.filter((item) => Boolean(item.measurement_hint)).length;
  const withBoundaryConditions = selected.filter((item) => Boolean(item.boundary_condition)).length;
  const withReproSignals = selected.filter((item) => (item.reproducibility_signals?.length ?? 0) > 0).length;
  const score = roundScore(
    [
      selected.length > 0 ? 0.3 : 0,
      avgEvidenceLinks >= 2 ? 0.25 : avgEvidenceLinks > 0 ? 0.12 : 0,
      withMeasurementHints === selected.length && selected.length > 0 ? 0.2 : 0,
      withBoundaryConditions === selected.length && selected.length > 0 ? 0.15 : 0,
      withReproSignals === selected.length && selected.length > 0 ? 0.1 : 0
    ].reduce((sum, value) => sum + value, 0)
  );

  return {
    label: input.variant,
    score,
    notes: [
      `${selected.length} selected hypothesis/hypotheses`,
      `avg evidence refs ${avgEvidenceLinks.toFixed(2)}`,
      `${withMeasurementHints}/${selected.length} with measurement hints`
    ]
  };
}

async function evaluateDesignExperimentsVariant(
  input: TuneNodeEvaluatorInput
): Promise<TuneNodeVariantScore> {
  const hypotheses = await readDesignHypotheses(input.workspaceRoot, input.run.id);
  if (hypotheses.length === 0) {
    return {
      label: input.variant,
      score: 0,
      notes: ["No hypotheses.jsonl items were available for design_experiments."]
    };
  }

  const llm = new SyntheticTuneNodeLLM(input.node, input.variant === "mutant");
  const result = await designExperimentsFromHypotheses({
    llm,
    runTitle: input.run.title,
    runTopic: input.run.topic,
    objectiveMetric: input.run.objectiveMetric,
    hypotheses,
    constraintProfile: buildHeuristicConstraintProfile(input.run.constraints),
    objectiveProfile: buildHeuristicObjectiveMetricProfile(input.run.objectiveMetric),
    candidateCount: 3,
    promptOverrides: {
      systemPrompt: input.systemPrompt
    }
  });

  const selected = result.selected;
  const score = roundScore(
    [
      selected.baselines.length > 0 ? 0.3 : 0,
      selected.metrics.length > 0 ? 0.2 : 0,
      selected.evaluation_steps.length >= 2 ? 0.2 : selected.evaluation_steps.length > 0 ? 0.1 : 0,
      selected.risks.length > 0 ? 0.15 : 0,
      selected.resource_notes.length > 0 ? 0.15 : 0
    ].reduce((sum, value) => sum + value, 0)
  );

  return {
    label: input.variant,
    score,
    notes: [
      `${selected.baselines.length} baseline/comparator entries`,
      `${selected.metrics.length} metrics`,
      `${selected.evaluation_steps.length} evaluation step(s)`
    ]
  };
}

async function evaluateAnalyzeResultsVariant(
  input: TuneNodeEvaluatorInput
): Promise<TuneNodeVariantScore> {
  const report = await readAnalysisReport(input.workspaceRoot, input.run.id);
  if (!report) {
    return {
      label: input.variant,
      score: 0,
      notes: ["No result_analysis.json artifact was available for analyze_results."]
    };
  }

  const llm = new SyntheticTuneNodeLLM(input.node, input.variant === "mutant");
  const synthesis = await synthesizeAnalysisReport({
    run: input.run,
    report,
    llm,
    node: "analyze_results",
    systemPromptOverride: input.systemPrompt
  });

  const score = scoreAnalysisSynthesis(synthesis);
  return {
    label: input.variant,
    score,
    notes: [
      `${synthesis.discussion_points.length} discussion point(s)`,
      `${synthesis.follow_up_actions.length} follow-up action(s)`,
      synthesis.confidence_statement ? "confidence statement present" : "missing confidence statement"
    ]
  };
}

class SyntheticTuneNodeLLM implements LLMClient {
  constructor(
    private readonly node: TunableNodeName,
    private readonly improved: boolean
  ) {}

  async complete(prompt: string, opts?: { systemPrompt?: string }): Promise<LLMCompletion> {
    const systemPrompt = opts?.systemPrompt || "";
    if (this.node === "generate_hypotheses") {
      if (systemPrompt.includes("evidence synthesizer")) {
        return {
          text: JSON.stringify({
            summary: "Axes prepared.",
            axes: [
              {
                id: "ax_1",
                label: "coordination stability",
                mechanism: "Schema-constrained coordination reduces variance.",
                intervention: "Add shared structured state between agents.",
                boundary_condition: "May weaken if the task is mostly single-hop.",
                evaluation_hint: "Measure run-to-run variance.",
                evidence_links: ["ev_1", "ev_2"]
              }
            ]
          })
        };
      }
      if (systemPrompt.includes("skeptical reviewer")) {
        return {
          text: JSON.stringify({
            summary: "Review completed.",
            reviews: [
              {
                candidate_id: "cand_1",
                keep: true,
                groundedness: 4,
                causal_clarity: 4,
                falsifiability: 4,
                experimentability: 4,
                reproducibility_specificity: 4,
                reproducibility_signals: this.improved ? ["run_to_run_variance", "seed_stability"] : ["run_to_run_variance"],
                measurement_hint: "Track variance and replication success.",
                limitation_reflection: 4,
                measurement_readiness: 4,
                strengths: ["Grounded in explicit evidence."],
                weaknesses: this.improved ? ["Needs confirmatory baselines."] : ["Still narrow."],
                critique_summary: "Viable with explicit repeated-run measurement."
              }
            ]
          })
        };
      }
      return {
        text: JSON.stringify({
          summary: "Generated hypotheses.",
          candidates: [
            {
              id: "cand_1",
              text: this.improved
                ? "Introducing shared structured state will improve reproducibility_score over free-form coordination."
                : "Shared state may help the system do better.",
              novelty: 3,
              feasibility: 4,
              testability: 4,
              cost: 2,
              expected_gain: 3,
              evidence_links: this.improved ? ["ev_1", "ev_2"] : ["ev_1"],
              rationale: "Prior evidence suggests lower coordination variance.",
              reproducibility_signals: this.improved ? ["run_to_run_variance", "replication_success_rate"] : ["run_to_run_variance"],
              measurement_hint: this.improved ? "Compare reproducibility_score and variance across repeated runs." : "Check results.",
              boundary_condition: this.improved ? "The effect may vanish on tasks with trivial coordination overhead." : ""
            }
          ],
          selected_ids: ["cand_1"]
        })
      };
    }

    if (this.node === "design_experiments") {
      return {
        text: JSON.stringify({
          summary: "Generated experiment designs.",
          candidates: [
            {
              id: "design_1",
              title: "Structured-state reproducibility comparison",
              hypothesis_ids: ["h_1"],
              plan_summary: "Compare free-form coordination against shared structured state on repeated runs.",
              datasets: ["hotpotqa_mini", "gsm8k_mini"],
              metrics: this.improved ? ["reproducibility_score", "replication_success_rate"] : ["reproducibility_score"],
              baselines: this.improved ? ["free_form_chat baseline", "shared_state_schema treatment"] : ["free_form_chat baseline"],
              implementation_notes: ["Reuse managed execution bundle."],
              evaluation_steps: this.improved
                ? ["Run repeated seeds for baseline.", "Run repeated seeds for treatment.", "Compare variance and replication success."]
                : ["Run baseline and treatment."],
              risks: this.improved ? ["Task mix may be too narrow for paper-scale claims."] : [],
              resource_notes: this.improved ? ["Two worker slots are sufficient for the confirmatory slice."] : []
            }
          ],
          selected_id: "design_1"
        })
      };
    }

    return {
      text: JSON.stringify({
        discussion_points: this.improved
          ? [
              "The structured condition improved the primary reproducibility metric over the baseline.",
              "The effect direction is consistent with lower run-to-run variance."
            ]
          : ["The treatment looks promising overall."],
        failure_analysis: this.improved
          ? ["Residual risk remains because the benchmark slice is still narrow."]
          : ["There may be some risks."],
        follow_up_actions: this.improved
          ? [
              "Run a confirmatory comparator slice with additional seeds.",
              "Preserve the current condition comparison in the result table."
            ]
          : ["Do more experiments."],
        confidence_statement: this.improved
          ? "Confidence is moderate because the comparison is explicit, but confirmatory coverage is still limited."
          : "Confidence is unclear."
      })
    };
  }
}

async function readEvidenceSeeds(workspaceRoot: string, runId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await readJsonl(path.join(workspaceRoot, ".autolabos", "runs", runId, "evidence_store.jsonl"));
  return rows.filter((row) => typeof row.evidence_id === "string");
}

async function readDesignHypotheses(workspaceRoot: string, runId: string): Promise<DesignInputHypothesis[]> {
  const rows = await readJsonl(path.join(workspaceRoot, ".autolabos", "runs", runId, "hypotheses.jsonl"));
  const parsed: Array<DesignInputHypothesis | undefined> = rows.map((row, index) => {
      const hypothesisId = cleanString(row.hypothesis_id) || `h_${index + 1}`;
      const text = cleanString(row.text);
      if (!text) {
        return undefined;
      }
      return {
        hypothesis_id: hypothesisId,
        text,
        score: typeof row.score === "number" ? row.score : undefined,
        evidence_links: normalizeStringArray(row.evidence_links),
        groundedness: asNumber(row.groundedness),
        causal_clarity: asNumber(row.causal_clarity),
        falsifiability: asNumber(row.falsifiability),
        experimentability: asNumber(row.experimentability),
        reproducibility_specificity: asNumber(row.reproducibility_specificity),
        reproducibility_signals: normalizeStringArray(row.reproducibility_signals),
        measurement_hint: cleanString(row.measurement_hint),
        boundary_condition: cleanString(row.boundary_condition),
        limitation_reflection: asNumber(row.limitation_reflection),
        measurement_readiness: asNumber(row.measurement_readiness),
        critique_summary: cleanString(row.critique_summary)
      } satisfies DesignInputHypothesis;
    });
  return parsed.filter((value): value is DesignInputHypothesis => Boolean(value));
}

async function readAnalysisReport(workspaceRoot: string, runId: string): Promise<AnalysisReport | undefined> {
  const reportPath = path.join(workspaceRoot, ".autolabos", "runs", runId, "result_analysis.json");
  try {
    const raw = await fs.readFile(reportPath, "utf8");
    return JSON.parse(raw) as AnalysisReport;
  } catch {
    return undefined;
  }
}

function scoreAnalysisSynthesis(synthesis: AnalysisSynthesis): number {
  return roundScore(
    [
      synthesis.discussion_points.length >= 2 ? 0.35 : synthesis.discussion_points.length > 0 ? 0.2 : 0,
      synthesis.failure_analysis.length >= 1 ? 0.2 : 0,
      synthesis.follow_up_actions.length >= 2 ? 0.25 : synthesis.follow_up_actions.length > 0 ? 0.15 : 0,
      synthesis.confidence_statement.trim() ? 0.2 : 0
    ].reduce((sum, value) => sum + value, 0)
  );
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function formatSignedScore(score: number): string {
  return `${score >= 0 ? "+" : ""}${score.toFixed(2)}`;
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled tune-node target: ${String(value)}`);
}
