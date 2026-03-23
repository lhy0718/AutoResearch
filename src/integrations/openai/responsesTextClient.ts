import {
  DEFAULT_OPENAI_RESPONSES_MODEL,
  DEFAULT_OPENAI_RESPONSES_REASONING_EFFORT,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "./modelCatalog.js";

export interface OpenAiResponsesTextResult {
  text: string;
  responseId?: string;
  model?: string;
}

export interface OpenAiResponsesTextDefaults {
  model?: string;
  reasoningEffort?: string;
}

interface ResponsesApiResponse {
  id?: string;
  model?: string;
  error?: {
    message?: string;
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
      reasoningEffort: normalizeOpenAiResponsesReasoningEffort(model, defaults.reasoningEffort)
    };
  }

  updateDefaults(next: OpenAiResponsesTextDefaults): void {
    const model = normalizeOpenAiResponsesModel(next.model || this.defaults.model);
    this.defaults = {
      model,
      reasoningEffort: normalizeOpenAiResponsesReasoningEffort(
        model,
        next.reasoningEffort || this.defaults.reasoningEffort
      )
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
    abortSignal?: AbortSignal;
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
    abortSignal?: AbortSignal;
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

    const text = extractOutputText(payload);
    if (!text) {
      throw new Error("Responses API returned no output text.");
    }

    this.mostRecentResponseId = payload.id;

    return {
      text,
      responseId: payload.id,
      model: payload.model || model
    };
  }
}

function getOpenAiResponsesTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.AUTOLABOS_OPENAI_RESPONSES_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
