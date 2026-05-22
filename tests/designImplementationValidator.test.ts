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
    const scriptPath = path.join(publicDir, "current_study_runner.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-public-wrapper-pass", "metrics.json");
    writeFileSync(scriptPath, "print('baseline and adaptive evaluation')\n", "utf8");
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'python "${SCRIPT_DIR}/current_study_runner.py" --metrics-path "${PWD}/metrics.json"'
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
    const scriptPath = path.join(publicDir, "current_study_runner.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-wrapper-surface", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "BASELINE_CONDITION_MARKER = 'baseline_condition'",
        "REQUIRED_SEEDS = (42, 43, 44)",
        "REQUIRED_CONDITION_MARKERS = (",
        "  'baseline_condition', 'candidate_condition_a', 'candidate_condition_a5',",
        "  'baseline_condition5', 'candidate_condition_d', 'candidate_condition_d5',",
        "  'candidate_condition_f', 'candidate_condition_f5',",
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
        'exec python "${SCRIPT_DIR}/current_study_runner.py" --metrics-path "${PWD}/metrics.json"'
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
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: [
          "baseline_condition",
          "candidate_condition_a",
          "candidate_condition_a5",
          "baseline_condition5",
          "candidate_condition_d",
          "candidate_condition_d5",
          "candidate_condition_f",
          "candidate_condition_f5"
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
    const scriptPath = path.join(publicDir, "current_study_runner.py");
    const staleScriptPath = path.join(publicDir, "stale_study_runner.py");
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
        'python "${SCRIPT_DIR}/stale_study_runner.py" --metrics-path "${PWD}/metrics.json"'
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
    const scriptPath = path.join(publicDir, "current_study_runner.py");
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
        'python "${SCRIPT_DIR}/current_study_runner.py" --experiment-dir "${SCRIPT_DIR}" --metrics-path "${PWD}/metrics.json"'
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
        "PLANNED_CONDITIONS = ['baseline_condition', 'candidate_condition_h', 'candidate_condition_d', 'candidate_condition_i', 'candidate_condition_f']",
        "print('baseline and comparator runner')"
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-planned", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-planned",
        hypothesis_ids: ["h1"],
        baselines: ["baseline_condition"]
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
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: [
          "candidate_condition_a",
          "candidate_condition_a5",
          "baseline_condition",
          "baseline_condition5",
          "candidate_condition_d",
          "candidate_condition_d5",
          "candidate_condition_f",
          "candidate_condition_f5"
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

  it("blocks stale public docs that contradict the approved full-grid run contract", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-public-doc-contract-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const readmePath = path.join(publicDir, "README.md");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-public-doc", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        "  'baseline_condition', 'candidate_condition_a', 'candidate_condition_a5', 'baseline_condition5',",
        "  'candidate_condition_d', 'candidate_condition_d5', 'candidate_condition_f', 'candidate_condition_f5',",
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "print('baseline and comparator runner')"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      readmePath,
      [
        "Planned tuned conditions:",
        "- baseline_condition",
        "- candidate_condition_a",
        "- candidate_condition_d",
        "- candidate_condition_f",
        "",
        "Planned run count:",
        "- 22 total runs"
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-public-doc", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-public-doc",
        hypothesis_ids: ["h1"],
        baselines: ["baseline_condition"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: [
          "baseline_condition",
          "candidate_condition_a",
          "candidate_condition_a5",
          "baseline_condition5",
          "candidate_condition_d",
          "candidate_condition_d5",
          "candidate_condition_f",
          "candidate_condition_f5"
        ]
      },
      attempt: {
        runCommand: `python3 ${JSON.stringify(scriptPath)} --metrics-path ${JSON.stringify(metricsPath)}`,
        testCommand: `python3 -m py_compile ${JSON.stringify(scriptPath)}`,
        scriptPath,
        metricsPath,
        workingDir: publicDir,
        publicDir,
        changedFiles: [scriptPath, readmePath],
        publicArtifacts: [scriptPath, readmePath]
      }
    });

    expect(report.verdict).toBe("block");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PUBLIC_CONDITION_MARKERS_CONTRACTED",
          severity: "block"
        }),
        expect.objectContaining({
          code: "PUBLIC_RUN_COUNT_CONTRACTED",
          severity: "block"
        })
      ])
    );
  });

  it("blocks planned runners that declare a full schedule but resolve only missing per-run helpers", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-missing-per-run-helper-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "current_study_runner.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-missing-per-run-helper", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        "  'baseline_condition', 'candidate_condition_a', 'candidate_condition_a5', 'baseline_condition5',",
        "  'candidate_condition_d', 'candidate_condition_d5', 'candidate_condition_f', 'candidate_condition_f5',",
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "PRIMARY_METRIC_KEY = 'accuracy_delta_vs_baseline'",
        "def _resolve_global_callable(names):",
        "    return None",
        "def _resolve_run_callable():",
        "    run_callable = _resolve_global_callable([",
        "        'run_condition_seed',",
        "        'run_condition_seed_experiment',",
        "        'execute_condition_seed_run',",
        "        'train_and_evaluate_condition',",
        "    ])",
        "    if run_callable is None:",
        "        raise RuntimeError('No callable per-run execution helper was found in the current script.')",
        "    return run_callable",
        "def main():",
        "    return {'completed_run_count': 0, 'accuracy_delta_vs_baseline': None}"
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-missing-per-run-helper", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-missing-per-run-helper",
        hypothesis_ids: ["h1"],
        baselines: ["baseline_condition"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: [
          "baseline_condition",
          "candidate_condition_a",
          "candidate_condition_a5",
          "baseline_condition5",
          "candidate_condition_d",
          "candidate_condition_d5",
          "candidate_condition_f",
          "candidate_condition_f5"
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
          code: "PLANNED_PER_RUN_EXECUTION_HELPER_MISSING",
          severity: "block",
          evidence: expect.stringContaining("required_runs=32")
        })
      ])
    );
  });

  it("blocks planned runners whose execution loop resolver raises the runnable-helper variant", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-runnable-helper-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "current_study_runner.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-runnable-helper", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        "  'baseline_condition', 'candidate_condition_a', 'candidate_condition_a5', 'baseline_condition5',",
        "  'candidate_condition_d', 'candidate_condition_d5', 'candidate_condition_f', 'candidate_condition_f5',",
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "PRIMARY_METRIC_KEY = 'accuracy_delta_vs_baseline'",
        "def _find_callable(names):",
        "    return None",
        "def _execute_study_runs():",
        "    single_run_function = _find_callable((",
        "        'run_single_condition_seed',",
        "        '_run_single_condition_seed',",
        "        'execute_single_run',",
        "        '_execute_single_run',",
        "        'run_condition_seed',",
        "        '_run_condition_seed',",
        "        'train_and_evaluate_single_run',",
        "    ))",
        "    if single_run_function is None:",
        "        raise RuntimeError('Unable to locate a runnable execution helper in the current module. Expected a study runner, execution loop, or single-run callable.')",
        "    return single_run_function",
        "def main():",
        "    return {'completed_run_count': 0, 'accuracy_delta_vs_baseline': None}"
      ].join("\n"),
      "utf8"
    );

    const report = await validateDesignImplementationAlignment({
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: [
          "baseline_condition",
          "candidate_condition_a",
          "candidate_condition_a5",
          "baseline_condition5",
          "candidate_condition_d",
          "candidate_condition_d5",
          "candidate_condition_f",
          "candidate_condition_f5"
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
          code: "PLANNED_PER_RUN_EXECUTION_HELPER_MISSING",
          severity: "block",
          evidence: expect.stringContaining("run_single_condition_seed")
        })
      ])
    );
  });

  it("blocks public study entrypoints that cannot accept run_experiments args keyword", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-entrypoint-args-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "study_runner.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-entrypoint-args", "metrics.json");
    const markers = [
      "baseline_condition",
      "candidate_condition_a",
      "candidate_condition_b",
      "candidate_condition_c",
      "candidate_condition_d",
      "candidate_condition_e",
      "candidate_condition_f",
      "candidate_condition_g"
    ];
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        ...markers.map((marker) => `  '${marker}',`),
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "PRIMARY_METRIC_KEY = 'accuracy_delta_vs_baseline'",
        "def run_single_condition_seed(condition, seed, output_dir):",
        "    return {'condition_marker': condition, 'seed': seed, 'accuracy_delta_vs_baseline': 0.0}",
        "def run_public_study(config):",
        "    return {'completed_run_count': 32, 'accuracy_delta_vs_baseline': 0.0}",
        "def main():",
        "    return run_public_study(config={})"
      ].join("\n"),
      "utf8"
    );

    const report = await validateDesignImplementationAlignment({
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: markers[0],
        required_condition_markers: markers
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
          code: "PLANNED_RUNTIME_ENTRYPOINT_ARGS_INCOMPATIBLE",
          severity: "block",
          evidence: expect.stringContaining("run_public_study(config)")
        })
      ])
    );
  });

  it("does not require args keyword on per-run condition-seed helpers", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-per-run-entrypoint-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "study_runner.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-per-run-entrypoint", "metrics.json");
    const markers = [
      "baseline_condition",
      "candidate_condition_a",
      "candidate_condition_b",
      "candidate_condition_c",
      "candidate_condition_d",
      "candidate_condition_e",
      "candidate_condition_f",
      "candidate_condition_g"
    ];
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        ...markers.map((marker) => `  '${marker}',`),
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "PRIMARY_METRIC_KEY = 'accuracy_delta_vs_baseline'",
        "def run_single_condition_seed_experiment(condition, seed, output_dir):",
        "    return {'condition_marker': condition, 'seed': seed, 'accuracy_delta_vs_baseline': 0.0}",
        "def run_public_study(args):",
        "    return {'completed_run_count': 32, 'accuracy_delta_vs_baseline': 0.0}",
        "def main():",
        "    return run_public_study(args={})"
      ].join("\n"),
      "utf8"
    );

    const report = await validateDesignImplementationAlignment({
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: markers[0],
        required_condition_markers: markers
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

    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PLANNED_RUNTIME_ENTRYPOINT_ARGS_INCOMPATIBLE",
          evidence: expect.stringContaining("run_single_condition_seed_experiment")
        })
      ])
    );
  });

  it("blocks locked condition resolvers that cannot discover the declared condition catalog", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-locked-resolver-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "study_runner.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-locked-resolver", "metrics.json");
    const markers = [
      "baseline_condition",
      "candidate_condition_a",
      "candidate_condition_b",
      "candidate_condition_c",
      "candidate_condition_d",
      "candidate_condition_e",
      "candidate_condition_f",
      "candidate_condition_g"
    ];
    writeFileSync(
      scriptPath,
      [
        "LOCKED_CONDITION_SPECS = (",
        ...markers.map((marker, index) => `  {'marker': '${marker}', 'order': ${index}},`),
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "def run_single_condition_seed(condition, seed, output_dir):",
        "    return {'condition_marker': condition['marker'], 'seed': seed}",
        "def _first_present_global(names, default):",
        "    return default",
        "def _get_locked_condition_specs():",
        "    raw = _first_present_global(('LOCKED_CONDITIONS', 'PLANNED_CONDITIONS', 'CONDITION_SCHEDULE', 'CONDITIONS'), [])",
        "    if not raw:",
        "        raise ValueError('No locked conditions are available to select from.')",
        "    return list(raw)",
        "def run_public_study(args=None):",
        "    return {'completed_run_count': 32}"
      ].join("\n"),
      "utf8"
    );

    const report = await validateDesignImplementationAlignment({
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: markers[0],
        required_condition_markers: markers
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
          code: "PLANNED_LOCKED_CONDITION_RESOLVER_MISMATCH",
          severity: "block",
          evidence: expect.stringContaining("LOCKED_CONDITION_SPECS")
        })
      ])
    );
  });

  it("blocks unresolved runtime guards where the study execution loop should be", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-runtime-guard-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "study_runner.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-runtime-guard", "metrics.json");
    const markers = [
      "baseline_condition",
      "candidate_condition_a",
      "candidate_condition_b",
      "candidate_condition_c",
      "candidate_condition_d",
      "candidate_condition_e",
      "candidate_condition_f",
      "candidate_condition_g"
    ];
    writeFileSync(
      scriptPath,
      [
        "PLANNED_CONDITION_MARKERS = (",
        ...markers.map((marker) => `  '${marker}',`),
        ")",
        "REQUIRED_CONDITION_COUNT = 8",
        "REQUIRED_RUN_COUNT = 32",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "def run_single_condition_seed(condition, seed, output_dir):",
        "    return {'condition_marker': condition, 'seed': seed}",
        "def run_public_study(args=None):",
        "    raise RuntimeError('No locked study execution helper is available; expected chunk_2c2 execution loop definitions.')"
      ].join("\n"),
      "utf8"
    );

    const report = await validateDesignImplementationAlignment({
      plannedConditionContract: {
        required_condition_count: 8,
        required_run_count: 32,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: markers[0],
        required_condition_markers: markers
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
          code: "PLANNED_RUNTIME_EXECUTION_GUARD_UNRESOLVED",
          severity: "block",
          evidence: expect.stringContaining("missing_locked_study_execution_helper")
        })
      ])
    );
  });

  it("blocks hard evaluation caps below a full-validation contract", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-full-eval-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "experiment.py");
    const metricsPath = path.join(workspace, ".autolabos", "runs", "run-full-eval", "metrics.json");
    writeFileSync(
      scriptPath,
      [
        "LOCKED_BUDGET = dict(max_eval_examples_per_task=96)",
        "PLANNED_CONDITION_MARKERS = ('baseline_condition', 'candidate_condition_a')",
        "REQUIRED_RUN_COUNT = 8",
        "SEED_SCHEDULE = [42, 43, 44, 45]",
        "print('baseline and comparator runner')"
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-full-eval", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-full-eval",
        hypothesis_ids: ["h1"],
        baselines: ["baseline_condition"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = await validateDesignImplementationAlignment({
      comparisonContract: contract,
      plannedConditionContract: {
        required_condition_count: 2,
        required_run_count: 8,
        seed_schedule: [42, 43, 44, 45],
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: ["baseline_condition", "candidate_condition_a"],
        full_evaluation_required: true,
        minimum_eval_examples_per_task: {
          benchmark_task_a: 299,
          benchmark_task_b: 10042
        }
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
          code: "PLANNED_FULL_EVAL_CONTRACTED",
          severity: "block",
          evidence: expect.stringContaining("declared_cap=96")
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
        "  'candidate_condition_a',",
        "  'candidate_condition_a5',",
        "  'baseline_condition',",
        "  'baseline_condition5',",
        "  'candidate_condition_d',",
        "  'candidate_condition_d5',",
        "  'candidate_condition_f',",
        "  'candidate_condition_f5',",
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
        baselines: ["baseline_condition"]
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
        baseline_condition_marker: "baseline_condition",
        required_condition_markers: [
          "baseline_condition",
          "candidate_condition_a",
          "candidate_condition_a5",
          "baseline_condition5",
          "candidate_condition_d",
          "candidate_condition_d5",
          "candidate_condition_f",
          "candidate_condition_f5"
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

  it("allows verification through the same published run wrapper as run_command", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-wrapper-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const scriptPath = path.join(publicDir, "current_study_runner.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    writeFileSync(scriptPath, "print('baseline evaluation ready')\n", "utf8");
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'exec "${PYTHON_BIN:-python3}" "${SCRIPT_DIR}/current_study_runner.py" "$@"'
      ].join("\n"),
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

    const report = validateVerificationCommandSurface({
      comparisonContract: contract,
      verificationCommand: `bash ${JSON.stringify(wrapperPath)}`,
      workingDir: publicDir,
      scriptPath,
      metricsPath: path.join(workspace, ".autolabos", "runs", "run-wrapper", "metrics.json"),
      runCommand: `bash ${JSON.stringify(wrapperPath)}`
    });

    expect(report.verdict).toBe("allow");
    expect(report.checked_items).toContain("verification_command_run_wrapper_binding");
    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "VERIFY_COMMAND_SCRIPT_MISMATCH"
        })
      ])
    );
  });

  it("allows verification of the runner launched by the reported shell script_path", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-design-validator-wrapper-target-"));
    tempDirs.push(workspace);
    const publicDir = path.join(workspace, "outputs", "experiment");
    mkdirSync(publicDir, { recursive: true });
    const runnerPath = path.join(publicDir, "current_study_runner.py");
    const wrapperPath = path.join(publicDir, "run_command.sh");
    writeFileSync(runnerPath, "print('baseline evaluation ready')\n", "utf8");
    writeFileSync(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'exec "${PYTHON_BIN:-python3}" "${SCRIPT_DIR}/current_study_runner.py" "$@"'
      ].join("\n"),
      "utf8"
    );

    const contract = buildExperimentComparisonContract({
      run: { id: "run-wrapper-target", objectiveMetric: "accuracy_delta_vs_baseline" },
      selectedDesign: {
        id: "design-wrapper-target",
        hypothesis_ids: ["h1"],
        baselines: ["greedy_direct"]
      },
      objectiveProfile: buildHeuristicObjectiveMetricProfile("accuracy_delta_vs_baseline"),
      managedBundleSupported: false
    });

    const report = validateVerificationCommandSurface({
      comparisonContract: contract,
      verificationCommand: `python3 -m py_compile ${JSON.stringify(runnerPath)}`,
      workingDir: publicDir,
      scriptPath: wrapperPath,
      metricsPath: path.join(workspace, ".autolabos", "runs", "run-wrapper-target", "metrics.json"),
      runCommand: `bash ${JSON.stringify(wrapperPath)}`
    });

    expect(report.verdict).toBe("allow");
    expect(report.checked_items).toContain("verification_command_wrapper_target_binding");
    expect(report.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "VERIFY_COMMAND_SCRIPT_MISMATCH"
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
