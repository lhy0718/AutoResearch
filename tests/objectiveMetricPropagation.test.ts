import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createAnalyzeResultsNode } from "../src/core/nodes/analyzeResults.js";
import { createRunExperimentsNode } from "../src/core/nodes/runExperiments.js";
import { createWritePaperNode } from "../src/core/nodes/writePaper.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Multi-Agent Collaboration",
    topic: "AI agent automation",
    constraints: [],
    objectiveMetric: "accuracy at least 0.9",
    status: "running",
    currentNode: "run_experiments",
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    graph: createDefaultGraphState(),
    memoryRefs: {
      runContextPath: `.autoresearch/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autoresearch/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autoresearch/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

describe("objective metric propagation", () => {
  it("evaluates objective metrics during run, analysis, and paper writing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autoresearch-objective-propagation-"));
    process.chdir(root);

    const runId = "run-objective-propagation";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autoresearch", "runs", runId);
    const memoryDir = path.join(runDir, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      path.join(memoryDir, "run_context.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            key: "implement_experiments.run_command",
            value: "python3 experiment.py",
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.cwd",
            value: root,
            updatedAt: new Date().toISOString()
          },
          {
            key: "implement_experiments.metrics_path",
            value: `.autoresearch/runs/${runId}/metrics.json`,
            updatedAt: new Date().toISOString()
          }
        ]
      }),
      "utf8"
    );

    const eventStream = new InMemoryEventStream();
    const aci = {
      runCommand: async () => {
        await writeFile(
          path.join(runDir, "metrics.json"),
          JSON.stringify({ accuracy: 0.91, f1: 0.88 }, null, 2),
          "utf8"
        );
        return {
          status: "ok" as const,
          stdout: "done",
          stderr: "",
          exit_code: 0,
          duration_ms: 10
        };
      },
      runTests: async () => ({
        status: "ok" as const,
        stdout: "",
        stderr: "",
        exit_code: 0,
        duration_ms: 1
      })
    };

    const deps = {
      config: {} as any,
      runStore: {} as any,
      eventStream,
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: aci as any,
      semanticScholar: {} as any
    };

    const runNode = createRunExperimentsNode(deps);
    const analyzeNode = createAnalyzeResultsNode(deps);
    const writeNode = createWritePaperNode(deps);

    const runResult = await runNode.execute({ run, graph: run.graph });
    expect(runResult.status).toBe("success");
    expect(runResult.summary).toContain("Objective metric met");

    const evaluationRaw = await readFile(path.join(runDir, "objective_evaluation.json"), "utf8");
    expect(evaluationRaw).toContain('"status": "met"');
    expect(evaluationRaw).toContain('"matchedMetricKey": "accuracy"');

    const analyzeResult = await analyzeNode.execute({ run, graph: run.graph });
    expect(analyzeResult.status).toBe("success");
    expect(analyzeResult.summary).toContain("Objective metric met");

    const analysisRaw = await readFile(path.join(runDir, "result_analysis.json"), "utf8");
    expect(analysisRaw).toContain('"status": "met"');
    expect(analysisRaw).toContain('"mean_score": 0.895');

    const writeResult = await writeNode.execute({ run, graph: run.graph });
    expect(writeResult.status).toBe("success");

    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).toContain("Primary objective: accuracy at least 0.9.");
    expect(tex).toContain("Objective evaluation: Objective metric met: accuracy=0.91 >= 0.9.");
    expect(tex).toContain("Result emphasis:");
  });
});
