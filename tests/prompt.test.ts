import { describe, expect, it } from "vitest";

import { formatPromptChoiceLine } from "../src/utils/prompt.js";

describe("formatPromptChoiceLine", () => {
  it("renders non-selected descriptions in gray", () => {
    const line = formatPromptChoiceLine(
      {
        label: "codex",
        value: "codex_chatgpt_only",
        description: "(ChatGPT sign-in, best for interactive coding)"
      },
      false,
      true
    );

    expect(line).toContain("  codex");
    expect(line).toContain("\x1b[90m(ChatGPT sign-in, best for interactive coding)\x1b[0m");
  });

  it("renders selected options in blue", () => {
    const line = formatPromptChoiceLine(
      {
        label: "api",
        value: "openai_api",
        description: "(OPENAI_API_KEY required, direct API control)"
      },
      true,
      true
    );

    expect(line).toBe("\x1b[94m> api (OPENAI_API_KEY required, direct API control)\x1b[0m");
  });

  it("falls back to plain text when color is disabled", () => {
    const line = formatPromptChoiceLine(
      {
        label: "api",
        value: "openai_api",
        description: "(OPENAI_API_KEY required, direct API control)"
      },
      false,
      false
    );

    expect(line).toBe("  api (OPENAI_API_KEY required, direct API control)");
  });
});
