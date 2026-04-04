import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs, generatePublicRunReadme } from "../publicOutputPublisher.js";
import {
  buildOperatorHistoryRelativePath,
  renderOperatorHistoryMarkdown,
  renderOperatorSummaryMarkdown
} from "../operatorSummary.js";
import { PaperProfileConfig, TransitionRecommendation } from "../../types.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
import { ensureDir, fileExists } from "../../utils/fs.js";
import { buildPublicAnalysisDir, buildPublicPaperDir } from "../publicArtifacts.js";
import type { ConstraintProfile } from "../runConstraints.js";
import {
  ObjectiveMetricEvaluation,
  resolveObjectiveMetricProfile
} from "../objectiveMetric.js";
import {
  buildRelatedWorkBrief,
  buildRelatedWorkNotes,
  buildPaperBibtex,
  buildPaperEvidenceMap,
  collectPaperCitationIds,
  PaperWritingBundle,
  parseCorpusRows,
  parseEvidenceRows,
  parseExperimentPlan,
  parseHypotheses,
  parsePaperSummaries,
  parseResultAnalysis,
  validatePaperDraft
} from "../analysis/paperWriting.js";
import {
  buildVerifiedRegistryWithExternalLookup,
  VerifiedRegistryArtifact
} from "../analysis/verifiedRegistry.js";
import {
  checkCitationConsistency,
  type CitationReport
} from "../analysis/citationConsistencyChecker.js";
import {
  buildNetworkDependencyReadinessRisks,
  buildReadinessRiskArtifact,
  type ReadinessRisk,
  type ReadinessRiskArtifact
} from "../readinessRisks.js";
import {
  PaperManuscript,
  PaperSubmissionValidationReport,
  PaperTraceabilityReport,
  buildFallbackPaperManuscript,
  buildPaperSubmissionValidation,
  buildPaperTraceability,
  renderSubmissionPaperTex
} from "../analysis/paperManuscript.js";
import {
  applyGateWarningsToLimitations,
  appendixConsistencyLinter,
  applyScientificWritingPolicy,
  buildScientificValidationArtifact,
  buildWritePaperGateDecision,
  ConsistencyLintReport,
  experimentArtifactLoader,
  manuscriptConsistencyLinter,
  materializeScientificManuscript,
  resolvePaperProfile
} from "../analysis/scientificWriting.js";
import { PaperWriterSessionManager } from "../agents/paperWriterSessionManager.js";
import {
  buildManuscriptRepairPlan,
  buildManuscriptRepairVerificationArtifact,
  buildManuscriptStyleLint,
  collectManuscriptQualityIssues,
  reconcileManuscriptStyleLintWithReview,
  ManuscriptQualityIssueSnapshot,
  ManuscriptRepairPlanArtifact,
  ManuscriptRepairVerificationArtifact,
  ManuscriptReviewAuditArtifact,
  ManuscriptRepairDecision,
  ManuscriptRepairReport,
  ManuscriptReviewArtifact,
  ManuscriptReviewValidationArtifact,
  validateManuscriptReviewArtifact,
  ManuscriptStyleLintArtifact
} from "../analysis/manuscriptQuality.js";
import { maybeEnrichRelatedWorkScout } from "../writePaperRelatedWorkEnrichment.js";
import { maybeRunRelatedWorkScout } from "../writePaperRelatedWorkScout.js";
import {
  buildPostDraftCritique,
  critiqueDecisionToTransitionAction,
  critiqueDecisionToTargetNode,
  type PaperCritique
} from "../paperCritique.js";
import type { BriefEvidenceAssessment } from "../analysis/briefEvidenceValidator.js";
import type { ManuscriptType } from "../paperCritique.js";
import { buildRunOperatorStatus } from "../runs/runStatus.js";
import { buildRunCompletenessChecklist } from "../runs/runCompletenessChecklist.js";
import {
  deriveLatexTemplatePolicy,
  loadLatexTemplate,
  resolveLatexTemplatePath,
  type ParsedLatexTemplate
} from "../latex/latexTemplateLoader.js";
import {
  parseAppendixPreferencesFromBrief,
  parseManuscriptTemplateFromBrief
} from "../runs/researchBriefFiles.js";

interface PaperCompileCommandResult {
  step: string;
  command: string;
  status: "ok" | "error";
  exit_code?: number;
  duration_ms: number;
  optional?: boolean;
  stdout?: string;
  stderr?: string;
}

interface PaperCompileAttempt {
  attempt: number;
  repaired: boolean;
  status: "success" | "failed";
  commands: PaperCompileCommandResult[];
  warnings: string[];
  error?: string;
  build_log_path: string;
  pdf_exists: boolean;
}

interface PaperCompileResult {
  enabled: boolean;
  status: "skipped" | "success" | "repaired_success" | "failed";
  repaired: boolean;
  toolCallsUsed: number;
  attempts: PaperCompileAttempt[];
  warnings: string[];
  pdf_path?: string;
  build_log_path?: string;
  repair_error?: string;
}

interface CompiledPdfPageValidationReport {
  checked: boolean;
  validation_mode: "default" | "strict_paper";
  status: "pass" | "warn" | "fail";
  outcome: "ok" | "under_limit" | "measurement_unavailable" | "skipped";
  minimum_main_pages: number;
  target_main_pages: number;
  main_page_limit: number;
  compiled_pdf_page_count: number | null;
  pdf_path: string | null;
  message: string;
}

interface PaperInputValidationIssue {
  artifact: string;
  path: string;
  reason: string;
}

interface PaperInputValidationReport {
  ok: boolean;
  issues: PaperInputValidationIssue[];
}

type ClaimEvidenceStatus = "verified" | "unverified" | "blocked" | "inferred";

interface ClaimEvidenceTableRow {
  claim_id: string;
  statement: string;
  section_heading: string;
  evidence_source_type: "literature" | "experiment" | "qualitative_observation" | "limitation";
  artifact_refs: string[];
  citation_refs: string[];
  strength: "high" | "medium" | "low";
  downgrade_note?: string;
}

interface ClaimStatusRow {
  claim_id: string;
  statement: string;
  section_heading: string;
  status: ClaimEvidenceStatus;
  primary_source_present: boolean;
  run_artifact_present: boolean;
  reproduction_trace_present: boolean;
  artifact_refs: string[];
  citation_refs: string[];
  claim_ids_in_trace: string[];
  citation_statuses: Array<{
    citation_paper_id: string;
    resolved_paper_id?: string;
    status: ClaimEvidenceStatus;
    repaired: boolean;
  }>;
  notes: string[];
}

interface ClaimStatusTableArtifact {
  generated_at: string;
  counts: Record<ClaimEvidenceStatus, number>;
  claims: ClaimStatusRow[];
}

interface EvidenceGateIssue {
  severity: "warning" | "fail";
  code: string;
  claim_id: string;
  section_heading: string;
  message: string;
  fix_recommendation: string;
}

interface EvidenceGateDecisionArtifact {
  generated_at: string;
  status: "pass" | "warn" | "fail";
  blocking_issue_count: number;
  warning_count: number;
  issues: EvidenceGateIssue[];
  summary_lines: string[];
}

interface PaperReadinessArtifact {
  generated_at: string;
  paper_ready: boolean;
  readiness_state: ManuscriptType;
  overall_score?: number;
  reason: string;
  citation_check: CitationReport["status"];
  triggered_by: string[];
  evidence_gate_status: EvidenceGateDecisionArtifact["status"];
  scientific_validation_status: "pass" | "warn" | "fail";
  submission_validation_ok: boolean;
  manuscript_quality_action: ManuscriptRepairDecision["action"];
  claim_status_counts: Record<ClaimEvidenceStatus, number>;
}

interface ManuscriptQualityFailureArtifact {
  generated_at: string;
  reason: string;
  decision_digest: ManuscriptRepairDecision["decision_digest"];
  summary_lines: string[];
  triggered_by: string[];
  review_reliability: "grounded" | "partially_grounded" | "degraded";
  final_issues: ManuscriptQualityIssueSnapshot[];
  lint_findings: Array<{
    code: string;
    section: string;
    severity: "warning" | "fail";
    gate_role?: "primary_signal" | "backstop_only" | "hard_stop";
    coverage_status?: "primary" | "backstop_only";
    covered_by_review_issue_code?: string;
    location_keys?: string[];
  }>;
  reviewer_missed_policy_findings: Array<{
    code: string;
    section: string;
    severity: "warning" | "fail";
    gate_role?: "hard_stop";
    location_keys?: string[];
  }>;
  reviewer_covered_backstop_findings: Array<{
    code: string;
    section: string;
    severity: "warning" | "fail";
    gate_role?: "backstop_only";
    covered_by_review_issue_code?: string;
    location_keys?: string[];
  }>;
}

type ManuscriptRepairDecisionCore = Omit<ManuscriptRepairDecision, "summary_lines" | "decision_digest">;

interface PaperDraftValidationRepairReport {
  threshold: number;
  attempted: boolean;
  applied: boolean;
  source?: string;
  error?: string;
  reason?: string;
  initial_warning_count: number;
  candidate_warning_count?: number;
  final_warning_count: number;
}

interface ManuscriptCandidateEvaluation {
  manuscript: PaperManuscript;
  traceability: PaperTraceabilityReport;
  tex: string;
  submissionValidation: PaperSubmissionValidationReport;
  styleLint: ManuscriptStyleLintArtifact;
  consistencyLint: ConsistencyLintReport;
  appendixLint: ConsistencyLintReport;
  gateDecision: ReturnType<typeof buildWritePaperGateDecision>;
}

interface GroundedManuscriptReviewCycleResult {
  review: ManuscriptReviewArtifact;
  reviewValidation: ManuscriptReviewValidationArtifact;
  reviewAudit: ManuscriptReviewAuditArtifact;
  reviewRaw?: string;
  auditRaw?: string;
  toolCallsUsed: number;
  retryUsed: boolean;
}

const VALIDATION_REPAIR_WARNING_THRESHOLD = 1;

export function createWritePaperNode(deps: NodeExecutionDeps): GraphNodeHandler {
  const sessions = new PaperWriterSessionManager({
    config: deps.config,
    codex: deps.codex,
    llm: deps.llm,
    eventStream: deps.eventStream,
    runStore: deps.runStore,
    workspaceRoot: process.cwd()
  });

  return {
    id: "write_paper",
    async execute({ run, abortSignal }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const emitLog = (text: string) => {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "write_paper",
          payload: { text }
        });
      };
      const bundleResult = await loadValidatedPaperBundle(run);
      await writeRunArtifact(
        run,
        "paper/input_validation.json",
        `${JSON.stringify(bundleResult.report, null, 2)}\n`
      );
      await runContextMemory.put("write_paper.input_validation", bundleResult.report);
      if (!bundleResult.bundle) {
        emitLog(bundleResult.error);
        await runContextMemory.put("write_paper.last_error", bundleResult.error);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: bundleResult.error,
          summary: bundleResult.error,
          toolCallsUsed: 0
        };
      }
      await runContextMemory.put("write_paper.last_error", null);
      const preDraftCritique = await loadPreDraftCritique(run.id);
      const briefEvidenceAssessment =
        (await runContextMemory.get<BriefEvidenceAssessment>("analyze_results.brief_evidence_assessment")) ?? undefined;
      const writeEligibility = evaluateWritePaperEligibility({
        preDraftCritique,
        briefEvidenceAssessment
      });
      await writeRunArtifact(
        run,
        "paper/write_paper_eligibility.json",
        `${JSON.stringify(writeEligibility, null, 2)}\n`
      );
      await runContextMemory.put("write_paper.eligibility", writeEligibility);
      if (!writeEligibility.allowed) {
        emitLog(writeEligibility.reason);
        await runContextMemory.put("write_paper.last_error", writeEligibility.reason);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: writeEligibility.reason,
          summary: writeEligibility.reason,
          toolCallsUsed: 0
        };
      }

      const constraintProfile = await resolveConstraintProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "write_paper",
        abortSignal
      });
      const objectiveMetricProfile = await resolveObjectiveMetricProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "write_paper"
      });
      const objectiveEvaluation = await loadObjectiveEvaluation(runContextMemory, run.id);
      const bundle = bundleResult.bundle;
      const manuscriptFormatTarget = await runContextMemory.get("run_brief.manuscript_format") as
        { columns?: number; main_body_pages?: number; references_excluded_from_page_limit?: boolean; appendices_excluded_from_page_limit?: boolean } | undefined;
      const rawBrief = (await runContextMemory.get<string>("run_brief.raw")) ?? null;
      const briefTemplatePath = rawBrief
        ? (parseManuscriptTemplateFromBrief(rawBrief) ?? null)
        : null;
      const briefAppendixPreferences = rawBrief
        ? (parseAppendixPreferencesFromBrief(rawBrief) ?? undefined)
        : undefined;
      const resolvedTemplatePath = await resolveLatexTemplatePath(
        process.cwd(),
        briefTemplatePath
      );
      let parsedTemplate: ParsedLatexTemplate | null = null;
      if (briefTemplatePath && !resolvedTemplatePath) {
        emitLog(
          `[write_paper] LaTeX template not found (${briefTemplatePath}). Using built-in preamble.`
        );
      } else if (resolvedTemplatePath) {
        try {
          parsedTemplate = await loadLatexTemplate(resolvedTemplatePath);
          emitLog(
            `[write_paper] LaTeX template loaded: ${parsedTemplate.sourcePath}` +
              (parsedTemplate.sectionOrder.length > 0
                ? ` (sections: ${parsedTemplate.sectionOrder.join(", ")})`
                : "")
          );
        } catch (err) {
          emitLog(
            `[write_paper] LaTeX template load failed (${resolvedTemplatePath}): ${err}. Using built-in preamble.`
          );
        }
      }
      const templatePolicy = deriveLatexTemplatePolicy(parsedTemplate);
      const briefMainBodyPages =
        typeof manuscriptFormatTarget?.main_body_pages === "number" ? manuscriptFormatTarget.main_body_pages : undefined;
      const paperProfile = resolvePaperProfile(
        {
          column_count:
            parsedTemplate?.columnLayout
            ?? (manuscriptFormatTarget?.columns === 1 ? 1 : undefined),
          target_main_pages: briefMainBodyPages,
          minimum_main_pages: briefMainBodyPages,
          main_page_limit: briefMainBodyPages,
          references_counted:
            manuscriptFormatTarget
              ? manuscriptFormatTarget.references_excluded_from_page_limit === false
              : undefined,
          appendix_allowed:
            manuscriptFormatTarget
              ? manuscriptFormatTarget.appendices_excluded_from_page_limit !== false
              : undefined,
          appendix_format: templatePolicy.appendixFormat ?? undefined,
          prefer_appendix_for: briefAppendixPreferences?.preferAppendixFor,
          estimated_words_per_page: templatePolicy.estimatedWordsPerPage ?? undefined
        },
        constraintProfile
      );
      const validationMode = resolvePaperValidationMode(deps.config.paper?.validation_mode);
      bundle.latestResults = await loadLatestResultsArtifact(run);
      const relatedWorkScout = await maybeRunRelatedWorkScout({
        run,
        bundle,
        constraintProfile,
        semanticScholar: deps.semanticScholar,
        abortSignal,
        emitLog
      });
      await runContextMemory.put("write_paper.related_work_scout", {
        status: relatedWorkScout.status,
        reason: relatedWorkScout.reason,
        query: relatedWorkScout.query,
        rationale: relatedWorkScout.rationale,
        requested_limit: relatedWorkScout.requested_limit,
        paper_count: relatedWorkScout.papers.length,
        papers: relatedWorkScout.papers,
        planned_query_count: relatedWorkScout.queryPlan?.planned_queries.length || 0,
        executed_query_count: relatedWorkScout.coverageAudit?.after.executed_query_count || 0,
        coverage_status: relatedWorkScout.coverageAudit?.status,
        coverage_stop_reason: relatedWorkScout.coverageAudit?.stop_reason
      });
      if (relatedWorkScout.scout && relatedWorkScout.corpusRows.length > 0) {
        bundle.relatedWorkScout = relatedWorkScout.scout;
        bundle.corpus = mergeBundleCorpus(bundle.corpus, relatedWorkScout.corpusRows);
      }
      const relatedWorkEnrichment = await maybeEnrichRelatedWorkScout({
        run,
        config: deps.config,
        scoutRows: relatedWorkScout.corpusRows,
        existingPaperIds: new Set(bundle.paperSummaries.map((item) => item.paper_id)),
        llm: deps.llm,
        pdfTextLlm: deps.pdfTextLlm,
        responsesPdfAnalysis: deps.responsesPdfAnalysis,
        abortSignal,
        emitLog
      });
      await runContextMemory.put("write_paper.related_work_enrichment", {
        status: relatedWorkEnrichment.status,
        reason: relatedWorkEnrichment.reason,
        attempted_paper_count: relatedWorkEnrichment.attemptedPaperIds.length,
        analyzed_paper_count: relatedWorkEnrichment.summaryRows.length,
        full_text_count: relatedWorkEnrichment.fullTextCount,
        abstract_fallback_count: relatedWorkEnrichment.abstractFallbackCount,
        failures: relatedWorkEnrichment.failures
      });
      if (relatedWorkEnrichment.summaryRows.length > 0) {
        bundle.paperSummaries = mergeBundlePaperSummaries(
          bundle.paperSummaries,
          relatedWorkEnrichment.summaryRows
        );
        bundle.evidenceRows = mergeBundleEvidenceRows(
          bundle.evidenceRows,
          relatedWorkEnrichment.evidenceRows
        );
      }
      const relatedWorkNotes = buildRelatedWorkNotes(bundle);
      if (relatedWorkNotes.length > 0) {
        bundle.relatedWorkNotes = relatedWorkNotes;
        const relatedWorkBrief = buildRelatedWorkBrief(bundle);
        await writeRunArtifact(
          run,
          "paper/related_work_notes.json",
          `${JSON.stringify(
            {
              note_count: relatedWorkNotes.length,
              comparison_axes: relatedWorkBrief.comparison_axes,
              paragraph_plan: relatedWorkBrief.paragraph_plan,
              notes: relatedWorkNotes
            },
            null,
            2
          )}\n`
        );
        await runContextMemory.put("write_paper.related_work_notes", {
          note_count: relatedWorkNotes.length,
          comparison_axes: relatedWorkBrief.comparison_axes,
          paragraph_plan: relatedWorkBrief.paragraph_plan,
          top_titles: relatedWorkNotes.slice(0, 4).map((item) => item.title)
        });
      }

      emitLog(
        `Preparing paper draft from ${bundle.paperSummaries.length} summaries, ${bundle.evidenceRows.length} evidence items, and ${bundle.hypotheses.length} hypotheses.`
      );

      const sessionResult = await sessions.run({
        run,
        bundle,
        constraintProfile,
        paperProfile,
        objectiveMetricProfile,
        objectiveEvaluation,
        latexTemplateSectionOrder:
          parsedTemplate?.sectionOrder?.length ? parsedTemplate.sectionOrder : null,
        appendixKeepInMainBody:
          briefAppendixPreferences?.keepInMainBody?.length ? briefAppendixPreferences.keepInMainBody : null,
        abortSignal
      });
      let paperDraft = sessionResult.draft;
      emitLog(`Structured paper draft prepared with ${paperDraft.sections.length} sections via ${sessionResult.source}.`);

      let validation = validatePaperDraft({
        draft: paperDraft,
        bundle
      });
      paperDraft = validation.draft;
      if (validation.issues.length > 0) {
        emitLog(`Validated paper draft and recorded ${validation.issues.length} evidence-alignment warning(s).`);
      }
      const validationRepair: PaperDraftValidationRepairReport = {
        threshold: VALIDATION_REPAIR_WARNING_THRESHOLD,
        attempted: false,
        applied: false,
        initial_warning_count: validation.issues.length,
        final_warning_count: validation.issues.length
      };
      if (shouldAttemptValidationRepair(validation)) {
        emitLog(
          `Validation accumulated ${validation.issues.length} warning(s); attempting one automatic repair pass before rendering.`
        );
        const repairResult = await sessions.reviseAfterValidation({
          run,
          bundle,
          constraintProfile,
          paperProfile,
          objectiveMetricProfile,
          objectiveEvaluation,
          outline: sessionResult.outline,
          draft: paperDraft,
          review: sessionResult.review,
          validationIssues: validation.issues,
          abortSignal
        });
        validationRepair.attempted = repairResult.attempted;
        validationRepair.source = repairResult.source;
        validationRepair.error = repairResult.error;
        if (repairResult.applied) {
          const repairedValidation = validatePaperDraft({
            draft: repairResult.draft,
            bundle
          });
          validationRepair.candidate_warning_count = repairedValidation.issues.length;
          if (repairedValidation.issues.length <= validation.issues.length) {
            paperDraft = repairedValidation.draft;
            validation = repairedValidation;
            validationRepair.applied = true;
            validationRepair.final_warning_count = repairedValidation.issues.length;
            emitLog(
              `Automatic validation repair ${repairedValidation.issues.length < validationRepair.initial_warning_count ? "reduced" : "stabilized"} warnings at ${repairedValidation.issues.length}.`
            );
          } else {
            validationRepair.reason = "repair did not improve warning count";
            emitLog(
              `Automatic validation repair was discarded because warnings increased from ${validation.issues.length} to ${repairedValidation.issues.length}.`
            );
          }
        } else if (repairResult.error) {
          validationRepair.reason = "repair pass failed";
          emitLog(`Automatic validation repair failed: ${repairResult.error}`);
        }
      }

      const scientificDraft = applyScientificWritingPolicy({
        draft: paperDraft,
        bundle,
        profile: paperProfile,
        objectiveEvaluation,
        objectiveMetricProfile
      });
      const scientificValidationArtifact = buildScientificValidationArtifact(scientificDraft);
      paperDraft = scientificDraft.draft;
      validation = validatePaperDraft({
        draft: paperDraft,
        bundle
      });
      await writeRunArtifact(
        run,
        "paper/scientific_validation.json",
        `${JSON.stringify(scientificValidationArtifact, null, 2)}\n`
      );
        await runContextMemory.put("write_paper.scientific_validation", {
          mode: validationMode,
          page_budget_status: scientificDraft.page_budget.status,
          page_budget_column_count: scientificDraft.page_budget.column_count,
          page_budget_target_main_pages: scientificDraft.page_budget.target_main_pages,
          page_budget_minimum_main_pages: scientificDraft.page_budget.minimum_main_pages,
          page_budget_main_page_limit: scientificDraft.page_budget.main_page_limit,
          page_budget_references_counted: scientificDraft.page_budget.references_counted,
          page_budget_target_words: scientificDraft.page_budget.target_main_words,
        page_budget_estimated_words: scientificDraft.page_budget.estimated_main_words,
        method_status: scientificDraft.method_completeness.status,
        results_status: scientificDraft.results_richness.status,
        related_work_status: scientificDraft.related_work_richness.status,
        discussion_status: scientificDraft.discussion_richness.status,
        evidence_blocked: scientificDraft.evidence_diagnostics.blocked_by_evidence_insufficiency,
        missing_evidence_categories: scientificDraft.evidence_diagnostics.missing_evidence_categories,
        thin_sections: scientificDraft.evidence_diagnostics.thin_sections,
        appendix_reference_count: scientificDraft.appendix_plan.cross_references.length,
        claim_rewrite_count: scientificDraft.claim_rewrite_report.rewrites.length,
        expansion_recheck: scientificDraft.auto_repairs.expansion_recheck,
        issue_count: scientificValidationArtifact.issues.length
      });
      if (scientificDraft.page_budget.warnings.length > 0) {
        emitLog(`Scientific page-budget warnings: ${scientificDraft.page_budget.warnings.join(" ")}`);
      }
      if (scientificDraft.claim_rewrite_report.rewrites.length > 0) {
        emitLog(
          `Claim-strength rewriting softened ${scientificDraft.claim_rewrite_report.rewrites.length} over-strong phrase(s).`
        );
      }

      const citedPaperIds = collectPaperCitationIds(paperDraft, bundle);
      const verifiedRegistryResult = await buildVerifiedRegistryWithExternalLookup({
        citedPaperIds,
        corpus: bundle.corpus,
        externalProviders: {
          semanticScholar: deps.semanticScholar,
          openAlex: deps.openAlex,
          crossref: deps.crossref,
          arxiv: deps.arxiv
        },
        abortSignal
      });
      const verifiedRegistry = verifiedRegistryResult.artifact;
      const bibtex = buildPaperBibtex(
        dedupeCorpusRowsById([
          ...bundle.corpus,
          ...verifiedRegistryResult.supplemental_corpus_rows
        ]),
        uniqueStrings(
          verifiedRegistry.entries
            .filter((entry) => entry.status !== "blocked")
            .map((entry) => entry.resolved_paper_id || entry.citation_paper_id)
            .filter(Boolean) as string[]
        )
      );
      for (const entry of verifiedRegistry.entries) {
        const resolvedPaperId = entry.resolved_paper_id || entry.citation_paper_id;
        const citationKey = bibtex.citationKeysByPaperId.get(resolvedPaperId);
        if (citationKey) {
          bibtex.citationKeysByPaperId.set(entry.citation_paper_id, citationKey);
        }
      }
      const unresolvedCitationPaperIds = uniqueStrings([
        ...bibtex.unresolvedPaperIds,
        ...verifiedRegistry.blocked_citation_paper_ids
      ]);
      const manuscriptCandidate = validationRepair.applied
        ? buildFallbackPaperManuscript({
            draft: paperDraft,
            resultAnalysis: bundle.resultAnalysis,
            objectiveEvaluation,
            objectiveMetricProfile,
            experimentPlan: bundle.experimentPlan
          })
        : sessionResult.manuscript;
      const scientificManuscript = materializeScientificManuscript({
        candidate: manuscriptCandidate,
        draft: paperDraft,
        bundle,
        profile: paperProfile,
        objectiveEvaluation,
        objectiveMetricProfile,
        appendixPlan: scientificDraft.appendix_plan,
        pageBudget: scientificDraft.page_budget
      });
      const manuscriptQuality = await runManuscriptQualityLoop({
        run,
        sessions,
        bundle,
        draft: paperDraft,
        initialManuscript: scientificManuscript.manuscript,
        constraintProfile,
        paperProfile,
        objectiveMetricProfile,
        objectiveEvaluation,
        scientificValidationArtifact,
        appendixPlan: scientificDraft.appendix_plan,
        pageBudget: scientificDraft.page_budget,
        validationMode,
        citationKeysByPaperId: bibtex.citationKeysByPaperId,
        unresolvedCitationPaperIds,
        template: deps.config?.paper?.template,
        parsedTemplate,
        emitLog,
        abortSignal,
        runContextMemory
      });
      const gateDecision = manuscriptQuality.evaluation.gateDecision;
      const nonBlockingWarnings = gateDecision.issues.filter((i) => !i.blocking);
      if (nonBlockingWarnings.length > 0) {
        bundle.gateWarnings = nonBlockingWarnings.map((i) => ({
          severity: i.severity,
          category: i.category,
          message: i.message,
          outcome: i.outcome
        }));
        paperDraft = applyGateWarningsToLimitations(paperDraft, bundle.gateWarnings);
      }

      const manuscript = manuscriptQuality.evaluation.manuscript;
      const traceability = manuscriptQuality.evaluation.traceability;
      const tex = manuscriptQuality.evaluation.tex;
      const evidenceMapObject = buildPaperEvidenceMap(paperDraft);
      const evidenceMap = JSON.stringify(evidenceMapObject, null, 2);
      const traceabilityJson = `${JSON.stringify(traceability, null, 2)}\n`;
      const manuscriptJson = `${JSON.stringify(manuscript, null, 2)}\n`;
      const provenanceMapJson = `${JSON.stringify(scientificManuscript.provenance_map, null, 2)}\n`;
      const submissionValidation = manuscriptQuality.evaluation.submissionValidation;
      const claimEvidenceTable = buildClaimEvidenceTableArtifact(evidenceMapObject);
      const claimStatusTable = buildClaimStatusTableArtifact({
        evidenceMap: evidenceMapObject,
        traceability,
        verifiedRegistry
      });
      const evidenceGateDecision = buildEvidenceGateDecisionArtifact(claimStatusTable);

      await writeRunArtifact(run, "paper/main.tex", tex);
      await writeRunArtifact(run, "paper/references.bib", bibtex.references);
      await writeRunArtifact(run, "paper/evidence_links.json", evidenceMap);
      await writeRunArtifact(
        run,
        "paper/claim_evidence_table.json",
        `${JSON.stringify(claimEvidenceTable, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "paper/verified_registry.json",
        `${JSON.stringify(verifiedRegistry, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "paper/claim_status_table.json",
        `${JSON.stringify(claimStatusTable, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "paper/evidence_gate_decision.json",
        `${JSON.stringify(evidenceGateDecision, null, 2)}\n`
      );
      const citationConsistency = checkCitationConsistency(path.join(process.cwd(), ".autolabos", "runs", run.id));
      await writeRunArtifact(
        run,
        "paper/citation_consistency.json",
        `${JSON.stringify(citationConsistency, null, 2)}\n`
      );
      await writeRunArtifact(run, "paper/draft.json", `${JSON.stringify(paperDraft, null, 2)}\n`);
      await writeRunArtifact(run, "paper/manuscript.json", manuscriptJson);
      await writeRunArtifact(run, "paper/traceability.json", traceabilityJson);
      await writeRunArtifact(run, "paper/provenance_map.json", provenanceMapJson);
      await writeRunArtifact(run, "paper/validation.json", `${JSON.stringify(validation, null, 2)}\n`);
      await writeRunArtifact(
        run,
        "paper/consistency_lint.json",
        `${JSON.stringify(
          {
            manuscript: manuscriptQuality.evaluation.consistencyLint,
            appendix: manuscriptQuality.evaluation.appendixLint
          },
          null,
          2
        )}\n`
      );
      await writeRunArtifact(
        run,
        "paper/gate_decision.json",
        `${JSON.stringify(gateDecision, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "paper/submission_validation.json",
        `${JSON.stringify(submissionValidation, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "paper/validation_repair_report.json",
        `${JSON.stringify(validationRepair, null, 2)}\n`
      );

      const publicPaperDir = buildPublicPaperDir(process.cwd(), run);
      await ensureDir(publicPaperDir);
      await fs.writeFile(path.join(publicPaperDir, "main.tex"), tex, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "references.bib"), bibtex.references, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "manuscript.json"), manuscriptJson, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "traceability.json"), traceabilityJson, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "provenance_map.json"), provenanceMapJson, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "evidence_links.json"), evidenceMap, "utf8");
      await fs.writeFile(
        path.join(publicPaperDir, "claim_evidence_table.json"),
        `${JSON.stringify(claimEvidenceTable, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "verified_registry.json"),
        `${JSON.stringify(verifiedRegistry, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "claim_status_table.json"),
        `${JSON.stringify(claimStatusTable, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "evidence_gate_decision.json"),
        `${JSON.stringify(evidenceGateDecision, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "citation_consistency.json"),
        `${JSON.stringify(citationConsistency, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(path.join(publicPaperDir, "gate_decision.json"), `${JSON.stringify(gateDecision, null, 2)}\n`, "utf8");
      await fs.writeFile(
        path.join(publicPaperDir, "manuscript_review.json"),
        `${JSON.stringify(manuscriptQuality.review, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "manuscript_review_validation.json"),
        `${JSON.stringify(manuscriptQuality.reviewValidation, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "manuscript_review_audit.json"),
        `${JSON.stringify(manuscriptQuality.reviewAudit, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "manuscript_style_lint.json"),
        `${JSON.stringify(manuscriptQuality.evaluation.styleLint, null, 2)}\n`,
        "utf8"
      );
      await fs.writeFile(
        path.join(publicPaperDir, "manuscript_quality_gate.json"),
        `${JSON.stringify(manuscriptQuality.repairDecision, null, 2)}\n`,
        "utf8"
      );

      const fallbackReadinessRisks = buildFallbackPaperReadinessRiskArtifact({
        preDraftCritique,
        verifiedRegistry,
        claimStatusTable,
        evidenceGateDecision,
        citationReport: citationConsistency,
        scientificGateStatus: gateDecision.status,
        submissionValidationOk: submissionValidation.ok,
        manuscriptQualityAction: manuscriptQuality.repairDecision.action,
        config: deps.config
      });
      await writeRunArtifact(
        run,
        "paper/readiness_risks.json",
        `${JSON.stringify(fallbackReadinessRisks, null, 2)}\n`
      );
      await fs.writeFile(
        path.join(publicPaperDir, "readiness_risks.json"),
        `${JSON.stringify(fallbackReadinessRisks, null, 2)}\n`,
        "utf8"
      );

      const preCompileToolCallsUsed =
        Math.max(1, 4 - sessionResult.stageFallbacks)
        + (validationRepair.attempted ? 1 : 0)
        + manuscriptQuality.toolCallsUsed;
      await runContextMemory.put("write_paper.public_dir", publicPaperDir);
      await runContextMemory.put("write_paper.source", sessionResult.source);
      await runContextMemory.put("write_paper.section_count", paperDraft.sections.length);
      await runContextMemory.put("write_paper.cited_paper_ids", bibtex.usedPaperIds);
      await runContextMemory.put("write_paper.last_draft", paperDraft);
      await runContextMemory.put("write_paper.last_manuscript", manuscript);
      await runContextMemory.put("write_paper.traceability", traceability);
      await runContextMemory.put("write_paper.provenance_map", scientificManuscript.provenance_map);
      await runContextMemory.put("write_paper.claim_evidence_table", claimEvidenceTable);
      await runContextMemory.put("write_paper.verified_registry", verifiedRegistry);
      await runContextMemory.put("write_paper.claim_status_table", claimStatusTable);
      await runContextMemory.put("write_paper.evidence_gate_decision", evidenceGateDecision);
      await runContextMemory.put("write_paper.citation_consistency", citationConsistency);
      await runContextMemory.put("write_paper.validation", validation);
      await runContextMemory.put("write_paper.consistency_lint", {
        manuscript: manuscriptQuality.evaluation.consistencyLint,
        appendix: manuscriptQuality.evaluation.appendixLint
      });
      await runContextMemory.put("write_paper.gate_decision", gateDecision);
      await runContextMemory.put("write_paper.submission_validation", submissionValidation);
      await runContextMemory.put("write_paper.validation_repair", validationRepair);
      await runContextMemory.put("write_paper.manuscript_review", manuscriptQuality.review);
      await runContextMemory.put("write_paper.manuscript_review_validation", manuscriptQuality.reviewValidation);
      await runContextMemory.put("write_paper.manuscript_review_audit", manuscriptQuality.reviewAudit);
      await runContextMemory.put("write_paper.manuscript_style_lint", manuscriptQuality.evaluation.styleLint);
      await runContextMemory.put("write_paper.manuscript_quality_gate", manuscriptQuality.repairDecision);
      await runContextMemory.put("write_paper.manuscript_repair_reports", manuscriptQuality.repairReports);
      await runContextMemory.put("write_paper.readiness_risks", fallbackReadinessRisks);
      if (manuscriptQuality.repairDecision.action === "stop") {
        const manuscriptError = buildManuscriptQualityFailureError(manuscriptQuality.repairDecision);
        emitLog(manuscriptError);
        await runContextMemory.put("write_paper.last_error", manuscriptError);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: manuscriptError,
          summary: manuscriptError,
          toolCallsUsed: preCompileToolCallsUsed
        };
      }
      if (gateDecision.status === "warn") {
        emitLog(`Scientific quality gate warnings (${validationMode} mode): ${gateDecision.summary.slice(1).join(" ")}`);
      }
      if (evidenceGateDecision.status === "warn") {
        emitLog(`Evidence gate warnings: ${evidenceGateDecision.summary_lines.join(" ")}`);
      }
      if (evidenceGateDecision.status === "fail") {
        const evidenceGateError = buildEvidenceGateFailureError(evidenceGateDecision);
        emitLog(evidenceGateError);
        await runContextMemory.put("write_paper.last_error", evidenceGateError);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: evidenceGateError,
          summary: evidenceGateError,
          toolCallsUsed: preCompileToolCallsUsed
        };
      }
      if (gateDecision.status === "fail") {
        const gateError = buildScientificGateFailureError(gateDecision);
        emitLog(gateError);
        await runContextMemory.put("write_paper.last_error", gateError);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: gateError,
          summary: gateError,
          toolCallsUsed: preCompileToolCallsUsed
        };
      }
      if (!submissionValidation.ok) {
        const submissionError = buildSubmissionValidationError(submissionValidation);
        emitLog(submissionError);
        await runContextMemory.put("write_paper.last_error", submissionError);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: submissionError,
          summary: submissionError,
          toolCallsUsed: preCompileToolCallsUsed
        };
      }

      // Build post-draft critique artifact
      const postDraftCritique = buildPostDraftCritique({
        preDraftCritique,
        gateDecision,
        scientificValidation: scientificValidationArtifact,
        submissionValidation,
        manuscriptSections: manuscript.sections.map((s: { heading: string }) => s.heading),
        validationWarningCount: validation.issues.length,
        claimRewriteCount: scientificDraft.claim_rewrite_report.rewrites.length,
        evidenceDiagnostics: scientificDraft.evidence_diagnostics,
        pageBudgetStatus: scientificDraft.page_budget.status,
        methodStatus: scientificDraft.method_completeness.status,
        resultsStatus: scientificDraft.results_richness.status,
        relatedWorkStatus: scientificDraft.related_work_richness.status,
        discussionStatus: scientificDraft.discussion_richness.status
      });
      await writeRunArtifact(
        run,
        "paper/paper_critique.json",
        `${JSON.stringify(postDraftCritique, null, 2)}\n`
      );
      const paperReadiness = buildPaperReadinessArtifact({
        manuscriptType: postDraftCritique.manuscript_type,
        overallScore: postDraftCritique.overall_score,
        evidenceGateDecision,
        claimStatusTable,
        citationReport: citationConsistency,
        scientificGateStatus: gateDecision.status,
        submissionValidationOk: submissionValidation.ok,
        manuscriptQualityAction: manuscriptQuality.repairDecision.action
      });
      const readinessRisks = buildPaperReadinessRiskArtifact({
        manuscriptType: postDraftCritique.manuscript_type,
        paperReadiness,
        verifiedRegistry,
        claimStatusTable,
        evidenceGateDecision,
        scientificGateStatus: gateDecision.status,
        submissionValidationOk: submissionValidation.ok,
        manuscriptQualityAction: manuscriptQuality.repairDecision.action,
        config: deps.config
      });
      await writeRunArtifact(
        run,
        "paper/paper_readiness.json",
        `${JSON.stringify(paperReadiness, null, 2)}\n`
      );
      await writeRunArtifact(
        run,
        "paper/readiness_risks.json",
        `${JSON.stringify(readinessRisks, null, 2)}\n`
      );
      await runContextMemory.put("write_paper.paper_critique", postDraftCritique);
      await runContextMemory.put("write_paper.paper_readiness", paperReadiness);
      await runContextMemory.put("write_paper.readiness_risks", readinessRisks);
      await runContextMemory.put("write_paper.manuscript_type", postDraftCritique.manuscript_type);
      const operatorSummaryInput = {
        runId: run.id,
        title: run.title,
        stage: "paper" as const,
        summary: [
          `Paper readiness: ${paperReadiness.readiness_state}.`,
          paperReadiness.reason,
          `Manuscript decision: ${postDraftCritique.overall_decision}.`
        ],
        decision: `paper_ready=${paperReadiness.paper_ready}; evidence_gate=${paperReadiness.evidence_gate_status}; scientific_validation=${paperReadiness.scientific_validation_status}.`,
        blockers: readinessRisks.risks.filter((risk) => risk.severity === "blocked").slice(0, 4).map((risk) => risk.message),
        openQuestions: readinessRisks.risks.filter((risk) => risk.severity === "warning").slice(0, 3).map((risk) => risk.message),
        nextActions: readinessRisks.risks.slice(0, 3).map((risk) => risk.recommended_action),
        references: [
          { label: "Paper readiness", path: "paper/paper_readiness.json" },
          { label: "Paper critique", path: "paper/paper_critique.json" },
          { label: "Readiness risks", path: "paper/readiness_risks.json" },
          { label: "Citation consistency", path: "paper/citation_consistency.json" },
          { label: "Claim evidence table", path: "paper/claim_evidence_table.json" },
          { label: "Evidence gate decision", path: "paper/evidence_gate_decision.json" },
          { label: "Main TeX", path: "paper/main.tex" }
        ]
      };
      const operatorSummaryPath = await writeRunArtifact(
        run,
        "operator_summary.md",
        renderOperatorSummaryMarkdown(operatorSummaryInput)
      );
      const operatorHistoryPath = await writeRunArtifact(
        run,
        buildOperatorHistoryRelativePath("paper"),
        renderOperatorHistoryMarkdown(operatorSummaryInput)
      );
      const runStatus = await buildRunOperatorStatus({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "write_paper",
        approvalMode: deps.config?.workflow?.approval_mode || "minimal",
        networkPolicy:
          deps.config?.experiments?.network_policy
          || (deps.config?.experiments?.allow_network ? "declared" : "blocked"),
        networkPurpose: deps.config?.experiments?.network_purpose
      });
      const runStatusPath = await writeRunArtifact(
        run,
        "run_status.json",
        `${JSON.stringify(runStatus, null, 2)}\n`
      );
      emitLog(
        `Post-draft critique: manuscript_type=${postDraftCritique.manuscript_type}, ` +
        `decision=${postDraftCritique.overall_decision}, ` +
        `blocking=${postDraftCritique.blocking_issues_count}.`
      );

      // If post-draft critique recommends upstream backtrack, emit transition
      const postDraftTransition = buildPostDraftTransitionRecommendation(postDraftCritique);

      const compileResult = await maybeBuildPaperPdf({
        deps,
        sessions,
        run,
        abortSignal,
        emitLog,
        publicPaperDir
      });
      const runPaperDir = path.join(process.cwd(), ".autolabos", "runs", run.id, "paper");
      const publicOutputs = await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "write_paper",
        runContext: runContextMemory,
        section: "paper",
        files: [
          {
            sourcePath: path.join(runPaperDir, "main.tex"),
            targetRelativePath: "main.tex"
          },
          {
            sourcePath: path.join(runPaperDir, "references.bib"),
            targetRelativePath: "references.bib"
          },
          {
            sourcePath: path.join(runPaperDir, "manuscript.json"),
            targetRelativePath: "manuscript.json"
          },
          {
            sourcePath: path.join(runPaperDir, "traceability.json"),
            targetRelativePath: "traceability.json"
          },
          {
            sourcePath: path.join(runPaperDir, "provenance_map.json"),
            targetRelativePath: "provenance_map.json"
          },
          {
            sourcePath: path.join(runPaperDir, "gate_decision.json"),
            targetRelativePath: "gate_decision.json"
          },
          {
            sourcePath: path.join(runPaperDir, "evidence_links.json"),
            targetRelativePath: "evidence_links.json"
          },
          {
            sourcePath: path.join(runPaperDir, "claim_evidence_table.json"),
            targetRelativePath: "claim_evidence_table.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "verified_registry.json"),
            targetRelativePath: "verified_registry.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "claim_status_table.json"),
            targetRelativePath: "claim_status_table.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "evidence_gate_decision.json"),
            targetRelativePath: "evidence_gate_decision.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "paper_readiness.json"),
            targetRelativePath: "paper_readiness.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "citation_consistency.json"),
            targetRelativePath: "citation_consistency.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "paper_critique.json"),
            targetRelativePath: "paper_critique.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "readiness_risks.json"),
            targetRelativePath: "readiness_risks.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "manuscript_review.json"),
            targetRelativePath: "manuscript_review.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "manuscript_review_validation.json"),
            targetRelativePath: "manuscript_review_validation.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "manuscript_review_audit.json"),
            targetRelativePath: "manuscript_review_audit.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "manuscript_style_lint.json"),
            targetRelativePath: "manuscript_style_lint.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "manuscript_quality_gate.json"),
            targetRelativePath: "manuscript_quality_gate.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "main.pdf"),
            targetRelativePath: "main.pdf",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "build.log"),
            targetRelativePath: "build.log",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "scientific_validation.json"),
            targetRelativePath: "scientific_validation.json",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "compiled_page_validation.json"),
            targetRelativePath: "compiled_page_validation.json",
            optional: true
          }
        ]
      });
      await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "write_paper",
        section: "results",
        files: [
          {
            sourcePath: operatorSummaryPath,
            targetRelativePath: "operator_summary.md"
          },
          {
            sourcePath: operatorHistoryPath,
            targetRelativePath: buildOperatorHistoryRelativePath("paper")
          },
          {
            sourcePath: runStatusPath,
            targetRelativePath: "run_status.json"
          }
        ]
      });
      const completenessChecklist = await buildRunCompletenessChecklist({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "write_paper"
      });
      const completenessChecklistPath = await writeRunArtifact(
        run,
        "run_completeness_checklist.json",
        `${JSON.stringify(completenessChecklist, null, 2)}\n`
      );
      await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "write_paper",
        section: "results",
        files: [
          {
            sourcePath: completenessChecklistPath,
            targetRelativePath: "run_completeness_checklist.json"
          }
        ]
      });
      emitLog(`Public paper outputs are available at ${publicOutputs.sectionDirRelative}.`);

      // Generate output bundle README after all sections are published
      try {
        await generatePublicRunReadme(process.cwd(), run);
      } catch {
        // non-fatal — README generation is best-effort
      }
      const toolCallsUsed = preCompileToolCallsUsed + compileResult.toolCallsUsed;
      await runContextMemory.put("write_paper.compile_status", compileResult.status);
      await runContextMemory.put("write_paper.compile_report", compileResult);
      await runContextMemory.put("write_paper.pdf_path", compileResult.pdf_path || null);
      if (compileResult.status === "failed") {
        const compileError = buildCompileFailureError(compileResult);
        emitLog(compileError);
        // Treat missing-tool compile failures as non-fatal — the LaTeX source was generated
        // successfully and the scientific quality gate already passed.
        const isMissingTool = compileResult.attempts.some(
          (a) => a.error && /not found|command not found|ENOENT/iu.test(a.error)
        );
        if (!isMissingTool) {
          await runContextMemory.put("write_paper.last_error", compileError);
          return {
            status: "failure",
            error: compileError,
            summary: compileError,
            toolCallsUsed
          };
        }
        emitLog("PDF compilation tool is unavailable; continuing with LaTeX source only.");
      }
      const compiledPageValidation = await validateCompiledPdfPageBudget({
        deps,
        run,
        compileResult,
        validationMode,
        minimumMainPages: scientificDraft.page_budget.minimum_main_pages,
        targetMainPages: scientificDraft.page_budget.target_main_pages
      });
      await writeRunArtifact(
        run,
        "paper/compiled_page_validation.json",
        `${JSON.stringify(compiledPageValidation, null, 2)}\n`
      );
      await fs.writeFile(
        path.join(publicPaperDir, "compiled_page_validation.json"),
        `${JSON.stringify(compiledPageValidation, null, 2)}\n`,
        "utf8"
      );
      await runContextMemory.put("write_paper.compiled_page_validation", compiledPageValidation);
      if (compiledPageValidation.status === "warn") {
        emitLog(`Compiled PDF page-budget warning: ${compiledPageValidation.message}`);
      }
      if (compiledPageValidation.status === "fail") {
        const pageValidationError = buildCompiledPdfPageValidationError(compiledPageValidation);
        emitLog(pageValidationError);
        await runContextMemory.put("write_paper.last_error", pageValidationError);
        return {
          status: "failure",
          error: pageValidationError,
          summary: pageValidationError,
          toolCallsUsed
        };
      }
      await runContextMemory.put("write_paper.last_error", sessionResult.errors[0] || null);

      deps.eventStream.emit({
        type: "NODE_COMPLETED",
        runId: run.id,
        node: "write_paper",
        payload: {
          artifacts: [
            "paper/main.tex",
            "paper/references.bib",
            "paper/manuscript.json",
            "paper/traceability.json",
            "paper/provenance_map.json",
            ...(compileResult.pdf_path ? ["paper/main.pdf"] : []),
            publicPaperDir
          ]
        }
      });

      return {
        status: "success",
        summary:
          sessionResult.source === "fallback"
            ? `Paper draft generated in LaTeX using staged fallbacks. Validation warnings: ${validation.issues.length}${describeValidationRepair(validationRepair)}. Scientific gate: ${describeScientificGateStatus(gateDecision)}. Manuscript: ${postDraftCritique.manuscript_type}. PDF: ${describeCompileStatus(compileResult)}. Public outputs: ${publicOutputs.outputRootRelative}.`
            : `Paper draft generated in LaTeX from ${paperDraft.sections.length} structured section(s) via ${sessionResult.source} with ${validation.issues.length} validation warning(s)${describeValidationRepair(validationRepair)}. Scientific gate: ${describeScientificGateStatus(gateDecision)}. Manuscript: ${postDraftCritique.manuscript_type}. PDF: ${describeCompileStatus(compileResult)}. Public outputs: ${publicOutputs.outputRootRelative}.`,
        needsApproval: true,
        toolCallsUsed,
        transitionRecommendation: postDraftTransition
      };
  }
};
}

function mergeBundleCorpus(existing: PaperWritingBundle["corpus"], additions: PaperWritingBundle["corpus"]): PaperWritingBundle["corpus"] {
  const seen = new Set(existing.map((item) => item.paper_id));
  const merged = [...existing];
  for (const row of additions) {
    if (!row.paper_id || seen.has(row.paper_id)) {
      continue;
    }
    seen.add(row.paper_id);
    merged.push(row);
  }
  return merged;
}

function mergeBundlePaperSummaries(
  existing: PaperWritingBundle["paperSummaries"],
  additions: PaperWritingBundle["paperSummaries"]
): PaperWritingBundle["paperSummaries"] {
  const merged = new Map(existing.map((item) => [item.paper_id, item] as const));
  for (const row of additions) {
    if (!row.paper_id) {
      continue;
    }
    merged.set(row.paper_id, row);
  }
  return [...merged.values()];
}

function mergeBundleEvidenceRows(
  existing: PaperWritingBundle["evidenceRows"],
  additions: PaperWritingBundle["evidenceRows"]
): PaperWritingBundle["evidenceRows"] {
  const merged = new Map(
    existing.map((item) => [`${item.paper_id}:${item.evidence_id}`, item] as const)
  );
  for (const row of additions) {
    if (!row.paper_id || !row.evidence_id) {
      continue;
    }
    merged.set(`${row.paper_id}:${row.evidence_id}`, row);
  }
  return [...merged.values()];
}

async function loadValidatedPaperBundle(
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"]
): Promise<{
  bundle?: PaperWritingBundle;
  report: PaperInputValidationReport;
  error: string;
}> {
  const runRoot = path.join(".autolabos", "runs", run.id);
  const issues: PaperInputValidationIssue[] = [];
  const paperSummariesPath = path.join(runRoot, "paper_summaries.jsonl");
  const evidenceStorePath = path.join(runRoot, "evidence_store.jsonl");
  const hypothesesPath = path.join(runRoot, "hypotheses.jsonl");
  const corpusPath = path.join(runRoot, "corpus.jsonl");
  const experimentPlanPath = path.join(runRoot, "experiment_plan.yaml");
  const resultAnalysisPath = path.join(runRoot, "result_analysis.json");
  const reviewDecisionPath = path.join(runRoot, "review", "decision.json");
  const reviewFindingsPath = path.join(runRoot, "review", "findings.jsonl");

  const [
    paperSummariesRaw,
    evidenceRowsRaw,
    hypothesesRaw,
    corpusRaw,
    experimentPlanRaw,
    resultAnalysisRaw,
    reviewDecisionRaw,
    reviewFindingsRaw
  ] = await Promise.all([
    readRequiredRunArtifact(paperSummariesPath, "paper_summaries.jsonl", issues),
    readRequiredRunArtifact(evidenceStorePath, "evidence_store.jsonl", issues),
    readRequiredRunArtifact(hypothesesPath, "hypotheses.jsonl", issues),
    readRequiredRunArtifact(corpusPath, "corpus.jsonl", issues),
    readRequiredRunArtifact(experimentPlanPath, "experiment_plan.yaml", issues),
    readRequiredRunArtifact(resultAnalysisPath, "result_analysis.json", issues),
    safeRead(reviewDecisionPath),
    safeRead(reviewFindingsPath)
  ]);

  const paperSummaries = paperSummariesRaw ? parsePaperSummaries(paperSummariesRaw) : [];
  if (paperSummariesRaw && paperSummaries.length === 0) {
    issues.push({
      artifact: "paper_summaries.jsonl",
      path: paperSummariesPath,
      reason: "no valid paper summaries were found"
    });
  }

  const evidenceRows = evidenceRowsRaw ? parseEvidenceRows(evidenceRowsRaw) : [];
  if (evidenceRowsRaw && evidenceRows.length === 0) {
    issues.push({
      artifact: "evidence_store.jsonl",
      path: evidenceStorePath,
      reason: "no valid evidence rows were found"
    });
  }

  const hypotheses = hypothesesRaw ? parseHypotheses(hypothesesRaw) : [];
  if (hypothesesRaw && hypotheses.length === 0) {
    issues.push({
      artifact: "hypotheses.jsonl",
      path: hypothesesPath,
      reason: "no valid hypotheses were found"
    });
  }

  const corpus = corpusRaw ? parseCorpusRows(corpusRaw) : [];
  if (corpusRaw && corpus.length === 0) {
    issues.push({
      artifact: "corpus.jsonl",
      path: corpusPath,
      reason: "no valid corpus rows were found"
    });
  }

  const experimentPlan = experimentPlanRaw ? parseExperimentPlan(experimentPlanRaw) : undefined;
  if (experimentPlanRaw && !experimentPlan) {
    issues.push({
      artifact: "experiment_plan.yaml",
      path: experimentPlanPath,
      reason: "the experiment plan could not be parsed"
    });
  }

  const resultAnalysis = resultAnalysisRaw ? parseResultAnalysis(resultAnalysisRaw) : undefined;
  if (resultAnalysisRaw && !resultAnalysis) {
    issues.push({
      artifact: "result_analysis.json",
      path: resultAnalysisPath,
      reason: "the result analysis could not be parsed"
    });
  }
  const reviewContext = parseReviewContext(reviewDecisionRaw, reviewFindingsRaw);

  const report: PaperInputValidationReport = {
    ok: issues.length === 0,
    issues
  };

  if (issues.length > 0) {
    const artifactList = [...new Set(issues.map((item) => item.artifact))].join(", ");
    return {
      report,
      error: `write_paper requires valid upstream artifacts before drafting. Missing or invalid inputs: ${artifactList}.`
    };
  }

  return {
    bundle: {
      runTitle: run.title,
      topic: run.topic,
      objectiveMetric: run.objectiveMetric,
      constraints: run.constraints,
      paperSummaries,
      evidenceRows,
      hypotheses,
      corpus,
      experimentPlan,
      resultAnalysis,
      reviewContext
    },
    report,
    error: ""
  };
}

function parseReviewContext(
  reviewDecisionRaw: string,
  reviewFindingsRaw: string
): PaperWritingBundle["reviewContext"] | undefined {
  if (!reviewDecisionRaw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(reviewDecisionRaw) as {
      outcome?: unknown;
      summary?: unknown;
      required_actions?: unknown;
    };
    if (typeof parsed.outcome !== "string" || typeof parsed.summary !== "string") {
      return undefined;
    }

    const topFindings = reviewFindingsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const finding = JSON.parse(line) as { title?: unknown; detail?: unknown };
          const title = typeof finding.title === "string" ? finding.title.trim() : "";
          const detail = typeof finding.detail === "string" ? finding.detail.trim() : "";
          return title && detail ? `${title}: ${detail}` : title || detail;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .slice(0, 4);

    return {
      outcome: parsed.outcome,
      summary: parsed.summary,
      requiredActions: Array.isArray(parsed.required_actions)
        ? parsed.required_actions.filter((item): item is string => typeof item === "string").slice(0, 4)
        : [],
      topFindings
    };
  } catch {
    return undefined;
  }
}

function describeValidationRepair(report: PaperDraftValidationRepairReport): string {
  if (!report.attempted) {
    return "";
  }
  if (report.applied) {
    return ` after one automatic validation repair (${report.initial_warning_count} -> ${report.final_warning_count})`;
  }
  if (report.error) {
    return ` after one failed validation repair attempt`;
  }
  return ` after one discarded validation repair attempt`;
}

function shouldAttemptValidationRepair(validation: {
  issues: Array<{ message: string }>;
}): boolean {
  return (
    validation.issues.length >= VALIDATION_REPAIR_WARNING_THRESHOLD &&
    validation.issues.some((issue) => isValidationRepairableIssue(issue.message))
  );
}

function isValidationRepairableIssue(message: string): boolean {
  return /\bborrowed\b/iu.test(message);
}

async function loadObjectiveEvaluation(
  runContextMemory: RunContextMemory,
  runId: string
): Promise<ObjectiveMetricEvaluation | undefined> {
  const cached = await runContextMemory.get<ObjectiveMetricEvaluation>("objective_metric.last_evaluation");
  if (cached) {
    return cached;
  }
  try {
    const raw = await safeRead(`.autolabos/runs/${runId}/objective_evaluation.json`);
    return raw ? (JSON.parse(raw) as ObjectiveMetricEvaluation) : undefined;
  } catch {
    return undefined;
  }
}

async function loadLatestResultsArtifact(
  run: Pick<Parameters<GraphNodeHandler["execute"]>[0]["run"], "id" | "title">
): Promise<Record<string, unknown> | undefined> {
  const filePath = path.join(buildPublicAnalysisDir(process.cwd(), run), "latest_results.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function readRequiredRunArtifact(
  filePath: string,
  artifact: string,
  issues: PaperInputValidationIssue[]
): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      issues.push({
        artifact,
        path: filePath,
        reason: "file is empty"
      });
      return undefined;
    }
    return raw;
  } catch (error) {
    issues.push({
      artifact,
      path: filePath,
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

async function maybeBuildPaperPdf(input: {
  deps: NodeExecutionDeps;
  sessions: PaperWriterSessionManager;
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
  abortSignal?: AbortSignal;
  emitLog: (text: string) => void;
  publicPaperDir: string;
}): Promise<PaperCompileResult> {
  const buildPdf = input.deps.config?.paper?.build_pdf === true;
  if (!buildPdf) {
    return {
      enabled: false,
      status: "skipped",
      repaired: false,
      toolCallsUsed: 0,
      attempts: [],
      warnings: []
    };
  }

  const runPaperDir = path.join(".autolabos", "runs", input.run.id, "paper");
  const compileWarnings: string[] = [];
  const attempts: PaperCompileAttempt[] = [];
  let toolCallsUsed = 0;
  let repaired = false;
  let repairError: string | undefined;

  input.emitLog("PDF build is enabled; starting LaTeX compilation.");

  const firstAttempt = await runLatexCompileAttempt({
    deps: input.deps,
    runId: input.run.id,
    paperDir: runPaperDir,
    attempt: 1,
    repaired: false,
    abortSignal: input.abortSignal,
    emitLog: input.emitLog
  });
  attempts.push(firstAttempt.attempt);
  compileWarnings.push(...firstAttempt.attempt.warnings);
  toolCallsUsed += firstAttempt.toolCallsUsed;

  let finalAttempt = firstAttempt.attempt;
  if (firstAttempt.ok) {
    await finalizeCompiledArtifacts(runPaperDir, input.publicPaperDir, finalAttempt);
    const pdfPath = path.join(runPaperDir, "main.pdf");
    const buildLogPath = path.join(runPaperDir, "build.log");
    const report: PaperCompileResult = {
      enabled: true,
      status: "success",
      repaired: false,
      toolCallsUsed,
      attempts,
      warnings: compileWarnings,
      pdf_path: pdfPath,
      build_log_path: buildLogPath
    };
    await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  if (!firstAttempt.repairable) {
    input.emitLog(`LaTeX compilation failed without repair attempt: ${firstAttempt.attempt.error || "unknown error"}`);
    const report: PaperCompileResult = {
      enabled: true,
      status: "failed",
      repaired: false,
      toolCallsUsed,
      attempts,
      warnings: compileWarnings,
      build_log_path: path.join(runPaperDir, "build.log")
    };
    await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const texPath = path.join(runPaperDir, "main.tex");
  const currentTex = await safeRead(texPath);
  const buildLog = await safeRead(firstAttempt.attempt.build_log_path);
  const repair = await input.sessions.repairLatex({
    run: input.run,
    tex: currentTex,
    buildLog,
    abortSignal: input.abortSignal
  });
  if (repair.tex) {
    repaired = true;
    await fs.writeFile(texPath, repair.tex, "utf8");
    await fs.writeFile(path.join(input.publicPaperDir, "main.tex"), repair.tex, "utf8");
    input.emitLog("Applied one automatic LaTeX repair pass and retrying PDF compilation.");
    const secondAttempt = await runLatexCompileAttempt({
      deps: input.deps,
      runId: input.run.id,
      paperDir: runPaperDir,
      attempt: 2,
      repaired: true,
      abortSignal: input.abortSignal,
      emitLog: input.emitLog
    });
    attempts.push(secondAttempt.attempt);
    compileWarnings.push(...secondAttempt.attempt.warnings);
    toolCallsUsed += secondAttempt.toolCallsUsed;
    finalAttempt = secondAttempt.attempt;
    if (secondAttempt.ok) {
      await finalizeCompiledArtifacts(runPaperDir, input.publicPaperDir, finalAttempt);
      const pdfPath = path.join(runPaperDir, "main.pdf");
      const buildLogPath = path.join(runPaperDir, "build.log");
      const report: PaperCompileResult = {
        enabled: true,
        status: "repaired_success",
        repaired: true,
        toolCallsUsed,
        attempts,
        warnings: compileWarnings,
        pdf_path: pdfPath,
        build_log_path: buildLogPath
      };
      await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    repairError = secondAttempt.attempt.error;
  } else {
    repairError = repair.error || "latex repair produced no replacement source";
    input.emitLog(`Automatic LaTeX repair failed: ${repairError}`);
  }

  const report: PaperCompileResult = {
    enabled: true,
    status: "failed",
    repaired,
    toolCallsUsed,
    attempts,
    warnings: compileWarnings,
    build_log_path: path.join(runPaperDir, "build.log"),
    repair_error: repairError
  };
  await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function runLatexCompileAttempt(input: {
  deps: NodeExecutionDeps;
  runId: string;
  paperDir: string;
  attempt: number;
  repaired: boolean;
  abortSignal?: AbortSignal;
  emitLog: (text: string) => void;
}): Promise<{ ok: boolean; repairable: boolean; toolCallsUsed: number; attempt: PaperCompileAttempt }> {
  const commands = [
    { step: "pdflatex-pass-1", command: "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex" },
    { step: "bibtex", command: "bibtex main", optional: true },
    { step: "pdflatex-pass-2", command: "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex" },
    { step: "pdflatex-pass-3", command: "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex" }
  ];

  const results: PaperCompileCommandResult[] = [];
  const warnings: string[] = [];
  const logChunks: string[] = [];
  let repairable = true;

  for (const item of commands) {
    input.deps.eventStream.emit({
      type: "TOOL_CALLED",
      runId: input.runId,
      node: "write_paper",
      payload: {
        command: item.command,
        cwd: input.paperDir,
        source: "paper_pdf_build"
      }
    });
    const obs = await input.deps.aci.runCommand(item.command, input.paperDir, input.abortSignal);
    const result: PaperCompileCommandResult = {
      step: item.step,
      command: item.command,
      status: obs.status,
      exit_code: obs.exit_code,
      duration_ms: obs.duration_ms,
      optional: item.optional,
      stdout: obs.stdout,
      stderr: obs.stderr
    };
    results.push(result);
    logChunks.push(`$ ${item.command}`, obs.stdout || "", obs.stderr || "", "");

    if (obs.status !== "ok") {
      if (item.optional && isMissingBinaryObservation(obs)) {
        warnings.push(`${item.step} unavailable: ${(obs.stderr || "").trim() || "missing binary"}`);
        input.emitLog(`Optional LaTeX step "${item.step}" failed; continuing with warnings.`);
        continue;
      }
      input.deps.eventStream.emit({
        type: "TEST_FAILED",
        runId: input.runId,
        node: "write_paper",
        payload: {
          command: item.command,
          stderr: obs.stderr || `${item.step} failed`
        }
      });
      if (isMissingBinaryObservation(obs) || isPolicyBlockedObservation(obs)) {
        repairable = false;
      }
      const buildLogPath = path.join(input.paperDir, `build.attempt_${input.attempt}.log`);
      await fs.writeFile(buildLogPath, logChunks.join("\n"), "utf8");
      await fs.writeFile(path.join(input.paperDir, "build.log"), logChunks.join("\n"), "utf8");
      return {
        ok: false,
        repairable,
        toolCallsUsed: results.length,
        attempt: {
          attempt: input.attempt,
          repaired: input.repaired,
          status: "failed",
          commands: results,
          warnings,
          error: obs.stderr || `${item.step} failed`,
          build_log_path: buildLogPath,
          pdf_exists: await fileExists(path.join(input.paperDir, "main.pdf"))
        }
      };
    }
  }

  const buildLogPath = path.join(input.paperDir, `build.attempt_${input.attempt}.log`);
  await fs.writeFile(buildLogPath, logChunks.join("\n"), "utf8");
  await fs.writeFile(path.join(input.paperDir, "build.log"), logChunks.join("\n"), "utf8");
  const pdfExists = await fileExists(path.join(input.paperDir, "main.pdf"));
  if (!pdfExists) {
    return {
      ok: false,
      repairable: true,
      toolCallsUsed: results.length,
      attempt: {
        attempt: input.attempt,
        repaired: input.repaired,
        status: "failed",
        commands: results,
        warnings,
        error: "pdflatex sequence completed without producing main.pdf",
        build_log_path: buildLogPath,
        pdf_exists: false
      }
    };
  }

  return {
    ok: true,
    repairable: true,
    toolCallsUsed: results.length,
    attempt: {
      attempt: input.attempt,
      repaired: input.repaired,
      status: "success",
      commands: results,
      warnings,
      build_log_path: buildLogPath,
      pdf_exists: true
    }
  };
}

async function finalizeCompiledArtifacts(
  runPaperDir: string,
  publicPaperDir: string,
  attempt: PaperCompileAttempt
): Promise<void> {
  const pdfPath = path.join(runPaperDir, "main.pdf");
  const publicPdfPath = path.join(publicPaperDir, "main.pdf");
  const buildLogSource = attempt.build_log_path;
  const publicBuildLogPath = path.join(publicPaperDir, "build.log");
  if (await fileExists(pdfPath)) {
    await fs.copyFile(pdfPath, publicPdfPath);
  }
  if (await fileExists(buildLogSource)) {
    await fs.copyFile(buildLogSource, path.join(runPaperDir, "build.log"));
    await fs.copyFile(buildLogSource, publicBuildLogPath);
  }
}

function describeCompileStatus(result: PaperCompileResult): string {
  switch (result.status) {
    case "success":
      return "built successfully";
    case "repaired_success":
      return "built successfully after one automatic repair";
    case "failed":
      return "build failed";
    default:
      return "build skipped";
  }
}

function describeScientificGateStatus(result: {
  status: "pass" | "warn" | "fail";
  blocking_issue_count: number;
  warning_count: number;
}): string {
  if (result.status === "pass") {
    return "pass";
  }
  if (result.status === "fail") {
    return `fail (${result.blocking_issue_count} blocking issue${result.blocking_issue_count === 1 ? "" : "s"})`;
  }
  return `warn (${result.warning_count} issue${result.warning_count === 1 ? "" : "s"})`;
}

async function runManuscriptQualityLoop(input: {
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
  sessions: PaperWriterSessionManager;
  bundle: PaperWritingBundle;
  draft: Parameters<typeof buildPaperTraceability>[0]["draft"];
  initialManuscript: PaperManuscript;
  constraintProfile: ConstraintProfile;
  paperProfile: PaperProfileConfig;
  objectiveMetricProfile: Awaited<ReturnType<typeof resolveObjectiveMetricProfile>>;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  scientificValidationArtifact: ReturnType<typeof buildScientificValidationArtifact>;
  appendixPlan: Parameters<typeof materializeScientificManuscript>[0]["appendixPlan"];
  pageBudget: Parameters<typeof materializeScientificManuscript>[0]["pageBudget"];
  validationMode: "default" | "strict_paper";
  citationKeysByPaperId: Map<string, string>;
  unresolvedCitationPaperIds: string[];
  template?: string;
  parsedTemplate?: ParsedLatexTemplate | null;
  emitLog: (text: string) => void;
  abortSignal?: AbortSignal;
  runContextMemory: RunContextMemory;
}): Promise<{
  evaluation: ManuscriptCandidateEvaluation;
  review: ManuscriptReviewArtifact;
  reviewValidation: ManuscriptReviewValidationArtifact;
  reviewAudit: ManuscriptReviewAuditArtifact;
  repairDecision: ManuscriptRepairDecision;
  repairReports: ManuscriptRepairReport[];
  toolCallsUsed: number;
}> {
  const context = experimentArtifactLoader({
    bundle: input.bundle,
    objectiveEvaluation: input.objectiveEvaluation,
    objectiveMetricProfile: input.objectiveMetricProfile
  });
  const repairReports: ManuscriptRepairReport[] = [];
let toolCallsUsed = 0;
let currentManuscript = input.initialManuscript;
  let previousIssues: ManuscriptQualityIssueSnapshot[] | undefined;

  const evaluateCandidate = (manuscript: PaperManuscript): ManuscriptCandidateEvaluation => {
    const consistencyLint = manuscriptConsistencyLinter({
      manuscript,
      context
    });
    const appendixLint = appendixConsistencyLinter({
      manuscript,
      appendixPlan: input.appendixPlan,
      pageBudget: input.pageBudget
    });
    const gateDecision = buildWritePaperGateDecision({
      mode: input.validationMode,
      scientificValidation: input.scientificValidationArtifact,
      consistencyLint,
      appendixLint
    });
    const traceability = buildPaperTraceability({
      draft: input.draft,
      manuscript
    });
    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability,
      citationKeysByPaperId: input.citationKeysByPaperId,
      template: input.template,
      paperProfile: input.paperProfile,
      parsedTemplate: input.parsedTemplate
    });
    const submissionValidation = buildPaperSubmissionValidation({
      manuscript,
      tex,
      traceability,
      citationKeysByPaperId: input.citationKeysByPaperId,
      unresolvedCitationPaperIds: input.unresolvedCitationPaperIds
    });
    const styleLint = buildManuscriptStyleLint({
      manuscript,
      traceability
    });
    return {
      manuscript,
      traceability,
      tex,
      submissionValidation,
      styleLint,
      consistencyLint,
      appendixLint,
      gateDecision
    };
  };

  const persistRoundArtifacts = async (roundIndex: number, payload: {
    review: ManuscriptReviewArtifact;
    reviewRaw?: string;
    reviewValidation: ManuscriptReviewValidationArtifact;
    reviewAudit: ManuscriptReviewAuditArtifact;
    auditRaw?: string;
    lint: ManuscriptStyleLintArtifact;
    decision: ManuscriptRepairDecision;
  }) => {
    await writeRoundArtifact(input.run, "paper/manuscript_review", roundIndex, payload.review);
    await writeRunArtifact(input.run, "paper/manuscript_review.json", `${JSON.stringify(payload.review, null, 2)}\n`);
    await writeRoundTextArtifact(input.run, "paper/manuscript_review", roundIndex, payload.reviewRaw || "");
    await writeRunArtifact(input.run, "paper/manuscript_review.raw.txt", `${payload.reviewRaw || ""}\n`);
    await writeRoundArtifact(
      input.run,
      "paper/manuscript_review_validation",
      roundIndex,
      payload.reviewValidation
    );
    await writeRunArtifact(
      input.run,
      "paper/manuscript_review_validation.json",
      `${JSON.stringify(payload.reviewValidation, null, 2)}\n`
    );
    await writeRoundArtifact(input.run, "paper/manuscript_review_audit", roundIndex, payload.reviewAudit);
    await writeRunArtifact(
      input.run,
      "paper/manuscript_review_audit.json",
      `${JSON.stringify(payload.reviewAudit, null, 2)}\n`
    );
    await writeRoundTextArtifact(input.run, "paper/manuscript_review_audit", roundIndex, payload.auditRaw || "");
    await writeRunArtifact(input.run, "paper/manuscript_review_audit.raw.txt", `${payload.auditRaw || ""}\n`);
    await writeRoundArtifact(input.run, "paper/manuscript_style_lint", roundIndex, payload.lint);
    await writeRunArtifact(input.run, "paper/manuscript_style_lint.json", `${JSON.stringify(payload.lint, null, 2)}\n`);
    await writeRoundArtifact(input.run, "paper/manuscript_quality_gate", roundIndex, payload.decision);
    await writeRunArtifact(input.run, "paper/manuscript_quality_gate.json", `${JSON.stringify(payload.decision, null, 2)}\n`);
    await input.runContextMemory.put("write_paper.manuscript_review", payload.review);
    await input.runContextMemory.put("write_paper.manuscript_review_validation", payload.reviewValidation);
    await input.runContextMemory.put("write_paper.manuscript_review_audit", payload.reviewAudit);
    await input.runContextMemory.put("write_paper.manuscript_style_lint", payload.lint);
    await input.runContextMemory.put("write_paper.manuscript_quality_gate", payload.decision);
  };

  const persistRepairPlanArtifact = async (
    passIndex: 1 | 2,
    repairPlan: ManuscriptRepairPlanArtifact
  ) => {
    await writeRunArtifact(
      input.run,
      `paper/manuscript_repair_plan_${passIndex}.json`,
      `${JSON.stringify(repairPlan, null, 2)}\n`
    );
    await input.runContextMemory.put(`write_paper.manuscript_repair_plan_${passIndex}`, repairPlan);
  };

  const persistRepairVerificationArtifact = async (
    passIndex: 1 | 2,
    verification: ManuscriptRepairVerificationArtifact
  ) => {
    await writeRunArtifact(
      input.run,
      `paper/manuscript_repair_verification_${passIndex}.json`,
      `${JSON.stringify(verification, null, 2)}\n`
    );
    await input.runContextMemory.put(`write_paper.manuscript_repair_verification_${passIndex}`, verification);
  };

  const runGroundedReviewCycle = async (cycleInput: {
    evaluation: ManuscriptCandidateEvaluation;
    passLabel: string;
    repairPlan?: ManuscriptRepairPlanArtifact;
    focusLocationKeys?: string[];
  }): Promise<GroundedManuscriptReviewCycleResult> => {
    let cycleToolCallsUsed = 0;
    let retryUsed = false;
    let reviewResult = await input.sessions.reviewManuscript({
      run: input.run,
      manuscript: cycleInput.evaluation.manuscript,
      bundle: input.bundle,
      constraintProfile: input.constraintProfile,
      paperProfile: input.paperProfile,
      objectiveMetricProfile: input.objectiveMetricProfile,
      objectiveEvaluation: input.objectiveEvaluation,
      stage: "manuscript_review",
      passLabel: cycleInput.passLabel,
      repairPlan: cycleInput.repairPlan,
      focusLocationKeys: cycleInput.focusLocationKeys,
      abortSignal: input.abortSignal
    });
    if (reviewResult.source !== "fallback") {
      cycleToolCallsUsed += 1;
    }

    let review = reviewResult.review;
    let reviewRaw = reviewResult.rawText;
    let validated = validateManuscriptReviewArtifact({
      review,
      manuscript: cycleInput.evaluation.manuscript,
      traceability: cycleInput.evaluation.traceability
    });
    review = validated.review;
    let reviewValidation = validated.validation;

    if (reviewValidation.retry_requested && !retryUsed) {
      retryUsed = true;
      reviewResult = await input.sessions.reviewManuscript({
        run: input.run,
        manuscript: cycleInput.evaluation.manuscript,
        bundle: input.bundle,
        constraintProfile: input.constraintProfile,
        paperProfile: input.paperProfile,
        objectiveMetricProfile: input.objectiveMetricProfile,
        objectiveEvaluation: input.objectiveEvaluation,
        stage: "manuscript_review_retry",
        passLabel: `${cycleInput.passLabel} retry`,
        previousReview: review,
        reviewValidation,
        repairPlan: cycleInput.repairPlan,
        focusLocationKeys: cycleInput.focusLocationKeys,
        abortSignal: input.abortSignal
      });
      if (reviewResult.source !== "fallback") {
        cycleToolCallsUsed += 1;
      }
      review = reviewResult.review;
      reviewRaw = reviewResult.rawText;
      validated = validateManuscriptReviewArtifact({
        review,
        manuscript: cycleInput.evaluation.manuscript,
        traceability: cycleInput.evaluation.traceability
      });
      review = validated.review;
      reviewValidation = validated.validation;
    }

    let auditResult = await input.sessions.auditManuscriptReview({
      run: input.run,
      manuscript: cycleInput.evaluation.manuscript,
      review,
      validation: reviewValidation,
      lint: cycleInput.evaluation.styleLint,
      traceability: cycleInput.evaluation.traceability,
      passLabel: cycleInput.passLabel,
      abortSignal: input.abortSignal
    });
    if (auditResult.source !== "fallback") {
      cycleToolCallsUsed += 1;
    }
    let reviewAudit = auditResult.audit;
    let auditRaw = auditResult.rawText;

    if (reviewAudit.retry_recommended && !retryUsed) {
      retryUsed = true;
      reviewResult = await input.sessions.reviewManuscript({
        run: input.run,
        manuscript: cycleInput.evaluation.manuscript,
        bundle: input.bundle,
        constraintProfile: input.constraintProfile,
        paperProfile: input.paperProfile,
        objectiveMetricProfile: input.objectiveMetricProfile,
        objectiveEvaluation: input.objectiveEvaluation,
        stage: "manuscript_review_retry",
        passLabel: `${cycleInput.passLabel} retry`,
        previousReview: review,
        reviewValidation,
        reviewAudit,
        repairPlan: cycleInput.repairPlan,
        focusLocationKeys: cycleInput.focusLocationKeys,
        abortSignal: input.abortSignal
      });
      if (reviewResult.source !== "fallback") {
        cycleToolCallsUsed += 1;
      }
      review = reviewResult.review;
      reviewRaw = reviewResult.rawText;
      validated = validateManuscriptReviewArtifact({
        review,
        manuscript: cycleInput.evaluation.manuscript,
        traceability: cycleInput.evaluation.traceability
      });
      review = validated.review;
      reviewValidation = validated.validation;
      auditResult = await input.sessions.auditManuscriptReview({
        run: input.run,
        manuscript: cycleInput.evaluation.manuscript,
        review,
        validation: reviewValidation,
        lint: cycleInput.evaluation.styleLint,
        traceability: cycleInput.evaluation.traceability,
        passLabel: `${cycleInput.passLabel} audit recheck`,
        abortSignal: input.abortSignal
      });
      if (auditResult.source !== "fallback") {
        cycleToolCallsUsed += 1;
      }
      reviewAudit = auditResult.audit;
      auditRaw = auditResult.rawText;
    }

    reviewValidation = {
      ...reviewValidation,
      metrics: {
        ...reviewValidation.metrics,
        retry_used: retryUsed
      }
    };
    reviewAudit = {
      ...reviewAudit,
      metrics: {
        ...reviewAudit.metrics,
        retry_used: retryUsed
      }
    };

    return {
      review,
      reviewValidation,
      reviewAudit,
      reviewRaw,
      auditRaw,
      toolCallsUsed: cycleToolCallsUsed,
      retryUsed
    };
  };

  const resolvePendingRepairPlan = async (inputPlan: {
    passIndex: 1 | 2;
    manuscript: PaperManuscript;
    review: ManuscriptReviewArtifact;
    lint: ManuscriptStyleLintArtifact;
    issues: ManuscriptQualityIssueSnapshot[];
    decision: ManuscriptRepairDecision;
  }): Promise<{
    plan: ManuscriptRepairPlanArtifact | undefined;
    decision: ManuscriptRepairDecision;
  }> => {
    if (inputPlan.decision.action !== "repair") {
      return {
        plan: undefined,
        decision: inputPlan.decision
      };
    }
    const repairPlan = buildManuscriptRepairPlan({
      passIndex: inputPlan.passIndex,
      manuscript: inputPlan.manuscript,
      review: inputPlan.review,
      lint: inputPlan.lint,
      mustImproveIssues: inputPlan.issues
    });
    await persistRepairPlanArtifact(inputPlan.passIndex, repairPlan);
    if (repairPlan.targets.length > 0 && repairPlan.blocked_targets.length === 0) {
      return {
        plan: repairPlan,
        decision: inputPlan.decision
      };
    }
    return {
      plan: repairPlan,
      decision: {
        ...inputPlan.decision,
        action: "stop",
        remaining_allowed_repairs: 0,
        stop_or_continue_reason:
          repairPlan.targets.length === 0
            ? "Repairable manuscript issues remained, but no bounded local repair target could be derived safely."
            : "Repairable manuscript issues remained, but some issues could not be converted into safe bounded local repair targets."
      }
    };
  };

  let evaluation = evaluateCandidate(currentManuscript);
  let reviewCycle = await runGroundedReviewCycle({
    evaluation,
    passLabel: "initial manuscript review"
  });
  toolCallsUsed += reviewCycle.toolCallsUsed;
  let review = reviewCycle.review;
  let reviewValidation = reviewCycle.reviewValidation;
  let reviewAudit = reviewCycle.reviewAudit;
  let effectiveStyleLint = reconcileManuscriptStyleLintWithReview({
    lint: evaluation.styleLint,
    review
  });
  evaluation = {
    ...evaluation,
    styleLint: effectiveStyleLint
  };
  let decision = buildInitialManuscriptRepairDecision({
    review,
    reviewValidation,
    reviewAudit,
    lint: effectiveStyleLint
  });
  let pendingRepairPlanResult = await resolvePendingRepairPlan({
    passIndex: 1,
    manuscript: evaluation.manuscript,
    review,
    lint: effectiveStyleLint,
    issues: decision.issues_before,
    decision
  });
  let pendingRepairPlan = pendingRepairPlanResult.plan;
  decision = pendingRepairPlanResult.decision;
  await persistRoundArtifacts(0, {
    review,
    reviewRaw: reviewCycle.reviewRaw,
    reviewValidation,
    reviewAudit,
    auditRaw: reviewCycle.auditRaw,
    lint: effectiveStyleLint,
    decision
  });
  input.emitLog(
    `Manuscript quality round 0: decision=${decision.action}, issues=${decision.issues_before.length}, lint=${effectiveStyleLint.issues.length}, review_reliability=${resolveReviewArtifactReliability(reviewValidation, reviewAudit)}.`
  );
  if (decision.action === "pass") {
    return {
      evaluation,
      review,
      reviewValidation,
      reviewAudit,
      repairDecision: decision,
      repairReports,
      toolCallsUsed
    };
  }

  previousIssues = decision.issues_before;

  for (const passIndex of [1, 2] as const) {
    if (decision.action !== "repair") {
      break;
    }
    const remainingAllowedRepairs = Math.max(0, decision.allowed_max_passes - passIndex);
    const repairPlan = pendingRepairPlan;
    if (!repairPlan) {
      decision = {
        ...decision,
        action: "stop",
        remaining_allowed_repairs: 0,
        stop_or_continue_reason: "A manuscript repair was requested, but no safe bounded local repair plan was available."
      };
      break;
    }
    input.emitLog(`Running manuscript repair pass ${passIndex}.`);
    const manuscriptBeforeRepair = evaluation.manuscript;
    const repairResult = await input.sessions.repairManuscript({
      run: input.run,
      passIndex,
      manuscript: manuscriptBeforeRepair,
      draft: input.draft,
      bundle: input.bundle,
      review,
      lint: evaluation.styleLint,
      repairPlan,
      objectiveEvaluation: input.objectiveEvaluation,
      objectiveMetricProfile: input.objectiveMetricProfile,
      remainingAllowedRepairs,
      mustImproveIssues: decision.issues_before,
      abortSignal: input.abortSignal
    });
    if (repairResult.source !== "fallback") {
      toolCallsUsed += 1;
    }
    currentManuscript = repairResult.manuscript;
    evaluation = evaluateCandidate(currentManuscript);
    reviewCycle = await runGroundedReviewCycle({
      evaluation,
      passLabel: `recheck after manuscript repair ${passIndex}`,
      repairPlan,
      focusLocationKeys: uniqueStrings(
        repairPlan.targets.flatMap((target) =>
          target.allowed_location_keys.length > 0 ? target.allowed_location_keys : [target.location_key]
        )
      )
    });
    toolCallsUsed += reviewCycle.toolCallsUsed;
    review = reviewCycle.review;
    reviewValidation = reviewCycle.reviewValidation;
    reviewAudit = reviewCycle.reviewAudit;
    effectiveStyleLint = reconcileManuscriptStyleLintWithReview({
      lint: evaluation.styleLint,
      review
    });
    evaluation = {
      ...evaluation,
      styleLint: effectiveStyleLint
    };
    const repairVerification = buildManuscriptRepairVerificationArtifact({
      passIndex,
      before: manuscriptBeforeRepair,
      after: currentManuscript,
      repairPlan,
      reviewAfter: review
    });
    await persistRepairVerificationArtifact(passIndex, repairVerification);
    const issuesAfter = collectManuscriptQualityIssues({
      review,
      lint: effectiveStyleLint
    });
    decision = buildFollowupManuscriptRepairDecision({
      passIndex,
      review,
      reviewValidation,
      reviewAudit,
      repairVerification,
      previousIssues: previousIssues || [],
      issuesAfter,
      gateDecision: evaluation.gateDecision,
      submissionValidation: evaluation.submissionValidation
    });
    pendingRepairPlanResult = await resolvePendingRepairPlan({
      passIndex: passIndex === 1 ? 2 : 2,
      manuscript: evaluation.manuscript,
      review,
      lint: effectiveStyleLint,
      issues: issuesAfter,
      decision
    });
    pendingRepairPlan = pendingRepairPlanResult.plan;
    decision = pendingRepairPlanResult.decision;
    const report: ManuscriptRepairReport = {
      pass_index: passIndex,
      triggered_by: uniqueStrings((previousIssues || []).map((issue) => issue.code)),
      allowed_max_passes: decision.allowed_max_passes,
      issues_before: previousIssues || [],
      issues_after: issuesAfter,
      improvement_detected: Boolean(decision.improvement_detected),
      verification_summary: repairVerification.summary,
      verification_findings: buildRepairVerificationFindings(repairVerification),
      stop_or_continue_reason: decision.stop_or_continue_reason
    };
    repairReports.push(report);
    await writeRunArtifact(
      input.run,
      `paper/manuscript_repair_${passIndex}.json`,
      `${JSON.stringify(repairResult.manuscript, null, 2)}\n`
    );
    await writeRunArtifact(
      input.run,
      `paper/manuscript_repair_${passIndex}.raw.txt`,
      `${repairResult.rawText || repairResult.error || ""}\n`
    );
    await writeRunArtifact(
      input.run,
      `paper/manuscript_repair_${passIndex}_report.json`,
      `${JSON.stringify(report, null, 2)}\n`
    );
    await persistRoundArtifacts(passIndex, {
      review,
      reviewRaw: reviewCycle.reviewRaw,
      reviewValidation,
      reviewAudit,
      auditRaw: reviewCycle.auditRaw,
      lint: effectiveStyleLint,
      decision
    });
    await input.runContextMemory.put(`write_paper.manuscript_repair_${passIndex}`, report);
    input.emitLog(
      `Manuscript quality round ${passIndex}: decision=${decision.action}, remaining_issues=${issuesAfter.length}, improvement=${decision.improvement_detected ? "yes" : "no"}, review_reliability=${resolveReviewArtifactReliability(reviewValidation, reviewAudit)}.`
    );
    if (decision.action === "pass" || decision.action === "stop") {
      break;
    }
    previousIssues = issuesAfter;
  }

  if (decision.action === "stop") {
    await writeRunArtifact(
      input.run,
      "paper/manuscript_quality_failure.json",
      `${JSON.stringify(
        buildManuscriptQualityFailureArtifact({
          decision,
          lint: evaluation.styleLint,
          reviewValidation,
          reviewAudit
        }),
        null,
        2
      )}\n`
    );
  }

  return {
    evaluation,
    review,
    reviewValidation,
    reviewAudit,
    repairDecision: decision,
    repairReports,
    toolCallsUsed
  };
}

function buildInitialManuscriptRepairDecision(input: {
  review: ManuscriptReviewArtifact;
  reviewValidation: ManuscriptReviewValidationArtifact;
  reviewAudit: ManuscriptReviewAuditArtifact;
  lint: ManuscriptStyleLintArtifact;
}): ManuscriptRepairDecision {
  const issuesBefore = collectManuscriptQualityIssues({
    review: input.review,
    lint: input.lint
  });
  const reviewReliability = resolveReviewArtifactReliability(input.reviewValidation, input.reviewAudit);
  const failCount = issuesBefore.filter((issue) => issue.severity === "fail").length;
  const nonRepairableFailCount = issuesBefore.filter((issue) => issue.severity === "fail" && !issue.repairable).length;
  if (issuesBefore.length === 0 && reviewReliability === "degraded") {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: 0,
      triggered_by: [],
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: [],
      stop_or_continue_reason:
        "The manuscript review artifact remained degraded after bounded validation and audit, so the manuscript cannot be accepted silently."
    }, reviewReliability);
  }
  if (nonRepairableFailCount > 0) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: 0,
      triggered_by: uniqueStrings(issuesBefore.filter((issue) => issue.severity === "fail" && !issue.repairable).map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: issuesBefore,
      stop_or_continue_reason:
        "Deterministic hard-stop manuscript policy findings remain outside the repairable local-writing surface."
    }, reviewReliability);
  }
  if (issuesBefore.length === 0) {
    return finalizeManuscriptRepairDecision({
      action: "pass",
      pass_index: 0,
      triggered_by: [],
      allowed_max_passes: 1,
      remaining_allowed_repairs: 1,
      issues_before: [],
      stop_or_continue_reason: "Initial manuscript review and style lint passed."
    }, reviewReliability);
  }
  if (
    issuesBefore.every((issue) => issue.repairable) &&
    (failCount > 0 || input.review.overall_decision === "repair")
  ) {
    return finalizeManuscriptRepairDecision({
      action: "repair",
      pass_index: 0,
      triggered_by: uniqueStrings(issuesBefore.map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 1,
      issues_before: issuesBefore,
      stop_or_continue_reason: "Repairable manuscript-quality issues remain after the initial review."
    }, reviewReliability);
  }
  return finalizeManuscriptRepairDecision({
    action: "pass",
    pass_index: 0,
    triggered_by: uniqueStrings(issuesBefore.map((issue) => issue.code)),
    allowed_max_passes: 1,
    remaining_allowed_repairs: 1,
    issues_before: issuesBefore,
    stop_or_continue_reason: "Initial manuscript review found only non-blocking manuscript warnings."
  }, reviewReliability);
}

function buildFollowupManuscriptRepairDecision(input: {
  passIndex: 1 | 2;
  review: ManuscriptReviewArtifact;
  reviewValidation: ManuscriptReviewValidationArtifact;
  reviewAudit: ManuscriptReviewAuditArtifact;
  repairVerification: ManuscriptRepairVerificationArtifact;
  previousIssues: ManuscriptQualityIssueSnapshot[];
  issuesAfter: ManuscriptQualityIssueSnapshot[];
  gateDecision: ReturnType<typeof buildWritePaperGateDecision>;
  submissionValidation: PaperSubmissionValidationReport;
}): ManuscriptRepairDecision {
  const reviewReliability = resolveReviewArtifactReliability(input.reviewValidation, input.reviewAudit);
  const improvement = detectIssueImprovement(input.previousIssues, input.issuesAfter);
  const repeatedIssueSignatures = findRepeatedIssueSignatures(input.previousIssues, input.issuesAfter);
  const repeatedCriticalIssues = repeatedIssueSignatures.filter((signature) =>
    CRITICAL_REPEAT_MANUSCRIPT_CODES.has(signature.code)
  );
  const changedVisualReviewIssues = collectChangedVisualReviewIssues(
    input.review,
    input.repairVerification.changed_location_keys
  );
  const remainingFailCount = input.issuesAfter.filter((issue) => issue.severity === "fail").length;
  const remainingNonRepairableFails = input.issuesAfter.filter((issue) => issue.severity === "fail" && !issue.repairable);
  if (!input.repairVerification.locality_ok) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.previousIssues.map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "The manuscript repair changed out-of-scope locations, so the bounded local repair loop stops."
    }, reviewReliability);
  }
  if (
    changedVisualReviewIssues.some((issue) => issue.severity === "fail")
    || (input.review.overall_decision === "stop" && changedVisualReviewIssues.length > 0)
  ) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(changedVisualReviewIssues.map((issue) => issue.code)),
      allowed_max_passes: input.passIndex === 1 ? 1 : 2,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason:
        "The follow-up manuscript review still finds a changed visual or caption issue after repair, so the bounded local repair loop stops."
    }, reviewReliability);
  }
  if (!input.repairVerification.visual_conservatism_ok && changedVisualReviewIssues.length === 0) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings([
        ...input.previousIssues.map((issue) => issue.code),
        ...(!input.repairVerification.visual_caption_conservatism_ok ? ["visual_caption_overclaim"] : []),
        ...(!input.repairVerification.visual_label_conservatism_ok ? ["visual_label_overclaim"] : [])
      ]),
      allowed_max_passes: input.passIndex === 1 ? 1 : 2,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason:
        "The repaired manuscript still contains non-conservative changed visual wording, so the bounded local repair loop stops instead of retrying silently."
    }, reviewReliability);
  }
  if (input.issuesAfter.length === 0) {
    if (reviewReliability === "degraded") {
      return finalizeManuscriptRepairDecision({
        action: "stop",
        pass_index: input.passIndex,
        triggered_by: uniqueStrings(input.previousIssues.map((issue) => issue.code)),
        allowed_max_passes: input.passIndex === 1 ? 1 : 2,
        remaining_allowed_repairs: 0,
        issues_before: input.previousIssues,
        issues_after: input.issuesAfter,
        improvement_detected: improvement,
        stop_or_continue_reason:
          "The repaired manuscript is locally clean, but the follow-up manuscript review artifact remained degraded after bounded retry."
      }, reviewReliability);
    }
    return finalizeManuscriptRepairDecision({
      action: "pass",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.previousIssues.map((issue) => issue.code)),
      allowed_max_passes: input.passIndex === 1 ? 1 : 2,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: `Manuscript repair ${input.passIndex} resolved the remaining manuscript-quality issues.`
    }, reviewReliability);
  }
  if (remainingNonRepairableFails.length > 0) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(remainingNonRepairableFails.map((issue) => issue.code)),
      allowed_max_passes: input.passIndex === 1 ? 1 : 2,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason:
        "Deterministic hard-stop manuscript policy findings remain after repair, so another local manuscript repair is not allowed."
    }, reviewReliability);
  }
  if (input.passIndex >= 2) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.previousIssues.map((issue) => issue.code)),
      allowed_max_passes: 2,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "A third manuscript repair pass is forbidden."
    }, reviewReliability);
  }
  if (remainingFailCount === 0 && input.review.overall_decision !== "repair") {
    return finalizeManuscriptRepairDecision({
      action: "pass",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.previousIssues.map((issue) => issue.code)),
      allowed_max_passes: input.passIndex === 1 ? 1 : 2,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "Only non-blocking manuscript warnings remain after repair."
    }, reviewReliability);
  }
  if (input.gateDecision.status === "fail" || !input.submissionValidation.ok) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.issuesAfter.map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "Scientific or submission validation now exposes core failures, so a second manuscript repair is not allowed."
    }, reviewReliability);
  }
  if (reviewReliability === "degraded") {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.issuesAfter.map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason:
        "The follow-up manuscript review artifact remained degraded after bounded validation and audit, so a second manuscript repair is not allowed."
    }, reviewReliability);
  }
  if (reviewReliability === "partially_grounded") {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.issuesAfter.map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason:
        "The follow-up manuscript review remained only partially grounded, so a second manuscript repair is not allowed."
    }, reviewReliability);
  }
  if (repeatedCriticalIssues.length > 0) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: repeatedCriticalIssues.map((item) => item.code),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "Critical manuscript-quality issue codes repeated after the first repair pass."
    }, reviewReliability);
  }
  if (repeatedIssueSignatures.length > 0) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(repeatedIssueSignatures.map((item) => item.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "The same manuscript-quality issue code repeated after repair, so the loop stops instead of retrying silently."
    }, reviewReliability);
  }
  if (!improvement || worsenedIssues(input.previousIssues, input.issuesAfter)) {
    return finalizeManuscriptRepairDecision({
      action: "stop",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.issuesAfter.map((issue) => issue.code)),
      allowed_max_passes: 1,
      remaining_allowed_repairs: 0,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "The first manuscript repair did not show a reliable quality improvement."
    }, reviewReliability);
  }
  const narrowScope =
    input.issuesAfter.every((issue) => issue.repairable) &&
    input.issuesAfter.length <= 3 &&
    uniqueStrings(input.issuesAfter.map((issue) => `${issue.source}:${issue.code}`)).length <= 3 &&
    input.review.overall_decision !== "stop";
  if (narrowScope) {
    return finalizeManuscriptRepairDecision({
      action: "repair",
      pass_index: input.passIndex,
      triggered_by: uniqueStrings(input.issuesAfter.map((issue) => issue.code)),
      allowed_max_passes: 2,
      remaining_allowed_repairs: 1,
      issues_before: input.previousIssues,
      issues_after: input.issuesAfter,
      improvement_detected: improvement,
      stop_or_continue_reason: "A second and final manuscript repair is allowed because the remaining issues are narrow, repairable, and improved after pass 1."
    }, reviewReliability);
  }
  return finalizeManuscriptRepairDecision({
    action: "stop",
    pass_index: input.passIndex,
    triggered_by: uniqueStrings(input.issuesAfter.map((issue) => issue.code)),
    allowed_max_passes: 1,
    remaining_allowed_repairs: 0,
    issues_before: input.previousIssues,
    issues_after: input.issuesAfter,
    improvement_detected: improvement,
    stop_or_continue_reason: "Remaining manuscript issues are too broad for a second local repair pass."
  }, reviewReliability);
}

function detectIssueImprovement(
  before: ManuscriptQualityIssueSnapshot[],
  after: ManuscriptQualityIssueSnapshot[]
): boolean {
  const beforeFail = before.filter((issue) => issue.severity === "fail").length;
  const afterFail = after.filter((issue) => issue.severity === "fail").length;
  if (afterFail < beforeFail) {
    return true;
  }
  const beforeScore = issueSeverityScore(before);
  const afterScore = issueSeverityScore(after);
  if (afterScore < beforeScore) {
    return true;
  }
  const beforeCodes = uniqueStrings(before.map((issue) => issue.code));
  const afterCodes = new Set(after.map((issue) => issue.code));
  const unresolvedBeforeCodes = beforeCodes.filter((code) => afterCodes.has(code));
  if (unresolvedBeforeCodes.length < beforeCodes.length) {
    return true;
  }
  return uniqueStrings(after.map(issueSignature)).length < uniqueStrings(before.map(issueSignature)).length;
}

function worsenedIssues(
  before: ManuscriptQualityIssueSnapshot[],
  after: ManuscriptQualityIssueSnapshot[]
): boolean {
  return issueSeverityScore(after) > issueSeverityScore(before)
    || after.filter((issue) => issue.severity === "fail").length > before.filter((issue) => issue.severity === "fail").length;
}

function issueSeverityScore(issues: ManuscriptQualityIssueSnapshot[]): number {
  return issues.reduce((sum, issue) => sum + (issue.severity === "fail" ? 2 : 1), 0);
}

function findRepeatedIssueSignatures(
  previous: ManuscriptQualityIssueSnapshot[],
  current: ManuscriptQualityIssueSnapshot[]
): Array<{ code: string; section: string; severity: "warning" | "fail" }> {
  const previousSet = new Set(previous.map(issueSignature));
  return current
    .filter((issue) => previousSet.has(issueSignature(issue)))
    .map((issue) => ({
      code: issue.code,
      section: issue.section,
      severity: issue.severity
    }));
}

function issueSignature(issue: ManuscriptQualityIssueSnapshot): string {
  const anchorSignature =
    issue.anchor_ids && issue.anchor_ids.length > 0
      ? uniqueStrings(issue.anchor_ids).sort().join("|")
      : issue.section;
  return `${issue.source}:${issue.code}:${anchorSignature}:${issue.severity}`;
}

function collectChangedVisualReviewIssues(
  review: ManuscriptReviewArtifact,
  changedLocationKeys: string[]
): ManuscriptReviewArtifact["issues"] {
  const changedSet = new Set(changedLocationKeys);
  return review.issues.filter((issue) =>
    (issue.visual_targets || []).some((target) => {
      const locationKey = target.kind === "table"
        ? `table:${target.index}`
        : target.kind === "figure"
          ? `figure:${target.index}`
          : target.kind === "appendix_table"
            ? `appendix_table:${target.index}`
            : `appendix_figure:${target.index}`;
      return changedSet.has(locationKey);
    })
  );
}

function resolveReviewArtifactReliability(
  reviewValidation: ManuscriptReviewValidationArtifact,
  reviewAudit: ManuscriptReviewAuditArtifact
): "grounded" | "partially_grounded" | "degraded" {
  if (
    reviewValidation.artifact_reliability === "degraded"
    || reviewAudit.artifact_reliability === "degraded"
  ) {
    return "degraded";
  }
  if (
    reviewValidation.artifact_reliability === "partially_grounded"
    || reviewAudit.artifact_reliability === "partially_grounded"
  ) {
    return "partially_grounded";
  }
  return "grounded";
}

function finalizeManuscriptRepairDecision(
  decision: ManuscriptRepairDecisionCore,
  reviewReliability: "grounded" | "partially_grounded" | "degraded"
): ManuscriptRepairDecision {
  return {
    ...decision,
    decision_digest: buildManuscriptQualityGateDecisionDigest({
      decision,
      reviewReliability
    }),
    summary_lines: buildManuscriptQualityGateSummaryLines({
      decision,
      reviewReliability
    })
  };
}

function buildManuscriptQualityGateDecisionDigest(input: {
  decision: ManuscriptRepairDecisionCore;
  reviewReliability: "grounded" | "partially_grounded" | "degraded";
}): ManuscriptRepairDecision["decision_digest"] {
  const before = summarizeIssueCounts(input.decision.issues_before);
  const after = input.decision.issues_after ? summarizeIssueCounts(input.decision.issues_after) : undefined;
  return {
    stage:
      input.decision.pass_index === 0
        ? "initial_gate"
        : input.decision.pass_index === 1
          ? "post_repair_1"
          : "post_repair_2",
    action: input.decision.action,
    review_reliability: input.reviewReliability,
    issue_counts_before: before,
    ...(after ? { issue_counts_after: after } : {}),
    ...(typeof input.decision.improvement_detected === "boolean"
      ? { improvement_detected: input.decision.improvement_detected }
      : {}),
    allowed_max_passes: input.decision.allowed_max_passes,
    remaining_allowed_repairs: input.decision.remaining_allowed_repairs,
    triggered_by: input.decision.triggered_by,
    stop_reason_category: inferManuscriptQualityStopReasonCategory(input.decision, input.reviewReliability)
  };
}

function summarizeIssueCounts(
  issues: ManuscriptQualityIssueSnapshot[]
): ManuscriptRepairDecision["decision_digest"]["issue_counts_before"] {
  return {
    total: issues.length,
    fail: issues.filter((issue) => issue.severity === "fail").length,
    warning: issues.filter((issue) => issue.severity === "warning").length
  };
}

function inferManuscriptQualityStopReasonCategory(
  decision: ManuscriptRepairDecisionCore,
  reviewReliability: "grounded" | "partially_grounded" | "degraded"
): ManuscriptRepairDecision["decision_digest"]["stop_reason_category"] {
  if (decision.action === "repair") {
    return "repairable_manuscript_issue";
  }
  if (decision.action === "pass") {
    return "clean_pass";
  }
  if (reviewReliability === "degraded" || reviewReliability === "partially_grounded") {
    if (
      /review artifact remained degraded|review artifact remained partially grounded|cannot be accepted silently/iu.test(
        decision.stop_or_continue_reason
      )
    ) {
      return "review_reliability";
    }
  }
  if (/out-of-scope locations|bounded local repair loop stops/iu.test(decision.stop_or_continue_reason)) {
    return "locality_violation";
  }
  if (
    decision.triggered_by.some((code) => code.startsWith("appendix_"))
    || /appendix/i.test(decision.stop_or_continue_reason)
  ) {
    return "policy_hard_stop";
  }
  if (
    decision.triggered_by.includes("visual_caption_overclaim")
    || /visual caption|changed visual|visual surfaces/iu.test(decision.stop_or_continue_reason)
  ) {
    return "visual_overclaim";
  }
  if (/Scientific or submission validation/iu.test(decision.stop_or_continue_reason)) {
    return "upstream_scientific_or_submission_failure";
  }
  if (/repeated/iu.test(decision.stop_or_continue_reason)) {
    return "repeated_issue";
  }
  if (/did not show a reliable quality improvement/iu.test(decision.stop_or_continue_reason)) {
    return "no_improvement";
  }
  if (/too broad|third manuscript repair pass is forbidden/iu.test(decision.stop_or_continue_reason)) {
    return "scope_too_broad";
  }
  if (reviewReliability === "partially_grounded" || reviewReliability === "degraded") {
    return "review_reliability";
  }
  return "repairable_manuscript_issue";
}

function buildManuscriptQualityGateSummaryLines(input: {
  decision: ManuscriptRepairDecisionCore;
  reviewReliability: "grounded" | "partially_grounded" | "degraded";
}): string[] {
  const digest = buildManuscriptQualityGateDecisionDigest(input);
  const beforeTotal = input.decision.issues_before.length;
  const beforeFail = input.decision.issues_before.filter((issue) => issue.severity === "fail").length;
  const afterIssues = input.decision.issues_after;
  const lines = [
    `Action: ${input.decision.action}.`,
    input.decision.pass_index === 0
      ? "Decision stage: initial manuscript-quality gate."
      : `Decision stage: post-repair gate after pass ${input.decision.pass_index}.`,
    `Decision reason: ${input.decision.stop_or_continue_reason}`,
    `Review reliability: ${input.reviewReliability}.`,
    `Reason category: ${digest.stop_reason_category}.`,
    `Issues before: ${beforeTotal} total (${beforeFail} fail).`
  ];
  if (afterIssues) {
    const afterFail = afterIssues.filter((issue) => issue.severity === "fail").length;
    lines.push(`Issues after: ${afterIssues.length} total (${afterFail} fail).`);
  }
  if (typeof input.decision.improvement_detected === "boolean") {
    lines.push(`Improvement detected: ${input.decision.improvement_detected ? "yes" : "no"}.`);
  }
  lines.push(
    `Allowed max repairs: ${input.decision.allowed_max_passes}; remaining allowed repairs: ${input.decision.remaining_allowed_repairs}.`
  );
  if (input.decision.triggered_by.length > 0) {
    lines.push(`Triggered by: ${input.decision.triggered_by.join(", ")}.`);
  }
  return lines;
}

function buildRepairVerificationFindings(
  verification: ManuscriptRepairVerificationArtifact
): ManuscriptRepairReport["verification_findings"] {
  const findings: ManuscriptRepairReport["verification_findings"] = [];
  if (verification.out_of_scope_changes.length > 0) {
    findings.push({
      code: "out_of_scope_change",
      severity: "fail",
      location_keys: verification.out_of_scope_changes,
      message: "The repair modified locations outside the bounded local repair plan."
    });
  }
  const nonConservativeCaptionChecks = verification.visual_caption_checks.filter((check) => !check.conservative);
  if (nonConservativeCaptionChecks.length > 0) {
    findings.push({
      code: "visual_caption_overclaim",
      severity: "fail",
      location_keys: nonConservativeCaptionChecks.map((check) => check.location_key),
      message: "The repaired manuscript still contains changed visual captions that overstate the takeaway.",
      concerns: uniqueStrings(nonConservativeCaptionChecks.flatMap((check) => check.concerns))
    });
  }
  const nonConservativeLabelChecks = verification.visual_label_checks.filter((check) => !check.conservative);
  if (nonConservativeLabelChecks.length > 0) {
    findings.push({
      code: "visual_label_overclaim",
      severity: "fail",
      location_keys: nonConservativeLabelChecks.map((check) => check.location_key),
      message: "The repaired manuscript still contains changed visual labels that overstate the takeaway.",
      concerns: uniqueStrings(nonConservativeLabelChecks.flatMap((check) => check.concerns))
    });
  }
  return findings;
}

function buildManuscriptQualityFailureArtifact(input: {
  decision: ManuscriptRepairDecision;
  lint: ManuscriptStyleLintArtifact;
  reviewValidation: ManuscriptReviewValidationArtifact;
  reviewAudit: ManuscriptReviewAuditArtifact;
}): ManuscriptQualityFailureArtifact {
  const reviewReliability = resolveReviewArtifactReliability(input.reviewValidation, input.reviewAudit);
  const lintFindings = input.lint.issues.map((issue) => ({
    code: issue.code,
    section: issue.section,
    severity: issue.severity,
    gate_role: issue.gate_role,
    coverage_status: issue.coverage_status,
    covered_by_review_issue_code: issue.covered_by_review_issue_code,
    location_keys: issue.location_keys
  }));
  const reviewerMissedPolicyFindings = lintFindings
    .filter((issue) => issue.gate_role === "hard_stop")
    .map((issue) => ({
      code: issue.code,
      section: issue.section,
      severity: issue.severity,
      gate_role: "hard_stop" as const,
      location_keys: issue.location_keys
    }));
  const reviewerCoveredBackstopFindings = lintFindings
    .filter((issue) => issue.gate_role === "backstop_only")
    .map((issue) => ({
      code: issue.code,
      section: issue.section,
      severity: issue.severity,
      gate_role: "backstop_only" as const,
      covered_by_review_issue_code: issue.covered_by_review_issue_code,
      location_keys: issue.location_keys
    }));
  return {
    generated_at: new Date().toISOString(),
    reason: input.decision.stop_or_continue_reason,
    decision_digest: input.decision.decision_digest,
    summary_lines: buildManuscriptQualityFailureSummaryLines({
      decision: input.decision,
      reviewReliability,
      reviewerMissedPolicyFindings,
      reviewerCoveredBackstopFindings
    }),
    triggered_by: input.decision.triggered_by,
    review_reliability: reviewReliability,
    final_issues: input.decision.issues_after || input.decision.issues_before,
    lint_findings: lintFindings,
    reviewer_missed_policy_findings: reviewerMissedPolicyFindings,
    reviewer_covered_backstop_findings: reviewerCoveredBackstopFindings
  };
}

function buildManuscriptQualityFailureSummaryLines(input: {
  decision: ManuscriptRepairDecision;
  reviewReliability: "grounded" | "partially_grounded" | "degraded";
  reviewerMissedPolicyFindings: ManuscriptQualityFailureArtifact["reviewer_missed_policy_findings"];
  reviewerCoveredBackstopFindings: ManuscriptQualityFailureArtifact["reviewer_covered_backstop_findings"];
}): string[] {
  const lines = [
    `Stop reason: ${input.decision.stop_or_continue_reason}`,
    `Review reliability: ${input.reviewReliability}.`
  ];
  if (input.reviewerMissedPolicyFindings.length > 0) {
    lines.push(
      `${input.reviewerMissedPolicyFindings.length} deterministic hard-stop finding(s) remained outside reviewer coverage.`
    );
  }
  if (input.reviewerCoveredBackstopFindings.length > 0) {
    lines.push(
      `${input.reviewerCoveredBackstopFindings.length} deterministic finding(s) remained as reviewer-covered backstops.`
    );
  }
  if (input.decision.triggered_by.length > 0) {
    lines.push(`Triggered by: ${input.decision.triggered_by.join(", ")}.`);
  }
  return lines;
}

async function writeRoundArtifact(
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"],
  basePath: string,
  roundIndex: number,
  payload: unknown
): Promise<void> {
  await writeRunArtifact(run, `${basePath}_round_${roundIndex}.json`, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeRoundTextArtifact(
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"],
  basePath: string,
  roundIndex: number,
  text: string
): Promise<void> {
  await writeRunArtifact(run, `${basePath}_round_${roundIndex}.raw.txt`, `${text}\n`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value.trim().length > 0))];
}

function dedupeCorpusRowsById<T extends { paper_id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!byId.has(row.paper_id)) {
      byId.set(row.paper_id, row);
    }
  }
  return [...byId.values()];
}

function sanitizeRiskCodeFragment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "item";
}

const CRITICAL_REPEAT_MANUSCRIPT_CODES = new Set([
  "rhetorical_overreach",
  "citation_hygiene",
  "appendix_hygiene",
  "appendix_internal_text",
  "appendix_meta_text",
  "appendix_raw_artifact_reference"
]);

function buildClaimEvidenceTableArtifact(
  evidenceMap: ReturnType<typeof buildPaperEvidenceMap>
): { generated_at: string; claims: ClaimEvidenceTableRow[] } {
  return {
    generated_at: new Date().toISOString(),
    claims: evidenceMap.claims.map((claim) => {
      const sourceType = classifyClaimEvidenceSourceType(claim.section_heading, claim.evidence_ids, claim.citation_paper_ids);
      const strength = classifyClaimStrength(claim.evidence_ids.length, claim.citation_paper_ids.length);
      return {
        claim_id: claim.claim_id,
        statement: claim.statement,
        section_heading: claim.section_heading,
        evidence_source_type: sourceType,
        artifact_refs: claim.evidence_ids,
        citation_refs: claim.citation_paper_ids,
        strength,
        ...(strength === "low"
          ? { downgrade_note: "Claim support is weak and should remain conservative." }
          : {})
      };
    })
  };
}

function buildClaimStatusTableArtifact(input: {
  evidenceMap: ReturnType<typeof buildPaperEvidenceMap>;
  traceability: PaperTraceabilityReport;
  verifiedRegistry: VerifiedRegistryArtifact;
}): ClaimStatusTableArtifact {
  const traceabilityByClaimId = new Map<string, PaperTraceabilityReport["paragraphs"]>();
  const registryByCitationPaperId = new Map(
    input.verifiedRegistry.entries.map((entry) => [entry.citation_paper_id, entry] as const)
  );
  for (const paragraph of input.traceability.paragraphs) {
    for (const claimId of paragraph.claim_ids || []) {
      const existing = traceabilityByClaimId.get(claimId) || [];
      existing.push(paragraph);
      traceabilityByClaimId.set(claimId, existing);
    }
  }

  const claims = input.evidenceMap.claims.map((claim) => {
    const traceEntries = traceabilityByClaimId.get(claim.claim_id) || [];
    const citationStatuses = claim.citation_paper_ids
      .map((citationPaperId) => registryByCitationPaperId.get(citationPaperId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({
        citation_paper_id: entry.citation_paper_id,
        resolved_paper_id: entry.resolved_paper_id,
        status: entry.status,
        repaired: entry.repaired
      }));
    const usableCitationSupport = citationStatuses.some((entry) => entry.status !== "blocked");
    const blockedCitationSupport = citationStatuses.filter((entry) => entry.status === "blocked");
    const weakCitationSupport = citationStatuses.filter(
      (entry) => entry.status === "unverified" || entry.status === "inferred"
    );
    const primarySourcePresent = usableCitationSupport || claim.evidence_ids.length > 0;
    const runArtifactPresent = claim.evidence_ids.length > 0;
    const reproductionTracePresent = traceEntries.length > 0;
    const notes: string[] = [];
    let status: ClaimEvidenceStatus;

    if (blockedCitationSupport.length > 0) {
      notes.push(
        `Blocked citation source(s): ${blockedCitationSupport.map((entry) => entry.citation_paper_id).join(", ")}.`
      );
    }
    if (weakCitationSupport.length > 0) {
      notes.push(
        `Weak citation source(s): ${weakCitationSupport
          .map((entry) => `${entry.citation_paper_id}:${entry.status}`)
          .join(", ")}.`
      );
    }

    if (primarySourcePresent && runArtifactPresent && reproductionTracePresent && blockedCitationSupport.length === 0) {
      status = "verified";
    } else if (primarySourcePresent && reproductionTracePresent && blockedCitationSupport.length === 0) {
      status = "inferred";
      notes.push("Primary source and traceability exist, but no run artifact is directly attached to this claim.");
    } else if (runArtifactPresent && reproductionTracePresent) {
      status = blockedCitationSupport.length > 0 ? "unverified" : "inferred";
      if (blockedCitationSupport.length > 0) {
        notes.push("Run artifacts support the claim, but one or more literature citations remain blocked.");
      }
    } else if (primarySourcePresent || runArtifactPresent || reproductionTracePresent) {
      status = "unverified";
      if (!primarySourcePresent) {
        notes.push("Primary source coverage is incomplete.");
      }
      if (!reproductionTracePresent) {
        notes.push("No traceability paragraph could be linked back to this claim.");
      }
    } else {
      status = "blocked";
      notes.push("The claim has neither traceability nor concrete source support.");
    }

    return {
      claim_id: claim.claim_id,
      statement: claim.statement,
      section_heading: claim.section_heading,
      status,
      primary_source_present: primarySourcePresent,
      run_artifact_present: runArtifactPresent,
      reproduction_trace_present: reproductionTracePresent,
      artifact_refs: claim.evidence_ids,
      citation_refs: claim.citation_paper_ids,
      claim_ids_in_trace: traceEntries.flatMap((entry) => entry.claim_ids || []).filter(Boolean),
      citation_statuses: citationStatuses,
      notes
    };
  });

  return {
    generated_at: new Date().toISOString(),
    counts: {
      verified: claims.filter((claim) => claim.status === "verified").length,
      unverified: claims.filter((claim) => claim.status === "unverified").length,
      blocked: claims.filter((claim) => claim.status === "blocked").length,
      inferred: claims.filter((claim) => claim.status === "inferred").length
    },
    claims
  };
}

function buildEvidenceGateDecisionArtifact(
  claimStatusTable: ClaimStatusTableArtifact
): EvidenceGateDecisionArtifact {
  const issues: EvidenceGateIssue[] = [];
  for (const claim of claimStatusTable.claims) {
    if (claim.status === "blocked") {
      issues.push({
        severity: "fail",
        code: "claim_evidence_blocked",
        claim_id: claim.claim_id,
        section_heading: claim.section_heading,
        message: `Claim ${claim.claim_id} in ${claim.section_heading} has no usable evidence/traceability support.`,
        fix_recommendation: "Link the claim to concrete evidence or remove/rewrite it before paper acceptance."
      });
      continue;
    }
    if (claim.status === "unverified") {
      issues.push({
        severity: "warning",
        code: "claim_evidence_unverified",
        claim_id: claim.claim_id,
        section_heading: claim.section_heading,
        message: `Claim ${claim.claim_id} in ${claim.section_heading} is only partially grounded.`,
        fix_recommendation: "Add the missing source or traceability link, or weaken the claim wording."
      });
      continue;
    }
    if (claim.status === "inferred") {
      issues.push({
        severity: "warning",
        code: "claim_evidence_inferred",
        claim_id: claim.claim_id,
        section_heading: claim.section_heading,
        message: `Claim ${claim.claim_id} in ${claim.section_heading} is inferential and should stay conservative.`,
        fix_recommendation: "Keep the rhetoric explicitly inferential or add direct run-artifact support."
      });
    }
  }

  const blockingIssueCount = issues.filter((issue) => issue.severity === "fail").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return {
    generated_at: new Date().toISOString(),
    status: blockingIssueCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass",
    blocking_issue_count: blockingIssueCount,
    warning_count: warningCount,
    issues,
    summary_lines:
      issues.length === 0
        ? ["All major claims remain grounded within the available evidence ceiling."]
        : [
            `Claim evidence statuses: verified=${claimStatusTable.counts.verified}, inferred=${claimStatusTable.counts.inferred}, unverified=${claimStatusTable.counts.unverified}, blocked=${claimStatusTable.counts.blocked}.`,
            ...issues.slice(0, 3).map((issue) => issue.message)
          ]
  };
}

function buildPaperReadinessArtifact(input: {
  manuscriptType: ManuscriptType;
  overallScore?: number;
  evidenceGateDecision: EvidenceGateDecisionArtifact;
  claimStatusTable: ClaimStatusTableArtifact;
  citationReport: CitationReport;
  scientificGateStatus: "pass" | "warn" | "fail";
  submissionValidationOk: boolean;
  manuscriptQualityAction: ManuscriptRepairDecision["action"];
}): PaperReadinessArtifact {
  const paperReady =
    input.manuscriptType === "paper_ready"
    && input.evidenceGateDecision.status !== "fail"
    && input.citationReport.status !== "fail"
    && input.scientificGateStatus !== "fail"
    && input.submissionValidationOk
    && input.manuscriptQualityAction !== "stop";
  const triggeredBy = [
    ...(input.evidenceGateDecision.status === "fail" ? ["evidence_gate"] : []),
    ...(input.citationReport.status === "fail" ? ["citation_check"] : []),
    ...(input.scientificGateStatus === "fail" ? ["scientific_validation"] : []),
    ...(!input.submissionValidationOk ? ["submission_validation"] : []),
    ...(input.manuscriptQualityAction === "stop" ? ["manuscript_quality"] : [])
  ];
  return {
    generated_at: new Date().toISOString(),
    paper_ready: paperReady,
    readiness_state: paperReady ? "paper_ready" : input.manuscriptType,
    overall_score: typeof input.overallScore === "number" ? input.overallScore : undefined,
    citation_check: input.citationReport.status,
    reason: paperReady
      ? "The manuscript passed manuscript-quality, evidence, scientific, and submission gates."
      : input.citationReport.status === "fail"
        ? "citation_gap"
      : input.evidenceGateDecision.status === "fail"
        ? "paper_ready is blocked because at least one major claim remained blocked at the evidence gate."
        : !input.submissionValidationOk
          ? "paper_ready is blocked because submission validation failed."
          : input.scientificGateStatus === "fail"
            ? "paper_ready is blocked because the scientific validation gate failed."
            : `paper_ready remains ${input.manuscriptType} after post-draft critique.`,
    triggered_by: triggeredBy,
    evidence_gate_status: input.evidenceGateDecision.status,
    scientific_validation_status: input.scientificGateStatus,
    submission_validation_ok: input.submissionValidationOk,
    manuscript_quality_action: input.manuscriptQualityAction,
    claim_status_counts: input.claimStatusTable.counts
  };
}

function buildPaperReadinessRiskArtifact(input: {
  manuscriptType: ManuscriptType;
  paperReadiness: PaperReadinessArtifact;
  verifiedRegistry: VerifiedRegistryArtifact;
  claimStatusTable: ClaimStatusTableArtifact;
  evidenceGateDecision: EvidenceGateDecisionArtifact;
  scientificGateStatus: "pass" | "warn" | "fail";
  submissionValidationOk: boolean;
  manuscriptQualityAction: ManuscriptRepairDecision["action"];
  config: NodeExecutionDeps["config"];
}): ReadinessRiskArtifact {
  const risks: ReadinessRisk[] = buildNetworkDependencyReadinessRisks({
    source: "paper",
    allowNetwork: input.config.experiments?.allow_network === true,
    networkPolicy: input.config.experiments?.network_policy,
    networkPurpose: input.config.experiments?.network_purpose,
    executionApprovalMode: input.config.workflow?.execution_approval_mode
  });

  for (const entry of input.verifiedRegistry.entries) {
    if (entry.status !== "blocked" && entry.status !== "unverified") {
      continue;
    }
    risks.push({
      risk_code: `citation_source_${entry.status}_${sanitizeRiskCodeFragment(entry.citation_paper_id)}`,
      severity: entry.status === "blocked" ? "blocked" : "warning",
      category: "citation_source",
      status: entry.status,
      message:
        entry.status === "blocked"
          ? `Citation source ${entry.citation_paper_id} remained unresolved after bounded verification.`
          : `Citation source ${entry.citation_paper_id} was repaired but remains below fully verified status.`,
      triggered_by: ["verified_registry", "evidence_gate"],
      affected_claim_ids: [],
      affected_citation_ids: [entry.citation_paper_id],
      recommended_action:
        entry.status === "blocked"
          ? "Provide a stable source row or remove the unsupported citation before claiming paper readiness."
          : "Keep the citation wording conservative or promote it to a fully verified source.",
      recheck_condition:
        entry.status === "blocked"
          ? "A direct corpus source or externally verified locator becomes available for this citation."
          : "The repaired citation is replaced with a direct corpus-backed or fully verified source."
    });
  }

  for (const claim of input.claimStatusTable.claims) {
    if (claim.status !== "blocked" && claim.status !== "unverified") {
      continue;
    }
    risks.push({
      risk_code: `claim_evidence_${claim.status}_${sanitizeRiskCodeFragment(claim.claim_id)}`,
      severity: claim.status === "blocked" ? "blocked" : "warning",
      category: "claim_evidence",
      status: claim.status,
      message:
        claim.status === "blocked"
          ? `Claim ${claim.claim_id} in ${claim.section_heading} lacks enough usable evidence or traceability for paper readiness.`
          : `Claim ${claim.claim_id} in ${claim.section_heading} remains only partially grounded.`,
      triggered_by: ["claim_status_table", "evidence_gate"],
      affected_claim_ids: [claim.claim_id],
      affected_citation_ids: claim.citation_refs,
      recommended_action:
        claim.status === "blocked"
          ? "Add concrete evidence and traceability, or remove/rewrite the claim."
          : "Add the missing source support or weaken the claim wording further.",
      recheck_condition:
        claim.status === "blocked"
          ? "The claim gains concrete evidence and traceability links."
          : "The claim is re-linked to verified evidence or downgraded enough to remove the grounding gap."
    });
  }

  if (input.scientificGateStatus === "fail") {
    risks.push({
      risk_code: "scientific_validation_fail",
      severity: "blocked",
      category: "scientific_validation",
      status: "blocked",
      message: "Scientific validation failed, so the manuscript cannot be treated as paper-ready.",
      triggered_by: ["scientific_validation"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: "Address the scientific validation failures before treating the manuscript as paper-scale.",
      recheck_condition: "Scientific validation returns pass or warn without blocking issues."
    });
  }

  if (!input.submissionValidationOk) {
    risks.push({
      risk_code: "submission_validation_fail",
      severity: "blocked",
      category: "submission_validation",
      status: "blocked",
      message: "Submission validation failed, so the paper bundle is not yet safe to hand off as paper-ready.",
      triggered_by: ["submission_validation"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: "Resolve the submission validation errors before final paper handoff.",
      recheck_condition: "Submission validation passes cleanly."
    });
  }

  if (input.manuscriptQualityAction === "stop") {
    risks.push({
      risk_code: "manuscript_quality_stop",
      severity: "blocked",
      category: "manuscript_quality",
      status: "blocked",
      message: "The manuscript-quality loop stopped before acceptance, so readiness remains blocked.",
      triggered_by: ["manuscript_quality"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: "Resolve the remaining manuscript-quality blockers or accept an honest downgrade.",
      recheck_condition: "The manuscript-quality gate passes without a stop decision."
    });
  }

  if (input.manuscriptType !== "paper_ready") {
    const blocked = input.manuscriptType === "blocked_for_paper_scale";
    risks.push({
      risk_code: `paper_scale_${sanitizeRiskCodeFragment(input.manuscriptType)}`,
      severity: blocked ? "blocked" : "warning",
      category: "paper_scale",
      status: blocked ? "blocked" : "unverified",
      message: blocked
        ? "The post-draft critique still classifies the run as blocked for paper scale."
        : `The post-draft critique still classifies the run as ${input.manuscriptType}, not paper_ready.`,
      triggered_by: ["paper_critique", ...input.paperReadiness.triggered_by],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: blocked
        ? "Backtrack or downgrade rather than presenting the current manuscript as paper-ready."
        : "Keep the manuscript explicitly downgraded until stronger evidence or critique outcomes are available.",
      recheck_condition: "The post-draft critique classifies the manuscript as paper_ready."
    });
  }

  return buildReadinessRiskArtifact({
    paperReady: input.paperReadiness.paper_ready,
    readinessState: input.paperReadiness.readiness_state,
    risks
  });
}

function buildFallbackPaperReadinessRiskArtifact(input: {
  preDraftCritique: PaperCritique | null;
  verifiedRegistry: VerifiedRegistryArtifact;
  claimStatusTable: ClaimStatusTableArtifact;
  evidenceGateDecision: EvidenceGateDecisionArtifact;
  citationReport?: CitationReport;
  scientificGateStatus: "pass" | "warn" | "fail";
  submissionValidationOk: boolean;
  manuscriptQualityAction: ManuscriptRepairDecision["action"];
  config: NodeExecutionDeps["config"];
}): ReadinessRiskArtifact {
  const manuscriptType = resolveFallbackReadinessState(input);
  const paperReadiness = buildPaperReadinessArtifact({
    manuscriptType,
    overallScore: input.preDraftCritique?.overall_score,
    evidenceGateDecision: input.evidenceGateDecision,
    claimStatusTable: input.claimStatusTable,
    citationReport: input.citationReport ?? {
      orphan_citations: [],
      unchecked_sources: [],
      status: "pass"
    },
    scientificGateStatus: input.scientificGateStatus,
    submissionValidationOk: input.submissionValidationOk,
    manuscriptQualityAction: input.manuscriptQualityAction
  });
  return buildPaperReadinessRiskArtifact({
    manuscriptType,
    paperReadiness,
    verifiedRegistry: input.verifiedRegistry,
    claimStatusTable: input.claimStatusTable,
    evidenceGateDecision: input.evidenceGateDecision,
    scientificGateStatus: input.scientificGateStatus,
    submissionValidationOk: input.submissionValidationOk,
    manuscriptQualityAction: input.manuscriptQualityAction,
    config: input.config
  });
}

function resolveFallbackReadinessState(input: {
  preDraftCritique: PaperCritique | null;
  evidenceGateDecision: EvidenceGateDecisionArtifact;
  scientificGateStatus: "pass" | "warn" | "fail";
  submissionValidationOk: boolean;
  manuscriptQualityAction: ManuscriptRepairDecision["action"];
}): ManuscriptType {
  const critiqueType = input.preDraftCritique?.manuscript_type;
  if (
    input.manuscriptQualityAction === "stop"
    || input.evidenceGateDecision.status === "fail"
    || input.scientificGateStatus === "fail"
    || !input.submissionValidationOk
  ) {
    if (critiqueType === "system_validation_note" || critiqueType === "research_memo") {
      return critiqueType;
    }
    return "blocked_for_paper_scale";
  }
  return critiqueType ?? "paper_scale_candidate";
}

function classifyClaimEvidenceSourceType(
  sectionHeading: string,
  evidenceIds: string[],
  citationPaperIds: string[]
): ClaimEvidenceTableRow["evidence_source_type"] {
  if (/limit/i.test(sectionHeading)) {
    return "limitation";
  }
  if (evidenceIds.length > 0) {
    return "experiment";
  }
  if (citationPaperIds.length > 0) {
    return "literature";
  }
  return "qualitative_observation";
}

function classifyClaimStrength(
  evidenceCount: number,
  citationCount: number
): ClaimEvidenceTableRow["strength"] {
  if (evidenceCount > 0 && citationCount > 0) {
    return "high";
  }
  if (evidenceCount > 0 || citationCount > 0) {
    return "medium";
  }
  return "low";
}

function buildManuscriptQualityFailureError(report: ManuscriptRepairDecision): string {
  return `write_paper generated manuscript artifacts but stopped before scientific/submission acceptance because the manuscript-quality gate failed: ${report.stop_or_continue_reason}`;
}

function buildEvidenceGateFailureError(report: EvidenceGateDecisionArtifact): string {
  const lead = report.issues[0]?.message || "claim evidence gate failed";
  return `write_paper generated manuscript artifacts but stopped before scientific/submission acceptance because the evidence gate failed: ${lead}`;
}

function buildSubmissionValidationError(
  report: {
    issues: Array<{ message: string; value?: string }>;
    unresolvedCitationPaperIds: string[];
  }
): string {
  const leadIssue = report.issues[0];
  const leadDetail = leadIssue
    ? `${leadIssue.message}${leadIssue.value ? ` (${leadIssue.value})` : ""}`
    : "submission validation failed";
  const unresolved =
    report.unresolvedCitationPaperIds.length > 0
      ? ` Unresolved citations: ${report.unresolvedCitationPaperIds.join(", ")}.`
      : "";
  return `write_paper generated manuscript artifacts but stopped before PDF build because submission-quality validation failed: ${leadDetail}.${unresolved}`;
}

function buildCompiledPdfPageValidationError(report: CompiledPdfPageValidationReport): string {
  const qualifier = report.validation_mode === "strict_paper" ? "strict-paper mode" : "default mode";
  return `write_paper generated PDF artifacts but stopped because compiled PDF page-budget validation failed in ${qualifier}: ${report.message}`;
}

function buildCompileFailureError(result: PaperCompileResult): string {
  const latestAttempt = [...result.attempts].reverse().find((item) => item.status === "failed");
  const detail = (result.repair_error || latestAttempt?.error || "unknown LaTeX compilation error").trim();
  const normalizedDetail = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  const buildLogHint = result.build_log_path ? ` See ${result.build_log_path}.` : "";
  return `write_paper generated LaTeX artifacts but the configured PDF build failed: ${normalizedDetail}${buildLogHint}`;
}

function buildScientificGateFailureError(report: {
  mode: "default" | "strict_paper";
  failure_reasons: string[];
  evidence_summary?: {
    thin_sections: string[];
    missing_evidence_categories: string[];
    blocked_by_evidence_insufficiency: boolean;
  };
}): string {
  const leadDetail = report.failure_reasons[0] || "scientific quality gate failed";
  const qualifier = report.mode === "strict_paper" ? "strict-paper mode" : "default mode";
  const evidenceDetail =
    report.evidence_summary?.blocked_by_evidence_insufficiency
      ? ` Evidence insufficiency remains in ${report.evidence_summary.thin_sections.join(", ") || "core sections"}; missing categories: ${report.evidence_summary.missing_evidence_categories.join(", ")}.`
      : "";
  return `write_paper generated manuscript artifacts but stopped before PDF build because the scientific quality gate failed in ${qualifier}: ${leadDetail}${evidenceDetail}`;
}

function resolvePaperValidationMode(value: unknown): "default" | "strict_paper" {
  return value === "strict_paper" ? "strict_paper" : "default";
}

export async function validateCompiledPdfPageBudget(input: {
  deps: NodeExecutionDeps;
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
  compileResult: PaperCompileResult;
  validationMode: "default" | "strict_paper";
  minimumMainPages: number;
  targetMainPages: number;
}): Promise<CompiledPdfPageValidationReport> {
  if (!input.compileResult.pdf_path) {
    return {
      checked: false,
      validation_mode: input.validationMode,
      status: "pass",
      outcome: "skipped",
      minimum_main_pages: input.minimumMainPages,
      target_main_pages: input.targetMainPages,
      main_page_limit: input.minimumMainPages,
      compiled_pdf_page_count: null,
      pdf_path: null,
      message: "Compiled PDF page-budget validation was skipped because no PDF artifact was produced."
    };
  }

  const runPaperDir = path.join(process.cwd(), ".autolabos", "runs", input.run.id, "paper");
  const observation = await input.deps.aci.runCommand("pdfinfo main.pdf", runPaperDir);
  const stdoutText = observation.stdout || "";
  const match = stdoutText.match(/^Pages:\s+(\d+)/mu);
  const parsedPageCount = match ? Number.parseInt(match[1], 10) : Number.NaN;
  if (observation.status !== "ok" || !Number.isFinite(parsedPageCount)) {
    return {
      checked: false,
      validation_mode: input.validationMode,
      status: input.validationMode === "strict_paper" ? "fail" : "warn",
      outcome: "measurement_unavailable",
      minimum_main_pages: input.minimumMainPages,
      target_main_pages: input.targetMainPages,
      main_page_limit: input.minimumMainPages,
      compiled_pdf_page_count: null,
      pdf_path: input.compileResult.pdf_path,
      message:
        "Compiled PDF page count could not be verified with pdfinfo, so minimum_main_pages compliance remains unverified."
    };
  }
  if (parsedPageCount < input.minimumMainPages) {
    return {
      checked: true,
      validation_mode: input.validationMode,
      status: input.validationMode === "strict_paper" ? "fail" : "warn",
      outcome: "under_limit",
      minimum_main_pages: input.minimumMainPages,
      target_main_pages: input.targetMainPages,
      main_page_limit: input.minimumMainPages,
      compiled_pdf_page_count: parsedPageCount,
      pdf_path: input.compileResult.pdf_path,
      message:
        `Compiled PDF is only ${parsedPageCount} page${parsedPageCount === 1 ? "" : "s"}, below the configured ` +
        `minimum_main_pages of ${input.minimumMainPages}.`
    };
  }
  return {
    checked: true,
    validation_mode: input.validationMode,
    status: "pass",
    outcome: "ok",
    minimum_main_pages: input.minimumMainPages,
    target_main_pages: input.targetMainPages,
    main_page_limit: input.minimumMainPages,
    compiled_pdf_page_count: parsedPageCount,
    pdf_path: input.compileResult.pdf_path,
    message:
      `Compiled PDF reached ${parsedPageCount} page${parsedPageCount === 1 ? "" : "s"}, meeting the configured ` +
      `minimum_main_pages of ${input.minimumMainPages}.`
  };
}

function isMissingBinaryObservation(obs: { stderr?: string; exit_code?: number }): boolean {
  const text = `${obs.stderr || ""}`.toLowerCase();
  return obs.exit_code === 127 || text.includes("not found") || text.includes("enoent");
}

function isPolicyBlockedObservation(obs: { exit_code?: number; stderr?: string }): boolean {
  return obs.exit_code === 126 && `${obs.stderr || ""}`.includes("Policy blocked");
}

function buildPostDraftTransitionRecommendation(
  critique: PaperCritique
): TransitionRecommendation | undefined {
  // If the critique says advance or repair_then_retry, no transition needed
  if (critique.overall_decision === "advance" || critique.overall_decision === "repair_then_retry") {
    return undefined;
  }

  const action = critiqueDecisionToTransitionAction(critique.overall_decision);
  const targetNode = critiqueDecisionToTargetNode(critique.overall_decision);
  const evidence = [
    `Manuscript type: ${critique.manuscript_type}`,
    `Blocking issues: ${critique.blocking_issues_count}`,
    critique.manuscript_claim_risk_summary
  ].filter(Boolean).slice(0, 4);

  return {
    action,
    sourceNode: "write_paper",
    targetNode,
    reason: `Post-draft critique: ${critique.manuscript_claim_risk_summary}`,
    confidence: critique.confidence,
    autoExecutable: true,
    evidence,
    suggestedCommands: [],
    generatedAt: new Date().toISOString()
  };
}

function evaluateWritePaperEligibility(input: {
  preDraftCritique: PaperCritique | null;
  briefEvidenceAssessment?: BriefEvidenceAssessment;
}): {
  generated_at: string;
  allowed: boolean;
  reason: string;
  manuscript_type?: ManuscriptType;
  brief_evidence_status?: BriefEvidenceAssessment["status"];
} {
  if (input.briefEvidenceAssessment?.enabled && input.briefEvidenceAssessment.status === "fail") {
    return {
      generated_at: new Date().toISOString(),
      allowed: false,
      reason: `write_paper blocked by brief evidence gate: ${input.briefEvidenceAssessment.summary}`,
      manuscript_type: input.preDraftCritique?.manuscript_type,
      brief_evidence_status: input.briefEvidenceAssessment.status
    };
  }

  const manuscriptType = input.preDraftCritique?.manuscript_type;
  const enforcePaperScaleFloor = input.briefEvidenceAssessment?.enabled === true;
  if (manuscriptType === "blocked_for_paper_scale") {
    return {
      generated_at: new Date().toISOString(),
      allowed: false,
      reason: "write_paper blocked because review classified this run as blocked_for_paper_scale.",
      manuscript_type: manuscriptType,
      brief_evidence_status: input.briefEvidenceAssessment?.status
    };
  }
  if (
    enforcePaperScaleFloor &&
    manuscriptType &&
    manuscriptType !== "paper_scale_candidate" &&
    manuscriptType !== "paper_ready"
  ) {
    return {
      generated_at: new Date().toISOString(),
      allowed: false,
      reason: `write_paper requires a pre-draft critique of at least paper_scale_candidate, but review classified this run as ${manuscriptType}.`,
      manuscript_type: manuscriptType,
      brief_evidence_status: input.briefEvidenceAssessment?.status
    };
  }

  return {
    generated_at: new Date().toISOString(),
    allowed: true,
    reason: manuscriptType
      ? `write_paper allowed: pre-draft critique classified the run as ${manuscriptType}.`
      : "write_paper allowed: no pre-draft critique was available, so no critique-based gate was applied.",
    manuscript_type: manuscriptType ?? undefined,
    brief_evidence_status: input.briefEvidenceAssessment?.status
  };
}

async function loadPreDraftCritique(runId: string): Promise<PaperCritique | null> {
  try {
    const raw = await safeRead(path.join(".autolabos", "runs", runId, "review", "paper_critique.json"));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PaperCritique;
    return parsed && parsed.stage === "pre_draft_review" ? parsed : null;
  } catch {
    return null;
  }
}
