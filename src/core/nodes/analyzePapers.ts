import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonlItems, runArtifactsDir, safeRead } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { readJsonFile, writeJsonFile } from "../../utils/fs.js";
import {
  analyzePaperWithLlm,
  analyzePaperWithResponsesPdf,
  PaperEvidenceRow,
  PaperSummaryRow,
  shouldFallbackResponsesPdfToLocalText
} from "../analysis/paperAnalyzer.js";
import {
  AnalysisCorpusRow,
  resolvePaperPdfUrl,
  resolvePaperTextSource
} from "../analysis/paperText.js";
import {
  AnalysisSelectionRequest,
  DeterministicScoreBreakdown,
  normalizeAnalysisSelectionRequest,
  PaperSelectionResult,
  selectPapersForAnalysis
} from "../analysis/paperSelection.js";

interface AnalysisManifest {
  version: 2;
  updatedAt: string;
  request: AnalysisSelectionRequest;
  selectionFingerprint: string;
  totalCandidates: number;
  candidatePoolSize: number;
  selectedPaperIds: string[];
  rerankedPaperIds: string[];
  deterministicRankingPreview: Array<{
    paper_id: string;
    title: string;
    deterministic_score: number;
    score_breakdown: DeterministicScoreBreakdown;
  }>;
  papers: Record<string, AnalysisManifestEntry>;
}

interface AnalysisManifestEntry {
  paper_id: string;
  title: string;
  status: "pending" | "completed" | "failed" | "skipped";
  selected: boolean;
  rank?: number;
  source_type?: "full_text" | "abstract";
  summary_count: number;
  evidence_count: number;
  analysis_attempts: number;
  analysis_mode?: "codex_text_extract" | "responses_api_pdf";
  pdf_url?: string;
  pdf_cache_path?: string;
  text_cache_path?: string;
  fallback_reason?: string;
  last_error?: string;
  has_table_references?: boolean;
  table_reference_count?: number;
  has_figure_references?: boolean;
  figure_reference_count?: number;
  deterministic_score?: number;
  selection_score?: number;
  score_breakdown?: DeterministicScoreBreakdown;
  rerank_position?: number;
  updatedAt: string;
  completedAt?: string;
}

export function createAnalyzePapersNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "analyze_papers",
    async execute({ run, abortSignal }) {
      const emitLog = (text: string) => {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "analyze_papers",
          payload: {
            text
          }
        });
      };
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const corpusRows = await readCorpusRows(run.id);
      const analysisMode = deps.config.analysis.pdf_mode;
      const artifactsRoot = runArtifactsDir(run);
      const manifestPath = path.join(artifactsRoot, "analysis_manifest.json");
      const summaryPath = path.join(artifactsRoot, "paper_summaries.jsonl");
      const evidencePath = path.join(artifactsRoot, "evidence_store.jsonl");

      const request = await loadAnalysisSelectionRequest(runContextMemory);
      await runContextMemory.put("analyze_papers.request", request);

      emitLog(
        request.selectionMode === "top_n" && request.topN
          ? `Ranking ${corpusRows.length} papers and selecting the top ${request.topN} for analysis.`
          : `Analyzing all ${corpusRows.length} collected papers.`
      );

      const selection = await selectPapersForAnalysis({
        llm: deps.llm,
        runTitle: run.title,
        runTopic: run.topic,
        corpusRows,
        request,
        onProgress: (text) => emitLog(text),
        abortSignal
      });

      deps.eventStream.emit({
        type: "PLAN_CREATED",
        runId: run.id,
        node: "analyze_papers",
        payload: {
          selectionMode: selection.request.selectionMode,
          selectedCount: selection.selectedPaperIds.length,
          totalCandidates: selection.totalCandidates,
          candidatePoolSize: selection.candidatePoolSize,
          rerankApplied: selection.rerankApplied
        }
      });

      if (selection.rerankFallbackReason) {
        emitLog(`LLM rerank unavailable, falling back to deterministic order (${selection.rerankFallbackReason}).`);
      } else if (selection.rerankApplied) {
        emitLog(`Hybrid rerank selected ${selection.selectedPaperIds.length} paper(s) from ${selection.totalCandidates} candidate(s).`);
      }
      if (selection.deterministicRankingPreview.length > 0) {
        emitLog(
          `Ranking preview: ${selection.deterministicRankingPreview
            .slice(0, 3)
            .map((row) => `${row.paper_id}=${row.deterministic_score}`)
            .join(", ")}`
        );
      }

      const selectedRows = selection.selectedPaperIds
        .map((paperId) => corpusRows.find((row) => row.paper_id === paperId))
        .filter((row): row is AnalysisCorpusRow => Boolean(row));

      if (
        analysisMode === "responses_api_pdf" &&
        selectedRows.some((row) => Boolean(resolvePaperPdfUrl(row))) &&
        !(await deps.responsesPdfAnalysis.hasApiKey())
      ) {
        return {
          status: "failure",
          summary: "Responses API PDF analysis is selected, but OPENAI_API_KEY is not configured.",
          error: "OPENAI_API_KEY is required when PDF analysis mode is set to Responses API.",
          toolCallsUsed: 0
        };
      }

      const existingManifest = await readExistingManifest(manifestPath);
      let manifest =
        existingManifest && existingManifest.selectionFingerprint === selection.selectionFingerprint
          ? existingManifest
          : undefined;

      if (!manifest && !existingManifest && selection.request.selectionMode === "all") {
        manifest = await bootstrapManifestFromExistingOutputs(selection, summaryPath, evidencePath);
        await writeJsonFile(manifestPath, manifest);
      }

      if (!manifest) {
        await resetAnalysisOutputs(summaryPath, evidencePath);
        manifest = createFreshManifest(selection);
        await writeJsonFile(manifestPath, manifest);
      }

      const pendingRows = selectedRows.filter((row) => manifest!.papers[row.paper_id]?.status !== "completed");
      const analysisConcurrency = getAnalysisConcurrency(analysisMode);
      if (pendingRows.length > 0) {
        emitLog(`Analyzing ${pendingRows.length} paper(s) with concurrency ${analysisConcurrency}.`);
      }
      let failedCount = 0;
      const persistQueue = createAsyncQueue();

      await runWithConcurrency(pendingRows, analysisConcurrency, async (row, index) => {
        emitLog(`Analyzing paper ${index + 1}/${pendingRows.length}: "${row.title}".`);
        emitLog(`Resolving analysis source ${index + 1}/${pendingRows.length} for "${row.title}".`);

        deps.eventStream.emit({
          type: "TOOL_CALLED",
          runId: run.id,
          node: "analyze_papers",
          payload: {
            tool: "analyze_paper",
            paper_id: row.paper_id
          }
        });

        const pdfUrl = resolvePaperPdfUrl(row);
        const useResponsesPdf = analysisMode === "responses_api_pdf" && Boolean(pdfUrl);
        let source = useResponsesPdf
          ? {
              sourceType: "full_text" as const,
              text: row.abstract || row.title,
              fullTextAvailable: true,
              pdfUrl
            }
          : await resolvePaperTextSource({
              runId: run.id,
              paper: row,
              abortSignal,
              onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
            });

        let analysisModeUsed: "responses_api_pdf" | "codex_text_extract" = useResponsesPdf
          ? "responses_api_pdf"
          : "codex_text_extract";

        emitLog(
          useResponsesPdf
            ? `Using Responses API PDF input for "${row.title}".`
            : source.sourceType === "full_text"
              ? `Using full text for "${row.title}".`
              : `Falling back to abstract for "${row.title}" (${source.fallbackReason || "no full text"}).`
        );

        try {
          let analysis;
          if (useResponsesPdf && pdfUrl) {
            try {
              analysis = await analyzePaperWithResponsesPdf({
                client: deps.responsesPdfAnalysis,
                paper: row,
                pdfUrl,
                model: deps.config.analysis.responses_model,
                maxAttempts: 2,
                abortSignal,
                onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
              });
            } catch (error) {
              if (!shouldFallbackResponsesPdfToLocalText(error)) {
                throw error;
              }
              const reason = error instanceof Error ? error.message : String(error);
              emitLog(
                `[${row.paper_id}] Responses API could not download the remote PDF (${reason}). Falling back to local PDF download/text extraction.`
              );
              source = await resolvePaperTextSource({
                runId: run.id,
                paper: row,
                abortSignal,
                onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
              });
              analysisModeUsed = "codex_text_extract";
              emitLog(
                source.sourceType === "full_text"
                  ? `Using locally extracted full text for "${row.title}" after Responses API fallback.`
                  : `Falling back to abstract for "${row.title}" after Responses API fallback (${source.fallbackReason || "no full text"}).`
              );
              analysis = await analyzePaperWithLlm({
                llm: deps.llm,
                paper: row,
                source,
                maxAttempts: 2,
                abortSignal,
                onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
              });
            }
          } else {
            analysis = await analyzePaperWithLlm({
              llm: deps.llm,
              paper: row,
              source,
              maxAttempts: 2,
              abortSignal,
              onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
            });
          }

          await persistQueue.run(async () => {
            await appendJsonlItems(run, "paper_summaries.jsonl", [analysis.summaryRow]);
            await appendJsonlItems(run, "evidence_store.jsonl", analysis.evidenceRows);
            emitLog(
              `Persisted analysis outputs for "${row.title}" (1 summary row, ${analysis.evidenceRows.length} evidence row(s)).`
            );
            const structureSignals = analyzeStructureSignals(source.text);

            const manifestEntry = manifest.papers[row.paper_id];
            manifest.papers[row.paper_id] = {
              ...manifestEntry,
              paper_id: row.paper_id,
              title: row.title,
              status: "completed",
              selected: true,
              source_type: source.sourceType,
              summary_count: 1,
              evidence_count: analysis.evidenceRows.length,
              analysis_attempts: analysis.attempts,
              analysis_mode: analysisModeUsed,
              pdf_url: source.pdfUrl,
              pdf_cache_path: source.pdfCachePath,
              text_cache_path: source.textCachePath,
              fallback_reason: source.fallbackReason,
              last_error: undefined,
              has_table_references: structureSignals.tableReferenceCount > 0,
              table_reference_count: structureSignals.tableReferenceCount,
              has_figure_references: structureSignals.figureReferenceCount > 0,
              figure_reference_count: structureSignals.figureReferenceCount,
              updatedAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            };
            manifest.updatedAt = new Date().toISOString();
            await writeJsonFile(manifestPath, manifest);
          });

          emitLog(`Analyzed "${row.title}" (${analysis.evidenceRows.length} evidence item(s), source=${source.sourceType}).`);
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          failedCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          await persistQueue.run(async () => {
            const manifestEntry = manifest.papers[row.paper_id];
            manifest.papers[row.paper_id] = {
              ...manifestEntry,
              paper_id: row.paper_id,
              title: row.title,
              status: "failed",
              selected: true,
              source_type: source.sourceType,
              summary_count: 0,
              evidence_count: 0,
              analysis_attempts: 2,
              analysis_mode: analysisModeUsed,
              pdf_url: source.pdfUrl,
              pdf_cache_path: source.pdfCachePath,
              text_cache_path: source.textCachePath,
              fallback_reason: source.fallbackReason,
              last_error: message,
              has_table_references: false,
              table_reference_count: 0,
              has_figure_references: false,
              figure_reference_count: 0,
              updatedAt: new Date().toISOString()
            };
            manifest.updatedAt = new Date().toISOString();
            await writeJsonFile(manifestPath, manifest);
            deps.eventStream.emit({
              type: "TEST_FAILED",
              runId: run.id,
              node: "analyze_papers",
              payload: {
                text: `Analysis failed for "${row.title}": ${message}`,
                error: message
              }
            });
          });
        }
      });

      await persistQueue.onIdle();

      const summaryRows = await readSummaryRows(summaryPath);
      const evidenceRows = await readEvidenceRows(evidencePath);
      const fullTextCount = summaryRows.filter((row) => row.source_type === "full_text").length;
      const abstractFallbackCount = summaryRows.filter((row) => row.source_type === "abstract").length;

      await runContextMemory.put("analyze_papers.summary_count", summaryRows.length);
      await runContextMemory.put("analyze_papers.evidence_count", evidenceRows.length);
      await runContextMemory.put("analyze_papers.full_text_count", fullTextCount);
      await runContextMemory.put("analyze_papers.abstract_fallback_count", abstractFallbackCount);
      await runContextMemory.put("analyze_papers.selected_count", selection.selectedPaperIds.length);
      await runContextMemory.put("analyze_papers.total_candidates", selection.totalCandidates);
      await runContextMemory.put("analyze_papers.selection_fingerprint", selection.selectionFingerprint);
      emitLog(
        `Analysis totals: summaries=${summaryRows.length}, evidence=${evidenceRows.length}, full_text=${fullTextCount}, abstract_fallback=${abstractFallbackCount}.`
      );

      if (failedCount > 0) {
        return {
          status: "failure",
          summary:
            request.selectionMode === "top_n" && request.topN
              ? `Analyzed ${summaryRows.length}/${selection.selectedPaperIds.length} selected papers from ${selection.totalCandidates} candidates; ${failedCount} failed and can be retried.`
              : `Analyzed ${summaryRows.length}/${corpusRows.length} papers, ${failedCount} failed and can be retried.`,
          error: `Analysis incomplete: ${failedCount} paper(s) failed validation or LLM extraction.`,
          toolCallsUsed: Math.max(1, pendingRows.length)
        };
      }

      return {
        status: "success",
        summary:
          request.selectionMode === "top_n" && request.topN
            ? `Analyzed top ${selection.selectedPaperIds.length}/${selection.totalCandidates} ranked papers into ${evidenceRows.length} evidence item(s); ${fullTextCount} full-text and ${abstractFallbackCount} abstract fallback (mode=${analysisMode}).`
            : `Analyzed ${summaryRows.length} papers into ${evidenceRows.length} evidence item(s); ${fullTextCount} full-text and ${abstractFallbackCount} abstract fallback (mode=${analysisMode}).`,
        needsApproval: true,
        toolCallsUsed: Math.max(1, pendingRows.length)
      };
    }
  };
}

function getAnalysisConcurrency(analysisMode: "codex_text_extract" | "responses_api_pdf"): number {
  return analysisMode === "responses_api_pdf" ? 2 : 3;
}

function createAsyncQueue() {
  let tail = Promise.resolve();
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    async onIdle(): Promise<void> {
      await tail;
    }
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;

  const runners = Array.from({ length: normalizedConcurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

async function loadAnalysisSelectionRequest(runContextMemory: RunContextMemory): Promise<AnalysisSelectionRequest> {
  const stored = await runContextMemory.get<{ topN?: unknown; selectionMode?: unknown; selectionPolicy?: unknown }>(
    "analyze_papers.request"
  );
  const topN =
    typeof stored?.topN === "number" && Number.isFinite(stored.topN) && stored.topN > 0
      ? Math.floor(stored.topN)
      : null;
  return normalizeAnalysisSelectionRequest(topN);
}

async function readCorpusRows(runId: string): Promise<AnalysisCorpusRow[]> {
  const corpusPath = path.join(".autoresearch", "runs", runId, "corpus.jsonl");
  const corpusText = await safeRead(corpusPath);
  return corpusText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as AnalysisCorpusRow;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is AnalysisCorpusRow => Boolean(row?.paper_id));
}

async function readExistingManifest(manifestPath: string): Promise<AnalysisManifest | undefined> {
  try {
    const manifest = await readJsonFile<AnalysisManifest>(manifestPath);
    if (manifest?.version === 2 && manifest.papers && typeof manifest.papers === "object") {
      return manifest;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function createFreshManifest(selection: PaperSelectionResult): AnalysisManifest {
  const now = new Date().toISOString();
  return {
    version: 2,
    updatedAt: now,
    request: selection.request,
    selectionFingerprint: selection.selectionFingerprint,
    totalCandidates: selection.totalCandidates,
    candidatePoolSize: selection.candidatePoolSize,
    selectedPaperIds: selection.selectedPaperIds,
    rerankedPaperIds: selection.rerankedPaperIds,
    deterministicRankingPreview: selection.deterministicRankingPreview,
    papers: Object.fromEntries(
      selection.rankedCandidates.map((candidate) => [
        candidate.paper.paper_id,
        {
          paper_id: candidate.paper.paper_id,
          title: candidate.paper.title,
          status: candidate.selected ? "pending" : "skipped",
          selected: candidate.selected,
          rank: candidate.rank,
          summary_count: 0,
          evidence_count: 0,
          analysis_attempts: 0,
          deterministic_score: candidate.deterministicScore,
          selection_score: candidate.selectionScore,
          score_breakdown: candidate.scoreBreakdown,
          rerank_position: candidate.rerankPosition,
          has_table_references: false,
          table_reference_count: 0,
          has_figure_references: false,
          figure_reference_count: 0,
          updatedAt: now
        } satisfies AnalysisManifestEntry
      ])
    )
  };
}

async function resetAnalysisOutputs(summaryPath: string, evidencePath: string): Promise<void> {
  await fs.rm(summaryPath, { force: true });
  await fs.rm(evidencePath, { force: true });
}

async function bootstrapManifestFromExistingOutputs(
  selection: PaperSelectionResult,
  summaryPath: string,
  evidencePath: string
): Promise<AnalysisManifest> {
  const manifest = createFreshManifest(selection);
  const summaries = await readSummaryRows(summaryPath);
  const evidences = await readEvidenceRows(evidencePath);
  const evidenceCountByPaper = new Map<string, number>();

  for (const evidence of evidences) {
    evidenceCountByPaper.set(evidence.paper_id, (evidenceCountByPaper.get(evidence.paper_id) ?? 0) + 1);
  }

  for (const summary of summaries) {
    const entry = manifest.papers[summary.paper_id];
    if (!entry || !entry.selected) {
      continue;
    }
    manifest.papers[summary.paper_id] = {
      ...entry,
      status: "completed",
      source_type: summary.source_type,
      summary_count: 1,
      evidence_count: evidenceCountByPaper.get(summary.paper_id) ?? 0,
      analysis_attempts: 1,
      analysis_mode: "codex_text_extract",
      has_table_references: false,
      table_reference_count: 0,
      has_figure_references: false,
      figure_reference_count: 0,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
  }

  return manifest;
}

async function readSummaryRows(filePath: string): Promise<PaperSummaryRow[]> {
  const raw = await safeRead(filePath);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PaperSummaryRow;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is PaperSummaryRow => Boolean(row?.paper_id));
}

async function readEvidenceRows(filePath: string): Promise<PaperEvidenceRow[]> {
  const raw = await safeRead(filePath);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PaperEvidenceRow;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is PaperEvidenceRow => Boolean(row?.paper_id));
}

function analyzeStructureSignals(text: string): {
  tableReferenceCount: number;
  figureReferenceCount: number;
} {
  const normalized = text.replace(/\s+/g, " ");
  const tableMatches =
    normalized.match(/\btable(?:s)?\.?\s*(?:\d+|[ivxlcdm]+)\b/giu) ?? [];
  const figureMatches =
    normalized.match(/\b(?:fig(?:ure)?(?:s)?\.?)\s*(?:\d+|[ivxlcdm]+)\b/giu) ?? [];
  return {
    tableReferenceCount: tableMatches.length,
    figureReferenceCount: figureMatches.length
  };
}
