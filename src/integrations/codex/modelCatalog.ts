import type { CodexReasoningEffort } from "./codexCliClient.js";

export const GPT_5_4_FAST_MODEL_LABEL = "gpt-5.4 (fast)";
export const RECOMMENDED_CODEX_MODEL = "gpt-5.5";
export const DEFAULT_CODEX_MODEL = "gpt-5.5";

// Official Codex model list from developers.openai.com/codex/models
// (recommended + alternative models), verified 2026-03-06.
export const OFFICIAL_CODEX_MODELS = [
  RECOMMENDED_CODEX_MODEL,
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5"
] as const;

const KNOWN_CODEX_MODEL_SELECTION_ORDER = [
  RECOMMENDED_CODEX_MODEL,
  GPT_5_4_FAST_MODEL_LABEL,
  ...OFFICIAL_CODEX_MODELS.filter((model) => model !== RECOMMENDED_CODEX_MODEL)
] as const;

const DEFAULT_REASONING_EFFORT_CHOICES: readonly CodexReasoningEffort[] = ["low", "medium", "high"];

// Reasoning-effort support is sourced from the Codex config reference and
// per-model OpenAI docs where they exist. For preview/legacy models without
// an explicit model page, the selector uses a conservative subset.
const MODEL_REASONING_EFFORTS: Record<string, readonly CodexReasoningEffort[]> = {
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.3-codex-spark": ["low", "medium", "high"],
  "gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.2": ["low", "medium", "high"],
  "gpt-5.1-codex-max": ["low", "medium", "high"],
  "gpt-5.1": ["low", "medium", "high"],
  "gpt-5.1-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5-codex": ["low", "medium", "high"],
  "gpt-5-codex-mini": ["low", "medium", "high"],
  "gpt-5": ["minimal", "low", "medium", "high"]
};

export function buildCodexModelSelectionChoices(currentModel?: string, rawEnvChoices = ""): string[] {
  const current = currentModel?.trim();
  const fromEnv = rawEnvChoices
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const deduped = new Set<string>([
    ...(current ? [current] : []),
    DEFAULT_CODEX_MODEL,
    RECOMMENDED_CODEX_MODEL,
    GPT_5_4_FAST_MODEL_LABEL,
    ...OFFICIAL_CODEX_MODELS.filter((model) => model !== RECOMMENDED_CODEX_MODEL),
    ...fromEnv
  ]);

  const knownChoices = KNOWN_CODEX_MODEL_SELECTION_ORDER.filter((choice) => deduped.has(choice));
  const unknownChoices = [...deduped]
    .filter((choice) => !KNOWN_CODEX_MODEL_SELECTION_ORDER.includes(choice as (typeof KNOWN_CODEX_MODEL_SELECTION_ORDER)[number]))
    .sort(compareUnknownCodexModelChoices);
  return [...knownChoices, ...unknownChoices];
}

export function getReasoningEffortChoicesForModel(model?: string): readonly CodexReasoningEffort[] {
  const normalized = model?.trim();
  if (normalized && MODEL_REASONING_EFFORTS[normalized]) {
    return MODEL_REASONING_EFFORTS[normalized];
  }
  return DEFAULT_REASONING_EFFORT_CHOICES;
}

export function isReasoningEffortSupportedForModel(model: string | undefined, effort: string | undefined): boolean {
  if (!effort) {
    return false;
  }
  return getReasoningEffortChoicesForModel(model).includes(effort as CodexReasoningEffort);
}

export function normalizeReasoningEffortForModel(
  model: string | undefined,
  effort: string | undefined
): CodexReasoningEffort {
  if (isReasoningEffortSupportedForModel(model, effort)) {
    return effort as CodexReasoningEffort;
  }

  const supported = getReasoningEffortChoicesForModel(model);
  return supported.includes("medium") ? "medium" : supported[0];
}

export function resolveCodexModelSelection(choice: string): {
  model: string;
  fastMode: boolean;
} {
  if (choice === GPT_5_4_FAST_MODEL_LABEL) {
    return {
      model: "gpt-5.4",
      fastMode: true
    };
  }

  return {
    model: choice,
    fastMode: false
  };
}

export function getCurrentCodexModelSelectionValue(model: string | undefined, fastMode: boolean | undefined): string {
  if (model === "gpt-5.4" && fastMode) {
    return GPT_5_4_FAST_MODEL_LABEL;
  }
  return model?.trim() || DEFAULT_CODEX_MODEL;
}

export function getCodexModelSelectionDescription(choice: string): string | undefined {
  switch (choice) {
    case RECOMMENDED_CODEX_MODEL:
      return "Recommended GPT-5.5 mode.";
    case GPT_5_4_FAST_MODEL_LABEL:
      return "Fast mode: 1.5x speed, 2x credits.";
    case "gpt-5.3-codex-spark":
      return "Separate fast Codex model.";
    default:
      return undefined;
  }
}

export function isRecommendedCodexModelSelection(choice: string): boolean {
  return choice === RECOMMENDED_CODEX_MODEL;
}

function compareUnknownCodexModelChoices(left: string, right: string): number {
  const leftVersion = extractChoiceVersion(left);
  const rightVersion = extractChoiceVersion(right);
  if (leftVersion && rightVersion) {
    for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) {
      const delta = (rightVersion[index] ?? -1) - (leftVersion[index] ?? -1);
      if (delta !== 0) {
        return delta;
      }
    }
  } else if (leftVersion) {
    return -1;
  } else if (rightVersion) {
    return 1;
  }

  return left.localeCompare(right);
}

function extractChoiceVersion(choice: string): number[] | undefined {
  const normalized = choice === GPT_5_4_FAST_MODEL_LABEL ? RECOMMENDED_CODEX_MODEL : choice;
  const match = normalized.match(/^gpt-(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  if (!match) {
    return undefined;
  }

  return match
    .slice(1)
    .filter((segment) => segment !== undefined)
    .map((segment) => Number(segment));
}
