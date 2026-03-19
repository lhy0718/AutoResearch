import path from "node:path";
import { promises as fs } from "node:fs";

import { RunRecord } from "../types.js";
import { ensureDir, fileExists, writeJsonFile } from "../utils/fs.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import {
  buildPublicRunManifestPath,
  buildPublicRunOutputDir,
  buildPublicSectionDir,
  PublicRunOutputSection
} from "./publicArtifacts.js";

export interface PublicRunManifestSection {
  dir: string;
  generated_files: string[];
  updated_at: string;
}

export interface PublicRunManifest {
  version: 1;
  run_id: string;
  title: string;
  output_root: string;
  sections: Partial<Record<PublicRunOutputSection, PublicRunManifestSection>>;
  workspace_changed_files: string[];
  generated_files: string[];
  updated_at: string;
}

export interface PublishPublicRunOutputFile {
  sourcePath: string;
  targetRelativePath?: string;
  optional?: boolean;
}

export interface PublishPublicRunOutputsInput {
  workspaceRoot: string;
  run: Pick<RunRecord, "id" | "title">;
  section: PublicRunOutputSection;
  files: PublishPublicRunOutputFile[];
  workspaceChangedFiles?: string[];
  runContext?: RunContextMemory;
}

export interface PublishPublicRunOutputsResult {
  outputRoot: string;
  outputRootRelative: string;
  sectionDir: string;
  sectionDirRelative: string;
  manifestPath: string;
  manifestPathRelative: string;
  generatedFiles: string[];
  workspaceChangedFiles: string[];
  firstPublished: boolean;
}

export async function publishPublicRunOutputs(
  input: PublishPublicRunOutputsInput
): Promise<PublishPublicRunOutputsResult> {
  const outputRoot = buildPublicRunOutputDir(input.workspaceRoot, input.run);
  const manifestPath = buildPublicRunManifestPath(input.workspaceRoot, input.run);
  const existingManifest = await loadStoredPublicRunManifest(manifestPath);
  if (existingManifest?.run_id && existingManifest.run_id !== input.run.id) {
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
  const sectionDir = buildPublicSectionDir(input.workspaceRoot, input.run, input.section);
  await ensureDir(sectionDir);

  const now = new Date().toISOString();
  const manifest = await loadPublicRunManifest(manifestPath, input.workspaceRoot, input.run);
  const previousSection = manifest.sections[input.section];

  for (const file of input.files) {
    const sourcePath = resolveWorkspacePath(input.workspaceRoot, file.sourcePath);
    const defaultTargetPath = isPathInsideOrEqual(sourcePath, sectionDir)
      ? normalizeRelativePath(path.relative(sectionDir, sourcePath))
      : path.basename(sourcePath);
    const targetRelativePath = normalizeRelativePath(
      path.join(input.section, file.targetRelativePath || defaultTargetPath)
    );
    const targetPath = path.join(outputRoot, targetRelativePath);
    const sourceExists = await fileExists(sourcePath);

    if (!sourceExists) {
      if (await fileExists(targetPath)) {
        await fs.rm(targetPath, { force: true });
      }
      continue;
    }

    await ensureDir(path.dirname(targetPath));
    if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
  const sectionFiles = await listSectionFiles(sectionDir, outputRoot);

  const normalizedWorkspaceChangedFiles = normalizeWorkspaceChangedFiles(
    input.workspaceChangedFiles || [],
    input.workspaceRoot,
    outputRoot
  );

  manifest.sections[input.section] = {
    dir: normalizeRelativePath(path.relative(input.workspaceRoot, sectionDir)),
    generated_files: sectionFiles,
    updated_at: now
  };
  manifest.workspace_changed_files = normalizedWorkspaceChangedFiles;
  manifest.generated_files = collectGeneratedFiles(manifest.sections);
  manifest.updated_at = now;
  await writeJsonFile(manifestPath, manifest);

  if (input.runContext) {
    await input.runContext.put("public_outputs.root", normalizeRelativePath(path.relative(input.workspaceRoot, outputRoot)));
    await input.runContext.put("public_outputs.manifest", normalizeRelativePath(path.relative(input.workspaceRoot, manifestPath)));
    await input.runContext.put(
      `public_outputs.${input.section}_dir`,
      normalizeRelativePath(path.relative(input.workspaceRoot, sectionDir))
    );
  }

  return {
    outputRoot,
    outputRootRelative: normalizeRelativePath(path.relative(input.workspaceRoot, outputRoot)),
    sectionDir,
    sectionDirRelative: normalizeRelativePath(path.relative(input.workspaceRoot, sectionDir)),
    manifestPath,
    manifestPathRelative: normalizeRelativePath(path.relative(input.workspaceRoot, manifestPath)),
    generatedFiles: sectionFiles,
    workspaceChangedFiles: normalizedWorkspaceChangedFiles,
    firstPublished: (previousSection?.generated_files.length || 0) === 0 && sectionFiles.length > 0
  };
}

async function loadPublicRunManifest(
  manifestPath: string,
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): Promise<PublicRunManifest> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as PublicRunManifest;
    if (parsed && parsed.version === 1 && parsed.run_id === run.id) {
      return {
        ...parsed,
        title: run.title,
        output_root: normalizeRelativePath(path.relative(workspaceRoot, buildPublicRunOutputDir(workspaceRoot, run)))
      };
    }
  } catch {
    // ignore invalid or missing manifest
  }

  return {
    version: 1,
    run_id: run.id,
    title: run.title,
    output_root: normalizeRelativePath(path.relative(workspaceRoot, buildPublicRunOutputDir(workspaceRoot, run))),
    sections: {},
    workspace_changed_files: [],
    generated_files: [],
    updated_at: new Date(0).toISOString()
  };
}

function collectGeneratedFiles(
  sections: Partial<Record<PublicRunOutputSection, PublicRunManifestSection>>
): string[] {
  const generated = new Set<string>();
  for (const section of Object.values(sections)) {
    if (!section) {
      continue;
    }
    for (const filePath of section.generated_files) {
      generated.add(normalizeRelativePath(filePath));
    }
  }
  return [...generated].sort();
}

function normalizeWorkspaceChangedFiles(
  filePaths: string[],
  workspaceRoot: string,
  outputRoot: string
): string[] {
  const outputsDir = path.join(workspaceRoot, "outputs");
  return [...new Set(filePaths.map((filePath) => resolveWorkspacePath(workspaceRoot, filePath)))]
    .filter((filePath) => isPathInsideOrEqual(filePath, workspaceRoot))
    .filter((filePath) => !isPathInsideOrEqual(filePath, path.join(workspaceRoot, ".autolabos")))
    .filter((filePath) => !isPathInsideOrEqual(filePath, outputsDir))
    .filter((filePath) => !isPathInsideOrEqual(filePath, outputRoot))
    .map((filePath) => normalizeRelativePath(path.relative(workspaceRoot, filePath)))
    .sort();
}

async function listSectionFiles(sectionDir: string, outputRoot: string): Promise<string[]> {
  const collected = new Set<string>();
  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => undefined);
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      collected.add(normalizeRelativePath(path.relative(outputRoot, absolutePath)));
    }
  }

  await walk(sectionDir);
  return [...collected].sort();
}

function resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isPathInsideOrEqual(filePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Generate a user-facing README.md for the public output bundle.
 * Called after all sections have been published.
 */
export async function generatePublicRunReadme(
  workspaceRoot: string,
  run: Pick<RunRecord, "id" | "title">
): Promise<string> {
  const outputRoot = buildPublicRunOutputDir(workspaceRoot, run);
  const manifestPath = buildPublicRunManifestPath(workspaceRoot, run);
  const manifest = await loadPublicRunManifest(manifestPath, workspaceRoot, run);

  const lines: string[] = [
    `# ${run.title || "Research Run"}`,
    "",
    `**Run ID:** \`${run.id}\``,
    `**Generated by:** AutoLabOS`,
    `**Last updated:** ${manifest.updated_at}`,
    "",
    "## Contents",
    ""
  ];

  const sectionDescriptions: Record<string, string> = {
    experiment: "Experiment design, plans, and baseline summaries",
    analysis: "Result analysis, tables, and transition recommendations",
    review: "Paper-quality evaluation, evidence gap reports, and review artifacts",
    paper: "Manuscript TeX source, PDF output, traceability, and provenance",
    results: "Compact quantitative result summaries",
    reproduce: "Reproduction scripts and notes"
  };

  for (const [section, info] of Object.entries(manifest.sections)) {
    if (!info || info.generated_files.length === 0) continue;
    const desc = sectionDescriptions[section] || section;
    lines.push(`### ${section}/`);
    lines.push(`${desc}`);
    lines.push("");
    for (const f of info.generated_files) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  lines.push("## Reproduction");
  lines.push("");
  lines.push("To reproduce this run:");
  lines.push("1. Install AutoLabOS: `npm install`");
  lines.push("2. Ensure the same API keys and environment are configured");
  lines.push(`3. The research brief and experiment plan used are in the \`experiment/\` section`);
  lines.push("4. Result artifacts and analysis are in the `analysis/` section");
  lines.push("");

  const readmePath = path.join(outputRoot, "README.md");
  const content = lines.join("\n");
  await ensureDir(outputRoot);
  await fs.writeFile(readmePath, content, "utf8");

  return readmePath;
}

async function loadStoredPublicRunManifest(manifestPath: string): Promise<PublicRunManifest | undefined> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as PublicRunManifest;
    if (parsed && parsed.version === 1 && typeof parsed.run_id === "string") {
      return parsed;
    }
  } catch {
    // ignore invalid or missing manifest
  }
  return undefined;
}
