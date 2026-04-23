import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexOAuthResponsesLLMClient } from "../src/core/llm/client.js";
import { CodexOAuthResponsesTextClient } from "../src/integrations/codex/oauthResponsesTextClient.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodexOAuthResponsesTextClient", () => {
  it("fails clearly when ~/.codex/auth.json credentials are unavailable", async () => {
    const client = new CodexOAuthResponsesTextClient(async () => undefined, { model: "gpt-5.3-codex" });

    await expect(client.runForText({ prompt: "hello" })).rejects.toThrow(
      "Codex ChatGPT OAuth is required. Run `codex login` so ~/.codex/auth.json contains tokens."
    );
  });

  it("posts a responses-style request to the ChatGPT Codex backend using the access token", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-access-token",
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      });
      expect(JSON.parse(String(init?.body || "{}"))).toMatchObject({
        model: "gpt-5.3-codex",
        instructions: "system",
        store: false,
        stream: true,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "hello" }]
          }
        ],
        text: { format: { type: "text" } },
        reasoning: { effort: "high" }
      });
      return new Response(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"codex_resp_1","model":"gpt-5.3-codex","status":"in_progress","output":[]}}',
          "",
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"native codex reply"}',
          "",
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"codex_resp_1","model":"gpt-5.3-codex","status":"completed","usage":{"input_tokens":120,"output_tokens":30},"output":[{"type":"message","content":[{"type":"output_text","text":"native codex reply"}]}]}}',
          ""
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodexOAuthResponsesTextClient(
      async () => ({
        accessToken: "test-access-token",
        accountId: "acct_123"
      }),
      { model: "gpt-5.3-codex", reasoningEffort: "high" }
    );

    const result = await client.complete({
      prompt: "hello",
      systemPrompt: "system"
    });

    expect(result).toMatchObject({
      text: "native codex reply",
      responseId: "codex_resp_1",
      model: "gpt-5.3-codex",
      usage: {
        inputTokens: 120,
        outputTokens: 30
      }
    });
  });

  it("forwards streamed text deltas through the generic LLM progress callback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          [
            'event: response.created',
            'data: {"type":"response.created","response":{"id":"codex_resp_delta","model":"gpt-5.3-codex","status":"in_progress","output":[]}}',
            "",
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"first "}',
            "",
            'event: response.output_text.delta',
            'data: {"type":"response.output_text.delta","delta":"second"}',
            "",
            'event: response.completed',
            'data: {"type":"response.completed","response":{"id":"codex_resp_delta","model":"gpt-5.3-codex","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"first second"}]}]}}',
            ""
          ].join("\n"),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
          }
        );
      })
    );

    const textClient = new CodexOAuthResponsesTextClient(
      async () => ({
        accessToken: "test-access-token",
        accountId: "acct_123"
      }),
      { model: "gpt-5.3-codex", reasoningEffort: "high" }
    );
    const llmClient = new CodexOAuthResponsesLLMClient(textClient);
    const progress: Array<{ type: "status" | "delta"; text: string }> = [];

    const result = await llmClient.complete("hello", {
      onProgress: (event) => progress.push(event)
    });

    expect(result.text).toBe("first second");
    expect(progress).toContainEqual({ type: "delta", text: "first " });
    expect(progress).toContainEqual({ type: "delta", text: "second" });
    expect(progress).toContainEqual({ type: "status", text: "Received Codex OAuth output." });
  });

  it("does not send previous_response_id when only a threadId is provided", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body).not.toHaveProperty("previous_response_id");
      return new Response(
        [
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"codex_resp_2","model":"gpt-5.3-codex","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}',
          ""
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodexOAuthResponsesTextClient(
      async () => ({
        accessToken: "test-access-token",
        accountId: "acct_123"
      }),
      { model: "gpt-5.3-codex", reasoningEffort: "high" }
    );

    const result = await client.complete({
      prompt: "hello",
      threadId: "thread-opaque-id"
    });

    expect(result.text).toBe("ok");
  });

  it("sends previous_response_id only when explicitly provided", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.previous_response_id).toBe("resp_explicit");
      return new Response(
        [
          'event: response.completed',
          'data: {"type":"response.completed","response":{"id":"codex_resp_3","model":"gpt-5.3-codex","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}',
          ""
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodexOAuthResponsesTextClient(
      async () => ({
        accessToken: "test-access-token",
        accountId: "acct_123"
      }),
      { model: "gpt-5.3-codex", reasoningEffort: "high" }
    );

    const result = await client.complete({
      prompt: "hello",
      threadId: "thread-opaque-id",
      previousResponseId: "resp_explicit"
    });

    expect(result.text).toBe("ok");
  });

  it("salvages text from item.completed when the stream never emits response.completed", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"codex_resp_4","model":"gpt-5.3-codex","status":"in_progress","output":[]}}',
          "",
          'event: item.completed',
          'data: {"type":"item.completed","item":{"type":"message","content":[{"type":"output_text","text":"partial-but-usable"}]}}',
          ""
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodexOAuthResponsesTextClient(
      async () => ({
        accessToken: "test-access-token",
        accountId: "acct_123"
      }),
      { model: "gpt-5.3-codex", reasoningEffort: "high" }
    );

    const result = await client.complete({ prompt: "hello" });

    expect(result).toMatchObject({
      text: "partial-but-usable",
      responseId: "codex_resp_4",
      model: "gpt-5.3-codex"
    });
  });

  it("salvages output_text.done text when the response payload never leaves in_progress", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"codex_resp_5","model":"gpt-5.3-codex","status":"in_progress","output":[]}}',
          "",
          'event: response.output_text.done',
          'data: {"type":"response.output_text.done","text":"final text from done event"}',
          ""
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new CodexOAuthResponsesTextClient(
      async () => ({
        accessToken: "test-access-token",
        accountId: "acct_123"
      }),
      { model: "gpt-5.3-codex", reasoningEffort: "high" }
    );

    const result = await client.complete({ prompt: "hello" });

    expect(result.text).toBe("final text from done event");
    expect(result.responseId).toBe("codex_resp_5");
  });
});
