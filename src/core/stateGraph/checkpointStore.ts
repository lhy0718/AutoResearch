import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeId, RunRecord } from "../../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import { AppPaths } from "../../config.js";
import { CheckpointPhase, CheckpointRecord } from "./types.js";

export class CheckpointStore {
  constructor(private readonly paths: AppPaths) {}

  async save(
    run: RunRecord,
    phase: CheckpointPhase,
    reason?: string,
    checkpointNode?: GraphNodeId
  ): Promise<CheckpointRecord> {
    const seq = run.graph.checkpointSeq + 1;
    run.graph.checkpointSeq = seq;
    const node = checkpointNode || run.currentNode;

    const record: CheckpointRecord = {
      seq,
      runId: run.id,
      node,
      phase,
      reason,
      createdAt: new Date().toISOString(),
      runSnapshot: structuredClone(run)
    };

    const dir = this.runCheckpointDir(run.id);
    await ensureDir(dir);

    const checkpointFile = path.join(dir, `${String(seq).padStart(4, "0")}-${node}-${phase}.json`);
    await writeJsonFile(checkpointFile, record);

    const latestFile = path.join(dir, "latest.json");
    await writeJsonFile(latestFile, {
      seq: record.seq,
      node: record.node,
      phase: record.phase,
      createdAt: record.createdAt,
      reason: record.reason,
      file: path.basename(checkpointFile)
    });

    return record;
  }

  async latest(runId: string): Promise<CheckpointRecord | undefined> {
    const dir = this.runCheckpointDir(runId);
    const latestFile = path.join(dir, "latest.json");

    try {
      const latest = await readJsonFile<{ file: string }>(latestFile);
      const recordPath = path.join(dir, latest.file);
      return await readJsonFile<CheckpointRecord>(recordPath);
    } catch {
      return undefined;
    }
  }

  async list(runId: string): Promise<CheckpointRecord[]> {
    const dir = this.runCheckpointDir(runId);
    try {
      const files = await fs.readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "latest.json").sort();
      const records: CheckpointRecord[] = [];
      for (const file of jsonFiles) {
        const item = await readJsonFile<CheckpointRecord>(path.join(dir, file));
        records.push(item);
      }
      return records;
    } catch {
      return [];
    }
  }

  async load(runId: string, checkpointSeq?: number): Promise<CheckpointRecord | undefined> {
    if (checkpointSeq == null) {
      return this.latest(runId);
    }

    const records = await this.list(runId);
    return records.find((x) => x.seq === checkpointSeq);
  }

  runCheckpointDir(runId: string): string {
    return path.join(this.paths.runsDir, runId, "checkpoints");
  }
}
