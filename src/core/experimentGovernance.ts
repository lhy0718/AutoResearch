import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";

import { RunRecord } from "../types.js";
import { ObjectiveMetricProfile, normalizeObjectiveMetricProfile } from "./objectiveMetric.js";
import { AnalysisConditionComparison, AnalysisReport } from "./resultAnalysis.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import { safeRead, writeRunArtifact } from "./nodes/helpers.js";
import { normalizeFsPath } from "../utils/fs.js";
import type { ExperimentDesignImplementationValidationReport } from "./experiments/designImplementationValidator.js";

export const EXPERIMENT_GOVERNANCE_CONTRACT_KEY = "experiment_governance.comparison_contract";
export const EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY =
  "experiment_governance.implementation_context";
export const EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_KEY =
  "experiment_governance.baseline_snapshot";
export const EXPERIMENT_GOVERNANCE_LATEST_DECISION_KEY = "experiment_governance.latest_decision";
export const EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_KEY =
  "experiment_governance.managed_bundle_lock";
export const EXPERIMENT_GOVERNANCE_DRIFT_REPORT_KEY = "experiment_governance.drift_report";
export const EXPERIMENT_GOVERNANCE_CANDIDATE_ISOLATION_REPORT_KEY =
  "experiment_governance.candidate_isolation_report";
export const EXPERIMENT_GOVERNANCE_DESIGN_IMPLEMENTATION_VALIDATION_KEY =
  "experiment_governance.design_implementation_validation";

export const EXPERIMENT_GOVERNANCE_DIR = "experiment_governance";
export const EXPERIMENT_GOVERNANCE_CONTRACT_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "comparison_contract.json"
);
export const EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "implementation_context.json"
);
export const EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "baseline_snapshot.json"
);
export const EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "ledger.json"
);
export const EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "managed_bundle_lock.json"
);
export const EXPERIMENT_GOVERNANCE_DRIFT_REPORT_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "drift_report.json"
);
export const EXPERIMENT_GOVERNANCE_CANDIDATE_ISOLATION_REPORT_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "candidate_isolation_report.json"
);
export const EXPERIMENT_GOVERNANCE_DESIGN_IMPLEMENTATION_VALIDATION_ARTIFACT = path.join(
  EXPERIMENT_GOVERNANCE_DIR,
  "design_implementation_validation.json"
);

export type CandidateIsolationStrategy = "attempt_snapshot_restore" | "attempt_worktree";

export interface ExperimentBudgetProfile {
  mode: "managed_standard" | "single_run_locked";
  locked: true;
  timeout_sec: number;
  profile_name?: "standard";
  max_workers?: number;
  repeats?: number;
  prompt_variants?: number;
  tasks_per_dataset?: number;
  dataset_count?: number;
  total_trials?: number;
  supplemental_profiles?: string[];
}

export interface FrozenObjectiveProfile {
  source: ObjectiveMetricProfile["source"];
  raw: string;
  primaryMetric?: string;
  preferredMetricKeys: string[];
  direction?: ObjectiveMetricProfile["direction"];
  comparator?: ObjectiveMetricProfile["comparator"];
  targetValue?: number;
  targetDescription?: string;
}

export interface ExperimentComparisonContract {
  version: 1;
  run_id: string;
  plan_id: string;
  hypothesis_id?: string;
  selected_hypothesis_ids: string[];
  objective_metric_name: string;
  baseline_first_required: boolean;
  baseline_candidate_ids: string[];
  comparison_mode: "baseline_first_locked" | "objective_only";
  budget_profile: ExperimentBudgetProfile;
  objective_profile: FrozenObjectiveProfile;
  evaluator_contract_id: string;
  created_at: string;
}

export interface ExperimentImplementationContext {
  version: 1;
  candidate_id: string;
  parent_candidate_id?: string | null;
  candidate_isolation: {
    strategy: "branch_focus_patch_summary" | CandidateIsolationStrategy;
    requested_strategy?: CandidateIsolationStrategy;
    fallback_from?: CandidateIsolationStrategy;
    fallback_reason?: string;
    branch_id?: string;
    focus_files: string[];
    changed_files: string[];
    thread_id?: string;
    restored_attempts?: number;
    snapshot_root?: string;
    worktree_path?: string;
    cleanup_status?: "completed" | "failed" | "skipped";
    orphaned_residue_detected?: boolean;
  };
  code_state_ref: {
    strategy: "branch_focus_patch_summary";
    branch_id?: string;
    focus_files: string[];
    changed_files: string[];
    script_path?: string;
    run_command?: string;
    test_command?: string;
    working_dir?: string;
  };
  updated_at: string;
}

export interface ExperimentBaselineSnapshot {
  version: 1;
  snapshot_id: string;
  plan_id: string;
  baseline_candidate_id: string;
  primary_candidate_id: string;
  baseline_condition: string;
  primary_condition: string;
  metric_key: string;
  objective_metric_name: string;
  baseline_value: number;
  primary_value: number;
  budget_profile: ExperimentBudgetProfile;
  evaluator_contract_id: string;
  created_at: string;
}

export interface ExperimentDependencyFingerprint {
  scope: "bundle" | "workspace";
  kind:
    | "package_manifest"
    | "package_lockfile"
    | "python_manifest"
    | "python_lockfile"
    | "environment_manifest";
  path: string;
  hash: string;
}

export interface ExperimentManagedBundleLock {
  version: 2;
  environment_lock_version: number;
  plan_id: string;
  objective_metric_name: string;
  evaluator_contract_id: string;
  contract_binding_id: string;
  budget_profile: ExperimentBudgetProfile;
  public_dir: string;
  sampling_profile_name: "standard";
  total_trials?: number;
  script_hash: string;
  config_hash: string;
  benchmark_tasks_hash: string;
  prompts_hash: string;
  evaluator_hash: string;
  environment_hash: string;
  dependency_surface_hash: string;
  runtime_profile_fingerprint: string;
  dependency_fingerprints: ExperimentDependencyFingerprint[];
  lock_source_scope: {
    public_dir: string;
    workspace_root?: string;
    dependency_files: string[];
  };
  collected_at_stage: "run_experiments" | "analyze_results";
  environment_signature: {
    python?: string;
    platform?: string;
    implementation?: string;
    provider?: string;
    model?: string;
    reasoning_effort?: string;
    fast_mode?: boolean;
  };
  locked_at: string;
}

export interface ExperimentDriftFinding {
  kind:
    | "evaluator_drift"
    | "environment_drift"
    | "dependency_drift"
    | "prompt_or_task_drift"
    | "trial_shape_drift"
    | "unverifiable_lock";
  field: string;
  severity: "block" | "warn";
  detail: string;
}

export interface ExperimentManagedBundleDriftReport {
  version: 1;
  plan_id?: string;
  evaluator_contract_id?: string;
  status: "validated" | "drifted" | "unverifiable";
  verdict: "allow" | "block";
  summary: string;
  findings: ExperimentDriftFinding[];
  drift_fields: string[];
  checked_at: string;
  locked_at?: string;
  public_dir?: string;
  lock_source_scope?: ExperimentManagedBundleLock["lock_source_scope"];
  collected_at_stage?: ExperimentManagedBundleLock["collected_at_stage"];
}

export interface CandidateIsolationAttemptReport {
  attempt: number;
  requested_strategy: CandidateIsolationStrategy;
  effective_strategy: CandidateIsolationStrategy;
  fallback_from?: CandidateIsolationStrategy;
  fallback_reason?: string;
  workspace_root: string;
  isolated_workspace_root?: string;
  snapshot_root?: string;
  worktree_path?: string;
  restored_paths?: string[];
  restored_after_failure?: boolean;
  cleanup_status?: "completed" | "failed" | "skipped";
  cleanup_notes?: string[];
  orphaned_residue_paths: string[];
  started_at?: string;
  finished_at?: string;
}

export interface CandidateIsolationReport {
  version: 1;
  run_id: string;
  requested_strategy: CandidateIsolationStrategy;
  final_strategy: CandidateIsolationStrategy;
  fallback_occurred?: boolean;
  attempts: CandidateIsolationAttemptReport[];
  updated_at: string;
}

export interface ExperimentLedgerEntry {
  candidate_id: string;
  parent_candidate_id?: string | null;
  hypothesis_id?: string | null;
  plan_id: string;
  code_state_ref: ExperimentImplementationContext["code_state_ref"];
  budget_profile: ExperimentBudgetProfile;
  objective_metric_name: string;
  observed_value: number | null;
  verdict: "keep" | "discard" | "crash";
  rationale: string;
  resource_usage: Record<string, unknown>;
  timestamp: string;
}

export interface ExperimentLedgerStore {
  version: 1;
  run_id: string;
  updated_at: string;
  entries: ExperimentLedgerEntry[];
}

export interface GovernedAnalysisDecision {
  baselineSnapshot?: ExperimentBaselineSnapshot;
  baselineEntry?: ExperimentLedgerEntry;
  candidateEntry: ExperimentLedgerEntry;
  transitionOverride?: {
    targetNode: "design_experiments" | "implement_experiments";
    rationale: string;
  };
}

export interface ManagedBundleValidation {
  ok: boolean;
  rationale: string;
  drift_fields?: string[];
  report: ExperimentManagedBundleDriftReport;
}

export function buildExperimentComparisonContract(input: {
  run: Pick<RunRecord, "id" | "objectiveMetric">;
  selectedDesign: {
    id: string;
    hypothesis_ids: string[];
    baselines: string[];
  };
  objectiveProfile: ObjectiveMetricProfile;
  managedBundleSupported: boolean;
  createdAt?: string;
}): ExperimentComparisonContract {
  const createdAt = input.createdAt || new Date().toISOString();
  const baselineIds = dedupeStrings(
    input.selectedDesign.baselines.map((item) => toBaselineCandidateId(input.selectedDesign.id, item))
  );
  const comparisonMode = baselineIds.length > 0 ? "baseline_first_locked" : "objective_only";
  const contract: ExperimentComparisonContract = {
    version: 1,
    run_id: input.run.id,
    plan_id: input.selectedDesign.id,
    hypothesis_id: input.selectedDesign.hypothesis_ids[0],
    selected_hypothesis_ids: [...input.selectedDesign.hypothesis_ids],
    objective_metric_name: input.run.objectiveMetric,
    baseline_first_required: baselineIds.length > 0,
    baseline_candidate_ids: baselineIds,
    comparison_mode: comparisonMode,
    budget_profile: buildBudgetProfile(input.managedBundleSupported),
    objective_profile: freezeObjectiveProfile(input.objectiveProfile),
    evaluator_contract_id: "",
    created_at: createdAt
  };

  contract.evaluator_contract_id = hashToId("eval", {
    plan_id: contract.plan_id,
    objective_profile: contract.objective_profile,
    budget_profile: contract.budget_profile
  });
  return contract;
}

export function buildExperimentImplementationContext(input: {
  contract: ExperimentComparisonContract;
  branchPlan?: {
    branch_id?: string;
    focus_files?: string[];
  };
  changedFiles: string[];
  scriptPath?: string;
  runCommand?: string;
  testCommand?: string;
  workingDir?: string;
  threadId?: string;
  candidateIsolationStrategy?: ExperimentImplementationContext["candidate_isolation"]["strategy"];
  requestedCandidateIsolationStrategy?: CandidateIsolationStrategy;
  fallbackFrom?: CandidateIsolationStrategy;
  fallbackReason?: string;
  restoredAttempts?: number;
  snapshotRoot?: string;
  worktreePath?: string;
  cleanupStatus?: ExperimentImplementationContext["candidate_isolation"]["cleanup_status"];
  orphanedResidueDetected?: boolean;
  updatedAt?: string;
}): ExperimentImplementationContext {
  const focusFiles = dedupeStrings(input.branchPlan?.focus_files || []);
  const changedFiles = dedupeStrings(input.changedFiles);
  return {
    version: 1,
    candidate_id: toPrimaryCandidateId(input.contract.plan_id),
    parent_candidate_id: input.contract.baseline_candidate_ids[0] || null,
    candidate_isolation: {
      strategy: input.candidateIsolationStrategy || "branch_focus_patch_summary",
      requested_strategy: input.requestedCandidateIsolationStrategy,
      fallback_from: input.fallbackFrom,
      fallback_reason: input.fallbackReason,
      branch_id: input.branchPlan?.branch_id,
      focus_files: focusFiles,
      changed_files: changedFiles,
      thread_id: input.threadId,
      restored_attempts:
        typeof input.restoredAttempts === "number" && input.restoredAttempts > 0
          ? input.restoredAttempts
          : undefined,
      snapshot_root: cleanString(input.snapshotRoot),
      worktree_path: cleanString(input.worktreePath),
      cleanup_status: input.cleanupStatus,
      orphaned_residue_detected: input.orphanedResidueDetected === true ? true : undefined
    },
    code_state_ref: {
      strategy: "branch_focus_patch_summary",
      branch_id: input.branchPlan?.branch_id,
      focus_files: focusFiles,
      changed_files: changedFiles,
      script_path: input.scriptPath,
      run_command: input.runCommand,
      test_command: input.testCommand,
      working_dir: input.workingDir
    },
    updated_at: input.updatedAt || new Date().toISOString()
  };
}

export function buildCrashLedgerEntry(input: {
  contract?: ExperimentComparisonContract;
  implementationContext?: ExperimentImplementationContext;
  objectiveMetricName: string;
  rationale: string;
  resourceUsage: Record<string, unknown>;
  timestamp?: string;
}): ExperimentLedgerEntry {
  const timestamp = input.timestamp || new Date().toISOString();
  const planId = input.contract?.plan_id || "unknown_plan";
  const candidateId = input.implementationContext?.candidate_id || toPrimaryCandidateId(planId);
  return {
    candidate_id: candidateId,
    parent_candidate_id:
      input.implementationContext?.parent_candidate_id || input.contract?.baseline_candidate_ids[0] || null,
    hypothesis_id: input.contract?.hypothesis_id || null,
    plan_id: planId,
    code_state_ref:
      input.implementationContext?.code_state_ref || {
        strategy: "branch_focus_patch_summary",
        focus_files: [],
        changed_files: []
      },
    budget_profile: input.contract?.budget_profile || buildBudgetProfile(false),
    objective_metric_name: input.contract?.objective_metric_name || input.objectiveMetricName,
    observed_value: null,
    verdict: "crash",
    rationale: oneLine(input.rationale),
    resource_usage: input.resourceUsage,
    timestamp
  };
}

export function deriveGovernedAnalysisDecision(input: {
  report: AnalysisReport;
  contract: ExperimentComparisonContract;
  implementationContext?: ExperimentImplementationContext;
  managedBundleValidation?: ManagedBundleValidation;
}): GovernedAnalysisDecision | undefined {
  const resourceUsage = buildAnalysisResourceUsage(input.report, input.contract.budget_profile);
  if (input.managedBundleValidation && !input.managedBundleValidation.ok) {
    const implementationContext =
      input.implementationContext ||
      buildExperimentImplementationContext({
        contract: input.contract,
        changedFiles: []
      });
    return {
      candidateEntry: {
        candidate_id: implementationContext.candidate_id,
        parent_candidate_id: implementationContext.parent_candidate_id || null,
        hypothesis_id: input.contract.hypothesis_id || null,
        plan_id: input.contract.plan_id,
        code_state_ref: implementationContext.code_state_ref,
        budget_profile: input.contract.budget_profile,
        objective_metric_name: input.contract.objective_metric_name,
        observed_value: input.report.overview.observed_value ?? null,
        verdict: "discard",
        rationale: oneLine(input.managedBundleValidation.rationale),
        resource_usage: {
          ...resourceUsage,
          managed_bundle_validation: input.managedBundleValidation.report
        },
        timestamp: new Date().toISOString()
      },
      transitionOverride: {
        targetNode: "implement_experiments",
        rationale: oneLine(input.managedBundleValidation.rationale)
      }
    };
  }
  if (!input.contract.baseline_first_required) {
    return undefined;
  }

  // When no condition comparisons exist from condition_metrics (typical of
  // complete factorial designs where all conditions run in one script), the
  // baseline-first governance cannot ground a comparison.  Rather than forcing
  // a backtrack loop, skip governance and let the standard transition
  // recommendation (which already checks objective status) decide.
  const metricsComparisons = input.report.condition_comparisons.filter(
    (c) => c.source === "metrics.condition_metrics"
  );
  if (metricsComparisons.length === 0) {
    return undefined;
  }

  const implementationContext =
    input.implementationContext ||
    buildExperimentImplementationContext({
      contract: input.contract,
      changedFiles: []
    });
  const comparisonMetric = pickComparisonMetric(input.report);

  if (hasBudgetMismatch(input.report, input.contract.budget_profile)) {
    const rationale = buildBudgetMismatchRationale(input.report, input.contract.budget_profile);
    return {
      candidateEntry: {
        candidate_id: implementationContext.candidate_id,
        parent_candidate_id: implementationContext.parent_candidate_id || null,
        hypothesis_id: input.contract.hypothesis_id || null,
        plan_id: input.contract.plan_id,
        code_state_ref: implementationContext.code_state_ref,
        budget_profile: input.contract.budget_profile,
        objective_metric_name: input.contract.objective_metric_name,
        observed_value: input.report.overview.observed_value ?? null,
        verdict: "discard",
        rationale,
        resource_usage: resourceUsage,
        timestamp: new Date().toISOString()
      },
      transitionOverride: {
        targetNode: "implement_experiments",
        rationale
      }
    };
  }

  if (!comparisonMetric) {
    const rationale =
      "Baseline-first comparison could not be grounded from the primary run artifacts, so the candidate cannot be kept under the locked comparison contract.";
    return {
      candidateEntry: {
        candidate_id: implementationContext.candidate_id,
        parent_candidate_id: implementationContext.parent_candidate_id || null,
        hypothesis_id: input.contract.hypothesis_id || null,
        plan_id: input.contract.plan_id,
        code_state_ref: implementationContext.code_state_ref,
        budget_profile: input.contract.budget_profile,
        objective_metric_name: input.contract.objective_metric_name,
        observed_value: input.report.overview.observed_value ?? null,
        verdict: "discard",
        rationale,
        resource_usage: resourceUsage,
        timestamp: new Date().toISOString()
      },
      transitionOverride: {
        targetNode: "implement_experiments",
        rationale
      }
    };
  }

  const primaryCondition =
    cleanString(asString(input.report.metrics.primary_condition)) ||
    parseConditionPair(comparisonMetric.comparison.id).primary ||
    "primary";
  const baselineCondition =
    cleanString(asString(input.report.metrics.baseline_condition)) ||
    parseConditionPair(comparisonMetric.comparison.id).baseline ||
    "baseline";
  const baselineCandidateId =
    input.contract.baseline_candidate_ids[0] || toBaselineCandidateId(input.contract.plan_id, baselineCondition);
  const primaryCandidateId = implementationContext.candidate_id;
  const improved = isStrictImprovement(
    comparisonMetric.metric.primary_value as number,
    comparisonMetric.metric.baseline_value as number,
    input.contract.objective_profile.direction
  );
  const snapshotCreatedAt = new Date().toISOString();
  const baselineSnapshot: ExperimentBaselineSnapshot = {
    version: 1,
    snapshot_id: hashToId("baseline", {
      plan_id: input.contract.plan_id,
      metric_key: comparisonMetric.metric.key,
      primary_condition: primaryCondition,
      baseline_condition: baselineCondition,
      primary_value: comparisonMetric.metric.primary_value,
      baseline_value: comparisonMetric.metric.baseline_value
    }),
    plan_id: input.contract.plan_id,
    baseline_candidate_id: baselineCandidateId,
    primary_candidate_id: primaryCandidateId,
    baseline_condition: baselineCondition,
    primary_condition: primaryCondition,
    metric_key: comparisonMetric.metric.key,
    objective_metric_name: input.contract.objective_metric_name,
    baseline_value: comparisonMetric.metric.baseline_value as number,
    primary_value: comparisonMetric.metric.primary_value as number,
    budget_profile: input.contract.budget_profile,
    evaluator_contract_id: input.contract.evaluator_contract_id,
    created_at: snapshotCreatedAt
  };
  const baselineEntry: ExperimentLedgerEntry = {
    candidate_id: baselineCandidateId,
    parent_candidate_id: null,
    hypothesis_id: input.contract.hypothesis_id || null,
    plan_id: input.contract.plan_id,
    code_state_ref: implementationContext.code_state_ref,
    budget_profile: input.contract.budget_profile,
    objective_metric_name: input.contract.objective_metric_name,
    observed_value: comparisonMetric.metric.baseline_value as number,
    verdict: "keep",
    rationale: oneLine(
      `Locked baseline snapshot fixed ${baselineCondition} at ${formatMetricValue(
        comparisonMetric.metric.baseline_value as number
      )} for ${comparisonMetric.metric.key}.`
    ),
    resource_usage: resourceUsage,
    timestamp: snapshotCreatedAt
  };
  const candidateRationale = improved
    ? `Locked baseline comparison passed: ${primaryCondition} improved ${comparisonMetric.metric.key} from ${formatMetricValue(
        comparisonMetric.metric.baseline_value as number
      )} to ${formatMetricValue(comparisonMetric.metric.primary_value as number)}.`
    : `Locked baseline comparison failed: ${primaryCondition} did not improve ${comparisonMetric.metric.key} over ${baselineCondition} (${formatMetricValue(
        comparisonMetric.metric.primary_value as number
      )} vs ${formatMetricValue(comparisonMetric.metric.baseline_value as number)}).`;
  return {
    baselineSnapshot,
    baselineEntry,
    candidateEntry: {
      candidate_id: primaryCandidateId,
      parent_candidate_id: baselineCandidateId,
      hypothesis_id: input.contract.hypothesis_id || null,
      plan_id: input.contract.plan_id,
      code_state_ref: implementationContext.code_state_ref,
      budget_profile: input.contract.budget_profile,
      objective_metric_name: input.contract.objective_metric_name,
      observed_value: comparisonMetric.metric.primary_value as number,
      verdict: improved ? "keep" : "discard",
      rationale: oneLine(candidateRationale),
      resource_usage: resourceUsage,
      timestamp: snapshotCreatedAt
    },
    transitionOverride: improved
      ? undefined
      : {
          targetNode: "design_experiments",
          rationale: oneLine(candidateRationale)
        }
  };
}

export function getGovernedObjectiveProfile(
  contract: ExperimentComparisonContract | undefined,
  rawObjectiveMetric: string
): ObjectiveMetricProfile | undefined {
  if (!contract) {
    return undefined;
  }
  return normalizeObjectiveMetricProfile(contract.objective_profile, rawObjectiveMetric);
}

export async function writeExperimentGovernanceJson(
  run: Pick<RunRecord, "id">,
  relativePath: string,
  value: unknown
): Promise<string> {
  return writeRunArtifact(run as RunRecord, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readExperimentGovernanceJson<T>(
  run: Pick<RunRecord, "id">,
  relativePath: string
): Promise<T | undefined> {
  const raw = await safeRead(path.join(".autolabos", "runs", run.id, relativePath));
  if (!raw.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function appendExperimentLedgerEntries(
  run: Pick<RunRecord, "id">,
  entries: ExperimentLedgerEntry[]
): Promise<ExperimentLedgerStore> {
  const existing =
    (await readExperimentGovernanceJson<ExperimentLedgerStore>(run, EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT)) || {
      version: 1,
      run_id: run.id,
      updated_at: new Date().toISOString(),
      entries: []
    };
  const next: ExperimentLedgerStore = {
    version: 1,
    run_id: run.id,
    updated_at: new Date().toISOString(),
    entries: [...existing.entries, ...entries]
  };
  await writeExperimentGovernanceJson(run, EXPERIMENT_GOVERNANCE_LEDGER_ARTIFACT, next);
  return next;
}

export async function loadExperimentComparisonContract(
  run: Pick<RunRecord, "id">,
  runContext: RunContextMemory
): Promise<ExperimentComparisonContract | undefined> {
  return (
    (await runContext.get<ExperimentComparisonContract>(EXPERIMENT_GOVERNANCE_CONTRACT_KEY)) ||
    (await readExperimentGovernanceJson<ExperimentComparisonContract>(
      run,
      EXPERIMENT_GOVERNANCE_CONTRACT_ARTIFACT
    ))
  );
}

export async function loadExperimentImplementationContext(
  run: Pick<RunRecord, "id">,
  runContext: RunContextMemory
): Promise<ExperimentImplementationContext | undefined> {
  return (
    (await runContext.get<ExperimentImplementationContext>(
      EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY
    )) ||
    (await readExperimentGovernanceJson<ExperimentImplementationContext>(
      run,
      EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_ARTIFACT
    ))
  );
}

export async function loadExperimentManagedBundleLock(
  run: Pick<RunRecord, "id">,
  runContext: RunContextMemory
): Promise<ExperimentManagedBundleLock | undefined> {
  return (
    (await runContext.get<ExperimentManagedBundleLock>(EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_KEY)) ||
    (await readExperimentGovernanceJson<ExperimentManagedBundleLock>(
      run,
      EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_ARTIFACT
    ))
  );
}

export async function storeExperimentGovernanceDecision(
  run: Pick<RunRecord, "id">,
  runContext: RunContextMemory,
  input: {
    contract?: ExperimentComparisonContract;
    implementationContext?: ExperimentImplementationContext;
    baselineSnapshot?: ExperimentBaselineSnapshot;
    managedBundleLock?: ExperimentManagedBundleLock;
    driftReport?: ExperimentManagedBundleDriftReport;
    candidateIsolationReport?: CandidateIsolationReport;
    designImplementationValidation?: ExperimentDesignImplementationValidationReport;
    entries: ExperimentLedgerEntry[];
  }
): Promise<void> {
  if (input.contract) {
    await writeExperimentGovernanceJson(run, EXPERIMENT_GOVERNANCE_CONTRACT_ARTIFACT, input.contract);
    await runContext.put(EXPERIMENT_GOVERNANCE_CONTRACT_KEY, input.contract);
  }
  if (input.implementationContext) {
    await writeExperimentGovernanceJson(
      run,
      EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_ARTIFACT,
      input.implementationContext
    );
    await runContext.put(EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY, input.implementationContext);
  }
  if (input.baselineSnapshot) {
    await writeExperimentGovernanceJson(
      run,
      EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_ARTIFACT,
      input.baselineSnapshot
    );
    await runContext.put(EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_KEY, input.baselineSnapshot);
  }
  if (input.managedBundleLock) {
    await writeExperimentGovernanceJson(
      run,
      EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_ARTIFACT,
      input.managedBundleLock
    );
    await runContext.put(EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_KEY, input.managedBundleLock);
  }
  if (input.driftReport) {
    await writeExperimentGovernanceJson(
      run,
      EXPERIMENT_GOVERNANCE_DRIFT_REPORT_ARTIFACT,
      input.driftReport
    );
    await runContext.put(EXPERIMENT_GOVERNANCE_DRIFT_REPORT_KEY, input.driftReport);
  }
  if (input.candidateIsolationReport) {
    await writeExperimentGovernanceJson(
      run,
      EXPERIMENT_GOVERNANCE_CANDIDATE_ISOLATION_REPORT_ARTIFACT,
      input.candidateIsolationReport
    );
    await runContext.put(
      EXPERIMENT_GOVERNANCE_CANDIDATE_ISOLATION_REPORT_KEY,
      input.candidateIsolationReport
    );
  }
  if (input.designImplementationValidation) {
    await writeExperimentGovernanceJson(
      run,
      EXPERIMENT_GOVERNANCE_DESIGN_IMPLEMENTATION_VALIDATION_ARTIFACT,
      input.designImplementationValidation
    );
    await runContext.put(
      EXPERIMENT_GOVERNANCE_DESIGN_IMPLEMENTATION_VALIDATION_KEY,
      input.designImplementationValidation
    );
  }
  const ledger = await appendExperimentLedgerEntries(run, input.entries);
  const latest = input.entries.at(-1);
  if (latest) {
    await runContext.put(EXPERIMENT_GOVERNANCE_LATEST_DECISION_KEY, {
      candidate_id: latest.candidate_id,
      verdict: latest.verdict,
      rationale: latest.rationale,
      timestamp: latest.timestamp,
      ledger_count: ledger.entries.length
    });
  }
}

export async function freezeManagedBundleLock(input: {
  contract: ExperimentComparisonContract;
  publicDir?: string;
  workspaceRoot?: string;
  lockedAt?: string;
  collectedAtStage?: "run_experiments" | "analyze_results";
}): Promise<ExperimentManagedBundleLock | undefined> {
  if (input.contract.budget_profile.mode !== "managed_standard") {
    return undefined;
  }
  const publicDir = cleanString(input.publicDir);
  if (!publicDir) {
    return undefined;
  }
  const normalizedPublicDir = normalizeFsPath(publicDir);
  const scriptPath = path.join(normalizedPublicDir, "run_experiment.py");
  const configPath = path.join(normalizedPublicDir, "experiment_config.json");
  const tasksPath = path.join(normalizedPublicDir, "benchmark_tasks.json");
  const promptsPath = path.join(normalizedPublicDir, "prompts.json");
  const evaluatorPath = path.join(normalizedPublicDir, "evaluator_manifest.json");
  const environmentPath = path.join(normalizedPublicDir, "environment.lock.json");
  for (const filePath of [scriptPath, configPath, tasksPath, promptsPath, evaluatorPath, environmentPath]) {
    try {
      await fs.access(filePath);
    } catch {
      return undefined;
    }
  }

  const [scriptBytes, config, tasks, prompts, evaluator, environment] = await Promise.all([
    fs.readFile(scriptPath),
    readJsonFile(configPath),
    readJsonFile(tasksPath),
    readJsonFile(promptsPath),
    readJsonFile(evaluatorPath),
    readJsonFile(environmentPath)
  ]);
  const environmentSignature = sanitizeEnvironmentLock(environment);
  const dependencyFingerprints = await collectDependencyFingerprints({
    workspaceRoot: input.workspaceRoot,
    publicDir: normalizedPublicDir
  });
  const dependencySurfaceHash = hashCanonicalJson(
    dependencyFingerprints.map((item) => ({
      scope: item.scope,
      kind: item.kind,
      path: item.path,
      hash: item.hash
    }))
  );
  const runtimeProfileFingerprint = hashCanonicalJson({
    environment_signature: environmentSignature,
    dependency_surface_hash: dependencySurfaceHash,
    config_surface: extractManagedBundleConfigSurface(config)
  });
  const environmentLockVersion = asNumber(asRecord(environment)?.version) || 1;

  return {
    version: 2,
    environment_lock_version: environmentLockVersion,
    plan_id: input.contract.plan_id,
    objective_metric_name: input.contract.objective_metric_name,
    evaluator_contract_id: input.contract.evaluator_contract_id,
    contract_binding_id: buildManagedBundleBindingId(input.contract),
    budget_profile: input.contract.budget_profile,
    public_dir: normalizedPublicDir,
    sampling_profile_name: "standard",
    total_trials: input.contract.budget_profile.total_trials,
    script_hash: hashBytes(scriptBytes),
    config_hash: hashCanonicalJson(extractManagedBundleConfigSurface(config)),
    benchmark_tasks_hash: hashCanonicalJson(tasks),
    prompts_hash: hashCanonicalJson(prompts),
    evaluator_hash: hashCanonicalJson(evaluator),
    environment_hash: hashCanonicalJson(environmentSignature),
    dependency_surface_hash: dependencySurfaceHash,
    runtime_profile_fingerprint: runtimeProfileFingerprint,
    dependency_fingerprints: dependencyFingerprints,
    lock_source_scope: {
      public_dir: normalizedPublicDir,
      workspace_root: cleanString(input.workspaceRoot) ? normalizeFsPath(input.workspaceRoot as string) : undefined,
      dependency_files: dependencyFingerprints.map((item) => item.path)
    },
    collected_at_stage: input.collectedAtStage || "run_experiments",
    environment_signature: environmentSignature,
    locked_at: input.lockedAt || new Date().toISOString()
  };
}

export async function validateManagedBundleLock(input: {
  contract?: ExperimentComparisonContract;
  managedBundleLock?: ExperimentManagedBundleLock;
  implementationContext?: ExperimentImplementationContext;
  metrics?: Record<string, unknown>;
  publicDir?: string;
  workspaceRoot?: string;
}): Promise<ManagedBundleValidation | undefined> {
  if (!input.contract || input.contract.budget_profile.mode !== "managed_standard") {
    return undefined;
  }
  if (!input.managedBundleLock) {
    const report = buildDriftReport({
      planId: input.contract.plan_id,
      evaluatorContractId: input.contract.evaluator_contract_id,
      publicDir: input.publicDir,
      collectedAtStage: "run_experiments",
      status: "unverifiable",
      findings: [
        {
          kind: "unverifiable_lock",
          field: "managed_bundle_lock",
          severity: "block",
          detail:
            "No immutable managed bundle lock was captured from the primary standard run."
        }
      ]
    });
    return {
      ok: false,
      rationale: report.summary,
      drift_fields: ["managed_bundle_lock"],
      report
    };
  }
  if (input.managedBundleLock.contract_binding_id !== buildManagedBundleBindingId(input.contract)) {
    const report = buildDriftReport({
      planId: input.contract.plan_id,
      evaluatorContractId: input.contract.evaluator_contract_id,
      publicDir: input.managedBundleLock.public_dir,
      lockedAt: input.managedBundleLock.locked_at,
      lockSourceScope: input.managedBundleLock.lock_source_scope,
      collectedAtStage: input.managedBundleLock.collected_at_stage,
      status: "unverifiable",
      findings: [
        {
          kind: "unverifiable_lock",
          field: "contract_binding_id",
          severity: "block",
          detail:
            "The frozen evaluator lock no longer matches the active comparison contract."
        }
      ]
    });
    return {
      ok: false,
      rationale: report.summary,
      drift_fields: ["contract_binding_id"],
      report
    };
  }

  const currentLock = await freezeManagedBundleLock({
    contract: input.contract,
    publicDir: input.publicDir || input.managedBundleLock.public_dir,
    workspaceRoot: input.managedBundleLock.lock_source_scope.workspace_root || input.workspaceRoot,
    lockedAt: input.managedBundleLock.locked_at,
    collectedAtStage: input.managedBundleLock.collected_at_stage
  });
  if (!currentLock) {
    const report = buildDriftReport({
      planId: input.contract.plan_id,
      evaluatorContractId: input.contract.evaluator_contract_id,
      publicDir: input.publicDir || input.managedBundleLock.public_dir,
      lockedAt: input.managedBundleLock.locked_at,
      lockSourceScope: input.managedBundleLock.lock_source_scope,
      collectedAtStage: input.managedBundleLock.collected_at_stage,
      status: "unverifiable",
      findings: [
        {
          kind: "unverifiable_lock",
          field: "bundle_artifacts",
          severity: "block",
          detail:
            "One or more immutable evaluator artifacts are missing from the managed bundle."
        }
      ]
    });
    return {
      ok: false,
      rationale: report.summary,
      drift_fields: ["bundle_artifacts"],
      report
    };
  }

  const findings = classifyManagedBundleDrift(
    input.managedBundleLock,
    currentLock,
    input.implementationContext
  );
  const samplingProfile = asRecord(input.metrics?.sampling_profile);
  const observedProfileName = cleanString(asString(samplingProfile?.name));
  if (observedProfileName && observedProfileName !== input.managedBundleLock.sampling_profile_name) {
    findings.push({
      kind: "trial_shape_drift",
      field: "sampling_profile.name",
      severity: "block",
      detail: `Observed sampling profile ${observedProfileName} did not match the locked standard profile.`
    });
  }
  const expectedTrials = input.managedBundleLock.total_trials;
  const observedTrials = asNumber(samplingProfile?.total_trials);
  if (
    typeof expectedTrials === "number" &&
    typeof observedTrials === "number" &&
    observedTrials !== expectedTrials
  ) {
    findings.push({
      kind: "trial_shape_drift",
      field: "sampling_profile.total_trials",
      severity: "block",
      detail: `Observed standard-run trial count ${observedTrials} did not match locked budget ${expectedTrials}.`
    });
  }

  const report = buildDriftReport({
    planId: input.contract.plan_id,
    evaluatorContractId: input.contract.evaluator_contract_id,
    publicDir: input.managedBundleLock.public_dir,
    lockedAt: input.managedBundleLock.locked_at,
    lockSourceScope: input.managedBundleLock.lock_source_scope,
    collectedAtStage: input.managedBundleLock.collected_at_stage,
    status: findings.some((item) => item.severity === "block") ? "drifted" : "validated",
    findings
  });

  return {
    ok: report.verdict === "allow",
    rationale: report.summary,
    drift_fields: findings.map((item) => item.field),
    report
  };
}

function buildBudgetProfile(managedBundleSupported: boolean): ExperimentBudgetProfile {
  if (!managedBundleSupported) {
    return {
      mode: "single_run_locked",
      locked: true,
      timeout_sec: 1800
    };
  }
  return {
    mode: "managed_standard",
    locked: true,
    timeout_sec: 1800,
    profile_name: "standard",
    max_workers: 2,
    repeats: 2,
    prompt_variants: 2,
    tasks_per_dataset: 2,
    dataset_count: 3,
    total_trials: 48,
    supplemental_profiles: ["quick_check", "confirmatory"]
  };
}

function freezeObjectiveProfile(profile: ObjectiveMetricProfile): FrozenObjectiveProfile {
  return {
    source: profile.source,
    raw: profile.raw,
    primaryMetric: profile.primaryMetric,
    preferredMetricKeys: [...profile.preferredMetricKeys],
    direction: profile.direction,
    comparator: profile.comparator,
    targetValue: profile.targetValue,
    targetDescription: profile.targetDescription
  };
}

function hashToId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12)}`;
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJsonValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function buildManagedBundleBindingId(contract: ExperimentComparisonContract): string {
  return hashToId("bundle", {
    plan_id: contract.plan_id,
    baseline_candidate_ids: contract.baseline_candidate_ids,
    objective_profile: contract.objective_profile,
    budget_profile: contract.budget_profile,
    evaluator_contract_id: contract.evaluator_contract_id
  });
}

function extractManagedBundleConfigSurface(value: unknown): Record<string, unknown> {
  const record = asRecord(value) || {};
  const execution = asRecord(record.execution);
  const sampling = asRecord(record.sampling);
  return {
    experiment_mode: record.experiment_mode,
    llm_profile: record.llm_profile,
    execution: execution
      ? {
          max_workers: execution.max_workers,
          role_overrides: execution.role_overrides
        }
      : undefined,
    sampling: sampling
      ? {
          standard: asRecord(sampling.standard) || sampling.standard
        }
      : undefined,
    conditions: record.conditions,
    token_limit: record.token_limit,
    timeout_sec: record.timeout_sec,
    allow_network: record.allow_network
  };
}

function sanitizeEnvironmentLock(
  value: unknown
): ExperimentManagedBundleLock["environment_signature"] {
  const record = asRecord(value) || {};
  return {
    python: asString(record.python),
    platform: asString(record.platform),
    implementation: asString(record.implementation),
    provider: asString(record.provider),
    model: asString(record.model),
    reasoning_effort: asString(record.reasoning_effort),
    fast_mode: asBoolean(record.fast_mode)
  };
}

async function collectDependencyFingerprints(input: {
  publicDir: string;
  workspaceRoot?: string;
}): Promise<ExperimentDependencyFingerprint[]> {
  const results: ExperimentDependencyFingerprint[] = [];
  for (const candidate of dependencyFingerprintCandidates(input.publicDir, input.workspaceRoot)) {
    const normalizedPath = normalizeFsPath(candidate.absolutePath);
    try {
      const stat = await fs.stat(normalizedPath);
      if (!stat.isFile()) {
        continue;
      }
      results.push({
        kind: candidate.kind,
        scope: candidate.scope,
        path: candidate.relativeLabel,
        hash: hashBytes(await fs.readFile(normalizedPath))
      });
    } catch {
      continue;
    }
  }
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

function dependencyFingerprintCandidates(publicDir: string, workspaceRoot?: string): Array<{
  scope: "bundle" | "workspace";
  kind: ExperimentDependencyFingerprint["kind"];
  absolutePath: string;
  relativeLabel: string;
}> {
  const bundleFiles: Array<{
    kind: ExperimentDependencyFingerprint["kind"];
    fileName: string;
  }> = [
    { kind: "package_manifest", fileName: "package.json" },
    { kind: "package_lockfile", fileName: "package-lock.json" },
    { kind: "package_lockfile", fileName: "pnpm-lock.yaml" },
    { kind: "package_lockfile", fileName: "yarn.lock" },
    { kind: "package_lockfile", fileName: "bun.lockb" },
    { kind: "package_lockfile", fileName: "bun.lock" },
    { kind: "python_manifest", fileName: "requirements.txt" },
    { kind: "python_manifest", fileName: "requirements-dev.txt" },
    { kind: "python_manifest", fileName: "requirements.lock" },
    { kind: "python_manifest", fileName: "pyproject.toml" },
    { kind: "python_manifest", fileName: "Pipfile" },
    { kind: "python_lockfile", fileName: "Pipfile.lock" },
    { kind: "python_lockfile", fileName: "poetry.lock" },
    { kind: "python_lockfile", fileName: "uv.lock" },
    { kind: "environment_manifest", fileName: "environment.yml" },
    { kind: "environment_manifest", fileName: "environment.yaml" },
    { kind: "environment_manifest", fileName: "conda-lock.yml" },
    { kind: "environment_manifest", fileName: "conda-lock.yaml" },
    { kind: "python_manifest", fileName: "setup.py" },
    { kind: "python_manifest", fileName: "setup.cfg" }
  ];
  const candidates: Array<{
    scope: ExperimentDependencyFingerprint["scope"];
    kind: ExperimentDependencyFingerprint["kind"];
    absolutePath: string;
    relativeLabel: string;
  }> = bundleFiles.map((entry) => ({
    scope: "bundle",
    kind: entry.kind,
    absolutePath: path.join(publicDir, entry.fileName),
    relativeLabel: `bundle/${entry.fileName}`
  }));
  const normalizedWorkspaceRoot = cleanString(workspaceRoot);
  if (normalizedWorkspaceRoot) {
    for (const entry of bundleFiles) {
      candidates.push({
        scope: "workspace",
        kind: entry.kind,
        absolutePath: path.join(normalizedWorkspaceRoot, entry.fileName),
        relativeLabel: `workspace/${entry.fileName}`
      });
    }
  }
  return candidates;
}

function classifyManagedBundleDrift(
  expected: ExperimentManagedBundleLock,
  observed: ExperimentManagedBundleLock,
  implementationContext?: ExperimentImplementationContext
): ExperimentDriftFinding[] {
  const findings: ExperimentDriftFinding[] = [];
  if (expected.evaluator_hash !== observed.evaluator_hash) {
    findings.push({
      kind: "evaluator_drift",
      field: "evaluator_hash",
      severity: "block",
      detail: "Evaluator manifest changed after the lock was captured."
    });
  }
  const promptOrTaskFields: string[] = [];
  if (expected.script_hash !== observed.script_hash) {
    promptOrTaskFields.push("script_hash");
  }
  if (expected.config_hash !== observed.config_hash) {
    promptOrTaskFields.push("config_hash");
  }
  if (expected.benchmark_tasks_hash !== observed.benchmark_tasks_hash) {
    promptOrTaskFields.push("benchmark_tasks_hash");
  }
  if (expected.prompts_hash !== observed.prompts_hash) {
    promptOrTaskFields.push("prompts_hash");
  }
  if (promptOrTaskFields.length > 0) {
    findings.push({
      kind: "prompt_or_task_drift",
      field: promptOrTaskFields.join(","),
      severity: "block",
      detail: "Managed runner code, prompt surface, task set, or locked config changed after the standard run."
    });
  }
  const environmentFields: string[] = [];
  if (expected.environment_hash !== observed.environment_hash) {
    environmentFields.push("environment_hash");
  }
  if (expected.environment_lock_version !== observed.environment_lock_version) {
    environmentFields.push("environment_lock_version");
  }
  if (environmentFields.length > 0) {
    findings.push({
      kind: "environment_drift",
      field: environmentFields.join(","),
      severity: "block",
      detail: "Runtime environment signature changed after the lock was captured."
    });
  }
  const dependencyDiff = diffDependencyFingerprints(
    expected.dependency_fingerprints,
    observed.dependency_fingerprints
  );
  if (dependencyDiff.length > 0) {
    const workspaceRoot =
      cleanString(expected.lock_source_scope.workspace_root) ||
      cleanString(observed.lock_source_scope.workspace_root);
    const bundleDiffs = dependencyDiff.filter((item) => item.scope === "bundle");
    const workspaceDiffs = dependencyDiff.filter((item) => item.scope === "workspace");
    if (bundleDiffs.length > 0) {
      findings.push({
        kind: "dependency_drift",
        field: "dependency_fingerprints",
        severity: "block",
        detail: `Dependency manifest or lockfile surface changed after the standard run (${bundleDiffs
          .map((item) => item.path)
          .slice(0, 4)
          .join(", ")}${bundleDiffs.length > 4 ? ", ..." : ""}).`
      });
    }
    if (workspaceDiffs.length > 0) {
      const relevantWorkspaceDiffs = workspaceDiffs.filter((item) =>
        isRelevantWorkspaceDependencyDiff(item.path, workspaceRoot, implementationContext)
      );
      const severity: ExperimentDriftFinding["severity"] =
        relevantWorkspaceDiffs.length > 0 || !workspaceRoot || !implementationContext ? "block" : "warn";
      findings.push({
        kind: "dependency_drift",
        field: "dependency_fingerprints",
        severity,
        detail:
          severity === "block"
            ? `Workspace dependency surface changed on a relevant execution path (${workspaceDiffs
                .map((item) => item.path)
                .slice(0, 4)
                .join(", ")}${workspaceDiffs.length > 4 ? ", ..." : ""}).`
            : `Workspace dependency surface changed outside the candidate execution surface (${workspaceDiffs
                .map((item) => item.path)
                .slice(0, 4)
                .join(", ")}${workspaceDiffs.length > 4 ? ", ..." : ""}).`
      });
    }
  } else if (expected.dependency_surface_hash !== observed.dependency_surface_hash) {
    findings.push({
      kind: "dependency_drift",
      field: "dependency_surface_hash",
      severity: "block",
      detail: "Dependency manifest or lockfile surface changed after the standard run."
    });
  }
  if (
    expected.runtime_profile_fingerprint !== observed.runtime_profile_fingerprint &&
    environmentFields.length === 0 &&
    dependencyDiff.length === 0 &&
    expected.dependency_surface_hash === observed.dependency_surface_hash
  ) {
    findings.push({
      kind: "dependency_drift",
      field: "runtime_profile_fingerprint",
      severity: "block",
      detail:
        "Runtime dependency/profile fingerprint changed even though the comparison cohort is locked."
    });
  }
  return dedupeDriftFindings(findings);
}

function dedupeDriftFindings(findings: ExperimentDriftFinding[]): ExperimentDriftFinding[] {
  const seen = new Set<string>();
  const deduped: ExperimentDriftFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.field}:${finding.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function diffDependencyFingerprints(
  expected: ExperimentDependencyFingerprint[],
  observed: ExperimentDependencyFingerprint[]
): ExperimentDependencyFingerprint[] {
  const expectedByPath = new Map(expected.map((item) => [item.path, item]));
  const observedByPath = new Map(observed.map((item) => [item.path, item]));
  const changed = new Map<string, ExperimentDependencyFingerprint>();
  for (const [pathLabel, item] of expectedByPath.entries()) {
    if (observedByPath.get(pathLabel)?.hash !== item.hash) {
      changed.set(pathLabel, item);
    }
  }
  for (const [pathLabel, item] of observedByPath.entries()) {
    if (expectedByPath.get(pathLabel)?.hash !== item.hash) {
      changed.set(pathLabel, item);
    }
  }
  return [...changed.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function isRelevantWorkspaceDependencyDiff(
  pathLabel: string,
  workspaceRoot: string | undefined,
  implementationContext: ExperimentImplementationContext | undefined
): boolean {
  if (!workspaceRoot || !implementationContext) {
    return true;
  }
  const absolutePath = resolveDependencyFingerprintAbsolutePath(pathLabel, workspaceRoot);
  if (!absolutePath) {
    return true;
  }
  const dependencyDir = path.dirname(absolutePath);
  const codeState = implementationContext.code_state_ref;
  const relatedPaths = dedupeStrings([
    codeState.script_path,
    codeState.working_dir,
    ...codeState.focus_files,
    ...codeState.changed_files
  ]).map((value) => normalizeGovernancePath(value, workspaceRoot))
    .filter((value): value is string => Boolean(value));
  if (relatedPaths.some((value) => value === absolutePath)) {
    return true;
  }
  if (dependencyDir === normalizeFsPath(workspaceRoot)) {
    return relatedPaths.some((value) => normalizeFsPath(value) === normalizeFsPath(workspaceRoot));
  }
  return relatedPaths.some((value) => isPathInsideOrEqual(normalizeFsPath(value), dependencyDir));
}

function resolveDependencyFingerprintAbsolutePath(
  pathLabel: string,
  workspaceRoot: string
): string | undefined {
  if (!pathLabel.startsWith("workspace/")) {
    return undefined;
  }
  const relativePath = pathLabel.slice("workspace/".length);
  if (!relativePath) {
    return undefined;
  }
  return normalizeFsPath(path.join(workspaceRoot, relativePath));
}

function normalizeGovernancePath(value: string | undefined, workspaceRoot: string): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return undefined;
  }
  if (path.isAbsolute(cleaned)) {
    return normalizeFsPath(cleaned);
  }
  return normalizeFsPath(path.join(workspaceRoot, cleaned));
}

function isPathInsideOrEqual(filePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildDriftReport(input: {
  planId?: string;
  evaluatorContractId?: string;
  publicDir?: string;
  lockedAt?: string;
  lockSourceScope?: ExperimentManagedBundleLock["lock_source_scope"];
  collectedAtStage?: ExperimentManagedBundleLock["collected_at_stage"];
  status: ExperimentManagedBundleDriftReport["status"];
  findings: ExperimentDriftFinding[];
}): ExperimentManagedBundleDriftReport {
  const hasBlockingFindings = input.findings.some((item) => item.severity === "block");
  const hasWarningFindings = input.findings.some((item) => item.severity === "warn");
  const verdict = input.status === "validated" && !hasBlockingFindings ? "allow" : "block";
  const driftKinds = dedupeStrings(input.findings.map((item) => item.kind));
  const summary =
    input.status === "validated"
      ? hasWarningFindings
        ? `Managed bundle lock validated with warnings: ${input.findings
            .filter((item) => item.severity === "warn")
            .map((item) => item.detail)
            .join(" ")}`
        : "Managed bundle lock validated."
      : input.status === "unverifiable"
        ? `Managed bundle comparison could not be verified: ${input.findings.map((item) => item.detail).join(" ")}`
        : `Managed bundle comparison could not be kept because ${driftKinds.join(", ")} was detected: ${input.findings
            .map((item) => item.detail)
            .join(" ")}`;
  return {
    version: 1,
    plan_id: input.planId,
    evaluator_contract_id: input.evaluatorContractId,
    status: input.status,
    verdict,
    summary: oneLine(summary),
    findings: input.findings,
    drift_fields: input.findings.map((item) => item.field),
    checked_at: new Date().toISOString(),
    locked_at: input.lockedAt,
    public_dir: input.publicDir,
    lock_source_scope: input.lockSourceScope,
    collected_at_stage: input.collectedAtStage
  };
}

function toPrimaryCandidateId(planId: string): string {
  return `${planId}:primary`;
}

function toBaselineCandidateId(planId: string, baseline: string): string {
  return `${planId}:baseline:${slugify(baseline)}`;
}

function buildAnalysisResourceUsage(
  report: AnalysisReport,
  budgetProfile: ExperimentBudgetProfile
): Record<string, unknown> {
  return {
    budget_mode: budgetProfile.mode,
    executed_trials: report.statistical_summary.executed_trials,
    total_trials: report.statistical_summary.total_trials,
    cached_trials: report.statistical_summary.cached_trials,
    supplemental_profiles: report.supplemental_runs.map((item) => item.profile)
  };
}

function pickComparisonMetric(
  report: AnalysisReport
):
  | {
      comparison: AnalysisConditionComparison;
      metric: {
        key: string;
        value: number;
        primary_value?: number;
        baseline_value?: number;
      };
    }
  | undefined {
  const matchedMetricKey =
    report.objective_metric.evaluation.matchedMetricKey || report.overview.matched_metric_key;
  const conditionComparisons = report.condition_comparisons.filter(
    (item) => item.source === "metrics.condition_metrics"
  );
  for (const comparison of conditionComparisons) {
    const exact =
      comparison.metrics.find(
        (metric) =>
          metric.key === matchedMetricKey &&
          typeof metric.primary_value === "number" &&
          typeof metric.baseline_value === "number"
      ) ||
      comparison.metrics.find(
        (metric) =>
          typeof metric.primary_value === "number" &&
          typeof metric.baseline_value === "number"
      );
    if (exact) {
      return {
        comparison,
        metric: exact
      };
    }
  }
  return undefined;
}

function parseConditionPair(comparisonId: string): {
  primary?: string;
  baseline?: string;
} {
  const [primary, baseline] = comparisonId.split("_vs_");
  return {
    primary: cleanString(primary),
    baseline: cleanString(baseline)
  };
}

function isStrictImprovement(
  primaryValue: number,
  baselineValue: number,
  direction: ObjectiveMetricProfile["direction"]
): boolean {
  if (direction === "minimize") {
    return primaryValue < baselineValue;
  }
  return primaryValue > baselineValue;
}

function hasBudgetMismatch(report: AnalysisReport, budgetProfile: ExperimentBudgetProfile): boolean {
  if (budgetProfile.mode !== "managed_standard") {
    return false;
  }
  const expectedTrials = budgetProfile.total_trials;
  const observedTrials = report.statistical_summary.total_trials;
  if (typeof expectedTrials === "number" && typeof observedTrials === "number") {
    return observedTrials !== expectedTrials;
  }
  return false;
}

function buildBudgetMismatchRationale(
  report: AnalysisReport,
  budgetProfile: ExperimentBudgetProfile
): string {
  return oneLine(
    `Budget-locked comparison could not be validated because the observed primary trial count (${report.statistical_summary.total_trials ?? "unknown"}) did not match the locked budget (${budgetProfile.total_trials ?? "unknown"}).`
  );
}

function formatMetricValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "baseline";
}

function cleanString(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(normalizeFsPath(filePath), "utf8");
  return JSON.parse(raw) as unknown;
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((item) => cleanString(item || undefined)).filter((item): item is string => Boolean(item)))];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
