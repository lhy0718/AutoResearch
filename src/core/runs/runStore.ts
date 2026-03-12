import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";

import { AppPaths } from "../../config.js";
import { GRAPH_NODE_ORDER, GraphNodeId, NodeStatus, RunRecord, RunsFile, SlashContextRun } from "../../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import { nowIso } from "../../utils/time.js";
import {
  isRunsFileV1,
  isRunsFileV2,
  isRunsFileV3,
  migrateAnyRunsFileToV3
} from "./migrateRuns.js";
import { createDefaultGraphState } from "../stateGraph/defaults.js";
import { RunContextItem } from "../memory/runContextMemory.js";

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
    const reconciledRuns = await Promise.all(runsFile.runs.map((run) => this.reconcileRunRecord(run)));
    if (JSON.stringify(runsFile.runs) !== JSON.stringify(reconciledRuns)) {
      await this.writeRunsFile({
        version: 3,
        runs: reconciledRuns
      });
    }
    return [...reconciledRuns].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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

    const [stored, incoming] = await Promise.all([
      this.reconcileRunRecord(runsFile.runs[idx]),
      this.reconcileRunRecord(run)
    ]);
    const next = preferFresherRunRecord(stored, incoming);
    next.updatedAt = maxIso([next.updatedAt, nowIso()]) ?? nowIso();
    runsFile.runs[idx] = next;
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

  private async reconcileRunRecord(run: RunRecord): Promise<RunRecord> {
    let next = normalizeRunRecord(run);
    const details = await this.readDerivedRunDetails(next);
    next = applyCheckpointDerivedState(next, details.latestCheckpoint);
    const collectSummary = buildCollectDerivedSummary(details);
    const analyzeSummary = buildAnalyzeDerivedSummary(details);

    next = applyCollectDerivedState(next, collectSummary);
    next = applyAnalyzeDerivedState(next, analyzeSummary);
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
      analyzeSummary.updatedAt
    ]);
    if (latestTimestamp) {
      next.updatedAt = latestTimestamp;
    }

    return next;
  }

  private async readDerivedRunDetails(run: RunRecord): Promise<DerivedRunDetails> {
    const runRoot = path.join(this.paths.runsDir, run.id);
    const runContextPath = this.resolveWorkspacePath(run.memoryRefs.runContextPath);
    const [contextItems, collectResultFile, analysisManifest, summaryArtifact, evidenceArtifact, latestCheckpoint] =
      await Promise.all([
      this.readRunContextItems(runContextPath),
      this.readOptionalJson<CollectResultLike>(path.join(runRoot, "collect_result.json")),
      this.readOptionalJson<AnalysisManifestLike>(path.join(runRoot, "analysis_manifest.json")),
      this.readJsonlArtifact(path.join(runRoot, "paper_summaries.jsonl")),
      this.readJsonlArtifact(path.join(runRoot, "evidence_store.jsonl")),
      this.readLatestCheckpointSnapshot(runRoot)
    ]);

    return {
      contextEntries: new Map(contextItems.map((item) => [item.key, item])),
      collectResultFile,
      analysisManifest,
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
      const [value, stat] = await Promise.all([readJsonFile<T>(filePath), fs.stat(filePath)]);
      return {
        value,
        updatedAt: extractUpdatedAtCandidate(value, stat.mtime.toISOString())
      };
    } catch {
      return {};
    }
  }

  private async readJsonlArtifact(filePath: string): Promise<DerivedCountFile> {
    try {
      const [raw, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
      return {
        count: raw
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line.length > 0).length,
        updatedAt: stat.mtime.toISOString()
      };
    } catch {
      return {};
    }
  }

  private async readLatestCheckpointSnapshot(runRoot: string): Promise<DerivedCheckpointRecord | undefined> {
    const checkpointsDir = path.join(runRoot, "checkpoints");
    try {
      const files = (await fs.readdir(checkpointsDir))
        .filter((file) => file.endsWith(".json") && file !== "latest.json")
        .sort();
      if (files.length === 0) {
        return undefined;
      }

      let latest: DerivedCheckpointRecord | undefined;
      for (const file of files) {
        const record = await readJsonFile<CheckpointRecordLike>(path.join(checkpointsDir, file));
        if (!record.runSnapshot || typeof record.seq !== "number" || !Number.isFinite(record.seq)) {
          continue;
        }

        const candidate: DerivedCheckpointRecord = {
          seq: record.seq,
          createdAt: toOptionalString(record.createdAt),
          runSnapshot: normalizeRunRecord(record.runSnapshot)
        };
        if (!latest || compareCheckpointFreshness(candidate, latest) > 0) {
          latest = candidate;
        }
      }

      return latest;
    } catch {
      return undefined;
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
    memoryRefs: run.memoryRefs ?? {
      runContextPath: `.autolabos/runs/${run.id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${run.id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${run.id}/memory/episodes.jsonl`
    }
  };
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

interface DerivedRunDetails {
  contextEntries: Map<string, RunContextItem>;
  collectResultFile: DerivedJsonFile<CollectResultLike>;
  analysisManifest: DerivedJsonFile<AnalysisManifestLike>;
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
  const currentNote = run.graph.nodeStates[run.currentNode]?.note?.trim();
  if (currentNote) {
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
