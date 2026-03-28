import path from "node:path";
import { promises as fs } from "node:fs";

import {
  ExperimentNetworkPolicy,
  ExperimentNetworkPurpose,
  GraphNodeId,
  RunLifecycleStatus,
  RunOperatorStatusArtifact,
  RunJobFailureAggregate,
  RunJobProjection,
  RunJobsSnapshot,
  RunRecord,
  RunRecommendedNextAction,
  WorkflowApprovalMode
} from "../../types.js";
import { fileExists } from "../../utils/fs.js";
import { parseAnalysisReport } from "../resultAnalysis.js";
import { formatReadinessRiskSection, parseReadinessRiskArtifact, type ReadinessRiskArtifact } from "../readinessRisks.js";
import { buildRunOperatorStatus, readRunOperatorStatus } from "./runStatus.js";

interface ReviewPacketProjection {
  readiness?: {
    status?: "ready" | "warning" | "blocking";
  };
  decision?: {
    outcome?: string;
    recommended_transition?: string;
  };
}

interface ReviewScorecardProjection {
  overall_score_1_to_5?: number;
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
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
}): Promise<RunJobsSnapshot> {
  const projected = await Promise.all(
    input.runs.map((run) =>
      buildRunJobProjectionInternal({
        workspaceRoot: input.workspaceRoot,
        run,
        approvalMode: input.approvalMode,
        networkPolicy: input.networkPolicy,
        networkPurpose: input.networkPurpose
      })
    )
  );

  return {
    generated_at: new Date().toISOString(),
    runs: projected
      .sort((left, right) => Date.parse(right.last_event_at) - Date.parse(left.last_event_at))
      .map(stripInternalProjection),
    top_failures: summarizeFailures(projected)
  };
}

export async function buildAnalyzeResultsOperatorSummary(input: {
  workspaceRoot: string;
  run: RunRecord;
  approvalMode: WorkflowApprovalMode;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
}): Promise<AnalyzeResultsOperatorSummary> {
  const projected = await buildRunJobProjectionInternal(input);
  const runDir = buildRunDir(input.workspaceRoot, input.run.id);
  const analysisReport = await readAnalysisReport(path.join(runDir, "result_analysis.json"));
  const transitionRecommendation = await readJsonArtifact<Record<string, unknown>>(
    path.join(runDir, "transition_recommendation.json")
  );
  const reviewPacket = await readJsonArtifact<ReviewPacketProjection>(
    path.join(runDir, "review", "review_packet.json")
  );
  const reviewScorecard = await readJsonArtifact<ReviewScorecardProjection>(
    path.join(runDir, "review", "scorecard.json")
  );

  const artifactRefs = [
    maybeArtifactRef(projected.analysis_ready, "Analysis report", "result_analysis.json"),
    maybeArtifactRef(projected.analysis_ready, "Transition recommendation", "transition_recommendation.json"),
    maybeArtifactRef(Boolean(reviewPacket), "Review packet", "review/review_packet.json"),
    maybeArtifactRef(Boolean(reviewScorecard), "Review scorecard", "review/scorecard.json"),
    maybeArtifactRef(projected.review_ready, "Paper critique", "review/paper_critique.json"),
    maybeArtifactRef(projected.review_ready, "Review minimum gate", "review/minimum_gate.json"),
    maybeArtifactRef(projected.review_ready, "Review readiness risks", "review/readiness_risks.json"),
    maybeArtifactRef(projected.paper_ready || Boolean(projected.paper_readiness_state), "Paper readiness", "paper/paper_readiness.json"),
    maybeArtifactRef(await fileExists(path.join(runDir, "run_status.json")), "Run status", "run_status.json")
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

  if (!projected.review_ready) {
    lines.push("Review gate: not started yet or still missing one of the required review artifacts.");
  } else if (projected.review_gate_label || projected.review_decision_outcome || projected.review_gate_status) {
    lines.push(`Review gate: ${projected.review_gate_label || projected.review_gate_status}.`);
  }

  if (typeof projected.review_score_overall === "number") {
    lines.push(`Review scorecard: ${projected.review_score_overall}/5 overall.`);
  }

  if (projected.paper_gate_label || projected.paper_readiness_state) {
    lines.push(`Paper readiness state: ${projected.paper_gate_label || projected.paper_readiness_state}.`);
  }

  if (projected.blocker_summary) {
    lines.push(`Blocker: ${projected.blocker_summary}`);
  }

  if (projected.network_dependency?.enabled || projected.network_dependency?.severity === "blocking") {
    lines.push(`Network dependency: ${projected.network_dependency.operator_label}.`);
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
  const reviewPendingCount = input.snapshot.runs.filter(
    (run) => run.recommended_next_action === "resume_review" || run.current_node === "review"
  ).length;
  const paperBlockedCount = input.snapshot.runs.filter(
    (run) => Boolean(run.paper_readiness_state) && !run.paper_ready
  ).length;
  return [
    `${input.window === "3d" ? "3-day" : "7-day"} operator check-in template`,
    `Runs in view: ${input.snapshot.runs.length}. Active: ${activeCount}. Blocked for inspection: ${blockedCount}.`,
    `Review-adjacent runs: ${reviewPendingCount}. Paper-blocked runs: ${paperBlockedCount}.`,
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
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
}): Promise<RunJobProjectionInternal> {
  const status = await loadOrBuildRunStatus(input);
  return projectRunStatus(status);
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
    review_gate_status: input.review_gate_status,
    review_decision_outcome: input.review_decision_outcome,
    review_recommended_transition: input.review_recommended_transition,
    review_score_overall: input.review_score_overall,
    paper_readiness_state: input.paper_readiness_state,
    paper_readiness_reason: input.paper_readiness_reason,
    blocker_summary: input.blocker_summary,
    review_gate_label: input.review_gate_label,
    paper_gate_label: input.paper_gate_label,
    blocking_reasons: input.blocking_reasons,
    warning_reasons: input.warning_reasons,
    network_dependency: input.network_dependency,
    validation_scope: input.validation_scope
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

async function readAnalysisReport(filePath: string) {
  const raw = await readTextArtifact(filePath);
  return raw ? parseAnalysisReport(raw) : undefined;
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
  return action;
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
  return status;
}

export function formatRunJobProjectionLines(input: {
  projection: RunJobProjection;
}): string[] {
  const lines = [
    `${input.projection.run_id} | ${input.projection.title} | ${input.projection.current_node} | ${input.projection.lifecycle_status} | ${input.projection.approval_mode}`,
    `  readiness: analysis=${yesNo(input.projection.analysis_ready)} review=${yesNo(input.projection.review_ready)} paper=${yesNo(input.projection.paper_ready)} | next=${input.projection.recommended_next_action}`,
    `  last event: ${input.projection.last_event_at}`
  ];
  if (input.projection.review_gate_status || input.projection.review_decision_outcome || typeof input.projection.review_score_overall === "number") {
    const gateLabel =
      input.projection.review_gate_label
      || (input.projection.review_decision_outcome
        ? `${input.projection.review_decision_outcome}${input.projection.review_recommended_transition ? ` -> ${input.projection.review_recommended_transition}` : ""}`
        : input.projection.review_gate_status || "missing");
    const scoreLabel = typeof input.projection.review_score_overall === "number"
      ? ` | score=${input.projection.review_score_overall}/5`
      : "";
    lines.push(`  review gate: ${gateLabel}${scoreLabel}`);
  }
  if (input.projection.paper_readiness_state) {
    const paperDetail = input.projection.paper_readiness_reason
      ? ` | ${compactOneLine(input.projection.paper_readiness_reason, 120)}`
      : "";
    lines.push(`  paper state: ${input.projection.paper_gate_label || input.projection.paper_readiness_state}${paperDetail}`);
  }
  if (input.projection.network_dependency) {
    lines.push(`  network: ${input.projection.network_dependency.operator_label}`);
  }
  if (input.projection.validation_scope && input.projection.validation_scope !== "full_run") {
    lines.push(`  validation scope: ${input.projection.validation_scope}`);
  }
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

async function loadOrBuildRunStatus(input: {
  workspaceRoot: string;
  run: RunRecord;
  approvalMode: WorkflowApprovalMode;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
}): Promise<RunOperatorStatusArtifact> {
  const runDir = buildRunDir(input.workspaceRoot, input.run.id);
  const existing = await readRunOperatorStatus(runDir);
  if (existing) {
    return existing;
  }
  return buildRunOperatorStatus({
    workspaceRoot: input.workspaceRoot,
    run: input.run,
    approvalMode: input.approvalMode,
    networkPolicy: input.networkPolicy,
    networkPurpose: input.networkPurpose
  });
}

function projectRunStatus(status: RunOperatorStatusArtifact): RunJobProjectionInternal {
  return {
    run_id: status.run_id,
    title: status.title,
    current_node: status.current_node,
    lifecycle_status: status.lifecycle_status,
    approval_mode: status.approval_mode,
    last_event_at: status.last_event_at,
    recommended_next_action: status.recommended_next_action,
    analysis_ready: status.analysis_ready,
    review_ready: status.review_ready,
    paper_ready: status.paper_ready,
    review_gate_status: status.review_gate.status,
    review_decision_outcome: status.review_gate.decision_outcome,
    review_recommended_transition: status.review_gate.recommended_transition,
    review_score_overall: status.review_gate.score_overall,
    paper_readiness_state: status.paper_gate.readiness_state,
    paper_readiness_reason: status.paper_gate.reason,
    blocker_summary: status.blocker_summary,
    review_gate_label: status.review_gate.operator_label,
    paper_gate_label: status.paper_gate.operator_label,
    blocking_reasons: [...status.blocking_reasons],
    warning_reasons: [...status.warning_reasons],
    network_dependency: status.network_dependency,
    validation_scope: status.validation_scope,
    dominantFailure: status.dominant_failure
      ? {
          key: status.dominant_failure.key,
          summary: status.dominant_failure.summary,
          remediation: status.dominant_failure.remediation
        }
      : undefined
  };
}
