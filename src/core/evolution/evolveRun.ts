import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { bootstrapAutoLabOSRuntime, type AutoLabOSRuntime } from "../../runtime/createRuntime.js";
import { InteractionSession } from "../../interaction/InteractionSession.js";
import { InteractiveRunSupervisor } from "../runs/interactiveRunSupervisor.js";
import { findLatestResearchBrief, validateResearchBriefFile } from "../runs/researchBriefFiles.js";
import { buildWorkspaceRunRoot } from "../runs/runPaths.js";
import { buildSelfCritiqueRetryPromptVariant } from "../nodePrompts.js";

const execFile = promisify(execFileCallback);

export type EvolveTarget = "skills" | "prompts" | "all";
export type MutationStrategy = "none" | "prompts" | "skills" | "both";
export type EvolveCycleStatus = "IMPROVED" | "REGRESSED" | "UNCHANGED" | "DRY_RUN";

export interface EvolveCycleRow {
  cycle: number;
  fitness: number;
  delta: number | null;
  mutation_target: MutationStrategy;
  status: EvolveCycleStatus;
}

export interface EvolveCycleObservation {
  runId: string;
  fitnessScore: number;
  runStatus: "completed" | "failed" | "paused";
  currentNode?: string;
  episodePath?: string;
}

export interface EvolveRunReport {
  rows: EvolveCycleRow[];
  lines: string[];
}

export interface EvolveRunOptions {
  cwd: string;
  maxCycles: number;
  target: EvolveTarget;
  dryRun?: boolean;
}

interface EvolveRunDeps {
  bootstrapRuntime: typeof bootstrapAutoLabOSRuntime;
  executeCycle: (input: { cwd: string; runtime: AutoLabOSRuntime }) => Promise<EvolveCycleObservation>;
  createGitTag: (cwd: string, tagName: string) => Promise<void>;
  restoreMutationTargets: (cwd: string, tagName: string) => Promise<void>;
  runValidateHarness: (cwd: string) => Promise<void>;
  mutatePrompts: (cwd: string, cycle: number) => Promise<string[]>;
  mutateSkills: (cwd: string, cycle: number, episodePath?: string) => Promise<string[]>;
}

export async function runEvolveLoop(
  options: EvolveRunOptions,
  deps: Partial<EvolveRunDeps> = {}
): Promise<EvolveRunReport> {
  const strategies = resolveStrategies(options.target);
  const rows: EvolveCycleRow[] = [];
  if (options.dryRun) {
    rows.push({
      cycle: 1,
      fitness: 0,
      delta: null,
      mutation_target: "none",
      status: "DRY_RUN"
    });
    return {
      rows,
      lines: renderEvolveCycleTable(rows, {
        dryRunNotice: `Dry run: would execute up to ${options.maxCycles} cycle(s) using ${strategies.join(" -> ")}.`
      })
    };
  }

  const resolvedDeps: EvolveRunDeps = {
    bootstrapRuntime: bootstrapAutoLabOSRuntime,
    executeCycle: executeFreshRunCycle,
    createGitTag: createGitTag,
    restoreMutationTargets: restoreMutationTargets,
    runValidateHarness: runValidateHarness,
    mutatePrompts: mutatePromptFiles,
    mutateSkills: mutateSkillFiles,
    ...deps
  };

  const bootstrap = await resolvedDeps.bootstrapRuntime({
    cwd: options.cwd,
    allowInteractiveSetup: true
  });
  if (!bootstrap.runtime) {
    throw new Error("AutoLabOS runtime could not be initialized for evolve mode.");
  }

  let previousFitness: number | null = null;
  let lastGoodTag: string | undefined;
  let mutationForCurrentCycle: MutationStrategy = "none";
  let nextStrategyIndex = 0;

  for (let cycle = 1; cycle <= options.maxCycles; cycle += 1) {
    const observation = await resolvedDeps.executeCycle({
      cwd: options.cwd,
      runtime: bootstrap.runtime
    });

    const delta = previousFitness == null ? null : roundToHundredths(observation.fitnessScore - previousFitness);
    const improved = previousFitness == null || observation.fitnessScore > previousFitness;
    const regressed = previousFitness != null && observation.fitnessScore < previousFitness;
    const status: EvolveCycleStatus = improved ? "IMPROVED" : regressed ? "REGRESSED" : "UNCHANGED";
    const row: EvolveCycleRow = {
      cycle,
      fitness: observation.fitnessScore,
      delta,
      mutation_target: mutationForCurrentCycle,
      status
    };
    rows.push(row);

    if (improved) {
      const tagName = `evo-${cycle}`;
      await resolvedDeps.createGitTag(options.cwd, tagName);
      lastGoodTag = tagName;
    } else if (regressed && lastGoodTag) {
      await resolvedDeps.restoreMutationTargets(options.cwd, lastGoodTag);
    }

    previousFitness = observation.fitnessScore;

    if (cycle >= options.maxCycles) {
      break;
    }

    const prepared = await prepareNextMutation({
      cwd: options.cwd,
      strategies,
      startIndex: nextStrategyIndex,
      cycle: cycle + 1,
      lastGoodTag,
      episodePath: observation.episodePath,
      mutatePrompts: resolvedDeps.mutatePrompts,
      mutateSkills: resolvedDeps.mutateSkills,
      runValidateHarness: resolvedDeps.runValidateHarness,
      restoreMutationTargets: resolvedDeps.restoreMutationTargets
    });
    mutationForCurrentCycle = prepared.strategy;
    nextStrategyIndex = prepared.nextStrategyIndex;
  }

  return {
    rows,
    lines: renderEvolveCycleTable(rows)
  };
}

async function prepareNextMutation(input: {
  cwd: string;
  strategies: MutationStrategy[];
  startIndex: number;
  cycle: number;
  lastGoodTag?: string;
  episodePath?: string;
  mutatePrompts: EvolveRunDeps["mutatePrompts"];
  mutateSkills: EvolveRunDeps["mutateSkills"];
  runValidateHarness: EvolveRunDeps["runValidateHarness"];
  restoreMutationTargets: EvolveRunDeps["restoreMutationTargets"];
}): Promise<{ strategy: MutationStrategy; nextStrategyIndex: number }> {
  if (input.strategies.length === 0) {
    return {
      strategy: "none",
      nextStrategyIndex: input.startIndex
    };
  }

  for (let attempt = 0; attempt < input.strategies.length; attempt += 1) {
    const strategy = input.strategies[(input.startIndex + attempt) % input.strategies.length];
    await applyMutationStrategy({
      cwd: input.cwd,
      cycle: input.cycle,
      strategy,
      episodePath: input.episodePath,
      mutatePrompts: input.mutatePrompts,
      mutateSkills: input.mutateSkills
    });
    try {
      await input.runValidateHarness(input.cwd);
      return {
        strategy,
        nextStrategyIndex: input.startIndex + attempt + 1
      };
    } catch (error) {
      if (input.lastGoodTag) {
        await input.restoreMutationTargets(input.cwd, input.lastGoodTag);
      }
      if (attempt === input.strategies.length - 1) {
        throw error;
      }
    }
  }

  return {
    strategy: "none",
    nextStrategyIndex: input.startIndex
  };
}

async function applyMutationStrategy(input: {
  cwd: string;
  cycle: number;
  strategy: MutationStrategy;
  episodePath?: string;
  mutatePrompts: EvolveRunDeps["mutatePrompts"];
  mutateSkills: EvolveRunDeps["mutateSkills"];
}): Promise<void> {
  if (input.strategy === "prompts" || input.strategy === "both") {
    await input.mutatePrompts(input.cwd, input.cycle);
  }
  if (input.strategy === "skills" || input.strategy === "both") {
    await input.mutateSkills(input.cwd, input.cycle, input.episodePath);
  }
}

function resolveStrategies(target: EvolveTarget): MutationStrategy[] {
  if (target === "prompts") {
    return ["prompts"];
  }
  if (target === "skills") {
    return ["skills"];
  }
  return ["prompts", "skills", "both"];
}

export function renderEvolveCycleTable(
  rows: EvolveCycleRow[],
  options?: { dryRunNotice?: string }
): string[] {
  const lines: string[] = [];
  if (options?.dryRunNotice) {
    lines.push(options.dryRunNotice);
  }
  lines.push(
    [
      padRight("CYCLE", 5),
      padLeft("FITNESS", 7),
      padLeft("DELTA", 7),
      padRight("MUTATION_TARGET", 16),
      padRight("STATUS", 10)
    ].join(" ")
  );
  for (const row of rows) {
    lines.push(
      [
        padRight(String(row.cycle), 5),
        padLeft(row.fitness.toFixed(2), 7),
        padLeft(row.delta == null ? "n/a" : formatSignedDelta(row.delta), 7),
        padRight(row.mutation_target, 16),
        padRight(row.status, 10)
      ].join(" ")
    );
  }
  return lines;
}

export async function executeFreshRunCycle(input: {
  cwd: string;
  runtime: AutoLabOSRuntime;
}): Promise<EvolveCycleObservation> {
  const briefPath = await findLatestResearchBrief(input.cwd);
  if (!briefPath) {
    throw new Error("No research brief file was found. Create Brief.md before running autolabos evolve.");
  }
  const validation = await validateResearchBriefFile(briefPath);
  if (validation.errors.length > 0) {
    throw new Error(`The latest brief is not ready to run: ${validation.errors.join("; ")}`);
  }

  const brief = await fs.readFile(briefPath, "utf8");
  const session = new InteractionSession({
    workspaceRoot: input.cwd,
    config: input.runtime.config,
    executionProfile: input.runtime.executionProfile,
    runStore: input.runtime.runStore,
    titleGenerator: input.runtime.titleGenerator,
    codex: input.runtime.codex,
    openAiTextClient: input.runtime.openAiTextClient,
    eventStream: input.runtime.eventStream,
    orchestrator: input.runtime.orchestrator,
    semanticScholarApiKeyConfigured: input.runtime.semanticScholarApiKeyConfigured
  });
  const run = await session.createRunFromBrief({
    brief,
    sourcePath: briefPath,
    autoStart: false
  });
  const supervisor = new InteractiveRunSupervisor(input.cwd, input.runtime.runStore, input.runtime.orchestrator);
  const outcome = await supervisor.runUntilStop(run.id);
  const finalRun = (await input.runtime.runStore.getRun(run.id)) || outcome.run;
  const fitnessScore = await readPaperReadinessFitness(input.cwd, finalRun.id);
  return {
    runId: finalRun.id,
    fitnessScore,
    runStatus: normalizeOutcomeStatus(outcome.status),
    currentNode: finalRun.currentNode,
    episodePath: path.join(input.cwd, finalRun.memoryRefs.episodePath)
  };
}

function normalizeOutcomeStatus(
  status: "awaiting_human" | "paused" | "completed" | "failed"
): "completed" | "failed" | "paused" {
  if (status === "awaiting_human" || status === "paused") {
    return "paused";
  }
  return status;
}

export async function readPaperReadinessFitness(cwd: string, runId: string): Promise<number> {
  const readinessPath = path.join(buildWorkspaceRunRoot(cwd, runId), "paper", "paper_readiness.json");
  try {
    const raw = JSON.parse(await fs.readFile(readinessPath, "utf8")) as { overall_score?: unknown };
    const score = typeof raw.overall_score === "number" ? raw.overall_score : 0;
    return Number.isFinite(score) ? score : 0;
  } catch {
    return 0;
  }
}

export async function createGitTag(cwd: string, tagName: string): Promise<void> {
  await execFile("git", ["tag", "-f", tagName], { cwd });
}

export async function restoreMutationTargets(cwd: string, tagName: string): Promise<void> {
  await execFile("git", ["restore", "--source", tagName, "--worktree", "--", ".codex", "node-prompts"], {
    cwd
  });
}

export async function runValidateHarness(cwd: string): Promise<void> {
  await execFile("npm", ["run", "validate:harness"], { cwd });
}

export async function mutatePromptFiles(cwd: string, cycle: number): Promise<string[]> {
  const promptFiles = [
    "node-prompts/generate_hypotheses.md",
    "node-prompts/design_experiments.md",
    "node-prompts/analyze_results.md"
  ];
  const touched: string[] = [];
  for (const relativePath of promptFiles) {
    const fullPath = path.join(cwd, relativePath);
    let current = "";
    try {
      current = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const mutated = appendEvolutionSentence(
      current,
      `Evolution cycle ${cycle}: self-critique the first draft for baseline coverage, evidence grounding, and paper-scale adequacy before returning the final answer.`
    );
    await fs.writeFile(fullPath, mutated, "utf8");
    touched.push(relativePath);
  }
  return touched;
}

export async function mutateSkillFiles(cwd: string, cycle: number, episodePath?: string): Promise<string[]> {
  const skillFiles = [
    ".codex/skills/paper-build-output-hygiene/SKILL.md",
    ".codex/skills/paper-scale-research-loop/SKILL.md",
    ".codex/skills/tui-state-validation/SKILL.md",
    ".codex/skills/tui-validation-loop-automation/SKILL.md"
  ];
  const lesson = (await readLatestLessonLearned(episodePath))
    || `Evolution cycle ${cycle}: prefer the smallest auditable change that raises paper-readiness without weakening the governed review gate.`;
  const touched: string[] = [];
  for (const relativePath of skillFiles) {
    const fullPath = path.join(cwd, relativePath);
    let current = "";
    try {
      current = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const mutated = appendLessonBullet(current, lesson);
    await fs.writeFile(fullPath, mutated, "utf8");
    touched.push(relativePath);
  }
  return touched;
}

async function readLatestLessonLearned(episodePath?: string): Promise<string | undefined> {
  if (!episodePath) {
    return undefined;
  }
  try {
    const raw = await fs.readFile(episodePath, "utf8");
    const records = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as { lesson?: string };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { lesson?: string } => Boolean(entry));
    const latest = [...records].reverse().find((entry) => typeof entry.lesson === "string" && entry.lesson.trim().length > 0);
    return latest?.lesson?.trim();
  } catch {
    return undefined;
  }
}

function appendEvolutionSentence(original: string, sentence: string): string {
  const trimmed = original.trimEnd();
  const variant = buildSelfCritiqueRetryPromptVariant(trimmed);
  const needsSentence = !variant.includes(sentence);
  return `${trimmed}\n${needsSentence ? `${sentence}\n` : ""}`;
}

function appendLessonBullet(original: string, lesson: string): string {
  const trimmed = original.trimEnd();
  if (trimmed.includes(lesson)) {
    return `${trimmed}\n`;
  }
  const heading = "## Evolution Notes";
  if (trimmed.includes(heading)) {
    return `${trimmed}\n- ${lesson}\n`;
  }
  return `${trimmed}\n\n${heading}\n- ${lesson}\n`;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : `${" ".repeat(width - value.length)}${value}`;
}

function formatSignedDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}
