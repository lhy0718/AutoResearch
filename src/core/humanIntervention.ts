import path from "node:path";
import { randomUUID } from "node:crypto";

import { GraphNodeId, RunRecord } from "../types.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import { ensureDir, writeJsonFile } from "../utils/fs.js";

export const HUMAN_INTERVENTION_PENDING_KEY = "human_intervention.pending";
export const HUMAN_INTERVENTION_HISTORY_KEY = "human_intervention.history";

export type HumanInterventionKind =
  | "objective_metric_clarification"
  | "transition_choice"
  | "generic_pause";

export type HumanInterventionInputMode = "free_text" | "single_choice";
export type HumanInterventionResumeAction =
  | "retry_current"
  | "approve_current"
  | "apply_transition"
  | "jump";

export interface HumanInterventionChoice {
  id: string;
  label: string;
  description?: string;
  answerAliases?: string[];
  resumeAction?: HumanInterventionResumeAction;
  targetNode?: GraphNodeId;
}

export interface HumanInterventionRequest {
  id: string;
  sourceNode: GraphNodeId;
  kind: HumanInterventionKind;
  title: string;
  question: string;
  context: string[];
  choices?: HumanInterventionChoice[];
  inputMode: HumanInterventionInputMode;
  resumeAction: HumanInterventionResumeAction;
  createdAt: string;
}

export interface HumanInterventionHistoryEntry {
  requestId: string;
  sourceNode: GraphNodeId;
  kind: HumanInterventionKind;
  title: string;
  answer: string;
  selectedChoiceId?: string;
  resumeAction: HumanInterventionResumeAction;
  targetNode?: GraphNodeId;
  answeredAt: string;
}

export interface ResolvedHumanInterventionAnswer {
  request: HumanInterventionRequest;
  answer: string;
  selectedChoice?: HumanInterventionChoice;
  resumeAction: HumanInterventionResumeAction;
  targetNode?: GraphNodeId;
}

export function createHumanInterventionRequest(
  input: Omit<HumanInterventionRequest, "id" | "createdAt">
): HumanInterventionRequest {
  return {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
}

export async function writeHumanInterventionRequest(input: {
  workspaceRoot: string;
  run: RunRecord;
  runContext: RunContextMemory;
  request: HumanInterventionRequest;
}): Promise<void> {
  await input.runContext.put(HUMAN_INTERVENTION_PENDING_KEY, input.request);
  const artifactPath = humanInterventionArtifactPath(input.workspaceRoot, input.run.id);
  await ensureDir(path.dirname(artifactPath));
  await writeJsonFile(artifactPath, input.request);
}

export async function readPendingHumanInterventionRequest(
  runContext: RunContextMemory
): Promise<HumanInterventionRequest | undefined> {
  const request = await runContext.get<HumanInterventionRequest>(HUMAN_INTERVENTION_PENDING_KEY);
  return isHumanInterventionRequest(request) ? request : undefined;
}

export async function clearPendingHumanInterventionRequest(runContext: RunContextMemory): Promise<void> {
  await runContext.put(HUMAN_INTERVENTION_PENDING_KEY, null);
}

export async function appendHumanInterventionHistory(
  runContext: RunContextMemory,
  entry: HumanInterventionHistoryEntry
): Promise<void> {
  const current = await runContext.get<HumanInterventionHistoryEntry[]>(HUMAN_INTERVENTION_HISTORY_KEY);
  const history = Array.isArray(current) ? current : [];
  history.push(entry);
  await runContext.put(HUMAN_INTERVENTION_HISTORY_KEY, history.slice(-50));
}

export function humanInterventionArtifactPath(workspaceRoot: string, runId: string): string {
  return path.join(workspaceRoot, ".autolabos", "runs", runId, "human_intervention", "request.json");
}

export function isActiveHumanInterventionRequest(
  run: RunRecord,
  request: HumanInterventionRequest | undefined
): request is HumanInterventionRequest {
  if (!request) {
    return false;
  }
  const nodeState = run.graph.nodeStates[run.currentNode];
  return (
    run.status === "paused" &&
    nodeState.status === "needs_approval" &&
    request.sourceNode === run.currentNode
  );
}

export function resolveHumanInterventionAnswer(
  request: HumanInterventionRequest,
  rawAnswer: string
): ResolvedHumanInterventionAnswer | { error: string } {
  const answer = rawAnswer.trim();
  if (!answer) {
    return { error: "Please provide an answer before resuming the run." };
  }

  if (request.inputMode === "free_text") {
    return {
      request,
      answer,
      resumeAction: request.resumeAction
    };
  }

  const choices = request.choices || [];
  if (choices.length === 0) {
    return { error: "This question has no configured choices." };
  }

  const selectedChoice = resolveChoiceByAnswer(choices, answer);
  if (!selectedChoice) {
    const labels = choices.map((choice, index) => `${index + 1}) ${choice.label}`).join(" | ");
    return { error: `Choose one of: ${labels}` };
  }

  return {
    request,
    answer,
    selectedChoice,
    resumeAction: selectedChoice.resumeAction || request.resumeAction,
    targetNode: selectedChoice.targetNode
  };
}

function resolveChoiceByAnswer(
  choices: HumanInterventionChoice[],
  rawAnswer: string
): HumanInterventionChoice | undefined {
  const normalized = rawAnswer.trim().toLowerCase();
  const index = Number.parseInt(normalized, 10);
  if (Number.isFinite(index) && index >= 1 && index <= choices.length) {
    return choices[index - 1];
  }
  return choices.find((choice) => {
    const aliases = new Set<string>([
      choice.id.toLowerCase(),
      choice.label.toLowerCase(),
      ...(choice.answerAliases || []).map((item) => item.toLowerCase())
    ]);
    return aliases.has(normalized);
  });
}

function isHumanInterventionRequest(value: unknown): value is HumanInterventionRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as HumanInterventionRequest).id === "string" &&
      typeof (value as HumanInterventionRequest).sourceNode === "string" &&
      typeof (value as HumanInterventionRequest).question === "string"
  );
}
