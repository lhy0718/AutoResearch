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

  // Enhanced confounding detection (Target 3): heuristic multi-change detection
  const confoundingHints = detectConfoundingHints(contract);
  for (const hint of confoundingHints) {
    issues.push(hint);
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Enhanced confounding detection (Target 3)
// ---------------------------------------------------------------------------

/**
 * Heuristic multi-change detection beyond the structural `additional_changes` flag.
 * Conservative: returns hints only when strong textual signals indicate multiple
 * independent changes in what is declared as a single_change.
 */
export function detectConfoundingHints(contract: ExperimentContract): string[] {
  if (contract.confounded) return []; // already flagged structurally

  const hints: string[] = [];
  const change = contract.single_change.toLowerCase();

  // 1. Conjunction-split heuristic: "X and Y" or "X + Y" suggesting two distinct changes
  // Only split on strong conjunctions that separate independent clauses.
  // Skip "and its", "and the", "and their" which connect a noun to its qualifier.
  const conjunctionSplits = change.split(/\b(?:and|plus|\+|&|as well as|along with|together with|in addition to)\b(?!\s+(?:its|the|their|this|that|those|these)\b)/i);
  const substantiveParts = conjunctionSplits
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  if (substantiveParts.length >= 2) {
    // Verify the parts are distinct enough to be separate interventions
    const partTokens = substantiveParts.map((p) =>
      new Set(p.split(/\s+/).filter((t) => t.length > 3).map((t) => t.toLowerCase()))
    );
    if (partTokens.length >= 2 && partTokens[0].size >= 2 && partTokens[1].size >= 2) {
      const [first, second] = partTokens;
      const overlap = [...first].filter((t) => second.has(t)).length;
      const maxSize = Math.max(first.size, second.size);
      // Require that overlap is less than 30% of the larger set — truly distinct interventions
      const distinctEnough = overlap < maxSize * 0.3 && overlap < 2;
      if (distinctEnough) {
        hints.push(
          `Potential confounding: single_change contains conjunction-separated parts that appear to be distinct interventions: "${substantiveParts.slice(0, 3).join('" + "')}".`
        );
      }
    }
  }

  // 2. List-form heuristic: numbered or bulleted lists inside single_change
  const listPattern = /(?:^|\n)\s*(?:\d+[.)]\s+|[-*]\s+)/;
  if (listPattern.test(contract.single_change) && contract.single_change.split(listPattern).filter(Boolean).length >= 2) {
    hints.push("Potential confounding: single_change appears to contain a list of multiple changes.");
  }

  // 3. Mechanism-change mismatch: if causal_mechanism mentions a different entity than single_change
  // This is the most conservative check — only flag if mechanism talks about something not in the change
  const mechanismWords = new Set(
    contract.causal_mechanism.toLowerCase().split(/\s+/).filter((t) => t.length > 4)
  );
  const changeWords = new Set(
    change.split(/\s+/).filter((t) => t.length > 4)
  );
  const mechanismOnly = [...mechanismWords].filter((t) => !changeWords.has(t));
  // Look for action verbs in mechanism-only words that suggest an additional intervention
  const additionalInterventionVerbs = mechanismOnly.filter((t) =>
    /^(?:replace|add|remove|modify|change|introduce|eliminate|switch|restructur|refactor)/i.test(t)
  );
  if (additionalInterventionVerbs.length >= 2) {
    hints.push(
      `Potential confounding: causal_mechanism references additional interventions not captured in single_change: ${additionalInterventionVerbs.slice(0, 3).join(", ")}.`
    );
  }

  return hints;
}
