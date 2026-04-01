import path from "node:path";

export const RUN_RECORD_FILE = "run_record.json";
export const RUN_EVENTS_FILE = "events.jsonl";
export const RUN_CHECKPOINTS_DIR = "checkpoints";

export function buildRunRootPath(runsDir: string, runId: string): string {
  return path.join(runsDir, runId);
}

export function buildRunRecordPath(runsDir: string, runId: string): string {
  return path.join(buildRunRootPath(runsDir, runId), RUN_RECORD_FILE);
}

export function buildRunEventsPath(runsDir: string, runId: string): string {
  return path.join(buildRunRootPath(runsDir, runId), RUN_EVENTS_FILE);
}

export function buildRunCheckpointsDirPath(runsDir: string, runId: string): string {
  return path.join(buildRunRootPath(runsDir, runId), RUN_CHECKPOINTS_DIR);
}

export function buildWorkspaceRunsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".autolabos", "runs");
}

export function buildWorkspaceRunRoot(workspaceRoot: string, runId: string): string {
  return buildRunRootPath(buildWorkspaceRunsDir(workspaceRoot), runId);
}
