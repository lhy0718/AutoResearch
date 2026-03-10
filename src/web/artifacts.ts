import path from "node:path";
import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";

import { AppPaths } from "../config.js";
import { ArtifactEntry } from "../types.js";

export async function listRunArtifacts(paths: AppPaths, runId: string): Promise<ArtifactEntry[]> {
  const root = resolveRunArtifactsRoot(paths, runId);
  const entries: ArtifactEntry[] = [];
  await walkArtifacts(root, "", entries);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readRunArtifact(
  paths: AppPaths,
  runId: string,
  relativePath: string
): Promise<{
  entry: ArtifactEntry;
  absolutePath: string;
  contentType: string;
  data: Buffer;
}> {
  const absolutePath = resolveRunArtifactPath(paths, runId, relativePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("Artifact is not a file.");
  }
  const entry = buildArtifactEntry(relativePath, stat);
  return {
    entry,
    absolutePath,
    contentType: contentTypeForPath(relativePath, entry.kind),
    data: await fs.readFile(absolutePath)
  };
}

export function resolveRunArtifactPath(paths: AppPaths, runId: string, relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid artifact path.");
  }
  const root = resolveRunArtifactsRoot(paths, runId);
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    throw new Error("Artifact path escapes the run directory.");
  }
  return resolved;
}

function resolveRunArtifactsRoot(paths: AppPaths, runId: string): string {
  return path.join(paths.runsDir, runId);
}

async function walkArtifacts(root: string, relativeDir: string, out: ArtifactEntry[]): Promise<void> {
  const absoluteDir = path.join(root, relativeDir);
  let items: Dirent[];
  try {
    items = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    const relativePath = relativeDir ? path.posix.join(relativeDir, item.name) : item.name;
    const absolutePath = path.join(root, relativePath);
    const stat = await fs.stat(absolutePath);
    if (item.isDirectory()) {
      out.push({
        path: relativePath,
        kind: "directory",
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        previewable: false
      });
      await walkArtifacts(root, relativePath, out);
      continue;
    }
    out.push(buildArtifactEntry(relativePath, stat));
  }
}

function buildArtifactEntry(relativePath: string, stat: { size: number; mtime: Date }): ArtifactEntry {
  const kind = artifactKind(relativePath);
  return {
    path: relativePath,
    kind,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    previewable: kind !== "download"
  };
}

function artifactKind(relativePath: string): ArtifactEntry["kind"] {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return lower.endsWith(".json") || lower.endsWith(".jsonl") ? "json" : "text";
  }
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".tex") ||
    lower.endsWith(".bib") ||
    lower.endsWith(".md") ||
    lower.endsWith(".log") ||
    lower.endsWith(".py")
  ) {
    return "text";
  }
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp")) {
    return "image";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  return "download";
}

function contentTypeForPath(relativePath: string, kind: ArtifactEntry["kind"]): string {
  switch (kind) {
    case "json":
      return relativePath.toLowerCase().endsWith(".jsonl") ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8";
    case "text":
      return "text/plain; charset=utf-8";
    case "image":
      if (relativePath.toLowerCase().endsWith(".png")) {
        return "image/png";
      }
      if (relativePath.toLowerCase().endsWith(".gif")) {
        return "image/gif";
      }
      if (relativePath.toLowerCase().endsWith(".webp")) {
        return "image/webp";
      }
      return "image/jpeg";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
