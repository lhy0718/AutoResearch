import { afterEach, describe, expect, it } from "vitest";

import { CodexCliClient } from "../src/integrations/codex/codexCliClient.js";

describe("CodexCliClient fake response sequence", () => {
  afterEach(() => {
    delete process.env.AUTOLABOS_FAKE_CODEX_RESPONSE;
    delete process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE;
  });

  it("consumes fake response sequence entries in order", async () => {
    process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE = JSON.stringify([
      { reply_lines: ["first"] },
      { reply_lines: ["second"] }
    ]);

    const client = new CodexCliClient(process.cwd());
    const first = await client.runForText({
      prompt: "one",
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });
    const second = await client.runForText({
      prompt: "two",
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });

    expect(first).toContain("first");
    expect(second).toContain("second");
  });
});
