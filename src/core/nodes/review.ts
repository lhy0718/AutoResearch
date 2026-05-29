import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { AnalysisConditionComparison, AnalysisReport } from "../resultAnalysis.js";
import { buildReviewPacket } from "../reviewPacket.js";
import {
  runReviewPanel,
  type ReviewArtifactPresence,
  type ReviewDecision,
  type ReviewFinding
} from "../reviewSystem.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
import {
  buildOperatorHistoryRelativePath,
  renderOperatorHistoryMarkdown,
  renderOperatorSummaryMarkdown
} from "../operatorSummary.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { TransitionRecommendation } from "../../types.js";
import {
  buildPreDraftCritique,
  critiqueDecisionToTransitionAction,
  critiqueDecisionToTargetNode,
  type PaperCritique
} from "../paperCritique.js";
import { loadAttemptDecisions } from "../experiments/attemptDecision.js";
import { loadExperimentContract } from "../experiments/experimentContract.js";
import { FailureMemory } from "../experiments/failureMemory.js";
import { evaluateMinimumGate } from "../analysis/paperMinimumGate.js";
import type { PaperScaleDiagnostic } from "../analysis/paperScaleDiagnostics.js";
import { runLLMPaperQualityEvaluation } from "../analysis/llmPaperQualityEvaluator.js";
import { checkReviewDecision } from "../analysis/reviewDecision.js";
import type { RiskSignal } from "../analysis/riskSignals.js";
import type { BriefEvidenceAssessment } from "../analysis/briefEvidenceValidator.js";
import type { FigureAuditSummary } from "../exploration/types.js";
import {
  buildNetworkDependencyReadinessRisks,
  buildReadinessRiskArtifact,
  type ReadinessRisk,
  type ReadinessRiskArtifact
} from "../readinessRisks.js";
import { buildRunOperatorStatus } from "../runs/runStatus.js";
import { buildRunCompletenessChecklist } from "../runs/runCompletenessChecklist.js";

export function createReviewNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "review",
    async execute({ run, abortSignal }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const report = await loadAnalysisReport(run.id, runContextMemory);
      if (!report) {
        return {
          status: "failure",
          error: "review requires a completed analyze_results artifact at result_analysis.json.",
          summary: "review requires analyze_results output before it can prepare a manual review packet.",
          toolCallsUsed: 1
        };
      }

      const runDir = path.join(".autolabos", "runs", run.id);
      const priorCompiledPageValidation = await loadPriorCompiledPageValidation(runDir);

      // --- Pre-review summary artifact (Target 6) ---
      const experimentContract = await loadExperimentContract(run.id);
      const attemptDecisions = await loadAttemptDecisions(run.id);
      const failMem = FailureMemory.forRun(run.id);
      const failureClusters = await failMem.failureClusters("run_experiments");
      const preReviewSummary = buildPreReviewSummary({
        report,
        experimentContract: experimentContract ?? undefined,
        attemptDecisions,
        failureClusters,
        objectiveMetric: run.objectiveMetric,
        priorCompiledPageValidation,
        retryCounters: run.graph.retryCounters,
        rollbackCounters: run.graph.rollbackCounters
      });
      await writeRunArtifact(
        run,
        "review/pre_review_summary.json",
        `${JSON.stringify(preReviewSummary, null, 2)}\n`
      );

      const presence = await resolveReviewArtifactPresence(runDir, report);
      const citationConsistencyArtifact = await safeReadJson(path.join(runDir, "paper", "citation_consistency.json")) as
        | { orphan_citations?: string[] }
        | undefined;
      const riskSignalsArtifact = await safeReadJson(path.join(runDir, "analysis", "risk_signals.json")) as
        | RiskSignal[]
        | undefined;
      const figureAuditSummary = await safeReadJson(path.join(runDir, "figure_audit", "figure_audit_summary.json")) as
        | FigureAuditSummary
        | undefined;
      const panel = await runReviewPanel({
        run,
        node: "review",
        report,
        presence,
        orphanCitations: Array.isArray(citationConsistencyArtifact?.orphan_citations)
          ? citationConsistencyArtifact.orphan_citations.filter((value): value is string => typeof value === "string")
          : [],
        riskSignals: Array.isArray(riskSignalsArtifact)
          ? riskSignalsArtifact.filter((value): value is RiskSignal => {
              if (!value || typeof value !== "object" || Array.isArray(value)) {
                return false;
              }
              const candidate = value as Partial<RiskSignal>;
              return (
                typeof candidate.type === "string"
                && (candidate.severity === "warn" || candidate.severity === "critical")
                && typeof candidate.detail === "string"
              );
            })
          : [],
        figureAuditSummary,
        llm: deps.llm,
        eventStream: deps.eventStream,
        abortSignal
      });
      const effectivePanel = applyFigureAuditDecisionGate(panel, figureAuditSummary);
      const packet = buildReviewPacket(report, presence, effectivePanel);
      const completionDecision = checkReviewDecision(packet);
      const briefEvidenceAssessment =
        (await runContextMemory.get<BriefEvidenceAssessment>("analyze_results.brief_evidence_assessment")) ?? undefined;
      const bibliographyText = [
        await safeRead(path.join(runDir, "bibtex.bib")),
        await safeRead(path.join(runDir, "paper", "references.bib"))
      ].filter(Boolean).join("\n");

      // --- Layer 1: Deterministic minimum gate ---
      const minimumGate = evaluateMinimumGate({
        presence,
        report,
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        briefEvidenceAssessment,
        evidenceLinksArtifact: await safeReadJson(path.join(runDir, "paper", "evidence_links.json")),
        claimEvidenceTableArtifact: await safeReadJson(path.join(runDir, "paper", "claim_evidence_table.json")),
        figureAuditSummaryArtifact: figureAuditSummary,
        bibliographyText
      });
      await writeRunArtifact(
        run,
        "review/minimum_gate.json",
        `${JSON.stringify(minimumGate, null, 2)}\n`
      );
      const paperScaleDiagnostics = {
        generated_at: minimumGate.evaluated_at,
        diagnostics: minimumGate.paper_scale_diagnostics ?? [],
        blocking_count: (minimumGate.paper_scale_diagnostics ?? []).filter((diagnostic) => diagnostic.severity === "blocking").length,
        warning_count: (minimumGate.paper_scale_diagnostics ?? []).filter((diagnostic) => diagnostic.severity === "warning").length
      };
      const nodeStrengtheningRecommendations = buildNodeStrengtheningRecommendations(
        minimumGate.paper_scale_diagnostics ?? [],
        effectivePanel.findings,
        effectivePanel.decision
      );
      const paperScaleDiagnosticsPath = await writeRunArtifact(
        run,
        "review/paper_scale_diagnostics.json",
        `${JSON.stringify(paperScaleDiagnostics, null, 2)}\n`
      );
      const nodeStrengtheningPath = await writeRunArtifact(
        run,
        "review/node_strengthening_recommendations.json",
        `${JSON.stringify(nodeStrengtheningRecommendations, null, 2)}\n`
      );

      // Build structured pre-draft critique artifact
      const preDraftCritique = buildPreDraftCritique({
        scorecard: effectivePanel.scorecard,
        decision: effectivePanel.decision,
        findings: effectivePanel.findings,
        presence,
        minimumGateCeiling: minimumGate.ceiling_type
      });

      // --- Layer 2: LLM paper-quality evaluation ---
      let llmEvalCost = 0;
      const hypothesis = run.graph.nodeStates.generate_hypotheses?.note || run.topic;
      const llmEvalResult = await runLLMPaperQualityEvaluation(
        {
          topic: run.topic,
          objectiveMetric: run.objectiveMetric,
          hypothesis,
          report,
          presence,
          minimumGate,
          reviewScorecard: panel.scorecard ? {
            overall_score_1_to_5: panel.scorecard.overall_score_1_to_5,
            dimensions: Object.fromEntries(
              (panel.scorecard.dimensions || []).map((d: { dimension: string; score_1_to_5: number }) => [d.dimension, d.score_1_to_5])
            )
          } : undefined
        },
        deps.llm,
        { abortSignal, timeoutMs: Number(process.env.AUTOLABOS_REVIEW_REFINEMENT_TIMEOUT_MS) || 30_000 }
      );
      llmEvalCost = llmEvalResult.costUsd ?? 0;
      await writeRunArtifact(
        run,
        "review/paper_quality_evaluation.json",
        `${JSON.stringify(llmEvalResult.evaluation, null, 2)}\n`
      );

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "review",
        payload: {
          text: `Paper quality evaluation: gate ${minimumGate.passed ? "PASSED" : "BLOCKED (" + minimumGate.ceiling_type + ")"}. LLM score: ${llmEvalResult.evaluation.overall_score_1_to_10}/10, worthiness: ${llmEvalResult.evaluation.paper_worthiness}, action: ${llmEvalResult.evaluation.recommended_action}.`
        }
      });

      // Use critique + minimum gate + LLM evaluation to build transition recommendation
      const transitionRecommendation = buildReviewTransitionRecommendation(
        effectivePanel,
        packet,
        preDraftCritique,
        minimumGate,
        llmEvalResult.evaluation,
        run.graph.researchCycle,
        briefEvidenceAssessment
      );
      const markdown = renderReviewChecklist(run, packet, effectivePanel);
      const readinessRisks = buildReviewReadinessRiskArtifact({
        critique: preDraftCritique,
        minimumGate,
        briefEvidenceAssessment,
        paperScaleDiagnostics: minimumGate.paper_scale_diagnostics ?? [],
        config: deps.config
      });

      const findingsPath = await writeRunArtifact(run, "review/findings.jsonl", renderJsonl(panel.findings));
      const scorecardPath = await writeRunArtifact(run, "review/scorecard.json", `${JSON.stringify(panel.scorecard, null, 2)}\n`);
      await writeRunArtifact(
        run,
        "review/consistency_report.json",
        `${JSON.stringify(panel.consistency, null, 2)}\n`
      );
      await writeRunArtifact(run, "review/bias_report.json", `${JSON.stringify(panel.bias, null, 2)}\n`);
      await writeRunArtifact(
        run,
        "review/revision_plan.json",
        `${JSON.stringify(effectivePanel.revision_plan, null, 2)}\n`
      );
      const decisionArtifact = {
        ...effectivePanel.decision,
        figure_audit_block_required: figureAuditSummary?.review_block_required === true,
        figure_audit_severe_count: figureAuditSummary?.severe_mismatch_count ?? 0
      };
      const decisionPath = await writeRunArtifact(run, "review/decision.json", `${JSON.stringify(decisionArtifact, null, 2)}\n`);
      const critiquePath = await writeRunArtifact(
        run,
        "review/paper_critique.json",
        `${JSON.stringify(preDraftCritique, null, 2)}\n`
      );
      const readinessRiskPath = await writeRunArtifact(
        run,
        "review/readiness_risks.json",
        `${JSON.stringify(readinessRisks, null, 2)}\n`
      );
      const operatorSummaryInput = {
        runId: run.id,
        title: run.title,
        stage: "review" as const,
        summary: [
          packet.objective_summary,
          `Review readiness: ${packet.readiness.status}.`,
          `Panel scorecard: ${effectivePanel.scorecard.overall_score_1_to_5}/5 overall across ${effectivePanel.reviewers.length} reviewer(s).`,
          `Paper quality: ${llmEvalResult.evaluation.overall_score_1_to_10}/10 (${llmEvalResult.evaluation.paper_worthiness}).`
        ],
        decision: `${effectivePanel.decision.outcome}${effectivePanel.decision.recommended_transition ? ` -> ${effectivePanel.decision.recommended_transition}` : ""}. ${effectivePanel.decision.summary}`,
        blockers: [
          ...preDraftCritique.blocking_issues.slice(0, 3).map((issue) => issue.summary),
          ...readinessRisks.risks.filter((risk) => risk.severity === "blocked").slice(0, 2).map((risk) => risk.message)
        ],
        openQuestions: [
          `Review completion verdict: ${completionDecision.verdict}.`,
          ...effectivePanel.decision.required_actions.slice(0, 2),
          ...llmEvalResult.evaluation.weaknesses.slice(0, 2)
        ].slice(0, 3),
        nextActions: packet.suggested_actions.slice(0, 3),
        references: [
          { label: "Review packet", path: "review/review_packet.json" },
          { label: "Review scorecard", path: "review/scorecard.json" },
          { label: "Paper critique", path: "review/paper_critique.json" },
          { label: "Review decision", path: "review/decision.json" },
          { label: "Minimum gate", path: "review/minimum_gate.json" },
          { label: "Paper-scale diagnostics", path: "review/paper_scale_diagnostics.json" },
          { label: "Node strengthening", path: "review/node_strengthening_recommendations.json" },
          { label: "Readiness risks", path: "review/readiness_risks.json" },
          { label: "Figure audit summary", path: "figure_audit/figure_audit_summary.json" }
        ]
      };
      const operatorSummaryPath = await writeRunArtifact(
        run,
        "operator_summary.md",
        renderOperatorSummaryMarkdown(operatorSummaryInput)
      );
      const operatorHistoryPath = await writeRunArtifact(
        run,
        buildOperatorHistoryRelativePath("review"),
        renderOperatorHistoryMarkdown(operatorSummaryInput)
      );
      const reviewPacketPath = await writeRunArtifact(run, "review/review_packet.json", `${JSON.stringify(packet, null, 2)}\n`);
      const checklistPath = await writeRunArtifact(run, "review/checklist.md", markdown);
      const runStatus = await buildRunOperatorStatus({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "review",
        lifecycleStatus: "needs_approval",
        approvalMode: deps.config?.workflow?.approval_mode || "minimal",
        networkPolicy: deps.config?.experiments?.network_policy,
        networkPurpose: deps.config?.experiments?.network_purpose
      });
      const runStatusPath = await writeRunArtifact(
        run,
        "run_status.json",
        `${JSON.stringify(runStatus, null, 2)}\n`
      );
      const publicOutputs = await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "review",
        runContext: runContextMemory,
        section: "review",
        files: [
          {
            sourcePath: path.join(runDir, "review", "pre_review_summary.json"),
            targetRelativePath: "pre_review_summary.json"
          },
          {
            sourcePath: reviewPacketPath,
            targetRelativePath: "review_packet.json"
          },
          {
            sourcePath: scorecardPath,
            targetRelativePath: "scorecard.json"
          },
          {
            sourcePath: checklistPath,
            targetRelativePath: "checklist.md"
          },
          {
            sourcePath: decisionPath,
            targetRelativePath: "decision.json"
          },
          {
            sourcePath: findingsPath,
            targetRelativePath: "findings.jsonl"
          },
          {
            sourcePath: critiquePath,
            targetRelativePath: "paper_critique.json"
          },
          {
            sourcePath: readinessRiskPath,
            targetRelativePath: "readiness_risks.json"
          },
          {
            sourcePath: paperScaleDiagnosticsPath,
            targetRelativePath: "paper_scale_diagnostics.json"
          },
          {
            sourcePath: nodeStrengtheningPath,
            targetRelativePath: "node_strengthening_recommendations.json"
          }
        ]
      });
      await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "review",
        section: "results",
        files: [
          {
            sourcePath: operatorSummaryPath,
            targetRelativePath: "operator_summary.md"
          },
          {
            sourcePath: operatorHistoryPath,
            targetRelativePath: buildOperatorHistoryRelativePath("review")
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
        currentNode: "review"
      });
      const completenessChecklistPath = await writeRunArtifact(
        run,
        "run_completeness_checklist.json",
        `${JSON.stringify(completenessChecklist, null, 2)}\n`
      );
      await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        node: "review",
        section: "results",
        files: [
          {
            sourcePath: completenessChecklistPath,
            targetRelativePath: "run_completeness_checklist.json"
          }
        ]
      });
      await runContextMemory.put("review.packet", packet);
      await runContextMemory.put("review.last_summary", packet.objective_summary);
      await runContextMemory.put("review.last_recommendation", packet.recommendation || null);
      await runContextMemory.put("review.last_decision", decisionArtifact);
      await runContextMemory.put("review.completion_decision", completionDecision);
      await runContextMemory.put("review.last_findings_count", panel.findings.length);
      await runContextMemory.put("review.last_panel_agreement", panel.consistency.panel_agreement);
      await runContextMemory.put("review.paper_critique", preDraftCritique);
      await runContextMemory.put("review.manuscript_type", preDraftCritique.manuscript_type);
      await runContextMemory.put("review.minimum_gate", minimumGate);
      await runContextMemory.put("review.paper_quality_evaluation", llmEvalResult.evaluation);
      await runContextMemory.put("review.readiness_risks", readinessRisks);
      await runContextMemory.put("review.paper_scale_diagnostics", paperScaleDiagnostics);
      await runContextMemory.put("review.node_strengthening_recommendations", nodeStrengtheningRecommendations);

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "review",
        payload: {
          text: `Review panel completed with ${effectivePanel.reviewers.length} specialist reviewer(s), ${effectivePanel.findings.length} finding(s), outcome ${effectivePanel.decision.outcome}, and completion verdict ${completionDecision.verdict}. Manuscript type: ${preDraftCritique.manuscript_type}.`
        }
      });
      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "review",
        payload: {
          text: `Public review outputs are available at ${publicOutputs.sectionDirRelative}.`
        }
      });

      const blockers = packet.readiness.blocking_checks;
      const warnings = packet.readiness.warning_checks;
      const manual = packet.readiness.manual_checks;
      const toolCallsUsed = Math.max(1, effectivePanel.llm_calls_used + (llmEvalResult.llmUsed ? 1 : 0));
      const costUsd = (effectivePanel.llm_cost_usd ?? 0) + llmEvalCost;
      const inputTokens = (effectivePanel.llm_input_tokens ?? 0) + (llmEvalResult.usage?.inputTokens ?? 0);
      const outputTokens = (effectivePanel.llm_output_tokens ?? 0) + (llmEvalResult.usage?.outputTokens ?? 0);
      const critiqueLabel = preDraftCritique.manuscript_type !== "paper_ready"
        ? ` Manuscript classified as ${preDraftCritique.manuscript_type}.`
        : " Manuscript classified as paper_ready.";
      return {
        status: "success",
        summary:
          completionDecision.verdict === "reject" || blockers > 0
            ? `Review panel prepared ${panel.findings.length} finding(s) with ${blockers} blocking issue(s), ${warnings} warning(s), and ${manual} manual review item(s). Completion verdict: reject. The runtime will take the conservative backtrack recommended by review before paper drafting.${critiqueLabel} Public outputs: ${publicOutputs.outputRootRelative}.`
            : completionDecision.verdict === "revise" || warnings > 0 || manual > 0
              ? `Review panel prepared ${panel.findings.length} finding(s) with ${warnings} warning(s) and ${manual} manual review item(s). Completion verdict: revise. The next stage will carry the attached revision checklist or follow the recommended backtrack automatically.${critiqueLabel} Public outputs: ${publicOutputs.outputRootRelative}.`
              : `Review panel completed with outcome ${effectivePanel.decision.outcome} and completion verdict accept.${critiqueLabel} The runtime can continue automatically from the review recommendation. Public outputs: ${publicOutputs.outputRootRelative}.`,
        needsApproval: true,
        approvalSignal: {
          source: "review",
          overall_score: llmEvalResult.evaluation.overall_score_1_to_10,
          specialist_scores: effectivePanel.reviewers.map((reviewer) => reviewer.score_1_to_5),
          summary: `${llmEvalResult.evaluation.overall_score_1_to_10}/10 overall with ${effectivePanel.reviewers.length} specialist reviewer(s).`
        },
        toolCallsUsed,
        costUsd,
        usage: {
          toolCalls: toolCallsUsed,
          costUsd,
          inputTokens,
          outputTokens
        },
        transitionRecommendation
      };
    }
  };
}

function buildReviewReadinessRiskArtifact(input: {
  critique: PaperCritique;
  minimumGate: ReturnType<typeof evaluateMinimumGate>;
  briefEvidenceAssessment?: BriefEvidenceAssessment;
  paperScaleDiagnostics?: PaperScaleDiagnostic[];
  config: NodeExecutionDeps["config"];
}): ReadinessRiskArtifact {
  const risks: ReadinessRisk[] = buildNetworkDependencyReadinessRisks({
    source: "review",
    networkPolicy: input.config.experiments?.network_policy,
    networkPurpose: input.config.experiments?.network_purpose,
    executionApprovalMode: input.config.workflow?.execution_approval_mode
  });
  const claimEvidenceCheck = input.minimumGate.checks.find((check) => check.id === "claim_evidence_linkage");
  if (claimEvidenceCheck && !claimEvidenceCheck.passed) {
    risks.push({
      risk_code: "review_claim_evidence_gap",
      severity: input.minimumGate.ceiling_type === "blocked_for_paper_scale" ? "blocked" : "warning",
      category: "claim_evidence",
      status: input.minimumGate.ceiling_type === "blocked_for_paper_scale" ? "blocked" : "unverified",
      message: claimEvidenceCheck.detail,
      triggered_by: ["minimum_gate"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: "Strengthen claim-to-evidence linkage before advancing this run toward paper readiness.",
      recheck_condition: "The review minimum gate passes the claim-to-evidence linkage check."
    });
  }

  if (!input.minimumGate.passed) {
    const blocked =
      input.minimumGate.ceiling_type === "blocked_for_paper_scale"
      || input.minimumGate.ceiling_type === "system_validation_note";
    risks.push({
      risk_code: `review_minimum_gate_${input.minimumGate.ceiling_type}`,
      severity: blocked ? "blocked" : "warning",
      category: "paper_scale",
      status: blocked ? "blocked" : "unverified",
      message: input.minimumGate.summary,
      triggered_by: ["minimum_gate"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: blocked
        ? "Backtrack to recover the missing evidence floor instead of treating the run as paper-scale."
        : "Treat the run as downgraded until the missing minimum-gate checks are repaired.",
      recheck_condition: "The review minimum gate passes without any failed checks."
    });
  }

  if (input.briefEvidenceAssessment?.enabled && input.briefEvidenceAssessment.status !== "not_applicable") {
    if (input.briefEvidenceAssessment.status === "fail" || input.briefEvidenceAssessment.status === "warn") {
      const blocked = input.briefEvidenceAssessment.status === "fail";
      risks.push({
        risk_code: `brief_evidence_${input.briefEvidenceAssessment.status}`,
        severity: blocked ? "blocked" : "warning",
        category: "paper_scale",
        status: blocked ? "blocked" : "unverified",
        message: input.briefEvidenceAssessment.summary,
        triggered_by: ["brief_evidence_assessment"],
        affected_claim_ids: [],
        affected_citation_ids: [],
        recommended_action: blocked
          ? "Repair the brief-governed evidence floor before allowing progression to paper drafting."
          : "Keep the run explicitly downgraded until the brief evidence warnings are cleared or accepted.",
        recheck_condition: "The brief evidence assessment returns pass without outstanding failures."
      });
    }
  }

  for (const diagnostic of input.paperScaleDiagnostics ?? []) {
    risks.push({
      risk_code: `review_paper_scale_${diagnostic.id}`,
      severity: diagnostic.severity === "blocking" ? "blocked" : "warning",
      category:
        diagnostic.category === "related_work_depth"
          ? "claim_evidence"
          : diagnostic.category === "resource_claim"
            ? "paper_scale"
            : "paper_scale",
      status: diagnostic.severity === "blocking" ? "blocked" : "unverified",
      message: diagnostic.summary,
      triggered_by: ["paper_scale_diagnostics", diagnostic.source_node],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: diagnostic.recommended_action,
      recheck_condition: diagnostic.recheck_condition
    });
  }

  if (input.critique.manuscript_type !== "paper_ready") {
    const blocked =
      input.critique.manuscript_type === "blocked_for_paper_scale"
      || input.critique.manuscript_type === "system_validation_note";
    risks.push({
      risk_code: `review_paper_scale_${input.critique.manuscript_type}`,
      severity: blocked ? "blocked" : "warning",
      category: "paper_scale",
      status: blocked ? "blocked" : "unverified",
      message: blocked
        ? `Pre-draft critique classified the run as ${input.critique.manuscript_type}.`
        : `Pre-draft critique classified the run as ${input.critique.manuscript_type}, not paper_ready.`,
      triggered_by: ["paper_critique"],
      affected_claim_ids: [],
      affected_citation_ids: [],
      recommended_action: blocked
        ? "Backtrack or downgrade instead of drifting into write_paper as if the run were paper-ready."
        : "Keep the output explicitly downgraded until stronger evidence upgrades the critique outcome.",
      recheck_condition: "The pre-draft critique upgrades the run to paper_ready."
    });
  }

  const paperReady = input.critique.manuscript_type === "paper_ready" && risks.every((risk) => risk.severity !== "blocked");
  return buildReadinessRiskArtifact({
    paperReady,
    readinessState: paperReady ? "paper_ready" : input.critique.manuscript_type,
    risks
  });
}

interface NodeStrengtheningRecommendation {
  node: string;
  priority: "high" | "medium";
  diagnostic_ids: string[];
  problem_summary: string;
  recommended_prompt_focus: string;
  recheck_condition: string;
}

export function buildNodeStrengtheningRecommendations(
  diagnostics: PaperScaleDiagnostic[],
  findings: ReviewFinding[] = [],
  decision?: ReviewDecision
): {
  generated_at: string;
  recommendations: NodeStrengtheningRecommendation[];
} {
  type RecommendationSignal = {
    id: string;
    severity: "blocking" | "warning";
    summary: string;
    target_node: string;
    source_node: string;
    recommended_action: string;
    recheck_condition: string;
  };

  const signals: RecommendationSignal[] = diagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    severity: diagnostic.severity,
    summary: diagnostic.summary,
    target_node: diagnostic.target_node || diagnostic.source_node,
    source_node: diagnostic.source_node,
    recommended_action: diagnostic.recommended_action,
    recheck_condition: diagnostic.recheck_condition
  }));

  for (const finding of findings) {
    if (finding.severity === "low") {
      continue;
    }
    signals.push({
      id: `finding:${finding.id}`,
      severity: finding.severity === "high" ? "blocking" : "warning",
      summary: `${finding.title}: ${finding.detail}`,
      target_node: targetNodeForReviewFinding(finding),
      source_node: "review",
      recommended_action: finding.fix_hint || "Repair the reviewed weakness before attempting paper drafting.",
      recheck_condition: recheckConditionForReviewFinding(finding)
    });
  }

  const byTarget = new Map<string, RecommendationSignal[]>();
  for (const signal of signals) {
    const target = signal.target_node || signal.source_node;
    byTarget.set(target, [...(byTarget.get(target) ?? []), signal]);
  }

  if (decision && decision.outcome !== "advance" && decision.required_actions.length > 0) {
    const target = decision.recommended_transition === "backtrack_to_hypotheses"
      ? "generate_hypotheses"
      : decision.recommended_transition === "backtrack_to_design"
        ? "design_experiments"
        : decision.recommended_transition === "backtrack_to_implement"
          ? "implement_experiments"
          : "review";
    byTarget.set(target, [
      ...(byTarget.get(target) ?? []),
      {
        id: `decision:${decision.outcome}`,
        severity: decision.blocking_finding_ids.length > 0 ? "blocking" : "warning",
        summary: `${decision.summary} Required actions: ${decision.required_actions.join(" ")}`,
        target_node: target,
        source_node: "review",
        recommended_action: decision.required_actions.join(" "),
        recheck_condition: "The review decision advances without unresolved required actions or blocking findings."
      }
    ]);
  }

  for (const diagnostic of diagnostics) {
    const target = diagnostic.target_node || diagnostic.source_node;
    byTarget.set(target, byTarget.get(target) ?? []);
  }

  const recommendations = Array.from(byTarget.entries()).map(([node, nodeSignals]) => {
    const blocking = nodeSignals.some((signal) => signal.severity === "blocking");
    const summaries = nodeSignals.map((signal) => signal.summary);
    return {
      node,
      priority: blocking ? "high" as const : "medium" as const,
      diagnostic_ids: nodeSignals.map((signal) => signal.id),
      problem_summary: summaries.join(" "),
      recommended_prompt_focus: buildPromptFocus(node, diagnostics, findings),
      recheck_condition: nodeSignals.map((signal) => signal.recheck_condition).join(" ")
    };
  });

  return {
    generated_at: new Date().toISOString(),
    recommendations
  };
}

function targetNodeForReviewFinding(finding: ReviewFinding): string {
  const text = `${finding.id} ${finding.dimension} ${finding.title} ${finding.detail} ${finding.fix_hint ?? ""}`.toLowerCase();
  if (text.includes("claim") && (text.includes("outpace") || text.includes("objective") || text.includes("success"))) {
    return "generate_hypotheses";
  }
  if (text.includes("confidence interval") || text.includes("primary comparison") || text.includes("comparison")) {
    return "analyze_results";
  }
  if (text.includes("seed") || text.includes("evaluation scope") || text.includes("method scope") || text.includes("single-run")) {
    return "design_experiments";
  }
  if (text.includes("train") || text.includes("budget") || text.includes("optimizer")) {
    return "implement_experiments";
  }
  if (text.includes("execute") || text.includes("rerun") || text.includes("run confirmatory")) {
    return "run_experiments";
  }
  switch (finding.dimension) {
    case "statistics":
      return "analyze_results";
    case "methodology":
      return "design_experiments";
    case "claim_verification":
      return "generate_hypotheses";
    case "writing_readiness":
      return "write_paper";
    case "integrity":
      return "review";
  }
}

function recheckConditionForReviewFinding(finding: ReviewFinding): string {
  if (finding.dimension === "statistics") {
    return "Review no longer reports missing confidence intervals, primary comparisons, or statistical support gaps.";
  }
  if (finding.dimension === "methodology") {
    return "Review no longer reports narrow methodology, single-run coverage, or missing confirmatory variants.";
  }
  if (finding.dimension === "claim_verification") {
    return "Review no longer reports claims that outpace measured outcomes or missing primary comparisons.";
  }
  return "The same review finding no longer appears in the review panel output.";
}

function buildPromptFocus(
  node: string,
  diagnostics: PaperScaleDiagnostic[],
  findings: ReviewFinding[] = []
): string {
  const ids = new Set(diagnostics.map((diagnostic) => diagnostic.id));
  const findingText = findings.map((finding) => `${finding.id} ${finding.title} ${finding.detail} ${finding.fix_hint ?? ""}`).join(" ").toLowerCase();
  if (node === "collect_papers" || ids.has("canonical_method_references_missing")) {
    return "Require canonical-method coverage for the topic before downstream hypothesis/design work; when a topic centers on a named method family, include the original method sources.";
  }
  if (node === "generate_hypotheses" && findingText.includes("claims outpace")) {
    return "When objective metrics are not met, force the hypothesis and claim set to downgrade or reformulate; do not preserve success or interaction framing that the evidence did not support.";
  }
  if (node === "design_experiments") {
    return "Force the design to declare sample-size, seed, baseline/comparator, and interaction-test requirements before implementation.";
  }
  if (node === "implement_experiments") {
    return "Implement enough train/eval budget and artifact fields to distinguish smoke validation from tuning evidence.";
  }
  if (node === "run_experiments") {
    return "Execute the planned sample/seed floor and persist per-task counts, per-seed rows, raw correct totals, and failure visibility.";
  }
  if (node === "analyze_results") {
    return "Translate raw counts into evidence-ceiling judgments, including one-example gains, confidence granularity, and unsupported resource claims.";
  }
  if (node === "write_paper") {
    return "Keep manuscript drafting under the review-approved claim ceiling and omit template-absent or unsupported paper-surface elements.";
  }
  return "Strengthen the node prompt so generated artifacts surface the diagnostic as a blocker or downgrade condition.";
}

function buildReviewTransitionRecommendation(
  panel: Awaited<ReturnType<typeof runReviewPanel>>,
  packet: ReturnType<typeof buildReviewPacket>,
  critique: PaperCritique,
  minimumGate?: ReturnType<typeof evaluateMinimumGate>,
  llmEval?: { recommended_action: string; paper_worthiness: string; overall_score_1_to_10: number },
  researchCycle?: number,
  briefEvidenceAssessment?: BriefEvidenceAssessment
): TransitionRecommendation | undefined {
  const action = panel.decision.outcome;
  const confidence = Number(panel.decision.confidence.toFixed(2));
  const evidence = [
    panel.decision.summary,
    ...panel.findings.slice(0, 3).map((finding) => finding.title)
  ].filter((value, index, items) => Boolean(value) && items.indexOf(value) === index);

  // Layer 1: If deterministic minimum gate blocks and the panel recommends advance,
  // override to backtrack. The gate is a hard safety boundary.
  if (
    minimumGate &&
    !minimumGate.passed &&
    (minimumGate.ceiling_type === "blocked_for_paper_scale" || minimumGate.ceiling_type === "system_validation_note")
  ) {
    const gateBlockers = minimumGate.blockers.join(", ");
    return createReviewTransition({
      action: "backtrack_to_design",
      targetNode: "design_experiments",
      reason: `Minimum evidence gate blocked (${minimumGate.ceiling_type}): missing ${gateBlockers}. Cannot advance to paper drafting.`,
      confidence: 0.9,
      autoExecutable: true,
      evidence: [
        `Gate ceiling: ${minimumGate.ceiling_type}`,
        `Blockers: ${gateBlockers}`,
        ...evidence.slice(0, 2)
      ],
      suggestedCommands: packet.suggested_actions
    });
  }

  if (briefEvidenceAssessment?.enabled && briefEvidenceAssessment.status === "fail") {
    return createReviewTransition({
      action: "backtrack_to_design",
      targetNode: "design_experiments",
      reason: `Brief evidence gate failed: ${briefEvidenceAssessment.summary}`,
      confidence: 0.92,
      autoExecutable: true,
      evidence: [
        `Brief ceiling: ${briefEvidenceAssessment.ceiling_type}`,
        ...briefEvidenceAssessment.failures.slice(0, 2),
        ...evidence.slice(0, 2)
      ],
      suggestedCommands: packet.suggested_actions
    });
  }

  // Layer 2: If LLM evaluator recommends backtrack and panel says advance,
  // respect LLM judgment (but don't override deterministic gate passes)
  if (
    llmEval &&
    action === "advance" &&
    (llmEval.recommended_action === "backtrack_to_experiments" ||
     llmEval.recommended_action === "backtrack_to_design" ||
     llmEval.recommended_action === "backtrack_to_hypotheses") &&
    llmEval.paper_worthiness === "not_ready"
  ) {
    const targetNode = llmEval.recommended_action === "backtrack_to_hypotheses"
      ? "generate_hypotheses" as const
      : llmEval.recommended_action === "backtrack_to_design"
        ? "design_experiments" as const
        : "implement_experiments" as const;
    return createReviewTransition({
      action: llmEval.recommended_action as TransitionRecommendation["action"],
      targetNode,
      reason: `LLM paper-quality evaluator recommends ${llmEval.recommended_action} (score: ${llmEval.overall_score_1_to_10}/10, worthiness: ${llmEval.paper_worthiness}).`,
      confidence: Math.min(confidence, 0.7),
      autoExecutable: true,
      evidence: [
        `LLM score: ${llmEval.overall_score_1_to_10}/10`,
        `Worthiness: ${llmEval.paper_worthiness}`,
        ...evidence.slice(0, 2)
      ],
      suggestedCommands: packet.suggested_actions
    });
  }

  // If the critique found the manuscript is blocked_for_paper_scale or system_validation_note
  // with blocking issues, override the panel decision with a backtrack.
  // But enforce a cycle cap: after 2 backtrack cycles, if the minimum gate passed
  // and the panel recommends advance, stop backtracking to avoid infinite loops.
  const currentCycle = researchCycle || 0;
  const hardBlockedManuscriptType =
    critique.manuscript_type === "blocked_for_paper_scale" ||
    critique.manuscript_type === "system_validation_note";
  const cycleCappedAdvance =
    currentCycle >= 2 &&
    minimumGate?.passed &&
    action === "advance" &&
    !hardBlockedManuscriptType;
  if (
    !cycleCappedAdvance &&
    critique.overall_decision !== "advance" &&
    critique.overall_decision !== "repair_then_retry" &&
    (critique.manuscript_type === "blocked_for_paper_scale" ||
      critique.manuscript_type === "system_validation_note" ||
      critique.manuscript_type === "research_memo")
  ) {
    const critiqueAction = critiqueDecisionToTransitionAction(critique.overall_decision);
    const critiqueTarget = critiqueDecisionToTargetNode(critique.overall_decision);
    return createReviewTransition({
      action: critiqueAction,
      targetNode: critiqueTarget,
      reason: `Pre-draft critique classified manuscript as ${critique.manuscript_type}: ${critique.manuscript_claim_risk_summary}`,
      confidence: Math.min(confidence, critique.confidence),
      autoExecutable: true,
      evidence: [
        `Manuscript type: ${critique.manuscript_type}`,
        `Blocking issues: ${critique.blocking_issues_count}`,
        ...evidence.slice(0, 2)
      ],
      suggestedCommands: packet.suggested_actions
    });
  }

  if (action === "advance" && critique.manuscript_type !== "paper_ready") {
    return createReviewTransition({
      action: "advance",
      targetNode: "write_paper",
      reason: `Pre-draft critique classified manuscript as ${critique.manuscript_type} with ${critique.blocking_issues_count} paper-readiness blocker(s); advancing only to draft under that downgraded claim ceiling, not as paper_ready.`,
      confidence: Math.min(confidence, critique.confidence),
      autoExecutable: true,
      evidence: [
        `Manuscript type: ${critique.manuscript_type}`,
        `Paper-readiness blockers: ${critique.blocking_issues_count}`,
        ...critique.blocking_issues.slice(0, 2).map((issue) => issue.summary),
        ...evidence.slice(0, 1)
      ],
      suggestedCommands: packet.suggested_actions
    });
  }

  if (action === "advance") {
    return createReviewTransition({
      action: "advance",
      targetNode: "write_paper",
      reason: panel.decision.summary,
      confidence,
      autoExecutable: true,
      evidence,
      suggestedCommands: packet.suggested_actions
    });
  }

  if (action === "backtrack_to_hypotheses") {
    return createReviewTransition({
      action: "backtrack_to_hypotheses",
      targetNode: "generate_hypotheses",
      reason: panel.decision.summary,
      confidence,
      autoExecutable: true,
      evidence,
      suggestedCommands: packet.suggested_actions
    });
  }

  if (action === "backtrack_to_design") {
    return createReviewTransition({
      action: "backtrack_to_design",
      targetNode: "design_experiments",
      reason: panel.decision.summary,
      confidence,
      autoExecutable: true,
      evidence,
      suggestedCommands: packet.suggested_actions
    });
  }

  if (action === "backtrack_to_implement") {
    return createReviewTransition({
      action: "backtrack_to_implement",
      targetNode: "implement_experiments",
      reason: panel.decision.summary,
      confidence,
      autoExecutable: true,
      evidence,
      suggestedCommands: packet.suggested_actions
    });
  }

  return createReviewTransition({
    action: "advance",
    targetNode: "write_paper",
    reason: `${panel.decision.summary} Carry the review checklist into paper drafting and keep the revisions conservative.`,
    confidence,
    autoExecutable: true,
    evidence,
    suggestedCommands: packet.suggested_actions
  });
}

function createReviewTransition(input: {
  action: TransitionRecommendation["action"];
  reason: string;
  confidence: number;
  autoExecutable: boolean;
  evidence: string[];
  suggestedCommands: string[];
  targetNode?: TransitionRecommendation["targetNode"];
}): TransitionRecommendation {
  return {
    action: input.action,
    sourceNode: "review",
    targetNode: input.targetNode,
    reason: input.reason,
    confidence: input.confidence,
    autoExecutable: input.autoExecutable,
    evidence: input.evidence.slice(0, 4),
    suggestedCommands: input.suggestedCommands.slice(0, 4),
    generatedAt: new Date().toISOString()
  };
}

async function resolveReviewArtifactPresence(
  runDir: string,
  report: AnalysisReport
): Promise<ReviewArtifactPresence> {
  const baselineSummaryRaw = await safeRead(path.join(runDir, "baseline_summary.json"));
  const resultTableRaw = await safeRead(path.join(runDir, "result_table.json"));
  const richnessRaw = await safeRead(path.join(runDir, "analyze_papers_richness_summary.json"));

  let richnessReadiness: ReviewArtifactPresence["richnessReadiness"] = "unknown";
  if (richnessRaw) {
    try {
      const richness = JSON.parse(richnessRaw);
      richnessReadiness = richness.readiness ?? "unknown";
    } catch {
      richnessReadiness = "unknown";
    }
  }

  return {
        corpusPresent: Boolean(await safeRead(path.join(runDir, "corpus.jsonl"))),
        paperSummariesPresent: Boolean(await safeRead(path.join(runDir, "paper_summaries.jsonl"))),
        evidenceStorePresent: Boolean(await safeRead(path.join(runDir, "evidence_store.jsonl"))),
        hypothesesPresent: Boolean(await safeRead(path.join(runDir, "hypotheses.jsonl"))),
        experimentPlanPresent: Boolean(await safeRead(path.join(runDir, "experiment_plan.yaml"))),
        metricsPresent: Boolean(await safeRead(path.join(runDir, "metrics.json"))),
        figurePresent: Boolean(await safeRead(path.join(runDir, "figures", "performance.svg"))),
        synthesisPresent:
          Boolean(report.synthesis?.discussion_points?.length) ||
          Boolean(await safeRead(path.join(runDir, "result_analysis_synthesis.json"))),
        baselineSummaryPresent: Boolean(baselineSummaryRaw),
        resultTablePresent: Boolean(resultTableRaw),
        richnessSummaryPresent: Boolean(richnessRaw),
        richnessReadiness
  };
}

async function loadAnalysisReport(
  runId: string,
  runContextMemory: RunContextMemory
): Promise<AnalysisReport | undefined> {
  const cached = await runContextMemory.get<AnalysisReport>("analyze_results.last_summary");
  if (cached) {
    return cached;
  }

  const raw = await safeRead(path.join(".autolabos", "runs", runId, "result_analysis.json"));
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as AnalysisReport;
  } catch {
    return undefined;
  }
}

async function safeReadJson(filePath: string): Promise<unknown | undefined> {
  const raw = await safeRead(filePath);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function applyFigureAuditDecisionGate(
  panel: Awaited<ReturnType<typeof runReviewPanel>>,
  figureAuditSummary?: FigureAuditSummary
): Awaited<ReturnType<typeof runReviewPanel>> {
  if (!figureAuditSummary?.review_block_required || panel.decision.outcome !== "advance") {
    return panel;
  }

  return {
    ...panel,
    decision: {
      ...panel.decision,
      outcome: "revise_in_place",
      summary: `${panel.decision.summary} Figure audit reported ${figureAuditSummary.severe_mismatch_count} severe mismatch(es), so review acceptance is downgraded to revise.`,
      rationale: `${panel.decision.rationale} Figure audit requires revision before the manuscript can be treated as publication-ready.`,
      required_actions: [
        ...panel.decision.required_actions,
        "Repair severe figure/caption/reference mismatches flagged by figure_audit before final paper promotion."
      ].filter((value, index, items) => Boolean(value) && items.indexOf(value) === index)
    }
  };
}

function renderReviewChecklist(
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"],
  packet: ReturnType<typeof buildReviewPacket>,
  panel: Awaited<ReturnType<typeof runReviewPanel>>
): string {
  const lines = [
    "# Review checklist",
    "",
    `Run: ${run.id}`,
    `Title: ${run.title}`,
    `Generated: ${packet.generated_at}`,
    "",
    `Readiness: ${packet.readiness.status} (${packet.readiness.ready_checks} ready, ${packet.readiness.warning_checks} warning, ${packet.readiness.blocking_checks} blocking, ${packet.readiness.manual_checks} manual)`,
    "",
    `Decision: ${panel.decision.outcome}${panel.decision.recommended_transition ? ` -> ${panel.decision.recommended_transition}` : ""} (${Math.round(panel.decision.confidence * 100)}%)`,
    panel.decision.summary,
    "",
    `Consensus: ${panel.consistency.panel_agreement}`,
    panel.consistency.summary,
    "",
    `Objective: ${packet.objective_status}`,
    packet.objective_summary,
    ""
  ];

  if (packet.recommendation) {
    lines.push(
      `Recommendation: ${packet.recommendation.action}${packet.recommendation.target ? ` -> ${packet.recommendation.target}` : ""} (${packet.recommendation.confidence_pct}%)`
    );
    lines.push(packet.recommendation.reason);
    if (packet.recommendation.evidence.length > 0) {
      lines.push("");
      lines.push("Evidence:");
      for (const item of packet.recommendation.evidence) {
        lines.push(`- ${item}`);
      }
    }
    lines.push("");
  }

  lines.push("Checklist:");
  for (const item of packet.checks) {
    lines.push(`- [ ] ${item.label} (${item.status}): ${item.detail}`);
  }

  if (panel.reviewers.length > 0) {
    lines.push("");
    lines.push("Specialist panel:");
    for (const reviewer of panel.reviewers) {
      lines.push(
        `- ${reviewer.reviewer_label}: score ${reviewer.score_1_to_5}/5, ${reviewer.recommendation}, ${reviewer.summary}`
      );
    }
  }

  if (panel.findings.length > 0) {
    lines.push("");
    lines.push("Top findings:");
    for (const finding of panel.findings.slice(0, 6)) {
      lines.push(`- [${finding.severity}] ${finding.reviewer_label}: ${finding.title} - ${finding.detail}`);
    }
  }

  if (panel.revision_plan.items.length > 0) {
    lines.push("");
    lines.push("Revision plan:");
    for (const item of panel.revision_plan.items.slice(0, 6)) {
      lines.push(`- (${item.priority}) ${item.owner}: ${item.action}`);
    }
  }

  lines.push("");
  lines.push("Suggested actions:");
  for (const action of packet.suggested_actions) {
    lines.push(`- ${action}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function renderJsonl(items: unknown[]): string {
  if (items.length === 0) {
    return "";
  }
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Pre-review summary (Target 6)
// ---------------------------------------------------------------------------

interface ClaimCeilingDetail {
  strongest_defensible_claim: string;
  blocked_stronger_claims: Array<{ claim: string; reason: string }>;
  additional_evidence_needed: string[];
}

interface PreReviewSummary {
  generated_at: string;
  objective_metric: string;
  baseline: string;
  attempts: number;
  best_attempt: string;
  discarded_attempts: string[];
  failure_clusters: Array<{ fingerprint: string; count: number }>;
  remaining_uncertainty: string[];
  claim_ceiling: string;
  claim_ceiling_detail: ClaimCeilingDetail;
  experiment_contract?: {
    hypothesis: string;
    single_change: string;
    confounded: boolean;
    expected_metric_effect: string;
    abort_condition: string;
    keep_or_discard_rule: string;
  };
  prior_compiled_page_validation?: {
    status: string;
    outcome: string;
    minimum_main_pages: number | null;
    target_main_pages: number | null;
    main_page_limit: number | null;
    compiled_pdf_page_count: number | null;
    message: string;
  };
  retry_counters: Record<string, number>;
  rollback_counters: Record<string, number>;
}

function buildPreReviewSummary(input: {
  report: AnalysisReport;
  experimentContract?: import("../experiments/experimentContract.js").ExperimentContract;
  attemptDecisions: import("../experiments/attemptDecision.js").AttemptDecision[];
  failureClusters: Array<[string, number]>;
  objectiveMetric: string;
  priorCompiledPageValidation?: {
    status: string;
    outcome: string;
    minimum_main_pages: number | null;
    target_main_pages: number | null;
    main_page_limit: number | null;
    compiled_pdf_page_count: number | null;
    message: string;
  };
  retryCounters: Record<string, number>;
  rollbackCounters: Record<string, number>;
}): PreReviewSummary {
  const { report, experimentContract, attemptDecisions, failureClusters, objectiveMetric } = input;

  const keptDecisions = attemptDecisions.filter((d) => d.verdict === "keep");
  const discardedDecisions = attemptDecisions.filter((d) => d.verdict === "discard");
  const bestAttempt = keptDecisions.length > 0
    ? `Attempt ${keptDecisions[keptDecisions.length - 1].attempt} (${keptDecisions[keptDecisions.length - 1].verdict})`
    : "No kept attempts";

  const baselines = extractPreReviewBaselineLabels(report);

  const uncertainties: string[] = [];
  if (report.overview?.objective_status === "unknown") {
    uncertainties.push("Objective metric status is unknown.");
  }
  if ((report.failure_taxonomy ?? []).length > 0) {
    uncertainties.push(
      `Failure categories detected: ${(report.failure_taxonomy ?? []).map((f) => f.category).join(", ")}.`
    );
  }
  if (attemptDecisions.some((d) => d.verdict === "needs_replication")) {
    uncertainties.push("At least one attempt needs replication to confirm.");
  }

  const objectiveStatus = report.overview?.objective_status;
  const isConfounded = experimentContract?.confounded ?? false;
  const hasBaseline = baselines.length > 0;
  const hasReplication = attemptDecisions.some((d) => d.verdict === "needs_replication");
  const hasMultipleKept = keptDecisions.length >= 2;

  const claimCeiling = objectiveStatus === "met"
    ? isConfounded
      ? "Confounded experiment: claims limited to correlation, not causation."
      : "Objective met; claims can reference metric improvement over baseline."
    : objectiveStatus === "not_met"
      ? "Objective not met; claims must be limited to negative or null result."
      : "Objective unknown; claims must be heavily qualified.";

  // --- Claim ceiling detail (Target 5) ---
  const claimCeilingDetail = buildClaimCeilingDetail({
    objectiveStatus,
    isConfounded,
    hasBaseline,
    hasReplication,
    hasMultipleKept,
    failureClusters,
    uncertainties,
    objectiveMetric
  });

  return {
    generated_at: new Date().toISOString(),
    objective_metric: objectiveMetric,
    baseline: baselines.length > 0 ? baselines.join(", ") : "(no explicit baseline identified)",
    attempts: attemptDecisions.length || 1,
    best_attempt: bestAttempt,
    discarded_attempts: discardedDecisions.map(
      (d) => `Attempt ${d.attempt}: ${d.discard_reason || d.rationale}`
    ),
    failure_clusters: failureClusters.map(([fp, count]) => ({ fingerprint: fp, count })),
    remaining_uncertainty: uncertainties,
    claim_ceiling: claimCeiling,
    claim_ceiling_detail: claimCeilingDetail,
    experiment_contract: experimentContract
      ? {
          hypothesis: experimentContract.hypothesis,
          single_change: experimentContract.single_change,
          confounded: experimentContract.confounded,
          expected_metric_effect: experimentContract.expected_metric_effect,
          abort_condition: experimentContract.abort_condition,
          keep_or_discard_rule: experimentContract.keep_or_discard_rule
        }
      : undefined,
    prior_compiled_page_validation: input.priorCompiledPageValidation,
    retry_counters: Object.fromEntries(
      Object.entries(input.retryCounters).filter(([, v]) => v !== undefined)
    ) as Record<string, number>,
    rollback_counters: Object.fromEntries(
      Object.entries(input.rollbackCounters).filter(([, v]) => v !== undefined)
    ) as Record<string, number>
  };
}

async function loadPriorCompiledPageValidation(runDir: string): Promise<PreReviewSummary["prior_compiled_page_validation"] | undefined> {
  try {
    const raw = await safeRead(path.join(runDir, "paper", "compiled_page_validation.json"));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as {
      status?: unknown;
      outcome?: unknown;
      minimum_main_pages?: unknown;
      target_main_pages?: unknown;
      main_page_limit?: unknown;
      compiled_pdf_page_count?: unknown;
      message?: unknown;
    };
    if (typeof parsed.status !== "string" || typeof parsed.outcome !== "string" || typeof parsed.message !== "string") {
      return undefined;
    }
    return {
      status: parsed.status,
      outcome: parsed.outcome,
      minimum_main_pages:
        typeof parsed.minimum_main_pages === "number"
          ? parsed.minimum_main_pages
          : typeof parsed.main_page_limit === "number"
            ? parsed.main_page_limit
            : null,
      target_main_pages:
        typeof parsed.target_main_pages === "number"
          ? parsed.target_main_pages
          : typeof parsed.main_page_limit === "number"
            ? parsed.main_page_limit
            : null,
      main_page_limit: typeof parsed.main_page_limit === "number" ? parsed.main_page_limit : null,
      compiled_pdf_page_count: typeof parsed.compiled_pdf_page_count === "number" ? parsed.compiled_pdf_page_count : null,
      message: parsed.message
    };
  } catch {
    return undefined;
  }
}

function extractPreReviewBaselineLabels(report: AnalysisReport): string[] {
  const labels = new Set<string>();

  for (const comparison of report.condition_comparisons ?? []) {
    if (comparison.label.toLowerCase().includes("baseline")) {
      labels.add(comparison.label);
    }
  }

  const metrics = asRecord(report.metrics);
  const currentBestBaseline = asRecord(metrics.current_best_baseline);
  const comparisonContract = asRecord(metrics.comparison_contract);
  const baselineBinding = asRecord(comparisonContract.baseline_binding);
  const selectedDesignBaselines = report.plan_context?.selected_design?.baselines ?? [];

  addBaselineLabel(labels, currentBestBaseline.arm_name);
  addBaselineLabel(labels, baselineBinding.source_arm_name);
  for (const baseline of selectedDesignBaselines) {
    addBaselineLabel(labels, baseline);
  }

  return Array.from(labels);
}

function addBaselineLabel(labels: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  labels.add(trimmed);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function buildClaimCeilingDetail(input: {
  objectiveStatus?: string;
  isConfounded: boolean;
  hasBaseline: boolean;
  hasReplication: boolean;
  hasMultipleKept: boolean;
  failureClusters: Array<[string, number]>;
  uncertainties: string[];
  objectiveMetric: string;
}): ClaimCeilingDetail {
  const { objectiveStatus, isConfounded, hasBaseline, hasReplication, hasMultipleKept, failureClusters, objectiveMetric } = input;

  let strongestClaim: string;
  const blocked: Array<{ claim: string; reason: string }> = [];
  const evidenceNeeded: string[] = [];

  if (objectiveStatus === "met" && hasBaseline && !isConfounded) {
    strongestClaim = `${objectiveMetric} improved over explicit baseline under controlled single-change conditions.`;
    if (!hasMultipleKept) {
      blocked.push({
        claim: "Robust improvement across multiple attempts",
        reason: "Only one kept attempt — single data point insufficient for robustness claim."
      });
      evidenceNeeded.push("Additional successful attempt to strengthen robustness.");
    }
    if (hasReplication) {
      blocked.push({
        claim: "Confirmed improvement",
        reason: "At least one attempt flagged as needs_replication."
      });
      evidenceNeeded.push("Replication attempt with consistent results.");
    }
  } else if (objectiveStatus === "met" && isConfounded) {
    strongestClaim = `${objectiveMetric} improved, but experiment was confounded — correlation only.`;
    blocked.push({
      claim: "Causal improvement from the proposed change",
      reason: "Multiple changes confounded; cannot isolate the independent variable."
    });
    evidenceNeeded.push("Repeat experiment with single isolated change.");
  } else if (objectiveStatus === "met" && !hasBaseline) {
    strongestClaim = `${objectiveMetric} reached target level, but no explicit baseline comparison.`;
    blocked.push({
      claim: "Improvement over prior work",
      reason: "No baseline identified; improvement direction is unverifiable."
    });
    evidenceNeeded.push("Add explicit baseline for comparison.");
  } else if (objectiveStatus === "not_met") {
    strongestClaim = `Negative or null result: ${objectiveMetric} did not improve.`;
    blocked.push({
      claim: "Any positive improvement claim",
      reason: "Objective metric was not met."
    });
    evidenceNeeded.push("Redesign experiment or revise hypothesis if pursuing positive result.");
  } else {
    strongestClaim = `Inconclusive: ${objectiveMetric} status unknown — claims must be heavily qualified.`;
    blocked.push({
      claim: "Any definitive claim about metric direction",
      reason: "Objective status is unknown or not evaluated."
    });
    evidenceNeeded.push("Complete analysis to determine objective status.");
  }

  if (failureClusters.length > 0) {
    const totalFailures = failureClusters.reduce((sum, [, c]) => sum + c, 0);
    if (totalFailures >= 3) {
      blocked.push({
        claim: "Reliable execution",
        reason: `${totalFailures} failures across ${failureClusters.length} pattern(s) during execution.`
      });
      evidenceNeeded.push("Address failure patterns before claiming reliable execution.");
    }
  }

  return {
    strongest_defensible_claim: strongestClaim,
    blocked_stronger_claims: blocked,
    additional_evidence_needed: evidenceNeeded
  };
}
