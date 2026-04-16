import { afterEach, describe, expect, it, vi } from "vitest";

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
});
