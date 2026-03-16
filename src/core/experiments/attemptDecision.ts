/**
 * Attempt decision: structured keep/discard artifact for each experiment
 * attempt.  Written by analyze_results.
 *
 * Artifact path: .autolabos/runs/<run_id>/attempt_decisions.jsonl
 */

import { RunRecord } from "../../types.js";
import { appendJsonlItems } from "../nodes/helpers.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type AttemptDecisionVerdict =
  | "keep"
  | "discard"
  | "needs_replication"
  | "needs_design_revision";

export interface AttemptDecision {
  decision_id: string;
  run_id: string;
  attempt: number;
  timestamp: string;

  /** The verdict for this attempt. */
  verdict: AttemptDecisionVerdict;

  /** Human-readable rationale for the decision. */
  rationale: string;

  /** References to specific evidence artifacts supporting the decision. */
  evidence_refs: string[];

  /** Primary metric name evaluated. */
  metric_name?: string;

  /** Primary metric value observed. */
  metric_value?: number;

  /** Baseline metric value for comparison. */
  baseline_value?: number;

  /** Whether the objective metric improved relative to baseline. */
  metric_improved?: boolean;

  /** If discard: what specifically failed or was insufficient. */
  discard_reason?: string;

  /** If needs_replication: what should be replicated and why. */
  replication_note?: string;

  /** If needs_design_revision: what design flaw was identified. */
  design_revision_note?: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildAttemptDecisionInput {
  runId: string;
  attempt: number;
  verdict: AttemptDecisionVerdict;
  rationale: string;
  evidenceRefs?: string[];
  metricName?: string;
  metricValue?: number;
  baselineValue?: number;
  metricImproved?: boolean;
  discardReason?: string;
  replicationNote?: string;
  designRevisionNote?: string;
}

export function buildAttemptDecision(input: BuildAttemptDecisionInput): AttemptDecision {
  return {
    decision_id: `dec_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    run_id: input.runId,
    attempt: input.attempt,
    timestamp: new Date().toISOString(),
    verdict: input.verdict,
    rationale: input.rationale,
    evidence_refs: input.evidenceRefs ?? [],
    metric_name: input.metricName,
    metric_value: input.metricValue,
    baseline_value: input.baselineValue,
    metric_improved: input.metricImproved,
    discard_reason: input.verdict === "discard" ? input.discardReason : undefined,
    replication_note: input.verdict === "needs_replication" ? input.replicationNote : undefined,
    design_revision_note: input.verdict === "needs_design_revision" ? input.designRevisionNote : undefined
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const ARTIFACT_PATH = "attempt_decisions.jsonl";

export async function writeAttemptDecision(
  run: RunRecord,
  decision: AttemptDecision
): Promise<string> {
  return appendJsonlItems(run, ARTIFACT_PATH, [decision]);
}

export async function loadAttemptDecisions(
  runId: string
): Promise<AttemptDecision[]> {
  const { promises: fs } = await import("node:fs");
  const filePath = `.autolabos/runs/${runId}/${ARTIFACT_PATH}`;
  let text = "";
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const out: AttemptDecision[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AttemptDecision);
    } catch {
      continue;
    }
  }
  return out;
}
