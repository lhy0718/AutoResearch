import type { ManuscriptType } from "./paperCritique.js";
import type { ExecutionApprovalMode, ExperimentNetworkPolicy, ExperimentNetworkPurpose } from "../types.js";

export type ReadinessRiskCategory =
  | "citation_source"
  | "claim_evidence"
  | "scientific_validation"
  | "submission_validation"
  | "manuscript_quality"
  | "paper_scale"
  | "network_dependency";

export type ReadinessRiskSeverity = "warning" | "blocked";
export type ReadinessRiskStatus = "unverified" | "blocked";

export interface ReadinessRisk {
  risk_code: string;
  severity: ReadinessRiskSeverity;
  category: ReadinessRiskCategory;
  status: ReadinessRiskStatus;
  message: string;
  triggered_by: string[];
  affected_claim_ids: string[];
  affected_citation_ids: string[];
  recommended_action: string;
  recheck_condition: string;
}

export interface ReadinessRiskArtifact {
  generated_at: string;
  paper_ready: boolean;
  readiness_state: ManuscriptType;
  risk_count: number;
  blocked_count: number;
  warning_count: number;
  risks: ReadinessRisk[];
  summary_lines: string[];
}

export function buildReadinessRiskArtifact(input: {
  paperReady: boolean;
  readinessState: ManuscriptType;
  risks: ReadinessRisk[];
}): ReadinessRiskArtifact {
  const blockedCount = input.risks.filter((risk) => risk.severity === "blocked").length;
  const warningCount = input.risks.filter((risk) => risk.severity === "warning").length;
  return {
    generated_at: new Date().toISOString(),
    paper_ready: input.paperReady,
    readiness_state: input.readinessState,
    risk_count: input.risks.length,
    blocked_count: blockedCount,
    warning_count: warningCount,
    risks: input.risks,
    summary_lines:
      input.risks.length === 0
        ? ["No separate readiness risks remain beyond the current readiness decision."]
        : [
            `Readiness risks: blocked=${blockedCount}, warning=${warningCount}, readiness_state=${input.readinessState}.`,
            ...input.risks.slice(0, 4).map((risk) => risk.message)
          ]
  };
}

export function formatReadinessRiskSection(category: ReadinessRiskCategory): string {
  switch (category) {
    case "citation_source":
      return "Citation source";
    case "claim_evidence":
      return "Claim evidence";
    case "scientific_validation":
      return "Scientific validation";
    case "submission_validation":
      return "Submission validation";
    case "manuscript_quality":
      return "Manuscript quality";
    case "paper_scale":
      return "Paper scale";
    case "network_dependency":
      return "Network dependency";
  }
}

export function parseReadinessRiskArtifact(raw: string): ReadinessRiskArtifact | undefined {
  if (!raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as ReadinessRiskArtifact;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.risks) || typeof parsed.readiness_state !== "string") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function buildNetworkDependencyReadinessRisks(input: {
  source: "review" | "paper";
  allowNetwork: boolean;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
  executionApprovalMode?: ExecutionApprovalMode;
}): ReadinessRisk[] {
  if (!input.allowNetwork) {
    return [];
  }

  if (!input.networkPolicy || !input.networkPurpose) {
    return [
      {
        risk_code: `${input.source}_network_dependency_undeclared`,
        severity: "blocked",
        category: "network_dependency",
        status: "blocked",
        message: "Network access is enabled for experiment execution, but the run is missing a declared network policy or purpose.",
        triggered_by: ["network_policy"],
        affected_claim_ids: [],
        affected_citation_ids: [],
        recommended_action: "Declare why this run needs network access, or disable allow_network before treating the run as ready.",
        recheck_condition: "The run records a declared or required network policy with a concrete purpose."
      }
    ];
  }

  if (input.executionApprovalMode === "full_auto") {
    return [
      {
        risk_code: `${input.source}_network_dependency_full_auto_conflict`,
        severity: "blocked",
        category: "network_dependency",
        status: "blocked",
        message: `Network-enabled experiment execution (${input.networkPolicy}:${input.networkPurpose}) conflicts with full_auto execution approval mode.`,
        triggered_by: ["network_policy", "execution_approval_mode"],
        affected_claim_ids: [],
        affected_citation_ids: [],
        recommended_action: "Downgrade execution approval to manual or risk_ack before treating the run as ready.",
        recheck_condition: "The run uses manual or risk_ack approval for the declared network dependency."
      }
    ];
  }

  return [
    {
      risk_code: `${input.source}_network_dependency_${input.networkPolicy}_${input.networkPurpose}`,
      severity: "warning",
      category: "network_dependency",
      status: "unverified",
      message:
        input.networkPolicy === "required"
          ? `This run is network-critical for ${input.networkPurpose}, so reproducibility depends on an external service remaining available.`
          : `This run declares a network dependency for ${input.networkPurpose}; keep its outputs marked as network-assisted until the dependency is no longer needed.`,
      triggered_by: ["network_policy"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action:
        input.networkPolicy === "required"
          ? "Keep the run under manual or risk_ack oversight and document the external dependency in the final handoff."
          : "Document the external dependency and prefer a prewarmed/offline path when practical.",
      recheck_condition:
        input.networkPolicy === "required"
          ? "The run records and justifies the external dependency under the right approval mode."
          : "The dependency is either removed or kept explicitly declared with the appropriate approval mode."
    }
  ];
}
