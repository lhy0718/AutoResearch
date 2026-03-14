import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeId } from "../../types.js";
import { fileExists } from "../../utils/fs.js";

export interface HarnessValidationIssue {
  code: string;
  message: string;
  filePath?: string;
  runId?: string;
}

export interface RunArtifactValidationInput {
  runId: string;
  runDir: string;
  nodeStates?: Partial<Record<GraphNodeId, { status?: string }>>;
  runStatus?: string;
}

export interface RunArtifactValidationResult {
  runId: string;
  checked: string[];
  issues: HarnessValidationIssue[];
}

export interface IssueLogValidationResult {
  issueCount: number;
  issues: HarnessValidationIssue[];
}

const ISSUE_REQUIRED_FIELDS = [
  "Validation target",
  "Environment/session context",
  "Reproduction steps",
  "Expected behavior",
  "Actual behavior",
  "Fresh vs existing session comparison",
  "Root cause hypothesis",
  "Code/test changes",
  "Regression status",
  "Follow-up risks"
] as const;

const PLACEHOLDER_TOKENS = new Set([
  "todo",
  "tbd",
  "placeholder",
  "unknown",
  "none",
  "n/a",
  "na",
  "null",
  "-"
]);

export async function validateRunArtifactStructure(
  input: RunArtifactValidationInput
): Promise<RunArtifactValidationResult> {
  const issues: HarnessValidationIssue[] = [];
  const checked = new Set<string>();
  const { runId, runDir, nodeStates, runStatus } = input;
  const metricsPath = path.join(runDir, "metrics.json");
  const objectiveEvaluationPath = path.join(runDir, "objective_evaluation.json");
  const resultAnalysisPath = path.join(runDir, "result_analysis.json");
  const transitionPath = path.join(runDir, "transition_recommendation.json");
  const reviewDecisionPath = path.join(runDir, "review", "decision.json");

  const reviewPacketPath = path.join(runDir, "review", "review_packet.json");
  const reviewCompleted = isNodeCompleted(nodeStates, "review");
  const reviewPacketPresent = await fileExists(reviewPacketPath);
  const reviewDecision = await readJsonObjectIfPresent(reviewDecisionPath, runId, issues);
  if (reviewCompleted || reviewPacketPresent) {
    checked.add("review_packet");
    const reviewPacket = await requireJsonObject({
      filePath: reviewPacketPath,
      missingCode: "review_packet_missing",
      malformedCode: "review_packet_malformed",
      runId,
      issues
    });
    if (reviewPacket) {
      validateReviewPacketPayload(reviewPacket, reviewPacketPath, runId, issues);
      const decisionExpected = reviewCompleted || isRecord(reviewPacket.decision);
      if (decisionExpected) {
        await requireJsonObject({
          filePath: reviewDecisionPath,
          missingCode: "review_decision_missing",
          malformedCode: "review_decision_malformed",
          runId,
          issues
        });
        await requireJsonObject({
          filePath: path.join(runDir, "review", "revision_plan.json"),
          missingCode: "review_revision_plan_missing",
          malformedCode: "review_revision_plan_malformed",
          runId,
          issues
        });
      }
    }
  }

  const writePaperCompleted = isNodeCompleted(nodeStates, "write_paper");
  const mainTexPath = path.join(runDir, "paper", "main.tex");
  const mainTexPresent = await fileExists(mainTexPath);
  if (writePaperCompleted || mainTexPresent || runStatus === "completed") {
    checked.add("paper_artifacts");
    await requireNonEmptyText({
      filePath: mainTexPath,
      missingCode: "paper_main_tex_missing",
      emptyCode: "paper_main_tex_empty",
      runId,
      issues
    });
    await requireNonEmptyText({
      filePath: path.join(runDir, "paper", "references.bib"),
      missingCode: "paper_references_missing",
      emptyCode: "paper_references_empty",
      runId,
      issues
    });
    const evidenceLinks = await requireJsonObject({
      filePath: path.join(runDir, "paper", "evidence_links.json"),
      missingCode: "paper_evidence_links_missing",
      malformedCode: "paper_evidence_links_malformed",
      runId,
      issues
    });
    if (evidenceLinks) {
      await validateEvidenceLinksPayload(
        evidenceLinks,
        runId,
        path.join(runDir, "paper", "evidence_links.json"),
        issues,
        {
          runDir
        }
      );
    }
    await validatePaperResultConsistency({
      runId,
      runDir,
      mainTexPath,
      metricsPath,
      objectiveEvaluationPath,
      issues
    });
  }

  const runVerifier = await readJsonObjectIfPresent(path.join(runDir, "run_experiments_verify_report.json"), runId, issues);
  const runExperimentsCompleted = isNodeCompleted(nodeStates, "run_experiments");
  const runVerifierPass = asString(runVerifier?.status) === "pass";
  if (runExperimentsCompleted || runVerifierPass) {
    checked.add("run_experiments");
    const metrics = await requireJsonObject({
      filePath: metricsPath,
      missingCode: "run_metrics_missing",
      malformedCode: "run_metrics_malformed",
      runId,
      issues
    });
    if (metrics && Object.keys(metrics).length === 0) {
      issues.push({
        code: "run_metrics_empty",
        message: "metrics.json must not be an empty object after successful experiment execution.",
        filePath: metricsPath,
        runId
      });
    }
  }

  const analyzeResultsCompleted = isNodeCompleted(nodeStates, "analyze_results");
  const resultAnalysisPresent = await fileExists(resultAnalysisPath);
  if (analyzeResultsCompleted || resultAnalysisPresent) {
    checked.add("analyze_results");
    await requireJsonObject({
      filePath: resultAnalysisPath,
      missingCode: "analyze_results_missing",
      malformedCode: "analyze_results_malformed",
      runId,
      issues
    });
    await requireJsonObject({
      filePath: objectiveEvaluationPath,
      missingCode: "analyze_results_objective_evaluation_missing",
      malformedCode: "analyze_results_objective_evaluation_malformed",
      runId,
      issues
    });
    await requireJsonObject({
      filePath: transitionPath,
      missingCode: "analyze_results_transition_missing",
      malformedCode: "analyze_results_transition_malformed",
      runId,
      issues
    });
  }

  await validateReviewAndPaperConsistency({
    runId,
    runStatus,
    runDir,
    writePaperCompleted,
    mainTexPresent,
    reviewDecision,
    issues
  });
  validateRunStatusConsistency({
    runId,
    runStatus,
    runDir,
    mainTexPresent,
    writePaperCompleted,
    issues
  });

  return {
    runId,
    checked: [...checked].sort(),
    issues
  };
}

export function validateLiveValidationIssueMarkdown(
  markdown: string,
  filePath = "ISSUES.md"
): IssueLogValidationResult {
  const issues: HarnessValidationIssue[] = [];
  const entries = collectIssueEntries(markdown);

  if (entries.length === 0) {
    if (hasExplicitNoActiveIssues(markdown)) {
      return { issueCount: 0, issues };
    }
    issues.push({
      code: "issue_entry_missing",
      message: "No `Issue:` entries were found in ISSUES.md.",
      filePath
    });
    return { issueCount: 0, issues };
  }

  for (const entry of entries) {
    for (const field of ISSUE_REQUIRED_FIELDS) {
      if (!hasField(entry.body, field)) {
        issues.push({
          code: "issue_field_missing",
          message: `${entry.title} is missing required field: ${field}.`,
          filePath
        });
      }
    }

    if (hasField(entry.body, "Reproduction steps") && !/^\s*\d+\.\s+/m.test(entry.body)) {
      issues.push({
        code: "issue_reproduction_steps_malformed",
        message: `${entry.title} must include numbered reproduction steps.`,
        filePath
      });
    }

    if (hasField(entry.body, "Fresh vs existing session comparison")) {
      if (!/Fresh session:/m.test(entry.body) || !/Existing session:/m.test(entry.body)) {
        issues.push({
          code: "issue_session_comparison_incomplete",
          message: `${entry.title} must include both Fresh session and Existing session lines.`,
          filePath
        });
      }
    }
  }

  return {
    issueCount: entries.length,
    issues
  };
}

function hasExplicitNoActiveIssues(markdown: string): boolean {
  const activeSection = markdown.match(/##\s*Active issues[\s\S]*?(?=\n##\s+|$)/iu)?.[0] || "";
  return /\bnone\b/i.test(activeSection);
}

export async function validateLiveValidationIssueFile(filePath: string): Promise<IssueLogValidationResult> {
  const markdown = await fs.readFile(filePath, "utf8");
  return validateLiveValidationIssueMarkdown(markdown, filePath);
}

function isNodeCompleted(
  nodeStates: RunArtifactValidationInput["nodeStates"],
  node: GraphNodeId
): boolean {
  return nodeStates?.[node]?.status === "completed";
}

function validateReviewPacketPayload(
  packet: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  if (!isRecord(packet.readiness)) {
    issues.push({
      code: "review_packet_readiness_missing",
      message: "review_packet.json must include a readiness object.",
      filePath,
      runId
    });
  }

  if (!Array.isArray(packet.checks) || packet.checks.length === 0) {
    issues.push({
      code: "review_packet_checks_missing",
      message: "review_packet.json must include a non-empty checks array.",
      filePath,
      runId
    });
  }

  if (!Array.isArray(packet.suggested_actions)) {
    issues.push({
      code: "review_packet_suggested_actions_missing",
      message: "review_packet.json must include suggested_actions.",
      filePath,
      runId
    });
  }

  if (!asString(packet.objective_status) || !asString(packet.objective_summary)) {
    issues.push({
      code: "review_packet_objective_missing",
      message: "review_packet.json must include objective_status and objective_summary.",
      filePath,
      runId
    });
  }
}

async function validateEvidenceLinksPayload(
  payload: Record<string, unknown>,
  runId: string,
  filePath: string,
  issues: HarnessValidationIssue[],
  context?: {
    runDir: string;
  }
): Promise<void> {
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  if (claims.length === 0) {
    issues.push({
      code: "paper_claims_missing",
      message: "paper/evidence_links.json must include a non-empty claims array.",
      filePath,
      runId
    });
    return;
  }

  let claimsWithConcreteLinks = 0;
  for (let index = 0; index < claims.length; index += 1) {
    const item = claims[index];
    const claim = isRecord(item) ? item : undefined;
    if (!claim) {
      issues.push({
        code: "paper_claim_malformed",
        message: `Claim entry ${index + 1} in paper/evidence_links.json is not an object.`,
        filePath,
        runId
      });
      continue;
    }

    const claimId = asString(claim.claim_id);
    const statement = asString(claim.statement);
    const evidenceIds = asStringArray(claim.evidence_ids);
    const citationPaperIds = asStringArray(claim.citation_paper_ids);
    const linkageIds = [...evidenceIds, ...citationPaperIds];
    const sourceArtifacts = asStringArray(claim.source_artifacts);

    if (isPlaceholder(claimId)) {
      issues.push({
        code: "paper_claim_id_placeholder",
        message: `Claim entry ${index + 1} has an empty or placeholder claim_id.`,
        filePath,
        runId
      });
    }

    if (isPlaceholder(statement)) {
      issues.push({
        code: "paper_claim_statement_placeholder",
        message: `Claim ${claimId || `#${index + 1}`} has an empty or placeholder statement.`,
        filePath,
        runId
      });
    }

    if (linkageIds.length === 0) {
      issues.push({
        code: "paper_claim_linkage_missing",
        message: `Claim ${claimId || `#${index + 1}`} has no evidence_ids or citation_paper_ids.`,
        filePath,
        runId
      });
    }

    if (linkageIds.some((value) => isPlaceholder(value))) {
      issues.push({
        code: "paper_claim_linkage_placeholder",
        message: `Claim ${claimId || `#${index + 1}`} uses placeholder evidence/citation linkage.`,
        filePath,
        runId
      });
    }

    if (linkageIds.length > 0 && !linkageIds.some((value) => isPlaceholder(value))) {
      claimsWithConcreteLinks += 1;
    }

    if (!context) {
      continue;
    }

    for (const evidenceId of evidenceIds) {
      if (isPlaceholder(evidenceId)) {
        continue;
      }
      if (looksLikePath(evidenceId) && !(await fileExists(path.join(context.runDir, evidenceId)))) {
        issues.push({
          code: "paper_claim_source_path_missing",
          message: `Claim ${claimId || `#${index + 1}`} references missing artifact path: ${evidenceId}.`,
          filePath,
          runId
        });
      }
    }

    for (const sourceArtifact of sourceArtifacts) {
      if (!sourceArtifact || isPlaceholder(sourceArtifact)) {
        issues.push({
          code: "paper_claim_source_path_placeholder",
          message: `Claim ${claimId || `#${index + 1}`} uses an empty or placeholder source artifact mapping.`,
          filePath,
          runId
        });
        continue;
      }
      const absolute = path.isAbsolute(sourceArtifact)
        ? sourceArtifact
        : path.join(context.runDir, sourceArtifact);
      if (!(await fileExists(absolute))) {
        issues.push({
          code: "paper_claim_source_path_missing",
          message: `Claim ${claimId || `#${index + 1}`} references missing source artifact: ${sourceArtifact}.`,
          filePath,
          runId
        });
      }
    }
  }

  if (claims.length >= 4 && claimsWithConcreteLinks / claims.length < 0.5) {
    issues.push({
      code: "paper_claim_linkage_imbalance",
      message: `Only ${claimsWithConcreteLinks}/${claims.length} claims have concrete evidence/citation linkage.`,
      filePath,
      runId
    });
  }
}

async function validatePaperResultConsistency(input: {
  runId: string;
  runDir: string;
  mainTexPath: string;
  metricsPath: string;
  objectiveEvaluationPath: string;
  issues: HarnessValidationIssue[];
}): Promise<void> {
  const tex = await readFileIfExists(input.mainTexPath);
  if (!tex || !looksLikeResultNarrative(tex)) {
    return;
  }
  const metricsPresent = await fileExists(input.metricsPath);
  const objectivePresent = await fileExists(input.objectiveEvaluationPath);
  if (!metricsPresent && !objectivePresent) {
    input.issues.push({
      code: "paper_result_artifacts_missing_for_claims",
      message:
        "paper/main.tex appears to describe quantitative/core results, but metrics.json and objective_evaluation.json are both missing.",
      filePath: input.mainTexPath,
      runId: input.runId
    });
  }
}

async function validateReviewAndPaperConsistency(input: {
  runId: string;
  runStatus?: string;
  runDir: string;
  writePaperCompleted: boolean;
  mainTexPresent: boolean;
  reviewDecision?: Record<string, unknown>;
  issues: HarnessValidationIssue[];
}): Promise<void> {
  if (!input.reviewDecision) {
    return;
  }
  const outcome = asString(input.reviewDecision.outcome).toLowerCase();
  if (!outcome) {
    return;
  }
  const referencesPresent = path.join(input.runDir, "paper", "references.bib");
  const evidenceLinksPresent = path.join(input.runDir, "paper", "evidence_links.json");
  const paperArtifactsMissing = !input.mainTexPresent;
  const expectsFinalPaper = outcome === "advance" && (input.writePaperCompleted || input.runStatus === "completed");

  if (expectsFinalPaper && paperArtifactsMissing) {
    input.issues.push({
      code: "review_accepted_without_paper_artifacts",
      message: "Review outcome is advance/finalized, but paper/main.tex is missing.",
      filePath: path.join(input.runDir, "review", "decision.json"),
      runId: input.runId
    });
  }

  if (outcome === "advance" && input.mainTexPresent) {
    const referencesExists = await fileExists(referencesPresent);
    const evidenceExists = await fileExists(evidenceLinksPresent);
    if (!referencesExists || !evidenceExists) {
      input.issues.push({
        code: "review_paper_artifact_set_incomplete",
        message:
          "Review advanced to paper completion, but references.bib or evidence_links.json is missing in paper artifacts.",
        filePath: path.join(input.runDir, "review", "decision.json"),
        runId: input.runId
      });
    }
  }
}

function validateRunStatusConsistency(input: {
  runId: string;
  runStatus?: string;
  runDir: string;
  mainTexPresent: boolean;
  writePaperCompleted: boolean;
  issues: HarnessValidationIssue[];
}): void {
  if (input.runStatus === "completed" && !input.mainTexPresent) {
    input.issues.push({
      code: "run_state_completed_without_paper",
      message: "Run status is completed, but paper/main.tex is missing.",
      filePath: path.join(input.runDir, "paper", "main.tex"),
      runId: input.runId
    });
  }

  if (input.mainTexPresent && !input.writePaperCompleted && input.runStatus !== "completed") {
    input.issues.push({
      code: "status_artifact_mismatch_write_paper_state",
      message:
        "paper/main.tex exists while write_paper node is not marked completed. Verify resume/retry state projection.",
      filePath: path.join(input.runDir, "paper", "main.tex"),
      runId: input.runId
    });
  }
}

function looksLikeResultNarrative(tex: string): boolean {
  const normalized = tex.toLowerCase();
  const metricWord = /\b(accuracy|f1|auc|precision|recall|objective|metric|improv(ed|ement)|outperform)\b/u.test(
    normalized
  );
  const numericSignal = /\b\d+(?:\.\d+)?%?\b/u.test(normalized);
  return metricWord && numericSignal;
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || /\.(json|jsonl|yaml|yml|tex|bib|md|csv|tsv|txt)$/iu.test(value);
}


async function requireJsonObject(input: {
  filePath: string;
  missingCode: string;
  malformedCode: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<Record<string, unknown> | undefined> {
  const raw = await readFileIfExists(input.filePath);
  if (raw === undefined) {
    input.issues.push({
      code: input.missingCode,
      message: `Missing required artifact: ${relativeFromRun(input.filePath)}.`,
      filePath: input.filePath,
      runId: input.runId
    });
    return undefined;
  }
  const parsed = parseJsonRecord(raw);
  if (!parsed) {
    input.issues.push({
      code: input.malformedCode,
      message: `Artifact must be a valid JSON object: ${relativeFromRun(input.filePath)}.`,
      filePath: input.filePath,
      runId: input.runId
    });
    return undefined;
  }
  return parsed;
}

async function requireNonEmptyText(input: {
  filePath: string;
  missingCode: string;
  emptyCode: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<void> {
  const raw = await readFileIfExists(input.filePath);
  if (raw === undefined) {
    input.issues.push({
      code: input.missingCode,
      message: `Missing required artifact: ${relativeFromRun(input.filePath)}.`,
      filePath: input.filePath,
      runId: input.runId
    });
    return;
  }
  if (!raw.trim()) {
    input.issues.push({
      code: input.emptyCode,
      message: `Artifact must not be empty: ${relativeFromRun(input.filePath)}.`,
      filePath: input.filePath,
      runId: input.runId
    });
  }
}

async function readJsonObjectIfPresent(
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): Promise<Record<string, unknown> | undefined> {
  const raw = await readFileIfExists(filePath);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = parseJsonRecord(raw);
  if (!parsed) {
    issues.push({
      code: "artifact_malformed_json",
      message: `Artifact must be a valid JSON object: ${relativeFromRun(filePath)}.`,
      filePath,
      runId
    });
    return undefined;
  }
  return parsed;
}

function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

function collectIssueEntries(markdown: string): Array<{ title: string; body: string }> {
  const headingPattern = /^##+\s+Issue:\s+(.+)$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || markdown.length : markdown.length;
    const body = markdown.slice(start, end);
    return {
      title: match[1]?.trim() || `Issue ${index + 1}`,
      body
    };
  });
}

function hasField(text: string, field: string): boolean {
  return new RegExp(`^-\\s*${escapeRegExp(field)}\\s*:`, "m").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (PLACEHOLDER_TOKENS.has(normalized)) {
    return true;
  }
  return normalized.startsWith("todo") || normalized.startsWith("tbd");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function relativeFromRun(filePath: string): string {
  const parts = filePath.split(path.sep);
  const runIndex = parts.lastIndexOf("runs");
  if (runIndex >= 0 && runIndex + 2 < parts.length) {
    return parts.slice(runIndex + 2).join("/");
  }
  return filePath;
}
