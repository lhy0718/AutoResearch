import { createHash } from "node:crypto";

import { LLMClient } from "../llm/client.js";
import { AnalysisCorpusRow } from "./paperText.js";

export interface AnalysisSelectionRequest {
  topN: number | null;
  selectionMode: "all" | "top_n";
  selectionPolicy: "hybrid_title_citation_recency_pdf_v2";
}

export interface DeterministicScoreBreakdown {
  title_similarity_score: number;
  citation_score: number;
  recency_score: number;
  pdf_availability_score: number;
}

export interface RankedPaperCandidate {
  paper: AnalysisCorpusRow;
  deterministicScore: number;
  selectionScore: number;
  rerankPosition?: number;
  selected: boolean;
  rank?: number;
  scoreBreakdown: DeterministicScoreBreakdown;
}

export interface SelectionPreviewRow {
  paper_id: string;
  title: string;
  deterministic_score: number;
  score_breakdown: DeterministicScoreBreakdown;
}

export interface PaperSelectionResult {
  request: AnalysisSelectionRequest;
  totalCandidates: number;
  candidatePoolSize: number;
  deterministicRankingPreview: SelectionPreviewRow[];
  rerankedPaperIds: string[];
  selectedPaperIds: string[];
  selectionFingerprint: string;
  rerankApplied: boolean;
  rerankFallbackReason?: string;
  rankedCandidates: RankedPaperCandidate[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "based",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "recent",
  "state",
  "study",
  "the",
  "to",
  "with",
  "논문",
  "최근",
  "연구"
]);

const RERANK_SYSTEM_PROMPT = [
  "You rerank scientific papers for AutoResearch.",
  "Return one JSON object only.",
  "No markdown, no prose outside JSON.",
  "Prioritize semantic relevance to the research title/topic first, then citation impact, then recency.",
  "Do not invent paper IDs. Only use paper IDs provided in the candidate list."
].join(" ");

interface RerankJson {
  ordered_paper_ids?: unknown;
  rationale?: unknown;
}

export function normalizeAnalysisSelectionRequest(topN?: number | null): AnalysisSelectionRequest {
  const normalizedTopN = typeof topN === "number" && Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : null;
  return {
    topN: normalizedTopN,
    selectionMode: normalizedTopN ? "top_n" : "all",
    selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
  };
}

export async function selectPapersForAnalysis(args: {
  llm: LLMClient;
  runTitle: string;
  runTopic: string;
  corpusRows: AnalysisCorpusRow[];
  request: AnalysisSelectionRequest;
  onProgress?: (message: string) => void;
}): Promise<PaperSelectionResult> {
  args.onProgress?.(
    `Deterministic pre-rank started for ${args.corpusRows.length} paper(s) using title/topic similarity, citation count, recency, and PDF availability.`
  );
  const ranked = rankPapersDeterministically(args.runTitle || args.runTopic, args.corpusRows);
  const totalCandidates = ranked.length;
  args.onProgress?.(`Deterministic pre-rank completed for ${totalCandidates} candidate(s).`);
  if (args.request.selectionMode === "all" || !args.request.topN || args.request.topN >= totalCandidates) {
    const selectedPaperIds = ranked.map((candidate) => candidate.paper.paper_id);
    const rankedCandidates = ranked.map((candidate, index) => ({
      ...candidate,
      selected: true,
      rank: index + 1,
      selectionScore: candidate.deterministicScore
    }));
    return {
      request: args.request,
      totalCandidates,
      candidatePoolSize: totalCandidates,
      deterministicRankingPreview: ranked.slice(0, 10).map(toPreviewRow),
      rerankedPaperIds: [],
      selectedPaperIds,
      selectionFingerprint: buildSelectionFingerprint(args.request, args.runTitle, args.runTopic, selectedPaperIds),
      rerankApplied: false,
      rankedCandidates
    };
  }

  const candidatePoolSize = Math.min(totalCandidates, Math.max(args.request.topN * 5, 50));
  const candidatePool = ranked.slice(0, candidatePoolSize);
  args.onProgress?.(
    `Preparing LLM rerank for ${candidatePool.length} candidate(s) to choose top ${args.request.topN}.`
  );
  args.onProgress?.(
    `Rerank candidate preview: ${candidatePool
      .slice(0, 5)
      .map((candidate) => `${candidate.paper.paper_id}:${candidate.deterministicScore}`)
      .join(", ")}`
  );
  const rerank = await rerankCandidates(
    args.llm,
    args.runTitle || args.runTopic,
    args.runTopic,
    args.request.topN,
    candidatePool,
    args.onProgress
  );
  const rerankedIds = rerank.orderedPaperIds;
  const rerankOrder = new Map<string, number>(rerankedIds.map((paperId, index) => [paperId, index]));
  args.onProgress?.(
    rerank.applied
      ? `LLM rerank completed. Top selection preview: ${rerankedIds.slice(0, Math.min(args.request.topN, 5)).join(", ")}`
      : `LLM rerank fallback activated. Using deterministic order (${rerank.fallbackReason}).`
  );

  const selectedPaperIds = rerankedIds.slice(0, args.request.topN);
  const selectedSet = new Set(selectedPaperIds);
  const rankedCandidates = ranked
    .map((candidate) => {
      const rerankPosition = rerankOrder.get(candidate.paper.paper_id);
      const selectionScore =
        rerankPosition !== undefined
          ? Number((candidatePoolSize - rerankPosition + candidate.deterministicScore).toFixed(6))
          : candidate.deterministicScore;
      return {
        ...candidate,
        selectionScore,
        rerankPosition,
        selected: selectedSet.has(candidate.paper.paper_id)
      };
    })
    .sort(compareHybridCandidates)
    .map((candidate, index) => ({
      ...candidate,
      rank: candidate.selected ? selectedPaperIds.indexOf(candidate.paper.paper_id) + 1 : undefined
    }));

  return {
    request: args.request,
    totalCandidates,
    candidatePoolSize,
    deterministicRankingPreview: ranked.slice(0, 10).map(toPreviewRow),
    rerankedPaperIds: rerankedIds,
    selectedPaperIds,
    selectionFingerprint: buildSelectionFingerprint(args.request, args.runTitle, args.runTopic, selectedPaperIds),
    rerankApplied: rerank.applied,
    rerankFallbackReason: rerank.fallbackReason,
    rankedCandidates
  };
}

export function buildSelectionFingerprint(
  request: AnalysisSelectionRequest,
  runTitle: string,
  runTopic: string,
  selectedPaperIds: string[]
): string {
  const payload = JSON.stringify({
    request,
    runTitle,
    runTopic,
    selectedPaperIds
  });
  return createHash("sha256").update(payload).digest("hex");
}

function rankPapersDeterministically(referenceTitle: string, corpusRows: AnalysisCorpusRow[]): RankedPaperCandidate[] {
  const maxCitation = corpusRows.reduce((max, row) => Math.max(max, row.citation_count ?? 0), 0);
  const maxLogCitation = maxCitation > 0 ? Math.log1p(maxCitation) : 0;
  const currentYear = new Date().getUTCFullYear();

  return [...corpusRows]
    .map((paper) => {
      const titleSimilarityScore = computeTitleSimilarityScore(referenceTitle, paper.title);
      const citationScore =
        maxLogCitation > 0 && (paper.citation_count ?? 0) > 0
          ? Math.log1p(paper.citation_count ?? 0) / maxLogCitation
          : 0;
      const recencyScore = computeRecencyScore(paper.year, currentYear);
      const pdfAvailabilityScore = paper.pdf_url ? 1 : 0;
      const deterministicScore = Number(
        (
          titleSimilarityScore * 0.45 +
          citationScore * 0.25 +
          recencyScore * 0.1 +
          pdfAvailabilityScore * 0.2
        ).toFixed(6)
      );
      return {
        paper,
        deterministicScore,
        selectionScore: deterministicScore,
        selected: false,
        scoreBreakdown: {
          title_similarity_score: Number(titleSimilarityScore.toFixed(6)),
          citation_score: Number(citationScore.toFixed(6)),
          recency_score: Number(recencyScore.toFixed(6)),
          pdf_availability_score: Number(pdfAvailabilityScore.toFixed(6))
        }
      };
    })
    .sort(compareDeterministicCandidates);
}

async function rerankCandidates(
  llm: LLMClient,
  referenceTitle: string,
  runTopic: string,
  topN: number,
  candidates: RankedPaperCandidate[],
  onProgress?: (message: string) => void
): Promise<{ orderedPaperIds: string[]; applied: boolean; fallbackReason?: string }> {
  try {
    onProgress?.(`Submitting rerank request for ${candidates.length} candidate(s).`);
    const response = await llm.complete(buildRerankPrompt(referenceTitle, runTopic, topN, candidates), {
      systemPrompt: RERANK_SYSTEM_PROMPT,
      onProgress: (event) => {
        const text = event.text.trim();
        if (!text) {
          return;
        }
        onProgress?.(event.type === "delta" ? `LLM rerank> ${text}` : text);
      }
    });
    onProgress?.("Received rerank response. Parsing JSON ordering.");
    const parsed = parseRerankJson(response.text);
    const seen = new Set<string>();
    const orderedPaperIds = normalizeStringArray(parsed.ordered_paper_ids)
      .filter((paperId) => candidates.some((candidate) => candidate.paper.paper_id === paperId))
      .filter((paperId) => {
        if (seen.has(paperId)) {
          return false;
        }
        seen.add(paperId);
        return true;
      });
    onProgress?.(`Parsed rerank JSON with ${orderedPaperIds.length} explicit paper id(s).`);

    const fallbackRemainder = candidates
      .map((candidate) => candidate.paper.paper_id)
      .filter((paperId) => !seen.has(paperId));

    return {
      orderedPaperIds: [...orderedPaperIds, ...fallbackRemainder],
      applied: true
    };
  } catch (error) {
    onProgress?.(`Rerank request failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      orderedPaperIds: candidates.map((candidate) => candidate.paper.paper_id),
      applied: false,
      fallbackReason: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildRerankPrompt(
  referenceTitle: string,
  runTopic: string,
  topN: number,
  candidates: RankedPaperCandidate[]
): string {
  const lines = [
    "Rerank the candidate papers for deep analysis.",
    "Return JSON with this exact shape:",
    '{ "ordered_paper_ids": ["paper_id"], "rationale": "optional short string" }',
    "",
    `Research title: ${referenceTitle || runTopic}`,
    `Research topic: ${runTopic || referenceTitle}`,
    `Need the best ${topN} paper(s) for analysis.`,
    "Candidates:"
  ];

  candidates.forEach((candidate, index) => {
    const abstractSnippet = truncateForPrompt(candidate.paper.abstract || "Abstract unavailable.", 220);
    lines.push(
      [
        `${index + 1}. paper_id=${candidate.paper.paper_id}`,
        `title=${candidate.paper.title}`,
        `year=${candidate.paper.year ?? "unknown"}`,
        `venue=${candidate.paper.venue ?? "unknown"}`,
        `citation_count=${candidate.paper.citation_count ?? 0}`,
        `deterministic_score=${candidate.deterministicScore}`,
        `abstract=${abstractSnippet}`
      ].join(" | ")
    );
  });

  return lines.join("\n");
}

function parseRerankJson(text: string): RerankJson {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_rerank_output");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1]?.trim();
  const candidate = fenced || extractFirstJsonObject(trimmed);
  const parsed = JSON.parse(candidate) as RerankJson;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_rerank_json");
  }
  return parsed;
}

function extractFirstJsonObject(text: string): string {
  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) {
    throw new Error("no_json_object_found");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let idx = firstBrace; idx < text.length; idx += 1) {
    const char = text[idx];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, idx + 1);
      }
    }
  }
  throw new Error("unterminated_json_object");
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function truncateForPrompt(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}…`;
}

function computeTitleSimilarityScore(referenceTitle: string, paperTitle: string): number {
  const referenceTokens = tokenizeTitle(referenceTitle);
  const paperTokens = tokenizeTitle(paperTitle);
  const tokenOverlap = computeTokenOverlap(referenceTokens, paperTokens);
  const bigramDice = computeBigramDice(referenceTokens.join(" "), paperTokens.join(" "));
  return Number(((tokenOverlap + bigramDice) / 2).toFixed(6));
}

function tokenizeTitle(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));
}

function computeTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.max(leftSet.size, rightSet.size);
}

function computeBigramDice(left: string, right: string): number {
  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }
  const rightCounts = new Map<string, number>();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }
  let shared = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;
    if (count > 0) {
      shared += 1;
      rightCounts.set(bigram, count - 1);
    }
  }
  return (2 * shared) / (leftBigrams.length + rightBigrams.length);
}

function buildBigrams(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 2) {
    return [];
  }
  const out: string[] = [];
  for (let idx = 0; idx < normalized.length - 1; idx += 1) {
    out.push(normalized.slice(idx, idx + 2));
  }
  return out;
}

function computeRecencyScore(year: number | undefined, currentYear: number): number {
  if (!year || !Number.isFinite(year)) {
    return 0;
  }
  const age = Math.max(0, currentYear - year);
  return Math.max(0, 1 - Math.min(age, 10) / 10);
}

function compareDeterministicCandidates(left: RankedPaperCandidate, right: RankedPaperCandidate): number {
  return (
    right.deterministicScore - left.deterministicScore ||
    right.scoreBreakdown.title_similarity_score - left.scoreBreakdown.title_similarity_score ||
    right.scoreBreakdown.pdf_availability_score - left.scoreBreakdown.pdf_availability_score ||
    (right.paper.citation_count ?? 0) - (left.paper.citation_count ?? 0) ||
    (right.paper.year ?? 0) - (left.paper.year ?? 0) ||
    left.paper.paper_id.localeCompare(right.paper.paper_id)
  );
}

function compareHybridCandidates(left: RankedPaperCandidate, right: RankedPaperCandidate): number {
  const leftRerank = left.rerankPosition ?? Number.MAX_SAFE_INTEGER;
  const rightRerank = right.rerankPosition ?? Number.MAX_SAFE_INTEGER;
  return (
    leftRerank - rightRerank ||
    right.deterministicScore - left.deterministicScore ||
    right.scoreBreakdown.title_similarity_score - left.scoreBreakdown.title_similarity_score ||
    right.scoreBreakdown.pdf_availability_score - left.scoreBreakdown.pdf_availability_score ||
    (right.paper.citation_count ?? 0) - (left.paper.citation_count ?? 0) ||
    (right.paper.year ?? 0) - (left.paper.year ?? 0) ||
    left.paper.paper_id.localeCompare(right.paper.paper_id)
  );
}

function toPreviewRow(candidate: RankedPaperCandidate): SelectionPreviewRow {
  return {
    paper_id: candidate.paper.paper_id,
    title: candidate.paper.title,
    deterministic_score: candidate.deterministicScore,
    score_breakdown: candidate.scoreBreakdown
  };
}
