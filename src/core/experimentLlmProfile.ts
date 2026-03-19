import { AppConfig } from "../types.js";

export interface ExperimentLlmProfile {
  provider: "codex" | "openai" | "ollama";
  model: string;
  reasoningEffort: string;
  fastMode: boolean;
}

export function resolveExperimentLlmProfile(config: AppConfig): ExperimentLlmProfile {
  if (config.providers.llm_mode === "openai_api") {
    return {
      provider: "openai",
      model: config.providers.openai.experiment_model || config.providers.openai.model,
      reasoningEffort:
        config.providers.openai.experiment_reasoning_effort || config.providers.openai.reasoning_effort,
      fastMode: false
    };
  }

  if (config.providers.llm_mode === "ollama") {
    return {
      provider: "ollama",
      model:
        config.providers.ollama?.experiment_model ||
        config.providers.ollama?.research_model ||
        "qwen3.5:35b-a3b",
      reasoningEffort: "medium",
      fastMode: false
    };
  }

  return {
    provider: "codex",
    model: config.providers.codex.experiment_model || config.providers.codex.model,
    reasoningEffort:
      config.providers.codex.experiment_reasoning_effort || config.providers.codex.reasoning_effort,
    fastMode: config.providers.codex.experiment_fast_mode === true
  };
}
