import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollectPapersNode, waitForAllCollectEnrichmentJobs, waitForCollectEnrichmentJob } from "../src/core/nodes/collectPapers.js";
import { InMemoryEventStream } from "../src/core/events.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();
const FIXED_TOPIC =
  "Investigate how small language models can improve reasoning quality under constrained inference budgets through adaptive or structured test-time strategies";
const RAW_BRIEF = `# Research Brief

## Topic

${FIXED_TOPIC}
`;

afterEach(async () => {
  await waitForAllCollectEnrichmentJobs();
  process.chdir(ORIGINAL_CWD);
});

async function readRunContextValue(root: string, runId: string, key: string): Promise<unknown> {
  const raw = await readFile(path.join(root, ".autolabos", "runs", runId, "memory", "run_context.json"), "utf8");
  const parsed = JSON.parse(raw) as { items?: Array<{ key?: string; value?: unknown }> };
  return parsed.items?.find((item) => item.key === key)?.value;
}

function buildRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Efficient Test-Time Reasoning for Small Language Models",
    topic: FIXED_TOPIC,
    constraints: [],
    objectiveMetric: "GSM8K accuracy",
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

async function seedRunContext(root: string, runId: string): Promise<void> {
  const memoryDir = path.join(root, ".autolabos", "runs", runId, "memory");
  await mkdir(memoryDir, { recursive: true });
  await writeFile(
    path.join(memoryDir, "run_context.json"),
    JSON.stringify({
      version: 1,
      items: [
        {
          key: "run_brief.raw",
          value: RAW_BRIEF,
          updatedAt: new Date().toISOString()
        },
        {
          key: "run_brief.extracted",
          value: {
            topic: FIXED_TOPIC
          },
          updatedAt: new Date().toISOString()
        }
      ]
    }),
    "utf8"
  );
}

describe("collectPapers deterministic topic fallback", () => {
  it("uses short phrase bundle queries from the brief topic when llm query generation fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-deterministic-fallback-"));
    process.chdir(root);

    const runId = "run-deterministic-fallback";
    const run = buildRun(runId);
    await seedRunContext(root, runId);

    const streamSearchPapers = vi.fn(async function* (request: { query: string }) {
      expect(request.query).toBe('+"small language models" +"test-time reasoning"');
      yield [
        {
          paperId: "paper-1",
          title: "Adaptive Test-Time Reasoning for Small Language Models",
          authors: ["Alice Kim"]
        }
      ];
    });

    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: {
        complete: vi.fn(async () => {
          throw new Error("LLM unavailable");
        })
      } as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers,
        getLastSearchDiagnostics: vi.fn(() => ({
          attemptCount: 1,
          lastStatus: 200,
          attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
        }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(streamSearchPapers).toHaveBeenCalledTimes(1);

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      query?: string;
      queryAttempts?: Array<{ query?: string; reason?: string }>;
    } | undefined;
    expect(lastResult?.query).toBe('+"small language models" +"test-time reasoning"');
    expect(lastResult?.queryAttempts?.[0]).toMatchObject({
      query: '+"small language models" +"test-time reasoning"',
      reason: "brief_topic"
    });

    await waitForCollectEnrichmentJob(runId);
  });

  it("retries with another short phrase bundle instead of collapsing to a generic keyword anchor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-collect-deterministic-retry-"));
    process.chdir(root);

    const runId = "run-deterministic-retry";
    const run = buildRun(runId);
    await seedRunContext(root, runId);

    const issuedQueries: string[] = [];
    const streamSearchPapers = vi.fn(async function* (request: { query: string }) {
      issuedQueries.push(request.query);
      if (request.query === '+"small language models" +"test-time reasoning"') {
        return;
      }
      expect(request.query).toBe('("adaptive reasoning" | "structured reasoning") +"small language models"');
      yield [
        {
          paperId: "paper-2",
          title: "Structured Reasoning Policies for Small Language Models",
          authors: ["Bob Lee"]
        }
      ];
    });

    const node = createCollectPapersNode({
      config: {
        papers: {
          max_results: 200
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: {
        complete: vi.fn(async () => {
          throw new Error("LLM unavailable");
        })
      } as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        streamSearchPapers,
        getLastSearchDiagnostics: vi.fn(() => ({
          attemptCount: 1,
          lastStatus: 200,
          attempts: [{ attempt: 1, ok: true, status: 200, endpoint: "search" }]
        }))
      } as any
    });

    const result = await node.execute({
      run,
      graph: run.graph
    });

    expect(result.status).toBe("success");
    expect(issuedQueries).toEqual([
      '+"small language models" +"test-time reasoning"',
      '("adaptive reasoning" | "structured reasoning") +"small language models"'
    ]);
    expect(issuedQueries).not.toContain("investigate how language models can improve");

    const lastResult = (await readRunContextValue(root, runId, "collect_papers.last_result")) as {
      query?: string;
      queryAttempts?: Array<{ query?: string; reason?: string }>;
    } | undefined;
    expect(lastResult?.query).toBe('("adaptive reasoning" | "structured reasoning") +"small language models"');
    expect(lastResult?.queryAttempts?.[1]).toMatchObject({
      query: '("adaptive reasoning" | "structured reasoning") +"small language models"',
      reason: "brief_topic"
    });

    await waitForCollectEnrichmentJob(runId);
  });
});
