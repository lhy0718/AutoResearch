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

  it("allows a shell run_command wrapper that launches script_path", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-wrapper-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-wrapper", "metrics.json");
    writeFileSync(scriptPath, "print('baseline and adaptive evaluation')\n", "utf8");
    writeFileSync(
      wrapperPath,
      `#!/usr/bin/env bash\npython3 ${JSON.stringify(scriptPath)} --metrics-path ${JSON.stringify(metricsPath)}\n`,
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-wrapper", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-wrapper",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      attempt: {
        runCommand: `bash ${JSON.stringify(wrapperPath)}`,
        testCommand: `python3 -m py_compile ${JSON.stringify(scriptPath)}`,
        scriptPath,
        metricsPath,
        workingDir: publicDir,
        publicDir,
        changedFiles: [scriptPath, wrapperPath],
        publicArtifacts: [scriptPath, wrapperPath]
      }
    });

    expect(report.verdict).toBe("allow");
    expect(report.findings.filter((finding) => finding.severity === "block")).toEqual([]);
  });

  it("allows a published run_command.sh wrapper that launches script_path through SCRIPT_DIR", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-public-wrapper-pass-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "run_lora_rank_dropout_experiment.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-public-wrapper-pass", "metrics.json");
    writeFileSync(scriptPath, "print('baseline and adaptive evaluation')\n", "utf8");
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'python "${SCRIPT_DIR}/run_lora_rank_dropout_experiment.py" --metrics-path "${PWD}/metrics.json"'
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-public-wrapper-pass", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-public-wrapper-pass",
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
    expect(report.checked_items).toContain("public_run_command_wrapper_binding");
  });

  it("uses a shell wrapper target runner as the planned-condition implementation surface", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-wrapper-surface-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "run_lora_rank_dropout_experiment.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-wrapper-surface", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "BASELINE_CONDITION_MARKER = 'rank_8_dropout_0_0'",
        "REQUIRED_SEEDS = (42, 43, 44)",
        "REQUIRED_CONDITION_MARKERS = (",
        "  'rank_8_dropout_0_0', 'rank_4_dropout_0_0', 'rank_4_dropout_0_05',",
        "  'rank_8_dropout_0_05', 'rank_16_dropout_0_0', 'rank_16_dropout_0_05',",
        "  'rank_32_dropout_0_0', 'rank_32_dropout_0_05',",
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 24",
        "print('baseline and adaptive evaluation')"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'exec python "${SCRIPT_DIR}/run_lora_rank_dropout_experiment.py" --metrics-path "${PWD}/metrics.json"'
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-wrapper-surface", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-wrapper-surface",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 24,
        seed_schedule: [42, 43, 44],
        baseline_condition_marker: "rank_8_dropout_0_0",
        required_condition_markers: [
          "rank_8_dropout_0_0",
          "rank_4_dropout_0_0",
          "rank_4_dropout_0_05",
          "rank_8_dropout_0_05",
          "rank_16_dropout_0_0",
          "rank_16_dropout_0_05",
          "rank_32_dropout_0_0",
          "rank_32_dropout_0_05"
        ]
      },
      attempt: {
        runCommand: `bash ${JSON.stringify(wrapperPath)}`,
        scriptPath: wrapperPath,
        metricsPath,
        workingDir: publicDir,
        publicDir,
        changedFiles: [wrapperPath, scriptPath],
        publicArtifacts: [wrapperPath, scriptPath]
      }
    });

    expect(report.verdict).toBe("allow");
    expect(report.findings.filter((finding) => finding.severity === "block")).toEqual([]);
  });

  it("blocks when a published run_command.sh still launches a stale runner", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-public-wrapper-stale-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "run_lora_rank_dropout_experiment.py");
    const staleScriptPath = path.join(publicDir, "run_lora_rank_dropout_study.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-public-wrapper-stale", "metrics.json");
    writeFileSync(scriptPath, "REQUIRED_CONDITION_COUNT = 8\nprint('baseline and adaptive evaluation')\n", "utf8");
    writeFileSync(staleScriptPath, "REQUIRED_CONDITION_COUNT = 4\nprint('stale runner')\n", "utf8");
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'python "${SCRIPT_DIR}/run_lora_rank_dropout_study.py" --metrics-path "${PWD}/metrics.json"'
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-public-wrapper-stale", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-public-wrapper-stale",
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

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PUBLIC_RUN_COMMAND_WRAPPER_SCRIPT_MISMATCH",
          severity: "block"
        })
      ])
    );
  });

  it("blocks when a published run_command.sh passes flags unsupported by script_path", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-public-wrapper-flags-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "run_lora_rank_dropout_experiment.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-public-wrapper-flags", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "import argparse",
        "parser = argparse.ArgumentParser()",
        "parser.add_argument('--metrics-path')",
        "parser.add_argument('--public-dir')",
        "print('baseline and adaptive evaluation')"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'python "${SCRIPT_DIR}/run_lora_rank_dropout_experiment.py" --experiment-dir "${SCRIPT_DIR}" --metrics-path "${PWD}/metrics.json"'
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-public-wrapper-flags", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-public-wrapper-flags",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      attempt: {
        runCommand: `bash ${JSON.stringify(wrapperPath)}`,
        testCommand: `python3 -m py_compile ${JSON.stringify(scriptPath)}`,
        scriptPath,
        metricsPath,
        workingDir: publicDir,
        publicDir,
        changedFiles: [scriptPath, wrapperPath],
        publicArtifacts: [scriptPath, wrapperPath]
      }
    });

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PUBLIC_RUN_COMMAND_WRAPPER_UNSUPPORTED_ARGS",
          severity: "block",
          evidence: expect.stringContaining("--experiment-dir")
        })
      ])
    );
  });

  it("blocks when a runner compresses the planned full-grid condition and seed contract", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-planned-contract-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-planned", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "REQUIRED_CONDITION_COUNT = 5",
        "DEFAULT_SEED = 17",
        "PLANNED_CONDITIONS = ['rank_8_dropout_0_0', 'rank_8_dropout_0_1', 'rank_16_dropout_0_0', 'rank_16_dropout_0_1', 'rank_32_dropout_0_0']",
        "print('baseline and comparator runner')"
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-planned", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-planned",
        hypothesis_ids: ["h1"],
        baselines: ["rank_8_dropout_0_0"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 24,
        minimum_seeds_per_condition: 3,
        seed_schedule: [42, 43, 44],
        baseline_condition_marker: "rank_8_dropout_0_0",
        required_condition_markers: [
          "rank_4_dropout_0_0",
          "rank_4_dropout_0_05",
          "rank_8_dropout_0_0",
          "rank_8_dropout_0_05",
          "rank_16_dropout_0_0",
          "rank_16_dropout_0_05",
          "rank_32_dropout_0_0",
          "rank_32_dropout_0_05"
        ]
      },
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

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PLANNED_CONDITION_MARKERS_MISSING",
          severity: "block"
        }),
        expect.objectContaining({
          code: "PLANNED_CONDITION_COUNT_CONTRACTED",
          severity: "block"
        }),
        expect.objectContaining({
          code: "PLANNED_SEED_SCHEDULE_MISSING",
          severity: "block"
        })
      ])
    );
  });

  it("blocks when the full condition grid is present but the locked baseline is not first", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-baseline-order-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-baseline-order", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        "  'rank_4_dropout_0_0',",
        "  'rank_4_dropout_0_05',",
        "  'rank_8_dropout_0_0',",
        "  'rank_8_dropout_0_05',",
        "  'rank_16_dropout_0_0',",
        "  'rank_16_dropout_0_05',",
        "  'rank_32_dropout_0_0',",
        "  'rank_32_dropout_0_05',",
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 24",
        "SEED_SCHEDULE = [42, 43, 44]",
        "print('baseline and comparator runner')"
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-baseline-order", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-baseline-order",
        hypothesis_ids: ["h1"],
        baselines: ["rank_8_dropout_0_0"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 24,
        seed_schedule: [42, 43, 44],
        baseline_condition_marker: "rank_8_dropout_0_0",
        required_condition_markers: [
          "rank_8_dropout_0_0",
          "rank_4_dropout_0_0",
          "rank_4_dropout_0_05",
          "rank_8_dropout_0_05",
          "rank_16_dropout_0_0",
          "rank_16_dropout_0_05",
          "rank_32_dropout_0_0",
          "rank_32_dropout_0_05"
        ]
      },
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

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PLANNED_BASELINE_ORDER_MISMATCH",
          severity: "block"
        })
      ])
    );
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
