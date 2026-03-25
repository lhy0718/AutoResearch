export interface OpenAiResponsesUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

interface ResponsesUsageCarrier {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  } | null;
}

export function extractOpenAiResponsesUsage(
  payload: ResponsesUsageCarrier
): OpenAiResponsesUsage | undefined {
  const inputTokens = asTokenCount(payload.usage?.input_tokens);
  const outputTokens = asTokenCount(payload.usage?.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens
  };
}

function asTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.trunc(value);
}
