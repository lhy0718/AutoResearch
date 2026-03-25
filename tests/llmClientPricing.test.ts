import { describe, expect, it, vi } from "vitest";

import { CodexCliClient } from "../src/integrations/codex/codexCliClient.js";
import { OpenAiResponsesTextClient } from "../src/integrations/openai/responsesTextClient.js";
import { CodexLLMClient, OpenAiResponsesLLMClient } from "../src/core/llm/client.js";

describe("LLM client pricing propagation", () => {
  it("passes through OpenAI Responses usage and cost", async () => {
    const openai = new OpenAiResponsesTextClient(async () => undefined, { model: "gpt-5.4" });
    vi.spyOn(openai, "complete").mockResolvedValue({
      text: "ok",
      responseId: "resp_1",
      model: "gpt-5.4",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.00055
      }
    });

    const client = new OpenAiResponsesLLMClient(openai, { model: "gpt-5.4" });
    const result = await client.complete("hello");

    expect(result).toEqual({
      text: "ok",
      threadId: "resp_1",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.00055
      }
    });
  });

  it("extracts Codex token usage and computes cost when events expose usage", async () => {
    const codex = new CodexCliClient(process.cwd());
    vi.spyOn(codex, "runTurnStream").mockResolvedValue({
      threadId: "thread_1",
      finalText: "done",
      events: [
        {
          type: "response.completed",
          model: "gpt-5.2-codex",
          usage: {
            input_tokens: 1_000,
            output_tokens: 200
          }
        }
      ]
    });

    const client = new CodexLLMClient(codex, { model: "gpt-5.2-codex" });
    const result = await client.complete("fix this");

    expect(result).toEqual({
      text: "done",
      threadId: "thread_1",
      usage: {
        inputTokens: 1_000,
        outputTokens: 200,
        costUsd: 0.00455
      }
    });
  });

  it("preserves Codex tokens but leaves dollars undefined for unpriced models", async () => {
    const codex = new CodexCliClient(process.cwd());
    vi.spyOn(codex, "runTurnStream").mockResolvedValue({
      threadId: "thread_2",
      finalText: "done",
      events: [
        {
          type: "response.completed",
          model: "gpt-5.3-codex-spark",
          usage: {
            input_tokens: 1_000,
            output_tokens: 200
          }
        }
      ]
    });

    const client = new CodexLLMClient(codex, { model: "gpt-5.3-codex-spark" });
    const result = await client.complete("fix this");

    expect(result.usage).toEqual({
      inputTokens: 1_000,
      outputTokens: 200,
      costUsd: undefined
    });
  });
});
