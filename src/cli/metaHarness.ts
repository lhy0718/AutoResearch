import { runMetaHarness, type MetaHarnessNode } from "../core/metaHarness/metaHarness.js";

export async function runMetaHarnessCli(input: {
  cwd: string;
  runs: number;
  nodes: MetaHarnessNode[];
  noApply?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  const result = await runMetaHarness({
    cwd: input.cwd,
    runs: input.runs,
    nodes: input.nodes,
    noApply: input.noApply,
    dryRun: input.dryRun
  });
  process.stdout.write(`${result.lines.join("\n")}\n`);
}
