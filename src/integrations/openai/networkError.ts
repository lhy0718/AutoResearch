export function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function describeOpenAiFetchError(context: string, error: unknown): string {
  if (!(error instanceof Error)) {
    return `${context}: ${String(error)}`;
  }

  const detailParts = [error.message || error.name];
  const cause = asErrorLike(error.cause);
  if (cause) {
    const causeParts = [cause.message || cause.name];
    if (typeof cause.code === "string" && cause.code.trim()) {
      causeParts.push(`code=${cause.code}`);
    }
    if (typeof cause.errno === "number") {
      causeParts.push(`errno=${cause.errno}`);
    }
    if (typeof cause.syscall === "string" && cause.syscall.trim()) {
      causeParts.push(`syscall=${cause.syscall}`);
    }
    detailParts.push(`cause: ${causeParts.join(", ")}`);
  }

  return `${context}: ${detailParts.join(" | ")}`;
}

function asErrorLike(value: unknown):
  | { message?: string; name?: string; code?: string; errno?: number; syscall?: string }
  | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  return {
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    errno: typeof candidate.errno === "number" ? candidate.errno : undefined,
    syscall: typeof candidate.syscall === "string" ? candidate.syscall : undefined
  };
}