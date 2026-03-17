import path from "node:path";

import { RunRecord } from "../types.js";

export type PublicRunOutputSection = "experiment" | "analysis" | "review" | "paper" | "results" | "reproduce";

export function buildPublicRunOutputDir(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): string {
  const slug = sanitizeSlug(run.title) || "run";
  return path.join(workspaceRoot, "outputs", `${slug}-${run.id.slice(0, 8)}`);
}

export function buildPublicExperimentDir(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): string {
  return path.join(buildPublicRunOutputDir(workspaceRoot, run), "experiment");
}

export function buildPublicPaperDir(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): string {
  return path.join(buildPublicRunOutputDir(workspaceRoot, run), "paper");
}

export function buildPublicAnalysisDir(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): string {
  return path.join(buildPublicRunOutputDir(workspaceRoot, run), "analysis");
}

export function buildPublicReviewDir(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): string {
  return path.join(buildPublicRunOutputDir(workspaceRoot, run), "review");
}

export function buildPublicRunManifestPath(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): string {
  return path.join(buildPublicRunOutputDir(workspaceRoot, run), "manifest.json");
}

export function buildPublicSectionDir(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">,
  section: PublicRunOutputSection
): string {
  switch (section) {
    case "experiment":
      return buildPublicExperimentDir(workspaceRoot, run);
    case "analysis":
      return buildPublicAnalysisDir(workspaceRoot, run);
    case "review":
      return buildPublicReviewDir(workspaceRoot, run);
    case "paper":
      return buildPublicPaperDir(workspaceRoot, run);
    case "results":
      return path.join(buildPublicRunOutputDir(workspaceRoot, run), "results");
    case "reproduce":
      return path.join(buildPublicRunOutputDir(workspaceRoot, run), "reproduce");
  }
}

export function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
