import { runPaperReadinessAudit, type PaperReadinessAuditInput } from "../core/audit/paperReadinessAudit.js";

export async function runPaperReadinessAuditCli(input: PaperReadinessAuditInput): Promise<void> {
  const summary = await runPaperReadinessAudit(input);
  process.stdout.write(
    [
      `Paper-readiness audit verdict: ${summary.verdict}`,
      `Report: ${summary.outputs.report_path}`,
      `Summary: ${summary.outputs.summary_path}`,
      `Blockers: ${summary.outputs.blockers_path}`,
      `Top blockers: ${summary.top_blockers.length}`,
      `Claim ceiling: ${summary.claim_ceiling.allowed_level}`
    ].join("\n") + "\n"
  );
}
