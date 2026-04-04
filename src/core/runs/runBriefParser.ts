export interface RunBriefTextClient {
  runForText(opts: {
    prompt: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    systemPrompt?: string;
    reasoningEffort?: string;
    abortSignal?: AbortSignal;
  }): Promise<string>;
}

export interface ExtractRunBriefInput {
  brief: string;
  defaults: {
    topic: string;
    constraints: string[];
    objectiveMetric: string;
  };
  llm?: RunBriefTextClient;
  abortSignal?: AbortSignal;
}

export interface ExtractedRunBrief {
  topic: string;
  constraints: string[];
  objectiveMetric: string;
  planSummary?: string;
  assumptions: string[];
  source: "llm" | "heuristic_fallback";
  rawBrief: string;
}

export interface MarkdownRunBriefSections {
  title?: string;
  topic?: string;
  objectiveMetric?: string;
  constraints?: string;
  plan?: string;
  researchQuestion?: string;
  whySmallExperiment?: string;
  baselineComparator?: string;
  datasetTaskBench?: string;
  notes?: string;
  questionsRisks?: string;
  targetComparison?: string;
  minimumAcceptableEvidence?: string;
  disallowedShortcuts?: string;
  allowedBudgetedPasses?: string;
  paperCeiling?: string;
  minimumExperimentPlan?: string;
  paperWorthinessGate?: string;
  failureConditions?: string;
  manuscriptFormat?: string;
  manuscriptTemplate?: string;
  appendixPreferences?: string;
}

const RUN_BRIEF_TIMEOUT_REASONING = "medium";

export function looksLikeRunBriefRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  const hasStartCue =
    /(?:create|start|begin|launch|kick off|set up)\s+(?:a\s+)?(?:new\s+)?(?:research|experiment|study|run)/iu.test(normalized) ||
    /(?:새\s*)?(?:연구|실험|런|run)(?:를)?\s*(?:만들|시작|돌려|생성|시작해)/u.test(normalized);
  const hasBriefFields =
    /(?:topic|objective|goal|metric|constraint|plan)\s*:/iu.test(normalized) ||
    /(?:주제|목표|지표|제약|계획)\s*:/u.test(normalized);
  return hasStartCue || hasBriefFields;
}

export async function extractRunBrief(input: ExtractRunBriefInput): Promise<ExtractedRunBrief> {
  const normalizedBrief = input.brief.replace(/\r/g, "").trim();
  const heuristic = extractRunBriefHeuristically(input.brief, input.defaults);
  const explicitAnchors = extractStructuredRunBriefAnchors(normalizedBrief);
  if (!input.llm) {
    return heuristic;
  }

  try {
    const raw = await input.llm.runForText({
      prompt: buildRunBriefPrompt(input.brief, input.defaults),
      sandboxMode: "read-only",
      approvalPolicy: "never",
      systemPrompt: buildRunBriefSystemPrompt(),
      reasoningEffort: RUN_BRIEF_TIMEOUT_REASONING,
      abortSignal: input.abortSignal
    });
    const parsed = parseRunBriefJson(raw, input.defaults, input.brief);
    const topic = resolveRunBriefTopic({
      explicitTopic: explicitAnchors.topic,
      llmTopic: parsed.topic,
      heuristicTopic: heuristic.topic
    });
    const assumptions = [...parsed.assumptions];
    if (
      !explicitAnchors.topic &&
      topic === heuristic.topic &&
      cleanText(parsed.topic) &&
      cleanText(parsed.topic) !== cleanText(heuristic.topic)
    ) {
      assumptions.unshift("Preserved broader topic wording from the brief for literature collection stability.");
    }
    return {
      ...parsed,
      topic,
      objectiveMetric: explicitAnchors.objectiveMetric || parsed.objectiveMetric || heuristic.objectiveMetric,
      constraints:
        explicitAnchors.constraints && explicitAnchors.constraints.length > 0
          ? explicitAnchors.constraints
          : parsed.constraints.length > 0
            ? parsed.constraints
            : heuristic.constraints,
      planSummary: parsed.planSummary || heuristic.planSummary,
      assumptions: assumptions.slice(0, 6),
      source: "llm"
    };
  } catch {
    return heuristic;
  }
}

export function summarizeRunBrief(extracted: ExtractedRunBrief): string[] {
  const lines = [
    `Topic: ${extracted.topic}`,
    `Objective: ${extracted.objectiveMetric}`,
    `Constraints: ${extracted.constraints.join(", ") || "none"}`
  ];
  if (extracted.planSummary) {
    lines.push(`Plan hint: ${extracted.planSummary}`);
  }
  return lines;
}

export function parseMarkdownRunBriefSections(markdown: string): MarkdownRunBriefSections | undefined {
  const normalized = markdown.replace(/\r/g, "").trim();
  if (!normalized) {
    return undefined;
  }
  const lines = normalized.split("\n");
  const sections: Partial<Record<keyof MarkdownRunBriefSections, string[]>> = {};
  let title: string | undefined;
  let currentSection: keyof MarkdownRunBriefSections | undefined;

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+?)\s*$/u);
    if (h1Match) {
      if (!title) {
        title = cleanText(h1Match[1]);
      }
      currentSection = undefined;
      continue;
    }

    const h2Match = line.match(/^##\s+(.+?)\s*$/u);
    if (h2Match) {
      currentSection = mapMarkdownHeadingToSection(h2Match[1]);
      if (currentSection && !sections[currentSection]) {
        sections[currentSection] = [];
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection]!.push(line);
    }
  }

  if (!title && Object.keys(sections).length === 0) {
    return undefined;
  }

  return {
    title,
    topic: collapseMarkdownSection(sections.topic),
    objectiveMetric: collapseMarkdownSection(sections.objectiveMetric),
    constraints: collapseMarkdownSection(sections.constraints),
    plan: collapseMarkdownSection(sections.plan),
    researchQuestion: collapseMarkdownSection(sections.researchQuestion),
    whySmallExperiment: collapseMarkdownSection(sections.whySmallExperiment),
    baselineComparator: collapseMarkdownSection(sections.baselineComparator),
    datasetTaskBench: collapseMarkdownSection(sections.datasetTaskBench),
    notes: collapseMarkdownSection(sections.notes),
    questionsRisks: collapseMarkdownSection(sections.questionsRisks),
    targetComparison: collapseMarkdownSection(sections.targetComparison),
    minimumAcceptableEvidence: collapseMarkdownSection(sections.minimumAcceptableEvidence),
    disallowedShortcuts: collapseMarkdownSection(sections.disallowedShortcuts),
    allowedBudgetedPasses: collapseMarkdownSection(sections.allowedBudgetedPasses),
    paperCeiling: collapseMarkdownSection(sections.paperCeiling),
    minimumExperimentPlan: collapseMarkdownSection(sections.minimumExperimentPlan),
    paperWorthinessGate: collapseMarkdownSection(sections.paperWorthinessGate),
    failureConditions: collapseMarkdownSection(sections.failureConditions),
    manuscriptFormat: collapseMarkdownSection(sections.manuscriptFormat),
    manuscriptTemplate: collapseMarkdownSection(sections.manuscriptTemplate),
    appendixPreferences: collapseMarkdownSection(sections.appendixPreferences)
  };
}

function extractRunBriefHeuristically(
  brief: string,
  defaults: ExtractRunBriefInput["defaults"]
): ExtractedRunBrief {
  const normalized = brief.replace(/\r/g, "").trim();
  const explicitAnchors = extractStructuredRunBriefAnchors(normalized);
  const sentenceObjective = cleanText(extractObjectiveFromSentence(normalized));
  const sentenceConstraints = parseConstraintList(extractConstraintSentence(normalized));
  const sentencePlan = cleanText(extractPlanSentence(normalized));

  const topic = explicitAnchors.topic || cleanText(stripRunCreationLead(normalized)) || defaults.topic;
  const objectiveMetric = explicitAnchors.objectiveMetric || sentenceObjective || defaults.objectiveMetric;
  const constraints = explicitAnchors.constraints || sentenceConstraints || defaults.constraints;
  const planSummary = explicitAnchors.planSummary || sentencePlan || undefined;
  const assumptions: string[] = [];

  if (!explicitAnchors.objectiveMetric && !sentenceObjective) {
    assumptions.push(`Used default objective metric: ${objectiveMetric}`);
  }
  if (!explicitAnchors.constraints && !sentenceConstraints) {
    assumptions.push(`Used default constraints: ${constraints.join(", ") || "none"}`);
  }
  if (!explicitAnchors.planSummary && planSummary) {
    assumptions.push("Derived a short plan summary from the free-form brief.");
  }

  return {
    topic,
    objectiveMetric,
    constraints,
    planSummary,
    assumptions: assumptions.slice(0, 4),
    source: "heuristic_fallback",
    rawBrief: brief
  };
}

function buildRunBriefSystemPrompt(): string {
  return [
    "You are the AutoLabOS run-brief parser.",
    "Extract a research run specification from a natural-language brief.",
    "Return JSON only.",
    "Do not invent details that are not explicit or strongly implied.",
    "Keep plan_summary short and practical."
  ].join("\n");
}

function buildRunBriefPrompt(
  brief: string,
  defaults: ExtractRunBriefInput["defaults"]
): string {
  return [
    "Return one JSON object with this shape:",
    "{",
    '  "topic": "string",',
    '  "objective_metric": "string",',
    '  "constraints": ["string"],',
    '  "plan_summary": "string|null",',
    '  "assumptions": ["string"]',
    "}",
    "",
    "Rules:",
    "- topic should be concise and specific enough for literature collection.",
    "- If the brief already has an explicit Topic/주제 field, preserve its wording closely and do not fold constraints into the topic.",
    "- For generalized briefs, keep topic close to the core literature question; do not inject operational qualifiers like resource-aware, CPU-only, runtime, memory, or small public datasets unless they already appear in the explicit topic.",
    "- objective_metric should be the main success criterion or metric.",
    "- constraints should capture explicit limits, required datasets/tools, time windows, manuscript-template constraints, or resource constraints.",
    "- Preserve one constraint per bullet/item when the brief uses a list.",
    "- plan_summary should preserve experimental intent that does not fit neatly into topic/objective/constraints.",
    "- If a field is missing, fall back to the provided defaults only when necessary.",
    "",
    `Default topic: ${defaults.topic}`,
    `Default objective metric: ${defaults.objectiveMetric}`,
    `Default constraints: ${defaults.constraints.join(", ") || "none"}`,
    "",
    "Natural-language brief:",
    brief
  ].join("\n");
}

function parseRunBriefJson(
  raw: string,
  defaults: ExtractRunBriefInput["defaults"],
  brief: string
): ExtractedRunBrief {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new Error("run_brief_json_not_found");
  }
  const parsed = JSON.parse(jsonText) as {
    topic?: unknown;
    objective_metric?: unknown;
    constraints?: unknown;
    plan_summary?: unknown;
    assumptions?: unknown;
  };
  return {
    topic: cleanText(parsed.topic) || defaults.topic,
    objectiveMetric: cleanText(parsed.objective_metric) || defaults.objectiveMetric,
    constraints: normalizeStringArray(parsed.constraints).length > 0
      ? normalizeStringArray(parsed.constraints)
      : defaults.constraints,
    planSummary: cleanText(parsed.plan_summary) || undefined,
    assumptions: normalizeStringArray(parsed.assumptions).slice(0, 6),
    source: "llm",
    rawBrief: brief
  };
}

function extractLabeledValue(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegex(label)}\\s*:\\s*([^\\n]+)`, "iu");
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function extractObjectiveFromSentence(text: string): string | undefined {
  const match = text.match(
    /(?:objective|goal|success metric|metric|목표|지표)\s+(?:is|should be|will be|는)?\s*([^.;\n]+)/iu
  );
  return match?.[1]?.trim();
}

function extractConstraintSentence(text: string): string | undefined {
  const match = text.match(/(?:constraints?|requirements?|limits?|조건|제약)\s+(?:are|include|include:|는)?\s*([^.\n]+)/iu);
  return match?.[1]?.trim();
}

function extractPlanSentence(text: string): string | undefined {
  const match = text.match(/(?:plan|approach|experimental plan|method|계획|방법)\s+(?:is|will be|는)?\s*([^.\n]+)/iu);
  return match?.[1]?.trim();
}

function parseConstraintList(value: string | undefined): string[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\r/g, "").trim();
  if (!normalized) {
    return undefined;
  }

  const bulletItems = parseMarkdownListItems(normalized);
  if (bulletItems.length > 0) {
    return bulletItems;
  }
  const inlineBulletItems = parseInlineMarkdownListItems(normalized);
  if (inlineBulletItems.length > 0) {
    return inlineBulletItems;
  }

  const lines = normalized
    .split("\n")
    .map((line) => normalizeConstraintItem(line))
    .filter(Boolean);
  if (lines.length > 1) {
    return lines;
  }

  const semicolonItems = splitConstraintItems(normalized, /;/u);
  if (semicolonItems.length > 1) {
    return semicolonItems;
  }

  if (looksLikeCommaSeparatedConstraintList(normalized)) {
    const commaItems = splitConstraintItems(normalized, /,/u);
    if (commaItems.length > 1) {
      return commaItems;
    }
  }

  const single = normalizeConstraintItem(normalized);
  return single ? [single] : undefined;
}

function stripRunCreationLead(text: string): string {
  return cleanText(
    text
      .replace(
        /^(?:please\s+)?(?:create|start|begin|launch|kick off)\s+(?:a\s+)?(?:new\s+)?(?:(?:research|experiment|study)\s+run|research|experiment|study|run)\s*(?:about|on|for)?\s*/iu,
        ""
      )
      .replace(/^(?:새\s*)?(?:연구|실험|런|run)(?:를)?\s*(?:만들|시작|돌려|생성|진행)(?:줘|해주세요)?\s*/u, "")
      .split(/\n/u)[0] || ""
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => cleanText(String(item))).filter(Boolean))];
}

function extractJsonObject(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced?.[1] || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function resolveRunBriefTopic(input: {
  explicitTopic?: string;
  llmTopic?: string;
  heuristicTopic?: string;
}): string {
  const explicitTopic = cleanText(input.explicitTopic);
  if (explicitTopic) {
    return explicitTopic;
  }

  const llmTopic = cleanText(input.llmTopic);
  const heuristicTopic = cleanText(input.heuristicTopic);
  if (!llmTopic) {
    return heuristicTopic;
  }
  if (!heuristicTopic) {
    return llmTopic;
  }
  if (shouldPreferHeuristicTopic(llmTopic, heuristicTopic)) {
    return heuristicTopic;
  }
  return llmTopic;
}

function shouldPreferHeuristicTopic(llmTopic: string, heuristicTopic: string): boolean {
  if (!containsTopicQualifier(llmTopic) || containsTopicQualifier(heuristicTopic)) {
    return false;
  }

  const llmTokens = extractTopicCoreTokens(llmTopic);
  const heuristicTokens = extractTopicCoreTokens(heuristicTopic);
  if (llmTokens.size === 0 || heuristicTokens.size === 0) {
    return false;
  }

  const sharedCount = [...llmTokens].filter((token) => heuristicTokens.has(token)).length;
  const requiredShared = Math.min(2, Math.min(llmTokens.size, heuristicTokens.size));
  if (sharedCount < requiredShared) {
    return false;
  }

  const heuristicSpecificCount = [...heuristicTokens].filter((token) => !llmTokens.has(token)).length;
  return heuristicSpecificCount > 0 || llmTopic.length > heuristicTopic.length + 12;
}

function containsTopicQualifier(value: string): boolean {
  return [
    /\b(?:resource-aware|resource constrained|resource-constrained|resource efficient|resource-efficient)\b/iu,
    /\b(?:cpu[-\s]?only|cpu[-\s]?safe|gpu[-\s]?free|laptop[-\s]?safe|consumer[-\s]?hardware)\b/iu,
    /\b(?:lightweight|reproducible|seed[-\s]?controlled|fixed splits?)\b/iu,
    /\b(?:small|compact)\s+public\s+(?:datasets?|benchmarks?)\b/iu,
    /\b(?:runtime|memory|macro[-\s]?f1|wall[-\s]?clock)\b/iu
  ].some((pattern) => pattern.test(value));
}

function extractTopicCoreTokens(value: string): Set<string> {
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "aware",
    "classification",
    "consumer",
    "datasets",
    "efficient",
    "for",
    "hardware",
    "in",
    "local",
    "of",
    "on",
    "public",
    "resource",
    "runtime",
    "small",
    "the",
    "to",
    "with"
  ]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/iu)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => token.length > 2)
      .filter((token) => !stopwords.has(token))
  );
}

function normalizeConstraintItem(value: string): string {
  return cleanText(value.replace(/^(?:[-*+]|\d+[.)])\s*/u, ""));
}

function splitConstraintItems(value: string, separator: RegExp): string[] {
  return value
    .split(separator)
    .map((item) => normalizeConstraintItem(item))
    .filter(Boolean);
}

function looksLikeCommaSeparatedConstraintList(value: string): boolean {
  if (!value.includes(",")) {
    return false;
  }
  if (/\b(?:and|or|및|그리고)\b/iu.test(value) && /[.?!]\s*$/u.test(value)) {
    return false;
  }
  const parts = splitConstraintItems(value, /,/u);
  return parts.length > 1 && parts.every((item) => item.split(/\s+/u).length <= 8);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapMarkdownHeadingToSection(value: string): keyof MarkdownRunBriefSections | undefined {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "topic":
      return "topic";
    case "objective metric":
    case "objective":
      return "objectiveMetric";
    case "constraints":
      return "constraints";
    case "plan":
      return "plan";
    case "research question":
      return "researchQuestion";
    case "why this can be tested with a small real experiment":
    case "why this can be tested with a small experiment":
    case "why this is a small real experiment":
      return "whySmallExperiment";
    case "baseline / comparator":
    case "baseline/comparator":
    case "baseline comparator":
      return "baselineComparator";
    case "dataset / task / bench":
    case "dataset/task/bench":
    case "dataset / task / benchmark":
    case "dataset / task / corpus":
      return "datasetTaskBench";
    case "notes":
      return "notes";
    case "questions / risks":
    case "questions/risks":
    case "questions and risks":
      return "questionsRisks";
    case "target comparison":
    case "target comparisons":
    case "comparison":
      return "targetComparison";
    case "minimum acceptable evidence":
    case "minimum evidence":
    case "acceptable evidence":
      return "minimumAcceptableEvidence";
    case "disallowed shortcuts":
    case "forbidden shortcuts":
    case "disallowed":
      return "disallowedShortcuts";
    case "allowed budgeted passes":
    case "budgeted passes":
    case "allowed passes":
      return "allowedBudgetedPasses";
    case "paper ceiling if evidence remains weak":
    case "paper ceiling":
    case "evidence ceiling":
      return "paperCeiling";
    case "minimum experiment plan":
      return "minimumExperimentPlan";
    case "paper-worthiness gate":
    case "paper worthiness gate":
    case "paper-readiness gate":
    case "paper readiness gate":
      return "paperWorthinessGate";
    case "failure conditions":
    case "blocked conditions":
      return "failureConditions";
    case "manuscript format":
    case "paper format":
    case "format":
      return "manuscriptFormat";
    case "manuscript template":
    case "paper template":
    case "template":
      return "manuscriptTemplate";
    case "appendix preferences":
    case "appendix preference":
    case "appendix policy":
    case "appendix routing":
      return "appendixPreferences";
    default:
      return undefined;
  }
}

function collapseMarkdownSection(lines: string[] | undefined): string | undefined {
  if (!lines || lines.length === 0) {
    return undefined;
  }
  const value = lines.join("\n").trim();
  return value || undefined;
}

function extractStructuredRunBriefAnchors(markdown: string): {
  topic?: string;
  objectiveMetric?: string;
  constraints?: string[];
  planSummary?: string;
} {
  const markdownSections = parseMarkdownRunBriefSections(markdown);

  return {
    topic:
      cleanText(markdownSections?.topic) ||
      cleanText(extractLabeledValue(markdown, ["topic", "research topic", "study topic", "주제"])) ||
      undefined,
    objectiveMetric:
      cleanText(markdownSections?.objectiveMetric) ||
      cleanText(
        extractLabeledValue(markdown, [
          "objective",
          "objective metric",
          "goal",
          "success metric",
          "metric",
          "목표",
          "지표"
        ])
      ) ||
      undefined,
    constraints:
      parseConstraintList(markdownSections?.constraints) ||
      parseConstraintList(
        extractLabeledValue(markdown, ["constraints", "constraint", "requirements", "limits", "조건", "제약"])
      ) ||
      undefined,
    planSummary:
      cleanText(markdownSections?.plan) ||
      cleanText(extractLabeledValue(markdown, ["plan", "approach", "experimental plan", "method", "계획", "방법"])) ||
      undefined
  };
}

function parseMarkdownListItems(value: string): string[] {
  const items: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const combined = cleanText(current.join(" "));
    if (combined) {
      items.push(combined);
    }
    current = [];
  };

  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }

    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/u);
    if (bulletMatch) {
      flush();
      current.push(bulletMatch[1]);
      continue;
    }

    if (current.length > 0) {
      current.push(trimmed);
    }
  }

  flush();
  return items;
}

function parseInlineMarkdownListItems(value: string): string[] {
  const parts = value
    .trim()
    .split(/\s+(?=(?:[-*+]|\d+[.)])\s+)/u)
    .map((part) => normalizeConstraintItem(part))
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}
