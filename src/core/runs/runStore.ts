import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import { AppPaths } from "../../config.js";
import { GraphNodeId, NodeStatus, RunRecord, RunsFile, SlashContextRun } from "../../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import { nowIso } from "../../utils/time.js";
import {
  isRunsFileV1,
  isRunsFileV2,
  isRunsFileV3,
  migrateAnyRunsFileToV3
} from "./migrateRuns.js";
import { createDefaultGraphState } from "../stateGraph/defaults.js";

export interface CreateRunInput {
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
}

export class RunStore {
  constructor(private readonly paths: AppPaths) {}

  async listRuns(): Promise<RunRecord[]> {
    const runsFile = await this.readRunsFile();
    return [...runsFile.runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    const runs = await this.listRuns();
    return runs.find((run) => run.id === id);
  }

  async searchRuns(query: string): Promise<RunRecord[]> {
    const norm = query.trim().toLowerCase();
    const runs = await this.listRuns();
    if (!norm) {
      return runs;
    }

    return runs.filter((run) => {
      return run.id.toLowerCase().includes(norm) || run.title.toLowerCase().includes(norm);
    });
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const runsFile = await this.readRunsFile();
    const ts = nowIso();
    const id = randomUUID();
    const graph = createDefaultGraphState();

    const run: RunRecord = {
      version: 3,
      workflowVersion: 3,
      id,
      title: input.title,
      topic: input.topic,
      constraints: input.constraints,
      objectiveMetric: input.objectiveMetric,
      status: "pending",
      currentNode: graph.currentNode,
      latestSummary: undefined,
      nodeThreads: {},
      createdAt: ts,
      updatedAt: ts,
      graph,
      memoryRefs: {
        runContextPath: `.autolabos/runs/${id}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${id}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${id}/memory/episodes.jsonl`
      }
    };

    runsFile.runs.push(run);
    await this.writeRunsFile(runsFile);
    await this.ensureRunDirectory(run.id);
    return run;
  }

  async updateRun(run: RunRecord): Promise<void> {
    const runsFile = await this.readRunsFile();
    const idx = runsFile.runs.findIndex((x) => x.id === run.id);
    if (idx < 0) {
      throw new Error(`Run not found: ${run.id}`);
    }

    run.updatedAt = nowIso();
    runsFile.runs[idx] = run;
    await this.writeRunsFile(runsFile);
  }

  async markNodeStatus(
    runId: string,
    node: GraphNodeId,
    status: NodeStatus,
    note?: string
  ): Promise<RunRecord> {
    const run = await this.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    run.graph.nodeStates[node] = {
      status,
      updatedAt: nowIso(),
      note
    };
    run.currentNode = node;
    run.graph.currentNode = node;

    if (status === "running") {
      run.status = "running";
    } else if (status === "failed") {
      run.status = "failed";
    } else if (status === "needs_approval") {
      run.status = "paused";
    }

    await this.updateRun(run);
    return run;
  }

  async toSlashContextRuns(): Promise<SlashContextRun[]> {
    const runs = await this.listRuns();
    return runs.map((run) => ({
      id: run.id,
      title: run.title,
      currentNode: run.currentNode,
      status: run.status,
      updatedAt: run.updatedAt
    }));
  }

  private async readRunsFile(): Promise<RunsFile> {
    const raw = await readJsonFile<unknown>(this.paths.runsFile);

    if (isRunsFileV3(raw)) {
      const normalized = normalizeRunsV3(raw);
      if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
        await this.writeRunsFile(normalized);
      }
      return normalized;
    }

    if (!isRunsFileV1(raw) && !isRunsFileV2(raw)) {
      throw new Error("Invalid runs file format");
    }

    try {
      const migrated = migrateAnyRunsFileToV3(raw);
      await this.writeRunsFile(migrated);
      return migrated;
    } catch (error) {
      await this.backupBrokenMigrationSource(raw);
      throw error;
    }
  }

  private async writeRunsFile(runsFile: RunsFile): Promise<void> {
    await writeJsonFile(this.paths.runsFile, runsFile);
  }

  private async backupBrokenMigrationSource(raw: unknown): Promise<void> {
    const backupPath = `${this.paths.runsFile}.migration-failed-${Date.now()}.bak`;
    await fs.writeFile(backupPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }

  private async ensureRunDirectory(runId: string): Promise<void> {
    const runRoot = path.join(this.paths.runsDir, runId);
    await Promise.all([
      ensureDir(runRoot),
      ensureDir(path.join(runRoot, "checkpoints")),
      ensureDir(path.join(runRoot, "memory")),
      ensureDir(path.join(runRoot, "patches")),
      ensureDir(path.join(runRoot, "exec_logs")),
      ensureDir(path.join(runRoot, "figures")),
      ensureDir(path.join(runRoot, "paper"))
    ]);
  }
}

function normalizeRunsV3(runsFile: RunsFile): RunsFile {
  return {
    version: 3,
    runs: runsFile.runs.map((run) => ({
      ...run,
      version: 3,
      workflowVersion: 3,
      graph: {
        ...createDefaultGraphState(),
        ...run.graph,
        nodeStates: run.graph?.nodeStates ?? createDefaultGraphState().nodeStates,
        retryCounters: run.graph?.retryCounters ?? {},
        rollbackCounters: run.graph?.rollbackCounters ?? {},
        researchCycle: run.graph?.researchCycle ?? 0,
        transitionHistory: run.graph?.transitionHistory ?? []
      },
      nodeThreads: run.nodeThreads ?? {},
      memoryRefs: run.memoryRefs ?? {
        runContextPath: `.autolabos/runs/${run.id}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${run.id}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${run.id}/memory/episodes.jsonl`
      }
    }))
  };
}
