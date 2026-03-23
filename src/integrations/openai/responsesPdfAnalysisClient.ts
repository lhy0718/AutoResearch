import {
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "./modelCatalog.js";

export interface ResponsesPdfAnalysisResult {
  text: string;
  responseId?: string;
  model?: string;
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

export class ResponsesPdfAnalysisClient {
  constructor(
    private readonly resolveApiKey: () => Promise<string | undefined>
  ) {}

  async hasApiKey(): Promise<boolean> {
    return Boolean(await this.resolveApiKey());
  }

  async analyzePdf(args: {
    model: string;
    pdfUrl: string;
    prompt: string;
    systemPrompt?: string;
    reasoningEffort?: string;
    abortSignal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<ResponsesPdfAnalysisResult> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for Responses API PDF analysis.");
    }

    args.onProgress?.(`Submitting PDF analysis request to Responses API (${args.model}).`);

    const body: Record<string, unknown> = {
      model: args.model,
      instructions: args.systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: args.prompt },
            { type: "input_file", file_url: args.pdfUrl }
          ]
        }
      ],
      text: {
        format: {
          type: "text"
        }
      }
    };

    if (supportsOpenAiResponsesReasoning(args.model)) {
      body.reasoning = {
        effort: normalizeOpenAiResponsesReasoningEffort(args.model, args.reasoningEffort)
      };
    }

    const timeoutMs = getOpenAiResponsesTimeoutMs();
    const timeoutController = timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutId = timeoutController ? setTimeout(() => timeoutController.abort(), timeoutMs) : undefined;
    const combinedSignal = timeoutController
      ? args.abortSignal
        ? AbortSignal.any([args.abortSignal, timeoutController.signal])
        : timeoutController.signal
      : args.abortSignal;

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
      const body = await safeReadText(response);
      throw new Error(`Responses API request failed: ${response.status}${body ? ` ${body}` : ""}`);
    }

    args.onProgress?.("Responses API returned a successful HTTP response for PDF analysis.");
    const payload = (await response.json()) as ResponsesApiResponse;
    if (payload.error?.message) {
      throw new Error(`Responses API returned an error: ${payload.error.message}`);
    }

    const text = extractOutputText(payload);
    if (!text) {
      throw new Error("Responses API returned no output text.");
    }

    args.onProgress?.("Responses API produced PDF analysis text.");

    return {
      text,
      responseId: payload.id,
      model: payload.model
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
    const text = await response.text();
    return text.trim();
  } catch {
    return "";
  }
}
