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

export type PaperReadinessAuditVerdict = "blocked" | "needs-review" | "conditionally-ready";

export interface PaperReadinessAuditInput {
  cwd: string;
  runRoot?: string;
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
    mode: "run" | "seed";
    run_root: string;
    seed_id?: string;
  };
  outputs: {
    report_path: string;
    summary_path: string;
    blockers_path: string;
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
  scorer_outputs: {
    result_table: ResultTableScore;
    claim_evidence: ClaimEvidenceScore;
    figure_audit: FigureAuditScore;
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
  figureAuditSummary: FigureAuditSummary | null | undefined;
  runRecord: Record<string, unknown> | undefined;
  evidenceStoreLines: Record<string, unknown>[];
  designContractPayloads: Array<{ path: string; payload: Record<string, unknown> }>;
  mainTexExists: boolean;
}

const SUPPORTED_AUDIT_SEEDS = new Set(["AGB-001", "AGB-003", "AGB-010"]);

export async function runPaperReadinessAudit(
  input: PaperReadinessAuditInput
): Promise<PaperReadinessAuditSummary> {
  if (Boolean(input.runRoot) === Boolean(input.seedId)) {
    throw new Error("Paper-readiness audit requires exactly one of --run <run-artifact-root> or --seed <AGB-id>.");
  }

  const cwd = path.resolve(input.cwd);
  const outDir = path.resolve(cwd, input.outDir || path.join("outputs", "audit"));
  await fs.mkdir(outDir, { recursive: true });

  const seedId = input.seedId ? normalizeSeedId(input.seedId) : undefined;
  const runRoot = seedId
    ? await materializeSeedAuditRun({ cwd, outDir, seedId })
    : path.resolve(cwd, input.runRoot || "");
  const artifacts = await loadRunArtifacts(runRoot);
  const summary = await buildAuditSummary({
    cwd,
    outDir,
    seedId,
    artifacts
  });

  await writeJsonFile(path.join(outDir, "audit-summary.json"), summary);
  await writeJsonFile(path.join(outDir, "blockers.json"), {
    generated_at: summary.generated_at,
    verdict: summary.verdict,
    blockers: summary.top_blockers,
    unsupported_claims: summary.unsupported_claims,
    next_action_checklist: summary.next_action_checklist
  });
  await fs.writeFile(path.join(outDir, "paper-readiness-audit.md"), renderAuditMarkdown(summary), "utf8");

  return summary;
}

async function buildAuditSummary(input: {
  cwd: string;
  outDir: string;
  seedId?: string;
  artifacts: LoadedRunArtifacts;
}): Promise<PaperReadinessAuditSummary> {
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

  return {
    generated_at: new Date().toISOString(),
    verdict,
    input: {
      mode: input.seedId ? "seed" : "run",
      run_root: relativePath(input.cwd, input.artifacts.runRoot),
      ...(input.seedId ? { seed_id: input.seedId } : {})
    },
    outputs: {
      report_path: path.posix.join(relativeOutDir, "paper-readiness-audit.md"),
      summary_path: path.posix.join(relativeOutDir, "audit-summary.json"),
      blockers_path: path.posix.join(relativeOutDir, "blockers.json")
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
    scorer_outputs: {
      result_table: resultTable,
      claim_evidence: claimEvidence,
      figure_audit: figureAudit,
      ...(liveValidation ? { live_validation: liveValidation } : {}),
      governance_score: governanceScore
    },
    next_action_checklist: buildNextActions(blockers)
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
    figureAuditSummary: await readOptionalJson<FigureAuditSummary>(path.join(runRoot, "figure_audit", "figure_audit_summary.json")),
    runRecord: await readOptionalJson<Record<string, unknown>>(path.join(runRoot, "run_record.json")),
    evidenceStoreLines: await readJsonl(path.join(runRoot, "evidence_store.jsonl")),
    designContractPayloads: await readDesignContractPayloads(runRoot),
    mainTexExists: await fileExists(path.join(runRoot, "paper", "main.tex"))
  };
}

async function materializeSeedAuditRun(input: {
  cwd: string;
  outDir: string;
  seedId: string;
}): Promise<string> {
  if (!SUPPORTED_AUDIT_SEEDS.has(input.seedId)) {
    throw new Error(`Unsupported audit seed: ${input.seedId}. Expected AGB-001, AGB-003, or AGB-010.`);
  }
  const runRoot = path.join(input.outDir, "_seed-replay", input.seedId, "runs", `${input.seedId}-gated-audit`);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const scenario = seedScenario(input.seedId);
  await writeJsonFile(path.join(runRoot, "governance_condition.json"), {
    name: "gated",
    task_id: input.seedId,
    replay_mode: "audit_seed_replay"
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
  await fs.writeFile(path.join(runRoot, "paper", "main.tex"), "\\section{Audit Seed Replay}\nPaper-shaped output is not paper-ready evidence.\n", "utf8");
  return runRoot;
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
} {
  const auditedAt = "2026-05-04T00:00:00.000Z";
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
    '<a id="paper-readiness-flags"></a>',
    "## Paper-Readiness Flags",
    "",
    `- write_paper completed: ${summary.paper_readiness.write_paper_completed}`,
    `- paper_ready flag: ${summary.paper_readiness.paper_ready}`,
    "",
    '<a id="claim-ceiling"></a>',
    "## Claim Ceiling",
    "",
    `Allowed level: ${summary.claim_ceiling.allowed_level}`,
    "",
    ...listOrNone(summary.claim_ceiling.rules_applied),
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
