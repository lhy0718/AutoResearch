import { askLine } from "./utils/prompt.js";
import { AppConfig } from "./types.js";
import { launchTerminalApp } from "./tui/TerminalApp.js";
import { bootstrapAutoresearchRuntime } from "./runtime/createRuntime.js";
import { RunStore } from "./core/runs/runStore.js";
import { TitleGenerator } from "./core/runs/titleGenerator.js";
import { configExists, resolveAppPaths } from "./config.js";

export async function runAutoresearchApp(): Promise<void> {
  const paths = resolveAppPaths(process.cwd());
  const firstRunSetup = !(await configExists(paths));
  if (firstRunSetup) {
    process.stdout.write("AutoResearch setup wizard (first run)\n\n");
  }
  const bootstrap = await bootstrapAutoresearchRuntime({
    cwd: process.cwd(),
    allowInteractiveSetup: true
  });
  if (!bootstrap.runtime || !bootstrap.config) {
    throw new Error("AutoResearch runtime could not be initialized.");
  }

  if (bootstrap.firstRunSetup) {
    process.stdout.write("\nSetup completed.\n");
  }

  const initialRunId = await maybeCreateInitialRun({
    firstRunSetup: bootstrap.firstRunSetup,
    runStore: bootstrap.runtime.runStore,
    titleGenerator: bootstrap.runtime.titleGenerator,
    config: bootstrap.config
  });

  await launchTerminalApp({
    config: bootstrap.runtime.config,
    runStore: bootstrap.runtime.runStore,
    titleGenerator: bootstrap.runtime.titleGenerator,
    codex: bootstrap.runtime.codex,
    openAiTextClient: bootstrap.runtime.openAiTextClient,
    eventStream: bootstrap.runtime.eventStream,
    orchestrator: bootstrap.runtime.orchestrator,
    initialRunId,
    semanticScholarApiKeyConfigured: bootstrap.runtime.semanticScholarApiKeyConfigured,
    onQuit: () => {
      process.stdout.write("\nBye\n");
    },
    saveConfig: bootstrap.runtime.saveConfig
  });
}

interface InitialRunArgs {
  firstRunSetup: boolean;
  runStore: RunStore;
  titleGenerator: TitleGenerator;
  config: AppConfig;
}

async function maybeCreateInitialRun(args: InitialRunArgs): Promise<string | undefined> {
  const runs = await args.runStore.listRuns();
  if (!args.firstRunSetup) {
    return undefined;
  }
  if (runs.length > 0) {
    return runs[0].id;
  }

  const answer = (await askLine("Create your first run now? (Y/n)", "Y")).trim().toLowerCase();
  if (["n", "no"].includes(answer)) {
    process.stdout.write("Skipping initial run creation.\n");
    process.stdout.write("Launching dashboard...\n");
    return undefined;
  }

  const topic = args.config.research.default_topic;
  const constraints = args.config.research.default_constraints;
  const objectiveMetric = args.config.research.default_objective_metric;

  process.stdout.write("Creating first run with current defaults...\n");
  const title = await args.titleGenerator.generateTitle(topic, constraints, objectiveMetric);
  const run = await args.runStore.createRun({
    title,
    topic,
    constraints,
    objectiveMetric
  });

  process.stdout.write(`First run created: ${run.id}\n`);
  process.stdout.write("Launching dashboard...\n");
  return run.id;
}
