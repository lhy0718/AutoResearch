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
});
