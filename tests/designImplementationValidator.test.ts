import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildExperimentComparisonContract } from "../src/core/experimentGovernance.js";
import { buildHeuristicObjectiveMetricProfile } from "../src/core/objectiveMetric.js";
import {
  validateDesignImplementationAlignment,
  validateVerificationCommandSurface
} from "../src/core/experiments/designImplementationValidator.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("validateDesignImplementationAlignment", () => {
  it("blocks when run_command points at a different script than script_path", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const otherScriptPath = path.join(publicDir, "other_experiment.py");
    writeFileSync(scriptPath, "print('baseline run')\n", "utf8");

    const contract = buildExperimentComparisonContract({
      run: { id: "run-1", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-1",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      attempt: {
        runCommand: `python3 ${JSON.stringify(otherScriptPath)}`,
        testCommand: `python3 -m py_compile ${JSON.stringify(scriptPath)}`,
        scriptPath,
        metricsPath: path.join(workspace, ".autolabos", "runs", "run-1", "metrics.json"),
        workingDir: publicDir,
        publicDir,
        changedFiles: [scriptPath],
        publicArtifacts: [scriptPath]
      }
    });

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RUN_COMMAND_SCRIPT_MISMATCH",
          severity: "block"
        })
      ])
    );
  });

  it("allows aligned script and metrics bindings", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-pass-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-2", "metrics.json");
    writeFileSync(
      scriptPath,
      "def run_baseline():\n    return 1\n\nprint('baseline and adaptive evaluation')\n",
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-2", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-2",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      attempt: {
        runCommand: `python3 ${JSON.stringify(scriptPath)} --metrics-path ${JSON.stringify(metricsPath)}`,
        testCommand: `python3 -m py_compile ${JSON.stringify(scriptPath)}`,
        scriptPath,
        metricsPath,
        workingDir: publicDir,
        publicDir,
        changedFiles: [scriptPath],
        publicArtifacts: [scriptPath]
      }
    });

    expect(report.verdict).toBe("allow");
    expect(report.findings.filter((finding) => finding.severity === "block")).toEqual([]);
  });

  it("blocks when verification command points at a different script than script_path", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-verify-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const otherScriptPath = path.join(publicDir, "other_experiment.py");

    const contract = buildExperimentComparisonContract({
      run: { id: "run-3", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-3",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = validateVerificationCommandSurface({
      comparisonContract: contract,
      verificationCommand: `python3 -m py_compile ${JSON.stringify(otherScriptPath)}`,
      workingDir: publicDir,
      scriptPath,
      metricsPath: path.join(workspace, ".autolabos", "runs", "run-3", "metrics.json"),
      runCommand: `python3 ${JSON.stringify(scriptPath)}`
    });

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "VERIFY_COMMAND_SCRIPT_MISMATCH",
          severity: "block"
        })
      ])
    );
  });

  it("ignores shell assignment prefixes when a heredoc verification command references the script path", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-heredoc-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    writeFileSync(scriptPath, "print('ok')\n", "utf8");

    const contract = buildExperimentComparisonContract({
      run: { id: "run-4", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-4",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = validateVerificationCommandSurface({
      comparisonContract: contract,
      verificationCommand: [
        "python - << 'PY'",
        `p='${scriptPath}'`,
        "print(p)",
        "PY"
      ].join("\n"),
      workingDir: publicDir,
      scriptPath,
      metricsPath: path.join(workspace, ".autolabos", "runs", "run-4", "metrics.json"),
      runCommand: `python3 ${JSON.stringify(scriptPath)}`
    });

    expect(report.verdict).toBe("allow");
    expect(report.findings.filter((finding) => finding.severity === "block")).toEqual([]);
  });
});
