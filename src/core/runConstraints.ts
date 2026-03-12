export interface CollectConstraintDefaults {
  dateRange?: string;
  year?: string;
  lastYears?: number;
  fieldsOfStudy?: string[];
  venues?: string[];
  publicationTypes?: string[];
  minCitationCount?: number;
  openAccessPdf?: boolean;
}

export interface PaperConstraintProfile {
  raw: string[];
  targetVenue?: string;
  toneHint?: string;
  lengthHint?: string;
}

export interface ExperimentConstraintProfile {
  designNotes: string[];
  implementationNotes: string[];
  evaluationNotes: string[];
}

export interface ConstraintProfile {
  source: "llm" | "heuristic_fallback";
  raw: string[];
  collect: CollectConstraintDefaults;
  writing: PaperConstraintProfile;
  experiment: ExperimentConstraintProfile;
  assumptions: string[];
}

export interface LiteratureQueryCandidate {
  query: string;
  reason:
    | "requested_query"
    | "brief_topic"
    | "run_topic"
    | "constraint_stripped"
    | "keyword_anchor";
}

export function buildHeuristicConstraintProfile(constraints: string[]): ConstraintProfile {
  const raw = constraints.map((constraint) => constraint.trim()).filter(Boolean);
  return {
    source: "heuristic_fallback",
    raw,
    collect: deriveCollectConstraintDefaults(raw),
    writing: derivePaperConstraintProfile(raw),
    experiment: {
      designNotes: [],
      implementationNotes: [],
      evaluationNotes: []
    },
    assumptions: []
  };
}

export function mergeCollectConstraintDefaults(
  filters: CollectConstraintDefaults | undefined,
  defaults: CollectConstraintDefaults | undefined
): CollectConstraintDefaults | undefined {
  if (!defaults) {
    return hasAnyCollectConstraintDefaults(filters || {}) ? { ...(filters || {}) } : undefined;
  }

  const merged: CollectConstraintDefaults = {
    ...filters
  };

  if (!merged.dateRange && !merged.year && merged.lastYears === undefined && defaults.lastYears !== undefined) {
    merged.lastYears = defaults.lastYears;
  }
  if (!merged.dateRange && !merged.year && defaults.dateRange) {
    merged.dateRange = defaults.dateRange;
  }
  if (!merged.dateRange && !merged.year && !merged.lastYears && defaults.year) {
    merged.year = defaults.year;
  }
  if ((!merged.fieldsOfStudy || merged.fieldsOfStudy.length === 0) && defaults.fieldsOfStudy?.length) {
    merged.fieldsOfStudy = [...defaults.fieldsOfStudy];
  }
  if ((!merged.venues || merged.venues.length === 0) && defaults.venues?.length) {
    merged.venues = [...defaults.venues];
  }
  if ((!merged.publicationTypes || merged.publicationTypes.length === 0) && defaults.publicationTypes?.length) {
    merged.publicationTypes = [...defaults.publicationTypes];
  }
  if (merged.minCitationCount === undefined && defaults.minCitationCount !== undefined) {
    merged.minCitationCount = defaults.minCitationCount;
  }
  if (merged.openAccessPdf === undefined && defaults.openAccessPdf !== undefined) {
    merged.openAccessPdf = defaults.openAccessPdf;
  }

  return hasAnyCollectConstraintDefaults(merged) ? merged : undefined;
}

export function deriveCollectConstraintDefaults(constraints: string[]): CollectConstraintDefaults {
  const normalized = constraints.map((constraint) => constraint.trim()).filter(Boolean);
  const combined = normalized.join(" | ");
  const result: CollectConstraintDefaults = {};

  const lastYearsMatch =
    combined.match(/최근\s*(\d+)\s*년/u) ||
    combined.match(/\blast\s+(\d+)\s+years?\b/iu);
  if (lastYearsMatch) {
    result.lastYears = Number(lastYearsMatch[1]);
  } else if (
    /\brecent papers?\b/iu.test(combined) ||
    /\blatest papers?\b/iu.test(combined) ||
    /최신\s*논문/u.test(combined)
  ) {
    result.lastYears = 3;
  }

  if (
    /\bopen[\s-]?access\b/iu.test(combined) ||
    /\bpdf\b.*\b(link|available|only|required)\b/iu.test(combined) ||
    /오픈\s*액세스/u.test(combined) ||
    /pdf\s*(링크|있는|가능)/u.test(combined)
  ) {
    result.openAccessPdf = true;
  }

  if (
    /\breview papers?\b/iu.test(combined) ||
    /\bsurvey papers?\b/iu.test(combined) ||
    /리뷰\s*논문/u.test(combined) ||
    /서베이\s*논문/u.test(combined)
  ) {
    result.publicationTypes = ["Review"];
  }

  const minCitationMatch =
    combined.match(/(?:min(?:imum)?\s+citations?|citations?\s+at\s+least)\s*(\d+)/iu) ||
    combined.match(/최소\s*인용\s*(\d+)/u) ||
    combined.match(/인용\s*(\d+)\s*이상/u);
  if (minCitationMatch) {
    result.minCitationCount = Number(minCitationMatch[1]);
  }

  return result;
}

export function derivePaperConstraintProfile(constraints: string[]): PaperConstraintProfile {
  const raw = constraints.map((constraint) => constraint.trim()).filter(Boolean);
  const combined = raw.join(" | ");

  return {
    raw,
    targetVenue: detectTargetVenue(combined),
    toneHint: detectToneHint(combined),
    lengthHint: detectLengthHint(combined)
  };
}

export function normalizeConstraintProfile(input: Partial<ConstraintProfile> | undefined, rawConstraints: string[]): ConstraintProfile {
  const raw = rawConstraints.map((constraint) => constraint.trim()).filter(Boolean);
  const collect: Partial<CollectConstraintDefaults> = input?.collect || {};
  const writing: Partial<PaperConstraintProfile> = input?.writing || {};
  const experiment: Partial<ExperimentConstraintProfile> = input?.experiment || {};

  return {
    source: input?.source === "llm" ? "llm" : "heuristic_fallback",
    raw,
    collect: {
      dateRange: cleanString(collect.dateRange),
      year: cleanString(collect.year),
      lastYears: normalizePositiveInteger(collect.lastYears),
      fieldsOfStudy: normalizeStringArray(collect.fieldsOfStudy),
      venues: normalizeStringArray(collect.venues),
      publicationTypes: normalizePublicationTypes(collect.publicationTypes),
      minCitationCount: normalizePositiveInteger(collect.minCitationCount),
      openAccessPdf: normalizeBoolean(collect.openAccessPdf)
    },
    writing: {
      raw,
      targetVenue: cleanString(writing.targetVenue),
      toneHint: cleanString(writing.toneHint),
      lengthHint: cleanString(writing.lengthHint)
    },
    experiment: {
      designNotes: normalizeStringArray(experiment.designNotes),
      implementationNotes: normalizeStringArray(experiment.implementationNotes),
      evaluationNotes: normalizeStringArray(experiment.evaluationNotes)
    },
    assumptions: normalizeStringArray(input?.assumptions)
  };
}

export function extractResearchBriefTopic(rawBrief: string | undefined): string | undefined {
  const text = cleanString(rawBrief);
  if (!text) {
    return undefined;
  }

  const lines = text.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => /^\s{0,3}#{1,6}\s*topic\s*$/iu.test(line.trim()));
  if (headingIndex >= 0) {
    const collected: string[] = [];
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
      if (/^\s{0,3}#{1,6}\s+\S/iu.test(lines[index])) {
        break;
      }
      collected.push(lines[index]);
    }
    const topic = cleanBriefTopic(collected.join("\n"));
    if (topic) {
      return topic;
    }
  }

  const labeledMatch = text.match(/^\s*(?:topic|research topic|study topic|주제)\s*:\s*(.+)$/imu);
  if (labeledMatch?.[1]) {
    return cleanBriefTopic(labeledMatch[1]);
  }

  return undefined;
}

export function buildLiteratureQueryCandidates(input: {
  requestedQuery?: string;
  runTopic: string;
  briefTopic?: string;
}): LiteratureQueryCandidate[] {
  const candidates: LiteratureQueryCandidate[] = [];
  const pushCandidate = (query: string | undefined, reason: LiteratureQueryCandidate["reason"]) => {
    const normalized = normalizeLiteratureQuery(query);
    if (!normalized) {
      return;
    }
    if (candidates.some((candidate) => candidate.query.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    candidates.push({ query: normalized, reason });
  };

  const requested = normalizeLiteratureQuery(input.requestedQuery);
  const briefTopic = normalizeLiteratureQuery(input.briefTopic);
  const runTopic = normalizeLiteratureQuery(input.runTopic);
  const strippedRequested = stripLiteratureConstraintPhrases(requested);
  const strippedBriefTopic = stripLiteratureConstraintPhrases(briefTopic);
  const strippedRunTopic = stripLiteratureConstraintPhrases(runTopic);

  pushCandidate(requested, "requested_query");

  if (!requested) {
    pushCandidate(briefTopic, "brief_topic");
    pushCandidate(runTopic, "run_topic");
  } else {
    pushCandidate(briefTopic, "brief_topic");
    pushCandidate(runTopic, "run_topic");
  }

  pushCandidate(strippedRequested, "constraint_stripped");
  pushCandidate(strippedBriefTopic, "constraint_stripped");
  pushCandidate(strippedRunTopic, "constraint_stripped");
  pushCandidate(buildKeywordAnchorQuery(strippedRequested || strippedBriefTopic || strippedRunTopic || briefTopic || runTopic), "keyword_anchor");

  return candidates;
}

function detectTargetVenue(text: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bacl\b/iu, "ACL"],
    [/\bemnlp\b/iu, "EMNLP"],
    [/\bnaacl\b/iu, "NAACL"],
    [/\bneurips\b/iu, "NeurIPS"],
    [/\biclr\b/iu, "ICLR"],
    [/\bicml\b/iu, "ICML"],
    [/\bcvpr\b/iu, "CVPR"],
    [/\beccv\b/iu, "ECCV"],
    [/\biccv\b/iu, "ICCV"]
  ];
  for (const [pattern, venue] of patterns) {
    if (pattern.test(text)) {
      return venue;
    }
  }
  return undefined;
}

function cleanBriefTopic(value: string | undefined): string | undefined {
  const normalized = normalizeLiteratureQuery(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function normalizeLiteratureQuery(value: string | undefined): string | undefined {
  const cleaned = cleanString(value)
    ?.replace(/^[*_\-#>\s]+/u, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!,:;]+$/u, "")
    .trim();
  return cleaned || undefined;
}

function stripLiteratureConstraintPhrases(value: string | undefined): string | undefined {
  const text = normalizeLiteratureQuery(value);
  if (!text) {
    return undefined;
  }

  let next = ` ${text} `;
  const phrasePatterns = [
    /\b(?:resource-aware|resource constrained|resource-constrained|resource efficient|resource-efficient)\b/giu,
    /\b(?:cpu[-\s]?only|cpu[-\s]?safe|gpu[-\s]?free|laptop[-\s]?safe|consumer[-\s]?hardware)\b/giu,
    /\b(?:locally reproducible|reproducible|seeded|seed[-\s]?controlled|lightweight)\b/giu,
    /\b(?:small|compact)\s+public\s+(?:datasets?|benchmarks?)\b/giu,
    /\bon\s+(?:small|compact)\s+public\s+(?:tabular\s+)?(?:datasets?|benchmarks?)\b/giu,
    /\bfor\s+ordinary\s+local\s+iteration(?:\s+on\s+consumer\s+hardware)?\b/giu,
    /\bwith\s+(?:fixed|seed[-\s]?controlled)\s+(?:train\/validation\/test|train validation test)\s+protocol\b/giu,
    /\b(?:runtime|memory|macro[-\s]?f1|wall[-\s]?clock)\b/giu
  ];

  for (const pattern of phrasePatterns) {
    next = next.replace(pattern, " ");
  }

  next = next
    .replace(/\b(?:on|with|under)\s+(?:consumer|ordinary|local)\s+(?:hardware|execution|iteration)\b/giu, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(?:for|on|with)\s*$/iu, "")
    .trim();

  if (!next) {
    return undefined;
  }
  return normalizeLiteratureQuery(next);
}

function buildKeywordAnchorQuery(value: string | undefined): string | undefined {
  const text = normalizeLiteratureQuery(value);
  if (!text) {
    return undefined;
  }

  const stopwords = new Set([
    "a",
    "an",
    "and",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "using",
    "with"
  ]);
  const keywords = text
    .toLowerCase()
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !stopwords.has(token))
    .filter((token) => token.length > 2)
    .filter(
      (token) =>
        ![
          "resource",
          "aware",
          "small",
          "public",
          "local",
          "consumer",
          "runtime",
          "memory",
          "macro",
          "seeded",
          "reproducible",
          "lightweight"
        ].includes(token)
    );

  if (keywords.length === 0) {
    return undefined;
  }

  const limited = keywords.slice(0, 6);
  if (limited.length < 2) {
    return undefined;
  }
  return normalizeLiteratureQuery(limited.join(" "));
}

function detectToneHint(text: string): string | undefined {
  if (/\bformal\b/iu.test(text) || /\bacademic\b/iu.test(text) || /격식|학술/u.test(text)) {
    return "formal academic";
  }
  if (/\bsurvey\b/iu.test(text) || /\breview\b/iu.test(text) || /서베이|리뷰/u.test(text)) {
    return "survey";
  }
  if (/\btutorial\b/iu.test(text) || /튜토리얼/u.test(text)) {
    return "tutorial";
  }
  if (/\bempirical\b/iu.test(text) || /실증/u.test(text)) {
    return "empirical";
  }
  return undefined;
}

function detectLengthHint(text: string): string | undefined {
  const rangeMatch = text.match(/(\d+)\s*[-~]\s*(\d+)\s*(?:pages?|페이지)/iu);
  if (rangeMatch) {
    return `${rangeMatch[1]}-${rangeMatch[2]} pages`;
  }

  const exactMatch = text.match(/(\d+)\s*(?:pages?|페이지)/iu);
  if (exactMatch) {
    return `${exactMatch[1]} pages`;
  }

  if (/\bshort paper\b/iu.test(text) || /짧은\s*논문/u.test(text)) {
    return "short paper";
  }
  if (/\blong paper\b/iu.test(text) || /\bfull paper\b/iu.test(text) || /장문/u.test(text)) {
    return "long paper";
  }
  if (/\bextended abstract\b/iu.test(text) || /확장\s*초록/u.test(text)) {
    return "extended abstract";
  }
  return undefined;
}

function hasAnyCollectConstraintDefaults(filters: CollectConstraintDefaults): boolean {
  return Boolean(
    filters.dateRange ||
      filters.year ||
      filters.lastYears !== undefined ||
      (filters.fieldsOfStudy && filters.fieldsOfStudy.length > 0) ||
      (filters.venues && filters.venues.length > 0) ||
      (filters.publicationTypes && filters.publicationTypes.length > 0) ||
      filters.minCitationCount !== undefined ||
      filters.openAccessPdf !== undefined
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item));
}

function normalizePublicationTypes(value: unknown): string[] {
  return normalizeStringArray(value).filter((item) => {
    const normalized = item.trim().toLowerCase();
    return !["paper", "papers", "article", "articles"].includes(normalized);
  });
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.floor(raw);
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
