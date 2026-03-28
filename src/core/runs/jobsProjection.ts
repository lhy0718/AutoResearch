import path from "node:path";
import { promises as fs } from "node:fs";

import {
  GraphNodeId,
  RunJobFailureAggregate,
  RunJobProjection,
  RunJobsSnapshot,
  RunLifecycleStatus,
  RunRecord,
  RunRecommendedNextAction,
  WorkflowApprovalMode
} from "../../types.js";
import { fileExists } from "../../utils/fs.js";
import { parseAnalysisReport } from "../resultAnalysis.js";
import { formatReadinessRiskSection, parseReadinessRiskArtifact, type ReadinessRiskArtifact } from "../readinessRisks.js";

interface ReviewCritiqueProjection {
  blocking_issues_count?: number;
  paper_readiness_state?: string;
  overall_decision?: string;
}

interface PaperReadinessProjection {
  paper_ready?: boolean;
  readiness_state?: string;
  reason?: string;
  triggered_by?: string[];
}

interface FailureSeed {
  key: string;
  summary: string;
  remediation: string;
}

interface RunJobProjectionInternal extends RunJobProjection {
  dominantFailure?: FailureSeed;
}

export interface AnalyzeResultsOperatorSummary {
  run_id: string;
  title: string;
  current_node: GraphNodeId;
  lifecycle_status: RunLifecycleStatus;
  analysis_ready: boolean;
  review_ready: boolean;
  paper_ready: boolean;
  recommended_next_action: RunRecommendedNextAction;
  blocker_summary?: string;
  lines: string[];
  artifact_refs: Array<{
    label: string;
    path: string;
  }>;
}

export interface JobsCommandArgs {
  query?: string;
  template?: "3d" | "7d";
}

export async function buildRunJobsSnapshot(input: {
  workspaceRoot: string;
  runs: RunRecord[];
  approvalMode: WorkflowApprovalMode;
}): Promise<RunJobsSnapshot> {
  const projected = await Promise.all(
    input.runs.map((run) =>
      buildRunJobProjectionInternal({
        workspaceRoot: input.workspaceRoot,
        run,
        approvalMode: input.approvalMode
      })
    )
  );

  return {
    generated_at: new Date().toISOString(),
    runs: projected.map(stripInternalProjection),
    top_failures: summarizeFailures(projected)
  };
}

export async function buildAnalyzeResultsOperatorSummary(input: {
  workspaceRoot: string;
  run: RunRecord;
  approvalMode: WorkflowApprovalMode;
}): Promise<AnalyzeResultsOperatorSummary> {
  const projected = await buildRunJobProjectionInternal(input);
  const runDir = buildRunDir(input.workspaceRoot, input.run.id);
  const analysisReport = await readAnalysisReport(path.join(runDir, "result_analysis.json"));
  const transitionRecommendation = await readJsonArtifact<Record<string, unknown>>(
    path.join(runDir, "transition_recommendation.json")
  );

  const artifactRefs = [
    maybeArtifactRef(projected.analysis_ready, "Analysis report", "result_analysis.json"),
    maybeArtifactRef(projected.analysis_ready, "Transition recommendation", "transition_recommendation.json"),
    maybeArtifactRef(projected.review_ready, "Review packet", "review/review_packet.json"),
    maybeArtifactRef(projected.review_ready, "Paper critique", "review/paper_critique.json"),
    maybeArtifactRef(projected.review_ready, "Review minimum gate", "review/minimum_gate.json"),
    maybeArtifactRef(projected.paper_ready || Boolean(projected.paper_readiness_state), "Paper readiness", "paper/paper_readiness.json")
  ].filter((item): item is { label: string; path: string } => Boolean(item));

  const lines = [
    `Analyze-results operator view for ${input.run.id}.`,
    `Lifecycle: ${projected.lifecycle_status} at ${projected.current_node}.`,
    `Readiness: analysis=${yesNo(projected.analysis_ready)}, review=${yesNo(projected.review_ready)}, paper=${yesNo(projected.paper_ready)}.`
  ];

  if (analysisReport?.overview?.objective_summary) {
    lines.push(`Objective: ${compactOneLine(analysisReport.overview.objective_summary, 180)}`);
  }

  if (transitionRecommendation?.action && typeof transitionRecommendation.action === "string") {
    const target =
      typeof transitionRecommendation.targetNode === "string" && transitionRecommendation.targetNode.length > 0
        ? ` -> ${transitionRecommendation.targetNode}`
        : "";
    lines.push(`Transition: ${transitionRecommendation.action}${target}.`);
  }

  if (projected.blocker_summary) {
    lines.push(`Blocker: ${projected.blocker_summary}`);
  }

  lines.push(`Next: ${projected.recommended_next_action}.`);

  return {
    run_id: projected.run_id,
    title: projected.title,
    current_node: projected.current_node,
    lifecycle_status: projected.lifecycle_status,
    analysis_ready: projected.analysis_ready,
    review_ready: projected.review_ready,
    paper_ready: projected.paper_ready,
    recommended_next_action: projected.recommended_next_action,
    blocker_summary: projected.blocker_summary,
    lines,
    artifact_refs: artifactRefs
  };
}

export function buildJobsTemplateLines(input: {
  snapshot: RunJobsSnapshot;
  window: "3d" | "7d";
}): string[] {
  const activeCount = input.snapshot.runs.filter((run) => run.lifecycle_status !== "completed").length;
  const blockedCount = input.snapshot.runs.filter((run) => run.recommended_next_action === "inspect_blocker").length;
  return [
    `${input.window === "3d" ? "3-day" : "7-day"} operator check-in template`,
    `Runs in view: ${input.snapshot.runs.length}. Active: ${activeCount}. Blocked for inspection: ${blockedCount}.`,
    "1. Confirm the current_node and recommended_next_action for the top active runs.",
    "2. Inspect one blocker artifact before retrying any failed or paused run.",
    "3. Verify whether review is the next governed gate before treating a run as paper-ready.",
    `4. Review the top recurring failure: ${input.snapshot.top_failures[0]?.reason || "No recurring blocker is currently dominant."}`
  ];
}

export function parseJobsCommandArgs(args: string[]): JobsCommandArgs {
  const templateIndex = args.findIndex((arg) => arg === "--template");
  if (templateIndex >= 0) {
    const value = args[templateIndex + 1];
    if (value === "3d" || value === "7d") {
      return {
        template: value,
        query: args
          .filter((_, index) => index !== templateIndex && index !== templateIndex + 1)
          .join(" ")
          .trim() || undefined
      };
    }
  }

  return {
    query: args.join(" ").trim() || undefined
  };
}

async function buildRunJobProjectionInternal(input: {
  workspaceRoot: string;
  run: RunRecord;
  approvalMode: WorkflowApprovalMode;
}): Promise<RunJobProjectionInternal> {
  const runDir = buildRunDir(input.workspaceRoot, input.run.id);
  const analysisReady = await hasArtifacts(runDir, ["result_analysis.json", "transition_recommendation.json"]);
  const reviewReady = await hasArtifacts(runDir, [
    "review/review_packet.json",
    "review/paper_critique.json",
    "review/minimum_gate.json",
    "review/readiness_risks.json"
  ]);
  const paperReadiness = await readJsonArtifact<PaperReadinessProjection>(
    path.join(runDir, "paper", "paper_readiness.json")
  );
  const paperReady = Boolean(paperReadiness?.paper_ready);
  const reviewRisks = await readReadinessRisks(path.join(runDir, "review", "readiness_risks.json"));
  const paperRisks = await readReadinessRisks(path.join(runDir, "paper", "readiness_risks.json"));
  const reviewCritique = await readJsonArtifact<ReviewCritiqueProjection>(
    path.join(runDir, "review", "paper_critique.json")
  );
  const lifecycleStatus = deriveLifecycleStatus(input.run);
  const lastEventAt = await readLastEventTimestamp(runDir, input.run.updatedAt);
  const dominantFailure = deriveDominantFailure({
    run: input.run,
    reviewRisks,
    paperRisks,
    reviewCritique,
    paperReadiness
  });
  const recommendedNextAction = deriveRecommendedNextAction({
    run: input.run,
    lifecycleStatus,
    analysisReady,
    reviewReady,
    paperReady,
    dominantFailure: Boolean(dominantFailure)
  });

  return {
    run_id: input.run.id,
    title: input.run.title,
    current_node: input.run.currentNode,
    lifecycle_status: lifecycleStatus,
    approval_mode: input.approvalMode,
    last_event_at: lastEventAt,
    recommended_next_action: recommendedNextAction,
    analysis_ready: analysisReady,
    review_ready: reviewReady,
    paper_ready: paperReady,
    paper_readiness_state:
      asNonEmptyString(paperReadiness?.readiness_state) || asNonEmptyString(reviewCritique?.paper_readiness_state),
    blocker_summary: dominantFailure?.summary,
    dominantFailure
  };
}

function stripInternalProjection(input: RunJobProjectionInternal): RunJobProjection {
  return {
    run_id: input.run_id,
    title: input.title,
    current_node: input.current_node,
    lifecycle_status: input.lifecycle_status,
    approval_mode: input.approval_mode,
    last_event_at: input.last_event_at,
    recommended_next_action: input.recommended_next_action,
    analysis_ready: input.analysis_ready,
    review_ready: input.review_ready,
    paper_ready: input.paper_ready,
    paper_readiness_state: input.paper_readiness_state,
    blocker_summary: input.blocker_summary
  };
}

function summarizeFailures(input: RunJobProjectionInternal[]): RunJobFailureAggregate[] {
  const grouped = new Map<
    string,
    { summary: string; remediation: string; count: number }
  >();
  const failingRuns = input.filter((run) => Boolean(run.dominantFailure));
  for (const run of failingRuns) {
    if (!run.dominantFailure) {
      continue;
    }
    const current = grouped.get(run.dominantFailure.key) || {
      summary: run.dominantFailure.summary,
      remediation: run.dominantFailure.remediation,
      count: 0
    };
    current.count += 1;
    grouped.set(run.dominantFailure.key, current);
  }

  const denominator = Math.max(1, failingRuns.length);
  return [...grouped.entries()]
    .map(([key, value]) => ({
      key,
      reason: value.summary,
      occurrence_count: value.count,
      recurrence_probability: Number((value.count / denominator).toFixed(2)),
      remediation: value.remediation
    }))
    .sort((left, right) => right.occurrence_count - left.occurrence_count || left.reason.localeCompare(right.reason))
    .slice(0, 3);
}

function deriveLifecycleStatus(run: RunRecord): RunLifecycleStatus {
  const currentStatus = run.graph.nodeStates[run.currentNode]?.status;
  if (currentStatus === "needs_approval") {
    return "needs_approval";
  }
  return run.status;
}

function deriveRecommendedNextAction(input: {
  run: RunRecord;
  lifecycleStatus: RunLifecycleStatus;
  analysisReady: boolean;
  reviewReady: boolean;
  paperReady: boolean;
  dominantFailure: boolean;
}): RunRecommendedNextAction {
  if (input.run.status === "completed" && input.paperReady) {
    return "completed";
  }
  if (
    (input.lifecycleStatus === "needs_approval" && input.run.currentNode === "review")
    || (input.analysisReady && !input.reviewReady && (input.run.currentNode === "analyze_results" || input.run.currentNode === "review"))
    || (input.reviewReady && !input.paperReady && input.run.currentNode === "review")
  ) {
    return "resume_review";
  }
  if (input.dominantFailure) {
    return input.run.status === "failed" ? "rerun_after_fix" : "inspect_blocker";
  }
  if (input.lifecycleStatus === "needs_approval" || input.run.status === "paused") {
    return "waiting_for_input";
  }
  if (input.run.status === "failed") {
    return "rerun_after_fix";
  }
  if (input.run.status === "completed") {
    return input.paperReady ? "completed" : "inspect_blocker";
  }
  return "waiting_for_input";
}

function deriveDominantFailure(input: {
  run: RunRecord;
  reviewRisks?: ReadinessRiskArtifact;
  paperRisks?: ReadinessRiskArtifact;
  reviewCritique?: ReviewCritiqueProjection;
  paperReadiness?: PaperReadinessProjection;
}): FailureSeed | undefined {
  const runtimeError = compactOneLine(
    input.run.graph.nodeStates[input.run.currentNode]?.lastError
      || input.run.graph.nodeStates[input.run.currentNode]?.note,
    180
  );
  if (runtimeError) {
    return {
      key: `runtime:${input.run.currentNode}`,
      summary: runtimeError,
      remediation: `Inspect the latest ${input.run.currentNode} artifact or event log before retrying the run.`
    };
  }

  const blockedPaperRisk = input.paperRisks?.risks.find((risk) => risk.severity === "blocked");
  if (blockedPaperRisk) {
    return {
      key: `paper:${blockedPaperRisk.category}:${blockedPaperRisk.risk_code}`,
      summary: blockedPaperRisk.message,
      remediation: blockedPaperRisk.recommended_action
    };
  }

  const blockedReviewRisk = input.reviewRisks?.risks.find((risk) => risk.severity === "blocked");
  if (blockedReviewRisk) {
    return {
      key: `review:${blockedReviewRisk.category}:${blockedReviewRisk.risk_code}`,
      summary: blockedReviewRisk.message,
      remediation: blockedReviewRisk.recommended_action
    };
  }

  if ((input.reviewCritique?.blocking_issues_count || 0) > 0) {
    return {
      key: "review:paper_critique",
      summary: `${input.reviewCritique?.blocking_issues_count} blocking critique issue(s) remain before paper drafting.`,
      remediation: "Inspect review/paper_critique.json and resolve the blocking issues before advancing to write_paper."
    };
  }

  if (input.paperReadiness && input.paperReadiness.paper_ready === false && asNonEmptyString(input.paperReadiness.reason)) {
    const summarizedReason = compactOneLine(input.paperReadiness.reason, 180);
    return {
      key: "paper:readiness",
      summary: summarizedReason || "Paper readiness remains blocked by unresolved paper-level requirements.",
      remediation: "Inspect paper/paper_readiness.json and paper/readiness_risks.json before treating the run as complete."
    };
  }

  return undefined;
}

async function hasArtifacts(runDir: string, paths: string[]): Promise<boolean> {
  for (const relativePath of paths) {
    if (!(await fileExists(path.join(runDir, relativePath)))) {
      return false;
    }
  }
  return true;
}

async function readAnalysisReport(filePath: string) {
  const raw = await readTextArtifact(filePath);
  return raw ? parseAnalysisReport(raw) : undefined;
}

async function readReadinessRisks(filePath: string): Promise<ReadinessRiskArtifact | undefined> {
  const raw = await readTextArtifact(filePath);
  return raw ? parseReadinessRiskArtifact(raw) : undefined;
}

async function readJsonArtifact<T>(filePath: string): Promise<T | undefined> {
  const raw = await readTextArtifact(filePath);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function readTextArtifact(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readLastEventTimestamp(runDir: string, fallback: string): Promise<string> {
  const eventsPath = path.join(runDir, "events.jsonl");
  try {
    const raw = await fs.readFile(eventsPath, "utf8");
    const lines = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]) as { timestamp?: string };
        if (typeof parsed.timestamp === "string" && parsed.timestamp.trim().length > 0) {
          return parsed.timestamp;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // fall through
  }
  return fallback;
}

function maybeArtifactRef(
  enabled: boolean,
  label: string,
  artifactPath: string
): { label: string; path: string } | undefined {
  if (!enabled) {
    return undefined;
  }
  return { label, path: artifactPath };
}

function buildRunDir(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, ".autolabos", "runs", runId);
}

function compactOneLine(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function formatRecommendedNextAction(action: RunRecommendedNextAction): string {
  switch (action) {
    case "inspect_blocker":
      return "Inspect blocker";
    case "resume_review":
      return "Resume review";
    case "rerun_after_fix":
      return "Rerun after fix";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Completed";
  }
}

export function formatRunJobLifecycleStatus(status: RunLifecycleStatus): string {
  switch (status) {
    case "needs_approval":
      return "Needs approval";
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}

export function formatRunJobProjectionLines(input: {
  projection: RunJobProjection;
}): string[] {
  const lines = [
    `${input.projection.run_id} | ${input.projection.title} | ${input.projection.current_node} | ${input.projection.lifecycle_status} | ${input.projection.approval_mode}`,
    `  readiness: analysis=${yesNo(input.projection.analysis_ready)} review=${yesNo(input.projection.review_ready)} paper=${yesNo(input.projection.paper_ready)} | next=${input.projection.recommended_next_action}`,
    `  last event: ${input.projection.last_event_at}`
  ];
  if (input.projection.blocker_summary) {
    lines.push(`  blocker: ${compactOneLine(input.projection.blocker_summary, 180)}`);
  }
  return lines;
}

export function formatFailureAggregateLines(topFailures: RunJobFailureAggregate[]): string[] {
  if (topFailures.length === 0) {
    return ["Top failures: none recorded in the current jobs view."];
  }
  return [
    "Top failures:",
    ...topFailures.map(
      (failure, index) =>
        `  ${index + 1}. ${failure.reason} | recurrence=${Math.round(failure.recurrence_probability * 100)}% | remediation=${failure.remediation}`
    )
  ];
}

export function formatReadinessSummaryLine(risks: ReadinessRiskArtifact | undefined): string | undefined {
  if (!risks || risks.risk_count === 0) {
    return undefined;
  }
  const dominant = risks.risks[0];
  if (!dominant) {
    return undefined;
  }
  return `${formatReadinessRiskSection(dominant.category)}: ${compactOneLine(dominant.message, 160)}`;
}
