import { importGovernanceSeedBundle } from "../core/benchmark/governanceSeedBundle.js";

export interface RunGovernanceBenchmarkSeedCliInput {
  cwd: string;
  sourcePath: string;
  taskId?: string;
  outDir?: string;
  referenceOnly?: boolean;
}

export async function runGovernanceBenchmarkSeedCli(
  input: RunGovernanceBenchmarkSeedCliInput
): Promise<void> {
  const result = await importGovernanceSeedBundle({
    cwd: input.cwd,
    sourcePath: input.sourcePath,
    taskId: input.taskId,
    outDir: input.outDir,
    referenceOnly: input.referenceOnly
  });
  process.stdout.write(
    [
      `Governance seed ${result.manifest.mode === "reference" ? "referenced" : "imported"}: ${result.manifest.task_id}`,
      `Manifest: ${result.manifestPath}`,
      `Files: ${result.manifest.files.length}`,
      `Source SHA-256: ${result.manifest.source_sha256}`
    ].join("\n") + "\n"
  );
}
