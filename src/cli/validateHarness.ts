import path from "node:path";

import { runHarnessValidation } from "../core/validation/harnessValidationService.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const report = await runHarnessValidation({
    workspaceRoot: cwd,
    includeWorkspaceRuns: true,
    includeTestRunStores: true,
    maxFindings: 200
  });

  process.stdout.write(`[validate:harness] issue entries checked: ${report.issueEntryCount}\n`);
  process.stdout.write(`[validate:harness] run stores checked: ${report.runStoresChecked}\n`);
  process.stdout.write(`[validate:harness] runs checked: ${report.runsChecked}\n`);

  if (report.findings.length === 0) {
    process.stdout.write("[validate:harness] OK: no structural violations found.\n");
    return;
  }

  process.stderr.write(`[validate:harness] FAIL: ${report.findings.length} structural issue(s) found.\n`);
  for (const finding of report.findings) {
    const location = finding.filePath ? ` (${path.relative(cwd, finding.filePath)})` : "";
    const run = finding.runId ? ` [run:${finding.runId}]` : "";
    process.stderr.write(`- (${finding.kind}) ${finding.code}${run}: ${finding.message}${location}\n`);
    process.stderr.write(`  remediation: ${finding.remediation}\n`);
  }
  process.exitCode = 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  process.stderr.write(`[validate:harness] fatal error: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
