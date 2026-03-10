import { CodexCliClient } from "../../integrations/codex/codexCliClient.js";
import { OpenAiResponsesTextClient } from "../../integrations/openai/responsesTextClient.js";

export interface LLMCompletionUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface LLMCompletion {
  text: string;
  usage?: LLMCompletionUsage;
}

export interface LLMProgressEvent {
  type: "status" | "delta";
  text: string;
}

export interface LLMClient {
  complete(
    prompt: string,
    opts?: {
      threadId?: string;
      systemPrompt?: string;
      onProgress?: (event: LLMProgressEvent) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<LLMCompletion>;
}

interface CodexClientDefaults {
  model?: string;
  reasoningEffort?: string;
  fastMode?: boolean;
}

export class CodexLLMClient implements LLMClient {
  constructor(
    private readonly codex: CodexCliClient,
    private readonly defaults: CodexClientDefaults = {}
  ) {}

  async complete(
    prompt: string,
    opts?: {
      threadId?: string;
      systemPrompt?: string;
      onProgress?: (event: LLMProgressEvent) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<LLMCompletion> {
    const progress = createCodexProgressEmitter(opts?.onProgress);
    const result = await this.codex.runTurnStream({
      prompt,
      threadId: opts?.threadId,
      systemPrompt: opts?.systemPrompt,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      model: this.defaults.model,
      reasoningEffort: this.defaults.reasoningEffort as never,
      fastMode: this.defaults.fastMode,
      abortSignal: opts?.abortSignal,
      onEvent: (event) => {
        progress?.onEvent(event);
      }
    });
    progress?.flush();

    return {
      text: result.finalText,
      usage: {
        costUsd: undefined
      }
    };
  }
}

export class OpenAiResponsesLLMClient implements LLMClient {
  constructor(
    private readonly openai: OpenAiResponsesTextClient,
    private readonly defaults: { model?: string; reasoningEffort?: string } = {}
  ) {}

  async complete(
    prompt: string,
    opts?: {
      threadId?: string;
      systemPrompt?: string;
      onProgress?: (event: LLMProgressEvent) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<LLMCompletion> {
    opts?.onProgress?.({ type: "status", text: "Submitting request to OpenAI Responses API." });
    const text = await this.openai.runForText({
      prompt,
      systemPrompt: opts?.systemPrompt,
      model: this.defaults.model,
      reasoningEffort: this.defaults.reasoningEffort,
      abortSignal: opts?.abortSignal
    });
    opts?.onProgress?.({ type: "status", text: "Received Responses API output." });

    return {
      text,
      usage: {
        costUsd: undefined
      }
    };
  }
}

export class RoutedLLMClient implements LLMClient {
  constructor(private readonly resolveClient: () => LLMClient) {}

  async complete(
    prompt: string,
    opts?: {
      threadId?: string;
      systemPrompt?: string;
      onProgress?: (event: LLMProgressEvent) => void;
      abortSignal?: AbortSignal;
    }
  ): Promise<LLMCompletion> {
    return this.resolveClient().complete(prompt, opts);
  }
}

export class MockLLMClient implements LLMClient {
  async complete(prompt: string): Promise<LLMCompletion> {
    return {
      text: `[mock] ${prompt.slice(0, 120)}`,
      usage: {
        inputTokens: prompt.length / 4,
        outputTokens: 32,
        costUsd: 0
      }
    };
  }
}

function createCodexProgressEmitter(
  onProgress?: (event: LLMProgressEvent) => void
): { onEvent: (event: Record<string, unknown>) => void; flush: () => void } | undefined {
  if (!onProgress) {
    return undefined;
  }

  const state = {
    buffer: "",
    lastEmitMs: 0
  };

  const flush = () => {
    const text = oneLine(state.buffer);
    if (!text) {
      state.buffer = "";
      return;
    }
    onProgress({ type: "delta", text });
    state.buffer = "";
    state.lastEmitMs = Date.now();
  };

  return {
    onEvent(event: Record<string, unknown>) {
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "thread.started") {
        onProgress({ type: "status", text: "Codex analysis session started." });
        return;
      }
      const delta = extractProgressDelta(event);
      if (delta) {
        state.buffer += delta;
        const now = Date.now();
        const hasBreak = /[\n\r]/u.test(state.buffer);
        const longEnough = state.buffer.length >= 48;
        if (state.lastEmitMs === 0) {
          state.lastEmitMs = now;
        }
        const stale = now - state.lastEmitMs >= 500;
        if (hasBreak || longEnough || stale) {
          flush();
        }
        return;
      }
      if (type.endsWith(".completed") || type === "response.completed" || type === "item.completed") {
        flush();
      }
    },
    flush
  };
}

function extractProgressDelta(event: Record<string, unknown>): string {
  const type = typeof event.type === "string" ? event.type : "";
  if (!type.includes("delta")) {
    return "";
  }
  const direct =
    (typeof event.delta === "string" ? event.delta : "") ||
    (typeof event.text === "string" ? event.text : "") ||
    extractTextFromUnknown(event.item) ||
    extractTextFromUnknown(event.content);
  return direct;
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromUnknown(item)).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const direct =
    (typeof record.text === "string" ? record.text : "") ||
    (typeof record.output_text === "string" ? record.output_text : "") ||
    (typeof record.delta === "string" ? record.delta : "");
  if (direct) {
    return direct;
  }
  return extractTextFromUnknown(record.content);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
