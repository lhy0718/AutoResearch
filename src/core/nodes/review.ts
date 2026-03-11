import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { AnalysisReport } from "../resultAnalysis.js";
import { buildReviewPacket } from "../reviewPacket.js";
import { ReviewArtifactPresence, runReviewPanel } from "../reviewSystem.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { TransitionRecommendation } from "../../types.js";

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
      const transitionRecommendation = buildReviewTransitionRecommendation(panel, packet);
      const markdown = renderReviewChecklist(run, packet, panel);

      await writeRunArtifact(run, "review/findings.jsonl", renderJsonl(panel.findings));
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
      await writeRunArtifact(run, "review/decision.json", `${JSON.stringify(panel.decision, null, 2)}\n`);
      await writeRunArtifact(run, "review/review_packet.json", `${JSON.stringify(packet, null, 2)}\n`);
      await writeRunArtifact(run, "review/checklist.md", markdown);
      await runContextMemory.put("review.packet", packet);
      await runContextMemory.put("review.last_summary", packet.objective_summary);
      await runContextMemory.put("review.last_recommendation", packet.recommendation || null);
      await runContextMemory.put("review.last_decision", panel.decision);
      await runContextMemory.put("review.last_findings_count", panel.findings.length);
      await runContextMemory.put("review.last_panel_agreement", panel.consistency.panel_agreement);

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "review",
        payload: {
          text: `Review panel completed with ${panel.reviewers.length} specialist reviewer(s), ${panel.findings.length} finding(s), and outcome ${panel.decision.outcome}.`
        }
      });

      const blockers = packet.readiness.blocking_checks;
      const warnings = packet.readiness.warning_checks;
      const manual = packet.readiness.manual_checks;
      return {
        status: "success",
        summary:
          blockers > 0
            ? `Review panel prepared ${panel.findings.length} finding(s) with ${blockers} blocking issue(s), ${warnings} warning(s), and ${manual} manual review item(s). The runtime will take the conservative backtrack recommended by review before paper drafting.`
            : warnings > 0 || manual > 0
              ? `Review panel prepared ${panel.findings.length} finding(s) with ${warnings} warning(s) and ${manual} manual review item(s). The next stage will carry the attached revision checklist or follow the recommended backtrack automatically.`
              : `Review panel completed with outcome ${panel.decision.outcome}. The runtime can continue automatically from the review recommendation.`,
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
  packet: ReturnType<typeof buildReviewPacket>
): TransitionRecommendation | undefined {
  const action = panel.decision.outcome;
  const confidence = Number(panel.decision.confidence.toFixed(2));
  const evidence = [
    panel.decision.summary,
    ...panel.findings.slice(0, 3).map((finding) => finding.title)
  ].filter((value, index, items) => Boolean(value) && items.indexOf(value) === index);

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
