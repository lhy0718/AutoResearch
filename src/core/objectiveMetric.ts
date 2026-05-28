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
  const relativeBaseline = inferRelativeBaselineObjective(raw, normalized);
  const metricDef = detectMetricDefinition(normalized);
  const threshold = parseThreshold(raw);
  const primaryMetric = relativeBaseline?.primaryMetric || metricDef?.primaryMetric;
  const preferredMetricKeys = dedupe([
    ...(relativeBaseline?.preferredMetricKeys || []),
    ...(metricDef?.preferredMetricKeys || [])
  ]);
  const direction =
    relativeBaseline?.direction || metricDef?.direction || inferDirectionFromComparator(threshold?.comparator);
  // When a relative-baseline interpretation is available, its comparator and
  // targetValue are semantically correct (delta comparison). The raw
  // parseThreshold result would be an absolute number that makes no sense
  // as a delta (e.g. 1.5 instead of 0.015).
  const comparator = relativeBaseline?.comparator || threshold?.comparator;
  const targetValue = relativeBaseline?.targetValue ?? threshold?.targetValue;
  const targetDescription =
    relativeBaseline?.targetDescription ||
    (typeof targetValue === "number" && comparator
      ? `${comparator} ${targetValue}`
      : undefined);

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
    comparator,
    targetValue,
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
  const relativeBaseline = inferRelativeBaselineObjective(rawObjectiveMetric, rawObjectiveMetric.trim().toLowerCase());
  const partial = input || {};

  const primaryMetric = relativeBaseline?.primaryMetric || cleanString(partial.primaryMetric) || fallback.primaryMetric;
  const preferredMetricKeys = dedupe([
    ...(relativeBaseline?.preferredMetricKeys || []),
    ...normalizeStringArray(partial.preferredMetricKeys),
    ...fallback.preferredMetricKeys
  ]);
  const direction = relativeBaseline?.direction || normalizeDirection(partial.direction) || fallback.direction;
  const comparator = relativeBaseline?.comparator || normalizeComparator(partial.comparator) || fallback.comparator;
  const targetValue = relativeBaseline?.targetValue ?? normalizeNumber(partial.targetValue) ?? fallback.targetValue;
  const targetDescription =
    relativeBaseline?.targetDescription || cleanString(partial.targetDescription) || fallback.targetDescription;

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

/**
 * If metrics.primary_metric is a structured object with {name, value, met, target},
 * promote it as a top-level numeric key so that findMatchingMetric can find it by name.
 * This handles metrics blobs that use baseline_metrics/routed_metrics structure
 * instead of a flat conditions array.
 */
function promotePrimaryMetric(metrics: Record<string, unknown>): Record<string, unknown> {
  const pm = metrics.primary_metric;
  if (typeof pm === "string") {
    const value = metrics.primary_value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return metrics;
    }
    const enriched: Record<string, unknown> = { ...metrics };
    if (!(pm in enriched) || typeof enriched[pm] !== "number") {
      enriched[pm] = value;
    }
    return enriched;
  }

  if (!pm || typeof pm !== "object" || Array.isArray(pm)) {
    return metrics;
  }
  const pmObj = pm as Record<string, unknown>;
  const name = pmObj.name;
  const value = pmObj.value;
  if (typeof name !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
    return metrics;
  }
  const enriched: Record<string, unknown> = { ...metrics };
  // Inject the primary metric value as a top-level key if it doesn't already exist
  if (!(name in enriched) || typeof enriched[name] !== "number") {
    enriched[name] = value;
  }
  return enriched;
}

export function evaluateObjectiveMetric(
  metrics: Record<string, unknown>,
  profile: ObjectiveMetricProfile,
  rawObjectiveMetric: string
): ObjectiveMetricEvaluation {
  const enrichedMetrics = synthesizeRelativeMetrics(metrics);
  const withPrimary = promotePrimaryMetric(enrichedMetrics);
  const flattened = flattenNumericMetrics(withPrimary);
  const basePreferredKeys = dedupe([
    ...profile.preferredMetricKeys,
    ...(profile.primaryMetric ? [profile.primaryMetric] : [])
  ]);
  const preferredKeys = prioritizePrimaryMetricRelativeKeys(enrichedMetrics, metrics, basePreferredKeys);
  const relativeObjective = isRelativeObjectiveMetricRequest(preferredKeys, rawObjectiveMetric);
  const matchableMetrics = relativeObjective
    ? flattened.filter((metric) => isRelativeMetricKey(metric.key))
    : flattened;
  const matched = findMatchingMetric(matchableMetrics, preferredKeys);

  if (!matched) {
    const directPreferred = findDirectPreferredTopLevelMetric(enrichedMetrics, preferredKeys);
    if (directPreferred && (!relativeObjective || isRelativeMetricKey(directPreferred.key))) {
      return applyObjectiveRequirementChecks(
        buildObjectiveEvaluation({
          rawObjectiveMetric,
          profile,
          preferredKeys,
          matched: directPreferred
        }),
        metrics,
        rawObjectiveMetric
      );
    }

    const inferred = inferBestEffortMetricMatch(flattened, preferredKeys, rawObjectiveMetric);
    if (inferred) {
      return applyObjectiveRequirementChecks(
        buildObjectiveEvaluation({
          rawObjectiveMetric,
          profile,
          preferredKeys,
          matched: inferred.metric,
          summaryPrefix: inferred.summaryPrefix
        }),
        metrics,
        rawObjectiveMetric
      );
    }
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

  return applyObjectiveRequirementChecks(
    buildObjectiveEvaluation({
      rawObjectiveMetric,
      profile,
      preferredKeys,
      matched
    }),
    metrics,
    rawObjectiveMetric
  );
}

const BASELINE_PATTERN = /baseline|single.pass|control|reference|vanilla/iu;
const SYNTHESIZE_METRIC_KEYS = [
  "accuracy_pass_at_1",
  "accuracy",
  "acc",
  "f1",
  "macro_f1",
  "exact_match",
  "pass_at_1",
  "bleu",
  "rouge",
  "rouge_l",
  "success_rate",
  "mean_accuracy",
  "primary_mean_accuracy",
  "average_accuracy",
  "mean_zero_shot_accuracy",
  "zero_shot_accuracy",
  "benchmark_task_a_accuracy",
  "benchmark_task_b_accuracy"
];

/**
 * Compute delta metrics from the `conditions` array in metrics.json.
 * For each known metric, synthesize `<metric>_delta_vs_baseline` = best_non_baseline - baseline.
 * Also handles the `baseline_metrics` + `routed_metrics` (or `*_metrics`) structure.
 */
export function synthesizeRelativeMetrics(
  metrics: Record<string, unknown>
): Record<string, unknown> {
  // Strategy 1: conditions array
  const conditions = metrics.conditions;
  if (Array.isArray(conditions) && conditions.length >= 2) {
    const conditionRecords = conditions.filter(
      (c: unknown): c is Record<string, unknown> =>
        !!c && typeof c === "object" && !Array.isArray(c)
    );
    const baseline =
      conditionRecords.find((record) => record.baseline === true || record.is_baseline === true) ||
      conditionRecords.find((record) => baselineConditionScore(conditionArrayLabel(record), record) > 0);
    if (baseline) {
      const nonBaseline = conditionRecords.filter((c: unknown) => c !== baseline);
      const enriched: Record<string, unknown> = { ...metrics };
      for (const metricKey of SYNTHESIZE_METRIC_KEYS) {
        const baseVal = getConditionMetricValue(baseline, metricKey);
        if (baseVal === undefined) continue;
        let bestDelta = -Infinity;
        for (const cond of nonBaseline) {
          if (!cond || typeof cond !== "object") continue;
          const condRecord = cond as Record<string, unknown>;
          const val = getConditionMetricValue(condRecord, metricKey);
          if (val === undefined) continue;
          const delta = val - baseVal;
          if (delta > bestDelta) bestDelta = delta;
        }
        if (Number.isFinite(bestDelta)) {
          enriched[`${metricKey}_delta_vs_baseline`] = bestDelta;
          enriched[`${metricKey}_improvement_over_baseline`] = bestDelta;
          if (metricKey.includes("accuracy")) {
            enriched.accuracy_delta_vs_baseline = bestDelta;
            enriched.accuracy_improvement_over_baseline = bestDelta;
          }
        }
      }
      return enriched;
    }
  }

  // Strategy 1b: conditions object map with nested evaluation payloads, e.g.
  // `conditions: { base: { evaluation: { primary_mean_accuracy } }, lora: ... }`.
  if (conditions && typeof conditions === "object" && !Array.isArray(conditions)) {
    const conditionEntries = Object.entries(conditions as Record<string, unknown>).filter(
      ([, value]) => value && typeof value === "object" && !Array.isArray(value)
    ) as Array<[string, Record<string, unknown>]>;
    if (conditionEntries.length >= 2) {
      const baselineEntry = selectBaselineConditionEntry(conditionEntries);
      if (baselineEntry) {
        const [, baselineRecord] = baselineEntry;
        const nonBaselineEntries = selectEligibleTreatmentConditionEntries(
          conditionEntries.filter((entry) => entry !== baselineEntry)
        );
        const enriched: Record<string, unknown> = { ...metrics };
        for (const metricKey of SYNTHESIZE_METRIC_KEYS) {
          const baseVal = getConditionMetricValue(baselineRecord, metricKey);
          if (baseVal === undefined) continue;
          let bestDelta = -Infinity;
          for (const [, treatmentRecord] of nonBaselineEntries) {
            const val = getConditionMetricValue(treatmentRecord, metricKey);
            if (val === undefined) continue;
            const delta = val - baseVal;
            if (delta > bestDelta) bestDelta = delta;
          }
          if (Number.isFinite(bestDelta)) {
            enriched[`${metricKey}_delta_vs_baseline`] = bestDelta;
            enriched[`${metricKey}_improvement_over_baseline`] = bestDelta;
            if (metricKey.includes("accuracy")) {
              enriched.accuracy_delta_vs_baseline = bestDelta;
              enriched.accuracy_improvement_over_baseline = bestDelta;
            }
          }
        }
        return enriched;
      }
    }
  }

  // Strategy 2: baseline_metrics + routed_metrics (or other *_metrics objects)
  const baselineObj = metrics.baseline_metrics;
  if (baselineObj && typeof baselineObj === "object" && !Array.isArray(baselineObj)) {
    const baseMetrics = baselineObj as Record<string, unknown>;
    // Find the first non-baseline *_metrics object
    const treatmentKeys = Object.keys(metrics).filter(
      (k) =>
        k.endsWith("_metrics") &&
        k !== "baseline_metrics" &&
        metrics[k] &&
        typeof metrics[k] === "object" &&
        !Array.isArray(metrics[k])
    );
    if (treatmentKeys.length > 0) {
      const enriched: Record<string, unknown> = { ...metrics };
      for (const metricKey of SYNTHESIZE_METRIC_KEYS) {
        const baseVal = typeof baseMetrics[metricKey] === "number" ? (baseMetrics[metricKey] as number) : undefined;
        if (baseVal === undefined) continue;
        let bestDelta = -Infinity;
        for (const tk of treatmentKeys) {
          const treatObj = metrics[tk] as Record<string, unknown>;
          const val = typeof treatObj[metricKey] === "number" ? (treatObj[metricKey] as number) : undefined;
          if (val === undefined) continue;
          const delta = val - baseVal;
          if (delta > bestDelta) bestDelta = delta;
        }
        if (Number.isFinite(bestDelta)) {
          enriched[`${metricKey}_delta_vs_baseline`] = bestDelta;
          enriched[`${metricKey}_improvement_over_baseline`] = bestDelta;
        }
      }
      return enriched;
    }
  }

  // Strategy 3: baseline_method + methods object
  const baselineMethod = typeof metrics.baseline_method === "string" ? metrics.baseline_method : undefined;
  const methodsObj = metrics.methods;
  if (
    baselineMethod &&
    methodsObj &&
    typeof methodsObj === "object" &&
    !Array.isArray(methodsObj)
  ) {
    const methodMetrics = methodsObj as Record<string, unknown>;
    const baselineRecord = methodMetrics[baselineMethod];
    if (baselineRecord && typeof baselineRecord === "object" && !Array.isArray(baselineRecord)) {
      const nonBaselineEntries = Object.entries(methodMetrics).filter(
        ([name, value]) =>
          name !== baselineMethod &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value)
      );
      if (nonBaselineEntries.length > 0) {
        const baseMetrics = baselineRecord as Record<string, unknown>;
        const enriched: Record<string, unknown> = { ...metrics };
        for (const metricKey of SYNTHESIZE_METRIC_KEYS) {
          const baseVal = typeof baseMetrics[metricKey] === "number" ? (baseMetrics[metricKey] as number) : undefined;
          if (baseVal === undefined) continue;
          let bestDelta = -Infinity;
          for (const [, treatmentValue] of nonBaselineEntries) {
            const treatMetrics = treatmentValue as Record<string, unknown>;
            const val = typeof treatMetrics[metricKey] === "number" ? (treatMetrics[metricKey] as number) : undefined;
            if (val === undefined) continue;
            const delta = val - baseVal;
            if (delta > bestDelta) bestDelta = delta;
          }
          if (Number.isFinite(bestDelta)) {
            enriched[`${metricKey}_delta_vs_baseline`] = bestDelta;
            enriched[`${metricKey}_improvement_over_baseline`] = bestDelta;
          }
        }
        return enriched;
      }
    }
  }

  // Strategy 4: recipe/condition result rows, e.g. PEFT runners that emit
  // `results: [{ recipe, kind, mean_zero_shot_accuracy, ... }]`.
  const results = metrics.results;
  if (Array.isArray(results) && results.length >= 2) {
    const records = results.filter(
      (item: unknown): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    );
    const baseline = records.find((record) => isBaselineResultRecord(record));
    if (baseline) {
      const nonBaseline = records.filter((record) => record !== baseline);
      if (nonBaseline.length > 0) {
        const enriched: Record<string, unknown> = { ...metrics };
        for (const metricKey of SYNTHESIZE_METRIC_KEYS) {
          const baseVal = typeof baseline[metricKey] === "number" ? (baseline[metricKey] as number) : undefined;
          if (baseVal === undefined) continue;
          let bestDelta = -Infinity;
          for (const record of nonBaseline) {
            const val = typeof record[metricKey] === "number" ? (record[metricKey] as number) : undefined;
            if (val === undefined) continue;
            const delta = val - baseVal;
            if (delta > bestDelta) bestDelta = delta;
          }
          if (Number.isFinite(bestDelta)) {
            enriched[`${metricKey}_delta_vs_baseline`] = bestDelta;
            enriched[`${metricKey}_improvement_over_baseline`] = bestDelta;
            if (metricKey.includes("accuracy")) {
              enriched.accuracy_delta_vs_baseline = bestDelta;
              enriched.accuracy_improvement_over_baseline = bestDelta;
            }
          }
        }
        return enriched;
      }
    }
  }

  return metrics;
}

function isBaselineResultRecord(record: Record<string, unknown>): boolean {
  const labels = ["name", "recipe", "condition", "method", "kind", "label"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return BASELINE_PATTERN.test(labels);
}

function selectBaselineConditionEntry(
  entries: Array<[string, Record<string, unknown>]>
): [string, Record<string, unknown>] | undefined {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: baselineConditionScore(entry[0], entry[1])
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.entry;
}

function selectEligibleTreatmentConditionEntries(
  entries: Array<[string, Record<string, unknown>]>
): Array<[string, Record<string, unknown>]> {
  const nonBaselineEntries = entries.filter(([name, record]) => !isBaselineConditionRecord(name, record));
  return nonBaselineEntries.length > 0 ? nonBaselineEntries : entries;
}

function isBaselineConditionRecord(name: string, record: Record<string, unknown>): boolean {
  if (baselineConditionScore(name, record) > 0) {
    return true;
  }
  const labels = conditionLabelText(name, record);
  return BASELINE_PATTERN.test(labels);
}

function baselineConditionScore(name: string, record: Record<string, unknown>): number {
  const labels = conditionLabelText(name, record).toLowerCase();
  const referenceBaseline =
    /(?:^|[_\s-])(?:unmodified|pretrained|zero[_\s-]?shot|untuned|no[_\s-]?tuning|base)(?:[_\s-]|$)/u.test(labels);
  const explicitBaseline = /(?:^|[_\s-])baseline(?:[_\s-]|$)/u.test(labels);
  const tunedBaseline =
    /(?:^|[_\s-])(?:lora|peft|adapter|tuned|locked)[\w\s-]*baseline(?:[_\s-]|$)/u.test(labels) ||
    /(?:^|[_\s-])baseline[\w\s-]*(?:lora|peft|adapter|tuned|locked)(?:[_\s-]|$)/u.test(labels);

  if (tunedBaseline && !referenceBaseline) {
    return 4;
  }
  if (explicitBaseline && !referenceBaseline) {
    return 3;
  }
  if (explicitBaseline) {
    return 2;
  }
  return referenceBaseline ? 1 : 0;
}

function conditionLabelText(name: string, record: Record<string, unknown>): string {
  const labels = [
    name,
    record.name,
    record.condition,
    record.condition_id,
    record.condition_type,
    record.type,
    record.kind,
    record.label
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return labels;
}

function conditionArrayLabel(record: Record<string, unknown>): string {
  return [
    record.name,
    record.condition_marker,
    record.condition,
    record.condition_id,
    record.recipe,
    record.method,
    record.label
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function getConditionMetricValue(record: Record<string, unknown>, metricKey: string): number | undefined {
  const direct = record[metricKey];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }
  for (const nestedKey of ["evaluation", "metrics", "summary"]) {
    const nested = record[nestedKey];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      continue;
    }
    const value = (nested as Record<string, unknown>)[metricKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function buildObjectiveMetricSystemPrompt(): string {
  return [
    "You are the AutoLabOS objective metric planning agent.",
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

function findDirectPreferredTopLevelMetric(
  metrics: Record<string, unknown>,
  preferredKeys: string[]
): { key: string; value: number } | undefined {
  const normalizedTargets = preferredKeys.map(normalizeMetricKey).filter(Boolean);
  for (const key of preferredKeys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return { key, value };
    }
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    if (normalizedTargets.includes(normalizeMetricKey(key))) {
      return { key, value };
    }
  }
  return undefined;
}

function findMatchingMetric(
  metrics: Array<{ key: string; value: number }>,
  preferredKeys: string[]
): { key: string; value: number } | undefined {
  const normalizedTargets = preferredKeys.map(normalizeMetricKey).filter(Boolean);
  // Phase 1: exact match (after normalization)
  for (const target of normalizedTargets) {
    const exact = metrics.find((metric) => normalizeMetricKey(metric.key) === target);
    if (exact) {
      return exact;
    }
  }
  // Phase 2: partial match — only if target is specific enough (>=10 chars)
  // and the target covers a meaningful portion of the metric key
  for (const target of normalizedTargets) {
    if (target.length < 10) continue;
    const partial = metrics.find((metric) => {
      const normalized = normalizeMetricKey(metric.key);
      return normalized.includes(target) && target.length >= normalized.length * 0.4;
    });
    if (partial) {
      return partial;
    }
  }
  return undefined;
}

function prioritizePrimaryMetricRelativeKeys(
  enrichedMetrics: Record<string, unknown>,
  originalMetrics: Record<string, unknown>,
  preferredKeys: string[]
): string[] {
  const primaryMetric = typeof originalMetrics.primary_metric === "string"
    ? originalMetrics.primary_metric.trim()
    : "";
  if (!primaryMetric || !preferredKeys.some((key) => /(?:^|_)accuracy(?:_|$)/iu.test(key))) {
    return preferredKeys;
  }
  const scopedKeys = [
    `${primaryMetric}_delta_vs_baseline`,
    `${primaryMetric}_improvement_over_baseline`
  ].filter((key) => typeof enrichedMetrics[key] === "number");
  if (scopedKeys.length === 0) {
    return preferredKeys;
  }
  return dedupe([...scopedKeys, ...preferredKeys]);
}

function buildObjectiveEvaluation(input: {
  rawObjectiveMetric: string;
  profile: ObjectiveMetricProfile;
  preferredKeys: string[];
  matched: { key: string; value: number };
  summaryPrefix?: string;
}): ObjectiveMetricEvaluation {
  if (input.profile.comparator && typeof input.profile.targetValue === "number") {
    let effectiveTarget = input.profile.targetValue;

    // Plausibility guard: if the target exceeds 1.0 but the observed metric
    // is on a 0–1 scale, the target was likely specified in percentage-point
    // units. Rescale it to match the observed proportion scale.
    if (
      effectiveTarget > 1 &&
      Math.abs(input.matched.value) <= 1 &&
      (input.profile.comparator === ">=" || input.profile.comparator === ">")
    ) {
      effectiveTarget = effectiveTarget / 100;
    }

    const met = compareObjectiveValue(input.matched.value, input.profile.comparator, effectiveTarget);
    const baseSummary = met
      ? `Objective metric met: ${input.matched.key}=${input.matched.value} ${input.profile.comparator} ${effectiveTarget}.`
      : `Objective metric not met: ${input.matched.key}=${input.matched.value} does not satisfy ${input.profile.comparator} ${effectiveTarget}.`;
    return {
      rawObjectiveMetric: input.rawObjectiveMetric,
      profileSource: input.profile.source,
      primaryMetric: input.profile.primaryMetric,
      preferredMetricKeys: input.preferredKeys,
      matchedMetricKey: input.matched.key,
      direction: input.profile.direction,
      comparator: input.profile.comparator,
      targetValue: effectiveTarget,
      observedValue: input.matched.value,
      status: met ? "met" : "not_met",
      summary: input.summaryPrefix ? `${input.summaryPrefix} ${baseSummary}` : baseSummary
    };
  }

  const baseSummary = `Observed objective metric ${input.matched.key}=${input.matched.value}.`;
  return {
    rawObjectiveMetric: input.rawObjectiveMetric,
    profileSource: input.profile.source,
    primaryMetric: input.profile.primaryMetric,
    preferredMetricKeys: input.preferredKeys,
    matchedMetricKey: input.matched.key,
    direction: input.profile.direction,
    comparator: input.profile.comparator,
    targetValue: input.profile.targetValue,
    observedValue: input.matched.value,
    status: "observed",
    summary: input.summaryPrefix ? `${input.summaryPrefix} ${baseSummary}` : baseSummary
  };
}

function applyObjectiveRequirementChecks(
  evaluation: ObjectiveMetricEvaluation,
  metrics: Record<string, unknown>,
  rawObjectiveMetric: string
): ObjectiveMetricEvaluation {
  const requirements = collectObjectiveRequirements(metrics, rawObjectiveMetric, evaluation);
  if (requirements.length === 0) {
    return evaluation;
  }

  let status = evaluation.status;
  if (status === "met") {
    if (requirements.some((item) => item.status === "not_met")) {
      status = "not_met";
    } else if (requirements.some((item) => item.status === "missing")) {
      status = "missing";
    }
  }

  const suffix = requirements.map((item) => item.summary).join(" ");
  return {
    ...evaluation,
    status,
    summary: suffix ? `${evaluation.summary} ${suffix}` : evaluation.summary
  };
}

function inferBestEffortMetricMatch(
  metrics: Array<{ key: string; value: number }>,
  preferredKeys: string[],
  rawObjectiveMetric: string
): {
  metric: { key: string; value: number };
  summaryPrefix: string;
} | undefined {
  if (metrics.length === 0) {
    return undefined;
  }
  const relativeObjective = isRelativeObjectiveMetricRequest(preferredKeys, rawObjectiveMetric);
  const candidateMetrics = relativeObjective
    ? metrics.filter((metric) => isRelativeMetricKey(metric.key))
    : metrics;
  const objectiveTokens = tokenizeMetricText(rawObjectiveMetric).filter((token) => !GENERIC_OBJECTIVE_TOKENS.has(token));
  if (candidateMetrics.length === 0) {
    if (preferredKeys.length === 0 && metrics.length === 1 && objectiveTokens.length === 0) {
      return {
        metric: metrics[0],
        summaryPrefix: `Best-effort objective match inferred from the sole numeric metric "${metrics[0].key}".`
      };
    }
    return undefined;
  }

  const scored = candidateMetrics
    .map((metric) => {
      const metricTokens = tokenizeMetricText(metric.key);
      const sharedTokens = metricTokens.filter((token) => objectiveTokens.includes(token));
      return {
        metric,
        sharedTokens,
        score: sharedTokens.length
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.metric.key.localeCompare(right.metric.key));

  const top = scored[0];
  const runnerUp = scored[1];
  if (top && top.score > (runnerUp?.score ?? 0)) {
    return {
      metric: top.metric,
      summaryPrefix: `Best-effort objective match inferred from overlapping metric terms (${top.sharedTokens.join(", ")}).`
    };
  }

  if (!relativeObjective && preferredKeys.length === 0 && metrics.length === 1) {
    return {
      metric: metrics[0],
      summaryPrefix: `Best-effort objective match inferred from the sole numeric metric "${metrics[0].key}".`
    };
  }

  return undefined;
}

function isRelativeObjectiveMetricRequest(preferredKeys: string[], rawObjectiveMetric: string): boolean {
  const text = `${preferredKeys.join(" ")} ${rawObjectiveMetric}`.toLowerCase();
  return /\b(delta|improvement|improve|gain|lift)\b/u.test(text) || /\b(vs|versus|over)\s+(?:a\s+|the\s+)?baseline\b/u.test(text);
}

function isRelativeMetricKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("delta") || normalized.includes("improvement") || normalized.includes("gain") || normalized.includes("lift");
}

function normalizeMetricKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const GENERIC_OBJECTIVE_TOKENS = new Set([
  "overall",
  "improvement",
  "metric",
  "metrics",
  "objective",
  "target",
  "result",
  "results",
  "performance",
  "primary",
  "main",
  "score",
  "scores",
  "success"
]);

function tokenizeMetricText(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
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

function inferRelativeBaselineObjective(
  rawObjectiveMetric: string,
  normalized: string
): {
  primaryMetric?: string;
  preferredMetricKeys: string[];
  direction: ObjectiveDirection;
  comparator: ObjectiveComparator;
  targetValue: number;
  targetDescription: string;
} | undefined {
  const indicatesImprovement =
    /\b(improv(?:e|ement|ing)?|outperform|beat|better|higher|exceed|gain)\b/iu.test(rawObjectiveMetric) ||
    /\bimprov(?:e|ement|ing)?\b/iu.test(normalized) ||
    // "+X.Y" with a plus sign inherently indicates improvement
    /\+\d+(?:\.\d+)?/.test(rawObjectiveMetric) ||
    // "X points/pp over" inherently indicates a delta comparison
    /\d+\s*(?:\w+\s+)?(?:points?|pp)\s+(?:over|above|beyond)\b/iu.test(rawObjectiveMetric);
  const indicatesBaselineComparison =
    /\b(over|vs\.?|versus|than|relative to|against)\b/iu.test(rawObjectiveMetric) ||
    /\bbaseline\b/iu.test(rawObjectiveMetric) ||
    /\blogistic regression\b/iu.test(rawObjectiveMetric);
  if (!indicatesImprovement || !indicatesBaselineComparison) {
    return undefined;
  }

  const mentionsMacroF1 = /\bmacro[-_\s]?f1\b|\bf1\b/iu.test(rawObjectiveMetric);
  const mentionsAccuracy = /\baccuracy\b|\bacc\b/iu.test(rawObjectiveMetric);
  const mentionsLogreg = /\blogistic regression\b|\blogreg\b/iu.test(rawObjectiveMetric);
  if (!mentionsMacroF1 && !mentionsAccuracy) {
    return undefined;
  }

  if (mentionsMacroF1 && mentionsLogreg) {
    return {
      primaryMetric: "macro_f1_delta_vs_logreg",
      preferredMetricKeys: [
        "macro_f1_delta_vs_logreg",
        "mean_macro_f1_improvement_over_logreg",
        "mean_delta_vs_logreg",
        "delta_vs_logreg",
        "value"
      ],
      direction: "maximize",
      comparator: ">",
      targetValue: 0,
      targetDescription: "> 0 relative to the logistic regression baseline"
    };
  }

  if (mentionsAccuracy && mentionsLogreg) {
    return {
      primaryMetric: "accuracy_delta_vs_logreg",
      preferredMetricKeys: [
        "accuracy_delta_vs_logreg",
        "mean_accuracy_improvement_over_logreg",
        "mean_delta_vs_logreg",
        "delta_vs_logreg",
        "value"
      ],
      direction: "maximize",
      comparator: ">",
      targetValue: 0,
      targetDescription: "> 0 relative to the logistic regression baseline"
    };
  }

  // General accuracy + any baseline (non-logreg)
  if (mentionsAccuracy) {
    const deltaAmount = parseDeltaAmount(rawObjectiveMetric);
    const targetVal = deltaAmount ?? 0;
    return {
      primaryMetric: "accuracy_delta_vs_baseline",
      preferredMetricKeys: [
        "accuracy_delta_vs_baseline",
        "accuracy_pass_at_1_delta_vs_baseline",
        "accuracy_improvement_over_baseline",
        "accuracy_pass_at_1_improvement_over_baseline",
        "improvement_over_baseline",
        "delta_vs_baseline",
        "value"
      ],
      direction: "maximize",
      comparator: deltaAmount !== undefined ? ">=" : ">",
      targetValue: targetVal,
      targetDescription:
        deltaAmount !== undefined
          ? `>= ${targetVal} improvement over baseline`
          : "> 0 relative to baseline"
    };
  }

  // General macro-F1 + any baseline (non-logreg)
  if (mentionsMacroF1) {
    const deltaAmount = parseDeltaAmount(rawObjectiveMetric);
    const targetVal = deltaAmount ?? 0;
    return {
      primaryMetric: "macro_f1_delta_vs_baseline",
      preferredMetricKeys: [
        "macro_f1_delta_vs_baseline",
        "f1_delta_vs_baseline",
        "macro_f1_improvement_over_baseline",
        "f1_improvement_over_baseline",
        "improvement_over_baseline",
        "delta_vs_baseline",
        "value"
      ],
      direction: "maximize",
      comparator: deltaAmount !== undefined ? ">=" : ">",
      targetValue: targetVal,
      targetDescription:
        deltaAmount !== undefined
          ? `>= ${targetVal} improvement over baseline`
          : "> 0 relative to baseline"
    };
  }

  return undefined;
}

/**
 * Parse a delta amount from text like "+1.5 accuracy points", "1.5pp",
 * "1.5 percentage points". Converts percentage-point notation to 0–1 proportion.
 */
function parseDeltaAmount(text: string): number | undefined {
  const pointsMatch = text.match(
    /([+-]?\d+(?:\.\d+)?)\s*(?:accuracy\s+)?(?:points?|pp|percentage\s+points?)\b/iu
  );
  if (pointsMatch) {
    return Math.abs(Number(pointsMatch[1])) / 100;
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

function collectObjectiveRequirements(
  metrics: Record<string, unknown>,
  rawObjectiveMetric: string,
  evaluation?: ObjectiveMetricEvaluation
): Array<{ status: "met" | "not_met" | "missing"; summary: string }> {
  const requirements: Array<{ status: "met" | "not_met" | "missing"; summary: string }> = [];
  if (/\bcpu[-\s]?only\b/iu.test(rawObjectiveMetric)) {
    requirements.push(describeBooleanRequirement("CPU-only requirement", resolveCpuOnlyEvidence(metrics)));
  }
  if (/\breproduc(?:ible|ibility)\b/iu.test(rawObjectiveMetric) || /\breplicab(?:le|ility)\b/iu.test(rawObjectiveMetric)) {
    requirements.push(describeBooleanRequirement("Reproducibility requirement", resolveReproducibilityEvidence(metrics)));
  }
  if (requiresResourceRegressionCheck(rawObjectiveMetric)) {
    requirements.push(describeResourceRegressionRequirement(metrics, rawObjectiveMetric, evaluation));
  }
  return requirements;
}

function describeBooleanRequirement(
  label: string,
  value: boolean | undefined
): { status: "met" | "not_met" | "missing"; summary: string } {
  if (value === true) {
    return { status: "met", summary: `${label} satisfied.` };
  }
  if (value === false) {
    return { status: "not_met", summary: `${label} not satisfied.` };
  }
  return { status: "missing", summary: `${label} could not be verified from metrics.json.` };
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function resolveCpuOnlyEvidence(metrics: Record<string, unknown>): boolean | undefined {
  const direct = asBoolean(metrics.cpu_only);
  if (direct !== undefined) {
    return direct;
  }
  const protocol = asRecord(metrics.protocol);
  return asBoolean(protocol.cpu_only);
}

function resolveReproducibilityEvidence(metrics: Record<string, unknown>): boolean | undefined {
  const direct = asBoolean(metrics.reproducible);
  if (direct !== undefined) {
    return direct;
  }
  const protocol = asRecord(metrics.protocol);
  const protocolFlag = asBoolean(protocol.reproducible);
  if (protocolFlag !== undefined) {
    return protocolFlag;
  }
  const samplingProfile = asRecord(metrics.sampling_profile);
  const executedTrials = normalizeNumber(samplingProfile.executed_trials);
  if (typeof executedTrials === "number" && executedTrials > 1) {
    return true;
  }
  const stabilitySignals = [
    normalizeNumber(metrics.run_to_run_variance),
    normalizeNumber(metrics.seed_sensitivity),
    normalizeNumber(metrics.rank_stability),
    normalizeNumber(metrics.fold_to_fold_stability)
  ].filter((value): value is number => typeof value === "number");
  if (stabilitySignals.length > 0) {
    return true;
  }
  return undefined;
}

const RESOURCE_REGRESSION_RATIO_LIMIT = 1.5;
const STRICT_RESOURCE_REGRESSION_RATIO_LIMIT = 1.05;

interface ResourceRegressionMetric {
  kind: "runtime" | "memory";
  label: string;
  candidateValue?: number;
  baselineValue?: number;
  ratio?: number;
}

interface ResourceRegressionComparison {
  baselineName: string;
  candidateName: string;
  metrics: ResourceRegressionMetric[];
}

function requiresResourceRegressionCheck(rawObjectiveMetric: string): boolean {
  return (
    /\b(?:runtime|run[-\s]?time|wall[-\s]?clock|latency|time|memory|gpu|vram)\b/iu.test(rawObjectiveMetric) &&
    /\b(?:regression|worse|without|unacceptable|material|preserv|cost)\b/iu.test(rawObjectiveMetric)
  );
}

function describeResourceRegressionRequirement(
  metrics: Record<string, unknown>,
  rawObjectiveMetric: string,
  evaluation?: ObjectiveMetricEvaluation
): { status: "met" | "not_met" | "missing"; summary: string } {
  const comparison = selectResourceRegressionComparison(metrics, evaluation);
  if (!comparison) {
    return {
      status: "missing",
      summary: "Resource regression requirement could not be verified from metrics.json."
    };
  }

  const limit = resourceRegressionRatioLimit(rawObjectiveMetric);
  const requiredKinds = requiredResourceKinds(rawObjectiveMetric);
  const relevantMetrics = comparison.metrics.filter((metric) => requiredKinds.has(metric.kind));
  const missingMetrics = relevantMetrics.filter((metric) => metric.ratio === undefined);
  const failedMetrics = relevantMetrics.filter((metric) => typeof metric.ratio === "number" && metric.ratio > limit);
  const ratioSummary = relevantMetrics
    .map((metric) =>
      typeof metric.ratio === "number"
        ? `${metric.kind} ${formatRatio(metric.ratio)}`
        : `${metric.kind} unavailable`
    )
    .join(", ");
  const pair = `${comparison.candidateName} vs ${comparison.baselineName}`;

  if (failedMetrics.length > 0) {
    return {
      status: "not_met",
      summary: `Resource regression requirement not satisfied for ${pair}: ${ratioSummary}; allowed limit is ${formatRatio(limit)}.`
    };
  }
  if (missingMetrics.length > 0) {
    return {
      status: "missing",
      summary: `Resource regression requirement could not be fully verified for ${pair}: ${ratioSummary}.`
    };
  }
  return {
    status: "met",
    summary: `Resource regression requirement satisfied for ${pair}: ${ratioSummary}; allowed limit is ${formatRatio(limit)}.`
  };
}

function resourceRegressionRatioLimit(rawObjectiveMetric: string): number {
  const normalized = rawObjectiveMetric.toLowerCase();
  if (
    /\b(?:no|zero)\b[\s\S]{0,40}\b(?:regression|worse)\b/u.test(normalized) &&
    !/\b(?:unacceptable|material|substantial)\b/u.test(normalized)
  ) {
    return STRICT_RESOURCE_REGRESSION_RATIO_LIMIT;
  }
  return RESOURCE_REGRESSION_RATIO_LIMIT;
}

function requiredResourceKinds(rawObjectiveMetric: string): Set<ResourceRegressionMetric["kind"]> {
  const kinds = new Set<ResourceRegressionMetric["kind"]>();
  if (/\b(?:runtime|run[-\s]?time|wall[-\s]?clock|latency|time)\b/iu.test(rawObjectiveMetric)) {
    kinds.add("runtime");
  }
  if (/\b(?:memory|gpu|vram)\b/iu.test(rawObjectiveMetric)) {
    kinds.add("memory");
  }
  if (kinds.size === 0) {
    kinds.add("runtime");
    kinds.add("memory");
  }
  return kinds;
}

function selectResourceRegressionComparison(
  metrics: Record<string, unknown>,
  evaluation?: ObjectiveMetricEvaluation
): ResourceRegressionComparison | undefined {
  const entries = conditionEntriesFromMetrics(metrics);
  if (entries.length < 2) {
    return undefined;
  }
  const baselineEntry = selectBaselineConditionEntry(entries);
  if (!baselineEntry) {
    return undefined;
  }
  const treatmentEntries = selectEligibleTreatmentConditionEntries(entries.filter((entry) => entry !== baselineEntry));
  if (treatmentEntries.length === 0) {
    return undefined;
  }

  const [, baselineRecord] = baselineEntry;
  const scoreMetricKeys = scoreMetricKeysForEvaluation(evaluation);
  const candidates = scoreMetricKeys.flatMap((metricKey, metricIndex) => {
    const baselineValue = getConditionMetricValue(baselineRecord, metricKey);
    if (baselineValue === undefined) {
      return [];
    }
    return treatmentEntries.flatMap(([candidateName, candidateRecord], candidateIndex) => {
      const candidateValue = getConditionMetricValue(candidateRecord, metricKey);
      if (candidateValue === undefined) {
        return [];
      }
      const delta = candidateValue - baselineValue;
      return [
        {
          entry: [candidateName, candidateRecord] as [string, Record<string, unknown>],
          delta,
          exactObservedMatch:
            typeof evaluation?.observedValue === "number" &&
            Math.abs(delta - evaluation.observedValue) <= 1e-9,
          metricIndex,
          candidateIndex
        }
      ];
    });
  });

  const selected = candidates.sort(
    (left, right) =>
      Number(right.exactObservedMatch) - Number(left.exactObservedMatch) ||
      right.delta - left.delta ||
      left.metricIndex - right.metricIndex ||
      left.candidateIndex - right.candidateIndex
  )[0];
  if (!selected) {
    return undefined;
  }

  const [candidateName, candidateRecord] = selected.entry;
  const [baselineName] = baselineEntry;
  return {
    baselineName: humanizeConditionName(baselineName),
    candidateName: humanizeConditionName(candidateName),
    metrics: [
      compareResourceMetric("runtime", "runtime", baselineRecord, candidateRecord),
      compareResourceMetric("memory", "memory", baselineRecord, candidateRecord)
    ]
  };
}

function conditionEntriesFromMetrics(metrics: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const conditions = metrics.conditions;
  if (Array.isArray(conditions)) {
    return conditions
      .filter((item): item is Record<string, unknown> => item && typeof item === "object" && !Array.isArray(item))
      .map((record, index) => [
        cleanString(record.name) || cleanString(record.condition_id) || cleanString(record.condition) || `condition_${index + 1}`,
        record
      ]);
  }
  if (conditions && typeof conditions === "object") {
    return Object.entries(conditions as Record<string, unknown>).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        Boolean(entry[1]) && typeof entry[1] === "object" && !Array.isArray(entry[1])
    );
  }
  return [];
}

function scoreMetricKeysForEvaluation(evaluation?: ObjectiveMetricEvaluation): string[] {
  const matchedMetricKey = evaluation?.matchedMetricKey || "";
  const stripped = matchedMetricKey
    .replace(/_improvement_over_baseline$/iu, "")
    .replace(/_delta_vs_baseline$/iu, "")
    .replace(/_gain_vs_baseline$/iu, "")
    .replace(/_lift_vs_baseline$/iu, "");
  const preferred = stripped && stripped !== matchedMetricKey ? [stripped] : [];
  const accuracyKeys = /accuracy|acc/iu.test(matchedMetricKey)
    ? ["mean_zero_shot_accuracy", "primary_mean_accuracy", "mean_accuracy", "accuracy", "acc"]
    : [];
  return dedupe([...accuracyKeys, ...preferred, ...SYNTHESIZE_METRIC_KEYS]);
}

function compareResourceMetric(
  kind: ResourceRegressionMetric["kind"],
  label: string,
  baselineRecord: Record<string, unknown>,
  candidateRecord: Record<string, unknown>
): ResourceRegressionMetric {
  const paths = kind === "runtime" ? RUNTIME_METRIC_PATHS : MEMORY_METRIC_PATHS;
  const baseline = readFirstNumericPath(baselineRecord, paths);
  const candidate = readFirstNumericPath(candidateRecord, paths);
  const ratio =
    typeof baseline?.value === "number" &&
    baseline.value > 0 &&
    typeof candidate?.value === "number"
      ? candidate.value / baseline.value
      : undefined;
  return {
    kind,
    label,
    baselineValue: baseline?.value,
    candidateValue: candidate?.value,
    ratio
  };
}

const RUNTIME_METRIC_PATHS = [
  ["wall_clock_sec"],
  ["wall_clock_seconds"],
  ["runtime_sec"],
  ["run_time_sec"],
  ["elapsed_sec"],
  ["duration_sec"],
  ["training", "train_runtime_sec"],
  ["training", "trainer_metrics", "train_runtime"],
  ["trainer_metrics", "train_runtime"]
];

const MEMORY_METRIC_PATHS = [
  ["peak_gpu_memory_bytes"],
  ["peak_memory_bytes"],
  ["max_memory_allocated_bytes"],
  ["cuda_max_memory_allocated_bytes"],
  ["device_info_end", "cuda_max_memory_allocated_bytes"],
  ["device_info_final", "cuda_max_memory_allocated_bytes"],
  ["training", "peak_gpu_memory_bytes"],
  ["training", "cuda_max_memory_allocated_bytes"]
];

function readFirstNumericPath(
  record: Record<string, unknown>,
  paths: string[][]
): { key: string; value: number } | undefined {
  for (const pathParts of paths) {
    let current: unknown = record;
    for (const part of pathParts) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === "number" && Number.isFinite(current)) {
      return { key: pathParts.join("."), value: current };
    }
  }
  return undefined;
}

function humanizeConditionName(value: string): string {
  return value.replace(/[_-]+/gu, " ").trim() || value;
}

function formatRatio(value: number): string {
  return `${value.toFixed(2)}x`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
