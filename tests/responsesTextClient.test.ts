import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiResponsesTextClient } from "../src/integrations/openai/responsesTextClient.js";

const ORIGINAL_FAKE_RESPONSE = process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE;
const ORIGINAL_FAKE_SEQUENCE = process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_SEQUENCE;

afterEach(() => {
  if (ORIGINAL_FAKE_RESPONSE === undefined) {
    delete process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE;
  } else {
    process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE = ORIGINAL_FAKE_RESPONSE;
  }

  if (ORIGINAL_FAKE_SEQUENCE === undefined) {
    delete process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_SEQUENCE;
  } else {
    process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_SEQUENCE = ORIGINAL_FAKE_SEQUENCE;
  }

  vi.restoreAllMocks();
});

describe("OpenAiResponsesTextClient", () => {
  it("supports fake response sequences for offline tests", async () => {
    process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_SEQUENCE = JSON.stringify(["first", "second"]);
    const client = new OpenAiResponsesTextClient(async () => undefined, { model: "gpt-5.4" });

    await expect(client.runForText({ prompt: "hello" })).resolves.toBe("first");
    await expect(client.runForText({ prompt: "hello again" })).resolves.toBe("second");
  });

  it("fails clearly when OPENAI_API_KEY is missing and no fake response is configured", async () => {
    delete process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE;
    delete process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_SEQUENCE;
    const client = new OpenAiResponsesTextClient(async () => undefined, { model: "gpt-5.4" });

    await expect(client.runForText({ prompt: "hello" })).rejects.toThrow(
      "OPENAI_API_KEY is required for OpenAI API provider mode."
    );
  });

  it("chains retries with previous_response_id when a thread id is provided", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        const responseIndex = requestBodies.length;
        return new Response(
          JSON.stringify({
            id: `resp_${responseIndex}`,
            model: "gpt-5.4",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: `reply ${responseIndex}` }]
              }
            ]
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      })
    );

    const client = new OpenAiResponsesTextClient(async () => "test-key", { model: "gpt-5.4" });

    const first = await client.complete({
      prompt: "first request",
      systemPrompt: "system one"
    });
    const second = await client.complete({
      prompt: "repair request",
      systemPrompt: "system two",
      threadId: first.responseId
    });

    expect(first.responseId).toBe("resp_1");
    expect(second.responseId).toBe("resp_2");
    expect(requestBodies[0]).not.toHaveProperty("previous_response_id");
    expect(requestBodies[1]).toMatchObject({
      previous_response_id: "resp_1",
      instructions: "system two"
    });
  });

  it("surfaces the underlying network cause when fetch fails before an HTTP response arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", {
          cause: {
            message: "connect ECONNRESET 10.0.0.5:443",
            code: "ECONNRESET",
            errno: -104,
            syscall: "connect"
          }
        });
      })
    );

    const client = new OpenAiResponsesTextClient(async () => "test-key", { model: "gpt-5.4" });

    await expect(client.runForText({ prompt: "hello" })).rejects.toThrow(
      "Responses API network request failed before receiving an HTTP response: fetch failed | cause: connect ECONNRESET 10.0.0.5:443, code=ECONNRESET, errno=-104, syscall=connect"
    );
  });

  it("creates long-running responses in background mode and polls until completion", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.openai.com/v1/responses") {
        expect(JSON.parse(String(init?.body || "{}"))).toMatchObject({
          background: true,
          store: true
        });
        return new Response(
          JSON.stringify({
            id: "resp_bg_1",
            status: "queued",
            model: "gpt-5.4"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      expect(url).toBe("https://api.openai.com/v1/responses/resp_bg_1");
      const callIndex = fetchMock.mock.calls.length;
      const status = callIndex < 3 ? "in_progress" : "completed";
      return new Response(
        JSON.stringify({
          id: "resp_bg_1",
          status,
          model: "gpt-5.4",
          output:
            status === "completed"
              ? [
                  {
                    type: "message",
                    content: [{ type: "output_text", text: "background reply" }]
                  }
                ]
              : []
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.AUTOLABOS_OPENAI_BACKGROUND_POLL_MS = "1";

    const progress: string[] = [];
    const client = new OpenAiResponsesTextClient(async () => "test-key", {
      model: "gpt-5.4",
      background: true
    });

    const result = await client.complete({
      prompt: "long request",
      onProgress: (message) => progress.push(message)
    });

    expect(result.text).toBe("background reply");
    expect(result.responseId).toBe("resp_bg_1");
    expect(progress).toContain("OpenAI accepted background response resp_bg_1; polling for completion.");
    expect(progress.some((message) => message.includes("is in_progress"))).toBe(true);
  });
});
