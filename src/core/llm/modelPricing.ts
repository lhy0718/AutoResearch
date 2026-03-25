import {
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_EXPERIMENT_MODEL,
  DEFAULT_OLLAMA_RESEARCH_MODEL,
  DEFAULT_OLLAMA_VISION_MODEL,
  OLLAMA_CHAT_MODEL_OPTIONS,
  OLLAMA_EXPERIMENT_MODEL_OPTIONS,
  OLLAMA_RESEARCH_MODEL_OPTIONS,
  OLLAMA_VISION_MODEL_OPTIONS
} from "../../integrations/ollama/modelCatalog.js";

export interface TokenPricedModelBilling {
  kind: "token";
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
}

export interface LocalModelBilling {
  kind: "local";
}

export interface UnpricedModelBilling {
  kind: "unpriced";
  reason: string;
}

export type ModelBilling = TokenPricedModelBilling | LocalModelBilling | UnpricedModelBilling;

export interface ResolvedModelBilling {
  modelId: string;
  billing: ModelBilling;
}

const TOKEN_PRICED_MODELS: Record<string, TokenPricedModelBilling> = {
  // OpenAI Responses family.
  "gpt-5.4": { kind: "token", inputUsdPer1MTokens: 2.5, outputUsdPer1MTokens: 15 },
  "gpt-5": { kind: "token", inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 },
  "gpt-5-mini": { kind: "token", inputUsdPer1MTokens: 0.25, outputUsdPer1MTokens: 2 },
  "gpt-4.1": { kind: "token", inputUsdPer1MTokens: 2, outputUsdPer1MTokens: 8 },
  "gpt-4o": { kind: "token", inputUsdPer1MTokens: 2.5, outputUsdPer1MTokens: 10 },
  "gpt-4o-mini": { kind: "token", inputUsdPer1MTokens: 0.15, outputUsdPer1MTokens: 0.6 },

  // Codex / coding-oriented GPT family where token pricing is publicly exposed.
  "gpt-5.3-codex": { kind: "token", inputUsdPer1MTokens: 1.75, outputUsdPer1MTokens: 14 },
  "gpt-5.2": { kind: "token", inputUsdPer1MTokens: 1.75, outputUsdPer1MTokens: 14 },
  "gpt-5.2-codex": { kind: "token", inputUsdPer1MTokens: 1.75, outputUsdPer1MTokens: 14 },
  "gpt-5.1": { kind: "token", inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 },
  "gpt-5.1-codex": { kind: "token", inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 },
  "gpt-5.1-codex-max": { kind: "token", inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 },
  "gpt-5-codex": { kind: "token", inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 10 }
};

const UNPRICED_MODELS: Record<string, UnpricedModelBilling> = {
  "gpt-5.3-codex-spark": {
    kind: "unpriced",
    reason: "No verifiable token-priced public rate was available from accessible sources."
  },
  "gpt-5-codex-mini": {
    kind: "unpriced",
    reason: "No verifiable token-priced public rate was available from accessible sources."
  }
};

const LOCAL_MODEL_IDS = new Set(
  [
    DEFAULT_OLLAMA_CHAT_MODEL,
    DEFAULT_OLLAMA_RESEARCH_MODEL,
    DEFAULT_OLLAMA_EXPERIMENT_MODEL,
    DEFAULT_OLLAMA_VISION_MODEL,
    ...OLLAMA_CHAT_MODEL_OPTIONS.map((option) => option.value),
    ...OLLAMA_RESEARCH_MODEL_OPTIONS.map((option) => option.value),
    ...OLLAMA_EXPERIMENT_MODEL_OPTIONS.map((option) => option.value),
    ...OLLAMA_VISION_MODEL_OPTIONS.map((option) => option.value)
  ].map((value) => value.trim().toLowerCase())
);

const KNOWN_MODEL_IDS = [
  ...Object.keys(TOKEN_PRICED_MODELS),
  ...Object.keys(UNPRICED_MODELS),
  ...LOCAL_MODEL_IDS
].sort((left, right) => right.length - left.length);

export function resolveModelBilling(model: string | undefined): ResolvedModelBilling | undefined {
  const normalized = normalizeModelForBilling(model);
  if (!normalized) {
    return undefined;
  }

  if (LOCAL_MODEL_IDS.has(normalized)) {
    return {
      modelId: normalized,
      billing: { kind: "local" }
    };
  }

  if (TOKEN_PRICED_MODELS[normalized]) {
    return {
      modelId: normalized,
      billing: TOKEN_PRICED_MODELS[normalized]
    };
  }

  if (UNPRICED_MODELS[normalized]) {
    return {
      modelId: normalized,
      billing: UNPRICED_MODELS[normalized]
    };
  }

  for (const candidate of KNOWN_MODEL_IDS) {
    if (!isSnapshotAliasOfModel(normalized, candidate)) {
      continue;
    }

    if (LOCAL_MODEL_IDS.has(candidate)) {
      return {
        modelId: candidate,
        billing: { kind: "local" }
      };
    }

    if (TOKEN_PRICED_MODELS[candidate]) {
      return {
        modelId: candidate,
        billing: TOKEN_PRICED_MODELS[candidate]
      };
    }

    if (UNPRICED_MODELS[candidate]) {
      return {
        modelId: candidate,
        billing: UNPRICED_MODELS[candidate]
      };
    }
  }

  return undefined;
}

export function computeModelUsageCostUsd(
  model: string | undefined,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
  }
): number | undefined {
  const resolved = resolveModelBilling(model);
  if (!resolved) {
    return undefined;
  }

  if (resolved.billing.kind === "local") {
    return 0;
  }

  if (resolved.billing.kind === "unpriced") {
    return undefined;
  }

  const inputTokens = sanitizeTokenCount(usage.inputTokens) ?? 0;
  const outputTokens = sanitizeTokenCount(usage.outputTokens) ?? 0;
  if (inputTokens === 0 && outputTokens === 0) {
    return undefined;
  }

  return (
    (inputTokens * resolved.billing.inputUsdPer1MTokens +
      outputTokens * resolved.billing.outputUsdPer1MTokens) /
    1_000_000
  );
}

function normalizeModelForBilling(model: string | undefined): string | undefined {
  if (typeof model !== "string") {
    return undefined;
  }

  const trimmed = model.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^openai\//u, "");
}

function isSnapshotAliasOfModel(model: string, candidate: string): boolean {
  if (!model.startsWith(candidate)) {
    return false;
  }

  const remainder = model.slice(candidate.length);
  if (!remainder.startsWith("-")) {
    return false;
  }

  return /\d/u.test(remainder[1] || "");
}

function sanitizeTokenCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}
