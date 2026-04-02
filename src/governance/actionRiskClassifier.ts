import { ActionRiskTier, GovernancePolicy } from "./policyTypes.js";

export interface ClassifiableAction {
  type: "file_write" | "file_read" | "shell_exec" | "llm_call" | "external_request";
  target: string;
  context: string;
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replaceAll("\\", "/");
}

function normalizeTarget(target: string): string {
  return target.trim().replaceAll("\\", "/");
}

function globToRegExp(glob: string): RegExp {
  const escaped = normalizePattern(glob)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*\*/gu, "__DOUBLE_WILDCARD__")
    .replace(/\*/gu, "[^/]*")
    .replace(/__DOUBLE_WILDCARD__/gu, ".*");
  return new RegExp(`^${escaped}$`, "u");
}

export function matchesPolicyPattern(target: string, pattern: string): boolean {
  const normalizedTarget = normalizeTarget(target);
  const normalizedPattern = normalizePattern(pattern);
  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.includes("|") && !normalizedPattern.includes("*")) {
    return normalizedPattern
      .split("|")
      .map((token) => token.trim())
      .filter(Boolean)
      .some((token) => normalizedTarget.includes(token));
  }

  if (!normalizedPattern.includes("*")) {
    return normalizedTarget.includes(normalizedPattern);
  }

  return globToRegExp(normalizedPattern).test(normalizedTarget);
}

function matchesAnyPattern(target: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPolicyPattern(target, pattern));
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/^www\./u, "");
}

function extractHostname(target: string): string | null {
  try {
    const hostname = new URL(target).hostname;
    return hostname ? normalizeHostname(hostname) : null;
  } catch {
    return null;
  }
}

function isTrustedSource(target: string, trustedSources: string[]): boolean {
  const hostname = extractHostname(target);
  if (!hostname) {
    return false;
  }

  return trustedSources.some((source) => {
    const trusted = normalizeHostname(source);
    return hostname === trusted || hostname.endsWith(`.${trusted}`);
  });
}

export function classifyAction(
  action: ClassifiableAction,
  policy: GovernancePolicy
): ActionRiskTier {
  const target = normalizeTarget(action.target);

  if (action.type === "file_read") {
    return "read_only";
  }

  if (action.type === "file_write") {
    if (target === "paper/main.tex" || target === "paper/references.bib" || matchesPolicyPattern(target, "outputs/**")) {
      return "publication_risk";
    }
    if (matchesAnyPattern(target, policy.reviewRequiredPaths || [])) {
      return "local_mutation_high";
    }
    if (matchesAnyPattern(target, policy.allowedWritePaths || [])) {
      return "local_mutation_low";
    }
    return "local_mutation_high";
  }

  if (action.type === "shell_exec") {
    if (matchesAnyPattern(target, policy.forbiddenExternalActions || [])) {
      return "external_side_effect";
    }
    return "execution_low";
  }

  if (action.type === "external_request") {
    return isTrustedSource(target, policy.trustedSources || []) ? "execution_low" : "execution_high";
  }

  return "execution_low";
}
