import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { ensureDir, normalizeFsPath } from "../../utils/fs.js";

const execFile = promisify(execFileCallback);

export interface HarnessApplyResult {
  applied: boolean;
  targetFile: string;
  gitCommitBefore: string | null;
  validationPassed: boolean;
  rolledBack: boolean;
  rollbackReason: string | null;
  auditLogPath: string;
}

export interface HarnessApplyOptions {
  targetFile: string;
  newContent: string;
  source: "meta-harness" | "shadow-eval";
  candidateId: string | null;
  scoreBefore: number | null;
  dryRun?: boolean;
}

interface HarnessApplierDeps {
  runValidateHarness: (cwd: string) => Promise<void>;
  gitRevParseHead: (cwd: string) => Promise<string | null>;
  gitAdd: (cwd: string, targetFile: string) => Promise<void>;
  gitCommit: (cwd: string, message: string) => Promise<void>;
}

export async function applyWithSafetyNet(
  options: HarnessApplyOptions,
  deps: Partial<HarnessApplierDeps> = {}
): Promise<HarnessApplyResult> {
  const targetFile = normalizeFsPath(options.targetFile);
  const workspaceRoot = findWorkspaceRoot(targetFile);
  const promptsRoot = normalizeFsPath(path.join(workspaceRoot, "node-prompts"));
  if (!isWithinDirectory(targetFile, promptsRoot)) {
    throw new Error("Harness targetFile must stay inside node-prompts/.");
  }

  const auditLogPath = normalizeFsPath(path.join(workspaceRoot, ".autolabos", "harness-apply-log.jsonl"));
  const resolvedDeps: HarnessApplierDeps = {
    runValidateHarness: defaultRunValidateHarness,
    gitRevParseHead: defaultGitRevParseHead,
    gitAdd: defaultGitAdd,
    gitCommit: defaultGitCommit,
    ...deps
  };

  const gitCommitBefore = await resolvedDeps.gitRevParseHead(workspaceRoot);
  if (options.dryRun) {
    const result: HarnessApplyResult = {
      applied: false,
      targetFile,
      gitCommitBefore,
      validationPassed: false,
      rolledBack: false,
      rollbackReason: null,
      auditLogPath
    };
    await appendAuditLog(auditLogPath, {
      timestamp: new Date().toISOString(),
      source: options.source,
      node: path.basename(targetFile, ".md"),
      target_file: targetFile,
      applied: false,
      validation_passed: false,
      rolled_back: false,
      rollback_reason: null,
      candidate_id: options.candidateId,
      score_before: options.scoreBefore
    });
    return result;
  }

  const previousContent = await fs.readFile(targetFile, "utf8");
  await fs.writeFile(targetFile, options.newContent, "utf8");

  try {
    await resolvedDeps.runValidateHarness(workspaceRoot);
    await resolvedDeps.gitAdd(workspaceRoot, targetFile);
    await resolvedDeps.gitCommit(
      workspaceRoot,
      `chore(harness): auto-apply ${options.source} → ${path.basename(targetFile, ".md")}`
    );
    const result: HarnessApplyResult = {
      applied: true,
      targetFile,
      gitCommitBefore,
      validationPassed: true,
      rolledBack: false,
      rollbackReason: null,
      auditLogPath
    };
    await appendAuditLog(auditLogPath, {
      timestamp: new Date().toISOString(),
      source: options.source,
      node: path.basename(targetFile, ".md"),
      target_file: targetFile,
      applied: true,
      validation_passed: true,
      rolled_back: false,
      rollback_reason: null,
      candidate_id: options.candidateId,
      score_before: options.scoreBefore
    });
    return result;
  } catch (error) {
    await fs.writeFile(targetFile, previousContent, "utf8");
    const rollbackReason = error instanceof Error ? error.message : String(error);
    const result: HarnessApplyResult = {
      applied: false,
      targetFile,
      gitCommitBefore,
      validationPassed: false,
      rolledBack: true,
      rollbackReason,
      auditLogPath
    };
    await appendAuditLog(auditLogPath, {
      timestamp: new Date().toISOString(),
      source: options.source,
      node: path.basename(targetFile, ".md"),
      target_file: targetFile,
      applied: false,
      validation_passed: false,
      rolled_back: true,
      rollback_reason: rollbackReason,
      candidate_id: options.candidateId,
      score_before: options.scoreBefore
    });
    return result;
  }
}

async function appendAuditLog(
  auditLogPath: string,
  entry: {
    timestamp: string;
    source: "meta-harness" | "shadow-eval";
    node: string;
    target_file: string;
    applied: boolean;
    validation_passed: boolean;
    rolled_back: boolean;
    rollback_reason: string | null;
    candidate_id: string | null;
    score_before: number | null;
  }
): Promise<void> {
  await ensureDir(path.dirname(auditLogPath));
  await fs.appendFile(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function findWorkspaceRoot(targetFile: string): string {
  const promptsIndex = targetFile.lastIndexOf(`${path.sep}node-prompts${path.sep}`);
  if (promptsIndex >= 0) {
    return targetFile.slice(0, promptsIndex);
  }
  return path.dirname(path.dirname(targetFile));
}

function isWithinDirectory(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function defaultRunValidateHarness(cwd: string): Promise<void> {
  await execFile("npm", ["run", "validate:harness"], {
    cwd,
    timeout: 120_000
  });
}

async function defaultGitRevParseHead(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function defaultGitAdd(cwd: string, targetFile: string): Promise<void> {
  await execFile("git", ["add", targetFile], { cwd });
}

async function defaultGitCommit(cwd: string, message: string): Promise<void> {
  await execFile("git", ["commit", "-m", message], { cwd });
}
