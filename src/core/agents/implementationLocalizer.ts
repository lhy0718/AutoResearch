import path from "node:path";

import { AgentComputerInterface } from "../../tools/aci.js";

export interface LocalizationSearchHit {
  path: string;
  line?: number;
  excerpt?: string;
  query: string;
  source: "search_code" | "find_symbol" | "list_files";
}

export interface LocalizationCandidate {
  path: string;
  symbol?: string;
  reason: string;
  confidence?: number;
}

export interface LocalizationResult {
  summary?: string;
  strategy?: string;
  reasoning?: string;
  selected_files: string[];
  candidates: LocalizationCandidate[];
  confidence?: number;
  search_queries?: string[];
  hits?: LocalizationSearchHit[];
}

export interface ImplementationLocalizerInput {
  workspaceRoot: string;
  goal: string;
  topic: string;
  objectiveMetric: string;
  constraints: string[];
  planExcerpt: string;
  hypothesesExcerpt: string;
  previousSummary?: string;
  previousFailureSummary?: string;
  previousRunCommand?: string;
  previousScript?: string;
  existingChangedFiles?: string[];
}

interface CandidateAccumulator {
  path: string;
  score: number;
  reasons: Set<string>;
}

interface LocalizationFocusHints {
  preferredOutputRoots: string[];
  preferredRunIds: string[];
  preferredBasenames: string[];
}

const MAX_QUERIES = 8;
const MAX_HITS = 24;
const MAX_CANDIDATES = 6;
const MAX_SELECTED_FILES = 3;

export class ImplementationLocalizer {
  constructor(private readonly aci: AgentComputerInterface) {}

  async localize(input: ImplementationLocalizerInput): Promise<LocalizationResult> {
    const queries = buildSearchQueries(input);
    const focusHints = deriveLocalizationFocusHints(input);
    const hits: LocalizationSearchHit[] = [];
    const candidates = new Map<string, CandidateAccumulator>();

    for (const query of queries) {
      const searchObs = await this.aci.searchCode(query, input.workspaceRoot, 10);
      for (const hit of parseSearchHits(searchObs.stdout, query, "search_code", input.workspaceRoot)) {
        collectHit(hit, hits);
        bumpCandidate(candidates, hit.path, 3, `${query} matched file content`);
      }

      if (looksLikeSymbol(query)) {
        const symbolObs = await this.aci.findSymbol(query, input.workspaceRoot, 6);
        for (const hit of parseSearchHits(symbolObs.stdout, query, "find_symbol", input.workspaceRoot)) {
          collectHit(hit, hits);
          bumpCandidate(candidates, hit.path, 4, `${query} matched a likely symbol definition`);
        }
      }
    }

    const filesObs = await this.aci.listFiles(input.workspaceRoot, 200);
    const listedFiles = parseFileList(filesObs.stdout, input.workspaceRoot);
    for (const filePath of listedFiles) {
      const score = scorePathFromQueries(filePath, queries, input.existingChangedFiles || [], focusHints);
      if (score > 0) {
        bumpCandidate(candidates, filePath, score, "path matched localization query");
        collectHit(
          {
            path: filePath,
            query: queries[0] || "path_match",
            source: "list_files"
          },
          hits
        );
      }
    }

    const ranked = prioritizeCandidates([...candidates.values()], focusHints)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, MAX_CANDIDATES);
    const selectedFiles = ranked.slice(0, MAX_SELECTED_FILES).map((item) => item.path);
    const sameRunBiasApplied = focusHints.preferredOutputRoots.length > 0 || focusHints.preferredRunIds.length > 0;

    return {
      summary:
        selectedFiles.length > 0
          ? `Search-backed localization selected ${selectedFiles.length} candidate file(s).`
          : "Search-backed localization did not find strong file candidates.",
      strategy: "search_backed_localization",
      reasoning:
        selectedFiles.length > 0
          ? sameRunBiasApplied
            ? "Ranked files by ripgrep content hits, symbol-like matches, path similarity, and run-specific output hints so sibling-run outputs do not outrank the active run."
            : "Ranked files by ripgrep content hits, symbol-like matches, and path similarity to the task."
          : "No useful ripgrep or path matches were found for the current task description.",
      selected_files: selectedFiles,
      candidates: ranked.map((item) => ({
        path: item.path,
        reason: [...item.reasons].join("; "),
        confidence: normalizeConfidence(item.score, ranked[0]?.score || item.score)
      })),
      confidence: normalizeConfidence(ranked[0]?.score || 0, Math.max(ranked[0]?.score || 0, 1)),
      search_queries: queries,
      hits
    };
  }
}

function buildSearchQueries(input: ImplementationLocalizerInput): string[] {
  const queries: string[] = [];
  const push = (value: string | undefined) => {
    const normalized = normalizeQuery(value);
    if (!normalized || queries.includes(normalized)) {
      return;
    }
    queries.push(normalized);
  };

  push(input.topic);
  push(input.objectiveMetric);
  push(input.previousFailureSummary);

  for (const token of extractKeywords([
    input.goal,
    input.topic,
    input.objectiveMetric,
    input.planExcerpt,
    input.hypothesesExcerpt,
    input.previousSummary,
    input.previousFailureSummary,
    path.basename(input.previousScript || ""),
    path.basename(extractScriptPath(input.previousRunCommand) || "")
  ])) {
    push(token);
    if (queries.length >= MAX_QUERIES) {
      break;
    }
  }

  return queries.slice(0, MAX_QUERIES);
}

function extractKeywords(values: Array<string | undefined>): string[] {
  const stopwords = new Set([
    "with",
    "from",
    "that",
    "this",
    "into",
    "using",
    "used",
    "have",
    "will",
    "were",
    "your",
    "their",
    "which",
    "when",
    "where",
    "make",
    "more",
    "only",
    "real",
    "path",
    "task",
    "run",
    "file",
    "files",
    "metrics",
    "json",
    "recent"
  ]);

  const out: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const rawToken of value.split(/[^A-Za-z0-9_./-]+/u)) {
      const token = rawToken.trim().toLowerCase();
      if (
        token.length < 3 ||
        stopwords.has(token) ||
        /^\d+$/u.test(token) ||
        token.includes("/") ||
        token === "none"
      ) {
        continue;
      }
      if (!out.includes(token)) {
        out.push(token);
      }
    }
  }
  return out;
}

function normalizeQuery(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : undefined;
}

function extractScriptPath(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }
  return command
    .split(/\s+/u)
    .map((part) => part.replace(/^['"]|['"]$/g, ""))
    .find((part) => /\.(py|js|mjs|cjs|sh)$/iu.test(part));
}

function parseSearchHits(
  text: string | undefined,
  query: string,
  source: LocalizationSearchHit["source"],
  workspaceRoot: string
): LocalizationSearchHit[] {
  if (!text) {
    return [];
  }
  const out: LocalizationSearchHit[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/^(.*?):(\d+):(.*)$/u);
    if (!match) {
      continue;
    }
    out.push({
      path: normalizePath(match[1], workspaceRoot),
      line: Number(match[2]),
      excerpt: match[3].trim().slice(0, 220),
      query,
      source
    });
  }
  return out;
}

function parseFileList(text: string | undefined, workspaceRoot: string): string[] {
  if (!text) {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizePath(line, workspaceRoot));
}

function normalizePath(filePath: string, workspaceRoot: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
}

function looksLikeSymbol(query: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{2,}$/u.test(query);
}

function scorePathFromQueries(
  filePath: string,
  queries: string[],
  existingChangedFiles: string[],
  focusHints: LocalizationFocusHints
): number {
  const lowerPath = filePath.toLowerCase();
  let score = 0;
  for (const query of queries) {
    const lowerQuery = query.toLowerCase();
    if (lowerPath.includes(lowerQuery)) {
      score += query.includes(" ") ? 3 : 2;
    } else {
      for (const token of lowerQuery.split(/\s+/u)) {
        if (token.length >= 3 && lowerPath.includes(token)) {
          score += 1;
        }
      }
    }
  }

  if (existingChangedFiles.some((item) => item === filePath)) {
    score += 2;
  }

  for (const outputRoot of focusHints.preferredOutputRoots) {
    if (isDescendantPath(filePath, outputRoot)) {
      score += 12;
    }
  }

  for (const runId of focusHints.preferredRunIds) {
    const shortId = runId.slice(0, 8).toLowerCase();
    if (shortId.length >= 4 && lowerPath.includes(shortId)) {
      score += 8;
    }
  }

  for (const basename of focusHints.preferredBasenames) {
    if (path.basename(filePath).toLowerCase() === basename.toLowerCase()) {
      score += 5;
    }
  }

  if (
    focusHints.preferredOutputRoots.length > 0 &&
    isInsideOutputsDirectory(filePath) &&
    !focusHints.preferredOutputRoots.some((outputRoot) => isDescendantPath(filePath, outputRoot))
  ) {
    score -= 6;
  }

  if (
    focusHints.preferredRunIds.length > 0 &&
    isInsideOutputsDirectory(filePath) &&
    !focusHints.preferredRunIds.some((runId) => lowerPath.includes(runId.slice(0, 8).toLowerCase()))
  ) {
    score -= 4;
  }

  return score;
}

function deriveLocalizationFocusHints(input: ImplementationLocalizerInput): LocalizationFocusHints {
  const rawValues = [
    input.planExcerpt,
    input.previousSummary,
    input.previousFailureSummary,
    input.previousRunCommand,
    input.previousScript,
    ...(input.existingChangedFiles || [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  const preferredOutputRoots = new Set<string>();
  const preferredRunIds = new Set<string>();
  const preferredBasenames = new Set<string>();

  for (const value of rawValues) {
    for (const outputRoot of extractPreferredOutputRoots(value, input.workspaceRoot)) {
      preferredOutputRoots.add(outputRoot);
      const suffix = path.basename(outputRoot).match(/-([0-9a-f]{8})$/iu)?.[1];
      if (suffix) {
        preferredRunIds.add(suffix.toLowerCase());
      }
    }
    for (const runId of extractRunIds(value)) {
      preferredRunIds.add(runId.toLowerCase());
    }
    const basename = extractScriptPath(value);
    if (basename) {
      preferredBasenames.add(path.basename(basename));
    }
  }

  return {
    preferredOutputRoots: [...preferredOutputRoots],
    preferredRunIds: [...preferredRunIds],
    preferredBasenames: [...preferredBasenames]
  };
}

function extractPreferredOutputRoots(value: string, workspaceRoot: string): string[] {
  const matches = value.match(/(?:^|[\s"'`(])((?:\/[^"'`\s)]+|outputs\/[^"'`\s)]+))(?:$|[\s"'`),])/gu) || [];
  const roots = new Set<string>();
  const canonicalOutputsRoot = path.join(workspaceRoot, "outputs");
  for (const match of matches) {
    const candidate = match.trim().replace(/^[\s"'`(]+|[\s"'`),]+$/gu, "");
    if (!candidate.includes("outputs/")) {
      continue;
    }
    const normalized = path.isAbsolute(candidate) ? candidate : path.join(workspaceRoot, candidate);
    if (isInsideOutputsDirectory(normalized)) {
      roots.add(canonicalOutputsRoot);
      continue;
    }
    const experimentIndex = normalized.indexOf(`${path.sep}experiment${path.sep}`);
    if (experimentIndex >= 0) {
      roots.add(normalized.slice(0, experimentIndex));
      continue;
    }
    const manifestSuffix = `${path.sep}manifest.json`;
    if (normalized.endsWith(manifestSuffix)) {
      roots.add(normalized.slice(0, -manifestSuffix.length));
      continue;
    }
  }
  return [...roots];
}

function extractRunIds(value: string): string[] {
  const matches = value.match(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu) || [];
  const shortMatches = value.match(/\b[0-9a-f]{8}\b/giu) || [];
  return [...new Set([...matches, ...shortMatches])];
}

function prioritizeCandidates(
  candidates: CandidateAccumulator[],
  focusHints: LocalizationFocusHints
): CandidateAccumulator[] {
  const hasPreferredRunCandidates = candidates.some((candidate) => isPreferredRunCandidate(candidate.path, focusHints));
  if (!hasPreferredRunCandidates) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    if (isPreferredRunCandidate(candidate.path, focusHints)) {
      return true;
    }
    if (isInsideOutputsDirectory(candidate.path)) {
      return false;
    }
    return true;
  });
}

function isPreferredRunCandidate(filePath: string, focusHints: LocalizationFocusHints): boolean {
  if (focusHints.preferredOutputRoots.some((outputRoot) => isDescendantPath(filePath, outputRoot))) {
    return true;
  }
  const lowerPath = filePath.toLowerCase();
  return focusHints.preferredRunIds.some((runId) => lowerPath.includes(runId.slice(0, 8).toLowerCase()));
}

function isInsideOutputsDirectory(filePath: string): boolean {
  return /(?:^|[/\\])outputs(?:[/\\]|$)/u.test(filePath);
}

function isDescendantPath(filePath: string, ancestorPath: string): boolean {
  const relative = path.relative(ancestorPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function bumpCandidate(
  candidates: Map<string, CandidateAccumulator>,
  filePath: string,
  delta: number,
  reason: string
): void {
  const existing = candidates.get(filePath);
  if (existing) {
    existing.score += delta;
    existing.reasons.add(reason);
    return;
  }
  candidates.set(filePath, {
    path: filePath,
    score: delta,
    reasons: new Set([reason])
  });
}

function collectHit(hit: LocalizationSearchHit, hits: LocalizationSearchHit[]): void {
  if (hits.some((existing) => existing.path === hit.path && existing.line === hit.line && existing.query === hit.query)) {
    return;
  }
  if (hits.length < MAX_HITS) {
    hits.push(hit);
  }
}

function normalizeConfidence(score: number, bestScore: number): number {
  if (score <= 0 || bestScore <= 0) {
    return 0;
  }
  return Math.max(0.15, Math.min(0.95, score / bestScore));
}
