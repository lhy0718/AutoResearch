interface TitleGenerationClient {
  runForText(opts: {
    prompt: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    systemPrompt?: string;
    abortSignal?: AbortSignal;
  }): Promise<string>;
}

const DEFAULT_TITLE_GENERATION_TIMEOUT_MS = 8000;

export class TitleGenerator {
  constructor(
    private readonly resolveClient: () => TitleGenerationClient,
    private readonly options: {
      timeoutMs?: number;
    } = {}
  ) {}

  async generateTitle(topic: string, constraints: string[], objectiveMetric: string): Promise<string> {
    const prompt = [
      "Create a concise research run title in English.",
      "Rules:",
      "- 8 to 12 words",
      "- single line",
      "- no quotes",
      "- include the core topic",
      "",
      `Topic: ${topic}`,
      `Constraints: ${constraints.join(", ") || "none"}`,
      `Objective metric: ${objectiveMetric || "none"}`
    ].join("\n");

    const abortController = new AbortController();
    const timeoutMs = Math.max(1, this.options.timeoutMs ?? DEFAULT_TITLE_GENERATION_TIMEOUT_MS);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.resolveClient().runForText({
          prompt,
          sandboxMode: "read-only",
          approvalPolicy: "never",
          abortSignal: abortController.signal
        }),
        new Promise<string>((_, reject) => {
          timeoutId = setTimeout(() => {
            abortController.abort();
            reject(new Error("Title generation timed out"));
          }, timeoutMs);
        })
      ]);
      return sanitizeTitle(response, topic);
    } catch {
      return fallbackTitle(topic);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}

function sanitizeTitle(raw: string, topic: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return fallbackTitle(topic);
  }
  return oneLine.slice(0, 96);
}

function fallbackTitle(topic: string): string {
  const trimmed = topic.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "Untitled AutoLabOS Run";
  }
  return trimmed.slice(0, 96);
}
