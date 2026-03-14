import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";

import { RunRecord } from "../types.js";
import { ObjectiveMetricProfile, normalizeObjectiveMetricProfile } from "./objectiveMetric.js";
import { AnalysisConditionComparison, AnalysisReport } from "./resultAnalysis.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import { safeRead, writeRunArtifact } from "./nodes/helpers.js";
import { normalizeFsPath } from "../utils/fs.js";

export const EXPERIMENT_GOVERNANCE_CONTRACT_KEY = "experiment_governance.comparison_contract";
export const EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY = "experiment_governance.implementation_context";
export const EXPERIMENT_GOVERNANCE_BASELINE_SNAPSHOT_KEY = "experiment_governance.baseline_snapshot";
export const EXPERIMENT_GOVERNANCE_LATEST_DECISION_KEY = "experiment_governance.latest_decision";
export const EXPERIMENT_GOVERNANCE_MANAGED_BUNDLE_LOCK_KEY = "experiment_governance.managed_bundle_lock";

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
    strategy: "branch_focus_patch_summary" | "attempt_snapshot_restore";
    branch_id?: string;
    focus_files: string[];
    changed_files: string[];
    thread_id?: string;
    restored_attempts?: number;
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

export interface ExperimentManagedBundleLock {
  version: 1;
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
  const comparisonMode =
    baselineIds.length > 0 ? "baseline_first_locked" : "objective_only";
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
  restoredAttempts?: number;
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
      branch_id: input.branchPlan?.branch_id,
      focus_files: focusFiles,
      changed_files: changedFiles,
      thread_id: input.threadId,
      restored_attempts:
        typeof input.restoredAttempts === "number" && input.restoredAttempts > 0
          ? input.restoredAttempts
          : undefined
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
  const candidateId =
    input.implementationContext?.candidate_id || toPrimaryCandidateId(planId);
  return {
    candidate_id: candidateId,
    parent_candidate_id:
      input.implementationContext?.parent_candidate_id ||
      input.contract?.baseline_candidate_ids[0] ||
      null,
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
          managed_bundle_validation: {
            ok: false,
            drift_fields: input.managedBundleValidation.drift_fields || []
          }
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

  const implementationContext =
    input.implementationContext ||
    buildExperimentImplementationContext({
      contract: input.contract,
      changedFiles: []
    });
  const comparisonMetric = pickComparisonMetric(input.report);

  if (hasBudgetMismatch(input.report, input.contract.budget_profile)) {
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
        rationale: buildBudgetMismatchRationale(input.report, input.contract.budget_profile),
        resource_usage: resourceUsage,
        timestamp: new Date().toISOString()
      },
      transitionOverride: {
        targetNode: "implement_experiments",
        rationale: buildBudgetMismatchRationale(input.report, input.contract.budget_profile)
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
    input.contract.baseline_candidate_ids[0] ||
    toBaselineCandidateId(input.contract.plan_id, baselineCondition);
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
    await runContext.put(
      EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY,
      input.implementationContext
    );
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
  lockedAt?: string;
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
  return {
    version: 1,
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
    environment_signature: environmentSignature,
    locked_at: input.lockedAt || new Date().toISOString()
  };
}

export async function validateManagedBundleLock(input: {
  contract?: ExperimentComparisonContract;
  managedBundleLock?: ExperimentManagedBundleLock;
  metrics?: Record<string, unknown>;
  publicDir?: string;
}): Promise<ManagedBundleValidation | undefined> {
  if (!input.contract || input.contract.budget_profile.mode !== "managed_standard") {
    return undefined;
  }
  if (!input.managedBundleLock) {
    return {
      ok: false,
      rationale:
        "Managed bundle comparison could not be kept because no immutable evaluator/environment lock was captured from the primary standard run."
    };
  }
  if (input.managedBundleLock.contract_binding_id !== buildManagedBundleBindingId(input.contract)) {
    return {
      ok: false,
      rationale:
        "Managed bundle comparison could not be kept because the frozen evaluator lock no longer matches the active comparison contract.",
      drift_fields: ["contract_binding_id"]
    };
  }
  const currentLock = await freezeManagedBundleLock({
    contract: input.contract,
    publicDir: input.publicDir || input.managedBundleLock.public_dir,
    lockedAt: input.managedBundleLock.locked_at
  });
  if (!currentLock) {
    return {
      ok: false,
      rationale:
        "Managed bundle comparison could not be kept because one or more immutable evaluator artifacts are missing."
    };
  }
  const driftFields = compareManagedBundleLocks(input.managedBundleLock, currentLock);
  if (driftFields.length > 0) {
    return {
      ok: false,
      rationale: oneLine(
        `Managed bundle comparison could not be kept because the immutable evaluator contract drifted (${driftFields.join(
          ", "
        )}).`
      ),
      drift_fields: driftFields
    };
  }
  const samplingProfile = asRecord(input.metrics?.sampling_profile);
  const observedProfileName = cleanString(asString(samplingProfile?.name));
  if (observedProfileName && observedProfileName !== input.managedBundleLock.sampling_profile_name) {
    return {
      ok: false,
      rationale: oneLine(
        `Managed bundle comparison could not be kept because the observed sampling profile (${observedProfileName}) did not match the locked standard profile.`
      ),
      drift_fields: ["sampling_profile.name"]
    };
  }
  const expectedTrials = input.managedBundleLock.total_trials;
  const observedTrials = asNumber(samplingProfile?.total_trials);
  if (
    typeof expectedTrials === "number" &&
    typeof observedTrials === "number" &&
    observedTrials !== expectedTrials
  ) {
    return {
      ok: false,
      rationale: oneLine(
        `Managed bundle comparison could not be kept because the observed standard-run trial count (${observedTrials}) did not match the locked budget (${expectedTrials}).`
      ),
      drift_fields: ["sampling_profile.total_trials"]
    };
  }
  return {
    ok: true,
    rationale: "Managed bundle lock validated."
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

function sanitizeEnvironmentLock(value: unknown): ExperimentManagedBundleLock["environment_signature"] {
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

function compareManagedBundleLocks(
  expected: ExperimentManagedBundleLock,
  observed: ExperimentManagedBundleLock
): string[] {
  const driftFields: string[] = [];
  const fields: Array<keyof ExperimentManagedBundleLock> = [
    "script_hash",
    "config_hash",
    "benchmark_tasks_hash",
    "prompts_hash",
    "evaluator_hash",
    "environment_hash",
    "sampling_profile_name",
    "total_trials",
    "contract_binding_id"
  ];
  for (const field of fields) {
    if (expected[field] !== observed[field]) {
      driftFields.push(String(field));
    }
  }
  return driftFields;
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

function pickComparisonMetric(report: AnalysisReport):
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

function hasBudgetMismatch(
  report: AnalysisReport,
  budgetProfile: ExperimentBudgetProfile
): boolean {
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => cleanString(item)).filter((item): item is string => Boolean(item)))];
}

function cleanString(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(normalizeFsPath(filePath), "utf8")) as unknown;
}
