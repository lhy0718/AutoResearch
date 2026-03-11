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
  notes?: string;
  questionsRisks?: string;
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
  const heuristic = extractRunBriefHeuristically(input.brief, input.defaults);
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
    return {
      ...parsed,
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
    notes: collapseMarkdownSection(sections.notes),
    questionsRisks: collapseMarkdownSection(sections.questionsRisks)
  };
}

function extractRunBriefHeuristically(
  brief: string,
  defaults: ExtractRunBriefInput["defaults"]
): ExtractedRunBrief {
  const normalized = brief.replace(/\r/g, "").trim();
  const markdownSections = parseMarkdownRunBriefSections(normalized);
  const topicLabel = markdownSections?.topic || extractLabeledValue(normalized, ["topic", "research topic", "study topic", "주제"]);
  const objectiveLabel = extractLabeledValue(normalized, [
    "objective",
    "objective metric",
    "goal",
    "success metric",
    "metric",
    "목표",
    "지표"
  ]);
  const objectiveSection = markdownSections?.objectiveMetric;
  const constraintsLabel = extractLabeledValue(normalized, [
    "constraints",
    "constraint",
    "requirements",
    "limits",
    "조건",
    "제약"
  ]);
  const constraintsSection = markdownSections?.constraints;
  const planLabel = extractLabeledValue(normalized, [
    "plan",
    "approach",
    "experimental plan",
    "method",
    "계획",
    "방법"
  ]);
  const planSection = markdownSections?.plan;

  const topic =
    cleanText(topicLabel) ||
    cleanText(stripRunCreationLead(normalized)) ||
    defaults.topic;
  const objectiveMetric =
    cleanText(objectiveSection) ||
    cleanText(objectiveLabel) ||
    cleanText(extractObjectiveFromSentence(normalized)) ||
    defaults.objectiveMetric;
  const constraints =
    parseConstraintList(constraintsSection) ||
    parseConstraintList(constraintsLabel) ||
    parseConstraintList(extractConstraintSentence(normalized)) ||
    defaults.constraints;
  const planSummary = cleanText(planSection) || cleanText(planLabel) || cleanText(extractPlanSentence(normalized)) || undefined;

  return {
    topic,
    objectiveMetric,
    constraints,
    planSummary,
    assumptions: buildHeuristicAssumptions(normalized, {
      topic,
      objectiveMetric,
      constraints,
      planSummary
    }),
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
    "- objective_metric should be the main success criterion or metric.",
    "- constraints should capture explicit limits, required datasets/tools, time windows, venue style, or budget constraints.",
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
  const cleaned = cleanText(value);
  if (!cleaned) {
    return undefined;
  }
  const items = cleaned
    .split(/\n|[;,]/u)
    .map((item) => item.replace(/^[-*+]\s*/u, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function buildHeuristicAssumptions(
  brief: string,
  extracted: { topic: string; objectiveMetric: string; constraints: string[]; planSummary?: string }
): string[] {
  const assumptions: string[] = [];
  if (!extractObjectiveFromSentence(brief) && !extractLabeledValue(brief, ["objective", "goal", "metric", "목표", "지표"])) {
    assumptions.push(`Used default objective metric: ${extracted.objectiveMetric}`);
  }
  if (
    !extractConstraintSentence(brief) &&
    !extractLabeledValue(brief, ["constraints", "constraint", "requirements", "limits", "조건", "제약"])
  ) {
    assumptions.push(`Used default constraints: ${extracted.constraints.join(", ") || "none"}`);
  }
  if (!extractLabeledValue(brief, ["plan", "approach", "experimental plan", "method", "계획", "방법"]) && extracted.planSummary) {
    assumptions.push("Derived a short plan summary from the free-form brief.");
  }
  return assumptions.slice(0, 4);
}

function stripRunCreationLead(text: string): string {
  return cleanText(
    text
      .replace(/^(?:please\s+)?(?:create|start|begin|launch|kick off)\s+(?:a\s+)?(?:new\s+)?(?:research|experiment|study|run)\s*(?:about|on|for)?\s*/iu, "")
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
    case "notes":
      return "notes";
    case "questions / risks":
    case "questions/risks":
    case "questions and risks":
      return "questionsRisks";
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
