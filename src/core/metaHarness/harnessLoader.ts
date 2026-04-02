import { GRAPH_NODE_ORDER } from "../../types.js";
import { BASE_HARNESS, BUILTIN_HARNESS_PRESETS } from "./presets.js";
import type { HarnessCandidate, ValidationResult } from "./types.js";

const ALLOWED_NODE_SET = new Set<string>(GRAPH_NODE_ORDER);

function isPositiveInteger(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value > 0);
}

export function loadHarnessCandidate(id: string): HarnessCandidate {
  const candidate = BUILTIN_HARNESS_PRESETS.find((entry) => entry.id === id);
  if (!candidate) {
    throw new Error(`Unknown harness candidate: ${id}`);
  }
  return candidate;
}

export function listHarnessCandidates(): HarnessCandidate[] {
  return [...BUILTIN_HARNESS_PRESETS];
}

export function validateHarnessCandidate(candidate: HarnessCandidate): ValidationResult {
  const errors: string[] = [];

  if (!candidate.id.trim()) {
    errors.push("Harness candidate id must not be empty.");
  }

  for (const node of candidate.targetNodes) {
    if (!ALLOWED_NODE_SET.has(node)) {
      errors.push(`Harness candidate contains unsupported target node: ${node}`);
    }
  }

  if (!isPositiveInteger(candidate.artifactPolicy.maxTokenBudget)) {
    errors.push("artifactPolicy.maxTokenBudget must be null or a positive integer.");
  }

  if (!isPositiveInteger(candidate.compressionPolicy.maxLinesPerArtifact)) {
    errors.push("compressionPolicy.maxLinesPerArtifact must be null or a positive integer.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export const DEFAULT_HARNESS_CANDIDATE = BASE_HARNESS;
