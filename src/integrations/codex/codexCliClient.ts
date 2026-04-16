import path from "node:path";
import os from "node:os";
import { constants as fsConstants, promises as fs } from "node:fs";
import {
  checkCodexOAuthStatus,
  resolveCodexOAuthCredentials
} from "./oauthAuth.js";
import { CodexOAuthResponsesTextClient } from "./oauthResponsesTextClient.js";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface CodexRunDefaults {
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fastMode?: boolean;
}

export interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

export interface RunTurnOptions {
  prompt: string;
  threadId?: string;
  agentId?: string;
  systemPrompt?: string;
  inputImagePaths?: string[];
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  fastMode?: boolean;
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  abortSignal?: AbortSignal;
  workingDirectory?: string;
  onEvent?: (event: CodexEvent) => void;
}

export interface RunTurnResult {
  threadId?: string;
  finalText: string;
  events: CodexEvent[];
}

export interface CodexCompletionUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CliCheckResult {
  ok: boolean;
  detail: string;
}

export interface CodexEnvironmentCheck extends CliCheckResult {
  name: "codex-home" | "codex-shell-snapshots" | "codex-model-capacity";
  blocking: boolean;
}

const SANDBOX_PATH_ALIAS_PREFIXES = [
  ["/private/tmp", "/tmp"],
  ["/private/var/folders", "/var/folders"]
] as const;

export function presentCodexPath(filePath: string): string {
  for (const [internalPrefix, visiblePrefix] of SANDBOX_PATH_ALIAS_PREFIXES) {
    const mapped = remapPathPrefix(filePath, internalPrefix, visiblePrefix);
    if (mapped) {
      return mapped;
    }
  }
  return filePath;
}

export function normalizeCodexWorkspacePath(filePath: string | undefined, workspaceRoot: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  if (!path.isAbsolute(filePath)) {
    const resolved = path.resolve(workspaceRoot, filePath);
    return isPathInsideOrEqual(resolved, workspaceRoot) ? resolved : undefined;
  }

  for (const root of buildWorkspacePathAliases(workspaceRoot)) {
    if (!isPathInsideOrEqual(filePath, root)) {
      continue;
    }
    const relative = path.relative(root, filePath);
    const normalized = path.resolve(workspaceRoot, relative);
    if (isPathInsideOrEqual(normalized, workspaceRoot)) {
      return normalized;
    }
  }

  return undefined;
}

export function selectPreferredCodexFinalText(options: {
  completedText?: string;
  deltaText?: string;
  fallbackText?: string;
}): string {
  const candidates = [
    options.completedText?.trim() || "",
    options.deltaText?.trim() || "",
    options.fallbackText?.trim() || ""
  ].filter(Boolean);
  if (candidates.length === 0) {
    return "";
  }

  const uniqueCandidates = [...new Set(candidates)];
  uniqueCandidates.sort((left, right) => scoreCodexFinalText(right) - scoreCodexFinalText(left));
  return uniqueCandidates[0] || "";
}

export class CodexNativeClient {
  private readonly oauthTextClient: CodexOAuthResponsesTextClient;

  constructor(
    private readonly defaultWorkingDirectory: string,
    private readonly defaults: CodexRunDefaults = {}
  ) {
    this.oauthTextClient = new CodexOAuthResponsesTextClient(
      () => resolveCodexOAuthCredentials(),
      {
        model: this.defaults.model,
        reasoningEffort: this.defaults.reasoningEffort
      }
    );
  }

  updateDefaults(next: CodexRunDefaults): void {
    if (typeof next.model === "string" && next.model.trim()) {
      this.defaults.model = next.model.trim();
    }
    if (next.reasoningEffort) {
      this.defaults.reasoningEffort = next.reasoningEffort;
    }
    if (typeof next.fastMode === "boolean") {
      this.defaults.fastMode = next.fastMode;
    }
    this.oauthTextClient.updateDefaults({
      model: this.defaults.model,
      reasoningEffort: this.defaults.reasoningEffort
    });
  }

  async checkCliAvailable(): Promise<CliCheckResult> {
    return checkCodexOAuthStatus();
  }

  async checkLoginStatus(): Promise<CliCheckResult> {
    return checkCodexOAuthStatus();
  }

  async checkEnvironmentReadiness(opts?: {
    models?: string[];
    includeModelCapacity?: boolean;
  }): Promise<CodexEnvironmentCheck[]> {
    const checks: CodexEnvironmentCheck[] = [];
    const runtimeHome = await this.resolveRuntimeCodexHome();
    checks.push(...runtimeHome.checks);

    if (opts?.includeModelCapacity) {
      const riskyModels = Array.from(
        new Set(
          (opts.models || [])
            .map((model) => model.trim())
            .filter(Boolean)
            .filter((model) => /gpt-5\.3-codex-spark/i.test(model))
        )
      );
      checks.push({
        name: "codex-model-capacity",
        ok: riskyModels.length === 0,
        blocking: false,
        detail:
          riskyModels.length === 0
            ? "Configured Codex analysis models avoid the known Spark long-run usage-limit risk."
            : `Configured Codex analysis model(s) ${riskyModels.join(
                ", "
              )} are prone to usage-limit stalls during long rerank/analyze passes; prefer /model -> gpt-5.4 before large literature runs.`
      });
    }

    return checks;
  }

  async runForText(opts: {
    prompt: string;
    sandboxMode: CodexSandboxMode;
    approvalPolicy: CodexApprovalPolicy;
    threadId?: string;
    agentId?: string;
    systemPrompt?: string;
    inputImagePaths?: string[];
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    fastMode?: boolean;
  }): Promise<string> {
    const result = await this.runTurnStream({
      prompt: opts.prompt,
      threadId: opts.threadId,
      agentId: opts.agentId,
      systemPrompt: opts.systemPrompt,
      inputImagePaths: opts.inputImagePaths,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      fastMode: opts.fastMode,
      sandboxMode: opts.sandboxMode,
      approvalPolicy: opts.approvalPolicy
    });
    return result.finalText;
  }

  async runTurnStream(opts: RunTurnOptions): Promise<RunTurnResult> {
    const fakeResponse = resolveFakeCodexResponse();
    if (typeof fakeResponse === "string" && fakeResponse.length > 0) {
      const discoveredThreadId = opts.threadId || process.env.AUTOLABOS_FAKE_CODEX_THREAD_ID || "fake-thread";
      const event = normalizeAgentEvent(
        {
          type: "item.completed",
          item: {
            text: fakeResponse
          }
        },
        opts.agentId
      );
      opts.onEvent?.(event);
      return {
        threadId: discoveredThreadId,
        finalText: fakeResponse,
        events: [event]
      };
    }

    const events: CodexEvent[] = [];
    const emit = (event: CodexEvent) => {
      const normalized = normalizeAgentEvent(event, opts.agentId);
      events.push(normalized);
      opts.onEvent?.(normalized);
    };

    let result;
    try {
      result = await this.oauthTextClient.complete({
        prompt: opts.prompt,
        threadId: opts.threadId,
        previousResponseId: opts.threadId,
        systemPrompt: opts.systemPrompt,
        inputImagePaths: opts.inputImagePaths,
        model: opts.model || this.defaults.model,
        reasoningEffort: opts.reasoningEffort || this.defaults.reasoningEffort,
        abortSignal: opts.abortSignal,
        onProgress: (message) => {
          emit({
            type: "status",
            message
          });
        }
      });
    } catch (error) {
      if (opts.abortSignal?.aborted || isAbortLikeError(error)) {
        throw new Error("Operation aborted by user");
      }
      throw error;
    }

    const discoveredThreadId = result.responseId || opts.threadId;
    if (discoveredThreadId) {
      emit({
        type: "thread.started",
        thread_id: discoveredThreadId
      });
    }

    if (result.text) {
      emit({
        type: "response.output_text.delta",
        delta: result.text
      });
    }

    const usagePayload = result.usage
      ? {
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens
        }
      : undefined;

    emit({
      type: "item.completed",
      item: {
        text: result.text,
        model: result.model,
        usage: usagePayload
      }
    });
    emit({
      type: "response.completed",
      response: {
        id: discoveredThreadId,
        model: result.model,
        usage: usagePayload,
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: result.text
              }
            ]
          }
        ]
      }
    });

    return {
      threadId: discoveredThreadId,
      finalText: result.text,
      events
    };
  }

  private resolveCodexHomePath(): string {
    const configured = process.env.CODEX_HOME?.trim();
    if (configured) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(this.defaultWorkingDirectory, configured);
    }
    return path.join(os.homedir(), ".codex");
  }

  private resolveWorkspaceFallbackCodexHomePath(): string {
    return path.join(this.defaultWorkingDirectory, ".autolabos", "runtime", "codex-home");
  }

  private async ensureRuntimeDirectories(): Promise<NodeJS.ProcessEnv> {
    const runtimeHome = await this.resolveRuntimeCodexHome();
    const blockingFailures = runtimeHome.checks.filter((check) => !check.ok && check.blocking);
    if (blockingFailures.length > 0) {
      throw new Error(
        blockingFailures.map((check) => `${check.name}: ${check.detail}`).join("\n")
      );
    }
    return {
      ...process.env,
      CODEX_HOME: runtimeHome.codexHome
    };
  }

  private async resolveRuntimeCodexHome(): Promise<{
    codexHome: string;
    checks: CodexEnvironmentCheck[];
  }> {
    const configured = process.env.CODEX_HOME?.trim();
    const primaryHome = this.resolveCodexHomePath();
    const primaryChecks = await this.checkCodexHomeReadiness(primaryHome);
    if (primaryChecks.every((check) => check.ok) || configured) {
      return {
        codexHome: primaryHome,
        checks: primaryChecks
      };
    }

    const fallbackHome = this.resolveWorkspaceFallbackCodexHomePath();
    const fallbackChecks = await this.checkCodexHomeReadiness(
      fallbackHome,
      `Using workspace-local fallback because ${primaryHome} is not writable.`
    );
    if (fallbackChecks.every((check) => check.ok)) {
      return {
        codexHome: fallbackHome,
        checks: fallbackChecks
      };
    }

    return {
      codexHome: primaryHome,
      checks: [...primaryChecks, ...fallbackChecks]
    };
  }

  private async checkCodexHomeReadiness(
    codexHome: string,
    detailPrefix?: string
  ): Promise<CodexEnvironmentCheck[]> {
    const prefix = detailPrefix ? `${detailPrefix} ` : "";
    return [
      await this.checkWritableDirectory(
        "codex-home",
        codexHome,
        `${prefix}Codex home directory is writable.`
      ),
      await this.checkWritableDirectory(
        "codex-shell-snapshots",
        path.join(codexHome, "shell_snapshots"),
        `${prefix}Codex shell snapshot directory is writable.`
      )
    ];
  }

  private async checkWritableDirectory(
    name: CodexEnvironmentCheck["name"],
    dirPath: string,
    successDetail: string
  ): Promise<CodexEnvironmentCheck> {
    try {
      const existing = await fs.stat(dirPath).catch(() => undefined);
      if (existing && !existing.isDirectory()) {
        return {
          name,
          ok: false,
          blocking: true,
          detail: `${dirPath} exists but is not a directory.`
        };
      }
      await fs.mkdir(dirPath, { recursive: true });
      await fs.access(dirPath, fsConstants.R_OK | fsConstants.W_OK);
      return {
        name,
        ok: true,
        blocking: true,
        detail: `${successDetail} (${dirPath})`
      };
    } catch (error) {
      return {
        name,
        ok: false,
        blocking: true,
        detail: `${dirPath}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}


function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name : "";
  return name === "AbortError";
}

function remapPathPrefix(filePath: string, fromPrefix: string, toPrefix: string): string | undefined {
  if (filePath === fromPrefix) {
    return toPrefix;
  }
  if (filePath.startsWith(`${fromPrefix}/`)) {
    return `${toPrefix}${filePath.slice(fromPrefix.length)}`;
  }
  return undefined;
}

function buildWorkspacePathAliases(workspaceRoot: string): string[] {
  const aliases = new Set<string>([workspaceRoot]);
  for (const [internalPrefix, visiblePrefix] of SANDBOX_PATH_ALIAS_PREFIXES) {
    const toVisible = remapPathPrefix(workspaceRoot, internalPrefix, visiblePrefix);
    if (toVisible) {
      aliases.add(toVisible);
    }
    const toInternal = remapPathPrefix(workspaceRoot, visiblePrefix, internalPrefix);
    if (toInternal) {
      aliases.add(toInternal);
    }
  }
  return [...aliases];
}

function isPathInsideOrEqual(filePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

let fakeResponseSequenceSource = "";
let fakeResponseSequenceIndex = 0;

function resolveFakeCodexResponse(): string | undefined {
  const fakeSequence = process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE;
  if (typeof fakeSequence === "string" && fakeSequence.trim()) {
    if (fakeResponseSequenceSource !== fakeSequence) {
      fakeResponseSequenceSource = fakeSequence;
      fakeResponseSequenceIndex = 0;
    }

    try {
      const parsed = JSON.parse(fakeSequence) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const index = Math.min(fakeResponseSequenceIndex, parsed.length - 1);
        fakeResponseSequenceIndex += 1;
        const selected = parsed[index];
        if (typeof selected === "string") {
          return selected;
        }
        return JSON.stringify(selected);
      }
    } catch {
      return undefined;
    }
  }

  const fakeResponse = process.env.AUTOLABOS_FAKE_CODEX_RESPONSE;
  if (typeof fakeResponse === "string" && fakeResponse.length > 0) {
    return fakeResponse;
  }
  return undefined;
}

function extractFallbackText(events: CodexEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = unwrapAgentEvent(events[i]);
    const completed = extractCompletedText(event);
    if (completed) {
      return completed;
    }

    const freeform = extractAnyText(event);
    if (freeform) {
      return freeform;
    }
  }
  return "";
}

function extractCompletedText(event: CodexEvent): string | undefined {
  if (event.type === "agent_message") {
    return asNonEmptyString(event.text);
  }

  if (
    event.type === "item.completed" ||
    event.type === "message.completed" ||
    event.type === "response.completed"
  ) {
    const fromItem = extractFromItem(event.item);
    if (fromItem) {
      return fromItem;
    }
  }

  if (event.type.endsWith(".completed")) {
    const direct = extractAnyText(event);
    if (direct) {
      return direct;
    }
  }

  return undefined;
}

function extractDeltaText(event: CodexEvent): string {
  if (!event.type.includes("delta")) {
    return "";
  }

  const directDelta = asString(event.delta);
  if (directDelta) {
    return directDelta;
  }

  const fromItem = extractFromItem(event.item);
  if (fromItem) {
    return fromItem;
  }

  const fromContent = extractFromContent(event.content);
  if (fromContent) {
    return fromContent;
  }

  return "";
}

function extractFromItem(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const record = item as Record<string, unknown>;

  const direct =
    asNonEmptyString(record.text) ||
    asNonEmptyString(record.output_text) ||
    asNonEmptyString(record.message) ||
    asNonEmptyString(record.content);
  if (direct) {
    return direct;
  }

  const fromContent = extractFromContent(record.content);
  if (fromContent) {
    return fromContent;
  }

  const delta = asString(record.delta);
  if (delta) {
    return delta;
  }

  return undefined;
}

function extractFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const p = part as Record<string, unknown>;
    const text =
      asString(p.text) ||
      asString(p.output_text) ||
      asString(p.delta) ||
      asString((p.text as Record<string, unknown> | undefined)?.value);
    if (text) {
      chunks.push(text);
    }
  }

  const joined = chunks.join("").trim();
  return joined || undefined;
}

function extractAnyText(event: CodexEvent): string | undefined {
  const direct =
    asNonEmptyString(event.text) ||
    asNonEmptyString(event.output_text) ||
    asNonEmptyString(event.message) ||
    asNonEmptyString(event.content);
  if (direct) {
    return direct;
  }

  const fromItem = extractFromItem(event.item);
  if (fromItem) {
    return fromItem;
  }

  return undefined;
}

function scoreCodexFinalText(text: string): number {
  let score = text.length;
  if (text.startsWith("{") || text.startsWith("[")) {
    score += 2_000;
  }
  if (/[}\]]\s*$/u.test(text)) {
    score += 1_000;
  }
  return score;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeAgentEvent(event: CodexEvent, agentId?: string): CodexEvent {
  if (!agentId) {
    return event;
  }
  return {
    type: "agent_event",
    agent_id: agentId,
    event
  };
}

function unwrapAgentEvent(event: CodexEvent): CodexEvent {
  if (event.type === "agent_event") {
    const nested = event.event;
    if (nested && typeof nested === "object") {
      return nested as CodexEvent;
    }
  }
  return event;
}

export function extractCodexCompletionUsageFromEvents(events: CodexEvent[]): CodexCompletionUsage | undefined {
  let discoveredModel: string | undefined;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = unwrapAgentEvent(events[i]);
    discoveredModel = discoveredModel || extractCodexModel(event);

    const usage = extractCodexUsage(event);
    if (usage) {
      return {
        model: discoveredModel || extractCodexModel(event),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens
      };
    }
  }

  if (discoveredModel) {
    return { model: discoveredModel };
  }

  return undefined;
}

function extractCodexUsage(value: unknown, depth = 0): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!value || typeof value !== "object" || depth > 4) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = readTokenUsageRecord(record);
  if (direct) {
    return direct;
  }

  for (const key of ["usage", "token_usage", "tokenUsage", "response", "item", "message", "metadata"]) {
    const nested = extractCodexUsage(record[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      const nested = extractCodexUsage(part, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function extractCodexModel(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== "object" || depth > 4) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct =
    asNonEmptyString(record.model) ||
    asNonEmptyString(record.model_name) ||
    asNonEmptyString(record.model_slug);
  if (direct) {
    return direct;
  }

  for (const key of ["response", "item", "message", "metadata"]) {
    const nested = extractCodexModel(record[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      const nested = extractCodexModel(part, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function readTokenUsageRecord(record: Record<string, unknown>): {
  inputTokens?: number;
  outputTokens?: number;
} | undefined {
  const inputTokens =
    asFiniteNumber(record.input_tokens) ??
    asFiniteNumber(record.inputTokens) ??
    asFiniteNumber(record.prompt_tokens) ??
    asFiniteNumber(record.promptTokens);
  const outputTokens =
    asFiniteNumber(record.output_tokens) ??
    asFiniteNumber(record.outputTokens) ??
    asFiniteNumber(record.completion_tokens) ??
    asFiniteNumber(record.completionTokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens
  };
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}
