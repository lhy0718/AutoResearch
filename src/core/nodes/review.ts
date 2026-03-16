import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { AnalysisConditionComparison, AnalysisReport } from "../resultAnalysis.js";
import { buildReviewPacket } from "../reviewPacket.js";
import { ReviewArtifactPresence, runReviewPanel } from "../reviewSystem.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
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

      // Build structured pre-draft critique artifact
      const venueStyle = resolveVenueStyle(deps.config.paper_profile?.target_venue_style);
      const preDraftCritique = buildPreDraftCritique({
        venueStyle,
        scorecard: panel.scorecard,
        decision: panel.decision,
        findings: panel.findings,
        presence
      });

      // Use critique to potentially strengthen transition recommendation
      const transitionRecommendation = buildReviewTransitionRecommendation(panel, packet, preDraftCritique);
      const markdown = renderReviewChecklist(run, packet, panel);

      const findingsPath = await writeRunArtifact(run, "review/findings.jsonl", renderJsonl(panel.findings));
      await writeRunArtifact(run, "review/scorecard.json", `${JSON.stringify(panel.scorecard, null, 2)}\n`);
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
      const reviewPacketPath = await writeRunArtifact(run, "review/review_packet.json", `${JSON.stringify(packet, null, 2)}\n`);
      const checklistPath = await writeRunArtifact(run, "review/checklist.md", markdown);
      const publicOutputs = await publishPublicRunOutputs({
        workspaceRoot: process.cwd(),
        run,
        runContext: runContextMemory,
        section: "review",
        files: [
          {
            sourcePath: reviewPacketPath,
            targetRelativePath: "review_packet.json"
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
        toolCallsUsed: Math.max(1, panel.llm_calls_used),
        costUsd: panel.llm_cost_usd,
        transitionRecommendation
      };
    }
  };
}

function buildReviewTransitionRecommendation(
  panel: Awaited<ReturnType<typeof runReviewPanel>>,
  packet: ReturnType<typeof buildReviewPacket>,
  critique: PaperCritique
): TransitionRecommendation | undefined {
  const action = panel.decision.outcome;
  const confidence = Number(panel.decision.confidence.toFixed(2));
  const evidence = [
    panel.decision.summary,
    ...panel.findings.slice(0, 3).map((finding) => finding.title)
  ].filter((value, index, items) => Boolean(value) && items.indexOf(value) === index);

  // If the critique found the manuscript is blocked_for_paper_scale or system_validation_note
  // with blocking issues, override the panel decision with a backtrack
  if (
    critique.overall_decision !== "advance" &&
    critique.overall_decision !== "repair_then_retry" &&
    (critique.manuscript_type === "blocked_for_paper_scale" || critique.manuscript_type === "system_validation_note")
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
          Boolean(await safeRead(path.join(runDir, "result_analysis_synthesis.json")))
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
  experiment_contract?: {
    hypothesis: string;
    single_change: string;
    confounded: boolean;
    expected_metric_effect: string;
    abort_condition: string;
    keep_or_discard_rule: string;
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
  retryCounters: Record<string, number>;
  rollbackCounters: Record<string, number>;
}): PreReviewSummary {
  const { report, experimentContract, attemptDecisions, failureClusters, objectiveMetric } = input;

  const keptDecisions = attemptDecisions.filter((d) => d.verdict === "keep");
  const discardedDecisions = attemptDecisions.filter((d) => d.verdict === "discard");
  const bestAttempt = keptDecisions.length > 0
    ? `Attempt ${keptDecisions[keptDecisions.length - 1].attempt} (${keptDecisions[keptDecisions.length - 1].verdict})`
    : "No kept attempts";

  const baselines = (report.condition_comparisons ?? [])
    .filter((c: AnalysisConditionComparison) => c.label.toLowerCase().includes("baseline"))
    .map((c: AnalysisConditionComparison) => c.label);

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

  const claimCeiling = report.overview?.objective_status === "met"
    ? experimentContract?.confounded
      ? "Confounded experiment: claims limited to correlation, not causation."
      : "Objective met; claims can reference metric improvement over baseline."
    : report.overview?.objective_status === "not_met"
      ? "Objective not met; claims must be limited to negative or null result."
      : "Objective unknown; claims must be heavily qualified.";

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
    retry_counters: Object.fromEntries(
      Object.entries(input.retryCounters).filter(([, v]) => v !== undefined)
    ) as Record<string, number>,
    rollback_counters: Object.fromEntries(
      Object.entries(input.rollbackCounters).filter(([, v]) => v !== undefined)
    ) as Record<string, number>
  };
}
