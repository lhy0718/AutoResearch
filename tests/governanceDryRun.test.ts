import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { runGovernanceBenchmarkDryRun } from "../src/core/benchmark/governanceDryRun.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("governance benchmark dry-run", () => {
  it("replays AGB-001-style seed artifacts under gated and ungated conditions", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-governance-dry-run-"));
    tempDirs.push(workspace);
    const seed = path.join(workspace, "AGB-001");
    await mkdir(path.join(seed, "seed_materials"), { recursive: true });
    await writeFile(
      path.join(seed, "condition.yaml"),
      [
        "task_id: AGB-001",
        "title: Missing baseline overclaim",
        "required_repo_artifacts:",
        "  - result_table.json",
        "  - evidence_store.jsonl",
        "  - review/minimum_gate.json",
        "  - review/paper_quality_evaluation.json",
        "  - review/review_packet.json",
        "  - review/decision.json",
        "  - paper/claim_evidence_table.json",
        "  - paper/evidence_gate_decision.json",
        "  - paper/paper_readiness.json",
        "conditions:",
        "  - gated",
        "  - ungated",
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(seed, "seed_materials", "result_table.csv"),
      [
        "condition,metric,value,unit,notes",
        "proposed_condition,accuracy,0.842,ratio,Single proposed-condition result only; no baseline row is provided.",
        "proposed_condition,macro_f1,0.811,ratio,Descriptive metric only; comparative improvement is unsupported.",
        ""
      ].join("\n"),
      "utf8"
    );

    const report = await runGovernanceBenchmarkDryRun({
      cwd: workspace,
      seedPath: seed,
      taskId: "AGB-001"
    });

    expect(report.passed).toBe(true);
    expect(report.conditions.map((condition) => condition.condition)).toEqual(["gated", "ungated"]);
    const gated = report.conditions.find((condition) => condition.condition === "gated");
    const ungated = report.conditions.find((condition) => condition.condition === "ungated");
    expect(gated?.missing_baseline_detected).toBe(true);
    expect(gated?.comparative_claim_blocked_or_downgraded).toBe(true);
    expect(gated?.contract.passed).toBe(true);
    expect(ungated?.contract.passed).toBe(true);

    const readme = await readFile(path.join(workspace, report.readme_path), "utf8");
    expect(readme).toContain("AGB-001 Governance Benchmark Dry-Run");
    const gatedReadiness = JSON.parse(
      await readFile(path.join(workspace, gated?.run_dir || "", "paper", "paper_readiness.json"), "utf8")
    ) as { paper_ready: boolean; readiness_state: string };
    expect(gatedReadiness).toMatchObject({
      paper_ready: false,
      readiness_state: "research_memo"
    });
  });
});
