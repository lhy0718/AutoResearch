import { importGovernanceSeedBundle } from "../core/benchmark/governanceSeedBundle.js";
import {
  runGovernanceBenchmarkDryRun,
  type GovernanceBenchmarkDryRunInput
} from "../core/benchmark/governanceDryRun.js";

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

export async function runGovernanceBenchmarkDryRunCli(
  input: GovernanceBenchmarkDryRunInput
): Promise<void> {
  const report = await runGovernanceBenchmarkDryRun(input);
  process.stdout.write(
    [
      `Governance dry-run ${report.passed ? "passed" : "failed"}: ${report.task_id}`,
      `Output: ${report.output_dir}`,
      `Summary: ${report.summary_path}`,
      `README: ${report.readme_path}`,
      ...report.conditions.map((condition) =>
        `${condition.condition}: run=${condition.run_id}, contract=${condition.contract.passed ? "passed" : "failed"}, missing_baseline=${condition.missing_baseline_detected}`
      )
    ].join("\n") + "\n"
  );
}
