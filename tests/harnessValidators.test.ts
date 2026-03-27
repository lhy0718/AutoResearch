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

    await writeFile(
      path.join(runDir, "events.jsonl"),
      `${JSON.stringify({
        type: "NODE_STARTED",
        runId: "run-pass",
        node: "run_experiments",
        timestamp: new Date().toISOString()
      })}\n`,
      "utf8"
    );
    await writeJson(path.join(runDir, "experiment_portfolio.json"), {
      version: 1,
      run_id: "run-pass",
      execution_model: "single_run",
      primary_trial_group_id: "primary",
      trial_groups: [{ id: "primary", label: "Primary run", role: "primary" }]
    });
    await writeJson(path.join(runDir, "run_manifest.json"), {
      version: 1,
      run_id: "run-pass",
      execution_model: "single_run",
      portfolio: {
        primary_trial_group_id: "primary"
      },
      trial_groups: [{ id: "primary", status: "pass" }]
    });
    await writeJson(path.join(runDir, "run_experiments_verify_report.json"), { status: "pass" });
    await writeJson(path.join(runDir, "metrics.json"), { accuracy: 0.92 });
    await writeJson(path.join(runDir, "objective_evaluation.json"), { status: "met" });
    await writeJson(path.join(runDir, "result_analysis.json"), { overview: { objective_status: "met" } });
    await writeJson(path.join(runDir, "transition_recommendation.json"), { action: "advance" });
    await writeJson(path.join(runDir, "review", "decision.json"), { outcome: "advance" });
    await writeJson(path.join(runDir, "review", "revision_plan.json"), { required_actions: [] });
    await writeJson(path.join(runDir, "review", "minimum_gate.json"), {
      passed: true,
      ceiling_type: "unrestricted"
    });
    await writeJson(path.join(runDir, "review", "paper_critique.json"), {
      stage: "pre_draft_review",
      manuscript_type: "paper_scale_candidate",
      paper_readiness_state: "paper_scale_candidate"
    });
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
    await writeJson(path.join(runDir, "paper", "claim_evidence_table.json"), {
      generated_at: new Date().toISOString(),
      claims: [
        {
          claim_id: "c1",
          section_heading: "Results",
          evidence_source_type: "experiment",
          artifact_refs: ["ev_1"],
          citation_refs: ["paper_1"],
          strength: "high"
        }
      ]
    });
    await writeJson(path.join(runDir, "paper", "verified_registry.json"), {
      generated_at: new Date().toISOString(),
      counts: {
        verified: 1,
        unverified: 0,
        blocked: 0,
        inferred: 0
      },
      blocked_citation_paper_ids: [],
      summary_lines: ["VerifiedRegistry citation statuses: verified=1, inferred=0, unverified=0, blocked=0."],
      entries: [
        {
          citation_paper_id: "paper_1",
          resolved_paper_id: "paper_1",
          title: "Paper 1",
          status: "verified",
          repaired: false,
          bibtex_mode: "stored",
          doi: "10.1000/test",
          notes: [],
          attempts: []
        }
      ]
    });
    await writeJson(path.join(runDir, "paper", "claim_status_table.json"), {
      generated_at: new Date().toISOString(),
      counts: {
        verified: 1,
        unverified: 0,
        blocked: 0,
        inferred: 0
      },
      claims: [
        {
          claim_id: "c1",
          section_heading: "Results",
          status: "verified",
          primary_source_present: true,
          run_artifact_present: true,
          reproduction_trace_present: true,
          artifact_refs: ["ev_1"],
          citation_refs: ["paper_1"],
          claim_ids_in_trace: ["c1"],
          notes: []
        }
      ]
    });
    await writeJson(path.join(runDir, "paper", "evidence_gate_decision.json"), {
      generated_at: new Date().toISOString(),
      status: "pass",
      blocking_issue_count: 0,
      warning_count: 0,
      issues: [],
      summary_lines: ["ok"]
    });
    await writeJson(path.join(runDir, "paper", "paper_readiness.json"), {
      generated_at: new Date().toISOString(),
      paper_ready: false,
      readiness_state: "paper_scale_candidate",
      evidence_gate_status: "pass",
      scientific_validation_status: "pass",
      submission_validation_ok: true
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
    expect(codes).toContain("review_minimum_gate_missing");
    expect(codes).toContain("review_paper_critique_missing");
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

  it("reports missing paper readiness and claim status artifacts when paper claims exist", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-paper-contract-");
    await mkdir(path.join(runDir, "paper"), { recursive: true });
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
      runId: "run-paper-contract-missing",
      runDir,
      nodeStates: makeNodeStates({
        write_paper: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("paper_claim_evidence_table_missing");
    expect(codes).toContain("paper_verified_registry_missing");
    expect(codes).toContain("paper_claim_status_table_missing");
    expect(codes).toContain("paper_evidence_gate_decision_missing");
    expect(codes).toContain("paper_readiness_missing");
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
    expect(codes).toContain("events_log_missing");
    expect(codes).toContain("experiment_portfolio_missing");
    expect(codes).toContain("run_manifest_missing");
    expect(codes).toContain("run_metrics_missing");
    expect(codes).toContain("analyze_results_objective_evaluation_missing");
    expect(codes).toContain("analyze_results_transition_missing");
  });

  it("reports missing trial-group metrics artifacts referenced by run_manifest.json", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-trial-group-metrics-");
    await writeJson(path.join(runDir, "experiment_portfolio.json"), {
      version: 1,
      run_id: "run-trial-group-metrics",
      execution_model: "managed_bundle",
      primary_trial_group_id: "primary_standard",
      trial_groups: [
        { id: "primary_standard", label: "Primary standard managed run", role: "primary" },
        {
          id: "primary_standard__hotpotqa_mini",
          label: "Primary standard managed run / hotpotqa_mini",
          role: "supplemental",
          group_kind: "matrix_slice",
          source_trial_group_id: "primary_standard"
        }
      ]
    });
    await writeJson(path.join(runDir, "run_manifest.json"), {
      version: 1,
      run_id: "run-trial-group-metrics",
      execution_model: "managed_bundle",
      portfolio: {
        primary_trial_group_id: "primary_standard"
      },
      trial_groups: [
        { id: "primary_standard", status: "pass" },
        {
          id: "primary_standard__hotpotqa_mini",
          status: "pass",
          metrics_path: ".autolabos/runs/run-trial-group-metrics/trial_group_metrics/primary_standard__hotpotqa_mini.json"
        }
      ]
    });
    await writeJson(path.join(runDir, "run_experiments_verify_report.json"), { status: "pass" });
    await writeJson(path.join(runDir, "metrics.json"), { accuracy: 0.92 });
    await writeJson(path.join(runDir, "objective_evaluation.json"), { status: "met" });

    const result = await validateRunArtifactStructure({
      runId: "run-trial-group-metrics",
      runDir,
      nodeStates: makeNodeStates({
        run_experiments: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("run_manifest_trial_group_metrics_missing");
  });

  it("reports malformed event logs and malformed collect background job records", async () => {
    const runDir = createTempRunDir("autolabos-harness-validator-events-");
    await writeFile(path.join(runDir, "events.jsonl"), '{"type":"NODE_STARTED"}\nnot-json\n', "utf8");
    await writeFile(path.join(runDir, "collect_background_job.json"), "[]\n", "utf8");

    const result = await validateRunArtifactStructure({
      runId: "run-events-bad",
      runDir,
      nodeStates: makeNodeStates({
        collect_papers: "completed"
      })
    });

    const codes = result.issues.map((item) => item.code);
    expect(codes).toContain("events_log_malformed");
    expect(codes).toContain("collect_background_job_malformed");
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

  it("reports duplicate LV identifiers", () => {
    const duplicateMarkdown = `
### LV-068 — First issue
- Status: FIXED
- Validation target: target one
- Environment/session context: test workspace
- Reproduction steps:
  1. do thing one
- Expected behavior: it works
- Actual behavior: it fails
- Fresh vs existing session comparison:
  - Fresh session: pass
  - Existing session: fail
- Root cause hypothesis: hypothesis one
- Code/test changes: change one
- Regression status: pass

### LV-068 — Second issue
- Status: FIX IMPLEMENTED, LIVE REVALIDATION PENDING
- Validation target: target two
- Environment/session context: test workspace
- Reproduction steps:
  1. do thing two
- Expected behavior: it works
- Actual behavior: it fails differently
- Fresh vs existing session comparison:
  - Fresh session: pass
  - Existing session: fail
- Root cause hypothesis: hypothesis two
- Code/test changes: change two
- Regression status: pending
`.trim();

    const result = validateLiveValidationIssueMarkdown(duplicateMarkdown, "ISSUES.md");

    expect(result.issueCount).toBe(2);
    expect(result.issues.some((item) => item.code === "issue_duplicate_identifier")).toBe(true);
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
