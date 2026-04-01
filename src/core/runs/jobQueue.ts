import path from "node:path";
import { promises as fs } from "node:fs";

import type { GraphNodeId, RunQueueJobSummary, RunQueueRecommendedAction, RunQueueSnapshot, RunRecord } from "../../types.js";
import { buildWorkspaceRunRoot } from "./runPaths.js";

const STALLED_CHECKPOINT_WINDOW_MS = 10 * 60 * 1000;

interface CollectBackgroundJobArtifact {
  version?: number;
  kind?: string;
  status?: string;
  runId?: string;
  scheduledAt?: string;
  updatedAt?: string;
}

export async function buildRunQueueSnapshot(input: {
  workspaceRoot: string;
  runs: RunRecord[];
  now?: Date;
}): Promise<RunQueueSnapshot> {
  const now = input.now ?? new Date();
  const running: RunQueueJobSummary[] = [];
  const waiting: RunQueueJobSummary[] = [];
  const stalled: RunQueueJobSummary[] = [];

  for (const run of input.runs) {
    const runDir = buildWorkspaceRunRoot(input.workspaceRoot, run.id);
    const currentNode = run.currentNode;
    const nodeState = run.graph.nodeStates[currentNode];
    const latestCheckpointAt = await readLatestCheckpointTimestamp(runDir);
    const backgroundJob = await readCollectBackgroundJob(runDir);

    const runJob = buildRunNodeQueueSummary({
      run,
      node: currentNode,
      nodeUpdatedAt: nodeState?.updatedAt || run.updatedAt,
      nodeStatus: nodeState?.status || run.status,
      latestCheckpointAt,
      now
    });
    if (runJob) {
      if (runJob.bucket === "stalled") {
        stalled.push(runJob.summary);
      } else if (runJob.bucket === "running") {
        running.push(runJob.summary);
      } else {
        waiting.push(runJob.summary);
      }
    }

    const backgroundSummary = buildCollectBackgroundQueueSummary({
      run,
      backgroundJob,
      latestCheckpointAt,
      now,
      skipBecauseActiveCollect: currentNode === "collect_papers" && nodeState?.status === "running"
    });
    if (backgroundSummary) {
      if (backgroundSummary.bucket === "stalled") {
        stalled.push(backgroundSummary.summary);
      } else {
        running.push(backgroundSummary.summary);
      }
    }
  }

  const byStartedAtDesc = (left: RunQueueJobSummary, right: RunQueueJobSummary) =>
    Date.parse(right.started_at) - Date.parse(left.started_at);

  return {
    running: running.sort(byStartedAtDesc),
    waiting: waiting.sort(byStartedAtDesc),
    stalled: stalled.sort(byStartedAtDesc)
  };
}

function buildRunNodeQueueSummary(input: {
  run: RunRecord;
  node: GraphNodeId;
  nodeUpdatedAt: string;
  nodeStatus: string;
  latestCheckpointAt?: string;
  now: Date;
}): { bucket: "running" | "waiting" | "stalled"; summary: RunQueueJobSummary } | undefined {
  if (input.nodeStatus === "running") {
    const startedAt = normalizeTimestamp(input.nodeUpdatedAt) || input.run.updatedAt;
    const isStalled = isCheckpointStalled({
      startedAt,
      latestCheckpointAt: input.latestCheckpointAt,
      now: input.now
    });
    const summary: RunQueueJobSummary = {
      run_id: input.run.id,
      node: input.node,
      status: "running",
      started_at: startedAt,
      elapsed_seconds: elapsedSeconds(startedAt, input.now),
      source: "run"
    };
    if (isStalled) {
      const recommendation = deriveStalledRecommendation(input.run, input.node);
      summary.recommended_action = recommendation;
      summary.recommendation_line = recommendation === "retry"
        ? "Recommended action: retry."
        : "Recommended action: manual review.";
      return { bucket: "stalled", summary };
    }
    return { bucket: "running", summary };
  }

  if (input.nodeStatus === "needs_approval" || input.nodeStatus === "pending") {
    const startedAt = normalizeTimestamp(input.nodeUpdatedAt) || input.run.updatedAt;
    return {
      bucket: "waiting",
      summary: {
        run_id: input.run.id,
        node: input.node,
        status: input.nodeStatus,
        started_at: startedAt,
        elapsed_seconds: elapsedSeconds(startedAt, input.now),
        source: "run"
      }
    };
  }

  return undefined;
}

function buildCollectBackgroundQueueSummary(input: {
  run: RunRecord;
  backgroundJob?: CollectBackgroundJobArtifact;
  latestCheckpointAt?: string;
  now: Date;
  skipBecauseActiveCollect: boolean;
}): { bucket: "running" | "stalled"; summary: RunQueueJobSummary } | undefined {
  if (input.skipBecauseActiveCollect) {
    return undefined;
  }
  const job = input.backgroundJob;
  if (!job || job.status !== "running") {
    return undefined;
  }
  const startedAt = normalizeTimestamp(job.scheduledAt) || normalizeTimestamp(job.updatedAt) || input.run.updatedAt;
  const isStalled = isCheckpointStalled({
    startedAt,
    latestCheckpointAt: normalizeTimestamp(job.updatedAt) || input.latestCheckpointAt,
    now: input.now
  });
  const summary: RunQueueJobSummary = {
    run_id: input.run.id,
    node: "collect_papers",
    status: "running",
    started_at: startedAt,
    elapsed_seconds: elapsedSeconds(startedAt, input.now),
    source: "collect_background_job"
  };
  if (isStalled) {
    const recommendation = deriveStalledRecommendation(input.run, "collect_papers");
    summary.recommended_action = recommendation;
    summary.recommendation_line = recommendation === "retry"
      ? "Recommended action: retry."
      : "Recommended action: manual review.";
    return { bucket: "stalled", summary };
  }
  return { bucket: "running", summary };
}

function deriveStalledRecommendation(run: RunRecord, node: GraphNodeId): RunQueueRecommendedAction {
  const attempts = run.graph.retryCounters[node] ?? 0;
  return attempts < run.graph.retryPolicy.maxAttemptsPerNode ? "retry" : "manual review";
}

function isCheckpointStalled(input: {
  startedAt: string;
  latestCheckpointAt?: string;
  now: Date;
}): boolean {
  const baseline = normalizeTimestamp(input.latestCheckpointAt) || normalizeTimestamp(input.startedAt);
  if (!baseline) {
    return false;
  }
  return input.now.getTime() - Date.parse(baseline) > STALLED_CHECKPOINT_WINDOW_MS;
}

function elapsedSeconds(startedAt: string, now: Date): number {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

async function readLatestCheckpointTimestamp(runDir: string): Promise<string | undefined> {
  try {
    const latestRaw = await fs.readFile(path.join(runDir, "checkpoints", "latest.json"), "utf8");
    const latest = JSON.parse(latestRaw) as { createdAt?: string };
    return normalizeTimestamp(latest.createdAt);
  } catch {
    return undefined;
  }
}

async function readCollectBackgroundJob(runDir: string): Promise<CollectBackgroundJobArtifact | undefined> {
  try {
    const raw = await fs.readFile(path.join(runDir, "collect_background_job.json"), "utf8");
    const parsed = JSON.parse(raw) as CollectBackgroundJobArtifact;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // ignore malformed / missing here; harness remains the structural validator
  }
  return undefined;
}
