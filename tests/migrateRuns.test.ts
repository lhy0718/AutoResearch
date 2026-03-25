import { describe, expect, it } from "vitest";

import { isGraphNodeId, migrateAnyRunsFileToV3, migrateRunsFileV1ToV2, migrateRunsFileV2ToV3 } from "../src/core/runs/migrateRuns.js";

describe("migrate runs to v3", () => {
  it("migrates v1 -> v2 -> v3 and maps execute stage to graph nodes", () => {
    const ts = new Date().toISOString();
    const v1 = {
      version: 1 as const,
      runs: [
        {
          id: "run-1",
          title: "Legacy run",
          topic: "agents",
          constraints: [],
          objectiveMetric: "f1",
          status: "paused" as const,
          currentStage: "execute" as const,
          latestSummary: "legacy summary",
          implementThreadId: "thread-xyz",
          createdAt: ts,
          updatedAt: ts,
          stages: {
            collect: { status: "completed" as const, updatedAt: ts },
            analyze: { status: "completed" as const, updatedAt: ts },
            hypothesize: { status: "completed" as const, updatedAt: ts },
            design: { status: "completed" as const, updatedAt: ts },
            implement: { status: "completed" as const, updatedAt: ts },
            execute: { status: "needs_approval" as const, updatedAt: ts },
            results: { status: "pending" as const, updatedAt: ts },
            write: { status: "pending" as const, updatedAt: ts }
          }
        }
      ]
    };

    const v2 = migrateRunsFileV1ToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.runs[0].currentAgent).toBe("experiment_runner");

    const v3 = migrateRunsFileV2ToV3(v2);
    expect(v3.version).toBe(3);
    expect(v3.runs[0].version).toBe(3);
    expect(v3.runs[0].workflowVersion).toBe(3);
    expect(v3.runs[0].currentNode).toBe("implement_experiments");
    expect(v3.runs[0].nodeThreads.implement_experiments).toBe("thread-xyz");
    expect(v3.runs[0].graph.nodeStates.implement_experiments.status).toBe("needs_approval");
  });

  it("migrateAnyRunsFileToV3 accepts v1/v2 and keeps graph node ids valid", () => {
    const ts = new Date().toISOString();
    const migrated = migrateAnyRunsFileToV3({
      version: 2,
      runs: [
        {
          version: 2,
          id: "run-2",
          title: "v2 run",
          topic: "topic",
          constraints: [],
          objectiveMetric: "acc",
          status: "running",
          currentAgent: "literature",
          latestSummary: "",
          agentThreads: {},
          createdAt: ts,
          updatedAt: ts,
          agents: {
            literature: { status: "running", updatedAt: ts },
            idea: { status: "pending", updatedAt: ts },
            hypothesis: { status: "pending", updatedAt: ts },
            experiment_designer: { status: "pending", updatedAt: ts },
            experiment_runner: { status: "pending", updatedAt: ts },
            result_analyzer: { status: "pending", updatedAt: ts },
            paper_writer: { status: "pending", updatedAt: ts }
          }
        }
      ]
    });

    expect(migrated.version).toBe(3);
    expect(isGraphNodeId(migrated.runs[0].currentNode)).toBe(true);
  });

  it("normalizes persisted usage summaries when accepting v3 inputs", () => {
    const ts = new Date().toISOString();
    const migrated = migrateAnyRunsFileToV3({
      version: 3,
      runs: [
        {
          version: 3,
          workflowVersion: 3,
          id: "run-usage",
          title: "usage run",
          topic: "topic",
          constraints: [],
          objectiveMetric: "acc",
          status: "running",
          currentNode: "collect_papers",
          latestSummary: "",
          nodeThreads: {},
          createdAt: ts,
          updatedAt: ts,
          usage: {
            totals: {
              costUsd: -1,
              toolCalls: 3,
              inputTokens: -5,
              outputTokens: 7,
              wallTimeMs: 12
            },
            byNode: {
              analyze_results: {
                costUsd: 1,
                toolCalls: -3,
                inputTokens: 9,
                outputTokens: -2,
                wallTimeMs: 8,
                executions: 2
              },
              bogus: {
                costUsd: 10,
                toolCalls: 10,
                inputTokens: 10,
                outputTokens: 10,
                wallTimeMs: 10,
                executions: 10
              }
            } as any,
            lastUpdatedAt: ""
          },
          graph: {
            currentNode: "collect_papers",
            nodeStates: {
              collect_papers: { status: "running", updatedAt: ts },
              analyze_papers: { status: "pending", updatedAt: ts },
              generate_hypotheses: { status: "pending", updatedAt: ts },
              design_experiments: { status: "pending", updatedAt: ts },
              implement_experiments: { status: "pending", updatedAt: ts },
              run_experiments: { status: "pending", updatedAt: ts },
              analyze_results: { status: "pending", updatedAt: ts },
              review: { status: "pending", updatedAt: ts },
              write_paper: { status: "pending", updatedAt: ts }
            },
            retryCounters: {},
            rollbackCounters: {},
            researchCycle: 0,
            transitionHistory: [],
            checkpointSeq: 0,
            retryPolicy: {
              maxAttemptsPerNode: 3,
              maxAutoRollbacksPerNode: 1
            }
          },
          memoryRefs: {
            runContextPath: ".autolabos/runs/run-usage/memory/run_context.json",
            longTermPath: ".autolabos/runs/run-usage/memory/long_term.jsonl",
            episodePath: ".autolabos/runs/run-usage/memory/episodes.jsonl"
          }
        }
      ]
    } as any);

    expect(migrated.runs[0].usage).toEqual({
      totals: {
        costUsd: 0,
        toolCalls: 3,
        inputTokens: 0,
        outputTokens: 7,
        wallTimeMs: 12
      },
      byNode: {
        analyze_results: {
          costUsd: 1,
          toolCalls: 0,
          inputTokens: 9,
          outputTokens: 0,
          wallTimeMs: 8,
          executions: 2,
          lastUpdatedAt: undefined
        }
      },
      lastUpdatedAt: undefined
    });
  });
});
