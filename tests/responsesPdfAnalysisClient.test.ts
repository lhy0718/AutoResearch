import { afterEach, describe, expect, it, vi } from "vitest";

import { ResponsesPdfAnalysisClient } from "../src/integrations/openai/responsesPdfAnalysisClient.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ResponsesPdfAnalysisClient", () => {
  it("sends a PDF file_url to the Responses API and extracts output text", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "resp_test",
          model: "gpt-5.4",
          usage: {
            input_tokens: 1_000,
            output_tokens: 200
          },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "{\"summary\":\"ok\",\"evidence_items\":[]}"
                }
              ]
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new ResponsesPdfAnalysisClient(async () => "openai-test-key");
    const result = await client.analyzePdf({
      model: "gpt-5.4",
      pdfUrl: "https://example.com/paper.pdf",
      prompt: "Analyze this paper."
    });

    expect(result.text).toContain("\"summary\":\"ok\"");
    expect(result.usage).toEqual({
      inputTokens: 1_000,
      outputTokens: 200,
      costUsd: 0.0055
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-5.4");
    expect(body.input[0].content[1]).toEqual({
      type: "input_file",
      file_url: "https://example.com/paper.pdf"
    });
  });

  it("fails clearly when OPENAI_API_KEY is missing", async () => {
    const client = new ResponsesPdfAnalysisClient(async () => undefined);
    await expect(
      client.analyzePdf({
        model: "gpt-5.4",
        pdfUrl: "https://example.com/paper.pdf",
        prompt: "Analyze this paper."
      })
    ).rejects.toThrow("OPENAI_API_KEY is required");
  });
});
