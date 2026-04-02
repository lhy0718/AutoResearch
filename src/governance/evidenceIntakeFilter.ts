import type { EvidenceScreeningResult, GovernancePolicy } from "./policyTypes.js";

export interface ScreeningInput {
  text: string;
  source: string;
  context: string;
}

export interface ScreeningReport {
  result: EvidenceScreeningResult;
  triggeredRules: string[];
  excerpt: string | null;
  recommendation: string;
}

export interface EvidenceScreeningRule {
  id: string;
  test: (input: ScreeningInput, policy: GovernancePolicy) => boolean;
  result: EvidenceScreeningResult;
}

const BLOCKED_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "prompt_injection", pattern: /ignore previous instructions/iu },
  { id: "prompt_injection", pattern: /disregard your system prompt/iu },
  { id: "prompt_injection", pattern: /\byou are now\b/iu },
  { id: "prompt_injection", pattern: /do not follow/iu },
  { id: "tool_invocation_attempt", pattern: /<tool>/iu },
  { id: "tool_invocation_attempt", pattern: /<function>/iu },
  { id: "tool_invocation_attempt", pattern: /execute the following command/iu },
  { id: "tool_invocation_attempt", pattern: /run the following code/iu }
];

const SUSPICIOUS_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "unsupported_strong_claim", pattern: /this proves that/iu },
  { id: "unsupported_strong_claim", pattern: /it is certain that/iu },
  { id: "unsupported_strong_claim", pattern: /definitively shows/iu }
];

export const SCREENING_RULES: EvidenceScreeningRule[] = [
  {
    id: "prompt_injection",
    result: "blocked",
    test: (input) => BLOCKED_PATTERNS.some((entry) => entry.id === "prompt_injection" && entry.pattern.test(input.text))
  },
  {
    id: "tool_invocation_attempt",
    result: "blocked",
    test: (input) =>
      BLOCKED_PATTERNS.some((entry) => entry.id === "tool_invocation_attempt" && entry.pattern.test(input.text))
  },
  {
    id: "unsupported_strong_claim",
    result: "suspicious_but_usable",
    test: (input) =>
      SUSPICIOUS_PATTERNS.some((entry) => entry.id === "unsupported_strong_claim" && entry.pattern.test(input.text))
  },
  {
    id: "untrusted_source",
    result: "suspicious_but_usable",
    test: (input, policy) => isUntrustedSource(input.source, policy)
  }
];

export function screenEvidence(input: ScreeningInput, policy: GovernancePolicy): ScreeningReport {
  const triggeredRules = SCREENING_RULES.filter((rule) => rule.test(input, policy)).map((rule) => rule.id);
  const result = resolveScreeningResult(triggeredRules);

  return {
    result,
    triggeredRules,
    excerpt: triggeredRules.length > 0 ? buildExcerpt(input.text) : null,
    recommendation: buildRecommendation(result, triggeredRules, input)
  };
}

function resolveScreeningResult(triggeredRules: string[]): EvidenceScreeningResult {
  if (triggeredRules.some((rule) => rule === "prompt_injection" || rule === "tool_invocation_attempt")) {
    return "blocked";
  }
  if (triggeredRules.length > 0) {
    return "suspicious_but_usable";
  }
  return "clean";
}

function buildExcerpt(text: string): string | null {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 200);
}

function buildRecommendation(
  result: EvidenceScreeningResult,
  triggeredRules: string[],
  input: ScreeningInput
): string {
  if (result === "blocked") {
    return `Exclude this ${input.context} input and record the governance trace before continuing.`;
  }
  if (result === "suspicious_but_usable") {
    return `Use this ${input.context} input with caution and carry the warning into downstream review.`;
  }
  return "No governance screening issues detected.";
}

function isUntrustedSource(source: string, policy: GovernancePolicy): boolean {
  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    return !policy.trustedSources.some((domain) => {
      const normalized = domain.toLowerCase();
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}
