import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
import { TransitionRecommendation } from "../../types.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
import { ensureDir, fileExists } from "../../utils/fs.js";
import { buildPublicAnalysisDir, buildPublicPaperDir } from "../publicArtifacts.js";
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
  buildFallbackPaperManuscript,
  buildPaperSubmissionValidation,
  buildPaperTraceability,
  renderSubmissionPaperTex
} from "../analysis/paperManuscript.js";
import {
  applyScientificWritingPolicy,
  buildScientificValidationArtifact,
  buildWritePaperGateDecision,
  materializeScientificManuscript
} from "../analysis/scientificWriting.js";
import { PaperWriterSessionManager } from "../agents/paperWriterSessionManager.js";
import { maybeEnrichRelatedWorkScout } from "../writePaperRelatedWorkEnrichment.js";
import { maybeRunRelatedWorkScout } from "../writePaperRelatedWorkScout.js";
import {
  buildPostDraftCritique,
  critiqueDecisionToTransitionAction,
  critiqueDecisionToTargetNode,
  resolveVenueStyle,
  getVenueProfile,
  type PaperCritique
} from "../paperCritique.js";

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

interface PaperInputValidationIssue {
  artifact: string;
  path: string;
  reason: string;
}

interface PaperInputValidationReport {
  ok: boolean;
  issues: PaperInputValidationIssue[];
}

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

      const constraintProfile = await resolveConstraintProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "write_paper"
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
      const paperProfile = deps.config.paper_profile;
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
      const bibtex = buildPaperBibtex(bundle.corpus, citedPaperIds);
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
      const gateDecision = buildWritePaperGateDecision({
        mode: validationMode,
        scientificValidation: scientificValidationArtifact,
        consistencyLint: scientificManuscript.consistency_lint,
        appendixLint: scientificManuscript.appendix_lint
      });
      const manuscript = scientificManuscript.manuscript;
      const traceability = buildPaperTraceability({
        draft: paperDraft,
        manuscript
      });
      const tex = renderSubmissionPaperTex({
        manuscript,
        traceability,
        citationKeysByPaperId: bibtex.citationKeysByPaperId,
        template: deps.config?.paper?.template
      });
      const evidenceMap = JSON.stringify(buildPaperEvidenceMap(paperDraft), null, 2);
      const traceabilityJson = `${JSON.stringify(traceability, null, 2)}\n`;
      const manuscriptJson = `${JSON.stringify(manuscript, null, 2)}\n`;
      const provenanceMapJson = `${JSON.stringify(scientificManuscript.provenance_map, null, 2)}\n`;
      const submissionValidation = buildPaperSubmissionValidation({
        manuscript,
        tex,
        traceability,
        citationKeysByPaperId: bibtex.citationKeysByPaperId,
        unresolvedCitationPaperIds: bibtex.unresolvedPaperIds
      });

      await writeRunArtifact(run, "paper/main.tex", tex);
      await writeRunArtifact(run, "paper/references.bib", bibtex.references);
      await writeRunArtifact(run, "paper/evidence_links.json", evidenceMap);
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
            manuscript: scientificManuscript.consistency_lint,
            appendix: scientificManuscript.appendix_lint
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
      await fs.writeFile(path.join(publicPaperDir, "gate_decision.json"), `${JSON.stringify(gateDecision, null, 2)}\n`, "utf8");

      const preCompileToolCallsUsed = Math.max(1, 4 - sessionResult.stageFallbacks) + (validationRepair.attempted ? 1 : 0);
      await runContextMemory.put("write_paper.public_dir", publicPaperDir);
      await runContextMemory.put("write_paper.source", sessionResult.source);
      await runContextMemory.put("write_paper.section_count", paperDraft.sections.length);
      await runContextMemory.put("write_paper.cited_paper_ids", bibtex.usedPaperIds);
      await runContextMemory.put("write_paper.last_draft", paperDraft);
      await runContextMemory.put("write_paper.last_manuscript", manuscript);
      await runContextMemory.put("write_paper.traceability", traceability);
      await runContextMemory.put("write_paper.provenance_map", scientificManuscript.provenance_map);
      await runContextMemory.put("write_paper.validation", validation);
      await runContextMemory.put("write_paper.consistency_lint", {
        manuscript: scientificManuscript.consistency_lint,
        appendix: scientificManuscript.appendix_lint
      });
      await runContextMemory.put("write_paper.gate_decision", gateDecision);
      await runContextMemory.put("write_paper.submission_validation", submissionValidation);
      await runContextMemory.put("write_paper.validation_repair", validationRepair);
      if (gateDecision.status === "warn") {
        emitLog(`Scientific quality gate warnings (${validationMode} mode): ${gateDecision.summary.slice(1).join(" ")}`);
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
      const venueStyle = resolveVenueStyle(deps.config.paper_profile?.target_venue_style);
      const preDraftCritiqueRaw = await loadPreDraftCritique(run.id);
      const postDraftCritique = buildPostDraftCritique({
        venueStyle,
        preDraftCritique: preDraftCritiqueRaw,
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
      await runContextMemory.put("write_paper.paper_critique", postDraftCritique);
      await runContextMemory.put("write_paper.manuscript_type", postDraftCritique.manuscript_type);
      await runContextMemory.put("write_paper.target_venue_style", postDraftCritique.target_venue_style);
      emitLog(
        `Post-draft critique: manuscript_type=${postDraftCritique.manuscript_type}, ` +
        `decision=${postDraftCritique.overall_decision}, ` +
        `blocking=${postDraftCritique.blocking_issues_count}, ` +
        `venue=${postDraftCritique.target_venue_style}.`
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
            sourcePath: path.join(runPaperDir, "main.pdf"),
            targetRelativePath: "main.pdf",
            optional: true
          },
          {
            sourcePath: path.join(runPaperDir, "build.log"),
            targetRelativePath: "build.log",
            optional: true
          }
        ]
      });
      emitLog(`Public paper outputs are available at ${publicOutputs.sectionDirRelative}.`);
      const toolCallsUsed = preCompileToolCallsUsed + compileResult.toolCallsUsed;
      await runContextMemory.put("write_paper.compile_status", compileResult.status);
      await runContextMemory.put("write_paper.compile_report", compileResult);
      await runContextMemory.put("write_paper.pdf_path", compileResult.pdf_path || null);
      if (compileResult.status === "failed") {
        const compileError = buildCompileFailureError(compileResult);
        emitLog(compileError);
        await runContextMemory.put("write_paper.last_error", compileError);
        return {
          status: "failure",
          error: compileError,
          summary: compileError,
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
            ? `Paper draft generated in LaTeX using staged fallbacks. Validation warnings: ${validation.issues.length}${describeValidationRepair(validationRepair)}. Scientific gate: ${describeScientificGateStatus(gateDecision)}. Manuscript: ${postDraftCritique.manuscript_type} (venue: ${postDraftCritique.target_venue_style}). PDF: ${describeCompileStatus(compileResult)}. Public outputs: ${publicOutputs.outputRootRelative}.`
            : `Paper draft generated in LaTeX from ${paperDraft.sections.length} structured section(s) via ${sessionResult.source} with ${validation.issues.length} validation warning(s)${describeValidationRepair(validationRepair)}. Scientific gate: ${describeScientificGateStatus(gateDecision)}. Manuscript: ${postDraftCritique.manuscript_type} (venue: ${postDraftCritique.target_venue_style}). PDF: ${describeCompileStatus(compileResult)}. Public outputs: ${publicOutputs.outputRootRelative}.`,
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
