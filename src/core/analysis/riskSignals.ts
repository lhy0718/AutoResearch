export interface RiskSignal {
  type: string;
  severity: "warn" | "critical";
  detail: string;
}

export function detectNaNInf(metrics: object): RiskSignal | null {
  const findings: string[] = [];
  visitValue(metrics, [], (value, path) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      findings.push(`${formatPath(path)}=${String(value)}`);
      return;
    }
    if (typeof value === "string" && /^(?:nan|[-+]?inf(?:inity)?)$/iu.test(value.trim())) {
      findings.push(`${formatPath(path)}=${value.trim()}`);
    }
  });

  if (findings.length === 0) {
    return null;
  }

  return {
    type: "nan_inf",
    severity: "critical",
    detail: `Detected NaN/Inf metric values: ${findings.slice(0, 5).join(", ")}.`
  };
}

export function detectStatisticalAnomaly(metrics: object): RiskSignal | null {
  const findings: string[] = [];
  visitValue(metrics, [], (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const record = value as Record<string, unknown>;
    const lower = asFiniteNumber(record.lower);
    const upper = asFiniteNumber(record.upper);
    if (lower != null && upper != null && lower > upper) {
      findings.push(`${formatPath(path)} has lower (${lower}) > upper (${upper})`);
    }

    for (const [key, child] of Object.entries(record)) {
      const numericValue = asFiniteNumber(child);
      if (numericValue == null) {
        continue;
      }
      const normalizedKey = key.toLowerCase();
      const childPath = formatPath([...path, key]);
      if ((normalizedKey === "p_value" || normalizedKey === "pvalue") && (numericValue < 0 || numericValue > 1)) {
        findings.push(`${childPath}=${numericValue} is outside [0,1]`);
      }
      if (
        (normalizedKey === "sample_size" || normalizedKey === "n" || normalizedKey === "count")
        && numericValue <= 0
      ) {
        findings.push(`${childPath}=${numericValue} is not a positive sample size`);
      }
      if (
        /(variance|stddev|stdev|stderr|standard_error)$/iu.test(normalizedKey)
        && numericValue < 0
      ) {
        findings.push(`${childPath}=${numericValue} cannot be negative`);
      }
    }
  });

  if (findings.length === 0) {
    return null;
  }

  return {
    type: "statistical_anomaly",
    severity: "critical",
    detail: `Detected statistically inconsistent metrics: ${findings.slice(0, 5).join(", ")}.`
  };
}

export function detectUnverifiedCitations(evidenceStore: object[]): RiskSignal | null {
  const criticalEntries: string[] = [];
  const warningEntries: string[] = [];

  for (const [index, row] of evidenceStore.entries()) {
    const record = asRecord(row);
    if (!record) {
      continue;
    }
    const identifier =
      asNonEmptyString(record.evidence_id)
      || asNonEmptyString(record.paper_id)
      || asNonEmptyString(record.claim)
      || `row_${index + 1}`;
    const status = normalizeStatus(
      asNonEmptyString(record.verification_status)
      || asNonEmptyString(record.citation_status)
      || asNonEmptyString(record.status)
    );
    const sourceType = normalizeStatus(asNonEmptyString(record.source_type));
    const locatorKeys = ["doi", "url", "landing_url", "pdf_url", "source_url", "arxiv_id"] as const;
    const hasLocatorFields = locatorKeys.some((key) => key in record);
    const hasAnyLocatorValue = locatorKeys.some((key) => Boolean(asNonEmptyString(record[key])));

    if (status === "blocked" || status === "unverified" || status === "missing") {
      criticalEntries.push(identifier);
      continue;
    }

    if (sourceType === "abstract_only" || sourceType === "metadata_only") {
      warningEntries.push(identifier);
      continue;
    }

    if (hasLocatorFields && !hasAnyLocatorValue) {
      warningEntries.push(identifier);
    }
  }

  if (criticalEntries.length > 0) {
    return {
      type: "unverified_citations",
      severity: "critical",
      detail: `Detected unverified citation evidence: ${criticalEntries.slice(0, 5).join(", ")}.`
    };
  }

  if (warningEntries.length > 0) {
    return {
      type: "unverified_citations",
      severity: "warn",
      detail: `Detected citation evidence with weak or incomplete source verification: ${warningEntries.slice(0, 5).join(", ")}.`
    };
  }

  return null;
}

function visitValue(
  value: unknown,
  path: string[],
  visitor: (value: unknown, path: string[]) => void
): void {
  visitor(value, path);
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      visitValue(child, [...path, String(index)], visitor);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitValue(child, [...path, key], visitor);
  }
}

function formatPath(path: string[]): string {
  return path.length > 0 ? path.join(".") : "metrics";
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStatus(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}
