import path from "node:path";
import { promises as fs } from "node:fs";

import {
  ExperimentNetworkPolicy,
  ExperimentNetworkPurpose,
  GraphNodeId,
  RunLifecycleStatus,
  RunOperatorStatusArtifact,
  RunRecord,
  RunRecommendedNextAction,
  RunValidationScope,
  WorkflowApprovalMode
} from "../../types.js";
import { fileExists } from "../../utils/fs.js";
import { parseAnalysisReport } from "../resultAnalysis.js";
import { parseReadinessRiskArtifact, type ReadinessRiskArtifact } from "../readinessRisks.js";
import { buildWorkspaceRunRoot } from "./runPaths.js";

interface ReviewCritiqueProjection {
  blocking_issues_count?: number;
  paper_readiness_state?: string;
}

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

export const RUN_STATUS_RELATIVE_PATH = "run_status.json";

export async function readRunOperatorStatus(runDir: string): Promise<RunOperatorStatusArtifact | undefined> {
  const raw = await readTextArtifact(path.join(runDir, RUN_STATUS_RELATIVE_PATH));
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as RunOperatorStatusArtifact;
    if (parsed?.version === 1 && typeof parsed.run_id === "string") {
      return parsed;
    }
  } catch {
    // ignore malformed status artifact here; harness handles validation
  }
  return undefined;
}

export async function buildRunOperatorStatus(input: {
  workspaceRoot: string;
  run: RunRecord;
  approvalMode: WorkflowApprovalMode;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
  validationScope?: RunValidationScope;
  currentNode?: GraphNodeId;
  lifecycleStatus?: RunLifecycleStatus;
}): Promise<RunOperatorStatusArtifact> {
  const runDir = buildWorkspaceRunRoot(input.workspaceRoot, input.run.id);
  const currentNode = input.currentNode || input.run.currentNode;
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
  const reviewPacket = await readJsonArtifact<ReviewPacketProjection>(
    path.join(runDir, "review", "review_packet.json")
  );
  const reviewScorecard = await readJsonArtifact<ReviewScorecardProjection>(
    path.join(runDir, "review", "scorecard.json")
  );
  const lifecycleStatus = deriveLifecycleStatus(input.run, currentNode, input.lifecycleStatus);
  const lastEventAt = await readLastEventTimestamp(runDir, input.run.updatedAt);
  const dominantFailure = deriveDominantFailure({
    run: input.run,
    currentNode,
    reviewRisks,
    paperRisks,
    reviewCritique,
    paperReadiness
  });
  const recommendedNextAction = deriveRecommendedNextAction({
    run: input.run,
    currentNode,
    lifecycleStatus,
    analysisReady,
    reviewReady,
    paperReady,
    dominantFailure: Boolean(dominantFailure)
  });
  const reviewGateStatus = normalizeReviewGateStatus(reviewPacket?.readiness?.status);
  const reviewDecisionOutcome = asNonEmptyString(reviewPacket?.decision?.outcome);
  const reviewRecommendedTransition = asNonEmptyString(reviewPacket?.decision?.recommended_transition);
  const reviewScoreOverall =
    typeof reviewScorecard?.overall_score_1_to_5 === "number"
      ? Number(reviewScorecard.overall_score_1_to_5.toFixed(1))
      : undefined;
  const paperReadinessState =
    asNonEmptyString(paperReadiness?.readiness_state) || asNonEmptyString(reviewCritique?.paper_readiness_state);
  const paperReadinessReason = asNonEmptyString(paperReadiness?.reason);
  const blockingReasons = collectRiskMessages("blocked", reviewRisks, paperRisks);
  const warningReasons = collectRiskMessages("warning", reviewRisks, paperRisks);
  if (dominantFailure?.summary && !blockingReasons.includes(dominantFailure.summary)) {
    blockingReasons.unshift(dominantFailure.summary);
  }

  const networkDependency = normalizeNetworkDependency({
    policy: input.networkPolicy,
    purpose: input.networkPurpose
  });

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    run_id: input.run.id,
    title: input.run.title,
    current_node: currentNode,
    lifecycle_status: lifecycleStatus,
    approval_mode: input.approvalMode,
    last_event_at: lastEventAt,
    analysis_ready: analysisReady,
    review_ready: reviewReady,
    paper_ready: paperReady,
    recommended_next_action: recommendedNextAction,
    blocker_summary: dominantFailure?.summary,
    blocking_reasons: blockingReasons.slice(0, 6),
    warning_reasons: warningReasons.slice(0, 6),
    dominant_failure: dominantFailure
      ? {
          key: dominantFailure.key,
          summary: dominantFailure.summary,
          remediation: dominantFailure.remediation
        }
      : undefined,
    review_gate: {
      status: reviewGateStatus,
      decision_outcome: reviewDecisionOutcome,
      recommended_transition: reviewRecommendedTransition,
      score_overall: reviewScoreOverall,
      operator_label: buildReviewGateOperatorLabel(reviewGateStatus, reviewDecisionOutcome, reviewRecommendedTransition)
    },
    paper_gate: {
      status: resolvePaperGateStatus(paperReadinessState, paperReady),
      readiness_state: paperReadinessState,
      reason: paperReadinessReason,
      operator_label: buildPaperGateOperatorLabel(paperReadinessState, paperReady, paperReadinessReason)
    },
    network_dependency: networkDependency,
    validation_scope: input.validationScope || "full_run"
  };
}

function collectRiskMessages(
  severity: "blocked" | "warning",
  ...artifacts: Array<ReadinessRiskArtifact | undefined>
): string[] {
  const messages = new Set<string>();
  for (const artifact of artifacts) {
    for (const risk of artifact?.risks || []) {
      if (risk.severity === severity && risk.message.trim().length > 0) {
        messages.add(compactOneLine(risk.message, 180) || risk.message);
      }
    }
  }
  return [...messages];
}

function normalizeNetworkDependency(input: {
  policy?: ExperimentNetworkPolicy;
  purpose?: ExperimentNetworkPurpose;
}): RunOperatorStatusArtifact["network_dependency"] {
  const policy = input.policy;
  const purpose = input.purpose;
  if (!policy || policy === "blocked") {
    return {
      enabled: false,
      policy: "blocked",
      severity: "info",
      operator_label: "Offline"
    };
  }
  if (!purpose) {
    return {
      enabled: true,
      policy,
      severity: "blocking",
      operator_label: "Network enabled without declaration"
    };
  }
  if (policy === "required") {
    return {
      enabled: true,
      policy,
      purpose,
      severity: "attention",
      operator_label: `Required network: ${purpose}`
    };
  }
  return {
    enabled: true,
    policy,
    purpose,
    severity: "warning",
    operator_label: `Declared network: ${purpose}`
  };
}

function buildReviewGateOperatorLabel(
  status: RunOperatorStatusArtifact["review_gate"]["status"],
  outcome?: string,
  transition?: string
): string | undefined {
  if (outcome) {
    return transition ? `${outcome} -> ${transition}` : outcome;
  }
  return status;
}

function resolvePaperGateStatus(
  readinessState: string | undefined,
  paperReady: boolean
): RunOperatorStatusArtifact["paper_gate"]["status"] {
  if (!readinessState) {
    return undefined;
  }
  if (paperReady) {
    return "passed";
  }
  if (readinessState === "paper_scale_candidate") {
    return "warning";
  }
  return "blocking";
}

function buildPaperGateOperatorLabel(
  readinessState: string | undefined,
  paperReady: boolean,
  reason?: string
): string | undefined {
  if (!readinessState && !reason) {
    return undefined;
  }
  if (paperReady && readinessState) {
    return readinessState;
  }
  if (readinessState === "blocked_for_paper_scale") {
    return "Paper-readiness stop";
  }
  if (readinessState === "research_memo") {
    return "Research memo";
  }
  if (readinessState) {
    return readinessState;
  }
  return reason;
}

function deriveLifecycleStatus(
  run: RunRecord,
  currentNode: GraphNodeId,
  override?: RunLifecycleStatus
): RunLifecycleStatus {
  if (override) {
    return override;
  }
  const currentStatus = run.graph.nodeStates[currentNode]?.status;
  if (currentStatus === "needs_approval") {
    return "needs_approval";
  }
  return run.status;
}

function deriveRecommendedNextAction(input: {
  run: RunRecord;
  currentNode: GraphNodeId;
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
    (input.lifecycleStatus === "needs_approval" && input.currentNode === "review")
    || (input.analysisReady && !input.reviewReady && (input.currentNode === "analyze_results" || input.currentNode === "review"))
    || (input.reviewReady && !input.paperReady && input.currentNode === "review")
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
  currentNode: GraphNodeId;
  reviewRisks?: ReadinessRiskArtifact;
  paperRisks?: ReadinessRiskArtifact;
  reviewCritique?: ReviewCritiqueProjection;
  paperReadiness?: PaperReadinessProjection;
}): FailureSeed | undefined {
  const runtimeError = compactOneLine(
    input.run.graph.nodeStates[input.currentNode]?.lastError
      || input.run.graph.nodeStates[input.currentNode]?.note,
    180
  );
  if (runtimeError) {
    return {
      key: `runtime:${input.currentNode}`,
      summary: runtimeError,
      remediation: `Inspect the latest ${input.currentNode} artifact or event log before retrying the run.`
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
    // ignore and use fallback
  }
  return fallback;
}

function normalizeReviewGateStatus(
  value: "ready" | "warning" | "blocking" | undefined
): RunOperatorStatusArtifact["review_gate"]["status"] {
  if (value === "ready" || value === "warning" || value === "blocking") {
    return value;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
