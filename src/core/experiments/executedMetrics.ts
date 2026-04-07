export function detectPreflightOnlyMetrics(metrics: Record<string, unknown>): string | null {
  const mode = typeof metrics.mode === "string" ? metrics.mode.trim().toLowerCase() : "";
  const notes = typeof metrics.notes === "string" ? metrics.notes.trim() : "";
  if (mode === "preflight") {
    return "Experiment only emitted preflight metrics; no training or evaluation was executed.";
  }
  if (/no training\/evaluation executed/i.test(notes)) {
    return "Experiment reported that no training or evaluation was executed.";
  }
  return null;
}
