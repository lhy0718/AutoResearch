import { LLMClient, LLMProgressEvent } from "../llm/client.js";
import { AnalysisCorpusRow, ResolvedPaperSource, buildAbstractFallbackText } from "./paperText.js";
import { ResponsesPdfAnalysisClient } from "../../integrations/openai/responsesPdfAnalysisClient.js";

export interface PaperSummaryRow {
  paper_id: string;
  title: string;
  source_type: "full_text" | "abstract";
  summary: string;
  key_findings: string[];
  limitations: string[];
  datasets: string[];
  metrics: string[];
  novelty: string;
  reproducibility_notes: string[];
}

export interface PaperEvidenceRow {
  evidence_id: string;
  paper_id: string;
  claim: string;
  method_slot: string;
  result_slot: string;
  limitation_slot: string;
  dataset_slot: string;
  metric_slot: string;
  evidence_span: string;
  source_type: "full_text" | "abstract";
  confidence: number;
}

interface RawEvidenceItem {
  claim?: unknown;
  method_slot?: unknown;
  result_slot?: unknown;
  limitation_slot?: unknown;
  dataset_slot?: unknown;
  metric_slot?: unknown;
  evidence_span?: unknown;
  confidence?: unknown;
}

interface RawPaperAnalysis {
  summary?: unknown;
  key_findings?: unknown;
  limitations?: unknown;
  datasets?: unknown;
  metrics?: unknown;
  novelty?: unknown;
  reproducibility_notes?: unknown;
  evidence_items?: unknown;
}

export interface PaperAnalysisResult {
  summaryRow: PaperSummaryRow;
  evidenceRows: PaperEvidenceRow[];
  attempts: number;
  rawJson: RawPaperAnalysis;
}

export const ANALYSIS_SYSTEM_PROMPT = [
  "You are a scientific literature analyst for AutoResearch.",
  "Return one JSON object only.",
  "No markdown, no prose before or after the JSON.",
  "Be faithful to the provided source. Do not invent claims.",
  "If the source is weak, keep fields concise and conservative."
].join(" ");

export async function analyzePaperWithLlm(args: {
  llm: LLMClient;
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  maxAttempts?: number;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<PaperAnalysisResult> {
  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      args.onProgress?.(`Starting LLM analysis attempt ${attempt}/${maxAttempts}.`);
      const completion = await args.llm.complete(buildPaperAnalysisPrompt(args.paper, args.source), {
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        abortSignal: args.abortSignal,
        onProgress: (event) => {
          emitLlmProgress(args.onProgress, event);
        }
      });
      args.onProgress?.("Received LLM output. Parsing structured JSON.");
      const parsed = parsePaperAnalysisJson(completion.text);
      args.onProgress?.("Structured JSON parsed successfully.");
      return {
        ...normalizePaperAnalysis(args.paper, args.source, parsed),
        attempts: attempt,
        rawJson: parsed
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      args.onProgress?.(`Analysis attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("paper_analysis_failed");
}

export async function analyzePaperWithResponsesPdf(args: {
  client: ResponsesPdfAnalysisClient;
  paper: AnalysisCorpusRow;
  pdfUrl: string;
  model: string;
  reasoningEffort?: string;
  maxAttempts?: number;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<PaperAnalysisResult> {
  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);
  let lastError: Error | undefined;
  const sourceHint: ResolvedPaperSource = {
    sourceType: "full_text",
    text: buildAbstractFallbackText(args.paper),
    fullTextAvailable: true,
    pdfUrl: args.pdfUrl
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      args.onProgress?.(`Starting Responses API PDF analysis attempt ${attempt}/${maxAttempts} with model ${args.model}.`);
      const completion = await args.client.analyzePdf({
        model: args.model,
        pdfUrl: args.pdfUrl,
        prompt: buildPaperAnalysisFilePrompt(args.paper),
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        reasoningEffort: args.reasoningEffort,
        abortSignal: args.abortSignal,
        onProgress: (message) => args.onProgress?.(message)
      });
      args.onProgress?.("Received Responses API output. Parsing structured JSON.");
      const parsed = parsePaperAnalysisJson(completion.text);
      args.onProgress?.("Structured JSON parsed successfully.");
      return {
        ...normalizePaperAnalysis(args.paper, sourceHint, parsed),
        attempts: attempt,
        rawJson: parsed
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      args.onProgress?.(`PDF analysis attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("paper_analysis_failed");
}

export function shouldFallbackResponsesPdfToLocalText(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    /error while downloading/i,
    /timeout while downloading/i,
    /failed to download/i,
    /unable to download/i,
    /unable to fetch/i,
    /could not fetch/i,
    /upstream status code:\s*40[34]/i,
    /invalid_request_error/i,
    /param"\s*:\s*"url"/i,
    /file_url/i,
    /remote file/i
  ].some((pattern) => pattern.test(message));
}

function emitLlmProgress(
  onProgress: ((message: string) => void) | undefined,
  event: LLMProgressEvent
): void {
  if (!onProgress) {
    return;
  }
  if (event.type === "delta") {
    const text = event.text.trim();
    if (text) {
      onProgress(`LLM> ${text}`);
    }
    return;
  }
  const text = event.text.trim();
  if (text) {
    onProgress(text);
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

export function buildPaperAnalysisPrompt(paper: AnalysisCorpusRow, source: ResolvedPaperSource): string {
  return [
    "Analyze the following paper and extract structured evidence.",
    "Return JSON with this exact top-level shape:",
    "{",
    '  "summary": "string",',
    '  "key_findings": ["string"],',
    '  "limitations": ["string"],',
    '  "datasets": ["string"],',
    '  "metrics": ["string"],',
    '  "novelty": "string",',
    '  "reproducibility_notes": ["string"],',
    '  "evidence_items": [',
    "    {",
    '      "claim": "string",',
    '      "method_slot": "string",',
    '      "result_slot": "string",',
    '      "limitation_slot": "string",',
    '      "dataset_slot": "string",',
    '      "metric_slot": "string",',
    '      "evidence_span": "string",',
    '      "confidence": 0.0',
    "    }",
    "  ]",
    "}",
    "",
    `Paper ID: ${paper.paper_id}`,
    `Title: ${paper.title}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Venue: ${paper.venue ?? "unknown"}`,
    `Authors: ${paper.authors.join(", ") || "unknown"}`,
    `Citation count: ${paper.citation_count ?? "unknown"}`,
    `Source type: ${source.sourceType}`,
    "Source text:",
    source.text
  ].join("\n");
}

export function buildPaperAnalysisFilePrompt(paper: AnalysisCorpusRow): string {
  return [
    "Analyze the attached PDF paper and extract structured evidence.",
    "The attached PDF is the primary source. Use the metadata and abstract below only as supplemental context.",
    "Return JSON with this exact top-level shape:",
    "{",
    '  "summary": "string",',
    '  "key_findings": ["string"],',
    '  "limitations": ["string"],',
    '  "datasets": ["string"],',
    '  "metrics": ["string"],',
    '  "novelty": "string",',
    '  "reproducibility_notes": ["string"],',
    '  "evidence_items": [',
    "    {",
    '      "claim": "string",',
    '      "method_slot": "string",',
    '      "result_slot": "string",',
    '      "limitation_slot": "string",',
    '      "dataset_slot": "string",',
    '      "metric_slot": "string",',
    '      "evidence_span": "string",',
    '      "confidence": 0.0',
    "    }",
    "  ]",
    "}",
    "",
    `Paper ID: ${paper.paper_id}`,
    `Title: ${paper.title}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Venue: ${paper.venue ?? "unknown"}`,
    `Authors: ${paper.authors.join(", ") || "unknown"}`,
    `Citation count: ${paper.citation_count ?? "unknown"}`,
    "Abstract/context:",
    paper.abstract?.trim() || "Abstract unavailable."
  ].join("\n");
}

export function parsePaperAnalysisJson(text: string): RawPaperAnalysis {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_analysis_output");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1]?.trim();
  const candidate = fenced || extractFirstJsonObject(trimmed);
  const parsed = JSON.parse(candidate) as RawPaperAnalysis;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_analysis_json");
  }
  return parsed;
}

export function normalizePaperAnalysis(
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource,
  parsed: RawPaperAnalysis
): Pick<PaperAnalysisResult, "summaryRow" | "evidenceRows"> {
  const summary = fallbackString(parsed.summary, paper.abstract || paper.title || "Summary unavailable.");
  const keyFindings = normalizeStringArray(parsed.key_findings);
  const limitations = normalizeStringArray(parsed.limitations);
  const datasets = normalizeStringArray(parsed.datasets);
  const metrics = normalizeStringArray(parsed.metrics);
  const reproducibilityNotes = normalizeStringArray(parsed.reproducibility_notes);
  const novelty = fallbackString(parsed.novelty, keyFindings[0] || "Novelty not specified.");
  const evidenceItems = normalizeEvidenceItems(parsed.evidence_items, summary, paper, source);

  return {
    summaryRow: {
      paper_id: paper.paper_id,
      title: paper.title,
      source_type: source.sourceType,
      summary,
      key_findings: keyFindings,
      limitations,
      datasets,
      metrics,
      novelty,
      reproducibility_notes: reproducibilityNotes
    },
    evidenceRows: evidenceItems.map((item, index) => ({
      evidence_id: buildEvidenceId(paper.paper_id, index),
      paper_id: paper.paper_id,
      claim: fallbackString(item.claim, summary),
      method_slot: fallbackString(item.method_slot, "Not specified."),
      result_slot: fallbackString(item.result_slot, keyFindings[0] || summary),
      limitation_slot: fallbackString(item.limitation_slot, limitations[0] || "Not specified."),
      dataset_slot: fallbackString(item.dataset_slot, datasets[0] || "Not specified."),
      metric_slot: fallbackString(item.metric_slot, metrics[0] || "Not specified."),
      evidence_span: fallbackString(item.evidence_span, summary),
      source_type: source.sourceType,
      confidence: normalizeConfidence(item.confidence)
    }))
  };
}

function normalizeEvidenceItems(
  raw: unknown,
  summary: string,
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource
): RawEvidenceItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      {
        claim: summary,
        method_slot: "Not specified.",
        result_slot: summary,
        limitation_slot: "Not specified.",
        dataset_slot: "Not specified.",
        metric_slot: "Not specified.",
        evidence_span: source.text.slice(0, 240) || paper.abstract || paper.title,
        confidence: 0.5
      }
    ];
  }
  return raw
    .filter((item): item is RawEvidenceItem => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .slice(0, 4);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function fallbackString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback.trim();
  }
  const trimmed = value.trim();
  return trimmed || fallback.trim();
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, Number(value.toFixed(3))));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, Number(parsed.toFixed(3))));
    }
  }
  return 0.5;
}

function buildEvidenceId(paperId: string, index: number): string {
  const stem = paperId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `ev_${stem}_${index + 1}`;
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("analysis_json_not_found");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  throw new Error("analysis_json_incomplete");
}
