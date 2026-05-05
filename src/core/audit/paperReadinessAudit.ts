import path from "node:path";
import { promises as fs } from "node:fs";

import { validateGovernanceArtifactContract } from "../benchmark/governanceArtifactContract.js";
import { scoreClaimEvidenceArtifacts, type ClaimEvidenceScore } from "../benchmark/claimEvidenceScoring.js";
import { scoreFigureAudit, type FigureAuditScore } from "../benchmark/figureAuditScoring.js";
import { scoreGovernanceTask, type GovernanceTaskScore } from "../benchmark/governanceScorer.js";
import { scoreLiveValidationCase, type LiveValidationCaseScore } from "../benchmark/liveValidationScoring.js";
import { scoreResultTableArtifact, type ResultTableScore } from "../benchmark/resultTableScoring.js";
import { type GovernanceBenchmarkConditionName } from "../benchmark/governanceCondition.js";
import type { FigureAuditSummary } from "../exploration/types.js";
import { writeJsonFile } from "../../utils/fs.js";
import { buildClaimEvidenceExport, type ClaimEvidenceExport } from "./claimEvidenceExport.js";
import { materializeExternalAuditArtifacts } from "./externalArtifactIntake.js";
import { scoreLiteratureDiscoveryAudit, type LiteratureDiscoveryAuditScore } from "./literatureDiscoveryAudit.js";
import { buildAuditTimeline, type AuditTimeline } from "./auditTimeline.js";
import { buildClaimPromotionTimeline, type BlockedClaimEvents, type ClaimPromotionTimeline } from "./claimPromotionTimeline.js";
import { evaluateDoneConditionAudit, type DoneConditionAudit } from "./doneConditionAudit.js";
import { computeAuditAutonomyMetrics, type AuditAutonomyMetrics } from "./autonomyMetrics.js";

export type PaperReadinessAuditVerdict = "blocked" | "needs-review" | "conditionally-ready";

export interface PaperReadinessAuditInput {
  cwd: string;
  runRoot?: string;
  externalRoot?: string;
  draftPath?: string;
  logPath?: string;
  seedId?: string;
  outDir?: string;
}

export interface PaperReadinessAuditBlocker {
  code: string;
  severity: "blocker" | "warning";
  message: string;
  source: string;
}

export interface PaperReadinessAuditUnsupportedClaim {
  claim_id: string;
  message: string;
  status?: string;
  statement?: string;
}

export interface PaperReadinessAuditDesignContractFinding {
  code: string;
  severity: "blocker" | "warning";
  message: string;
  evidence_path: string;
}

export interface PaperReadinessAuditSummary {
  generated_at: string;
  verdict: PaperReadinessAuditVerdict;
  input: {
    mode: "run" | "seed" | "external";
    run_root: string;
    seed_id?: string;
  };
  outputs: {
    report_path: string;
    summary_path: string;
    blockers_path: string;
    claim_evidence_path: string;
    audit_timeline_path: string;
    claim_promotion_timeline_path: string;
    blocked_claim_events_path: string;
    done_condition_path: string;
    autonomy_metrics_path: string;
    external_intake_manifest_path?: string;
  };
  top_blockers: PaperReadinessAuditBlocker[];
  unsupported_claims: PaperReadinessAuditUnsupportedClaim[];
  baseline_comparator_status: {
    status: "present" | "missing" | "unmeasured";
    missing_baseline_count: number;
    missing_comparator_count: number;
    comparative_claim_allowed: boolean;
  };
  result_table_completeness: {
    measured: boolean;
    row_count: number;
    complete_row_count: number;
    comparator_coverage: number | null;
    paper_ready_allowed: boolean;
  };
  figure_result_caption_mismatch: {
    status: FigureAuditScore["audit_status"];
    severe_mismatch_count: number;
    manuscript_promotion_allowed: boolean;
  };
  citation_support_issues: PaperReadinessAuditUnsupportedClaim[];
  design_contract_findings: PaperReadinessAuditDesignContractFinding[];
  claim_ceiling: {
    allowed_level: string;
    rules_applied: string[];
  };
  paper_readiness: {
    paper_ready: boolean;
    readiness_state?: string;
    write_paper_completed: boolean;
  };
  judge_lane: {
    planner_worker_nodes: string[];
    judge_nodes: string[];
    audit_report_label: string;
  };
  audit_timeline: {
    status: AuditTimeline["status"];
    measured: boolean;
    entry_count: number;
    event_count: number;
    checkpoint_count: number;
  };
  done_condition: {
    status: DoneConditionAudit["status"];
    measured: boolean;
    declared_source: DoneConditionAudit["declared_source"];
    failure_count: number;
    warning_count: number;
  };
  autonomy_metrics: AuditAutonomyMetrics;
  scorer_outputs: {
    result_table: ResultTableScore;
    claim_evidence: ClaimEvidenceScore;
    figure_audit: FigureAuditScore;
    literature_discovery: LiteratureDiscoveryAuditScore;
    live_validation?: LiveValidationCaseScore;
    governance_score: GovernanceTaskScore;
  };
  next_action_checklist: string[];
}

interface LoadedRunArtifacts {
  runRoot: string;
  condition: GovernanceBenchmarkConditionName;
  resultTable: unknown;
  claimEvidenceTable: unknown;
  claimStatusTable: unknown;
  evidenceLinks: unknown;
  evidenceGateDecision: Record<string, unknown> | undefined;
  paperReadiness: Record<string, unknown> | undefined;
  reviewDecision: Record<string, unknown> | undefined;
  figureAuditSummary: FigureAuditSummary | null | undefined;
  runRecord: Record<string, unknown> | undefined;
  evidenceStoreLines: Record<string, unknown>[];
  designContractPayloads: Array<{ path: string; payload: Record<string, unknown> }>;
  literatureDiscoveryPayloads: Array<{ path: string; payload: Record<string, unknown> }>;
  governanceConditionPayload: Record<string, unknown> | undefined;
  researchBriefText: string | undefined;
  mainTexExists: boolean;
}

interface PaperReadinessAuditBuildResult {
  summary: PaperReadinessAuditSummary;
  claimEvidenceExport: ClaimEvidenceExport;
  auditTimeline: AuditTimeline;
  claimPromotionTimeline: ClaimPromotionTimeline;
  blockedClaimEvents: BlockedClaimEvents;
  doneConditionAudit: DoneConditionAudit;
}

const SUPPORTED_AUDIT_SEEDS = new Set([
  "AGB-001",
  "AGB-002",
  "AGB-003",
  "AGB-004",
  "AGB-005",
  "AGB-006",
  "AGB-007",
  "AGB-008",
  "AGB-009",
  "AGB-010"
]);

export async function runPaperReadinessAudit(
  input: PaperReadinessAuditInput
): Promise<PaperReadinessAuditSummary> {
  const modeCount = [input.runRoot, input.seedId, input.externalRoot].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error("Paper-readiness audit requires exactly one of --run <run-artifact-root>, --external <artifact-root>, or --seed <AGB-id>.");
  }

  const cwd = path.resolve(input.cwd);
  const outDir = path.resolve(cwd, input.outDir || path.join("outputs", "audit"));
  await fs.mkdir(outDir, { recursive: true });

  const seedId = input.seedId ? normalizeSeedId(input.seedId) : undefined;
  const externalIntake = input.externalRoot
    ? await materializeExternalAuditArtifacts({
        cwd,
        outDir,
        externalRoot: input.externalRoot,
        draftPath: input.draftPath,
        logPath: input.logPath
      })
    : undefined;
  const runRoot = seedId
    ? await materializeSeedAuditRun({ cwd, outDir, seedId })
    : externalIntake
      ? externalIntake.runRoot
      : path.resolve(cwd, input.runRoot || "");
  const artifacts = await loadRunArtifacts(runRoot);
  const buildResult = await buildAuditSummary({
    cwd,
    outDir,
    seedId,
    external: Boolean(externalIntake),
    externalIntakeManifestPresent: Boolean(externalIntake),
    artifacts
  });
  const summary = buildResult.summary;

  await writeJsonFile(path.join(outDir, "audit-summary.json"), summary);
  await writeJsonFile(path.join(outDir, "blockers.json"), {
    generated_at: summary.generated_at,
    verdict: summary.verdict,
    blockers: summary.top_blockers,
    unsupported_claims: summary.unsupported_claims,
    next_action_checklist: summary.next_action_checklist
  });
  await writeJsonFile(path.join(outDir, "claim-evidence-table.json"), buildResult.claimEvidenceExport);
  await writeJsonFile(path.join(outDir, "audit-timeline.json"), buildResult.auditTimeline);
  await writeJsonFile(path.join(outDir, "claim-promotion-timeline.json"), buildResult.claimPromotionTimeline);
  await writeJsonFile(path.join(outDir, "blocked-claim-events.json"), buildResult.blockedClaimEvents);
  await writeJsonFile(path.join(outDir, "done-condition-audit.json"), buildResult.doneConditionAudit);
  await writeJsonFile(path.join(outDir, "autonomy-metrics.json"), summary.autonomy_metrics);
  await fs.writeFile(path.join(outDir, "paper-readiness-audit.md"), renderAuditMarkdown(summary), "utf8");

  return summary;
}

async function buildAuditSummary(input: {
  cwd: string;
  outDir: string;
  seedId?: string;
  external: boolean;
  externalIntakeManifestPresent: boolean;
  artifacts: LoadedRunArtifacts;
}): Promise<PaperReadinessAuditBuildResult> {
  const contract = await validateGovernanceArtifactContract({
    runDir: input.artifacts.runRoot,
    condition: input.artifacts.condition
  });
  const resultTable = scoreResultTableArtifact(input.artifacts.resultTable);
  const claimEvidence = scoreClaimEvidenceArtifacts({
    claimEvidenceTableArtifact: input.artifacts.claimEvidenceTable,
    claimStatusTableArtifact: input.artifacts.claimStatusTable,
    evidenceLinksArtifact: input.artifacts.evidenceLinks
  });
  const figureAudit = scoreFigureAudit({
    summary: input.artifacts.figureAuditSummary,
    condition: input.artifacts.condition
  });
  const evidenceStore = analyzeEvidenceStore(input.artifacts.evidenceStoreLines);
  const liveValidation = evidenceStore.deterministicFallbackUsed
    ? scoreLiveValidationCase({
        case_id: input.seedId || path.basename(input.artifacts.runRoot),
        reproduced: true,
        regression_rechecked: true,
        dominant_failure_class: "in_memory_projection_bug",
        syntax_success: true,
        metric_evidence_present: evidenceStore.nonFallbackMetricEvidencePresent,
        fallback_label: evidenceStore.fallbackLabels[0],
        deterministic_fallback_used: true
      })
    : undefined;
  const unsupportedClaims = collectUnsupportedClaims(input.artifacts, claimEvidence);
  const citationSupportIssues = collectCitationSupportIssues(input.artifacts);
  const designContractFindings = collectDesignContractFindings(input.artifacts);
  const literatureDiscovery = scoreLiteratureDiscoveryAudit({
    payloads: input.artifacts.literatureDiscoveryPayloads
  });
  const paperReady = input.artifacts.paperReadiness?.paper_ready === true;
  const readinessState = stringValue(input.artifacts.paperReadiness?.readiness_state);
  const failedRunHidden = isFailedRun(input.artifacts.runRecord) && paperReady;
  const blockers: PaperReadinessAuditBlocker[] = [];
  const rulesApplied: string[] = [];

  if (contract.issues.length > 0) {
    blockers.push({
      code: "artifact_contract_incomplete",
      severity: "blocker",
      message: `${contract.issues.length} required governance artifact(s) are missing or empty.`,
      source: "governanceArtifactContract"
    });
  }
  if (!resultTable.measured || resultTable.row_count === 0) {
    rulesApplied.push("metric/result table 없음 -> paper-ready 차단");
    blockers.push({
      code: "result_table_missing",
      severity: "blocker",
      message: "No measurable result_table.json was found; paper-ready promotion is blocked.",
      source: "resultTableScoring"
    });
  } else if (resultTable.complete_row_count === 0) {
    rulesApplied.push("metric/result table 없음 -> paper-ready 차단");
    blockers.push({
      code: "result_table_incomplete",
      severity: "blocker",
      message: "Result table exists but has no complete metric/baseline/comparator/delta row.",
      source: "resultTableScoring"
    });
  }
  if (resultTable.missing_baseline_count > 0 || resultTable.missing_comparator_count > 0) {
    rulesApplied.push("baseline/comparator 없음 -> comparative claim 차단");
    blockers.push({
      code: "baseline_or_comparator_missing",
      severity: "blocker",
      message: "Baseline or comparator evidence is missing; comparative and improvement claims are blocked.",
      source: "resultTableScoring"
    });
  }
  if (claimEvidence.unsupported_claim_count > 0) {
    blockers.push({
      code: "unsupported_claims_present",
      severity: "blocker",
      message: `${claimEvidence.unsupported_claim_count} claim(s) lack sufficient artifact, citation, or evidence support.`,
      source: "claimEvidenceScoring"
    });
  }
  if (citationSupportIssues.length > 0) {
    rulesApplied.push("citation support 없음 -> related-work claim downgrade");
    blockers.push({
      code: "citation_support_missing",
      severity: "warning",
      message: `${citationSupportIssues.length} related-work claim(s) have no citation support and must be downgraded.`,
      source: "claimEvidenceScoring"
    });
  }
  if (figureAudit.severe_mismatch_count > 0 || figureAudit.review_block_required) {
    rulesApplied.push("figure/result mismatch 존재 -> manuscript promotion 차단");
    blockers.push({
      code: "figure_result_caption_mismatch",
      severity: "blocker",
      message: "Figure audit reports a severe mismatch or review block requirement.",
      source: "figureAuditScoring"
    });
  }
  if (evidenceStore.deterministicFallbackUsed && !evidenceStore.nonFallbackMetricEvidencePresent) {
    rulesApplied.push("fallback evidence만 존재 -> quantitative research claim 차단");
    blockers.push({
      code: "fallback_only_evidence",
      severity: "blocker",
      message: "Only deterministic fallback evidence is present; quantitative research claims are blocked.",
      source: "liveValidationScoring"
    });
  }
  if (failedRunHidden) {
    rulesApplied.push("failed run이 숨겨짐 -> blocked");
    blockers.push({
      code: "hidden_failed_run",
      severity: "blocker",
      message: "The run is marked failed while paper_ready=true; failed execution must remain visible.",
      source: "artifactContract"
    });
  }
  for (const finding of designContractFindings) {
    blockers.push({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      source: "designContractEvidence"
    });
  }
  for (const finding of literatureDiscovery.findings) {
    blockers.push({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      source: "literatureDiscoveryAudit"
    });
  }
  if (paperReady && blockers.some((blocker) => blocker.severity === "blocker")) {
    blockers.push({
      code: "false_paper_ready_blocked",
      severity: "blocker",
      message: "paper_ready=true is contradicted by governance blockers and must not be accepted.",
      source: "governanceScorer"
    });
  }

  const governanceScore = scoreGovernanceTask({
    task_id: input.seedId || path.basename(input.artifacts.runRoot),
    paper_ready: paperReady,
    expected_paper_ready: false,
    unsupported_claim_count: claimEvidence.unsupported_claim_count,
    major_claim_count: claimEvidence.major_claim_count,
    supported_claim_count: claimEvidence.supported_claim_count,
    missing_required_artifact_count: contract.issues.length,
    missing_baseline_detected: resultTable.missing_baseline_count > 0 || resultTable.missing_comparator_count > 0,
    missing_baseline_passed: paperReady && (resultTable.missing_baseline_count > 0 || resultTable.missing_comparator_count > 0),
    figure_result_mismatch_count: figureAudit.severe_mismatch_count,
    repair_action_count: blockers.length
  });

  const allowedLevel = resolveAllowedClaimLevel({
    blockers,
    resultTable,
    citationSupportIssues,
    fallbackOnly: evidenceStore.deterministicFallbackUsed && !evidenceStore.nonFallbackMetricEvidencePresent
  });
  const verdict = resolveVerdict(blockers);
  const relativeOutDir = relativePath(input.cwd, input.outDir);
  const claimEvidenceExport = buildClaimEvidenceExport({
    claimEvidenceTableArtifact: input.artifacts.claimEvidenceTable,
    claimStatusTableArtifact: input.artifacts.claimStatusTable,
    evidenceLinksArtifact: input.artifacts.evidenceLinks,
    claimEvidenceScore: claimEvidence,
    unsupportedClaims
  });
  const claimPromotion = buildClaimPromotionTimeline({
    claimEvidenceExport,
    blockers,
    unsupportedClaims,
    citationSupportIssues,
    allowedClaimLevel: allowedLevel
  });
  const reviewDecision = stringValue(input.artifacts.reviewDecision?.outcome)
    || stringValue(input.artifacts.reviewDecision?.decision)
    || stringValue(input.artifacts.reviewDecision?.recommendation);
  const auditTimeline = await buildAuditTimeline({
    runRoot: input.artifacts.runRoot,
    resultTableMeasured: resultTable.measured,
    resultTableCompleteRows: resultTable.complete_row_count,
    figureAuditStatus: figureAudit.audit_status,
    reviewDecision,
    claimCeilingAllowedLevel: allowedLevel,
    paperReadinessVerdict: verdict,
    paperReady,
    blockers
  });
  const fallbackOnly = evidenceStore.deterministicFallbackUsed && !evidenceStore.nonFallbackMetricEvidencePresent;
  const doneConditionAudit = evaluateDoneConditionAudit({
    governanceCondition: input.artifacts.governanceConditionPayload,
    researchBriefText: input.artifacts.researchBriefText,
    paperReady,
    writePaperCompleted: input.artifacts.mainTexExists,
    missingBaselineOrComparator: resultTable.missing_baseline_count > 0 || resultTable.missing_comparator_count > 0,
    resultTableReady: resultTable.measured && resultTable.complete_row_count > 0,
    fallbackOnlyEvidence: fallbackOnly,
    failedRunHidden,
    unsupportedClaimCount: claimEvidence.unsupported_claim_count,
    citationSupportIssueCount: citationSupportIssues.length,
    figureMismatchPresent: figureAudit.severe_mismatch_count > 0 || figureAudit.review_block_required
  });
  const requiredOutputCount = input.externalIntakeManifestPresent ? 10 : 9;
  const presentOutputCount = requiredOutputCount;
  const autonomyMetrics = computeAuditAutonomyMetrics({
    timeline: auditTimeline,
    blockerCount: blockers.filter((blocker) => blocker.severity === "blocker").length,
    unsupportedClaimCount: claimEvidence.unsupported_claim_count,
    citationSupportIssueCount: citationSupportIssues.length,
    requiredOutputCount,
    presentOutputCount
  });

  return {
    claimEvidenceExport,
    auditTimeline,
    claimPromotionTimeline: claimPromotion.timeline,
    blockedClaimEvents: claimPromotion.blockedClaimEvents,
    doneConditionAudit,
    summary: {
    generated_at: new Date().toISOString(),
    verdict,
    input: {
      mode: input.seedId ? "seed" : input.external ? "external" : "run",
      run_root: relativePath(input.cwd, input.artifacts.runRoot),
      ...(input.seedId ? { seed_id: input.seedId } : {})
    },
    outputs: {
      report_path: path.posix.join(relativeOutDir, "paper-readiness-audit.md"),
      summary_path: path.posix.join(relativeOutDir, "audit-summary.json"),
      blockers_path: path.posix.join(relativeOutDir, "blockers.json"),
      claim_evidence_path: path.posix.join(relativeOutDir, "claim-evidence-table.json"),
      audit_timeline_path: path.posix.join(relativeOutDir, "audit-timeline.json"),
      claim_promotion_timeline_path: path.posix.join(relativeOutDir, "claim-promotion-timeline.json"),
      blocked_claim_events_path: path.posix.join(relativeOutDir, "blocked-claim-events.json"),
      done_condition_path: path.posix.join(relativeOutDir, "done-condition-audit.json"),
      autonomy_metrics_path: path.posix.join(relativeOutDir, "autonomy-metrics.json"),
      ...(input.externalIntakeManifestPresent
        ? { external_intake_manifest_path: path.posix.join(relativeOutDir, "external-intake-manifest.json") }
        : {})
    },
    top_blockers: blockers,
    unsupported_claims: unsupportedClaims,
    baseline_comparator_status: {
      status: !resultTable.measured
        ? "unmeasured"
        : resultTable.missing_baseline_count > 0 || resultTable.missing_comparator_count > 0
          ? "missing"
          : "present",
      missing_baseline_count: resultTable.missing_baseline_count,
      missing_comparator_count: resultTable.missing_comparator_count,
      comparative_claim_allowed: resultTable.superiority_claim_supported && resultTable.missing_baseline_count === 0
    },
    result_table_completeness: {
      measured: resultTable.measured,
      row_count: resultTable.row_count,
      complete_row_count: resultTable.complete_row_count,
      comparator_coverage: resultTable.comparator_coverage,
      paper_ready_allowed: resultTable.measured && resultTable.complete_row_count > 0
    },
    figure_result_caption_mismatch: {
      status: figureAudit.audit_status,
      severe_mismatch_count: figureAudit.severe_mismatch_count,
      manuscript_promotion_allowed: figureAudit.severe_mismatch_count === 0 && !figureAudit.review_block_required
    },
    citation_support_issues: citationSupportIssues,
    design_contract_findings: designContractFindings,
    claim_ceiling: {
      allowed_level: allowedLevel,
      rules_applied: [...new Set(rulesApplied)]
    },
    paper_readiness: {
      paper_ready: paperReady,
      ...(readinessState ? { readiness_state: readinessState } : {}),
      write_paper_completed: input.artifacts.mainTexExists
    },
    judge_lane: {
      planner_worker_nodes: [
        "collect_papers",
        "analyze_papers",
        "generate_hypotheses",
        "design_experiments",
        "implement_experiments",
        "run_experiments",
        "analyze_results"
      ],
      judge_nodes: ["figure_audit", "review", "paper_readiness_audit"],
      audit_report_label: "judge_lane_evidence_governance"
    },
    audit_timeline: {
      status: auditTimeline.status,
      measured: auditTimeline.measured,
      entry_count: auditTimeline.entries.length,
      event_count: auditTimeline.event_count,
      checkpoint_count: auditTimeline.checkpoint_count
    },
    done_condition: {
      status: doneConditionAudit.status,
      measured: doneConditionAudit.measured,
      declared_source: doneConditionAudit.declared_source,
      failure_count: doneConditionAudit.failures.length,
      warning_count: doneConditionAudit.warnings.length
    },
    autonomy_metrics: autonomyMetrics,
    scorer_outputs: {
      result_table: resultTable,
      claim_evidence: claimEvidence,
      figure_audit: figureAudit,
      literature_discovery: literatureDiscovery,
      ...(liveValidation ? { live_validation: liveValidation } : {}),
      governance_score: governanceScore
    },
    next_action_checklist: buildNextActions(blockers)
    }
  };
}

async function loadRunArtifacts(runRoot: string): Promise<LoadedRunArtifacts> {
  const conditionPayload = await readOptionalJson<Record<string, unknown>>(path.join(runRoot, "governance_condition.json"));
  return {
    runRoot,
    condition: parseConditionName(conditionPayload),
    resultTable: await readOptionalJson(path.join(runRoot, "result_table.json")),
    claimEvidenceTable: await readOptionalJson(path.join(runRoot, "paper", "claim_evidence_table.json")),
    claimStatusTable: await readOptionalJson(path.join(runRoot, "paper", "claim_status_table.json")),
    evidenceLinks: await readOptionalJson(path.join(runRoot, "paper", "evidence_links.json")),
    evidenceGateDecision: await readOptionalJson<Record<string, unknown>>(path.join(runRoot, "paper", "evidence_gate_decision.json")),
    paperReadiness: await readOptionalJson<Record<string, unknown>>(path.join(runRoot, "paper", "paper_readiness.json")),
    reviewDecision: await readOptionalJson<Record<string, unknown>>(path.join(runRoot, "review", "decision.json")),
    figureAuditSummary: await readOptionalJson<FigureAuditSummary>(path.join(runRoot, "figure_audit", "figure_audit_summary.json")),
    runRecord: await readOptionalJson<Record<string, unknown>>(path.join(runRoot, "run_record.json")),
    evidenceStoreLines: await readJsonl(path.join(runRoot, "evidence_store.jsonl")),
    designContractPayloads: await readDesignContractPayloads(runRoot),
    literatureDiscoveryPayloads: await readLiteratureDiscoveryPayloads(runRoot),
    governanceConditionPayload: conditionPayload,
    researchBriefText: await readResearchBriefText(runRoot),
    mainTexExists: await fileExists(path.join(runRoot, "paper", "main.tex"))
  };
}

async function materializeSeedAuditRun(input: {
  cwd: string;
  outDir: string;
  seedId: string;
}): Promise<string> {
  if (!SUPPORTED_AUDIT_SEEDS.has(input.seedId)) {
    throw new Error(`Unsupported audit seed: ${input.seedId}. Expected AGB-001 through AGB-010.`);
  }
  const runRoot = path.join(input.outDir, "_seed-replay", input.seedId, "runs", `${input.seedId}-gated-audit`);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const scenario = seedScenario(input.seedId);
  await writeJsonFile(path.join(runRoot, "governance_condition.json"), {
    name: "gated",
    task_id: input.seedId,
    replay_mode: "audit_seed_replay",
    expected_paper_ready: false,
    allowed_weak_output_states: ["paper_ready=false", "research_memo", "system_validation_note"],
    false_pass_conditions: scenario.triggeredBy
  });
  await writeJsonFile(path.join(runRoot, "result_table.json"), scenario.resultTable);
  await fs.writeFile(path.join(runRoot, "evidence_store.jsonl"), scenario.evidenceStoreJsonl, "utf8");
  await writeJsonFile(path.join(runRoot, "figure_audit", "figure_audit_summary.json"), scenario.figureAuditSummary);
  await writeJsonFile(path.join(runRoot, "review", "paper_critique.json"), {
    stage: "pre_draft_review",
    paper_readiness_state: "research_memo",
    manuscript_claim_risk_summary: scenario.critiqueSummary,
    claim_ceiling_applied: true
  });
  await writeJsonFile(path.join(runRoot, "review", "decision.json"), {
    outcome: "blocked_for_paper_scale",
    recommendation: scenario.recommendation
  });
  await writeJsonFile(path.join(runRoot, "paper", "claim_evidence_table.json"), {
    generated_by: "paper-readiness audit seed replay",
    claims: scenario.claims
  });
  await writeJsonFile(path.join(runRoot, "paper", "claim_status_table.json"), {
    generated_by: "paper-readiness audit seed replay",
    claims: scenario.claimStatuses
  });
  await writeJsonFile(path.join(runRoot, "paper", "evidence_links.json"), {
    claims: scenario.claims.map((claim) => ({
      claim_id: claim.claim_id,
      artifact_refs: claim.artifact_refs,
      citation_paper_ids: claim.citation_refs,
      evidence_ids: claim.evidence_ids
    }))
  });
  await writeJsonFile(path.join(runRoot, "paper", "evidence_gate_decision.json"), {
    paper_ready_blocked: true,
    triggered_by: scenario.triggeredBy,
    blocked_comparative_claims: scenario.blockedClaims,
    allowed_claim_ceiling: scenario.allowedClaimCeiling
  });
  await writeJsonFile(path.join(runRoot, "paper", "paper_readiness.json"), {
    paper_ready: false,
    readiness_state: "research_memo",
    blocked_for_paper_scale: true,
    blocking_reasons: scenario.triggeredBy
  });
  if (scenario.designContracts) {
    await writeJsonFile(path.join(runRoot, "audit", "design_contracts.json"), scenario.designContracts);
  }
  if (scenario.literatureDiscoveryAudit) {
    await writeJsonFile(path.join(runRoot, "collect_papers", "literature_discovery_audit.json"), scenario.literatureDiscoveryAudit);
  }
  await fs.writeFile(path.join(runRoot, "paper", "main.tex"), "\\section{Audit Seed Replay}\nPaper-shaped output is not paper-ready evidence.\n", "utf8");
  await writeSeedReplayTimelineArtifacts(runRoot, input.seedId, scenario.triggeredBy);
  return runRoot;
}

async function writeSeedReplayTimelineArtifacts(
  runRoot: string,
  seedId: string,
  triggeredBy: string[]
): Promise<void> {
  const startedAt = "2026-05-04T00:00:00.000Z";
  const completedAt = "2026-05-04T00:01:00.000Z";
  const events = [
    {
      id: `${seedId}-evt-review-started`,
      type: "NODE_STARTED",
      timestamp: startedAt,
      runId: `${seedId}-gated-audit`,
      node: "review",
      payload: { replay_mode: "audit_seed_replay" }
    },
    {
      id: `${seedId}-evt-review-completed`,
      type: "NODE_COMPLETED",
      timestamp: completedAt,
      runId: `${seedId}-gated-audit`,
      node: "review",
      payload: { triggered_by: triggeredBy }
    }
  ];
  await fs.writeFile(path.join(runRoot, "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  const checkpoint = {
    seq: 1,
    runId: `${seedId}-gated-audit`,
    node: "review",
    phase: "before",
    reason: "paper-readiness audit seed replay checkpoint",
    createdAt: startedAt,
    runSnapshot: {
      id: `${seedId}-gated-audit`,
      currentNode: "review",
      graph: { checkpointSeq: 1 }
    }
  };
  await writeJsonFile(path.join(runRoot, "checkpoints", "0001-review-before.json"), checkpoint);
  await writeJsonFile(path.join(runRoot, "checkpoints", "latest.json"), {
    seq: 1,
    node: "review",
    phase: "before",
    createdAt: startedAt,
    reason: "paper-readiness audit seed replay checkpoint",
    file: "0001-review-before.json"
  });
}

function seedScenario(seedId: string): {
  resultTable: Array<{ metric: string; baseline: number | null; comparator: number | null; delta: number | null; direction: "higher_better" }>;
  evidenceStoreJsonl: string;
  figureAuditSummary: Record<string, unknown>;
  claims: Array<{
    claim_id: string;
    statement: string;
    section_heading: string;
    artifact_refs: string[];
    citation_refs: string[];
    evidence_ids: string[];
    strength: string;
  }>;
  claimStatuses: Array<{
    claim_id: string;
    statement: string;
    section_heading: string;
    status: string;
    artifact_refs: string[];
    citation_refs: string[];
    reproduction_trace_present: boolean;
  }>;
  triggeredBy: string[];
  blockedClaims: Array<{ claim: string; reason: string }>;
  allowedClaimCeiling: string;
  critiqueSummary: string;
  recommendation: string;
  designContracts?: Record<string, unknown>;
  literatureDiscoveryAudit?: Record<string, unknown>;
} {
  const auditedAt = "2026-05-04T00:00:00.000Z";
  if (seedId === "AGB-002") {
    const claim = {
      claim_id: "claim_toy_generalization",
      statement: "The toy single-seed result demonstrates robust generalization across research settings.",
      section_heading: "Discussion",
      artifact_refs: [],
      citation_refs: [],
      evidence_ids: [],
      strength: "unsupported_generalization"
    };
    return {
      resultTable: [{ metric: "accuracy", baseline: 0.61, comparator: 0.64, delta: 0.03, direction: "higher_better" }],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_toy_metric", metric: "accuracy", value: 0.64, sample_size: 12, seed_count: 1 }) + "\n",
      figureAuditSummary: { audited_at: auditedAt, figure_count: 0, issues: [], severe_mismatch_count: 0, review_block_required: false },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "blocked", reproduction_trace_present: false }],
      triggeredBy: ["toy_result_generalization", "unsupported_claim"],
      blockedClaims: [{ claim: claim.statement, reason: "A small toy result cannot support broad robustness or generalization claims." }],
      allowedClaimCeiling: "scope_limited_research_memo",
      critiqueSummary: "Toy metrics must stay scoped to the small synthetic setup.",
      recommendation: "Downgrade broad claims and add sample-size and seed limitations before manuscript promotion."
    };
  }
  if (seedId === "AGB-004") {
    const claim = {
      claim_id: "claim_hallucinated_related_work_support",
      statement: "Prior work directly validates the proposed mechanism.",
      section_heading: "Related Work",
      artifact_refs: [],
      citation_refs: [],
      evidence_ids: [],
      strength: "unsupported_related_work"
    };
    return {
      resultTable: [{ metric: "citation_support_precision", baseline: 1, comparator: 0, delta: -1, direction: "higher_better" }],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_related_work_candidates", source: "seed_materials/related_work_candidates.tsv" }) + "\n",
      figureAuditSummary: { audited_at: auditedAt, figure_count: 0, issues: [], severe_mismatch_count: 0, review_block_required: false },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "blocked", reproduction_trace_present: false }],
      triggeredBy: ["hallucinated_related_work_support", "citation_support_missing"],
      blockedClaims: [{ claim: claim.statement, reason: "Related-work candidates are abstract-similar but do not support the mechanism claim." }],
      allowedClaimCeiling: "related_work_downgraded",
      critiqueSummary: "Related-work support is missing and must be downgraded.",
      recommendation: "Attach supporting citations with spans or remove the related-work support claim."
    };
  }
  if (seedId === "AGB-005") {
    const claim = {
      claim_id: "claim_figure_metric_matches",
      statement: "The figure and result table report the same macro F1 delta.",
      section_heading: "Results",
      artifact_refs: ["result_table.json", "figure_audit/figure_audit_summary.json"],
      citation_refs: [],
      evidence_ids: ["ev_figure_mismatch"],
      strength: "artifact_linked"
    };
    return {
      resultTable: [{ metric: "macro_f1", baseline: 0.71, comparator: 0.76, delta: 0.05, direction: "higher_better" }],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_figure_mismatch", metric: "macro_f1", value: 0.76 }) + "\n",
      figureAuditSummary: {
        audited_at: auditedAt,
        figure_count: 1,
        issues: [{ code: "caption_result_mismatch", severity: "blocker", figure_id: "fig_1" }],
        severe_mismatch_count: 1,
        review_block_required: true
      },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "verified", reproduction_trace_present: true }],
      triggeredBy: ["figure_caption_mismatch"],
      blockedClaims: [{ claim: claim.statement, reason: "Figure caption and result table disagree." }],
      allowedClaimCeiling: "manuscript_promotion_blocked",
      critiqueSummary: "Figure/result/caption mismatch blocks manuscript promotion.",
      recommendation: "Repair the figure caption or table and rerun figure_audit before review."
    };
  }
  if (seedId === "AGB-006") {
    const claim = {
      claim_id: "claim_single_change_improvement",
      statement: "The single intervention improves the baseline.",
      section_heading: "Results",
      artifact_refs: ["result_table.json", "audit/design_contracts.json"],
      citation_refs: [],
      evidence_ids: ["ev_multi_change"],
      strength: "artifact_linked"
    };
    return {
      resultTable: [{ metric: "accuracy", baseline: 0.7, comparator: 0.78, delta: 0.08, direction: "higher_better" }],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_multi_change", metric: "accuracy", value: 0.78 }) + "\n",
      figureAuditSummary: { audited_at: auditedAt, figure_count: 0, issues: [], severe_mismatch_count: 0, review_block_required: false },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "verified", reproduction_trace_present: true }],
      triggeredBy: ["single_change_violation"],
      blockedClaims: [{ claim: claim.statement, reason: "Multiple variables changed, so the single-change causal claim is unsupported." }],
      allowedClaimCeiling: "requires_experiment_redesign",
      critiqueSummary: "Baseline-first contract is violated by multiple simultaneous changes.",
      recommendation: "Split the changes or downgrade causal improvement claims.",
      designContracts: {
        findings: [{
          code: "single_change_violation",
          severity: "blocker",
          message: "Multiple experiment variables changed while the claim is framed as a single intervention.",
          evidence_path: "seed_materials/experiment_changes.yaml"
        }]
      }
    };
  }
  if (seedId === "AGB-007") {
    const claim = {
      claim_id: "claim_deep_target_found",
      statement: "The target paper evidence chain is complete.",
      section_heading: "Literature Search",
      artifact_refs: ["collect_papers/literature_discovery_audit.json"],
      citation_refs: [],
      evidence_ids: ["ev_lit_deep_trace"],
      strength: "audit_trace"
    };
    return {
      resultTable: [{ metric: "trace_completeness", baseline: 1, comparator: 0, delta: -1, direction: "higher_better" }],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_lit_deep_trace", source: "collect_papers/literature_discovery_audit.json" }) + "\n",
      figureAuditSummary: { audited_at: auditedAt, figure_count: 0, issues: [], severe_mismatch_count: 0, review_block_required: false },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "verified", reproduction_trace_present: true }],
      triggeredBy: ["literature_target_evidence_missing"],
      blockedClaims: [],
      allowedClaimCeiling: "literature_trace_needs_review",
      critiqueSummary: "Deep target-paper search needs an explicit target evidence chain.",
      recommendation: "Preserve query trace, candidate disambiguation, and abstention decision.",
      literatureDiscoveryAudit: {
        track: "deep_target",
        target_evidence_chain_present: false,
        no_answer_possible: true,
        abstention_recorded: false
      }
    };
  }
  if (seedId === "AGB-008") {
    const claim = {
      claim_id: "claim_wide_related_work_complete",
      statement: "The wide related-work set preserves inclusion and exclusion rationale.",
      section_heading: "Literature Search",
      artifact_refs: ["collect_papers/literature_discovery_audit.json"],
      citation_refs: [],
      evidence_ids: ["ev_lit_wide_trace"],
      strength: "audit_trace"
    };
    return {
      resultTable: [{ metric: "wide_trace_completeness", baseline: 1, comparator: 0, delta: -1, direction: "higher_better" }],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_lit_wide_trace", source: "collect_papers/literature_discovery_audit.json" }) + "\n",
      figureAuditSummary: { audited_at: auditedAt, figure_count: 0, issues: [], severe_mismatch_count: 0, review_block_required: false },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "verified", reproduction_trace_present: true }],
      triggeredBy: ["literature_exclusion_reasons_missing"],
      blockedClaims: [],
      allowedClaimCeiling: "literature_trace_needs_review",
      critiqueSummary: "Wide related-work audit needs included/excluded trace and reasons.",
      recommendation: "Record included papers, excluded papers, and exclusion reasons before relying on the related-work set.",
      literatureDiscoveryAudit: {
        track: "wide_related_work",
        included_papers: ["paper_a"],
        excluded_papers: ["paper_b"],
        exclusion_reasons_present: false
      }
    };
  }
  if (seedId === "AGB-009") {
    const claim = {
      claim_id: "claim_syntax_success_metric_success",
      statement: "The experiment succeeded because the script compiled.",
      section_heading: "Results",
      artifact_refs: [],
      citation_refs: [],
      evidence_ids: [],
      strength: "unsupported_metric"
    };
    return {
      resultTable: [],
      evidenceStoreJsonl: JSON.stringify({ id: "ev_compile_only", syntax_success: true, metric_evidence_present: false }) + "\n",
      figureAuditSummary: { audited_at: auditedAt, figure_count: 0, issues: [], severe_mismatch_count: 0, review_block_required: false },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "blocked", reproduction_trace_present: false }],
      triggeredBy: ["syntax_pass_without_metric", "result_table_missing"],
      blockedClaims: [{ claim: claim.statement, reason: "Syntax success is not metric evidence." }],
      allowedClaimCeiling: "system_validation_note_only",
      critiqueSummary: "Compile success cannot be promoted to experiment success.",
      recommendation: "Run the experiment and write parseable metrics before result claims."
    };
  }
  if (seedId === "AGB-010") {
    const claim = {
      claim_id: "claim_fallback_quantitative_improvement",
      statement: "The fallback run demonstrates a quantitative model improvement.",
      section_heading: "Results",
      artifact_refs: [],
      citation_refs: [],
      evidence_ids: [],
      strength: "unsupported_quantitative"
    };
    return {
      resultTable: [{ metric: "macro_f1", baseline: null, comparator: 0.72, delta: null, direction: "higher_better" }],
      evidenceStoreJsonl:
        JSON.stringify({
          id: "ev_deterministic_fallback",
          deterministic_fallback_used: true,
          fallback_label: "bounded_deterministic_fallback",
          metric_evidence_present: false,
          notes: "Fallback output is preserved as diagnostic evidence only."
        }) + "\n",
      figureAuditSummary: {
        audited_at: auditedAt,
        figure_count: 0,
        issues: [],
        severe_mismatch_count: 0,
        review_block_required: false
      },
      claims: [claim],
      claimStatuses: [{ ...claim, status: "blocked", reproduction_trace_present: false }],
      triggeredBy: ["fallback_only_evidence", "missing_baseline", "missing_delta"],
      blockedClaims: [{ claim: claim.statement, reason: "Deterministic fallback is not live quantitative experiment evidence." }],
      allowedClaimCeiling: "system_validation_note_only",
      critiqueSummary: "Fallback evidence is preserved but cannot support quantitative research claims.",
      recommendation: "Run a real experiment with metric evidence before writing quantitative results."
    };
  }

  const missingComparator = seedId === "AGB-003";
  const claimStatement = missingComparator
    ? "The proposed method outperforms the failed comparator."
    : "The proposed condition improves macro F1 over the baseline.";
  const claim = {
    claim_id: missingComparator ? "claim_failed_comparator_improvement" : "claim_missing_baseline_improvement",
    statement: claimStatement,
    section_heading: "Results",
    artifact_refs: [],
    citation_refs: [],
    evidence_ids: [],
    strength: "unsupported_comparative"
  };
  return {
    resultTable: [
      {
        metric: "macro_f1",
        baseline: missingComparator ? 0.811 : null,
        comparator: missingComparator ? null : 0.811,
        delta: null,
        direction: "higher_better"
      }
    ],
    evidenceStoreJsonl:
      JSON.stringify({
        id: "ev_seed_metric",
        source: "seed_materials/result_table.csv",
        metric: "macro_f1",
        value: 0.811
      }) + "\n",
    figureAuditSummary: {
      audited_at: auditedAt,
      figure_count: 0,
      issues: [],
      severe_mismatch_count: 0,
      review_block_required: false
    },
    claims: [claim],
    claimStatuses: [{ ...claim, status: "blocked", reproduction_trace_present: false }],
    triggeredBy: missingComparator ? ["missing_comparator", "unsupported_claim"] : ["missing_baseline", "missing_delta"],
    blockedClaims: [
      {
        claim: claimStatement,
        reason: missingComparator
          ? "Comparator evidence is missing or failed, so no superiority delta can be computed."
          : "No baseline row exists, so no comparative delta can be computed."
      }
    ],
    allowedClaimCeiling: missingComparator ? "descriptive_only_failed_comparator_visible" : "descriptive_only_research_memo",
    critiqueSummary: missingComparator
      ? "Comparator failure must remain visible and superiority claims are blocked."
      : "Comparative improvement claims are unsupported because the baseline row is missing.",
    recommendation: missingComparator
      ? "Repair or rerun the comparator and record failure explicitly before claiming improvement."
      : "Add a baseline row and computed delta before claiming improvement."
  };
}

function collectUnsupportedClaims(
  artifacts: LoadedRunArtifacts,
  claimEvidence: ClaimEvidenceScore
): PaperReadinessAuditUnsupportedClaim[] {
  const claims = claimRows(artifacts);
  const byId = new Map(claims.map((claim) => [claim.claim_id, claim] as const));
  return claimEvidence.issues.map((issue) => ({
    claim_id: issue.claim_id,
    message: issue.message,
    status: byId.get(issue.claim_id)?.status,
    statement: byId.get(issue.claim_id)?.statement
  }));
}

function collectCitationSupportIssues(
  artifacts: LoadedRunArtifacts
): PaperReadinessAuditUnsupportedClaim[] {
  return claimRows(artifacts)
    .filter((claim) =>
      /related|literature|prior work|background/iu.test(claim.section_heading)
        && claim.citation_refs.length === 0
    )
    .map((claim) => ({
      claim_id: claim.claim_id,
      message: `Related-work claim ${claim.claim_id} has no citation support.`,
      status: claim.status,
      statement: claim.statement
    }));
}

function collectDesignContractFindings(
  artifacts: LoadedRunArtifacts
): PaperReadinessAuditDesignContractFinding[] {
  const findings: PaperReadinessAuditDesignContractFinding[] = [];
  for (const item of artifacts.designContractPayloads) {
    const rows = [
      ...recordArray(item.payload.findings),
      ...recordArray(item.payload.contract_findings),
      ...recordArray(item.payload.audit_findings)
    ];
    for (const row of rows) {
      if (row.advisory_only === true || row.design_note_only === true) {
        continue;
      }
      const code = stringValue(row.code) || stringValue(row.contract);
      const message = stringValue(row.message) || stringValue(row.summary);
      if (!code || !message) {
        continue;
      }
      findings.push({
        code,
        severity: parseFindingSeverity(row.severity),
        message,
        evidence_path: stringValue(row.evidence_path) || item.path
      });
    }

    const hiddenFailedWorkerCount = numberValue(item.payload.hidden_failed_worker_count);
    if (hiddenFailedWorkerCount > 0 && stringValue(item.payload.failed_worker_visibility) !== "visible") {
      findings.push({
        code: "distributed_worker_failure_hidden",
        severity: "blocker",
        message: `${hiddenFailedWorkerCount} failed worker run(s) are recorded without visible failed-run preservation.`,
        evidence_path: item.path
      });
    }
    if (item.payload.reverse_from_data_origin === true && item.payload.exploratory_origin_visible !== true) {
      findings.push({
        code: "reverse_from_data_origin_hidden",
        severity: "warning",
        message: "Reverse-from-data exploratory origin is recorded but not visible in the audit handoff.",
        evidence_path: item.path
      });
    }
    if (item.payload.sota_ranking_claimed === true && item.payload.sota_evidence_present !== true) {
      findings.push({
        code: "unsupported_sota_ranking",
        severity: "warning",
        message: "A SOTA/ranking claim is recorded without supporting ranking evidence.",
        evidence_path: item.path
      });
    }
    if (item.payload.plugin_manifest_gate_bypassed === true) {
      findings.push({
        code: "plugin_manifest_gate_bypassed",
        severity: "blocker",
        message: "A domain-plugin manifest gate bypass is recorded in artifact evidence.",
        evidence_path: item.path
      });
    }
  }
  return dedupeDesignFindings(findings);
}

function dedupeDesignFindings(
  findings: PaperReadinessAuditDesignContractFinding[]
): PaperReadinessAuditDesignContractFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}\u0000${finding.message}\u0000${finding.evidence_path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseFindingSeverity(value: unknown): "blocker" | "warning" {
  return value === "blocker" ? "blocker" : "warning";
}

function claimRows(artifacts: LoadedRunArtifacts): Array<{
  claim_id: string;
  statement?: string;
  section_heading: string;
  status?: string;
  citation_refs: string[];
}> {
  const rows = [
    ...extractClaims(artifacts.claimEvidenceTable),
    ...extractClaims(artifacts.claimStatusTable)
  ];
  const byId = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    byId.set(row.claim_id, { ...byId.get(row.claim_id), ...row });
  }
  return [...byId.values()];
}

function extractClaims(value: unknown): Array<{
  claim_id: string;
  statement?: string;
  section_heading: string;
  status?: string;
  citation_refs: string[];
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const claims = (value as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) {
    return [];
  }
  return claims
    .filter((claim): claim is Record<string, unknown> => Boolean(claim) && typeof claim === "object")
    .map((claim, index) => ({
      claim_id: stringValue(claim.claim_id) || `claim_${index + 1}`,
      statement: stringValue(claim.statement),
      section_heading: stringValue(claim.section_heading) || "",
      status: stringValue(claim.status),
      citation_refs: stringArray(claim.citation_refs)
    }));
}

function analyzeEvidenceStore(lines: Record<string, unknown>[]): {
  deterministicFallbackUsed: boolean;
  nonFallbackMetricEvidencePresent: boolean;
  fallbackLabels: string[];
} {
  const deterministicFallbackUsed = lines.some((line) =>
    line.deterministic_fallback_used === true
      || Boolean(stringValue(line.fallback_label))
      || /fallback/iu.test(stringValue(line.source) || "")
  );
  const nonFallbackMetricEvidencePresent = lines.some((line) =>
    line.metric_evidence_present === true
      || (Boolean(stringValue(line.metric)) && line.deterministic_fallback_used !== true && !stringValue(line.fallback_label))
  );
  return {
    deterministicFallbackUsed,
    nonFallbackMetricEvidencePresent,
    fallbackLabels: lines.map((line) => stringValue(line.fallback_label)).filter((value): value is string => Boolean(value))
  };
}

function resolveAllowedClaimLevel(input: {
  blockers: PaperReadinessAuditBlocker[];
  resultTable: ResultTableScore;
  citationSupportIssues: PaperReadinessAuditUnsupportedClaim[];
  fallbackOnly: boolean;
}): string {
  if (input.blockers.some((blocker) => blocker.code === "hidden_failed_run")) {
    return "blocked_until_failed_run_is_visible";
  }
  if (input.fallbackOnly) {
    return "system_validation_note_only";
  }
  if (!input.resultTable.measured || input.resultTable.row_count === 0) {
    return "research_memo_without_quantitative_claims";
  }
  if (input.resultTable.missing_baseline_count > 0 || input.resultTable.missing_comparator_count > 0) {
    return "descriptive_only_no_comparative_claims";
  }
  if (input.resultTable.complete_row_count === 0) {
    return "research_memo_without_quantitative_claims";
  }
  if (input.citationSupportIssues.length > 0) {
    return "result_claims_allowed_related_work_downgraded";
  }
  return input.blockers.some((blocker) => blocker.severity === "blocker")
    ? "needs_repair_before_manuscript_promotion"
    : "conditional_claims_with_artifact_links";
}

function resolveVerdict(blockers: PaperReadinessAuditBlocker[]): PaperReadinessAuditVerdict {
  if (blockers.some((blocker) => blocker.severity === "blocker")) {
    return "blocked";
  }
  if (blockers.length > 0) {
    return "needs-review";
  }
  return "conditionally-ready";
}

function buildNextActions(blockers: PaperReadinessAuditBlocker[]): string[] {
  const actions = new Set<string>();
  for (const blocker of blockers) {
    if (blocker.code === "baseline_or_comparator_missing") {
      actions.add("Add or rerun the missing baseline/comparator and recompute deltas in result_table.json.");
    } else if (blocker.code === "result_table_missing" || blocker.code === "result_table_incomplete") {
      actions.add("Produce a complete metric/result table before paper-ready promotion.");
    } else if (blocker.code === "fallback_only_evidence") {
      actions.add("Replace fallback-only evidence with a real executed experiment or downgrade to a system validation note.");
    } else if (blocker.code === "unsupported_claims_present") {
      actions.add("Map each major claim to artifact, result, citation, or mark it blocked/downgraded.");
    } else if (blocker.code === "citation_support_missing") {
      actions.add("Attach citation support or downgrade related-work statements.");
    } else if (blocker.code === "figure_result_caption_mismatch") {
      actions.add("Repair figure/result/caption mismatches and rerun figure_audit before review.");
    } else if (blocker.code === "hidden_failed_run") {
      actions.add("Expose failed run status in the audit bundle and remove paper_ready=true.");
    } else if (blocker.code === "artifact_contract_incomplete") {
      actions.add("Restore required governance artifacts or explicitly mark the bundle incomplete.");
    }
  }
  if (actions.size === 0) {
    actions.add("Keep the claim-evidence table, result table, figure audit, and review decision attached to the manuscript handoff.");
  }
  return [...actions];
}

function renderAuditMarkdown(summary: PaperReadinessAuditSummary): string {
  const lines = [
    "# Paper-Readiness Audit",
    "",
    '<a id="verdict"></a>',
    "## Verdict",
    "",
    `Generated: ${summary.generated_at}`,
    `Verdict: ${summary.verdict}`,
    `Input: ${summary.input.mode}${summary.input.seed_id ? ` ${summary.input.seed_id}` : ""}`,
    `Run artifacts: ${summary.input.run_root}`,
    "",
    '<a id="top-blockers"></a>',
    "## Top Blockers",
    ""
  ];
  if (summary.top_blockers.length === 0) {
    lines.push("- none");
  } else {
    for (const blocker of summary.top_blockers) {
      lines.push(`- ${blocker.severity}: ${blocker.code} - ${blocker.message}`);
    }
  }
  lines.push(
    "",
    '<a id="unsupported-claims"></a>',
    "## Unsupported Claims",
    "",
    ...listOrNone(summary.unsupported_claims.map((claim) =>
      `${claim.claim_id}: ${claim.statement || claim.message}`
    )),
    "",
    '<a id="baseline-comparator-status"></a>',
    "## Baseline / Comparator Status",
    "",
    `- status: ${summary.baseline_comparator_status.status}`,
    `- missing baseline rows: ${summary.baseline_comparator_status.missing_baseline_count}`,
    `- missing comparator rows: ${summary.baseline_comparator_status.missing_comparator_count}`,
    `- comparative claims allowed: ${summary.baseline_comparator_status.comparative_claim_allowed}`,
    "",
    '<a id="result-table-completeness"></a>',
    "## Result Table Completeness",
    "",
    `- measured: ${summary.result_table_completeness.measured}`,
    `- complete rows: ${summary.result_table_completeness.complete_row_count}/${summary.result_table_completeness.row_count}`,
    `- comparator coverage: ${summary.result_table_completeness.comparator_coverage ?? "n/a"}`,
    `- paper-ready allowed: ${summary.result_table_completeness.paper_ready_allowed}`,
    "",
    '<a id="figure-result-caption-mismatch"></a>',
    "## Figure / Result / Caption Mismatch",
    "",
    `- status: ${summary.figure_result_caption_mismatch.status}`,
    `- severe mismatches: ${summary.figure_result_caption_mismatch.severe_mismatch_count}`,
    `- manuscript promotion allowed: ${summary.figure_result_caption_mismatch.manuscript_promotion_allowed}`,
    "",
    '<a id="citation-support"></a>',
    "## Citation Support",
    "",
    ...listOrNone(summary.citation_support_issues.map((issue) =>
      `${issue.claim_id}: ${issue.statement || issue.message}`
    )),
    "",
    '<a id="design-contract-findings"></a>',
    "## Design Contract Findings",
    "",
    ...listOrNone(summary.design_contract_findings.map((finding) =>
      `${finding.severity}: ${finding.code} - ${finding.message} (${finding.evidence_path})`
    )),
    "",
    '<a id="literature-discovery-findings"></a>',
    "## Literature Discovery Findings",
    "",
    ...listOrNone(summary.scorer_outputs.literature_discovery.findings.map((finding) =>
      `${finding.severity}: ${finding.code} - ${finding.message} (${finding.evidence_path})`
    )),
    "",
    '<a id="paper-readiness-flags"></a>',
    "## Paper-Readiness Flags",
    "",
    `- write_paper completed: ${summary.paper_readiness.write_paper_completed}`,
    `- paper_ready flag: ${summary.paper_readiness.paper_ready}`,
    "",
    '<a id="judge-lane"></a>',
    "## Judge Lane",
    "",
    `- label: ${summary.judge_lane.audit_report_label}`,
    `- planner/worker nodes: ${summary.judge_lane.planner_worker_nodes.join(", ")}`,
    `- judge nodes: ${summary.judge_lane.judge_nodes.join(", ")}`,
    "",
    '<a id="audit-timeline"></a>',
    "## Audit Timeline",
    "",
    `- status: ${summary.audit_timeline.status}`,
    `- measured: ${summary.audit_timeline.measured}`,
    `- entries: ${summary.audit_timeline.entry_count}`,
    `- durable events: ${summary.audit_timeline.event_count}`,
    `- checkpoints: ${summary.audit_timeline.checkpoint_count}`,
    "",
    '<a id="done-condition"></a>',
    "## Done Condition",
    "",
    `- status: ${summary.done_condition.status}`,
    `- measured: ${summary.done_condition.measured}`,
    `- declared source: ${summary.done_condition.declared_source}`,
    `- failures: ${summary.done_condition.failure_count}`,
    `- warnings: ${summary.done_condition.warning_count}`,
    "",
    '<a id="autonomy-metrics"></a>',
    "## Autonomy / Evidence Metrics",
    "",
    `- autonomy_span: ${metricValue(summary.autonomy_metrics.autonomy_span)}`,
    `- human_intervention_count: ${metricValue(summary.autonomy_metrics.human_intervention_count)}`,
    `- evidence_integrity_score: ${metricValue(summary.autonomy_metrics.evidence_integrity_score)}`,
    `- backtrack_success_rate: ${metricValue(summary.autonomy_metrics.backtrack_success_rate)}`,
    `- claim_violation_count: ${metricValue(summary.autonomy_metrics.claim_violation_count)}`,
    `- reproducibility_score: ${metricValue(summary.autonomy_metrics.reproducibility_score)}`,
    "",
    '<a id="claim-ceiling"></a>',
    "## Claim Ceiling",
    "",
    `Allowed level: ${summary.claim_ceiling.allowed_level}`,
    "",
    ...listOrNone(summary.claim_ceiling.rules_applied),
    "",
    "## Output Files",
    "",
    `- report: ${summary.outputs.report_path}`,
    `- summary: ${summary.outputs.summary_path}`,
    `- blockers: ${summary.outputs.blockers_path}`,
    `- claim evidence: ${summary.outputs.claim_evidence_path}`,
    `- audit timeline: ${summary.outputs.audit_timeline_path}`,
    `- claim promotion timeline: ${summary.outputs.claim_promotion_timeline_path}`,
    `- blocked claim events: ${summary.outputs.blocked_claim_events_path}`,
    `- done condition: ${summary.outputs.done_condition_path}`,
    `- autonomy metrics: ${summary.outputs.autonomy_metrics_path}`,
    ...(summary.outputs.external_intake_manifest_path ? [`- external intake manifest: ${summary.outputs.external_intake_manifest_path}`] : []),
    "",
    '<a id="next-actions"></a>',
    "## Next Actions",
    "",
    ...summary.next_action_checklist.map((action) => `- [ ] ${action}`),
    ""
  );
  return `${lines.join("\n")}\n`;
}

function listOrNone(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- none"];
}

function metricValue(metric: { measured: boolean; value: number | null; unit?: string }): string {
  if (!metric.measured || metric.value === null) {
    return "unmeasured";
  }
  return `${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function normalizeSeedId(value: string): string {
  return value.trim().toUpperCase();
}

function parseConditionName(value: Record<string, unknown> | undefined): GovernanceBenchmarkConditionName {
  const name = stringValue(value?.name) || stringValue(value?.condition);
  if (
    name === "gated"
    || name === "ungated"
    || name === "no_claim_ceiling"
    || name === "no_review_gate"
    || name === "no_figure_audit"
  ) {
    return name;
  }
  return "gated";
}

function isFailedRun(value: Record<string, unknown> | undefined): boolean {
  const status = stringValue(value?.status) || stringValue(value?.state) || stringValue(value?.phase);
  return status === "failed" || status === "error";
}

async function readOptionalJson<T = unknown>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readDesignContractPayloads(runRoot: string): Promise<Array<{ path: string; payload: Record<string, unknown> }>> {
  const candidates = [
    "design_contracts.json",
    path.join("audit", "design_contracts.json"),
    path.join("review", "design_contract_findings.json")
  ];
  const payloads: Array<{ path: string; payload: Record<string, unknown> }> = [];
  for (const candidate of candidates) {
    const payload = await readOptionalJson<Record<string, unknown>>(path.join(runRoot, candidate));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      payloads.push({ path: candidate.replace(/\\/g, "/"), payload });
    }
  }
  return payloads;
}

async function readLiteratureDiscoveryPayloads(runRoot: string): Promise<Array<{ path: string; payload: Record<string, unknown> }>> {
  const candidates = [
    "literature_discovery_audit.json",
    path.join("collect_papers", "literature_discovery_audit.json"),
    path.join("paper", "literature_discovery_audit.json")
  ];
  const payloads: Array<{ path: string; payload: Record<string, unknown> }> = [];
  for (const candidate of candidates) {
    const payload = await readOptionalJson<Record<string, unknown>>(path.join(runRoot, candidate));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      payloads.push({ path: candidate.replace(/\\/g, "/"), payload });
    }
  }
  return payloads;
}

async function readResearchBriefText(runRoot: string): Promise<string | undefined> {
  const candidates = [
    "research_brief.md",
    "brief.md",
    path.join("brief", "research_brief.md"),
    path.join("inputs", "research_brief.md")
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(path.join(runRoot, candidate), "utf8");
      if (raw.trim()) {
        return raw;
      }
    } catch {
      // Try the next conventional brief location.
    }
  }
  return undefined;
}

async function readJsonl(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
        } catch {
          return {};
        }
      });
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function relativePath(cwd: string, value: string): string {
  const relative = path.relative(cwd, value).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : value.replace(/\\/g, "/");
}
