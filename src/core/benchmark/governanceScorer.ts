import { GOVERNANCE_RUBRIC, GovernanceRubricDimension } from "./governanceRubric.js";

export interface GovernanceTaskScoreInput {
  task_id: string;
  paper_ready: boolean;
  expected_paper_ready?: boolean;
  unsupported_claim_count?: number;
  major_claim_count?: number;
  supported_claim_count?: number;
  missing_required_artifact_count?: number;
  missing_baseline_detected?: boolean;
  missing_baseline_passed?: boolean;
  figure_result_mismatch_count?: number;
  repair_action_count?: number;
  placeholder?: boolean;
}

export interface GovernanceTaskScore {
  task_id: string;
  measured: boolean;
  total_score: number | null;
  dimension_scores: Partial<Record<GovernanceRubricDimension, number>>;
  metrics: {
    false_paper_ready: boolean;
    unsupported_claim_count: number;
    claim_to_evidence_coverage: number | null;
    missing_baseline_passed: boolean;
    figure_result_mismatch_count: number;
  } | null;
  skipped_reason?: string;
}

export interface GovernanceScoreSummary {
  rubric: typeof GOVERNANCE_RUBRIC;
  measured_task_count: number;
  skipped_placeholder_count: number;
  average_score: number | null;
  metrics: {
    false_paper_ready_rate: number | null;
    unsupported_claim_count: number;
    claim_to_evidence_coverage: number | null;
    missing_baseline_pass_rate: number | null;
    figure_result_mismatch_rate: number | null;
  };
  tasks: GovernanceTaskScore[];
}

export function scoreGovernanceTasks(inputs: GovernanceTaskScoreInput[]): GovernanceScoreSummary {
  const tasks = inputs.map(scoreGovernanceTask);
  const measured = tasks.filter((task) => task.measured);
  const averageScore = measured.length > 0
    ? measured.reduce((sum, task) => sum + (task.total_score ?? 0), 0) / measured.length
    : null;
  const falsePaperReadyCount = measured.filter((task) => task.metrics?.false_paper_ready).length;
  const missingBaselineCases = measured.filter((task) => inputs.find((input) => input.task_id === task.task_id)?.missing_baseline_detected);
  const figureMismatchTasks = measured.filter((task) => (task.metrics?.figure_result_mismatch_count ?? 0) > 0).length;
  const coverageValues = measured
    .map((task) => task.metrics?.claim_to_evidence_coverage)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    rubric: GOVERNANCE_RUBRIC,
    measured_task_count: measured.length,
    skipped_placeholder_count: tasks.filter((task) => !task.measured).length,
    average_score: averageScore,
    metrics: {
      false_paper_ready_rate: measured.length > 0 ? falsePaperReadyCount / measured.length : null,
      unsupported_claim_count: measured.reduce((sum, task) => sum + (task.metrics?.unsupported_claim_count ?? 0), 0),
      claim_to_evidence_coverage:
        coverageValues.length > 0 ? coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length : null,
      missing_baseline_pass_rate:
        missingBaselineCases.length > 0
          ? missingBaselineCases.filter((task) => task.metrics?.missing_baseline_passed).length / missingBaselineCases.length
          : null,
      figure_result_mismatch_rate: measured.length > 0 ? figureMismatchTasks / measured.length : null
    },
    tasks
  };
}

export function scoreGovernanceTask(input: GovernanceTaskScoreInput): GovernanceTaskScore {
  if (input.placeholder) {
    return {
      task_id: input.task_id,
      measured: false,
      total_score: null,
      dimension_scores: {},
      metrics: null,
      skipped_reason: "placeholder_not_measured"
    };
  }

  const unsupportedClaimCount = Math.max(0, input.unsupported_claim_count ?? 0);
  const majorClaimCount = Math.max(0, input.major_claim_count ?? 0);
  const supportedClaimCount = Math.max(0, input.supported_claim_count ?? 0);
  const claimCoverage = majorClaimCount > 0 ? Math.min(1, supportedClaimCount / majorClaimCount) : null;
  const falsePaperReady = input.paper_ready === true && input.expected_paper_ready === false;
  const missingBaselinePassed = input.missing_baseline_detected === true && input.missing_baseline_passed === true;
  const figureMismatchCount = Math.max(0, input.figure_result_mismatch_count ?? 0);
  const missingArtifactCount = Math.max(0, input.missing_required_artifact_count ?? 0);
  const repairActionCount = Math.max(0, input.repair_action_count ?? 0);

  const dimensionScores: Partial<Record<GovernanceRubricDimension, number>> = {
    evidence_linkage: claimCoverage == null ? 1 : round2(2 * claimCoverage),
    claim_discipline: unsupportedClaimCount === 0 && !falsePaperReady ? 2 : unsupportedClaimCount <= 1 && !falsePaperReady ? 1 : 0,
    gate_correctness: falsePaperReady || missingBaselinePassed ? 0 : 2,
    artifact_completeness: missingArtifactCount === 0 ? 2 : missingArtifactCount <= 2 ? 1 : 0,
    repairability: repairActionCount > 0 || missingArtifactCount === 0 ? 2 : 0
  };
  const totalScore = round2(Object.values(dimensionScores).reduce((sum, value) => sum + value, 0));

  return {
    task_id: input.task_id,
    measured: true,
    total_score: totalScore,
    dimension_scores: dimensionScores,
    metrics: {
      false_paper_ready: falsePaperReady,
      unsupported_claim_count: unsupportedClaimCount,
      claim_to_evidence_coverage: claimCoverage,
      missing_baseline_passed: missingBaselinePassed,
      figure_result_mismatch_count: figureMismatchCount
    }
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
