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
    | "llm_generated"
    | "brief_topic"
    | "run_topic"
    | "constraint_stripped"
    | "keyword_anchor";
}

const YEAR_SPEC_RE = /^(\d{4}|(\d{4}-\d{4})|(\d{4}-)|(-\d{4}))$/u;
const DATE_PART_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/u;

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
      dateRange: normalizeCollectDateRange(collect.dateRange),
      year: normalizeCollectYear(collect.year),
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
  llmGeneratedQueries?: string[];
  extractedBriefTopic?: string;
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
  const llmGeneratedQueries = sanitizeSemanticScholarQueryList(input.llmGeneratedQueries || []);
  const topicSeed = normalizeLiteratureQuery(input.briefTopic || input.extractedBriefTopic || input.runTopic);
  const topicReason: LiteratureQueryCandidate["reason"] = input.briefTopic
    ? "brief_topic"
    : input.extractedBriefTopic
      ? "brief_topic"
      : "run_topic";
  const strippedTopic = stripLiteratureConstraintPhrases(topicSeed);

  pushCandidate(requested, "requested_query");
  if (requested) {
    return candidates;
  }
  for (const query of llmGeneratedQueries) {
    pushCandidate(query, "llm_generated");
  }

  for (const query of buildDeterministicPhraseBundleQueries(topicSeed)) {
    pushCandidate(query, topicReason);
  }

  if (strippedTopic && strippedTopic !== topicSeed) {
    for (const query of buildDeterministicPhraseBundleQueries(strippedTopic)) {
      pushCandidate(query, "constraint_stripped");
    }
  }

  const keywordAnchor = buildKeywordAnchorQuery(strippedTopic || topicSeed);
  if (isSpecificKeywordAnchorQuery(keywordAnchor)) {
    pushCandidate(keywordAnchor, "keyword_anchor");
  }

  if (candidates.length === 0) {
    pushCandidate(topicSeed, topicReason);
    if (strippedTopic && strippedTopic !== topicSeed) {
      pushCandidate(strippedTopic, "constraint_stripped");
    }
  }

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

export function sanitizeSemanticScholarQueryList(values: Array<string | undefined>): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = sanitizeSemanticScholarFreeTextQuery(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(normalized);
  }
  return results;
}

export function sanitizeSemanticScholarFreeTextQuery(value: string | undefined): string | undefined {
  const normalized = normalizeLiteratureQuery(value);
  if (!normalized) {
    return undefined;
  }

  const cleaned = normalized
    .replace(/```/gu, " ")
    .replace(
      /\b(?:title|abstract|author|authors|venue|journal|year|paperid|doi|fieldsofstudy|fields[\s_-]*of[\s_-]*study)\s*:/giu,
      " "
    )
    .replace(/\bAND\b/gu, " + ")
    .replace(/\bOR\b/gu, " | ")
    .replace(/\bNOT\b/gu, " - ")
    .replace(/'/gu, '"')
    .replace(/[`[\]{}<>]/gu, " ")
    .replace(/[,:;=]/gu, " ")
    .replace(/\s*\|\s*/gu, " | ")
    .replace(/(^|[\s(])\+\s*/gu, "$1+")
    .replace(/(^|[\s(])-+\s*/gu, "$1-")
    .replace(/\s+/gu, " ")
    .trim();

  return normalizeLiteratureQuery(cleaned);
}

export function hasSemanticScholarSpecialSyntax(query: string | undefined): boolean {
  if (!query?.trim()) {
    return false;
  }
  return /[|+()"]/u.test(query) || /\b(?:AND|OR|NOT)\b/u.test(query);
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
  const genericMetaTokens = new Set([
    "agenda",
    "benchmark",
    "benchmarking",
    "future",
    "grade",
    "literature",
    "plan",
    "plans",
    "research",
    "review",
    "reviews",
    "survey",
    "systematic"
  ]);
  const keywords = text
    .toLowerCase()
    .split(/[^a-z0-9]+/iu)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !stopwords.has(token))
    .filter((token) => token.length > 2)
    .filter((token) => !genericMetaTokens.has(token))
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

function buildDeterministicPhraseBundleQueries(value: string | undefined): string[] {
  const phrases = collectDeterministicResearchPhrases(value);
  if (phrases.length === 0) {
    return [];
  }

  const queries: string[] = [];
  const seen = new Set<string>();
  const pushQuery = (query: string | undefined) => {
    const normalized = normalizeLiteratureQuery(query);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    queries.push(normalized);
  };
  const quoted = (phrase: string): string => `"${phrase}"`;
  const lora = phrases.find((phrase) => /^(low-rank adaptation|lora)$/iu.test(phrase)) || undefined;
  const instructionTuning =
    phrases.find((phrase) => /^instruction (?:fine-)?tuning$/iu.test(phrase)) || undefined;
  const modelFamily = phrases.find((phrase) => /\bmistral(?:\s+7b)?\b/iu.test(phrase)) || undefined;
  const adapterAxes = Array.from(
    new Set(
      phrases.filter((phrase) => /^(lora rank|lora dropout)$/iu.test(phrase))
    )
  );
  const anchor = phrases.find((phrase) => /language models?$/iu.test(phrase)) || phrases[0];
  const reasoning =
    phrases.find((phrase) => /test-time|reasoning|reasoners?|math reasoning/iu.test(phrase)) || undefined;
  const adaptive = phrases.find((phrase) => /^adaptive\b/iu.test(phrase)) || undefined;
  const structured = phrases.find((phrase) => /^structured\b/iu.test(phrase)) || undefined;
  const budget = phrases.find((phrase) => /budget|inference/iu.test(phrase)) || undefined;

  if (lora && instructionTuning) {
    pushQuery(`+${quoted(lora)} +${quoted(instructionTuning)}`);
  }
  if (lora && instructionTuning && modelFamily) {
    pushQuery(`+${quoted(lora)} +${quoted(instructionTuning)} +${quoted(modelFamily)}`);
  }
  if (lora && adapterAxes.length > 0) {
    pushQuery(
      adapterAxes.length === 1
        ? `+${quoted(lora)} +${quoted(adapterAxes[0])}`
        : `+${quoted(lora)} +(${adapterAxes.map((phrase) => quoted(phrase)).join(" | ")})`
    );
  }
  if (instructionTuning && modelFamily) {
    pushQuery(`+${quoted(instructionTuning)} +${quoted(modelFamily)}`);
  }

  if (anchor && reasoning && anchor !== reasoning) {
    pushQuery(`+${quoted(anchor)} +${quoted(reasoning)}`);
  }

  const alternatives = Array.from(new Set([adaptive, structured].filter((candidate): candidate is string => Boolean(candidate))));
  if (anchor && alternatives.length === 1) {
    pushQuery(`+${quoted(alternatives[0])} +${quoted(anchor)}`);
  } else if (anchor && alternatives.length > 1) {
    pushQuery(`(${alternatives.map((phrase) => quoted(phrase)).join(" | ")}) +${quoted(anchor)}`);
  }

  if (anchor && budget) {
    const third = reasoning && reasoning !== budget ? ` +${quoted(reasoning)}` : "";
    pushQuery(`+${quoted(budget)} +${quoted(anchor)}${third}`);
  }

  if (queries.length === 0 && phrases.length >= 2) {
    pushQuery(`+${quoted(phrases[0])} +${quoted(phrases[1])}`);
  }
  if (queries.length === 0 && phrases.length >= 1) {
    pushQuery(`+${quoted(phrases[0])}`);
  }

  return queries.slice(0, 4);
}

function collectDeterministicResearchPhrases(value: string | undefined): string[] {
  const text = normalizeLiteratureQuery(value)?.toLowerCase();
  if (!text) {
    return [];
  }

  const phrases: string[] = [];
  const pushPhrase = (phrase: string | undefined) => {
    const normalized = normalizeLiteratureQuery(phrase)?.toLowerCase();
    if (!normalized) {
      return;
    }
    if (normalized.split(/\s+/u).length > 3) {
      return;
    }
    if (!phrases.includes(normalized)) {
      phrases.push(normalized);
    }
  };

  if (/\bsmall\s+language\s+models?\b/u.test(text)) {
    pushPhrase("small language models");
  } else if (/\blanguage\s+models?\b/u.test(text)) {
    pushPhrase("language models");
  }

  if (/\blora\b/u.test(text) || /\blow[-\s]?rank adaptation\b/u.test(text)) {
    pushPhrase("low-rank adaptation");
  }
  if (/\binstruction\b/u.test(text) && /\b(?:fine[-\s]?tuning|tuning)\b/u.test(text)) {
    pushPhrase("instruction tuning");
  }
  if (/\bmistral(?:[-\s]?7b)?(?:[-\s]?v?\d+(?:\.\d+)*)?\b/u.test(text)) {
    pushPhrase("mistral 7b");
  }
  if (/\blora\b/u.test(text) && /\brank\b/u.test(text)) {
    pushPhrase("lora rank");
  }
  if (/\blora\b/u.test(text) && /\bdropout\b/u.test(text)) {
    pushPhrase("lora dropout");
  }

  if (/\btest[-\s]?time\b/u.test(text) && /\breason/u.test(text)) {
    pushPhrase("test-time reasoning");
  } else if (/\btest[-\s]?time\b/u.test(text) && /\bstrateg/u.test(text)) {
    pushPhrase("test-time strategies");
  } else if (/\breason/u.test(text)) {
    pushPhrase("reasoning");
  }

  if (/\badaptive\b/u.test(text) && (/\btest[-\s]?time\b/u.test(text) || /\breason/u.test(text) || /\binference\b/u.test(text))) {
    pushPhrase("adaptive reasoning");
  }
  if (/\bstructured\b/u.test(text) && (/\btest[-\s]?time\b/u.test(text) || /\breason/u.test(text) || /\binference\b/u.test(text))) {
    pushPhrase("structured reasoning");
  }
  if (/\b(?:budget[-\s]?aware|inference\s+budgets?|constrained\s+inference)\b/u.test(text)) {
    pushPhrase("inference budget");
  }
  if (/\bgsm8k\b/u.test(text)) {
    pushPhrase("GSM8K");
  } else if (/\bmath\b/u.test(text) && /\breason/u.test(text)) {
    pushPhrase("math reasoning");
  }

  return phrases.slice(0, 6);
}

function isSpecificKeywordAnchorQuery(value: string | undefined): boolean {
  const text = normalizeLiteratureQuery(value)?.toLowerCase();
  if (!text) {
    return false;
  }

  const groups =
    Number(/\blanguage\s+models?\b|\bllms?\b/u.test(text)) +
    Number(/\btest\b|\btest-time\b/u.test(text)) +
    Number(/\breason(?:ing|er|ers)?\b/u.test(text)) +
    Number(/\badaptive\b|\bstructured\b|\bgated\b|\breflection\b|\brevise\b/u.test(text)) +
    Number(/\bbudget\b|\binference\b|\bcost\b|\blatency\b|\btokens?\b/u.test(text)) +
    Number(/\bgsm8k\b|\bmath\b/u.test(text));

  return groups >= 2;
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

function normalizeCollectYear(value: unknown): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned || !YEAR_SPEC_RE.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function normalizeCollectDateRange(value: unknown): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return undefined;
  }
  const parts = cleaned.split(":");
  if (parts.length !== 2) {
    return undefined;
  }
  const [start, end] = parts;
  const startValid = start === "" || DATE_PART_RE.test(start);
  const endValid = end === "" || DATE_PART_RE.test(end);
  if (!startValid || !endValid || (start === "" && end === "")) {
    return undefined;
  }
  return cleaned;
}
