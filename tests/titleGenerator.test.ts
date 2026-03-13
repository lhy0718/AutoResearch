import { afterEach, describe, expect, it, vi } from "vitest";

import { TitleGenerator } from "../src/core/runs/titleGenerator.js";

class MockCodexSuccess {
  async runForText(): Promise<string> {
    return "  Multi Agent Planning for Retrieval-Augmented Research Workflows  ";
  }
}

class MockCodexFail {
  async runForText(): Promise<string> {
    throw new Error("codex unavailable");
  }
}

class MockCodexHang {
  abortSignals: AbortSignal[] = [];

  async runForText(opts: { abortSignal?: AbortSignal }): Promise<string> {
    this.abortSignals.push(opts.abortSignal as AbortSignal);
    return new Promise<string>(() => undefined);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TitleGenerator", () => {
  it("sanitizes codex title output", async () => {
    const generator = new TitleGenerator(() => new MockCodexSuccess() as never);
    const title = await generator.generateTitle("topic", ["a"], "metric");
    expect(title).toBe("Multi Agent Planning for Retrieval-Augmented Research Workflows");
  });

  it("falls back to topic when codex fails", async () => {
    const generator = new TitleGenerator(() => new MockCodexFail() as never);
    const title = await generator.generateTitle("My Topic", [], "");
    expect(title).toBe("My Topic");
  });

  it("times out hung providers and falls back to the topic", async () => {
    vi.useFakeTimers();
    const client = new MockCodexHang();
    const generator = new TitleGenerator(() => client as never, { timeoutMs: 25 });

    const pendingTitle = generator.generateTitle("Small Tabular Classification", [], "");
    await vi.advanceTimersByTimeAsync(25);

    await expect(pendingTitle).resolves.toBe("Small Tabular Classification");
    expect(client.abortSignals).toHaveLength(1);
    expect(client.abortSignals[0]?.aborted).toBe(true);
  });
});
