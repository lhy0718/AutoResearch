import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, appendJsonlItems, runArtifactsDir, safeRead } from "./helpers.js";
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
  ResolvedPaperSource,
  resolvePaperPdfUrl,
  resolvePaperTextSource
} from "../analysis/paperText.js";
import {
  AnalysisSelectionRequest,
  buildSelectionFingerprint,
  buildSelectionRequestFingerprint,
  DeterministicScoreBreakdown,
  normalizeAnalysisSelectionRequest,
  PaperSelectionResult,
  RankedPaperCandidate,
  selectPapersForAnalysis
} from "../analysis/paperSelection.js";
import { TransitionRecommendation } from "../../types.js";

interface AnalysisManifest {
  version: 2 | 3;
  updatedAt: string;
  request: AnalysisSelectionRequest;
  selectionFingerprint: string;
  selectionRequestFingerprint?: string;
  analysisFingerprint?: string;
  corpusFingerprint?: string;
  totalCandidates: number;
  candidatePoolSize: number;
  rerankApplied?: boolean;
  rerankFallbackReason?: string;
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
  analysis_mode?: "codex_text_image_hybrid" | "responses_api_pdf";
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

const MAX_AUTO_SELECTION_EXPANSIONS = 2;
const DEFAULT_SAFE_ANALYSIS_TOP_N = 30;
const MIN_SELECTION_GUARD_ANCHORS = 2;

const SELECTION_QUALITY_STOPWORDS = new Set([
  "a",
  "an",
  "analysis",
  "and",
  "approach",
  "benchmark",
  "benchmarks",
  "comparison",
  "comparisons",
  "dataset",
  "datasets",
  "evaluation",
  "for",
  "from",
  "in",
  "method",
  "methods",
  "of",
  "on",
  "paper",
  "public",
  "research",
  "results",
  "small",
  "study",
  "task",
  "tasks",
  "the",
  "toward",
  "using",
  "with"
]);

const SELECTION_QUALITY_GENERIC_TOKENS = new Set([
  "classification",
  "classifications",
  "classifier",
  "classifiers",
  "data",
  "dataset",
  "datasets",
  "deep",
  "learning",
  "machine",
  "model",
  "models",
  "prediction",
  "predictions",
  "predictive",
  "system",
  "systems"
]);

interface LoadedAnalysisSelectionRequest {
  request: AnalysisSelectionRequest;
  autoDefaultReason?: string;
}

interface AnalysisQuarantineRow {
  paper_id: string;
  title: string;
  reason: string;
  source_type: "full_text" | "abstract";
  analysis_mode: "codex_text_image_hybrid" | "responses_api_pdf";
  fallback_reason?: string;
  summary_preview?: string;
  source_excerpt?: string;
  createdAt: string;
}

interface SelectedFailureSummary {
  failedEntries: AnalysisManifestEntry[];
  usageLimitEntries: AnalysisManifestEntry[];
  environmentBlockedEntries: AnalysisManifestEntry[];
  sourceMismatchEntries: AnalysisManifestEntry[];
  cleanedMessages: string[];
}

interface SelectionQualityGuardResult {
  selection: PaperSelectionResult;
  applied: boolean;
  droppedPaperIds: string[];
  addedPaperIds: string[];
  reason?: string;
}

interface SelectionRetargetResult {
  manifest: AnalysisManifest;
  summaryRows: PaperSummaryRow[];
  evidenceRows: PaperEvidenceRow[];
  preservedCompletedPaperIds: string[];
  droppedPaperIds: string[];
  logMessage: string;
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
      const corpusFingerprint = buildCorpusFingerprint(corpusRows);
      const analysisMode = deps.config.analysis.pdf_mode;
      const artifactsRoot = runArtifactsDir(run);
      const manifestPath = path.join(artifactsRoot, "analysis_manifest.json");
      const summaryPath = path.join(artifactsRoot, "paper_summaries.jsonl");
      const evidencePath = path.join(artifactsRoot, "evidence_store.jsonl");

      const initialManifest = await readExistingManifest(manifestPath);
      const loadedRequest = await loadAnalysisSelectionRequest(
        runContextMemory,
        corpusRows.length,
        initialManifest?.request
      );
      let request = loadedRequest.request;
      if (loadedRequest.autoDefaultReason) {
        emitLog(loadedRequest.autoDefaultReason);
      }
      const includePageImages = deps.config.providers?.llm_mode === "codex_chatgpt_only";
      const analysisFingerprint = buildAnalysisFingerprint({
        analysisMode,
        responsesModel: deps.config.analysis.responses_model,
        responsesReasoningEffort: deps.config.analysis.responses_reasoning_effort,
        includePageImages
      });
      let autoExpansionCount = 0;
      let autoExpansionReason: string | undefined;
      const startedWithExistingManifest = Boolean(initialManifest);

      while (true) {
        await runContextMemory.put("analyze_papers.request", request);
        const selectionRequestFingerprint = buildSelectionRequestFingerprint(request, run.title, run.topic);
        const existingManifest = await readExistingManifest(manifestPath);
        const reuseCachedSelection = canReuseManifestSelection(
          existingManifest,
          request,
          selectionRequestFingerprint,
          analysisFingerprint,
          corpusFingerprint,
          corpusRows
        );

        const rawSelection = reuseCachedSelection
          ? restoreSelectionFromManifest(existingManifest as AnalysisManifest, corpusRows)
          : await (async () => {
              emitLog(
                request.selectionMode === "top_n" && request.topN
                  ? `Ranking ${corpusRows.length} papers and selecting the top ${request.topN} for analysis.`
                  : `Analyzing all ${corpusRows.length} collected papers.`
              );
              return selectPapersForAnalysis({
                llm: deps.llm,
                runTitle: run.title,
                runTopic: run.topic,
                corpusRows,
                request,
                onProgress: (text) => emitLog(text),
                abortSignal
              });
            })();
        const selectionGuard = applySelectionQualitySafeguards({
          selection: rawSelection,
          runTitle: run.title,
          runTopic: run.topic
        });
        const selection = selectionGuard.selection;

        if (existingManifest && reuseCachedSelection) {
          emitLog(
            request.selectionMode === "top_n" && request.topN
              ? `Reusing cached paper rerank from analysis_manifest.json for top ${request.topN}; skipping a new LLM rerank.`
              : "Reusing cached paper selection from analysis_manifest.json."
          );
        }
        if (selectionGuard.applied && selectionGuard.reason) {
          emitLog(selectionGuard.reason);
        }
        if (rawSelection.selectedPaperIds.length > 0 && selection.selectedPaperIds.length === 0) {
          emitLog(
            `Selection quality safeguard removed all ${rawSelection.selectedPaperIds.length} initially selected paper(s); pausing for manual review instead of analyzing an off-topic set.`
          );
          return {
            status: "success",
            summary:
              request.selectionMode === "top_n" && request.topN
                ? `analyze_papers paused because the top ${request.topN} selection candidates did not match the research-specific anchors strongly enough after fallback safeguards.`
                : "analyze_papers paused because the selected papers did not match the research-specific anchors strongly enough after fallback safeguards.",
            needsApproval: true,
            toolCallsUsed: 0,
            transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
              runId: run.id,
              reason:
                "analyze_papers rejected the current selected paper set because the fallback/off-topic safeguard found no candidate that matched the research-specific anchors strongly enough.",
              confidence: 0.95,
              evidence: [
                `${rawSelection.selectedPaperIds.length} initially selected paper(s) were filtered by the selection quality guard.`,
                selectionGuard.reason || "No guard reason recorded.",
                `Research title/topic: ${run.title || run.topic}`
              ],
              suggestedCommands: [`/agent run analyze_papers ${run.id}`, "/model"]
            })
          };
        }

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

        const canExtendExistingManifest = Boolean(
          existingManifest && canExtendManifestForExpandedSelection(existingManifest, selection, analysisFingerprint)
        );
        const canRetargetExistingManifest = Boolean(
          existingManifest &&
            canRetargetManifestForSelectionChange(
              existingManifest,
              selection,
              analysisFingerprint,
              selectionRequestFingerprint,
              corpusFingerprint
            )
        );
        let existingSummaryRows = await readSummaryRows(summaryPath);
        let existingEvidenceRows = await readEvidenceRows(evidencePath);
        const retargetedSelection =
          canRetargetExistingManifest && existingManifest
            ? retargetManifestForSelectionChange(
                existingManifest,
                selection,
                existingSummaryRows,
                existingEvidenceRows,
                analysisFingerprint,
                selectionRequestFingerprint,
                corpusFingerprint
              )
            : undefined;
        if (retargetedSelection) {
          existingSummaryRows = retargetedSelection.summaryRows;
          existingEvidenceRows = retargetedSelection.evidenceRows;
        }
        const resetReason =
          existingManifest && existingManifest.selectionFingerprint !== selection.selectionFingerprint
            ? "selection_changed"
            : existingManifest && !existingManifest.analysisFingerprint
              ? "legacy_manifest"
              : existingManifest && existingManifest.analysisFingerprint !== analysisFingerprint
                ? "analysis_config_changed"
                : undefined;
        const preservedSelectionRegression = shouldPreservePartialArtifactsOnSelectionRegression({
          runId: run.id,
          existingManifest,
          selection,
          resetReason,
          selectionRequestFingerprint,
          analysisFingerprint,
          corpusFingerprint,
          existingSummaryRows,
          existingEvidenceRows
        });
        if (preservedSelectionRegression) {
          emitLog(preservedSelectionRegression.logMessage);
          const progress = buildAnalysisProgress(existingSummaryRows, existingEvidenceRows);
          await syncAnalysisProgress(runContextMemory, {
            runContextPath: run.memoryRefs.runContextPath,
            summaryRows: existingSummaryRows,
            evidenceRows: existingEvidenceRows,
            selectedCount: existingManifest?.selectedPaperIds.length ?? progress.summaryRows.length,
            totalCandidates: existingManifest?.totalCandidates ?? selection.totalCandidates,
            selectionFingerprint: existingManifest?.selectionFingerprint ?? selection.selectionFingerprint
          });
          await runContextMemory.put("analyze_papers.auto_expand_count", autoExpansionCount);
          await runContextMemory.put("analyze_papers.auto_expand_reason", autoExpansionReason || null);
          emitLog(
            `Analysis totals: summaries=${progress.summaryRows.length}, evidence=${progress.evidenceRows.length}, full_text=${progress.fullTextCount}, abstract_fallback=${progress.abstractFallbackCount}.`
          );
          return {
            status: "success",
            summary: preservedSelectionRegression.summary,
            needsApproval: true,
            toolCallsUsed: 0,
            transitionRecommendation: preservedSelectionRegression.transitionRecommendation
          };
        }
        let manifest =
          existingManifest &&
          existingManifest.selectionFingerprint === selection.selectionFingerprint &&
          existingManifest.analysisFingerprint === analysisFingerprint
            ? existingManifest
            : canExtendExistingManifest && existingManifest
              ? extendManifestForExpandedSelection(
                  existingManifest,
                  selection,
                  analysisFingerprint,
                  selectionRequestFingerprint,
                  corpusFingerprint
                )
              : retargetedSelection?.manifest;

        if (!manifest && !existingManifest && selection.request.selectionMode === "all") {
          manifest = await bootstrapManifestFromExistingOutputs(
            selection,
            summaryPath,
            evidencePath,
            analysisFingerprint,
            selectionRequestFingerprint,
            corpusFingerprint
          );
          await writeJsonFile(manifestPath, manifest);
        }

        if (!manifest) {
          if (resetReason === "selection_changed") {
            emitLog("Analysis selection changed since the previous run. Resetting summaries/evidence for the new paper set.");
          } else if (resetReason === "legacy_manifest") {
            emitLog("Existing analysis manifest lacks configuration fingerprint metadata. Resetting summaries/evidence to rebuild a consistent analysis state.");
          } else if (resetReason === "analysis_config_changed") {
            emitLog("Analysis settings changed since the previous run. Resetting summaries/evidence and re-analyzing the selected papers.");
          }
          await resetAnalysisOutputs(summaryPath, evidencePath);
          existingSummaryRows = [];
          existingEvidenceRows = [];
          manifest = createFreshManifest(selection, analysisFingerprint, selectionRequestFingerprint, corpusFingerprint);
          await writeJsonFile(manifestPath, manifest);
        } else if (canExtendExistingManifest && existingManifest) {
          emitLog(
            `Expanding analysis selection from top ${existingManifest.selectedPaperIds.length} to top ${selection.selectedPaperIds.length}; preserving completed analyses and queueing only the new papers.`
          );
          await writeJsonFile(manifestPath, manifest);
        } else if (retargetedSelection) {
          emitLog(retargetedSelection.logMessage);
          await appendJsonl(run, "paper_summaries.jsonl", existingSummaryRows);
          await appendJsonl(run, "evidence_store.jsonl", existingEvidenceRows);
          await writeJsonFile(manifestPath, manifest);
        }

        const reconciledState = reconcileManifestWithOutputs(manifest, existingSummaryRows, existingEvidenceRows);
        manifest = reconciledState.manifest;
        if (reconciledState.changed) {
          if (reconciledState.requeuedPaperIds.length > 0 || reconciledState.droppedSummaryRows > 0 || reconciledState.droppedEvidenceRows > 0) {
            emitLog(
              `Detected inconsistent analysis artifacts. Re-queueing ${reconciledState.requeuedPaperIds.length} completed paper(s) and pruning ${reconciledState.droppedSummaryRows} summary row(s) / ${reconciledState.droppedEvidenceRows} evidence row(s).`
            );
          } else {
            emitLog("Reconciled analysis manifest metadata with the persisted summaries/evidence.");
          }
          await appendJsonl(run, "paper_summaries.jsonl", reconciledState.summaryRows);
          await appendJsonl(run, "evidence_store.jsonl", reconciledState.evidenceRows);
          await writeJsonFile(manifestPath, manifest);
        }
        let summaryRowsState = reconciledState.summaryRows;
        let evidenceRowsState = reconciledState.evidenceRows;
        await syncAnalysisProgress(runContextMemory, {
          runContextPath: run.memoryRefs.runContextPath,
          summaryRows: summaryRowsState,
          evidenceRows: evidenceRowsState,
          selectedCount: selection.selectedPaperIds.length,
          totalCandidates: selection.totalCandidates,
          selectionFingerprint: selection.selectionFingerprint
        });
        await syncAnalyzeRunRecord({
          runStore: deps.runStore,
          runId: run.id,
          summary: buildAnalyzeProgressSummary({
            request,
            selectedCount: selection.selectedPaperIds.length,
            totalCandidates: selection.totalCandidates,
            progress: buildAnalysisProgress(summaryRowsState, evidenceRowsState),
            failedCount: 0,
            analysisMode
          })
        });

        const pendingRows = selectedRows.filter((row) => manifest!.papers[row.paper_id]?.status !== "completed");
        const previousFailedPaperIds = getSelectedFailedPaperIds(manifest);
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
              includePageImages,
              abortSignal,
              onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
            });

        let analysisModeUsed: "responses_api_pdf" | "codex_text_image_hybrid" = useResponsesPdf
          ? "responses_api_pdf"
          : "codex_text_image_hybrid";
        let analysisAttempts = 0;
        let quarantineRecord: AnalysisQuarantineRow | undefined;

        emitLog(
          useResponsesPdf
            ? `Using Responses API PDF input for "${row.title}".`
            : source.sourceType === "full_text"
              ? source.pageImagePaths && source.pageImagePaths.length > 0
                ? `Using full text plus ${source.pageImagePaths.length} rendered PDF page image(s) for "${row.title}".`
                : `Using full text for "${row.title}".`
              : source.pageImagePaths && source.pageImagePaths.length > 0
                ? `Falling back to abstract plus ${source.pageImagePaths.length} rendered PDF page image(s) for "${row.title}" (${source.fallbackReason || "no full text"}).`
              : `Falling back to abstract for "${row.title}" (${source.fallbackReason || "no full text"}).`
        );

        try {
          const sourceMismatchError = validateResolvedSourceIdentity(row, source);
          if (sourceMismatchError) {
            quarantineRecord = buildAnalysisQuarantineRow({
              paper: row,
              source,
              analysisMode: analysisModeUsed,
              reason: sourceMismatchError
            });
            throw new Error(sourceMismatchError);
          }

          let analysis;
          if (useResponsesPdf && pdfUrl) {
            try {
              analysis = await analyzePaperWithResponsesPdf({
                client: deps.responsesPdfAnalysis,
                paper: row,
                pdfUrl,
                model: deps.config.analysis.responses_model,
                reasoningEffort: deps.config.analysis.responses_reasoning_effort,
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
                `[${row.paper_id}] Responses API could not download the remote PDF (${reason}). Falling back to local PDF download/text-plus-image analysis.`
              );
              source = await resolvePaperTextSource({
                runId: run.id,
                paper: row,
                includePageImages,
                abortSignal,
                onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
              });
              analysisModeUsed = "codex_text_image_hybrid";
              const fallbackSourceMismatchError = validateResolvedSourceIdentity(row, source);
              if (fallbackSourceMismatchError) {
                quarantineRecord = buildAnalysisQuarantineRow({
                  paper: row,
                  source,
                  analysisMode: analysisModeUsed,
                  reason: fallbackSourceMismatchError
                });
                throw new Error(fallbackSourceMismatchError);
              }
              emitLog(
                source.sourceType === "full_text"
                  ? source.pageImagePaths && source.pageImagePaths.length > 0
                    ? `Using locally extracted full text plus ${source.pageImagePaths.length} rendered PDF page image(s) for "${row.title}" after Responses API fallback.`
                    : `Using locally extracted full text for "${row.title}" after Responses API fallback.`
                  : source.pageImagePaths && source.pageImagePaths.length > 0
                    ? `Falling back to abstract plus ${source.pageImagePaths.length} rendered PDF page image(s) for "${row.title}" after Responses API fallback (${source.fallbackReason || "no full text"}).`
                  : `Falling back to abstract for "${row.title}" after Responses API fallback (${source.fallbackReason || "no full text"}).`
              );
              analysis = await analyzePaperWithLlm({
                llm: source.sourceType === "full_text" ? deps.pdfTextLlm : deps.llm,
                paper: row,
                source,
                maxAttempts: 2,
                abortSignal,
                onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
              });
            }
          } else {
            analysis = await analyzePaperWithLlm({
              llm: source.sourceType === "full_text" ? deps.pdfTextLlm : deps.llm,
              paper: row,
              source,
              maxAttempts: 2,
              abortSignal,
              onProgress: (text) => emitLog(`[${row.paper_id}] ${text}`)
            });
          }
          analysisAttempts = analysis.attempts;
          const analysisMismatchError = validateAnalysisBeforePersist(row, source, analysis);
          if (analysisMismatchError) {
            quarantineRecord = buildAnalysisQuarantineRow({
              paper: row,
              source,
              analysis,
              analysisMode: analysisModeUsed,
              reason: analysisMismatchError
            });
            throw new Error(analysisMismatchError);
          }

          await persistQueue.run(async () => {
            const structureSignals = analyzeStructureSignals(source.text);
            const nextSummaryRowsState = replaceSummaryRow(summaryRowsState, analysis.summaryRow);
            const nextEvidenceRowsState = replaceEvidenceRowsForPaper(evidenceRowsState, row.paper_id, analysis.evidenceRows);
            const nextManifest: AnalysisManifest = {
              ...manifest,
              papers: { ...manifest.papers }
            };

            const manifestEntry = manifest.papers[row.paper_id];
            nextManifest.papers[row.paper_id] = {
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
            nextManifest.updatedAt = new Date().toISOString();
            await appendJsonl(run, "paper_summaries.jsonl", nextSummaryRowsState);
            await appendJsonl(run, "evidence_store.jsonl", nextEvidenceRowsState);
            await writeJsonFile(manifestPath, nextManifest);
            await syncAnalysisProgress(runContextMemory, {
              runContextPath: run.memoryRefs.runContextPath,
              summaryRows: nextSummaryRowsState,
              evidenceRows: nextEvidenceRowsState,
              selectedCount: selection.selectedPaperIds.length,
              totalCandidates: selection.totalCandidates,
              selectionFingerprint: selection.selectionFingerprint
            });
            await syncAnalyzeRunRecord({
              runStore: deps.runStore,
              runId: run.id,
              summary: buildAnalyzeProgressSummary({
                request,
                selectedCount: selection.selectedPaperIds.length,
                totalCandidates: selection.totalCandidates,
                progress: buildAnalysisProgress(nextSummaryRowsState, nextEvidenceRowsState),
                failedCount,
                analysisMode
              })
            });
            manifest = nextManifest;
            summaryRowsState = nextSummaryRowsState;
            evidenceRowsState = nextEvidenceRowsState;
            emitLog(
              `Persisted analysis outputs for "${row.title}" (1 summary row, ${analysis.evidenceRows.length} evidence row(s)).`
            );
          });

          emitLog(`Analyzed "${row.title}" (${analysis.evidenceRows.length} evidence item(s), source=${source.sourceType}).`);
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          failedCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          await persistQueue.run(async () => {
            if (quarantineRecord) {
              await appendJsonlItems(run, "analysis_quarantine.jsonl", [quarantineRecord]);
            }
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
              analysis_attempts: analysisAttempts,
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
            await syncAnalyzeRunRecord({
              runStore: deps.runStore,
              runId: run.id,
              summary: buildAnalyzeProgressSummary({
                request,
                selectedCount: selection.selectedPaperIds.length,
                totalCandidates: selection.totalCandidates,
                progress: buildAnalysisProgress(summaryRowsState, evidenceRowsState),
                failedCount,
                analysisMode
              })
            });
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

        const progress = buildAnalysisProgress(summaryRowsState, evidenceRowsState);
        await syncAnalysisProgress(runContextMemory, {
          runContextPath: run.memoryRefs.runContextPath,
          summaryRows: summaryRowsState,
          evidenceRows: evidenceRowsState,
          selectedCount: selection.selectedPaperIds.length,
          totalCandidates: selection.totalCandidates,
          selectionFingerprint: selection.selectionFingerprint
        });
        emitLog(
          `Analysis totals: summaries=${progress.summaryRows.length}, evidence=${progress.evidenceRows.length}, full_text=${progress.fullTextCount}, abstract_fallback=${progress.abstractFallbackCount}.`
        );

        if (failedCount > 0) {
          const failedPaperIds = getSelectedFailedPaperIds(manifest);
          const failureSummary = summarizeSelectedFailures(manifest, selection.selectedPaperIds);
          const zeroProgress = progress.summaryRows.length === 0 && progress.evidenceRows.length === 0;
          const allSelectedFailed =
            selection.selectedPaperIds.length > 0 && failedPaperIds.size === selection.selectedPaperIds.length;

          if (failureSummary.usageLimitEntries.length > 0) {
            const blockedCount = failureSummary.usageLimitEntries.length;
            const sampleMessage = failureSummary.cleanedMessages[0] || "Model usage limit reached.";
            emitLog(
              `Detected model usage-limit failure for ${blockedCount} selected paper(s). Pausing analyze_papers instead of auto-retrying because the requested model is currently unavailable.`
            );
            return {
              status: "success",
              summary:
                progress.evidenceRows.length > 0
                  ? request.selectionMode === "top_n" && request.topN
                    ? `Preserved partial analysis for top ${selection.selectedPaperIds.length}/${selection.totalCandidates} ranked papers (${progress.summaryRows.length} summaries, ${progress.evidenceRows.length} evidence item(s)) after ${blockedCount} paper(s) hit the current model usage limit.`
                    : `Preserved partial analysis (${progress.summaryRows.length} summaries, ${progress.evidenceRows.length} evidence item(s)) after ${blockedCount} paper(s) hit the current model usage limit.`
                  : request.selectionMode === "top_n" && request.topN
                    ? `analyze_papers paused because ${blockedCount}/${selection.selectedPaperIds.length} selected paper(s) hit the current model usage limit before any summaries or evidence were produced.`
                    : `analyze_papers paused because ${blockedCount} selected paper(s) hit the current model usage limit before any summaries or evidence were produced.`,
              needsApproval: true,
              toolCallsUsed: Math.max(1, pendingRows.length),
              transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
                runId: run.id,
                reason:
                  "analyze_papers is blocked by a model usage limit, so retrying immediately would churn without producing new outputs.",
                confidence: 0.98,
                targetNode: progress.evidenceRows.length > 0 ? "generate_hypotheses" : undefined,
                evidence: [
                  `${blockedCount} selected paper(s) reported a model usage-limit failure.`,
                  progress.evidenceRows.length > 0
                    ? `${progress.summaryRows.length} summary row(s) and ${progress.evidenceRows.length} evidence item(s) are already persisted.`
                    : "No summaries or evidence were persisted before the limit was hit.",
                  sampleMessage
                ],
                suggestedCommands:
                  progress.evidenceRows.length > 0
                    ? [`/agent run generate_hypotheses ${run.id}`, `/model`, `/agent run analyze_papers ${run.id}`]
                    : ["/model", `/agent run analyze_papers ${run.id}`]
              })
            };
          }

          if (
            failureSummary.sourceMismatchEntries.length > 0 &&
            failureSummary.sourceMismatchEntries.length === failureSummary.failedEntries.length
          ) {
            const blockedCount = failureSummary.sourceMismatchEntries.length;
            const sampleMessage = failureSummary.cleanedMessages[0] || "Resolved source content did not match the requested paper.";
            emitLog(
              `Detected non-retriable source-identity mismatch for ${blockedCount} selected paper(s). Pausing instead of auto-retrying the same contaminated analysis inputs.`
            );
            return {
              status: "success",
              summary:
                progress.evidenceRows.length > 0
                  ? request.selectionMode === "top_n" && request.topN
                    ? `Preserved partial analysis for top ${selection.selectedPaperIds.length}/${selection.totalCandidates} ranked papers while quarantining ${blockedCount} source-mismatched paper(s).`
                    : `Preserved partial analysis while quarantining ${blockedCount} source-mismatched paper(s).`
                  : request.selectionMode === "top_n" && request.topN
                    ? `analyze_papers paused because ${blockedCount}/${selection.selectedPaperIds.length} selected paper(s) failed source-identity validation before any summaries or evidence were persisted.`
                    : `analyze_papers paused because ${blockedCount} selected paper(s) failed source-identity validation before any summaries or evidence were persisted.`,
              needsApproval: true,
              toolCallsUsed: Math.max(1, pendingRows.length),
              transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
                runId: run.id,
                reason:
                  "analyze_papers quarantined one or more paper analyses because the resolved source content did not match the requested paper identity, so auto-retrying would likely repeat the same contamination.",
                confidence: 0.97,
                targetNode: progress.evidenceRows.length > 0 ? "generate_hypotheses" : undefined,
                evidence: [
                  `${blockedCount} selected paper(s) failed source-identity validation.`,
                  progress.evidenceRows.length > 0
                    ? `${progress.summaryRows.length} summary row(s) and ${progress.evidenceRows.length} evidence item(s) remain safely persisted.`
                    : "No summaries or evidence were persisted for the quarantined papers.",
                  sampleMessage
                ],
                suggestedCommands:
                  progress.evidenceRows.length > 0
                    ? [`/agent run generate_hypotheses ${run.id}`, `/agent run analyze_papers ${run.id}`]
                    : [`/agent run analyze_papers ${run.id}`, "/model"]
              })
            };
          }

          if (
            zeroProgress &&
            allSelectedFailed &&
            failureSummary.environmentBlockedEntries.length === failureSummary.failedEntries.length &&
            failureSummary.environmentBlockedEntries.length > 0
          ) {
            const sampleMessage = failureSummary.cleanedMessages[0] || "Environment blocked paper analysis.";
            emitLog(
              "All selected papers failed with environment or permission errors before any summaries/evidence were produced. Pausing instead of auto-retrying the same blocked analysis pass."
            );
            return {
              status: "success",
              summary:
                request.selectionMode === "top_n" && request.topN
                  ? `analyze_papers paused because all top ${selection.selectedPaperIds.length} selected paper(s) failed with environment or permission errors before any summaries or evidence were produced.`
                  : "analyze_papers paused because all selected papers failed with environment or permission errors before any summaries or evidence were produced.",
              needsApproval: true,
              toolCallsUsed: Math.max(1, pendingRows.length),
              transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
                runId: run.id,
                reason:
                  "analyze_papers is blocked by environment or permission errors, so another automatic retry would likely fail the same way.",
                confidence: 0.96,
                evidence: [
                  `${failureSummary.environmentBlockedEntries.length} selected paper(s) failed with environment or permission errors.`,
                  "No summaries or evidence were persisted in this pass.",
                  sampleMessage
                ],
                suggestedCommands: ["/doctor", "/model", `/agent run analyze_papers ${run.id}`]
              })
            };
          }

          const stalledFailures = shouldPauseForRepeatedAnalysisFailures({
            previousFailedPaperIds,
            currentFailedPaperIds: failedPaperIds,
            priorRetryCount: run.graph.retryCounters.analyze_papers ?? 0
          });
          if (stalledFailures && progress.evidenceRows.length > 0) {
            const summary =
              request.selectionMode === "top_n" && request.topN
                ? `Preserved partial analysis for top ${selection.selectedPaperIds.length}/${selection.totalCandidates} ranked papers (${progress.summaryRows.length} summaries, ${progress.evidenceRows.length} evidence item(s)) after ${failedPaperIds.size} repeated paper failure(s) stopped shrinking across retries.`
                : `Preserved partial analysis (${progress.summaryRows.length} summaries, ${progress.evidenceRows.length} evidence item(s)) after ${failedPaperIds.size} repeated paper failure(s) stopped shrinking across retries.`;
            emitLog(
              `Repeated analyze_papers retry would not reduce the failed subset (${failedPaperIds.size} paper(s) still failing). Preserving partial artifacts and pausing for manual review instead of triggering another destructive reset path.`
            );
            return {
              status: "success",
              summary,
              needsApproval: true,
              toolCallsUsed: Math.max(1, pendingRows.length),
              transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
                runId: run.id,
                reason:
                  "analyze_papers preserved partial evidence because retrying again did not shrink the failed-paper subset.",
                confidence: 0.92,
                targetNode: "generate_hypotheses",
                evidence: [
                  `${progress.summaryRows.length} summary row(s) and ${progress.evidenceRows.length} evidence item(s) are already persisted.`,
                  `${failedPaperIds.size} paper(s) remain failed after repeated retries.`,
                  previousFailedPaperIds.size > 0
                    ? `The failed subset stayed at ${previousFailedPaperIds.size} -> ${failedPaperIds.size} paper(s).`
                    : `Retry counter before this pass was ${run.graph.retryCounters.analyze_papers ?? 0}.`
                ]
              })
            };
          }
          if (stalledFailures && zeroProgress && allSelectedFailed) {
            emitLog(
              `Repeated analyze_papers retry still produced zero summaries/evidence and did not shrink the failed subset (${failedPaperIds.size} paper(s)). Pausing for manual review instead of retrying again.`
            );
            return {
              status: "success",
              summary:
                request.selectionMode === "top_n" && request.topN
                  ? `analyze_papers produced no summaries or evidence after repeated retries on top ${selection.selectedPaperIds.length}/${selection.totalCandidates} ranked papers, so the node paused for manual review.`
                  : "analyze_papers produced no summaries or evidence after repeated retries, so the node paused for manual review.",
              needsApproval: true,
              toolCallsUsed: Math.max(1, pendingRows.length),
              transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
                runId: run.id,
                reason:
                  "Repeated analyze_papers retries produced zero persisted outputs and the failed paper subset did not shrink.",
                confidence: 0.94,
                evidence: [
                  `${failedPaperIds.size} selected paper(s) remain failed after repeated retries.`,
                  "No summaries or evidence are currently persisted for the selected set.",
                  failureSummary.cleanedMessages[0] || `Retry counter before this pass was ${run.graph.retryCounters.analyze_papers ?? 0}.`
                ],
                suggestedCommands: ["/doctor", "/model", `/agent run analyze_papers ${run.id}`]
              })
            };
          }
          return {
            status: "failure",
            summary:
              request.selectionMode === "top_n" && request.topN
                ? `Analyzed ${progress.summaryRows.length}/${selection.selectedPaperIds.length} selected papers from ${selection.totalCandidates} candidates; ${failedCount} failed and can be retried.`
                : `Analyzed ${progress.summaryRows.length}/${corpusRows.length} papers, ${failedCount} failed and can be retried.`,
            error: `Analysis incomplete: ${failedCount} paper(s) failed validation or LLM extraction.`,
            toolCallsUsed: Math.max(1, pendingRows.length)
          };
        }

        const expansionDecision = decideAutomaticSelectionExpansion({
          request,
          selection,
          summaryRows: progress.summaryRows,
          evidenceRows: progress.evidenceRows,
          fullTextCount: progress.fullTextCount,
          autoExpansionCount,
          startedWithExistingManifest: Boolean(startedWithExistingManifest)
        });
        if (expansionDecision) {
          autoExpansionCount += 1;
          autoExpansionReason = expansionDecision.reason;
          request = expansionDecision.nextRequest;
          await runContextMemory.put("analyze_papers.auto_expand_count", autoExpansionCount);
          await runContextMemory.put("analyze_papers.auto_expand_reason", autoExpansionReason);
          emitLog(expansionDecision.reason);
          continue;
        }

        await runContextMemory.put("analyze_papers.auto_expand_count", autoExpansionCount);
        await runContextMemory.put("analyze_papers.auto_expand_reason", autoExpansionReason || null);

        const baseSummary =
          request.selectionMode === "top_n" && request.topN
            ? `Analyzed top ${selection.selectedPaperIds.length}/${selection.totalCandidates} ranked papers into ${progress.evidenceRows.length} evidence item(s); ${progress.fullTextCount} full-text and ${progress.abstractFallbackCount} abstract fallback (mode=${analysisMode}).`
            : `Analyzed ${progress.summaryRows.length} papers into ${progress.evidenceRows.length} evidence item(s); ${progress.fullTextCount} full-text and ${progress.abstractFallbackCount} abstract fallback (mode=${analysisMode}).`;

        return {
          status: "success",
          summary:
            autoExpansionCount > 0 && request.selectionMode === "top_n" && request.topN
              ? `${baseSummary} Auto-expanded the analysis window ${autoExpansionCount} time(s) and finished at top ${request.topN}.`
              : baseSummary,
          needsApproval: true,
          toolCallsUsed: Math.max(1, pendingRows.length)
        };
      }
    }
  };
}

function getAnalysisConcurrency(analysisMode: "codex_text_image_hybrid" | "responses_api_pdf"): number {
  return analysisMode === "responses_api_pdf" ? 2 : 3;
}

function decideAutomaticSelectionExpansion(input: {
  request: AnalysisSelectionRequest;
  selection: PaperSelectionResult;
  summaryRows: PaperSummaryRow[];
  evidenceRows: PaperEvidenceRow[];
  fullTextCount: number;
  autoExpansionCount: number;
  startedWithExistingManifest: boolean;
}): {
  nextRequest: AnalysisSelectionRequest;
  reason: string;
} | undefined {
  if (
    input.request.selectionMode !== "top_n" ||
    !input.request.topN ||
    input.request.topN >= input.selection.totalCandidates ||
    input.autoExpansionCount >= MAX_AUTO_SELECTION_EXPANSIONS ||
    (input.startedWithExistingManifest && input.autoExpansionCount === 0) ||
    input.summaryRows.length === 0
  ) {
    return undefined;
  }

  const evidenceTooThin = input.evidenceRows.length < Math.max(2, input.request.topN);
  const lowRichnessCoverage = input.fullTextCount === 0 || input.evidenceRows.length < input.summaryRows.length;
  if (!evidenceTooThin || !lowRichnessCoverage) {
    return undefined;
  }

  const growth = input.request.topN <= 2 ? 1 : Math.min(2, Math.ceil(input.request.topN * 0.5));
  const nextTopN = Math.min(input.selection.totalCandidates, input.request.topN + growth);
  if (nextTopN <= input.request.topN) {
    return undefined;
  }

  return {
    nextRequest: normalizeAnalysisSelectionRequest(nextTopN),
    reason:
      `Evidence coverage is still thin after top ${input.request.topN} analysis ` +
      `(${input.evidenceRows.length} evidence item(s), ${input.fullTextCount} full-text paper(s)). ` +
      `Auto-expanding to top ${nextTopN} for one more bounded analysis pass.`
  };
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

async function loadAnalysisSelectionRequest(
  runContextMemory: RunContextMemory,
  corpusCount: number,
  existingRequest?: AnalysisSelectionRequest
): Promise<LoadedAnalysisSelectionRequest> {
  const stored = await runContextMemory.get<{ topN?: unknown; selectionMode?: unknown; selectionPolicy?: unknown }>(
    "analyze_papers.request"
  );
  const topN =
    typeof stored?.topN === "number" && Number.isFinite(stored.topN) && stored.topN > 0
      ? Math.floor(stored.topN)
      : null;
  if (topN) {
    return {
      request: normalizeAnalysisSelectionRequest(topN)
    };
  }
  if (stored && typeof stored === "object" && stored.selectionMode === "all") {
    return {
      request: normalizeAnalysisSelectionRequest(null)
    };
  }
  if (existingRequest) {
    return {
      request: existingRequest
    };
  }
  if (corpusCount > DEFAULT_SAFE_ANALYSIS_TOP_N) {
    return {
      request: normalizeAnalysisSelectionRequest(DEFAULT_SAFE_ANALYSIS_TOP_N),
      autoDefaultReason:
        `No explicit analyze_papers selection was stored. ` +
        `For a large corpus of ${corpusCount} papers, auto-start is using top ${DEFAULT_SAFE_ANALYSIS_TOP_N} instead of analyzing all candidates.`
    };
  }
  return {
    request: normalizeAnalysisSelectionRequest(null)
  };
}

async function readCorpusRows(runId: string): Promise<AnalysisCorpusRow[]> {
  const corpusPath = path.join(".autolabos", "runs", runId, "corpus.jsonl");
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
    if ((manifest?.version === 2 || manifest?.version === 3) && manifest.papers && typeof manifest.papers === "object") {
      return manifest;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function buildCorpusFingerprint(corpusRows: AnalysisCorpusRow[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        corpusRows.map((row) => ({
          paper_id: row.paper_id,
          title: row.title,
          abstract: row.abstract || "",
          year: row.year ?? null,
          venue: row.venue ?? null,
          citation_count: row.citation_count ?? 0,
          pdf_url: resolvePaperPdfUrl(row) ?? null
        }))
      )
    )
    .digest("hex");
}

function canReuseManifestSelection(
  manifest: AnalysisManifest | undefined,
  request: AnalysisSelectionRequest,
  selectionRequestFingerprint: string,
  analysisFingerprint: string,
  corpusFingerprint: string,
  corpusRows: AnalysisCorpusRow[]
): manifest is AnalysisManifest {
  if (!manifest) {
    return false;
  }
  if (manifest.analysisFingerprint !== analysisFingerprint) {
    return false;
  }
  if (manifest.selectionRequestFingerprint !== selectionRequestFingerprint) {
    return false;
  }
  if (manifest.corpusFingerprint !== corpusFingerprint) {
    return false;
  }
  if (manifest.request.selectionMode !== request.selectionMode || manifest.request.topN !== request.topN) {
    return false;
  }

  const manifestPaperIds = new Set(Object.keys(manifest.papers));
  return corpusRows.length === manifestPaperIds.size && corpusRows.every((row) => manifestPaperIds.has(row.paper_id));
}

function restoreSelectionFromManifest(
  manifest: AnalysisManifest,
  corpusRows: AnalysisCorpusRow[]
): PaperSelectionResult {
  const paperById = new Map(corpusRows.map((row) => [row.paper_id, row] as const));
  const rankedCandidates: RankedPaperCandidate[] = [];
  for (const entry of Object.values(manifest.papers)) {
    const paper = paperById.get(entry.paper_id);
    if (!paper) {
      continue;
    }
    rankedCandidates.push({
      paper,
      deterministicScore: entry.deterministic_score ?? 0,
      selectionScore: entry.selection_score ?? entry.deterministic_score ?? 0,
      rerankPosition: entry.rerank_position,
      selected: entry.selected,
      rank: entry.rank,
      scoreBreakdown: entry.score_breakdown ?? {
        title_similarity_score: 0,
        citation_score: 0,
        recency_score: 0,
        pdf_availability_score: 0
      }
    });
  }

  rankedCandidates.sort((left, right) => {
      const leftRank = left.selected ? left.rank ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const rightRank = right.selected ? right.rank ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      return (
        leftRank - rightRank ||
        (right.selectionScore ?? right.deterministicScore) - (left.selectionScore ?? left.deterministicScore) ||
        right.deterministicScore - left.deterministicScore ||
        left.paper.paper_id.localeCompare(right.paper.paper_id)
      );
    });

  return {
    request: manifest.request,
    totalCandidates: manifest.totalCandidates,
    candidatePoolSize: manifest.candidatePoolSize,
    deterministicRankingPreview: manifest.deterministicRankingPreview,
    rerankedPaperIds: manifest.rerankedPaperIds,
    selectedPaperIds: manifest.selectedPaperIds,
    selectionFingerprint: manifest.selectionFingerprint,
    rerankApplied: manifest.rerankApplied ?? manifest.rerankedPaperIds.length > 0,
    rerankFallbackReason: manifest.rerankFallbackReason,
    rankedCandidates
  };
}

function canExtendManifestForExpandedSelection(
  existingManifest: AnalysisManifest,
  selection: PaperSelectionResult,
  analysisFingerprint: string
): boolean {
  if (
    existingManifest.analysisFingerprint !== analysisFingerprint ||
    existingManifest.request.selectionMode !== "top_n" ||
    selection.request.selectionMode !== "top_n"
  ) {
    return false;
  }

  if (selection.selectedPaperIds.length <= existingManifest.selectedPaperIds.length) {
    return false;
  }

  const nextSelection = new Set(selection.selectedPaperIds);
  return existingManifest.selectedPaperIds.every((paperId) => nextSelection.has(paperId));
}

function extendManifestForExpandedSelection(
  existingManifest: AnalysisManifest,
  selection: PaperSelectionResult,
  analysisFingerprint: string,
  selectionRequestFingerprint: string,
  corpusFingerprint: string
): AnalysisManifest {
  const fresh = createFreshManifest(selection, analysisFingerprint, selectionRequestFingerprint, corpusFingerprint);
  for (const [paperId, freshEntry] of Object.entries(fresh.papers)) {
    const previousEntry = existingManifest.papers[paperId];
    if (!previousEntry?.selected || !freshEntry.selected) {
      continue;
    }
    fresh.papers[paperId] = {
      ...freshEntry,
      status: previousEntry.status,
      source_type: previousEntry.source_type,
      summary_count: previousEntry.summary_count,
      evidence_count: previousEntry.evidence_count,
      analysis_attempts: previousEntry.analysis_attempts,
      analysis_mode: previousEntry.analysis_mode,
      pdf_url: previousEntry.pdf_url,
      pdf_cache_path: previousEntry.pdf_cache_path,
      text_cache_path: previousEntry.text_cache_path,
      fallback_reason: previousEntry.fallback_reason,
      last_error: previousEntry.last_error,
      has_table_references: previousEntry.has_table_references,
      table_reference_count: previousEntry.table_reference_count,
      has_figure_references: previousEntry.has_figure_references,
      figure_reference_count: previousEntry.figure_reference_count,
      updatedAt: previousEntry.updatedAt,
      completedAt: previousEntry.completedAt
    };
  }
  return fresh;
}

function canRetargetManifestForSelectionChange(
  existingManifest: AnalysisManifest,
  selection: PaperSelectionResult,
  analysisFingerprint: string,
  selectionRequestFingerprint: string,
  corpusFingerprint: string
): boolean {
  return (
    existingManifest.analysisFingerprint === analysisFingerprint &&
    existingManifest.selectionRequestFingerprint === selectionRequestFingerprint &&
    existingManifest.corpusFingerprint === corpusFingerprint &&
    existingManifest.selectionFingerprint !== selection.selectionFingerprint
  );
}

function retargetManifestForSelectionChange(
  existingManifest: AnalysisManifest,
  selection: PaperSelectionResult,
  summaryRows: PaperSummaryRow[],
  evidenceRows: PaperEvidenceRow[],
  analysisFingerprint: string,
  selectionRequestFingerprint: string,
  corpusFingerprint: string
): SelectionRetargetResult {
  const nextManifest = createFreshManifest(selection, analysisFingerprint, selectionRequestFingerprint, corpusFingerprint);
  const nextSelectedSet = new Set(selection.selectedPaperIds);
  const preservedCompletedPaperIds: string[] = [];

  for (const [paperId, nextEntry] of Object.entries(nextManifest.papers)) {
    const previousEntry = existingManifest.papers[paperId];
    if (!nextEntry.selected || !previousEntry?.selected) {
      continue;
    }
    nextManifest.papers[paperId] = {
      ...nextEntry,
      status: previousEntry.status,
      source_type: previousEntry.source_type,
      summary_count: previousEntry.summary_count,
      evidence_count: previousEntry.evidence_count,
      analysis_attempts: previousEntry.analysis_attempts,
      analysis_mode: previousEntry.analysis_mode,
      pdf_url: previousEntry.pdf_url,
      pdf_cache_path: previousEntry.pdf_cache_path,
      text_cache_path: previousEntry.text_cache_path,
      fallback_reason: previousEntry.fallback_reason,
      last_error: previousEntry.last_error,
      has_table_references: previousEntry.has_table_references,
      table_reference_count: previousEntry.table_reference_count,
      has_figure_references: previousEntry.has_figure_references,
      figure_reference_count: previousEntry.figure_reference_count,
      updatedAt: previousEntry.updatedAt,
      completedAt: previousEntry.completedAt
    };
    if (previousEntry.status === "completed") {
      preservedCompletedPaperIds.push(paperId);
    }
  }

  const nextSummaryRows = summaryRows.filter((row) => nextSelectedSet.has(row.paper_id));
  const nextEvidenceRows = evidenceRows.filter((row) => nextSelectedSet.has(row.paper_id));
  const droppedPaperIds = existingManifest.selectedPaperIds.filter((paperId) => !nextSelectedSet.has(paperId));

  return {
    manifest: nextManifest,
    summaryRows: nextSummaryRows,
    evidenceRows: nextEvidenceRows,
    preservedCompletedPaperIds,
    droppedPaperIds,
    logMessage:
      `Analysis selection changed under the same request/corpus fingerprint. ` +
      `Preserving ${preservedCompletedPaperIds.length} completed paper(s) and pruning ${droppedPaperIds.length} deselected paper(s) instead of resetting all artifacts.`
  };
}

function createFreshManifest(
  selection: PaperSelectionResult,
  analysisFingerprint: string,
  selectionRequestFingerprint: string,
  corpusFingerprint: string
): AnalysisManifest {
  const now = new Date().toISOString();
  return {
    version: 3,
    updatedAt: now,
    request: selection.request,
    selectionFingerprint: selection.selectionFingerprint,
    selectionRequestFingerprint,
    analysisFingerprint,
    corpusFingerprint,
    totalCandidates: selection.totalCandidates,
    candidatePoolSize: selection.candidatePoolSize,
    rerankApplied: selection.rerankApplied,
    rerankFallbackReason: selection.rerankFallbackReason,
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
  evidencePath: string,
  analysisFingerprint: string,
  selectionRequestFingerprint: string,
  corpusFingerprint: string
): Promise<AnalysisManifest> {
  const manifest = createFreshManifest(selection, analysisFingerprint, selectionRequestFingerprint, corpusFingerprint);
  const summaries = await readSummaryRows(summaryPath);
  const evidences = await readEvidenceRows(evidencePath);
  const summariesByPaper = new Map<string, PaperSummaryRow[]>();
  const evidenceCountByPaper = new Map<string, number>();

  for (const summary of summaries) {
    const rows = summariesByPaper.get(summary.paper_id) ?? [];
    rows.push(summary);
    summariesByPaper.set(summary.paper_id, rows);
  }
  for (const evidence of evidences) {
    evidenceCountByPaper.set(evidence.paper_id, (evidenceCountByPaper.get(evidence.paper_id) ?? 0) + 1);
  }

  for (const [paperId, summaryRows] of summariesByPaper.entries()) {
    const entry = manifest.papers[paperId];
    if (!entry || !entry.selected) {
      continue;
    }
    const summary = summaryRows[0];
    const evidenceCount = evidenceCountByPaper.get(paperId) ?? 0;
    if (summaryRows.length !== 1 || evidenceCount === 0) {
      continue;
    }
    manifest.papers[paperId] = {
      ...entry,
      status: "completed",
      source_type: summary.source_type,
      summary_count: 1,
      evidence_count: evidenceCount,
      analysis_attempts: 1,
      analysis_mode: "codex_text_image_hybrid",
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

function buildAnalysisFingerprint(args: {
  analysisMode: "codex_text_image_hybrid" | "responses_api_pdf";
  responsesModel?: string;
  responsesReasoningEffort?: string;
  includePageImages: boolean;
}): string {
  const modeSpecificConfig =
    args.analysisMode === "responses_api_pdf"
      ? {
          responsesModel: args.responsesModel ?? null,
          responsesReasoningEffort: args.responsesReasoningEffort ?? null
        }
      : {
          includePageImages: args.includePageImages
        };
  return JSON.stringify({
    analysisMode: args.analysisMode,
    ...modeSpecificConfig
  });
}

function buildAnalysisProgress(summaryRows: PaperSummaryRow[], evidenceRows: PaperEvidenceRow[]): {
  summaryRows: PaperSummaryRow[];
  evidenceRows: PaperEvidenceRow[];
  fullTextCount: number;
  abstractFallbackCount: number;
} {
  return {
    summaryRows,
    evidenceRows,
    fullTextCount: summaryRows.filter((row) => row.source_type === "full_text").length,
    abstractFallbackCount: summaryRows.filter((row) => row.source_type === "abstract").length
  };
}

function buildAnalyzeProgressSummary(input: {
  request: AnalysisSelectionRequest;
  selectedCount: number;
  totalCandidates: number;
  progress: ReturnType<typeof buildAnalysisProgress>;
  failedCount: number;
  analysisMode: string;
}): string {
  if (input.failedCount > 0) {
    if (input.request.selectionMode === "top_n" && input.request.topN && input.selectedCount > 0 && input.totalCandidates > 0) {
      return `Analyzed ${input.progress.summaryRows.length}/${input.selectedCount} selected papers from ${input.totalCandidates} candidates; ${input.failedCount} failed and can be retried.`;
    }
    return `Analyzed ${input.progress.summaryRows.length} papers, ${input.failedCount} failed and can be retried.`;
  }

  if (input.progress.summaryRows.length === 0 && input.progress.evidenceRows.length === 0) {
    if (input.request.selectionMode === "top_n" && input.request.topN && input.selectedCount > 0 && input.totalCandidates > 0) {
      return `Selected top ${input.selectedCount}/${input.totalCandidates} ranked papers for analysis. Persisted 0 summary row(s) and 0 evidence row(s).`;
    }
    return `Selected ${input.selectedCount}/${input.totalCandidates} paper(s) for analysis. Persisted 0 summary row(s) and 0 evidence row(s).`;
  }

  if (input.request.selectionMode === "top_n" && input.request.topN) {
    return `Analyzed top ${input.selectedCount}/${input.totalCandidates} ranked papers into ${input.progress.evidenceRows.length} evidence item(s); ${input.progress.fullTextCount} full-text and ${input.progress.abstractFallbackCount} abstract fallback (mode=${input.analysisMode}).`;
  }

  return `Analyzed ${input.progress.summaryRows.length} papers into ${input.progress.evidenceRows.length} evidence item(s); ${input.progress.fullTextCount} full-text and ${input.progress.abstractFallbackCount} abstract fallback (mode=${input.analysisMode}).`;
}

async function syncAnalysisProgress(
  runContextMemory: RunContextMemory,
  input: {
    runContextPath: string;
    summaryRows: PaperSummaryRow[];
    evidenceRows: PaperEvidenceRow[];
    selectedCount: number;
    totalCandidates: number;
    selectionFingerprint: string;
  }
): Promise<void> {
  const progress = buildAnalysisProgress(input.summaryRows, input.evidenceRows);
  void runContextMemory;
  await upsertRunContextValues(input.runContextPath, {
    "analyze_papers.summary_count": progress.summaryRows.length,
    "analyze_papers.evidence_count": progress.evidenceRows.length,
    "analyze_papers.full_text_count": progress.fullTextCount,
    "analyze_papers.abstract_fallback_count": progress.abstractFallbackCount,
    "analyze_papers.selected_count": input.selectedCount,
    "analyze_papers.total_candidates": input.totalCandidates,
    "analyze_papers.selection_fingerprint": input.selectionFingerprint
  });
}

async function syncAnalyzeRunRecord(input: {
  runStore: Pick<NodeExecutionDeps["runStore"], "getRun" | "updateRun"> | undefined;
  runId: string;
  summary: string;
}): Promise<void> {
  if (
    !input.runStore ||
    typeof input.runStore.getRun !== "function" ||
    typeof input.runStore.updateRun !== "function"
  ) {
    return;
  }

  const run = await input.runStore.getRun(input.runId);
  if (!run) {
    return;
  }

  run.graph.nodeStates.analyze_papers = {
    ...run.graph.nodeStates.analyze_papers,
    updatedAt: new Date().toISOString(),
    note: input.summary
  };

  if (run.currentNode === "analyze_papers" || !run.latestSummary) {
    run.latestSummary = input.summary;
  }

  await input.runStore.updateRun(run);
}

function replaceSummaryRow(rows: PaperSummaryRow[], nextRow: PaperSummaryRow): PaperSummaryRow[] {
  return [...rows.filter((row) => row.paper_id !== nextRow.paper_id), nextRow];
}

function replaceEvidenceRowsForPaper(
  rows: PaperEvidenceRow[],
  paperId: string,
  nextRows: PaperEvidenceRow[]
): PaperEvidenceRow[] {
  return [...rows.filter((row) => row.paper_id !== paperId), ...nextRows];
}

function getSelectedFailedPaperIds(manifest: AnalysisManifest): Set<string> {
  return new Set(
    Object.entries(manifest.papers)
      .filter(([, entry]) => entry.selected && entry.status === "failed")
      .map(([paperId]) => paperId)
  );
}

function shouldPauseForRepeatedAnalysisFailures(input: {
  previousFailedPaperIds: Set<string>;
  currentFailedPaperIds: Set<string>;
  priorRetryCount: number;
}): boolean {
  if (input.priorRetryCount < 1 || input.previousFailedPaperIds.size === 0 || input.currentFailedPaperIds.size === 0) {
    return false;
  }
  if (input.currentFailedPaperIds.size < input.previousFailedPaperIds.size) {
    for (const paperId of input.currentFailedPaperIds) {
      if (!input.previousFailedPaperIds.has(paperId)) {
        return false;
      }
    }
    return false;
  }
  return true;
}

function shouldPreservePartialArtifactsOnSelectionRegression(input: {
  runId: string;
  existingManifest?: AnalysisManifest;
  selection: PaperSelectionResult;
  resetReason?: "selection_changed" | "legacy_manifest" | "analysis_config_changed";
  selectionRequestFingerprint: string;
  analysisFingerprint: string;
  corpusFingerprint: string;
  existingSummaryRows: PaperSummaryRow[];
  existingEvidenceRows: PaperEvidenceRow[];
}):
  | {
      logMessage: string;
      summary: string;
      transitionRecommendation: TransitionRecommendation;
    }
  | undefined {
  if (
    input.resetReason !== "selection_changed" ||
    !input.existingManifest ||
    input.existingSummaryRows.length === 0 ||
    input.existingEvidenceRows.length === 0
  ) {
    return undefined;
  }
  if (
    input.existingManifest.selectionRequestFingerprint !== input.selectionRequestFingerprint ||
    input.existingManifest.analysisFingerprint !== input.analysisFingerprint ||
    !input.existingManifest.corpusFingerprint ||
    input.existingManifest.corpusFingerprint === input.corpusFingerprint
  ) {
    return undefined;
  }

  const previousCompletedCount = countCompletedSelectedEntries(input.existingManifest);
  const previousSelectedCount = input.existingManifest.selectedPaperIds.length;
  const nextSelectedCount = input.selection.selectedPaperIds.length;
  const suspiciousRegression =
    input.selection.totalCandidates === 0 ||
    nextSelectedCount === 0 ||
    nextSelectedCount < Math.min(previousSelectedCount, previousCompletedCount);
  if (!suspiciousRegression || previousCompletedCount === 0) {
    return undefined;
  }

  const reason =
    `Preserving ${input.existingSummaryRows.length} summary row(s) and ${input.existingEvidenceRows.length} evidence row(s) ` +
    `after the analysis selection regressed from ${previousSelectedCount} paper(s) to ${nextSelectedCount} ` +
    `without any selection-request change.`;
  return {
    logMessage:
      `${reason} Manual review is required before replacing the recovered artifacts because the corpus fingerprint changed.`,
    summary:
      `${reason} Approval can continue with the preserved partial analysis, or you can re-run collection/analysis after reviewing the corpus regression.`,
    transitionRecommendation: createAnalyzePapersManualReviewRecommendation({
      runId: input.runId,
      reason:
        "analyze_papers detected a corpus regression with the same selection request and preserved the previous partial analysis instead of deleting it.",
      confidence: 0.97,
      targetNode: "generate_hypotheses",
      evidence: [
        `${input.existingSummaryRows.length} summary row(s) and ${input.existingEvidenceRows.length} evidence item(s) already exist on disk.`,
        `Selected papers regressed from ${previousSelectedCount} to ${nextSelectedCount}.`,
        `Corpus fingerprint changed while the selection request fingerprint stayed the same.`
      ]
    })
  };
}

function countCompletedSelectedEntries(manifest: AnalysisManifest): number {
  return Object.values(manifest.papers).filter((entry) => entry.selected && entry.status === "completed").length;
}

function createAnalyzePapersManualReviewRecommendation(input: {
  runId: string;
  reason: string;
  evidence: string[];
  confidence: number;
  targetNode?: TransitionRecommendation["targetNode"];
  suggestedCommands?: string[];
}): TransitionRecommendation {
  return {
    action: "pause_for_human",
    sourceNode: "analyze_papers",
    targetNode: input.targetNode,
    reason: input.reason,
    confidence: Number(input.confidence.toFixed(2)),
    autoExecutable: false,
    evidence: input.evidence.slice(0, 4),
    suggestedCommands:
      input.suggestedCommands && input.suggestedCommands.length > 0
        ? input.suggestedCommands.slice(0, 4)
        : [`/agent run generate_hypotheses ${input.runId}`, `/agent run analyze_papers ${input.runId}`],
    generatedAt: new Date().toISOString()
  };
}

function applySelectionQualitySafeguards(input: {
  selection: PaperSelectionResult;
  runTitle: string;
  runTopic: string;
}): SelectionQualityGuardResult {
  if (
    input.selection.request.selectionMode !== "top_n" ||
    !input.selection.request.topN ||
    input.selection.selectedPaperIds.length === 0 ||
    input.selection.selectedPaperIds.length >= input.selection.totalCandidates
  ) {
    return {
      selection: input.selection,
      applied: false,
      droppedPaperIds: [],
      addedPaperIds: []
    };
  }

  const referenceAnchors = extractSelectionReferenceAnchors(`${input.runTitle || ""} ${input.runTopic || ""}`);
  if (referenceAnchors.length < MIN_SELECTION_GUARD_ANCHORS) {
    return {
      selection: input.selection,
      applied: false,
      droppedPaperIds: [],
      addedPaperIds: []
    };
  }

  const strictMode = Boolean(input.selection.rerankFallbackReason);
  const candidateSignalsById = new Map(
    input.selection.rankedCandidates.map((candidate) => [
      candidate.paper.paper_id,
      evaluateSelectionCandidateQuality(candidate, referenceAnchors)
    ] as const)
  );
  const orderedPaperIds =
    input.selection.rerankedPaperIds.length > 0
      ? input.selection.rerankedPaperIds
      : input.selection.rankedCandidates
          .slice()
          .sort(
            (left, right) =>
              (right.selectionScore ?? right.deterministicScore) - (left.selectionScore ?? left.deterministicScore) ||
              right.deterministicScore - left.deterministicScore ||
              left.paper.paper_id.localeCompare(right.paper.paper_id)
          )
          .map((candidate) => candidate.paper.paper_id);
  const targetCount = input.selection.selectedPaperIds.length;
  const nextSelectedPaperIds: string[] = [];

  for (const paperId of orderedPaperIds) {
    const candidate = input.selection.rankedCandidates.find((item) => item.paper.paper_id === paperId);
    const signals = candidateSignalsById.get(paperId);
    if (!candidate || !signals || !passesSelectionQualityGuard(candidate, signals, strictMode)) {
      continue;
    }
    nextSelectedPaperIds.push(paperId);
    if (nextSelectedPaperIds.length >= targetCount) {
      break;
    }
  }

  const previousSelection = input.selection.selectedPaperIds;
  if (!strictMode && nextSelectedPaperIds.length < targetCount) {
    return {
      selection: input.selection,
      applied: false,
      droppedPaperIds: [],
      addedPaperIds: []
    };
  }
  if (arraysEqual(previousSelection, nextSelectedPaperIds)) {
    return {
      selection: input.selection,
      applied: false,
      droppedPaperIds: [],
      addedPaperIds: []
    };
  }

  const nextSelectedSet = new Set(nextSelectedPaperIds);
  const nextRankedCandidates = input.selection.rankedCandidates.map((candidate) => ({
    ...candidate,
    selected: nextSelectedSet.has(candidate.paper.paper_id),
    rank: nextSelectedSet.has(candidate.paper.paper_id)
      ? nextSelectedPaperIds.indexOf(candidate.paper.paper_id) + 1
      : undefined
  }));
  const droppedPaperIds = previousSelection.filter((paperId) => !nextSelectedSet.has(paperId));
  const addedPaperIds = nextSelectedPaperIds.filter((paperId) => !previousSelection.includes(paperId));
  const cleanedFallbackReason = cleanFailureMessage(input.selection.rerankFallbackReason);

  return {
    selection: {
      ...input.selection,
      selectedPaperIds: nextSelectedPaperIds,
      selectionFingerprint: buildSelectionFingerprint(
        input.selection.request,
        input.runTitle,
        input.runTopic,
        nextSelectedPaperIds
      ),
      rankedCandidates: nextRankedCandidates
    },
    applied: true,
    droppedPaperIds,
    addedPaperIds,
    reason:
      `Selection quality safeguard ${strictMode ? "tightened the rerank-fallback shortlist" : "filtered weakly grounded shortlist items"} ` +
      `using research anchors [${referenceAnchors.join(", ")}]. ` +
      `Dropped ${droppedPaperIds.length} off-topic paper(s)` +
      `${addedPaperIds.length > 0 ? ` and promoted ${addedPaperIds.length} replacement(s)` : ""}.` +
      `${cleanedFallbackReason ? ` Fallback context: ${cleanedFallbackReason}` : ""}`
  };
}

function extractSelectionReferenceAnchors(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.map((token) => normalizeSelectionToken(token))
        .filter(
          (token): token is string =>
            Boolean(token) &&
            token.length >= 4 &&
            !SELECTION_QUALITY_STOPWORDS.has(token) &&
            !SELECTION_QUALITY_GENERIC_TOKENS.has(token)
        ) ?? []
    )
  );
}

function normalizeSelectionToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (normalized.endsWith("ies") && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (/(ches|shes|xes|zes)$/.test(normalized) && normalized.length > 4) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith("s") && normalized.length > 4) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function evaluateSelectionCandidateQuality(
  candidate: RankedPaperCandidate,
  referenceAnchors: string[]
): {
  titleAnchorHits: number;
  abstractAnchorHits: number;
  totalAnchorHits: number;
} {
  const titleTokens = new Set(
    (candidate.paper.title.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((token) => normalizeSelectionToken(token))
  );
  const abstractTokens = new Set(
    (candidate.paper.abstract?.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((token) => normalizeSelectionToken(token))
  );
  const titleAnchorHits = referenceAnchors.filter((token) => titleTokens.has(token)).length;
  const abstractAnchorHits = referenceAnchors.filter((token) => !titleTokens.has(token) && abstractTokens.has(token)).length;
  return {
    titleAnchorHits,
    abstractAnchorHits,
    totalAnchorHits: titleAnchorHits + abstractAnchorHits
  };
}

function passesSelectionQualityGuard(
  candidate: RankedPaperCandidate,
  signals: {
    titleAnchorHits: number;
    abstractAnchorHits: number;
    totalAnchorHits: number;
  },
  strictMode: boolean
): boolean {
  if (signals.titleAnchorHits >= 1) {
    return true;
  }
  if (
    signals.totalAnchorHits >= (strictMode ? 2 : 1) &&
    candidate.scoreBreakdown.title_similarity_score >= (strictMode ? 0.12 : 0.08)
  ) {
    return true;
  }
  return !strictMode && candidate.deterministicScore >= 0.5 && candidate.scoreBreakdown.title_similarity_score >= 0.25;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function upsertRunContextValues(runContextPath: string, updates: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const store = await readJsonFile<{ version?: unknown; items?: Array<{ key?: unknown; value?: unknown; updatedAt?: unknown }> }>(
    runContextPath
  ).catch(() => ({
    version: 1,
    items: []
  }));
  const items = Array.isArray(store.items) ? [...store.items] : [];

  for (const [key, value] of Object.entries(updates)) {
    const nextItem = {
      key,
      value,
      updatedAt: now
    };
    const existingIndex = items.findIndex((item) => item?.key === key);
    if (existingIndex >= 0) {
      items[existingIndex] = nextItem;
    } else {
      items.push(nextItem);
    }
  }

  await writeJsonFile(runContextPath, {
    version: 1,
    items
  });
}

function summarizeSelectedFailures(
  manifest: AnalysisManifest,
  selectedPaperIds: string[]
): SelectedFailureSummary {
  const selectedSet = new Set(selectedPaperIds);
  const failedEntries = Object.values(manifest.papers).filter(
    (entry) => selectedSet.has(entry.paper_id) && entry.status === "failed"
  );
  return {
    failedEntries,
    usageLimitEntries: failedEntries.filter((entry) => isModelUsageLimitError(entry.last_error)),
    environmentBlockedEntries: failedEntries.filter((entry) => isEnvironmentBlockedError(entry.last_error)),
    sourceMismatchEntries: failedEntries.filter((entry) => isSourceContentMismatchError(entry.last_error)),
    cleanedMessages: Array.from(
      new Set(
        failedEntries
          .map((entry) => cleanFailureMessage(entry.last_error))
          .filter((message): message is string => Boolean(message))
      )
    )
  };
}

function cleanFailureMessage(message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }
  const lines = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isBenignCodexCleanupWarning(line));
  const cleaned = (lines.length > 0 ? lines.join(" ") : message.trim()).trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

function isBenignCodexCleanupWarning(message: string): boolean {
  return /codex_core::shell_snapshot/i.test(message) || /failed to delete shell snapshot/i.test(message);
}

function isModelUsageLimitError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return (
    /usage limit/i.test(message) ||
    /switch to another model/i.test(message) ||
    /try again at \d{1,2}:\d{2}/i.test(message) ||
    /quota exceeded/i.test(message)
  );
}

function isEnvironmentBlockedError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return [
    /operation not permitted/i,
    /failed to write models cache/i,
    /readonly database/i,
    /read-only database/i,
    /could not update path/i,
    /attempt to write a readonly database/i
  ].some((pattern) => pattern.test(message));
}

function isSourceContentMismatchError(message: string | undefined): boolean {
  return typeof message === "string" && /source_content_mismatch|analysis_content_mismatch/i.test(message);
}

const SOURCE_IDENTITY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "approach",
  "assessment",
  "based",
  "benchmark",
  "benchmarking",
  "classification",
  "comparative",
  "data",
  "driven",
  "empirical",
  "evaluation",
  "for",
  "framework",
  "from",
  "improved",
  "in",
  "learning",
  "machine",
  "method",
  "methods",
  "model",
  "models",
  "of",
  "on",
  "paper",
  "predicting",
  "review",
  "study",
  "system",
  "systems",
  "tabular",
  "the",
  "toward",
  "using",
  "with"
]);

function validateResolvedSourceIdentity(paper: AnalysisCorpusRow, source: ResolvedPaperSource): string | undefined {
  if (source.sourceType !== "full_text") {
    return undefined;
  }

  const sourceText = source.text.trim();
  if (!sourceText) {
    return undefined;
  }

  const abstractText = paper.abstract?.trim();
  if (sourceText === paper.title.trim() || (abstractText && sourceText === abstractText)) {
    return undefined;
  }

  const normalizedSource = normalizeIdentityText(sourceText);
  const normalizedTitle = normalizeIdentityText(paper.title);
  if (normalizedTitle && normalizedSource.includes(normalizedTitle)) {
    return undefined;
  }

  const titleTokens = Array.from(
    new Set(
      (paper.title.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) => token.length >= 4 && !SOURCE_IDENTITY_STOPWORDS.has(token)
      )
    )
  );
  if (titleTokens.length === 0) {
    return undefined;
  }

  const matchedTitleTokens = titleTokens.filter((token) => normalizedSource.includes(token));
  if (matchedTitleTokens.length >= Math.min(2, titleTokens.length)) {
    return undefined;
  }

  const authorTokens = Array.from(
    new Set(
      paper.authors
        .flatMap((author) => author.toLowerCase().match(/[a-z0-9]+/g) ?? [])
        .filter((token) => token.length >= 4 && !SOURCE_IDENTITY_STOPWORDS.has(token))
    )
  );
  const hasAuthorMatch = authorTokens.some((token) => normalizedSource.includes(token));
  if (matchedTitleTokens.length >= 1 && hasAuthorMatch) {
    return undefined;
  }

  return (
    `source_content_mismatch: resolved source text for "${paper.title}" did not match the paper identity strongly enough ` +
    `(matched_title_tokens=${matchedTitleTokens.length}/${titleTokens.length}, author_match=${hasAuthorMatch ? "yes" : "no"}).`
  );
}

function validateAnalysisBeforePersist(
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource,
  analysis: {
    summaryRow: PaperSummaryRow;
    evidenceRows: PaperEvidenceRow[];
  }
): string | undefined {
  const sourceMismatchError = validateResolvedSourceIdentity(paper, source);
  if (sourceMismatchError) {
    return sourceMismatchError;
  }

  const analysisTexts = [
    analysis.summaryRow.summary,
    ...analysis.summaryRow.key_findings,
    ...analysis.summaryRow.limitations,
    ...analysis.summaryRow.reproducibility_notes,
    analysis.summaryRow.novelty,
    ...analysis.evidenceRows.flatMap((row) => [row.claim, row.confidence_reason ?? "", row.evidence_span])
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!analysisTexts) {
    return undefined;
  }

  const mismatchPatterns = [
    /(supplied|provided)\s+source\s+(text|document|paper).*(unrelated|different paper|another paper)/i,
    /source\s+(text|document|paper).*(does not match|did not match|mismatch)/i,
    /(document|paper).*(appears|seems)\s+to\s+be.*instead of/i,
    /metadata.*(does not match|did not match|mismatch)/i
  ];
  if (mismatchPatterns.some((pattern) => pattern.test(analysisTexts))) {
    return (
      `analysis_content_mismatch: structured analysis for "${paper.title}" reported a probable source-identity mismatch ` +
      `inside the extracted summary/evidence, so the outputs were quarantined before persistence.`
    );
  }

  return undefined;
}

function buildAnalysisQuarantineRow(input: {
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  analysisMode: "codex_text_image_hybrid" | "responses_api_pdf";
  reason: string;
  analysis?: {
    summaryRow: PaperSummaryRow;
  };
}): AnalysisQuarantineRow {
  return {
    paper_id: input.paper.paper_id,
    title: input.paper.title,
    reason: input.reason,
    source_type: input.source.sourceType,
    analysis_mode: input.analysisMode,
    fallback_reason: input.source.fallbackReason,
    summary_preview: input.analysis?.summaryRow.summary.slice(0, 240),
    source_excerpt: input.source.text.slice(0, 240),
    createdAt: new Date().toISOString()
  };
}

function normalizeIdentityText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function reconcileManifestWithOutputs(
  manifest: AnalysisManifest,
  summaryRows: PaperSummaryRow[],
  evidenceRows: PaperEvidenceRow[]
): {
  manifest: AnalysisManifest;
  summaryRows: PaperSummaryRow[];
  evidenceRows: PaperEvidenceRow[];
  changed: boolean;
  requeuedPaperIds: string[];
  droppedSummaryRows: number;
  droppedEvidenceRows: number;
} {
  const now = new Date().toISOString();
  const nextManifest: AnalysisManifest = {
    ...manifest,
    papers: { ...manifest.papers }
  };
  const summariesByPaper = new Map<string, PaperSummaryRow[]>();
  const evidencesByPaper = new Map<string, PaperEvidenceRow[]>();
  let changed = false;
  const requeuedPaperIds: string[] = [];

  for (const row of summaryRows) {
    const rows = summariesByPaper.get(row.paper_id) ?? [];
    rows.push(row);
    summariesByPaper.set(row.paper_id, rows);
  }
  for (const row of evidenceRows) {
    const rows = evidencesByPaper.get(row.paper_id) ?? [];
    rows.push(row);
    evidencesByPaper.set(row.paper_id, rows);
  }

  const retainedPaperIds = new Set<string>();
  for (const [paperId, entry] of Object.entries(manifest.papers)) {
    if (!entry.selected || entry.status !== "completed") {
      continue;
    }
    const paperSummaries = summariesByPaper.get(paperId) ?? [];
    const paperEvidence = evidencesByPaper.get(paperId) ?? [];
    if (paperSummaries.length !== 1 || paperEvidence.length === 0) {
      changed = true;
      requeuedPaperIds.push(paperId);
      nextManifest.papers[paperId] = {
        ...entry,
        status: "pending",
        summary_count: 0,
        evidence_count: 0,
        last_error: "missing_analysis_outputs",
        updatedAt: now,
        completedAt: undefined
      };
      continue;
    }

    retainedPaperIds.add(paperId);
    const summary = paperSummaries[0];
    if (
      entry.summary_count !== 1 ||
      entry.evidence_count !== paperEvidence.length ||
      entry.source_type !== summary.source_type
    ) {
      changed = true;
      nextManifest.papers[paperId] = {
        ...entry,
        source_type: summary.source_type,
        summary_count: 1,
        evidence_count: paperEvidence.length,
        updatedAt: now
      };
    }
  }

  const nextSummaryRows = summaryRows.filter((row) => retainedPaperIds.has(row.paper_id));
  const nextEvidenceRows = evidenceRows.filter((row) => retainedPaperIds.has(row.paper_id));
  if (nextSummaryRows.length !== summaryRows.length || nextEvidenceRows.length !== evidenceRows.length) {
    changed = true;
  }
  if (changed) {
    nextManifest.updatedAt = now;
  }

  const droppedSummaryRows = summaryRows.length - nextSummaryRows.length;
  const droppedEvidenceRows = evidenceRows.length - nextEvidenceRows.length;
  return {
    manifest: nextManifest,
    summaryRows: nextSummaryRows,
    evidenceRows: nextEvidenceRows,
    changed,
    requeuedPaperIds,
    droppedSummaryRows,
    droppedEvidenceRows
  };
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
