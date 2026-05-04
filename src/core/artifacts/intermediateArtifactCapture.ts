import path from "node:path";
import { promises as fs } from "node:fs";

export type IntermediateArtifactNode = "implement_experiments" | "run_experiments";
export type IntermediateArtifactRole =
  | "candidate_output"
  | "diagnostic"
  | "log"
  | "metric"
  | "partial"
  | "verification";
export type IntermediateArtifactParseAs = "json" | "jsonl" | "text" | "none";

export interface IntermediateArtifactCaptureInput {
  artifactId: string;
  filePath?: string | null;
  relativePath?: string | null;
  role: IntermediateArtifactRole;
  required: boolean;
  parseAs?: IntermediateArtifactParseAs;
  notes?: string[];
}

export interface IntermediateArtifactCaptureEntry {
  artifact_id: string;
  relative_path: string;
  path_kind: "run_relative" | "external" | "omitted";
  role: IntermediateArtifactRole;
  required: boolean;
  status: "present" | "missing" | "external_not_checked" | "omitted";
  parse_as: IntermediateArtifactParseAs;
  parse_status: "parseable" | "malformed" | "not_checked" | "missing";
  byte_size?: number;
  notes: string[];
}

export interface IntermediateArtifactCaptureManifest {
  version: 1;
  run_id: string;
  node: IntermediateArtifactNode;
  phase: string;
  status: string;
  generated_at: string;
  source_of_truth: "run_scoped_artifacts";
  entries: IntermediateArtifactCaptureEntry[];
  summary: {
    total: number;
    present: number;
    missing_required: number;
    malformed: number;
    external_not_checked: number;
  };
  claim_ceiling_note: string;
}

export interface IntermediateArtifactCaptureValidationIssue {
  code: string;
  artifact_id?: string;
  message: string;
}

export async function buildIntermediateArtifactCaptureManifest(input: {
  runId: string;
  runDir: string;
  node: IntermediateArtifactNode;
  phase: string;
  status: string;
  artifacts: IntermediateArtifactCaptureInput[];
  generatedAt?: string;
}): Promise<IntermediateArtifactCaptureManifest> {
  const entries: IntermediateArtifactCaptureEntry[] = [];
  for (const artifact of input.artifacts) {
    entries.push(await inspectCaptureArtifact(input.runId, input.runDir, artifact));
  }
  return {
    version: 1,
    run_id: input.runId,
    node: input.node,
    phase: input.phase,
    status: input.status,
    generated_at: input.generatedAt || new Date().toISOString(),
    source_of_truth: "run_scoped_artifacts",
    entries,
    summary: {
      total: entries.length,
      present: entries.filter((entry) => entry.status === "present").length,
      missing_required: entries.filter((entry) => entry.required && entry.status === "missing").length,
      malformed: entries.filter((entry) => entry.parse_status === "malformed").length,
      external_not_checked: entries.filter((entry) => entry.status === "external_not_checked").length
    },
    claim_ceiling_note:
      "Intermediate artifacts are diagnostic until linked run-scoped evidence, result tables, review gates, and audit contracts support a stronger claim."
  };
}

export function validateIntermediateArtifactCaptureManifest(
  manifest: IntermediateArtifactCaptureManifest
): IntermediateArtifactCaptureValidationIssue[] {
  const issues: IntermediateArtifactCaptureValidationIssue[] = [];
  if (manifest.version !== 1) {
    issues.push({
      code: "intermediate_capture_version_invalid",
      message: "Intermediate artifact capture manifest must use version 1."
    });
  }
  if (!manifest.run_id.trim()) {
    issues.push({
      code: "intermediate_capture_run_id_missing",
      message: "Intermediate artifact capture manifest must include run_id."
    });
  }
  if (!Array.isArray(manifest.entries)) {
    issues.push({
      code: "intermediate_capture_entries_missing",
      message: "Intermediate artifact capture manifest must include entries."
    });
    return issues;
  }
  for (const entry of manifest.entries) {
    if (path.isAbsolute(entry.relative_path) || entry.relative_path.includes("..")) {
      issues.push({
        code: "intermediate_capture_path_not_portable",
        artifact_id: entry.artifact_id,
        message: `Intermediate artifact path must be run-relative or a placeholder: ${entry.relative_path}`
      });
    }
    if (entry.required && entry.status === "missing") {
      issues.push({
        code: "intermediate_capture_required_missing",
        artifact_id: entry.artifact_id,
        message: `Required intermediate artifact is missing: ${entry.artifact_id}`
      });
    }
    if (entry.parse_status === "malformed") {
      issues.push({
        code: "intermediate_capture_malformed",
        artifact_id: entry.artifact_id,
        message: `Intermediate artifact is malformed: ${entry.artifact_id}`
      });
    }
  }
  return issues;
}

async function inspectCaptureArtifact(
  runId: string,
  runDir: string,
  artifact: IntermediateArtifactCaptureInput
): Promise<IntermediateArtifactCaptureEntry> {
  const parseAs = artifact.parseAs || "none";
  const normalized = normalizeCapturePath({
    runId,
    runDir,
    filePath: artifact.filePath,
    relativePath: artifact.relativePath
  });
  const base = {
    artifact_id: artifact.artifactId,
    relative_path: normalized.relativePath,
    path_kind: normalized.pathKind,
    role: artifact.role,
    required: artifact.required,
    parse_as: parseAs,
    notes: artifact.notes || []
  } satisfies Omit<IntermediateArtifactCaptureEntry, "status" | "parse_status" | "byte_size">;

  if (normalized.pathKind === "omitted") {
    return {
      ...base,
      status: "omitted",
      parse_status: "not_checked"
    };
  }
  if (normalized.pathKind === "external") {
    return {
      ...base,
      status: "external_not_checked",
      parse_status: "not_checked"
    };
  }

  const absolutePath = path.join(runDir, normalized.relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return {
        ...base,
        status: "missing",
        parse_status: "missing"
      };
    }
    const parseStatus = await inspectParseStatus(absolutePath, parseAs);
    return {
      ...base,
      status: "present",
      parse_status: parseStatus,
      byte_size: stat.size
    };
  } catch {
    return {
      ...base,
      status: "missing",
      parse_status: "missing"
    };
  }
}

function normalizeCapturePath(input: {
  runId: string;
  runDir: string;
  filePath?: string | null;
  relativePath?: string | null;
}): { relativePath: string; pathKind: "run_relative" | "external" | "omitted" } {
  const explicit = normalizeRelative(input.relativePath);
  if (explicit) {
    return { relativePath: explicit, pathKind: "run_relative" };
  }
  const rawPath = input.filePath?.trim();
  if (!rawPath) {
    return { relativePath: "<omitted>", pathKind: "omitted" };
  }
  const runPrefix = `.autolabos/runs/${input.runId}/`;
  const normalizedRaw = rawPath.replace(/\\/g, "/");
  if (normalizedRaw.startsWith(runPrefix)) {
    return {
      relativePath: normalizeRelative(normalizedRaw.slice(runPrefix.length)) || "<omitted>",
      pathKind: "run_relative"
    };
  }
  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
  const relativeToRun = path.relative(input.runDir, absolute).replace(/\\/g, "/");
  if (relativeToRun && !relativeToRun.startsWith("..") && !path.isAbsolute(relativeToRun)) {
    return {
      relativePath: normalizeRelative(relativeToRun) || "<omitted>",
      pathKind: "run_relative"
    };
  }
  return {
    relativePath: "<external-artifact>",
    pathKind: "external"
  };
}

function normalizeRelative(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, "/").replace(/^\.\/+/u, "");
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

async function inspectParseStatus(
  filePath: string,
  parseAs: IntermediateArtifactParseAs
): Promise<IntermediateArtifactCaptureEntry["parse_status"]> {
  if (parseAs === "none" || parseAs === "text") {
    return "not_checked";
  }
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (parseAs === "json") {
      JSON.parse(raw);
      return "parseable";
    }
    const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      JSON.parse(line);
    }
    return "parseable";
  } catch {
    return "malformed";
  }
}
