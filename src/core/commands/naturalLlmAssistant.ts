import path from "node:path";
import { promises as fs } from "node:fs";

import { CodexCliClient } from "../../integrations/codex/codexCliClient.js";
import { GRAPH_NODE_ORDER, RunRecord } from "../../types.js";
import { parseSlashCommand } from "./parseSlash.js";

export interface NaturalAssistantResponse {
  lines: string[];
  targetRunId?: string;
  pendingCommand?: string;
  pendingCommands?: string[];
}

interface NaturalLlmAssistantContext {
  input: string;
  runs: RunRecord[];
  activeRunId?: string;
  logs: string[];
  llm: NaturalAssistantTextClient;
  workspaceRoot?: string;
  steeringHints?: string[];
  abortSignal?: AbortSignal;
  onProgress?: (line: string) => void;
}

interface ModelOutput {
  reply_lines?: unknown;
  target_run_id?: unknown;
  recommended_command?: unknown;
  recommended_commands?: unknown;
  should_offer_execute?: unknown;
}

interface RunFacts {
  runId: string;
  title: string;
  status: string;
  currentNode: string;
  currentNodeStatus: string;
  progress: string;
  collectPapersCount?: number;
  paperTitles?: string[];
  missingPdfCount?: number;
  topCitationTitle?: string;
  topCitationCount?: number;
  evidenceCount?: number;
  hypothesisCount?: number;
  hypothesisStoredCount?: number;
  hypothesisRequestedTopK?: number;
  hypothesisCandidateCount?: number;
  hypothesisSummary?: string;
  metrics?: Record<string, unknown>;
  collectPapersError?: string;
}

const ALLOWED_ROOT_COMMANDS = new Set([
  "help",
  "new",
  "doctor",
  "runs",
  "run",
  "resume",
  "title",
  "agent",
  "model",
  "approve",
  "retry",
  "settings",
  "quit"
]);

const NATURAL_LLM_PRIMARY_TIMEOUT_MS = 90000;
const NATURAL_LLM_RETRY_TIMEOUT_MS = 45000;

interface NaturalAssistantTextClient {
  runForText(opts: {
    prompt: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    systemPrompt?: string;
  }): Promise<string>;
  runTurnStream?: CodexCliClient["runTurnStream"];
}

export async function buildNaturalAssistantResponseWithLlm(
  ctx: NaturalLlmAssistantContext
): Promise<NaturalAssistantResponse> {
  const workspaceRoot = ctx.workspaceRoot || process.cwd();
  const selectedRun = resolveTargetRun(ctx.runs, ctx.activeRunId, ctx.input);
  const selectedFacts = selectedRun ? await buildRunFacts(selectedRun, workspaceRoot) : undefined;
  const progress = createProgressReporter(ctx.onProgress);

  const prompt = buildPrompt(ctx, selectedFacts, workspaceRoot);
  let raw = "";
  try {
    progress.status("LLM request started.");
    raw = await runForTextWithTimeout(
      ctx.llm,
      {
        prompt,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        abortSignal: ctx.abortSignal
      },
      NATURAL_LLM_PRIMARY_TIMEOUT_MS,
      progress
    );
    progress.status("LLM response received.");
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    progress.status("LLM request failed.");
    return unavailableResponse(ctx.input, selectedRun?.id, error);
  }

  const firstTry = parseLlmResponse(raw, ctx.runs, selectedRun?.id);
  if (firstTry) {
    return firstTry;
  }

  const plainTextPrompt = buildPlainTextRetryPrompt(ctx, selectedFacts, workspaceRoot);
  try {
    progress.status("Retrying LLM response parsing in plain-text mode...");
    const retryRaw = await runForTextWithTimeout(
      ctx.llm,
      {
        prompt: plainTextPrompt,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        abortSignal: ctx.abortSignal
      },
      NATURAL_LLM_RETRY_TIMEOUT_MS,
      progress
    );
    progress.status("LLM retry response received.");
    const retryTry = parseLlmResponse(retryRaw, ctx.runs, selectedRun?.id);
    if (retryTry) {
      return retryTry;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return unavailableResponse(ctx.input, selectedRun?.id, error);
    // fall through
  }

  return unavailableResponse(ctx.input, selectedRun?.id);
}

function buildPrompt(
  ctx: NaturalLlmAssistantContext,
  selectedFacts: RunFacts | undefined,
  workspaceRoot: string
): string {
  const runs = ctx.runs.slice(0, 8).map((run) => ({
    id: run.id,
    title: run.title,
    status: run.status,
    current_node: run.currentNode,
    node_status: run.graph.nodeStates[run.currentNode].status,
    latest_summary: run.latestSummary || ""
  }));

  const recentLogs = ctx.logs.slice(-12);
  const steeringHints = (ctx.steeringHints || []).filter((x) => x.trim()).slice(-5);

  return [
    "You are a natural-language assistant for the AutoLabOS TUI.",
    "You must respond with STRICT JSON only. No markdown, no extra text.",
    "reply_lines must follow the same language as the user input.",
    "You have read-only access to workspace files and should inspect relevant files when needed.",
    "Answer exactly what the user asked. Do not include unrelated workflow/status unless explicitly requested.",
    "Use selected_run_facts as trusted context for run artifacts and counts.",
    "For hypothesis questions, selected_run_facts.hypothesisStoredCount is the canonical saved count from hypotheses.jsonl when available.",
    "selected_run_facts.hypothesisCandidateCount is only the number of generated candidates/branches before selection, not the saved hypothesis count.",
    "Do not infer a mismatch between summary text and saved files unless the user explicitly asks about candidate generation or inconsistency.",
    "If the answer is uncertain, state uncertainty clearly instead of inventing data.",
    "If user asks to execute, suggest exactly one safe slash command and set should_offer_execute=true.",
    "If the user asks for a multi-step action, you may return recommended_commands as an ordered array of safe slash commands.",
    "If steering hints indicate a previous plan step failed, treat this as a replanning request and revise the plan.",
    "When replanning after failure, avoid repeating the same failed command unchanged unless no safer alternative exists.",
    "If user asks for explanation only, set should_offer_execute=false.",
    "Allowed root commands: /help, /new, /doctor, /runs, /run, /resume, /title, /agent, /model, /approve, /retry, /settings, /quit.",
    "For model settings, recommend '/model' only (no subcommands).",
    "When user asks to collect papers, prefer '/agent collect [query] [options]' and set should_offer_execute=true.",
    "For additional paper collection, prefer '/agent collect --additional <count> --run <run-id>' (legacy '/agent recollect <count> [run-id]' is also valid).",
    "Collect options include --limit, --additional, --last-years, --year, --date-range, --sort, --order, --field, --venue, --type, --min-citations, --open-access, --bibtex, --dry-run.",
    "For additional paper collection requests, do NOT recommend /approve.",
    "When user asks to move back to an earlier stage/node, prefer '/agent jump <node> [run-id]'.",
    "Never output shell commands.",
    "",
    `Workspace root: ${workspaceRoot}`,
    `User input: ${ctx.input}`,
    `Active run id: ${ctx.activeRunId || ""}`,
    `Runs snapshot: ${JSON.stringify(runs)}`,
    `Selected run facts: ${JSON.stringify(selectedFacts || {})}`,
    `Steering hints: ${JSON.stringify(steeringHints)}`,
    `Recent logs: ${JSON.stringify(recentLogs)}`,
    "",
    "JSON schema:",
    "{",
    '  "reply_lines": ["line1", "line2"],',
    '  "target_run_id": "run-id-or-empty",',
    '  "recommended_command": "/agent ... or empty",',
    '  "recommended_commands": ["/agent ...", "/title ..."] ,',
    '  "should_offer_execute": true',
    "}"
  ].join("\n");
}

function buildPlainTextRetryPrompt(
  ctx: NaturalLlmAssistantContext,
  selectedFacts: RunFacts | undefined,
  workspaceRoot: string
): string {
  const steeringHints = (ctx.steeringHints || []).filter((x) => x.trim()).slice(-5);
  return [
    "You are a natural-language assistant for the AutoLabOS TUI.",
    "The previous strict-JSON answer failed to parse.",
    "Answer in plain text only, no JSON and no markdown.",
    "Use the same language as the user input.",
    "Answer exactly what the user asked in 1-4 lines.",
    "If you need command guidance, include one slash command inline.",
    "",
    `Workspace root: ${workspaceRoot}`,
    `User input: ${ctx.input}`,
    `Active run id: ${ctx.activeRunId || ""}`,
    `Selected run facts: ${JSON.stringify(selectedFacts || {})}`,
    `Steering hints: ${JSON.stringify(steeringHints)}`
  ].join("\n");
}

function parseModelOutput(raw: string): ModelOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const direct = tryJson(trimmed);
  if (direct) {
    return direct;
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fenced = tryJson(fencedMatch[1].trim());
    if (fenced) {
      return fenced;
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryJson(trimmed.slice(start, end + 1));
    if (sliced) {
      return sliced;
    }
  }

  return null;
}

function tryJson(text: string): ModelOutput | null {
  try {
    return JSON.parse(text) as ModelOutput;
  } catch {
    return null;
  }
}

function sanitizeReplyLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function parseLlmResponse(
  raw: string,
  runs: RunRecord[],
  selectedRunId?: string
): NaturalAssistantResponse | undefined {
  const parsed = parseModelOutput(raw);
  if (parsed) {
    const replyLines = sanitizeReplyLines(parsed.reply_lines);
    if (replyLines.length > 0) {
      const targetRunId = resolveTargetRunId(parsed.target_run_id, runs, selectedRunId);
      const recommendedCommand = sanitizeRecommendedCommand(parsed.recommended_command);
      const recommendedCommands = sanitizeRecommendedCommands(parsed.recommended_commands);
      const shouldOfferExecute = parsed.should_offer_execute === true;
      const effectiveCommands =
        recommendedCommands.length > 0
          ? recommendedCommands
          : recommendedCommand
            ? [recommendedCommand]
            : [];
      return {
        lines: replyLines,
        targetRunId,
        pendingCommand: shouldOfferExecute && effectiveCommands.length === 1 ? effectiveCommands[0] : undefined,
        pendingCommands: shouldOfferExecute && effectiveCommands.length > 1 ? effectiveCommands : undefined
      };
    }
  }

  const freeform = sanitizeFreeformReply(raw);
  if (freeform.length > 0) {
    return {
      lines: freeform,
      targetRunId: selectedRunId
    };
  }

  return undefined;
}

function sanitizeFreeformReply(raw: string): string[] {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  if (!cleaned) {
    return [];
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);

  if (lines.length === 0) {
    return [];
  }

  const jsonLike = lines.every((line) => /^[\[\]{}:,"]+$/.test(line));
  if (jsonLike) {
    return [];
  }

  return lines;
}

function resolveTargetRunId(raw: unknown, runs: RunRecord[], fallback?: string): string | undefined {
  if (typeof raw === "string" && raw.trim()) {
    const found = runs.find((run) => run.id === raw.trim());
    if (found) {
      return found.id;
    }
  }
  return fallback;
}

function sanitizeRecommendedCommand(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const cmd = raw.replace(/\s+/g, " ").trim();
  if (!cmd.startsWith("/")) {
    return undefined;
  }
  if (/[\n\r]/.test(cmd)) {
    return undefined;
  }

  const parsed = parseSlashCommand(cmd);
  if (!parsed) {
    return undefined;
  }
  if (!ALLOWED_ROOT_COMMANDS.has(parsed.command)) {
    return undefined;
  }

  return cmd;
}

function sanitizeRecommendedCommands(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const value of raw) {
    const command = sanitizeRecommendedCommand(value);
    if (!command) {
      continue;
    }
    if (!out.includes(command)) {
      out.push(command);
    }
  }
  return out.slice(0, 8);
}

function resolveTargetRun(runs: RunRecord[], activeRunId: string | undefined, input: string): RunRecord | undefined {
  const lower = input.toLowerCase();
  for (const run of runs) {
    if (lower.includes(run.id.toLowerCase()) || lower.includes(run.title.toLowerCase())) {
      return run;
    }
  }

  if (activeRunId) {
    const active = runs.find((run) => run.id === activeRunId);
    if (active) {
      return active;
    }
  }

  return runs[0];
}

async function buildRunFacts(run: RunRecord, workspaceRoot: string): Promise<RunFacts> {
  const runContextPath = resolvePath(workspaceRoot, run.memoryRefs.runContextPath);
  const contextMap = await readRunContextMap(runContextPath);
  const runRoot = path.join(workspaceRoot, ".autolabos", "runs", run.id);

  const collectFromMemory = toOptionalNumber(contextMap.get("collect_papers.count"));
  const evidenceFromMemory = toOptionalNumber(contextMap.get("analyze_papers.evidence_count"));
  const hypothesisRequestedTopK = toOptionalNumber(contextMap.get("generate_hypotheses.top_k"));
  const hypothesisCandidateCount =
    toOptionalNumber(contextMap.get("generate_hypotheses.candidate_count")) ??
    toOptionalNumber(contextMap.get("generate_hypotheses.branch_count"));
  const hypothesisSummary = toOptionalString(contextMap.get("generate_hypotheses.summary"));

  const corpusFacts = await readCorpusFacts(path.join(runRoot, "corpus.jsonl"), 20);
  const collectFromFile = corpusFacts.count;
  const paperTitles = corpusFacts.titles;
  const evidenceFromFile = await countJsonlLines(path.join(runRoot, "evidence_store.jsonl"));
  const hypothesisFromFile = await countJsonlLines(path.join(runRoot, "hypotheses.jsonl"));
  const metrics = await readMetrics(path.join(runRoot, "metrics.json"));
  const hypothesisStoredCount = hypothesisFromFile ?? hypothesisRequestedTopK;

  const completedCount = GRAPH_NODE_ORDER.filter((node) => {
    const status = run.graph.nodeStates[node].status;
    return status === "completed" || status === "skipped";
  }).length;

  return {
    runId: run.id,
    title: run.title,
    status: run.status,
    currentNode: run.currentNode,
    currentNodeStatus: run.graph.nodeStates[run.currentNode].status,
    progress: `${completedCount}/${GRAPH_NODE_ORDER.length}`,
    collectPapersCount: collectFromMemory ?? collectFromFile,
    paperTitles,
    missingPdfCount: corpusFacts.missingPdfCount,
    topCitationTitle: corpusFacts.topCitationTitle,
    topCitationCount: corpusFacts.topCitationCount,
    evidenceCount: evidenceFromMemory ?? evidenceFromFile,
    hypothesisCount: hypothesisStoredCount,
    hypothesisStoredCount,
    hypothesisRequestedTopK,
    hypothesisCandidateCount,
    hypothesisSummary,
    metrics,
    collectPapersError: toOptionalString(contextMap.get("collect_papers.last_error"))
  };
}

function unavailableResponse(input: string, targetRunId?: string, error?: unknown): NaturalAssistantResponse {
  const reason = summarizeError(error);
  const language = detectInputLanguage(input);
  if (language === "ko") {
    const lines = [
      "현재 질문에 답할 모델 응답을 해석하지 못했습니다."
    ];
    if (reason) {
      lines.push(`원인: ${reason}`);
    }
    lines.push("질문을 조금 바꿔서 다시 시도해 주세요.");
    return {
      lines,
      targetRunId
    };
  }

  return {
    lines: [
      "I couldn't parse a reliable model response for this question.",
      reason ? `Reason: ${reason}` : "Please rephrase and try again."
    ],
    targetRunId
  };
}

function summarizeError(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const oneLine = error.message.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return undefined;
  }

  if (oneLine.length <= 160) {
    return oneLine;
  }

  return `${oneLine.slice(0, 157)}...`;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

function detectInputLanguage(input: string): "ko" | "en" {
  return /[\p{Script=Hangul}]/u.test(input) ? "ko" : "en";
}

function resolvePath(workspaceRoot: string, maybeRelative: string): string {
  if (path.isAbsolute(maybeRelative)) {
    return maybeRelative;
  }
  return path.join(workspaceRoot, maybeRelative);
}

async function readRunContextMap(filePath: string): Promise<Map<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { items?: Array<{ key?: unknown; value?: unknown }> };
    const map = new Map<string, unknown>();
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      if (typeof item.key === "string") {
        map.set(item.key, item.value);
      }
    }
    return map;
  } catch {
    return new Map<string, unknown>();
  }
}

async function countJsonlLines(filePath: string): Promise<number | undefined> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
  } catch {
    return undefined;
  }
}

interface CorpusFacts {
  count?: number;
  titles: string[];
  missingPdfCount?: number;
  topCitationTitle?: string;
  topCitationCount?: number;
}

async function readCorpusFacts(filePath: string, maxTitles: number): Promise<CorpusFacts> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const facts: CorpusFacts = {
      count: lines.length,
      titles: [],
      missingPdfCount: 0
    };

    let bestCitation = -1;
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const title = toOptionalString(row.title);
        if (title && facts.titles.length < maxTitles) {
          facts.titles.push(title);
        }

        const pdfPath =
          toOptionalString(row.pdf_url) ||
          toOptionalString(row.open_access_pdf_url) ||
          readNestedUrl(row.open_access_pdf);
        const canonicalUrl = toOptionalString(row.url);
        const hasPdf = Boolean(pdfPath) || looksLikePdfUrl(canonicalUrl);
        if (!hasPdf) {
          facts.missingPdfCount = (facts.missingPdfCount ?? 0) + 1;
        }

        const citationRaw = row.citation_count ?? row.citationCount;
        const citation = toOptionalNumber(citationRaw);
        if (title && citation !== undefined && citation > bestCitation) {
          bestCitation = citation;
          facts.topCitationTitle = title;
          facts.topCitationCount = citation;
        }
      } catch {
        facts.missingPdfCount = (facts.missingPdfCount ?? 0) + 1;
      }
    }

    return facts;
  } catch {
    return {
      titles: []
    };
  }
}

async function readMetrics(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed;
  } catch {
    return undefined;
  }
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readNestedUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return toOptionalString(record.url);
}

function looksLikePdfUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return /\.pdf($|[?#])/i.test(url);
}

async function runForTextWithTimeout(
  llm: NaturalAssistantTextClient,
  args: {
    prompt: string;
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
    approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted";
    abortSignal?: AbortSignal;
  },
  timeoutMs: number,
  progress?: ProgressReporter
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const execute = typeof llm.runTurnStream === "function"
      ? llm
          .runTurnStream({
            ...args,
            onEvent: (event) => {
              progress?.onEvent(event);
            }
          })
          .then((result) => result.finalText)
      : llm.runForText({
          prompt: args.prompt,
          sandboxMode: args.sandboxMode,
          approvalPolicy: args.approvalPolicy
        });

    return await Promise.race([
      execute,
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`LLM timeout after ${Math.ceil(timeoutMs / 1000)}s`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

interface ProgressReporter {
  status: (message: string) => void;
  onEvent: (event: unknown) => void;
}

function createProgressReporter(onProgress?: (line: string) => void): ProgressReporter {
  const state = {
    buffer: "",
    lastEmitMs: 0
  };

  return {
    status(_message: string) {
      // Keep status-level progress silent to reduce log noise.
    },
    onEvent(event: unknown) {
      if (!onProgress) {
        return;
      }

      const eventType = readEventType(event);
      if (eventType === "thread.started") {
        return;
      }

      const delta = extractEventDelta(event);
      if (delta) {
        state.buffer += delta;
        const hasBreak = /[\n\r]/u.test(state.buffer);
        const longEnough = state.buffer.length >= 24;
        const now = Date.now();
        if (state.lastEmitMs === 0) {
          state.lastEmitMs = now;
        }
        const stale = now - state.lastEmitMs >= 350;
        if (hasBreak || longEnough || stale) {
          const text = oneLine(state.buffer);
          if (text) {
            onProgress(`LLM> ${text}`);
            state.buffer = "";
            state.lastEmitMs = now;
          }
        }
        return;
      }

      if (eventType.endsWith(".completed")) {
        const flushed = oneLine(state.buffer);
        if (flushed) {
          onProgress(`LLM> ${flushed}`);
          state.buffer = "";
        }
      }
    }
  };
}

function readEventType(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" ? type : "";
}

function extractEventDelta(event: unknown): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const record = event as {
    type?: unknown;
    delta?: unknown;
    text?: unknown;
    item?: unknown;
    content?: unknown;
  };
  const type = typeof record.type === "string" ? record.type : "";
  if (!type.includes("delta")) {
    return "";
  }

  if (typeof record.delta === "string") {
    return record.delta;
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  const fromItem = extractTextFromUnknown(record.item);
  if (fromItem) {
    return fromItem;
  }

  const fromContent = extractTextFromUnknown(record.content);
  if (fromContent) {
    return fromContent;
  }

  return "";
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((x) => extractTextFromUnknown(x)).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct =
    (typeof record.text === "string" ? record.text : "") ||
    (typeof record.output_text === "string" ? record.output_text : "") ||
    (typeof record.delta === "string" ? record.delta : "");

  if (direct) {
    return direct;
  }

  return extractTextFromUnknown(record.content);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
