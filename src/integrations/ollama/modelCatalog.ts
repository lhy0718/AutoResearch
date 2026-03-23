export interface OllamaModelOption {
  value: string;
  label: string;
  description: string;
}

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_CHAT_MODEL = "qwen3.5:27b";
export const DEFAULT_OLLAMA_RESEARCH_MODEL = "qwen3.5:35b-a3b";
export const DEFAULT_OLLAMA_EXPERIMENT_MODEL = "qwen2.5-coder:32b";
export const DEFAULT_OLLAMA_VISION_MODEL = "qwen3.5:35b-a3b";

export const OLLAMA_CHAT_MODEL_OPTIONS: OllamaModelOption[] = [
  {
    value: "qwen3.5:27b",
    label: "qwen3.5:27b",
    description: "Fast chat model for interactive and lightweight tasks."
  },
  {
    value: "qwen3:32b",
    label: "qwen3:32b",
    description: "Larger Qwen3 model for chat."
  },
  {
    value: "llama3.3:70b",
    label: "llama3.3:70b",
    description: "Llama 3.3 70B for high-quality chat (requires >40GB VRAM)."
  },
  {
    value: "gemma3:27b",
    label: "gemma3:27b",
    description: "Google Gemma 3 27B for general chat."
  }
];

export const OLLAMA_RESEARCH_MODEL_OPTIONS: OllamaModelOption[] = [
  {
    value: "qwen3.5:35b-a3b",
    label: "qwen3.5:35b-a3b",
    description: "MoE research backend model with strong reasoning for main workflow nodes."
  },
  {
    value: "qwen3:32b",
    label: "qwen3:32b",
    description: "Dense 32B model for research backend tasks."
  },
  {
    value: "deepseek-r1:32b",
    label: "deepseek-r1:32b",
    description: "DeepSeek-R1 distill for strong reasoning."
  },
  {
    value: "llama3.3:70b",
    label: "llama3.3:70b",
    description: "Llama 3.3 70B for research backend tasks (requires >40GB VRAM)."
  }
];

export const OLLAMA_EXPERIMENT_MODEL_OPTIONS: OllamaModelOption[] = [
  {
    value: "qwen2.5-coder:32b",
    label: "qwen2.5-coder:32b",
    description: "Code-specialized model for experiment implementation."
  },
  {
    value: "qwen3:32b",
    label: "qwen3:32b",
    description: "General model usable for code tasks."
  },
  {
    value: "deepseek-coder-v2:16b",
    label: "deepseek-coder-v2:16b",
    description: "Compact code model for lighter experiment tasks."
  }
];

export const OLLAMA_VISION_MODEL_OPTIONS: OllamaModelOption[] = [
  {
    value: "qwen3.5:35b-a3b",
    label: "qwen3.5:35b-a3b",
    description: "Multimodal MoE model for vision/PDF page analysis."
  },
  {
    value: "llama3.2-vision:11b",
    label: "llama3.2-vision:11b",
    description: "Llama 3.2 Vision 11B for image understanding."
  },
  {
    value: "gemma3:27b",
    label: "gemma3:27b",
    description: "Gemma 3 27B with vision capabilities."
  }
];

export function buildOllamaChatModelChoices(): string[] {
  return OLLAMA_CHAT_MODEL_OPTIONS.map((o) => o.value);
}

export function buildOllamaResearchModelChoices(): string[] {
  return OLLAMA_RESEARCH_MODEL_OPTIONS.map((o) => o.value);
}

export function buildOllamaExperimentModelChoices(): string[] {
  return OLLAMA_EXPERIMENT_MODEL_OPTIONS.map((o) => o.value);
}

export function buildOllamaVisionModelChoices(): string[] {
  return OLLAMA_VISION_MODEL_OPTIONS.map((o) => o.value);
}

export function getOllamaModelDescription(model: string): string {
  const all = [
    ...OLLAMA_CHAT_MODEL_OPTIONS,
    ...OLLAMA_RESEARCH_MODEL_OPTIONS,
    ...OLLAMA_EXPERIMENT_MODEL_OPTIONS,
    ...OLLAMA_VISION_MODEL_OPTIONS
  ];
  return all.find((o) => o.value === model)?.description || "Ollama model.";
}
