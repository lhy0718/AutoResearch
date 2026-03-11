import { launchTerminalApp } from "./tui/TerminalApp.js";
import { bootstrapAutoLabOSRuntime } from "./runtime/createRuntime.js";
import { configExists, resolveAppPaths } from "./config.js";

export async function runAutoLabOSApp(): Promise<void> {
  const paths = resolveAppPaths(process.cwd());
  const firstRunSetup = !(await configExists(paths));
  if (firstRunSetup) {
    process.stdout.write("AutoLabOS setup wizard (first run)\n\n");
  }
  const bootstrap = await bootstrapAutoLabOSRuntime({
    cwd: process.cwd(),
    allowInteractiveSetup: true
  });
  if (!bootstrap.runtime || !bootstrap.config) {
    throw new Error("AutoLabOS runtime could not be initialized.");
  }

  if (bootstrap.firstRunSetup) {
    process.stdout.write("\nSetup completed.\n");
  }
  await launchTerminalApp({
    config: bootstrap.runtime.config,
    runStore: bootstrap.runtime.runStore,
    titleGenerator: bootstrap.runtime.titleGenerator,
    codex: bootstrap.runtime.codex,
    openAiTextClient: bootstrap.runtime.openAiTextClient,
    eventStream: bootstrap.runtime.eventStream,
    orchestrator: bootstrap.runtime.orchestrator,
    initialRunId: undefined,
    semanticScholarApiKeyConfigured: bootstrap.runtime.semanticScholarApiKeyConfigured,
    onQuit: () => {
      process.stdout.write("\nBye\n");
    },
    saveConfig: bootstrap.runtime.saveConfig
  });
}
