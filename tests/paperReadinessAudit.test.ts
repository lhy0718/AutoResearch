import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { formatPaperReadinessAuditCliSummary } from "../src/cli/audit.js";
import { runPaperReadinessAudit } from "../src/core/audit/paperReadinessAudit.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("paper-readiness audit", () => {
  it.each([
    ["AGB-001", "baseline_or_comparator_missing", "descriptive_only_no_comparative_claims"],
    ["AGB-003", "baseline_or_comparator_missing", "descriptive_only_no_comparative_claims"],
    ["AGB-010", "fallback_only_evidence", "system_validation_note_only"]
  ])("blocks false paper-ready promotion for %s", async (seedId, expectedBlocker, expectedCeiling) => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-seed-"));
    tempDirs.push(workspace);

    const summary = await runPaperReadinessAudit({
      cwd: workspace,
      seedId,
      outDir: "outputs/audit"
    });

    expect(summary.verdict).toBe("blocked");
    expect(summary.paper_readiness.paper_ready).toBe(false);
    expect(summary.top_blockers.map((blocker) => blocker.code)).toContain(expectedBlocker);
    expect(summary.claim_ceiling.allowed_level).toBe(expectedCeiling);
    expect(summary.outputs.report_path).toBe("outputs/audit/paper-readiness-audit.md");
    expect(summary.outputs.claim_evidence_path).toBe("outputs/audit/claim-evidence-table.json");
    expect(summary.outputs.audit_timeline_path).toBe("outputs/audit/audit-timeline.json");
    expect(summary.outputs.claim_promotion_timeline_path).toBe("outputs/audit/claim-promotion-timeline.json");
    expect(summary.outputs.blocked_claim_events_path).toBe("outputs/audit/blocked-claim-events.json");
    expect(summary.outputs.done_condition_path).toBe("outputs/audit/done-condition-audit.json");
    expect(summary.outputs.autonomy_metrics_path).toBe("outputs/audit/autonomy-metrics.json");
    expect(summary.audit_timeline.status).toBe("available");
    expect(summary.done_condition.status).toBe("pass");
    expect(summary.judge_lane.judge_nodes).toContain("paper_readiness_audit");

    const report = await readFile(path.join(workspace, "outputs", "audit", "paper-readiness-audit.md"), "utf8");
    expect(report).toContain("Verdict: blocked");
    expect(report).toContain('<a id="verdict"></a>');
    expect(report).toContain('<a id="top-blockers"></a>');
    expect(report).toContain('<a id="unsupported-claims"></a>');
    expect(report).toContain('<a id="baseline-comparator-status"></a>');
    expect(report).toContain('<a id="result-table-completeness"></a>');
    expect(report).toContain('<a id="figure-result-caption-mismatch"></a>');
    expect(report).toContain('<a id="citation-support"></a>');
    expect(report).toContain('<a id="design-contract-findings"></a>');
    expect(report).toContain('<a id="literature-discovery-findings"></a>');
    expect(report).toContain('<a id="judge-lane"></a>');
    expect(report).toContain('<a id="audit-timeline"></a>');
    expect(report).toContain('<a id="done-condition"></a>');
    expect(report).toContain('<a id="autonomy-metrics"></a>');
    expect(report).toContain("## Claim Ceiling");
    expect(report).toContain('<a id="claim-ceiling"></a>');
    expect(report).toContain('<a id="next-actions"></a>');

    const cliOutput = formatPaperReadinessAuditCliSummary(summary);
    expect(cliOutput).toContain("Paper-readiness audit: blocked");
    expect(cliOutput).toContain("Severity:");
    expect(cliOutput).toContain("Top blockers:");
    expect(cliOutput).toContain("  blocker:");
    expect(cliOutput).toContain(`report: ${summary.outputs.report_path}`);
    expect(cliOutput).toContain(`claim evidence: ${summary.outputs.claim_evidence_path}`);

    const blockers = JSON.parse(
      await readFile(path.join(workspace, "outputs", "audit", "blockers.json"), "utf8")
    ) as { blockers: Array<{ code: string }> };
    expect(blockers.blockers.map((blocker) => blocker.code)).toContain(expectedBlocker);

    const claimEvidence = await readFile(path.join(workspace, "outputs", "audit", "claim-evidence-table.json"), "utf8");
    expect(claimEvidence).toContain("does not create evidence");

    const timeline = await readFile(path.join(workspace, "outputs", "audit", "audit-timeline.json"), "utf8");
    expect(timeline).toContain("paper_readiness_verdict");
    const claimPromotion = await readFile(path.join(workspace, "outputs", "audit", "claim-promotion-timeline.json"), "utf8");
    expect(claimPromotion).toContain("Claim promotion events are derived");
    const blockedClaimEvents = await readFile(path.join(workspace, "outputs", "audit", "blocked-claim-events.json"), "utf8");
    expect(blockedClaimEvents).toContain(expectedBlocker);
    const doneCondition = await readFile(path.join(workspace, "outputs", "audit", "done-condition-audit.json"), "utf8");
    expect(doneCondition).toContain("write_paper completion");
    const autonomyMetrics = await readFile(path.join(workspace, "outputs", "audit", "autonomy-metrics.json"), "utf8");
    expect(autonomyMetrics).toContain("evidence_integrity_score");
  });

  it("audits an existing run artifact root", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-run-"));
    tempDirs.push(workspace);
    const seedSummary = await runPaperReadinessAudit({
      cwd: workspace,
      seedId: "AGB-001",
      outDir: "outputs/seed-audit"
    });

    const summary = await runPaperReadinessAudit({
      cwd: workspace,
      runRoot: seedSummary.input.run_root,
      outDir: "outputs/run-audit"
    });

    expect(summary.input.mode).toBe("run");
    expect(summary.verdict).toBe("blocked");
    expect(summary.baseline_comparator_status.status).toBe("missing");
    expect(summary.result_table_completeness.paper_ready_allowed).toBe(false);
  });

  it("fails the done-condition audit when paper_ready hides known blockers", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-done-condition-"));
    tempDirs.push(workspace);
    const seedSummary = await runPaperReadinessAudit({
      cwd: workspace,
      seedId: "AGB-001",
      outDir: "outputs/seed-audit"
    });
    const runRoot = path.join(workspace, seedSummary.input.run_root);
    await writeFile(
      path.join(runRoot, "paper", "paper_readiness.json"),
      JSON.stringify({ paper_ready: true, readiness_state: "paper_ready" }),
      "utf8"
    );
    await writeFile(
      path.join(runRoot, "run_record.json"),
      JSON.stringify({ id: "AGB-001-gated-audit", status: "failed" }),
      "utf8"
    );

    const summary = await runPaperReadinessAudit({
      cwd: workspace,
      runRoot: seedSummary.input.run_root,
      outDir: "outputs/done-condition-audit"
    });

    expect(summary.done_condition.status).toBe("fail");
    expect(summary.done_condition.failure_count).toBeGreaterThan(0);
    expect(summary.top_blockers.map((blocker) => blocker.code)).toContain("hidden_failed_run");
    const doneCondition = await readFile(
      path.join(workspace, "outputs", "done-condition-audit", "done-condition-audit.json"),
      "utf8"
    );
    expect(doneCondition).toContain("Paper-ready comparative claims require baseline/comparator evidence");
  });

  it("uses only run-artifact evidence for selected P2 design contract audit findings", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-design-contract-"));
    tempDirs.push(workspace);
    const seedSummary = await runPaperReadinessAudit({
      cwd: workspace,
      seedId: "AGB-003",
      outDir: "outputs/seed-audit"
    });
    const runRoot = path.join(workspace, seedSummary.input.run_root);
    await mkdir(path.join(runRoot, "audit"), { recursive: true });
    await writeFile(
      path.join(runRoot, "audit", "design_contracts.json"),
      JSON.stringify({
        findings: [
          {
            code: "advisory_design_note",
            severity: "blocker",
            message: "This design note is advisory only.",
            advisory_only: true
          }
        ],
        hidden_failed_worker_count: 2,
        failed_worker_visibility: "hidden",
        reverse_from_data_origin: true,
        exploratory_origin_visible: false,
        sota_ranking_claimed: true,
        sota_evidence_present: false
      }),
      "utf8"
    );

    const summary = await runPaperReadinessAudit({
      cwd: workspace,
      runRoot: seedSummary.input.run_root,
      outDir: "outputs/design-contract-audit"
    });

    expect(summary.design_contract_findings.map((finding) => finding.code)).toEqual([
      "distributed_worker_failure_hidden",
      "reverse_from_data_origin_hidden",
      "unsupported_sota_ranking"
    ]);
    expect(summary.top_blockers.map((blocker) => blocker.code)).toContain("distributed_worker_failure_hidden");
    expect(summary.top_blockers.map((blocker) => blocker.code)).not.toContain("advisory_design_note");

    const report = await readFile(
      path.join(workspace, "outputs", "design-contract-audit", "paper-readiness-audit.md"),
      "utf8"
    );
    expect(report).toContain('<a id="design-contract-findings"></a>');
    expect(report).toContain("distributed_worker_failure_hidden");
  });
});
