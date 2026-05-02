import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { validateGovernanceArtifactContract } from "../src/core/benchmark/governanceArtifactContract.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("governanceArtifactContract", () => {
  it("passes when gated benchmark artifacts are present and traceable", async () => {
    const runDir = await makeRunDir("run-artifact-contract-pass");
    await seedGatedArtifacts(runDir, { paperReady: false });
    const manifestPath = path.join(path.dirname(runDir), "manifest.json");
    await writeJson(manifestPath, {
      run_id: path.basename(runDir),
      provenance: { run_id: path.basename(runDir), node: "write_paper" }
    });

    const report = await validateGovernanceArtifactContract({
      runDir,
      condition: "gated",
      publicManifestPath: manifestPath
    });

    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.required_artifacts).toContain("figure_audit/figure_audit_summary.json");
    expect(report.required_artifacts).toContain("review/paper_critique.json");
    expect(report.required_artifacts).toContain("paper/paper_readiness.json");
  });

  it("does not accept paper_ready=true when evidence artifacts are missing", async () => {
    const runDir = await makeRunDir("run-artifact-contract-paper-ready");
    await writeJson(path.join(runDir, "governance_condition.json"), { name: "gated" });
    await mkdir(path.join(runDir, "paper"), { recursive: true });
    await writeFile(path.join(runDir, "paper", "main.tex"), "\\section{Results}\n", "utf8");
    await writeJson(path.join(runDir, "paper", "paper_readiness.json"), {
      paper_ready: true,
      readiness_state: "paper_ready"
    });

    const report = await validateGovernanceArtifactContract({ runDir, condition: "gated" });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("paper_ready_without_evidence_artifact");
    expect(report.issues.map((issue) => issue.file_path)).toContain("result_table.json");
  });

  it("does not require figure audit artifacts for the no_figure_audit ablation", async () => {
    const runDir = await makeRunDir("run-artifact-contract-no-figure");
    await seedGatedArtifacts(runDir, { paperReady: false, omitFigureAudit: true });

    const report = await validateGovernanceArtifactContract({
      runDir,
      condition: "no_figure_audit"
    });

    expect(report.required_artifacts).not.toContain("figure_audit/figure_audit_summary.json");
    expect(report.issues.map((issue) => issue.file_path)).not.toContain("figure_audit/figure_audit_summary.json");
  });

  it("reports public manifest trace mismatches", async () => {
    const runDir = await makeRunDir("run-artifact-contract-manifest");
    await seedGatedArtifacts(runDir, { paperReady: false });
    const manifestPath = path.join(path.dirname(runDir), "manifest.json");
    await writeJson(manifestPath, {
      run_id: "other-run",
      provenance: { run_id: "other-run", node: "write_paper" }
    });

    const report = await validateGovernanceArtifactContract({
      runDir,
      condition: "gated",
      publicManifestPath: manifestPath
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("public_manifest_run_trace_mismatch");
  });
});

async function makeRunDir(runId: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "autolabos-governance-artifacts-"));
  tempDirs.push(root);
  const runDir = path.join(root, runId);
  await mkdir(runDir, { recursive: true });
  return runDir;
}

async function seedGatedArtifacts(
  runDir: string,
  options: { paperReady: boolean; omitFigureAudit?: boolean }
): Promise<void> {
  await writeJson(path.join(runDir, "governance_condition.json"), { name: "gated" });
  await writeJson(path.join(runDir, "result_table.json"), { rows: [{ metric: "accuracy" }] });
  await writeFile(path.join(runDir, "evidence_store.jsonl"), "{\"id\":\"ev1\"}\n", "utf8");
  if (!options.omitFigureAudit) {
    await writeJson(path.join(runDir, "figure_audit", "figure_audit_summary.json"), {
      severe_mismatch_count: 0,
      review_block_required: false
    });
  }
  await writeJson(path.join(runDir, "review", "paper_critique.json"), {
    paper_readiness_state: "paper_scale_candidate"
  });
  await writeJson(path.join(runDir, "review", "decision.json"), { outcome: "advance" });
  await mkdir(path.join(runDir, "paper"), { recursive: true });
  await writeFile(path.join(runDir, "paper", "main.tex"), "\\section{Results}\n", "utf8");
  await writeJson(path.join(runDir, "paper", "evidence_links.json"), {
    claims: [{ claim_id: "c1", evidence_ids: ["ev1"] }]
  });
  await writeJson(path.join(runDir, "paper", "paper_readiness.json"), {
    paper_ready: options.paperReady,
    readiness_state: options.paperReady ? "paper_ready" : "paper_scale_candidate"
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
