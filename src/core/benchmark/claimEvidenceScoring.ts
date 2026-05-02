import type { GovernanceTaskScoreInput } from "./governanceScorer.js";

export interface ClaimEvidenceScoringIssue {
  code: string;
  claim_id: string;
  message: string;
}

export interface ClaimEvidenceScore {
  measured: boolean;
  major_claim_count: number;
  supported_claim_count: number;
  unsupported_claim_count: number;
  claim_to_evidence_coverage: number | null;
  issues: ClaimEvidenceScoringIssue[];
}

export interface ScoreClaimEvidenceArtifactsInput {
  claimEvidenceTableArtifact?: unknown;
  claimStatusTableArtifact?: unknown;
  evidenceLinksArtifact?: unknown;
}

interface NormalizedClaimEvidenceRow {
  claim_id: string;
  artifact_refs: string[];
  citation_refs: string[];
  evidence_ids: string[];
  strength?: string;
}

interface NormalizedClaimStatusRow {
  claim_id: string;
  status?: string;
  artifact_refs: string[];
  citation_refs: string[];
  reproduction_trace_present?: boolean;
}

export function scoreClaimEvidenceArtifacts(
  input: ScoreClaimEvidenceArtifactsInput
): ClaimEvidenceScore {
  const tableClaims = normalizeClaimEvidenceRows(input.claimEvidenceTableArtifact);
  const statusRows = normalizeClaimStatusRows(input.claimStatusTableArtifact);
  const evidenceLinkClaims = normalizeEvidenceLinkRows(input.evidenceLinksArtifact);
  const claimIds = new Set<string>([
    ...tableClaims.map((claim) => claim.claim_id),
    ...statusRows.map((claim) => claim.claim_id),
    ...evidenceLinkClaims.map((claim) => claim.claim_id)
  ]);

  if (claimIds.size === 0) {
    return {
      measured: false,
      major_claim_count: 0,
      supported_claim_count: 0,
      unsupported_claim_count: 0,
      claim_to_evidence_coverage: null,
      issues: [
        {
          code: "claim_evidence_unmeasured",
          claim_id: "unknown",
          message: "No claim evidence artifacts contained parseable claim rows."
        }
      ]
    };
  }

  const tableById = new Map(tableClaims.map((claim) => [claim.claim_id, claim] as const));
  const statusById = new Map(statusRows.map((claim) => [claim.claim_id, claim] as const));
  const evidenceLinksById = new Map(evidenceLinkClaims.map((claim) => [claim.claim_id, claim] as const));
  let supported = 0;
  let unsupported = 0;
  const issues: ClaimEvidenceScoringIssue[] = [];

  for (const claimId of [...claimIds].sort()) {
    const tableClaim = tableById.get(claimId);
    const statusClaim = statusById.get(claimId);
    const evidenceLinkClaim = evidenceLinksById.get(claimId);
    const evidenceRefs = [
      ...(tableClaim?.artifact_refs ?? []),
      ...(tableClaim?.citation_refs ?? []),
      ...(tableClaim?.evidence_ids ?? []),
      ...(statusClaim?.artifact_refs ?? []),
      ...(statusClaim?.citation_refs ?? []),
      ...(evidenceLinkClaim?.artifact_refs ?? []),
      ...(evidenceLinkClaim?.citation_refs ?? []),
      ...(evidenceLinkClaim?.evidence_ids ?? [])
    ].filter(Boolean);
    const status = statusClaim?.status;
    const blocked = status === "blocked";
    const unsupportedByStatus = blocked || status === "unverified";
    const supportedByStatus = status === "verified" || status === "inferred";
    const hasSupport = evidenceRefs.length > 0;
    const isSupported = supportedByStatus || (hasSupport && !unsupportedByStatus);

    if (isSupported) {
      supported += 1;
      continue;
    }

    unsupported += 1;
    issues.push({
      code: blocked ? "claim_evidence_blocked" : hasSupport ? "claim_evidence_unverified" : "claim_evidence_missing",
      claim_id: claimId,
      message: hasSupport
        ? `Claim ${claimId} has evidence references but remains unverified or blocked.`
        : `Claim ${claimId} has no artifact, citation, or evidence references.`
    });
  }

  return {
    measured: true,
    major_claim_count: claimIds.size,
    supported_claim_count: supported,
    unsupported_claim_count: unsupported,
    claim_to_evidence_coverage: claimIds.size > 0 ? round2(supported / claimIds.size) : null,
    issues
  };
}

export function buildGovernanceTaskScoreInputFromClaimEvidence(input: {
  taskId: string;
  paperReady: boolean;
  expectedPaperReady?: boolean;
  claimEvidenceScore: ClaimEvidenceScore;
  missingRequiredArtifactCount?: number;
  missingBaselineDetected?: boolean;
  missingBaselinePassed?: boolean;
  figureResultMismatchCount?: number;
  repairActionCount?: number;
}): GovernanceTaskScoreInput {
  return {
    task_id: input.taskId,
    paper_ready: input.paperReady,
    expected_paper_ready: input.expectedPaperReady,
    unsupported_claim_count: input.claimEvidenceScore.unsupported_claim_count,
    major_claim_count: input.claimEvidenceScore.major_claim_count,
    supported_claim_count: input.claimEvidenceScore.supported_claim_count,
    missing_required_artifact_count: input.missingRequiredArtifactCount,
    missing_baseline_detected: input.missingBaselineDetected,
    missing_baseline_passed: input.missingBaselinePassed,
    figure_result_mismatch_count: input.figureResultMismatchCount,
    repair_action_count: input.repairActionCount,
    placeholder: !input.claimEvidenceScore.measured
  };
}

function normalizeClaimEvidenceRows(value: unknown): NormalizedClaimEvidenceRow[] {
  return normalizeClaimsArray(value).map((claim, index) => ({
    claim_id: normalizeClaimId(claim, index),
    artifact_refs: normalizeStringArray(claim.artifact_refs),
    citation_refs: normalizeStringArray(claim.citation_refs),
    evidence_ids: normalizeStringArray(claim.evidence_ids),
    strength: typeof claim.strength === "string" ? claim.strength : undefined
  }));
}

function normalizeClaimStatusRows(value: unknown): NormalizedClaimStatusRow[] {
  return normalizeClaimsArray(value).map((claim, index) => ({
    claim_id: normalizeClaimId(claim, index),
    status: typeof claim.status === "string" ? claim.status : undefined,
    artifact_refs: normalizeStringArray(claim.artifact_refs),
    citation_refs: normalizeStringArray(claim.citation_refs),
    reproduction_trace_present:
      typeof claim.reproduction_trace_present === "boolean" ? claim.reproduction_trace_present : undefined
  }));
}

function normalizeEvidenceLinkRows(value: unknown): NormalizedClaimEvidenceRow[] {
  return normalizeClaimsArray(value).map((claim, index) => ({
    claim_id: normalizeClaimId(claim, index),
    artifact_refs: normalizeStringArray(claim.artifact_refs),
    citation_refs: normalizeStringArray(claim.citation_paper_ids),
    evidence_ids: normalizeStringArray(claim.evidence_ids)
  }));
}

function normalizeClaimsArray(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const claims = (value as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) {
    return [];
  }
  return claims.filter((claim): claim is Record<string, unknown> => Boolean(claim) && typeof claim === "object");
}

function normalizeClaimId(claim: Record<string, unknown>, index: number): string {
  const explicit = claim.claim_id;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  return `claim_${index + 1}`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
