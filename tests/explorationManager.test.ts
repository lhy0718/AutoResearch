import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { createDesignExperimentsNode } from "../src/core/nodes/designExperiments.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { appendExplorationFailure } from "../src/core/exploration/failureMemoryIntegration.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { DefaultNodeRegistry } from "../src/core/stateGraph/nodeRegistry.js";
import { loadExplorationConfig } from "../src/core/exploration/explorationConfig.js";
import {
  addNode,
  initResearchTree,
  loadResearchTree,
  saveResearchTree
} from "../src/core/exploration/researchTree.js";
import { ExplorationManager } from "../src/core/exploration/explorationManager.js";
import type { ExplorationConfig } from "../src/core/exploration/explorationConfig.js";
import type { ResearchTreeNode } from "../src/core/exploration/types.js";
import type { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.restoreAllMocks();
});

function makeRun(root: string, runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Exploration Manager",
    topic: "AI agent automation",
    constraints: [],
    objectiveMetric: "accuracy",
    status: "running",
    currentNode: "design_experiments",
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

function makeTreeNode(patch: Partial<ResearchTreeNode> = {}): ResearchTreeNode {
  const now = new Date().toISOString();
  return {
    node_id: patch.node_id ?? "node-1",
    parent_id: patch.parent_id ?? null,
    root_id: patch.root_id ?? (patch.node_id ?? "node-1"),
    stage: patch.stage ?? "baseline_hardening",
    depth: patch.depth ?? 0,
    debug_depth: patch.debug_depth ?? 0,
    branch_kind: patch.branch_kind ?? "baseline",
    change_set: patch.change_set ?? {},
    hypothesis_link: patch.hypothesis_link ?? null,
    expected_effect: patch.expected_effect ?? "Improve objective.",
    actual_result_summary: patch.actual_result_summary ?? null,
    objective_metrics: patch.objective_metrics ?? {},
    budget_cost: patch.budget_cost ?? 0,
    reproducibility_status: patch.reproducibility_status ?? "not_tested",
    failure_fingerprint: patch.failure_fingerprint ?? null,
    evidence_manifest: patch.evidence_manifest ?? null,
    promotion_decision: patch.promotion_decision ?? null,
    blocked_reasons: patch.blocked_reasons ?? [],
    status: patch.status ?? "pending",
    created_at: patch.created_at ?? now,
    updated_at: patch.updated_at ?? now
  };
}

function makeExplorationConfig(overrides: Partial<ExplorationConfig> = {}): ExplorationConfig {
  return {
    ...loadExplorationConfig(),
    enabled: true,
    ...overrides
  };
}

async function seedDesignInputs(root: string, runId: string): Promise<void> {
  const runDir = path.join(root, ".autolabos", "runs", runId);
  await mkdir(path.join(runDir, "memory"), { recursive: true });
  await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
  await writeFile(
    path.join(runDir, "hypotheses.jsonl"),
    `${JSON.stringify({ hypothesis_id: "h_1", text: "Structured coordination improves reproducibility." })}\n`,
    "utf8"
  );
}

describe("exploration manager", () => {
  it("registers the figure_audit node without changing registry construction behavior", () => {
    const registry = new DefaultNodeRegistry({} as any);
    // figure_audit is the one intentional post-analysis checkpoint node; exploration adds no others.
    expect(registry.list()).toHaveLength(10);
    expect(registry.list().some((handler) => handler.id === "figure_audit")).toBe(true);
  });

  it("round-trips a persisted research tree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-research-tree-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-tree");
    const initial = initResearchTree("run-tree", runDir);
    const tree = addNode(initial, makeTreeNode());

    saveResearchTree(runDir, tree);
    const loaded = loadResearchTree(runDir);

    expect(loaded).toEqual(tree);
  });

  it("returns false when a parent exceeds max_children_per_node", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-children-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-children");
    const manager = new ExplorationManager(
      "run-children",
      runDir,
      makeExplorationConfig({ max_children_per_node: 1 })
    );
    await manager.initialize();

    const rootNode = manager.proposeNode({
      parentId: null,
      stage: "baseline_hardening",
      branchKind: "baseline",
      changeSet: { model: "base-model" },
      hypothesisLink: null,
      expectedEffect: "Baseline branch."
    });
    expect(rootNode).not.toBeNull();

    const child = manager.proposeNode({
      parentId: rootNode!.node_id,
      stage: "baseline_hardening",
      branchKind: "main",
      changeSet: { dataset: "slice-a" },
      hypothesisLink: null,
      expectedEffect: "First child."
    });
    expect(child).not.toBeNull();

    expect(manager.canAddNode(rootNode!.node_id)).toBe(false);
  });

  it("returns null when the proposed node violates the single-change policy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-single-change-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-single-change");
    const manager = new ExplorationManager("run-single-change", runDir, makeExplorationConfig());
    await manager.initialize();

    const proposed = manager.proposeNode({
      parentId: null,
      stage: "baseline_hardening",
      branchKind: "main",
      changeSet: { model: "model-a", dataset: "dataset-a" },
      hypothesisLink: null,
      expectedEffect: "Should be blocked."
    });

    expect(proposed).toBeNull();
  });

  it("blocks proposing a child branch when the parent failure fingerprint is blocked by exploration memory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-blocked-subtree-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-blocked-subtree");
    const manager = new ExplorationManager("run-blocked-subtree", runDir, makeExplorationConfig());
    await manager.initialize();

    const parent = manager.proposeNode({
      parentId: null,
      stage: "baseline_hardening",
      branchKind: "baseline",
      changeSet: { hyperparameter: "seed=1" },
      hypothesisLink: "hypothesis-1",
      expectedEffect: "Establish baseline branch."
    });
    expect(parent).not.toBeNull();

    manager.completeNode(parent!.node_id, {
      actualResultSummary: "Repeated failure.",
      objectiveMetrics: { accuracy: 0.4 },
      evidenceManifest: {
        branch_id: parent!.node_id,
        executed_at: new Date().toISOString(),
        artifact_paths: ["analysis/report.json"],
        metrics_source: "metrics.json",
        is_executed: true,
        is_reproducible: false,
        reproduction_runs: 0
      },
      failureFingerprint: "fp.blocked.same"
    });

    appendExplorationFailure(path.join(runDir, "failure_memory.jsonl"), {
      failure_fingerprint: "fp.blocked.same",
      failure_class: "evaluation",
      retry_policy: "block",
      equivalent_to: null,
      affects_stage: ["main_agenda"],
      first_seen_at: new Date().toISOString(),
      occurrence_count: 1
    });

    const child = manager.proposeNode({
      parentId: parent!.node_id,
      stage: "main_agenda",
      branchKind: "main",
      changeSet: { model: "candidate-model" },
      hypothesisLink: "hypothesis-1",
      expectedEffect: "Should be blocked by repeated failure memory."
    });

    expect(child).toBeNull();
  });

  it("persists and restores resume context", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-resume-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-resume");
    const manager = new ExplorationManager("run-resume", runDir, makeExplorationConfig());
    await manager.initialize();

    manager.recordStageDecision({
      stage: "main_agenda",
      decision: "proceed",
      reason: "Baseline hardened.",
      decided_at: new Date().toISOString()
    });

    const before = manager.resumeContext();

    const reloaded = new ExplorationManager("run-resume", runDir, makeExplorationConfig());
    await reloaded.initialize();
    const after = reloaded.resumeContext();

    expect(after).toEqual(before);
  });

  it("creates tree and manager state artifacts when exploration is enabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-enabled-"));
    const runDir = path.join(root, ".autolabos", "runs", "run-enabled");
    const manager = new ExplorationManager("run-enabled", runDir, makeExplorationConfig());

    await manager.initialize();

    await expect(stat(path.join(runDir, "experiment_tree", "tree.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(runDir, "experiment_tree", "manager_state.json"))).resolves.toBeTruthy();
  });

  it("keeps design_experiments outputs unchanged when exploration is disabled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-disabled-"));
    process.chdir(root);

    const runId = "run-exploration-disabled";
    const run = makeRun(root, runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await seedDesignInputs(root, runId);

    const node = createDesignExperimentsNode({
      config: {} as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      experimentLlm: {} as any,
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any,
      responsesPdfAnalysis: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    await expect(readFile(path.join(runDir, "experiment_plan.yaml"), "utf8")).resolves.toContain("selected_design:");
    await expect(readFile(path.join(runDir, "experiment_contract.json"), "utf8")).resolves.toContain("results_table_schema");
    await expect(stat(path.join(runDir, "experiment_tree", "tree.json"))).rejects.toThrow();
    await expect(stat(path.join(runDir, "experiment_tree", "manager_state.json"))).rejects.toThrow();
  });
});
