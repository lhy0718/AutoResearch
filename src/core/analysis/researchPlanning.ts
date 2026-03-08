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
}

export interface HypothesisPlanningResult {
  source: "llm" | "fallback";
  summary: string;
  candidates: HypothesisCandidate[];
  selected: HypothesisCandidate[];
  fallbackReason?: string;
}

export interface DesignInputHypothesis {
  hypothesis_id: string;
  text: string;
  score?: number;
  evidence_links?: string[];
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
  "You are the AutoResearch hypothesis agent.",
  "Generate multiple research hypotheses from structured evidence.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON.",
  "Keep hypotheses specific, testable, and grounded in the supplied evidence."
].join(" ");

const DESIGN_SYSTEM_PROMPT = [
  "You are the AutoResearch experiment designer.",
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
    args.onProgress?.(`Submitting hypothesis generation request for ${args.evidenceSeeds.length} evidence seed(s).`);
    const completion = await args.llm.complete(
      buildHypothesisPrompt(args.runTitle, args.runTopic, args.objectiveMetric, args.evidenceSeeds, branchCount, topK),
      {
        systemPrompt: HYPOTHESIS_SYSTEM_PROMPT,
        onProgress: (event) => emitProgress(args.onProgress, "Hypothesis LLM", event)
      }
    );
    args.onProgress?.("Received hypothesis generation output. Parsing JSON.");
    const parsed = parseHypothesisJson(completion.text);
    const normalizedCandidates = normalizeHypothesisCandidates(parsed.candidates, branchCount, args.evidenceSeeds);
    const selected = selectHypotheses(normalizedCandidates, parsed.selected_ids, topK);
    if (normalizedCandidates.length === 0 || selected.length === 0) {
      throw new Error("No valid hypothesis candidates were returned.");
    }
    return {
      source: "llm",
      summary: toOptionalString(parsed.summary) || `Generated ${normalizedCandidates.length} hypothesis candidate(s).`,
      candidates: normalizedCandidates,
      selected
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    args.onProgress?.(`Hypothesis generation fallback: ${reason}`);
    const fallback = buildFallbackHypotheses(args.evidenceSeeds, branchCount, topK);
    return {
      source: "fallback",
      summary: `Fallback generated ${fallback.candidates.length} hypothesis candidate(s).`,
      candidates: fallback.candidates,
      selected: fallback.selected,
      fallbackReason: reason
    };
  }
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
    const candidates = normalizeDesignCandidates(parsed.candidates, candidateCount, args.hypotheses, args.constraintProfile);
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
    const fallback = buildFallbackDesigns(args.hypotheses, args.constraintProfile, args.objectiveMetric, candidateCount);
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
    "Hypotheses:"
  ];

  hypotheses.slice(0, 8).forEach((hypothesis, index) => {
    lines.push(
      [
        `${index + 1}. hypothesis_id=${hypothesis.hypothesis_id}`,
        `text=${hypothesis.text}`,
        typeof hypothesis.score === "number" ? `score=${hypothesis.score}` : undefined,
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
  evidenceSeeds: HypothesisEvidenceSeed[]
): HypothesisCandidate[] {
  const items = Array.isArray(rawCandidates) ? rawCandidates : [];
  const normalized = items
    .map((item, index) => normalizeHypothesisCandidate(item as RawHypothesisCandidate, index, evidenceSeeds))
    .filter((candidate): candidate is HypothesisCandidate => Boolean(candidate))
    .slice(0, branchCount);
  return dedupeById(normalized, (candidate) => candidate.id);
}

function normalizeHypothesisCandidate(
  raw: RawHypothesisCandidate,
  index: number,
  evidenceSeeds: HypothesisEvidenceSeed[]
): HypothesisCandidate | undefined {
  const text = toOptionalString(raw.text);
  if (!text) {
    return undefined;
  }
  const evidenceLinks = normalizeStringArray(raw.evidence_links).filter(Boolean);
  const fallbackEvidence = evidenceLinks.length > 0 ? evidenceLinks : [evidenceSeeds[index % Math.max(1, evidenceSeeds.length)]?.evidence_id || "ev_1"];
  return {
    id: toOptionalString(raw.id) || `cand_${index + 1}`,
    text,
    novelty: clampScore(raw.novelty),
    feasibility: clampScore(raw.feasibility),
    testability: clampScore(raw.testability),
    cost: clampScore(raw.cost),
    expected_gain: clampScore(raw.expected_gain),
    evidence_links: dedupeStrings(fallbackEvidence),
    rationale: toOptionalString(raw.rationale)
  };
}

function selectHypotheses(
  candidates: HypothesisCandidate[],
  rawSelectedIds: unknown,
  topK: number
): HypothesisCandidate[] {
  const selectedIds = normalizeStringArray(rawSelectedIds);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
  const explicit = selectedIds.map((id) => byId.get(id)).filter((candidate): candidate is HypothesisCandidate => Boolean(candidate));
  if (explicit.length >= topK) {
    return dedupeById(explicit, (candidate) => candidate.id).slice(0, topK);
  }
  const fallback = [...candidates]
    .sort(
      (a, b) =>
        scoreHypothesis(b) - scoreHypothesis(a) ||
        b.novelty - a.novelty ||
        b.feasibility - a.feasibility ||
        a.cost - b.cost ||
        a.id.localeCompare(b.id)
    )
    .slice(0, topK);
  return dedupeById([...explicit, ...fallback], (candidate) => candidate.id).slice(0, topK);
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
    rationale: "deterministic fallback"
  }));
  const selected = tot.selected
    .map((candidate) => candidates.find((item) => item.id === candidate.id))
    .filter((candidate): candidate is HypothesisCandidate => candidate !== undefined);
  return { candidates, selected };
}

function normalizeDesignCandidates(
  rawCandidates: unknown,
  candidateCount: number,
  hypotheses: DesignInputHypothesis[],
  constraintProfile: ConstraintProfile
): ExperimentDesignCandidate[] {
  const items = Array.isArray(rawCandidates) ? rawCandidates : [];
  const normalized = items
    .map((item, index) => normalizeDesignCandidate(item as RawDesignCandidate, index, hypotheses, constraintProfile))
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
  constraintProfile: ConstraintProfile
): ExperimentDesignCandidate | undefined {
  const title = toOptionalString(raw.title);
  const planSummary = toOptionalString(raw.plan_summary);
  if (!title || !planSummary) {
    return undefined;
  }
  const hypothesisIds = normalizeStringArray(raw.hypothesis_ids);
  const fallbackHypothesisIds = hypothesisIds.length > 0 ? hypothesisIds : hypotheses.slice(0, 1).map((item) => item.hypothesis_id);
  return {
    id: toOptionalString(raw.id) || `plan_${index + 1}`,
    title,
    hypothesis_ids: dedupeStrings(fallbackHypothesisIds),
    plan_summary: planSummary,
    datasets: normalizeStringArray(raw.datasets),
    metrics: normalizeStringArray(raw.metrics),
    baselines: normalizeStringArray(raw.baselines),
    implementation_notes: normalizeStringArray(raw.implementation_notes),
    evaluation_steps: normalizeStringArray(raw.evaluation_steps),
    risks: normalizeStringArray(raw.risks),
    budget_notes: normalizeStringArray(raw.budget_notes).length > 0
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
  candidateCount: number
): { candidates: ExperimentDesignCandidate[]; selected: ExperimentDesignCandidate } {
  const base =
    hypotheses.length > 0
      ? hypotheses.slice(0, Math.max(1, candidateCount))
      : [{ hypothesis_id: "h_1", text: "Baseline hypothesis placeholder." }];
  const candidates = base.map((hypothesis, index) => ({
    id: `plan_${index + 1}`,
    title: `Plan ${index + 1}: ${truncateText(hypothesis.text, 72)}`,
    hypothesis_ids: [hypothesis.hypothesis_id],
    plan_summary: `Test ${hypothesis.text} against configured baselines and evaluate with ${objectiveMetric || "the run objective metric"}.`,
    datasets:
      (constraintProfile.collect.fieldsOfStudy?.length ?? 0) > 0
        ? [...(constraintProfile.collect.fieldsOfStudy || [])]
        : ["dataset_to_be_selected"],
    metrics: [objectiveMetric || "primary_metric"],
    baselines: ["current_best_baseline"],
    implementation_notes: [
      ...constraintProfile.experiment.implementationNotes,
      "Keep the implementation minimal and reproducible."
    ],
    evaluation_steps: [
      ...constraintProfile.experiment.evaluationNotes,
      "Compare the hypothesis-driven change against the baseline."
    ],
    risks: ["Specification may be underspecified and require narrower scope."],
    budget_notes: buildDefaultBudgetNotes(constraintProfile)
  }));
  const selected = candidates[0]!;
  return { candidates, selected };
}

function scoreHypothesis(candidate: HypothesisCandidate): number {
  return candidate.novelty + candidate.feasibility + candidate.testability + candidate.expected_gain - candidate.cost;
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
