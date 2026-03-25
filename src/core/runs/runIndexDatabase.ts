import path from "node:path";
import { mkdirSync } from "node:fs";

import Database from "better-sqlite3";

import { RunRecord, RunUsageSummary } from "../../types.js";
import { normalizeFsPath } from "../../utils/fs.js";

const RUNS_JSON_MTIME_META_KEY = "runs_json_mtime_ms";

interface RunIndexRow {
  id: string;
  id_lower: string;
  title: string;
  title_lower: string;
  status: string;
  current_node: string;
  created_at: string;
  updated_at: string;
  run_json: string;
}

interface RunUsageSummaryRow {
  run_id: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tool_calls: number;
  total_cost_usd: number;
  total_wall_time_ms: number;
  last_accounted_at?: string | null;
  usage_json: string;
}

interface RunCheckpointIndexRow {
  run_id: string;
  checkpoint_seq: number;
  node_id: string;
  phase: string;
  created_at: string;
  reason?: string | null;
  file_path: string;
  snapshot_updated_at?: string | null;
}

interface RunEventIndexRow {
  run_id: string;
  event_seq: number;
  event_id: string;
  event_type: string;
  node_id?: string | null;
  created_at: string;
  file_path: string;
  event_json: string;
}

interface RunArtifactIndexRow {
  run_id: string;
  artifact_type: string;
  file_path: string;
  updated_at: string;
  metadata_json?: string | null;
}

export interface IndexedRunUsageSummary {
  runId: string;
  usage: RunUsageSummary;
}

export interface IndexedRunCheckpoint {
  runId: string;
  checkpointSeq: number;
  nodeId: string;
  phase: string;
  createdAt: string;
  reason?: string;
  filePath: string;
  snapshotUpdatedAt?: string;
}

export interface IndexedRunEvent {
  runId: string;
  eventSeq: number;
  eventId: string;
  eventType: string;
  nodeId?: string;
  createdAt: string;
  filePath: string;
  eventJson: string;
}

export interface IndexedRunArtifact {
  runId: string;
  artifactType: string;
  filePath: string;
  updatedAt: string;
  metadataJson?: string;
}

export function buildRunsDbFile(runsDir: string): string {
  return path.join(runsDir, "runs.sqlite");
}

export function toRunArtifactType(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.[^.]+$/u, "")
    .replace(/[^a-z0-9]+/giu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
}

export class RunIndexDatabase {
  private readonly db: Database.Database;
  private readonly selectAllRunsStatement: Database.Statement<[], RunIndexRow>;
  private readonly selectRunStatement: Database.Statement<[string], RunIndexRow>;
  private readonly searchRunsStatement: Database.Statement<[string, string], RunIndexRow>;
  private readonly upsertRunStatement: Database.Statement<
    [string, string, string, string, string, string, string, string, string],
    Database.RunResult
  >;
  private readonly clearRunsStatement: Database.Statement<[], Database.RunResult>;
  private readonly countRunsStatement: Database.Statement<[], { count: number }>;
  private readonly selectMetaStatement: Database.Statement<[string], { value: string }>;
  private readonly upsertMetaStatement: Database.Statement<[string, string], Database.RunResult>;
  private readonly selectRunUsageStatement: Database.Statement<[string], RunUsageSummaryRow>;
  private readonly upsertRunUsageStatement: Database.Statement<
    [string, number, number, number, number, number, string | null, string],
    Database.RunResult
  >;
  private readonly deleteRunUsageStatement: Database.Statement<[string], Database.RunResult>;
  private readonly clearRunUsageStatement: Database.Statement<[], Database.RunResult>;
  private readonly selectLatestCheckpointStatement: Database.Statement<[string], RunCheckpointIndexRow>;
  private readonly selectRunCheckpointsStatement: Database.Statement<[string], RunCheckpointIndexRow>;
  private readonly selectCheckpointStatement: Database.Statement<[string, number], RunCheckpointIndexRow>;
  private readonly upsertCheckpointStatement: Database.Statement<
    [string, number, string, string, string, string | null, string, string | null],
    Database.RunResult
  >;
  private readonly clearRunCheckpointsStatement: Database.Statement<[string], Database.RunResult>;
  private readonly selectNextEventSeqStatement: Database.Statement<[string], { next_seq: number }>;
  private readonly selectRunEventsStatement: Database.Statement<[string, number], RunEventIndexRow>;
  private readonly insertRunEventStatement: Database.Statement<
    [string, number, string, string, string | null, string, string, string],
    Database.RunResult
  >;
  private readonly clearRunEventsStatement: Database.Statement<[string], Database.RunResult>;
  private readonly selectArtifactByPathStatement: Database.Statement<[string, string], RunArtifactIndexRow>;
  private readonly selectRunArtifactsStatement: Database.Statement<[string], RunArtifactIndexRow>;
  private readonly upsertRunArtifactStatement: Database.Statement<
    [string, string, string, string, string | null],
    Database.RunResult
  >;
  private readonly clearRunArtifactsStatement: Database.Statement<[string], Database.RunResult>;
  private readonly replaceAllRunsTransaction: (runs: RunRecord[]) => void;
  private readonly upsertRunsTransaction: (runs: RunRecord[]) => void;
  private readonly replaceRunCheckpointsTransaction: (runId: string, checkpoints: IndexedRunCheckpoint[]) => void;
  private readonly replaceRunEventsTransaction: (runId: string, events: IndexedRunEvent[]) => void;
  private readonly replaceRunArtifactsTransaction: (runId: string, artifacts: IndexedRunArtifact[]) => void;

  constructor(filePath: string) {
    const normalizedFilePath = normalizeFsPath(filePath);
    mkdirSync(path.dirname(normalizedFilePath), { recursive: true });
    this.db = new Database(normalizedFilePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_index (
        id TEXT PRIMARY KEY,
        id_lower TEXT NOT NULL,
        title TEXT NOT NULL,
        title_lower TEXT NOT NULL,
        status TEXT NOT NULL,
        current_node TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        run_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS run_index_updated_at_idx ON run_index(updated_at DESC);
      CREATE INDEX IF NOT EXISTS run_index_title_lower_idx ON run_index(title_lower);

      CREATE TABLE IF NOT EXISTS run_index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_usage_summary (
        run_id TEXT PRIMARY KEY,
        total_input_tokens REAL NOT NULL DEFAULT 0,
        total_output_tokens REAL NOT NULL DEFAULT 0,
        total_tool_calls REAL NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        total_wall_time_ms REAL NOT NULL DEFAULT 0,
        last_accounted_at TEXT,
        usage_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_checkpoint_index (
        run_id TEXT NOT NULL,
        checkpoint_seq INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reason TEXT,
        file_path TEXT NOT NULL,
        snapshot_updated_at TEXT,
        PRIMARY KEY (run_id, checkpoint_seq)
      );
      CREATE INDEX IF NOT EXISTS run_checkpoint_index_latest_idx
        ON run_checkpoint_index(run_id, checkpoint_seq DESC);

      CREATE TABLE IF NOT EXISTS run_event_index (
        run_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        node_id TEXT,
        created_at TEXT NOT NULL,
        file_path TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, event_seq)
      );
      CREATE INDEX IF NOT EXISTS run_event_index_latest_idx
        ON run_event_index(run_id, event_seq DESC, created_at DESC);

      CREATE TABLE IF NOT EXISTS run_artifact_index (
        run_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT,
        PRIMARY KEY (run_id, artifact_type, file_path)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS run_artifact_index_run_path_idx
        ON run_artifact_index(run_id, file_path);
      CREATE INDEX IF NOT EXISTS run_artifact_index_run_updated_idx
        ON run_artifact_index(run_id, updated_at DESC);
    `);

    this.selectAllRunsStatement = this.db.prepare(`
      SELECT id, id_lower, title, title_lower, status, current_node, created_at, updated_at, run_json
      FROM run_index
      ORDER BY updated_at DESC, id ASC
    `);
    this.selectRunStatement = this.db.prepare(`
      SELECT id, id_lower, title, title_lower, status, current_node, created_at, updated_at, run_json
      FROM run_index
      WHERE id = ?
    `);
    this.searchRunsStatement = this.db.prepare(`
      SELECT id, id_lower, title, title_lower, status, current_node, created_at, updated_at, run_json
      FROM run_index
      WHERE id_lower LIKE ? ESCAPE '\\' OR title_lower LIKE ? ESCAPE '\\'
      ORDER BY updated_at DESC, id ASC
    `);
    this.upsertRunStatement = this.db.prepare(`
      INSERT INTO run_index (
        id,
        id_lower,
        title,
        title_lower,
        status,
        current_node,
        created_at,
        updated_at,
        run_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        id_lower = excluded.id_lower,
        title = excluded.title,
        title_lower = excluded.title_lower,
        status = excluded.status,
        current_node = excluded.current_node,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        run_json = excluded.run_json
    `);
    this.clearRunsStatement = this.db.prepare("DELETE FROM run_index");
    this.countRunsStatement = this.db.prepare("SELECT COUNT(*) AS count FROM run_index");
    this.selectMetaStatement = this.db.prepare("SELECT value FROM run_index_meta WHERE key = ?");
    this.upsertMetaStatement = this.db.prepare(`
      INSERT INTO run_index_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    this.selectRunUsageStatement = this.db.prepare(`
      SELECT
        run_id,
        total_input_tokens,
        total_output_tokens,
        total_tool_calls,
        total_cost_usd,
        total_wall_time_ms,
        last_accounted_at,
        usage_json
      FROM run_usage_summary
      WHERE run_id = ?
    `);
    this.upsertRunUsageStatement = this.db.prepare(`
      INSERT INTO run_usage_summary (
        run_id,
        total_input_tokens,
        total_output_tokens,
        total_tool_calls,
        total_cost_usd,
        total_wall_time_ms,
        last_accounted_at,
        usage_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        total_input_tokens = excluded.total_input_tokens,
        total_output_tokens = excluded.total_output_tokens,
        total_tool_calls = excluded.total_tool_calls,
        total_cost_usd = excluded.total_cost_usd,
        total_wall_time_ms = excluded.total_wall_time_ms,
        last_accounted_at = excluded.last_accounted_at,
        usage_json = excluded.usage_json
    `);
    this.deleteRunUsageStatement = this.db.prepare("DELETE FROM run_usage_summary WHERE run_id = ?");
    this.clearRunUsageStatement = this.db.prepare("DELETE FROM run_usage_summary");
    this.selectLatestCheckpointStatement = this.db.prepare(`
      SELECT
        run_id,
        checkpoint_seq,
        node_id,
        phase,
        created_at,
        reason,
        file_path,
        snapshot_updated_at
      FROM run_checkpoint_index
      WHERE run_id = ?
      ORDER BY checkpoint_seq DESC
      LIMIT 1
    `);
    this.selectRunCheckpointsStatement = this.db.prepare(`
      SELECT
        run_id,
        checkpoint_seq,
        node_id,
        phase,
        created_at,
        reason,
        file_path,
        snapshot_updated_at
      FROM run_checkpoint_index
      WHERE run_id = ?
      ORDER BY checkpoint_seq ASC
    `);
    this.selectCheckpointStatement = this.db.prepare(`
      SELECT
        run_id,
        checkpoint_seq,
        node_id,
        phase,
        created_at,
        reason,
        file_path,
        snapshot_updated_at
      FROM run_checkpoint_index
      WHERE run_id = ? AND checkpoint_seq = ?
    `);
    this.upsertCheckpointStatement = this.db.prepare(`
      INSERT INTO run_checkpoint_index (
        run_id,
        checkpoint_seq,
        node_id,
        phase,
        created_at,
        reason,
        file_path,
        snapshot_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, checkpoint_seq) DO UPDATE SET
        node_id = excluded.node_id,
        phase = excluded.phase,
        created_at = excluded.created_at,
        reason = excluded.reason,
        file_path = excluded.file_path,
        snapshot_updated_at = excluded.snapshot_updated_at
    `);
    this.clearRunCheckpointsStatement = this.db.prepare("DELETE FROM run_checkpoint_index WHERE run_id = ?");
    this.selectNextEventSeqStatement = this.db.prepare(`
      SELECT COALESCE(MAX(event_seq) + 1, 1) AS next_seq
      FROM run_event_index
      WHERE run_id = ?
    `);
    this.selectRunEventsStatement = this.db.prepare(`
      SELECT
        run_id,
        event_seq,
        event_id,
        event_type,
        node_id,
        created_at,
        file_path,
        event_json
      FROM run_event_index
      WHERE run_id = ?
      ORDER BY event_seq DESC
      LIMIT ?
    `);
    this.insertRunEventStatement = this.db.prepare(`
      INSERT INTO run_event_index (
        run_id,
        event_seq,
        event_id,
        event_type,
        node_id,
        created_at,
        file_path,
        event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, event_seq) DO UPDATE SET
        event_id = excluded.event_id,
        event_type = excluded.event_type,
        node_id = excluded.node_id,
        created_at = excluded.created_at,
        file_path = excluded.file_path,
        event_json = excluded.event_json
    `);
    this.clearRunEventsStatement = this.db.prepare("DELETE FROM run_event_index WHERE run_id = ?");
    this.selectArtifactByPathStatement = this.db.prepare(`
      SELECT run_id, artifact_type, file_path, updated_at, metadata_json
      FROM run_artifact_index
      WHERE run_id = ? AND file_path = ?
    `);
    this.selectRunArtifactsStatement = this.db.prepare(`
      SELECT run_id, artifact_type, file_path, updated_at, metadata_json
      FROM run_artifact_index
      WHERE run_id = ?
      ORDER BY updated_at DESC, artifact_type ASC
    `);
    this.upsertRunArtifactStatement = this.db.prepare(`
      INSERT INTO run_artifact_index (
        run_id,
        artifact_type,
        file_path,
        updated_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id, file_path) DO UPDATE SET
        artifact_type = excluded.artifact_type,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `);
    this.clearRunArtifactsStatement = this.db.prepare("DELETE FROM run_artifact_index WHERE run_id = ?");

    this.replaceAllRunsTransaction = this.db.transaction((runs: RunRecord[]) => {
      this.clearRunsStatement.run();
      this.clearRunUsageStatement.run();
      for (const run of runs) {
        this.upsertRunStatement.run(...toRunIndexParams(run));
        syncRunUsageStatement(this.upsertRunUsageStatement, this.deleteRunUsageStatement, run);
      }
    });
    this.upsertRunsTransaction = this.db.transaction((runs: RunRecord[]) => {
      for (const run of runs) {
        this.upsertRunStatement.run(...toRunIndexParams(run));
        syncRunUsageStatement(this.upsertRunUsageStatement, this.deleteRunUsageStatement, run);
      }
    });
    this.replaceRunCheckpointsTransaction = this.db.transaction(
      (runId: string, checkpoints: IndexedRunCheckpoint[]) => {
        this.clearRunCheckpointsStatement.run(runId);
        for (const checkpoint of checkpoints) {
          this.upsertCheckpointStatement.run(...toRunCheckpointParams(checkpoint));
        }
      }
    );
    this.replaceRunEventsTransaction = this.db.transaction((runId: string, events: IndexedRunEvent[]) => {
      this.clearRunEventsStatement.run(runId);
      for (const event of [...events].sort((left, right) => left.eventSeq - right.eventSeq)) {
        this.insertRunEventStatement.run(...toRunEventParams(event));
      }
    });
    this.replaceRunArtifactsTransaction = this.db.transaction(
      (runId: string, artifacts: IndexedRunArtifact[]) => {
        this.clearRunArtifactsStatement.run(runId);
        for (const artifact of artifacts) {
          this.upsertRunArtifactStatement.run(...toRunArtifactParams(artifact));
        }
      }
    );
  }

  close(): void {
    this.db.close();
  }

  listRuns(): RunRecord[] {
    return this.selectAllRunsStatement.all().map((row) => parseRunIndexRow(row));
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.selectRunStatement.get(id);
    return row ? parseRunIndexRow(row) : undefined;
  }

  searchRuns(query: string): RunRecord[] {
    const likePattern = toLikePattern(query);
    return this.searchRunsStatement.all(likePattern, likePattern).map((row) => parseRunIndexRow(row));
  }

  upsertRun(run: RunRecord): void {
    this.upsertRunStatement.run(...toRunIndexParams(run));
    syncRunUsageStatement(this.upsertRunUsageStatement, this.deleteRunUsageStatement, run);
  }

  upsertRuns(runs: RunRecord[]): void {
    this.upsertRunsTransaction(runs);
  }

  replaceAllRuns(runs: RunRecord[]): void {
    this.replaceAllRunsTransaction(runs);
  }

  countRuns(): number {
    const row = this.countRunsStatement.get();
    return typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0;
  }

  getRunUsageSummary(runId: string): IndexedRunUsageSummary | undefined {
    const row = this.selectRunUsageStatement.get(runId);
    return row ? parseRunUsageSummaryRow(row) : undefined;
  }

  upsertCheckpoint(checkpoint: IndexedRunCheckpoint): void {
    this.upsertCheckpointStatement.run(...toRunCheckpointParams(checkpoint));
  }

  getLatestCheckpoint(runId: string): IndexedRunCheckpoint | undefined {
    const row = this.selectLatestCheckpointStatement.get(runId);
    return row ? parseRunCheckpointRow(row) : undefined;
  }

  getCheckpoint(runId: string, checkpointSeq: number): IndexedRunCheckpoint | undefined {
    const row = this.selectCheckpointStatement.get(runId, checkpointSeq);
    return row ? parseRunCheckpointRow(row) : undefined;
  }

  listRunCheckpoints(runId: string): IndexedRunCheckpoint[] {
    return this.selectRunCheckpointsStatement.all(runId).map((row) => parseRunCheckpointRow(row));
  }

  replaceRunCheckpoints(runId: string, checkpoints: IndexedRunCheckpoint[]): void {
    this.replaceRunCheckpointsTransaction(runId, checkpoints);
  }

  appendRunEvent(event: Omit<IndexedRunEvent, "eventSeq">): IndexedRunEvent {
    const nextSeqRow = this.selectNextEventSeqStatement.get(event.runId);
    const eventSeq =
      typeof nextSeqRow?.next_seq === "number" && Number.isFinite(nextSeqRow.next_seq) && nextSeqRow.next_seq > 0
        ? nextSeqRow.next_seq
        : 1;
    const stored: IndexedRunEvent = {
      ...event,
      eventSeq
    };
    this.insertRunEventStatement.run(...toRunEventParams(stored));
    return stored;
  }

  listRunEvents(runId: string, limit = 200): IndexedRunEvent[] {
    if (limit <= 0) {
      return [];
    }
    return this.selectRunEventsStatement
      .all(runId, limit)
      .map((row) => parseRunEventRow(row))
      .reverse();
  }

  replaceRunEvents(runId: string, events: IndexedRunEvent[]): void {
    this.replaceRunEventsTransaction(runId, events);
  }

  upsertRunArtifact(artifact: IndexedRunArtifact): void {
    this.upsertRunArtifactStatement.run(...toRunArtifactParams(artifact));
  }

  getRunArtifactByPath(runId: string, filePath: string): IndexedRunArtifact | undefined {
    const row = this.selectArtifactByPathStatement.get(runId, normalizeFsPath(filePath));
    return row ? parseRunArtifactRow(row) : undefined;
  }

  listRunArtifacts(runId: string): IndexedRunArtifact[] {
    return this.selectRunArtifactsStatement.all(runId).map((row) => parseRunArtifactRow(row));
  }

  replaceRunArtifacts(runId: string, artifacts: IndexedRunArtifact[]): void {
    this.replaceRunArtifactsTransaction(runId, artifacts);
  }

  getRunsMirrorMtimeMs(): number | undefined {
    const row = this.selectMetaStatement.get(RUNS_JSON_MTIME_META_KEY);
    const parsed = row ? Number(row.value) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  setRunsMirrorMtimeMs(mtimeMs: number): void {
    this.upsertMetaStatement.run(RUNS_JSON_MTIME_META_KEY, String(mtimeMs));
  }
}

function parseRunIndexRow(row: RunIndexRow): RunRecord {
  return JSON.parse(row.run_json) as RunRecord;
}

function parseRunUsageSummaryRow(row: RunUsageSummaryRow): IndexedRunUsageSummary {
  return {
    runId: row.run_id,
    usage: JSON.parse(row.usage_json) as RunUsageSummary
  };
}

function parseRunCheckpointRow(row: RunCheckpointIndexRow): IndexedRunCheckpoint {
  return {
    runId: row.run_id,
    checkpointSeq: row.checkpoint_seq,
    nodeId: row.node_id,
    phase: row.phase,
    createdAt: row.created_at,
    reason: normalizeOptionalText(row.reason),
    filePath: normalizeFsPath(row.file_path),
    snapshotUpdatedAt: normalizeOptionalText(row.snapshot_updated_at)
  };
}

function parseRunEventRow(row: RunEventIndexRow): IndexedRunEvent {
  return {
    runId: row.run_id,
    eventSeq: row.event_seq,
    eventId: row.event_id,
    eventType: row.event_type,
    nodeId: normalizeOptionalText(row.node_id),
    createdAt: row.created_at,
    filePath: normalizeFsPath(row.file_path),
    eventJson: row.event_json
  };
}

function parseRunArtifactRow(row: RunArtifactIndexRow): IndexedRunArtifact {
  return {
    runId: row.run_id,
    artifactType: row.artifact_type,
    filePath: normalizeFsPath(row.file_path),
    updatedAt: row.updated_at,
    metadataJson: normalizeOptionalText(row.metadata_json)
  };
}

function syncRunUsageStatement(
  upsertStatement: Database.Statement<
    [string, number, number, number, number, number, string | null, string],
    Database.RunResult
  >,
  deleteStatement: Database.Statement<[string], Database.RunResult>,
  run: RunRecord
): void {
  if (!run.usage) {
    deleteStatement.run(run.id);
    return;
  }
  upsertStatement.run(...toRunUsageParams(run.id, run.usage));
}

function toRunIndexParams(run: RunRecord): [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string
] {
  return [
    run.id,
    run.id.toLowerCase(),
    run.title,
    run.title.toLowerCase(),
    run.status,
    run.currentNode,
    run.createdAt,
    run.updatedAt,
    JSON.stringify(run)
  ];
}

function toRunUsageParams(
  runId: string,
  usage: RunUsageSummary
): [string, number, number, number, number, number, string | null, string] {
  return [
    runId,
    usage.totals.inputTokens,
    usage.totals.outputTokens,
    usage.totals.toolCalls,
    usage.totals.costUsd,
    usage.totals.wallTimeMs,
    usage.lastUpdatedAt ?? null,
    JSON.stringify(usage)
  ];
}

function toRunCheckpointParams(checkpoint: IndexedRunCheckpoint): [
  string,
  number,
  string,
  string,
  string,
  string | null,
  string,
  string | null
] {
  return [
    checkpoint.runId,
    checkpoint.checkpointSeq,
    checkpoint.nodeId,
    checkpoint.phase,
    checkpoint.createdAt,
    checkpoint.reason ?? null,
    normalizeFsPath(checkpoint.filePath),
    checkpoint.snapshotUpdatedAt ?? null
  ];
}

function toRunEventParams(event: IndexedRunEvent): [
  string,
  number,
  string,
  string,
  string | null,
  string,
  string,
  string
] {
  return [
    event.runId,
    event.eventSeq,
    event.eventId,
    event.eventType,
    event.nodeId ?? null,
    event.createdAt,
    normalizeFsPath(event.filePath),
    event.eventJson
  ];
}

function toRunArtifactParams(artifact: IndexedRunArtifact): [string, string, string, string, string | null] {
  return [
    artifact.runId,
    artifact.artifactType,
    normalizeFsPath(artifact.filePath),
    artifact.updatedAt,
    artifact.metadataJson ?? null
  ];
}

function toLikePattern(query: string): string {
  const normalized = query.trim().toLowerCase();
  const escaped = normalized.replace(/[\\%_]/g, (token) => `\\${token}`);
  return `%${escaped}%`;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
