import path from "node:path";

import { promises as fs } from "node:fs";

import type { TransitionRecommendation } from "../../types.js";
import {
  checkCaptionConsistency,
  critiqueFiguresVision,
  lintFigures,
  type FigureAuditInput
} from "../analysis/figureAuditor.js";
import { resolveExplorationConfig } from "../exploration/explorationConfig.js";
import type { FigureAuditIssue, FigureAuditSummary } from "../exploration/types.js";
import { buildRunCompletenessChecklist } from "../runs/runCompletenessChecklist.js";
import { buildRunOperatorStatus } from "../runs/runStatus.js";
import { renderOperatorSummaryMarkdown } from "../operatorSummary.js";
import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import type { NodeExecutionDeps } from "./types.js";

export function createFigureAuditNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "figure_audit",
    async execute({ run }) {
      const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
      const config = resolveExplorationConfig({
        workspaceRoot: process.cwd(),
        appConfig: deps.config
      });
      const input = await buildFigureAuditInput(runDir);

      let gate1Gate2Issues: FigureAuditIssue[] = [];
      const cachedGateOneTwo = await readIssueArray(path.join(runDir, "figure_audit", "gate1_gate2_issues.json"));
      if (cachedGateOneTwo) {
        gate1Gate2Issues = cachedGateOneTwo;
      } else if (config.figure_auditor.enabled) {
        gate1Gate2Issues = [
          ...(await lintFigures(input)),
          ...(await checkCaptionConsistency(input))
        ];
        await writeRunArtifact(
          run,
          "figure_audit/gate1_gate2_issues.json",
          `${JSON.stringify(gate1Gate2Issues, null, 2)}\n`
        );
      }

      const gate3Issues = config.figure_auditor.enabled
        ? await critiqueFiguresVision(input, gate1Gate2Issues)
        : [];
      const issues = config.figure_auditor.enabled ? [...gate1Gate2Issues, ...gate3Issues] : [];
      const figureCount = await countFigureFiles(path.join(runDir, "paper", "figures"));
      const summary: FigureAuditSummary = {
        audited_at: new Date().toISOString(),
        figure_count: figureCount,
        issues,
        severe_mismatch_count: issues.filter((issue) => issue.severity === "severe").length,
        review_block_required: issues.some((issue) => issue.severity === "severe")
      };

      const summaryPath = await writeRunArtifact(
        run,
        "figure_audit/figure_audit_summary.json",
        `${JSON.stringify(summary, null, 2)}\n`
      );
      await writePerFigureIssues(run, issues);
      const operatorSummaryPath = await writeRunArtifact(
        run,
        "operator_summary.md",
        renderOperatorSummaryMarkdown({
          runId: run.id,
          title: run.title,
          stage: "review",
          summary: [
            config.figure_auditor.enabled
              ? `Figure audit found ${summary.issues.length} issue(s) across the manuscript figures.`
              : "Figure auditor disabled; stored an empty pass-through summary.",
            `Severe mismatches: ${summary.severe_mismatch_count}.`
          ],
          decision: summary.review_block_required
            ? "Figure audit recommends review-stage revision before any paper-ready claim."
            : "Figure audit found no severe mismatches and can advance to review.",
          blockers: summary.issues.filter((issue) => issue.severity === "severe").slice(0, 3).map((issue) => issue.description),
          openQuestions: summary.issues.filter((issue) => issue.severity !== "severe").slice(0, 3).map((issue) => issue.description),
          nextActions: summary.review_block_required
            ? [
                "Inspect figure_audit_summary.json before approving review.",
                "Repair severe figure/caption/reference mismatches before treating the manuscript as paper-ready."
              ]
            : ["Continue into review and keep figure issues attached to the review packet."],
          references: [
            { label: "Figure audit summary", path: "figure_audit/figure_audit_summary.json" },
            { label: "Gate 1/2 issues", path: "figure_audit/gate1_gate2_issues.json" }
          ]
        })
      );
      const runStatus = await buildRunOperatorStatus({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "figure_audit",
        approvalMode: deps.config?.workflow?.approval_mode || "minimal",
        networkPolicy:
          deps.config?.experiments?.network_policy
          || (deps.config?.experiments?.allow_network ? "declared" : "blocked"),
        networkPurpose: deps.config?.experiments?.network_purpose
      });
      await writeRunArtifact(run, "run_status.json", `${JSON.stringify(runStatus, null, 2)}\n`);
      const completenessChecklist = await buildRunCompletenessChecklist({
        workspaceRoot: process.cwd(),
        run,
        currentNode: "figure_audit"
      });
      await writeRunArtifact(
        run,
        "run_completeness_checklist.json",
        `${JSON.stringify(completenessChecklist, null, 2)}\n`
      );

      deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "figure_audit",
        payload: {
          text: config.figure_auditor.enabled
            ? `Figure audit completed: ${summary.severe_mismatch_count} severe mismatch(es), ${summary.issues.length} total issue(s).`
            : "Figure audit pass-through: figure_auditor.enabled=false."
        }
      });

      return {
        status: "success",
        summary: config.figure_auditor.enabled
          ? `Figure audit completed with ${summary.severe_mismatch_count} severe mismatch(es). Review block required: ${summary.review_block_required}.`
          : "Figure audit pass-through completed with an empty summary because figure_auditor.enabled=false.",
        toolCallsUsed: 1,
        transitionRecommendation: createAdvanceToReview(summary, config.figure_auditor.enabled, summaryPath, operatorSummaryPath)
      };
    }
  };
}

async function buildFigureAuditInput(runDir: string): Promise<FigureAuditInput> {
  const paperTexPath = path.join(runDir, "paper", "main.tex");
  const paperTexContent = await safeRead(paperTexPath);
  return {
    run_dir: runDir,
    figure_dir: null,
    paper_tex_content: paperTexContent || null,
    result_analysis_path: path.join(runDir, "result_analysis.json")
  };
}

function countDistinctFigureIds(issues: FigureAuditIssue[]): number {
  if (issues.length === 0) {
    return 0;
  }
  return new Set(issues.map((issue) => issue.figure_id)).size;
}

async function countFigureFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return countFigureFiles(target);
        }
        return entry.isFile() && /\.(png|pdf|svg)$/iu.test(entry.name) ? 1 : 0;
      })
    );
    return nested.reduce((sum, value) => sum + value, 0);
  } catch {
    return countDistinctFigureIds([]);
  }
}

async function readIssueArray(filePath: string): Promise<FigureAuditIssue[] | null> {
  const raw = await safeRead(filePath);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed as FigureAuditIssue[];
  } catch {
    return null;
  }
}

async function writePerFigureIssues(run: Parameters<GraphNodeHandler["execute"]>[0]["run"], issues: FigureAuditIssue[]): Promise<void> {
  const grouped = new Map<string, FigureAuditIssue[]>();
  for (const issue of issues) {
    grouped.set(issue.figure_id, [...(grouped.get(issue.figure_id) || []), issue]);
  }
  for (const [figureId, figureIssues] of grouped.entries()) {
    const safeFigureId = figureId.replace(/[^a-z0-9._-]+/giu, "_");
    await writeRunArtifact(
      run,
      `figure_audit/per_figure/${safeFigureId}.json`,
      `${JSON.stringify(
        {
          figure_id: figureId,
          issues: figureIssues
        },
        null,
        2
      )}\n`
    );
  }
  if (grouped.size === 0) {
    await fs.mkdir(path.join(process.cwd(), ".autolabos", "runs", run.id, "figure_audit", "per_figure"), {
      recursive: true
    });
  }
}

function createAdvanceToReview(
  summary: FigureAuditSummary,
  enabled: boolean,
  summaryPath: string,
  operatorSummaryPath: string
): TransitionRecommendation {
  return {
    action: "advance",
    sourceNode: "figure_audit",
    targetNode: "review",
    reason: enabled
      ? summary.review_block_required
        ? "Figure audit found severe mismatches; continue into review so the review gate can downgrade accept to revise."
        : "Figure audit found no severe mismatches and can continue into review."
      : "Figure auditor disabled; stored an empty pass-through summary before review.",
    confidence: enabled && summary.review_block_required ? 0.9 : 0.95,
    autoExecutable: true,
    evidence: [
      `Figure audit summary: ${summaryPath}`,
      `Operator summary: ${operatorSummaryPath}`
    ],
    suggestedCommands: ["/agent run review", "/agent review"],
    generatedAt: new Date().toISOString()
  };
}
