import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeJsonFile } from "../src/utils/fs.js";
import {
  buildSkillBaseline,
  compareSkillBaselines,
  loadSkillBaseline,
  runSkillEvolutionComparison,
  SKILL_PASS_SCORE_THRESHOLD,
  TRACKED_SKILLS
} from "../src/core/evaluation/skillEvolution.js";
import { EvalHarnessReport } from "../src/core/evaluation/evalHarness.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("skill evolution", () => {
  it("creates a baseline on first run", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-skill-evolution-"));
    tempDirs.push(workspace);
    const latestPath = path.join(workspace, "outputs", "eval-harness", "latest.json");
    const baselinePath = path.join(workspace, "outputs", "eval-harness", "baseline.json");
    await mkdir(path.dirname(latestPath), { recursive: true });
    await writeJsonFile(latestPath, buildEvalReport([0.9, 0.85]));

    const result = await runSkillEvolutionComparison({
      latestReportPath: latestPath,
      baselinePath
    });

    expect(result.baselineCreated).toBe(true);
    const saved = await loadSkillBaseline(baselinePath);
    expect(saved).not.toBeNull();
    expect(saved?.skills).toHaveLength(TRACKED_SKILLS.length);
    expect(saved?.skills.every((entry) => entry.pass_rate === 1)).toBe(true);
  });

  it("marks a skill as regressed when the delta exceeds the threshold", () => {
    const baseline = buildSkillBaseline(buildEvalReport([0.9, 0.85]));
    const current = buildSkillBaseline(buildEvalReport([0.6, 0.7]));

    const rows = compareSkillBaselines(baseline, current);

    expect(rows.every((row) => row.status === "REGRESSED")).toBe(true);
    expect(rows.every((row) => row.delta < -0.05)).toBe(true);
  });

  it("prefers skill-tagged runs when present", () => {
    const report = buildEvalReport([0.9, 0.7], [
      ["tui-state-validation"],
      ["paper-scale-research-loop"]
    ]);

    const baseline = buildSkillBaseline(report, {
      passScoreThreshold: SKILL_PASS_SCORE_THRESHOLD
    });

    const tuiSkill = baseline.skills.find((entry) => entry.skill === "tui-state-validation");
    const paperSkill = baseline.skills.find((entry) => entry.skill === "paper-scale-research-loop");
    const fallbackSkill = baseline.skills.find((entry) => entry.skill === "paper-build-output-hygiene");

    expect(tuiSkill).toMatchObject({ pass_rate: 1, run_count: 1, signal_source: "skill_runs" });
    expect(paperSkill).toMatchObject({ pass_rate: 0, run_count: 1, signal_source: "skill_runs" });
    expect(fallbackSkill).toMatchObject({ pass_rate: 0.5, run_count: 2, signal_source: "workspace_fallback" });
  });
});

function buildEvalReport(
  scores: number[],
  skillNames: Array<string[] | undefined> = []
): EvalHarnessReport {
  return {
    version: 1,
    generated_at: "2026-04-01T00:00:00.000Z",
    workspace_root: "/tmp/workspace",
    selection: {
      mode: "latest",
      requested_run_ids: [],
      evaluated_run_ids: scores.map((_, index) => `run-${index + 1}`),
      limit: 20
    },
    aggregate: {
      run_count: scores.length,
      implementation_pass_rate: 1,
      run_verifier_pass_rate: 1,
      objective_met_rate: 1,
      implementation_policy_block_rate: 0,
      run_verifier_policy_block_rate: 0,
      policy_blocked_run_rate: 0,
      auto_handoff_rate: 1,
      artifact_completeness_rate: 1,
      avg_implement_attempts: 1,
      avg_branch_count: 1,
      avg_overall_score: scores.reduce((sum, value) => sum + value, 0) / Math.max(scores.length, 1),
      policy_rule_counts: []
    },
    runs: scores.map((score, index) => ({
      run_id: `run-${index + 1}`,
      title: `Run ${index + 1}`,
      topic: "topic",
      objective_metric: "metric",
      run_status: "completed",
      current_node: "write_paper",
      updated_at: "2026-04-01T00:00:00.000Z",
      statuses: {
        implement: "pass",
        run_verifier: "pass",
        objective: "met",
        analysis: "present",
        paper: "present"
      },
      metrics: {
        implement_attempt_count: 1,
        branch_count: 1,
        changed_file_count: 1,
        auto_handoff_to_run_experiments: true,
        artifact_completeness_ratio: 1,
        policy_blocked: false
      },
      scores: {
        implementation: 1,
        run_verifier: 1,
        objective: 1,
        artifacts: 1,
        overall: score
      },
      missing_artifacts: [],
      findings: [],
      ...(skillNames[index] ? { skill_names: skillNames[index] } : {})
    })) as EvalHarnessReport["runs"]
  };
}
