import { createHash } from "node:crypto";

import { LLMClient } from "../llm/client.js";
import { parseStructuredModelJsonObject } from "./modelJson.js";
import { AnalysisCorpusRow, resolvePaperPdfUrl } from "./paperText.js";

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

const GENERIC_REFERENCE_TOKENS = new Set([
  "classification",
  "classifications",
  "classifier",
  "classifiers",
  "learning",
  "machine",
  "model",
  "models",
  "study",
  "studies"
]);

const LOW_SIGNAL_REFERENCE_TOKENS = new Set([
  "baseline",
  "baselines",
  "dataset",
  "datasets",
  "public",
  "small"
]);

const RERANK_MAX_ATTEMPTS = 2;

const BENIGN_RERANK_WARNING_PATTERNS = [
  /codex_core::shell_snapshot/i,
  /failed to delete shell snapshot/i
];

const RERANK_SYSTEM_PROMPT = [
  "You rerank scientific papers for AutoLabOS.",
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

export function buildSelectionRequestFingerprint(
  request: AnalysisSelectionRequest,
  runTitle: string,
  runTopic: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        request,
        runTitle,
        runTopic
      })
    )
    .digest("hex");
}

export async function selectPapersForAnalysis(args: {
  llm: LLMClient;
  runTitle: string;
  runTopic: string;
  corpusRows: AnalysisCorpusRow[];
  request: AnalysisSelectionRequest;
  onProgress?: (message: string) => void;
  abortSignal?: AbortSignal;
}): Promise<PaperSelectionResult> {
  args.onProgress?.(
    `Deterministic pre-rank started for ${args.corpusRows.length} paper(s) using title/topic similarity, citation count, recency, and PDF availability.`
  );
  const referenceTitle = args.runTitle || args.runTopic;
  const ranked = rankPapersDeterministically(referenceTitle, args.corpusRows);
  const totalCandidates = ranked.length;
  args.onProgress?.(`Deterministic pre-rank completed for ${totalCandidates} candidate(s).`);
  if (args.request.selectionMode === "all" || !args.request.topN || args.request.topN >= totalCandidates) {
    const selectedCandidates = filterAllModeCandidates(referenceTitle, ranked);
    if (selectedCandidates.length < ranked.length) {
      args.onProgress?.(
        `All-mode relevance guard filtered ${ranked.length - selectedCandidates.length} low-signal candidate(s); keeping ${selectedCandidates.length} anchored paper(s).`
      );
    }
    const selectedPaperIds = selectedCandidates.map((candidate) => candidate.paper.paper_id);
    const selectedSet = new Set(selectedPaperIds);
    const rankedCandidates = ranked.map((candidate) => ({
      ...candidate,
      selected: selectedSet.has(candidate.paper.paper_id),
      rank: selectedSet.has(candidate.paper.paper_id) ? selectedPaperIds.indexOf(candidate.paper.paper_id) + 1 : undefined,
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

  const candidatePoolSize = Math.min(totalCandidates, Math.min(Math.max(args.request.topN * 3, 30), 90));
  const candidatePool = ranked.slice(0, candidatePoolSize);
  args.onProgress?.(
    `Preparing LLM rerank for ${candidatePool.length} candidate(s) to choose top ${args.request.topN}.`
  );
  args.onProgress?.(`Rerank progress: 1/4 (25%) preparing prompt for ${candidatePool.length} candidate(s).`);
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
    args.onProgress,
    args.abortSignal
  );
  if (!rerank.applied) {
    args.onProgress?.(
      `LLM rerank failed. Top ${args.request.topN} selection requires a successful model rerank (${rerank.fallbackReason}).`
    );
    return {
      request: args.request,
      totalCandidates,
      candidatePoolSize,
      deterministicRankingPreview: ranked.slice(0, 10).map(toPreviewRow),
      rerankedPaperIds: [],
      selectedPaperIds: [],
      selectionFingerprint: buildSelectionFingerprint(args.request, args.runTitle, args.runTopic, []),
      rerankApplied: false,
      rerankFallbackReason: rerank.fallbackReason,
      rankedCandidates: ranked.map((candidate) => ({
        ...candidate,
        selectionScore: candidate.deterministicScore,
        selected: false,
        rank: undefined,
        rerankPosition: undefined
      }))
    };
  }

  const rerankedIds = rerank.orderedPaperIds;
  const rerankOrder = new Map<string, number>(rerankedIds.map((paperId, index) => [paperId, index]));
  args.onProgress?.(
    `LLM rerank completed. Top selection preview: ${rerankedIds.slice(0, Math.min(args.request.topN, 5)).join(", ")}`
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
    selectionRequestFingerprint: buildSelectionRequestFingerprint(request, runTitle, runTopic),
    selectedPaperIds
  });
  return createHash("sha256").update(payload).digest("hex");
}

function filterAllModeCandidates(referenceTitle: string, ranked: RankedPaperCandidate[]): RankedPaperCandidate[] {
  if (ranked.length <= 3) {
    return ranked;
  }

  const referenceTokens = Array.from(new Set(tokenizeTitle(referenceTitle)));
  if (referenceTokens.length === 0) {
    return ranked;
  }

  const thematicTokens = buildThematicTokens(referenceTokens);
  if (thematicTokens.length === 0) {
    return ranked;
  }

  const anchored = ranked.filter((candidate) => {
    const titleTokens = new Set(tokenizeTitle(candidate.paper.title));
    const abstractTokens = new Set(tokenizeTitle(candidate.paper.abstract || ""));
    return thematicTokens.some((token) => titleTokens.has(token) || abstractTokens.has(token));
  });

  const topScore = ranked[0]?.deterministicScore ?? 0;
  const relevanceFloor = Math.max(0.18, Number((topScore * 0.5).toFixed(6)));
  const filtered = anchored.filter((candidate) => candidate.deterministicScore >= relevanceFloor);

  if (filtered.length >= 2 && filtered.length < ranked.length) {
    return filtered;
  }

  if (anchored.length >= 2 && anchored.length < ranked.length) {
    return anchored;
  }

  return ranked;
}

function rankPapersDeterministically(referenceTitle: string, corpusRows: AnalysisCorpusRow[]): RankedPaperCandidate[] {
  const maxCitation = corpusRows.reduce((max, row) => Math.max(max, row.citation_count ?? 0), 0);
  const maxLogCitation = maxCitation > 0 ? Math.log1p(maxCitation) : 0;
  const currentYear = new Date().getUTCFullYear();
  const referenceTokens = Array.from(new Set(tokenizeTitle(referenceTitle)));
  const referenceTokenWeights = buildReferenceTokenWeights(referenceTokens, corpusRows);

  return [...corpusRows]
    .map((paper) => {
      const titleSimilarityScore = computeTitleSimilarityScore(
        referenceTokens,
        referenceTokenWeights,
        paper.title,
        paper.abstract
      );
      const topicCoverageMultiplier = computeTopicCoverageMultiplier(
        referenceTokens,
        paper.title,
        paper.abstract
      );
      const citationScore =
        maxLogCitation > 0 && (paper.citation_count ?? 0) > 0
          ? Math.log1p(paper.citation_count ?? 0) / maxLogCitation
          : 0;
      const recencyScore = computeRecencyScore(paper.year, currentYear);
      const pdfAvailabilityScore = resolvePaperPdfUrl(paper) ? 1 : 0;
      const deterministicScore = Number(
        (
          (
            titleSimilarityScore * 0.78 +
            citationScore * 0.1 +
            recencyScore * 0.07 +
            pdfAvailabilityScore * 0.05
          ) * topicCoverageMultiplier
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
  onProgress?: (message: string) => void,
  abortSignal?: AbortSignal
): Promise<{ orderedPaperIds: string[]; applied: true } | { applied: false; fallbackReason: string }> {
  for (let attempt = 1; attempt <= RERANK_MAX_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) {
        onProgress?.(`Retrying rerank request (${attempt}/${RERANK_MAX_ATTEMPTS}) after a benign Codex warning.`);
      }
      onProgress?.(`Submitting rerank request for ${candidates.length} candidate(s).`);
      onProgress?.("Rerank progress: 2/4 (50%) waiting for model response.");
      const response = await llm.complete(buildRerankPrompt(referenceTitle, runTopic, topN, candidates), {
        systemPrompt: RERANK_SYSTEM_PROMPT,
        abortSignal,
        onProgress: (event) => {
          if (event.type === "delta") {
            return;
          }
          const text = event.text.trim();
          if (!text) {
            return;
          }
          onProgress?.(text);
        }
      });
      onProgress?.("Rerank progress: 3/4 (75%) parsing model ordering.");
      onProgress?.("Received rerank response. Parsing JSON ordering.");
      const { value: parsed, repaired } = parseRerankJson(response.text);
      if (repaired) {
        onProgress?.("Rerank JSON looked truncated; repaired the ordering payload before parsing.");
      }
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
      onProgress?.("Rerank progress: 4/4 (100%) applying rerank order.");

      const fallbackRemainder = candidates
        .map((candidate) => candidate.paper.paper_id)
        .filter((paperId) => !seen.has(paperId));

      return {
        orderedPaperIds: [...orderedPaperIds, ...fallbackRemainder],
        applied: true
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const failure = classifyRerankFailure(error instanceof Error ? error.message : String(error));
      if (failure.benignOnly && attempt < RERANK_MAX_ATTEMPTS) {
        onProgress?.("Rerank request emitted only cleanup warnings without usable output. Retrying once before fallback.");
        continue;
      }
      onProgress?.(`Rerank request failed: ${failure.cleanedMessage}`);
      return {
        applied: false,
        fallbackReason: failure.cleanedMessage
      };
    }
  }

  return {
    applied: false,
    fallbackReason: "rerank_failed_without_output"
  };
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("abort");
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

function parseRerankJson(text: string): { value: RerankJson; repaired: boolean } {
  return parseStructuredModelJsonObject<RerankJson>(text, {
    emptyError: "empty_rerank_output",
    notFoundError: "no_json_object_found",
    incompleteError: "unterminated_json_object",
    invalidError: "invalid_rerank_json"
  });
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

function buildReferenceTokenWeights(referenceTokens: string[], corpusRows: AnalysisCorpusRow[]): Map<string, number> {
  const uniqueReferenceTokens = Array.from(new Set(referenceTokens));
  if (uniqueReferenceTokens.length === 0) {
    return new Map();
  }

  const corpusSize = Math.max(1, corpusRows.length);
  const tokenDocumentFrequency = new Map<string, number>();
  for (const row of corpusRows) {
    const rowTokens = new Set(tokenizeTitle(`${row.title} ${row.abstract || ""}`));
    for (const token of uniqueReferenceTokens) {
      if (rowTokens.has(token)) {
        tokenDocumentFrequency.set(token, (tokenDocumentFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  return new Map(
    uniqueReferenceTokens.map((token) => {
      const documentFrequency = tokenDocumentFrequency.get(token) ?? 0;
      const baseWeight = 1 + Math.log((corpusSize + 1) / (documentFrequency + 1));
      const adjustedWeight = GENERIC_REFERENCE_TOKENS.has(token) ? baseWeight * 0.25 : baseWeight;
      return [token, Number(adjustedWeight.toFixed(6))] as const;
    })
  );
}

function computeTitleSimilarityScore(
  referenceTokens: string[],
  referenceTokenWeights: Map<string, number>,
  paperTitle: string,
  paperAbstract?: string
): number {
  const uniqueReferenceTokens = Array.from(new Set(referenceTokens));
  if (uniqueReferenceTokens.length === 0) {
    return 0;
  }

  const paperTitleTokens = tokenizeTitle(paperTitle);
  const paperTitleTokenSet = new Set(paperTitleTokens);
  const paperAbstractTokenSet = new Set(tokenizeTitle(paperAbstract || ""));
  const totalWeight = uniqueReferenceTokens.reduce(
    (sum, token) => sum + (referenceTokenWeights.get(token) ?? 1),
    0
  );
  if (totalWeight <= 0) {
    return 0;
  }

  let matchedWeight = 0;
  for (const token of uniqueReferenceTokens) {
    const weight = referenceTokenWeights.get(token) ?? 1;
    if (paperTitleTokenSet.has(token)) {
      matchedWeight += weight;
      continue;
    }
    if (paperAbstractTokenSet.has(token)) {
      matchedWeight += weight * resolveAbstractMatchWeight(token);
    }
  }

  const thematicAnchorTokens = buildThematicTokens(uniqueReferenceTokens);
  const anchorTokens =
    thematicAnchorTokens.length > 0
      ? thematicAnchorTokens
      : selectAnchorTokens(uniqueReferenceTokens, referenceTokenWeights);
  const anchorTitleHits = anchorTokens.filter((token) => paperTitleTokenSet.has(token)).length;
  const anchorAbstractHits = anchorTokens.filter((token) => paperAbstractTokenSet.has(token)).length;
  const weightedOverlap = matchedWeight / totalWeight;
  const bigramDice = computeBigramDice(uniqueReferenceTokens.join(" "), paperTitleTokens.join(" "));

  let score = weightedOverlap * 0.8 + bigramDice * 0.2;
  if (anchorTokens.length > 0 && anchorTitleHits === 0 && anchorAbstractHits === 0) {
    score *= 0.35;
  } else if (anchorTokens.length > 0 && anchorTitleHits === 0 && anchorAbstractHits === 1) {
    score *= 0.55;
  } else if (anchorTokens.length > 0 && anchorTitleHits === 0 && anchorAbstractHits > 1) {
    score *= 0.9;
  }

  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

function resolveAbstractMatchWeight(token: string): number {
  return GENERIC_REFERENCE_TOKENS.has(token) ? 0.2 : 0.55;
}

function selectAnchorTokens(referenceTokens: string[], referenceTokenWeights: Map<string, number>): string[] {
  if (referenceTokens.length === 0) {
    return [];
  }

  const weightedTokens = referenceTokens
    .map((token) => ({
      token,
      weight: referenceTokenWeights.get(token) ?? 1
    }))
    .sort((left, right) => right.weight - left.weight || left.token.localeCompare(right.token));
  const averageWeight =
    weightedTokens.reduce((sum, item) => sum + item.weight, 0) / Math.max(1, weightedTokens.length);

  return weightedTokens
    .filter((item, index) => item.weight >= averageWeight || index < Math.min(2, weightedTokens.length))
    .map((item) => item.token);
}

function computeTopicCoverageMultiplier(
  referenceTokens: string[],
  paperTitle: string,
  paperAbstract?: string
): number {
  const thematicTokens = buildThematicTokens(referenceTokens);
  if (thematicTokens.length === 0) {
    return 1;
  }

  const titleTokens = new Set(tokenizeTitle(paperTitle));
  const abstractTokens = new Set(tokenizeTitle(paperAbstract || ""));
  const titleHits = thematicTokens.filter((token) => titleTokens.has(token)).length;
  const abstractHits = thematicTokens.filter((token) => abstractTokens.has(token)).length;

  if (titleHits > 0) {
    return 1;
  }
  if (abstractHits >= 2) {
    return 0.95;
  }
  if (abstractHits === 1) {
    return 0.72;
  }
  return 0.45;
}

function buildThematicTokens(referenceTokens: string[]): string[] {
  return Array.from(new Set(referenceTokens)).filter(
    (token) => token.length >= 5 && !GENERIC_REFERENCE_TOKENS.has(token) && !LOW_SIGNAL_REFERENCE_TOKENS.has(token)
  );
}

function tokenizeTitle(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));
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

function classifyRerankFailure(message: string): { cleanedMessage: string; benignOnly: boolean } {
  const lines = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      cleanedMessage: "rerank_failed_without_output",
      benignOnly: false
    };
  }

  const substantiveLines = lines.filter(
    (line) => !BENIGN_RERANK_WARNING_PATTERNS.some((pattern) => pattern.test(line))
  );
  if (substantiveLines.length === 0) {
    return {
      cleanedMessage:
        "Codex shell snapshot cleanup produced no usable rerank output. Ensure ~/.codex is writable, then rerun /doctor or switch to a healthier environment.",
      benignOnly: true
    };
  }

  return {
    cleanedMessage: substantiveLines.join("\n"),
    benignOnly: false
  };
}
