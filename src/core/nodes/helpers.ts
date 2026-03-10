import path from "node:path";
import { promises as fs } from "node:fs";

import { RunRecord } from "../../types.js";
import { ensureDir } from "../../utils/fs.js";

export function runArtifactsDir(run: RunRecord): string {
  return path.join(".autolabos", "runs", run.id);
}

export async function writeRunArtifact(run: RunRecord, relativePath: string, content: string): Promise<string> {
  const outputPath = path.join(runArtifactsDir(run), relativePath);
  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, content, "utf8");
  return outputPath;
}

export async function appendJsonl(run: RunRecord, relativePath: string, items: unknown[]): Promise<string> {
  const outputPath = path.join(runArtifactsDir(run), relativePath);
  await ensureDir(path.dirname(outputPath));
  const lines = items.map((item) => JSON.stringify(item)).join("\n");
  const trailing = lines ? `${lines}\n` : "";
  await fs.writeFile(outputPath, trailing, "utf8");
  return outputPath;
}

export async function appendJsonlItems(run: RunRecord, relativePath: string, items: unknown[]): Promise<string> {
  const outputPath = path.join(runArtifactsDir(run), relativePath);
  await ensureDir(path.dirname(outputPath));
  const lines = items.map((item) => JSON.stringify(item)).join("\n");
  if (!lines) {
    return outputPath;
  }
  await fs.appendFile(outputPath, `${lines}\n`, "utf8");
  return outputPath;
}

export async function safeRead(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
