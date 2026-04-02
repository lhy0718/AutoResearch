import { runEvolveLoop } from "../core/evolution/evolveRun.js";

export async function runEvolveCli(input: {
  cwd: string;
  maxCycles: number;
  target: "skills" | "prompts" | "all";
  dryRun?: boolean;
}): Promise<void> {
  const report = await runEvolveLoop({
    cwd: input.cwd,
    maxCycles: input.maxCycles,
    target: input.target,
    dryRun: input.dryRun
  });
  process.stdout.write(`${report.lines.join("\n")}\n`);
}
