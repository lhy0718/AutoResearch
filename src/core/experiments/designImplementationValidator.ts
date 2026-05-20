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

export interface PlannedConditionImplementationContract {
  required_condition_count?: number;
  required_run_count?: number;
  seed_schedule?: number[];
  minimum_seeds_per_condition?: number;
  baseline_condition_marker?: string;
  required_condition_markers?: string[];
  primary_metric_key?: string;
}

export async function validateDesignImplementationAlignment(input: {
  comparisonContract?: ExperimentComparisonContract;
  plannedConditionContract?: PlannedConditionImplementationContract;
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
  const scriptText = await readImplementationSurfaceText(input.attempt.scriptPath);

  checkedItems.push("run_command_paths");
  if (input.attempt.scriptPath) {
    checkedItems.push("script_path_binding");
    const referencedScript = allCommandPaths.find((candidate) => isRunnableScript(candidate));
    const runCommandTargetsScriptPath =
      referencedScript &&
      (samePath(referencedScript, input.attempt.scriptPath) ||
        (await missingSameNamedScriptReference(referencedScript, input.attempt.scriptPath)) ||
        (await shellWrapperReferencesScriptPath(referencedScript, input.attempt.scriptPath)));
    if (referencedScript && !runCommandTargetsScriptPath) {
      findings.push({
        code: "RUN_COMMAND_SCRIPT_MISMATCH",
        severity: "block",
        message: "run_command references a different executable script than script_path.",
        evidence: `script_path=${input.attempt.scriptPath}; run_command_script=${referencedScript}`
      });
    }
  }

  if (input.attempt.scriptPath) {
    const publicRunCommandWrappers = await findPublicRunCommandWrappers(
      input.attempt.publicDir,
      input.attempt.publicArtifacts
    );
    if (publicRunCommandWrappers.length > 0) {
      checkedItems.push("public_run_command_wrapper_binding");
    }
    for (const wrapperPath of publicRunCommandWrappers) {
      if (samePath(wrapperPath, input.attempt.scriptPath)) {
        continue;
      }
      const wrapperTargetsScriptPath = await shellWrapperReferencesScriptPath(wrapperPath, input.attempt.scriptPath);
      if (!wrapperTargetsScriptPath) {
        findings.push({
          code: "PUBLIC_RUN_COMMAND_WRAPPER_SCRIPT_MISMATCH",
          severity: "block",
          message: "A published run_command.sh exists but does not launch the reported script_path.",
          evidence: `script_path=${input.attempt.scriptPath}; public_run_command=${wrapperPath}`
        });
      }
      const unsupportedWrapperFlags = await findUnsupportedWrapperScriptFlags(wrapperPath, scriptText);
      if (unsupportedWrapperFlags.length > 0) {
        findings.push({
          code: "PUBLIC_RUN_COMMAND_WRAPPER_UNSUPPORTED_ARGS",
          severity: "block",
          message: "A published run_command.sh passes CLI options that the reported script_path does not accept.",
          evidence: `script_path=${input.attempt.scriptPath}; public_run_command=${wrapperPath}; unsupported=${unsupportedWrapperFlags.join(", ")}`
        });
      }
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

  if (input.plannedConditionContract) {
    checkedItems.push("planned_condition_contract_alignment");
    const plannedFindings = validatePlannedConditionImplementationSurface({
      contract: input.plannedConditionContract,
      scriptText,
      runCommand: input.attempt.runCommand,
      testCommand: input.attempt.testCommand || ""
    });
    findings.push(...plannedFindings);
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
  const runCommandPaths = extractCommandPaths(input.runCommand || "", input.workingDir);
  const runCommandScript = runCommandPaths.find((candidate) => isRunnableScript(candidate));
  const verificationUsesPublishedRunWrapper =
    verificationScript &&
    runCommandScript &&
    path.extname(verificationScript) === ".sh" &&
    samePath(verificationScript, runCommandScript);
  if (verificationUsesPublishedRunWrapper) {
    checkedItems.push("verification_command_run_wrapper_binding");
  }
  if (
    input.scriptPath &&
    verificationScript &&
    !samePath(verificationScript, input.scriptPath) &&
    !verificationUsesPublishedRunWrapper
  ) {
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

function validatePlannedConditionImplementationSurface(input: {
  contract: PlannedConditionImplementationContract;
  scriptText: string;
  runCommand: string;
  testCommand: string;
}): ExperimentDesignImplementationValidationFinding[] {
  const findings: ExperimentDesignImplementationValidationFinding[] = [];
  const implementationSignal = `${input.runCommand}\n${input.testCommand}\n${input.scriptText}`;
  const requiredMarkers = dedupeStrings(input.contract.required_condition_markers || []);
  const baselineMarker = input.contract.baseline_condition_marker || requiredMarkers[0];
  if (requiredMarkers.length > 0) {
    const missingMarkers = requiredMarkers.filter((marker) => !hasMarkerSignal(implementationSignal, marker));
    if (missingMarkers.length > 0) {
      findings.push({
        code: "PLANNED_CONDITION_MARKERS_MISSING",
        severity: "block",
        message: "The implementation surface does not preserve all required planned condition markers.",
        evidence: `missing=${missingMarkers.join(", ")}; required=${requiredMarkers.join(", ")}`
      });
    }
  }

  if (baselineMarker && requiredMarkers.length > 1) {
    const declaredMarkerOrder = extractDeclaredConditionMarkerOrder(input.scriptText);
    if (declaredMarkerOrder.length > 1 && declaredMarkerOrder[0] !== baselineMarker) {
      findings.push({
        code: "PLANNED_BASELINE_ORDER_MISMATCH",
        severity: "block",
        message: "The implementation exposes a planned condition order that does not put the locked baseline first.",
        evidence: `first=${declaredMarkerOrder[0]}; baseline=${baselineMarker}`
      });
    }
  }

  const requiredConditionCount = normalizePositiveInteger(input.contract.required_condition_count);
  if (requiredConditionCount !== undefined) {
    const declaredConditionCount = extractDeclaredConditionCount(implementationSignal, requiredMarkers);
    if (declaredConditionCount !== undefined && declaredConditionCount < requiredConditionCount) {
      findings.push({
        code: "PLANNED_CONDITION_COUNT_CONTRACTED",
        severity: "block",
        message: "The implementation declares fewer conditions than the approved design contract.",
        evidence: `declared=${declaredConditionCount}; required=${requiredConditionCount}`
      });
    }
  }

  const seedSchedule = (input.contract.seed_schedule || [])
    .map((seed) => normalizePositiveInteger(seed))
    .filter((seed): seed is number => seed !== undefined);
  if (seedSchedule.length > 1) {
    const missingSeeds = seedSchedule.filter((seed) => !hasNumberSignal(implementationSignal, seed));
    if (missingSeeds.length > 0) {
      findings.push({
        code: "PLANNED_SEED_SCHEDULE_MISSING",
        severity: "block",
        message: "The implementation surface does not preserve the planned repeated-seed schedule.",
        evidence: `missing=${missingSeeds.join(", ")}; required=${seedSchedule.join(", ")}`
      });
    }
  }

  const requiredRunCount = normalizePositiveInteger(input.contract.required_run_count);
  if (requiredRunCount !== undefined) {
    const declaredRunCount = extractDeclaredRunCount(implementationSignal);
    const inferredRunCount =
      requiredMarkers.length > 0 && seedSchedule.length > 0 ? requiredMarkers.length * seedSchedule.length : undefined;
    const bestVisibleRunCount = Math.max(declaredRunCount || 0, inferredRunCount || 0) || undefined;
    if (bestVisibleRunCount !== undefined && bestVisibleRunCount < requiredRunCount) {
      findings.push({
        code: "PLANNED_RUN_COUNT_CONTRACTED",
        severity: "block",
        message: "The implementation exposes fewer condition-by-seed runs than the approved design contract.",
        evidence: `visible=${bestVisibleRunCount}; required=${requiredRunCount}`
      });
    }
  }

  return findings;
}

function hasMarkerSignal(text: string, marker: string): boolean {
  const escaped = escapeRegExp(marker);
  const flexible = escaped.replace(/_/gu, "[_\\s.-]*");
  return new RegExp(`(?:^|[^A-Za-z0-9])${flexible}(?:$|[^A-Za-z0-9])`, "iu").test(text);
}

function hasNumberSignal(text: string, value: number): boolean {
  return new RegExp(`(?:^|[^0-9])${escapeRegExp(String(value))}(?:$|[^0-9])`, "u").test(text);
}

function extractDeclaredConditionCount(text: string, requiredMarkers: string[]): number | undefined {
  const counts: number[] = [];
  for (const match of text.matchAll(
    /\b(?:required|planned|locked)?_?condition_?count\b\s*[:=]\s*(\d+)/giu
  )) {
    const parsed = normalizePositiveInteger(Number.parseInt(match[1] || "", 10));
    if (parsed !== undefined) {
      counts.push(parsed);
    }
  }
  if (requiredMarkers.length > 0) {
    const visibleMarkerCount = requiredMarkers.filter((marker) => hasMarkerSignal(text, marker)).length;
    if (visibleMarkerCount > 0) {
      counts.push(visibleMarkerCount);
    }
  }
  return counts.length > 0 ? Math.max(...counts) : undefined;
}

function extractDeclaredRunCount(text: string): number | undefined {
  const counts: number[] = [];
  for (const match of text.matchAll(/\b(?:required|planned|total)?_?run_?count\b\s*[:=]\s*(\d+)/giu)) {
    const parsed = normalizePositiveInteger(Number.parseInt(match[1] || "", 10));
    if (parsed !== undefined) {
      counts.push(parsed);
    }
  }
  for (const match of text.matchAll(/\b(?:train\/eval|train[-\s]?eval|train[-\s]?and[-\s]?eval)\s+jobs?\b\s*[:=]\s*(\d+)/giu)) {
    const parsed = normalizePositiveInteger(Number.parseInt(match[1] || "", 10));
    if (parsed !== undefined) {
      counts.push(parsed);
    }
  }
  return counts.length > 0 ? Math.max(...counts) : undefined;
}

function extractDeclaredConditionMarkerOrder(text: string): string[] {
  const assignments = [
    ...text.matchAll(
      /\b(?:PLANNED_CONDITION_MARKERS|LOCKED_CONDITION_MARKERS|CONDITION_MARKERS|LOCKED_CONDITION_ORDER)\b\s*=\s*(?:\(|\[)([\s\S]*?)(?:\)|\])/gu
    )
  ];
  for (const assignment of assignments) {
    const body = assignment[1] || "";
    const markers = extractRankDropoutMarkersFromText(body);
    if (markers.length > 0) {
      return markers;
    }
  }
  return extractRankDropoutMarkersFromText(text);
}

function extractRankDropoutMarkersFromText(text: string): string[] {
  const markers: string[] = [];
  for (const match of text.matchAll(/\brank_(\d+)_dropout_([0-9_]+)\b/giu)) {
    const marker = `rank_${match[1]}_dropout_${match[2]}`;
    if (!markers.includes(marker)) {
      markers.push(marker);
    }
  }
  return markers;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

async function readImplementationSurfaceText(scriptPath: string | undefined): Promise<string> {
  const directText = await safeReadText(scriptPath);
  if (!scriptPath || !/\.sh$/iu.test(scriptPath) || !directText) {
    return directText;
  }
  const wrapperDir = path.dirname(scriptPath);
  const referencedPaths = extractCommandPaths(directText, wrapperDir)
    .filter((candidate) => !samePath(candidate, scriptPath) && isRunnableScript(candidate));
  const targetTexts: string[] = [];
  for (const referencedPath of referencedPaths) {
    const targetText = await safeReadText(referencedPath);
    if (targetText) {
      targetTexts.push(targetText);
    }
  }
  return [directText, ...targetTexts].join("\n");
}

function extractCommandPaths(command: string, cwd: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const paths = new Set<string>();
  for (const token of tokens) {
    const value = expandShellPathToken(normalizeShellPathToken(token), cwd);
    if (!value) {
      continue;
    }
    if (!looksLikePath(value)) {
      continue;
    }
    paths.add(path.normalize(path.isAbsolute(value) ? value : path.resolve(cwd, value)));
  }
  return [...paths];
}

function expandShellPathToken(value: string | null, cwd: string): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/\$\{SCRIPT_DIR\}|\$SCRIPT_DIR/gu, cwd)
    .replace(/\$\{PWD\}|\$PWD/gu, cwd);
}

function normalizeShellPathToken(token: string): string | null {
  const value = token.replace(/^['"]|['"]$/g, "");
  const assignmentMatch = value.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/u);
  if (!assignmentMatch) {
    return value;
  }
  const rhs = assignmentMatch[2]?.replace(/^['"]|['"]$/g, "") || "";
  if (!rhs) {
    return null;
  }
  if (
    rhs.startsWith("./") ||
    rhs.startsWith("../") ||
    rhs.startsWith(path.sep) ||
    rhs.includes(path.sep) ||
    /\.(py|js|mjs|cjs|sh|json|yaml|yml|toml)$/iu.test(rhs)
  ) {
    return rhs;
  }
  return null;
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

async function findPublicRunCommandWrappers(publicDir: string, publicArtifacts: string[]): Promise<string[]> {
  const candidates = dedupeStrings([
    path.join(publicDir, "run_command.sh"),
    ...publicArtifacts.filter((artifactPath) => path.basename(artifactPath) === "run_command.sh")
  ]);
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

async function findUnsupportedWrapperScriptFlags(wrapperPath: string, scriptText: string): Promise<string[]> {
  if (!scriptText) {
    return [];
  }
  const wrapperText = await safeReadText(wrapperPath);
  if (!wrapperText) {
    return [];
  }
  const wrapperFlags = extractLongOptionFlags(wrapperText);
  if (wrapperFlags.length === 0) {
    return [];
  }
  const acceptedFlags = extractArgparseLongOptionFlags(scriptText);
  if (acceptedFlags.size === 0) {
    return [];
  }
  return wrapperFlags.filter((flag) => !acceptedFlags.has(flag));
}

function extractArgparseLongOptionFlags(scriptText: string): Set<string> {
  const flags = new Set<string>();
  for (const match of scriptText.matchAll(/\badd_argument\s*\(([\s\S]*?)\)/gu)) {
    for (const flagMatch of (match[1] || "").matchAll(/["'](--[A-Za-z0-9][A-Za-z0-9_-]*)["']/gu)) {
      flags.add(flagMatch[1]);
    }
  }
  return flags;
}

function extractLongOptionFlags(text: string): string[] {
  const flags: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s"'`])(--[A-Za-z0-9][A-Za-z0-9_-]*)(?=$|[\s"'`=])/gu)) {
    const flag = match[1];
    if (flag && !flags.includes(flag)) {
      flags.push(flag);
    }
  }
  return flags;
}

async function shellWrapperReferencesScriptPath(wrapperPath: string, scriptPath: string): Promise<boolean> {
  if (!/\.sh$/iu.test(wrapperPath)) {
    return false;
  }
  const wrapperText = await safeReadText(wrapperPath);
  if (!wrapperText) {
    return false;
  }
  const wrapperDir = path.dirname(wrapperPath);
  const referencedPaths = extractCommandPaths(wrapperText, wrapperDir).filter((candidate) => !samePath(candidate, wrapperPath));
  return referencedPaths.some((candidate) => samePath(candidate, scriptPath));
}

async function missingSameNamedScriptReference(referencedPath: string, scriptPath: string): Promise<boolean> {
  if (path.basename(referencedPath) !== path.basename(scriptPath)) {
    return false;
  }
  if (samePath(referencedPath, scriptPath)) {
    return true;
  }
  const [referencedExists, scriptExists] = await Promise.all([pathExists(referencedPath), pathExists(scriptPath)]);
  return !referencedExists && scriptExists;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
