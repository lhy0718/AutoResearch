import path from "node:path";
import { promises as fs } from "node:fs";

import { RunRecord } from "../../types.js";
import { AutoLabOSRuntime, bootstrapAutoLabOSRuntime } from "../../runtime/createRuntime.js";
import { buildWorkspaceRunRoot } from "../runs/runPaths.js";
import { readPersistedRunEvents, type AutoLabOSEvent } from "../events.js";
import { applyWithSafetyNet, type HarnessApplyResult } from "./harnessApplier.js";
import {
  CodexLLMClient,
  LLMClient,
  OllamaLLMClient,
  OpenAiResponsesLLMClient
} from "../llm/client.js";
import { OllamaClient } from "../../integrations/ollama/ollamaClient.js";
import { DEFAULT_OLLAMA_BASE_URL } from "../../integrations/ollama/modelCatalog.js";
import { ensureDir, fileExists } from "../../utils/fs.js";

export type MetaHarnessNode = "analyze_results" | "review";

export interface MetaHarnessOptions {
  cwd: string;
  runs: number;
  nodes: MetaHarnessNode[];
  noApply?: boolean;
  dryRun?: boolean;
}

export interface MetaHarnessResult {
  contextDir: string;
  diffText?: string;
  targetFile?: string;
  applied?: HarnessApplyResult;
  lines: string[];
}

interface MetaHarnessRunSummary {
  run: RunRecord;
  paperReadinessScore: number | null;
}

interface MetaHarnessDeps {
  bootstrapRuntime: typeof bootstrapAutoLabOSRuntime;
  createLlm: (runtime: AutoLabOSRuntime) => LLMClient;
  callLlm: (client: LLMClient, input: { systemPrompt: string; userPrompt: string }) => Promise<string>;
  applyWithSafetyNet: typeof applyWithSafetyNet;
  now: () => Date;
}

export async function runMetaHarness(
  options: MetaHarnessOptions,
  deps: Partial<MetaHarnessDeps> = {}
): Promise<MetaHarnessResult> {
  const resolvedDeps: MetaHarnessDeps = {
    bootstrapRuntime: bootstrapAutoLabOSRuntime,
    createLlm: createMetaHarnessLlm,
    callLlm: defaultCallLlm,
    applyWithSafetyNet,
    now: () => new Date(),
    ...deps
  };

  const bootstrap = await resolvedDeps.bootstrapRuntime({
    cwd: options.cwd,
    allowInteractiveSetup: false
  });
  if (!bootstrap.runtime) {
    throw new Error("AutoLabOS runtime must be configured before meta-harness can run.");
  }

  const timestamp = formatTimestamp(resolvedDeps.now());
  const contextDir = path.join(options.cwd, "outputs", "meta-harness", timestamp);
  const selectedRuns = await selectRecentRuns(bootstrap.runtime, options.runs);
  await buildMetaHarnessContext({
    cwd: options.cwd,
    contextDir,
    runs: selectedRuns,
    nodes: options.nodes
  });

  if (options.noApply) {
    return {
      contextDir,
      lines: [
        `Meta-harness context prepared: ${contextDir}`,
        `Use codex --context ${contextDir} for manual review.`
      ]
    };
  }

  const taskPath = path.join(contextDir, "TASK.md");
  const systemPrompt = await fs.readFile(taskPath, "utf8");
  const userPrompt = await assembleContextPrompt(contextDir);
  const client = resolvedDeps.createLlm(bootstrap.runtime);
  const llmResponse = await resolvedDeps.callLlm(client, { systemPrompt, userPrompt });
  const parsed = parseMetaHarnessResponse(llmResponse);
  if (!parsed) {
    return {
      contextDir,
      lines: [
        `Meta-harness context prepared: ${contextDir}`,
        "LLM response did not match the required TARGET_FILE + unified diff format.",
        "No files were changed."
      ]
    };
  }

  if (options.dryRun) {
    return {
      contextDir,
      diffText: parsed.diffText,
      targetFile: parsed.targetFile,
      lines: [
        `Meta-harness context prepared: ${contextDir}`,
        `TARGET_FILE: ${parsed.targetFile}`,
        parsed.diffText
      ]
    };
  }

  const absoluteTargetFile = path.join(options.cwd, parsed.targetFile);
  const originalContent = await fs.readFile(absoluteTargetFile, "utf8");
  const newContent = applyUnifiedDiff(originalContent, parsed.diffText);
  const scoreBefore = computeAveragePaperReadinessScore(selectedRuns);
  const applyResult = await resolvedDeps.applyWithSafetyNet({
    targetFile: absoluteTargetFile,
    newContent,
    source: "meta-harness",
    candidateId: timestamp,
      scoreBefore
    });

  return {
    contextDir,
    diffText: parsed.diffText,
    targetFile: parsed.targetFile,
    applied: applyResult,
    lines: [
      `Meta-harness context prepared: ${contextDir}`,
      `TARGET_FILE: ${parsed.targetFile}`,
      applyResult.applied
        ? `Applied safely and committed. Audit log: ${applyResult.auditLogPath}`
        : applyResult.rolledBack
          ? `Validation failed; restored original file. Audit log: ${applyResult.auditLogPath}`
          : `No file changes were applied. Audit log: ${applyResult.auditLogPath}`
    ]
  };
}

async function buildMetaHarnessContext(input: {
  cwd: string;
  contextDir: string;
  runs: MetaHarnessRunSummary[];
  nodes: MetaHarnessNode[];
}): Promise<void> {
  await ensureDir(input.contextDir);
  await writeTaskFile(input.contextDir);

  for (const node of input.nodes) {
    const promptPath = path.join(input.cwd, "node-prompts", `${node}.md`);
    if (await fileExists(promptPath)) {
      await copyFileToContext(promptPath, path.join(input.contextDir, "node-prompts", `${node}.md`));
    }
  }

  const evalHistoryPath = path.join(input.cwd, "outputs", "eval-harness", "history.jsonl");
  if (await fileExists(evalHistoryPath)) {
    await copyFileToContext(evalHistoryPath, path.join(input.contextDir, "outputs", "eval-harness", "history.jsonl"));
  }

  for (const runSummary of input.runs) {
    const { run } = runSummary;
    const runRoot = buildWorkspaceRunRoot(input.cwd, run.id);
    const runContextDir = path.join(input.contextDir, "runs", run.id);
    await ensureDir(runContextDir);
    for (const node of input.nodes) {
      const filteredEvents = filterRunEventsByNode(
        readPersistedRunEvents({
          runsDir: path.join(input.cwd, ".autolabos", "runs"),
          runId: run.id,
          limit: 500
        }),
        node
      );
      await fs.writeFile(
        path.join(runContextDir, `${node}_events.jsonl`),
        filteredEvents.map((event) => JSON.stringify(event)).join("\n") + (filteredEvents.length > 0 ? "\n" : ""),
        "utf8"
      );

      const nodeArtifactPath = node === "analyze_results"
        ? path.join(runRoot, "result_analysis.json")
        : path.join(runRoot, "review", "decision.json");
      if (await fileExists(nodeArtifactPath)) {
        await copyFileToContext(nodeArtifactPath, path.join(runContextDir, path.basename(nodeArtifactPath)));
      }
    }

    const paperReadinessPath = path.join(runRoot, "paper", "paper_readiness.json");
    if (await fileExists(paperReadinessPath)) {
      await copyFileToContext(paperReadinessPath, path.join(runContextDir, "paper_readiness.json"));
    }
  }
}

async function writeTaskFile(contextDir: string): Promise<void> {
  const body = [
    "당신은 harness 엔지니어입니다. 위의 소스 코드, 실행 traces, 점수를 모두 읽으세요.",
    "paper_readiness.overall_score를 높일 수 있는 노드 프롬프트 파일의 개선안을 하나 제안하세요.",
    "반드시 다음 형식으로만 출력하세요:",
    "TARGET_FILE: node-prompts/<node>.md",
    "--- a/node-prompts/<node>.md",
    "+++ b/node-prompts/<node>.md",
    "@@ ... @@",
    "(unified diff 본문)",
    "TypeScript 소스(.ts 파일)는 절대 변경하지 마세요."
  ].join("\n");
  await fs.writeFile(path.join(contextDir, "TASK.md"), `${body}\n`, "utf8");
}

async function assembleContextPrompt(contextDir: string): Promise<string> {
  const files = await listFilesRecursively(contextDir);
  const contentBlocks: string[] = [];
  for (const filePath of files) {
    if (path.basename(filePath) === "TASK.md") {
      continue;
    }
    const relative = path.relative(contextDir, filePath).replace(/\\/g, "/");
    const content = await fs.readFile(filePath, "utf8");
    contentBlocks.push(`## FILE: ${relative}\n${content}`);
  }
  return contentBlocks.join("\n\n");
}

function filterRunEventsByNode(events: AutoLabOSEvent[], node: MetaHarnessNode): AutoLabOSEvent[] {
  return events.filter((event) => event.node === node);
}

async function selectRecentRuns(runtime: AutoLabOSRuntime, count: number): Promise<MetaHarnessRunSummary[]> {
  const runs = await runtime.runStore.listRuns();
  const selected = runs
    .filter((run) => run.status === "completed")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, count);
  return Promise.all(
    selected.map(async (run) => ({
      run,
      paperReadinessScore: await readPaperReadinessScore(runtime.paths.cwd, run.id)
    }))
  );
}

function createMetaHarnessLlm(runtime: AutoLabOSRuntime): LLMClient {
  const providers = runtime.config.providers;
  if (providers.llm_mode === "openai_api") {
    return new OpenAiResponsesLLMClient(runtime.openAiTextClient, {
      model: providers.openai.chat_model || providers.openai.model,
      reasoningEffort: providers.openai.chat_reasoning_effort || providers.openai.reasoning_effort
    });
  }
  if (providers.llm_mode === "ollama") {
    return new OllamaLLMClient(
      new OllamaClient(providers.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL),
      { model: providers.ollama?.chat_model || providers.ollama?.research_model }
    );
  }
  return new CodexLLMClient(runtime.codex, {
    model: providers.codex.chat_model || providers.codex.model,
    reasoningEffort: providers.codex.chat_reasoning_effort || providers.codex.reasoning_effort,
    fastMode: providers.codex.chat_fast_mode ?? providers.codex.fast_mode
  });
}

async function defaultCallLlm(
  client: LLMClient,
  input: { systemPrompt: string; userPrompt: string }
): Promise<string> {
  const completion = await client.complete(input.userPrompt, {
    systemPrompt: input.systemPrompt
  });
  return completion.text;
}

export function parseMetaHarnessResponse(
  raw: string
): { targetFile: string; diffText: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const targetMatch = normalized.match(/^TARGET_FILE:\s+(.+)$/m);
  const diffStart = normalized.indexOf("--- a/");
  if (!targetMatch || diffStart < 0) {
    return null;
  }
  const targetFile = targetMatch[1].trim();
  const diffText = normalized.slice(diffStart).trim();
  if (!targetFile.startsWith("node-prompts/")) {
    return null;
  }
  if (!diffText.includes("+++ b/")) {
    return null;
  }
  return { targetFile, diffText };
}

export function applyUnifiedDiff(originalContent: string, diffText: string): string {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n");
  const hunks: Array<{ oldStart: number; oldCount: number; lines: string[] }> = [];
  let index = 0;
  while (index < lines.length && !lines[index].startsWith("@@")) {
    index += 1;
  }
  while (index < lines.length) {
    const header = lines[index];
    const match = header.match(/^@@\s+\-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!match) {
      throw new Error("Invalid unified diff hunk header.");
    }
    const oldStart = Number(match[1]);
    const oldCount = Number(match[2] || "1");
    index += 1;
    const hunkLines: string[] = [];
    while (index < lines.length && !lines[index].startsWith("@@")) {
      hunkLines.push(lines[index]);
      index += 1;
    }
    hunks.push({ oldStart, oldCount, lines: hunkLines });
  }

  const sourceLines = originalContent.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let sourceIndex = 0;

  for (const hunk of hunks) {
    const targetIndex = Math.max(hunk.oldStart - 1, 0);
    while (sourceIndex < targetIndex) {
      output.push(sourceLines[sourceIndex]);
      sourceIndex += 1;
    }
    for (const line of hunk.lines) {
      if (line.startsWith(" ")) {
        output.push(line.slice(1));
        sourceIndex += 1;
      } else if (line.startsWith("-")) {
        sourceIndex += 1;
      } else if (line.startsWith("+")) {
        output.push(line.slice(1));
      } else if (line === "\\ No newline at end of file") {
        continue;
      } else {
        throw new Error("Invalid unified diff body line.");
      }
    }
  }

  while (sourceIndex < sourceLines.length) {
    output.push(sourceLines[sourceIndex]);
    sourceIndex += 1;
  }

  return output.join("\n");
}

function computeAveragePaperReadinessScore(runs: MetaHarnessRunSummary[]): number | null {
  const scores = runs
    .map((run) => run.paperReadinessScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) {
    return null;
  }
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100;
}

async function readPaperReadinessScore(cwd: string, runId: string): Promise<number | null> {
  const paperReadinessPath = path.join(buildWorkspaceRunRoot(cwd, runId), "paper", "paper_readiness.json");
  if (!(await fileExists(paperReadinessPath))) {
    return null;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(paperReadinessPath, "utf8")) as { overall_score?: unknown };
    return typeof parsed.overall_score === "number" && Number.isFinite(parsed.overall_score)
      ? parsed.overall_score
      : null;
  } catch {
    return null;
  }
}

async function copyFileToContext(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(nextPath)));
    } else if (entry.isFile()) {
      files.push(nextPath);
    }
  }
  return files.sort();
}

function formatTimestamp(now: Date): string {
  return now.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}
