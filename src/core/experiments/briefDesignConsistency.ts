/**
 * Design-vs-brief consistency check.
 *
 * Compares an experiment design against the structured brief sections to detect:
 * - missing target comparison
 * - insufficient evidence plan
 * - disallowed shortcuts in design
 * - unauthorized budgeted passes
 * - claims exceeding the paper ceiling
 *
 * Output: structured warnings stored as a parseable artifact.
 */

import { BriefCompletenessArtifact } from "../runs/researchBriefFiles.js";
import { MarkdownRunBriefSections } from "../runs/runBriefParser.js";
import { ExperimentContract } from "./experimentContract.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface BriefDesignWarning {
  code: string;
  severity: "error" | "warning";
  message: string;
  evidence?: string;
}

export interface BriefDesignConsistencyResult {
  generated_at: string;
  warnings: BriefDesignWarning[];
  paper_scale_blocked: boolean;
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export function checkBriefDesignConsistency(input: {
  briefSections?: MarkdownRunBriefSections;
  briefCompleteness?: BriefCompletenessArtifact;
  experimentContract?: ExperimentContract;
  designTitle?: string;
  designBaselines?: string[];
  designMetrics?: string[];
}): BriefDesignConsistencyResult {
  const warnings: BriefDesignWarning[] = [];
  const { briefSections, briefCompleteness, experimentContract, designBaselines, designMetrics } = input;

  // 1. Missing target comparison
  if (!briefSections?.targetComparison) {
    if (designBaselines && designBaselines.length > 0) {
      warnings.push({
        code: "MISSING_TARGET_COMPARISON",
        severity: "warning",
        message: "Design specifies baselines but the brief has no Target Comparison section. Add an explicit comparison target to the brief.",
        evidence: `Design baselines: ${designBaselines.join(", ")}`
      });
    } else {
      warnings.push({
        code: "MISSING_TARGET_COMPARISON",
        severity: "error",
        message: "Neither the brief nor the design specifies an explicit comparison target. Paper-scale claims require at least one baseline comparison."
      });
    }
  }

  // 2. Insufficient evidence plan
  if (!briefSections?.minimumAcceptableEvidence) {
    warnings.push({
      code: "MISSING_EVIDENCE_PLAN",
      severity: "warning",
      message: "The brief does not specify minimum acceptable evidence. Review will apply default thresholds which may be too lenient."
    });
  }

  // 3. Disallowed shortcuts check
  if (briefSections?.disallowedShortcuts && experimentContract) {
    const shortcuts = briefSections.disallowedShortcuts.toLowerCase();
    // Check if design single_change mentions anything disallowed
    if (shortcuts.includes("smoke") && experimentContract.single_change.toLowerCase().includes("smoke")) {
      warnings.push({
        code: "DISALLOWED_SHORTCUT_DETECTED",
        severity: "error",
        message: "The experiment design references smoke test artifacts, which is listed in disallowed shortcuts.",
        evidence: `single_change: ${experimentContract.single_change}`
      });
    }
    if (shortcuts.includes("cherry-pick") || shortcuts.includes("cherry pick")) {
      // Check for single-dataset-only designs
      if (designMetrics && designMetrics.length <= 1 && briefSections.disallowedShortcuts.includes("cherry-pick")) {
        warnings.push({
          code: "POTENTIAL_CHERRY_PICK",
          severity: "warning",
          message: "Design uses a single metric/dataset. Brief disallows cherry-picking. Ensure this is the pre-registered primary metric.",
          evidence: `Metrics: ${(designMetrics || []).join(", ") || "none specified"}`
        });
      }
    }
  }

  // 4. Unauthorized budgeted passes
  if (!briefSections?.allowedBudgetedPasses) {
    warnings.push({
      code: "MISSING_BUDGET_PASSES",
      severity: "warning",
      message: "The brief does not specify allowed budgeted passes. Any extra analysis passes must be justified."
    });
  }

  // 5. Paper ceiling alignment
  if (briefSections?.paperCeiling && experimentContract) {
    const ceiling = briefSections.paperCeiling.toLowerCase();
    if (ceiling.includes("system_validation_note") || ceiling.includes("research_memo")) {
      // If ceiling is capped below paper_ready, and the contract expects strong claims, warn
      if (experimentContract.expected_metric_effect.toLowerCase().includes("significant")) {
        warnings.push({
          code: "CLAIMS_EXCEED_CEILING",
          severity: "warning",
          message: `Design expects "${experimentContract.expected_metric_effect}" but brief caps paper ceiling at lower level. Adjust expectations or strengthen evidence.`,
          evidence: `Paper ceiling: ${briefSections.paperCeiling.trim().slice(0, 200)}`
        });
      }
    }
  }

  // 6. Confounded design warning
  if (experimentContract?.confounded) {
    warnings.push({
      code: "CONFOUNDED_DESIGN",
      severity: "warning",
      message: `Experiment conflates ${(experimentContract.additional_changes?.length ?? 0) + 1} changes. Causal claims will be limited to correlation.`,
      evidence: `additional_changes: ${(experimentContract.additional_changes ?? []).join("; ")}`
    });
  }

  // 7. Brief completeness below paper scale
  if (briefCompleteness && !briefCompleteness.paper_scale_ready) {
    warnings.push({
      code: "BRIEF_NOT_PAPER_SCALE",
      severity: "warning",
      message: `Brief completeness grade is "${briefCompleteness.grade}". Missing sections: ${briefCompleteness.missing_sections.join(", ") || "none"}.`
    });
  }

  const paperScaleBlocked = warnings.some(
    (w) => w.severity === "error" && (w.code === "MISSING_TARGET_COMPARISON" || w.code === "DISALLOWED_SHORTCUT_DETECTED")
  );

  return {
    generated_at: new Date().toISOString(),
    warnings,
    paper_scale_blocked: paperScaleBlocked
  };
}
