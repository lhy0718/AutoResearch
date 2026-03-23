import { describe, expect, it } from "vitest";

import { formatResearchBackendModelSummary } from "../src/modelSlotText.js";

describe("modelSlotText", () => {
  it("formats research backend model summaries for CLI surfaces", () => {
    expect(formatResearchBackendModelSummary("Codex", "gpt-5.4")).toBe(
      "Codex research backend model: gpt-5.4"
    );
    expect(formatResearchBackendModelSummary("OpenAI", "gpt-5-mini")).toBe(
      "OpenAI research backend model: gpt-5-mini"
    );
  });
});