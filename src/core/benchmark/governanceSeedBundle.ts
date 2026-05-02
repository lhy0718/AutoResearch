import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureDir, writeJsonFile } from "../../utils/fs.js";

export interface GovernanceSeedBundleFile {
  relative_path: string;
  size_bytes: number;
  mtime_ms: number;
  sha256: string;
}

export interface GovernanceSeedBundleManifest {
  version: 1;
  task_id: string;
  mode: "import" | "reference";
  imported_at: string;
  source_path: string;
  source_mtime_ms: number;
  source_sha256: string;
  output_dir: string;
  files: GovernanceSeedBundleFile[];
}

export interface ImportGovernanceSeedBundleInput {
  cwd: string;
  sourcePath: string;
  taskId?: string;
  outDir?: string;
  referenceOnly?: boolean;
}

export interface ImportGovernanceSeedBundleResult {
  manifestPath: string;
  manifest: GovernanceSeedBundleManifest;
}

export async function importGovernanceSeedBundle(
  input: ImportGovernanceSeedBundleInput
): Promise<ImportGovernanceSeedBundleResult> {
  const cwd = path.resolve(input.cwd);
  const sourcePath = path.resolve(cwd, input.sourcePath);
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
    throw new Error(`Governance seed source must be a file or directory: ${sourcePath}`);
  }

  const files = sourceStat.isDirectory()
    ? await collectDirectoryFiles(sourcePath)
    : [await describeFile(sourcePath, path.basename(sourcePath))];
  const sourceSha256 = hashFileRecords(files);
  const taskId = sanitizeTaskId(input.taskId || inferTaskId(sourcePath));
  const outputRoot = resolveOutputRoot(cwd, input.outDir);
  const bundleDir = path.join(outputRoot, taskId);
  await ensureDir(bundleDir);

  if (!input.referenceOnly) {
    if (sourceStat.isDirectory()) {
      await fs.cp(sourcePath, path.join(bundleDir, "source"), { recursive: true });
    } else {
      await fs.copyFile(sourcePath, path.join(bundleDir, path.basename(sourcePath)));
    }
  }

  const manifest: GovernanceSeedBundleManifest = {
    version: 1,
    task_id: taskId,
    mode: input.referenceOnly ? "reference" : "import",
    imported_at: new Date().toISOString(),
    source_path: sourcePath,
    source_mtime_ms: sourceStat.mtimeMs,
    source_sha256: sourceSha256,
    output_dir: path.relative(cwd, bundleDir).replace(/\\/g, "/"),
    files
  };
  const manifestPath = path.join(bundleDir, "manifest.json");
  await writeJsonFile(manifestPath, manifest);
  return { manifestPath, manifest };
}

function resolveOutputRoot(cwd: string, outDir: string | undefined): string {
  const defaultOutDir = path.join(cwd, "outputs", "governance-benchmark", "seeds");
  const outputRoot = outDir ? path.resolve(cwd, outDir) : defaultOutDir;
  const relative = path.relative(cwd, outputRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Governance seed output directory must stay inside the workspace.");
  }
  return outputRoot;
}

async function collectDirectoryFiles(sourceDir: string): Promise<GovernanceSeedBundleFile[]> {
  const files: GovernanceSeedBundleFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files.push(await describeFile(absolutePath, path.relative(sourceDir, absolutePath)));
    }
  }

  await walk(sourceDir);
  return files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

async function describeFile(absolutePath: string, relativePath: string): Promise<GovernanceSeedBundleFile> {
  const stat = await fs.stat(absolutePath);
  const data = await fs.readFile(absolutePath);
  return {
    relative_path: relativePath.replace(/\\/g, "/"),
    size_bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: crypto.createHash("sha256").update(data).digest("hex")
  };
}

function hashFileRecords(files: GovernanceSeedBundleFile[]): string {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file.relative_path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function inferTaskId(sourcePath: string): string {
  const base = path.basename(sourcePath).replace(/\.[^.]+$/u, "");
  return base || "governance-seed";
}

function sanitizeTaskId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "governance-seed";
}
