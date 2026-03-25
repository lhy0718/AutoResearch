import path from "node:path";
import { promises as fs } from "node:fs";

import { writeRunLiteratureIndex } from "../literatureIndex.js";
import { buildRunsDbFile, RunIndexDatabase, toRunArtifactType } from "../runs/runIndexDatabase.js";
import { RunRecord } from "../../types.js";
import { ensureDir, normalizeFsPath } from "../../utils/fs.js";

const LITERATURE_INDEX_TRIGGER_PATHS = new Set([
  "collect_result.json",
  "corpus.jsonl",
  "bibtex.bib",
  "paper_summaries.jsonl",
  "evidence_store.jsonl"
]);

export function runArtifactsDir(run: RunRecord): string {
  return path.join(".autolabos", "runs", run.id);
}

function resolveRunArtifactPath(run: RunRecord, relativePath: string): string {
  return normalizeFsPath(path.join(runArtifactsDir(run), relativePath));
}

async function writeTextArtifactAtomic(outputPath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(outputPath));
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, outputPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeRunArtifact(run: RunRecord, relativePath: string, content: string): Promise<string> {
  const outputPath = resolveRunArtifactPath(run, relativePath);
  const artifactPath = path.join(runArtifactsDir(run), relativePath);
  await writeTextArtifactAtomic(outputPath, content);
  await syncRunArtifactIndex(run, relativePath, { outputPath, content });
  await syncRunLiteratureIndexIfNeeded(run, relativePath);
  return artifactPath;
}

export async function appendJsonl(run: RunRecord, relativePath: string, items: unknown[]): Promise<string> {
  const outputPath = resolveRunArtifactPath(run, relativePath);
  const artifactPath = path.join(runArtifactsDir(run), relativePath);
  const lines = items.map((item) => JSON.stringify(item)).join("\n");
  const trailing = lines ? `${lines}\n` : "";
  await writeTextArtifactAtomic(outputPath, trailing);
  await syncRunArtifactIndex(run, relativePath, { outputPath, lineCount: items.length });
  await syncRunLiteratureIndexIfNeeded(run, relativePath);
  return artifactPath;
}

export async function appendJsonlItems(run: RunRecord, relativePath: string, items: unknown[]): Promise<string> {
  const outputPath = resolveRunArtifactPath(run, relativePath);
  const artifactPath = path.join(runArtifactsDir(run), relativePath);
  await ensureDir(path.dirname(outputPath));
  const lines = items.map((item) => JSON.stringify(item)).join("\n");
  if (!lines) {
    return artifactPath;
  }
  await fs.appendFile(outputPath, `${lines}\n`, "utf8");
  const indexedLineCount = await readIndexedJsonlLineCount(run.id, outputPath);
  const lineCount = indexedLineCount == null ? await countJsonlLines(outputPath) : indexedLineCount + items.length;
  await syncRunArtifactIndex(run, relativePath, { outputPath, lineCount });
  await syncRunLiteratureIndexIfNeeded(run, relativePath);
  return artifactPath;
}

export async function syncRunLiteratureIndex(run: RunRecord): Promise<void> {
  await writeRunLiteratureIndex(process.cwd(), run.id);
}

export async function safeRead(filePath: string): Promise<string> {
  try {
    return await fs.readFile(normalizeFsPath(filePath), "utf8");
  } catch {
    return "";
  }
}

async function syncRunLiteratureIndexIfNeeded(run: RunRecord, relativePath: string): Promise<void> {
  if (!LITERATURE_INDEX_TRIGGER_PATHS.has(relativePath)) {
    return;
  }
  await syncRunLiteratureIndex(run);
}

interface ArtifactIndexInput {
  outputPath: string;
  content?: string;
  lineCount?: number;
}

interface RunArtifactIndexMetadata {
  relativePath: string;
  kind: "json" | "jsonl" | "text";
  byteSize: number;
  lineCount?: number;
  topLevelKeys?: string[];
}

async function syncRunArtifactIndex(
  run: RunRecord,
  relativePath: string,
  input: ArtifactIndexInput
): Promise<void> {
  const runIndex = new RunIndexDatabase(buildRunsDbFile(path.join(process.cwd(), ".autolabos", "runs")));
  try {
    const stat = await fs.stat(input.outputPath);
    runIndex.upsertRunArtifact({
      runId: run.id,
      artifactType: toRunArtifactType(relativePath),
      filePath: input.outputPath,
      updatedAt: stat.mtime.toISOString(),
      metadataJson: JSON.stringify(buildArtifactIndexMetadata(relativePath, stat.size, input))
    });
  } finally {
    runIndex.close();
  }
}

async function readIndexedJsonlLineCount(runId: string, outputPath: string): Promise<number | undefined> {
  const runIndex = new RunIndexDatabase(buildRunsDbFile(path.join(process.cwd(), ".autolabos", "runs")));
  try {
    const artifact = runIndex.getRunArtifactByPath(runId, outputPath);
    if (!artifact?.metadataJson) {
      return undefined;
    }
    const parsed = JSON.parse(artifact.metadataJson) as RunArtifactIndexMetadata;
    return typeof parsed.lineCount === "number" && Number.isFinite(parsed.lineCount) ? parsed.lineCount : undefined;
  } catch {
    return undefined;
  } finally {
    runIndex.close();
  }
}

async function countJsonlLines(outputPath: string): Promise<number> {
  const raw = await fs.readFile(outputPath, "utf8");
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function buildArtifactIndexMetadata(
  relativePath: string,
  byteSize: number,
  input: ArtifactIndexInput
): RunArtifactIndexMetadata {
  const kind = detectArtifactKind(relativePath);
  const metadata: RunArtifactIndexMetadata = {
    relativePath: relativePath.replace(/\\/g, "/"),
    kind,
    byteSize
  };
  if (kind === "jsonl" && typeof input.lineCount === "number" && Number.isFinite(input.lineCount)) {
    metadata.lineCount = input.lineCount;
  }
  if (kind === "json" && input.content) {
    const parsed = parseJsonTopLevelKeys(input.content);
    if (parsed.length > 0) {
      metadata.topLevelKeys = parsed;
    }
  }
  return metadata;
}

function detectArtifactKind(relativePath: string): "json" | "jsonl" | "text" {
  if (relativePath.endsWith(".jsonl")) {
    return "jsonl";
  }
  if (relativePath.endsWith(".json")) {
    return "json";
  }
  return "text";
}

function parseJsonTopLevelKeys(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.keys(parsed).slice(0, 20);
  } catch {
    return [];
  }
}
