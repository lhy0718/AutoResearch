import { ExperimentBudgetProfile } from "./experimentGovernance.js";
import { ExperimentPortfolio } from "./experiments/experimentPortfolio.js";

type ExecutionStage = "resolve" | "preflight" | "command" | "metrics" | "supplemental";

export type RunExperimentsFailureCategory =
  | "policy_block"
  | "preflight_failure"
  | "command_failure"
  | "transient_command_failure"
  | "missing_metrics"
  | "invalid_metrics"
  | "supplemental_failure";

export interface RunExperimentsExecutionPlan {
  trigger: string;
  command: string;
  cwd: string;
  metrics_path: string;
  source: string;
  comparison_mode?: "baseline_first_locked" | "objective_only";
  budget_profile?: ExperimentBudgetProfile;
  evaluator_contract_id?: string;
  baseline_candidate_ids?: string[];
  preflight_command?: string;
  preflight_cwd?: string;
  managed_supplemental_profiles: Array<{
    profile: string;
    command: string;
    metrics_path: string;
  }>;
  portfolio?: {
    execution_model: ExperimentPortfolio["execution_model"];
    primary_trial_group_id: string;
    total_expected_trials?: number;
    trial_groups: Array<{
      id: string;
      label: string;
      role: "primary" | "supplemental";
      profile?: string;
      group_kind?: "aggregate" | "matrix_slice";
      source_trial_group_id?: string;
      matrix_axes?: Record<string, string>;
      expected_trials?: number;
    }>;
  };
  rerun_policy: {
    max_automatic_reruns: number;
  };
}

export interface RunExperimentsWatchdogState {
  metrics_path: string;
  previous_metrics_backup?: string;
  cleared_supplemental_outputs: string[];
  metrics_state: "not_checked" | "missing" | "present" | "invalid" | "valid";
  latest_log_file?: string;
  sentinel_findings: Array<{
    code: "nan_or_inf_metric" | "statistical_anomaly" | "citation_reliability_anomaly";
    severity: "warning" | "fail";
    message: string;
    requires_human_review: boolean;
    downgrade_to_unverified?: boolean;
  }>;
  supplemental_outputs: Array<{
    profile: string;
    status: "pass" | "fail" | "skipped";
    metrics_path: string;
  }>;
}

export interface RunExperimentsTriageAttempt {
  attempt: number;
  stage: ExecutionStage;
  category?: RunExperimentsFailureCategory;
  retryable: boolean;
  summary: string;
  command?: string;
  cwd?: string;
  exit_code?: number;
  log_file?: string;
  metrics_path?: string;
}

export interface RunExperimentsTriageReport {
  attempts: RunExperimentsTriageAttempt[];
  final_category?: RunExperimentsFailureCategory;
  watchdog: RunExperimentsWatchdogState;
}

export interface RunExperimentsRerunDecision {
  decision: "retry_once" | "fail_fast" | "not_needed";
  reason: string;
  next_attempt?: number;
}

export function buildRunExperimentsExecutionPlan(input: {
  trigger: string;
  command: string;
  cwd: string;
  metricsPath: string;
  source: string;
  comparisonMode?: "baseline_first_locked" | "objective_only";
  budgetProfile?: ExperimentBudgetProfile;
  evaluatorContractId?: string;
  baselineCandidateIds?: string[];
  testCommand?: string;
  testCwd?: string;
  portfolio?: ExperimentPortfolio;
  supplementalProfiles?: Array<{
    profile: string;
    command: string;
    metricsPath: string;
  }>;
}): RunExperimentsExecutionPlan {
  return {
    trigger: input.trigger,
    command: input.command,
    cwd: input.cwd,
    metrics_path: input.metricsPath,
    source: input.source,
    comparison_mode: input.comparisonMode,
    budget_profile: input.budgetProfile,
    evaluator_contract_id: input.evaluatorContractId,
    baseline_candidate_ids: input.baselineCandidateIds,
    preflight_command: input.testCommand,
    preflight_cwd: input.testCwd,
    managed_supplemental_profiles: (input.supplementalProfiles || []).map((profile) => ({
      profile: profile.profile,
      command: profile.command,
      metrics_path: profile.metricsPath
    })),
    portfolio: input.portfolio
      ? {
          execution_model: input.portfolio.execution_model,
          primary_trial_group_id: input.portfolio.primary_trial_group_id,
          total_expected_trials: input.portfolio.total_expected_trials,
          trial_groups: input.portfolio.trial_groups.map((group) => ({
            id: group.id,
            label: group.label,
            role: group.role,
            profile: group.profile,
            group_kind: group.group_kind,
            source_trial_group_id: group.source_trial_group_id,
            matrix_axes: group.matrix_axes,
            expected_trials: group.expected_trials
          }))
        }
      : undefined,
    rerun_policy: {
      max_automatic_reruns: 1
    }
  };
}

export function createRunExperimentsWatchdogState(input: {
  metricsPath: string;
  previousMetricsBackup?: string;
  clearedSupplementalOutputs?: string[];
}): RunExperimentsWatchdogState {
  return {
    metrics_path: input.metricsPath,
    previous_metrics_backup: input.previousMetricsBackup,
    cleared_supplemental_outputs: input.clearedSupplementalOutputs || [],
    metrics_state: "not_checked",
    sentinel_findings: [],
    supplemental_outputs: []
  };
}

export function classifyRunExperimentsFailure(input: {
  attempt: number;
  stage: ExecutionStage;
  summary: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  logFile?: string;
  metricsPath?: string;
  policyBlocked?: boolean;
}): RunExperimentsTriageAttempt {
  const category = resolveFailureCategory(input.stage, input.summary, input.policyBlocked === true);
  return {
    attempt: input.attempt,
    stage: input.stage,
    category,
    retryable: category === "transient_command_failure",
    summary: oneLine(input.summary),
    command: input.command,
    cwd: input.cwd,
    exit_code: input.exitCode,
    log_file: input.logFile,
    metrics_path: input.metricsPath
  };
}

export function decideRunExperimentsRerun(input: {
  triage: RunExperimentsTriageAttempt;
  automaticRerunsUsed: number;
  maxAutomaticReruns?: number;
}): RunExperimentsRerunDecision {
  if (input.triage.category !== "transient_command_failure") {
    return {
      decision: "fail_fast",
      reason: `The failure category ${input.triage.category || "unknown"} is not eligible for automatic reruns.`
    };
  }

  const maxAutomaticReruns = input.maxAutomaticReruns ?? 1;
  if (input.automaticRerunsUsed >= maxAutomaticReruns) {
    return {
      decision: "fail_fast",
      reason: "The automatic rerun limit for transient command failures is exhausted."
    };
  }

  return {
    decision: "retry_once",
    reason: "The command failure looks transient, so the primary command will be retried once.",
    next_attempt: input.triage.attempt + 1
  };
}

export function recordSupplementalOutputs(
  watchdog: RunExperimentsWatchdogState,
  outputs: Array<{
    profile: string;
    status: "pass" | "fail" | "skipped";
    metrics_path: string;
  }>
): RunExperimentsWatchdogState {
  return {
    ...watchdog,
    supplemental_outputs: outputs
  };
}

export function setMetricsState(
  watchdog: RunExperimentsWatchdogState,
  state: RunExperimentsWatchdogState["metrics_state"],
  latestLogFile?: string
): RunExperimentsWatchdogState {
  return {
    ...watchdog,
    metrics_state: state,
    latest_log_file: latestLogFile || watchdog.latest_log_file
  };
}

export function setSentinelFindings(
  watchdog: RunExperimentsWatchdogState,
  findings: RunExperimentsWatchdogState["sentinel_findings"]
): RunExperimentsWatchdogState {
  return {
    ...watchdog,
    sentinel_findings: findings
  };
}

export function finalizeRunExperimentsTriage(input: {
  attempts: RunExperimentsTriageAttempt[];
  watchdog: RunExperimentsWatchdogState;
}): RunExperimentsTriageReport {
  return {
    attempts: input.attempts,
    final_category: [...input.attempts].reverse().find((attempt) => attempt.category)?.category,
    watchdog: input.watchdog
  };
}

function resolveFailureCategory(
  stage: ExecutionStage,
  summary: string,
  policyBlocked: boolean
): RunExperimentsFailureCategory {
  if (policyBlocked) {
    return "policy_block";
  }
  if (stage === "preflight") {
    return "preflight_failure";
  }
  if (stage === "metrics" && /without metrics output|did not produce metrics/iu.test(summary)) {
    return "missing_metrics";
  }
  if (stage === "metrics") {
    return "invalid_metrics";
  }
  if (stage === "supplemental") {
    return "supplemental_failure";
  }
  if (looksTransient(summary)) {
    return "transient_command_failure";
  }
  return "command_failure";
}

function looksTransient(summary: string): boolean {
  return /timed out|timeout|temporarily unavailable|temporary failure|connection reset|connection aborted|econnreset|econnrefused|rate limit|try again|resource busy|killed|interrupted/iu.test(
    summary
  );
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
