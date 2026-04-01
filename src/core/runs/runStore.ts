import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";

import { AppPaths } from "../../config.js";
import {
  GRAPH_NODE_ORDER,
  GraphNodeId,
  NodeOptionPackageName,
  NodeStatus,
  RunRecord,
  RunsFile,
  SlashContextRun,
  TransitionRecommendation
} from "../../types.js";
import { ensureDir, fileExists, normalizeFsPath, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import { nowIso } from "../../utils/time.js";
import {
  isRunsFileV1,
  isRunsFileV2,
  isRunsFileV3,
  migrateAnyRunsFileToV3
} from "./migrateRuns.js";
import { createDefaultGraphState } from "../stateGraph/defaults.js";
import { RunContextItem } from "../memory/runContextMemory.js";
import { normalizeRunUsageSummary } from "./runUsage.js";
import { RunIndexDatabase, toRunArtifactType } from "./runIndexDatabase.js";
import { buildRunCheckpointsDirPath, buildRunRecordPath, buildRunRootPath } from "./runPaths.js";
import { indexRunKnowledge } from "../repositoryKnowledge.js";

export interface CreateRunInput {
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
}

export class RunStore {
  private runIndexReady?: Promise<RunIndexDatabase>;

  constructor(
    private readonly paths: AppPaths,
    private readonly options: {
      nodeOptionPackageName?: NodeOptionPackageName;
    } = {}
  ) {}

  async listRuns(): Promise<RunRecord[]> {
    return this.withRunIndex(async (index) => {
      const indexedRuns = index.listRuns();
      const reconciledRuns = await Promise.all(indexedRuns.map((run) => this.reconcileRunRecord(run)));
      const projectedRuns = reconciledRuns.map((run) => projectRunRecord(run));
      if (JSON.stringify(indexedRuns) !== JSON.stringify(projectedRuns)) {
        await this.persistProjectedRuns(index, indexedRuns, reconciledRuns);
      }
      return [...projectedRuns].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    });
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return this.withRunIndex(async (index) => {
      const storedSummary = index.getRun(id);
      if (!storedSummary) {
        return undefined;
      }

      const stored = await this.readStoredRunRecord(storedSummary);
      const reconciled = await this.reconcileRunRecord(stored.run);
      const projected = projectRunRecord(reconciled);
      if (
        !stored.hasSnapshot ||
        JSON.stringify(stored.run) !== JSON.stringify(reconciled) ||
        JSON.stringify(storedSummary) !== JSON.stringify(projected)
      ) {
        await this.persistRunRecord(index, reconciled);
      }

      return reconciled;
    });
  }

  async searchRuns(query: string): Promise<RunRecord[]> {
    const norm = query.trim().toLowerCase();
    if (!norm) {
      return this.listRuns();
    }

    return this.withRunIndex(async (index) => {
      const matchingRuns = index.searchRuns(norm);
      const reconciledRuns = await Promise.all(matchingRuns.map((run) => this.reconcileRunRecord(run)));
      const projectedRuns = reconciledRuns.map((run) => projectRunRecord(run));
      if (JSON.stringify(matchingRuns) !== JSON.stringify(projectedRuns)) {
        await this.persistProjectedRuns(index, matchingRuns, reconciledRuns);
      }
      return projectedRuns;
    });
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    return this.withRunIndex(async (index) => {
      const ts = nowIso();
      const id = randomUUID();
      const graph = createDefaultGraphState(this.options.nodeOptionPackageName);

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

      await this.ensureRunDirectory(run.id);
      index.upsertRun(projectRunRecord(run));
      await Promise.all([this.writeRunRecord(run), this.writeRunsMirror(index)]);
      return run;
    });
  }

  async updateRun(run: RunRecord): Promise<void> {
    await this.withRunIndex(async (index) => {
      const storedSummary = index.getRun(run.id);
      if (!storedSummary) {
        throw new Error(`Run not found: ${run.id}`);
      }

      const storedRecord = await this.readStoredRunRecord(storedSummary);
      const [stored, incoming] = await Promise.all([
        this.reconcileRunRecord(storedRecord.run),
        this.reconcileRunRecord(restoreProjectedRunFields(storedRecord.run, run))
      ]);
      const next = preferFresherRunRecord(stored, incoming);
      next.updatedAt = maxIso([next.updatedAt, nowIso()]) ?? nowIso();
      await this.persistRunRecord(index, next);
    });
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

  private async withRunIndex<T>(callback: (index: RunIndexDatabase) => Promise<T> | T): Promise<T> {
    const index = await this.getRunIndex();
    await this.refreshRunIndexFromRunsFileIfNeeded(index);
    return callback(index);
  }

  private async getRunIndex(): Promise<RunIndexDatabase> {
    this.runIndexReady ??= this.initializeRunIndex();
    return this.runIndexReady;
  }

  private async initializeRunIndex(): Promise<RunIndexDatabase> {
    await ensureDir(this.paths.runsDir);
    const index = new RunIndexDatabase(this.paths.runsDbFile);
    await this.refreshRunIndexFromRunsFileIfNeeded(index);
    if (!(await fileExists(this.paths.runsFile)) && index.countRuns() > 0) {
      await this.writeRunsMirror(index);
    }
    return index;
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

  private async refreshRunIndexFromRunsFileIfNeeded(index: RunIndexDatabase): Promise<void> {
    let runsFileStat: Stats | undefined;
    try {
      runsFileStat = await fs.stat(normalizeFsPath(this.paths.runsFile));
    } catch {
      if (index.countRuns() > 0) {
        await this.writeRunsMirror(index);
      }
      return;
    }

    const mirroredMtimeMs = index.getRunsMirrorMtimeMs();
    if (index.countRuns() > 0 && mirroredMtimeMs && runsFileStat.mtimeMs <= mirroredMtimeMs + 0.5) {
      return;
    }

    const runsFile = await this.readRunsFile();
    const seededRuns = await Promise.all(runsFile.runs.map((run) => this.readBootstrapRunRecord(run)));
    const projectedRuns = seededRuns.map((run) => projectRunRecord(run));
    index.replaceAllRuns(projectedRuns);
    if (JSON.stringify(runsFile.runs) !== JSON.stringify(projectedRuns)) {
      await this.writeRunsMirror(index, projectedRuns);
      return;
    }
    await this.recordRunsMirrorMtime(index);
  }

  private async persistProjectedRuns(index: RunIndexDatabase, storedRuns: RunRecord[], fullRuns: RunRecord[]): Promise<void> {
    const projectedRuns = fullRuns.map((run) => projectRunRecord(run));
    const changedIndices = projectedRuns
      .map((projected, idx) => (JSON.stringify(storedRuns[idx]) === JSON.stringify(projected) ? -1 : idx))
      .filter((idx) => idx >= 0);
    if (changedIndices.length === 0) {
      return;
    }

    const changedProjectedRuns = changedIndices.map((idx) => projectedRuns[idx]);
    const changedSnapshotWrites = changedIndices.map(async (idx) => {
      const persistableRun = await this.readPersistableRun(fullRuns[idx]);
      await this.writeRunRecord(persistableRun);
    });
    index.upsertRuns(changedProjectedRuns);
    await Promise.all([this.writeRunsMirror(index), ...changedSnapshotWrites]);
  }

  private async persistRunRecord(index: RunIndexDatabase, run: RunRecord): Promise<void> {
    const persistableRun = await this.readPersistableRun(run);
    index.upsertRun(projectRunRecord(persistableRun));
    await Promise.all([this.writeRunRecord(persistableRun), this.writeRunsMirror(index)]);
    if (persistableRun.status === "completed" || persistableRun.status === "failed") {
      await indexRunKnowledge({
        workspaceRoot: this.paths.cwd,
        run: persistableRun
      });
    }
  }

  private async writeRunsMirror(index: RunIndexDatabase, runs = index.listRuns()): Promise<void> {
    await this.writeRunsFile({
      version: 3,
      runs
    });
    await this.recordRunsMirrorMtime(index);
  }

  private async recordRunsMirrorMtime(index: RunIndexDatabase): Promise<void> {
    const stat = await fs.stat(normalizeFsPath(this.paths.runsFile));
    index.setRunsMirrorMtimeMs(stat.mtimeMs);
  }

  private async backupBrokenMigrationSource(raw: unknown): Promise<void> {
    const backupPath = `${this.paths.runsFile}.migration-failed-${Date.now()}.bak`;
    await fs.writeFile(normalizeFsPath(backupPath), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }

  private async ensureRunDirectory(runId: string): Promise<void> {
    const runRoot = buildRunRootPath(this.paths.runsDir, runId);
    await Promise.all([
      ensureDir(runRoot),
      ensureDir(buildRunCheckpointsDirPath(this.paths.runsDir, runId)),
      ensureDir(path.join(runRoot, "memory")),
      ensureDir(path.join(runRoot, "patches")),
      ensureDir(path.join(runRoot, "exec_logs")),
      ensureDir(path.join(runRoot, "figures")),
      ensureDir(path.join(runRoot, "paper"))
    ]);
  }

  private async readStoredRunRecord(
    run: RunRecord
  ): Promise<{ run: RunRecord; hasSnapshot: boolean }> {
    const normalized = normalizeRunRecord(run);
    const snapshot = await this.readRunRecord(run.id);
    if (!snapshot) {
      return {
        run: normalized,
        hasSnapshot: false
      };
    }

    return {
      run: compareRunFreshness(normalized, snapshot) > 0 ? normalized : snapshot,
      hasSnapshot: true
    };
  }

  private async readBootstrapRunRecord(run: RunRecord): Promise<RunRecord> {
    const normalized = normalizeRunRecord(run);
    const snapshot = await this.readRunRecord(run.id);
    return snapshot && compareRunFreshness(normalized, snapshot) <= 0 ? snapshot : normalized;
  }

  private async readPersistableRun(run: RunRecord): Promise<RunRecord> {
    const snapshot = await this.readRunRecord(run.id);
    return snapshot ? restoreProjectedRunFields(snapshot, run) : run;
  }

  private async readRunRecord(runId: string): Promise<RunRecord | undefined> {
    try {
      const raw = await readJsonFile<RunRecord>(this.runRecordPath(runId));
      return normalizeRunRecord(raw);
    } catch {
      return undefined;
    }
  }

  private async writeRunRecord(run: RunRecord): Promise<void> {
    await this.ensureRunDirectory(run.id);
    await writeJsonFile(this.runRecordPath(run.id), normalizeRunRecord(run));
  }

  private runRecordPath(runId: string): string {
    return buildRunRecordPath(this.paths.runsDir, runId);
  }

  private async reconcileRunRecord(run: RunRecord): Promise<RunRecord> {
    let next = normalizeRunRecord(run);
    const details = await this.readDerivedRunDetails(next);
    next = applyCheckpointDerivedState(next, details.latestCheckpoint);
    const collectSummary = buildCollectDerivedSummary(details);
    const analyzeSummary = buildAnalyzeDerivedSummary(details);

    next = applyCollectDerivedState(next, collectSummary);
    next = applyAnalyzeDerivedState(next, analyzeSummary);
    next = applyTransitionDerivedState(next, details.transitionRecommendationFile);
    next = clearStalePendingTransition(next);
    next = normalizeCurrentRunPointer(next);

    const latestSummary = pickLatestSummary(next);
    if (latestSummary) {
      next.latestSummary = latestSummary;
    }

    const latestTimestamp = maxIso([
      next.updatedAt,
      ...GRAPH_NODE_ORDER.map((node) => next.graph.nodeStates[node]?.updatedAt),
      details.latestCheckpoint?.createdAt,
      details.latestCheckpoint?.runSnapshot.updatedAt,
      collectSummary.updatedAt,
      analyzeSummary.updatedAt,
      details.transitionRecommendationFile.updatedAt
    ]);
    if (latestTimestamp) {
      next.updatedAt = latestTimestamp;
    }

    return next;
  }

  private async readDerivedRunDetails(run: RunRecord): Promise<DerivedRunDetails> {
    const runRoot = buildRunRootPath(this.paths.runsDir, run.id);
    const runContextPath = this.resolveWorkspacePath(run.memoryRefs.runContextPath);
    const [
      contextItems,
      collectResultFile,
      analysisManifest,
      transitionRecommendationFile,
      summaryArtifact,
      evidenceArtifact,
      latestCheckpoint
    ] =
      await Promise.all([
      this.readRunContextItems(runContextPath),
      this.readOptionalJson<CollectResultLike>(path.join(runRoot, "collect_result.json")),
      this.readOptionalJson<AnalysisManifestLike>(path.join(runRoot, "analysis_manifest.json")),
      this.readOptionalJson<TransitionRecommendation>(path.join(runRoot, "transition_recommendation.json")),
      this.readJsonlArtifact(run.id, path.join(runRoot, "paper_summaries.jsonl")),
      this.readJsonlArtifact(run.id, path.join(runRoot, "evidence_store.jsonl")),
      this.readLatestCheckpointSnapshot(run.id, runRoot)
    ]);

    return {
      contextEntries: new Map(contextItems.map((item) => [item.key, item])),
      collectResultFile,
      analysisManifest,
      transitionRecommendationFile,
      summaryArtifact,
      evidenceArtifact,
      latestCheckpoint
    };
  }

  private resolveWorkspacePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.paths.cwd, filePath);
  }

  private async readRunContextItems(filePath: string): Promise<RunContextItem[]> {
    try {
      const raw = await readJsonFile<{ items?: RunContextItem[] }>(filePath);
      return Array.isArray(raw.items) ? raw.items : [];
    } catch {
      return [];
    }
  }

  private async readOptionalJson<T>(filePath: string): Promise<DerivedJsonFile<T>> {
    try {
      const normalizedPath = normalizeFsPath(filePath);
      const [value, stat] = await Promise.all([readJsonFile<T>(normalizedPath), fs.stat(normalizedPath)]);
      return {
        value,
        updatedAt: extractUpdatedAtCandidate(value, stat.mtime.toISOString())
      };
    } catch {
      return {};
    }
  }

  private async readJsonlArtifact(runId: string, filePath: string): Promise<DerivedCountFile> {
    try {
      const normalizedPath = normalizeFsPath(filePath);
      const [index, stat] = await Promise.all([this.getRunIndex(), fs.stat(normalizedPath)]);
      const indexed = index.getRunArtifactByPath(runId, normalizedPath);
      const indexedMetadata = parseRunArtifactMetadata(indexed?.metadataJson);
      if (
        indexed?.updatedAt === stat.mtime.toISOString() &&
        typeof indexedMetadata?.lineCount === "number" &&
        Number.isFinite(indexedMetadata.lineCount)
      ) {
        return {
          count: indexedMetadata.lineCount,
          updatedAt: indexed.updatedAt
        };
      }

      const raw = await fs.readFile(normalizedPath, "utf8");
      const count = countNonEmptyLines(raw);
      const relativePath = path
        .relative(path.join(this.paths.runsDir, runId), normalizedPath)
        .replace(/\\/g, "/");
      index.upsertRunArtifact({
        runId,
        artifactType: toRunArtifactType(relativePath),
        filePath: normalizedPath,
        updatedAt: stat.mtime.toISOString(),
        metadataJson: JSON.stringify({
          relativePath,
          kind: "jsonl",
          byteSize: stat.size,
          lineCount: count
        })
      });
      return {
        count,
        updatedAt: stat.mtime.toISOString()
      };
    } catch {
      return {};
    }
  }

  private async readLatestCheckpointSnapshot(runId: string, runRoot: string): Promise<DerivedCheckpointRecord | undefined> {
    const checkpointsDir = path.join(runRoot, "checkpoints");
    let latest: DerivedCheckpointRecord | undefined;
    const index = await this.getRunIndex();
    const indexedLatest = index.getLatestCheckpoint(runId);
    if (indexedLatest) {
      try {
        const record = await readJsonFile<CheckpointRecordLike>(indexedLatest.filePath);
        if (record.runSnapshot && typeof record.seq === "number" && Number.isFinite(record.seq)) {
          latest = {
            seq: record.seq,
            createdAt: toOptionalString(record.createdAt),
            runSnapshot: normalizeRunRecord(record.runSnapshot)
          };
        }
      } catch {
        // Fall through to latest.json and directory scanning.
      }
    }

    try {
      const latestPointer = await readJsonFile<{ file?: unknown }>(path.join(checkpointsDir, "latest.json"));
      const latestFile = toOptionalString(latestPointer.file);
      if (latestFile) {
        const record = await readJsonFile<CheckpointRecordLike>(path.join(checkpointsDir, latestFile));
        if (record.runSnapshot && typeof record.seq === "number" && Number.isFinite(record.seq)) {
          const candidate: DerivedCheckpointRecord = {
            seq: record.seq,
            createdAt: toOptionalString(record.createdAt),
            runSnapshot: normalizeRunRecord(record.runSnapshot)
          };
          if (!latest || compareCheckpointFreshness(candidate, latest) > 0) {
            latest = candidate;
          }
          index.upsertCheckpoint({
            runId,
            checkpointSeq: candidate.seq,
            nodeId: toOptionalGraphNodeId(record.node) ?? candidate.runSnapshot.currentNode,
            phase: toOptionalCheckpointPhase(record.phase) ?? inferCheckpointPhaseFromFileName(latestFile),
            createdAt: candidate.createdAt ?? candidate.runSnapshot.updatedAt,
            filePath: path.join(checkpointsDir, latestFile),
            snapshotUpdatedAt: candidate.runSnapshot.updatedAt
          });
        }
      }
    } catch {
      // Fall back to scanning the checkpoint directory when latest.json is missing or stale.
    }

    try {
      const files = (await fs.readdir(normalizeFsPath(checkpointsDir)))
        .filter((file) => file.endsWith(".json") && file !== "latest.json")
        .sort();
      if (files.length === 0) {
        return latest;
      }

      const newestFile = files[files.length - 1];
      const record = await readJsonFile<CheckpointRecordLike>(path.join(checkpointsDir, newestFile));
      if (record.runSnapshot && typeof record.seq === "number" && Number.isFinite(record.seq)) {
        const candidate: DerivedCheckpointRecord = {
          seq: record.seq,
          createdAt: toOptionalString(record.createdAt),
          runSnapshot: normalizeRunRecord(record.runSnapshot)
        };
        if (!latest || compareCheckpointFreshness(candidate, latest) > 0) {
          latest = candidate;
        }
        index.upsertCheckpoint({
          runId,
          checkpointSeq: candidate.seq,
          nodeId: toOptionalGraphNodeId(record.node) ?? candidate.runSnapshot.currentNode,
          phase: toOptionalCheckpointPhase(record.phase) ?? inferCheckpointPhaseFromFileName(newestFile),
          createdAt: candidate.createdAt ?? candidate.runSnapshot.updatedAt,
          filePath: path.join(checkpointsDir, newestFile),
          snapshotUpdatedAt: candidate.runSnapshot.updatedAt
        });
      }

      return latest;
    } catch {
      return latest;
    }
  }
}

function normalizeRunsV3(runsFile: RunsFile): RunsFile {
  return {
    version: 3,
    runs: runsFile.runs.map((run) => normalizeRunRecord(run))
  };
}

function normalizeRunRecord(run: RunRecord): RunRecord {
  const retryPolicy = {
    ...createDefaultGraphState().retryPolicy,
    ...(run.graph?.retryPolicy ?? {})
  };
  return {
    ...run,
    version: 3,
    workflowVersion: 3,
    graph: {
      ...createDefaultGraphState(),
      ...run.graph,
      nodeStates: {
        ...createDefaultGraphState().nodeStates,
        ...(run.graph?.nodeStates ?? {})
      },
      retryCounters: clampCounters(
        run.graph?.retryCounters ?? {},
        Math.max(1, retryPolicy.maxAttemptsPerNode)
      ),
      rollbackCounters: clampCounters(
        run.graph?.rollbackCounters ?? {},
        Math.max(0, retryPolicy.maxAutoRollbacksPerNode)
      ),
      researchCycle: run.graph?.researchCycle ?? 0,
      transitionHistory: run.graph?.transitionHistory ?? [],
      retryPolicy,
      pendingTransition: normalizePendingTransition(run.graph?.pendingTransition)
    },
    nodeThreads: run.nodeThreads ?? {},
    usage: normalizeRunUsageSummary(run.usage),
    memoryRefs: run.memoryRefs ?? {
      runContextPath: `.autolabos/runs/${run.id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${run.id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${run.id}/memory/episodes.jsonl`
    }
  };
}

function projectRunRecord(run: RunRecord): RunRecord {
  const normalized = normalizeRunRecord(run);
  return {
    ...normalized,
    graph: {
      ...normalized.graph,
      transitionHistory: []
    }
  };
}

function restoreProjectedRunFields(stored: RunRecord, candidate: RunRecord): RunRecord {
  const normalized = normalizeRunRecord(candidate);
  if (
    normalized.graph.transitionHistory.length === 0 &&
    (stored.graph.transitionHistory?.length ?? 0) > 0
  ) {
    return {
      ...normalized,
      graph: {
        ...normalized.graph,
        transitionHistory: [...stored.graph.transitionHistory]
      }
    };
  }
  return normalized;
}

function normalizePendingTransition(
  transition: RunRecord["graph"]["pendingTransition"]
): RunRecord["graph"]["pendingTransition"] {
  if (!transition) {
    return undefined;
  }
  if (
    transition.sourceNode === "analyze_results" &&
    transition.action === "advance" &&
    transition.targetNode === "write_paper"
  ) {
    return {
      ...transition,
      targetNode: "review"
    };
  }
  return transition;
}

interface DerivedJsonFile<T> {
  value?: T;
  updatedAt?: string;
}

interface DerivedCountFile {
  count?: number;
  updatedAt?: string;
}

interface RunArtifactMetadataLike {
  lineCount?: unknown;
}

interface DerivedRunDetails {
  contextEntries: Map<string, RunContextItem>;
  collectResultFile: DerivedJsonFile<CollectResultLike>;
  analysisManifest: DerivedJsonFile<AnalysisManifestLike>;
  transitionRecommendationFile: DerivedJsonFile<TransitionRecommendation>;
  summaryArtifact: DerivedCountFile;
  evidenceArtifact: DerivedCountFile;
  latestCheckpoint?: DerivedCheckpointRecord;
}

interface DerivedNodeSummary {
  summary?: string;
  updatedAt?: string;
}

interface DerivedCheckpointRecord {
  seq: number;
  createdAt?: string;
  runSnapshot: RunRecord;
}

interface CheckpointRecordLike {
  seq?: unknown;
  node?: unknown;
  phase?: unknown;
  createdAt?: unknown;
  runSnapshot?: RunRecord;
}

interface CollectResultLike {
  query?: unknown;
  stored?: unknown;
  pdfRecovered?: unknown;
  bibtexEnriched?: unknown;
  enrichment?: {
    status?: unknown;
    targetCount?: unknown;
    processedCount?: unknown;
    lastError?: unknown;
    blocking?: unknown;
  };
}

interface AnalyzeRequestLike {
  topN?: unknown;
  selectionMode?: unknown;
}

interface AnalysisManifestEntryLike {
  status?: unknown;
  selected?: unknown;
  summary_count?: unknown;
  evidence_count?: unknown;
  updatedAt?: unknown;
  source_type?: unknown;
}

interface AnalysisManifestLike {
  updatedAt?: unknown;
  request?: AnalyzeRequestLike;
  totalCandidates?: unknown;
  selectedPaperIds?: unknown;
  analysisFingerprint?: unknown;
  papers?: Record<string, AnalysisManifestEntryLike>;
}

function clampCounters(
  counters: Partial<Record<GraphNodeId, number>>,
  max: number
): Partial<Record<GraphNodeId, number>> {
  return Object.fromEntries(
    Object.entries(counters).map(([node, value]) => {
      const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
      return [node, Math.min(Math.max(numericValue, 0), max)];
    })
  ) as Partial<Record<GraphNodeId, number>>;
}

function compareCheckpointFreshness(left: DerivedCheckpointRecord, right: DerivedCheckpointRecord): number {
  if (left.seq !== right.seq) {
    return left.seq - right.seq;
  }

  const createdAtDiff = updatedAtMs(left.createdAt) - updatedAtMs(right.createdAt);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return compareRunFreshness(left.runSnapshot, right.runSnapshot);
}

function applyCheckpointDerivedState(
  run: RunRecord,
  checkpoint: DerivedCheckpointRecord | undefined
): RunRecord {
  if (!checkpoint) {
    return run;
  }

  return compareRunFreshness(checkpoint.runSnapshot, run) > 0 ? checkpoint.runSnapshot : run;
}

function applyCollectDerivedState(run: RunRecord, summary: DerivedNodeSummary): RunRecord {
  if (!summary.summary) {
    return run;
  }

  const state = run.graph.nodeStates.collect_papers;
  return {
    ...run,
    graph: {
      ...run.graph,
      nodeStates: {
        ...run.graph.nodeStates,
        collect_papers: mergeNodeNote(state, summary)
      }
    }
  };
}

function applyAnalyzeDerivedState(run: RunRecord, summary: DerivedNodeSummary): RunRecord {
  if (!summary.summary) {
    return run;
  }

  const state = run.graph.nodeStates.analyze_papers;
  return {
    ...run,
    graph: {
      ...run.graph,
      nodeStates: {
        ...run.graph.nodeStates,
        analyze_papers: mergeNodeNote(state, summary)
      }
    }
  };
}

function applyTransitionDerivedState(
  run: RunRecord,
  transitionFile: DerivedJsonFile<TransitionRecommendation>
): RunRecord {
  const currentState = run.graph.nodeStates[run.currentNode];
  const shouldHydrateFailedRecovery =
    run.status === "failed" || currentState?.status === "failed";
  if (run.graph.pendingTransition || !transitionFile.value || !shouldHydrateFailedRecovery) {
    return run;
  }

  const transition = normalizePendingTransition(transitionFile.value);
  if (!transition) {
    return run;
  }

  return {
    ...run,
    graph: {
      ...run.graph,
      pendingTransition: transition
    }
  };
}

function clearStalePendingTransition(run: RunRecord): RunRecord {
  const transition = run.graph.pendingTransition;
  if (!transition) {
    return run;
  }

  const currentState = run.graph.nodeStates[run.currentNode];
  if (run.status === "failed" || currentState?.status === "failed" || currentState?.status === "needs_approval") {
    return run;
  }

  return {
    ...run,
    graph: {
      ...run.graph,
      pendingTransition: undefined
    }
  };
}

function buildCollectDerivedSummary(details: DerivedRunDetails): DerivedNodeSummary {
  const fromContext = getContextEntryValue<CollectResultLike>(details.contextEntries, "collect_papers.last_result");
  const fromRequest = getContextEntryValue<Record<string, unknown>>(details.contextEntries, "collect_papers.last_request");
  const meta = fromContext.value ?? details.collectResultFile.value;
  if (!meta) {
    return {};
  }

  const stored = toFiniteNumber(meta.stored);
  if (stored == null) {
    return {};
  }

  const query =
    toOptionalString(meta.query) ||
    toOptionalString(fromRequest.value?.query) ||
    undefined;
  const pdfRecovered = toFiniteNumber(meta.pdfRecovered) ?? 0;
  const bibtexEnriched = toFiniteNumber(meta.bibtexEnriched) ?? 0;
  const enrichmentStatus = toOptionalString(meta.enrichment?.status);
  const enrichmentTargetCount = toFiniteNumber(meta.enrichment?.targetCount) ?? 0;
  const enrichmentProcessedCount = toFiniteNumber(meta.enrichment?.processedCount) ?? 0;
  const enrichmentLastError = toOptionalString(meta.enrichment?.lastError);
  const baseSummary = query
    ? `Semantic Scholar stored ${stored} papers for "${query}".`
    : `Semantic Scholar stored ${stored} papers.`;
  const enrichmentSummary =
    enrichmentStatus === "completed"
      ? ` PDF recovered ${pdfRecovered}; BibTeX enriched ${bibtexEnriched}.`
      : enrichmentStatus === "failed"
        ? ` Deferred enrichment failed after ${Math.min(
            enrichmentProcessedCount,
            enrichmentTargetCount
          )}/${enrichmentTargetCount} paper(s): ${enrichmentLastError || "unknown error"}. Stored corpus remains available.`
      : enrichmentTargetCount > 0
        ? enrichmentProcessedCount > 0
          ? ` Deferred enrichment continues in background for ${enrichmentTargetCount} paper(s) (${Math.min(
              enrichmentProcessedCount,
              enrichmentTargetCount
            )}/${enrichmentTargetCount} processed).`
          : ` Deferred enrichment continues in background for ${enrichmentTargetCount} paper(s).`
        : "";

  return {
    summary: `${baseSummary}${enrichmentSummary}`.trim(),
    updatedAt: maxIso([fromContext.updatedAt, details.collectResultFile.updatedAt])
  };
}

function buildAnalyzeDerivedSummary(details: DerivedRunDetails): DerivedNodeSummary {
  const manifest = details.analysisManifest.value;
  const manifestEntries = Object.values(manifest?.papers ?? {});
  const contextRequest = getContextEntryValue<AnalyzeRequestLike>(details.contextEntries, "analyze_papers.request");
  const selectedCount = maxNumber([
    toFiniteNumber(getContextEntryValue(details.contextEntries, "analyze_papers.selected_count").value),
    Array.isArray(manifest?.selectedPaperIds) ? manifest.selectedPaperIds.length : undefined
  ]);
  const totalCandidates = maxNumber([
    toFiniteNumber(getContextEntryValue(details.contextEntries, "analyze_papers.total_candidates").value),
    toFiniteNumber(manifest?.totalCandidates)
  ]);
  const summaryCount = maxNumber([
    toFiniteNumber(getContextEntryValue(details.contextEntries, "analyze_papers.summary_count").value),
    details.summaryArtifact.count,
    sumManifestCounts(manifestEntries, "summary_count")
  ]) ?? 0;
  const evidenceCount = maxNumber([
    toFiniteNumber(getContextEntryValue(details.contextEntries, "analyze_papers.evidence_count").value),
    details.evidenceArtifact.count,
    sumManifestCounts(manifestEntries, "evidence_count")
  ]) ?? 0;
  const fullTextCount = maxNumber([
    toFiniteNumber(getContextEntryValue(details.contextEntries, "analyze_papers.full_text_count").value),
    countManifestBySourceType(manifestEntries, "full_text")
  ]) ?? 0;
  const abstractFallbackCount = maxNumber([
    toFiniteNumber(getContextEntryValue(details.contextEntries, "analyze_papers.abstract_fallback_count").value),
    countManifestBySourceType(manifestEntries, "abstract")
  ]) ?? 0;
  const failedCount = countSelectedFailedEntries(manifestEntries);
  const request = contextRequest.value ?? manifest?.request;
  const topN = toFiniteNumber(request?.topN);
  const selectionMode = toOptionalString(request?.selectionMode);
  const analysisMode = extractAnalysisMode(manifest?.analysisFingerprint);

  if ((selectedCount ?? 0) <= 0 && summaryCount <= 0 && evidenceCount <= 0 && failedCount <= 0) {
    return {};
  }

  let summary: string;
  if (failedCount > 0) {
    if (selectionMode === "top_n" && topN && (totalCandidates ?? 0) > 0 && (selectedCount ?? 0) > 0) {
      summary = `Analyzed ${summaryCount}/${selectedCount} selected papers from ${totalCandidates} candidates; ${failedCount} failed and can be retried.`;
    } else if ((selectedCount ?? 0) > 0 && (totalCandidates ?? 0) > 0) {
      summary = `Analyzed ${summaryCount}/${selectedCount} selected papers from ${totalCandidates} candidates; ${failedCount} failed and can be retried.`;
    } else if (summaryCount > 0 || evidenceCount > 0) {
      summary = `Analyzed ${summaryCount} papers into ${evidenceCount} evidence item(s); ${failedCount} failed and can be retried.`;
    } else {
      summary = `Analysis incomplete: ${failedCount} paper(s) failed validation or LLM extraction.`;
    }
  } else if (selectionMode === "top_n" && topN && (totalCandidates ?? 0) > 0 && (selectedCount ?? 0) > 0) {
    summary = `Analyzed top ${selectedCount}/${totalCandidates} ranked papers into ${evidenceCount} evidence item(s); ${fullTextCount} full-text and ${abstractFallbackCount} abstract fallback${analysisMode ? ` (mode=${analysisMode})` : ""}.`;
  } else if ((selectedCount ?? 0) > 0 || summaryCount > 0 || evidenceCount > 0) {
    summary = `Analyzed ${summaryCount} papers into ${evidenceCount} evidence item(s); ${fullTextCount} full-text and ${abstractFallbackCount} abstract fallback${analysisMode ? ` (mode=${analysisMode})` : ""}.`;
  } else {
    summary = `Prepared analysis selection for ${totalCandidates ?? 0} candidate paper(s).`;
  }

  const updatedAt = maxIso([
    contextRequest.updatedAt,
    getContextEntryValue(details.contextEntries, "analyze_papers.summary_count").updatedAt,
    getContextEntryValue(details.contextEntries, "analyze_papers.evidence_count").updatedAt,
    getContextEntryValue(details.contextEntries, "analyze_papers.full_text_count").updatedAt,
    getContextEntryValue(details.contextEntries, "analyze_papers.abstract_fallback_count").updatedAt,
    getContextEntryValue(details.contextEntries, "analyze_papers.selected_count").updatedAt,
    getContextEntryValue(details.contextEntries, "analyze_papers.total_candidates").updatedAt,
    details.analysisManifest.updatedAt,
    details.summaryArtifact.updatedAt,
    details.evidenceArtifact.updatedAt
  ]);

  return {
    summary,
    updatedAt
  };
}

function mergeNodeNote(
  state: RunRecord["graph"]["nodeStates"][GraphNodeId],
  derived: DerivedNodeSummary
): RunRecord["graph"]["nodeStates"][GraphNodeId] {
  if (!derived.summary) {
    return state;
  }

  const note = (state.note || "").trim();
  let nextNote = note;
  if (!nextNote) {
    nextNote = derived.summary;
  } else if (updatedAtMs(derived.updatedAt) > updatedAtMs(state.updatedAt)) {
    nextNote = derived.summary;
  } else if (isAugmentableNote(nextNote)) {
    nextNote = appendSummary(nextNote, derived.summary);
  }

  return {
    ...state,
    note: nextNote,
    updatedAt: maxIso([state.updatedAt, derived.updatedAt]) || state.updatedAt
  };
}

function normalizeCurrentRunPointer(run: RunRecord): RunRecord {
  const activeNodes = GRAPH_NODE_ORDER.filter((node) => {
    const status = run.graph.nodeStates[node]?.status;
    return status === "running" || status === "needs_approval";
  });
  if (activeNodes.length === 0) {
    return run;
  }

  const latestActiveNode = activeNodes.sort((left, right) => {
    return updatedAtMs(run.graph.nodeStates[left]?.updatedAt) - updatedAtMs(run.graph.nodeStates[right]?.updatedAt);
  })[activeNodes.length - 1];
  if (latestActiveNode === run.currentNode && latestActiveNode === run.graph.currentNode) {
    return run;
  }

  return {
    ...run,
    currentNode: latestActiveNode,
    status: run.graph.nodeStates[latestActiveNode].status === "needs_approval" ? "paused" : "running",
    graph: {
      ...run.graph,
      currentNode: latestActiveNode
    }
  };
}

function pickLatestSummary(run: RunRecord): string | undefined {
  const currentStatus = run.graph.nodeStates[run.currentNode]?.status;
  const currentNote = run.graph.nodeStates[run.currentNode]?.note?.trim();
  if (currentNote && currentStatus && currentStatus !== "pending") {
    return currentNote;
  }

  const notedNodes = GRAPH_NODE_ORDER.filter((node) => Boolean(run.graph.nodeStates[node]?.note?.trim()));
  if (notedNodes.length === 0) {
    return run.latestSummary;
  }

  const latestNode = notedNodes.sort((left, right) => {
    return updatedAtMs(run.graph.nodeStates[left]?.updatedAt) - updatedAtMs(run.graph.nodeStates[right]?.updatedAt);
  })[notedNodes.length - 1];
  return run.graph.nodeStates[latestNode]?.note?.trim() || run.latestSummary;
}

function preferFresherRunRecord(current: RunRecord, candidate: RunRecord): RunRecord {
  return compareRunFreshness(candidate, current) >= 0 ? candidate : current;
}

function compareRunFreshness(left: RunRecord, right: RunRecord): number {
  const leftSeq = left.graph.checkpointSeq ?? 0;
  const rightSeq = right.graph.checkpointSeq ?? 0;
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return updatedAtMs(runFreshnessTimestamp(left)) - updatedAtMs(runFreshnessTimestamp(right));
}

function runFreshnessTimestamp(run: RunRecord): string | undefined {
  return maxIso([
    run.updatedAt,
    ...GRAPH_NODE_ORDER.map((node) => run.graph.nodeStates[node]?.updatedAt)
  ]);
}

function getContextEntryValue<T>(
  entries: Map<string, RunContextItem>,
  key: string
): { value?: T; updatedAt?: string } {
  const item = entries.get(key);
  return {
    value: item?.value as T | undefined,
    updatedAt: item?.updatedAt
  };
}

function sumManifestCounts(entries: AnalysisManifestEntryLike[], field: "summary_count" | "evidence_count"): number | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  return entries.reduce((total, entry) => total + (toFiniteNumber(entry[field]) ?? 0), 0);
}

function countSelectedFailedEntries(entries: AnalysisManifestEntryLike[]): number {
  return entries.filter((entry) => {
    return (entry.selected !== false) && toOptionalString(entry.status) === "failed";
  }).length;
}

function countNonEmptyLines(raw: string): number {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function parseRunArtifactMetadata(metadataJson: string | undefined): { lineCount?: number } | undefined {
  if (!metadataJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(metadataJson) as RunArtifactMetadataLike;
    return {
      lineCount: toFiniteNumber(parsed.lineCount)
    };
  } catch {
    return undefined;
  }
}

function countManifestBySourceType(entries: AnalysisManifestEntryLike[], sourceType: string): number | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  return entries.filter((entry) => {
    return (toFiniteNumber(entry.summary_count) ?? 0) > 0 && toOptionalString(entry.source_type) === sourceType;
  }).length;
}

function extractAnalysisMode(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { analysisMode?: unknown };
    return toOptionalString(parsed.analysisMode);
  } catch {
    return undefined;
  }
}

function extractUpdatedAtCandidate(value: unknown, fallback: string): string {
  if (value && typeof value === "object") {
    const updatedAt = toOptionalString((value as { updatedAt?: unknown }).updatedAt);
    if (updatedAt) {
      return updatedAt;
    }
    const timestamp = toOptionalString((value as { timestamp?: unknown }).timestamp);
    if (timestamp) {
      return timestamp;
    }
  }
  return fallback;
}

function appendSummary(prefix: string, detail: string): string {
  if (!detail || prefix.includes(detail)) {
    return prefix;
  }
  return prefix.endsWith(".") ? `${prefix} ${detail}` : `${prefix}. ${detail}`;
}

function isAugmentableNote(note: string): boolean {
  return [/^Canceled by user$/i, /^manual retry$/i, /^Auto retry scheduled/i].some((pattern) => pattern.test(note.trim()));
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalGraphNodeId(value: unknown): GraphNodeId | undefined {
  return typeof value === "string" && GRAPH_NODE_ORDER.includes(value as GraphNodeId)
    ? (value as GraphNodeId)
    : undefined;
}

function toOptionalCheckpointPhase(value: unknown): string | undefined {
  return typeof value === "string" && ["before", "after", "fail", "jump", "retry"].includes(value)
    ? value
    : undefined;
}

function inferCheckpointPhaseFromFileName(fileName: string): string {
  const inferred = fileName.split("-").pop()?.replace(/\.json$/u, "");
  return toOptionalCheckpointPhase(inferred) ?? "after";
}

function maxNumber(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) {
    return undefined;
  }
  return Math.max(...present);
}

function maxIso(values: Array<string | undefined>): string | undefined {
  const present = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (present.length === 0) {
    return undefined;
  }
  return present.sort((left, right) => updatedAtMs(left) - updatedAtMs(right))[present.length - 1];
}

function updatedAtMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
