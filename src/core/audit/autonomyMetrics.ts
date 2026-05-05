import type { AuditTimeline } from "./auditTimeline.js";

export interface ScalarAuditMetric {
  measured: boolean;
  value: number | null;
  unit?: string;
  note: string;
}

export interface AuditAutonomyMetrics {
  version: 1;
  generated_at: string;
  autonomy_span: ScalarAuditMetric;
  human_intervention_count: ScalarAuditMetric;
  evidence_integrity_score: ScalarAuditMetric;
  backtrack_success_rate: ScalarAuditMetric;
  claim_violation_count: ScalarAuditMetric;
  reproducibility_score: ScalarAuditMetric;
  policy_note: string;
}

export function computeAuditAutonomyMetrics(input: {
  timeline: AuditTimeline;
  blockerCount: number;
  unsupportedClaimCount: number;
  citationSupportIssueCount: number;
  requiredOutputCount: number;
  presentOutputCount: number;
}): AuditAutonomyMetrics {
  const eventEntries = input.timeline.entries.filter((entry) => entry.source === "event");
  const timestamps = eventEntries
    .map((entry) => entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN)
    .filter((value) => Number.isFinite(value));
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const autonomySpanMeasured = timestamps.length >= 2 && Number.isFinite(first) && Number.isFinite(last) && last >= first;
  const rollbackCount = eventEntries.filter((entry) => entry.event_type === "NODE_ROLLBACK" || entry.event_type === "NODE_JUMP").length;
  const rollbackRecoveredCount = rollbackCount > 0 && eventEntries.some((entry) => entry.event_type === "NODE_COMPLETED")
    ? rollbackCount
    : 0;
  const claimViolationCount = input.unsupportedClaimCount + input.citationSupportIssueCount;
  const evidenceIntegrityScore = clamp01(1 - (input.blockerCount + claimViolationCount) / Math.max(1, input.blockerCount + claimViolationCount + 4));
  const reproducibilityScore = input.requiredOutputCount > 0
    ? clamp01(input.presentOutputCount / input.requiredOutputCount)
    : 0;

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    autonomy_span: {
      measured: autonomySpanMeasured,
      value: autonomySpanMeasured ? last - first : null,
      unit: "ms",
      note: autonomySpanMeasured
        ? "Measured from first to last durable run event."
        : "Unmeasured because fewer than two durable run events were available."
    },
    human_intervention_count: {
      measured: eventEntries.length > 0,
      value: eventEntries.length > 0 ? countHumanInterventions(input.timeline) : null,
      note: eventEntries.length > 0
        ? "Counted from explicit human/approval/review intervention markers in event payload titles."
        : "Unmeasured because no durable run events were available."
    },
    evidence_integrity_score: {
      measured: true,
      value: evidenceIntegrityScore,
      note: "Derived from audit blockers and claim/citation violations; lower scores mean more evidence-governance risk."
    },
    backtrack_success_rate: {
      measured: rollbackCount > 0,
      value: rollbackCount > 0 ? rollbackRecoveredCount / rollbackCount : null,
      note: rollbackCount > 0
        ? "Measured from rollback/jump events with later completed-node evidence."
        : "Unmeasured because no rollback or node-jump events were available."
    },
    claim_violation_count: {
      measured: true,
      value: claimViolationCount,
      note: "Unsupported claim count plus citation-support issue count."
    },
    reproducibility_score: {
      measured: input.requiredOutputCount > 0,
      value: input.requiredOutputCount > 0 ? reproducibilityScore : null,
      note: "Required audit output presence ratio for this audit bundle."
    },
    policy_note: "Autonomy metrics are run-level audit signals only; they are not paper-readiness claims unless backed by artifacts."
  };
}

function countHumanInterventions(timeline: AuditTimeline): number {
  return timeline.entries.filter((entry) => {
    const text = [entry.title, entry.kind, entry.decision].filter(Boolean).join(" ").toLowerCase();
    return /\bhuman\b|\bapproval\b|\bmanual\b|\breview required\b/iu.test(text);
  }).length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
