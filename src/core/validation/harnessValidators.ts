import path from "node:path";
import { promises as fs } from "node:fs";

import {
  GraphNodeId,
  RunCompletenessChecklistArtifact,
  RunOperatorStatusArtifact,
  RunValidationScope
} from "../../types.js";
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
  validationScope: RunValidationScope;
}

export interface IssueLogValidationResult {
  issueCount: number;
  issues: HarnessValidationIssue[];
}

interface IssueEntry {
  title: string;
  body: string;
  identifier?: string;
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
  "Regression status"
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
  const runStatusPath = path.join(runDir, "run_status.json");
  const runCompletenessChecklistPath = path.join(runDir, "run_completeness_checklist.json");
  const eventsPath = path.join(runDir, "events.jsonl");
  const collectBackgroundJobPath = path.join(runDir, "collect_background_job.json");
  const experimentPortfolioPath = path.join(runDir, "experiment_portfolio.json");
  const runManifestPath = path.join(runDir, "run_manifest.json");
  const metricsPath = path.join(runDir, "metrics.json");
  const objectiveEvaluationPath = path.join(runDir, "objective_evaluation.json");
  const resultAnalysisPath = path.join(runDir, "result_analysis.json");
  const transitionPath = path.join(runDir, "transition_recommendation.json");
  const reviewDecisionPath = path.join(runDir, "review", "decision.json");

  const runStatusArtifact = await readJsonObjectIfPresent(runStatusPath, runId, issues);
  const validationScope = resolveValidationScope(runStatusArtifact);
  if (runStatusArtifact) {
    checked.add("run_status");
    validateRunStatusPayload(runStatusArtifact, runStatusPath, runId, issues);
  }
  if (runStatusArtifact || (await fileExists(runCompletenessChecklistPath))) {
    checked.add("run_completeness_checklist");
    const completenessChecklist = runStatusArtifact
      ? await requireJsonObject({
          filePath: runCompletenessChecklistPath,
          missingCode: "run_completeness_checklist_missing",
          malformedCode: "run_completeness_checklist_malformed",
          runId,
          issues
        })
      : await readJsonObjectIfPresent(runCompletenessChecklistPath, runId, issues);
    if (completenessChecklist) {
      validateRunCompletenessChecklistPayload(
        completenessChecklist,
        runCompletenessChecklistPath,
        runId,
        validationScope,
        issues
      );
    }
  }

  const eventsPresent = await fileExists(eventsPath);
  if ((validationScope === "full_run" && (hasRunProgress(nodeStates, runStatus) || eventsPresent)) || eventsPresent) {
    checked.add("events_log");
    const events = await requireJsonLinesObjects({
      filePath: eventsPath,
      missingCode: "events_log_missing",
      emptyCode: "events_log_empty",
      malformedCode: "events_log_malformed",
      runId,
      issues
    });
    if (events) {
      validatePersistedEventsPayload(events, eventsPath, runId, issues);
    }
  }

  const collectBackgroundJob = await readOptionalJsonObject({
    filePath: collectBackgroundJobPath,
    malformedCode: "collect_background_job_malformed",
    runId,
    issues
  });
  if (collectBackgroundJob) {
    checked.add("collect_background_job");
    validateCollectBackgroundJobPayload(collectBackgroundJob, collectBackgroundJobPath, runId, issues);
  }

  const reviewPacketPath = path.join(runDir, "review", "review_packet.json");
  const reviewMinimumGatePath = path.join(runDir, "review", "minimum_gate.json");
  const reviewCritiquePath = path.join(runDir, "review", "paper_critique.json");
  const reviewReadinessRiskPath = path.join(runDir, "review", "readiness_risks.json");
  const reviewCompleted = isNodeCompleted(nodeStates, "review");
  const reviewPacketPresent = await fileExists(reviewPacketPath);
  const reviewDecision = await readJsonObjectIfPresent(reviewDecisionPath, runId, issues);
  if (validationScope === "live_fixture") {
    await validateLiveFixtureReviewArtifacts({
      runDir,
      runId,
      issues
    });
  } else if (reviewCompleted || reviewPacketPresent) {
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
      await requireJsonObject({
        filePath: reviewMinimumGatePath,
        missingCode: "review_minimum_gate_missing",
        malformedCode: "review_minimum_gate_malformed",
        runId,
        issues
      });
      await requireJsonObject({
        filePath: reviewCritiquePath,
        missingCode: "review_paper_critique_missing",
        malformedCode: "review_paper_critique_malformed",
        runId,
        issues
      });
      const reviewReadinessRisks = await requireJsonObject({
        filePath: reviewReadinessRiskPath,
        missingCode: "review_readiness_risks_missing",
        malformedCode: "review_readiness_risks_malformed",
        runId,
        issues
      });
      if (reviewReadinessRisks) {
        validateReadinessRiskPayload(reviewReadinessRisks, reviewReadinessRiskPath, runId, issues);
      }
    }
  }

  const writePaperCompleted = isNodeCompleted(nodeStates, "write_paper");
  const mainTexPath = path.join(runDir, "paper", "main.tex");
  const mainTexPresent = await fileExists(mainTexPath);
  if (validationScope === "live_fixture") {
    await validateLiveFixturePaperArtifacts({
      runDir,
      runId,
      issues
    });
  } else if (writePaperCompleted || mainTexPresent || runStatus === "completed") {
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
      const claims = Array.isArray((evidenceLinks as { claims?: unknown[] }).claims)
        ? (evidenceLinks as { claims?: unknown[] }).claims || []
        : [];
      if (claims.length > 0) {
        await requireJsonObject({
          filePath: path.join(runDir, "paper", "claim_evidence_table.json"),
          missingCode: "paper_claim_evidence_table_missing",
          malformedCode: "paper_claim_evidence_table_malformed",
          runId,
          issues
        });
        await requireJsonObject({
          filePath: path.join(runDir, "paper", "verified_registry.json"),
          missingCode: "paper_verified_registry_missing",
          malformedCode: "paper_verified_registry_malformed",
          runId,
          issues
        });
        await requireJsonObject({
          filePath: path.join(runDir, "paper", "claim_status_table.json"),
          missingCode: "paper_claim_status_table_missing",
          malformedCode: "paper_claim_status_table_malformed",
          runId,
          issues
        });
        await requireJsonObject({
          filePath: path.join(runDir, "paper", "evidence_gate_decision.json"),
          missingCode: "paper_evidence_gate_decision_missing",
          malformedCode: "paper_evidence_gate_decision_malformed",
          runId,
          issues
        });
      }
    }
    const paperReadiness = await requireJsonObject({
      filePath: path.join(runDir, "paper", "paper_readiness.json"),
      missingCode: "paper_readiness_missing",
      malformedCode: "paper_readiness_malformed",
      runId,
      issues
    });
    if (paperReadiness) {
      validatePaperReadinessPayload(paperReadiness, path.join(runDir, "paper", "paper_readiness.json"), runId, issues);
      const readinessRisks = await requireJsonObject({
        filePath: path.join(runDir, "paper", "readiness_risks.json"),
        missingCode: "paper_readiness_risks_missing",
        malformedCode: "paper_readiness_risks_malformed",
        runId,
        issues
      });
      if (readinessRisks) {
        validateReadinessRiskPayload(
          readinessRisks,
          path.join(runDir, "paper", "readiness_risks.json"),
          runId,
          issues
        );
      }
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
  let experimentPortfolio: Record<string, unknown> | undefined;
  if (runExperimentsCompleted || runVerifierPass || await fileExists(experimentPortfolioPath)) {
    checked.add("experiment_portfolio");
    experimentPortfolio = await requireJsonObject({
      filePath: experimentPortfolioPath,
      missingCode: "experiment_portfolio_missing",
      malformedCode: "experiment_portfolio_malformed",
      runId,
      issues
    });
    if (experimentPortfolio) {
      validateExperimentPortfolioPayload(experimentPortfolio, experimentPortfolioPath, runId, issues);
    }
  }

  let runManifest: Record<string, unknown> | undefined;
  if (runExperimentsCompleted || runVerifierPass || await fileExists(runManifestPath)) {
    checked.add("run_manifest");
    runManifest = await requireJsonObject({
      filePath: runManifestPath,
      missingCode: "run_manifest_missing",
      malformedCode: "run_manifest_malformed",
      runId,
      issues
    });
    if (runManifest) {
      validateRunManifestPayload(runManifest, runManifestPath, runId, issues);
      await validateRunManifestArtifactPaths({
        runManifest,
        runManifestPath,
        runDir,
        runId,
        issues
      });
    }
  }

  if (runManifest && experimentPortfolio) {
    validateExperimentExecutionConsistency({
      runManifest,
      experimentPortfolio,
      runManifestPath,
      experimentPortfolioPath,
      runId,
      issues
    });
  }

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
    const resultAnalysis = await requireJsonObject({
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
    if (resultAnalysis?.experiment_portfolio && !experimentPortfolio) {
      issues.push({
        code: "analyze_results_portfolio_missing",
        message: "result_analysis.json exposes experiment_portfolio, but experiment_portfolio.json is missing or malformed.",
        filePath: resultAnalysisPath,
        runId
      });
    }
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
    issues,
    validationScope
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

  const seenIdentifiers = new Map<string, string>();
  for (const entry of entries) {
    if (entry.identifier) {
      const previousTitle = seenIdentifiers.get(entry.identifier);
      if (previousTitle) {
        issues.push({
          code: "issue_duplicate_identifier",
          message: `${entry.identifier} is used by multiple issue headings, including "${previousTitle}" and "${entry.title}".`,
          filePath
        });
      } else {
        seenIdentifiers.set(entry.identifier, entry.title);
      }
    }

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
      const hasFullFormat = /Fresh session:/m.test(entry.body) && /Existing session:/m.test(entry.body);
      const hasInlineFormat = /^-\s*Fresh vs existing\s*:/m.test(entry.body);
      if (!hasFullFormat && !hasInlineFormat) {
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

function hasRunProgress(
  nodeStates: RunArtifactValidationInput["nodeStates"],
  runStatus?: string
): boolean {
  if (runStatus && runStatus !== "pending") {
    return true;
  }
  return Object.values(nodeStates ?? {}).some((state) => {
    const status = typeof state?.status === "string" ? state.status : undefined;
    return Boolean(status && status !== "pending");
  });
}

function validatePersistedEventsPayload(
  events: Record<string, unknown>[],
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!asString(event.type)) {
      issues.push({
        code: "events_log_entry_missing_type",
        message: `events.jsonl entry ${index + 1} must include a non-empty type.`,
        filePath,
        runId
      });
    }
    if (!asString(event.timestamp)) {
      issues.push({
        code: "events_log_entry_missing_timestamp",
        message: `events.jsonl entry ${index + 1} must include a non-empty timestamp.`,
        filePath,
        runId
      });
    }
    const eventRunId = asString(event.runId);
    if (!eventRunId) {
      issues.push({
        code: "events_log_entry_missing_run_id",
        message: `events.jsonl entry ${index + 1} must include runId.`,
        filePath,
        runId
      });
    } else if (eventRunId !== runId) {
      issues.push({
        code: "events_log_entry_run_id_mismatch",
        message: `events.jsonl entry ${index + 1} references runId ${eventRunId}, expected ${runId}.`,
        filePath,
        runId
      });
    }
  }
}

function validateCollectBackgroundJobPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  if (payload.version !== 1) {
    issues.push({
      code: "collect_background_job_version_invalid",
      message: "collect_background_job.json must declare version=1.",
      filePath,
      runId
    });
  }
  if (asString(payload.kind) !== "collect_deferred_enrichment") {
    issues.push({
      code: "collect_background_job_kind_invalid",
      message: "collect_background_job.json must declare kind=collect_deferred_enrichment.",
      filePath,
      runId
    });
  }
  if (asString(payload.runId) !== runId) {
    issues.push({
      code: "collect_background_job_run_id_mismatch",
      message: `collect_background_job.json references runId ${asString(payload.runId) || "(missing)"}, expected ${runId}.`,
      filePath,
      runId
    });
  }
  if (!["running", "completed", "failed"].includes(asString(payload.status))) {
    issues.push({
      code: "collect_background_job_status_invalid",
      message: "collect_background_job.json must use status running, completed, or failed.",
      filePath,
      runId
    });
  }
}

function validateExperimentPortfolioPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  if (payload.version !== 1) {
    issues.push({
      code: "experiment_portfolio_version_invalid",
      message: "experiment_portfolio.json must declare version=1.",
      filePath,
      runId
    });
  }
  if (asString(payload.run_id) !== runId) {
    issues.push({
      code: "experiment_portfolio_run_id_mismatch",
      message: `experiment_portfolio.json references run_id ${asString(payload.run_id) || "(missing)"}, expected ${runId}.`,
      filePath,
      runId
    });
  }
  if (!asString(payload.execution_model)) {
    issues.push({
      code: "experiment_portfolio_execution_model_missing",
      message: "experiment_portfolio.json must include execution_model.",
      filePath,
      runId
    });
  }
  const trialGroups = asObjectArray(payload.trial_groups);
  if (trialGroups.length === 0) {
    issues.push({
      code: "experiment_portfolio_trial_groups_missing",
      message: "experiment_portfolio.json must include a non-empty trial_groups array.",
      filePath,
      runId
    });
    return;
  }
  const primaryTrialGroupId = asString(payload.primary_trial_group_id);
  if (!primaryTrialGroupId) {
    issues.push({
      code: "experiment_portfolio_primary_group_missing",
      message: "experiment_portfolio.json must include primary_trial_group_id.",
      filePath,
      runId
    });
    return;
  }
  if (!trialGroups.some((trialGroup) => asString(trialGroup.id) === primaryTrialGroupId)) {
    issues.push({
      code: "experiment_portfolio_primary_group_unresolved",
      message: `experiment_portfolio.json primary_trial_group_id ${primaryTrialGroupId} does not appear in trial_groups.`,
      filePath,
      runId
    });
  }
}

function validateRunManifestPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  if (payload.version !== 1) {
    issues.push({
      code: "run_manifest_version_invalid",
      message: "run_manifest.json must declare version=1.",
      filePath,
      runId
    });
  }
  if (asString(payload.run_id) !== runId) {
    issues.push({
      code: "run_manifest_run_id_mismatch",
      message: `run_manifest.json references run_id ${asString(payload.run_id) || "(missing)"}, expected ${runId}.`,
      filePath,
      runId
    });
  }
  if (!asString(payload.execution_model)) {
    issues.push({
      code: "run_manifest_execution_model_missing",
      message: "run_manifest.json must include execution_model.",
      filePath,
      runId
    });
  }
  const trialGroups = asObjectArray(payload.trial_groups);
  if (trialGroups.length === 0) {
    issues.push({
      code: "run_manifest_trial_groups_missing",
      message: "run_manifest.json must include a non-empty trial_groups array.",
      filePath,
      runId
    });
    return;
  }
  for (let index = 0; index < trialGroups.length; index += 1) {
    const trialGroup = trialGroups[index];
    if (!asString(trialGroup.id)) {
      issues.push({
        code: "run_manifest_trial_group_id_missing",
        message: `run_manifest.json trial_groups[${index}] must include id.`,
        filePath,
        runId
      });
    }
    if (!asString(trialGroup.status)) {
      issues.push({
        code: "run_manifest_trial_group_status_missing",
        message: `run_manifest.json trial_groups[${index}] must include status.`,
        filePath,
        runId
      });
    }
  }
}

async function validateRunManifestArtifactPaths(input: {
  runManifest: Record<string, unknown>;
  runManifestPath: string;
  runDir: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<void> {
  const trialGroups = asObjectArray(input.runManifest.trial_groups);
  for (let index = 0; index < trialGroups.length; index += 1) {
    const metricsPath = asString(trialGroups[index]?.metrics_path);
    if (!metricsPath) {
      continue;
    }
    const resolvedPath = path.isAbsolute(metricsPath)
      ? metricsPath
      : path.join(process.cwd(), metricsPath);
    if (!resolvedPath.startsWith(process.cwd())) {
      continue;
    }
    if (!(await fileExists(resolvedPath))) {
      input.issues.push({
        code: "run_manifest_trial_group_metrics_missing",
        message:
          `run_manifest.json trial_groups[${index}] references metrics_path ${metricsPath}, ` +
          "but that artifact does not exist.",
        filePath: input.runManifestPath,
        runId: input.runId
      });
    }
  }
}

function validateExperimentExecutionConsistency(input: {
  runManifest: Record<string, unknown>;
  experimentPortfolio: Record<string, unknown>;
  runManifestPath: string;
  experimentPortfolioPath: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): void {
  const manifestExecutionModel = asString(input.runManifest.execution_model);
  const portfolioExecutionModel = asString(input.experimentPortfolio.execution_model);
  if (
    manifestExecutionModel
    && portfolioExecutionModel
    && manifestExecutionModel !== portfolioExecutionModel
  ) {
    input.issues.push({
      code: "experiment_execution_model_mismatch",
      message: `run_manifest.json execution_model (${manifestExecutionModel}) does not match experiment_portfolio.json (${portfolioExecutionModel}).`,
      filePath: input.runManifestPath,
      runId: input.runId
    });
  }

  const manifestPrimary = asString(isRecord(input.runManifest.portfolio) ? input.runManifest.portfolio.primary_trial_group_id : undefined);
  const portfolioPrimary = asString(input.experimentPortfolio.primary_trial_group_id);
  if (manifestPrimary && portfolioPrimary && manifestPrimary !== portfolioPrimary) {
    input.issues.push({
      code: "experiment_primary_group_mismatch",
      message: `run_manifest.json primary trial group (${manifestPrimary}) does not match experiment_portfolio.json (${portfolioPrimary}).`,
      filePath: input.experimentPortfolioPath,
      runId: input.runId
    });
  }
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

function validatePaperReadinessPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  const paperReady = payload.paper_ready;
  const readinessState = asString(payload.readiness_state);
  const evidenceGateStatus = asString(payload.evidence_gate_status);
  const scientificValidationStatus = asString(payload.scientific_validation_status);

  if (typeof paperReady !== "boolean") {
    issues.push({
      code: "paper_readiness_flag_missing",
      message: "paper/paper_readiness.json must include a boolean paper_ready field.",
      filePath,
      runId
    });
  }

  if (!readinessState) {
    issues.push({
      code: "paper_readiness_state_missing",
      message: "paper/paper_readiness.json must include a non-empty readiness_state.",
      filePath,
      runId
    });
  }

  if (evidenceGateStatus && !["pass", "warn", "fail"].includes(evidenceGateStatus)) {
    issues.push({
      code: "paper_readiness_evidence_gate_invalid",
      message: "paper/paper_readiness.json contains an invalid evidence_gate_status.",
      filePath,
      runId
    });
  }

  if (scientificValidationStatus && !["pass", "warn", "fail"].includes(scientificValidationStatus)) {
    issues.push({
      code: "paper_readiness_scientific_gate_invalid",
      message: "paper/paper_readiness.json contains an invalid scientific_validation_status.",
      filePath,
      runId
    });
  }
}

function validateReadinessRiskPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  const readinessState = asString(payload.readiness_state);
  const risks = Array.isArray(payload.risks) ? payload.risks : null;

  if (!readinessState) {
    issues.push({
      code: "paper_readiness_risks_state_missing",
      message: "paper/readiness_risks.json must include a non-empty readiness_state.",
      filePath,
      runId
    });
  }

  if (!risks) {
    issues.push({
      code: "paper_readiness_risks_array_missing",
      message: "paper/readiness_risks.json must include a risks array.",
      filePath,
      runId
    });
    return;
  }

  for (const risk of risks) {
    const record = isRecord(risk) ? risk : null;
    if (!record) {
      issues.push({
        code: "paper_readiness_risks_item_invalid",
        message: "paper/readiness_risks.json contains a non-object risk entry.",
        filePath,
        runId
      });
      continue;
    }
    const riskCode = asString(record.risk_code);
    const severity = asString(record.severity);
    const category = asString(record.category);
    const status = asString(record.status);
    if (!riskCode) {
      issues.push({
        code: "paper_readiness_risk_code_missing",
        message: "paper/readiness_risks.json contains a risk without a risk_code.",
        filePath,
        runId
      });
    }
    if (severity && !["warning", "blocked"].includes(severity)) {
      issues.push({
        code: "paper_readiness_risk_severity_invalid",
        message: "paper/readiness_risks.json contains an invalid risk severity.",
        filePath,
        runId
      });
    }
    if (
      category
      && ![
        "citation_source",
        "claim_evidence",
        "scientific_validation",
        "submission_validation",
        "manuscript_quality",
        "paper_scale",
        "network_dependency"
      ].includes(category)
    ) {
      issues.push({
        code: "paper_readiness_risk_category_invalid",
        message: "paper/readiness_risks.json contains an invalid risk category.",
        filePath,
        runId
      });
    }
    if (status && !["unverified", "blocked"].includes(status)) {
      issues.push({
        code: "paper_readiness_risk_status_invalid",
        message: "paper/readiness_risks.json contains an invalid risk status.",
        filePath,
        runId
      });
    }
  }
}

function validateRunStatusPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  issues: HarnessValidationIssue[]
): void {
  if (payload.version !== 1) {
    issues.push({
      code: "run_status_version_invalid",
      message: "run_status.json must declare version=1.",
      filePath,
      runId
    });
  }
  if (asString(payload.run_id) !== runId) {
    issues.push({
      code: "run_status_run_id_mismatch",
      message: `run_status.json references run_id ${asString(payload.run_id) || "(missing)"}, expected ${runId}.`,
      filePath,
      runId
    });
  }
  if (!asString(payload.current_node)) {
    issues.push({
      code: "run_status_current_node_missing",
      message: "run_status.json must include current_node.",
      filePath,
      runId
    });
  }
  if (!asString(payload.lifecycle_status)) {
    issues.push({
      code: "run_status_lifecycle_status_missing",
      message: "run_status.json must include lifecycle_status.",
      filePath,
      runId
    });
  }
  if (!asString(payload.recommended_next_action)) {
    issues.push({
      code: "run_status_recommended_next_action_missing",
      message: "run_status.json must include recommended_next_action.",
      filePath,
      runId
    });
  }
  const validationScope = asString(payload.validation_scope);
  if (validationScope && !["full_run", "live_fixture"].includes(validationScope)) {
    issues.push({
      code: "run_status_validation_scope_invalid",
      message: "run_status.json must use validation_scope full_run or live_fixture.",
      filePath,
      runId
    });
  }
}

function validateRunCompletenessChecklistPayload(
  payload: Record<string, unknown>,
  filePath: string,
  runId: string,
  expectedValidationScope: RunValidationScope,
  issues: HarnessValidationIssue[]
): void {
  const artifact = payload as Partial<RunCompletenessChecklistArtifact>;
  if (artifact.version !== 1) {
    issues.push({
      code: "run_completeness_checklist_version_invalid",
      message: "run_completeness_checklist.json must declare version=1.",
      filePath,
      runId
    });
  }
  if (asString(artifact.run_id) !== runId) {
    issues.push({
      code: "run_completeness_checklist_run_id_mismatch",
      message:
        `run_completeness_checklist.json references run_id ${asString(artifact.run_id) || "(missing)"}, expected ${runId}.`,
      filePath,
      runId
    });
  }
  const validationScope = asString(artifact.validation_scope);
  if (!validationScope || !["full_run", "live_fixture"].includes(validationScope)) {
    issues.push({
      code: "run_completeness_checklist_validation_scope_invalid",
      message: "run_completeness_checklist.json must use validation_scope full_run or live_fixture.",
      filePath,
      runId
    });
  } else if (validationScope !== expectedValidationScope) {
    issues.push({
      code: "run_completeness_checklist_validation_scope_mismatch",
      message:
        `run_completeness_checklist.json uses validation_scope ${validationScope}, expected ${expectedValidationScope}.`,
      filePath,
      runId
    });
  }
  if (!asString(artifact.summary)) {
    issues.push({
      code: "run_completeness_checklist_summary_missing",
      message: "run_completeness_checklist.json must include summary.",
      filePath,
      runId
    });
  }
  if (!Array.isArray(artifact.missing_required)) {
    issues.push({
      code: "run_completeness_checklist_missing_required_invalid",
      message: "run_completeness_checklist.json must include missing_required as an array.",
      filePath,
      runId
    });
  }
  if (!Array.isArray(artifact.missing_optional)) {
    issues.push({
      code: "run_completeness_checklist_missing_optional_invalid",
      message: "run_completeness_checklist.json must include missing_optional as an array.",
      filePath,
      runId
    });
  }
}

function resolveValidationScope(payload?: Record<string, unknown>): RunValidationScope {
  const scope = asString(payload?.validation_scope);
  return scope === "live_fixture" ? "live_fixture" : "full_run";
}

async function validateLiveFixtureReviewArtifacts(input: {
  runDir: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<void> {
  const reviewPacketPath = path.join(input.runDir, "review", "review_packet.json");
  const minimumGatePath = path.join(input.runDir, "review", "minimum_gate.json");
  const critiquePath = path.join(input.runDir, "review", "paper_critique.json");
  const readinessRiskPath = path.join(input.runDir, "review", "readiness_risks.json");
  const decisionPath = path.join(input.runDir, "review", "decision.json");

  const reviewPacket = await readJsonObjectIfPresent(reviewPacketPath, input.runId, input.issues);
  if (reviewPacket) {
    validateReviewPacketPayload(reviewPacket, reviewPacketPath, input.runId, input.issues);
  }
  const minimumGate = await readJsonObjectIfPresent(minimumGatePath, input.runId, input.issues);
  if (minimumGate && !asString(minimumGate.ceiling_type)) {
    input.issues.push({
      code: "review_minimum_gate_ceiling_missing",
      message: "review/minimum_gate.json must include ceiling_type when present.",
      filePath: minimumGatePath,
      runId: input.runId
    });
  }
  const critique = await readJsonObjectIfPresent(critiquePath, input.runId, input.issues);
  if (critique && typeof critique.blocking_issues_count !== "number") {
    input.issues.push({
      code: "review_paper_critique_blocking_count_missing",
      message: "review/paper_critique.json must include blocking_issues_count when present.",
      filePath: critiquePath,
      runId: input.runId
    });
  }
  const readinessRisks = await readJsonObjectIfPresent(readinessRiskPath, input.runId, input.issues);
  if (readinessRisks) {
    validateReadinessRiskPayload(readinessRisks, readinessRiskPath, input.runId, input.issues);
  }
  await readJsonObjectIfPresent(decisionPath, input.runId, input.issues);
}

async function validateLiveFixturePaperArtifacts(input: {
  runDir: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<void> {
  const paperDir = path.join(input.runDir, "paper");
  const mainTexPath = path.join(paperDir, "main.tex");
  const referencesPath = path.join(paperDir, "references.bib");
  const paperReadinessPath = path.join(paperDir, "paper_readiness.json");
  const readinessRiskPath = path.join(paperDir, "readiness_risks.json");

  if (await fileExists(mainTexPath)) {
    await requireNonEmptyText({
      filePath: mainTexPath,
      missingCode: "paper_main_tex_missing",
      emptyCode: "paper_main_tex_empty",
      runId: input.runId,
      issues: input.issues
    });
  }
  if (await fileExists(referencesPath)) {
    await requireNonEmptyText({
      filePath: referencesPath,
      missingCode: "paper_references_missing",
      emptyCode: "paper_references_empty",
      runId: input.runId,
      issues: input.issues
    });
  }
  const paperReadiness = await readJsonObjectIfPresent(paperReadinessPath, input.runId, input.issues);
  if (paperReadiness) {
    validatePaperReadinessPayload(paperReadiness, paperReadinessPath, input.runId, input.issues);
  }
  const readinessRisks = await readJsonObjectIfPresent(readinessRiskPath, input.runId, input.issues);
  if (readinessRisks) {
    validateReadinessRiskPayload(readinessRisks, readinessRiskPath, input.runId, input.issues);
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

async function requireJsonLinesObjects(input: {
  filePath: string;
  missingCode: string;
  emptyCode: string;
  malformedCode: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<Record<string, unknown>[] | undefined> {
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

  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    input.issues.push({
      code: input.emptyCode,
      message: `Artifact must not be empty: ${relativeFromRun(input.filePath)}.`,
      filePath: input.filePath,
      runId: input.runId
    });
    return undefined;
  }

  const entries: Record<string, unknown>[] = [];
  for (const line of lines) {
    const parsed = parseJsonRecord(line);
    if (!parsed) {
      input.issues.push({
        code: input.malformedCode,
        message: `Artifact must be newline-delimited JSON objects: ${relativeFromRun(input.filePath)}.`,
        filePath: input.filePath,
        runId: input.runId
      });
      return undefined;
    }
    entries.push(parsed);
  }

  return entries;
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

async function readOptionalJsonObject(input: {
  filePath: string;
  malformedCode: string;
  runId: string;
  issues: HarnessValidationIssue[];
}): Promise<Record<string, unknown> | undefined> {
  const raw = await readFileIfExists(input.filePath);
  if (raw === undefined) {
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

function collectIssueEntries(markdown: string): IssueEntry[] {
  // Scope to "Live validation issues" section when present, since Active/Resolved
  // sections use a compact format that predates the detailed template.
  const liveSection = markdown.match(/##\s*Live validation issues[\s\S]*$/iu)?.[0];
  const scope = liveSection ?? markdown;

  const headingPattern = /^##+\s+(?:Issue:\s+|LV-\d+\s*[—–-]\s*)(.+)$/gm;
  const matches = [...scope.matchAll(headingPattern)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || scope.length : scope.length;
    const body = scope.slice(start, end);
    return {
      title: match[1]?.trim() || `Issue ${index + 1}`,
      body,
      identifier: match[0]?.match(/\b(LV-\d+)\b/i)?.[1]?.toUpperCase()
    };
  });
}

const FIELD_ALIASES: Record<string, string[]> = {
  "Environment/session context": ["Environment"],
  "Root cause hypothesis": ["Root-cause hypothesis"],
  "Fresh vs existing session comparison": ["Fresh vs existing"],
  "Reproduction steps": ["Reproduction"],
  "Expected behavior": ["Expected"],
  "Actual behavior": ["Actual"]
};

function hasField(text: string, field: string): boolean {
  const candidates = [field, ...(FIELD_ALIASES[field] ?? [])];
  return candidates.some(
    (name) => new RegExp(`^-\\s*${escapeRegExp(name)}\\s*:`, "m").test(text)
  );
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

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => isRecord(item));
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
