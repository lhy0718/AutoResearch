import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "./modelCatalog.js";
import { describeOpenAiFetchError, isAbortLikeError } from "./networkError.js";

export interface OpenAiResponsesTextResult {
  text: string;
  responseId?: string;
  model?: string;
}

export interface OpenAiResponsesTextDefaults {
  model?: string;
  reasoningEffort?: string;
  background?: boolean;
}

interface ResponsesApiResponse {
  id?: string;
  model?: string;
  status?: string;
  error?: {
    message?: string;
  } | null;
  incomplete_details?: {
    reason?: string;
  } | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

export class OpenAiResponsesTextClient {
  private defaults: Required<OpenAiResponsesTextDefaults>;
  private mostRecentResponseId?: string;

  constructor(
    private readonly resolveApiKey: () => Promise<string | undefined>,
    defaults: OpenAiResponsesTextDefaults = {}
  ) {
    const model = normalizeOpenAiResponsesModel(defaults.model);
    this.defaults = {
      model,
      reasoningEffort: normalizeOpenAiResponsesReasoningEffort(model, defaults.reasoningEffort),
      background: defaults.background === true
    };
  }

  updateDefaults(next: OpenAiResponsesTextDefaults): void {
    const model = normalizeOpenAiResponsesModel(next.model || this.defaults.model);
    this.defaults = {
      model,
      reasoningEffort: normalizeOpenAiResponsesReasoningEffort(
        model,
        next.reasoningEffort || this.defaults.reasoningEffort
      ),
      background: next.background ?? this.defaults.background
    };
  }

  async runForText(opts: {
    prompt: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    threadId?: string;
    previousResponseId?: string;
    agentId?: string;
    systemPrompt?: string;
    model?: string;
    reasoningEffort?: string;
    background?: boolean;
    abortSignal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<string> {
    const result = await this.complete({
      ...opts,
      previousResponseId: opts.previousResponseId || opts.threadId
    });
    return result.text;
  }

  lastResponseId(): string | undefined {
    return this.mostRecentResponseId;
  }

  async complete(opts: {
    prompt: string;
    threadId?: string;
    previousResponseId?: string;
    systemPrompt?: string;
    model?: string;
    reasoningEffort?: string;
    background?: boolean;
    abortSignal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<OpenAiResponsesTextResult> {
    const fakeResponse = resolveFakeOpenAiResponse();
    if (typeof fakeResponse === "string" && fakeResponse.trim()) {
      return {
        text: fakeResponse,
        responseId: process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_ID || "fake-openai-response",
        model: opts.model || this.defaults.model
      };
    }

    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI API provider mode.");
    }

    const model = normalizeOpenAiResponsesModel(opts.model || this.defaults.model);
    const reasoningEffort = normalizeOpenAiResponsesReasoningEffort(
      model,
      opts.reasoningEffort || this.defaults.reasoningEffort
    );
    const useBackground = opts.background ?? this.defaults.background;

    const body: Record<string, unknown> = {
      model,
      instructions: opts.systemPrompt,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: opts.prompt }]
        }
      ],
      text: {
        format: {
          type: "text"
        }
      }
    };

    if (supportsOpenAiResponsesReasoning(model)) {
      body.reasoning = { effort: reasoningEffort };
    }

    if (useBackground) {
      body.background = true;
      body.store = true;
    }

    const previousResponseId = opts.previousResponseId || opts.threadId;
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    const timeoutMs = getOpenAiResponsesTimeoutMs();
    const timeoutController = timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutId = timeoutController ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined;
    const combinedSignal = timeoutController
      ? opts.abortSignal
        ? AbortSignal.any([opts.abortSignal, timeoutController.signal])
        : timeoutController.signal
      : opts.abortSignal;

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: combinedSignal,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw new Error(
        describeOpenAiFetchError("Responses API network request failed before receiving an HTTP response", error)
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    if (!response.ok) {
      const raw = await safeReadText(response);
      throw new Error(`Responses API request failed: ${response.status}${raw ? ` ${raw}` : ""}`);
    }

    const payload = (await response.json()) as ResponsesApiResponse;
    if (payload.error?.message) {
      throw new Error(`Responses API returned an error: ${payload.error.message}`);
    }

    let resolvedPayload = payload;
    if (useBackground) {
      if (!payload.id) {
        throw new Error("Responses API background request returned no response id.");
      }
      opts.onProgress?.(`OpenAI accepted background response ${payload.id}; polling for completion.`);
      resolvedPayload = await this.pollBackgroundResponse({
        responseId: payload.id,
        apiKey,
        abortSignal: opts.abortSignal,
        onProgress: opts.onProgress
      });
    }

    const text = extractOutputText(resolvedPayload);
    if (!text) {
      throw new Error(buildMissingOutputError(resolvedPayload));
    }

    this.mostRecentResponseId = resolvedPayload.id;

    return {
      text,
      responseId: resolvedPayload.id,
      model: resolvedPayload.model || model
    };
  }

  private async pollBackgroundResponse(input: {
    responseId: string;
    apiKey: string;
    abortSignal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<ResponsesApiResponse> {
    let attempt = 0;

    while (true) {
      if (input.abortSignal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const response = await this.fetchResponseById(input.responseId, input.apiKey, input.abortSignal);
      const status = normalizeResponseStatus(response.status);

      if (status === "queued" || status === "in_progress") {
        attempt += 1;
        input.onProgress?.(`OpenAI background response ${input.responseId} is ${status} (poll ${attempt}).`);
        await delay(resolveBackgroundPollIntervalMs(), input.abortSignal);
        continue;
      }

      if (status === "completed") {
        return response;
      }

      if (response.error?.message) {
        throw new Error(`Responses API background request failed: ${response.error.message}`);
      }

      if (status === "failed" || status === "cancelled" || status === "incomplete") {
        throw new Error(buildBackgroundTerminalError(response));
      }

      return response;
    }
  }

  private async fetchResponseById(
    responseId: string,
    apiKey: string,
    abortSignal?: AbortSignal
  ): Promise<ResponsesApiResponse> {
    let response: Response;
    try {
      response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: abortSignal
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw new Error(
        describeOpenAiFetchError(
          `Responses API polling request failed before receiving an HTTP response for ${responseId}`,
          error
        )
      );
    }

    if (!response.ok) {
      const raw = await safeReadText(response);
      throw new Error(
        `Responses API polling request failed for ${responseId}: ${response.status}${raw ? ` ${raw}` : ""}`
      );
    }

    return (await response.json()) as ResponsesApiResponse;
  }
}

function getOpenAiResponsesTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.AUTOLABOS_OPENAI_RESPONSES_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveBackgroundPollIntervalMs(): number {
  const parsed = Number.parseInt(process.env.AUTOLABOS_OPENAI_BACKGROUND_POLL_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

function extractOutputText(payload: ResponsesApiResponse): string {
  const parts: string[] = [];
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

async function delay(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
    };

    if (abortSignal?.aborted) {
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeResponseStatus(status: string | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function buildBackgroundTerminalError(payload: ResponsesApiResponse): string {
  const status = normalizeResponseStatus(payload.status) || "unknown";
  const reason = payload.incomplete_details?.reason?.trim();
  return `Responses API background request ended with status ${status}${reason ? ` (${reason})` : ""}.`;
}

function buildMissingOutputError(payload: ResponsesApiResponse): string {
  const status = normalizeResponseStatus(payload.status);
  if (payload.error?.message) {
    return `Responses API returned an error: ${payload.error.message}`;
  }
  if (status && status !== "completed") {
    return buildBackgroundTerminalError(payload);
  }
  return "Responses API returned no output text.";
}

let fakeResponseSequenceSource = "";
let fakeResponseSequenceIndex = 0;

function resolveFakeOpenAiResponse(): string | undefined {
  const fakeSequence = process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE_SEQUENCE;
  if (typeof fakeSequence === "string" && fakeSequence.trim()) {
    if (fakeResponseSequenceSource !== fakeSequence) {
      fakeResponseSequenceSource = fakeSequence;
      fakeResponseSequenceIndex = 0;
    }

    try {
      const parsed = JSON.parse(fakeSequence) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const index = Math.min(fakeResponseSequenceIndex, parsed.length - 1);
        fakeResponseSequenceIndex += 1;
        const selected = parsed[index];
        if (typeof selected === "string") {
          return selected;
        }
      }
    } catch {
      // fall through to single-response env
    }
  }

  const fakeResponse = process.env.AUTOLABOS_FAKE_OPENAI_RESPONSE;
  return typeof fakeResponse === "string" && fakeResponse.trim() ? fakeResponse : undefined;
}
