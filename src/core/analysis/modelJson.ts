export interface ParsedStructuredModelJson<T> {
  value: T;
  repaired: boolean;
}

export interface StructuredModelJsonParseOptions {
  emptyError: string;
  notFoundError: string;
  incompleteError: string;
  invalidError: string;
}

export function parseStructuredModelJsonObject<T>(
  text: string,
  options: StructuredModelJsonParseOptions
): ParsedStructuredModelJson<T> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(options.emptyError);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  let strictCandidate: string | undefined;
  let repairCandidate: string | undefined;
  let lastError: Error | undefined;

  if (fenced) {
    strictCandidate = fenced;
    repairCandidate = fenced;
  } else {
    try {
      strictCandidate = extractBalancedJsonObject(trimmed, options);
      repairCandidate = strictCandidate;
    } catch (error) {
      lastError = asError(error);
      if (!isIncompleteJsonExtractionError(lastError, options.incompleteError)) {
        throw lastError;
      }
      repairCandidate = extractJsonObjectTail(trimmed, options.notFoundError);
    }
  }

  if (strictCandidate) {
    try {
      return {
        value: parseJsonObject<T>(strictCandidate, options.invalidError),
        repaired: false
      };
    } catch (error) {
      lastError = asError(error);
      if (!shouldAttemptTruncatedJsonRepair(lastError)) {
        throw lastError;
      }
    }
  }

  if (repairCandidate) {
    for (const repaired of buildRepairCandidates(repairCandidate)) {
      try {
        return {
          value: parseJsonObject<T>(repaired, options.invalidError),
          repaired: true
        };
      } catch (error) {
        lastError = asError(error);
      }
    }
  }

  throw lastError ?? new Error(options.invalidError);
}

function parseJsonObject<T>(candidate: string, invalidError: string): T {
  const parsed = JSON.parse(candidate) as T;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(invalidError);
  }
  return parsed;
}

function extractBalancedJsonObject(text: string, options: StructuredModelJsonParseOptions): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error(options.notFoundError);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error(options.incompleteError);
}

function extractJsonObjectTail(text: string, notFoundError: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error(notFoundError);
  }
  return text.slice(start);
}

function buildRepairCandidates(candidate: string): string[] {
  const attempts: string[] = [];
  const seen = new Set<string>();

  const pushAttempt = (value: string | undefined) => {
    if (!value) {
      return;
    }
    if (value === candidate || seen.has(value)) {
      return;
    }
    seen.add(value);
    attempts.push(value);
  };

  pushAttempt(repairTruncatedJsonObject(candidate));

  let shortened = candidate;
  for (let index = 0; index < 4; index += 1) {
    shortened = trimJsonObjectToSafeBoundary(shortened) ?? "";
    if (!shortened) {
      break;
    }
    pushAttempt(repairTruncatedJsonObject(shortened));
  }

  return attempts;
}

function trimJsonObjectToSafeBoundary(candidate: string): string | undefined {
  const trimmed = candidate.trimEnd();
  if (!trimmed.startsWith("{") || trimmed.length < 3) {
    return undefined;
  }

  let inString = false;
  let escaped = false;
  let lastBoundary = -1;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "," || char === "{" || char === "[") {
      lastBoundary = index;
    }
  }

  if (lastBoundary <= 0 || lastBoundary >= trimmed.length - 1) {
    return undefined;
  }

  return trimmed.slice(0, lastBoundary + 1);
}

function repairTruncatedJsonObject(candidate: string): string | undefined {
  let repaired = candidate.trim();
  if (!repaired.startsWith("{")) {
    return undefined;
  }

  let inString = false;
  let escaped = false;
  let changed = false;
  const closingStack: string[] = [];

  for (let index = 0; index < repaired.length; index += 1) {
    const char = repaired[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      closingStack.push("}");
      continue;
    }
    if (char === "[") {
      closingStack.push("]");
      continue;
    }
    if ((char === "}" || char === "]") && closingStack[closingStack.length - 1] === char) {
      closingStack.pop();
    }
  }

  if (inString) {
    if (escaped) {
      repaired += "\\";
    }
    repaired += "\"";
    changed = true;
  }

  const withoutTrailingComma = repaired.replace(/,\s*$/u, "");
  if (withoutTrailingComma !== repaired) {
    repaired = withoutTrailingComma;
    changed = true;
  }

  if (closingStack.length > 0) {
    repaired += [...closingStack].reverse().join("");
    changed = true;
  }

  const normalizedClosers = repaired.replace(/,\s*([}\]])/gu, "$1");
  if (normalizedClosers !== repaired) {
    repaired = normalizedClosers;
    changed = true;
  }

  return changed ? repaired : undefined;
}

function shouldAttemptTruncatedJsonRepair(error: Error): boolean {
  return [
    /unexpected end of json input/i,
    /unterminated string in json/i,
    /expected ',' or ']' after array element/i,
    /expected ',' or '}' after property value/i
  ].some((pattern) => pattern.test(error.message));
}

function isIncompleteJsonExtractionError(error: Error, incompleteError: string): boolean {
  return error.message === incompleteError;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
