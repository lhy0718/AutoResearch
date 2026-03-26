import path from "node:path";
import { promises as fs } from "node:fs";

import { resolveAppPaths } from "../config.js";

export interface ArtifactCommandRef {
  label: string;
  path: string;
}

export interface ParsedArtifactSlashArgs {
  relativePath?: string;
  runQuery?: string;
  error?: string;
  usage: string;
}

export interface RunArtifactPreviewResult {
  ok: boolean;
  lines: string[];
  reason?: string;
}

const ARTIFACT_USAGE = "Usage: /artifact <path> [--run <run>]";
const JSON_EXTENSIONS = new Set([".json"]);
const PREVIEWABLE_TEXT_EXTENSIONS = new Set([
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".txt",
  ".tex",
  ".bib",
  ".md",
  ".log",
  ".py"
]);

export function parseArtifactSlashArgs(args: string[]): ParsedArtifactSlashArgs {
  let runQuery: string | undefined;
  const pathParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--run") {
      const next = args[index + 1];
      if (!next) {
        return {
          error: ARTIFACT_USAGE,
          usage: ARTIFACT_USAGE
        };
      }
      runQuery = next;
      index += 1;
      continue;
    }
    pathParts.push(token);
  }

  const relativePath = pathParts.join(" ").trim() || undefined;
  return {
    relativePath,
    runQuery,
    usage: ARTIFACT_USAGE
  };
}

export function formatArtifactSlashCommand(relativePath: string): string {
  return `/artifact ${quoteSlashArg(relativePath)}`;
}

export function buildArtifactCommandHintLines(refs: ArtifactCommandRef[], maxRefs = 2): string[] {
  return refs.slice(0, maxRefs).map((ref) => `${ref.label}: ${formatArtifactSlashCommand(ref.path)}`);
}

export async function previewRunArtifact(input: {
  workspaceRoot: string;
  runId: string;
  relativePath: string;
  maxLines?: number;
  maxLineLength?: number;
}): Promise<RunArtifactPreviewResult> {
  const maxLines = Math.max(4, input.maxLines ?? 12);
  const maxLineLength = Math.max(80, input.maxLineLength ?? 200);

  let absolutePath: string;
  try {
    absolutePath = resolveRunArtifactPath(input.workspaceRoot, input.runId, input.relativePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid artifact path.";
    return {
      ok: false,
      reason,
      lines: [reason, ARTIFACT_USAGE]
    };
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return {
        ok: false,
        reason: "Artifact is not a file.",
        lines: ["Artifact is not a file.", ARTIFACT_USAGE]
      };
    }
  } catch {
    return {
      ok: false,
      reason: "Artifact not found.",
      lines: [`Artifact not found: ${input.relativePath}`, ARTIFACT_USAGE]
    };
  }

  const extension = path.extname(input.relativePath).toLowerCase();
  if (!PREVIEWABLE_TEXT_EXTENSIONS.has(extension)) {
    const fileType = describeArtifactType(extension);
    return {
      ok: true,
      lines: [
        `Artifact preview (${input.runId}): ${input.relativePath}`,
        `  Preview unavailable for ${fileType} artifacts in the TUI.`,
        "  Use the web artifact panel when you need the full binary or rendered view."
      ]
    };
  }

  const raw = await fs.readFile(absolutePath, "utf8");
  const formatted = normalizePreviewText(input.relativePath, raw);
  const contentLines = formatted.split(/\r?\n/u);
  const previewBody = contentLines.slice(0, maxLines).map((line) => `  ${truncateLine(line, maxLineLength)}`);
  if (previewBody.length === 0) {
    previewBody.push("  <empty file>");
  }
  if (contentLines.length > maxLines) {
    previewBody.push(`  ... truncated after ${maxLines} line(s).`);
  }

  return {
    ok: true,
    lines: [`Artifact preview (${input.runId}): ${input.relativePath}`, ...previewBody]
  };
}

function quoteSlashArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/u.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function describeArtifactType(extension: string): string {
  switch (extension) {
    case ".pdf":
      return "PDF";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".svg":
      return "image";
    default:
      return "binary";
  }
}

function normalizePreviewText(relativePath: string, raw: string): string {
  if (JSON_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    try {
      return `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
    } catch {
      return raw;
    }
  }
  return raw;
}

function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength - 3)}...`;
}

function resolveRunArtifactPath(workspaceRoot: string, runId: string, relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\/+/u, "");
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid artifact path.");
  }
  const root = path.resolve(resolveAppPaths(workspaceRoot).runsDir, runId);
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new Error("Artifact path escapes the run directory.");
  }
  return resolved;
}
