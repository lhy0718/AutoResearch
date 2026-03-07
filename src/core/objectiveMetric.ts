import { createHash } from "node:crypto";

import { EventStream } from "./events.js";
import { LLMClient } from "./llm/client.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import { RunRecord } from "../types.js";

export type ObjectiveDirection = "maximize" | "minimize";
export type ObjectiveComparator = ">=" | ">" | "<=" | "<" | "==";
export type ObjectiveEvaluationStatus = "met" | "not_met" | "observed" | "missing" | "unknown";

export interface ObjectiveMetricProfile {
  source: "llm" | "heuristic_fallback";
  raw: string;
  primaryMetric?: string;
  preferredMetricKeys: string[];
  direction?: ObjectiveDirection;
  comparator?: ObjectiveComparator;
  targetValue?: number;
  targetDescription?: string;
  analysisFocus: string[];
  paperEmphasis: string[];
  assumptions: string[];
}

export interface ObjectiveMetricEvaluation {
  rawObjectiveMetric: string;
  profileSource: ObjectiveMetricProfile["source"];
  primaryMetric?: string;
  preferredMetricKeys: string[];
  matchedMetricKey?: string;
  direction?: ObjectiveDirection;
  comparator?: ObjectiveComparator;
  targetValue?: number;
  observedValue?: number;
  status: ObjectiveEvaluationStatus;
  summary: string;
}

const OBJECTIVE_PROFILE_CACHE_KEY = "objective_metric.profile";

interface StoredObjectiveMetricProfile {
  fingerprint: string;
  profile: ObjectiveMetricProfile;
  updatedAt: string;
}

interface ResolveObjectiveMetricProfileInput {
  run: RunRecord;
  runContextMemory: RunContextMemory;
  llm: LLMClient;
  eventStream?: EventStream;
  node?: string;
}

interface PartialObjectiveMetricProfile {
  source?: unknown;
  primaryMetric?: unknown;
  preferredMetricKeys?: unknown;
  direction?: unknown;
  comparator?: unknown;
  targetValue?: unknown;
  targetDescription?: unknown;
  analysisFocus?: unknown;
  paperEmphasis?: unknown;
  assumptions?: unknown;
}

export async function resolveObjectiveMetricProfile(
  input: ResolveObjectiveMetricProfileInput
): Promise<ObjectiveMetricProfile> {
  const fingerprint = buildObjectiveMetricFingerprint(input.run);
  const cached = await input.runContextMemory.get<StoredObjectiveMetricProfile>(OBJECTIVE_PROFILE_CACHE_KEY);
  if (cached?.fingerprint === fingerprint && cached.profile) {
    return normalizeObjectiveMetricProfile(cached.profile, input.run.objectiveMetric);
  }

  const heuristicFallback = buildHeuristicObjectiveMetricProfile(input.run.objectiveMetric);
  if (!input.run.objectiveMetric.trim()) {
    await input.runContextMemory.put(OBJECTIVE_PROFILE_CACHE_KEY, {
      fingerprint,
      profile: heuristicFallback,
      updatedAt: new Date().toISOString()
    });
    return heuristicFallback;
  }

  try {
    const completion = await input.llm.complete(buildObjectiveMetricPrompt(input.run), {
      systemPrompt: buildObjectiveMetricSystemPrompt()
    });
    const parsed = parseObjectiveMetricProfileResponse(completion.text, input.run.objectiveMetric);
    const profile = normalizeObjectiveMetricProfile(
      {
        ...parsed,
        source: "llm"
      },
      input.run.objectiveMetric
    );
    await input.runContextMemory.put(OBJECTIVE_PROFILE_CACHE_KEY, {
      fingerprint,
      profile,
      updatedAt: new Date().toISOString()
    });
    return profile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.eventStream?.emit({
      type: "OBS_RECEIVED",
      runId: input.run.id,
      node: input.node as RunRecord["currentNode"],
      payload: {
        text: `Objective metric profile fallback: ${message}`
      }
    });
    await input.runContextMemory.put(OBJECTIVE_PROFILE_CACHE_KEY, {
      fingerprint,
      profile: heuristicFallback,
      updatedAt: new Date().toISOString()
    });
    return heuristicFallback;
  }
}

export function buildHeuristicObjectiveMetricProfile(rawObjectiveMetric: string): ObjectiveMetricProfile {
  const raw = rawObjectiveMetric.trim();
  const normalized = raw.toLowerCase();
  const metricDef = detectMetricDefinition(normalized);
  const threshold = parseThreshold(raw);
  const primaryMetric = metricDef?.primaryMetric;
  const preferredMetricKeys = metricDef?.preferredMetricKeys || [];
  const direction = metricDef?.direction || inferDirectionFromComparator(threshold?.comparator);
  const targetDescription =
    threshold && typeof threshold.targetValue === "number"
      ? `${threshold.comparator} ${threshold.targetValue}`
      : undefined;

  const analysisFocus: string[] = [];
  const paperEmphasis: string[] = [];
  if (primaryMetric) {
    analysisFocus.push(`Center the results analysis on ${primaryMetric}.`);
    paperEmphasis.push(`Highlight ${primaryMetric} in the paper results section.`);
  }
  if (targetDescription && primaryMetric) {
    const sentence = `State explicitly whether ${primaryMetric} met ${targetDescription}.`;
    analysisFocus.push(sentence);
    paperEmphasis.push(sentence);
  }

  return {
    source: "heuristic_fallback",
    raw,
    primaryMetric,
    preferredMetricKeys,
    direction,
    comparator: threshold?.comparator,
    targetValue: threshold?.targetValue,
    targetDescription,
    analysisFocus,
    paperEmphasis,
    assumptions: []
  };
}

export function normalizeObjectiveMetricProfile(
  input: Partial<ObjectiveMetricProfile> | PartialObjectiveMetricProfile | undefined,
  rawObjectiveMetric: string
): ObjectiveMetricProfile {
  const fallback = buildHeuristicObjectiveMetricProfile(rawObjectiveMetric);
  const partial = input || {};

  const primaryMetric = cleanString(partial.primaryMetric) || fallback.primaryMetric;
  const preferredMetricKeys = normalizeStringArray(partial.preferredMetricKeys);
  const direction = normalizeDirection(partial.direction) || fallback.direction;
  const comparator = normalizeComparator(partial.comparator) || fallback.comparator;
  const targetValue = normalizeNumber(partial.targetValue) ?? fallback.targetValue;
  const targetDescription = cleanString(partial.targetDescription) || fallback.targetDescription;

  return {
    source: partial.source === "llm" ? "llm" : fallback.source,
    raw: rawObjectiveMetric.trim(),
    primaryMetric,
    preferredMetricKeys: preferredMetricKeys.length > 0 ? preferredMetricKeys : fallback.preferredMetricKeys,
    direction,
    comparator,
    targetValue,
    targetDescription,
    analysisFocus: normalizeStringArray(partial.analysisFocus).length > 0
      ? normalizeStringArray(partial.analysisFocus)
      : fallback.analysisFocus,
    paperEmphasis: normalizeStringArray(partial.paperEmphasis).length > 0
      ? normalizeStringArray(partial.paperEmphasis)
      : fallback.paperEmphasis,
    assumptions: normalizeStringArray(partial.assumptions)
  };
}

export function evaluateObjectiveMetric(
  metrics: Record<string, unknown>,
  profile: ObjectiveMetricProfile,
  rawObjectiveMetric: string
): ObjectiveMetricEvaluation {
  const flattened = flattenNumericMetrics(metrics);
  const preferredKeys = dedupe([
    ...profile.preferredMetricKeys,
    ...(profile.primaryMetric ? [profile.primaryMetric] : [])
  ]);
  const matched = findMatchingMetric(flattened, preferredKeys);

  if (!matched) {
    return {
      rawObjectiveMetric,
      profileSource: profile.source,
      primaryMetric: profile.primaryMetric,
      preferredMetricKeys: preferredKeys,
      direction: profile.direction,
      comparator: profile.comparator,
      targetValue: profile.targetValue,
      status: preferredKeys.length > 0 ? "missing" : "unknown",
      summary:
        preferredKeys.length > 0
          ? `Objective metric "${profile.primaryMetric || preferredKeys[0]}" was not found in metrics.json.`
          : `Objective metric "${rawObjectiveMetric}" could not be matched to a numeric metrics key.`
    };
  }

  if (profile.comparator && typeof profile.targetValue === "number") {
    const met = compareObjectiveValue(matched.value, profile.comparator, profile.targetValue);
    return {
      rawObjectiveMetric,
      profileSource: profile.source,
      primaryMetric: profile.primaryMetric,
      preferredMetricKeys: preferredKeys,
      matchedMetricKey: matched.key,
      direction: profile.direction,
      comparator: profile.comparator,
      targetValue: profile.targetValue,
      observedValue: matched.value,
      status: met ? "met" : "not_met",
      summary: met
        ? `Objective metric met: ${matched.key}=${matched.value} ${profile.comparator} ${profile.targetValue}.`
        : `Objective metric not met: ${matched.key}=${matched.value} does not satisfy ${profile.comparator} ${profile.targetValue}.`
    };
  }

  return {
    rawObjectiveMetric,
    profileSource: profile.source,
    primaryMetric: profile.primaryMetric,
    preferredMetricKeys: preferredKeys,
    matchedMetricKey: matched.key,
    direction: profile.direction,
    comparator: profile.comparator,
    targetValue: profile.targetValue,
    observedValue: matched.value,
    status: "observed",
    summary: `Observed objective metric ${matched.key}=${matched.value}.`
  };
}

function buildObjectiveMetricSystemPrompt(): string {
  return [
    "You are the AutoResearch objective metric planning agent.",
    "Convert the run objective metric into a strict JSON profile for execution evaluation and paper writing.",
    "Return JSON only.",
    "Do not invent a metric if the objective metric is too vague; prefer null, empty arrays, or assumptions."
  ].join("\n");
}

function buildObjectiveMetricPrompt(run: RunRecord): string {
  return [
    "Return one JSON object with this shape:",
    "{",
    '  "primaryMetric": string|null,',
    '  "preferredMetricKeys": string[],',
    '  "direction": "maximize"|"minimize"|null,',
    '  "comparator": ">="|">"|"<="|"<"|"=="|null,',
    '  "targetValue": number|null,',
    '  "targetDescription": string|null,',
    '  "analysisFocus": string[],',
    '  "paperEmphasis": string[],',
    '  "assumptions": string[]',
    "}",
    "",
    "Guidance:",
    "- preferredMetricKeys should list plausible metrics.json keys.",
    "- If the objective metric says things like 'under 200ms', extract comparator and targetValue.",
    "- If the objective metric is conceptual (e.g. reproducibility), keep the profile conservative and explain assumptions.",
    "",
    `Run topic: ${run.topic}`,
    `Constraints: ${run.constraints.join(", ") || "none"}`,
    `Objective metric: ${run.objectiveMetric || "none"}`
  ].join("\n");
}

function parseObjectiveMetricProfileResponse(
  raw: string,
  objectiveMetric: string
): Partial<ObjectiveMetricProfile> {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new Error("LLM returned no JSON object for the objective metric profile.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Objective metric profile JSON parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Objective metric profile JSON must decode to an object.");
  }

  return normalizeObjectiveMetricProfile(parsed as PartialObjectiveMetricProfile, objectiveMetric);
}

function extractJsonObject(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced?.[1] || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

function buildObjectiveMetricFingerprint(run: RunRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        topic: run.topic,
        constraints: run.constraints,
        objectiveMetric: run.objectiveMetric
      })
    )
    .digest("hex");
}

function flattenNumericMetrics(
  value: Record<string, unknown>,
  prefix = ""
): Array<{ key: string; value: number }> {
  const items: Array<{ key: string; value: number }> = [];
  for (const [key, raw] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      items.push({ key: nextKey, value: raw });
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      items.push(...flattenNumericMetrics(raw as Record<string, unknown>, nextKey));
    }
  }
  return items;
}

function findMatchingMetric(
  metrics: Array<{ key: string; value: number }>,
  preferredKeys: string[]
): { key: string; value: number } | undefined {
  const normalizedTargets = preferredKeys.map(normalizeMetricKey).filter(Boolean);
  for (const target of normalizedTargets) {
    const exact = metrics.find((metric) => normalizeMetricKey(metric.key) === target);
    if (exact) {
      return exact;
    }
  }
  for (const target of normalizedTargets) {
    const partial = metrics.find((metric) => normalizeMetricKey(metric.key).includes(target));
    if (partial) {
      return partial;
    }
  }
  return undefined;
}

function normalizeMetricKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compareObjectiveValue(
  observed: number,
  comparator: ObjectiveComparator,
  target: number
): boolean {
  switch (comparator) {
    case ">=":
      return observed >= target;
    case ">":
      return observed > target;
    case "<=":
      return observed <= target;
    case "<":
      return observed < target;
    case "==":
      return observed === target;
    default:
      return false;
  }
}

function detectMetricDefinition(text: string): {
  primaryMetric?: string;
  preferredMetricKeys: string[];
  direction?: ObjectiveDirection;
} | undefined {
  const defs: Array<{
    pattern: RegExp;
    primaryMetric: string;
    preferredMetricKeys: string[];
    direction: ObjectiveDirection;
  }> = [
    { pattern: /\baccuracy\b|\bacc\b/iu, primaryMetric: "accuracy", preferredMetricKeys: ["accuracy", "acc"], direction: "maximize" },
    { pattern: /\bf1(?:[-_\s]?score)?\b/iu, primaryMetric: "f1", preferredMetricKeys: ["f1", "f1_score"], direction: "maximize" },
    { pattern: /\bprecision\b/iu, primaryMetric: "precision", preferredMetricKeys: ["precision"], direction: "maximize" },
    { pattern: /\brecall\b/iu, primaryMetric: "recall", preferredMetricKeys: ["recall"], direction: "maximize" },
    { pattern: /\bloss\b/iu, primaryMetric: "loss", preferredMetricKeys: ["loss", "eval_loss"], direction: "minimize" },
    { pattern: /\blatency\b|\bresponse time\b|지연/u, primaryMetric: "latency", preferredMetricKeys: ["latency", "latency_ms", "response_time_ms"], direction: "minimize" },
    { pattern: /\bthroughput\b/iu, primaryMetric: "throughput", preferredMetricKeys: ["throughput", "samples_per_sec"], direction: "maximize" },
    { pattern: /\bexact match\b|\bem\b/iu, primaryMetric: "exact_match", preferredMetricKeys: ["exact_match", "em"], direction: "maximize" },
    { pattern: /\bbleu\b/iu, primaryMetric: "bleu", preferredMetricKeys: ["bleu"], direction: "maximize" },
    { pattern: /\brouge\b/iu, primaryMetric: "rouge", preferredMetricKeys: ["rouge", "rouge_l"], direction: "maximize" },
    { pattern: /\bsuccess rate\b|성공률/u, primaryMetric: "success_rate", preferredMetricKeys: ["success_rate", "successRate"], direction: "maximize" },
    { pattern: /\brobustness\b|강건/u, primaryMetric: "robustness", preferredMetricKeys: ["robustness", "robustness_score"], direction: "maximize" },
    { pattern: /\breproducibility\b|재현/u, primaryMetric: "reproducibility", preferredMetricKeys: ["reproducibility", "reproducibility_score"], direction: "maximize" }
  ];

  for (const def of defs) {
    if (def.pattern.test(text)) {
      return {
        primaryMetric: def.primaryMetric,
        preferredMetricKeys: def.preferredMetricKeys,
        direction: def.direction
      };
    }
  }
  return undefined;
}

function parseThreshold(text: string): { comparator: ObjectiveComparator; targetValue: number } | undefined {
  const patterns: Array<[RegExp, ObjectiveComparator]> = [
    [/(?:at\s+least|greater\s+than\s+or\s+equal\s+to|no\s+less\s+than|이상)\s*(\d+(?:\.\d+)?)/iu, ">="],
    [/(?:more\s+than|greater\s+than|above|초과)\s*(\d+(?:\.\d+)?)/iu, ">"],
    [/(?:at\s+most|less\s+than\s+or\s+equal\s+to|no\s+more\s+than|이하)\s*(\d+(?:\.\d+)?)/iu, "<="],
    [/(?:less\s+than|below|under|미만)\s*(\d+(?:\.\d+)?)/iu, "<"],
    [/(?:exactly|equal\s+to|같은)\s*(\d+(?:\.\d+)?)/iu, "=="],
    [/>=\s*(\d+(?:\.\d+)?)/u, ">="],
    [/>+\s*(\d+(?:\.\d+)?)/u, ">"],
    [/<=\s*(\d+(?:\.\d+)?)/u, "<="],
    [/<\s*(\d+(?:\.\d+)?)/u, "<"]
  ];

  for (const [pattern, comparator] of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        comparator,
        targetValue: Number(match[1])
      };
    }
  }
  return undefined;
}

function inferDirectionFromComparator(comparator: ObjectiveComparator | undefined): ObjectiveDirection | undefined {
  if (!comparator) {
    return undefined;
  }
  if (comparator === ">" || comparator === ">=") {
    return "maximize";
  }
  if (comparator === "<" || comparator === "<=") {
    return "minimize";
  }
  return undefined;
}

function normalizeDirection(value: unknown): ObjectiveDirection | undefined {
  return value === "maximize" || value === "minimize" ? value : undefined;
}

function normalizeComparator(value: unknown): ObjectiveComparator | undefined {
  return value === ">=" || value === ">" || value === "<=" || value === "<" || value === "==" ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? num : undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
