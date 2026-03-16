/**
 * Experiment contract: a small structured artifact capturing the causal
 * discipline for each experiment attempt.  Written by design_experiments,
 * consumed by run_experiments and analyze_results.
 *
 * Artifact path: .autolabos/runs/<run_id>/experiment_contract.json
 */

import { RunRecord } from "../../types.js";
import { writeRunArtifact, safeRead } from "../nodes/helpers.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface ExperimentContract {
  version: 1;
  run_id: string;
  created_at: string;

  /** The hypothesis being tested in plain language. */
  hypothesis: string;

  /** The proposed causal mechanism: why the change should cause the expected effect. */
  causal_mechanism: string;

  /**
   * The single independent variable being changed.
   * If more than one change is present the attempt is marked confounded.
   */
  single_change: string;

  /**
   * When true, the contract acknowledges that the attempt conflates
   * multiple independent changes and interpretation will be limited.
   */
  confounded: boolean;

  /** Optional list of additional changes when confounded is true. */
  additional_changes?: string[];

  /** The expected direction and rough magnitude of effect on the objective metric. */
  expected_metric_effect: string;

  /** Conditions under which the experiment should be stopped early. */
  abort_condition: string;

  /** Rule for deciding whether to keep or discard the result. */
  keep_or_discard_rule: string;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export interface BuildExperimentContractInput {
  run: RunRecord;
  hypothesis: string;
  causalMechanism: string;
  singleChange: string;
  additionalChanges?: string[];
  expectedMetricEffect: string;
  abortCondition: string;
  keepOrDiscardRule: string;
}

export function buildExperimentContract(input: BuildExperimentContractInput): ExperimentContract {
  const additionalChanges = (input.additionalChanges ?? []).filter(Boolean);
  const confounded = additionalChanges.length > 0;
  return {
    version: 1,
    run_id: input.run.id,
    created_at: new Date().toISOString(),
    hypothesis: input.hypothesis || "(not specified)",
    causal_mechanism: input.causalMechanism || "(not specified)",
    single_change: input.singleChange || "(not specified)",
    confounded,
    additional_changes: confounded ? additionalChanges : undefined,
    expected_metric_effect: input.expectedMetricEffect || "(not specified)",
    abort_condition: input.abortCondition || "No explicit abort condition defined.",
    keep_or_discard_rule: input.keepOrDiscardRule || "Keep if objective metric improves; discard otherwise."
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const ARTIFACT_PATH = "experiment_contract.json";

export async function writeExperimentContract(
  run: RunRecord,
  contract: ExperimentContract
): Promise<string> {
  return writeRunArtifact(run, ARTIFACT_PATH, `${JSON.stringify(contract, null, 2)}\n`);
}

export async function loadExperimentContract(
  runId: string
): Promise<ExperimentContract | undefined> {
  const raw = await safeRead(`.autolabos/runs/${runId}/${ARTIFACT_PATH}`);
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as ExperimentContract;
    if (parsed.version === 1 && parsed.hypothesis) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ExperimentContractValidation {
  valid: boolean;
  issues: string[];
}

export function validateExperimentContract(contract: ExperimentContract): ExperimentContractValidation {
  const issues: string[] = [];

  if (!contract.hypothesis || contract.hypothesis === "(not specified)") {
    issues.push("Missing hypothesis.");
  }
  if (!contract.causal_mechanism || contract.causal_mechanism === "(not specified)") {
    issues.push("Missing causal mechanism.");
  }
  if (!contract.single_change || contract.single_change === "(not specified)") {
    issues.push("Missing single change specification.");
  }
  if (contract.confounded) {
    issues.push(
      `Confounded attempt: ${(contract.additional_changes ?? []).length + 1} changes declared. Interpretation will be limited.`
    );
  }
  if (!contract.expected_metric_effect || contract.expected_metric_effect === "(not specified)") {
    issues.push("Missing expected metric effect.");
  }

  return { valid: issues.length === 0, issues };
}
