import { describe, expect, it, vi } from "vitest";

import { InteractiveRunSupervisor } from "../src/core/runs/interactiveRunSupervisor.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const graph = createDefaultGraphState();
  const now = "2026-03-19T09:29:04.067Z";
  return {
    version: 3,
    workflowVersion: 3,
    id: "run-1",
    title: "Test Run",
    topic: "topic",
    constraints: [],
    objectiveMetric: "accuracy",
    status: "running",
    currentNode: "design_experiments",
    latestSummary: "node executed",
    nodeThreads: {},
    createdAt: now,
    updatedAt: now,
    graph,
    memoryRefs: {
      runContextPath: ".autolabos/runs/run-1/memory/run_context.json",
      longTermPath: ".autolabos/runs/run-1/memory/long_term.jsonl",
      episodePath: ".autolabos/runs/run-1/memory/episodes.jsonl"
    },
    ...overrides
  };
}

describe("InteractiveRunSupervisor", () => {
  it("continues into the next pending node before pausing", async () => {
    const first = makeRun({
      currentNode: "implement_experiments",
      graph: {
        ...createDefaultGraphState(),
        currentNode: "implement_experiments",
        checkpointSeq: 1089,
        nodeStates: {
          ...createDefaultGraphState().nodeStates,
          design_experiments: {
            status: "completed",
            updatedAt: "2026-03-19T09:29:03.976Z",
            note: "design approved"
          },
          implement_experiments: {
            status: "pending",
            updatedAt: "2026-03-19T09:29:04.067Z",
            note: "ready to run"
          }
        }
      }
    });
    const second = makeRun({
      currentNode: "implement_experiments",
      updatedAt: "2026-03-19T09:29:08.000Z",
      graph: {
        ...createDefaultGraphState(),
        currentNode: "implement_experiments",
        checkpointSeq: 1090,
        nodeStates: {
          ...createDefaultGraphState().nodeStates,
          design_experiments: {
            status: "completed",
            updatedAt: "2026-03-19T09:29:03.976Z",
            note: "design approved"
          },
          implement_experiments: {
            status: "needs_approval",
            updatedAt: "2026-03-19T09:29:08.000Z",
            note: "implementation ready for review"
          }
        }
      }
    });

    const orchestrator = {
      runCurrentAgentWithOptions: vi
        .fn()
        .mockResolvedValueOnce({
          run: first,
          result: { status: "success", summary: "advanced to implement_experiments" }
        })
        .mockResolvedValueOnce({
          run: second,
          result: { status: "success", summary: "implementation ready for review" }
        })
    };

    const supervisor = new InteractiveRunSupervisor("/tmp", {} as never, orchestrator as never);
    vi.spyOn(supervisor, "getActiveRequest").mockResolvedValue(undefined);

    const outcome = await supervisor.runUntilStop("run-1");

    expect(orchestrator.runCurrentAgentWithOptions).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("paused");
    if (outcome.status !== "paused") {
      throw new Error("expected paused outcome");
    }
    expect(outcome.run.currentNode).toBe("implement_experiments");
    expect(outcome.run.graph.nodeStates.implement_experiments.status).toBe("needs_approval");
  });

  it("pauses when the same pending node repeats without progress", async () => {
    const repeated = makeRun({
      currentNode: "implement_experiments",
      graph: {
        ...createDefaultGraphState(),
        currentNode: "implement_experiments",
        checkpointSeq: 1089,
        nodeStates: {
          ...createDefaultGraphState().nodeStates,
          design_experiments: {
            status: "completed",
            updatedAt: "2026-03-19T09:29:03.976Z",
            note: "design approved"
          },
          implement_experiments: {
            status: "pending",
            updatedAt: "2026-03-19T09:29:04.067Z",
            note: "ready to run"
          }
        }
      }
    });

    const orchestrator = {
      runCurrentAgentWithOptions: vi.fn().mockResolvedValue({
        run: repeated,
        result: { status: "success", summary: "advanced to implement_experiments" }
      })
    };

    const supervisor = new InteractiveRunSupervisor("/tmp", {} as never, orchestrator as never);
    vi.spyOn(supervisor, "getActiveRequest").mockResolvedValue(undefined);

    const outcome = await supervisor.runUntilStop("run-1");

    expect(orchestrator.runCurrentAgentWithOptions).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("paused");
    if (outcome.status !== "paused") {
      throw new Error("expected paused outcome");
    }
    expect(outcome.reason).toContain("without additional progress");
  });
});
