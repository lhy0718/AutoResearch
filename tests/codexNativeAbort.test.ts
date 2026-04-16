import { afterEach, describe, expect, it, vi } from "vitest";

describe("CodexNativeClient abort cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("forwards abort to the native Codex OAuth request", async () => {
    vi.doMock("../src/integrations/codex/oauthAuth.js", () => ({
      checkCodexOAuthStatus: vi.fn().mockResolvedValue({ ok: true, detail: "logged in" }),
      resolveCodexOAuthCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        refreshToken: "refresh"
      })
    }));

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { CodexNativeClient } = await import("../src/integrations/codex/codexCliClient.js");
    const client = new CodexNativeClient(process.cwd());
    const controller = new AbortController();

    const runPromise = client.runTurnStream({
      prompt: "probe",
      sandboxMode: "read-only",
      approvalPolicy: "never",
      abortSignal: controller.signal
    });
    const rejection = expect(runPromise).rejects.toThrow("Operation aborted by user");

    controller.abort();
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
