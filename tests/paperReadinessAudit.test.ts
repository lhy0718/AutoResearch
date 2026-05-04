import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

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

    const report = await readFile(path.join(workspace, "outputs", "audit", "paper-readiness-audit.md"), "utf8");
    expect(report).toContain("Verdict: blocked");
    expect(report).toContain("## Claim Ceiling");

    const blockers = JSON.parse(
      await readFile(path.join(workspace, "outputs", "audit", "blockers.json"), "utf8")
    ) as { blockers: Array<{ code: string }> };
    expect(blockers.blockers.map((blocker) => blocker.code)).toContain(expectedBlocker);
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
});
