import { AppConfig, RunRecord } from "../types.js";
import {
  analyzePaperWithLlm,
  analyzePaperWithResponsesPdf,
  PaperEvidenceRow,
  PaperSummaryRow,
  shouldFallbackResponsesPdfToLocalText
} from "./analysis/paperAnalyzer.js";
import { getPdfAnalysisModeForConfig } from "../config.js";
import { AnalysisCorpusRow, resolvePaperPdfUrl, resolvePaperTextSource } from "./analysis/paperText.js";
import { safeRead, writeRunArtifact } from "./nodes/helpers.js";
import { StoredCorpusRow } from "./collection/types.js";
import { LLMClient } from "./llm/client.js";
import { ResponsesPdfAnalysisClient } from "../integrations/openai/responsesPdfAnalysisClient.js";

const RELATED_WORK_ENRICHMENT_MAX_PAPERS = 2;

interface RelatedWorkEnrichmentAnalysisSignature {
  pdf_mode: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  llm_mode?: "codex_chatgpt_only" | "openai_api" | "ollama";
  backend: "responses_api_pdf" | "codex_pdf_model" | "openai_pdf_model" | "ollama_pdf_model";
  model?: string;
  reasoning_effort?: string;
}

interface PersistedRelatedWorkEnrichmentRequest {
  paper_ids: string[];
  analysis_signature: RelatedWorkEnrichmentAnalysisSignature;
}

interface PersistedRelatedWorkEnrichmentResult {
  status: "skipped" | "completed" | "failed" | "reused";
  reason?: string;
  analysis_signature?: RelatedWorkEnrichmentAnalysisSignature;
  attempted_paper_ids: string[];
  analyzed_paper_count: number;
  full_text_count: number;
  abstract_fallback_count: number;
  reused_from_cache?: boolean;
  failures?: Array<{ paper_id: string; reason: string }>;
}

export interface RelatedWorkEnrichmentResult {
  status: "skipped" | "completed" | "failed" | "reused";
  reason?: string;
  attemptedPaperIds: string[];
  summaryRows: PaperSummaryRow[];
  evidenceRows: PaperEvidenceRow[];
  fullTextCount: number;
  abstractFallbackCount: number;
  failures: Array<{ paper_id: string; reason: string }>;
}

export async function maybeEnrichRelatedWorkScout(input: {
  run: RunRecord;
  config: AppConfig;
  scoutRows: StoredCorpusRow[];
  existingPaperIds: Set<string>;
  llm?: LLMClient;
  pdfTextLlm?: LLMClient;
  responsesPdfAnalysis?: ResponsesPdfAnalysisClient;
  abortSignal?: AbortSignal;
  emitLog?: (text: string) => void;
}): Promise<RelatedWorkEnrichmentResult> {
  const analysisSignature = buildEnrichmentAnalysisSignature(input.config);
  const candidates = selectEnrichmentCandidates(input.scoutRows, input.existingPaperIds);
  const request: PersistedRelatedWorkEnrichmentRequest = {
    paper_ids: candidates.map((item) => item.paper_id),
    analysis_signature: analysisSignature
  };
  const cached = await loadCachedEnrichment(input.run, request);
  if (cached) {
    input.emitLog?.(
      `Reusing related-work full-text enrichment for ${cached.attemptedPaperIds.length} scout paper(s) with ${describeAnalysisSignature(analysisSignature)}.`
    );
    return {
      status: "reused",
      reason: cached.reason,
      attemptedPaperIds: cached.attemptedPaperIds,
      summaryRows: cached.summaryRows,
      evidenceRows: cached.evidenceRows,
      fullTextCount: cached.fullTextCount,
      abstractFallbackCount: cached.abstractFallbackCount,
      failures: cached.failures
    };
  }

  if (candidates.length === 0) {
    const skipped: RelatedWorkEnrichmentResult = {
      status: "skipped",
      reason: "no new scout papers were eligible for bounded enrichment",
      attemptedPaperIds: [],
      summaryRows: [],
      evidenceRows: [],
      fullTextCount: 0,
      abstractFallbackCount: 0,
      failures: []
    };
    await persistEnrichment(input.run, request, skipped);
    return skipped;
  }

  const canUseResponsesClient = Boolean(
    input.responsesPdfAnalysis &&
      typeof input.responsesPdfAnalysis.analyzePdf === "function" &&
      (!input.responsesPdfAnalysis.hasApiKey || (await input.responsesPdfAnalysis.hasApiKey()))
  );
  const canUseLlm = typeof input.pdfTextLlm?.complete === "function";
  if (!canUseResponsesClient && !canUseLlm) {
    const skipped: RelatedWorkEnrichmentResult = {
      status: "skipped",
      reason: "no PDF/text analysis client is available in this execution context",
      attemptedPaperIds: candidates.map((item) => item.paper_id),
      summaryRows: [],
      evidenceRows: [],
      fullTextCount: 0,
      abstractFallbackCount: 0,
      failures: []
    };
    await persistEnrichment(input.run, request, skipped);
    input.emitLog?.("Skipping related-work PDF enrichment because no analysis client is available.");
    return skipped;
  }

  input.emitLog?.(`Related-work enrichment selected ${describeAnalysisSignature(analysisSignature)}.`);

  const summaryRows: PaperSummaryRow[] = [];
  const evidenceRows: PaperEvidenceRow[] = [];
  const failures: Array<{ paper_id: string; reason: string }> = [];
  let fullTextCount = 0;
  let abstractFallbackCount = 0;

  for (const row of candidates) {
    input.emitLog?.(`Related-work enrichment: analyzing scout paper "${row.title}".`);
    try {
      const analysisPaper = toAnalysisCorpusRow(row);
      const pdfUrl = resolvePaperPdfUrl(analysisPaper);
      let analysis;
      if (
        canUseResponsesClient &&
        getPdfAnalysisModeForConfig(input.config) === "responses_api_pdf" &&
        pdfUrl &&
        input.responsesPdfAnalysis
      ) {
        try {
          analysis = await analyzePaperWithResponsesPdf({
            client: input.responsesPdfAnalysis,
            paper: analysisPaper,
            pdfUrl,
            model: input.config.analysis.responses_model,
            reasoningEffort: input.config.analysis.responses_reasoning_effort,
            maxAttempts: 2,
            abortSignal: input.abortSignal,
            onProgress: (text) => input.emitLog?.(`[${row.paper_id}] ${text}`)
          });
        } catch (error) {
          if (!shouldFallbackResponsesPdfToLocalText(error)) {
            throw error;
          }
          input.emitLog?.(
            `[${row.paper_id}] Responses API PDF analysis fell back to local/full-text extraction: ${error instanceof Error ? error.message : String(error)}`
          );
          analysis = await analyzeScoutPaperWithTextSource({
            run: input.run,
            paper: analysisPaper,
            llm: input.llm,
            pdfTextLlm: input.pdfTextLlm,
            abortSignal: input.abortSignal,
            emitLog: input.emitLog
          });
        }
      } else {
        analysis = await analyzeScoutPaperWithTextSource({
          run: input.run,
          paper: analysisPaper,
          llm: input.llm,
          pdfTextLlm: input.pdfTextLlm,
          abortSignal: input.abortSignal,
          emitLog: input.emitLog
        });
      }

      summaryRows.push(analysis.summaryRow);
      evidenceRows.push(...analysis.evidenceRows);
      if (analysis.summaryRow.source_type === "full_text") {
        fullTextCount += 1;
      } else {
        abstractFallbackCount += 1;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ paper_id: row.paper_id, reason });
      input.emitLog?.(`[${row.paper_id}] Related-work enrichment failed: ${reason}`);
    }
  }

  const result: RelatedWorkEnrichmentResult = {
    status: summaryRows.length > 0 ? "completed" : "failed",
    reason:
      summaryRows.length > 0
        ? undefined
        : failures[0]?.reason || "related-work enrichment produced no analyzed scout papers",
    attemptedPaperIds: candidates.map((item) => item.paper_id),
    summaryRows,
    evidenceRows,
    fullTextCount,
    abstractFallbackCount,
    failures
  };
  await persistEnrichment(input.run, request, result);
  input.emitLog?.(
    summaryRows.length > 0
      ? `Related-work enrichment analyzed ${summaryRows.length} scout paper(s) (${fullTextCount} full-text, ${abstractFallbackCount} abstract fallback).`
      : "Related-work enrichment produced no usable scout analyses."
  );
  return result;
}

async function analyzeScoutPaperWithTextSource(input: {
  run: RunRecord;
  paper: AnalysisCorpusRow;
  llm?: LLMClient;
  pdfTextLlm?: LLMClient;
  abortSignal?: AbortSignal;
  emitLog?: (text: string) => void;
}) {
  const source = await resolvePaperTextSource({
    runId: input.run.id,
    paper: input.paper,
    includePageImages: false,
    abortSignal: input.abortSignal,
    onProgress: (text) => input.emitLog?.(`[${input.paper.paper_id}] ${text}`)
  });
  const client =
    source.sourceType === "full_text"
      ? input.pdfTextLlm || input.llm
      : input.llm || input.pdfTextLlm;
  if (!client || typeof client.complete !== "function") {
    throw new Error("No LLM client is available for scout full-text analysis.");
  }
  return analyzePaperWithLlm({
    llm: client,
    paper: input.paper,
    source,
    maxAttempts: 2,
    abortSignal: input.abortSignal,
    onProgress: (text) => input.emitLog?.(`[${input.paper.paper_id}] ${text}`)
  });
}

function selectEnrichmentCandidates(
  scoutRows: StoredCorpusRow[],
  existingPaperIds: Set<string>
): StoredCorpusRow[] {
  return scoutRows
    .filter((item) => item.paper_id && !existingPaperIds.has(item.paper_id))
    .slice()
    .sort((left, right) => {
      const leftHasPdf = resolvePaperPdfUrl(toAnalysisCorpusRow(left)) ? 1 : 0;
      const rightHasPdf = resolvePaperPdfUrl(toAnalysisCorpusRow(right)) ? 1 : 0;
      if (leftHasPdf !== rightHasPdf) {
        return rightHasPdf - leftHasPdf;
      }
      if ((left.citation_count || 0) !== (right.citation_count || 0)) {
        return (right.citation_count || 0) - (left.citation_count || 0);
      }
      return (right.year || 0) - (left.year || 0);
    })
    .slice(0, RELATED_WORK_ENRICHMENT_MAX_PAPERS);
}

function toAnalysisCorpusRow(row: StoredCorpusRow): AnalysisCorpusRow {
  return {
    paper_id: row.paper_id,
    title: row.title,
    abstract: row.abstract || "",
    year: row.year,
    venue: row.venue,
    url: row.url || row.landing_url,
    pdf_url: row.pdf_url,
    authors: row.authors || [],
    citation_count: row.citation_count,
    influential_citation_count: row.influential_citation_count,
    publication_date: row.publication_date,
    publication_types: row.publication_types,
    fields_of_study: row.fields_of_study
  };
}

async function loadCachedEnrichment(
  run: RunRecord,
  request: PersistedRelatedWorkEnrichmentRequest
): Promise<{
  attemptedPaperIds: string[];
  summaryRows: PaperSummaryRow[];
  evidenceRows: PaperEvidenceRow[];
  fullTextCount: number;
  abstractFallbackCount: number;
  failures: Array<{ paper_id: string; reason: string }>;
  reason?: string;
} | undefined> {
  const requestRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/enrichment_request.json`);
  const resultRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/enrichment_result.json`);
  const summariesRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/enrichment_summaries.jsonl`);
  const evidenceRaw = await safeRead(`.autolabos/runs/${run.id}/paper/related_work_scout/enrichment_evidence.jsonl`);
  if (!requestRaw || !resultRaw) {
    return undefined;
  }

  try {
    const cachedRequest = JSON.parse(requestRaw) as PersistedRelatedWorkEnrichmentRequest;
    const cachedResult = JSON.parse(resultRaw) as PersistedRelatedWorkEnrichmentResult;
    if (
      JSON.stringify(cachedRequest.paper_ids || []) !== JSON.stringify(request.paper_ids || []) ||
      JSON.stringify(cachedRequest.analysis_signature || {}) !==
        JSON.stringify(request.analysis_signature || {}) ||
      !["completed", "reused"].includes(cachedResult.status)
    ) {
      return undefined;
    }
    return {
      attemptedPaperIds: cachedResult.attempted_paper_ids || [],
      summaryRows: parseJsonl<PaperSummaryRow>(summariesRaw),
      evidenceRows: parseJsonl<PaperEvidenceRow>(evidenceRaw),
      fullTextCount: cachedResult.full_text_count || 0,
      abstractFallbackCount: cachedResult.abstract_fallback_count || 0,
      failures: cachedResult.failures || [],
      reason: cachedResult.reason
    };
  } catch {
    return undefined;
  }
}

async function persistEnrichment(
  run: RunRecord,
  request: PersistedRelatedWorkEnrichmentRequest,
  result: RelatedWorkEnrichmentResult
): Promise<void> {
  await writeRunArtifact(
    run,
    "paper/related_work_scout/enrichment_request.json",
    `${JSON.stringify(request, null, 2)}\n`
  );
  const persisted: PersistedRelatedWorkEnrichmentResult = {
    status: result.status === "reused" ? "reused" : result.status,
    reason: result.reason,
    analysis_signature: request.analysis_signature,
    attempted_paper_ids: result.attemptedPaperIds,
    analyzed_paper_count: result.summaryRows.length,
    full_text_count: result.fullTextCount,
    abstract_fallback_count: result.abstractFallbackCount,
    failures: result.failures
  };
  await writeRunArtifact(
    run,
    "paper/related_work_scout/enrichment_result.json",
    `${JSON.stringify(persisted, null, 2)}\n`
  );
  await writeRunArtifact(
    run,
    "paper/related_work_scout/enrichment_summaries.jsonl",
    result.summaryRows.length > 0 ? `${result.summaryRows.map((item) => JSON.stringify(item)).join("\n")}\n` : ""
  );
  await writeRunArtifact(
    run,
    "paper/related_work_scout/enrichment_evidence.jsonl",
    result.evidenceRows.length > 0 ? `${result.evidenceRows.map((item) => JSON.stringify(item)).join("\n")}\n` : ""
  );
}

function parseJsonl<T>(raw: string): T[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return undefined;
      }
    })
    .filter((item): item is T => Boolean(item));
}

function buildEnrichmentAnalysisSignature(config: AppConfig): RelatedWorkEnrichmentAnalysisSignature {
  const pdfMode = getPdfAnalysisModeForConfig(config);
  if (pdfMode === "responses_api_pdf") {
    return {
      pdf_mode: pdfMode,
      backend: "responses_api_pdf",
      model: config.analysis?.responses_model,
      reasoning_effort: config.analysis?.responses_reasoning_effort
    };
  }

  const llmMode = config.providers?.llm_mode || "codex_chatgpt_only";
  if (llmMode === "openai_api") {
    return {
      pdf_mode: pdfMode,
      llm_mode: llmMode,
      backend: "openai_pdf_model",
      model: config.providers?.openai?.pdf_model || config.providers?.openai?.model,
      reasoning_effort:
        config.providers?.openai?.pdf_reasoning_effort || config.providers?.openai?.reasoning_effort
    };
  }

  if (llmMode === "ollama") {
    return {
      pdf_mode: pdfMode,
      llm_mode: llmMode,
      backend: "ollama_pdf_model",
      model: config.providers?.ollama?.chat_model,
      reasoning_effort: undefined
    };
  }

  return {
    pdf_mode: pdfMode,
    llm_mode: llmMode,
    backend: "codex_pdf_model",
    model: config.providers?.codex?.pdf_model || config.providers?.codex?.model,
    reasoning_effort:
      config.providers?.codex?.pdf_reasoning_effort || config.providers?.codex?.reasoning_effort
  };
}

function describeAnalysisSignature(signature: RelatedWorkEnrichmentAnalysisSignature): string {
  if (signature.backend === "responses_api_pdf") {
    return `Responses API PDF mode${signature.model ? ` (${signature.model})` : ""}`;
  }
  if (signature.backend === "openai_pdf_model") {
    return `local/full-text PDF mode with OpenAI PDF model${signature.model ? ` (${signature.model})` : ""}`;
  }
  if (signature.backend === "ollama_pdf_model") {
    return `local/full-text PDF mode with Ollama${signature.model ? ` (${signature.model})` : ""}`;
  }
  return `local/full-text PDF mode with Codex PDF model${signature.model ? ` (${signature.model})` : ""}`;
}
