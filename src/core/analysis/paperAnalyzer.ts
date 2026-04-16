import { LLMClient, LLMProgressEvent } from "../llm/client.js";
import { parseStructuredModelJsonObject } from "./modelJson.js";
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
  confidence_reason?: string;
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
  confidence_reason?: unknown;
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

interface RawPaperAnalysisPlan {
  focus_sections?: unknown;
  target_claims?: unknown;
  extraction_priorities?: unknown;
  verification_checks?: unknown;
  risk_flags?: unknown;
}

interface PaperAnalysisPlan {
  focus_sections: string[];
  target_claims: string[];
  extraction_priorities: string[];
  verification_checks: string[];
  risk_flags: string[];
}

export interface PaperAnalysisResult {
  summaryRow: PaperSummaryRow;
  evidenceRows: PaperEvidenceRow[];
  attempts: number;
  rawJson: RawPaperAnalysis;
}

export function synthesizeDeterministicAbstractFallbackResult(args: {
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  failureReason: string;
  attempts?: number;
}): PaperAnalysisResult {
  const fallbackDraft = buildDeterministicAbstractTimeoutFallback(args.paper, args.source, args.failureReason);
  return {
    ...normalizePaperAnalysis(args.paper, args.source, fallbackDraft),
    attempts: args.attempts ?? 1,
    rawJson: fallbackDraft
  };
}

export function synthesizeDeterministicPlannerTimeoutFallbackResult(args: {
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  failureReason: string;
  attempts?: number;
}): PaperAnalysisResult {
  const fallbackDraft = buildDeterministicPlannerTimeoutFallback(args.paper, args.source, args.failureReason);
  return {
    ...normalizePaperAnalysis(args.paper, args.source, fallbackDraft),
    attempts: args.attempts ?? 1,
    rawJson: fallbackDraft
  };
}

export const ANALYSIS_SYSTEM_PROMPT = [
  "You are a scientific literature analyst for AutoLabOS.",
  "Return one JSON object only.",
  "No markdown, no prose before or after the JSON.",
  "Be faithful to the provided source. Do not invent claims.",
  "If the source is weak, keep fields concise and conservative.",
  "When an evidence item is tentative, use a lower confidence and explain it briefly in confidence_reason."
].join(" ");

const ANALYSIS_PLANNER_SYSTEM_PROMPT = [
  "You are the planning agent for AutoLabOS paper analysis.",
  "Read the paper source and produce a compact extraction plan before evidence synthesis.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON.",
  "Prioritize sections, claims, datasets, metrics, and verification checks that will improve grounded extraction."
].join(" ");

const ANALYSIS_REVIEWER_SYSTEM_PROMPT = [
  "You are the verification agent for AutoLabOS paper analysis.",
  "Audit a draft structured analysis against the supplied paper source.",
  "Return one corrected JSON object only.",
  "No markdown, no prose outside JSON.",
  "Remove unsupported claims, tighten evidence spans, and lower confidence when provenance is weak.",
  "Whenever you lower confidence or keep a caveat, fill confidence_reason with a short source-grounded explanation."
].join(" ");

const DEFAULT_ANALYSIS_PLANNER_TIMEOUT_MS = 120_000;
const DEFAULT_ANALYSIS_EXTRACT_TIMEOUT_MS = 240_000;
const DEFAULT_ANALYSIS_REVIEW_TIMEOUT_MS = 120_000;

export async function analyzePaperWithLlm(args: {
  llm: LLMClient;
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  maxAttempts?: number;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<PaperAnalysisResult> {
  const maxAttempts = Math.max(1, args.maxAttempts ?? 2);
  const imageBearingAttemptLimit = (args.source.pageImagePaths?.length ?? 0) > 0 ? 1 : maxAttempts;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= imageBearingAttemptLimit; attempt += 1) {
    try {
      args.onProgress?.(`Starting LLM analysis attempt ${attempt}/${imageBearingAttemptLimit}.`);
      if ((args.source.pageImagePaths?.length ?? 0) > 0) {
        args.onProgress?.(
          `Attaching ${args.source.pageImagePaths?.length ?? 0} rendered PDF page image(s) for hybrid analysis.`
        );
      }
      args.onProgress?.("Planning analysis focus, claim targets, and verification checks.");
      const plannerResolution = await planPaperAnalysisWithLlm({
        llm: args.llm,
        paper: args.paper,
        source: args.source,
        abortSignal: args.abortSignal,
        onProgress: args.onProgress
      });
      const parsed = plannerResolution.draft
        ? plannerResolution.draft
        : await extractPaperAnalysisWithLlm({
            llm: args.llm,
            paper: args.paper,
            source: args.source,
            plan: plannerResolution.plan,
            abortSignal: args.abortSignal,
            onProgress: args.onProgress
          });
      const reviewed = plannerResolution.draft
        ? parsed
        : await reviewPaperAnalysisWithLlm({
            llm: args.llm,
            paper: args.paper,
            source: args.source,
            plan: plannerResolution.plan,
            draft: parsed,
            abortSignal: args.abortSignal,
            onProgress: args.onProgress
          });
      return {
        ...normalizePaperAnalysis(args.paper, args.source, reviewed),
        attempts: attempt,
        rawJson: reviewed
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      args.onProgress?.(
        `Analysis attempt ${attempt}/${imageBearingAttemptLimit} failed: ${describeAnalysisAttemptFailureReason(lastError)}`
      );
      if (shouldSynthesizeAnalysisAttemptTimeoutFallback(args.source, lastError)) {
        args.onProgress?.(
          args.source.sourceType === "abstract"
            ? "Abstract-only analysis still timed out. Using a deterministic abstract fallback analysis to preserve a minimal, source-grounded summary."
            : "Full-text analysis still timed out. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip."
        );
        return synthesizeDeterministicPlannerTimeoutFallbackResult({
          paper: args.paper,
          source: args.source,
          failureReason: lastError.message,
          attempts: attempt
        });
      }
      if (isPaperAnalysisTimeoutError(lastError)) {
        throw lastError;
      }
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
      args.onProgress?.("Planning PDF analysis focus, claim targets, and verification checks.");
      const plannerResolution = await planPaperAnalysisWithResponsesPdf({
        client: args.client,
        paper: args.paper,
        pdfUrl: args.pdfUrl,
        model: args.model,
        reasoningEffort: args.reasoningEffort,
        abortSignal: args.abortSignal,
        onProgress: args.onProgress
      });
      const parsed = plannerResolution.draft
        ? plannerResolution.draft
        : await extractPaperAnalysisWithResponsesPdf({
            client: args.client,
            paper: args.paper,
            pdfUrl: args.pdfUrl,
            model: args.model,
            reasoningEffort: args.reasoningEffort,
            plan: plannerResolution.plan,
            abortSignal: args.abortSignal,
            onProgress: args.onProgress
          });
      const reviewed = plannerResolution.draft
        ? parsed
        : await reviewPaperAnalysisWithResponsesPdf({
            client: args.client,
            paper: args.paper,
            pdfUrl: args.pdfUrl,
            model: args.model,
            reasoningEffort: args.reasoningEffort,
            plan: plannerResolution.plan,
            draft: parsed,
            abortSignal: args.abortSignal,
            onProgress: args.onProgress
          });
      return {
        ...normalizePaperAnalysis(args.paper, sourceHint, reviewed),
        attempts: attempt,
        rawJson: reviewed
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      args.onProgress?.(
        `PDF analysis attempt ${attempt}/${maxAttempts} failed: ${describeAnalysisAttemptFailureReason(lastError)}`
      );
      if (shouldFallbackResponsesPdfToLocalText(lastError)) {
        throw lastError;
      }
      if (isPaperAnalysisTimeoutError(lastError)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("paper_analysis_failed");
}

async function planPaperAnalysisWithLlm(args: {
  llm: LLMClient;
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<{ plan: PaperAnalysisPlan; draft?: RawPaperAnalysis }> {
  try {
    const timeoutMs = resolveAnalysisPlannerTimeoutMs();
    const plannerSource = stripSupplementalPageImages(args.source);
    const completion = await runWithAbortableTimeout(
      timeoutMs,
      args.abortSignal,
      (abortSignal) =>
        args.llm.complete(buildPaperAnalysisPlannerPrompt(args.paper, plannerSource), {
          systemPrompt: ANALYSIS_PLANNER_SYSTEM_PROMPT,
          abortSignal,
          onProgress: (event) => emitLlmProgress(args.onProgress, event)
        }),
      `paper_analysis_planner_timeout_after_${timeoutMs}ms`
    );
    const planned = resolvePlannerOutput(completion.text, args.paper, args.source);
    if (planned.draft) {
      args.onProgress?.("Planner returned a directly usable structured analysis; reusing it as the extractor draft.");
    } else {
      args.onProgress?.(
        `Planner identified ${planned.plan.focus_sections.length} focus section(s) and ${planned.plan.target_claims.length} target claim(s).`
      );
    }
    return planned;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (shouldSynthesizePlannerTimeoutFallback(args.source, error)) {
      args.onProgress?.(
        args.source.sourceType === "abstract"
          ? "Planner timed out on an abstract-only source. Using a deterministic abstract fallback analysis to preserve a minimal, source-grounded summary."
          : "Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip."
      );
      return {
        plan: buildFallbackAnalysisPlan(args.paper, args.source),
        draft: buildDeterministicPlannerTimeoutFallback(
          args.paper,
          args.source,
          error instanceof Error ? error.message : String(error)
        )
      };
    }
    args.onProgress?.(
      `Planner unavailable, falling back to direct extraction: ${describePlannerFallbackReason(
        error,
        resolveAnalysisPlannerTimeoutMs()
      )}`
    );
    return {
      plan: buildFallbackAnalysisPlan(args.paper, args.source)
    };
  }
}

async function extractPaperAnalysisWithLlm(args: {
  llm: LLMClient;
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  plan: PaperAnalysisPlan;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<RawPaperAnalysis> {
  const timeoutMs = resolveAnalysisExtractTimeoutMs();
  const completion = await runWithAbortableTimeout(
    timeoutMs,
    args.abortSignal,
    (abortSignal) =>
      args.llm.complete(buildPaperAnalysisPrompt(args.paper, args.source, args.plan), {
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        inputImagePaths: args.source.pageImagePaths,
        abortSignal,
        onProgress: (event) => emitLlmProgress(args.onProgress, event)
      }),
    `paper_analysis_extractor_timeout_after_${timeoutMs}ms`
  );
  args.onProgress?.("Received extractor output. Parsing structured JSON.");
  const { value: parsed, repaired } = parsePaperAnalysisJsonDetailed(completion.text);
  if (repaired) {
    args.onProgress?.("Extractor JSON looked truncated; repaired the structured payload before parsing.");
  }
  args.onProgress?.("Extractor JSON parsed successfully.");
  return parsed;
}

async function reviewPaperAnalysisWithLlm(args: {
  llm: LLMClient;
  paper: AnalysisCorpusRow;
  source: ResolvedPaperSource;
  plan: PaperAnalysisPlan;
  draft: RawPaperAnalysis;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<RawPaperAnalysis> {
  try {
    const timeoutMs = resolveAnalysisReviewTimeoutMs();
    const completion = await runWithAbortableTimeout(
      timeoutMs,
      args.abortSignal,
      (abortSignal) =>
        args.llm.complete(buildPaperAnalysisReviewPrompt(args.paper, args.source, args.plan, args.draft), {
          systemPrompt: ANALYSIS_REVIEWER_SYSTEM_PROMPT,
          abortSignal,
          onProgress: (event) => emitLlmProgress(args.onProgress, event)
        }),
      `paper_analysis_reviewer_timeout_after_${timeoutMs}ms`
    );
    args.onProgress?.("Received reviewer output. Parsing corrected structured JSON.");
    const { value: parsed, repaired } = parsePaperAnalysisJsonDetailed(completion.text);
    if (repaired) {
      args.onProgress?.("Reviewer JSON looked truncated; repaired the structured payload before parsing.");
    }
    args.onProgress?.("Reviewer JSON parsed successfully.");
    emitReviewerAudit(args.onProgress, args.draft, parsed);
    return parsed;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    args.onProgress?.(
      `Reviewer unavailable, using extractor draft as-is: ${describeReviewerFallbackReason(
        error,
        resolveAnalysisReviewTimeoutMs()
      )}`
    );
    return args.draft;
  }
}

async function planPaperAnalysisWithResponsesPdf(args: {
  client: ResponsesPdfAnalysisClient;
  paper: AnalysisCorpusRow;
  pdfUrl: string;
  model: string;
  reasoningEffort?: string;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<{ plan: PaperAnalysisPlan; draft?: RawPaperAnalysis }> {
  try {
    const timeoutMs = resolveAnalysisPlannerTimeoutMs();
    const completion = await runWithAbortableTimeout(
      timeoutMs,
      args.abortSignal,
      (abortSignal) =>
        args.client.analyzePdf({
          model: args.model,
          pdfUrl: args.pdfUrl,
          prompt: buildPaperAnalysisFilePlannerPrompt(args.paper),
          systemPrompt: ANALYSIS_PLANNER_SYSTEM_PROMPT,
          reasoningEffort: args.reasoningEffort,
          abortSignal,
          onProgress: (message) => args.onProgress?.(message)
        }),
      `paper_analysis_planner_timeout_after_${timeoutMs}ms`
    );
    const planned = resolvePlannerOutput(
      completion.text,
      args.paper,
      {
        sourceType: "full_text",
        text: buildAbstractFallbackText(args.paper),
        fullTextAvailable: true,
        pdfUrl: args.pdfUrl
      }
    );
    if (planned.draft) {
      args.onProgress?.("Planner returned a directly usable structured PDF analysis; reusing it as the extractor draft.");
    } else {
      args.onProgress?.(
        `Planner identified ${planned.plan.focus_sections.length} focus section(s) and ${planned.plan.target_claims.length} target claim(s) for the PDF analysis.`
      );
    }
    return planned;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    args.onProgress?.(
      `PDF planner unavailable, falling back to direct extraction: ${describePlannerFallbackReason(
        error,
        resolveAnalysisPlannerTimeoutMs()
      )}`
    );
    return {
      plan: buildFallbackAnalysisPlan(args.paper, {
        sourceType: "full_text",
        text: buildAbstractFallbackText(args.paper),
        fullTextAvailable: true,
        pdfUrl: args.pdfUrl
      })
    };
  }
}

async function extractPaperAnalysisWithResponsesPdf(args: {
  client: ResponsesPdfAnalysisClient;
  paper: AnalysisCorpusRow;
  pdfUrl: string;
  model: string;
  reasoningEffort?: string;
  plan: PaperAnalysisPlan;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<RawPaperAnalysis> {
  const timeoutMs = resolveAnalysisExtractTimeoutMs();
  const completion = await runWithAbortableTimeout(
    timeoutMs,
    args.abortSignal,
    (abortSignal) =>
      args.client.analyzePdf({
        model: args.model,
        pdfUrl: args.pdfUrl,
        prompt: buildPaperAnalysisFilePrompt(args.paper, args.plan),
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        reasoningEffort: args.reasoningEffort,
        abortSignal,
        onProgress: (message) => args.onProgress?.(message)
      }),
    `paper_analysis_extractor_timeout_after_${timeoutMs}ms`
  );
  args.onProgress?.("Received Responses API extractor output. Parsing structured JSON.");
  const { value: parsed, repaired } = parsePaperAnalysisJsonDetailed(completion.text);
  if (repaired) {
    args.onProgress?.("Responses API extractor JSON looked truncated; repaired the structured payload before parsing.");
  }
  args.onProgress?.("Responses API extractor JSON parsed successfully.");
  return parsed;
}

async function reviewPaperAnalysisWithResponsesPdf(args: {
  client: ResponsesPdfAnalysisClient;
  paper: AnalysisCorpusRow;
  pdfUrl: string;
  model: string;
  reasoningEffort?: string;
  plan: PaperAnalysisPlan;
  draft: RawPaperAnalysis;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<RawPaperAnalysis> {
  try {
    const timeoutMs = resolveAnalysisReviewTimeoutMs();
    const completion = await runWithAbortableTimeout(
      timeoutMs,
      args.abortSignal,
      (abortSignal) =>
        args.client.analyzePdf({
          model: args.model,
          pdfUrl: args.pdfUrl,
          prompt: buildPaperAnalysisFileReviewPrompt(args.paper, args.plan, args.draft),
          systemPrompt: ANALYSIS_REVIEWER_SYSTEM_PROMPT,
          reasoningEffort: args.reasoningEffort,
          abortSignal,
          onProgress: (message) => args.onProgress?.(message)
        }),
      `paper_analysis_reviewer_timeout_after_${timeoutMs}ms`
    );
    args.onProgress?.("Received Responses API reviewer output. Parsing corrected structured JSON.");
    const { value: parsed, repaired } = parsePaperAnalysisJsonDetailed(completion.text);
    if (repaired) {
      args.onProgress?.("Responses API reviewer JSON looked truncated; repaired the structured payload before parsing.");
    }
    args.onProgress?.("Responses API reviewer JSON parsed successfully.");
    emitReviewerAudit(args.onProgress, args.draft, parsed);
    return parsed;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    args.onProgress?.(
      `PDF reviewer unavailable, using extractor draft as-is: ${describeReviewerFallbackReason(
        error,
        resolveAnalysisReviewTimeoutMs()
      )}`
    );
    return args.draft;
  }
}

function resolvePlannerOutput(
  text: string,
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource
): { plan: PaperAnalysisPlan; draft?: RawPaperAnalysis } {
  try {
    return {
      plan: normalizePaperAnalysisPlan(parsePaperAnalysisPlanJson(text), paper, source)
    };
  } catch {
    try {
      return {
        plan: buildFallbackAnalysisPlan(paper, source),
        draft: parsePaperAnalysisJson(text)
      };
    } catch {
      return {
        plan: buildFallbackAnalysisPlan(paper, source)
      };
    }
  }
}

export function shouldFallbackResponsesPdfToLocalText(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    /paper_analysis_(planner|extractor|reviewer)_timeout_after_\d+ms/i,
    /planner exceeded the \d+ms timeout/i,
    /extractor exceeded the \d+ms timeout/i,
    /reviewer exceeded the \d+ms timeout/i,
    /error while downloading/i,
    /timeout while downloading/i,
    /failed to download/i,
    /unable to download/i,
    /unable to fetch/i,
    /could not fetch/i,
    /fetch failed/i,
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

function isPaperAnalysisTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /paper_analysis_(planner|extractor|reviewer)_timeout_after_\d+ms/i.test(message);
}

function isPaperAnalysisPlannerTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /paper_analysis_planner_timeout_after_\d+ms/i.test(message);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

function shouldSynthesizeAnalysisAttemptTimeoutFallback(source: ResolvedPaperSource, error: unknown): boolean {
  if (source.sourceType === "abstract") {
    return isPaperAnalysisTimeoutError(error);
  }
  if (source.sourceType === "full_text") {
    return isPaperAnalysisPlannerTimeoutError(error);
  }
  return false;
}

function shouldSynthesizePlannerTimeoutFallback(source: ResolvedPaperSource, error: unknown): boolean {
  return isPaperAnalysisPlannerTimeoutError(error) && (source.sourceType === "abstract" || source.sourceType === "full_text");
}

function buildDeterministicAbstractTimeoutFallback(
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource,
  failureReason: string
): RawPaperAnalysis {
  const abstract = paper.abstract?.trim() || "";
  const fallbackSummary = summarizeAbstractForTimeoutFallback(abstract, paper.title);
  const abstractSentence = firstMeaningfulSentence(abstract);
  const evidenceSpan = trimToLength(abstract || source.text || paper.title, 240);
  const claim = trimToLength(abstractSentence || fallbackSummary, 220);
  return {
    summary: fallbackSummary,
    key_findings: abstractSentence ? [trimToLength(abstractSentence, 180)] : [],
    limitations: ["Abstract-only fallback; no verified full-text extraction completed before timeout."],
    datasets: [],
    metrics: [],
    novelty: "Not established from abstract-only fallback evidence.",
    reproducibility_notes: [
      `Synthesized from title/abstract only after analysis timed out (${failureReason}).`
    ],
    evidence_items: [
      {
        claim,
        method_slot: "Not specified from abstract-only fallback.",
        result_slot: fallbackSummary,
        limitation_slot: "Full-text extraction or extraction review did not complete before timeout.",
        dataset_slot: "Not specified.",
        metric_slot: "Not specified.",
        evidence_span: evidenceSpan,
        confidence: 0.3,
        confidence_reason:
          "This item was synthesized from title/abstract only after repeated analysis timeouts, so it should be treated as weak abstract-only evidence."
      }
    ]
  };
}

function buildDeterministicPlannerTimeoutFallback(
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource,
  failureReason: string
): RawPaperAnalysis {
  if (source.sourceType === "abstract") {
    return buildDeterministicAbstractTimeoutFallback(paper, source, failureReason);
  }

  const sourceText = source.text?.trim() || buildAbstractFallbackText(paper);
  const firstSentence = firstMeaningfulSentence(sourceText);
  const summary = trimToLength(firstSentence || sourceText || paper.title, 280);
  const evidenceSpan = trimToLength(sourceText || paper.title, 240);
  const claim = trimToLength(firstSentence || summary, 220);
  return {
    summary,
    key_findings: firstSentence ? [trimToLength(firstSentence, 180)] : [],
    limitations: [
      "Deterministic full-text fallback; planner timed out before structured extraction and review completed."
    ],
    datasets: [],
    metrics: [],
    novelty: "Not established from planner-timeout fallback evidence.",
    reproducibility_notes: [
      `Synthesized from extracted full text after the planner timed out (${failureReason}).`
    ],
    evidence_items: [
      {
        claim,
        method_slot: "Not yet structured; planner timed out before extraction planning completed.",
        result_slot: summary,
        limitation_slot: "Structured extraction and review did not complete before timeout.",
        dataset_slot: "Not yet structured.",
        metric_slot: "Not yet structured.",
        evidence_span: evidenceSpan,
        confidence: 0.45,
        confidence_reason:
          "This item was synthesized directly from the extracted full text after a planner timeout, so it is weaker than a normal structured extraction+review pass."
      }
    ]
  };
}

function summarizeAbstractForTimeoutFallback(abstract: string, title: string): string {
  const sentence = firstMeaningfulSentence(abstract);
  if (sentence) {
    return trimToLength(sentence, 280);
  }
  if (abstract) {
    return trimToLength(abstract, 280);
  }
  return trimToLength(`Abstract-only fallback for "${title}".`, 280);
}

function firstMeaningfulSentence(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  const sentences = normalized
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24);
  return sentences[0] || normalized;
}

function trimToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function buildPaperAnalysisPrompt(
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource,
  plan?: PaperAnalysisPlan
): string {
  const attachedImagesNote =
    source.pageImagePaths && source.pageImagePaths.length > 0
      ? [
          `Attached page images: ${source.pageImagePaths.length}`,
          source.pageImagePages && source.pageImagePages.length > 0
            ? `Attached page numbers: ${formatAttachedPageNumbers(source.pageImagePages)}`
            : undefined,
          "Use the attached page images to recover figure, table, equation, and layout details that may be weak in extracted text.",
          "If image content conflicts with extracted text, prefer the page image for localized visual details."
        ].filter(Boolean)
      : [];

  return [
    "Analyze the following paper and extract structured evidence.",
    "If an evidence item is tentative or indirect, lower confidence and explain why in confidence_reason.",
    "Keep the JSON compact: summary <= 4 short sentences; key_findings/limitations/datasets/metrics/reproducibility_notes <= 4 short strings each.",
    "Return at most 4 evidence_items, and keep each evidence_span to one short quoted or paraphrased sentence (<= 240 characters).",
    "Return JSON with this exact top-level shape:",
    ...buildPaperAnalysisSchemaLines(),
    "",
    `Paper ID: ${paper.paper_id}`,
    `Title: ${paper.title}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Venue: ${paper.venue ?? "unknown"}`,
    `Authors: ${paper.authors.join(", ") || "unknown"}`,
    `Citation count: ${paper.citation_count ?? "unknown"}`,
    `Source type: ${source.sourceType}`,
    ...attachedImagesNote,
    ...buildPlanContextLines(plan),
    "Source text:",
    source.text
  ].join("\n");
}

function formatAttachedPageNumbers(pages: number[]): string {
  if (pages.length === 0) {
    return "";
  }

  const ranges: string[] = [];
  let start = pages[0];
  let end = pages[0];

  for (let index = 1; index < pages.length; index += 1) {
    const page = pages[index];
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = page;
    end = page;
  }

  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(", ");
}

export function buildPaperAnalysisFilePrompt(paper: AnalysisCorpusRow, plan?: PaperAnalysisPlan): string {
  return [
    "Analyze the attached PDF paper and extract structured evidence.",
    "The attached PDF is the primary source. Use the metadata and abstract below only as supplemental context.",
    "If an evidence item is tentative or indirect, lower confidence and explain why in confidence_reason.",
    "Keep the JSON compact: summary <= 4 short sentences; key_findings/limitations/datasets/metrics/reproducibility_notes <= 4 short strings each.",
    "Return at most 4 evidence_items, and keep each evidence_span to one short quoted or paraphrased sentence (<= 240 characters).",
    "Return JSON with this exact top-level shape:",
    ...buildPaperAnalysisSchemaLines(),
    "",
    `Paper ID: ${paper.paper_id}`,
    `Title: ${paper.title}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Venue: ${paper.venue ?? "unknown"}`,
    `Authors: ${paper.authors.join(", ") || "unknown"}`,
    `Citation count: ${paper.citation_count ?? "unknown"}`,
    ...buildPlanContextLines(plan),
    "Abstract/context:",
    paper.abstract?.trim() || "Abstract unavailable."
  ].join("\n");
}

export function buildPaperAnalysisPlannerPrompt(paper: AnalysisCorpusRow, source: ResolvedPaperSource): string {
  const attachedImagesNote =
    source.pageImagePaths && source.pageImagePaths.length > 0
      ? [
          `Attached page images: ${source.pageImagePaths.length}`,
          source.pageImagePages && source.pageImagePages.length > 0
            ? `Attached page numbers: ${formatAttachedPageNumbers(source.pageImagePages)}`
            : undefined
        ].filter(Boolean)
      : [];

  return [
    "Plan a grounded paper-analysis workflow before extraction.",
    "Return JSON with this exact top-level shape:",
    "{",
    '  "focus_sections": ["string"],',
    '  "target_claims": ["string"],',
    '  "extraction_priorities": ["string"],',
    '  "verification_checks": ["string"],',
    '  "risk_flags": ["string"]',
    "}",
    "",
    `Paper ID: ${paper.paper_id}`,
    `Title: ${paper.title}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Venue: ${paper.venue ?? "unknown"}`,
    `Source type: ${source.sourceType}`,
    ...attachedImagesNote,
    "Source text:",
    source.text
  ].join("\n");
}

export function buildPaperAnalysisFilePlannerPrompt(paper: AnalysisCorpusRow): string {
  return [
    "Plan a grounded PDF-paper analysis workflow before extraction.",
    "The attached PDF is the primary source. Use the metadata and abstract below only as supplemental context.",
    "Return JSON with this exact top-level shape:",
    "{",
    '  "focus_sections": ["string"],',
    '  "target_claims": ["string"],',
    '  "extraction_priorities": ["string"],',
    '  "verification_checks": ["string"],',
    '  "risk_flags": ["string"]',
    "}",
    "",
    `Paper ID: ${paper.paper_id}`,
    `Title: ${paper.title}`,
    `Year: ${paper.year ?? "unknown"}`,
    `Venue: ${paper.venue ?? "unknown"}`,
    "Abstract/context:",
    paper.abstract?.trim() || "Abstract unavailable."
  ].join("\n");
}

export function buildPaperAnalysisReviewPrompt(
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource,
  plan: PaperAnalysisPlan,
  draft: RawPaperAnalysis
): string {
  return [
    "Audit the draft paper analysis against the supplied source and correct it.",
    "Prefer dropping unsupported items over guessing.",
    "Whenever you keep a caveat or lower confidence, explain it in confidence_reason for that evidence item.",
    "Keep the corrected JSON compact, and if the draft contains more than 4 evidence_items, keep only the 4 strongest supported items.",
    "Keep each evidence_span to one short quoted or paraphrased sentence (<= 240 characters).",
    "Return JSON with this exact top-level shape:",
    ...buildPaperAnalysisSchemaLines(),
    "",
    `Paper ID: ${paper.paper_id}`,
    ...buildPlanContextLines(plan),
    "Draft analysis JSON:",
    JSON.stringify(draft, null, 2),
    "",
    "Source text:",
    source.text
  ].join("\n");
}

export function buildPaperAnalysisFileReviewPrompt(
  paper: AnalysisCorpusRow,
  plan: PaperAnalysisPlan,
  draft: RawPaperAnalysis
): string {
  return [
    "Audit the draft PDF-paper analysis against the attached PDF and correct it.",
    "The attached PDF is the primary source. Prefer dropping unsupported items over guessing.",
    "Whenever you keep a caveat or lower confidence, explain it in confidence_reason for that evidence item.",
    "Keep the corrected JSON compact, and if the draft contains more than 4 evidence_items, keep only the 4 strongest supported items.",
    "Keep each evidence_span to one short quoted or paraphrased sentence (<= 240 characters).",
    "Return JSON with this exact top-level shape:",
    ...buildPaperAnalysisSchemaLines(),
    "",
    `Paper ID: ${paper.paper_id}`,
    ...buildPlanContextLines(plan),
    "Draft analysis JSON:",
    JSON.stringify(draft, null, 2),
    "",
    "Abstract/context:",
    paper.abstract?.trim() || "Abstract unavailable."
  ].join("\n");
}

function buildPaperAnalysisSchemaLines(): string[] {
  return [
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
    '      "confidence": 0.0,',
    '      "confidence_reason": "string"',
    "    }",
    "  ]",
    "}"
  ];
}

function buildPlanContextLines(plan: PaperAnalysisPlan | undefined): string[] {
  if (!plan) {
    return [];
  }
  return [
    "Analysis plan:",
    `Focus sections: ${plan.focus_sections.join(" | ") || "none"}`,
    `Target claims: ${plan.target_claims.join(" | ") || "none"}`,
    `Extraction priorities: ${plan.extraction_priorities.join(" | ") || "none"}`,
    `Verification checks: ${plan.verification_checks.join(" | ") || "none"}`,
    plan.risk_flags.length > 0 ? `Risk flags: ${plan.risk_flags.join(" | ")}` : "Risk flags: none"
  ];
}

export function parsePaperAnalysisJson(text: string): RawPaperAnalysis {
  return parsePaperAnalysisJsonDetailed(text).value;
}

function parsePaperAnalysisPlanJson(text: string): RawPaperAnalysisPlan {
  const { value: parsed } = parseStructuredModelJsonObject<RawPaperAnalysisPlan>(text, {
    emptyError: "empty_analysis_plan",
    notFoundError: "analysis_plan_json_not_found",
    incompleteError: "analysis_plan_json_incomplete",
    invalidError: "invalid_analysis_plan"
  });
  if (!isPaperAnalysisPlanLike(parsed)) {
    throw new Error("invalid_analysis_plan");
  }
  return parsed;
}

function parsePaperAnalysisJsonDetailed(text: string): { value: RawPaperAnalysis; repaired: boolean } {
  return parseStructuredModelJsonObject<RawPaperAnalysis>(text, {
    emptyError: "empty_analysis_output",
    notFoundError: "analysis_json_not_found",
    incompleteError: "analysis_json_incomplete",
    invalidError: "invalid_analysis_json"
  });
}

function normalizePaperAnalysisPlan(
  parsed: RawPaperAnalysisPlan,
  paper: AnalysisCorpusRow,
  source: ResolvedPaperSource
): PaperAnalysisPlan {
  const fallbackSections =
    source.sourceType === "full_text"
      ? ["method", "results", "limitations", "datasets/metrics"]
      : ["abstract", "metadata", "reported outcomes", "limitations"];
  const fallbackClaims = [
    `Core contribution of ${paper.title}`,
    "Main quantitative or qualitative result",
    "Dataset and metric details",
    "Primary limitation or caveat"
  ];
  return {
    focus_sections: normalizeStringArray(parsed.focus_sections).slice(0, 6).concat(
      normalizeStringArray(parsed.focus_sections).length > 0 ? [] : fallbackSections
    ),
    target_claims: normalizeStringArray(parsed.target_claims).slice(0, 6).concat(
      normalizeStringArray(parsed.target_claims).length > 0 ? [] : fallbackClaims
    ),
    extraction_priorities: normalizeStringArray(parsed.extraction_priorities).slice(0, 6).concat(
      normalizeStringArray(parsed.extraction_priorities).length > 0
        ? []
        : ["Prefer claims with explicit supporting evidence spans.", "Capture datasets, metrics, and limitations before novelty claims."]
    ),
    verification_checks: normalizeStringArray(parsed.verification_checks).slice(0, 6).concat(
      normalizeStringArray(parsed.verification_checks).length > 0
        ? []
        : ["Remove unsupported claims.", "Lower confidence when the source span is weak or indirect."]
    ),
    risk_flags: normalizeStringArray(parsed.risk_flags).slice(0, 6)
  };
}

function buildFallbackAnalysisPlan(paper: AnalysisCorpusRow, source: ResolvedPaperSource): PaperAnalysisPlan {
  return normalizePaperAnalysisPlan({}, paper, source);
}

function isPaperAnalysisPlanLike(value: RawPaperAnalysisPlan): boolean {
  return [
    value.focus_sections,
    value.target_claims,
    value.extraction_priorities,
    value.verification_checks,
    value.risk_flags
  ].some((field) => Array.isArray(field));
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

  const evidenceRows = calibrateEvidenceRows(
    evidenceItems.map((item, index) => ({
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
      confidence: normalizeConfidence(item.confidence),
      confidence_reason: cleanConfidenceReason(item.confidence_reason)
    })),
    source.text,
    source.sourceType
  );

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
    evidenceRows
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
        confidence: 0.5,
        confidence_reason: "Fallback evidence was synthesized because the model returned no structured evidence items."
      }
    ];
  }
  return raw
    .filter((item): item is RawEvidenceItem => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .slice(0, 4);
}

function calibrateEvidenceRows(
  rows: PaperEvidenceRow[],
  sourceText: string,
  sourceType: "full_text" | "abstract"
): PaperEvidenceRow[] {
  const normalizedSource = normalizeForMatch(sourceText);
  if (!normalizedSource) {
    return rows;
  }
  return rows.map((row) => {
    const normalizedSpan = normalizeForMatch(row.evidence_span);
    if (!normalizedSpan || normalizedSpan.length < 12 || normalizedSource.includes(normalizedSpan)) {
      return row;
    }
    return {
      ...row,
      confidence: Math.min(row.confidence, sourceType === "full_text" ? 0.35 : 0.45),
      confidence_reason:
        row.confidence_reason
        || "Confidence reduced because the cited evidence span could not be grounded in the available source text."
    };
  });
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
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

function cleanConfidenceReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildEvidenceId(paperId: string, index: number): string {
  const stem = paperId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `ev_${stem}_${index + 1}`;
}

function emitReviewerAudit(
  onProgress: ((message: string) => void) | undefined,
  draft: RawPaperAnalysis,
  reviewed: RawPaperAnalysis
): void {
  if (!onProgress) {
    return;
  }

  const draftItems = collectReviewEvidenceItems(draft.evidence_items);
  const reviewedItems = collectReviewEvidenceItems(reviewed.evidence_items);
  if (draftItems.length === 0 && reviewedItems.length === 0) {
    return;
  }

  const draftByClaim = new Map(
    draftItems
      .map((item) => [normalizeForMatch(item.claim), item] as const)
      .filter(([claim]) => Boolean(claim))
  );
  const reviewedClaims = new Set(
    reviewedItems.map((item) => normalizeForMatch(item.claim)).filter(Boolean)
  );

  const removedClaims = draftItems
    .filter((item) => !reviewedClaims.has(normalizeForMatch(item.claim)))
    .map((item) => truncateReviewerText(item.claim));
  if (removedClaims.length > 0) {
    onProgress(
      `Reviewer removed ${removedClaims.length} unsupported claim(s): ${removedClaims.slice(0, 2).join(" | ")}`
    );
  }

  for (const item of reviewedItems) {
    const draftItem = draftByClaim.get(normalizeForMatch(item.claim));
    if (!draftItem) {
      continue;
    }
    if (item.confidence + 0.001 >= draftItem.confidence) {
      continue;
    }
    const reason = item.confidenceReason || "confidence reduced after source verification.";
    onProgress(
      `Reviewer lowered confidence for "${truncateReviewerText(item.claim)}" from ${formatConfidence(draftItem.confidence)} to ${formatConfidence(item.confidence)}: ${reason}`
    );
  }
}

function collectReviewEvidenceItems(
  raw: unknown
): Array<{ claim: string; confidence: number; confidenceReason?: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is RawEvidenceItem => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({
      claim: fallbackString(item.claim, ""),
      confidence: normalizeConfidence(item.confidence),
      confidenceReason: cleanConfidenceReason(item.confidence_reason)
    }))
    .filter((item) => Boolean(item.claim));
}

function formatConfidence(value: number): string {
  return value.toFixed(2);
}

function truncateReviewerText(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function resolveAnalysisPlannerTimeoutMs(): number {
  const configured = Number.parseInt(process.env.AUTOLABOS_ANALYSIS_PLANNER_TIMEOUT_MS || "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_ANALYSIS_PLANNER_TIMEOUT_MS;
}

function resolveAnalysisExtractTimeoutMs(): number {
  const configured = Number.parseInt(process.env.AUTOLABOS_ANALYSIS_EXTRACT_TIMEOUT_MS || "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_ANALYSIS_EXTRACT_TIMEOUT_MS;
}

function resolveAnalysisReviewTimeoutMs(): number {
  const configured = Number.parseInt(process.env.AUTOLABOS_ANALYSIS_REVIEW_TIMEOUT_MS || "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return DEFAULT_ANALYSIS_REVIEW_TIMEOUT_MS;
}

function describePlannerFallbackReason(error: unknown, timeoutMs: number): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === `paper_analysis_planner_timeout_after_${timeoutMs}ms`) {
    return `planner exceeded the ${timeoutMs}ms timeout`;
  }
  return message;
}

function describeReviewerFallbackReason(error: unknown, timeoutMs: number): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === `paper_analysis_reviewer_timeout_after_${timeoutMs}ms`) {
    return `reviewer exceeded the ${timeoutMs}ms timeout`;
  }
  return message;
}

function describeAnalysisAttemptFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === `paper_analysis_planner_timeout_after_${resolveAnalysisPlannerTimeoutMs()}ms`) {
    return `planner exceeded the ${resolveAnalysisPlannerTimeoutMs()}ms timeout`;
  }
  if (message === `paper_analysis_extractor_timeout_after_${resolveAnalysisExtractTimeoutMs()}ms`) {
    return `extractor exceeded the ${resolveAnalysisExtractTimeoutMs()}ms timeout`;
  }
  if (message === `paper_analysis_reviewer_timeout_after_${resolveAnalysisReviewTimeoutMs()}ms`) {
    return `reviewer exceeded the ${resolveAnalysisReviewTimeoutMs()}ms timeout`;
  }
  return message;
}

function stripSupplementalPageImages(source: ResolvedPaperSource): ResolvedPaperSource {
  if ((source.pageImagePaths?.length ?? 0) === 0) {
    return source;
  }
  return {
    ...source,
    pageImagePaths: undefined,
    pageImagePages: undefined
  };
}

async function runWithAbortableTimeout<T>(
  timeoutMs: number,
  outerAbortSignal: AbortSignal | undefined,
  operation: (abortSignal: AbortSignal | undefined) => Promise<T>,
  timeoutErrorMessage: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation(outerAbortSignal);
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;

  const abortFromOuterSignal = () => controller.abort();
  if (outerAbortSignal) {
    if (outerAbortSignal.aborted) {
      controller.abort();
    } else {
      outerAbortSignal.addEventListener("abort", abortFromOuterSignal, { once: true });
    }
  }

  const operationPromise = operation(controller.signal);
  void operationPromise.catch(() => undefined);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(timeoutErrorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutErrorMessage);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    outerAbortSignal?.removeEventListener("abort", abortFromOuterSignal);
  }
}
