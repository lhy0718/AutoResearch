import type { ClaimEvidenceExport } from "./claimEvidenceExport.js";
import type { PaperReadinessAuditBlocker, PaperReadinessAuditUnsupportedClaim } from "./paperReadinessAudit.js";

export interface ClaimPromotionTimelineEntry {
  claim_id: string;
  statement?: string;
  event: "supported" | "unsupported" | "blocked" | "downgraded" | "unverified" | "unknown";
  support_level: string;
  evidence_refs: string[];
  issue_codes: string[];
  allowed_claim_level: string;
  source: "claim_evidence_export" | "audit_blocker";
}

export interface ClaimPromotionTimeline {
  version: 1;
  generated_at: string;
  measured: boolean;
  claim_count: number;
  entries: ClaimPromotionTimelineEntry[];
  policy_note: string;
}

export interface BlockedClaimEvent {
  code: string;
  severity: "blocker" | "warning";
  claim_id?: string;
  statement?: string;
  message: string;
  source: string;
}

export interface BlockedClaimEvents {
  version: 1;
  generated_at: string;
  event_count: number;
  events: BlockedClaimEvent[];
  policy_note: string;
}

export function buildClaimPromotionTimeline(input: {
  claimEvidenceExport: ClaimEvidenceExport;
  blockers: PaperReadinessAuditBlocker[];
  unsupportedClaims: PaperReadinessAuditUnsupportedClaim[];
  citationSupportIssues: PaperReadinessAuditUnsupportedClaim[];
  allowedClaimLevel: string;
}): { timeline: ClaimPromotionTimeline; blockedClaimEvents: BlockedClaimEvents } {
  const entries: ClaimPromotionTimelineEntry[] = input.claimEvidenceExport.claims.map((claim) => {
    const evidenceRefs = unique([
      ...claim.artifact_refs,
      ...claim.citation_refs,
      ...claim.evidence_ids
    ]);
    return {
      claim_id: claim.claim_id,
      ...(claim.statement ? { statement: claim.statement } : {}),
      event: eventForClaim(claim.status, claim.support_level),
      support_level: claim.support_level,
      evidence_refs: evidenceRefs,
      issue_codes: claim.issue_codes,
      allowed_claim_level: input.allowedClaimLevel,
      source: "claim_evidence_export"
    };
  });

  const blockedClaimEvents = buildBlockedClaimEvents(input);
  return {
    timeline: {
      version: 1,
      generated_at: new Date().toISOString(),
      measured: input.claimEvidenceExport.measured,
      claim_count: entries.length,
      entries,
      policy_note: "Claim promotion events are derived from preserved claim artifacts and scorer issues; unsupported claims are not upgraded."
    },
    blockedClaimEvents
  };
}

function buildBlockedClaimEvents(input: {
  blockers: PaperReadinessAuditBlocker[];
  unsupportedClaims: PaperReadinessAuditUnsupportedClaim[];
  citationSupportIssues: PaperReadinessAuditUnsupportedClaim[];
}): BlockedClaimEvents {
  const events: BlockedClaimEvent[] = [];
  for (const claim of input.unsupportedClaims) {
    events.push({
      code: "unsupported_claim",
      severity: "blocker",
      claim_id: claim.claim_id,
      ...(claim.statement ? { statement: claim.statement } : {}),
      message: claim.message,
      source: "claimEvidenceScoring"
    });
  }
  for (const claim of input.citationSupportIssues) {
    events.push({
      code: "citation_support_missing",
      severity: "warning",
      claim_id: claim.claim_id,
      ...(claim.statement ? { statement: claim.statement } : {}),
      message: claim.message,
      source: "claimEvidenceScoring"
    });
  }
  for (const blocker of input.blockers) {
    if (CLAIM_BLOCKER_CODES.has(blocker.code)) {
      events.push({
        code: blocker.code,
        severity: blocker.severity,
        message: blocker.message,
        source: blocker.source
      });
    }
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    event_count: events.length,
    events: dedupeEvents(events),
    policy_note: "Blocked-claim events preserve unsupported claims, citation gaps, failed-run visibility, fallback-only evidence, figure mismatch, and baseline/result-table blockers."
  };
}

const CLAIM_BLOCKER_CODES = new Set([
  "baseline_or_comparator_missing",
  "result_table_missing",
  "result_table_incomplete",
  "fallback_only_evidence",
  "figure_result_caption_mismatch",
  "hidden_failed_run",
  "unsupported_claims_present",
  "false_paper_ready_blocked"
]);

function eventForClaim(
  status: string,
  supportLevel: string
): ClaimPromotionTimelineEntry["event"] {
  if (status === "supported") {
    return "supported";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "unsupported" || supportLevel === "unsupported") {
    return "unsupported";
  }
  if (status === "unverified") {
    return "unverified";
  }
  return "unknown";
}

function dedupeEvents(events: BlockedClaimEvent[]): BlockedClaimEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.code}\u0000${event.claim_id || ""}\u0000${event.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
