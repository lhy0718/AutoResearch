import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { AnalysisConditionComparison, AnalysisReport } from "../resultAnalysis.js";
import { buildReviewPacket } from "../reviewPacket.js";
import { ReviewArtifactPresence, runReviewPanel } from "../reviewSystem.js";
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
  resolveVenueStyle,
  type PaperCritique
} from "../paperCritique.js";
import { loadAttemptDecisions } from "../experiments/attemptDecision.js";
import { loadExperimentContract } from "../experiments/experimentContract.js";
import { FailureMemory } from "../experiments/failureMemory.js";
import { evaluateMinimumGate } from "../analysis/paperMinimumGate.js";
import { runLLMPaperQualityEvaluation } from "../analysis/llmPaperQualityEvaluator.js";
import type { BriefEvidenceAssessment } from "../analysis/briefEvidenceValidator.js";
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
      const panel = await runReviewPanel({
        run,
        node: "review",
        report,
        presence,
        llm: deps.llm,
        eventStream: deps.eventStream,
        abortSignal
      });
      const packet = buildReviewPacket(report, presence, panel);
      const briefEvidenceAssessment =
        (await runContextMemory.get<BriefEvidenceAssessment>("analyze_results.brief_evidence_assessment")) ?? undefined;

      // --- Layer 1: Deterministic minimum gate ---
      const minimumGate = evaluateMinimumGate({
        presence,
        report,
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        briefEvidenceAssessment,
        evidenceLinksArtifact: await safeReadJson(path.join(runDir, "paper", "evidence_links.json")),
        claimEvidenceTableArtifact: await safeReadJson(path.join(runDir, "paper", "claim_evidence_table.json"))
      });
      await writeRunArtifact(
        run,
        "review/minimum_gate.json",
        `${JSON.stringify(minimumGate, null, 2)}\n`
      );

      // Build structured pre-draft critique artifact
      const venueStyle = resolveVenueStyle(deps.config.paper_profile?.target_venue_style);
      const preDraftCritique = buildPreDraftCritique({
        venueStyle,
        scorecard: panel.scorecard,
        decision: panel.decision,
        findings: panel.findings,
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
        panel,
        packet,
        preDraftCritique,
        minimumGate,
        llmEvalResult.evaluation,
        run.graph.researchCycle,
        briefEvidenceAssessment
      );
      const markdown = renderReviewChecklist(run, packet, panel);
      const readinessRisks = buildReviewReadinessRiskArtifact({
        critique: preDraftCritique,
        minimumGate,
        briefEvidenceAssessment,
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
        `${JSON.stringify(panel.revision_plan, null, 2)}\n`
      );
      const decisionPath = await writeRunArtifact(run, "review/decision.json", `${JSON.stringify(panel.decision, null, 2)}\n`);
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
          `Panel scorecard: ${panel.scorecard.overall_score_1_to_5}/5 overall across ${panel.reviewers.length} reviewer(s).`,
          `Paper quality: ${llmEvalResult.evaluation.overall_score_1_to_10}/10 (${llmEvalResult.evaluation.paper_worthiness}).`
        ],
        decision: `${panel.decision.outcome}${panel.decision.recommended_transition ? ` -> ${panel.decision.recommended_transition}` : ""}. ${panel.decision.summary}`,
        blockers: [
          ...preDraftCritique.blocking_issues.slice(0, 3).map((issue) => issue.summary),
          ...readinessRisks.risks.filter((risk) => risk.severity === "blocked").slice(0, 2).map((risk) => risk.message)
        ],
        openQuestions: [
          ...panel.decision.required_actions.slice(0, 2),
          ...llmEvalResult.evaluation.weaknesses.slice(0, 2)
        ].slice(0, 3),
        nextActions: packet.suggested_actions.slice(0, 3),
        references: [
          { label: "Review packet", path: "review/review_packet.json" },
          { label: "Review scorecard", path: "review/scorecard.json" },
          { label: "Paper critique", path: "review/paper_critique.json" },
          { label: "Review decision", path: "review/decision.json" },
          { label: "Minimum gate", path: "review/minimum_gate.json" },
          { label: "Readiness risks", path: "review/readiness_risks.json" }
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
        approvalMode: deps.config?.workflow?.approval_mode === "manual" ? "manual" : "minimal",
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
      await runContextMemory.put("review.last_decision", panel.decision);
      await runContextMemory.put("review.last_findings_count", panel.findings.length);
      await runContextMemory.put("review.last_panel_agreement", panel.consistency.panel_agreement);
      await runContextMemory.put("review.paper_critique", preDraftCritique);
      await runContextMemory.put("review.manuscript_type", preDraftCritique.manuscript_type);
      await runContextMemory.put("review.target_venue_style", preDraftCritique.target_venue_style);
      await runContextMemory.put("review.minimum_gate", minimumGate);
      await runContextMemory.put("review.paper_quality_evaluation", llmEvalResult.evaluation);
      await runContextMemory.put("review.readiness_risks", readinessRisks);

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "review",
        payload: {
          text: `Review panel completed with ${panel.reviewers.length} specialist reviewer(s), ${panel.findings.length} finding(s), and outcome ${panel.decision.outcome}. Manuscript type: ${preDraftCritique.manuscript_type}. Target venue: ${preDraftCritique.target_venue_style}.`
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
      const toolCallsUsed = Math.max(1, panel.llm_calls_used + (llmEvalResult.llmUsed ? 1 : 0));
      const costUsd = (panel.llm_cost_usd ?? 0) + llmEvalCost;
      const inputTokens = (panel.llm_input_tokens ?? 0) + (llmEvalResult.usage?.inputTokens ?? 0);
      const outputTokens = (panel.llm_output_tokens ?? 0) + (llmEvalResult.usage?.outputTokens ?? 0);
      const critiqueLabel = preDraftCritique.manuscript_type !== "paper_ready"
        ? ` Manuscript classified as ${preDraftCritique.manuscript_type} (venue: ${preDraftCritique.target_venue_style}).`
        : ` Manuscript classified as paper_ready (venue: ${preDraftCritique.target_venue_style}).`;
      return {
        status: "success",
        summary:
          blockers > 0
            ? `Review panel prepared ${panel.findings.length} finding(s) with ${blockers} blocking issue(s), ${warnings} warning(s), and ${manual} manual review item(s). The runtime will take the conservative backtrack recommended by review before paper drafting.${critiqueLabel} Public outputs: ${publicOutputs.outputRootRelative}.`
            : warnings > 0 || manual > 0
              ? `Review panel prepared ${panel.findings.length} finding(s) with ${warnings} warning(s) and ${manual} manual review item(s). The next stage will carry the attached revision checklist or follow the recommended backtrack automatically.${critiqueLabel} Public outputs: ${publicOutputs.outputRootRelative}.`
              : `Review panel completed with outcome ${panel.decision.outcome}.${critiqueLabel} The runtime can continue automatically from the review recommendation. Public outputs: ${publicOutputs.outputRootRelative}.`,
        needsApproval: true,
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
  config: NodeExecutionDeps["config"];
}): ReadinessRiskArtifact {
  const risks: ReadinessRisk[] = buildNetworkDependencyReadinessRisks({
    source: "review",
    allowNetwork: input.config.experiments?.allow_network === true,
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
  const cycleCappedAdvance = currentCycle >= 2 && minimumGate?.passed && action === "advance";
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
