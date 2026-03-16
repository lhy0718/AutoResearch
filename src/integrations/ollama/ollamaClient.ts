import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_OLLAMA_BASE_URL } from "./modelCatalog.js";

export interface OllamaCompletionResult {
  text: string;
  model?: string;
  totalDuration?: number;
  promptEvalCount?: number;
  evalCount?: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface OllamaHealthStatus {
  reachable: boolean;
  version?: string;
  error?: string;
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  model?: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    size?: number;
    digest?: string;
    modified_at?: string;
  }>;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes for long generations

export class OllamaClient {
  constructor(
    private readonly baseUrl: string = DEFAULT_OLLAMA_BASE_URL
  ) {}

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async checkHealth(): Promise<OllamaHealthStatus> {
    try {
      const response = await fetch(this.baseUrl, {
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        const text = await safeReadText(response);
        return { reachable: true, version: text.trim() || undefined };
      }
      return { reachable: false, error: `HTTP ${response.status}` };
    } catch (err) {
      return {
        reachable: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      throw new Error(`Ollama /api/tags failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => ({
      name: m.name ?? "",
      size: m.size ?? 0,
      digest: m.digest ?? "",
      modified_at: m.modified_at ?? ""
    }));
  }

  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.some(
        (m) => m.name === modelName || m.name === `${modelName}:latest`
      );
    } catch {
      return false;
    }
  }

  async chat(opts: {
    model: string;
    messages: OllamaMessage[];
    stream?: boolean;
    options?: Record<string, unknown>;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<OllamaCompletionResult> {
    const fakeResponse = resolveFakeOllamaResponse();
    if (typeof fakeResponse === "string" && fakeResponse.trim()) {
      return {
        text: fakeResponse,
        model: opts.model
      };
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: opts.messages,
        stream: false,
        ...opts.options ? { options: opts.options } : {}
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const raw = await safeReadText(response);
        throw new Error(`Ollama /api/chat failed: HTTP ${response.status}${raw ? ` — ${raw}` : ""}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      if (data.error) {
        throw new Error(`Ollama returned error: ${data.error}`);
      }

      const text = data.message?.content ?? "";
      return {
        text,
        model: data.model || opts.model,
        totalDuration: data.total_duration,
        promptEvalCount: data.prompt_eval_count,
        evalCount: data.eval_count
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chatStream(opts: {
    model: string;
    messages: OllamaMessage[];
    options?: Record<string, unknown>;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
    onToken?: (token: string) => void;
  }): Promise<OllamaCompletionResult> {
    const fakeResponse = resolveFakeOllamaResponse();
    if (typeof fakeResponse === "string" && fakeResponse.trim()) {
      opts.onToken?.(fakeResponse);
      return { text: fakeResponse, model: opts.model };
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: opts.messages,
        stream: true,
        ...(opts.options ? { options: opts.options } : {})
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const raw = await safeReadText(response);
        throw new Error(`Ollama /api/chat stream failed: HTTP ${response.status}${raw ? ` — ${raw}` : ""}`);
      }

      if (!response.body) {
        throw new Error("Ollama /api/chat stream returned no body.");
      }

      const chunks: string[] = [];
      let finalModel: string | undefined;
      let promptEvalCount: number | undefined;
      let evalCount: number | undefined;
      let totalDuration: number | undefined;
      let partial = "";

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        partial += decoder.decode(value, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as OllamaChatResponse;
            if (parsed.error) {
              throw new Error(`Ollama stream error: ${parsed.error}`);
            }
            const token = parsed.message?.content ?? "";
            if (token) {
              chunks.push(token);
              opts.onToken?.(token);
            }
            if (parsed.done) {
              finalModel = parsed.model;
              promptEvalCount = parsed.prompt_eval_count;
              evalCount = parsed.eval_count;
              totalDuration = parsed.total_duration;
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message.startsWith("Ollama stream error:")) {
              throw parseErr;
            }
            // Skip malformed NDJSON lines
          }
        }
      }

      // Process any remaining partial line
      if (partial.trim()) {
        try {
          const parsed = JSON.parse(partial.trim()) as OllamaChatResponse;
          const token = parsed.message?.content ?? "";
          if (token) {
            chunks.push(token);
            opts.onToken?.(token);
          }
          if (parsed.done) {
            finalModel = parsed.model;
            promptEvalCount = parsed.prompt_eval_count;
            evalCount = parsed.eval_count;
            totalDuration = parsed.total_duration;
          }
        } catch {
          // ignore trailing partial
        }
      }

      return {
        text: chunks.join(""),
        model: finalModel || opts.model,
        totalDuration,
        promptEvalCount,
        evalCount
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chatWithImages(opts: {
    model: string;
    prompt: string;
    systemPrompt?: string;
    imagePaths: string[];
    options?: Record<string, unknown>;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<OllamaCompletionResult> {
    const images: string[] = [];
    for (const imgPath of opts.imagePaths) {
      const buf = await fs.readFile(imgPath);
      images.push(buf.toString("base64"));
    }

    const messages: OllamaMessage[] = [];
    if (opts.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push({
      role: "user",
      content: opts.prompt,
      images
    });

    return this.chat({
      model: opts.model,
      messages,
      abortSignal: opts.abortSignal,
      timeoutMs: opts.timeoutMs,
      options: opts.options
    });
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

export async function encodeImageToBase64(imagePath: string): Promise<string> {
  const ext = path.extname(imagePath).toLowerCase();
  const buf = await fs.readFile(imagePath);
  const base64 = buf.toString("base64");
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp"
  };
  const mime = mimeMap[ext] || "image/png";
  return `data:${mime};base64,${base64}`;
}

let fakeResponseSequenceSource = "";
let fakeResponseSequenceIndex = 0;

function resolveFakeOllamaResponse(): string | undefined {
  const fakeSequence = process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE_SEQUENCE;
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
      // fall through
    }
  }

  const fakeResponse = process.env.AUTOLABOS_FAKE_OLLAMA_RESPONSE;
  return typeof fakeResponse === "string" && fakeResponse.trim() ? fakeResponse : undefined;
}
