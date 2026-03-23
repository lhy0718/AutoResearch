import path from "node:path";
import { promises as fs } from "node:fs";

import type { ExperimentComparisonContract } from "../experimentGovernance.js";

export interface ExperimentDesignImplementationValidationFinding {
  code: string;
  severity: "block" | "warn";
  message: string;
  evidence?: string;
}

export interface ExperimentDesignImplementationValidationReport {
  version: 1;
  generated_at: string;
  verdict: "allow" | "block";
  summary: string;
  checked_items: string[];
  findings: ExperimentDesignImplementationValidationFinding[];
  contract?: {
    plan_id: string;
    comparison_mode: ExperimentComparisonContract["comparison_mode"];
    baseline_first_required: boolean;
    objective_metric_name: string;
  };
}

export async function validateDesignImplementationAlignment(input: {
  comparisonContract?: ExperimentComparisonContract;
  attempt: {
    runCommand: string;
    testCommand?: string;
    scriptPath?: string;
    metricsPath: string;
    workingDir: string;
    publicDir: string;
    changedFiles: string[];
    publicArtifacts: string[];
  };
}): Promise<ExperimentDesignImplementationValidationReport> {
  const findings: ExperimentDesignImplementationValidationFinding[] = [];
  const checkedItems: string[] = [];
  const commandPaths = extractCommandPaths(input.attempt.runCommand, input.attempt.workingDir);
  const testCommandPaths = extractCommandPaths(input.attempt.testCommand || "", input.attempt.workingDir);
  const allCommandPaths = dedupeStrings([...commandPaths, ...testCommandPaths]);

  checkedItems.push("run_command_paths");
  if (input.attempt.scriptPath) {
    checkedItems.push("script_path_binding");
    const referencedScript = allCommandPaths.find((candidate) => isRunnableScript(candidate));
    if (referencedScript && !samePath(referencedScript, input.attempt.scriptPath)) {
      findings.push({
        code: "RUN_COMMAND_SCRIPT_MISMATCH",
        severity: "block",
        message: "run_command references a different executable script than script_path.",
        evidence: `script_path=${input.attempt.scriptPath}; run_command_script=${referencedScript}`
      });
    }
  }

  checkedItems.push("public_artifact_binding");
  if (
    input.attempt.scriptPath &&
    isSubpath(input.attempt.scriptPath, input.attempt.publicDir) &&
    !input.attempt.publicArtifacts.some((artifactPath) => samePath(artifactPath, input.attempt.scriptPath || ""))
  ) {
    findings.push({
      code: "PUBLIC_SCRIPT_NOT_DECLARED",
      severity: "block",
      message: "The published script lives in the public experiment directory but was not declared as a public artifact.",
      evidence: `script_path=${input.attempt.scriptPath}; public_dir=${input.attempt.publicDir}`
    });
  }

  checkedItems.push("changed_file_binding");
  if (
    input.attempt.scriptPath &&
    !input.attempt.changedFiles.some((changedPath) => samePath(changedPath, input.attempt.scriptPath || ""))
  ) {
    findings.push({
      code: "SCRIPT_NOT_DECLARED_CHANGED",
      severity: "warn",
      message: "script_path was not included in changed_files. Artifact publication may still work, but auditability is weaker.",
      evidence: `script_path=${input.attempt.scriptPath}`
    });
  }

  checkedItems.push("metrics_path_consistency");
  const referencedMetricsPath = findMetricsPathReference(allCommandPaths);
  if (referencedMetricsPath && !samePath(referencedMetricsPath, input.attempt.metricsPath)) {
    findings.push({
      code: "METRICS_PATH_MISMATCH",
      severity: "block",
      message: "A metrics path was declared in the command surface, but it does not match the locked metrics_path.",
      evidence: `metrics_path=${input.attempt.metricsPath}; command_metrics_path=${referencedMetricsPath}`
    });
  }

  checkedItems.push("baseline_contract_presence");
  if (input.comparisonContract?.baseline_first_required) {
    const scriptText = await safeReadText(input.attempt.scriptPath);
    const baselineSignal = `${input.attempt.runCommand}\n${scriptText}`.toLowerCase();
    if (!/(baseline|control|comparator|greedy)/u.test(baselineSignal)) {
      findings.push({
        code: "BASELINE_SIGNAL_MISSING",
        severity: "warn",
        message: "The locked comparison contract requires a baseline-first evaluation, but the implementation surface does not expose an obvious baseline signal.",
        evidence: `plan_id=${input.comparisonContract.plan_id}; baseline_candidates=${input.comparisonContract.baseline_candidate_ids.join(", ") || "none"}`
      });
    }
  }

  const blockingFindings = findings.filter((finding) => finding.severity === "block");
  const summary = blockingFindings.length > 0
    ? `Design-to-implementation validation blocked handoff with ${blockingFindings.length} blocking finding(s).`
    : findings.length > 0
      ? `Design-to-implementation validation passed with ${findings.length} warning(s).`
      : "Design-to-implementation validation passed.";

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    verdict: blockingFindings.length > 0 ? "block" : "allow",
    summary,
    checked_items: checkedItems,
    findings,
    contract: input.comparisonContract
      ? {
          plan_id: input.comparisonContract.plan_id,
          comparison_mode: input.comparisonContract.comparison_mode,
          baseline_first_required: input.comparisonContract.baseline_first_required,
          objective_metric_name: input.comparisonContract.objective_metric_name
        }
      : undefined
  };
}

export function validateVerificationCommandSurface(input: {
  comparisonContract?: ExperimentComparisonContract;
  verificationCommand: string;
  workingDir: string;
  scriptPath?: string;
  metricsPath: string;
  runCommand: string;
}): ExperimentDesignImplementationValidationReport {
  const findings: ExperimentDesignImplementationValidationFinding[] = [];
  const checkedItems = ["verification_command_script_binding", "verification_command_metrics_binding"];
  const verificationPaths = extractCommandPaths(input.verificationCommand, input.workingDir);
  const verificationScript = verificationPaths.find((candidate) => isRunnableScript(candidate));
  if (input.scriptPath && verificationScript && !samePath(verificationScript, input.scriptPath)) {
    findings.push({
      code: "VERIFY_COMMAND_SCRIPT_MISMATCH",
      severity: "block",
      message: "Local verification references a different script than script_path.",
      evidence: `script_path=${input.scriptPath}; verify_command_script=${verificationScript}`
    });
  }

  const verificationMetricsPath = findMetricsPathReference(verificationPaths);
  if (verificationMetricsPath && !samePath(verificationMetricsPath, input.metricsPath)) {
    findings.push({
      code: "VERIFY_COMMAND_METRICS_PATH_MISMATCH",
      severity: "block",
      message: "Local verification references a metrics path that does not match the locked metrics_path.",
      evidence: `metrics_path=${input.metricsPath}; verify_command_metrics_path=${verificationMetricsPath}`
    });
  }

  if (input.comparisonContract?.baseline_first_required) {
    checkedItems.push("verification_baseline_contract_presence");
    const baselineSignal = `${input.runCommand}\n${input.verificationCommand}`.toLowerCase();
    if (!/(baseline|control|comparator|greedy)/u.test(baselineSignal)) {
      findings.push({
        code: "VERIFY_COMMAND_BASELINE_SIGNAL_MISSING",
        severity: "warn",
        message: "Verification surface does not expose an obvious baseline signal for a baseline-first contract.",
        evidence: `plan_id=${input.comparisonContract.plan_id}`
      });
    }
  }

  const blockingFindings = findings.filter((finding) => finding.severity === "block");
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    verdict: blockingFindings.length > 0 ? "block" : "allow",
    summary:
      blockingFindings.length > 0
        ? `Verification command validation blocked execution with ${blockingFindings.length} blocking finding(s).`
        : findings.length > 0
          ? `Verification command validation passed with ${findings.length} warning(s).`
          : "Verification command validation passed.",
    checked_items: checkedItems,
    findings,
    contract: input.comparisonContract
      ? {
          plan_id: input.comparisonContract.plan_id,
          comparison_mode: input.comparisonContract.comparison_mode,
          baseline_first_required: input.comparisonContract.baseline_first_required,
          objective_metric_name: input.comparisonContract.objective_metric_name
        }
      : undefined
  };
}

async function safeReadText(filePath: string | undefined): Promise<string> {
  if (!filePath) {
    return "";
  }
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function extractCommandPaths(command: string, cwd: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const paths = new Set<string>();
  for (const token of tokens) {
    const value = token.replace(/^['"]|['"]$/g, "");
    if (!looksLikePath(value)) {
      continue;
    }
    paths.add(path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value)));
  }
  return [...paths];
}

function looksLikePath(value: string): boolean {
  if (!value) {
    return false;
  }
  if (/^[a-z]+:\/\//iu.test(value)) {
    return false;
  }
  return (
    value.startsWith(".") ||
    value.startsWith(path.sep) ||
    value.includes(path.sep) ||
    /\.(py|js|mjs|cjs|sh|json|yaml|yml|toml)$/iu.test(value)
  );
}

function isRunnableScript(filePath: string): boolean {
  return /\.(py|js|mjs|cjs|sh)$/iu.test(filePath);
}

function findMetricsPathReference(paths: string[]): string | undefined {
  return paths.find((candidate) => /metrics[^/]*\.json$/iu.test(candidate) || /metrics\.json$/iu.test(candidate));
}

function isSubpath(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left: string, right: string): boolean {
  return path.normalize(left) === path.normalize(right);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}