import type { GraphNodeId } from "../../types.js";

export interface ArtifactPolicy {
  include: string[];
  exclude: string[];
  maxTokenBudget: number | null;
}

export interface SkillPolicy {
  enabled: string[];
}

export interface PromptPolicy {
  templateFile: string | null;
  appendix: string | null;
}

export interface CompressionPolicy {
  strategy: "none" | "truncate" | "summary";
  maxLinesPerArtifact: number | null;
}

export interface HarnessCandidate {
  id: string;
  description: string;
  targetNodes: GraphNodeId[];
  artifactPolicy: ArtifactPolicy;
  skillPolicy: SkillPolicy;
  promptPolicy: PromptPolicy;
  compressionPolicy: CompressionPolicy;
  failureAware: boolean;
  reviewHeavy: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
