import {
  validateResultsTableSchema,
  type ResultsTableSchema
} from "../analysis/resultsTableSchema.js";

export interface ResultTableScoringIssue {
  code: string;
  row_index: number | null;
  metric?: string;
  message: string;
}

export interface ResultTableScore {
  measured: boolean;
  valid_schema: boolean;
  row_count: number;
  complete_row_count: number;
  missing_metric_count: number;
  missing_baseline_count: number;
  missing_comparator_count: number;
  missing_delta_count: number;
  comparator_coverage: number | null;
  superiority_claim_supported: boolean;
  issues: ResultTableScoringIssue[];
}

export function scoreResultTableArtifact(value: unknown): ResultTableScore {
  const normalized = normalizeResultTableArtifact(value);
  const validation = validateResultsTableSchema(normalized.value);
  const rows = validation.rows;
  const issues: ResultTableScoringIssue[] = [
    ...normalized.issues,
    ...validation.issues.map((message) => ({
      code: "result_table_schema_invalid",
      row_index: extractRowIndex(message),
      message
    }))
  ];

  if (!Array.isArray(normalized.value)) {
    return {
      measured: false,
      valid_schema: false,
      row_count: 0,
      complete_row_count: 0,
      missing_metric_count: 0,
      missing_baseline_count: 0,
      missing_comparator_count: 0,
      missing_delta_count: 0,
      comparator_coverage: null,
      superiority_claim_supported: false,
      issues
    };
  }

  rows.forEach((row, index) => {
    if (!row.metric.trim()) {
      issues.push({
        code: "result_table_metric_missing",
        row_index: index,
        message: `results_table[${index}] must name the metric.`
      });
    }
    if (row.baseline === null) {
      issues.push({
        code: "result_table_baseline_missing",
        row_index: index,
        metric: row.metric,
        message: `results_table[${index}] (${row.metric || "unknown metric"}) is missing a baseline value.`
      });
    }
    if (row.comparator === null) {
      issues.push({
        code: "result_table_comparator_missing",
        row_index: index,
        metric: row.metric,
        message: `results_table[${index}] (${row.metric || "unknown metric"}) is missing a comparator value.`
      });
    }
    if (row.delta === null) {
      issues.push({
        code: "result_table_delta_missing",
        row_index: index,
        metric: row.metric,
        message: `results_table[${index}] (${row.metric || "unknown metric"}) is missing a delta value.`
      });
    }
  });

  const completeRows = rows.filter(isCompleteRow);
  const missingMetricCount = rows.filter((row) => !row.metric.trim()).length;
  const missingBaselineCount = rows.filter((row) => row.baseline === null).length;
  const missingComparatorCount = rows.filter((row) => row.comparator === null).length;
  const missingDeltaCount = rows.filter((row) => row.delta === null).length;

  return {
    measured: true,
    valid_schema: normalized.valid_schema && validation.valid && issues.length === 0,
    row_count: rows.length,
    complete_row_count: completeRows.length,
    missing_metric_count: missingMetricCount,
    missing_baseline_count: missingBaselineCount,
    missing_comparator_count: missingComparatorCount,
    missing_delta_count: missingDeltaCount,
    comparator_coverage: rows.length > 0 ? round2(completeRows.length / rows.length) : null,
    superiority_claim_supported: completeRows.length > 0,
    issues
  };
}

function normalizeResultTableArtifact(value: unknown): {
  value: unknown;
  valid_schema: boolean;
  issues: ResultTableScoringIssue[];
} {
  if (Array.isArray(value)) {
    return { value, valid_schema: true, issues: [] };
  }
  if (!value || typeof value !== "object") {
    return { value, valid_schema: false, issues: [] };
  }

  const artifact = value as Record<string, unknown>;
  const comparisons = Array.isArray(artifact.comparisons)
    ? artifact.comparisons.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    : [];
  if (comparisons.length === 0) {
    return { value, valid_schema: false, issues: [] };
  }

  const rows = comparisons.map((comparison) => ({
    metric: stringValue(comparison.metric) || stringValue(comparison.primary) || "comparison",
    baseline: finiteNumberOrNull(comparison.baseline),
    comparator: finiteNumberOrNull(comparison.comparator),
    delta: finiteNumberOrNull(comparison.delta),
    direction: parseDirection(comparison.direction)
  }));

  return {
    value: rows,
    valid_schema: false,
    issues: [
      {
        code: "result_table_schema_noncanonical",
        row_index: null,
        message: "result_table.json uses a conditions/comparisons summary format; audit normalized it for completeness scoring, but canonical array rows are still recommended."
      }
    ]
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDirection(value: unknown): "higher_better" | "lower_better" {
  return value === "lower_better" ? "lower_better" : "higher_better";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCompleteRow(row: ResultsTableSchema[number]): boolean {
  return Boolean(row.metric.trim())
    && row.baseline !== null
    && row.comparator !== null
    && row.delta !== null;
}

function extractRowIndex(message: string): number | null {
  const match = message.match(/results_table\[(\d+)\]/u);
  return match ? Number(match[1]) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
