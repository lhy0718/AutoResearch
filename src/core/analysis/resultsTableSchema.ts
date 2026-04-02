export type ResultsTableDirection = "higher_better" | "lower_better";

export interface ResultsTableRow {
  metric: string;
  baseline: number | null;
  comparator: number | null;
  delta: number | null;
  direction: ResultsTableDirection;
}

export type ResultsTableSchema = ResultsTableRow[];

export interface ResultsTableSchemaValidation {
  valid: boolean;
  issues: string[];
  rows: ResultsTableSchema;
}

export function buildResultsTableSchema(
  metrics: string[],
  direction: ResultsTableDirection
): ResultsTableSchema {
  return uniqueStrings(metrics)
    .map((metric) => metric.trim())
    .filter(Boolean)
    .map((metric) => ({
      metric,
      baseline: null,
      comparator: null,
      delta: null,
      direction
    }));
}

export function validateResultsTableSchema(value: unknown): ResultsTableSchemaValidation {
  if (!Array.isArray(value)) {
    return {
      valid: false,
      issues: ["results_table must be an array."],
      rows: []
    };
  }

  const rows: ResultsTableSchema = [];
  const issues: string[] = [];

  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      issues.push(`results_table[${index}] must be an object.`);
      continue;
    }
    const row = candidate as Record<string, unknown>;
    const metric = typeof row.metric === "string" ? row.metric.trim() : "";
    const direction = row.direction;

    if (!metric) {
      issues.push(`results_table[${index}] must include a non-empty metric.`);
    }
    if (direction !== "higher_better" && direction !== "lower_better") {
      issues.push(`results_table[${index}] must include direction higher_better or lower_better.`);
    }

    const baseline = normalizeNullableNumber(row.baseline, `results_table[${index}].baseline`, issues);
    const comparator = normalizeNullableNumber(row.comparator, `results_table[${index}].comparator`, issues);
    const delta = normalizeNullableNumber(row.delta, `results_table[${index}].delta`, issues);

    rows.push({
      metric,
      baseline,
      comparator,
      delta,
      direction: direction === "lower_better" ? "lower_better" : "higher_better"
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    rows
  };
}

export function hasAtLeastOneCompleteResultsTableRow(rows: ResultsTableSchema | undefined): boolean {
  return (rows ?? []).some((row) => row.baseline !== null && row.comparator !== null);
}

export function hasAnyIncompleteResultsTableRow(rows: ResultsTableSchema | undefined): boolean {
  return (rows ?? []).some((row) => row.baseline === null || row.comparator === null);
}

function normalizeNullableNumber(
  value: unknown,
  label: string,
  issues: string[]
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  issues.push(`${label} must be a finite number or null.`);
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
