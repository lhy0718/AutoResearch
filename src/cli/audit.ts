import {
  runPaperReadinessAudit,
  type PaperReadinessAuditBlocker,
  type PaperReadinessAuditInput,
  type PaperReadinessAuditSummary
} from "../core/audit/paperReadinessAudit.js";

export async function runPaperReadinessAuditCli(input: PaperReadinessAuditInput): Promise<void> {
  const summary = await runPaperReadinessAudit(input);
  process.stdout.write(formatPaperReadinessAuditCliSummary(summary));
}

export function formatPaperReadinessAuditCliSummary(summary: PaperReadinessAuditSummary): string {
  const bySeverity = groupBlockersBySeverity(summary.top_blockers);
  const lines = [
    `Paper-readiness audit: ${summary.verdict}`,
    `Input: ${summary.input.mode}${summary.input.seed_id ? ` ${summary.input.seed_id}` : ""}`,
    `Run artifacts: ${summary.input.run_root}`,
    `Claim ceiling: ${summary.claim_ceiling.allowed_level}`,
    `Severity: ${bySeverity.blocker.length} blocker(s), ${bySeverity.warning.length} warning(s)`,
    `Unsupported claims: ${summary.unsupported_claims.length}`,
    `Baseline/comparator: ${summary.baseline_comparator_status.status}; comparative claims allowed=${yesNo(summary.baseline_comparator_status.comparative_claim_allowed)}`,
    `Result table: ${summary.result_table_completeness.complete_row_count}/${summary.result_table_completeness.row_count} complete row(s); paper-ready allowed=${yesNo(summary.result_table_completeness.paper_ready_allowed)}`,
    `Figure audit: ${summary.figure_result_caption_mismatch.status}; severe mismatches=${summary.figure_result_caption_mismatch.severe_mismatch_count}; manuscript promotion allowed=${yesNo(summary.figure_result_caption_mismatch.manuscript_promotion_allowed)}`,
    `Citation support issues: ${summary.citation_support_issues.length}`,
    `Design contract findings: ${summary.design_contract_findings.length}`,
    "Outputs:",
    `  report: ${summary.outputs.report_path}`,
    `  summary: ${summary.outputs.summary_path}`,
    `  blockers: ${summary.outputs.blockers_path}`,
    "Top blockers:"
  ];

  appendBlockerGroup(lines, "blocker", bySeverity.blocker);
  appendBlockerGroup(lines, "warning", bySeverity.warning);
  lines.push(
    "Next actions:",
    ...summary.next_action_checklist.map((action) => `  - [ ] ${action}`)
  );
  return `${lines.join("\n")}\n`;
}

function groupBlockersBySeverity(blockers: PaperReadinessAuditBlocker[]): {
  blocker: PaperReadinessAuditBlocker[];
  warning: PaperReadinessAuditBlocker[];
} {
  return {
    blocker: blockers.filter((blocker) => blocker.severity === "blocker"),
    warning: blockers.filter((blocker) => blocker.severity === "warning")
  };
}

function appendBlockerGroup(lines: string[], label: "blocker" | "warning", blockers: PaperReadinessAuditBlocker[]): void {
  lines.push(`  ${label}:`);
  if (blockers.length === 0) {
    lines.push("    - none");
    return;
  }
  for (const blocker of blockers) {
    lines.push(`    - ${blocker.code}: ${blocker.message}`);
  }
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}
