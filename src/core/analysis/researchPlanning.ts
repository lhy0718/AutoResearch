import { LLMClient, LLMProgressEvent } from "../llm/client.js";
import { runTreeOfThoughts } from "../agents/runtime/tot.js";
import { ConstraintProfile } from "../runConstraints.js";
import { ObjectiveMetricProfile } from "../objectiveMetric.js";

export interface HypothesisEvidenceSeed {
  evidence_id?: string;
  paper_id?: string;
  claim?: string;
  limitation_slot?: string;
  dataset_slot?: string;
  metric_slot?: string;
  confidence?: number;
}

export interface HypothesisCandidate {
  id: string;
  text: string;
  novelty: number;
  feasibility: number;
  testability: number;
  cost: number;
  expected_gain: number;
  evidence_links: string[];
  rationale?: string;
  generator_kind?: HypothesisGeneratorKind;
  axis_ids?: string[];
  groundedness?: number;
  causal_clarity?: number;
  falsifiability?: number;
  experimentability?: number;
  reproducibility_specificity?: number;
  reproducibility_signals?: string[];
  measurement_hint?: string;
  critique_summary?: string;
}

export type HypothesisGeneratorKind = "mechanism" | "contradiction" | "intervention" | "fallback" | "single_pass";

export interface HypothesisEvidenceAxis {
  id: string;
  label: string;
  mechanism: string;
  intervention: string;
  boundary_condition?: string;
  evaluation_hint?: string;
  evidence_links: string[];
}

export interface HypothesisReview {
  candidate_id: string;
  keep: boolean;
  groundedness: number;
  causal_clarity: number;
  falsifiability: number;
  experimentability: number;
  reproducibility_specificity: number;
  reproducibility_signals: string[];
  measurement_hint?: string;
  strengths: string[];
  weaknesses: string[];
  critique_summary?: string;
  revised_text?: string;
  revised_rationale?: string;
}

export interface HypothesisSelectionScore {
  candidate_id: string;
  raw_base_score: number;
  base_score: number;
  implementation_bonus: number;
  bundling_penalty: number;
  scope_penalty: number;
  diversity_penalty: number;
  final_score: number;
}

export interface HypothesisLlmExchange {
  prompt: string;
  completion: string;
}

export interface HypothesisDraftLlmExchange extends HypothesisLlmExchange {
  kind: HypothesisGeneratorKind;
  requested_count: number;
}

export interface HypothesisPlanningArtifacts {
  pipeline: "staged" | "single_pass" | "fallback";
  evidence_axes: HypothesisEvidenceAxis[];
  drafts: HypothesisCandidate[];
  reviews: HypothesisReview[];
  selection: {
    selected_ids: string[];
    ranked_ids: string[];
    scores: HypothesisSelectionScore[];
  };
  llm_trace: {
    axes?: HypothesisLlmExchange;
    drafts: HypothesisDraftLlmExchange[];
    review?: HypothesisLlmExchange;
    single_pass?: HypothesisLlmExchange;
  };
}

export interface HypothesisPlanningResult {
  source: "llm" | "fallback";
  summary: string;
  candidates: HypothesisCandidate[];
  selected: HypothesisCandidate[];
  fallbackReason?: string;
  toolCallsUsed: number;
  artifacts: HypothesisPlanningArtifacts;
}

export interface DesignInputHypothesis {
  hypothesis_id: string;
  text: string;
  score?: number;
  evidence_links?: string[];
  groundedness?: number;
  causal_clarity?: number;
  falsifiability?: number;
  experimentability?: number;
  reproducibility_specificity?: number;
  reproducibility_signals?: string[];
  measurement_hint?: string;
  critique_summary?: string;
}

export interface ExperimentDesignCandidate {
  id: string;
  title: string;
  hypothesis_ids: string[];
  plan_summary: string;
  datasets: string[];
  metrics: string[];
  baselines: string[];
  implementation_notes: string[];
  evaluation_steps: string[];
  risks: string[];
  budget_notes: string[];
}

export interface ExperimentDesignResult {
  source: "llm" | "fallback";
  summary: string;
  candidates: ExperimentDesignCandidate[];
  selected: ExperimentDesignCandidate;
  fallbackReason?: string;
}

const HYPOTHESIS_SYSTEM_PROMPT = [
  "You are the AutoLabOS hypothesis agent.",
  "Generate multiple research hypotheses from structured evidence.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON.",
  "Keep hypotheses specific, testable, and grounded in the supplied evidence."
].join(" ");

const HYPOTHESIS_AXIS_SYSTEM_PROMPT = [
  "You are the AutoLabOS evidence synthesizer.",
  "Map evidence into a small set of mechanism-oriented axes for better hypothesis generation.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON.",
  "Prefer axes that can be turned into interventions and evaluated for reproducibility."
].join(" ");

const HYPOTHESIS_REVIEW_SYSTEM_PROMPT = [
  "You are the AutoLabOS skeptical reviewer.",
  "Critique hypothesis drafts for groundedness, causal clarity, falsifiability, experimentability, and objective-metric alignment.",
  "When the objective is reproducibility, penalize performance-only hypotheses that do not specify a repeated-run or stability-based outcome.",
  "Revise weak wording instead of praising it.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON."
].join(" ");

const DESIGN_SYSTEM_PROMPT = [
  "You are the AutoLabOS experiment designer.",
  "Convert shortlisted hypotheses into executable experiment plans.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON.",
  "Plans must be concrete, measurable, and implementable."
].join(" ");

interface RawHypothesisJson {
  summary?: unknown;
  candidates?: unknown;
  selected_ids?: unknown;
}

interface RawHypothesisCandidate {
  id?: unknown;
  text?: unknown;
  novelty?: unknown;
  feasibility?: unknown;
  testability?: unknown;
  cost?: unknown;
  expected_gain?: unknown;
  evidence_links?: unknown;
  rationale?: unknown;
  axis_ids?: unknown;
}

interface RawHypothesisAxisJson {
  summary?: unknown;
  axes?: unknown;
}

interface RawHypothesisAxis {
  id?: unknown;
  label?: unknown;
  mechanism?: unknown;
  intervention?: unknown;
  boundary_condition?: unknown;
  evaluation_hint?: unknown;
  evidence_links?: unknown;
}

interface RawHypothesisReviewJson {
  summary?: unknown;
  reviews?: unknown;
}

interface RawHypothesisReview {
  candidate_id?: unknown;
  keep?: unknown;
  groundedness?: unknown;
  causal_clarity?: unknown;
  falsifiability?: unknown;
  experimentability?: unknown;
  reproducibility_specificity?: unknown;
  reproducibility_signals?: unknown;
  measurement_hint?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  critique_summary?: unknown;
  revised_text?: unknown;
  revised_rationale?: unknown;
}

interface RawDesignJson {
  summary?: unknown;
  candidates?: unknown;
  selected_id?: unknown;
}

interface RawDesignCandidate {
  id?: unknown;
  title?: unknown;
  hypothesis_ids?: unknown;
  plan_summary?: unknown;
  datasets?: unknown;
  metrics?: unknown;
  baselines?: unknown;
  implementation_notes?: unknown;
  evaluation_steps?: unknown;
  risks?: unknown;
  budget_notes?: unknown;
}

export async function generateHypothesesFromEvidence(args: {
  llm: LLMClient;
  runTitle: string;
  runTopic: string;
  objectiveMetric: string;
  evidenceSeeds: HypothesisEvidenceSeed[];
  branchCount?: number;
  topK?: number;
  onProgress?: (message: string) => void;
}): Promise<HypothesisPlanningResult> {
  const branchCount = Math.max(2, args.branchCount ?? 6);
  const topK = Math.max(1, args.topK ?? 2);

  try {
    return await runStagedHypothesisPipeline({
      ...args,
      branchCount,
      topK
    });
  } catch (stagedError) {
    const stagedReason = stagedError instanceof Error ? stagedError.message : String(stagedError);
    args.onProgress?.(`Staged hypothesis pipeline failed, retrying single-pass generation: ${stagedReason}`);

    try {
      args.onProgress?.(`Submitting single-pass hypothesis generation request for ${args.evidenceSeeds.length} evidence seed(s).`);
      const singlePassPrompt = buildHypothesisPrompt(
        args.runTitle,
        args.runTopic,
        args.objectiveMetric,
        args.evidenceSeeds,
        branchCount,
        topK
      );
      const completion = await args.llm.complete(
        singlePassPrompt,
        {
          systemPrompt: HYPOTHESIS_SYSTEM_PROMPT,
          onProgress: (event) => emitProgress(args.onProgress, "Hypothesis LLM", event)
        }
      );
      args.onProgress?.("Received single-pass hypothesis generation output. Parsing JSON.");
      const parsed = parseHypothesisJson(completion.text);
      const normalizedCandidates = normalizeHypothesisCandidates(
        parsed.candidates,
        branchCount,
        args.evidenceSeeds,
        "single_pass"
      );
      const selected = selectHypothesesWithDiversity(normalizedCandidates, [], topK, args.objectiveMetric);
      if (normalizedCandidates.length === 0 || selected.selected.length === 0) {
        throw new Error("No valid hypothesis candidates were returned.");
      }
      const summary =
        toOptionalString(parsed.summary) ||
        buildHypothesisSelectionSummary(normalizedCandidates, selected.selected, [], "single-pass");
      return {
        source: "llm",
        summary,
        candidates: normalizedCandidates,
        selected: selected.selected,
        fallbackReason: stagedReason,
        toolCallsUsed: 1,
        artifacts: {
          pipeline: "single_pass",
          evidence_axes: [],
          drafts: normalizedCandidates,
          reviews: [],
          selection: {
            selected_ids: selected.selected.map((candidate) => candidate.id),
            ranked_ids: selected.ranked.map((candidate) => candidate.id),
            scores: selected.scores
          },
          llm_trace: {
            drafts: [],
            single_pass: {
              prompt: singlePassPrompt,
              completion: completion.text
            }
          }
        }
      };
    } catch (legacyError) {
      const legacyReason = legacyError instanceof Error ? legacyError.message : String(legacyError);
      args.onProgress?.(`Hypothesis generation fallback: ${legacyReason}`);
      const fallback = buildFallbackHypotheses(args.evidenceSeeds, branchCount, topK);
      return {
        source: "fallback",
        summary: `Fallback generated ${fallback.candidates.length} hypothesis candidate(s).`,
        candidates: fallback.candidates,
        selected: fallback.selected,
        fallbackReason: `${stagedReason}; single_pass=${legacyReason}`,
        toolCallsUsed: 0,
        artifacts: {
          pipeline: "fallback",
          evidence_axes: [],
          drafts: fallback.candidates,
          reviews: [],
          selection: {
            selected_ids: fallback.selected.map((candidate) => candidate.id),
            ranked_ids: fallback.candidates.map((candidate) => candidate.id),
            scores: fallback.candidates.map((candidate) => ({
              candidate_id: candidate.id,
              raw_base_score: scoreHypothesis(candidate),
              base_score: scoreHypothesis(candidate),
              implementation_bonus: 0,
              bundling_penalty: 0,
              scope_penalty: 0,
              diversity_penalty: 0,
              final_score: scoreHypothesis(candidate)
            }))
          },
          llm_trace: {
            drafts: []
          }
        }
      };
    }
  }
}

async function runStagedHypothesisPipeline(args: {
  llm: LLMClient;
  runTitle: string;
  runTopic: string;
  objectiveMetric: string;
  evidenceSeeds: HypothesisEvidenceSeed[];
  branchCount: number;
  topK: number;
  onProgress?: (message: string) => void;
}): Promise<HypothesisPlanningResult> {
  const evidencePanel = selectHypothesisEvidencePanel(args.evidenceSeeds, 24);
  let toolCallsUsed = 0;
  const llmTrace: HypothesisPlanningArtifacts["llm_trace"] = {
    drafts: []
  };

  args.onProgress?.(`Synthesizing evidence axes from ${evidencePanel.length} curated evidence item(s).`);
  const axesPrompt = buildHypothesisAxesPrompt(args.runTitle, args.runTopic, args.objectiveMetric, evidencePanel);
  const axesCompletion = await args.llm.complete(
    axesPrompt,
    {
      systemPrompt: HYPOTHESIS_AXIS_SYSTEM_PROMPT,
      onProgress: (event) => emitProgress(args.onProgress, "Hypothesis axes", event)
    }
  );
  toolCallsUsed += 1;
  llmTrace.axes = {
    prompt: axesPrompt,
    completion: axesCompletion.text
  };
  const parsedAxes = parseHypothesisAxisJson(axesCompletion.text);
  const axes = normalizeHypothesisAxes(parsedAxes.axes, evidencePanel);
  if (axes.length === 0) {
    throw new Error("no_hypothesis_axes");
  }

  const draftTarget = Math.max(args.branchCount + 2, 6);
  const roleCounts = distributeCounts(draftTarget, 3);
  const rolePlan: Array<{ kind: HypothesisGeneratorKind; count: number }> = [
    { kind: "mechanism", count: roleCounts[0] ?? 0 },
    { kind: "contradiction", count: roleCounts[1] ?? 0 },
    { kind: "intervention", count: roleCounts[2] ?? 0 }
  ];

  const draftGroups: HypothesisCandidate[][] = [];
  for (const role of rolePlan) {
    if (role.count <= 0) {
      continue;
    }
    args.onProgress?.(`Generating ${roleLabel(role.kind)} hypothesis drafts (${role.count}).`);
    const rolePrompt = buildHypothesisRolePrompt(
      role.kind,
      args.runTitle,
      args.runTopic,
      args.objectiveMetric,
      axes,
      evidencePanel,
      role.count
    );
    const completion = await args.llm.complete(
      rolePrompt,
      {
        systemPrompt: HYPOTHESIS_SYSTEM_PROMPT,
        onProgress: (event) => emitProgress(args.onProgress, `${roleLabel(role.kind)} drafts`, event)
      }
    );
    toolCallsUsed += 1;
    llmTrace.drafts.push({
      kind: role.kind,
      requested_count: role.count,
      prompt: rolePrompt,
      completion: completion.text
    });
    const parsed = parseHypothesisJson(completion.text);
    const normalized = normalizeHypothesisCandidates(parsed.candidates, role.count, evidencePanel, role.kind);
    draftGroups.push(normalized);
  }

  const drafts = dedupeHypothesisCandidates(draftGroups.flat()).slice(0, Math.max(args.branchCount + 3, args.branchCount));
  if (drafts.length === 0) {
    throw new Error("no_hypothesis_drafts");
  }

  args.onProgress?.(`Reviewing ${drafts.length} hypothesis draft(s) for causal clarity and experimentability.`);
  const reviewPrompt = buildHypothesisReviewPrompt(args.runTitle, args.runTopic, args.objectiveMetric, axes, drafts, args.topK);
  const reviewCompletion = await args.llm.complete(
    reviewPrompt,
    {
      systemPrompt: HYPOTHESIS_REVIEW_SYSTEM_PROMPT,
      onProgress: (event) => emitProgress(args.onProgress, "Hypothesis review", event)
    }
  );
  toolCallsUsed += 1;
  llmTrace.review = {
    prompt: reviewPrompt,
    completion: reviewCompletion.text
  };
  const parsedReviews = parseHypothesisReviewJson(reviewCompletion.text);
  const reviews = normalizeHypothesisReviews(parsedReviews.reviews, drafts);
  const reviewedCandidates = dedupeHypothesisCandidates(applyHypothesisReviews(drafts, reviews));
  const selection = selectHypothesesWithDiversity(reviewedCandidates, reviews, args.topK, args.objectiveMetric);

  if (selection.selected.length === 0) {
    throw new Error("no_selected_hypotheses");
  }

  return {
    source: "llm",
    summary:
      toOptionalString(parsedReviews.summary) ||
      toOptionalString(parsedAxes.summary) ||
      buildHypothesisSelectionSummary(reviewedCandidates, selection.selected, axes, "staged"),
    candidates: reviewedCandidates,
    selected: selection.selected,
    toolCallsUsed,
    artifacts: {
      pipeline: "staged",
      evidence_axes: axes,
      drafts,
      reviews,
      selection: {
        selected_ids: selection.selected.map((candidate) => candidate.id),
        ranked_ids: selection.ranked.map((candidate) => candidate.id),
        scores: selection.scores
      },
      llm_trace: llmTrace
    }
  };
}

export async function designExperimentsFromHypotheses(args: {
  llm: LLMClient;
  runTitle: string;
  runTopic: string;
  objectiveMetric: string;
  hypotheses: DesignInputHypothesis[];
  constraintProfile: ConstraintProfile;
  objectiveProfile: ObjectiveMetricProfile;
  candidateCount?: number;
  onProgress?: (message: string) => void;
}): Promise<ExperimentDesignResult> {
  const candidateCount = Math.max(2, args.candidateCount ?? 3);

  try {
    args.onProgress?.(`Submitting experiment design request for ${args.hypotheses.length} hypothesis/hypotheses.`);
    const completion = await args.llm.complete(
      buildDesignPrompt(
        args.runTitle,
        args.runTopic,
        args.objectiveMetric,
        args.hypotheses,
        args.constraintProfile,
        args.objectiveProfile,
        candidateCount
      ),
      {
        systemPrompt: DESIGN_SYSTEM_PROMPT,
        onProgress: (event) => emitProgress(args.onProgress, "Design LLM", event)
      }
    );
    args.onProgress?.("Received experiment design output. Parsing JSON.");
    const parsed = parseDesignJson(completion.text);
    const candidates = normalizeDesignCandidates(
      parsed.candidates,
      candidateCount,
      args.hypotheses,
      args.constraintProfile,
      args.objectiveProfile
    );
    const selected = selectDesignCandidate(candidates, toOptionalString(parsed.selected_id));
    return {
      source: "llm",
      summary: toOptionalString(parsed.summary) || `Generated ${candidates.length} experiment design candidate(s).`,
      candidates,
      selected
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    args.onProgress?.(`Experiment design fallback: ${reason}`);
    const fallback = buildFallbackDesigns(
      args.hypotheses,
      args.constraintProfile,
      args.objectiveMetric,
      args.objectiveProfile,
      candidateCount
    );
    return {
      source: "fallback",
      summary: `Fallback generated ${fallback.candidates.length} experiment design candidate(s).`,
      candidates: fallback.candidates,
      selected: fallback.selected,
      fallbackReason: reason
    };
  }
}

function buildHypothesisPrompt(
  runTitle: string,
  runTopic: string,
  objectiveMetric: string,
  evidenceSeeds: HypothesisEvidenceSeed[],
  branchCount: number,
  topK: number
): string {
  const lines = [
    "Generate hypothesis branches from the provided evidence.",
    "Return JSON with this exact shape:",
    "{",
    '  "summary": "short string",',
    '  "candidates": [',
    "    {",
    '      "id": "cand_1",',
    '      "text": "hypothesis statement",',
    '      "novelty": 0,',
    '      "feasibility": 0,',
    '      "testability": 0,',
    '      "cost": 0,',
    '      "expected_gain": 0,',
    '      "evidence_links": ["ev_1"],',
    '      "rationale": "short rationale"',
    "    }",
    "  ],",
    '  "selected_ids": ["cand_1"]',
    "}",
    "",
    `Research title: ${runTitle}`,
    `Research topic: ${runTopic}`,
    `Objective metric: ${objectiveMetric || "none"}`,
    `Need ${branchCount} candidate(s) and the best ${topK} selected candidate(s).`,
    "Evidence seeds:"
  ];

  evidenceSeeds.slice(0, 16).forEach((seed, index) => {
    lines.push(
      [
        `${index + 1}. evidence_id=${seed.evidence_id ?? `ev_${index + 1}`}`,
        `paper_id=${seed.paper_id ?? "unknown"}`,
        `claim=${seed.claim ?? "unknown"}`,
        seed.limitation_slot ? `limitation=${seed.limitation_slot}` : undefined,
        seed.dataset_slot ? `dataset=${seed.dataset_slot}` : undefined,
        seed.metric_slot ? `metric=${seed.metric_slot}` : undefined,
        typeof seed.confidence === "number" ? `confidence=${seed.confidence}` : undefined
      ]
        .filter(Boolean)
        .join(" | ")
    );
  });

  return lines.join("\n");
}

function buildHypothesisAxesPrompt(
  runTitle: string,
  runTopic: string,
  objectiveMetric: string,
  evidenceSeeds: HypothesisEvidenceSeed[]
): string {
  const lines = [
    "Synthesize the evidence into 3-5 mechanism-oriented axes for hypothesis generation.",
    "Return JSON with this exact shape:",
    "{",
    '  "summary": "short string",',
    '  "axes": [',
    "    {",
    '      "id": "ax_1",',
    '      "label": "short axis name",',
    '      "mechanism": "why this design choice could change reproducibility",',
    '      "intervention": "what a future experiment would change",',
    '      "boundary_condition": "when the effect may weaken or reverse",',
    '      "evaluation_hint": "what to measure",',
    '      "evidence_links": ["ev_1", "ev_2"]',
    "    }",
    "  ]",
    "}",
    "",
    `Research title: ${runTitle}`,
    `Research topic: ${runTopic}`,
    `Objective metric: ${objectiveMetric || "none"}`,
    "Evidence panel:"
  ];

  evidenceSeeds.forEach((seed, index) => {
    lines.push(renderEvidenceSeed(seed, index));
  });

  return lines.join("\n");
}

function buildHypothesisRolePrompt(
  kind: HypothesisGeneratorKind,
  runTitle: string,
  runTopic: string,
  objectiveMetric: string,
  axes: HypothesisEvidenceAxis[],
  evidenceSeeds: HypothesisEvidenceSeed[],
  candidateCount: number
): string {
  const roleInstruction =
    kind === "mechanism"
      ? "Generate hypotheses that isolate the causal mechanism linking design choices to reproducibility."
      : kind === "contradiction"
        ? "Generate boundary-condition or counterfactual hypotheses from tensions, limitations, and task-dependent results."
        : "Generate intervention-first hypotheses that can be implemented directly as ablations or system changes.";

  const lines = [
    roleInstruction,
    "Return JSON with this exact shape:",
    "{",
    '  "summary": "short string",',
    '  "candidates": [',
    "    {",
    '      "id": "cand_1",',
    '      "text": "hypothesis statement",',
    '      "novelty": 0,',
    '      "feasibility": 0,',
    '      "testability": 0,',
    '      "cost": 0,',
    '      "expected_gain": 0,',
    '      "evidence_links": ["ev_1"],',
    '      "axis_ids": ["ax_1"],',
    '      "rationale": "why this hypothesis follows from the evidence"',
    "    }",
    "  ]",
    "}",
    "",
    `Research title: ${runTitle}`,
    `Research topic: ${runTopic}`,
    `Objective metric: ${objectiveMetric || "none"}`,
    `Need ${candidateCount} candidate(s).`,
    "Evidence axes:"
  ];

  axes.forEach((axis, index) => {
    lines.push(
      [
        `${index + 1}. axis_id=${axis.id}`,
        `label=${axis.label}`,
        `mechanism=${axis.mechanism}`,
        `intervention=${axis.intervention}`,
        axis.boundary_condition ? `boundary=${axis.boundary_condition}` : undefined,
        axis.evaluation_hint ? `evaluation=${axis.evaluation_hint}` : undefined,
        axis.evidence_links.length > 0 ? `evidence_links=${axis.evidence_links.join(",")}` : undefined
      ]
        .filter(Boolean)
        .join(" | ")
    );
  });

  lines.push("Supporting evidence panel:");
  evidenceSeeds.slice(0, 16).forEach((seed, index) => {
    lines.push(renderEvidenceSeed(seed, index));
  });

  return lines.join("\n");
}

function buildHypothesisReviewPrompt(
  runTitle: string,
  runTopic: string,
  objectiveMetric: string,
  axes: HypothesisEvidenceAxis[],
  candidates: HypothesisCandidate[],
  topK: number
): string {
  const lines = [
    "Review the hypothesis drafts skeptically.",
    "Reject unsupported or conflated hypotheses. Revise wording when the idea is salvageable.",
    "Prefer hypotheses that are grounded in evidence, isolate the intervention, and can be falsified by a concrete experiment.",
    "If the objective metric is reproducibility, prefer hypotheses that explicitly predict repeated-run stability, variance reduction, artifact consistency, or failure-mode stability rather than raw performance alone.",
    "Return JSON with this exact shape:",
    "{",
    '  "summary": "short string",',
    '  "reviews": [',
    "    {",
    '      "candidate_id": "cand_1",',
    '      "keep": true,',
    '      "groundedness": 0,',
    '      "causal_clarity": 0,',
    '      "falsifiability": 0,',
    '      "experimentability": 0,',
    '      "reproducibility_specificity": 0,',
    '      "reproducibility_signals": ["run_to_run_variance"],',
    '      "measurement_hint": "how to operationalize the reproducibility outcome",',
    '      "strengths": ["short point"],',
    '      "weaknesses": ["short point"],',
    '      "critique_summary": "one-line verdict",',
    '      "revised_text": "optional improved hypothesis statement",',
    '      "revised_rationale": "optional improved rationale"',
    "    }",
    "  ]",
    "}",
    "",
    `Research title: ${runTitle}`,
    `Research topic: ${runTopic}`,
    `Objective metric: ${objectiveMetric || "none"}`,
    `Selectable target count: ${topK}`,
    isReproducibilityObjective(objectiveMetric)
      ? "Review emphasis: reject hypotheses that fail to name a reproducibility signal such as repeated-run variance, trajectory stability, artifact consistency, or failure-mode stability."
      : "Review emphasis: keep the hypothesis tightly aligned to the stated objective metric.",
    "Evidence axes:"
  ];

  axes.forEach((axis, index) => {
    lines.push(
      [
        `${index + 1}. axis_id=${axis.id}`,
        `label=${axis.label}`,
        `mechanism=${axis.mechanism}`,
        `intervention=${axis.intervention}`,
        axis.boundary_condition ? `boundary=${axis.boundary_condition}` : undefined
      ]
        .filter(Boolean)
        .join(" | ")
    );
  });

  lines.push("Hypothesis drafts:");
  candidates.forEach((candidate, index) => {
    lines.push(
      [
        `${index + 1}. candidate_id=${candidate.id}`,
        `text=${candidate.text}`,
        candidate.generator_kind ? `generator=${candidate.generator_kind}` : undefined,
        candidate.axis_ids?.length ? `axis_ids=${candidate.axis_ids.join(",")}` : undefined,
        candidate.evidence_links.length > 0 ? `evidence_links=${candidate.evidence_links.join(",")}` : undefined,
        candidate.rationale ? `rationale=${candidate.rationale}` : undefined
      ]
        .filter(Boolean)
        .join(" | ")
    );
  });

  return lines.join("\n");
}

function buildDesignPrompt(
  runTitle: string,
  runTopic: string,
  objectiveMetric: string,
  hypotheses: DesignInputHypothesis[],
  constraintProfile: ConstraintProfile,
  objectiveProfile: ObjectiveMetricProfile,
  candidateCount: number
): string {
  const lines = [
    "Generate executable experiment design candidates.",
    "Translate hypothesis measurement hints and reproducibility signals into explicit metrics, baselines, instrumentation notes, and repeated-run evaluation steps.",
    "If the objective is reproducibility, include at least one repeated-run stability metric and a baseline representing the unmodified system.",
    "Return JSON with this exact shape:",
    "{",
    '  "summary": "short string",',
    '  "candidates": [',
    "    {",
    '      "id": "plan_1",',
    '      "title": "short design title",',
    '      "hypothesis_ids": ["h_1"],',
    '      "plan_summary": "what will be tested and why",',
    '      "datasets": ["dataset"],',
    '      "metrics": ["metric"],',
    '      "baselines": ["baseline"],',
    '      "implementation_notes": ["note"],',
    '      "evaluation_steps": ["step"],',
    '      "risks": ["risk"],',
    '      "budget_notes": ["budget note"]',
    "    }",
    "  ],",
    '  "selected_id": "plan_1"',
    "}",
    "",
    `Research title: ${runTitle}`,
    `Research topic: ${runTopic}`,
    `Objective metric: ${objectiveMetric || "none"}`,
    "Constraint profile:",
    JSON.stringify(constraintProfile, null, 2),
    "Objective metric profile:",
    JSON.stringify(objectiveProfile, null, 2),
    `Need ${candidateCount} candidate design(s).`,
    isReproducibilityObjective(objectiveMetric)
      ? "Design emphasis: operationalize reproducibility using repeated-run variance, consistency, stability, or agreement metrics in addition to raw task performance."
      : "Design emphasis: align metrics and baselines tightly to the objective profile.",
    "Hypotheses:"
  ];

  hypotheses.slice(0, 8).forEach((hypothesis, index) => {
    lines.push(
      [
        `${index + 1}. hypothesis_id=${hypothesis.hypothesis_id}`,
        `text=${hypothesis.text}`,
        typeof hypothesis.score === "number" ? `score=${hypothesis.score}` : undefined,
        typeof hypothesis.groundedness === "number" ? `groundedness=${hypothesis.groundedness}` : undefined,
        typeof hypothesis.causal_clarity === "number" ? `causal_clarity=${hypothesis.causal_clarity}` : undefined,
        typeof hypothesis.falsifiability === "number" ? `falsifiability=${hypothesis.falsifiability}` : undefined,
        typeof hypothesis.experimentability === "number" ? `experimentability=${hypothesis.experimentability}` : undefined,
        typeof hypothesis.reproducibility_specificity === "number"
          ? `reproducibility_specificity=${hypothesis.reproducibility_specificity}`
          : undefined,
        hypothesis.reproducibility_signals?.length
          ? `reproducibility_signals=${hypothesis.reproducibility_signals.join(",")}`
          : undefined,
        hypothesis.measurement_hint ? `measurement_hint=${hypothesis.measurement_hint}` : undefined,
        hypothesis.critique_summary ? `critique=${hypothesis.critique_summary}` : undefined,
        hypothesis.evidence_links?.length ? `evidence_links=${hypothesis.evidence_links.join(",")}` : undefined
      ]
        .filter(Boolean)
        .join(" | ")
    );
  });

  return lines.join("\n");
}

function parseHypothesisJson(text: string): RawHypothesisJson {
  const candidate = extractFirstJsonObject(text);
  const parsed = JSON.parse(candidate) as RawHypothesisJson;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_hypothesis_json");
  }
  return parsed;
}

function parseHypothesisAxisJson(text: string): RawHypothesisAxisJson {
  const candidate = extractFirstJsonObject(text);
  const parsed = JSON.parse(candidate) as RawHypothesisAxisJson;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_hypothesis_axis_json");
  }
  return parsed;
}

function parseHypothesisReviewJson(text: string): RawHypothesisReviewJson {
  const candidate = extractFirstJsonObject(text);
  const parsed = JSON.parse(candidate) as RawHypothesisReviewJson;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_hypothesis_review_json");
  }
  return parsed;
}

function parseDesignJson(text: string): RawDesignJson {
  const candidate = extractFirstJsonObject(text);
  const parsed = JSON.parse(candidate) as RawDesignJson;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_design_json");
  }
  return parsed;
}

function normalizeHypothesisCandidates(
  rawCandidates: unknown,
  branchCount: number,
  evidenceSeeds: HypothesisEvidenceSeed[],
  generatorKind: HypothesisGeneratorKind
): HypothesisCandidate[] {
  const items = Array.isArray(rawCandidates) ? rawCandidates : [];
  const normalized = items
    .map((item, index) => normalizeHypothesisCandidate(item as RawHypothesisCandidate, index, evidenceSeeds, generatorKind))
    .filter((candidate): candidate is HypothesisCandidate => Boolean(candidate))
    .slice(0, branchCount);
  return dedupeById(normalized, (candidate) => candidate.id);
}

function normalizeHypothesisCandidate(
  raw: RawHypothesisCandidate,
  index: number,
  evidenceSeeds: HypothesisEvidenceSeed[],
  generatorKind: HypothesisGeneratorKind
): HypothesisCandidate | undefined {
  const text = toOptionalString(raw.text);
  if (!text) {
    return undefined;
  }
  const evidenceLinks = normalizeStringArray(raw.evidence_links).filter(Boolean);
  const fallbackEvidence = evidenceLinks.length > 0 ? evidenceLinks : [evidenceSeeds[index % Math.max(1, evidenceSeeds.length)]?.evidence_id || "ev_1"];
  return {
    id: buildHypothesisCandidateId(generatorKind, index),
    text,
    novelty: clampScore(raw.novelty),
    feasibility: clampScore(raw.feasibility),
    testability: clampScore(raw.testability),
    cost: clampScore(raw.cost),
    expected_gain: clampScore(raw.expected_gain),
    evidence_links: dedupeStrings(fallbackEvidence),
    rationale: toOptionalString(raw.rationale),
    generator_kind: generatorKind,
    axis_ids: normalizeStringArray(raw.axis_ids)
  };
}

function normalizeHypothesisAxes(
  rawAxes: unknown,
  evidenceSeeds: HypothesisEvidenceSeed[]
): HypothesisEvidenceAxis[] {
  const items = Array.isArray(rawAxes) ? rawAxes : [];
  const normalized = items
    .map((item, index) => normalizeHypothesisAxis(item as RawHypothesisAxis, index, evidenceSeeds))
    .filter((axis): axis is HypothesisEvidenceAxis => Boolean(axis))
    .slice(0, 5);

  return dedupeById(normalized, (axis) => axis.id);
}

function normalizeHypothesisAxis(
  raw: RawHypothesisAxis,
  index: number,
  evidenceSeeds: HypothesisEvidenceSeed[]
): HypothesisEvidenceAxis | undefined {
  const label = toOptionalString(raw.label);
  const mechanism = toOptionalString(raw.mechanism);
  const intervention = toOptionalString(raw.intervention);
  if (!label || !mechanism || !intervention) {
    return undefined;
  }
  const evidenceLinks = normalizeStringArray(raw.evidence_links);
  const fallbackEvidence =
    evidenceLinks.length > 0
      ? evidenceLinks
      : [evidenceSeeds[index % Math.max(1, evidenceSeeds.length)]?.evidence_id || "ev_1"];

  return {
    id: toOptionalString(raw.id) || `ax_${index + 1}`,
    label,
    mechanism,
    intervention,
    boundary_condition: toOptionalString(raw.boundary_condition),
    evaluation_hint: toOptionalString(raw.evaluation_hint),
    evidence_links: dedupeStrings(fallbackEvidence)
  };
}

function normalizeHypothesisReviews(
  rawReviews: unknown,
  candidates: HypothesisCandidate[]
): HypothesisReview[] {
  const byId = new Set(candidates.map((candidate) => candidate.id));
  const items = Array.isArray(rawReviews) ? rawReviews : [];
  const normalized: HypothesisReview[] = [];
  for (const item of items) {
    const review = normalizeHypothesisReview(item as RawHypothesisReview);
    if (!review || !byId.has(review.candidate_id)) {
      continue;
    }
    normalized.push(review);
  }
  return dedupeById(normalized, (review) => review.candidate_id);
}

function normalizeHypothesisReview(raw: RawHypothesisReview): HypothesisReview | undefined {
  const candidateId = toOptionalString(raw.candidate_id);
  if (!candidateId) {
    return undefined;
  }
  return {
    candidate_id: candidateId,
    keep: raw.keep === false ? false : true,
    groundedness: clampScore(raw.groundedness),
    causal_clarity: clampScore(raw.causal_clarity),
    falsifiability: clampScore(raw.falsifiability),
    experimentability: clampScore(raw.experimentability),
    reproducibility_specificity: clampScore(raw.reproducibility_specificity),
    reproducibility_signals: normalizeStringArray(raw.reproducibility_signals),
    measurement_hint: toOptionalString(raw.measurement_hint),
    strengths: normalizeStringArray(raw.strengths),
    weaknesses: normalizeStringArray(raw.weaknesses),
    critique_summary: toOptionalString(raw.critique_summary),
    revised_text: toOptionalString(raw.revised_text),
    revised_rationale: toOptionalString(raw.revised_rationale)
  };
}

function applyHypothesisReviews(
  candidates: HypothesisCandidate[],
  reviews: HypothesisReview[]
): HypothesisCandidate[] {
  const reviewMap = new Map(reviews.map((review) => [review.candidate_id, review] as const));
  return candidates.map((candidate) => {
    const review = reviewMap.get(candidate.id);
    if (!review) {
      return candidate;
    }
    return {
      ...candidate,
      text: review.revised_text || candidate.text,
      rationale: review.revised_rationale || candidate.rationale,
      groundedness: review.groundedness,
      causal_clarity: review.causal_clarity,
      falsifiability: review.falsifiability,
      experimentability: review.experimentability,
      reproducibility_specificity: review.reproducibility_specificity,
      reproducibility_signals: review.reproducibility_signals,
      measurement_hint: review.measurement_hint,
      critique_summary: review.critique_summary
    };
  });
}

function buildHypothesisCandidateId(generatorKind: HypothesisGeneratorKind, index: number): string {
  return `${generatorKind}_${index + 1}`;
}

function selectHypothesesWithDiversity(
  candidates: HypothesisCandidate[],
  reviews: HypothesisReview[],
  topK: number,
  objectiveMetric?: string
): { selected: HypothesisCandidate[]; ranked: HypothesisCandidate[]; scores: HypothesisSelectionScore[] } {
  const reviewMap = new Map(reviews.map((review) => [review.candidate_id, review] as const));
  const kept = candidates.filter((candidate) => reviewMap.get(candidate.id)?.keep !== false);
  const pool = kept.length >= topK ? kept : candidates;
  const adjustedBaseById = new Map(
    pool.map((candidate) => [
      candidate.id,
      buildHypothesisSelectionBase(candidate, reviewMap.get(candidate.id), objectiveMetric)
    ] as const)
  );
  const ranked = [...pool].sort(
    (a, b) =>
      (adjustedBaseById.get(b.id)?.base_score ?? hypothesisBaseScore(b, objectiveMetric)) -
        (adjustedBaseById.get(a.id)?.base_score ?? hypothesisBaseScore(a, objectiveMetric)) ||
      b.testability - a.testability ||
      b.feasibility - a.feasibility ||
      a.cost - b.cost ||
      a.id.localeCompare(b.id)
  );

  const selected: HypothesisCandidate[] = [];
  const scores: HypothesisSelectionScore[] = [];
  const remaining = [...ranked];

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestSelection: HypothesisSelectionScore | undefined;
    const requireImplementableTopSlot =
      selected.length === 0 && remaining.some((candidate) => (candidate.experimentability ?? 0) >= 4);

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      if (requireImplementableTopSlot && (candidate.experimentability ?? 0) < 4) {
        continue;
      }
      const score = buildHypothesisSelectionScore(
        candidate,
        selected,
        adjustedBaseById.get(candidate.id) ?? buildHypothesisSelectionBase(candidate, reviewMap.get(candidate.id), objectiveMetric)
      );
      if (score.final_score > bestScore) {
        bestIndex = index;
        bestScore = score.final_score;
        bestSelection = score;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) {
      break;
    }
    selected.push(chosen);
    if (bestSelection) {
      scores.push(bestSelection);
    }
  }

  for (const candidate of ranked) {
    if (scores.some((entry) => entry.candidate_id === candidate.id)) {
      continue;
    }
    scores.push(
      buildHypothesisSelectionScore(
        candidate,
        selected.filter((item) => item.id !== candidate.id),
        adjustedBaseById.get(candidate.id) ?? buildHypothesisSelectionBase(candidate, reviewMap.get(candidate.id), objectiveMetric)
      )
    );
  }

  return { selected, ranked, scores };
}

function buildFallbackHypotheses(
  evidenceSeeds: HypothesisEvidenceSeed[],
  branchCount: number,
  topK: number
): { candidates: HypothesisCandidate[]; selected: HypothesisCandidate[] } {
  const seeds = evidenceSeeds.length === 0
    ? ["baseline evidence gap"]
    : evidenceSeeds.slice(0, 8).map((seed, index) =>
        [
          seed.claim || `evidence_${index + 1}`,
          seed.dataset_slot ? `dataset=${seed.dataset_slot}` : undefined,
          seed.metric_slot ? `metric=${seed.metric_slot}` : undefined,
          seed.limitation_slot ? `limitation=${seed.limitation_slot}` : undefined
        ]
          .filter(Boolean)
          .join(" | ")
      );
  const tot = runTreeOfThoughts(seeds, { branchCount, topK });
  const candidates: HypothesisCandidate[] = tot.candidates.map((candidate, index) => ({
    id: candidate.id,
    text: candidate.text,
    novelty: candidate.novelty,
    feasibility: candidate.feasibility,
    testability: candidate.testability,
    cost: candidate.cost,
    expected_gain: candidate.expected_gain,
    evidence_links: [evidenceSeeds[index % Math.max(1, evidenceSeeds.length)]?.evidence_id || "ev_1"],
    rationale: "deterministic fallback",
    generator_kind: "fallback"
  }));
  const selected = tot.selected
    .map((candidate) => candidates.find((item) => item.id === candidate.id))
    .filter((candidate): candidate is HypothesisCandidate => candidate !== undefined);
  return { candidates, selected };
}

function selectHypothesisEvidencePanel(
  evidenceSeeds: HypothesisEvidenceSeed[],
  limit: number
): HypothesisEvidenceSeed[] {
  const scored = evidenceSeeds
    .map((seed, index) => ({
      seed,
      index,
      score:
        (typeof seed.confidence === "number" ? seed.confidence * 4 : 0) +
        (seed.limitation_slot ? 3 : 0) +
        (seed.dataset_slot ? 2 : 0) +
        (seed.metric_slot ? 2 : 0) +
        (seed.claim ? Math.min(2, seed.claim.length / 80) : 0)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: HypothesisEvidenceSeed[] = [];
  const seenPaperIds = new Set<string>();

  for (const entry of scored) {
    const paperId = entry.seed.paper_id || "";
    if (paperId && seenPaperIds.has(paperId)) {
      continue;
    }
    selected.push(entry.seed);
    if (paperId) {
      seenPaperIds.add(paperId);
    }
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const entry of scored) {
    if (selected.includes(entry.seed)) {
      continue;
    }
    selected.push(entry.seed);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function renderEvidenceSeed(seed: HypothesisEvidenceSeed, index: number): string {
  return [
    `${index + 1}. evidence_id=${seed.evidence_id ?? `ev_${index + 1}`}`,
    `paper_id=${seed.paper_id ?? "unknown"}`,
    `claim=${seed.claim ?? "unknown"}`,
    seed.limitation_slot ? `limitation=${seed.limitation_slot}` : undefined,
    seed.dataset_slot ? `dataset=${seed.dataset_slot}` : undefined,
    seed.metric_slot ? `metric=${seed.metric_slot}` : undefined,
    typeof seed.confidence === "number" ? `confidence=${seed.confidence}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");
}

function roleLabel(kind: HypothesisGeneratorKind): string {
  switch (kind) {
    case "mechanism":
      return "mechanism";
    case "contradiction":
      return "contradiction";
    case "intervention":
      return "intervention";
    case "fallback":
      return "fallback";
    case "single_pass":
      return "single-pass";
    default:
      return "hypothesis";
  }
}

function distributeCounts(total: number, buckets: number): number[] {
  const safeBuckets = Math.max(1, buckets);
  const base = Math.floor(total / safeBuckets);
  const remainder = total % safeBuckets;
  return Array.from({ length: safeBuckets }, (_unused, index) => base + (index < remainder ? 1 : 0));
}

function dedupeHypothesisCandidates(candidates: HypothesisCandidate[]): HypothesisCandidate[] {
  const byText = new Map<string, HypothesisCandidate>();
  for (const candidate of candidates) {
    const key = normalizeHypothesisText(candidate.text);
    const existing = byText.get(key);
    if (!existing) {
      byText.set(key, candidate);
      continue;
    }
    byText.set(key, {
      ...existing,
      evidence_links: dedupeStrings([...existing.evidence_links, ...candidate.evidence_links]),
      axis_ids: dedupeStrings([...(existing.axis_ids || []), ...(candidate.axis_ids || [])]),
      novelty: Math.max(existing.novelty, candidate.novelty),
      feasibility: Math.max(existing.feasibility, candidate.feasibility),
      testability: Math.max(existing.testability, candidate.testability),
      expected_gain: Math.max(existing.expected_gain, candidate.expected_gain),
      cost: Math.min(existing.cost, candidate.cost),
      rationale: existing.rationale || candidate.rationale,
      generator_kind: existing.generator_kind || candidate.generator_kind
    });
  }
  return [...byText.values()];
}

function buildHypothesisSelectionSummary(
  candidates: HypothesisCandidate[],
  selected: HypothesisCandidate[],
  axes: HypothesisEvidenceAxis[],
  pipelineLabel: string
): string {
  const axisMap = new Map(axes.map((axis) => [axis.id, axis.label] as const));
  const selectedThemes = dedupeStrings(
    selected.flatMap((candidate) => (candidate.axis_ids || []).map((axisId) => axisMap.get(axisId) || ""))
  ).filter(Boolean);
  const themeText =
    selectedThemes.length > 0
      ? ` with the strongest bets centered on ${selectedThemes.slice(0, 3).join(", ")}`
      : "";
  return `Generated ${candidates.length} reviewed hypothesis candidate(s) using the ${pipelineLabel} pipeline; selected ${selected.length}${themeText}.`;
}

function normalizeDesignCandidates(
  rawCandidates: unknown,
  candidateCount: number,
  hypotheses: DesignInputHypothesis[],
  constraintProfile: ConstraintProfile,
  objectiveProfile: ObjectiveMetricProfile
): ExperimentDesignCandidate[] {
  const items = Array.isArray(rawCandidates) ? rawCandidates : [];
  const normalized = items
    .map((item, index) =>
      normalizeDesignCandidate(item as RawDesignCandidate, index, hypotheses, constraintProfile, objectiveProfile)
    )
    .filter((candidate): candidate is ExperimentDesignCandidate => Boolean(candidate))
    .slice(0, candidateCount);
  if (normalized.length === 0) {
    throw new Error("no_design_candidates");
  }
  return dedupeById(normalized, (candidate) => candidate.id);
}

function normalizeDesignCandidate(
  raw: RawDesignCandidate,
  index: number,
  hypotheses: DesignInputHypothesis[],
  constraintProfile: ConstraintProfile,
  objectiveProfile: ObjectiveMetricProfile
): ExperimentDesignCandidate | undefined {
  const title = toOptionalString(raw.title);
  const planSummary = toOptionalString(raw.plan_summary);
  if (!title || !planSummary) {
    return undefined;
  }
  const hypothesisIds = normalizeStringArray(raw.hypothesis_ids);
  const fallbackHypothesisIds = hypothesisIds.length > 0 ? hypothesisIds : hypotheses.slice(0, 1).map((item) => item.hypothesis_id);
  const matchedHypotheses = hypotheses.filter((item) => fallbackHypothesisIds.includes(item.hypothesis_id));
  const guidance = mergeDesignGuidance(
    matchedHypotheses.map((hypothesis) => buildHypothesisDesignGuidance(hypothesis, objectiveProfile))
  );
  return {
    id: toOptionalString(raw.id) || `plan_${index + 1}`,
    title,
    hypothesis_ids: dedupeStrings(fallbackHypothesisIds),
    plan_summary: planSummary,
    datasets: normalizeStringArray(raw.datasets),
    metrics: dedupeStrings([...normalizeStringArray(raw.metrics), ...guidance.metrics]),
    baselines: dedupeStrings([...normalizeStringArray(raw.baselines), ...guidance.baselines]),
    implementation_notes: dedupeStrings([
      ...normalizeStringArray(raw.implementation_notes),
      ...guidance.implementationNotes
    ]),
    evaluation_steps: dedupeStrings([...normalizeStringArray(raw.evaluation_steps), ...guidance.evaluationSteps]),
    risks: normalizeStringArray(raw.risks),
    budget_notes:
      normalizeStringArray(raw.budget_notes).length > 0
        ? normalizeStringArray(raw.budget_notes)
        : buildDefaultBudgetNotes(constraintProfile)
  };
}

function selectDesignCandidate(
  candidates: ExperimentDesignCandidate[],
  selectedId?: string
): ExperimentDesignCandidate {
  if (selectedId) {
    const explicit = candidates.find((candidate) => candidate.id === selectedId);
    if (explicit) {
      return explicit;
    }
  }
  return [...candidates].sort((a, b) => b.hypothesis_ids.length - a.hypothesis_ids.length || a.id.localeCompare(b.id))[0];
}

function buildFallbackDesigns(
  hypotheses: DesignInputHypothesis[],
  constraintProfile: ConstraintProfile,
  objectiveMetric: string,
  objectiveProfile: ObjectiveMetricProfile,
  candidateCount: number
): { candidates: ExperimentDesignCandidate[]; selected: ExperimentDesignCandidate } {
  const base =
    hypotheses.length > 0
      ? hypotheses.slice(0, Math.max(1, candidateCount))
      : [{ hypothesis_id: "h_1", text: "Baseline hypothesis placeholder." }];
  const candidates = base.map((hypothesis, index) => {
    const guidance = buildHypothesisDesignGuidance(hypothesis, objectiveProfile);
    return {
      id: `plan_${index + 1}`,
      title: `Plan ${index + 1}: ${truncateText(hypothesis.text, 72)}`,
      hypothesis_ids: [hypothesis.hypothesis_id],
      plan_summary: `Test ${hypothesis.text} against configured baselines and evaluate with ${objectiveMetric || "the run objective metric"}.`,
      datasets:
        (constraintProfile.collect.fieldsOfStudy?.length ?? 0) > 0
          ? [...(constraintProfile.collect.fieldsOfStudy || [])]
          : ["dataset_to_be_selected"],
      metrics: dedupeStrings([objectiveMetric || "primary_metric", ...guidance.metrics]),
      baselines: dedupeStrings(["current_best_baseline", ...guidance.baselines]),
      implementation_notes: [
        ...constraintProfile.experiment.implementationNotes,
        ...guidance.implementationNotes,
        "Keep the implementation minimal and reproducible."
      ],
      evaluation_steps: [
        ...constraintProfile.experiment.evaluationNotes,
        ...guidance.evaluationSteps,
        "Compare the hypothesis-driven change against the baseline."
      ],
      risks: ["Specification may be underspecified and require narrower scope."],
      budget_notes: buildDefaultBudgetNotes(constraintProfile)
    };
  });
  const selected = candidates[0]!;
  return { candidates, selected };
}

interface DesignGuidance {
  metrics: string[];
  baselines: string[];
  implementationNotes: string[];
  evaluationSteps: string[];
}

function buildHypothesisDesignGuidance(
  hypothesis: DesignInputHypothesis,
  objectiveProfile: ObjectiveMetricProfile
): DesignGuidance {
  const text = hypothesis.text.toLowerCase();
  const guidance: DesignGuidance = {
    metrics: [],
    baselines: [],
    implementationNotes: [],
    evaluationSteps: []
  };

  if (objectiveProfile.primaryMetric) {
    guidance.metrics.push(objectiveProfile.primaryMetric);
  }
  guidance.metrics.push(...objectiveProfile.preferredMetricKeys);

  for (const signal of hypothesis.reproducibility_signals || []) {
    switch (signal) {
      case "run_to_run_variance":
        guidance.metrics.push("run_to_run_variance");
        guidance.evaluationSteps.push("Repeat each condition across multiple seeded runs and report run-to-run variance.");
        break;
      case "pass_rate_variance":
        guidance.metrics.push("pass_rate_variance");
        guidance.evaluationSteps.push("Compare pass-rate variance across repeated runs for each condition.");
        break;
      case "failure_mode_stability":
        guidance.metrics.push("failure_mode_stability");
        guidance.evaluationSteps.push("Track whether failure categories remain stable across repeated runs.");
        break;
      case "artifact_consistency":
        guidance.metrics.push("artifact_consistency_rate");
        guidance.evaluationSteps.push("Measure whether generated intermediate and final artifacts remain consistent across repeated runs.");
        break;
      case "trajectory_stability":
        guidance.metrics.push("trace_stability");
        guidance.evaluationSteps.push("Compare execution traces or agent trajectories across repeated runs.");
        break;
      case "output_consistency":
        guidance.metrics.push("output_consistency_rate");
        guidance.evaluationSteps.push("Measure output agreement across repeated runs under the same setup.");
        break;
      case "message_validity":
        guidance.metrics.push("message_schema_validity");
        guidance.evaluationSteps.push("Check the validity rate of messages against the expected schema.");
        break;
      default:
        guidance.metrics.push(signal);
        break;
    }
  }

  if (hypothesis.measurement_hint) {
    guidance.implementationNotes.push(`Instrumentation should support: ${hypothesis.measurement_hint}`);
    guidance.evaluationSteps.push(`Operationalize the primary comparison as: ${hypothesis.measurement_hint}`);
  }

  if (isReproducibilityObjective(objectiveProfile.raw)) {
    guidance.metrics.push("reproducibility");
    guidance.evaluationSteps.push("Run each condition with identical task inputs and multiple random seeds.");
  }

  if (/free-form chat|free form chat|unconstrained chat|dialogue|dialog/.test(text)) {
    guidance.baselines.push("free_form_chat_baseline");
  }
  if (/schema|structured communication|typed message|message routing|subscription/.test(text)) {
    guidance.baselines.push("unstructured_message_baseline");
  }
  if (/feedback|execute-test-repair|execute|test-repair|repair loop|bounded retr/.test(text)) {
    guidance.baselines.push("no_feedback_baseline");
    guidance.baselines.push("discussion_only_baseline");
  }
  if (/role|decomposition|solo|minimally collaborative|minimal collaboration/.test(text)) {
    guidance.baselines.push("solo_baseline");
    guidance.baselines.push("minimal_collaboration_baseline");
  }

  if (guidance.baselines.length === 0) {
    guidance.baselines.push("current_best_baseline");
  }

  return {
    metrics: dedupeStrings(guidance.metrics),
    baselines: dedupeStrings(guidance.baselines),
    implementationNotes: dedupeStrings(guidance.implementationNotes),
    evaluationSteps: dedupeStrings(guidance.evaluationSteps)
  };
}

function mergeDesignGuidance(items: DesignGuidance[]): DesignGuidance {
  return {
    metrics: dedupeStrings(items.flatMap((item) => item.metrics)),
    baselines: dedupeStrings(items.flatMap((item) => item.baselines)),
    implementationNotes: dedupeStrings(items.flatMap((item) => item.implementationNotes)),
    evaluationSteps: dedupeStrings(items.flatMap((item) => item.evaluationSteps))
  };
}

function scoreHypothesis(candidate: HypothesisCandidate): number {
  return candidate.novelty + candidate.feasibility + candidate.testability + candidate.expected_gain - candidate.cost;
}

function hypothesisBaseScore(candidate: HypothesisCandidate, objectiveMetric?: string): number {
  let score =
    candidate.novelty +
    candidate.feasibility +
    candidate.testability * 1.5 +
    candidate.expected_gain +
    (candidate.groundedness ?? 0) * 1.5 +
    (candidate.causal_clarity ?? 0) * 1.25 +
    (candidate.falsifiability ?? 0) * 1.5 +
    (candidate.experimentability ?? 0) * 1.5 -
    candidate.cost * 1.25;

  score += (candidate.reproducibility_specificity ?? 0) * 1.5;

  if (isReproducibilityObjective(objectiveMetric)) {
    score += (candidate.reproducibility_signals?.length ?? 0) > 0 ? 1.25 : -2;
    score += candidate.measurement_hint ? 1.25 : -1.5;
    if ((candidate.reproducibility_specificity ?? 0) < 3) {
      score -= 2;
    }
  }

  return score;
}

function buildHypothesisSelectionBase(
  candidate: HypothesisCandidate,
  review: HypothesisReview | undefined,
  objectiveMetric?: string
): {
  raw_base_score: number;
  base_score: number;
  implementation_bonus: number;
  bundling_penalty: number;
  scope_penalty: number;
} {
  const rawBaseScore = hypothesisBaseScore(candidate, objectiveMetric);
  const implementationBonus = hypothesisImplementationBonus(candidate, review);
  const bundlingPenalty = hypothesisBundlingPenalty(candidate, review);
  const scopePenalty = hypothesisScopePenalty(candidate, review);
  return {
    raw_base_score: rawBaseScore,
    base_score: rawBaseScore + implementationBonus - bundlingPenalty - scopePenalty,
    implementation_bonus: implementationBonus,
    bundling_penalty: bundlingPenalty,
    scope_penalty: scopePenalty
  };
}

function buildHypothesisSelectionScore(
  candidate: HypothesisCandidate,
  selected: HypothesisCandidate[],
  adjustedBase: {
    raw_base_score: number;
    base_score: number;
    implementation_bonus: number;
    bundling_penalty: number;
    scope_penalty: number;
  }
): HypothesisSelectionScore {
  const diversityPenalty = calculateDiversityPenalty(candidate, selected);
  return {
    candidate_id: candidate.id,
    raw_base_score: adjustedBase.raw_base_score,
    base_score: adjustedBase.base_score,
    implementation_bonus: adjustedBase.implementation_bonus,
    bundling_penalty: adjustedBase.bundling_penalty,
    scope_penalty: adjustedBase.scope_penalty,
    diversity_penalty: diversityPenalty,
    final_score: adjustedBase.base_score - diversityPenalty
  };
}

function hypothesisImplementationBonus(
  candidate: HypothesisCandidate,
  review: HypothesisReview | undefined
): number {
  let bonus = 0;
  const experimentability = candidate.experimentability ?? 0;
  if (experimentability >= 5) {
    bonus += 2.5;
  } else if (experimentability >= 4) {
    bonus += 2;
  } else if (experimentability >= 3) {
    bonus += 0.5;
  }

  if (candidate.measurement_hint) {
    bonus += 0.75;
  }
  if ((candidate.reproducibility_signals?.length ?? 0) >= 2) {
    bonus += 0.5;
  }
  if (candidate.cost <= 4) {
    bonus += 0.5;
  }

  const strengthsText = (review?.strengths ?? []).join(" ").toLowerCase();
  if (/(directly implementable|clear baseline|clear control|concrete intervention|direct intervention)/.test(strengthsText)) {
    bonus += 0.5;
  }

  return bonus;
}

function hypothesisBundlingPenalty(
  candidate: HypothesisCandidate,
  review: HypothesisReview | undefined
): number {
  const text = buildHypothesisSelectionText(candidate, review);
  let penalty = 0;

  if (
    /(separate arms|combined treatment|multiple interventions|conflat|merges? two distinct|over-bundle|overbundle)/.test(text)
  ) {
    penalty = Math.max(penalty, 4);
  } else if (
    /(one package|package rather than isolating|treats several .* as one package|not isolate|combined method|bundled|bundles|merged|consisting of .* and .* and )/.test(
      text
    )
  ) {
    penalty = Math.max(penalty, 2);
  }

  if ((candidate.axis_ids?.length ?? 0) > 1) {
    penalty += 0.5;
  }

  return Math.min(5, penalty);
}

function hypothesisScopePenalty(
  candidate: HypothesisCandidate,
  review: HypothesisReview | undefined
): number {
  const text = buildHypothesisSelectionText(candidate, review);
  let penalty = 0;
  const trainingLike = /(train each regime|training regime|fine-tun|policy optimization|distillation|supervised fine-tuning|sft|checkpoint)/.test(
    text
  );

  if (trainingLike) {
    penalty += 1.5;
  }
  if (trainingLike && /checkpoints?/.test(text)) {
    penalty += 0.75;
  }
  if (trainingLike && /(downstream tasks|cross-task|task outcomes|task-success|near ceiling|single-agent baseline)/.test(text)) {
    penalty += 0.75;
  }
  if (trainingLike && /(interaction-data|data regime|data size|sweep)/.test(text)) {
    penalty += 0.5;
  }
  if (/(too broad and expensive|unnecessarily wide|scope unnecessarily wide|experimental scope)/.test(text)) {
    penalty = Math.max(penalty, 3);
  }

  return Math.min(3.5, penalty);
}

function buildHypothesisSelectionText(
  candidate: HypothesisCandidate,
  review: HypothesisReview | undefined
): string {
  return [
    candidate.text,
    candidate.measurement_hint,
    candidate.critique_summary,
    review?.critique_summary,
    ...(review?.strengths ?? []),
    ...(review?.weaknesses ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function calculateDiversityPenalty(candidate: HypothesisCandidate, selected: HypothesisCandidate[]): number {
  if (selected.length === 0) {
    return 0;
  }
  let penalty = 0;
  for (const item of selected) {
    penalty = Math.max(penalty, candidateSimilarity(candidate, item) * 3);
    if (candidate.generator_kind && item.generator_kind && candidate.generator_kind === item.generator_kind) {
      penalty += 0.35;
    }
    if (overlapCount(candidate.axis_ids || [], item.axis_ids || []) > 0) {
      penalty += 0.65;
    }
  }
  return penalty;
}

function candidateSimilarity(a: HypothesisCandidate, b: HypothesisCandidate): number {
  const aTokens = tokenizeForSimilarity(a.text);
  const bTokens = tokenizeForSimilarity(b.text);
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }
  const overlap = overlapCount([...aTokens], [...bTokens]);
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : overlap / union;
}

function buildDefaultBudgetNotes(constraintProfile: ConstraintProfile): string[] {
  if (constraintProfile.experiment.designNotes.length > 0) {
    return [...constraintProfile.experiment.designNotes];
  }
  return ["Stay within the configured local execution budget."];
}

function emitProgress(
  onProgress: ((message: string) => void) | undefined,
  label: string,
  event: LLMProgressEvent
): void {
  const text = event.text.trim();
  if (!text) {
    return;
  }
  onProgress?.(event.type === "delta" ? `${label}> ${text}` : text);
}

function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_json_output");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const firstBrace = candidate.indexOf("{");
  if (firstBrace < 0) {
    throw new Error("no_json_object_found");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let idx = firstBrace; idx < candidate.length; idx += 1) {
    const char = candidate[idx];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(firstBrace, idx + 1);
      }
    }
  }
  throw new Error("unterminated_json_object");
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return dedupeStrings(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  );
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function dedupeById<T>(items: T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    output.push(item);
  }
  return output;
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.round(value)));
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function truncateText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeHypothesisText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeForSimilarity(text: string): Set<string> {
  return new Set(
    normalizeHypothesisText(text)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
  );
}

function overlapCount(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.reduce((count, item) => count + (setB.has(item) ? 1 : 0), 0);
}

function isReproducibilityObjective(objectiveMetric?: string): boolean {
  return /reproduc|재현/u.test(objectiveMetric || "");
}
