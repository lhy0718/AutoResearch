import { describe, expect, it } from "vitest";

import {
  DEFAULT_CODEX_MODEL,
  GPT_5_4_FAST_MODEL_LABEL,
  OFFICIAL_CODEX_MODELS,
  buildCodexModelSelectionChoices,
  getCurrentCodexModelSelectionValue,
  getReasoningEffortChoicesForModel,
  isRecommendedCodexModelSelection,
  normalizeReasoningEffortForModel,
  RECOMMENDED_CODEX_MODEL,
  resolveCodexModelSelection
} from "../src/integrations/codex/modelCatalog.js";

describe("modelCatalog", () => {
  it("matches the official Codex model list and excludes removed entries", () => {
    expect(OFFICIAL_CODEX_MODELS).toContain("gpt-5.4");
    expect(OFFICIAL_CODEX_MODELS).toContain("gpt-5.3-codex-spark");
    expect(OFFICIAL_CODEX_MODELS).toContain("gpt-5.2");
    expect(OFFICIAL_CODEX_MODELS).toContain("gpt-5-codex-mini");
    expect(OFFICIAL_CODEX_MODELS).not.toContain("gpt-5.1-codex-mini");
  });

  it("exposes gpt-5.4 and gpt-5.4 (fast) as separate selector options", () => {
    const choices = buildCodexModelSelectionChoices();
    expect(choices).toContain("gpt-5.4");
    expect(choices).toContain(GPT_5_4_FAST_MODEL_LABEL);
    expect(resolveCodexModelSelection("gpt-5.4")).toEqual({
      model: "gpt-5.4",
      fastMode: false
    });
    expect(resolveCodexModelSelection(GPT_5_4_FAST_MODEL_LABEL)).toEqual({
      model: "gpt-5.4",
      fastMode: true
    });
    expect(getCurrentCodexModelSelectionValue("gpt-5.4", true)).toBe(GPT_5_4_FAST_MODEL_LABEL);
    expect(getCurrentCodexModelSelectionValue(undefined, false)).toBe(DEFAULT_CODEX_MODEL);
  });

  it("orders model selector choices with gpt-5.4 first and remaining models in descending version order", () => {
    const choices = buildCodexModelSelectionChoices("gpt-5.1-codex");
    expect(choices.slice(0, 7)).toEqual([
      RECOMMENDED_CODEX_MODEL,
      GPT_5_4_FAST_MODEL_LABEL,
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.1-codex-max"
    ]);
    expect(choices.indexOf("gpt-5.1")).toBeLessThan(choices.indexOf("gpt-5"));
    expect(choices.indexOf("gpt-5.1-codex")).toBeLessThan(choices.indexOf("gpt-5-codex"));
  });

  it("marks only the standard gpt-5.4 option as recommended", () => {
    expect(isRecommendedCodexModelSelection(RECOMMENDED_CODEX_MODEL)).toBe(true);
    expect(isRecommendedCodexModelSelection(GPT_5_4_FAST_MODEL_LABEL)).toBe(false);
    expect(DEFAULT_CODEX_MODEL).toBe("gpt-5.4");
    expect(isRecommendedCodexModelSelection(DEFAULT_CODEX_MODEL)).toBe(true);
  });

  it("exposes xhigh for Codex models that document it", () => {
    expect(getReasoningEffortChoicesForModel("gpt-5.3-codex")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getReasoningEffortChoicesForModel("gpt-5.2-codex")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getReasoningEffortChoicesForModel("gpt-5.1-codex")).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("uses conservative effort subsets for general and preview models", () => {
    expect(getReasoningEffortChoicesForModel("gpt-5.4")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getReasoningEffortChoicesForModel("gpt-5.3-codex-spark")).toEqual(["low", "medium", "high"]);
    expect(getReasoningEffortChoicesForModel("gpt-5.2")).toEqual(["low", "medium", "high"]);
    expect(getReasoningEffortChoicesForModel("gpt-5")).toEqual(["minimal", "low", "medium", "high"]);
  });

  it("normalizes invalid reasoning effort to a supported default", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.2", "xhigh")).toBe("medium");
    expect(normalizeReasoningEffortForModel("gpt-5.3-codex", "minimal")).toBe("medium");
    expect(normalizeReasoningEffortForModel("gpt-5", "xhigh")).toBe("medium");
  });
});
