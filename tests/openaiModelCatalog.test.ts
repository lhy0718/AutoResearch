import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT,
  OPENAI_RESPONSES_MODEL_OPTIONS,
  buildOpenAiResponsesModelChoices,
  buildOpenAiResponsesReasoningChoices,
  getOpenAiResponsesModelDescription,
  getOpenAiResponsesReasoningOptions,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "../src/integrations/openai/modelCatalog.js";

describe("openaiModelCatalog", () => {
  it("exposes stable OpenAI Responses model choices", () => {
    expect(buildOpenAiResponsesModelChoices()).toEqual(
      OPENAI_RESPONSES_MODEL_OPTIONS.map((option) => option.value)
    );
    expect(buildOpenAiResponsesModelChoices()).toContain("gpt-5.4");
    expect(buildOpenAiResponsesModelChoices()).toContain("gpt-4o-mini");
  });

  it("returns readable descriptions", () => {
    expect(getOpenAiResponsesModelDescription("gpt-5.4")).toContain("Highest-quality");
    expect(getOpenAiResponsesModelDescription("gpt-4o")).toContain("multimodal");
  });

  it("normalizes unknown models and reasoning effort", () => {
    expect(normalizeOpenAiResponsesModel("")).toBe(DEFAULT_OPENAI_RESPONSES_MODEL);
    expect(normalizeOpenAiResponsesModel("unknown-model")).toBe(DEFAULT_OPENAI_RESPONSES_MODEL);
    expect(normalizeOpenAiResponsesReasoningEffort("gpt-5.4", "xhigh")).toBe("xhigh");
    expect(normalizeOpenAiResponsesReasoningEffort("gpt-4o", "xhigh")).toBe("medium");
    expect(supportsOpenAiResponsesReasoning("gpt-5")).toBe(true);
    expect(supportsOpenAiResponsesReasoning("gpt-4o")).toBe(false);
  });

  it("exposes reasoning choices only for supported models", () => {
    expect(buildOpenAiResponsesReasoningChoices("gpt-5.4")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh"
    ]);
    expect(buildOpenAiResponsesReasoningChoices("gpt-4o")).toEqual([
      DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT
    ]);
    expect(getOpenAiResponsesReasoningOptions("gpt-5-mini")).toHaveLength(5);
    expect(getOpenAiResponsesReasoningOptions("gpt-4.1")).toEqual([
      expect.objectContaining({ value: DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT })
    ]);
  });
});
