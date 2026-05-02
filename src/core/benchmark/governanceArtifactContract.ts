import path from "node:path";
import { promises as fs } from "node:fs";

import type { GovernanceBenchmarkConditionName } from "./governanceCondition.js";

export interface GovernanceArtifactContractIssue {
  code: string;
  message: string;
  file_path: string;
}

export interface GovernanceArtifactContractReport {
  run_dir: string;
  condition: GovernanceBenchmarkConditionName;
  passed: boolean;
  required_artifacts: string[];
  issues: GovernanceArtifactContractIssue[];
}

export interface ValidateGovernanceArtifactContractInput {
  runDir: string;
  condition?: GovernanceBenchmarkConditionName;
  publicManifestPath?: string;
  requiredArtifacts?: string[];
}

export async function validateGovernanceArtifactContract(
  input: ValidateGovernanceArtifactContractInput
): Promise<GovernanceArtifactContractReport> {
  const condition = input.condition || "gated";
  const requiredArtifacts = uniqueStrings([
    ...requiredArtifactsForCondition(condition),
    ...(input.requiredArtifacts || [])
  ]);
  const issues: GovernanceArtifactContractIssue[] = [];

  for (const relativePath of requiredArtifacts) {
    if (!(await nonEmptyArtifactExists(path.join(input.runDir, relativePath)))) {
      issues.push({
        code: "governance_required_artifact_missing",
        message: `Required governance artifact is missing or empty: ${relativePath}.`,
        file_path: relativePath
      });
    }
  }

  await validatePaperReadyEvidence(input.runDir, issues);

  if (input.publicManifestPath) {
    await validatePublicManifest(input.publicManifestPath, path.basename(input.runDir), issues);
  }

  return {
    run_dir: input.runDir,
    condition,
    passed: issues.length === 0,
    required_artifacts: requiredArtifacts,
    issues
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function requiredArtifactsForCondition(condition: GovernanceBenchmarkConditionName): string[] {
  const required = [
    "governance_condition.json",
    "result_table.json",
    "evidence_store.jsonl"
  ];
  if (condition !== "ungated" && condition !== "no_figure_audit") {
    required.push("figure_audit/figure_audit_summary.json");
  }
  if (condition !== "ungated" && condition !== "no_review_gate") {
    required.push("review/paper_critique.json", "review/decision.json");
  }
  if (condition !== "ungated") {
    required.push("paper/main.tex", "paper/evidence_links.json", "paper/paper_readiness.json");
  }
  return required;
}

async function nonEmptyArtifactExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function validatePaperReadyEvidence(
  runDir: string,
  issues: GovernanceArtifactContractIssue[]
): Promise<void> {
  const readinessPath = path.join(runDir, "paper", "paper_readiness.json");
  let readiness: Record<string, unknown> | undefined;
  try {
    readiness = JSON.parse(await fs.readFile(readinessPath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  if (readiness.paper_ready !== true) {
    return;
  }

  const evidenceRequired = [
    "result_table.json",
    "evidence_store.jsonl",
    "review/paper_critique.json",
    "paper/evidence_links.json"
  ];
  for (const relativePath of evidenceRequired) {
    if (!(await nonEmptyArtifactExists(path.join(runDir, relativePath)))) {
      issues.push({
        code: "paper_ready_without_evidence_artifact",
        message: `paper_ready=true requires evidence artifact: ${relativePath}.`,
        file_path: relativePath
      });
    }
  }
}

async function validatePublicManifest(
  manifestPath: string,
  runId: string,
  issues: GovernanceArtifactContractIssue[]
): Promise<void> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    issues.push({
      code: "public_manifest_missing_or_malformed",
      message: "Public output manifest is missing or malformed.",
      file_path: manifestPath
    });
    return;
  }

  const provenance = manifest.provenance as Record<string, unknown> | undefined;
  if (manifest.run_id !== runId || provenance?.run_id !== runId) {
    issues.push({
      code: "public_manifest_run_trace_mismatch",
      message: "Public output manifest must trace back to the same run id in run_id and provenance.run_id.",
      file_path: manifestPath
    });
  }
}
