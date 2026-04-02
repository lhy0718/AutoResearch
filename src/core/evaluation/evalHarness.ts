import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureScaffold, resolveAppPaths } from "../../config.js";
import { RunStore } from "../runs/runStore.js";
import { RunRecord } from "../../types.js";
import { fileExists, readJsonFile, writeJsonFile } from "../../utils/fs.js";
import { RunVerifierReport } from "../experiments/runVerifierFeedback.js";

export interface EvalHarnessOptions {
  cwd: string;
  runIds?: string[];
  limit?: number;
}

export interface EvalHarnessReport {
  version: 1;
  generated_at: string;
  workspace_root: string;
  selection: {
    mode: "explicit" | "latest";
    requested_run_ids: string[];
    evaluated_run_ids: string[];
    limit: number;
  };
  aggregate: {
    run_count: number;
    implementation_pass_rate: number;
    run_verifier_pass_rate: number;
    objective_met_rate: number;
    implementation_policy_block_rate: number;
    run_verifier_policy_block_rate: number;
    policy_blocked_run_rate: number;
    auto_handoff_rate: number;
    artifact_completeness_rate: number;
    avg_implement_attempts: number;
    avg_branch_count: number;
    avg_overall_score: number;
    policy_rule_counts: Array<{
      rule_id: string;
      count: number;
    }>;
  };
  runs: EvalHarnessRunReport[];
}

export interface EvalHarnessRunReport {
  run_id: string;
  title: string;
  topic: string;
  objective_metric: string;
  run_status: RunRecord["status"];
  current_node: RunRecord["currentNode"];
  updated_at: string;
  statuses: {
    implement: "pass" | "fail" | "deferred" | "missing";
    run_verifier: "pass" | "fail" | "missing";
    objective: string;
    analysis: "present" | "missing";
    paper: "present" | "missing";
  };
  metrics: {
    implement_attempt_count: number;
    branch_count: number;
    changed_file_count: number;
    auto_handoff_to_run_experiments: boolean;
    local_verify_status?: string;
    implement_failure_type?: string;
    implement_policy_rule_id?: string;
    run_verifier_stage?: string;
    run_verifier_policy_rule_id?: string;
    objective_status?: string;
    artifact_completeness_ratio: number;
    policy_blocked: boolean;
  };
  scores: {
    implementation: number;
    run_verifier: number;
    objective: number;
    artifacts: number;
    overall: number;
  };
  missing_artifacts: string[];
  findings: string[];
}

export interface EvalHarnessHistoryEntry {
  timestamp: string;
  run_id?: string;
  results: EvalHarnessReport;
}

interface ImplementResultArtifact {
  verify_report?: {
    status?: string;
    summary?: string;
    failure_type?: string;
    policy_rule_id?: string;
    policy_reason?: string;
  };
  attempt_count?: number;
  changed_files?: string[];
  auto_handoff_to_run_experiments?: boolean;
}

interface ImplementAttemptsArtifact {
  attempts?: Array<unknown>;
}

interface BranchSearchArtifact {
  branches?: Array<unknown>;
}

interface ObjectiveEvaluationArtifact {
  status?: string;
  summary?: string;
}

const EXPECTED_ARTIFACTS = [
  "implement_result.json",
  "implement_attempts.json",
  "verify_report.json",
  "branch_search_result.json",
  "run_experiments_verify_report.json",
  "objective_evaluation.json",
  "result_analysis.json",
  path.join("paper", "main.tex")
] as const;

export async function generateEvalHarnessReport(options: EvalHarnessOptions): Promise<EvalHarnessReport> {
  const paths = resolveAppPaths(options.cwd);
  await ensureScaffold(paths);
  const runStore = new RunStore(paths);
  const requestedRunIds = options.runIds || [];
  const limit = Math.max(1, options.limit || 10);
  const runs = await selectRuns(runStore, requestedRunIds, limit);
  const runReports = await Promise.all(runs.map((run) => evaluateRun(paths.runsDir, run)));

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    workspace_root: options.cwd,
    selection: {
      mode: requestedRunIds.length > 0 ? "explicit" : "latest",
      requested_run_ids: requestedRunIds,
      evaluated_run_ids: runReports.map((run) => run.run_id),
      limit
    },
    aggregate: buildAggregate(runReports),
    runs: runReports
  };
}

export async function writeEvalHarnessReport(
  report: EvalHarnessReport,
  outputPath: string
): Promise<{ jsonPath: string; markdownPath: string }> {
  await writeJsonFile(outputPath, report);
  const markdownPath = replaceExtension(outputPath, ".md");
  await fs.writeFile(markdownPath, renderEvalHarnessMarkdown(report), "utf8");
  return {
    jsonPath: outputPath,
    markdownPath
  };
}

export function resolveEvalHarnessHistoryPath(cwd: string): string {
  const paths = resolveAppPaths(cwd);
  return path.join(paths.outputsDir, "eval-harness", "history.jsonl");
}

export async function appendEvalHarnessHistoryEntry(
  cwd: string,
  report: EvalHarnessReport,
  runId?: string
): Promise<string> {
  const historyPath = resolveEvalHarnessHistoryPath(cwd);
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  const entry: EvalHarnessHistoryEntry = {
    timestamp: new Date().toISOString(),
    ...(runId ? { run_id: runId } : {}),
    results: report
  };
  await fs.appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf8");
  return historyPath;
}

export async function readEvalHarnessHistoryEntries(
  cwd: string,
  limit = 20
): Promise<EvalHarnessHistoryEntry[]> {
  const historyPath = resolveEvalHarnessHistoryPath(cwd);
  if (!(await fileExists(historyPath))) {
    return [];
  }
  const raw = await fs.readFile(historyPath, "utf8");
  const entries = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvalHarnessHistoryEntry);
  return entries.slice(Math.max(0, entries.length - Math.max(1, limit)));
}

export function renderEvalHarnessSummary(report: EvalHarnessReport): string {
  const lines = [
    `Eval harness completed for ${report.aggregate.run_count} run(s).`,
    `Implementation pass rate: ${formatPercent(report.aggregate.implementation_pass_rate)}`,
    `Run verifier pass rate: ${formatPercent(report.aggregate.run_verifier_pass_rate)}`,
    `Objective met rate: ${formatPercent(report.aggregate.objective_met_rate)}`,
    `Policy-blocked run rate: ${formatPercent(report.aggregate.policy_blocked_run_rate)}`,
    `Average overall score: ${report.aggregate.avg_overall_score.toFixed(3)}`
  ];
  if (report.aggregate.policy_rule_counts.length > 0) {
    lines.push(
      `Top policy rules: ${report.aggregate.policy_rule_counts
        .slice(0, 3)
        .map((item) => `${item.rule_id} (${item.count})`)
        .join(", ")}`
    );
  }

  const flagged = report.runs
    .filter((run) => run.scores.overall < 0.8 || run.findings.length > 0)
    .slice(0, 3);
  if (flagged.length > 0) {
    lines.push("Flagged runs:");
    for (const run of flagged) {
      lines.push(`- ${run.run_id} (${run.scores.overall.toFixed(3)}): ${run.findings[0] || "Needs review."}`);
    }
  }

  return lines.join("\n");
}

export function renderEvalHarnessMarkdown(report: EvalHarnessReport): string {
  const lines = [
    "# Eval Harness Report",
    "",
    `Generated at: ${report.generated_at}`,
    `Workspace: ${report.workspace_root}`,
    `Runs evaluated: ${report.aggregate.run_count}`,
    "",
    "## Aggregate",
    "",
    `- Implementation pass rate: ${formatPercent(report.aggregate.implementation_pass_rate)}`,
    `- Run verifier pass rate: ${formatPercent(report.aggregate.run_verifier_pass_rate)}`,
    `- Objective met rate: ${formatPercent(report.aggregate.objective_met_rate)}`,
    `- Implementation policy block rate: ${formatPercent(report.aggregate.implementation_policy_block_rate)}`,
    `- Run verifier policy block rate: ${formatPercent(report.aggregate.run_verifier_policy_block_rate)}`,
    `- Policy-blocked run rate: ${formatPercent(report.aggregate.policy_blocked_run_rate)}`,
    `- Auto handoff rate: ${formatPercent(report.aggregate.auto_handoff_rate)}`,
    `- Artifact completeness rate: ${formatPercent(report.aggregate.artifact_completeness_rate)}`,
    `- Average implement attempts: ${report.aggregate.avg_implement_attempts.toFixed(2)}`,
    `- Average branch count: ${report.aggregate.avg_branch_count.toFixed(2)}`,
    `- Average overall score: ${report.aggregate.avg_overall_score.toFixed(3)}`,
    "",
    "## Policy",
    "",
    ...(report.aggregate.policy_rule_counts.length > 0
      ? report.aggregate.policy_rule_counts.map((item) => `- ${item.rule_id}: ${item.count}`)
      : ["- No policy-blocked commands observed."]),
    "",
    "## Runs",
    "",
    "| Run | Implement | Run Verifier | Objective | Score | Notes |",
    "| --- | --- | --- | --- | ---: | --- |"
  ];

  for (const run of report.runs) {
    lines.push(
      `| ${run.run_id} | ${run.statuses.implement} | ${run.statuses.run_verifier} | ${run.statuses.objective} | ${run.scores.overall.toFixed(3)} | ${escapeMarkdownCell(run.findings[0] || "")} |`
    );
  }

  return lines.join("\n") + "\n";
}

async function selectRuns(runStore: RunStore, runIds: string[], limit: number): Promise<RunRecord[]> {
  if (runIds.length > 0) {
    const items = await Promise.all(runIds.map((runId) => runStore.getRun(runId)));
    return items.filter((run): run is RunRecord => Boolean(run));
  }

  const runs = await runStore.listRuns();
  return runs.slice(0, limit);
}

async function evaluateRun(runsDir: string, run: RunRecord): Promise<EvalHarnessRunReport> {
  const runDir = path.join(runsDir, run.id);
  const artifactPresence = await collectArtifactPresence(runDir);
  const implementResult = await readJsonIfExists<ImplementResultArtifact>(path.join(runDir, "implement_result.json"));
  const implementAttempts = await readJsonIfExists<ImplementAttemptsArtifact>(path.join(runDir, "implement_attempts.json"));
  const branchSearch = await readJsonIfExists<BranchSearchArtifact>(path.join(runDir, "branch_search_result.json"));
  const runVerifier = await readJsonIfExists<RunVerifierReport>(path.join(runDir, "run_experiments_verify_report.json"));
  const objectiveEvaluation = await readJsonIfExists<ObjectiveEvaluationArtifact>(path.join(runDir, "objective_evaluation.json"));

  const implementStatus = normalizeImplementStatus(implementResult?.verify_report?.status);
  const runVerifierStatus = normalizeRunVerifierStatus(runVerifier?.status);
  const objectiveStatus = normalizeString(objectiveEvaluation?.status) || "missing";
  const implementFailureType = normalizeString(implementResult?.verify_report?.failure_type);
  const implementPolicyRuleId =
    normalizeString(implementResult?.verify_report?.policy_rule_id) ||
    extractPolicyRuleId(implementResult?.verify_report?.summary);
  const runVerifierStage = normalizeString(runVerifier?.stage);
  const runVerifierPolicyRuleId =
    normalizeString(runVerifier?.policy_rule_id) ||
    extractPolicyRuleId(runVerifier?.summary, runVerifier?.stderr_excerpt, runVerifier?.stdout_excerpt);
  const analysisStatus = artifactPresence["result_analysis.json"] ? "present" : "missing";
  const paperStatus = artifactPresence[path.join("paper", "main.tex")] ? "present" : "missing";
  const implementAttemptCount = Math.max(
    asNumber(implementResult?.attempt_count),
    implementAttempts?.attempts?.length || 0
  );
  const branchCount = branchSearch?.branches?.length || 0;
  const changedFileCount = implementResult?.changed_files?.length || 0;
  const autoHandoff = implementResult?.auto_handoff_to_run_experiments === true;
  const artifactCompletenessRatio = ratio(
    Object.values(artifactPresence).filter(Boolean).length,
    EXPECTED_ARTIFACTS.length
  );
  const policyBlocked = implementFailureType === "policy" || runVerifierStage === "policy";

  const scores = {
    implementation: scoreImplementationStatus(implementStatus),
    run_verifier: scoreRunVerifierStatus(runVerifierStatus),
    objective: scoreObjectiveStatus(objectiveStatus),
    artifacts: round(artifactCompletenessRatio),
    overall: 0
  };
  scores.overall = round(
    scores.implementation * 0.35 +
      scores.run_verifier * 0.3 +
      scores.objective * 0.25 +
      scores.artifacts * 0.1
  );

  const missingArtifacts = EXPECTED_ARTIFACTS.filter((artifact) => !artifactPresence[artifact]);
  const findings = buildFindings({
    implementStatus,
    implementSummary: normalizeString(implementResult?.verify_report?.summary),
    runVerifierStatus,
    runVerifierSummary: normalizeString(runVerifier?.summary),
    objectiveStatus,
    objectiveSummary: normalizeString(objectiveEvaluation?.summary),
    missingArtifacts,
    implementAttemptCount,
    implementFailureType,
    implementPolicyRuleId,
    runVerifierStage,
    runVerifierPolicyRuleId
  });

  return {
    run_id: run.id,
    title: run.title,
    topic: run.topic,
    objective_metric: run.objectiveMetric,
    run_status: run.status,
    current_node: run.currentNode,
    updated_at: run.updatedAt,
    statuses: {
      implement: implementStatus,
      run_verifier: runVerifierStatus,
      objective: objectiveStatus,
      analysis: analysisStatus,
      paper: paperStatus
    },
    metrics: {
      implement_attempt_count: implementAttemptCount,
      branch_count: branchCount,
      changed_file_count: changedFileCount,
      auto_handoff_to_run_experiments: autoHandoff,
      local_verify_status: normalizeString(implementResult?.verify_report?.status),
      implement_failure_type: implementFailureType,
      implement_policy_rule_id: implementPolicyRuleId,
      run_verifier_stage: runVerifierStage,
      run_verifier_policy_rule_id: runVerifierPolicyRuleId,
      objective_status: objectiveStatus,
      artifact_completeness_ratio: round(artifactCompletenessRatio),
      policy_blocked: policyBlocked
    },
    scores,
    missing_artifacts: missingArtifacts,
    findings
  };
}

async function collectArtifactPresence(runDir: string): Promise<Record<(typeof EXPECTED_ARTIFACTS)[number], boolean>> {
  const entries = await Promise.all(
    EXPECTED_ARTIFACTS.map(async (artifact) => [artifact, await fileExists(path.join(runDir, artifact))] as const)
  );
  return Object.fromEntries(entries) as Record<(typeof EXPECTED_ARTIFACTS)[number], boolean>;
}

function buildAggregate(runReports: EvalHarnessRunReport[]): EvalHarnessReport["aggregate"] {
  return {
    run_count: runReports.length,
    implementation_pass_rate: averageRate(runReports, (run) => run.statuses.implement === "pass"),
    run_verifier_pass_rate: averageRate(runReports, (run) => run.statuses.run_verifier === "pass"),
    objective_met_rate: averageRate(runReports, (run) => run.statuses.objective === "met"),
    implementation_policy_block_rate: averageRate(runReports, (run) => run.metrics.implement_failure_type === "policy"),
    run_verifier_policy_block_rate: averageRate(runReports, (run) => run.metrics.run_verifier_stage === "policy"),
    policy_blocked_run_rate: averageRate(runReports, (run) => run.metrics.policy_blocked),
    auto_handoff_rate: averageRate(runReports, (run) => run.metrics.auto_handoff_to_run_experiments),
    artifact_completeness_rate: round(average(runReports.map((run) => run.metrics.artifact_completeness_ratio))),
    avg_implement_attempts: round(average(runReports.map((run) => run.metrics.implement_attempt_count))),
    avg_branch_count: round(average(runReports.map((run) => run.metrics.branch_count))),
    avg_overall_score: round(average(runReports.map((run) => run.scores.overall))),
    policy_rule_counts: countPolicyRules(runReports)
  };
}

function buildFindings(input: {
  implementStatus: EvalHarnessRunReport["statuses"]["implement"];
  implementSummary?: string;
  implementFailureType?: string;
  implementPolicyRuleId?: string;
  runVerifierStatus: EvalHarnessRunReport["statuses"]["run_verifier"];
  runVerifierSummary?: string;
  runVerifierStage?: string;
  runVerifierPolicyRuleId?: string;
  objectiveStatus: string;
  objectiveSummary?: string;
  missingArtifacts: string[];
  implementAttemptCount: number;
}): string[] {
  const findings: string[] = [];

  if (input.implementFailureType === "policy") {
    findings.push(
      input.implementPolicyRuleId
        ? `Implement verifier blocked by policy (${input.implementPolicyRuleId}).`
        : "Implement verifier blocked by policy."
    );
  } else if (input.implementStatus === "fail" && input.implementSummary) {
    findings.push(`Implement verifier failed: ${input.implementSummary}`);
  } else if (input.implementStatus === "deferred") {
    findings.push("Implement verifier deferred to run_experiments.");
  } else if (input.implementStatus === "missing") {
    findings.push("Missing implement_result.json; implementation stage could not be evaluated.");
  }

  if (input.runVerifierStage === "policy") {
    findings.push(
      input.runVerifierPolicyRuleId
        ? `Run verifier blocked by policy (${input.runVerifierPolicyRuleId}).`
        : "Run verifier blocked by policy."
    );
  } else if (input.runVerifierStatus === "fail" && input.runVerifierSummary) {
    findings.push(`Run verifier failed: ${input.runVerifierSummary}`);
  } else if (input.runVerifierStatus === "missing") {
    findings.push("Missing run_experiments_verify_report.json; second-stage verification could not be evaluated.");
  }

  if (input.objectiveStatus === "not_met" && input.objectiveSummary) {
    findings.push(`Objective metric not met: ${input.objectiveSummary}`);
  } else if (input.objectiveStatus === "missing") {
    findings.push("Objective metric evaluation is missing.");
  }

  if (input.implementAttemptCount > 1) {
    findings.push(`Implementation required ${input.implementAttemptCount} attempts.`);
  }

  if (input.missingArtifacts.length > 0) {
    findings.push(`Missing artifacts: ${input.missingArtifacts.join(", ")}`);
  }

  return findings.slice(0, 5);
}

function countPolicyRules(
  runReports: EvalHarnessRunReport[]
): EvalHarnessReport["aggregate"]["policy_rule_counts"] {
  const counts = new Map<string, number>();
  for (const run of runReports) {
    for (const ruleId of [
      run.metrics.implement_policy_rule_id,
      run.metrics.run_verifier_policy_rule_id
    ].filter((value): value is string => Boolean(value))) {
      counts.set(ruleId, (counts.get(ruleId) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([rule_id, count]) => ({ rule_id, count }));
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }
  try {
    return await readJsonFile<T>(filePath);
  } catch {
    return undefined;
  }
}

function normalizeImplementStatus(
  status: string | undefined
): EvalHarnessRunReport["statuses"]["implement"] {
  const normalized = normalizeString(status);
  if (normalized === "pass") {
    return "pass";
  }
  if (normalized === "fail") {
    return "fail";
  }
  if (normalized === "not_run") {
    return "deferred";
  }
  return "missing";
}

function normalizeRunVerifierStatus(
  status: string | undefined
): EvalHarnessRunReport["statuses"]["run_verifier"] {
  const normalized = normalizeString(status);
  if (normalized === "pass") {
    return "pass";
  }
  if (normalized === "fail") {
    return "fail";
  }
  return "missing";
}

function scoreImplementationStatus(status: EvalHarnessRunReport["statuses"]["implement"]): number {
  if (status === "pass") {
    return 1;
  }
  if (status === "deferred") {
    return 0.65;
  }
  return 0;
}

function scoreRunVerifierStatus(status: EvalHarnessRunReport["statuses"]["run_verifier"]): number {
  return status === "pass" ? 1 : 0;
}

function scoreObjectiveStatus(status: string): number {
  if (status === "met") {
    return 1;
  }
  if (status === "observed") {
    return 0.75;
  }
  if (status === "not_met") {
    return 0.25;
  }
  return 0;
}

function averageRate<T>(items: T[], predicate: (item: T) => boolean): number {
  if (items.length === 0) {
    return 0;
  }
  return round(items.filter(predicate).length / items.length);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractPolicyRuleId(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const match = normalizeString(value)?.match(/rule=([a-z0-9_]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
