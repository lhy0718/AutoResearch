import path from "node:path";
import { promises as fs } from "node:fs";

import { writeRunLiteratureIndex } from "../literatureIndex.js";
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
  await syncRunLiteratureIndexIfNeeded(run, relativePath);
  return artifactPath;
}

export async function appendJsonl(run: RunRecord, relativePath: string, items: unknown[]): Promise<string> {
  const outputPath = resolveRunArtifactPath(run, relativePath);
  const artifactPath = path.join(runArtifactsDir(run), relativePath);
  const lines = items.map((item) => JSON.stringify(item)).join("\n");
  const trailing = lines ? `${lines}\n` : "";
  await writeTextArtifactAtomic(outputPath, trailing);
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
