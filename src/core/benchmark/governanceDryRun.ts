import path from "node:path";
import { promises as fs } from "node:fs";
import YAML from "yaml";

import {
  validateGovernanceArtifactContract,
  type GovernanceArtifactContractReport
} from "./governanceArtifactContract.js";
import {
  resolveGovernanceBenchmarkCondition,
  type GovernanceBenchmarkConditionName
} from "./governanceCondition.js";
import {
  buildGovernanceTaskScoreInputFromClaimEvidence,
  scoreClaimEvidenceArtifacts,
  type ClaimEvidenceScore
} from "./claimEvidenceScoring.js";
import { scoreGovernanceTask, scoreGovernanceTasks, type GovernanceTaskScore } from "./governanceScorer.js";
import { scoreResultTableArtifact, type ResultTableScore } from "./resultTableScoring.js";

export interface GovernanceBenchmarkDryRunInput {
  cwd: string;
  seedPath: string;
  taskId?: string;
  outDir?: string;
  conditions?: GovernanceBenchmarkConditionName[];
}

export interface GovernanceBenchmarkDryRunConditionReport {
  condition: GovernanceBenchmarkConditionName;
  run_id: string;
  run_dir: string;
  contract: GovernanceArtifactContractReport;
  result_table_score: ResultTableScore;
  claim_evidence_score: ClaimEvidenceScore;
  governance_score: GovernanceTaskScore;
  missing_baseline_detected: boolean;
  comparative_claim_blocked_or_downgraded: boolean;
}

export interface GovernanceBenchmarkDryRunReport {
  task_id: string;
  output_dir: string;
  readme_path: string;
  summary_path: string;
  passed: boolean;
  conditions: GovernanceBenchmarkDryRunConditionReport[];
}

interface SeedConditionFile {
  task_id?: string;
  title?: string;
  required_repo_artifacts?: string[];
}

interface SeedMetricRow {
  condition: string;
  metric: string;
  value: number;
  unit: string;
  notes: string;
}

const DEFAULT_DRY_RUN_CONDITIONS: GovernanceBenchmarkConditionName[] = ["gated", "ungated"];

export async function runGovernanceBenchmarkDryRun(
  input: GovernanceBenchmarkDryRunInput
): Promise<GovernanceBenchmarkDryRunReport> {
  const seed = await resolveSeedSource(input.cwd, input.seedPath);
  const conditionFile = await readSeedCondition(seed.sourceDir);
  const taskId = input.taskId || conditionFile.task_id || path.basename(seed.sourceDir);
  const conditions = input.conditions?.length ? input.conditions : DEFAULT_DRY_RUN_CONDITIONS;
  const outputDir = path.resolve(input.cwd, input.outDir || path.join("outputs", "governance-benchmark", taskId));
  const metricRows = await readSeedMetricRows(seed.sourceDir);
  const resultsTable = buildResultsTable(metricRows);
  const resultTableScore = scoreResultTableArtifact(resultsTable);
  const missingBaselineDetected = resultTableScore.missing_baseline_count > 0;
  const reports: GovernanceBenchmarkDryRunConditionReport[] = [];

  await fs.mkdir(outputDir, { recursive: true });

  for (const conditionName of conditions) {
    const condition = resolveGovernanceBenchmarkCondition(conditionName);
    const runId = `${taskId}-${conditionName}-dry-run`;
    const runDir = path.join(outputDir, "runs", runId);
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.mkdir(runDir, { recursive: true });

    const claimArtifacts = buildClaimArtifacts({
      condition: conditionName,
      resultTableScore,
      missingBaselineDetected
    });
    await writeDryRunArtifacts({
      taskId,
      title: conditionFile.title,
      seedSourceMode: seed.mode,
      runId,
      runDir,
      condition,
      metricRows,
      resultsTable,
      missingBaselineDetected,
      claimArtifacts
    });

    const contract = await validateGovernanceArtifactContract({
      runDir,
      condition: conditionName,
      requiredArtifacts: conditionFile.required_repo_artifacts
    });
    const claimEvidenceScore = scoreClaimEvidenceArtifacts({
      claimEvidenceTableArtifact: claimArtifacts.claimEvidenceTable,
      claimStatusTableArtifact: claimArtifacts.claimStatusTable,
      evidenceLinksArtifact: claimArtifacts.evidenceLinks
    });
    const readiness = claimArtifacts.paperReadiness;
    const governanceScore = scoreGovernanceTask(
      buildGovernanceTaskScoreInputFromClaimEvidence({
        taskId,
        paperReady: readiness.paper_ready === true,
        expectedPaperReady: false,
        claimEvidenceScore,
        missingRequiredArtifactCount: contract.issues.length,
        missingBaselineDetected,
        missingBaselinePassed: conditionName === "ungated" && readiness.paper_ready === true,
        repairActionCount: claimArtifacts.repairActionCount
      })
    );
    await writeJson(path.join(runDir, "contract_report.json"), contract);
    await writeJson(path.join(runDir, "governance_score.json"), governanceScore);

    reports.push({
      condition: conditionName,
      run_id: runId,
      run_dir: path.relative(input.cwd, runDir).replace(/\\/g, "/"),
      contract,
      result_table_score: resultTableScore,
      claim_evidence_score: claimEvidenceScore,
      governance_score: governanceScore,
      missing_baseline_detected: missingBaselineDetected,
      comparative_claim_blocked_or_downgraded: claimArtifacts.comparativeClaimBlockedOrDowngraded
    });
  }

  const scoreSummary = scoreGovernanceTasks(reports.map((report) => ({
    task_id: `${taskId}:${report.condition}`,
    paper_ready: report.condition === "ungated",
    expected_paper_ready: false,
    unsupported_claim_count: report.claim_evidence_score.unsupported_claim_count,
    major_claim_count: report.claim_evidence_score.major_claim_count,
    supported_claim_count: report.claim_evidence_score.supported_claim_count,
    missing_required_artifact_count: report.contract.issues.length,
    missing_baseline_detected: report.missing_baseline_detected,
    missing_baseline_passed: report.condition === "ungated",
    repair_action_count: report.condition === "gated" ? 1 : 0
  })));
  const summary = {
    task_id: taskId,
    generated_at: new Date().toISOString(),
    seed_mode: seed.mode,
    output_dir: path.relative(input.cwd, outputDir).replace(/\\/g, "/"),
    passed: dryRunPassed(reports),
    conditions: reports,
    score_summary: scoreSummary
  };
  const summaryPath = path.join(outputDir, "summary.json");
  const readmePath = path.join(outputDir, "README.md");
  await writeJson(summaryPath, summary);
  await fs.writeFile(readmePath, renderReadme(summary), "utf8");

  return {
    task_id: taskId,
    output_dir: path.relative(input.cwd, outputDir).replace(/\\/g, "/"),
    readme_path: path.relative(input.cwd, readmePath).replace(/\\/g, "/"),
    summary_path: path.relative(input.cwd, summaryPath).replace(/\\/g, "/"),
    passed: summary.passed,
    conditions: reports
  };
}

async function resolveSeedSource(
  cwd: string,
  seedPath: string
): Promise<{ sourceDir: string; mode: "imported_seed" | "source_directory" }> {
  const resolved = path.resolve(cwd, seedPath);
  const importedSource = path.join(resolved, "source");
  if (await fileExists(path.join(importedSource, "condition.yaml"))) {
    return { sourceDir: importedSource, mode: "imported_seed" };
  }
  if (await fileExists(path.join(resolved, "condition.yaml"))) {
    return { sourceDir: resolved, mode: "source_directory" };
  }
  throw new Error(`Governance benchmark seed is missing condition.yaml: ${seedPath}`);
}

async function readSeedCondition(sourceDir: string): Promise<SeedConditionFile> {
  const raw = await fs.readFile(path.join(sourceDir, "condition.yaml"), "utf8");
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === "object" ? parsed as SeedConditionFile : {};
}

async function readSeedMetricRows(sourceDir: string): Promise<SeedMetricRow[]> {
  const csvPath = path.join(sourceDir, "seed_materials", "result_table.csv");
  const raw = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(raw);
  return rows.map((row) => ({
    condition: String(row.condition || "").trim(),
    metric: String(row.metric || "").trim(),
    value: Number(row.value),
    unit: String(row.unit || "").trim(),
    notes: String(row.notes || "").trim()
  })).filter((row) => row.condition && row.metric && Number.isFinite(row.value));
}

function buildResultsTable(rows: SeedMetricRow[]): Array<{
  metric: string;
  baseline: number | null;
  comparator: number | null;
  delta: number | null;
  direction: "higher_better";
}> {
  const byMetric = new Map<string, { baseline: number | null; comparator: number | null }>();
  for (const row of rows) {
    const current = byMetric.get(row.metric) || { baseline: null, comparator: null };
    if (/baseline|comparator/u.test(row.condition)) {
      current.baseline = row.value;
    }
    if (/proposed|treatment|candidate/u.test(row.condition)) {
      current.comparator = row.value;
    }
    byMetric.set(row.metric, current);
  }
  return [...byMetric.entries()].map(([metric, values]) => ({
    metric,
    baseline: values.baseline,
    comparator: values.comparator,
    delta:
      values.baseline !== null && values.comparator !== null
        ? Number((values.comparator - values.baseline).toFixed(6))
        : null,
    direction: "higher_better" as const
  }));
}

function buildClaimArtifacts(input: {
  condition: GovernanceBenchmarkConditionName;
  resultTableScore: ResultTableScore;
  missingBaselineDetected: boolean;
}): {
  claimEvidenceTable: Record<string, unknown>;
  claimStatusTable: Record<string, unknown>;
  evidenceLinks: Record<string, unknown>;
  evidenceGateDecision: Record<string, unknown>;
  paperReadiness: Record<string, unknown>;
  reviewDecision: Record<string, unknown>;
  comparativeClaimBlockedOrDowngraded: boolean;
  repairActionCount: number;
} {
  const descriptiveClaim = {
    claim_id: "claim_descriptive_proposed_macro_f1",
    statement: "The proposed condition has a descriptive macro F1 result of 0.811 in the seed table.",
    section_heading: "Results",
    artifact_refs: ["result_table.json"],
    citation_refs: [],
    evidence_ids: ["ev_proposed_macro_f1"],
    strength: "descriptive"
  };
  const ungatedComparativeClaim = {
    claim_id: "claim_unsupported_improvement",
    statement: "The proposed condition improves macro F1 over the baseline.",
    section_heading: "Results",
    artifact_refs: [],
    citation_refs: [],
    evidence_ids: [],
    strength: "unsupported_comparative"
  };
  const ungated = input.condition === "ungated";
  const claims = ungated ? [descriptiveClaim, ungatedComparativeClaim] : [descriptiveClaim];
  const statusClaims = claims.map((claim) => ({
    claim_id: claim.claim_id,
    statement: claim.statement,
    section_heading: claim.section_heading,
    status: claim.claim_id === "claim_unsupported_improvement" ? "unverified" : "verified",
    artifact_refs: claim.artifact_refs,
    citation_refs: claim.citation_refs,
    reproduction_trace_present: claim.claim_id !== "claim_unsupported_improvement"
  }));
  const comparativeClaimFindings = input.missingBaselineDetected
    ? [
        {
          claim: "The proposed condition improves macro F1 over the baseline.",
          reason: "No baseline row exists in seed_materials/result_table.csv, so no delta can be computed."
        }
      ]
    : [];
  const blockedComparativeClaims = ungated ? [] : comparativeClaimFindings;
  const paperReady = ungated && comparativeClaimFindings.length > 0;

  return {
    claimEvidenceTable: { generated_by: "governance-benchmark dry-run", claims },
    claimStatusTable: {
      generated_by: "governance-benchmark dry-run",
      counts: {
        verified: statusClaims.filter((claim) => claim.status === "verified").length,
        inferred: 0,
        unverified: 0,
        blocked: statusClaims.filter((claim) => claim.status === "blocked").length
      },
      claims: statusClaims
    },
    evidenceLinks: {
      claims: claims.map((claim) => ({
        claim_id: claim.claim_id,
        artifact_refs: claim.artifact_refs,
        citation_paper_ids: claim.citation_refs,
        evidence_ids: claim.evidence_ids
      }))
    },
    evidenceGateDecision: {
      paper_ready_blocked: !ungated && comparativeClaimFindings.length > 0,
      triggered_by: input.missingBaselineDetected ? ["missing_baseline", "missing_delta"] : [],
      blocked_comparative_claims: blockedComparativeClaims,
      detected_unsupported_comparative_claims: comparativeClaimFindings,
      allowed_claim_ceiling: input.missingBaselineDetected
        ? "descriptive_only_research_memo"
        : "comparative_claim_allowed"
    },
    paperReadiness: {
      paper_ready: paperReady,
      readiness_state: paperReady ? "paper_ready" : "research_memo",
      blocked_for_paper_scale: !paperReady,
      blocking_reasons: input.missingBaselineDetected
        ? ["missing_baseline", "missing_quantitative_comparison"]
        : []
    },
    reviewDecision: {
      outcome: ungated ? "ungated_ablation_allows_risk" : "blocked_for_paper_scale",
      missing_baseline_detected: input.missingBaselineDetected,
      comparative_claim_blocked_or_downgraded: !ungated,
      recommendation: input.missingBaselineDetected
        ? "Keep claims descriptive until a baseline row exists."
        : "Comparison may proceed."
    },
    comparativeClaimBlockedOrDowngraded: !ungated && blockedComparativeClaims.length > 0,
    repairActionCount: !ungated && blockedComparativeClaims.length > 0 ? 1 : 0
  };
}

async function writeDryRunArtifacts(input: {
  taskId: string;
  title?: string;
  seedSourceMode: string;
  runId: string;
  runDir: string;
  condition: ReturnType<typeof resolveGovernanceBenchmarkCondition>;
  metricRows: SeedMetricRow[];
  resultsTable: ReturnType<typeof buildResultsTable>;
  missingBaselineDetected: boolean;
  claimArtifacts: ReturnType<typeof buildClaimArtifacts>;
}): Promise<void> {
  await writeJson(path.join(input.runDir, "governance_condition.json"), {
    ...input.condition,
    run_id: input.runId,
    task_id: input.taskId,
    recorded_at: new Date().toISOString(),
    replay_mode: "dry_run"
  });
  await writeJson(path.join(input.runDir, "result_table.json"), input.resultsTable);
  await fs.writeFile(path.join(input.runDir, "evidence_store.jsonl"), renderEvidenceJsonl(input.metricRows), "utf8");
  await writeJson(path.join(input.runDir, "figure_audit", "figure_audit_summary.json"), {
    generated_by: "governance-benchmark dry-run",
    severe_mismatch_count: 0,
    review_block_required: input.missingBaselineDetected,
    notes: ["No figures are generated in the dry-run replay."]
  });
  await writeJson(path.join(input.runDir, "review", "minimum_gate.json"), {
    task_id: input.taskId,
    title: input.title,
    missing_baseline_detected: input.missingBaselineDetected,
    passed: !input.missingBaselineDetected,
    checks: [
      {
        id: "baseline_or_comparator",
        passed: !input.missingBaselineDetected,
        detail: input.missingBaselineDetected
          ? "The seed result table has proposed-condition rows but no baseline row."
          : "A baseline row is present."
      },
      {
        id: "claim_evidence_linkage",
        passed: true,
        detail: "Descriptive claims map to the proposed-condition result row."
      }
    ]
  });
  await writeJson(path.join(input.runDir, "review", "paper_quality_evaluation.json"), {
    paper_ready: input.claimArtifacts.paperReadiness.paper_ready,
    genre: input.claimArtifacts.paperReadiness.readiness_state,
    evidence_ceiling: input.claimArtifacts.evidenceGateDecision.allowed_claim_ceiling
  });
  await writeJson(path.join(input.runDir, "review", "review_packet.json"), {
    task_id: input.taskId,
    run_id: input.runId,
    seed_source_mode: input.seedSourceMode,
    missing_baseline_detected: input.missingBaselineDetected,
    result_table: input.resultsTable,
    blocked_comparative_claims: input.claimArtifacts.evidenceGateDecision.blocked_comparative_claims
  });
  await writeJson(path.join(input.runDir, "review", "paper_critique.json"), {
    stage: "pre_draft_review",
    manuscript_type: input.claimArtifacts.paperReadiness.readiness_state,
    manuscript_claim_risk_summary: input.missingBaselineDetected
      ? "Comparative improvement claims are unsupported because the baseline row is missing."
      : "Comparative claim evidence is present.",
    claim_ceiling_applied: input.condition.gates.claim_ceiling
  });
  await writeJson(path.join(input.runDir, "review", "decision.json"), input.claimArtifacts.reviewDecision);
  await writeJson(path.join(input.runDir, "paper", "claim_evidence_table.json"), input.claimArtifacts.claimEvidenceTable);
  await writeJson(path.join(input.runDir, "paper", "claim_status_table.json"), input.claimArtifacts.claimStatusTable);
  await writeJson(path.join(input.runDir, "paper", "evidence_links.json"), input.claimArtifacts.evidenceLinks);
  await writeJson(path.join(input.runDir, "paper", "evidence_gate_decision.json"), input.claimArtifacts.evidenceGateDecision);
  await writeJson(path.join(input.runDir, "paper", "paper_readiness.json"), input.claimArtifacts.paperReadiness);
  await fs.mkdir(path.join(input.runDir, "paper"), { recursive: true });
  await fs.writeFile(
    path.join(input.runDir, "paper", "main.tex"),
    [
      "\\section{AGB-001 Dry-Run Result}",
      input.missingBaselineDetected
        ? "The seed supports only a descriptive proposed-condition result; no baseline comparison is claimed."
        : "The seed includes enough rows for a comparison.",
      ""
    ].join("\n"),
    "utf8"
  );
}

function dryRunPassed(reports: GovernanceBenchmarkDryRunConditionReport[]): boolean {
  const gated = reports.find((report) => report.condition === "gated");
  const ungated = reports.find((report) => report.condition === "ungated");
  return Boolean(
    gated?.contract.passed
      && ungated?.contract.passed
      && gated.missing_baseline_detected
      && gated.comparative_claim_blocked_or_downgraded
  );
}

function renderReadme(summary: {
  task_id: string;
  generated_at: string;
  output_dir: string;
  passed: boolean;
  conditions: GovernanceBenchmarkDryRunConditionReport[];
}): string {
  const lines = [
    `# ${summary.task_id} Governance Benchmark Dry-Run`,
    "",
    `Generated: ${summary.generated_at}`,
    `Result: ${summary.passed ? "passed" : "failed"}`,
    "",
    "## Conditions",
    ""
  ];
  for (const condition of summary.conditions) {
    lines.push(
      `- ${condition.condition}: run=${condition.run_id}, contract=${condition.contract.passed ? "passed" : "failed"}, missing_baseline=${condition.missing_baseline_detected}, comparative_claim_blocked_or_downgraded=${condition.comparative_claim_blocked_or_downgraded}`
    );
  }
  lines.push(
    "",
    "## Contract",
    "",
    "This dry-run replays the seed result table into governed artifacts. The gated condition must detect the missing baseline and cap claims at a descriptive research memo. The ungated condition is retained as an ablation surface for scoring.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

function renderEvidenceJsonl(rows: SeedMetricRow[]): string {
  const entries = rows.map((row) => ({
    id: `ev_${row.condition}_${row.metric}`.replace(/[^a-z0-9_]+/giu, "_"),
    source: "seed_materials/result_table.csv",
    condition: row.condition,
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    notes: row.notes
  }));
  entries.push({
    id: "ev_missing_baseline",
    source: "seed_materials/result_table.csv",
    condition: "baseline_classifier",
    metric: "macro_f1",
    value: Number.NaN,
    unit: "ratio",
    notes: "No baseline row is present; comparative improvement is unsupported."
  });
  return entries.map((entry) => JSON.stringify({ ...entry, value: Number.isFinite(entry.value) ? entry.value : null })).join("\n") + "\n";
}

function parseCsv(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
  const [headerLine, ...body] = lines;
  if (!headerLine) {
    return [];
  }
  const headers = parseCsvLine(headerLine);
  return body.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
