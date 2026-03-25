import { describe, expect, it } from "vitest";

import { computeModelUsageCostUsd, resolveModelBilling } from "../src/core/llm/modelPricing.js";
import { OFFICIAL_CODEX_MODELS } from "../src/integrations/codex/modelCatalog.js";
import { OPENAI_RESPONSES_MODEL_OPTIONS } from "../src/integrations/openai/modelCatalog.js";

describe("modelPricing", () => {
  it("covers every configured OpenAI Responses model with token pricing", () => {
    for (const option of OPENAI_RESPONSES_MODEL_OPTIONS) {
      expect(resolveModelBilling(option.value)).toMatchObject({
        modelId: option.value,
        billing: { kind: "token" }
      });
    }
  });

  it("covers configured Codex models with explicit billing states", () => {
    expect(resolveModelBilling("gpt-5.3-codex-spark")).toMatchObject({
      billing: { kind: "unpriced" }
    });
    expect(resolveModelBilling("gpt-5-codex-mini")).toMatchObject({
      billing: { kind: "unpriced" }
    });

    for (const model of OFFICIAL_CODEX_MODELS.filter(
      (value) => value !== "gpt-5.3-codex-spark" && value !== "gpt-5-codex-mini"
    )) {
      expect(resolveModelBilling(model)).toMatchObject({
        modelId: model,
        billing: { kind: "token" }
      });
    }
  });

  it("keeps local Ollama models at zero dollars", () => {
    expect(
      computeModelUsageCostUsd("qwen3.5:35b-a3b", {
        inputTokens: 100_000,
        outputTokens: 50_000
      })
    ).toBe(0);
  });

  it("computes costs for snapshot and provider-prefixed model ids", () => {
    expect(
      computeModelUsageCostUsd("openai/gpt-4o-2024-08-06", {
        inputTokens: 1_000,
        outputTokens: 2_000
      })
    ).toBe(0.0225);
    expect(
      computeModelUsageCostUsd("gpt-5.4-20260305", {
        inputTokens: 200_000,
        outputTokens: 50_000
      })
    ).toBe(1.25);
  });

  it("refuses to invent costs for known but unpriced models", () => {
    expect(
      computeModelUsageCostUsd("gpt-5.3-codex-spark", {
        inputTokens: 1_000,
        outputTokens: 2_000
      })
    ).toBeUndefined();
  });
});
