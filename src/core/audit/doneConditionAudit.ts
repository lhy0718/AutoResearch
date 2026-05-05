export type DoneConditionStatus = "pass" | "needs-review" | "fail" | "unmeasured";

export interface DoneConditionCheck {
  id: string;
  label: string;
  severity: "error" | "warning";
  passed: boolean;
  detail: string;
}

export interface DoneConditionAudit {
  version: 1;
  generated_at: string;
  measured: boolean;
  status: DoneConditionStatus;
  declared_source: "governance_condition" | "research_brief" | "none";
  allowed_weak_output_states: string[];
  checks: DoneConditionCheck[];
  failures: string[];
  warnings: string[];
  policy_note: string;
}

export function evaluateDoneConditionAudit(input: {
  governanceCondition?: Record<string, unknown>;
  researchBriefText?: string;
  paperReady: boolean;
  writePaperCompleted: boolean;
  missingBaselineOrComparator: boolean;
  resultTableReady: boolean;
  fallbackOnlyEvidence: boolean;
  failedRunHidden: boolean;
  unsupportedClaimCount: number;
  citationSupportIssueCount: number;
  figureMismatchPresent: boolean;
}): DoneConditionAudit {
  const declaredSource = input.governanceCondition
    ? "governance_condition"
    : input.researchBriefText?.trim()
      ? "research_brief"
      : "none";
  const allowedWeakOutputStates = deriveAllowedWeakOutputStates(input);
  const measured = declaredSource !== "none";
  const checks: DoneConditionCheck[] = [
    {
      id: "write_paper_not_paper_ready",
      label: "write_paper completion is not accepted as paper-ready by itself",
      severity: "error",
      passed: !(input.writePaperCompleted && input.paperReady && hasPaperReadyBlocker(input)),
      detail: input.writePaperCompleted
        ? "write_paper completed; paper-ready still depends on evidence gates."
        : "write_paper did not complete, so no manuscript-completion shortcut is present."
    },
    {
      id: "baseline_comparator_required_for_paper_ready",
      label: "Paper-ready comparative claims require baseline/comparator evidence",
      severity: "error",
      passed: !input.paperReady || !input.missingBaselineOrComparator,
      detail: input.missingBaselineOrComparator
        ? "Baseline or comparator evidence is missing."
        : "Baseline/comparator evidence is not missing."
    },
    {
      id: "result_table_required_for_paper_ready",
      label: "Paper-ready status requires a complete result table",
      severity: "error",
      passed: !input.paperReady || input.resultTableReady,
      detail: input.resultTableReady
        ? "Result table has at least one complete metric row."
        : "Result table is missing or incomplete."
    },
    {
      id: "fallback_only_blocks_quantitative_done",
      label: "Fallback-only evidence cannot satisfy quantitative paper-ready completion",
      severity: "error",
      passed: !input.paperReady || !input.fallbackOnlyEvidence,
      detail: input.fallbackOnlyEvidence
        ? "Only fallback evidence is available."
        : "No fallback-only evidence condition is active."
    },
    {
      id: "failed_run_visibility_required",
      label: "Failed run visibility is required",
      severity: "error",
      passed: !input.failedRunHidden,
      detail: input.failedRunHidden
        ? "A failed run is hidden behind paper_ready=true."
        : "No hidden failed-run paper-ready contradiction was detected."
    },
    {
      id: "unsupported_claims_block_paper_ready",
      label: "Unsupported claims block paper-ready completion",
      severity: "error",
      passed: !input.paperReady || input.unsupportedClaimCount === 0,
      detail: `Unsupported claim count: ${input.unsupportedClaimCount}.`
    },
    {
      id: "citation_support_required_for_related_work",
      label: "Related-work claims require citation support",
      severity: "warning",
      passed: !input.paperReady || input.citationSupportIssueCount === 0,
      detail: `Citation support issue count: ${input.citationSupportIssueCount}.`
    },
    {
      id: "figure_mismatch_blocks_manuscript_promotion",
      label: "Figure/result/caption mismatch blocks manuscript promotion",
      severity: "error",
      passed: !input.paperReady || !input.figureMismatchPresent,
      detail: input.figureMismatchPresent
        ? "Figure audit reports a mismatch or review block."
        : "No figure mismatch blocker is active."
    },
    {
      id: "weak_output_state_explicit",
      label: "Weak output states are explicit when paper_ready=false",
      severity: "warning",
      passed: input.paperReady || allowedWeakOutputStates.length > 0,
      detail: allowedWeakOutputStates.length > 0
        ? `Allowed weak output states: ${allowedWeakOutputStates.join(", ")}.`
        : "No allowed weak output states were declared."
    }
  ];

  if (!measured) {
    return {
      version: 1,
      generated_at: new Date().toISOString(),
      measured: false,
      status: "unmeasured",
      declared_source: "none",
      allowed_weak_output_states: allowedWeakOutputStates,
      checks,
      failures: [],
      warnings: ["No governance condition or research brief done-condition source was available."],
      policy_note: policyNote()
    };
  }

  const failures = checks.filter((check) => check.severity === "error" && !check.passed).map((check) => check.label);
  const warnings = checks.filter((check) => check.severity === "warning" && !check.passed).map((check) => check.label);
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    measured,
    status: failures.length > 0 ? "fail" : warnings.length > 0 ? "needs-review" : "pass",
    declared_source: declaredSource,
    allowed_weak_output_states: allowedWeakOutputStates,
    checks,
    failures,
    warnings,
    policy_note: policyNote()
  };
}

function hasPaperReadyBlocker(input: {
  missingBaselineOrComparator: boolean;
  resultTableReady: boolean;
  fallbackOnlyEvidence: boolean;
  failedRunHidden: boolean;
  unsupportedClaimCount: number;
  figureMismatchPresent: boolean;
}): boolean {
  return input.missingBaselineOrComparator
    || !input.resultTableReady
    || input.fallbackOnlyEvidence
    || input.failedRunHidden
    || input.unsupportedClaimCount > 0
    || input.figureMismatchPresent;
}

function deriveAllowedWeakOutputStates(input: {
  governanceCondition?: Record<string, unknown>;
  researchBriefText?: string;
}): string[] {
  const states = new Set<string>();
  const rawStates = input.governanceCondition?.allowed_weak_output_states;
  if (Array.isArray(rawStates)) {
    for (const item of rawStates) {
      if (typeof item === "string" && item.trim()) {
        states.add(item.trim());
      }
    }
  }
  if (
    input.governanceCondition?.expected_paper_ready === false
    || input.governanceCondition?.paper_ready_expected === false
  ) {
    states.add("paper_ready=false");
  }
  const briefText = input.researchBriefText || "";
  for (const state of ["system_validation_note", "research_memo", "blocked_for_paper_scale", "paper_ready=false"]) {
    if (briefText.includes(state)) {
      states.add(state);
    }
  }
  return [...states].sort();
}

function policyNote(): string {
  return "Done-condition audit prevents workflow completion, write_paper completion, or PDF build success from satisfying paper-ready completion without evidence gates.";
}
