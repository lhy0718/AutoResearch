import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";

import { parseMetaHarnessResponse, runMetaHarness } from "../src/core/metaHarness/metaHarness.js";

const cleanupPaths: string[] = [];

describe("runMetaHarness", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true }))
    );
  });

  it("builds a proposer context directory with TASK.md and expected run files", async () => {
    const workspace = await createWorkspaceWithCompletedRun();
    const result = await runMetaHarness(
      {
        cwd: workspace,
        runs: 1,
        nodes: ["analyze_results", "review"],
        noApply: true
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(workspace)
      }
    );

    expect(result.contextDir).toContain(path.join("outputs", "meta-harness"));
    const task = await fs.readFile(path.join(result.contextDir, "TASK.md"), "utf8");
    expect(task).toContain("TARGET_FILE: node-prompts/<node>.md");
    await expect(fs.stat(path.join(result.contextDir, "runs", "run-1", "analyze_results_events.jsonl"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(result.contextDir, "runs", "run-1", "result_analysis.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(result.contextDir, "runs", "run-1", "decision.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(result.contextDir, "runs", "run-1", "paper_readiness.json"))).resolves.toBeTruthy();
  });

  it("returns the context dir without modifying files in --no-apply mode", async () => {
    const workspace = await createWorkspaceWithCompletedRun();
    const before = await fs.readFile(path.join(workspace, "node-prompts", "analyze_results.md"), "utf8");
    const result = await runMetaHarness(
      {
        cwd: workspace,
        runs: 1,
        nodes: ["analyze_results"],
        noApply: true
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(workspace)
      }
    );

    expect(result.lines[0]).toContain("Meta-harness context prepared");
    expect(await fs.readFile(path.join(workspace, "node-prompts", "analyze_results.md"), "utf8")).toBe(before);
  });

  it("prints diff only in dry-run mode without changing files", async () => {
    const workspace = await createWorkspaceWithCompletedRun();
    const targetFile = path.join(workspace, "node-prompts", "analyze_results.md");
    const before = await fs.readFile(targetFile, "utf8");
    const diff = [
      "TARGET_FILE: node-prompts/analyze_results.md",
      "--- a/node-prompts/analyze_results.md",
      "+++ b/node-prompts/analyze_results.md",
      "@@ -1 +1 @@",
      "-Prompt",
      "+Prompt improved"
    ].join("\n");

    const result = await runMetaHarness(
      {
        cwd: workspace,
        runs: 1,
        nodes: ["analyze_results"],
        dryRun: true
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(workspace),
        callLlm: vi.fn().mockResolvedValue(diff)
      }
    );

    expect(result.diffText).toContain("+++ b/node-prompts/analyze_results.md");
    expect(await fs.readFile(targetFile, "utf8")).toBe(before);
  });

  it("surfaces invalid LLM diff output without changing files", async () => {
    const workspace = await createWorkspaceWithCompletedRun();
    const targetFile = path.join(workspace, "node-prompts", "analyze_results.md");
    const before = await fs.readFile(targetFile, "utf8");

    const result = await runMetaHarness(
      {
        cwd: workspace,
        runs: 1,
        nodes: ["analyze_results"]
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(workspace),
        callLlm: vi.fn().mockResolvedValue("not a diff")
      }
    );

    expect(result.lines.join("\n")).toContain("did not match");
    expect(await fs.readFile(targetFile, "utf8")).toBe(before);
  });

  it("applies safely when the LLM diff parses and validation succeeds", async () => {
    const workspace = await createWorkspaceWithCompletedRun();
    const targetFile = path.join(workspace, "node-prompts", "analyze_results.md");
    const diff = [
      "TARGET_FILE: node-prompts/analyze_results.md",
      "--- a/node-prompts/analyze_results.md",
      "+++ b/node-prompts/analyze_results.md",
      "@@ -1 +1 @@",
      "-Prompt",
      "+Prompt improved"
    ].join("\n");
    const applyWithSafetyNet = vi.fn().mockResolvedValue({
      applied: true,
      targetFile,
      gitCommitBefore: "abc123",
      validationPassed: true,
      rolledBack: false,
      rollbackReason: null,
      auditLogPath: path.join(workspace, ".autolabos", "harness-apply-log.jsonl")
    });

    const result = await runMetaHarness(
      {
        cwd: workspace,
        runs: 1,
        nodes: ["analyze_results"]
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(workspace),
        callLlm: vi.fn().mockResolvedValue(diff),
        applyWithSafetyNet
      }
    );

    expect(applyWithSafetyNet).toHaveBeenCalledTimes(1);
    expect(result.lines.join("\n")).toContain("Applied safely and committed");
  });

  it("reports rollback when validation fails during apply", async () => {
    const workspace = await createWorkspaceWithCompletedRun();
    const diff = [
      "TARGET_FILE: node-prompts/analyze_results.md",
      "--- a/node-prompts/analyze_results.md",
      "+++ b/node-prompts/analyze_results.md",
      "@@ -1 +1 @@",
      "-Prompt",
      "+Prompt improved"
    ].join("\n");
    const applyWithSafetyNet = vi.fn().mockResolvedValue({
      applied: false,
      targetFile: path.join(workspace, "node-prompts", "analyze_results.md"),
      gitCommitBefore: "abc123",
      validationPassed: false,
      rolledBack: true,
      rollbackReason: "validate failed",
      auditLogPath: path.join(workspace, ".autolabos", "harness-apply-log.jsonl")
    });

    const result = await runMetaHarness(
      {
        cwd: workspace,
        runs: 1,
        nodes: ["analyze_results"]
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(workspace),
        callLlm: vi.fn().mockResolvedValue(diff),
        applyWithSafetyNet
      }
    );

    expect(result.lines.join("\n")).toContain("restored original file");
  });
});

describe("parseMetaHarnessResponse", () => {
  it("returns null when the response format is invalid", () => {
    expect(parseMetaHarnessResponse("hello")).toBeNull();
  });
});

async function createWorkspaceWithCompletedRun(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-meta-harness-"));
  cleanupPaths.push(workspace);
  const runRoot = path.join(workspace, ".autolabos", "runs", "run-1");
  await fs.mkdir(path.join(runRoot, "review"), { recursive: true });
  await fs.mkdir(path.join(runRoot, "paper"), { recursive: true });
  await fs.mkdir(path.join(workspace, "node-prompts"), { recursive: true });
  await fs.mkdir(path.join(workspace, "outputs", "eval-harness"), { recursive: true });
  await fs.writeFile(
    path.join(workspace, ".autolabos", "runs", "run-1", "events.jsonl"),
    [
      JSON.stringify(makeEvent("run-1", "analyze_results", "NODE_STARTED")),
      JSON.stringify(makeEvent("run-1", "review", "NODE_COMPLETED"))
    ].join("\n") + "\n",
    "utf8"
  );
  await fs.writeFile(path.join(runRoot, "result_analysis.json"), JSON.stringify({ summary: "analysis" }, null, 2), "utf8");
  await fs.writeFile(path.join(runRoot, "review", "decision.json"), JSON.stringify({ outcome: "revise" }, null, 2), "utf8");
  await fs.writeFile(
    path.join(runRoot, "paper", "paper_readiness.json"),
    JSON.stringify({ paper_ready: false, overall_score: 6.5 }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(workspace, "node-prompts", "analyze_results.md"), "Prompt\n", "utf8");
  await fs.writeFile(path.join(workspace, "node-prompts", "review.md"), "Review prompt\n", "utf8");
  await fs.writeFile(path.join(workspace, "outputs", "eval-harness", "history.jsonl"), "{\"timestamp\":\"2026-04-02T00:00:00.000Z\"}\n", "utf8");
  return workspace;
}

function fakeBootstrapRuntime(workspace: string) {
  return vi.fn().mockResolvedValue({
    configured: true,
    firstRunSetup: false,
    paths: { cwd: workspace },
    runtime: {
      paths: { cwd: workspace },
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: {
            model: "gpt-5.3-codex",
            reasoning_effort: "medium",
            fast_mode: false
          },
          openai: {
            model: "gpt-5.1",
            reasoning_effort: "medium"
          },
          ollama: {
            base_url: "http://127.0.0.1:11434"
          }
        }
      },
      codex: {},
      openAiTextClient: {},
      runStore: {
        listRuns: vi.fn().mockResolvedValue([
          {
            id: "run-1",
            title: "Run 1",
            topic: "Topic",
            objectiveMetric: "metric",
            constraints: [],
            status: "completed",
            currentNode: "write_paper",
            latestSummary: "done",
            nodeThreads: {},
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:00:00.000Z",
            graph: {} as never,
            memoryRefs: {
              runContextPath: ".autolabos/runs/run-1/memory/run_context.json",
              longTermPath: ".autolabos/runs/run-1/memory/long_term.jsonl",
              episodePath: ".autolabos/runs/run-1/memory/episodes.jsonl"
            }
          }
        ])
      }
    }
  });
}

function makeEvent(runId: string, node: "analyze_results" | "review", type: "NODE_STARTED" | "NODE_COMPLETED") {
  return {
    id: `evt-${node}`,
    type,
    timestamp: "2026-04-02T00:00:00.000Z",
    runId,
    node,
    payload: {}
  };
}
