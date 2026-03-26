import type { PaperProfileConfig } from "../../types.js";
import type { ObjectiveMetricEvaluation, ObjectiveMetricProfile } from "../objectiveMetric.js";
import type { ConstraintProfile } from "../runConstraints.js";
import type { PaperWritingBundle } from "./paperWriting.js";
import type {
  PaperManuscript,
  PaperSourceRef,
  PaperTraceabilityEntry,
  PaperTraceabilityReport
} from "./paperManuscript.js";

export type ManuscriptReviewDecision = "pass" | "repair" | "stop";
export type ManuscriptReviewIssueCode =
  | "section_completeness"
  | "paragraph_redundancy"
  | "related_work_quality"
  | "section_transition"
  | "visual_redundancy"
  | "appendix_hygiene"
  | "citation_hygiene"
  | "alignment"
  | "rhetorical_overreach";

export interface ManuscriptReviewCheck {
  status: "pass" | "warn" | "fail";
  note: string;
}

export interface ManuscriptReviewSupportSpan {
  section: string;
  paragraph_index: number;
  excerpt: string;
  reason?: string;
  anchor_id?: string;
  source_refs?: PaperSourceRef[];
}

export interface ManuscriptReviewVisualTarget {
  kind: "table" | "figure" | "appendix_table" | "appendix_figure";
  index: number;
  rationale?: string;
}

export interface ManuscriptReviewIssue {
  code: ManuscriptReviewIssueCode;
  severity: "warning" | "fail";
  section: string;
  repairable: boolean;
  message: string;
  fix_recommendation: string;
  supporting_spans: ManuscriptReviewSupportSpan[];
  visual_targets?: ManuscriptReviewVisualTarget[];
}

export interface ManuscriptReviewArtifact {
  stage: "manuscript_review";
  generated_at: string;
  overall_decision: ManuscriptReviewDecision;
  summary: string;
  checks: {
    section_completeness: ManuscriptReviewCheck;
    paragraph_redundancy: ManuscriptReviewCheck;
    related_work_quality: ManuscriptReviewCheck;
    section_transition: ManuscriptReviewCheck;
    visual_redundancy: ManuscriptReviewCheck;
    appendix_hygiene: ManuscriptReviewCheck;
    citation_hygiene: ManuscriptReviewCheck;
    alignment: ManuscriptReviewCheck;
    rhetorical_overreach: ManuscriptReviewCheck;
  };
  issues: ManuscriptReviewIssue[];
}

export interface ManuscriptStyleLintIssue {
  severity: "warning" | "fail";
  code: string;
  section: string;
  message: string;
  fix_recommendation: string;
  location_keys?: string[];
  coverage_status?: "primary" | "backstop_only";
  covered_by_review_issue_code?: ManuscriptReviewIssueCode;
  gate_role?: "primary_signal" | "backstop_only" | "hard_stop";
  redundant_visual_pair?: {
    table_index: number;
    figure_index: number;
    shared_labels: string[];
  };
}

export interface ManuscriptStyleLintArtifact {
  mode: "hard_policy_only";
  checked_rules: string[];
  ok: boolean;
  issues: ManuscriptStyleLintIssue[];
  summary: string[];
}

export type ManuscriptReviewArtifactReliability = "grounded" | "partially_grounded" | "degraded";

export interface ManuscriptReviewReliabilityMetrics {
  issue_count: number;
  valid_span_count: number;
  invalid_span_count: number;
  visual_target_only_issue_count: number;
  unsupported_issue_count: number;
  mismatch_count: number;
  retry_used: boolean;
}

export interface ManuscriptReviewValidationIssue {
  severity: "warning" | "fail";
  code: "invalid_supporting_span" | "issue_missing_supporting_span" | "unanchored_supporting_span";
  section: string;
  message: string;
  issue_code?: ManuscriptReviewIssueCode;
  span_index?: number;
}

export interface ManuscriptReviewValidationArtifact {
  ok: boolean;
  artifact_reliability: ManuscriptReviewArtifactReliability;
  retry_requested: boolean;
  issues: ManuscriptReviewValidationIssue[];
  dropped_span_count: number;
  retained_issue_count: number;
  metrics: ManuscriptReviewReliabilityMetrics;
}

export interface ManuscriptReviewAuditIssue {
  severity: "warning" | "fail";
  code: "unsupported_issue" | "missing_major_issue" | "check_issue_mismatch" | "insufficient_grounding";
  section: string;
  message: string;
  fix_recommendation: string;
}

export interface ManuscriptReviewAuditArtifact {
  ok: boolean;
  artifact_reliability: ManuscriptReviewArtifactReliability;
  retry_recommended: boolean;
  summary: string;
  issues: ManuscriptReviewAuditIssue[];
  metrics: ManuscriptReviewReliabilityMetrics;
}

export interface ManuscriptQualityIssueSnapshot {
  source: "review" | "style_lint";
  code: string;
  severity: "warning" | "fail";
  section: string;
  repairable: boolean;
  message: string;
  anchor_ids?: string[];
}

export interface ManuscriptRepairDecision {
  action: "pass" | "repair" | "stop";
  pass_index: number;
  triggered_by: string[];
  allowed_max_passes: number;
  remaining_allowed_repairs: number;
  issues_before: ManuscriptQualityIssueSnapshot[];
  issues_after?: ManuscriptQualityIssueSnapshot[];
  improvement_detected?: boolean;
  stop_or_continue_reason: string;
  decision_digest: {
    stage: "initial_gate" | "post_repair_1" | "post_repair_2";
    action: "pass" | "repair" | "stop";
    review_reliability: ManuscriptReviewArtifactReliability;
    issue_counts_before: {
      total: number;
      fail: number;
      warning: number;
    };
    issue_counts_after?: {
      total: number;
      fail: number;
      warning: number;
    };
    improvement_detected?: boolean;
    allowed_max_passes: number;
    remaining_allowed_repairs: number;
    triggered_by: string[];
    stop_reason_category:
      | "review_reliability"
      | "policy_hard_stop"
      | "locality_violation"
      | "visual_overclaim"
      | "repeated_issue"
      | "no_improvement"
      | "scope_too_broad"
      | "upstream_scientific_or_submission_failure"
      | "clean_pass"
      | "repairable_manuscript_issue";
  };
  summary_lines: string[];
}

export interface ManuscriptRepairReport {
  pass_index: number;
  triggered_by: string[];
  allowed_max_passes: number;
  issues_before: ManuscriptQualityIssueSnapshot[];
  issues_after: ManuscriptQualityIssueSnapshot[];
  improvement_detected: boolean;
  verification_summary: string;
  verification_findings: Array<{
    code: "out_of_scope_change" | "visual_caption_overclaim" | "visual_label_overclaim";
    severity: "fail";
    location_keys: string[];
    message: string;
    concerns?: string[];
  }>;
  stop_or_continue_reason: string;
}

export type ManuscriptRepairTargetKind =
  | "title"
  | "abstract"
  | "paragraph"
  | "appendix_paragraph"
  | "table"
  | "figure"
  | "appendix_table"
  | "appendix_figure";

export interface ManuscriptRepairTarget {
  source: "review" | "style_lint";
  issue_code: string;
  severity: "warning" | "fail";
  kind: ManuscriptRepairTargetKind;
  section: string;
  location_key: string;
  paragraph_index?: number;
  visual_index?: number;
  anchor_id?: string;
  excerpt: string;
  source_refs: PaperSourceRef[];
  edit_scope: "paragraph_local" | "adjacent_two_paragraphs" | "visual_local" | "appendix_local";
  allowed_location_keys: string[];
  scope_reason: string;
  scope_downgraded?: boolean;
}

export interface ManuscriptRepairBlockedTarget {
  source: "review" | "style_lint";
  issue_code: string;
  section: string;
  reason: string;
}

export interface ManuscriptRepairPlanArtifact {
  pass_index: 1 | 2;
  repair_scope: "bounded_local";
  targets: ManuscriptRepairTarget[];
  blocked_targets: ManuscriptRepairBlockedTarget[];
  preservation_rules: string[];
  summary: string;
}

export interface ManuscriptRepairVerificationArtifact {
  pass_index: 1 | 2;
  target_anchor_ids: string[];
  target_location_keys: string[];
  allowed_location_keys: string[];
  resolved_anchor_ids: string[];
  still_failing_anchor_ids: string[];
  changed_location_keys: string[];
  out_of_scope_changes: string[];
  unexpected_changed_sections: string[];
  scope_respected: boolean;
  scope_downgraded_targets: string[];
  locality_ok: boolean;
  visual_caption_conservatism_ok: boolean;
  visual_caption_checks: Array<{
    location_key: string;
    section: string;
    caption: string;
    conservative: boolean;
    concerns: string[];
    fix_recommendation: string;
  }>;
  visual_label_conservatism_ok: boolean;
  visual_label_checks: Array<{
    location_key: string;
    section: string;
    labels: string[];
    conservative: boolean;
    concerns: string[];
    fix_recommendation: string;
  }>;
  visual_conservatism_ok: boolean;
  summary: string;
}

interface RawManuscriptReviewArtifact {
  overall_decision?: unknown;
  summary?: unknown;
  checks?: unknown;
  issues?: unknown;
}

interface RawManuscriptReviewAuditArtifact {
  ok?: unknown;
  artifact_reliability?: unknown;
  retry_recommended?: unknown;
  summary?: unknown;
  issues?: unknown;
}

const MANUSCRIPT_REVIEW_CODES: ManuscriptReviewIssueCode[] = [
  "section_completeness",
  "paragraph_redundancy",
  "related_work_quality",
  "section_transition",
  "visual_redundancy",
  "appendix_hygiene",
  "citation_hygiene",
  "alignment",
  "rhetorical_overreach"
];

export function buildManuscriptReviewPrompt(input: {
  manuscript: PaperManuscript;
  bundle: PaperWritingBundle;
  constraintProfile: ConstraintProfile;
  paperProfile?: PaperProfileConfig;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  passLabel?: string;
  previousReview?: ManuscriptReviewArtifact;
  reviewValidation?: ManuscriptReviewValidationArtifact;
  reviewAudit?: ManuscriptReviewAuditArtifact;
  repairPlan?: ManuscriptRepairPlanArtifact;
  repairVerification?: ManuscriptRepairVerificationArtifact;
  focusLocationKeys?: string[];
}): string {
  const promptPayload = {
    run: {
      title: input.bundle.runTitle,
      topic: input.bundle.topic,
      objective_metric: input.bundle.objectiveMetric
    },
    writing_profile: {
      target_venue: input.constraintProfile.writing.targetVenue,
      tone_hint: input.constraintProfile.writing.toneHint,
      length_hint: input.constraintProfile.writing.lengthHint
    },
    paper_profile: input.paperProfile,
    objective_profile: {
      primary_metric: input.objectiveMetricProfile.primaryMetric,
      target_description: input.objectiveMetricProfile.targetDescription,
      objective_summary: input.objectiveEvaluation?.summary || input.bundle.resultAnalysis?.objective_metric?.evaluation?.summary || ""
    },
    manuscript: input.manuscript,
    ...(input.previousReview ? { previous_review: input.previousReview } : {}),
    ...(input.reviewValidation ? { previous_review_validation: input.reviewValidation } : {}),
    ...(input.reviewAudit ? { previous_review_audit: input.reviewAudit } : {}),
    ...(input.repairPlan ? { repair_plan: input.repairPlan } : {}),
    ...(input.repairVerification ? { repair_verification: input.repairVerification } : {}),
    ...(input.focusLocationKeys?.length ? { focus_location_keys: input.focusLocationKeys } : {})
  };

  return [
    `Review the human-facing manuscript${input.passLabel ? ` (${input.passLabel})` : ""}.`,
    "Judge it as a final paper that a reader would see, not as an internal draft object.",
    "Return one JSON object with this shape:",
    "{",
    '  "overall_decision": "pass | repair | stop",',
    '  "summary": "string",',
    '  "checks": {',
    '    "section_completeness": {"status": "pass | warn | fail", "note": "string"},',
    '    "paragraph_redundancy": {"status": "pass | warn | fail", "note": "string"},',
    '    "related_work_quality": {"status": "pass | warn | fail", "note": "string"},',
    '    "section_transition": {"status": "pass | warn | fail", "note": "string"},',
    '    "visual_redundancy": {"status": "pass | warn | fail", "note": "string"},',
    '    "appendix_hygiene": {"status": "pass | warn | fail", "note": "string"},',
    '    "citation_hygiene": {"status": "pass | warn | fail", "note": "string"},',
    '    "alignment": {"status": "pass | warn | fail", "note": "string"},',
    '    "rhetorical_overreach": {"status": "pass | warn | fail", "note": "string"}',
    "  },",
    '  "issues": [',
    "    {",
    '      "code": "section_completeness | paragraph_redundancy | related_work_quality | section_transition | visual_redundancy | appendix_hygiene | citation_hygiene | alignment | rhetorical_overreach",',
    '      "severity": "warning | fail",',
    '      "section": "string",',
    '      "repairable": true,',
    '      "message": "string",',
    '      "fix_recommendation": "string",',
    '      "supporting_spans": [',
    '        {"section": "string", "paragraph_index": 0, "excerpt": "string", "reason": "string"}',
    "      ],",
    '      "visual_targets": [',
    '        {"kind": "table | figure | appendix_table | appendix_figure", "index": 0, "rationale": "string"}',
    "      ]",
    "    }",
    "  ]",
    "}",
    "",
    "Review requirements:",
    "- Evaluate section completeness, paragraph-level redundancy, related-work comparison quality, transitions from Method to Results to Discussion, visual redundancy, appendix contamination, citation-text hygiene, title/abstract/conclusion alignment, and rhetorical overreach.",
    "- Use reviewer judgment instead of keyword matching for section-level adequacy. Check whether Abstract covers problem, method, main result, and takeaway; whether Introduction frames the problem and contribution; whether Related Work compares along axes; whether Method, Results, Discussion, and Limitations read like complete paper sections; and whether Conclusion stays aligned with earlier evidence.",
    "- Flag factual or comparative paragraphs that appear to need citation support or more cautious wording.",
    "- Treat evidence discipline as fixed. Do not request new experiments, new citations, or stronger evidence than the artifacts support.",
    "- Flag repeated framing sentences, repeated opening phrases, duplicated cross-section prose, summary-like sections, visual duplication, and internal/system/meta contamination.",
    "- Use paragraph_redundancy for repeated framing or duplicated prose when a local paragraph span can ground the issue.",
    "- Mark an issue as repairable only if it can be fixed by local manuscript editing without changing the evidence package.",
    "- Every emitted issue should include local evidence for why it matters. Use supporting_spans for paragraph-local issues. For visual-only issues, you may leave supporting_spans empty only if you provide precise visual_targets.",
    "- Keep supporting spans short and local. Use at most two spans per issue, and do not invent spans that are not clearly present in the manuscript.",
    "- When an issue concerns a table, figure, changed visual caption, or changed visual label wording, include visual_targets with the exact visual indices that need attention.",
    ...(input.focusLocationKeys?.length
      ? [
          "- This review is a post-repair recheck. Inspect the changed manuscript locations first, especially any changed visuals, captions, or labels.",
          `- Focus location keys: ${input.focusLocationKeys.join(", ")}`
        ]
      : []),
    ...(input.previousReview || input.reviewValidation || input.reviewAudit
      ? [
          "- This is a retry of a previous manuscript review. Correct grounding or coverage problems from the prior review instead of repeating them.",
          "- If the previous review overreached or omitted major issues, fix the review artifact rather than weakening the manuscript."
        ]
      : []),
    "- Use overall_decision=repair when the manuscript can be locally improved.",
    "- Use overall_decision=stop only when the remaining issue should not be handled by another local manuscript repair pass.",
    "",
    "Context JSON:",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}

export function buildManuscriptRepairPrompt(input: {
  manuscript: PaperManuscript;
  review: ManuscriptReviewArtifact;
  lint: ManuscriptStyleLintArtifact;
  repairPlan: ManuscriptRepairPlanArtifact;
  passIndex: number;
  remainingAllowedRepairs: number;
  mustImproveIssues: ManuscriptQualityIssueSnapshot[];
}): string {
  return [
    `Repair pass: ${input.passIndex}`,
    `Remaining allowed repair passes after this one: ${input.remainingAllowedRepairs}`,
    "Revise only the targeted manuscript-quality problems in the current human-facing manuscript JSON.",
    "This repair is bounded-local by default. Most targets allow only one paragraph, and a few explicitly listed targets may revise one adjacent paragraph in the same section.",
    "Do not rewrite the whole paper, and do not revise untargeted sections when a bounded local edit is enough.",
    "Preserve already-good sections, claims, visuals, and structure whenever possible.",
    "Do not add new evidence, new experiments, new citations, or stronger claims than the current evidence supports.",
    "Do not introduce internal instructions, TODO text, workflow directives, artifact paths, or system-language residue.",
    "If an appendix contains contaminated text, clean or remove only the contaminated material.",
    "If a figure and table are redundant, keep the more informative one and make the remaining caption and label wording conservative.",
    "Use the repair plan as the hard editing boundary. Only the listed allowed_location_keys may change; everything else should remain unchanged unless a targeted visual or appendix item is being removed.",
    "Return one JSON object with this shape:",
    "{",
    '  "revised_manuscript": {',
    '    "title": "string",',
    '    "abstract": "string",',
    '    "keywords": ["string"],',
    '    "sections": [{"heading": "string", "paragraphs": ["string"]}],',
    '    "tables": [{"caption": "string", "rows": [{"label": "string", "value": 0.0}]}],',
    '    "figures": [{"caption": "string", "bars": [{"label": "string", "value": 0.0}]}],',
    '    "appendix_sections": [{"heading": "string", "paragraphs": ["string"]}],',
    '    "appendix_tables": [{"caption": "string", "rows": [{"label": "string", "value": 0.0}]}],',
    '    "appendix_figures": [{"caption": "string", "bars": [{"label": "string", "value": 0.0}]}]',
    "  },",
    '  "resolved_target_anchor_ids": ["string"],',
    '  "changed_location_keys": ["string"],',
    '  "unchanged_anchor_ids_sample": ["string"],',
    '  "notes": "string"',
    "}",
    "Only include anchor ids that appear in the repair plan. If a target has no anchor id, leave it out of the anchor arrays.",
    "",
    "Current manuscript JSON:",
    JSON.stringify(input.manuscript, null, 2),
    "",
    "Manuscript review artifact JSON:",
    JSON.stringify(input.review, null, 2),
    "",
    "Manuscript style lint JSON:",
    JSON.stringify(input.lint, null, 2),
    "",
    "Manuscript repair plan JSON:",
    JSON.stringify(input.repairPlan, null, 2),
    "",
    "Must-improve issues JSON:",
    JSON.stringify(input.mustImproveIssues, null, 2)
  ].join("\n");
}

export function buildManuscriptReviewAuditPrompt(input: {
  manuscript: PaperManuscript;
  review: ManuscriptReviewArtifact;
  validation: ManuscriptReviewValidationArtifact;
  lint: ManuscriptStyleLintArtifact;
  traceability: PaperTraceabilityReport;
  passLabel?: string;
}): string {
  const promptPayload = {
    manuscript: input.manuscript,
    review: input.review,
    review_validation: input.validation,
    style_lint: input.lint,
    traceability: {
      paragraphs: input.traceability.paragraphs.map((paragraph) => ({
        anchor_id: paragraph.anchor_id,
        manuscript_section: paragraph.manuscript_section,
        paragraph_index: paragraph.paragraph_index,
        source_refs: paragraph.source_refs || []
      }))
    }
  };

  return [
    `Audit the manuscript review artifact${input.passLabel ? ` (${input.passLabel})` : ""}.`,
    "Judge the reliability of the reviewer output, not the manuscript directly.",
    "Return one JSON object with this shape:",
    "{",
    '  "ok": true,',
    '  "artifact_reliability": "grounded | partially_grounded | degraded",',
    '  "retry_recommended": false,',
    '  "summary": "string",',
    '  "issues": [',
    "    {",
    '      "severity": "warning | fail",',
    '      "code": "unsupported_issue | missing_major_issue | check_issue_mismatch | insufficient_grounding",',
    '      "section": "string",',
    '      "message": "string",',
    '      "fix_recommendation": "string"',
    "    }",
    "  ]",
    "}",
    "",
    "Audit rules:",
    "- Do not create a new manuscript critique. Audit whether the existing review artifact is reliable and well-grounded.",
    "- Focus on unsupported issues, missing major issues, mismatches between checks and issue list, or insufficient grounding relative to the manuscript text and traceability.",
    "- Recommend retry only when the review artifact itself is not trustworthy enough to drive repair decisions safely.",
    "- Use artifact_reliability=partially_grounded when the review remains usable but warning-level grounding or coverage gaps remain.",
    "- If the review is adequate, return ok=true, artifact_reliability=grounded, retry_recommended=false, and an empty issues list.",
    "",
    "Context JSON:",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}

export function parseManuscriptReviewJson(text: string): RawManuscriptReviewArtifact {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_manuscript_review_output");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  const candidate = fenced || extractFirstJsonObject(trimmed);
  const parsed = JSON.parse(candidate) as RawManuscriptReviewArtifact;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_manuscript_review_json");
  }
  return parsed;
}

export function parseManuscriptReviewAuditJson(text: string): RawManuscriptReviewAuditArtifact {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_manuscript_review_audit_output");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  const candidate = fenced || extractFirstJsonObject(trimmed);
  const parsed = JSON.parse(candidate) as RawManuscriptReviewAuditArtifact;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_manuscript_review_audit_json");
  }
  return parsed;
}

export function buildFallbackManuscriptReview(manuscript: PaperManuscript): ManuscriptReviewArtifact {
  const headings = new Set(manuscript.sections.map((section) => normalizeHeading(section.heading)));
  const missingCoreSections = ["introduction", "method", "results", "conclusion"].filter((heading) => !headings.has(heading));
  const issues: ManuscriptReviewIssue[] = missingCoreSections.map((heading) => ({
    code: "section_completeness",
    severity: "fail",
    section: humanizeHeading(heading),
    repairable: true,
    message: `${humanizeHeading(heading)} is missing from the final manuscript.`,
    fix_recommendation: `Restore a grounded ${humanizeHeading(heading)} section with paper-appropriate prose.`,
    supporting_spans: []
  }));
  return {
    stage: "manuscript_review",
    generated_at: new Date().toISOString(),
    overall_decision: issues.length === 0 ? "pass" : "repair",
    summary:
      issues.length === 0
        ? "Fallback manuscript review found no obvious local manuscript issues."
        : `Fallback manuscript review found ${issues.length} missing core section issue(s).`,
    checks: buildDefaultChecks(),
    issues
  };
}

export function buildFallbackManuscriptReviewAudit(
  review: ManuscriptReviewArtifact,
  validation: ManuscriptReviewValidationArtifact
): ManuscriptReviewAuditArtifact {
  if (!validation.ok) {
    return {
      ok: false,
      artifact_reliability: "degraded",
      retry_recommended: true,
      summary: "Review audit fallback marked the review artifact as degraded because validation found unsupported or ungrounded issues.",
      issues: [
        {
          severity: "fail",
          code: "insufficient_grounding",
          section: review.issues[0]?.section || "Manuscript Review",
          message: "The manuscript review artifact failed span validation, so its grounding is insufficient.",
          fix_recommendation: "Retry the manuscript review with explicit grounding feedback and valid supporting spans."
        }
      ],
      metrics: {
        ...validation.metrics,
        issue_count: 1,
        mismatch_count: Math.max(validation.metrics.mismatch_count, 1)
      }
    };
  }
  if (validation.artifact_reliability === "partially_grounded") {
    return {
      ok: true,
      artifact_reliability: "partially_grounded",
      retry_recommended: false,
      summary:
        "Review audit fallback marked the review artifact as only partially grounded because validation retained warning-level grounding gaps.",
      issues: [],
      metrics: {
        ...validation.metrics,
        issue_count: 0
      }
    };
  }
  return {
    ok: true,
    artifact_reliability: "grounded",
    retry_recommended: false,
    summary: "Review audit fallback found no reliability issue beyond the deterministic validation checks.",
    issues: [],
    metrics: {
      ...validation.metrics,
      issue_count: 0
    }
  };
}

export function normalizeManuscriptReview(
  raw: RawManuscriptReviewArtifact,
  manuscript: PaperManuscript
): ManuscriptReviewArtifact {
  const fallback = buildFallbackManuscriptReview(manuscript);
  const checksRecord = asRecord(raw.checks);
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .map((item) => normalizeManuscriptReviewIssue(item, manuscript))
        .filter((item): item is ManuscriptReviewIssue => Boolean(item))
        .slice(0, 12)
    : [];
  const overallDecision = normalizeDecision(raw.overall_decision);

  return {
    stage: "manuscript_review",
    generated_at: new Date().toISOString(),
    overall_decision:
      overallDecision || (issues.some((item) => item.severity === "fail") ? "repair" : fallback.overall_decision),
    summary: cleanString(raw.summary) || fallback.summary,
    checks: {
      section_completeness: normalizeCheck(checksRecord.section_completeness, fallback.checks.section_completeness),
      paragraph_redundancy: normalizeCheck(checksRecord.paragraph_redundancy, fallback.checks.paragraph_redundancy),
      related_work_quality: normalizeCheck(checksRecord.related_work_quality, fallback.checks.related_work_quality),
      section_transition: normalizeCheck(checksRecord.section_transition, fallback.checks.section_transition),
      visual_redundancy: normalizeCheck(checksRecord.visual_redundancy, fallback.checks.visual_redundancy),
      appendix_hygiene: normalizeCheck(checksRecord.appendix_hygiene, fallback.checks.appendix_hygiene),
      citation_hygiene: normalizeCheck(checksRecord.citation_hygiene, fallback.checks.citation_hygiene),
      alignment: normalizeCheck(checksRecord.alignment, fallback.checks.alignment),
      rhetorical_overreach: normalizeCheck(checksRecord.rhetorical_overreach, fallback.checks.rhetorical_overreach)
    },
    issues
  };
}

export function validateManuscriptReviewArtifact(input: {
  review: ManuscriptReviewArtifact;
  manuscript: PaperManuscript;
  traceability: PaperTraceabilityReport;
}): {
  review: ManuscriptReviewArtifact;
  validation: ManuscriptReviewValidationArtifact;
} {
  const issues: ManuscriptReviewValidationIssue[] = [];
  let droppedSpanCount = 0;
  let retainedIssueCount = 0;
  let validSpanCount = 0;
  let visualTargetOnlyIssueCount = 0;

  const validatedReview: ManuscriptReviewArtifact = {
    ...input.review,
    issues: input.review.issues.map((issue) => {
      const validatedSpans = issue.supporting_spans
        .map((span, spanIndex) => {
          const validated = validateSupportingSpan({
            span,
            issue,
            spanIndex,
            manuscript: input.manuscript,
            traceability: input.traceability
          });
          if (!validated.ok) {
            issues.push(validated.issue);
            droppedSpanCount += 1;
            return undefined;
          }
          if (validated.warning) {
            issues.push(validated.warning);
          }
          validSpanCount += 1;
          return validated.span;
        })
        .filter((span): span is ManuscriptReviewSupportSpan => Boolean(span));

      if (validatedSpans.length === 0) {
        if (!issue.visual_targets?.length) {
          issues.push({
            severity: "fail",
            code: "issue_missing_supporting_span",
            section: issue.section,
            message: `Review issue ${issue.code} has no retained supporting span after validation.`,
            issue_code: issue.code
          });
        } else {
          retainedIssueCount += 1;
          visualTargetOnlyIssueCount += 1;
        }
      } else {
        retainedIssueCount += 1;
      }

      return {
        ...issue,
        supporting_spans: validatedSpans
      };
    })
  };

  const failCount = issues.filter((issue) => issue.severity === "fail").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const mismatchCount = issues.filter((issue) =>
    issue.code === "invalid_supporting_span"
    || issue.code === "issue_missing_supporting_span"
    || issue.code === "unanchored_supporting_span"
  ).length;
  return {
    review: validatedReview,
    validation: {
      ok: failCount === 0,
      artifact_reliability: failCount > 0 ? "degraded" : warningCount > 0 ? "partially_grounded" : "grounded",
      retry_requested: failCount > 0,
      issues,
      dropped_span_count: droppedSpanCount,
      retained_issue_count: retainedIssueCount,
      metrics: {
        issue_count: issues.length,
        valid_span_count: validSpanCount,
        invalid_span_count: droppedSpanCount,
        visual_target_only_issue_count: visualTargetOnlyIssueCount,
        unsupported_issue_count: 0,
        mismatch_count: mismatchCount,
        retry_used: false
      }
    }
  };
}

export function normalizeManuscriptReviewAudit(
  raw: RawManuscriptReviewAuditArtifact,
  review: ManuscriptReviewArtifact,
  validation: ManuscriptReviewValidationArtifact
): ManuscriptReviewAuditArtifact {
  const fallback = buildFallbackManuscriptReviewAudit(review, validation);
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .map((item) => normalizeManuscriptReviewAuditIssue(item))
        .filter((item): item is ManuscriptReviewAuditIssue => Boolean(item))
        .slice(0, 8)
    : [];
  const retryRecommended =
    typeof raw.retry_recommended === "boolean"
      ? raw.retry_recommended
      : issues.some((issue) => issue.severity === "fail");
  const reliability = normalizeReviewReliability(raw.artifact_reliability)
    || (
      issues.some((issue) => issue.severity === "fail")
      || !validation.ok
        ? "degraded"
        : issues.some((issue) => issue.severity === "warning")
          || validation.artifact_reliability === "partially_grounded"
          ? "partially_grounded"
          : fallback.artifact_reliability
    );
  const unsupportedIssueCount = issues.filter((issue) => issue.code === "unsupported_issue").length;
  const mismatchCount = issues.filter((issue) =>
    issue.code === "check_issue_mismatch"
    || issue.code === "missing_major_issue"
    || issue.code === "insufficient_grounding"
  ).length;

  return {
    ok: typeof raw.ok === "boolean" ? raw.ok : issues.every((issue) => issue.severity !== "fail"),
    artifact_reliability: reliability,
    retry_recommended: retryRecommended,
    summary: cleanString(raw.summary) || fallback.summary,
    issues,
    metrics: {
      issue_count: issues.length,
      valid_span_count: validation.metrics.valid_span_count,
      invalid_span_count: validation.metrics.invalid_span_count,
      visual_target_only_issue_count: validation.metrics.visual_target_only_issue_count,
      unsupported_issue_count: unsupportedIssueCount,
      mismatch_count: mismatchCount,
      retry_used: validation.metrics.retry_used
    }
  };
}

export function buildManuscriptStyleLint(input: {
  manuscript: PaperManuscript;
  traceability: PaperTraceabilityReport;
}): ManuscriptStyleLintArtifact {
  const issues: ManuscriptStyleLintIssue[] = [];

  issues.push(...lintRepeatedSentences(input.manuscript));
  issues.push(...lintVisualRedundancy(input.manuscript));
  issues.push(...lintAppendixHygiene(input.manuscript));

  const deduped = dedupeStyleLintIssues(issues);
  return {
    mode: "hard_policy_only",
    checked_rules: [
      "exact_duplicate_sentence_pattern",
      "strict_visual_overlap",
      "appendix_internal_meta_leakage"
    ],
    ok: deduped.every((issue) => issue.severity !== "fail"),
    issues: deduped,
    summary:
      deduped.length === 0
        ? [
            "Policy-only manuscript lint passed without findings.",
            "Soft rhetorical judgments are handled in manuscript_review."
          ]
        : [
            "Policy-only manuscript lint emitted deterministic findings.",
            ...deduped.map((issue) => `${issue.section}: ${issue.code}`)
          ]
  };
}

export function collectManuscriptQualityIssues(input: {
  review: ManuscriptReviewArtifact;
  lint: ManuscriptStyleLintArtifact;
}): ManuscriptQualityIssueSnapshot[] {
  const reviewCoverage = buildReviewCoverage(input.review);
  return [
    ...input.review.issues.map((issue) => ({
      source: "review" as const,
      code: issue.code,
      severity: issue.severity,
      section: issue.section,
      repairable: issue.repairable,
      message: issue.message,
      anchor_ids: issue.supporting_spans
        .map((span) => cleanString(span.anchor_id))
        .filter((anchorId): anchorId is string => Boolean(anchorId))
    })),
    ...input.lint.issues
      .filter((issue) => !styleLintIssueCoveredByReview(issue, reviewCoverage))
      .map((issue) => ({
        source: "style_lint" as const,
        code: issue.code,
        severity: issue.severity,
        section: issue.section,
        repairable: issue.gate_role !== "hard_stop",
        message: issue.message
      }))
  ];
}

export function buildManuscriptRepairPlan(input: {
  passIndex: 1 | 2;
  manuscript: PaperManuscript;
  review: ManuscriptReviewArtifact;
  lint: ManuscriptStyleLintArtifact;
  mustImproveIssues: ManuscriptQualityIssueSnapshot[];
}): ManuscriptRepairPlanArtifact {
  const allowedIssueKeys = new Set(
    input.mustImproveIssues.map((issue) => buildRepairIssueKey(issue.source, issue.code, issue.section))
  );
  const targets: ManuscriptRepairTarget[] = [];
  const blockedTargets: ManuscriptRepairBlockedTarget[] = [];
  const reviewCoverage = buildReviewCoverage(input.review);

  for (const issue of input.review.issues) {
    const issueKey = buildRepairIssueKey("review", issue.code, issue.section);
    if (!allowedIssueKeys.has(issueKey)) {
      continue;
    }
    if (issue.visual_targets?.length) {
      const visualTargets = buildVisualRepairTargetsFromReviewIssue(input.manuscript, issue);
      if (visualTargets.length > 0) {
        targets.push(...visualTargets);
        continue;
      }
    }
    if (issue.supporting_spans.length === 0) {
      blockedTargets.push({
        source: "review",
        issue_code: issue.code,
        section: issue.section,
        reason: "Review issue had no validated supporting span, so bounded local repair cannot target it safely."
      });
      continue;
    }
    for (const span of issue.supporting_spans) {
      targets.push(buildRepairTargetFromSpan(input.manuscript, issue, span));
    }
  }

  for (const issue of input.lint.issues) {
    const issueKey = buildRepairIssueKey("style_lint", issue.code, issue.section);
    if (!allowedIssueKeys.has(issueKey)) {
      continue;
    }
    if (styleLintIssueCoveredByReview(issue, reviewCoverage)) {
      continue;
    }
    const lintTargets = buildRepairTargetsFromLintIssue(input.manuscript, issue);
    if (lintTargets.length === 0) {
      blockedTargets.push({
        source: "style_lint",
        issue_code: issue.code,
        section: issue.section,
        reason: "No deterministic bounded local or visual-local target could be derived from the style lint issue."
      });
      continue;
    }
    targets.push(...lintTargets);
  }

  const dedupedTargets = dedupeRepairTargets(targets);
  const dedupedBlockedTargets = dedupeBlockedTargets(blockedTargets);
  return {
    pass_index: input.passIndex,
    repair_scope: "bounded_local",
    targets: dedupedTargets,
    blocked_targets: dedupedBlockedTargets,
    preservation_rules: [
      "Edit only the targeted or explicitly allowed adjacent locations listed in this plan.",
      "Leave untargeted sections, visuals, and appendix material unchanged unless a targeted visual or appendix item is being removed.",
      "Preserve the existing evidence ceiling, citations, and source_refs; do not broaden claims beyond the current support."
    ],
    summary:
      dedupedBlockedTargets.length === 0
        ? `Repair plan ${input.passIndex} targets ${dedupedTargets.length} local manuscript location(s).`
        : `Repair plan ${input.passIndex} targets ${dedupedTargets.length} local location(s) and blocks ${dedupedBlockedTargets.length} untargetable issue(s).`
  };
}

export function reconcileManuscriptStyleLintWithReview(input: {
  lint: ManuscriptStyleLintArtifact;
  review: ManuscriptReviewArtifact;
}): ManuscriptStyleLintArtifact {
  const reviewCoverage = buildReviewCoverage(input.review);
  const issues = input.lint.issues.map((issue) => {
    const coveredBy = coveringReviewIssueCodeForLintIssue(issue, reviewCoverage);
    if (!coveredBy) {
      return {
        ...issue,
        coverage_status: "primary" as const,
        gate_role: inferLintGateRole(issue, undefined)
      };
    }
    return {
      ...issue,
      coverage_status: "backstop_only" as const,
      covered_by_review_issue_code: coveredBy,
      gate_role: inferLintGateRole(issue, coveredBy)
    };
  });
  return {
    ...input.lint,
    issues,
    summary:
      issues.length === 0
        ? input.lint.summary
        : issues.some((issue) => issue.gate_role === "backstop_only" || issue.gate_role === "hard_stop")
          ? [
              ...input.lint.summary,
              ...buildHardStopSummaryLines(issues),
              ...buildBackstopOnlySummaryLines(issues)
            ]
          : input.lint.summary
  };
}

export function buildManuscriptRepairVerificationArtifact(input: {
  passIndex: 1 | 2;
  before: PaperManuscript;
  after: PaperManuscript;
  repairPlan: ManuscriptRepairPlanArtifact;
  reviewAfter: ManuscriptReviewArtifact;
}): ManuscriptRepairVerificationArtifact {
  const targetAnchorIds = uniqueStrings(
    input.repairPlan.targets
      .map((target) => cleanString(target.anchor_id))
      .filter((anchorId): anchorId is string => Boolean(anchorId))
  );
  const targetLocationKeys = uniqueStrings(input.repairPlan.targets.map((target) => target.location_key));
  const allowedLocationKeys = uniqueStrings(
    input.repairPlan.targets.flatMap((target) =>
      target.allowed_location_keys.length > 0 ? target.allowed_location_keys : [target.location_key]
    )
  );
  const changedLocationKeys = collectChangedLocationKeys(input.before, input.after);
  const outOfScopeChanges = changedLocationKeys.filter((locationKey) => !allowedLocationKeys.includes(locationKey));
  const afterIssueAnchorIds = new Set(
    input.reviewAfter.issues.flatMap((issue) =>
      issue.supporting_spans
        .map((span) => cleanString(span.anchor_id))
        .filter((anchorId): anchorId is string => Boolean(anchorId))
    )
  );
  const stillFailingAnchorIds = targetAnchorIds.filter((anchorId) => afterIssueAnchorIds.has(anchorId));
  const resolvedAnchorIds = targetAnchorIds.filter((anchorId) => !afterIssueAnchorIds.has(anchorId));
  const unexpectedChangedSections = uniqueStrings(outOfScopeChanges.map(locationKeyToSection));
  const scopeDowngradedTargets = uniqueStrings(
    input.repairPlan.targets
      .filter((target) => Boolean(target.scope_downgraded))
      .map((target) => target.location_key)
  );
  const scopeRespected = outOfScopeChanges.length === 0;
  const visualCaptionChecks = buildVisualCaptionChecks(input.after, changedLocationKeys);
  const visualLabelChecks = buildVisualLabelChecks(input.after, changedLocationKeys);
  const visualCaptionConservatismOk = visualCaptionChecks.every((check) => check.conservative);
  const visualLabelConservatismOk = visualLabelChecks.every((check) => check.conservative);
  const visualConservatismOk = visualCaptionConservatismOk && visualLabelConservatismOk;
  const overclaimingCaptionLocations = visualCaptionChecks
    .filter((check) => !check.conservative)
    .map((check) => check.location_key);
  const overclaimingLabelLocations = visualLabelChecks
    .filter((check) => !check.conservative)
    .map((check) => check.location_key);

  return {
    pass_index: input.passIndex,
    target_anchor_ids: targetAnchorIds,
    target_location_keys: targetLocationKeys,
    allowed_location_keys: allowedLocationKeys,
    resolved_anchor_ids: resolvedAnchorIds,
    still_failing_anchor_ids: stillFailingAnchorIds,
    changed_location_keys: changedLocationKeys,
    out_of_scope_changes: outOfScopeChanges,
    unexpected_changed_sections: unexpectedChangedSections,
    scope_respected: scopeRespected,
    scope_downgraded_targets: scopeDowngradedTargets,
    locality_ok: scopeRespected,
    visual_caption_conservatism_ok: visualCaptionConservatismOk,
    visual_caption_checks: visualCaptionChecks,
    visual_label_conservatism_ok: visualLabelConservatismOk,
    visual_label_checks: visualLabelChecks,
    visual_conservatism_ok: visualConservatismOk,
    summary: scopeRespected
      ? visualConservatismOk
        ? `Repair verification ${input.passIndex} observed only allowed bounded-local changes and conservative changed visual surfaces.`
        : `Repair verification ${input.passIndex} observed only allowed bounded-local changes, but changed visual surfaces at ${uniqueStrings([...overclaimingCaptionLocations, ...overclaimingLabelLocations]).join(", ")} still overstate the takeaway.`
      : `Repair verification ${input.passIndex} found out-of-scope changes in ${unexpectedChangedSections.join(", ") || "unknown sections"}.`
  };
}

function lintRepeatedSentences(manuscript: PaperManuscript): ManuscriptStyleLintIssue[] {
  const issues: ManuscriptStyleLintIssue[] = [];
  const seen = new Map<string, { section: string; paragraphIndex: number; text: string }>();
  for (const section of manuscript.sections) {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      for (const sentence of splitSentences(paragraph)) {
        const normalized = normalizeSentence(sentence);
        if (normalized.length < 48) {
          continue;
        }
        const previous = seen.get(normalized);
        if (previous && previous.section !== section.heading) {
          issues.push({
            severity: "warning",
            code: "duplicate_sentence_pattern",
            section: section.heading,
            message: `The same sentence from ${previous.section} is repeated in ${section.heading}.`,
            fix_recommendation: "Rewrite one of the sections so each paragraph advances a distinct rhetorical role.",
            location_keys: uniqueStrings([
              buildParagraphLocationKey("paragraph", section.heading, paragraphIndex),
              buildParagraphLocationKey("paragraph", previous.section, previous.paragraphIndex)
            ])
          });
        } else if (!previous) {
          seen.set(normalized, { section: section.heading, paragraphIndex, text: sentence });
        }
      }
    });
  }
  return issues;
}

function lintVisualRedundancy(manuscript: PaperManuscript): ManuscriptStyleLintIssue[] {
  if (!manuscript.tables?.length || !manuscript.figures?.length) {
    return [];
  }
  const tables = manuscript.tables;
  const figures = manuscript.figures;
  const issues: ManuscriptStyleLintIssue[] = [];
  tables.forEach((table, tableIndex) => {
    const tableLabels = new Set(table.rows.map((row) => normalizeSentence(row.label)));
    const tableValueByLabel = new Map(
      table.rows.map((row) => [normalizeSentence(row.label), Number.isFinite(row.value) ? row.value : NaN] as const)
    );
    figures.forEach((figure, figureIndex) => {
      const figureLabels = new Set(figure.bars.map((row) => normalizeSentence(row.label)));
      if (tableLabels.size === 0 || figureLabels.size === 0 || tableLabels.size !== figureLabels.size) {
        return;
      }
      const overlap = jaccard(tableLabels, figureLabels);
      if (overlap < 1) {
        return;
      }
      const identicalValues = figure.bars.every((bar) => {
        const key = normalizeSentence(bar.label);
        const tableValue = tableValueByLabel.get(key);
        return typeof tableValue === "number" && Number.isFinite(tableValue) && Math.abs(tableValue - bar.value) < 1e-9;
      });
      if (!identicalValues) {
        return;
      }
      const sharedLabels = table.rows.map((row) => row.label).filter(Boolean);
      issues.push({
        severity: "warning",
        code: "visual_redundancy",
        section: "Results",
        message: `Table ${tableIndex + 1} and Figure ${figureIndex + 1} encode the same labels and values, so one is likely a redundant restatement.`,
        fix_recommendation: "Keep the more informative representation or revise one visual so it communicates a distinct pattern.",
        redundant_visual_pair: {
          table_index: tableIndex,
          figure_index: figureIndex,
          shared_labels: sharedLabels
        }
      });
    });
  });
  return issues;
}

function lintAppendixHygiene(manuscript: PaperManuscript): ManuscriptStyleLintIssue[] {
  const hasAppendixContent = Boolean(
    (manuscript.appendix_sections || []).length
    || (manuscript.appendix_tables || []).length
    || (manuscript.appendix_figures || []).length
  );
  if (!hasAppendixContent) {
    return [];
  }
  const issues: ManuscriptStyleLintIssue[] = [];
  for (const { code, pattern, fix } of buildAppendixLeakagePatterns()) {
    const locationKeys: string[] = [];
    let foundUnlocatableHeadingLeak = false;
    (manuscript.appendix_sections || []).forEach((section) => {
      if (pattern.test(section.heading)) {
        foundUnlocatableHeadingLeak = true;
      }
      section.paragraphs.forEach((paragraph, paragraphIndex) => {
        if (pattern.test(paragraph)) {
          locationKeys.push(buildParagraphLocationKey("appendix_paragraph", section.heading, paragraphIndex));
        }
      });
    });
    (manuscript.appendix_tables || []).forEach((table, index) => {
      if (pattern.test(table.caption)) {
        locationKeys.push(`appendix_table:${index}`);
      }
    });
    (manuscript.appendix_figures || []).forEach((figure, index) => {
      if (pattern.test(figure.caption)) {
        locationKeys.push(`appendix_figure:${index}`);
      }
    });
    if (foundUnlocatableHeadingLeak || locationKeys.length > 0) {
      issues.push({
        severity: "fail",
        code,
        section: "Appendix",
        message: "Appendix contains internal, meta, or raw-artifact text that should not appear in a paper.",
        fix_recommendation: fix,
        ...(locationKeys.length > 0 ? { location_keys: uniqueStrings(locationKeys) } : {})
      });
    }
  }
  return issues;
}

function buildAppendixLeakagePatterns(): Array<{ code: string; pattern: RegExp; fix: string }> {
  return [
    {
      code: "appendix_internal_text",
      pattern: /\bworkflow directive|system prompt|internal instruction|implementation todo|author note\b/iu,
      fix: "Remove internal or process-facing language from the appendix."
    },
    {
      code: "appendix_meta_text",
      pattern: /\bkeep topic fixed|todo|tbd|placeholder|next step|unresolved\b/iu,
      fix: "Replace planning/meta residue with reader-facing supporting material or remove it."
    },
    {
      code: "appendix_raw_artifact_reference",
      pattern: /(?:\/home\/|\.autolabos\/|result_analysis\.json|metrics\.json|events\.jsonl)/iu,
      fix: "Remove raw artifact paths and internal file references from the appendix prose."
    }
  ];
}

function dedupeStyleLintIssues(issues: ManuscriptStyleLintIssue[]): ManuscriptStyleLintIssue[] {
  const seen = new Set<string>();
  const result: ManuscriptStyleLintIssue[] = [];
  for (const issue of issues) {
    const key =
      issue.code === "visual_redundancy" && issue.redundant_visual_pair
        ? `${issue.code}:${issue.section}:${issue.severity}:${issue.redundant_visual_pair.table_index}:${issue.redundant_visual_pair.figure_index}`
        : issue.code === "duplicate_sentence_pattern" && issue.location_keys?.length
          ? `${issue.code}:${issue.section}:${issue.severity}:${uniqueStrings(issue.location_keys).sort().join("|")}`
        : `${issue.code}:${issue.section}:${issue.severity}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(issue);
  }
  return result.slice(0, 24);
}

function buildRepairTargetFromSpan(
  manuscript: PaperManuscript,
  issue: ManuscriptReviewIssue,
  span: ManuscriptReviewSupportSpan
): ManuscriptRepairTarget {
  const normalizedSection = normalizeHeading(span.section);
  const kind = normalizedSection === "title"
    ? "title"
    : normalizedSection === "abstract"
      ? "abstract"
      : isAppendixSectionName(span.section)
        ? "appendix_paragraph"
        : "paragraph";
  const section = normalizedSection === "title"
    ? "Title"
    : normalizedSection === "abstract"
      ? "Abstract"
      : span.section;
  const locationKey = buildParagraphLocationKey(kind, section, span.paragraph_index);
  const baseTarget: ManuscriptRepairTarget = {
    source: "review",
    issue_code: issue.code,
    severity: issue.severity,
    kind,
    section,
    location_key: locationKey,
    paragraph_index: span.paragraph_index,
    ...(span.anchor_id ? { anchor_id: span.anchor_id } : {}),
    excerpt: span.excerpt,
    source_refs: span.source_refs || [],
    edit_scope: kind === "appendix_paragraph" ? "appendix_local" : "paragraph_local",
    allowed_location_keys: [locationKey],
    scope_reason:
      kind === "appendix_paragraph"
        ? "Appendix repair is limited to the targeted contaminated appendix paragraph."
        : "Repair is limited to the targeted manuscript paragraph."
  };
  return applyReviewRepairScope({
    manuscript,
    issue,
    target: baseTarget
  });
}

function applyReviewRepairScope(input: {
  manuscript: PaperManuscript;
  issue: ManuscriptReviewIssue;
  target: ManuscriptRepairTarget;
}): ManuscriptRepairTarget {
  if (input.target.kind !== "paragraph") {
    return input.target;
  }
  if (input.issue.code === "section_transition") {
    return expandTargetToAdjacentParagraph({
      manuscript: input.manuscript,
      target: input.target,
      preferNext: true,
      reason:
        "Section-transition repair may revise the targeted paragraph and one adjacent paragraph in the same section.",
      downgradeReason:
        "Section-transition repair stayed paragraph-local because no adjacent paragraph exists in the same section."
    });
  }
  if (input.issue.code === "paragraph_redundancy") {
    const pairedParagraphKey = findAdjacentParagraphKeyFromIssueSpans(
      input.target,
      input.issue.supporting_spans
    );
    if (pairedParagraphKey) {
      return {
        ...input.target,
        edit_scope: "adjacent_two_paragraphs",
        allowed_location_keys: uniqueStrings([input.target.location_key, pairedParagraphKey]),
        scope_reason:
          "Paragraph-redundancy repair may revise one adjacent paragraph pair because the validated issue spans point to neighboring paragraphs."
      };
    }
    return input.target;
  }
  if (input.issue.code === "alignment") {
    const pairedParagraphKey = findAdjacentParagraphKeyFromIssueSpans(
      input.target,
      input.issue.supporting_spans
    );
    if (pairedParagraphKey) {
      return {
        ...input.target,
        edit_scope: "adjacent_two_paragraphs",
        allowed_location_keys: uniqueStrings([input.target.location_key, pairedParagraphKey]),
        scope_reason:
          "Alignment repair may revise one adjacent paragraph pair because the validated issue spans point to neighboring framing paragraphs in the same section."
      };
    }
    if (!isAlignmentAdjacentSection(input.target.section)) {
      return input.target;
    }
    return expandTargetToAdjacentParagraph({
      manuscript: input.manuscript,
      target: input.target,
      preferNext: shouldPreferNextAlignmentParagraph(input.manuscript, input.target),
      reason:
        `${input.target.section} alignment repair may revise the targeted paragraph and one adjacent paragraph in the same section.`,
      downgradeReason:
        `${input.target.section} alignment repair stayed paragraph-local because no adjacent paragraph exists in the same section.`
    });
  }
  return input.target;
}

function isAlignmentAdjacentSection(section: string): boolean {
  const normalized = normalizeHeading(section);
  return normalized === "introduction" || normalized === "conclusion";
}

function shouldPreferNextAlignmentParagraph(
  manuscript: PaperManuscript,
  target: ManuscriptRepairTarget
): boolean {
  if (target.kind !== "paragraph" || target.paragraph_index === undefined) {
    return true;
  }
  const section = manuscript.sections.find(
    (item) => normalizeHeading(item.heading) === normalizeHeading(target.section)
  );
  if (!section || section.paragraphs.length <= 1) {
    return true;
  }
  return target.paragraph_index === 0;
}

function expandTargetToAdjacentParagraph(input: {
  manuscript: PaperManuscript;
  target: ManuscriptRepairTarget;
  preferNext: boolean;
  reason: string;
  downgradeReason: string;
}): ManuscriptRepairTarget {
  const adjacentLocationKey = findAdjacentParagraphLocationKey({
    manuscript: input.manuscript,
    target: input.target,
    preferNext: input.preferNext
  });
  if (!adjacentLocationKey) {
    return {
      ...input.target,
      scope_reason: input.downgradeReason,
      scope_downgraded: true
    };
  }
  return {
    ...input.target,
    edit_scope: "adjacent_two_paragraphs",
    allowed_location_keys: uniqueStrings([input.target.location_key, adjacentLocationKey]),
    scope_reason: input.reason
  };
}

function findAdjacentParagraphKeyFromIssueSpans(
  target: ManuscriptRepairTarget,
  spans: ManuscriptReviewSupportSpan[]
): string | undefined {
  if (target.paragraph_index === undefined) {
    return undefined;
  }
  for (const span of spans) {
    if (normalizeHeading(span.section) !== normalizeHeading(target.section)) {
      continue;
    }
    if (span.paragraph_index === target.paragraph_index) {
      continue;
    }
    if (Math.abs(span.paragraph_index - target.paragraph_index) !== 1) {
      continue;
    }
    return buildParagraphLocationKey("paragraph", target.section, span.paragraph_index);
  }
  return undefined;
}

function findAdjacentParagraphLocationKey(input: {
  manuscript: PaperManuscript;
  target: ManuscriptRepairTarget;
  preferNext: boolean;
}): string | undefined {
  if (input.target.kind !== "paragraph" || input.target.paragraph_index === undefined) {
    return undefined;
  }
  const section = input.manuscript.sections.find(
    (item) => normalizeHeading(item.heading) === normalizeHeading(input.target.section)
  );
  if (!section || section.paragraphs.length <= 1) {
    return undefined;
  }
  const candidateIndices = input.preferNext
    ? [input.target.paragraph_index + 1, input.target.paragraph_index - 1]
    : [input.target.paragraph_index - 1, input.target.paragraph_index + 1];
  for (const candidateIndex of candidateIndices) {
    if (candidateIndex < 0 || candidateIndex >= section.paragraphs.length) {
      continue;
    }
    return buildParagraphLocationKey("paragraph", section.heading, candidateIndex);
  }
  return undefined;
}

function buildRepairTargetsFromLintIssue(
  manuscript: PaperManuscript,
  issue: ManuscriptStyleLintIssue
): ManuscriptRepairTarget[] {
  switch (issue.code) {
    case "duplicate_sentence_pattern":
      return buildDuplicateSentenceRepairTargets(manuscript, issue);
    case "visual_redundancy":
      return buildVisualRepairTargets(manuscript, issue);
    case "appendix_internal_text":
    case "appendix_meta_text":
    case "appendix_raw_artifact_reference":
      return buildAppendixRepairTargets(manuscript, issue);
    default:
      return [];
  }
}

function buildDuplicateSentenceRepairTargets(
  manuscript: PaperManuscript,
  issue: ManuscriptStyleLintIssue
): ManuscriptRepairTarget[] {
  const targetSection = manuscript.sections.find((section) => normalizeHeading(section.heading) === normalizeHeading(issue.section));
  if (!targetSection) {
    return [];
  }
  const normalizedBySentence = new Map<string, Array<{ section: string; paragraphIndex: number; sentence: string }>>();
  for (const section of manuscript.sections) {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      splitSentences(paragraph).forEach((sentence) => {
        const normalized = normalizeSentence(sentence);
        if (normalized.length < 48) {
          return;
        }
        const existing = normalizedBySentence.get(normalized) || [];
        existing.push({ section: section.heading, paragraphIndex, sentence });
        normalizedBySentence.set(normalized, existing);
      });
    });
  }
  const targets: ManuscriptRepairTarget[] = [];
  targetSection.paragraphs.forEach((paragraph, paragraphIndex) => {
    const repeatedSentence = splitSentences(paragraph).find((sentence) => {
      const normalized = normalizeSentence(sentence);
      const matches = normalizedBySentence.get(normalized) || [];
      return matches.some((match) => normalizeHeading(match.section) !== normalizeHeading(targetSection.heading));
    });
    if (!repeatedSentence) {
      return;
    }
    targets.push({
      source: "style_lint",
      issue_code: issue.code,
      severity: issue.severity,
      kind: "paragraph",
      section: targetSection.heading,
      location_key: buildParagraphLocationKey("paragraph", targetSection.heading, paragraphIndex),
      paragraph_index: paragraphIndex,
      excerpt: repeatedSentence,
      source_refs: [],
      edit_scope: "paragraph_local",
      allowed_location_keys: [buildParagraphLocationKey("paragraph", targetSection.heading, paragraphIndex)],
      scope_reason: "Duplicate-sentence repair is limited to the repeated paragraph."
    });
  });
  return targets;
}

function buildVisualRepairTargets(
  manuscript: PaperManuscript,
  issue: ManuscriptStyleLintIssue
): ManuscriptRepairTarget[] {
  const targets: ManuscriptRepairTarget[] = [];
  const pair = issue.redundant_visual_pair;
  if (!pair) {
    return targets;
  }
  const table = manuscript.tables?.[pair.table_index];
  if (table) {
    targets.push({
      source: "style_lint",
      issue_code: issue.code,
      severity: issue.severity,
      kind: "table",
      section: "Results",
      location_key: `table:${pair.table_index}`,
      visual_index: pair.table_index,
      excerpt: table.caption,
      source_refs: table.source_refs || [],
      edit_scope: "visual_local",
      allowed_location_keys: [`table:${pair.table_index}`],
      scope_reason: `Visual redundancy repair is limited to Table ${pair.table_index + 1} in the redundant table/figure pair.`
    });
  }
  const figure = manuscript.figures?.[pair.figure_index];
  if (figure) {
    targets.push({
      source: "style_lint",
      issue_code: issue.code,
      severity: issue.severity,
      kind: "figure",
      section: "Results",
      location_key: `figure:${pair.figure_index}`,
      visual_index: pair.figure_index,
      excerpt: figure.caption,
      source_refs: figure.source_refs || [],
      edit_scope: "visual_local",
      allowed_location_keys: [`figure:${pair.figure_index}`],
      scope_reason: `Visual redundancy repair is limited to Figure ${pair.figure_index + 1} in the redundant table/figure pair.`
    });
  }
  return targets;
}

function buildVisualRepairTargetsFromReviewIssue(
  manuscript: PaperManuscript,
  issue: ManuscriptReviewIssue
): ManuscriptRepairTarget[] {
  const targets: ManuscriptRepairTarget[] = [];
  for (const visualTarget of issue.visual_targets || []) {
    const target = resolveReviewVisualRepairTarget(manuscript, issue, visualTarget);
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

function resolveReviewVisualRepairTarget(
  manuscript: PaperManuscript,
  issue: ManuscriptReviewIssue,
  visualTarget: ManuscriptReviewVisualTarget
): ManuscriptRepairTarget | undefined {
  const collection =
    visualTarget.kind === "table"
      ? manuscript.tables
      : visualTarget.kind === "figure"
        ? manuscript.figures
        : visualTarget.kind === "appendix_table"
          ? manuscript.appendix_tables
          : manuscript.appendix_figures;
  const item = collection?.[visualTarget.index];
  if (!item) {
    return undefined;
  }
  const locationKey =
    visualTarget.kind === "table"
      ? `table:${visualTarget.index}`
      : visualTarget.kind === "figure"
        ? `figure:${visualTarget.index}`
        : visualTarget.kind === "appendix_table"
          ? `appendix_table:${visualTarget.index}`
          : `appendix_figure:${visualTarget.index}`;
  return {
    source: "review",
    issue_code: issue.code,
    severity: issue.severity,
    kind: visualTarget.kind,
    section: visualTarget.kind.startsWith("appendix_") ? "Appendix" : "Results",
    location_key: locationKey,
    visual_index: visualTarget.index,
    excerpt: cleanString(item.caption),
    source_refs: item.source_refs || [],
    edit_scope: visualTarget.kind.startsWith("appendix_") ? "appendix_local" : "visual_local",
    allowed_location_keys: [locationKey],
    scope_reason:
      visualTarget.rationale
      || `Reviewer-directed ${visualTarget.kind.replace(/_/gu, " ")} repair is limited to ${locationKey}.`
  };
}

function buildAppendixRepairTargets(
  manuscript: PaperManuscript,
  issue: ManuscriptStyleLintIssue
): ManuscriptRepairTarget[] {
  const targets: ManuscriptRepairTarget[] = [];
  const patterns = buildAppendixLeakagePatterns();
  const targetPattern = patterns.find((item) => item.code === issue.code)?.pattern;
  if (!targetPattern) {
    return targets;
  }
  (manuscript.appendix_sections || []).forEach((section) => {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      if (!targetPattern.test(paragraph)) {
        return;
      }
      targets.push({
        source: "style_lint",
        issue_code: issue.code,
        severity: issue.severity,
        kind: "appendix_paragraph",
        section: section.heading,
        location_key: buildParagraphLocationKey("appendix_paragraph", section.heading, paragraphIndex),
        paragraph_index: paragraphIndex,
        excerpt: paragraph,
        source_refs: section.source_refs || [],
        edit_scope: "appendix_local",
        allowed_location_keys: [buildParagraphLocationKey("appendix_paragraph", section.heading, paragraphIndex)],
        scope_reason: "Appendix hygiene repair is limited to the contaminated appendix paragraph."
      });
    });
  });
  (manuscript.appendix_tables || []).forEach((table, index) => {
    if (!targetPattern.test(table.caption)) {
      return;
    }
    targets.push({
      source: "style_lint",
      issue_code: issue.code,
      severity: issue.severity,
      kind: "appendix_table",
      section: "Appendix",
      location_key: `appendix_table:${index}`,
      visual_index: index,
      excerpt: table.caption,
      source_refs: table.source_refs || [],
      edit_scope: "appendix_local",
      allowed_location_keys: [`appendix_table:${index}`],
      scope_reason: "Appendix hygiene repair is limited to the contaminated appendix table."
    });
  });
  (manuscript.appendix_figures || []).forEach((figure, index) => {
    if (!targetPattern.test(figure.caption)) {
      return;
    }
    targets.push({
      source: "style_lint",
      issue_code: issue.code,
      severity: issue.severity,
      kind: "appendix_figure",
      section: "Appendix",
      location_key: `appendix_figure:${index}`,
      visual_index: index,
      excerpt: figure.caption,
      source_refs: figure.source_refs || [],
      edit_scope: "appendix_local",
      allowed_location_keys: [`appendix_figure:${index}`],
      scope_reason: "Appendix hygiene repair is limited to the contaminated appendix figure."
    });
  });
  return targets;
}

function collectChangedLocationKeys(before: PaperManuscript, after: PaperManuscript): string[] {
  const changed = new Set<string>();
  if (cleanString(before.title) !== cleanString(after.title)) {
    changed.add("title");
  }
  if (cleanString(before.abstract) !== cleanString(after.abstract)) {
    changed.add("abstract");
  }
  collectChangedParagraphKeys(before.sections, after.sections, "paragraph", changed);
  collectChangedParagraphKeys(before.appendix_sections || [], after.appendix_sections || [], "appendix_paragraph", changed);
  collectChangedVisualKeys(before.tables || [], after.tables || [], "table", changed);
  collectChangedVisualKeys(before.figures || [], after.figures || [], "figure", changed);
  collectChangedVisualKeys(before.appendix_tables || [], after.appendix_tables || [], "appendix_table", changed);
  collectChangedVisualKeys(before.appendix_figures || [], after.appendix_figures || [], "appendix_figure", changed);
  return [...changed];
}

function collectChangedParagraphKeys(
  beforeSections: Array<{ heading: string; paragraphs: string[] }>,
  afterSections: Array<{ heading: string; paragraphs: string[] }>,
  kind: "paragraph" | "appendix_paragraph",
  changed: Set<string>
): void {
  const headings = uniqueStrings([
    ...beforeSections.map((section) => section.heading),
    ...afterSections.map((section) => section.heading)
  ]);
  for (const heading of headings) {
    const beforeSection = beforeSections.find((section) => section.heading === heading);
    const afterSection = afterSections.find((section) => section.heading === heading);
    const paragraphCount = Math.max(beforeSection?.paragraphs.length || 0, afterSection?.paragraphs.length || 0);
    for (let paragraphIndex = 0; paragraphIndex < paragraphCount; paragraphIndex += 1) {
      const beforeParagraph = cleanString(beforeSection?.paragraphs[paragraphIndex]);
      const afterParagraph = cleanString(afterSection?.paragraphs[paragraphIndex]);
      if (beforeParagraph !== afterParagraph) {
        changed.add(buildParagraphLocationKey(kind, heading, paragraphIndex));
      }
    }
  }
}

function collectChangedVisualKeys(
  beforeItems: Array<{ caption: string; rows?: unknown; bars?: unknown }>,
  afterItems: Array<{ caption: string; rows?: unknown; bars?: unknown }>,
  prefix: "table" | "figure" | "appendix_table" | "appendix_figure",
  changed: Set<string>
): void {
  const itemCount = Math.max(beforeItems.length, afterItems.length);
  for (let index = 0; index < itemCount; index += 1) {
    if (JSON.stringify(beforeItems[index] || null) !== JSON.stringify(afterItems[index] || null)) {
      changed.add(`${prefix}:${index}`);
    }
  }
}

function buildVisualCaptionChecks(
  manuscript: PaperManuscript,
  changedLocationKeys: string[]
): Array<{
  location_key: string;
  section: string;
  caption: string;
  conservative: boolean;
  concerns: string[];
  fix_recommendation: string;
}> {
  return changedLocationKeys
    .filter((locationKey) =>
      locationKey.startsWith("table:")
      || locationKey.startsWith("figure:")
      || locationKey.startsWith("appendix_table:")
      || locationKey.startsWith("appendix_figure:")
    )
    .map((locationKey) => {
      const caption = resolveVisualCaption(manuscript, locationKey);
      const concerns = buildVisualWordingConcerns(caption);
      return {
        location_key: locationKey,
        section: locationKeyToSection(locationKey),
        caption,
        conservative: concerns.length === 0,
        concerns,
        fix_recommendation:
          concerns.length === 0
            ? "No caption edit needed."
            : "Rewrite the caption so it states a scoped, visual-specific takeaway without broad applicability or proof-style language."
      };
    });
}

function buildVisualLabelChecks(
  manuscript: PaperManuscript,
  changedLocationKeys: string[]
): Array<{
  location_key: string;
  section: string;
  labels: string[];
  conservative: boolean;
  concerns: string[];
  fix_recommendation: string;
}> {
  return changedLocationKeys
    .filter((locationKey) =>
      locationKey.startsWith("table:")
      || locationKey.startsWith("figure:")
      || locationKey.startsWith("appendix_table:")
      || locationKey.startsWith("appendix_figure:")
    )
    .map((locationKey) => {
      const labels = resolveVisualLabels(manuscript, locationKey);
      const concerns = uniqueStrings(labels.flatMap((label) => buildVisualWordingConcerns(label)));
      return {
        location_key: locationKey,
        section: locationKeyToSection(locationKey),
        labels,
        conservative: concerns.length === 0,
        concerns,
        fix_recommendation:
          concerns.length === 0
            ? "No visual label edit needed."
            : "Rewrite the changed visual labels so they stay descriptive and scoped to the observed pattern."
      };
    });
}

function resolveVisualCaption(manuscript: PaperManuscript, locationKey: string): string {
  if (locationKey.startsWith("table:")) {
    return cleanString(manuscript.tables?.[parseLocationIndex(locationKey)]?.caption);
  }
  if (locationKey.startsWith("figure:")) {
    return cleanString(manuscript.figures?.[parseLocationIndex(locationKey)]?.caption);
  }
  if (locationKey.startsWith("appendix_table:")) {
    return cleanString(manuscript.appendix_tables?.[parseLocationIndex(locationKey)]?.caption);
  }
  if (locationKey.startsWith("appendix_figure:")) {
    return cleanString(manuscript.appendix_figures?.[parseLocationIndex(locationKey)]?.caption);
  }
  return "";
}

function resolveVisualLabels(manuscript: PaperManuscript, locationKey: string): string[] {
  if (locationKey.startsWith("table:")) {
    return (manuscript.tables?.[parseLocationIndex(locationKey)]?.rows || []).map((row) => cleanString(row.label));
  }
  if (locationKey.startsWith("figure:")) {
    return (manuscript.figures?.[parseLocationIndex(locationKey)]?.bars || []).map((bar) => cleanString(bar.label));
  }
  if (locationKey.startsWith("appendix_table:")) {
    return (manuscript.appendix_tables?.[parseLocationIndex(locationKey)]?.rows || []).map((row) => cleanString(row.label));
  }
  if (locationKey.startsWith("appendix_figure:")) {
    return (manuscript.appendix_figures?.[parseLocationIndex(locationKey)]?.bars || []).map((bar) => cleanString(bar.label));
  }
  return [];
}

function parseLocationIndex(locationKey: string): number {
  const raw = locationKey.split(":")[1];
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function buildVisualWordingConcerns(text: string): string[] {
  if (!text) {
    return [];
  }
  const concerns: string[] = [];
  const patterns = [
    {
      pattern: /\b(clearly demonstrates broad applicability|demonstrates broad applicability|broad applicability)\b/iu,
      reason: "The visual wording claims broad applicability beyond the tested setting."
    },
    {
      pattern: /\b(substantially advances|state-of-the-art|universally|in all settings|across domains)\b/iu,
      reason: "The visual wording overstates the strength or scope of the takeaway."
    },
    {
      pattern: /\b(proves|proof of|definitively shows|unequivocally shows)\b/iu,
      reason: "The visual wording uses proof-style language instead of conservative empirical wording."
    }
  ];
  for (const { pattern, reason } of patterns) {
    if (pattern.test(text)) {
      concerns.push(reason);
    }
  }
  return concerns;
}

function buildParagraphLocationKey(
  kind: "title" | "abstract" | "paragraph" | "appendix_paragraph",
  section: string,
  paragraphIndex: number
): string {
  if (kind === "title") {
    return "title";
  }
  if (kind === "abstract") {
    return "abstract";
  }
  const normalizedSection = section.replace(/\s+/gu, "_").toLowerCase();
  return `${kind}:${normalizedSection}:${paragraphIndex}`;
}

function locationKeyToSection(locationKey: string): string {
  if (locationKey === "title") {
    return "Title";
  }
  if (locationKey === "abstract") {
    return "Abstract";
  }
  if (locationKey.startsWith("table:") || locationKey.startsWith("figure:")) {
    return "Results";
  }
  if (locationKey.startsWith("appendix_table:") || locationKey.startsWith("appendix_figure:")) {
    return "Appendix";
  }
  const parts = locationKey.split(":");
  if (parts.length >= 3) {
    return parts[1].replace(/_/gu, " ");
  }
  return "Unknown";
}

function dedupeRepairTargets(targets: ManuscriptRepairTarget[]): ManuscriptRepairTarget[] {
  const deduped: ManuscriptRepairTarget[] = [];
  for (const target of targets) {
    const existingIndex = deduped.findIndex(
      (item) => item.issue_code === target.issue_code && item.location_key === target.location_key
    );
    if (existingIndex >= 0) {
      if (deduped[existingIndex]?.source === "style_lint" && target.source === "review") {
        deduped.splice(existingIndex, 1, target);
      }
      continue;
    }
    deduped.push(target);
  }
  return deduped;
}

function dedupeBlockedTargets(targets: ManuscriptRepairBlockedTarget[]): ManuscriptRepairBlockedTarget[] {
  const seen = new Set<string>();
  const deduped: ManuscriptRepairBlockedTarget[] = [];
  for (const target of targets) {
    const key = `${target.source}:${target.issue_code}:${target.section}:${target.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function buildRepairIssueKey(source: "review" | "style_lint", code: string, section: string): string {
  return `${source}:${cleanString(code)}:${normalizeHeading(section)}`;
}

function reviewIssueVisualLocationKeys(issue: ManuscriptReviewIssue): string[] {
  return (issue.visual_targets || []).map(reviewVisualTargetToLocationKey);
}

function reviewIssueParagraphLocationKeys(issue: ManuscriptReviewIssue): string[] {
  return issue.supporting_spans
    .map((span) => reviewSupportSpanToLocationKey(span))
    .filter((locationKey): locationKey is string => Boolean(locationKey));
}

function buildReviewCoverage(review: ManuscriptReviewArtifact): {
  reviewVisualLocationKeys: Set<string>;
  reviewParagraphRedundancyLocationKeys: Set<string>;
  reviewAppendixHygieneLocationKeys: Set<string>;
} {
  return {
    reviewVisualLocationKeys: new Set(
      review.issues.flatMap((issue) => reviewIssueVisualLocationKeys(issue))
    ),
    reviewParagraphRedundancyLocationKeys: new Set(
      review.issues
        .filter((issue) => issue.code === "paragraph_redundancy")
        .flatMap((issue) => reviewIssueParagraphLocationKeys(issue))
    ),
    reviewAppendixHygieneLocationKeys: new Set(
      review.issues
        .filter((issue) => issue.code === "appendix_hygiene")
        .flatMap((issue) => [
          ...reviewIssueParagraphLocationKeys(issue).filter((locationKey) => locationKey.startsWith("appendix_")),
          ...reviewIssueVisualLocationKeys(issue).filter((locationKey) => locationKey.startsWith("appendix_"))
        ])
    )
  };
}

function reviewVisualTargetToLocationKey(target: ManuscriptReviewVisualTarget): string {
  return target.kind === "table"
    ? `table:${target.index}`
    : target.kind === "figure"
      ? `figure:${target.index}`
      : target.kind === "appendix_table"
        ? `appendix_table:${target.index}`
        : `appendix_figure:${target.index}`;
}

function styleLintIssueCoveredByReview(
  issue: ManuscriptStyleLintIssue,
  reviewCoverage: {
    reviewVisualLocationKeys: Set<string>;
    reviewParagraphRedundancyLocationKeys: Set<string>;
    reviewAppendixHygieneLocationKeys: Set<string>;
  }
): boolean {
  return Boolean(coveringReviewIssueCodeForLintIssue(issue, reviewCoverage));
}

function coveringReviewIssueCodeForLintIssue(
  issue: ManuscriptStyleLintIssue,
  reviewCoverage: {
    reviewVisualLocationKeys: Set<string>;
    reviewParagraphRedundancyLocationKeys: Set<string>;
    reviewAppendixHygieneLocationKeys: Set<string>;
  }
): ManuscriptReviewIssueCode | undefined {
  if (issue.code === "visual_redundancy" && issue.redundant_visual_pair) {
    const pairLocationKeys = [
      `table:${issue.redundant_visual_pair.table_index}`,
      `figure:${issue.redundant_visual_pair.figure_index}`
    ];
    return pairLocationKeys.every((locationKey) => reviewCoverage.reviewVisualLocationKeys.has(locationKey))
      ? "visual_redundancy"
      : undefined;
  }
  if (issue.code === "duplicate_sentence_pattern" && issue.location_keys?.length) {
    return issue.location_keys.some((locationKey) =>
      reviewCoverage.reviewParagraphRedundancyLocationKeys.has(locationKey)
    )
      ? "paragraph_redundancy"
      : undefined;
  }
  if (
    (issue.code === "appendix_internal_text"
      || issue.code === "appendix_meta_text"
      || issue.code === "appendix_raw_artifact_reference")
    && issue.location_keys?.length
  ) {
    return issue.location_keys.some((locationKey) =>
      reviewCoverage.reviewAppendixHygieneLocationKeys.has(locationKey)
    )
      ? "appendix_hygiene"
      : undefined;
  }
  return undefined;
}

function inferLintGateRole(
  issue: ManuscriptStyleLintIssue,
  coveredByReviewIssueCode: ManuscriptReviewIssueCode | undefined
): "primary_signal" | "backstop_only" | "hard_stop" {
  if (coveredByReviewIssueCode) {
    return "backstop_only";
  }
  if (
    issue.code === "appendix_internal_text"
    || issue.code === "appendix_meta_text"
    || issue.code === "appendix_raw_artifact_reference"
  ) {
    return "hard_stop";
  }
  return "primary_signal";
}

function buildBackstopOnlySummaryLines(issues: ManuscriptStyleLintIssue[]): string[] {
  const backstopIssues = issues.filter((issue) => issue.gate_role === "backstop_only");
  if (backstopIssues.length === 0) {
    return [];
  }
  const lines: string[] = [];
  const duplicateCount = backstopIssues.filter((issue) => issue.code === "duplicate_sentence_pattern").length;
  if (duplicateCount > 0) {
    lines.push(
      `${duplicateCount} duplicate-sentence finding(s) remain recorded as backstop-only because manuscript_review already covers the same paragraph-local redundancy.`
    );
  }
  const visualCount = backstopIssues.filter((issue) => issue.code === "visual_redundancy").length;
  if (visualCount > 0) {
    lines.push(
      `${visualCount} visual-redundancy finding(s) remain recorded as backstop-only because manuscript_review already covers the same table/figure pair.`
    );
  }
  const appendixCount = backstopIssues.filter((issue) =>
    issue.code === "appendix_internal_text"
    || issue.code === "appendix_meta_text"
    || issue.code === "appendix_raw_artifact_reference"
  ).length;
  if (appendixCount > 0) {
    lines.push(
      `${appendixCount} appendix-contamination finding(s) remain recorded as backstop-only because manuscript_review already covers the same appendix-local issue.`
    );
  }
  const remainingCount = backstopIssues.length - duplicateCount - visualCount - appendixCount;
  if (remainingCount > 0) {
    lines.push(
      `${remainingCount} deterministic finding(s) remain recorded as backstop-only because manuscript_review already covers the same local issue.`
    );
  }
  return lines;
}

function buildHardStopSummaryLines(issues: ManuscriptStyleLintIssue[]): string[] {
  const hardStopIssues = issues.filter((issue) => issue.gate_role === "hard_stop");
  if (hardStopIssues.length === 0) {
    return [];
  }
  const appendixCount = hardStopIssues.filter((issue) =>
    issue.code === "appendix_internal_text"
    || issue.code === "appendix_meta_text"
    || issue.code === "appendix_raw_artifact_reference"
  ).length;
  if (appendixCount === 0) {
    return [
      `${hardStopIssues.length} deterministic finding(s) remain hard-stop policy findings because manuscript_review does not yet cover the affected material.`
    ];
  }
  const lines = [
    `${appendixCount} appendix-contamination finding(s) remain deterministic hard-stop policy findings because manuscript_review does not yet cover the contaminated appendix material.`
  ];
  const remainingCount = hardStopIssues.length - appendixCount;
  if (remainingCount > 0) {
    lines.push(
      `${remainingCount} additional deterministic finding(s) remain hard-stop policy findings because manuscript_review does not yet cover the affected material.`
    );
  }
  return lines;
}

function reviewSupportSpanToLocationKey(span: ManuscriptReviewSupportSpan): string | undefined {
  const normalizedSection = normalizeHeading(span.section);
  if (!normalizedSection) {
    return undefined;
  }
  if (normalizedSection === "title") {
    return buildParagraphLocationKey("title", "Title", span.paragraph_index);
  }
  if (normalizedSection === "abstract") {
    return buildParagraphLocationKey("abstract", "Abstract", span.paragraph_index);
  }
  if (isAppendixSectionName(span.section)) {
    return buildParagraphLocationKey("appendix_paragraph", span.section, span.paragraph_index);
  }
  return buildParagraphLocationKey("paragraph", span.section, span.paragraph_index);
}

function isAppendixSectionName(section: string): boolean {
  return normalizeHeading(section) === "appendix"
    || normalizeHeading(section).startsWith("appendix ");
}

function normalizeManuscriptReviewIssue(
  value: unknown,
  manuscript: PaperManuscript
): ManuscriptReviewIssue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const code = normalizeReviewCode(record.code);
  const severity = normalizeSeverity(record.severity);
  const section = cleanString(record.section);
  const message = cleanString(record.message);
  const fix = cleanString(record.fix_recommendation);
  if (!code || !severity || !section || !message || !fix) {
    return undefined;
  }
  return {
    code,
    severity,
    section,
    repairable: typeof record.repairable === "boolean" ? record.repairable : true,
    message,
    fix_recommendation: fix,
    supporting_spans: normalizeSupportingSpans(record.supporting_spans, manuscript, section),
    visual_targets: normalizeReviewVisualTargets(record.visual_targets, manuscript)
  };
}

function normalizeReviewVisualTargets(
  value: unknown,
  manuscript: PaperManuscript
): ManuscriptReviewVisualTarget[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const targets = value
    .map((item) => normalizeReviewVisualTarget(item, manuscript))
    .filter((item): item is ManuscriptReviewVisualTarget => Boolean(item));
  return targets.length > 0 ? targets : undefined;
}

function normalizeReviewVisualTarget(
  value: unknown,
  manuscript: PaperManuscript
): ManuscriptReviewVisualTarget | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = cleanString(record.kind).toLowerCase();
  const index = normalizeInteger(record.index);
  const rationale = cleanString(record.rationale);
  if (
    (kind !== "table" && kind !== "figure" && kind !== "appendix_table" && kind !== "appendix_figure")
    || index === undefined
    || !visualTargetExists(manuscript, kind as ManuscriptReviewVisualTarget["kind"], index)
  ) {
    return undefined;
  }
  return {
    kind: kind as ManuscriptReviewVisualTarget["kind"],
    index,
    ...(rationale ? { rationale } : {})
  };
}

function visualTargetExists(
  manuscript: PaperManuscript,
  kind: ManuscriptReviewVisualTarget["kind"],
  index: number
): boolean {
  const collection =
    kind === "table"
      ? manuscript.tables
      : kind === "figure"
        ? manuscript.figures
        : kind === "appendix_table"
          ? manuscript.appendix_tables
          : manuscript.appendix_figures;
  return index >= 0 && index < (collection?.length || 0);
}

function normalizeManuscriptReviewAuditIssue(value: unknown): ManuscriptReviewAuditIssue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const severity = normalizeSeverity(record.severity);
  const code = normalizeAuditCode(record.code);
  const section = cleanString(record.section);
  const message = cleanString(record.message);
  const fix = cleanString(record.fix_recommendation);
  if (!severity || !code || !section || !message || !fix) {
    return undefined;
  }
  return {
    severity,
    code,
    section,
    message,
    fix_recommendation: fix
  };
}

function normalizeSupportingSpans(
  value: unknown,
  manuscript: PaperManuscript,
  fallbackSection: string
): ManuscriptReviewSupportSpan[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeSupportingSpan(item, manuscript, fallbackSection))
    .filter((item): item is ManuscriptReviewSupportSpan => Boolean(item))
    .slice(0, 2);
}

function normalizeSupportingSpan(
  value: unknown,
  manuscript: PaperManuscript,
  fallbackSection: string
): ManuscriptReviewSupportSpan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const section = cleanString(record.section) || fallbackSection;
  const paragraphIndex =
    typeof record.paragraph_index === "number" && Number.isInteger(record.paragraph_index) && record.paragraph_index >= 0
      ? record.paragraph_index
      : undefined;
  const excerpt = cleanString(record.excerpt);
  if (!section || paragraphIndex === undefined || !excerpt) {
    return undefined;
  }
  const paragraphText = resolveSpanParagraphText(manuscript, section, paragraphIndex);
  if (!paragraphText) {
    return undefined;
  }
  if (!normalizeSentence(paragraphText).includes(normalizeSentence(excerpt))) {
    return undefined;
  }
  const reason = cleanString(record.reason);
  return {
    section,
    paragraph_index: paragraphIndex,
    excerpt,
    ...(reason ? { reason } : {})
  };
}

function validateSupportingSpan(input: {
  span: ManuscriptReviewSupportSpan;
  issue: ManuscriptReviewIssue;
  spanIndex: number;
  manuscript: PaperManuscript;
  traceability: PaperTraceabilityReport;
}):
  | { ok: true; span: ManuscriptReviewSupportSpan; warning?: ManuscriptReviewValidationIssue }
  | { ok: false; issue: ManuscriptReviewValidationIssue } {
  const paragraphText = resolveSpanParagraphText(
    input.manuscript,
    input.span.section,
    input.span.paragraph_index
  );
  if (!paragraphText) {
    return {
      ok: false,
      issue: {
        severity: "fail",
        code: "invalid_supporting_span",
        section: input.issue.section,
        message: `Supporting span ${input.spanIndex} points to a missing paragraph location.`,
        issue_code: input.issue.code,
        span_index: input.spanIndex
      }
    };
  }
  if (!normalizeSentence(paragraphText).includes(normalizeSentence(input.span.excerpt))) {
    return {
      ok: false,
      issue: {
        severity: "fail",
        code: "invalid_supporting_span",
        section: input.issue.section,
        message: `Supporting span ${input.spanIndex} excerpt does not match the referenced manuscript paragraph.`,
        issue_code: input.issue.code,
        span_index: input.spanIndex
      }
    };
  }
  const traceabilityEntry = resolveSpanTraceabilityEntry(
    input.traceability,
    input.span.section,
    input.span.paragraph_index
  );
  return {
    ok: true,
    span: {
      ...input.span,
      ...(traceabilityEntry?.anchor_id ? { anchor_id: traceabilityEntry.anchor_id } : {}),
      ...(traceabilityEntry?.source_refs?.length ? { source_refs: traceabilityEntry.source_refs } : {})
    },
    ...(traceabilityEntry?.anchor_id
      ? {}
      : {
          warning: {
            severity: "warning",
            code: "unanchored_supporting_span",
            section: input.issue.section,
            message: `Supporting span ${input.spanIndex} is valid textually but could not be mapped to a traceability anchor.`,
            issue_code: input.issue.code,
            span_index: input.spanIndex
          }
        })
  };
}

function normalizeReviewCode(value: unknown): ManuscriptReviewIssueCode | undefined {
  const normalized = cleanString(value).toLowerCase().replace(/[\s-]+/gu, "_");
  return MANUSCRIPT_REVIEW_CODES.includes(normalized as ManuscriptReviewIssueCode)
    ? normalized as ManuscriptReviewIssueCode
    : undefined;
}

function normalizeAuditCode(
  value: unknown
): ManuscriptReviewAuditIssue["code"] | undefined {
  const normalized = cleanString(value).toLowerCase().replace(/[\s-]+/gu, "_");
  return normalized === "unsupported_issue"
    || normalized === "missing_major_issue"
    || normalized === "check_issue_mismatch"
    || normalized === "insufficient_grounding"
    ? normalized
    : undefined;
}

function normalizeSeverity(value: unknown): "warning" | "fail" | undefined {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "warning" || normalized === "fail") {
    return normalized;
  }
  return undefined;
}

function normalizeDecision(value: unknown): ManuscriptReviewDecision | undefined {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "pass" || normalized === "repair" || normalized === "stop") {
    return normalized;
  }
  return undefined;
}

function normalizeInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeReviewReliability(value: unknown): ManuscriptReviewArtifactReliability | undefined {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === "grounded" || normalized === "partially_grounded" || normalized === "degraded") {
    return normalized;
  }
  return undefined;
}

function normalizeCheck(value: unknown, fallback: ManuscriptReviewCheck): ManuscriptReviewCheck {
  const record = asRecord(value);
  const status = cleanString(record.status).toLowerCase();
  return {
    status: status === "pass" || status === "warn" || status === "fail"
      ? status
      : fallback.status,
    note: cleanString(record.note) || fallback.note
  };
}

function buildDefaultChecks(): ManuscriptReviewArtifact["checks"] {
  return {
    section_completeness: { status: "pass", note: "No missing core section detected." },
    paragraph_redundancy: { status: "pass", note: "No obvious paragraph redundancy detected." },
    related_work_quality: { status: "pass", note: "Related work appears acceptable at fallback level." },
    section_transition: { status: "pass", note: "Section transitions appear acceptable at fallback level." },
    visual_redundancy: { status: "pass", note: "No obvious visual redundancy detected." },
    appendix_hygiene: { status: "pass", note: "No appendix contamination detected at fallback level." },
    citation_hygiene: { status: "pass", note: "No obvious citation-grounding problem detected at fallback level." },
    alignment: { status: "pass", note: "Title, abstract, and conclusion appear broadly aligned." },
    rhetorical_overreach: { status: "pass", note: "No obvious rhetorical overreach detected at fallback level." }
  };
}

function resolveSpanParagraphText(
  manuscript: PaperManuscript,
  section: string,
  paragraphIndex: number
): string | undefined {
  const normalizedSection = normalizeHeading(section);
  if (normalizedSection === "title") {
    return paragraphIndex === 0 ? manuscript.title : undefined;
  }
  if (normalizedSection === "abstract") {
    return paragraphIndex === 0 ? manuscript.abstract : undefined;
  }
  const mainSection = manuscript.sections.find((item) => normalizeHeading(item.heading) === normalizedSection);
  if (mainSection) {
    return mainSection.paragraphs[paragraphIndex];
  }
  const appendixSection = (manuscript.appendix_sections || []).find(
    (item) => normalizeHeading(item.heading) === normalizedSection
  );
  if (appendixSection) {
    return appendixSection.paragraphs[paragraphIndex];
  }
  if (normalizedSection !== "appendix") {
    return undefined;
  }
  const appendixParagraphs = (manuscript.appendix_sections || []).flatMap((item) => item.paragraphs);
  return appendixParagraphs[paragraphIndex];
}

function resolveSpanTraceabilityEntry(
  traceability: PaperTraceabilityReport,
  section: string,
  paragraphIndex: number
): PaperTraceabilityEntry | undefined {
  const normalizedSection = normalizeHeading(section);
  const directMatch = traceability.paragraphs.find(
    (paragraph) =>
      normalizeHeading(paragraph.manuscript_section) === normalizedSection
      && paragraph.paragraph_index === paragraphIndex
  );
  if (directMatch) {
    return directMatch;
  }
  if (normalizedSection !== "appendix") {
    return undefined;
  }
  const appendixParagraphs = traceability.paragraphs.filter((paragraph) =>
    paragraph.anchor_id?.startsWith("paragraph:appendix_")
  );
  return appendixParagraphs[paragraphIndex];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function splitSentences(text: string): string[] {
  return cleanString(text)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function normalizeSentence(text: string): string {
  return cleanString(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeHeading(text: string): string {
  return cleanString(text).toLowerCase().replace(/[\s:.-]+/gu, " ").trim();
}

function humanizeHeading(text: string): string {
  return text
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }
  return intersection / union.size;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value.trim().length > 0))];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("json_object_not_found");
  }
  return text.slice(start, end + 1);
}
