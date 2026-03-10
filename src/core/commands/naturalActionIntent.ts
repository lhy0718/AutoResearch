import { GraphNodeId, RunRecord } from "../../types.js";
import {
  buildCollectSlashCommand,
  extractCollectRequestFromNatural,
  resolveNodeAlias
} from "./naturalDeterministic.js";
import { CollectCommandRequest } from "./collectOptions.js";

export interface NaturalActionTextClient {
  runForText(opts: {
    prompt: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    systemPrompt?: string;
    reasoningEffort?: string;
    abortSignal?: AbortSignal;
  }): Promise<string>;
}

export interface StructuredNaturalActionContext {
  input: string;
  runs: RunRecord[];
  activeRunId?: string;
  llm: NaturalActionTextClient;
  abortSignal?: AbortSignal;
  onProgress?: (line: string) => void;
}

export interface StructuredNaturalActionPlan {
  lines: string[];
  commands: string[];
  displayActions: string[];
  targetRunId?: string;
}

type StructuredActionType =
  | "collect"
  | "analyze_papers"
  | "generate_hypotheses"
  | "clear"
  | "jump"
  | "title";

interface StructuredActionOutput {
  target_run_id?: unknown;
  actions?: unknown;
}

interface StructuredAction {
  type: StructuredActionType;
  query?: string;
  limit?: number;
  additional?: number;
  filters?: {
    last_years?: number;
    year?: string;
    date_range?: string;
    fields?: string[];
    venues?: string[];
    publication_types?: string[];
    min_citations?: number;
    open_access?: boolean;
  };
  sort?: {
    field?: "relevance" | "citationCount" | "publicationDate" | "paperId";
    order?: "asc" | "desc";
  };
  bibtex_mode?: "generated" | "s2" | "hybrid";
  dry_run?: boolean;
  top_n?: number;
  top_k?: number;
  branch_count?: number;
  node?: GraphNodeId;
  force?: boolean;
  title?: string;
}

const ACTION_EXTRACTION_TIMEOUT_MS = 12000;

const ACTION_HINT_PATTERNS = [
  /(?:collect|gather|fetch|search|lookup|find|research|investigate|analy[sz]e|clear|remove|delete|jump|go\s+to|move\s+to|rename|change)/iu,
  /(?:hypotheses?|hypothesis|가설)/iu,
  /(?:수집|분석|가설|삭제|제거|지워|없애|이동|돌아가|되돌아가|점프|바꿔|변경|수정)/u,
  /(?:논문|paper|papers).{0,30}(?:\d+\s*(?:개|편|건|papers?))/iu
] as const;

const SUPPORTED_NODES: GraphNodeId[] = [
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "write_paper"
];

export function looksLikeStructuredActionRequest(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasExecutionCue =
    /(?:collect|gather|fetch|search|lookup|find|research|investigate|analy[sz]e|clear|remove|delete|jump|go\s+to|move\s+to|rename|change)/iu.test(
      lower
    ) ||
    /(?:해줘|해주세요|진행|실행|시작|추가|더|삭제|제거|지워|없애|이동|돌아가|되돌아가|점프|바꿔|변경|수정|분석)/u.test(raw);
  const isCountLikeQuestion =
    /몇|개수|갯수|how many|count|number/u.test(lower) &&
    !hasExecutionCue;
  if (isCountLikeQuestion) {
    return false;
  }
  return ACTION_HINT_PATTERNS.some((pattern) => pattern.test(raw));
}

export async function extractStructuredActionPlan(
  ctx: StructuredNaturalActionContext
): Promise<StructuredNaturalActionPlan | undefined> {
  const fastPlan = extractFastStructuredActionPlan(ctx.input, ctx.runs, ctx.activeRunId);
  if (fastPlan) {
    return fastPlan;
  }

  const activeRun = resolveActiveRun(ctx.runs, ctx.activeRunId);
  const prompt = buildStructuredActionPrompt(ctx.input, ctx.runs, activeRun?.id);
  ctx.onProgress?.("Extracting structured action intent...");

  const raw = await runForTextWithTimeout(
    ctx.llm,
    {
      prompt,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      abortSignal: ctx.abortSignal
    },
    ACTION_EXTRACTION_TIMEOUT_MS
  );

  const parsed = parseStructuredActionOutput(raw);
  if (!parsed) {
    ctx.onProgress?.("Structured action extraction returned no valid JSON plan.");
    return undefined;
  }

  const targetRun = resolveTargetRun(parsed.targetRunId, ctx.runs, ctx.activeRunId);
  const validated = validateStructuredActions(parsed.actions, targetRun);
  if (validated.length === 0) {
    return undefined;
  }

  const commands = validated.map((action) => buildCommandForStructuredAction(action, targetRun?.id)).filter(Boolean) as string[];
  if (commands.length === 0) {
    return undefined;
  }

  return {
    lines: buildSummaryLines(validated, detectLanguage(ctx.input)),
    commands,
    displayActions: validated.map((action) => summarizeAction(action, detectLanguage(ctx.input))),
    targetRunId: targetRun?.id
  };
}

export function isStructuredActionTimeoutError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("action intent timeout") || (message.includes("timeout") && message.includes("action intent"));
}

function extractFastStructuredActionPlan(
  input: string,
  runs: RunRecord[],
  activeRunId?: string
): StructuredNaturalActionPlan | undefined {
  const targetRun = resolveActiveRun(runs, activeRunId);
  const clearThenFollowUp = extractFastClearThenFollowupActions(input, targetRun);
  const actions: StructuredAction[] =
    clearThenFollowUp ??
    (() => {
      const analyzeAction = extractFastAnalyzeAction(input);
      if (analyzeAction) {
        return [analyzeAction];
      }
      const hypothesesAction = extractFastGenerateHypothesesAction(input);
      if (hypothesesAction) {
        return [hypothesesAction];
      }
      const collectRequest = extractCollectRequestFromNatural(input);
      if (collectRequest) {
        const collectAction = convertCollectRequestToStructuredAction(collectRequest, targetRun);
        return collectAction ? [collectAction] : [];
      }
      const clearAction = extractFastClearAction(input);
      if (clearAction) {
        return [clearAction];
      }
      const jumpAction = extractFastJumpAction(input);
      return jumpAction ? [jumpAction] : [];
    })();

  if (actions.length === 0) {
    return undefined;
  }
  const commands = actions
    .map((action) => buildCommandForStructuredAction(action, targetRun?.id))
    .filter(Boolean) as string[];
  if (commands.length === 0) {
    return undefined;
  }
  return {
    lines: buildSummaryLines(actions, detectLanguage(input)),
    commands,
    displayActions: actions.map((action) => summarizeAction(action, detectLanguage(input))),
    targetRunId: targetRun?.id
  };
}

function extractFastClearThenFollowupActions(
  raw: string,
  targetRun?: RunRecord
): StructuredAction[] | undefined {
  const clearAction = extractFastClearAction(raw);
  if (!clearAction) {
    return undefined;
  }
  const remainder = extractFollowupAfterClear(raw);
  if (!remainder) {
    return undefined;
  }
  const analyzeAction = extractFastAnalyzeAction(remainder);
  if (analyzeAction) {
    return [clearAction, analyzeAction];
  }
  const hypothesesAction = extractFastGenerateHypothesesAction(remainder);
  if (hypothesesAction) {
    return [clearAction, hypothesesAction];
  }
  const collectRequest = extractCollectRequestFromNatural(remainder);
  if (collectRequest) {
    const collectAction = convertCollectRequestToStructuredAction(collectRequest, targetRun);
    if (collectAction) {
      return [clearAction, collectAction];
    }
  }
  const jumpAction = extractFastJumpAction(remainder);
  if (jumpAction) {
    return [clearAction, jumpAction];
  }
  return undefined;
}

function extractFollowupAfterClear(raw: string): string | undefined {
  const normalized = raw.trim();
  const match = normalized.match(
    /(?:지우고|삭제하고|제거하고|없애고|clear(?:\s+out)?|remove(?:\s+all)?|delete(?:\s+all)?)([\s\S]+)/iu
  );
  const remainder = match?.[1]?.trim();
  if (!remainder || remainder === normalized) {
    return undefined;
  }
  return remainder.replace(/^(?:다시|then|and\s+then)\s+/iu, "").trim() || undefined;
}

function convertCollectRequestToStructuredAction(
  request: CollectCommandRequest,
  targetRun?: RunRecord
): StructuredAction | undefined {
  return {
    type: "collect",
    query: normalizeCollectQueryReference(request.query, targetRun),
    limit: request.limit,
    additional: request.additional,
    filters: {
      last_years: request.filters.lastYears,
      year: request.filters.year,
      date_range: request.filters.dateRange,
      fields: request.filters.fieldsOfStudy,
      venues: request.filters.venues,
      publication_types: request.filters.publicationTypes,
      min_citations: request.filters.minCitationCount,
      open_access: request.filters.openAccessPdf
    },
    sort: {
      field: request.sort.field,
      order: request.sort.order
    },
    bibtex_mode: request.bibtexMode,
    dry_run: request.dryRun
  };
}

function normalizeCollectQueryReference(query: string | undefined, targetRun?: RunRecord): string | undefined {
  const trimmed = query?.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(?:title|run title|현재 title|현재 제목|제목)$/iu.test(trimmed)) {
    return targetRun?.title ?? trimmed;
  }
  if (/^(?:topic|run topic|현재 topic|현재 주제|주제)$/iu.test(trimmed)) {
    return targetRun?.topic ?? trimmed;
  }
  return trimmed;
}

function extractFastAnalyzeAction(raw: string): StructuredAction | undefined {
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();
  const hasAnalyzeVerb = /분석|analy[sz]e/u.test(normalized);
  if (!hasAnalyzeVerb) {
    return undefined;
  }
  const topMatch =
    normalized.match(/상위\s*(\d+)\s*(?:개|편|건)?/u) ||
    lower.match(/\btop\s+(\d+)\b/u) ||
    normalized.match(/(\d+)\s*(?:개|편|건|papers?)\s*(?:만)?[^.\n]{0,40}분석/u) ||
    normalized.match(/분석[^.\n]{0,40}(\d+)\s*(?:개|편|건|papers?)/u);
  const topN = toPositiveInt(topMatch?.[1]);
  return topN ? { type: "analyze_papers", top_n: topN } : undefined;
}

function extractFastGenerateHypothesesAction(raw: string): StructuredAction | undefined {
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();
  const hasHypothesisCue =
    /가설/u.test(normalized) || /\bhypotheses?\b/i.test(lower) || /\bhypothesis\b/i.test(lower);
  const hasGenerationCue =
    /뽑|생성|만들|추출|generate|produce|draft|derive|brainstorm/u.test(normalized);
  if (!hasHypothesisCue || !hasGenerationCue) {
    return undefined;
  }

  const countMatch =
    normalized.match(/가설(?:을|를)?\s*(\d+)\s*(?:개|건|편)?/u) ||
    normalized.match(/가설[^.\n]{0,20}?(\d+)\s*(?:개|건|편)?/u) ||
    normalized.match(/(\d+)\s*(?:개|건|편)?[^.\n]{0,20}가설/u) ||
    lower.match(/\b(?:top\s+)?(\d+)\s+hypotheses?\b/u) ||
    lower.match(/\bhypotheses?\b[^.\n]{0,20}\b(\d+)\b/u);

  const topK = toPositiveInt(countMatch?.[1]);
  const branchCount = typeof topK === "number" ? Math.max(topK, 6) : undefined;
  return topK
    ? { type: "generate_hypotheses", top_k: topK, branch_count: branchCount }
    : { type: "generate_hypotheses" };
}

function extractFastClearAction(raw: string): StructuredAction | undefined {
  const normalized = raw.trim();
  const hasPaperWord = /논문|paper|papers/u.test(normalized);
  const hasClearVerb =
    /삭제|제거|지워|지우|없애|clear|remove|delete/u.test(normalized) &&
    /모두|전부|전체|all/u.test(normalized);
  if (!hasPaperWord || !hasClearVerb) {
    return undefined;
  }
  return { type: "clear", node: "collect_papers" };
}

function extractFastJumpAction(raw: string): StructuredAction | undefined {
  const node = resolveNodeAlias(raw);
  if (!node) {
    return undefined;
  }
  const hasMoveVerb = /이동|점프|돌아가|되돌아가|go\s+to|move\s+to|jump/u.test(raw);
  if (!hasMoveVerb) {
    return undefined;
  }
  return { type: "jump", node, force: false };
}

function buildStructuredActionPrompt(input: string, runs: RunRecord[], activeRunId?: string): string {
  const runsSnapshot = runs.slice(0, 8).map((run) => ({
    id: run.id,
    title: run.title,
    topic: run.topic,
    status: run.status,
    current_node: run.currentNode
  }));

  return [
    "You translate AutoLabOS natural-language execution requests into STRICT JSON.",
    "Return JSON only. No markdown, no prose.",
    "If the input is not asking to execute an action, return {\"actions\":[]}.",
    "Supported action types only: collect, analyze_papers, generate_hypotheses, clear, jump, title.",
    "Actions may be returned as an ordered array for multi-step requests.",
    "Do not answer read-only questions with actions.",
    "Use exact node ids only for clear/jump:",
    `- ${SUPPORTED_NODES.join(", ")}`,
    "For collect actions, infer query, limit/additional, filters, and sort when explicitly requested.",
    "For open-access/PDF-available requests, set filters.open_access=true.",
    "For 'top N papers analyze' requests, use type='analyze_papers' and top_n=N.",
    "For requests to generate or extract hypotheses, use type='generate_hypotheses'.",
    "If the user asks for N hypotheses, set top_k=N and branch_count=max(N,6) unless a larger candidate count is explicitly requested.",
    "If the user explicitly references the current run title or topic, use that exact run title/topic string as the collect query.",
    "Do not invent a query unless it is directly specified or clearly implied by the title/topic wording.",
    "When the user mentions title rename, return a title action with the requested title string.",
    "When the user wants to delete collected papers, use clear with node='collect_papers'.",
    "When the user wants to move to an earlier stage, use jump with the requested node.",
    `Active run id: ${activeRunId || ""}`,
    `Runs: ${JSON.stringify(runsSnapshot)}`,
    `User input: ${input}`,
    "",
    "JSON schema:",
    "{",
    '  "target_run_id": "run-id-or-empty",',
    '  "actions": [',
    "    {",
    '      "type": "collect|analyze_papers|generate_hypotheses|clear|jump|title",',
    '      "query": "optional string",',
    '      "limit": 100,',
    '      "additional": 50,',
    '      "filters": {',
    '        "last_years": 5,',
    '        "year": "2021-2025",',
    '        "date_range": "2021-01-01:",',
    '        "fields": ["Computer Science"],',
    '        "venues": ["Nature"],',
    '        "publication_types": ["Review"],',
    '        "min_citations": 100,',
    '        "open_access": true',
    "      },",
    '      "sort": { "field": "relevance|citationCount|publicationDate|paperId", "order": "asc|desc" },',
    '      "bibtex_mode": "generated|s2|hybrid",',
    '      "dry_run": false,',
    '      "top_n": 30,',
    '      "top_k": 10,',
    '      "branch_count": 10,',
    '      "node": "collect_papers",',
    '      "force": false,',
    '      "title": "New run title"',
    "    }",
    "  ]",
    "}"
  ].join("\n");
}

function parseStructuredActionOutput(raw: string): { targetRunId?: string; actions: StructuredAction[] } | undefined {
  const parsed = tryParseJson(extractJsonPayload(raw));
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const output = parsed as StructuredActionOutput;
  const actions = Array.isArray(output.actions) ? (output.actions as StructuredAction[]) : [];
  return {
    targetRunId: typeof output.target_run_id === "string" ? output.target_run_id.trim() || undefined : undefined,
    actions
  };
}

function validateStructuredActions(actions: StructuredAction[], targetRun?: RunRecord): StructuredAction[] {
  const out: StructuredAction[] = [];
  for (const action of actions) {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      continue;
    }
    switch (action.type) {
      case "collect": {
        const normalized = normalizeCollectAction(action, targetRun);
        if (normalized) {
          out.push(normalized);
        }
        break;
      }
      case "analyze_papers": {
        const topN = toPositiveInt(action.top_n);
        out.push(topN ? { type: "analyze_papers", top_n: topN } : { type: "analyze_papers" });
        break;
      }
      case "generate_hypotheses": {
        const topK = toPositiveInt(action.top_k);
        const branchCountRaw = toPositiveInt(action.branch_count);
        const branchCount =
          typeof topK === "number"
            ? Math.max(branchCountRaw ?? 0, topK, 6)
            : branchCountRaw;
        out.push(
          typeof topK === "number"
            ? {
                type: "generate_hypotheses",
                top_k: topK,
                branch_count: branchCount
              }
            : { type: "generate_hypotheses" }
        );
        break;
      }
      case "clear": {
        if (action.node && SUPPORTED_NODES.includes(action.node)) {
          out.push({ type: "clear", node: action.node });
        }
        break;
      }
      case "jump": {
        if (action.node && SUPPORTED_NODES.includes(action.node)) {
          out.push({ type: "jump", node: action.node, force: Boolean(action.force) });
        }
        break;
      }
      case "title": {
        const title = sanitizeTitle(action.title);
        if (title) {
          out.push({ type: "title", title });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function normalizeCollectAction(action: StructuredAction, targetRun?: RunRecord): StructuredAction | undefined {
  const query = normalizeQuery(action.query);
  const limit = toPositiveInt(action.limit);
  const additional = toPositiveInt(action.additional);
  if (limit && additional) {
    return undefined;
  }

  const filters = action.filters || {};
  const normalizedFilters: NonNullable<StructuredAction["filters"]> = {
    last_years: toPositiveInt(filters.last_years),
    year: typeof filters.year === "string" ? filters.year.trim() || undefined : undefined,
    date_range: typeof filters.date_range === "string" ? filters.date_range.trim() || undefined : undefined,
    fields: normalizeStringArray(filters.fields),
    venues: normalizeStringArray(filters.venues),
    publication_types: normalizeStringArray(filters.publication_types),
    min_citations: toPositiveInt(filters.min_citations),
    open_access: Boolean(filters.open_access)
  };

  const sortField = action.sort?.field;
  const sortOrder = action.sort?.order;
  const sort =
    sortField && ["relevance", "citationCount", "publicationDate", "paperId"].includes(sortField)
      ? {
          field: sortField,
          order:
            sortField === "relevance"
              ? "desc"
              : sortOrder === "asc" || sortOrder === "desc"
                ? sortOrder
                : "desc"
        }
      : { field: "relevance" as const, order: "desc" as const };

  const bibtexMode = action.bibtex_mode && ["generated", "s2", "hybrid"].includes(action.bibtex_mode)
    ? action.bibtex_mode
    : "hybrid";

  const next: StructuredAction = {
    type: "collect",
    query,
    limit,
    additional,
    filters: normalizedFilters,
    sort,
    bibtex_mode: bibtexMode,
    dry_run: Boolean(action.dry_run)
  };

  if (!next.query && !next.limit && !next.additional && !hasAnyCollectFilter(next) && !targetRun) {
    return undefined;
  }

  return next;
}

function buildCommandForStructuredAction(action: StructuredAction, runId?: string): string | undefined {
  switch (action.type) {
    case "collect": {
      const request: CollectCommandRequest = {
        query: action.query,
        limit: action.limit,
        additional: action.additional,
        filters: {
          lastYears: action.filters?.last_years,
          year: action.filters?.year,
          dateRange: action.filters?.date_range,
          fieldsOfStudy: action.filters?.fields,
          venues: action.filters?.venues,
          publicationTypes: action.filters?.publication_types,
          minCitationCount: action.filters?.min_citations,
          openAccessPdf: action.filters?.open_access
        },
        sort: action.sort?.field
          ? { field: action.sort.field, order: action.sort.order || "desc" }
          : { field: "relevance", order: "desc" },
        bibtexMode: action.bibtex_mode || "hybrid",
        dryRun: Boolean(action.dry_run),
        warnings: []
      };
      return buildCollectSlashCommand(request, runId);
    }
    case "analyze_papers":
      return `/agent run analyze_papers${runId ? ` ${runId}` : ""}${action.top_n ? ` --top-n ${action.top_n}` : ""}`;
    case "generate_hypotheses": {
      const topK = toPositiveInt(action.top_k);
      const branchCount = toPositiveInt(action.branch_count);
      return `/agent run generate_hypotheses${runId ? ` ${runId}` : ""}${topK ? ` --top-k ${topK}` : ""}${branchCount ? ` --branch-count ${branchCount}` : ""}`;
    }
    case "clear":
      return action.node ? `/agent clear ${action.node}${runId ? ` ${runId}` : ""}` : undefined;
    case "jump":
      return action.node
        ? `/agent jump ${action.node}${runId ? ` ${runId}` : ""}${action.force ? " --force" : ""}`
        : undefined;
    case "title": {
      const title = sanitizeTitle(action.title);
      if (!title || !runId) {
        return undefined;
      }
      const escaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `/title "${escaped}" --run ${runId}`;
    }
    default:
      return undefined;
  }
}

function buildSummaryLines(actions: StructuredAction[], language: "ko" | "en"): string[] {
  if (actions.length === 1) {
    const action = actions[0];
    switch (action.type) {
      case "collect":
        return [
          language === "ko" ? "구조화된 논문 수집 요청을 인식했습니다." : "Recognized a structured paper collection request.",
          `- ${summarizeAction(action, language)}`
        ];
      case "analyze_papers":
        return [
          action.top_n
            ? language === "ko"
              ? `상위 ${action.top_n}개 논문만 분석합니다.`
              : `Analyzing only the top ${action.top_n} ranked papers.`
            : language === "ko"
              ? "논문 분석 요청을 인식했습니다."
              : "Recognized a paper analysis request.",
          `- ${summarizeAction(action, language)}`
        ];
      case "generate_hypotheses":
        return [
          action.top_k
            ? language === "ko"
              ? `가설 ${action.top_k}개 생성을 준비합니다.`
              : `Preparing to generate ${action.top_k} hypotheses.`
            : language === "ko"
              ? "가설 생성 요청을 인식했습니다."
              : "Recognized a hypothesis-generation request.",
          `- ${summarizeAction(action, language)}`
        ];
      case "clear":
        return [
          language === "ko" ? "산출물 정리 요청을 인식했습니다." : "Recognized a clear-artifacts request.",
          `- ${summarizeAction(action, language)}`
        ];
      case "jump":
        return [
          language === "ko" ? "노드 이동 요청을 인식했습니다." : "Recognized a node jump request.",
          `- ${summarizeAction(action, language)}`
        ];
      case "title":
        return [
          language === "ko" ? "run title 변경 요청을 인식했습니다." : "Recognized a run title change request.",
          `- ${summarizeAction(action, language)}`
        ];
    }
  }
  const lines = [
    language === "ko"
      ? `구조화된 실행 계획을 인식했습니다. 총 ${actions.length}단계입니다.`
      : `Recognized a structured execution plan with ${actions.length} step(s).`
  ];
  actions.forEach((action, index) => {
    lines.push(`- [${index + 1}/${actions.length}] ${summarizeAction(action, language)}`);
  });
  return lines;
}

function summarizeAction(action: StructuredAction, language: "ko" | "en"): string {
  switch (action.type) {
    case "collect": {
      const fragments: string[] = [];
      if (action.query) {
        fragments.push(language === "ko" ? `query="${action.query}"` : `query="${action.query}"`);
      }
      if (action.limit) {
        fragments.push(language === "ko" ? `limit=${action.limit}` : `limit=${action.limit}`);
      }
      if (action.additional) {
        fragments.push(language === "ko" ? `additional=${action.additional}` : `additional=${action.additional}`);
      }
      if (action.filters?.last_years) {
        fragments.push(language === "ko" ? `lastYears=${action.filters.last_years}` : `lastYears=${action.filters.last_years}`);
      }
      if (action.filters?.open_access) {
        fragments.push(language === "ko" ? "openAccess=true" : "openAccess=true");
      }
      return language === "ko"
        ? `논문 수집 (${fragments.join(", ") || "기본값"})`
        : `Collect papers (${fragments.join(", ") || "defaults"})`;
    }
    case "analyze_papers":
      return action.top_n
        ? language === "ko"
          ? `상위 ${action.top_n}개 논문 분석`
          : `Analyze top ${action.top_n} papers`
        : language === "ko"
          ? "논문 분석"
          : "Analyze papers";
    case "generate_hypotheses": {
      const fragments: string[] = [];
      if (action.top_k) {
        fragments.push(`topK=${action.top_k}`);
      }
      if (action.branch_count) {
        fragments.push(`branchCount=${action.branch_count}`);
      }
      return language === "ko"
        ? `가설 생성 (${fragments.join(", ") || "기본값"})`
        : `Generate hypotheses (${fragments.join(", ") || "defaults"})`;
    }
    case "clear":
      return language === "ko" ? `${action.node} 산출물 정리` : `Clear ${action.node} artifacts`;
    case "jump":
      return language === "ko"
        ? `${action.node}${action.force ? "로 강제 이동" : "로 이동"}`
        : `${action.force ? "Force jump" : "Jump"} to ${action.node}`;
    case "title":
      return language === "ko" ? `title 변경 -> "${action.title}"` : `Rename title -> "${action.title}"`;
  }
}

function resolveActiveRun(runs: RunRecord[], activeRunId?: string): RunRecord | undefined {
  if (activeRunId) {
    const active = runs.find((run) => run.id === activeRunId);
    if (active) {
      return active;
    }
  }
  return runs[0];
}

function resolveTargetRun(targetRunId: string | undefined, runs: RunRecord[], activeRunId?: string): RunRecord | undefined {
  if (targetRunId) {
    const explicit = runs.find((run) => run.id === targetRunId);
    if (explicit) {
      return explicit;
    }
  }
  return resolveActiveRun(runs, activeRunId);
}

function hasAnyCollectFilter(action: StructuredAction): boolean {
  return Boolean(
    action.filters?.last_years ||
      action.filters?.year ||
      action.filters?.date_range ||
      action.filters?.fields?.length ||
      action.filters?.venues?.length ||
      action.filters?.publication_types?.length ||
      action.filters?.min_citations ||
      action.filters?.open_access
  );
}

function normalizeQuery(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const query = raw.replace(/\s+/g, " ").trim();
  return query || undefined;
}

function normalizeStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const out = values
    .map((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function sanitizeTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const title = raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").slice(0, 120);
  return title || undefined;
}

function toPositiveInt(raw: unknown): number | undefined {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function detectLanguage(text: string): "ko" | "en" {
  return /[\p{Script=Hangul}]/u.test(text) ? "ko" : "en";
}

async function runForTextWithTimeout(
  llm: NaturalActionTextClient,
  opts: {
    prompt: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    systemPrompt?: string;
    reasoningEffort?: string;
    abortSignal?: AbortSignal;
  },
  timeoutMs: number
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      llm.runForText(opts),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Action intent timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/iu) || trimmed.match(/```\s*([\s\S]*?)```/iu);
  return fenced?.[1]?.trim() || trimmed;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
