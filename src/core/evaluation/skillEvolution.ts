import { promises as fs } from "node:fs";

import { EvalHarnessReport } from "./evalHarness.js";
import { fileExists, readJsonFile, writeJsonFile } from "../../utils/fs.js";

export const TRACKED_SKILLS = [
  "tui-validation-loop-automation",
  "tui-state-validation",
  "paper-scale-research-loop",
  "paper-build-output-hygiene"
] as const;

export type TrackedSkillName = (typeof TRACKED_SKILLS)[number];

/**
 * Score threshold used to turn eval-harness run scores into pass/fail outcomes for the
 * skill-evolution rollup. This is intentionally conservative and maps cleanly to the
 * existing overall score semantics in the eval harness output.
 */
export const SKILL_PASS_SCORE_THRESHOLD = 0.8;

/**
 * Maximum allowed regression before the skill-evolution loop exits non-zero.
 * The requested 5% threshold is expressed here as a named constant so the shell wrapper
 * and tests can reference the same value.
 */
export const SKILL_REGRESSION_THRESHOLD = 0.05;

export interface SkillPassRateSnapshotEntry {
  skill: TrackedSkillName;
  pass_rate: number;
  run_count: number;
  signal_source: "skill_runs" | "workspace_fallback";
}

export interface SkillPassRateBaseline {
  version: 1;
  generated_at: string;
  regression_threshold: number;
  pass_score_threshold: number;
  skills: SkillPassRateSnapshotEntry[];
}

export interface SkillPassRateComparisonRow {
  skill: TrackedSkillName;
  baseline: number;
  current: number;
  delta: number;
  status: "OK" | "REGRESSED";
  signal_source: SkillPassRateSnapshotEntry["signal_source"];
  run_count: number;
}

export async function loadEvalHarnessReport(reportPath: string): Promise<EvalHarnessReport> {
  return readJsonFile<EvalHarnessReport>(reportPath);
}

export async function loadSkillBaseline(baselinePath: string): Promise<SkillPassRateBaseline | null> {
  if (!(await fileExists(baselinePath))) {
    return null;
  }
  return readJsonFile<SkillPassRateBaseline>(baselinePath);
}

export async function writeSkillBaseline(baselinePath: string, baseline: SkillPassRateBaseline): Promise<void> {
  await writeJsonFile(baselinePath, baseline);
}

export function buildSkillBaseline(
  report: EvalHarnessReport,
  options?: {
    regressionThreshold?: number;
    passScoreThreshold?: number;
  }
): SkillPassRateBaseline {
  const regressionThreshold = options?.regressionThreshold ?? SKILL_REGRESSION_THRESHOLD;
  const passScoreThreshold = options?.passScoreThreshold ?? SKILL_PASS_SCORE_THRESHOLD;
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    regression_threshold: regressionThreshold,
    pass_score_threshold: passScoreThreshold,
    skills: computeSkillPassRates(report, {
      passScoreThreshold
    })
  };
}

export function computeSkillPassRates(
  report: EvalHarnessReport,
  options?: {
    passScoreThreshold?: number;
  }
): SkillPassRateSnapshotEntry[] {
  const passScoreThreshold = options?.passScoreThreshold ?? SKILL_PASS_SCORE_THRESHOLD;
  const workspacePassRate = computePassRate(report.runs.map((run) => run.scores.overall), passScoreThreshold);

  return TRACKED_SKILLS.map((skill) => {
    const taggedRuns = report.runs.filter((run) => extractSkillSignals(run).includes(skill));
    if (taggedRuns.length === 0) {
      return {
        skill,
        pass_rate: workspacePassRate,
        run_count: report.runs.length,
        signal_source: "workspace_fallback"
      };
    }
    return {
      skill,
      pass_rate: computePassRate(
        taggedRuns.map((run) => run.scores.overall),
        passScoreThreshold
      ),
      run_count: taggedRuns.length,
      signal_source: "skill_runs"
    };
  });
}

export function compareSkillBaselines(
  baseline: SkillPassRateBaseline,
  current: SkillPassRateBaseline
): SkillPassRateComparisonRow[] {
  const baselineMap = new Map(baseline.skills.map((entry) => [entry.skill, entry] as const));

  return current.skills.map((entry) => {
    const previous = baselineMap.get(entry.skill);
    const baselineValue = previous?.pass_rate ?? entry.pass_rate;
    const delta = round(entry.pass_rate - baselineValue);
    return {
      skill: entry.skill,
      baseline: baselineValue,
      current: entry.pass_rate,
      delta,
      status: delta < -baseline.regression_threshold ? "REGRESSED" : "OK",
      signal_source: entry.signal_source,
      run_count: entry.run_count
    };
  });
}

export function renderSkillEvolutionReport(rows: SkillPassRateComparisonRow[]): string {
  const header = [
    padRight("SKILL", 34),
    padLeft("BASELINE", 8),
    padLeft("CURRENT", 8),
    padLeft("DELTA", 8),
    padLeft("STATUS", 10)
  ].join(" ");
  const body = rows.map((row) =>
    [
      padRight(row.skill, 34),
      padLeft(row.baseline.toFixed(2), 8),
      padLeft(row.current.toFixed(2), 8),
      padLeft(formatDelta(row.delta), 8),
      padLeft(row.status, 10)
    ].join(" ")
  );
  return [header, ...body].join("\n");
}

export async function runSkillEvolutionComparison(options: {
  latestReportPath: string;
  baselinePath: string;
  regressionThreshold?: number;
  passScoreThreshold?: number;
}): Promise<{
  baselineCreated: boolean;
  baseline: SkillPassRateBaseline;
  current: SkillPassRateBaseline;
  rows: SkillPassRateComparisonRow[];
}> {
  const report = await loadEvalHarnessReport(options.latestReportPath);
  const current = buildSkillBaseline(report, {
    regressionThreshold: options.regressionThreshold,
    passScoreThreshold: options.passScoreThreshold
  });
  const existingBaseline = await loadSkillBaseline(options.baselinePath);
  if (!existingBaseline) {
    await writeSkillBaseline(options.baselinePath, current);
    return {
      baselineCreated: true,
      baseline: current,
      current,
      rows: compareSkillBaselines(current, current)
    };
  }

  const rows = compareSkillBaselines(existingBaseline, current);
  return {
    baselineCreated: false,
    baseline: existingBaseline,
    current,
    rows
  };
}

export async function appendLatestEvalHarnessHistory(
  latestReportPath: string,
  historyDir: string
): Promise<string> {
  const report = await loadEvalHarnessReport(latestReportPath);
  await fs.mkdir(historyDir, { recursive: true });
  const fileName = `${report.generated_at.slice(0, 10)}.json`;
  const historyPath = `${historyDir}/${fileName}`;
  let existing: EvalHarnessReport[] = [];
  if (await fileExists(historyPath)) {
    existing = await readJsonFile<EvalHarnessReport[]>(historyPath);
  }
  existing.push(report);
  await writeJsonFile(historyPath, existing);
  return historyPath;
}

function extractSkillSignals(run: EvalHarnessReport["runs"][number]): string[] {
  const candidateSets: unknown[] = [
    (run as { skill_names?: unknown }).skill_names,
    (run as { skills?: unknown }).skills,
    (run as { metadata?: { skill_names?: unknown; skills?: unknown } }).metadata?.skill_names,
    (run as { metadata?: { skill_names?: unknown; skills?: unknown } }).metadata?.skills,
    (run as { labels?: { skills?: unknown } }).labels?.skills
  ];

  for (const value of candidateSets) {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

function computePassRate(scores: number[], threshold: number): number {
  if (scores.length === 0) {
    return 0;
  }
  const passing = scores.filter((score) => Number.isFinite(score) && score >= threshold).length;
  return round(passing / scores.length);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatDelta(value: number): string {
  const rendered = value.toFixed(2);
  return value > 0 ? `+${rendered}` : rendered;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : `${" ".repeat(width - value.length)}${value}`;
}
