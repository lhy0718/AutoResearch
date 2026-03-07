import { CollectCommandRequest } from "./collectOptions.js";
import { GraphNodeId, RunRecord } from "../../types.js";

type InputLanguage = "ko" | "en";

export interface SupportedNaturalInput {
  id: string;
  descriptionEn: string;
  descriptionKo: string;
  commandHintEn?: string;
  commandHintKo?: string;
  examples: string[];
}

export interface DeterministicNaturalContext {
  runs: RunRecord[];
  activeRunId?: string;
}

export interface DeterministicNaturalResult {
  lines: string[];
  pendingCommand?: string;
  targetRunId?: string;
}

export interface CompositeNaturalPlan {
  lines: string[];
  commands: string[];
}

export interface CollectContextFallback {
  title?: string;
  topic?: string;
}

export const SUPPORTED_NATURAL_INPUTS: SupportedNaturalInput[] = [
  {
    id: "supported_inputs",
    descriptionEn: "List supported natural-language inputs",
    descriptionKo: "지원되는 자연어 입력 목록 보기",
    examples: ["what natural inputs are supported?", "지원되는 자연어 입력을 보여줘"]
  },
  {
    id: "help_settings_model",
    descriptionEn: "Open help, settings, model selector, environment checks, or quit",
    descriptionKo: "도움말, 설정, 모델 선택기, 환경 점검, 종료",
    commandHintEn: "/help | /settings | /model | /doctor | /quit",
    commandHintKo: "/help | /settings | /model | /doctor | /quit",
    examples: ["도움말 보여줘", "모델 바꿀래", "환경 점검해줘"]
  },
  {
    id: "runs",
    descriptionEn: "Create a run, list runs, select a run, or resume a run",
    descriptionKo: "run 생성, 목록, 선택, 재개",
    commandHintEn: "/new | /runs | /run <run> | /resume <run>",
    commandHintKo: "/new | /runs | /run <run> | /resume <run>",
    examples: ["새 run 시작해줘", "run 목록 보여줘", "run-alpha 열어줘"]
  },
  {
    id: "title",
    descriptionEn: "Rename the active run title",
    descriptionKo: "현재 run title 변경",
    commandHintEn: "/title <new title>",
    commandHintKo: "/title <new title>",
    examples: ['change the run title to "Multi-agent collaboration"', '멀티에이전트 협업으로 title을 바꿔줘']
  },
  {
    id: "status_and_next",
    descriptionEn: "Show workflow structure, current status, next step, or execution recommendation",
    descriptionKo: "워크플로 구조, 현재 상태, 다음 단계, 실행 권장사항",
    examples: ["what should I do next?", "현재 상태 보여줘", "파이프라인 구조 알려줘"]
  },
  {
    id: "collect",
    descriptionEn: "Collect papers with filters like count, years, sort, venue, type, open access, and citations",
    descriptionKo: "개수, 기간, 정렬, venue, 유형, 오픈액세스, 인용수 조건으로 논문 수집",
    commandHintEn: "/agent collect ...",
    commandHintKo: "/agent collect ...",
    examples: [
      "최근 5년 관련도 순으로 100개 수집해줘",
      "open-access review papers only, top citations, 50 papers",
      "Nature와 Science에서 2021 이후 논문 수집해줘"
    ]
  },
  {
    id: "node_control",
    descriptionEn: "Run, jump, retry, focus, clear, or count any graph node",
    descriptionKo: "각 그래프 노드 실행, 이동, 재시도, 집중, clear, count",
    commandHintEn: "/agent run|jump|retry|focus|clear|count <node>",
    commandHintKo: "/agent run|jump|retry|focus|clear|count <node>",
    examples: ["수집 단계로 이동해줘", "가설 단계 다시 실행해줘", "결과분석 단계 산출물 개수 보여줘"]
  },
  {
    id: "graph_budget_approval",
    descriptionEn: "Show graph, show budget, approve current node, or retry current node",
    descriptionKo: "그래프 보기, 예산 보기, 현재 노드 승인, 현재 노드 재시도",
    commandHintEn: "/agent graph | /agent budget | /approve | /retry",
    commandHintKo: "/agent graph | /agent budget | /approve | /retry",
    examples: ["그래프 보여줘", "예산 상태 보여줘", "승인해줘", "다시 시도해줘"]
  },
  {
    id: "paper_questions",
    descriptionEn: "Ask direct questions about collected papers",
    descriptionKo: "수집된 논문에 대한 직접 질문",
    examples: ["논문 몇 개 모았어?", "pdf 없는 논문이 몇 개야?", "citation이 가장 높은 논문이 뭐야?"]
  }
];

const FIELD_ALIASES: Array<{ value: string; patterns: RegExp[] }> = [
  { value: "Computer Science", patterns: [/computer science/i, /컴퓨터\s*사이언스/u, /컴퓨터과학/u] },
  {
    value: "Artificial Intelligence",
    patterns: [/artificial intelligence/i, /인공지능/u, /\bai\b(?=.*(?:field|fields|분야))/i, /(?:field|fields|분야).*\bai\b/i]
  },
  { value: "Medicine", patterns: [/medicine/i, /medical/i, /의학/u, /의료/u] },
  { value: "Mathematics", patterns: [/mathematics/i, /math/i, /수학/u] },
  { value: "Engineering", patterns: [/engineering/i, /공학/u] },
  { value: "Physics", patterns: [/physics/i, /물리/u] },
  { value: "Biology", patterns: [/biology/i, /생물/u] }
];

const VENUE_ALIASES = [
  "Nature",
  "Science",
  "NeurIPS",
  "ICLR",
  "ACL",
  "ICML",
  "EMNLP",
  "NAACL",
  "CVPR",
  "ICCV",
  "AAAI"
] as const;

const NODE_ALIASES: Array<{ node: GraphNodeId; patterns: RegExp[] }> = [
  { node: "collect_papers", patterns: [/collect_papers/i, /collect/i, /논문\s*수집/u, /수집\s*단계/u, /수집\s*노드/u] },
  { node: "analyze_results", patterns: [/analyze_results/i, /result\s+analysis/i, /analy[sz]e\s+results/i, /결과\s*분석/u] },
  { node: "analyze_papers", patterns: [/analyze_papers/i, /analy[sz]e\s+papers/i, /논문\s*분석/u, /분석\s*단계/u, /분석\s*노드/u] },
  { node: "generate_hypotheses", patterns: [/generate_hypotheses/i, /hypotheses?/i, /가설/u] },
  { node: "design_experiments", patterns: [/design_experiments/i, /experiment\s*design/i, /실험\s*설계/u, /설계\s*단계/u] },
  { node: "implement_experiments", patterns: [/implement_experiments/i, /implement/i, /implementation/i, /실험\s*구현/u, /구현\s*단계/u, /코딩/u] },
  { node: "run_experiments", patterns: [/run_experiments/i, /execute\s+experiments/i, /run\s+experiments/i, /실험\s*실행/u, /실행\s*단계/u] },
  { node: "write_paper", patterns: [/write_paper/i, /paper\s+writing/i, /write\s+paper/i, /논문\s*작성/u, /논문\s*생성/u] }
];

export function isSupportedNaturalInputsQuery(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return (
    /지원.*자연어|자연어.*지원|자연어.*입력|자연어.*명령|무슨 말을|뭘 입력|어떤 입력/u.test(text) ||
    /natural.*input|natural.*command|supported.*input|what can i ask|what can i say/i.test(lower)
  );
}

export function formatSupportedNaturalInputLines(language: InputLanguage): string[] {
  const lines = [
    language === "ko" ? "지원되는 자연어 입력 범주:" : "Supported natural-language input families:"
  ];
  for (const item of SUPPORTED_NATURAL_INPUTS) {
    const desc = language === "ko" ? item.descriptionKo : item.descriptionEn;
    const hint = language === "ko" ? item.commandHintKo : item.commandHintEn;
    const example = item.examples[0];
    lines.push(hint ? `- ${desc}: ${hint} | e.g. ${example}` : `- ${desc} | e.g. ${example}`);
  }
  return lines.slice(0, 12);
}

export function resolveDeterministicPendingCommand(
  text: string,
  ctx: DeterministicNaturalContext
): DeterministicNaturalResult | undefined {
  const language = detectLanguage(text);
  const lower = text.trim().toLowerCase();
  if (!lower) {
    return undefined;
  }

  const mentionedRun = findMentionedRun(text, ctx.runs);
  const targetRun = mentionedRun || resolveActiveRun(ctx.runs, ctx.activeRunId);

  if (matchesAny(lower, [/help/i, /도움말/u, /사용법/u, /명령어/u])) {
    return buildPending(language, "/help", targetRun?.id, "Opening help.", "도움말을 엽니다.");
  }
  if (matchesAny(lower, [/doctor/i, /환경.*점검/u, /환경.*체크/u, /check.*environment/i])) {
    return buildPending(language, "/doctor", targetRun?.id, "Running environment checks.", "환경 점검을 실행합니다.");
  }
  if (matchesAny(lower, [/settings?/i, /설정/u])) {
    return buildPending(language, "/settings", targetRun?.id, "Opening settings.", "설정을 엽니다.");
  }
  if (matchesAny(lower, [/model/i, /reasoning effort/i, /모델/u, /리저닝/u])) {
    return buildPending(language, "/model", targetRun?.id, "Opening model selector.", "모델 선택기를 엽니다.");
  }
  if (matchesAny(lower, [/quit/i, /\bexit\b/i, /종료/u, /끝내/u])) {
    return buildPending(language, "/quit", targetRun?.id, "Preparing to quit.", "종료를 준비합니다.");
  }
  if (matchesAny(lower, [/(run|runs|런).*(목록|리스트|list|show|보여)/i, /list runs/i])) {
    return buildPending(language, "/runs", targetRun?.id, "Listing runs.", "run 목록을 표시합니다.");
  }
  if (matchesAny(lower, [/new run/i, /새.*run/u, /새.*런/u, /새.*연구/u])) {
    return buildPending(language, "/new", targetRun?.id, "Creating a new run.", "새 run 생성을 시작합니다.");
  }
  if (mentionedRun && matchesAny(lower, [/resume/i, /재개/u, /이어/u])) {
    return buildPending(
      language,
      `/resume ${mentionedRun.id}`,
      mentionedRun.id,
      `Resuming run ${mentionedRun.id}.`,
      `run ${mentionedRun.id}를 재개합니다.`
    );
  }
  if (mentionedRun && matchesAny(lower, [/select/i, /switch/i, /open/i, /choose/i, /선택/u, /전환/u, /열어/u])) {
    return buildPending(
      language,
      `/run ${mentionedRun.id}`,
      mentionedRun.id,
      `Selecting run ${mentionedRun.id}.`,
      `run ${mentionedRun.id}를 선택합니다.`
    );
  }
  if (matchesAny(lower, [/approve/i, /승인/u])) {
    return buildPending(language, "/approve", targetRun?.id, "Approving current node.", "현재 노드를 승인합니다.");
  }
  if (matchesAny(lower, [/retry/i, /재시도/u, /다시\s*시도/u]) && !resolveNodeAlias(text)) {
    return buildPending(language, "/retry", targetRun?.id, "Retrying the current node.", "현재 노드를 재시도합니다.");
  }
  if (targetRun && matchesAny(lower, [/graph/i, /state graph/i, /그래프/u, /워크플로/u])) {
    return buildPending(
      language,
      `/agent graph ${targetRun.id}`,
      targetRun.id,
      `Showing graph for ${targetRun.id}.`,
      `run ${targetRun.id}의 그래프를 표시합니다.`
    );
  }
  if (targetRun && matchesAny(lower, [/budget/i, /예산/u, /cost/i])) {
    return buildPending(
      language,
      `/agent budget ${targetRun.id}`,
      targetRun.id,
      `Showing budget for ${targetRun.id}.`,
      `run ${targetRun.id}의 예산 상태를 표시합니다.`
    );
  }

  const nodeCommand = resolveNodeCommand(text, targetRun?.id);
  if (nodeCommand) {
    return buildPending(language, nodeCommand.command, targetRun?.id, nodeCommand.en, nodeCommand.ko);
  }

  const collectRequest = extractCollectRequestFromNatural(text);
  if (collectRequest) {
    const contextualized = applyCollectRequestContext(collectRequest, text, targetRun);
    const command = buildCollectSlashCommand(contextualized, targetRun?.id);
    return buildPending(
      language,
      command,
      targetRun?.id,
      "Paper collection request recognized.",
      "논문 수집 요청을 인식했습니다."
    );
  }

  return undefined;
}

export function resolveNodeAlias(text: string): GraphNodeId | undefined {
  for (const entry of NODE_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.node;
    }
  }
  return undefined;
}

export function extractCollectRequestFromNatural(text: string): CollectCommandRequest | undefined {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!raw) {
    return undefined;
  }

  const quotedQuery = extractQuotedQuery(raw);

  const hasCollectVerb =
    /수집/u.test(raw) ||
    /collect|gather|fetch|search/i.test(lower) ||
    /모아줘|모아 줘|찾아줘|가져와/u.test(raw);
  const hasPaperWord = /논문|paper|papers/u.test(raw);
  const hasCollectHints =
    hasPaperWord ||
    /최근\s*\d+\s*년|last\s+\d+\s+years?/iu.test(raw) ||
    /\d+\s*(개|편)|\b\d+\s+(papers?|items?)\b/iu.test(raw) ||
    /관련도|relevance|citation|인용|최신|latest|recent|newest/u.test(lower) ||
    /open[- ]access|오픈\s*액세스|오픈액세스|review|리뷰/u.test(lower) ||
    /(nature|science|neurips|iclr|acl|icml|emnlp|naacl|cvpr|iccv|aaai)/iu.test(lower);
  if ((!hasCollectVerb && !quotedQuery) || !hasCollectHints) {
    return undefined;
  }

  const query = quotedQuery || extractTopicQuery(raw);
  const additional = extractAdditionalCount(raw);
  const limit = additional ? undefined : extractLimitCount(raw);
  const lastYears = extractLastYears(raw);
  const year = extractYearSpec(raw);
  const dateRange = extractDateRange(raw);
  const minCitationCount = extractMinCitations(raw);
  const openAccessPdf =
    /open[- ]access|오픈\s*액세스|오픈액세스/u.test(lower) ||
    /pdf\s*(?:링크|link|url)?\s*(?:가|이)?\s*있는(?:\s*것(?:들)?)?(?:으로|만)?/u.test(raw) ||
    /pdf\s*(?:있는|있는\s*것|있는\s*것들)\s*만/u.test(raw) ||
    /with\s+(?:a\s+)?pdf(?:\s+link)?|pdf\s+available|only\s+papers?\s+with\s+pdf/i.test(lower);
  const publicationTypes = extractPublicationTypes(raw);
  const fieldsOfStudy = extractFieldFilters(raw);
  const venues = extractVenues(raw);
  const dryRun = /dry\s*run|미리보기|계획만|preview|simulate|시뮬/u.test(lower);
  const bibtexMode = extractBibtexMode(raw);
  const sort = extractSort(raw);

  return {
    query,
    filters: {
      lastYears,
      year,
      dateRange,
      fieldsOfStudy,
      venues,
      publicationTypes,
      minCitationCount,
      openAccessPdf
    },
    sort,
    bibtexMode,
    limit,
    additional,
    dryRun,
    warnings: []
  };
}

export function buildCollectSlashCommand(request: CollectCommandRequest, runId?: string): string {
  const parts: string[] = ["/agent", "collect"];
  if (request.query) {
    parts.push(quoteArg(request.query));
  }
  if (request.filters.lastYears) {
    parts.push("--last-years", String(request.filters.lastYears));
  } else if (request.filters.year) {
    parts.push("--year", request.filters.year);
  } else if (request.filters.dateRange) {
    parts.push("--date-range", request.filters.dateRange);
  }
  if (request.sort.field !== "relevance" || request.sort.order !== "desc") {
    parts.push("--sort", request.sort.field);
    if (request.sort.field !== "relevance") {
      parts.push("--order", request.sort.order);
    }
  } else if (request.sort.field === "relevance") {
    parts.push("--sort", "relevance");
  }
  if (request.limit) {
    parts.push("--limit", String(request.limit));
  }
  if (request.additional) {
    parts.push("--additional", String(request.additional));
  }
  if (request.filters.fieldsOfStudy?.length) {
    parts.push("--field", quoteArg(request.filters.fieldsOfStudy.join(",")));
  }
  if (request.filters.venues?.length) {
    parts.push("--venue", quoteArg(request.filters.venues.join(",")));
  }
  if (request.filters.publicationTypes?.length) {
    parts.push("--type", quoteArg(request.filters.publicationTypes.join(",")));
  }
  if (request.filters.minCitationCount) {
    parts.push("--min-citations", String(request.filters.minCitationCount));
  }
  if (request.filters.openAccessPdf) {
    parts.push("--open-access");
  }
  if (request.bibtexMode !== "hybrid") {
    parts.push("--bibtex", request.bibtexMode);
  }
  if (request.dryRun) {
    parts.push("--dry-run");
  }
  if (runId) {
    parts.push("--run", runId);
  }
  return parts.join(" ");
}

export function applyCollectRequestContext(
  request: CollectCommandRequest,
  text: string,
  context?: CollectContextFallback
): CollectCommandRequest {
  if (!context) {
    return request;
  }

  const next: CollectCommandRequest = {
    ...request,
    filters: {
      ...request.filters
    },
    warnings: [...request.warnings]
  };

  if (shouldUseRunTitleQuery(text, request.query) && context.title) {
    next.query = context.title;
  } else if (shouldUseRunTopicQuery(text, request.query) && context.topic) {
    next.query = context.topic;
  }

  return next;
}

function resolveNodeCommand(
  text: string,
  runId?: string
): { command: string; en: string; ko: string } | undefined {
  const node = resolveNodeAlias(text);
  if (!node) {
    return undefined;
  }

  const lower = text.toLowerCase();
  if (matchesAny(lower, [/clear/i, /remove/i, /delete/i, /삭제/u, /제거/u, /비워/u])) {
    return {
      command: `/agent clear ${node}${runId ? ` ${runId}` : ""}`,
      en: `Clearing artifacts for ${node}.`,
      ko: `${node} 산출물을 정리합니다.`
    };
  }
  if (matchesAny(lower, [/count/i, /how many/i, /개수/u, /몇/u])) {
    return {
      command: `/agent count ${node}${runId ? ` ${runId}` : ""}`,
      en: `Counting artifacts for ${node}.`,
      ko: `${node} 산출물 개수를 조회합니다.`
    };
  }
  if (matchesAny(lower, [/jump/i, /go to/i, /back to/i, /이동/u, /돌아가/u])) {
    return {
      command: `/agent jump ${node}${runId ? ` ${runId}` : ""}`,
      en: `Jumping to ${node}.`,
      ko: `${node}로 이동합니다.`
    };
  }
  if (matchesAny(lower, [/focus/i, /집중/u])) {
    return {
      command: `/agent focus ${node}`,
      en: `Focusing on ${node}.`,
      ko: `${node}에 집중합니다.`
    };
  }
  if (matchesAny(lower, [/retry/i, /재시도/u, /다시\s*시도/u, /재실행/u])) {
    return {
      command: `/agent retry ${node}${runId ? ` ${runId}` : ""}`,
      en: `Retrying ${node}.`,
      ko: `${node}를 재시도합니다.`
    };
  }
  if (matchesAny(lower, [/run/i, /execute/i, /start/i, /실행/u, /시작/u])) {
    return {
      command: `/agent run ${node}${runId ? ` ${runId}` : ""}`,
      en: `Running ${node}.`,
      ko: `${node}를 실행합니다.`
    };
  }
  return undefined;
}

function extractSort(text: string): CollectCommandRequest["sort"] {
  const lower = text.toLowerCase();
  if (
    /(?:top|highest|most)\s+citations?|sort(?:ed)?\s+by\s+citations?|citation(?: count)?\s*(?:desc|ascending|descending|order|sort)|인용(?:수)?\s*(?:높|많|순|기준)/u.test(
      lower
    ) ||
    /(?:높|많)은\s*인용/u.test(lower)
  ) {
    return { field: "citationCount", order: /오름차순|asc|ascending/u.test(lower) ? "asc" : "desc" };
  }
  if (/최신|recent|latest|newest|publication date/u.test(lower)) {
    return { field: "publicationDate", order: /오름차순|asc|ascending/u.test(lower) ? "asc" : "desc" };
  }
  if (/paperid|paper id/i.test(lower)) {
    return { field: "paperId", order: /desc|내림차순/u.test(lower) ? "desc" : "asc" };
  }
  return { field: "relevance", order: "desc" };
}

function extractQuotedQuery(text: string): string | undefined {
  return text.match(/["'“”‘’]([^"'“”‘’]{2,120})["'“”‘’]/u)?.[1]?.trim();
}

function extractTopicQuery(text: string): string | undefined {
  const patterns = [
    /(.+?)\s*(?:와|과)?\s*관련(?:된|한)?\s*(?:최근\s*\d+\s*년(?:동안)?(?:의)?\s*)?(?:논문|paper|papers)/iu,
    /(.+?)\s*(?:와|과)?\s*관련(?:된|한)?\s*(?:논문|paper|papers)/iu,
    /주제(?:는|가|로)?\s*(.+?)\s*(?:논문|paper|papers)/iu,
    /(.+?)\s+\d+\s*(?:개|편)\s*(?:수집|collect|gather|fetch|search|모아|찾아|가져와)/iu,
    /(.+?)\s*(?:관련\s*)?(?:논문|paper|papers).*(?:수집|collect|gather|fetch|search|모아|찾아|가져와)/iu,
    /(?:about|on|for)\s+(.+?)\s+(?:papers?|collection|collect)/iu
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match && !/^\d+$/u.test(match)) {
      const normalized = normalizeTopicQueryCandidate(match);
      if (normalized.length >= 2 && normalized.length <= 120) {
        return normalized;
      }
    }
  }
  return undefined;
}

function extractAdditionalCount(text: string): number | undefined {
  const match =
    text.match(/(\d+)\s*(?:개|편)?\s*(?:더|추가)/u) ||
    text.match(/(?:additional|more)\s+(\d+)/iu);
  return toPositiveInt(match?.[1]);
}

function extractLimitCount(text: string): number | undefined {
  const match =
    text.match(/(\d+)\s*(?:개|편)\s*(?:수집|collect|gather|fetch|search)/u) ||
    text.match(/(\d+)\s*(?:개|편)(?!\s*(?:더|추가))/u) ||
    text.match(/(\d+)\s+(?:papers?|items?)(?!\s*(?:more|additional))/iu) ||
    text.match(/(?:collect|gather|fetch|search)\s+(\d+)\s+(?:papers?|items?)/iu);
  return toPositiveInt(match?.[1]);
}

function extractLastYears(text: string): number | undefined {
  const match = text.match(/최근\s*(\d+)\s*년/u) || text.match(/last\s+(\d+)\s+years?/iu);
  return toPositiveInt(match?.[1]);
}

function extractYearSpec(text: string): string | undefined {
  const range = text.match(/(\d{4})\s*[~\-]\s*(\d{4})/u);
  if (range?.[1] && range?.[2]) {
    return `${range[1]}-${range[2]}`;
  }
  const since = text.match(/(\d{4})\s*(?:이후|부터|and after)/u);
  if (since?.[1]) {
    return `${since[1]}-`;
  }
  const until = text.match(/(\d{4})\s*(?:이전|까지|or earlier|before)/u);
  if (until?.[1]) {
    return `-${until[1]}`;
  }
  return undefined;
}

function extractDateRange(text: string): string | undefined {
  const after = text.match(/(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*(?:이후|after|since)/iu);
  if (after?.[1]) {
    return `${after[1]}:`;
  }
  const before = text.match(/(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*(?:이전|before|until)/iu);
  if (before?.[1]) {
    return `:${before[1]}`;
  }
  const range = text.match(/(\d{4}(?:-\d{2}(?:-\d{2})?)?)\s*[:~]\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?)/u);
  if (range?.[1] && range?.[2]) {
    return `${range[1]}:${range[2]}`;
  }
  return undefined;
}

function extractMinCitations(text: string): number | undefined {
  const match =
    text.match(/최소\s*인용\s*(\d+)/u) ||
    text.match(/인용\s*(\d+)\s*이상/u) ||
    text.match(/min(?:imum)?\s+citations?\s*(\d+)/iu);
  return toPositiveInt(match?.[1]);
}

function extractPublicationTypes(text: string): string[] | undefined {
  const types = new Set<string>();
  if (/review|리뷰/u.test(text)) {
    types.add("Review");
  }
  if (/dataset|데이터셋/u.test(text)) {
    types.add("Dataset");
  }
  if (/meta[\s-]?analysis|메타분석/u.test(text)) {
    types.add("MetaAnalysis");
  }
  return types.size > 0 ? [...types] : undefined;
}

function extractFieldFilters(text: string): string[] | undefined {
  const out = new Set<string>();
  for (const alias of FIELD_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(text))) {
      out.add(alias.value);
    }
  }
  return out.size > 0 ? [...out] : undefined;
}

function extractVenues(text: string): string[] | undefined {
  const out = VENUE_ALIASES.filter((venue) => new RegExp(`\\b${escapeRegex(venue)}\\b`, "i").test(text));
  return out.length > 0 ? out : undefined;
}

function extractBibtexMode(text: string): CollectCommandRequest["bibtexMode"] {
  const lower = text.toLowerCase();
  if (/generated\s*bibtex|생성\s*bibtex/u.test(lower)) {
    return "generated";
  }
  if (/\bs2\b.*bibtex|semantic scholar bibtex/i.test(lower)) {
    return "s2";
  }
  return "hybrid";
}

function buildPending(
  language: InputLanguage,
  command: string,
  targetRunId: string | undefined,
  english: string,
  korean: string
): DeterministicNaturalResult {
  return {
    lines: [language === "ko" ? korean : english],
    pendingCommand: command,
    targetRunId
  };
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

function findMentionedRun(text: string, runs: RunRecord[]): RunRecord | undefined {
  const lower = text.toLowerCase();
  const idMatch = runs.find((run) => lower.includes(run.id.toLowerCase()));
  if (idMatch) {
    return idMatch;
  }
  return [...runs]
    .sort((a, b) => b.title.length - a.title.length)
    .find((run) => lower.includes(run.title.toLowerCase()));
}

function detectLanguage(text: string): InputLanguage {
  return /[\p{Script=Hangul}]/u.test(text) ? "ko" : "en";
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function toPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function quoteArg(value: string): string {
  if (!/[\s",]/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizeTopicQueryCandidate(value: string): string {
  let out = value.replace(/\s+/g, " ").trim();
  const leadingPatterns = [
    /^(?:수집\s*단계|collect_papers)\s*(?:로|으로)?\s*(?:이동(?:해서)?|돌아가(?:서)?|되돌아가(?:서)?|jump(?:\s+to)?|go\s+to|move\s+to)\s*/iu,
    /^(?:지금\s*)?(?:현재\s*)?논문(?:을|를|들|들을)?\s*(?:모두|전부|전체)?\s*(?:삭제|제거|지워|없애)(?:하고|한 뒤|후에)\s*/u,
    /^(?:clear|delete|remove)\s+(?:all\s+)?papers?\s*(?:and|then)\s*/iu,
    /^(?:논문(?:을|를|들|들을)?|papers?)\s*/iu,
    /^(?:지금|현재)\s*/u,
    /^최근\s*\d+\s*년(?:동안)?(?:의)?\s*/u,
    /^last\s+\d+\s+years?(?:\s+of)?\s*/iu,
    /^(?:관련도|relevance|최신순|latest|recent|newest|publication date|인용(?:수)?|citation(?: count)?)\s*(?:순(?:으로)?|order)?\s*/iu,
    /^(?:오픈\s*액세스|오픈액세스|open[- ]access)\s*/iu,
    /^(?:review|리뷰|dataset|데이터셋|meta[\s-]?analysis|메타분석)\s*/iu
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadingPatterns) {
      const next = out.replace(pattern, "").trim();
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out
    .replace(/^(?:and|for|on|about)\s+/iu, "")
    .replace(/\s*(?:논문(?:들|을|를)?|papers?)$/iu, "")
    .replace(/\s*최근\s*\d+\s*년(?:동안)?(?:의)?$/u, "")
    .replace(/\s*last\s+\d+\s+years?(?:\s+of)?$/iu, "")
    .replace(/\s*(?:와|과)$/u, "")
    .replace(/\s*(?:관련(?:된|한)?)$/u, "")
    .trim();
}

function shouldUseRunTitleQuery(text: string, query?: string): boolean {
  if (!/(?:run\s+title|\btitle\b|제목)/iu.test(text)) {
    return false;
  }
  const normalized = normalizeFallbackQuery(query);
  return !normalized || normalized === "title" || normalized === "run title" || normalized === "제목";
}

function shouldUseRunTopicQuery(text: string, query?: string): boolean {
  if (!/(?:run\s+topic|\btopic\b|주제)/iu.test(text)) {
    return false;
  }
  const normalized = normalizeFallbackQuery(query);
  return !normalized || normalized === "topic" || normalized === "run topic" || normalized === "주제";
}

function normalizeFallbackQuery(value: string | undefined): string {
  return (
    value
      ?.replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/^(?:current|현재)\s+/u, "")
      .trim() ?? ""
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
