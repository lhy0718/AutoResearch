import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveConstraintProfile } from "../src/core/constraintProfile.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { resolveGeneratedLiteratureQueries } from "../src/core/literatureQueryGeneration.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import type { RunRecord } from "../src/types.js";

class HangingLLMClient extends MockLLMClient {
  override async complete(): Promise<{ text: string }> {
    return await new Promise<{ text: string }>(() => {});
  }
}

function buildRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Timeout regression",
    topic: "LoRA rank dropout interaction",
    constraints: ["Use two GPUs", "Keep a named baseline and real metrics."],
    objectiveMetric: "ARC-Challenge and HellaSwag mean accuracy",
    status: "running",
    currentNode: "collect_papers",
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    graph: createDefaultGraphState(),
    memoryRefs: {
      runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

describe("collect-time LLM helpers", () => {
  const originalConstraintTimeout = process.env.AUTOLABOS_CONSTRAINT_PROFILE_TIMEOUT_MS;
  const originalQueryTimeout = process.env.AUTOLABOS_LITERATURE_QUERY_TIMEOUT_MS;

  afterEach(() => {
    if (originalConstraintTimeout === undefined) {
      delete process.env.AUTOLABOS_CONSTRAINT_PROFILE_TIMEOUT_MS;
    } else {
      process.env.AUTOLABOS_CONSTRAINT_PROFILE_TIMEOUT_MS = originalConstraintTimeout;
    }
    if (originalQueryTimeout === undefined) {
      delete process.env.AUTOLABOS_LITERATURE_QUERY_TIMEOUT_MS;
    } else {
      process.env.AUTOLABOS_LITERATURE_QUERY_TIMEOUT_MS = originalQueryTimeout;
    }
  });

  it("falls back to heuristic constraint profile when the LLM hangs", async () => {
    process.env.AUTOLABOS_CONSTRAINT_PROFILE_TIMEOUT_MS = "5";

    const root = await mkdtemp(path.join(os.tmpdir(), "autolabos-constraint-timeout-"));
    const runId = "run-timeout-constraint";
    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    const contextPath = path.join(memoryDir, "run_context.json");
    await writeFile(contextPath, JSON.stringify({ version: 1, items: [] }), "utf8");

    const memory = new RunContextMemory(contextPath);
    const eventStream = new InMemoryEventStream();
    const run = buildRun(runId);

    const profile = await resolveConstraintProfile({
      run,
      runContextMemory: memory,
      llm: new HangingLLMClient(),
      eventStream,
      node: "collect_papers"
    });

    expect(profile.source).toBe("heuristic_fallback");
    const snapshot = JSON.parse(await readFile(contextPath, "utf8")) as {
      items: Array<{ key: string; value: { profile?: { source?: string } } }>;
    };
    expect(
      snapshot.items.find((entry) => entry.key === "constraints.profile")?.value?.profile?.source
    ).toBe("heuristic_fallback");
    expect(
      eventStream.history().some((event) => JSON.stringify(event).includes("constraint_profile_timeout_after_5ms"))
    ).toBe(true);
  });

  it("falls back from generated literature queries when the LLM hangs", async () => {
    process.env.AUTOLABOS_LITERATURE_QUERY_TIMEOUT_MS = "5";

    const root = await mkdtemp(path.join(os.tmpdir(), "autolabos-query-timeout-"));
    const runId = "run-timeout-query";
    const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
    await mkdir(memoryDir, { recursive: true });
    const contextPath = path.join(memoryDir, "run_context.json");
    await writeFile(contextPath, JSON.stringify({ version: 1, items: [] }), "utf8");

    const memory = new RunContextMemory(contextPath);
    const eventStream = new InMemoryEventStream();
    const run = buildRun(runId);

    const result = await resolveGeneratedLiteratureQueries({
      run,
      rawBrief: "# Research Brief\n\n## Topic\nLoRA rank dropout interaction\n",
      extractedBriefTopic: "LoRA rank dropout interaction",
      runContextMemory: memory,
      llm: new HangingLLMClient(),
      eventStream,
      node: "collect_papers"
    });

    expect(result).toBeUndefined();
    expect(
      eventStream.history().some((event) => JSON.stringify(event).includes("literature_query_timeout_after_5ms"))
    ).toBe(true);
  });
});
