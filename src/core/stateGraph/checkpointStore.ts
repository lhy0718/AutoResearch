import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeId, RunRecord } from "../../types.js";
import { ensureDir, normalizeFsPath, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import { AppPaths } from "../../config.js";
import { IndexedRunCheckpoint, RunIndexDatabase } from "../runs/runIndexDatabase.js";
import { CheckpointPhase, CheckpointRecord } from "./types.js";

export class CheckpointStore {
  private readonly runIndex: RunIndexDatabase;

  constructor(private readonly paths: AppPaths) {
    this.runIndex = new RunIndexDatabase(paths.runsDbFile);
  }

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

    this.runIndex.upsertCheckpoint(toIndexedCheckpoint(record, checkpointFile));

    return record;
  }

  async latest(runId: string): Promise<CheckpointRecord | undefined> {
    const indexed = this.runIndex.getLatestCheckpoint(runId);
    if (indexed) {
      const record = await this.readCheckpointRecord(indexed.filePath);
      if (record) {
        return record;
      }
    }

    const fromPointer = await this.readLatestCheckpointFromPointer(runId);
    if (fromPointer) {
      this.runIndex.upsertCheckpoint(
        toIndexedCheckpoint(
          fromPointer,
          path.join(this.runCheckpointDir(runId), `${String(fromPointer.seq).padStart(4, "0")}-${fromPointer.node}-${fromPointer.phase}.json`)
        )
      );
      return fromPointer;
    }

    const records = await this.readCheckpointRecordsFromFiles(runId);
    return records[records.length - 1];
  }

  async list(runId: string): Promise<CheckpointRecord[]> {
    const indexed = this.runIndex.listRunCheckpoints(runId);
    if (indexed.length > 0) {
      const records = await this.readIndexedCheckpointRecords(indexed);
      if (records) {
        return records;
      }
    }

    return this.readCheckpointRecordsFromFiles(runId);
  }

  async load(runId: string, checkpointSeq?: number): Promise<CheckpointRecord | undefined> {
    if (checkpointSeq == null) {
      return this.latest(runId);
    }

    const indexed = this.runIndex.getCheckpoint(runId, checkpointSeq);
    if (indexed) {
      const record = await this.readCheckpointRecord(indexed.filePath);
      if (record) {
        return record;
      }
    }

    const records = await this.list(runId);
    return records.find((x) => x.seq === checkpointSeq);
  }

  runCheckpointDir(runId: string): string {
    return path.join(this.paths.runsDir, runId, "checkpoints");
  }

  private async readLatestCheckpointFromPointer(runId: string): Promise<CheckpointRecord | undefined> {
    const dir = this.runCheckpointDir(runId);
    const latestFile = path.join(dir, "latest.json");

    try {
      const latest = await readJsonFile<{ file: string }>(latestFile);
      const latestEntry = typeof latest.file === "string" ? latest.file : "";
      if (!latestEntry) {
        return undefined;
      }
      return await readJsonFile<CheckpointRecord>(path.join(dir, latestEntry));
    } catch {
      return undefined;
    }
  }

  private async readIndexedCheckpointRecords(indexed: IndexedRunCheckpoint[]): Promise<CheckpointRecord[] | undefined> {
    const records: CheckpointRecord[] = [];
    for (const item of indexed) {
      const record = await this.readCheckpointRecord(item.filePath);
      if (!record) {
        return undefined;
      }
      records.push(record);
    }
    return records;
  }

  private async readCheckpointRecordsFromFiles(runId: string): Promise<CheckpointRecord[]> {
    const dir = this.runCheckpointDir(runId);
    try {
      const files = (await fs.readdir(normalizeFsPath(dir)))
        .filter((file) => file.endsWith(".json") && file !== "latest.json")
        .sort();
      const records: CheckpointRecord[] = [];
      const indexed: IndexedRunCheckpoint[] = [];
      for (const file of files) {
        const filePath = path.join(dir, file);
        const item = await this.readCheckpointRecord(filePath);
        if (!item) {
          continue;
        }
        records.push(item);
        indexed.push(toIndexedCheckpoint(item, filePath));
      }
      this.runIndex.replaceRunCheckpoints(runId, indexed);
      return records;
    } catch {
      return [];
    }
  }

  private async readCheckpointRecord(filePath: string): Promise<CheckpointRecord | undefined> {
    try {
      return await readJsonFile<CheckpointRecord>(filePath);
    } catch {
      return undefined;
    }
  }
}

function toIndexedCheckpoint(record: CheckpointRecord, filePath: string): IndexedRunCheckpoint {
  return {
    runId: record.runId,
    checkpointSeq: record.seq,
    nodeId: record.node,
    phase: record.phase,
    createdAt: record.createdAt,
    reason: record.reason,
    filePath,
    snapshotUpdatedAt: record.runSnapshot.updatedAt
  };
}
