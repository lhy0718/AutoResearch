import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { GraphNodeId, NodeStatus } from "../src/types.js";
import {
  validateLiveValidationIssueMarkdown,
  validateRunArtifactStructure
} from "../src/core/validation/harnessValidators.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("harness validators", () => {
  it("accepts a structurally complete run bundle", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-pass-");
    await mkdir(path.join(runDir, "review"), { recursive: true });
    await mkdir(path.join(runDir, "paper"), { recursive: true });

    await writeJson(path.join(runDir, "run_experiments_verify_report.json"), { status: "pass" });
    await writeJson(path.join(runDir, "metrics.json"), { accuracy: 0.92 });
    await writeJson(path.join(runDir, "objective_evaluation.json"), { status: "met" });
    await writeJson(path.join(runDir, "result_analysis.json"), { overview: { objective_status: "met" } });
    await writeJson(path.join(runDir, "transition_recommendation.json"), { action: "advance" });
    await writeJson(path.join(runDir, "review", "decision.json"), { outcome: "advance" });
    await writeJson(path.join(runDir, "review", "revision_plan.json"), { required_actions: [] });
    await writeJson(path.join(runDir, "review", "review_packet.json"), {
      readiness: { status: "ready" },
      checks: [{ id: "c1", status: "ready" }],
      suggested_actions: ["/agent run write_paper"],
      objective_status: "met",
      objective_summary: "Objective met.",
      decision: { outcome: "advance" }
    });
    await writeFile(path.join(runDir, "paper", "main.tex"), "\\section{Results}\n", "utf8");
    await writeFile(path.join(runDir, "paper", "references.bib"), "@article{key, title={A}}\n", "utf8");
    await writeJson(path.join(runDir, "paper", "evidence_links.json"), {
      claims: [
        {
          claim_id: "c1",
          statement: "The method improved accuracy.",
          evidence_ids: ["ev_1"],
          citation_paper_ids: ["paper_1"]
        }
      ]
    });

    const result = await validateRunArtifactStructure({
      runId: "run-pass",
      runDir,
      nodeStates: makeNodeStates({
        run_experiments: "completed",
        analyze_results: "completed",
        review: "completed",
        write_paper: "completed"
      })
    });

    expect(result.issues).toEqual([]);
  });

  it("reports missing review decision and revision artifacts when review is completed", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-review-");
    await mkdir(path.join(runDir, "review"), { recursive: true });
    await writeJson(path.join(runDir, "review", "review_packet.json"), {
      readiness: { status: "warning" },
      checks: [{ id: "c1", status: "warning" }],
      suggested_actions: ["/agent review"],
      objective_status: "unknown",
      objective_summary: "Needs review.",
      decision: { outcome: "revise_in_place" }
    });

    const result = await validateRunArtifactStructure({
      runId: "run-review-missing",
      runDir,
      nodeStates: makeNodeStates({
        review: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("review_decision_missing");
    expect(codes).toContain("review_revision_plan_missing");
  });

  it("reports placeholder evidence mappings in paper evidence links", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-paper-");
    await mkdir(path.join(runDir, "paper"), { recursive: true });
    await writeFile(path.join(runDir, "paper", "main.tex"), "\\section{Results}\n", "utf8");
    await writeFile(path.join(runDir, "paper", "references.bib"), "@article{key, title={A}}\n", "utf8");
    await writeJson(path.join(runDir, "paper", "evidence_links.json"), {
      claims: [
        {
          claim_id: "todo",
          statement: "TBD",
          evidence_ids: ["TODO"],
          citation_paper_ids: []
        }
      ]
    });

    const result = await validateRunArtifactStructure({
      runId: "run-paper-placeholder",
      runDir,
      nodeStates: makeNodeStates({
        write_paper: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("paper_claim_id_placeholder");
    expect(codes).toContain("paper_claim_statement_placeholder");
    expect(codes).toContain("paper_claim_linkage_placeholder");
  });

  it("reports missing metrics/objective artifacts when later nodes are marked completed", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-run-");
    await writeJson(path.join(runDir, "run_experiments_verify_report.json"), { status: "pass" });
    await writeJson(path.join(runDir, "result_analysis.json"), { overview: { objective_status: "unknown" } });

    const result = await validateRunArtifactStructure({
      runId: "run-missing-artifacts",
      runDir,
      nodeStates: makeNodeStates({
        run_experiments: "completed",
        analyze_results: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("run_metrics_missing");
    expect(codes).toContain("analyze_results_objective_evaluation_missing");
    expect(codes).toContain("analyze_results_transition_missing");
  });

  it("reports missing source artifact paths in paper evidence links", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-linkage-");
    await mkdir(path.join(runDir, "paper"), { recursive: true });
    await writeFile(path.join(runDir, "paper", "main.tex"), "\\section{Results}\n", "utf8");
    await writeFile(path.join(runDir, "paper", "references.bib"), "@article{key, title={A}}\n", "utf8");
    await writeJson(path.join(runDir, "paper", "evidence_links.json"), {
      claims: [
        {
          claim_id: "c1",
          statement: "Claim with stale links.",
          evidence_ids: ["artifacts/missing.json"],
          citation_paper_ids: ["paper_kept"],
          source_artifacts: ["paper/not-found.json"]
        }
      ]
    });

    const result = await validateRunArtifactStructure({
      runId: "run-link-missing",
      runDir,
      nodeStates: makeNodeStates({
        write_paper: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("paper_claim_source_path_missing");
  });

  it("flags review and final artifact status mismatches", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-review-consistency-");
    await mkdir(path.join(runDir, "review"), { recursive: true });
    await mkdir(path.join(runDir, "paper"), { recursive: true });
    await writeJson(path.join(runDir, "review", "decision.json"), { outcome: "revise_in_place" });
    await writeFile(path.join(runDir, "paper", "main.tex"), "\\section{Results}\\naccuracy improved by 3.1%.", "utf8");
    await writeFile(path.join(runDir, "paper", "references.bib"), "@article{key, title={A}}", "utf8");
    await writeJson(path.join(runDir, "paper", "evidence_links.json"), {
      claims: [
        {
          claim_id: "c1",
          statement: "Accuracy improved.",
          evidence_ids: ["ev_1"],
          citation_paper_ids: []
        }
      ]
    });

    const result = await validateRunArtifactStructure({
      runId: "run-review-mismatch",
      runDir,
      runStatus: "completed",
      nodeStates: makeNodeStates({
        write_paper: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).not.toContain("review_requires_revision_but_run_completed");
    expect(codes).toContain("paper_result_artifacts_missing_for_claims");
  });

  it("validates required live-validation issue fields", () => {
    const validMarkdown = `
## Issue: LV-OK
- Status: open
- Validation target: /new -> /brief start
- Environment/session context: test workspace
- Reproduction steps:
  1. step one
  2. step two
- Expected behavior: expected
- Actual behavior: actual
- Fresh vs existing session comparison:
  - Fresh session: pass
  - Existing session: fail
  - Divergence: yes
- Root cause hypothesis: guess
- Code/test changes: none yet
- Regression status: pending
- Follow-up risks: low
`.trim();
    const invalidMarkdown = `
## Issue: LV-BROKEN
- Status: open
- Validation target: target
- Reproduction steps:
  - unnumbered
- Expected behavior: expected
- Actual behavior: actual
`.trim();

    const valid = validateLiveValidationIssueMarkdown(validMarkdown, "ISSUES.md");
    const invalid = validateLiveValidationIssueMarkdown(invalidMarkdown, "ISSUES.md");

    expect(valid.issueCount).toBe(1);
    expect(valid.issues).toEqual([]);
    expect(invalid.issueCount).toBe(1);
    expect(invalid.issues.length).toBeGreaterThan(0);
    expect(invalid.issues.some((item) => item.code === "issue_field_missing")).toBe(true);
  });

  it("parses LV-XXX heading format and accepts alternate field names", () => {
    const lvMarkdown = `
### LV-062 — Fresh runs can hang in analyze_papers
- Status: FIXED
- Validation target: fresh test run
- Environment: test workspace
- Reproduction:
  1. start fresh run
  2. observe hang
- Expected behavior: should time out
- Actual behavior: hangs indefinitely
- Fresh vs existing: reproduced on fresh run
- Root-cause hypothesis: unbounded timeouts
- Code/test changes: bounded timeouts added
- Regression status: VALIDATED
- Follow-up risks: none identified
`.trim();

    const result = validateLiveValidationIssueMarkdown(lvMarkdown, "ISSUES.md");

    expect(result.issueCount).toBe(1);
    expect(result.issues).toEqual([]);
  });
});

function createTempRunDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeNodeStates(
  overrides: Partial<Record<GraphNodeId, NodeStatus>>
): Partial<Record<GraphNodeId, { status: NodeStatus }>> {
  return Object.fromEntries(
    (Object.keys(overrides) as GraphNodeId[]).map((node) => [node, { status: overrides[node] as NodeStatus }])
  ) as Partial<Record<GraphNodeId, { status: NodeStatus }>>;
}
