import path from "node:path";
import { promises as fs } from "node:fs";

import { EventStream } from "../events.js";
import { RunStore } from "../runs/runStore.js";
import { RunRecord } from "../../types.js";
import { CodexCliClient, CodexEvent } from "../../integrations/codex/codexCliClient.js";
import { mapCodexEventToAutoResearchEvents } from "../../integrations/codex/codexEventMapper.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { ensureDir, fileExists, writeJsonFile } from "../../utils/fs.js";
import { safeRead } from "../nodes/helpers.js";

export interface ImplementSessionSummary {
  summary: string;
  threadId?: string;
  runCommand: string;
  testCommand?: string;
  scriptPath?: string;
  metricsPath: string;
  changedFiles: string[];
  artifacts: string[];
  rawResponse: string;
}

interface ImplementSessionDeps {
  codex: CodexCliClient;
  eventStream: EventStream;
  runStore: RunStore;
  workspaceRoot: string;
}

interface StructuredImplementResponse {
  summary?: string;
  run_command?: string;
  test_command?: string;
  changed_files?: string[];
  artifacts?: string[];
  script_path?: string;
  metrics_path?: string;
}

interface CachedConstraintProfile {
  profile?: {
    source?: string;
    collect?: Record<string, unknown>;
    writing?: Record<string, unknown>;
    experiment?: Record<string, unknown>;
    assumptions?: string[];
  };
}

export class ImplementSessionManager {
  constructor(private readonly deps: ImplementSessionDeps) {}

  async run(run: RunRecord, abortSignal?: AbortSignal): Promise<ImplementSessionSummary> {
    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    const runDir = path.join(this.deps.workspaceRoot, ".autoresearch", "runs", run.id);
    const metricsPath = path.join(runDir, "metrics.json");
    const currentThreadId =
      run.nodeThreads.implement_experiments ||
      (await runContext.get<string>("implement_experiments.thread_id"));

    const changedFiles = new Set<string>();
    const artifacts = new Set<string>();
    const rawEvents: CodexEvent[] = [];
    const streamProgress = createCodexProgressEmitter((text) => {
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text
        }
      });
    });

    const result = await this.deps.codex.runTurnStream({
      prompt: await this.buildPrompt(run, runDir, metricsPath, runContext),
      threadId: currentThreadId,
      agentId: `implementer:${run.id}`,
      systemPrompt: this.buildSystemPrompt(run, runDir, metricsPath),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      workingDirectory: this.deps.workspaceRoot,
      abortSignal,
      onEvent: (event) => {
        rawEvents.push(event);
        streamProgress.onEvent(event);
        const mapped = mapCodexEventToAutoResearchEvents({
          event,
          runId: run.id,
          node: "implement_experiments",
          agentRole: "implementer",
          workspaceRoot: this.deps.workspaceRoot
        });
        for (const item of mapped) {
          this.deps.eventStream.emit(item);
          const fileValue = typeof item.payload.file === "string" ? item.payload.file : undefined;
          if (fileValue) {
            changedFiles.add(fileValue);
            artifacts.add(fileValue);
          }
        }
      }
    });
    streamProgress.flush();

    const parsed = parseStructuredResponse(result.finalText);
    const normalizedMetricsPath = normalizeStoredPath(parsed.metrics_path, this.deps.workspaceRoot) || metricsPath;
    const normalizedScriptPath =
      normalizeStoredPath(parsed.script_path, this.deps.workspaceRoot) ||
      (await inferScriptPath(runDir, this.deps.workspaceRoot, parsed.run_command));

    for (const filePath of parsed.changed_files || []) {
      const normalized = normalizeStoredPath(filePath, this.deps.workspaceRoot);
      if (normalized) {
        changedFiles.add(normalized);
        artifacts.add(normalized);
      }
    }
    for (const filePath of parsed.artifacts || []) {
      const normalized = normalizeStoredPath(filePath, this.deps.workspaceRoot);
      if (normalized) {
        artifacts.add(normalized);
      }
    }
    if (normalizedScriptPath) {
      changedFiles.add(normalizedScriptPath);
      artifacts.add(normalizedScriptPath);
    }

    const summary =
      parsed.summary?.trim() ||
      `Codex implementation session updated ${Math.max(1, changedFiles.size)} file(s).`;
    const runCommand =
      parsed.run_command?.trim() ||
      inferRunCommand(normalizedScriptPath, this.deps.workspaceRoot, run.id);
    const testCommand = parsed.test_command?.trim() || undefined;

    if (!runCommand) {
      throw new Error("Codex implementation session did not yield a runnable command.");
    }

    const latestRun = (await this.deps.runStore.getRun(run.id)) || run;
    if (result.threadId && latestRun.nodeThreads.implement_experiments !== result.threadId) {
      latestRun.nodeThreads.implement_experiments = result.threadId;
      await this.deps.runStore.updateRun(latestRun);
    }

    await runContext.put("implement_experiments.thread_id", result.threadId || currentThreadId);
    await runContext.put("implement_experiments.run_command", runCommand);
    await runContext.put("implement_experiments.test_command", testCommand);
    await runContext.put("implement_experiments.changed_files", [...changedFiles]);
    await runContext.put("implement_experiments.artifacts", [...artifacts]);
    await runContext.put("implement_experiments.metrics_path", normalizedMetricsPath);
    await runContext.put("implement_experiments.script", normalizedScriptPath);
    await runContext.put("implement_experiments.cwd", this.deps.workspaceRoot);
    await runContext.put("implement_experiments.last_summary", summary);
    await runContext.put("implement_experiments.raw_response", result.finalText);

    await ensureDir(runDir);
    await writeJsonFile(path.join(runDir, "implement_result.json"), {
      thread_id: result.threadId || currentThreadId,
      summary,
      run_command: runCommand,
      test_command: testCommand,
      metrics_path: normalizedMetricsPath,
      script_path: normalizedScriptPath,
      changed_files: [...changedFiles],
      artifacts: [...artifacts],
      raw_response: result.finalText,
      raw_event_count: rawEvents.length,
      updated_at: new Date().toISOString()
    });

    return {
      summary,
      threadId: result.threadId || currentThreadId,
      runCommand,
      testCommand,
      scriptPath: normalizedScriptPath,
      metricsPath: normalizedMetricsPath,
      changedFiles: [...changedFiles],
      artifacts: [...artifacts],
      rawResponse: result.finalText
    };
  }

  private buildSystemPrompt(run: RunRecord, runDir: string, metricsPath: string): string {
    return [
      "You are the AutoResearch implementer role.",
      "Work directly in the workspace using Codex tools.",
      "Prefer concrete, runnable changes over prose.",
      "Do not modify git history or perform destructive cleanup.",
      `Run artifact directory: ${runDir}`,
      `The experiment execution must produce JSON metrics at: ${metricsPath}`,
      "Prefer creating or updating files under the run artifact directory unless the existing repo structure clearly requires a different target.",
      "Return ONLY one JSON object with keys: summary, run_command, test_command, changed_files, artifacts, script_path, metrics_path.",
      "changed_files and artifacts must be arrays of workspace paths."
    ].join("\n");
  }

  private async buildPrompt(
    run: RunRecord,
    runDir: string,
    metricsPath: string,
    runContext: RunContextMemory
  ): Promise<string> {
    const plan = trimBlock(await safeRead(path.join(runDir, "experiment_plan.yaml")), 12_000);
    const hypotheses = trimBlock(await safeRead(path.join(runDir, "hypotheses.jsonl")), 12_000);
    const previousSummary = await runContext.get<string>("implement_experiments.last_summary");
    const previousRunCommand = await runContext.get<string>("implement_experiments.run_command");
    const previousScript = await runContext.get<string>("implement_experiments.script");
    const cachedConstraintProfile = await runContext.get<CachedConstraintProfile>("constraints.profile");
    const repoListing = await topLevelWorkspaceListing(this.deps.workspaceRoot);

    return [
      `Run id: ${run.id}`,
      `Topic: ${run.topic}`,
      `Objective metric: ${run.objectiveMetric}`,
      `Constraints: ${run.constraints.join(", ") || "none"}`,
      "Resolved constraint profile:",
      JSON.stringify(cachedConstraintProfile?.profile || {}, null, 2),
      `Workspace root: ${this.deps.workspaceRoot}`,
      `Run directory: ${runDir}`,
      `Required metrics output: ${metricsPath}`,
      "",
      "Existing top-level workspace entries:",
      repoListing,
      "",
      "Experiment plan YAML:",
      plan || "(missing)",
      "",
      "Hypotheses JSONL excerpt:",
      hypotheses || "(missing)",
      "",
      "Previous implementation summary:",
      previousSummary || "(none)",
      `Previous run command: ${previousRunCommand || "(none)"}`,
      `Previous script path: ${previousScript || "(none)"}`,
      "",
      "Task:",
      "1. Implement a runnable experiment for this run.",
      "2. Ensure the recommended run command writes metrics JSON to the required metrics path.",
      "3. Keep the implementation minimal but real; prefer deterministic metrics generation if the research plan is underspecified.",
      "4. If useful, run lightweight checks locally before finishing.",
      "5. Finish by returning ONLY the required JSON object."
    ].join("\n");
  }
}

function createCodexProgressEmitter(onText: (text: string) => void): {
  onEvent: (event: CodexEvent) => void;
  flush: () => void;
} {
  const state = {
    buffer: "",
    lastEmitMs: 0
  };

  const emitBuffer = () => {
    const text = oneLine(state.buffer);
    if (!text) {
      state.buffer = "";
      return;
    }
    onText(text);
    state.buffer = "";
    state.lastEmitMs = Date.now();
  };

  return {
    onEvent(event: CodexEvent) {
      const delta = extractEventDelta(event);
      if (delta) {
        state.buffer += delta;
        const now = Date.now();
        const hasBreak = /[\n\r]/u.test(state.buffer);
        const longEnough = state.buffer.length >= 24;
        if (state.lastEmitMs === 0) {
          state.lastEmitMs = now;
        }
        const stale = now - state.lastEmitMs >= 350;
        if (hasBreak || longEnough || stale) {
          emitBuffer();
        }
        return;
      }

      const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
      if (type.endsWith(".completed") || type === "response.completed" || type === "item.completed") {
        emitBuffer();
      }
    },
    flush() {
      emitBuffer();
    }
  };
}

function extractEventDelta(event: CodexEvent): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const type = typeof event.type === "string" ? event.type : "";
  if (!type.includes("delta")) {
    return "";
  }

  const direct =
    (typeof event.delta === "string" ? event.delta : "") ||
    (typeof event.text === "string" ? event.text : "") ||
    extractTextFromUnknown((event as Record<string, unknown>).item) ||
    extractTextFromUnknown((event as Record<string, unknown>).content);

  return direct;
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromUnknown(item)).join("");
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
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function parseStructuredResponse(text: string): StructuredImplementResponse {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  return {
    summary: asString(record.summary),
    run_command: asString(record.run_command),
    test_command: asString(record.test_command),
    changed_files: asStringArray(record.changed_files),
    artifacts: asStringArray(record.artifacts),
    script_path: asString(record.script_path),
    metrics_path: asString(record.metrics_path)
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeStoredPath(filePath: string | undefined, workspaceRoot: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(workspaceRoot, filePath);
}

function trimBlock(text: string, limit: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}\n...<truncated>`;
}

async function topLevelWorkspaceListing(workspaceRoot: string): Promise<string> {
  try {
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .slice(0, 80)
      .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`)
      .join("\n");
  } catch {
    return "(unavailable)";
  }
}

async function inferScriptPath(
  runDir: string,
  workspaceRoot: string,
  runCommand?: string
): Promise<string | undefined> {
  const candidates = [
    path.join(runDir, "experiment.py"),
    path.join(runDir, "experiment.js"),
    path.join(runDir, "experiment.sh")
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  if (runCommand) {
    const token = runCommand
      .split(/\s+/)
      .find((part) => /\.(py|js|sh|mjs|cjs)$/i.test(part.replace(/^['"]|['"]$/g, "")));
    if (token) {
      return normalizeStoredPath(token.replace(/^['"]|['"]$/g, ""), workspaceRoot);
    }
  }

  return undefined;
}

function inferRunCommand(scriptPath: string | undefined, workspaceRoot: string, runId: string): string {
  if (scriptPath) {
    const quoted = JSON.stringify(scriptPath);
    if (/\.py$/i.test(scriptPath)) {
      return `python3 ${quoted}`;
    }
    if (/\.(js|mjs|cjs)$/i.test(scriptPath)) {
      return `node ${quoted}`;
    }
    if (/\.sh$/i.test(scriptPath)) {
      return `bash ${quoted}`;
    }
  }

  const fallback = path.join(workspaceRoot, ".autoresearch", "runs", runId, "experiment.py");
  return `python3 ${JSON.stringify(fallback)}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}
