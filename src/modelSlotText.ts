export const GENERAL_CHAT_SLOT_LABEL = "general chat";
export const RESEARCH_BACKEND_SLOT_LABEL = "research backend";

export const GENERAL_CHAT_MODEL_PROMPT = "General chat model";
export const GENERAL_CHAT_REASONING_PROMPT = "General chat reasoning effort";
export const OPENAI_API_GENERAL_CHAT_MODEL_PROMPT = "OpenAI API general chat model";

export const RESEARCH_BACKEND_MODEL_PROMPT = "Research backend model";
export const RESEARCH_BACKEND_REASONING_PROMPT = "Research backend reasoning effort";

export const SELECT_RESEARCH_BACKEND_MODEL_PROMPT = "Select research backend model";
export const SELECT_RESEARCH_BACKEND_REASONING_PROMPT = "Select research backend reasoning effort";

export const RESEARCH_BACKEND_UPDATED_LOG = "Research backend updated.";
export const RECOMMENDED_FOR_RESEARCH_BACKEND = "recommended for research backend";

export const CODEX_TASK_MODEL_DESCRIPTION = "Research backend, analysis, and planning tasks.";
export const OPENAI_TASK_MODEL_DESCRIPTION = "Research backend model and reasoning for API mode.";

export function getSelectModelPrompt(label: string): string {
  return `Select ${label} model`;
}

export function formatResearchBackendModelSummary(providerLabel: string, model: string): string {
  return `${providerLabel} research backend model: ${model}`;
}