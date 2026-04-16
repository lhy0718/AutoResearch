import path from "node:path";
import { promises as fs } from "node:fs";
import { describeOpenAiFetchError, isAbortLikeError } from "../openai/networkError.js";
import { computeModelUsageCostUsd } from "../../core/llm/modelPricing.js";
import { OpenAiResponsesUsage, extractOpenAiResponsesUsage } from "../openai/usage.js";
import { CodexOAuthCredentials } from "./oauthAuth.js";

export interface CodexOAuthResponsesTextResult {
  text: string;
  responseId?: string;
  model?: string;
  usage?: OpenAiResponsesUsage;
}

export interface CodexOAuthResponsesTextDefaults {
  model?: string;
  reasoningEffort?: string;
}

interface CodexResponsesApiResponse {
  id?: string;
  model?: string;
  status?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    } | null;
    output_tokens_details?: {
      reasoning_tokens?: number;
    } | null;
  } | null;
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

interface CodexResponsesEvent {
  type?: string;
  delta?: string;
  response?: CodexResponsesApiResponse;
}

export class CodexOAuthResponsesTextClient {
  private defaults: Required<CodexOAuthResponsesTextDefaults>;
  private mostRecentResponseId?: string;

  constructor(
    private readonly resolveCredentials: () => Promise<CodexOAuthCredentials | undefined>,
    defaults: CodexOAuthResponsesTextDefaults = {}
  ) {
    this.defaults = {
      model: defaults.model || "gpt-5.3-codex",
      reasoningEffort: defaults.reasoningEffort || "high"
    };
  }

  updateDefaults(next: CodexOAuthResponsesTextDefaults): void {
    this.defaults = {
      model: next.model || this.defaults.model,
      reasoningEffort: next.reasoningEffort || this.defaults.reasoningEffort
    };
  }

  lastResponseId(): string | undefined {
    return this.mostRecentResponseId;
  }

  async runForText(opts: {
    prompt: string;
    threadId?: string;
    previousResponseId?: string;
    systemPrompt?: string;
    inputImagePaths?: string[];
    model?: string;
    reasoningEffort?: string;
    abortSignal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<string> {
    const result = await this.complete(opts);
    return result.text;
  }

  async complete(opts: {
    prompt: string;
    threadId?: string;
    previousResponseId?: string;
    systemPrompt?: string;
    inputImagePaths?: string[];
    model?: string;
    reasoningEffort?: string;
    abortSignal?: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<CodexOAuthResponsesTextResult> {
    const credentials = await this.resolveCredentials();
    if (!credentials?.accessToken) {
      throw new Error("Codex ChatGPT OAuth is required. Run `codex login` so ~/.codex/auth.json contains tokens.");
    }

    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: opts.prompt }];
    const imageParts = await Promise.all(
      (opts.inputImagePaths || []).map((imagePath) => buildImageContentPart(imagePath))
    );
    content.push(...imageParts);

    const body: Record<string, unknown> = {
      model: opts.model || this.defaults.model,
      instructions: opts.systemPrompt || "You are Codex. Follow the user's request carefully.",
      store: false,
      stream: true,
      input: [
        {
          role: "user",
          content
        }
      ],
      text: {
        format: {
          type: "text"
        }
      },
      reasoning: {
        effort: opts.reasoningEffort || this.defaults.reasoningEffort
      }
    };

    const previousResponseId = opts.previousResponseId || opts.threadId;
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    opts.onProgress?.("Submitting request to Codex OAuth Responses backend.");

    let response: Response;
    try {
      response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        signal: opts.abortSignal,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw new Error(
        describeOpenAiFetchError("Codex OAuth backend request failed before receiving an HTTP response", error)
      );
    }

    if (!response.ok) {
      const raw = await safeReadText(response);
      throw new Error(`Codex OAuth backend request failed: ${response.status}${raw ? ` ${raw}` : ""}`);
    }

    const streamed = await readCodexStream(response, opts.onProgress);
    if (streamed.payload?.error?.message) {
      throw new Error(`Codex OAuth backend returned an error: ${streamed.payload.error.message}`);
    }

    const payload = streamed.payload;
    const text = streamed.text || extractOutputText(payload);
    if (!text) {
      throw new Error(buildMissingOutputError(payload));
    }

    this.mostRecentResponseId = payload.id;
    const usage = extractOpenAiResponsesUsage(payload);
    if (usage) {
      usage.costUsd = computeModelUsageCostUsd(payload.model || String(body.model || this.defaults.model), usage);
    }

    opts.onProgress?.("Received Codex OAuth output.");

    return {
      text,
      responseId: payload.id,
      model: payload.model || String(body.model || this.defaults.model),
      usage
    };
  }
}

async function buildImageContentPart(imagePath: string): Promise<Record<string, unknown>> {
  const bytes = await fs.readFile(imagePath);
  return {
    type: "input_image",
    image_url: `data:${inferImageMimeType(imagePath)};base64,${bytes.toString("base64")}`
  };
}

function inferImageMimeType(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "image/png";
}

async function readCodexStream(
  response: Response,
  onProgress?: (message: string) => void
): Promise<{ text: string; payload: CodexResponsesApiResponse }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const raw = await safeReadText(response);
    return {
      text: "",
      payload: parseCompletedPayloadFromText(raw)
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let payload: CodexResponsesApiResponse = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex >= 0) {
      const frame = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const event = parseSseFrame(frame);
      if (event) {
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        }
        if (event.type === "response.completed" && event.response) {
          payload = event.response;
        } else if (event.type === "response.created" && event.response && !payload.id) {
          payload = event.response;
        }
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    const event = parseSseFrame(trailing);
    if (event) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
      }
      if (event.type === "response.completed" && event.response) {
        payload = event.response;
      }
    }
  }

  onProgress?.("Received streamed Codex OAuth output.");
  return { text: text.trim(), payload };
}

function parseSseFrame(frame: string): CodexResponsesEvent | undefined {
  const dataLines = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(dataLines.join("\n")) as CodexResponsesEvent;
  } catch {
    return undefined;
  }
}

function parseCompletedPayloadFromText(raw: string): CodexResponsesApiResponse {
  const event = parseSseFrame(raw);
  return event?.response || {};
}

function extractOutputText(payload: CodexResponsesApiResponse): string {
  const parts: string[] = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("").trim();
}

function buildMissingOutputError(payload: CodexResponsesApiResponse): string {
  const status = payload.status ? `status=${payload.status}` : "status=unknown";
  const reason = payload.incomplete_details?.reason ? ` reason=${payload.incomplete_details.reason}` : "";
  return `Codex OAuth backend returned no output text (${status}${reason}).`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
