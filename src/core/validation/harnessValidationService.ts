import path from "node:path";
import { Dirent, promises as fs } from "node:fs";

import { resolveAppPaths } from "../../config.js";
import { GraphNodeId, RunRecord } from "../../types.js";
import {
  HarnessValidationIssue,
  validateLiveValidationIssueFile,
  validateRunArtifactStructure
} from "./harnessValidators.js";

export type HarnessIssueKind =
  | "missing_artifact"
  | "malformed_issue"
  | "broken_evidence_link"
  | "status_artifact_mismatch"
  | "paper_result_mismatch";

export type HarnessValidationScope = "issue_log" | "workspace" | "test_records";

export interface HarnessValidationFinding extends HarnessValidationIssue {
  kind: HarnessIssueKind;
  remediation: string;
  scope: HarnessValidationScope;
  runStorePath?: string;
}

export interface HarnessValidationTargetSummary {
  scope: Exclude<HarnessValidationScope, "issue_log">;
  runStoreCount: number;
  runCount: number;
  findingCount: number;
}

export interface HarnessValidationReport {
  generatedAt: string;
  workspaceRoot: string;
  issueLogPath: string;
  issueEntryCount: number;
  runStoresChecked: number;
  runsChecked: number;
  findings: HarnessValidationFinding[];
  countsByKind: Record<HarnessIssueKind, number>;
  targets: HarnessValidationTargetSummary[];
  status: "ok" | "fail";
}

export interface HarnessValidationOptions {
  workspaceRoot: string;
  issuesPath?: string;
  includeWorkspaceRuns?: boolean;
  includeTestRunStores?: boolean;
  maxFindings?: number;
}

interface RunsFileLike {
  runs?: RunRecord[];
}

interface RunStoreSource {
  scope: Exclude<HarnessValidationScope, "issue_log">;
  runStorePath: string;
}

export async function runHarnessValidation(options: HarnessValidationOptions): Promise<HarnessValidationReport> {
  const workspaceRoot = options.workspaceRoot;
  const issuesPath = options.issuesPath || path.join(workspaceRoot, "ISSUES.md");
  const includeWorkspaceRuns = options.includeWorkspaceRuns !== false;
  const includeTestRunStores = options.includeTestRunStores !== false;
  const maxFindings = Math.max(1, options.maxFindings || 200);
  const findings: HarnessValidationFinding[] = [];

  let issueEntryCount = 0;
  if (await fileExists(issuesPath)) {
    const issueResult = await validateLiveValidationIssueFile(issuesPath);
    issueEntryCount = issueResult.issueCount;
    for (const issue of issueResult.issues) {
      findings.push(classifyFinding(issue, "issue_log"));
    }
  } else {
    findings.push({
      code: "issues_file_missing",
      message: "ISSUES.md is missing, so live-validation records cannot be verified.",
      filePath: issuesPath,
      kind: "malformed_issue",
      remediation: "Create ISSUES.md using docs/live-validation-issue-template.md and record active validation issues.",
      scope: "issue_log"
    });
  }

  const sources = await collectRunStoreSources({
    workspaceRoot,
    includeWorkspaceRuns,
    includeTestRunStores
  });

  const targetCounters = new Map<
    Exclude<HarnessValidationScope, "issue_log">,
    { runStoreCount: number; runCount: number; findingCount: number }
  >();
  targetCounters.set("workspace", { runStoreCount: 0, runCount: 0, findingCount: 0 });
  targetCounters.set("test_records", { runStoreCount: 0, runCount: 0, findingCount: 0 });

  let runsChecked = 0;
  for (const source of sources) {
    const counters = targetCounters.get(source.scope);
    if (counters) {
      counters.runStoreCount += 1;
    }

    const parsed = await readRunsFile(source.runStorePath, source.scope, findings);
    const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
    for (const run of runs) {
      if (!run.id) {
        const finding = classifyFinding(
          {
            code: "run_record_missing_id",
            message: "A run record is missing id.",
            filePath: source.runStorePath
          },
          source.scope
        );
        finding.runStorePath = source.runStorePath;
        findings.push(finding);
        continue;
      }

      runsChecked += 1;
      if (counters) {
        counters.runCount += 1;
      }
      const runDir = path.join(path.dirname(source.runStorePath), run.id);
      if (!(await fileExists(runDir))) {
        const finding = classifyFinding(
          {
            code: "run_directory_missing",
            message: `Run directory is missing for ${run.id}.`,
            filePath: runDir,
            runId: run.id
          },
          source.scope
        );
        finding.runStorePath = source.runStorePath;
        findings.push(finding);
        continue;
      }

      const result = await validateRunArtifactStructure({
        runId: run.id,
        runDir,
        nodeStates: run.graph?.nodeStates,
        runStatus: run.status
      });
      for (const issue of result.issues) {
        const finding = classifyFinding(issue, source.scope);
        finding.runStorePath = source.runStorePath;
        findings.push(finding);
      }
    }
  }

  if (findings.length > maxFindings) {
    findings.splice(maxFindings);
  }

  for (const finding of findings) {
    if (finding.scope === "workspace" || finding.scope === "test_records") {
      const counters = targetCounters.get(finding.scope);
      if (counters) {
        counters.findingCount += 1;
      }
    }
  }

  const countsByKind: Record<HarnessIssueKind, number> = {
    missing_artifact: 0,
    malformed_issue: 0,
    broken_evidence_link: 0,
    status_artifact_mismatch: 0,
    paper_result_mismatch: 0
  };
  for (const finding of findings) {
    countsByKind[finding.kind] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    issueLogPath: issuesPath,
    issueEntryCount,
    runStoresChecked: sources.length,
    runsChecked,
    findings,
    countsByKind,
    targets: [
      {
        scope: "workspace",
        runStoreCount: targetCounters.get("workspace")?.runStoreCount || 0,
        runCount: targetCounters.get("workspace")?.runCount || 0,
        findingCount: targetCounters.get("workspace")?.findingCount || 0
      },
      {
        scope: "test_records",
        runStoreCount: targetCounters.get("test_records")?.runStoreCount || 0,
        runCount: targetCounters.get("test_records")?.runCount || 0,
        findingCount: targetCounters.get("test_records")?.findingCount || 0
      }
    ],
    status: findings.length > 0 ? "fail" : "ok"
  };
}

export function classifyHarnessIssueCode(code: string): HarnessIssueKind {
  if (code.startsWith("issue_") || code.includes("issues_file")) {
    return "malformed_issue";
  }
  if (
    code.includes("evidence")
    || code.includes("citation")
    || code.includes("claim_linkage")
    || code.includes("source_path")
  ) {
    return "broken_evidence_link";
  }
  if (code.includes("paper_result")) {
    return "paper_result_mismatch";
  }
  if (code.includes("review_") || code.includes("run_state_") || code.includes("status_")) {
    return "status_artifact_mismatch";
  }
  if (code.includes("missing") || code.includes("empty") || code.includes("malformed") || code.includes("parse")) {
    return "missing_artifact";
  }
  return "status_artifact_mismatch";
}

export function defaultRemediationForIssueCode(code: string): string {
  if (code.startsWith("issue_") || code === "issues_file_missing") {
    return "Fill the required ISSUES.md fields using docs/live-validation-issue-template.md and keep entries up to date.";
  }
  if (
    code.includes("evidence")
    || code.includes("citation")
    || code.includes("claim_linkage")
    || code.includes("source_path")
  ) {
    return "Regenerate paper evidence_links.json from grounded artifacts and ensure every claim maps to real evidence/citation IDs.";
  }
  if (code.includes("paper_result")) {
    return "Regenerate paper artifacts after run_experiments/analyze_results, or remove unsupported result claims from the manuscript.";
  }
  if (code.includes("review_")) {
    return "Align review decision artifacts, run status, and paper output state before marking the run as completed.";
  }
  if (code.includes("metrics")) {
    return "Ensure run_experiments produces metrics.json and objective_evaluation.json before advancing.";
  }
  if (code.includes("main_tex") || code.includes("references") || code.includes("paper_")) {
    return "Regenerate write_paper outputs and confirm paper/main.tex, references.bib, and evidence_links.json exist.";
  }
  if (code.includes("runs_json")) {
    return "Repair malformed runs.json records or regenerate the affected run metadata.";
  }
  return "Inspect the referenced artifact and regenerate the failing stage with /retry or targeted node rerun.";
}

function classifyFinding(
  issue: HarnessValidationIssue,
  scope: HarnessValidationScope
): HarnessValidationFinding {
  return {
    ...issue,
    kind: classifyHarnessIssueCode(issue.code),
    remediation: defaultRemediationForIssueCode(issue.code),
    scope
  };
}

async function collectRunStoreSources(input: {
  workspaceRoot: string;
  includeWorkspaceRuns: boolean;
  includeTestRunStores: boolean;
}): Promise<RunStoreSource[]> {
  const sources: RunStoreSource[] = [];
  const seen = new Set<string>();

  if (input.includeWorkspaceRuns) {
    const workspaceRunsFile = resolveAppPaths(input.workspaceRoot).runsFile;
    if (await fileExists(workspaceRunsFile)) {
      const resolved = path.resolve(workspaceRunsFile);
      seen.add(resolved);
      sources.push({ scope: "workspace", runStorePath: resolved });
    }
  }

  if (input.includeTestRunStores) {
    for (const relativeRoot of ["test", "tests"]) {
      const testRoot = path.join(input.workspaceRoot, relativeRoot);
      const testFiles = await findRunStoreFiles(testRoot);
      for (const filePath of testFiles) {
        const resolved = path.resolve(filePath);
        if (seen.has(resolved)) {
          continue;
        }
        seen.add(resolved);
        sources.push({ scope: "test_records", runStorePath: resolved });
      }
    }
  }

  return sources.sort((a, b) => a.runStorePath.localeCompare(b.runStorePath));
}

async function findRunStoreFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, files);
  return files.sort();
}

async function walk(currentPath: string, files: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const nextPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walk(nextPath, files);
      continue;
    }
    if (
      entry.isFile()
      && entry.name === "runs.json"
      && path.basename(path.dirname(nextPath)) === "runs"
      && nextPath.includes(`${path.sep}.autolabos${path.sep}`)
    ) {
      files.push(nextPath);
    }
  }
}

async function readRunsFile(
  filePath: string,
  scope: HarnessValidationScope,
  findings: HarnessValidationFinding[]
): Promise<RunsFileLike> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      findings.push(
        classifyFinding(
          {
            code: "runs_json_malformed",
            message: "runs.json must decode to an object.",
            filePath
          },
          scope
        )
      );
      return {};
    }
    const record = parsed as RunsFileLike;
    if (record.runs && !Array.isArray(record.runs)) {
      findings.push(
        classifyFinding(
          {
            code: "runs_json_runs_malformed",
            message: "runs.json field `runs` must be an array when present.",
            filePath
          },
          scope
        )
      );
      return {};
    }
    return record;
  } catch (error) {
    findings.push(
      classifyFinding(
        {
          code: "runs_json_parse_error",
          message: `Unable to parse runs.json: ${errorMessage(error)}`,
          filePath
        },
        scope
      )
    );
    return {};
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveRunNodeStates(
  run: RunRecord
): Partial<Record<GraphNodeId, { status?: string }>> | undefined {
  return run.graph?.nodeStates;
}
