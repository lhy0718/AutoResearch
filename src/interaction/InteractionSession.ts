import path from "node:path";
import { promises as fs } from "node:fs";

import { RunStore } from "../core/runs/runStore.js";
import { TitleGenerator } from "../core/runs/titleGenerator.js";
import { AgentOrchestrator } from "../core/agents/agentOrchestrator.js";
import { AutonomousRunController, buildDefaultOvernightPolicy, buildDefaultAutonomousPolicy } from "../core/agents/autonomousRunController.js";
import { EventStream, AutoLabOSEvent, readPersistedRunEvents } from "../core/events.js";
import { buildNaturalAssistantResponse, matchesNaturalAssistantIntent } from "../core/commands/naturalAssistant.js";
import { buildNaturalAssistantResponseWithLlm } from "../core/commands/naturalLlmAssistant.js";
import {
  buildCollectSlashCommand,
  formatSupportedNaturalInputLines,
  isSupportedNaturalInputsQuery,
  resolveDeterministicPendingCommand
} from "../core/commands/naturalDeterministic.js";
import {
  extractStructuredActionPlan,
  isStructuredActionTimeoutError,
  looksLikeStructuredActionRequest
} from "../core/commands/naturalActionIntent.js";
import { buildDoctorHighlightLines, runDoctorReport } from "../core/doctor.js";
import { resolveRunByQuery } from "../core/runs/runResolver.js";
import { RunContextMemory } from "../core/memory/runContextMemory.js";
import { parseSlashCommand } from "../core/commands/parseSlash.js";
import { getPdfAnalysisModeForConfig } from "../config.js";
import { parseAnalysisReport } from "../core/resultAnalysis.js";
import {
  extractRunBrief,
  looksLikeRunBriefRequest,
  summarizeRunBrief
} from "../core/runs/runBriefParser.js";
import { buildBriefCompletenessArtifact } from "../core/runs/researchBriefFiles.js";
import {
  buildReviewInsightCard,
  formatReviewPacketLines,
  parseReviewPacket
} from "../core/reviewPacket.js";
import {
  buildAnalyzeResultsInsightCard,
  formatAnalyzeResultsArtifactLines
} from "../core/resultAnalysisPresentation.js";
import { loadManuscriptQualityInsightCard } from "../core/manuscriptQualityPresentation.js";
import {
  shouldSurfaceAnalyzeResultsInsight,
  shouldSurfaceReviewInsight
} from "../core/runInsightSelection.js";
import {
  buildRepositoryKnowledgeEntryLines,
  buildRepositoryKnowledgeOverviewLines,
  readRepositoryKnowledgeIndex
} from "../core/repositoryKnowledge.js";
import { buildRunLiteratureIndexLines, writeRunLiteratureIndex } from "../core/literatureIndex.js";
import { CodexCliClient, CodexReasoningEffort } from "../integrations/codex/codexCliClient.js";
import { OpenAiResponsesTextClient } from "../integrations/openai/responsesTextClient.js";
import { OllamaClient } from "../integrations/ollama/ollamaClient.js";
import { OllamaLLMClient } from "../core/llm/client.js";
import {
  AppConfig,
  GraphNodeId,
  RunRecord,
  WebSessionState,
  PendingPlan,
  AGENT_ORDER,
  RunInsightCard
} from "../types.js";
import {
  CollectCommandRequest,
  COLLECT_USAGE,
  parseCollectArgs
} from "../core/commands/collectOptions.js";
import { resolveOpenAiApiKey } from "../config.js";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_CHAT_MODEL } from "../integrations/ollama/modelCatalog.js";

interface PendingNaturalCommandState {
  command: string;
  commands: string[];
  displayCommands?: string[];
  sourceInput: string;
  createdAt: string;
  stepIndex: number;
  totalSteps: number;
  presentation?: "default" | "collect_replan_summary";
}

interface ActiveNaturalRequest {
  input: string;
  steeringHints: string[];
  abortController: AbortController;
}

interface SlashExecutionResult {
  ok: boolean;
  reason?: string;
}

interface CorpusInsights {
  totalPapers: number;
  missingPdfCount: number;
  topCitation?: {
    title: string;
    citationCount: number;
  };
  titles: string[];
}

interface CorpusInsightsCacheEntry {
  mtimeMs: number;
  size: number;
  insights: CorpusInsights;
}

export interface InteractionSessionDeps {
  workspaceRoot: string;
  config: AppConfig;
  runStore: RunStore;
  titleGenerator: TitleGenerator;
  codex: CodexCliClient;
  openAiTextClient?: OpenAiResponsesTextClient;
  eventStream: EventStream;
  orchestrator: AgentOrchestrator;
  semanticScholarApiKeyConfigured: boolean;
}

export interface SessionListener {
  (): void;
}

export interface CreateRunRequest {
  topic: string;
  constraints: string[];
  objectiveMetric: string;
}

export interface CreateRunFromBriefRequest {
  brief: string;
  topic?: string;
  constraints?: string[];
  objectiveMetric?: string;
  autoStart?: boolean;
  abortSignal?: AbortSignal;
}

export class InteractionSession {
  private readonly workspaceRoot: string;
  private readonly config: AppConfig;
  private readonly runStore: RunStore;
  private readonly titleGenerator: TitleGenerator;
  private readonly codex: CodexCliClient;
  private readonly openAiTextClient?: OpenAiResponsesTextClient;
  private readonly eventStream: EventStream;
  private readonly orchestrator: AgentOrchestrator;
  private readonly semanticScholarApiKeyConfigured: boolean;
  private readonly listeners = new Set<SessionListener>();
  private readonly corpusInsightsCache = new Map<string, CorpusInsightsCacheEntry>();
  private readonly seenEventIds = new Set<string>();

  private logs: string[] = [];
  private runIndex: RunRecord[] = [];
  private activeRunId?: string;
  private activeRunInsight?: RunInsightCard;
  private busy = false;
  private thinking = false;
  private queuedInputs: string[] = [];
  private activeNaturalRequest?: ActiveNaturalRequest;
  private pendingNaturalCommand?: PendingNaturalCommandState;
  private activeBusyAbortController?: AbortController;
  private activeBusyLabel?: string;
  private steeringBufferDuringThinking: string[] = [];
  private drainingQueuedInputs = false;
  private unsubscribeEvents?: () => void;

  constructor(deps: InteractionSessionDeps) {
    this.workspaceRoot = deps.workspaceRoot;
    this.config = deps.config;
    this.runStore = deps.runStore;
    this.titleGenerator = deps.titleGenerator;
    this.codex = deps.codex;
    this.openAiTextClient = deps.openAiTextClient;
    this.eventStream = deps.eventStream;
    this.orchestrator = deps.orchestrator;
    this.semanticScholarApiKeyConfigured = deps.semanticScholarApiKeyConfigured;
  }

  async start(): Promise<void> {
    await this.refreshRunIndex();
    await this.replayPersistedRunEvents(this.activeRunId);
    this.unsubscribeEvents = this.eventStream.subscribe((event) => {
      if (!this.rememberEventId(event.id)) {
        return;
      }
      const line = formatEventLog(event);
      if (!line) {
        return;
      }
      this.pushLog(line);
    });
    this.pushLog("Web session is ready.");
  }

  dispose(): void {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): WebSessionState {
    return {
      activeRunId: this.activeRunId,
      busy: this.busy,
      busyLabel: this.thinking ? "Thinking..." : this.activeBusyLabel,
      pendingPlan: this.pendingNaturalCommand
        ? {
            sourceInput: this.pendingNaturalCommand.sourceInput,
            displayCommands: this.resolvePendingDisplayCommands(this.pendingNaturalCommand),
            stepIndex: this.pendingNaturalCommand.stepIndex,
            totalSteps: this.pendingNaturalCommand.totalSteps
          }
        : undefined,
      logs: [...this.logs],
      canCancel: this.busy,
      activeRunInsight: this.activeRunInsight
    };
  }

  runs(): RunRecord[] {
    return [...this.runIndex];
  }

  getActiveRunId(): string | undefined {
    return this.activeRunId;
  }

  async refresh(): Promise<void> {
    await this.refreshRunIndex();
  }

  async selectRun(runId: string): Promise<void> {
    await this.setActiveRunId(runId);
    this.notify();
  }

  async createRun(input: CreateRunRequest): Promise<RunRecord> {
    const title = await this.titleGenerator.generateTitle(
      input.topic,
      input.constraints,
      input.objectiveMetric
    );
    const run = await this.runStore.createRun({
      title,
      topic: input.topic,
      constraints: input.constraints,
      objectiveMetric: input.objectiveMetric
    });
    await this.refreshRunIndex();
    await this.setActiveRunId(run.id);
    this.pushLog(`Created run ${run.id}`);
    this.pushLog(`Title: ${run.title}`);
    return run;
  }

  async createRunFromBrief(input: CreateRunFromBriefRequest): Promise<RunRecord> {
    const extracted = await extractRunBrief({
      brief: input.brief,
      defaults: {
        topic: input.topic?.trim() || this.config.research.default_topic,
        constraints: input.constraints?.length ? input.constraints : this.config.research.default_constraints,
        objectiveMetric: input.objectiveMetric?.trim() || this.config.research.default_objective_metric
      },
      llm: this.getCommandIntentClient(),
      abortSignal: input.abortSignal
    });
    for (const line of summarizeRunBrief(extracted)) {
      this.pushLog(line);
    }
    const run = await this.createRun({
      topic: extracted.topic,
      constraints: extracted.constraints,
      objectiveMetric: extracted.objectiveMetric
    });
    const runContextMemory = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
    await runContextMemory.put("run_brief.raw", input.brief);
    await runContextMemory.put("run_brief.extracted", extracted);
    await runContextMemory.put("run_brief.plan_summary", extracted.planSummary || null);
    const briefCompleteness = buildBriefCompletenessArtifact(input.brief);
    await runContextMemory.put("run_brief.completeness", briefCompleteness);
    if (briefCompleteness.grade === "minimal") {
      this.pushLog(`Brief completeness: ${briefCompleteness.grade} — missing: ${briefCompleteness.missing_sections.join(", ") || "none"}.`);
    } else if (briefCompleteness.grade === "partial") {
      this.pushLog(`Brief completeness: ${briefCompleteness.grade} — paper-scale sections partially filled.`);
    }
    if (!input.autoStart) {
      return run;
    }
    return this.startRun(run.id, input.abortSignal);
  }

  async startRun(runId: string, abortSignal?: AbortSignal): Promise<RunRecord> {
    await this.setActiveRunId(runId);
    this.pushLog(`Auto-starting research for ${runId} from collect_papers...`);
    const response = await this.orchestrator.runCurrentAgentWithOptions(runId, {
      abortSignal
    });
    await this.refreshRunIndex();
    await this.setActiveRunId(response.run.id);
    this.pushLog(`Research start result: ${response.result.summary}`);
    if (response.result.status === "failure" && response.result.error) {
      this.pushLog(`Research start error: ${response.result.error}`);
    }
    return response.run;
  }

  async submitInput(text: string): Promise<WebSessionState> {
    const normalized = text.trim();
    if (!normalized) {
      return this.snapshot();
    }

    if (this.busy) {
      if (this.activeNaturalRequest) {
        const steering = normalizeSteeringInput(normalized);
        if (steering) {
          this.applySteeringInput(steering);
        }
        return this.snapshot();
      }
      this.queuedInputs.push(normalized);
      this.pushLog(`Queued turn: ${oneLine(normalized)}`);
      return this.snapshot();
    }

    if (this.pendingNaturalCommand && !isSlashPrefixed(normalized)) {
      await this.handlePendingNaturalConfirmation(normalized);
      return this.snapshot();
    }

    await this.executeInput(normalized);
    return this.snapshot();
  }

  async respondToPending(action: "next" | "all" | "cancel"): Promise<WebSessionState> {
    if (!this.pendingNaturalCommand) {
      return this.snapshot();
    }
    const text = action === "next" ? "y" : action === "all" ? "a" : "n";
    await this.handlePendingNaturalConfirmation(text);
    return this.snapshot();
  }

  async cancelActive(): Promise<WebSessionState> {
    this.cancelCurrentBusyOperation();
    return this.snapshot();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private pushLog(line: string): void {
    this.appendLogLine(line);
    this.notify();
  }

  private pushReplayLog(line: string): void {
    this.appendLogLine(`Replay: ${line}`);
    this.notify();
  }

  private appendLogLine(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 200) {
      this.logs = this.logs.slice(-200);
    }
  }

  private async refreshRunIndex(): Promise<void> {
    this.runIndex = await this.runStore.listRuns();
    if (this.runIndex.length > 0) {
      if (!this.activeRunId || !this.runIndex.some((run) => run.id === this.activeRunId)) {
        this.activeRunId = this.runIndex[0].id;
      }
    } else {
      this.activeRunId = undefined;
    }
    await this.refreshActiveRunInsight();
    this.notify();
  }

  private async executeInput(text: string): Promise<void> {
    if (!isSlashPrefixed(text)) {
      await this.handleNaturalInput(text);
      return;
    }

    if (this.pendingNaturalCommand) {
      const pending = this.describePendingNaturalCommands(this.pendingNaturalCommand);
      this.pendingNaturalCommand = undefined;
      this.pushLog(`Pending natural action cleared: ${pending}`);
    }

    const parsed = parseSlashCommand(text);
    if (!parsed) {
      this.pushLog("Unable to parse command. Use /help.");
      return;
    }

    await this.runBusyAction(
      async (abortSignal) => {
        await this.executeParsedSlash(parsed.command, parsed.args, abortSignal);
      },
      this.describeBusyLabelForSlash(parsed.command, parsed.args)
    );
  }

  private async handleNaturalInput(text: string): Promise<void> {
    await this.runBusyAction(async (busyAbortSignal) => {
      await this.refreshRunIndex();
      this.pushLog(`Natural query: ${oneLine(text)}`);

      const fastHandled = await this.handleFastNaturalIntent(text, busyAbortSignal);
      if (fastHandled) {
        return;
      }

      let steeringHints: string[] = [];
      while (true) {
        this.steeringBufferDuringThinking = [];
        const abortController = new AbortController();
        const forwardAbort = () => abortController.abort();
        if (busyAbortSignal.aborted) {
          abortController.abort();
        } else {
          busyAbortSignal.addEventListener("abort", forwardAbort, { once: true });
        }
        this.activeNaturalRequest = {
          input: text,
          steeringHints: [...steeringHints],
          abortController
        };
        this.startThinking();

        let response: Awaited<ReturnType<typeof buildNaturalAssistantResponseWithLlm>> | undefined;
        try {
          response = await buildNaturalAssistantResponseWithLlm({
            input: text,
            runs: this.runIndex,
            activeRunId: this.activeRunId,
            logs: this.logs,
            llm: this.getNaturalAssistantClient(),
            workspaceRoot: this.workspaceRoot,
            steeringHints,
            abortSignal: abortController.signal,
            onProgress: (line) => {
              this.pushLog(oneLine(line));
            }
          });
        } catch (error) {
          if (this.isSteeringAbort(error)) {
            const buffered = this.consumeSteeringBuffer();
            if (buffered.length > 0) {
              steeringHints = this.mergeSteeringHints(steeringHints, buffered);
              this.pushLog(`Steering applied (${buffered.length}). Re-running...`);
              continue;
            }
            if (busyAbortSignal.aborted) {
              return;
            }
          }
          throw error;
        } finally {
          busyAbortSignal.removeEventListener("abort", forwardAbort);
          this.activeNaturalRequest = undefined;
          this.stopThinking();
        }

        const bufferedAfter = this.consumeSteeringBuffer();
        if (bufferedAfter.length > 0) {
          steeringHints = this.mergeSteeringHints(steeringHints, bufferedAfter);
          this.pushLog(`Steering applied (${bufferedAfter.length}). Re-running...`);
          continue;
        }

        if (!response) {
          return;
        }
        if (response.targetRunId) {
          await this.setActiveRunId(response.targetRunId);
        }
        for (const line of response.lines) {
          this.pushLog(line);
        }
        if (response.pendingCommands?.length) {
          this.armPendingNaturalCommands(text, response.pendingCommands);
        } else if (response.pendingCommand) {
          this.armPendingNaturalCommands(text, [response.pendingCommand]);
        }
        return;
      }
    });
  }

  private async handlePendingNaturalConfirmation(text: string): Promise<void> {
    const pending = this.pendingNaturalCommand;
    if (!pending) {
      return;
    }
    const normalized = text.trim().toLowerCase();
    const runAllRemaining = isRunAllRemainingInput(normalized) && pending.totalSteps > 1;
    const displayCommands = this.resolvePendingDisplayCommands(pending);

    if (isAffirmative(normalized) || runAllRemaining) {
      this.pendingNaturalCommand = undefined;
      this.notify();
      await this.runBusyAction(async (abortSignal) => {
        if (pending.totalSteps === 1) {
          this.pushLog(`Confirmed. Running: ${displayCommands[0] ?? pending.command}`);
        } else if (runAllRemaining) {
          this.pushLog(
            `Confirmed. Running all remaining steps from ${pending.stepIndex + 1}/${pending.totalSteps}.`
          );
        } else {
          this.pushLog(
            `Confirmed. Running step ${pending.stepIndex + 1}/${pending.totalSteps}: ${displayCommands[0] ?? pending.command}`
          );
        }

        for (let offset = 0; offset < pending.commands.length; offset += 1) {
          const command = pending.commands[offset];
          const displayCommand = displayCommands[offset] ?? command;
          const currentStepIndex = pending.stepIndex + offset;
          const currentStepNumber = currentStepIndex + 1;
          const parsed = parseSlashCommand(command);
          if (!parsed) {
            this.pushLog(`Failed to parse pending command: ${command}`);
            return;
          }

          this.activeBusyLabel = this.describeBusyLabelForSlash(parsed.command, parsed.args);
          this.notify();
          if (pending.totalSteps > 1 && (offset > 0 || runAllRemaining)) {
            this.pushLog(`Step ${currentStepNumber}/${pending.totalSteps}: ${displayCommand}`);
          }

          const result = await this.executeParsedSlash(parsed.command, parsed.args, abortSignal);
          if (!result.ok) {
            if (pending.totalSteps > 1) {
              this.pushLog(
                `Stopped remaining plan after step ${currentStepNumber}/${pending.totalSteps}: ${result.reason || "step failed"}.`
              );
            }
            await this.attemptAutomaticReplanAfterFailedStep(
              pending,
              currentStepIndex,
              command,
              result.reason,
              abortSignal
            );
            return;
          }

          if (pending.totalSteps > 1 && currentStepNumber < pending.totalSteps) {
            this.pushLog(`Step ${currentStepNumber}/${pending.totalSteps} completed.`);
            if (!runAllRemaining) {
              this.armPendingNaturalCommands(pending.sourceInput, pending.commands.slice(offset + 1), {
                stepIndex: currentStepIndex + 1,
                totalSteps: pending.totalSteps,
                continuation: true,
                presentation: pending.presentation,
                displayCommands: pending.displayCommands?.slice(offset + 1)
              });
              return;
            }
          }
        }

        if (pending.totalSteps > 1) {
          this.pushLog(`Plan completed after ${pending.totalSteps} step(s).`);
        }
      }, "pending natural command");
      return;
    }

    if (isNegative(normalized)) {
      this.pendingNaturalCommand = undefined;
      this.pushLog(
        pending.totalSteps === 1
          ? `Canceled pending command: ${displayCommands[0] ?? pending.command}`
          : `Canceled pending plan from step ${pending.stepIndex + 1}/${pending.totalSteps}: ${this.describePendingNaturalCommands(pending)}`
      );
      this.notify();
      return;
    }

    if (pending.totalSteps === 1) {
      this.pushLog(`Pending command: ${displayCommands[0] ?? pending.command}`);
      this.pushLog("Type 'y' to run it, or 'n' to cancel.");
    } else {
      this.pushLog(this.buildPendingPlanReminderLine(pending));
      this.pushLog(
        `Type 'y' to run step ${pending.stepIndex + 1}/${pending.totalSteps}, 'a' to run all remaining steps, or 'n' to cancel the remaining plan.`
      );
    }
  }

  private async runBusyAction(
    action: (abortSignal: AbortSignal) => Promise<void>,
    label = "operation"
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeBusyAbortController = abortController;
    this.activeBusyLabel = label;
    this.busy = true;
    this.notify();
    try {
      await action(abortController.signal);
    } catch (error) {
      if (this.isAbortError(error)) {
        this.pushLog(`Canceled: ${label}`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.pushLog(`Error: ${message}`);
    } finally {
      if (this.activeBusyAbortController === abortController) {
        this.activeBusyAbortController = undefined;
        this.activeBusyLabel = undefined;
      }
      this.busy = false;
      this.thinking = false;
      this.notify();
      await this.drainQueuedInputs();
    }
  }

  private async handleFastNaturalIntent(text: string, abortSignal: AbortSignal): Promise<boolean> {
    if (abortSignal.aborted) {
      return true;
    }

    if (looksLikeRunBriefRequest(text)) {
      const run = await this.createRunFromBrief({
        brief: text,
        autoStart: true,
        abortSignal
      });
      this.pushLog(`Created run ${run.id} from the natural-language brief and started research.`);
      return true;
    }

    const titleChange = extractTitleChangeIntent(text);
    if (titleChange) {
      const run = await this.resolveTargetRun(undefined);
      if (!run) {
        return true;
      }
      const command = buildTitleCommand(titleChange.title, run.id);
      this.pushLog(`I can rename the run title to "${titleChange.title}".`);
      this.armPendingNaturalCommands(text, [command]);
      return true;
    }

    if (isSupportedNaturalInputsQuery(text)) {
      for (const line of formatSupportedNaturalInputLines("en")) {
        this.pushLog(line);
      }
      this.pushLog("Questions outside this list continue to use the workspace-grounded LLM fallback.");
      return true;
    }

    if (looksLikeStructuredActionRequest(text)) {
      this.startThinking();
      try {
        const structuredPlan = await extractStructuredActionPlan({
          input: text,
          runs: this.runIndex,
          activeRunId: this.activeRunId,
          llm: this.getCommandIntentClient(),
          abortSignal,
          onProgress: (line) => {
            this.pushLog(oneLine(line));
          }
        });
        if (structuredPlan) {
          if (structuredPlan.targetRunId) {
            await this.setActiveRunId(structuredPlan.targetRunId);
          }
          for (const line of structuredPlan.lines) {
            this.pushLog(line);
          }
          this.armPendingNaturalCommands(text, structuredPlan.commands, {
            displayCommands: structuredPlan.displayActions
          });
          return true;
        }
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        if (!isStructuredActionTimeoutError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          this.pushLog(`Structured action extraction failed: ${message}`);
        }
      } finally {
        this.stopThinking();
      }
    }

    const run = await this.resolveTargetRun(undefined);
    if (run) {
      const insights = await this.readCorpusInsights(run.id);
      if (isMissingPdfCountIntent(text)) {
        this.pushLog(
          insights.totalPapers === 0
            ? "No collected papers were found in the current run."
            : `Papers without a PDF path: ${insights.missingPdfCount} (out of ${insights.totalPapers}).`
        );
        return true;
      }
      if (isTopCitationIntent(text)) {
        if (insights.totalPapers === 0) {
          this.pushLog("No collected papers were found in the current run.");
          return true;
        }
        if (!insights.topCitation) {
          this.pushLog("Citation metadata is missing, so I cannot compute the top-cited paper.");
          return true;
        }
        this.pushLog(`The top-cited paper is "${insights.topCitation.title}" with ${insights.topCitation.citationCount} citations.`);
        return true;
      }
      if (isPaperCountIntent(text)) {
        this.pushLog(`The current run has ${insights.totalPapers} collected papers.`);
        return true;
      }
      if (isPaperTitleIntent(text)) {
        const limit = extractRequestedTitleCount(text);
        const titles = insights.titles.slice(0, limit);
        if (titles.length === 0) {
          this.pushLog("No collected paper titles were found in the current run.");
          return true;
        }
        this.pushLog(`Here are ${titles.length} paper title(s).`);
        titles.forEach((title, index) => {
          this.pushLog(`${index + 1}. ${title}`);
        });
        return true;
      }
    }

    const deterministic = resolveDeterministicPendingCommand(text, {
      runs: this.runIndex,
      activeRunId: this.activeRunId
    });
    if (deterministic) {
      if (deterministic.targetRunId) {
        await this.setActiveRunId(deterministic.targetRunId);
      }
      for (const line of deterministic.lines) {
        this.pushLog(line);
      }
      if (deterministic.pendingCommand) {
        this.armPendingNaturalCommands(text, [deterministic.pendingCommand]);
      }
      return true;
    }

    if (matchesNaturalAssistantIntent(text)) {
      const response = buildNaturalAssistantResponse({
        input: text,
        runs: this.runIndex,
        activeRunId: this.activeRunId
      });
      if (response.targetRunId) {
        await this.setActiveRunId(response.targetRunId);
      }
      for (const line of response.lines) {
        this.pushLog(line);
      }
      if (response.pendingCommand) {
        this.armPendingNaturalCommands(text, [response.pendingCommand]);
      }
      return true;
    }

    return false;
  }

  private async attemptAutomaticReplanAfterFailedStep(
    pending: { command: string; commands: string[]; sourceInput: string; createdAt: string },
    failedStepIndex: number,
    failedCommand: string,
    failureReason: string | undefined,
    abortSignal: AbortSignal
  ): Promise<void> {
    if (abortSignal.aborted) {
      return;
    }
    this.pushLog("Attempting automatic replan after failed step...");

    const deterministicReplan = this.buildDeterministicCollectReplanAfterFailure(
      failedCommand,
      failureReason
    );
    if (deterministicReplan) {
      for (const line of deterministicReplan.lines) {
        this.pushLog(line);
      }
      if (!samePendingPlan(pending.commands, deterministicReplan.commands)) {
        this.armPendingNaturalCommands(pending.sourceInput, deterministicReplan.commands, {
          presentation: "collect_replan_summary"
        });
      }
      return;
    }

    try {
      const response = await buildNaturalAssistantResponseWithLlm({
        input: pending.sourceInput,
        runs: this.runIndex,
        activeRunId: this.activeRunId,
        logs: this.logs,
        llm: this.getNaturalAssistantClient(),
        workspaceRoot: this.workspaceRoot,
        steeringHints: [
          "Automatic replan requested after a failed multi-step slash-command plan.",
          `Original pending commands: ${JSON.stringify(pending.commands)}`,
          `Failure step index: ${failedStepIndex + 1}/${pending.commands.length}`,
          `Failed command: ${failedCommand}`,
          `Failure reason: ${failureReason || "unknown"}`,
          "Return a revised slash-command plan if one is available.",
          "Do not repeat the same failed command unchanged if it already failed."
        ],
        abortSignal,
        onProgress: (line) => {
          this.pushLog(oneLine(line));
        }
      });
      if (response.targetRunId) {
        await this.setActiveRunId(response.targetRunId);
      }
      for (const line of response.lines) {
        this.pushLog(line);
      }
      const proposedCommands = response.pendingCommands?.length
        ? response.pendingCommands
        : response.pendingCommand
          ? [response.pendingCommand]
          : [];
      if (proposedCommands.length === 0 || samePendingPlan(pending.commands, proposedCommands)) {
        return;
      }
      this.armPendingNaturalCommands(pending.sourceInput, proposedCommands);
    } catch (error) {
      if (!this.isAbortError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        this.pushLog(`Automatic replan failed: ${message}`);
      }
    }
  }

  private buildDeterministicCollectReplanAfterFailure(
    failedCommand: string,
    failureReason: string | undefined
  ): { lines: string[]; commands: string[] } | undefined {
    if (!isSemanticScholarRateLimitFailure(failureReason)) {
      return undefined;
    }
    const parsedSlash = parseSlashCommand(failedCommand);
    if (!parsedSlash || parsedSlash.command !== "agent") {
      return undefined;
    }
    const sub = (parsedSlash.args[0] || "").toLowerCase();
    if (sub !== "collect" && sub !== "recollect") {
      return undefined;
    }
    const collectParsed =
      sub === "collect"
        ? parseCollectArgs(parsedSlash.args.slice(1))
        : parseCollectArgs(["--additional", parsedSlash.args[1] || "", "--run", parsedSlash.args[2] || ""]);
    if (!collectParsed.ok || !collectParsed.request) {
      return undefined;
    }

    const request = { ...collectParsed.request, warnings: [] };
    const targetRun =
      (request.runQuery ? this.runIndex.find((run) => run.id === request.runQuery) : undefined) ||
      this.getActiveIndexedRun();
    const query = request.query?.trim() || targetRun?.topic;
    if (!query) {
      return undefined;
    }

    const batchSize = determineCollectReplanBatchSize(request, !this.semanticScholarApiKeyConfigured);
    const totalRequested = request.additional ?? request.limit ?? Math.max(1, this.config.papers.max_results);
    if (totalRequested <= batchSize) {
      return undefined;
    }

    const commands: string[] = [];
    let remaining = totalRequested;
    const runId = targetRun?.id;
    const baseRequest: CollectCommandRequest = {
      ...request,
      query,
      warnings: [],
      dryRun: false
    };

    const firstFetch = Math.min(batchSize, remaining);
    commands.push(
      buildCollectSlashCommand(
        { ...baseRequest, additional: undefined, limit: firstFetch },
        runId
      )
    );
    remaining -= firstFetch;

    while (remaining > 0) {
      const additional = Math.min(batchSize, remaining);
      commands.push(
        buildCollectSlashCommand(
          { ...baseRequest, limit: undefined, additional },
          runId
        )
      );
      remaining -= additional;
    }

    return {
      lines: [
        `Deterministic collect replan: splitting the failed request into ${commands.length} smaller step(s) of up to ${batchSize} papers.`,
        "This avoids another LLM round-trip and retries the same collect request in smaller batches."
      ],
      commands
    };
  }

  private async drainQueuedInputs(): Promise<void> {
    if (this.drainingQueuedInputs || this.busy || this.queuedInputs.length === 0) {
      return;
    }
    this.drainingQueuedInputs = true;
    try {
      while (!this.busy && this.queuedInputs.length > 0) {
        const next = this.queuedInputs.shift();
        if (!next) {
          break;
        }
        this.pushLog(`Running queued input: ${oneLine(next)}`);
        await this.executeInput(next);
      }
    } finally {
      this.drainingQueuedInputs = false;
    }
  }

  private consumeSteeringBuffer(): string[] {
    const buffered = [...this.steeringBufferDuringThinking];
    this.steeringBufferDuringThinking = [];
    return buffered;
  }

  private mergeSteeringHints(base: string[], incoming: string[]): string[] {
    const merged = [...base];
    for (const hint of incoming) {
      const normalized = oneLine(hint);
      if (!normalized) {
        continue;
      }
      if (!merged.some((item) => oneLine(item) === normalized)) {
        merged.push(hint);
      }
    }
    return merged.slice(-8);
  }

  private cancelCurrentBusyOperation(): void {
    if (!this.busy) {
      return;
    }
    if (this.activeNaturalRequest && !this.activeNaturalRequest.abortController.signal.aborted) {
      this.pushLog(`Cancel requested: ${oneLine(this.activeNaturalRequest.input)}`);
      this.activeNaturalRequest.abortController.abort();
      return;
    }
    if (this.activeBusyAbortController && !this.activeBusyAbortController.signal.aborted) {
      const label = this.activeBusyLabel || "operation";
      this.pushLog(`Cancel requested: ${label}`);
      this.activeBusyAbortController.abort();
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && /abort/i.test(error.message);
  }

  private isSteeringAbort(error: unknown): boolean {
    return this.isAbortError(error);
  }

  private wasAgentRunCanceled(run: RunRecord, node: GraphNodeId): boolean {
    const state = run.graph.nodeStates[node];
    return run.status === "paused" && state.status === "pending" && state.note === "Canceled by user";
  }

  private shouldAutoContinueAfterNodeAdvance(requestedNode: GraphNodeId, run: RunRecord): boolean {
    if (AGENT_ORDER.indexOf(run.currentNode) <= AGENT_ORDER.indexOf(requestedNode)) {
      return false;
    }
    if (run.status === "completed" || run.status === "failed") {
      return false;
    }
    const currentState = run.graph.nodeStates[run.currentNode];
    return currentState.status === "pending" || currentState.status === "running";
  }

  private shouldAutoContinueAfterCollectRecovery(run: RunRecord): boolean {
    return this.shouldAutoContinueAfterNodeAdvance("collect_papers", run);
  }

  private applySteeringInput(instruction: string): void {
    if (!this.activeNaturalRequest) {
      return;
    }
    this.steeringBufferDuringThinking.push(instruction);
    this.pushLog(`Natural query: ${oneLine(instruction)}`);
    this.pushLog("Replanning current natural query with latest steering...");
    this.activeNaturalRequest.abortController.abort();
  }

  private async executeParsedSlash(
    command: string,
    args: string[],
    abortSignal?: AbortSignal
  ): Promise<SlashExecutionResult> {
    if (abortSignal?.aborted) {
      throw new Error("Operation aborted by user");
    }
    switch (command) {
      case "help":
        this.printHelp();
        return { ok: true };
      case "new":
        this.pushLog("Use the new run form in the web UI.");
        return { ok: false, reason: "new run requires the dedicated form" };
      case "doctor":
        await this.handleDoctor();
        return { ok: true };
      case "runs":
        await this.handleRuns(args);
        return { ok: true };
      case "run":
        return this.handleRunSelect(args, false);
      case "resume":
        return this.handleRunSelect(args, true);
      case "title":
        return this.handleTitle(args);
      case "knowledge":
        await this.handleKnowledge(args);
        return { ok: true };
      case "agent":
        return this.handleAgent(args, abortSignal);
      case "approve":
        return this.handleApprove();
      case "retry":
        return this.handleRetry();
      case "settings":
      case "model":
      case "quit":
        this.pushLog(`/${command} is not available in the web composer.`);
        return { ok: false, reason: `/${command} is not supported in web` };
      default:
        this.pushLog(`Unknown command: /${command}`);
        return { ok: false, reason: `unknown command /${command}` };
    }
  }

  private printHelp(): void {
    this.pushLog("Web composer commands:");
    this.pushLog("/help | /runs | /run <run> | /resume <run> | /title <new title>");
    this.pushLog("/knowledge [run]");
    this.pushLog("/doctor | /approve | /retry");
    this.pushLog("/agent list | /agent status [run] | /agent graph [run]");
    this.pushLog("/agent review [run] | /agent transition [run] | /agent apply [run] | /agent overnight [run] | /agent autonomous [run]");
    this.pushLog("/agent run <node> [run] [--top-n <n> | --top-k <n> --branch-count <n>]");
    this.pushLog("/agent collect [query] [options] | /agent jump <node> [run] [--force]");
  }

  private async handleKnowledge(args: string[]): Promise<void> {
    const index = await readRepositoryKnowledgeIndex(this.workspaceRoot);
    const query = args.join(" ").trim() || undefined;

    if (query) {
      const run = await this.resolveTargetRun(query);
      if (!run) {
        return;
      }
      const entry = index.entries.find((item) => item.run_id === run.id);
      if (!entry) {
        this.pushLog(`No repository knowledge entry has been published for ${run.id} yet.`);
      } else {
        for (const line of buildRepositoryKnowledgeEntryLines(entry)) {
          this.pushLog(line);
        }
      }
      for (const line of buildRunLiteratureIndexLines(await writeRunLiteratureIndex(this.workspaceRoot, run.id))) {
        this.pushLog(line);
      }
      return;
    }

    const activeRun = this.getActiveIndexedRun();
    if (activeRun) {
      const activeEntry = index.entries.find((item) => item.run_id === activeRun.id);
      if (activeEntry) {
        for (const line of buildRepositoryKnowledgeEntryLines(activeEntry)) {
          this.pushLog(line);
        }
      }
      for (const line of buildRunLiteratureIndexLines(await writeRunLiteratureIndex(this.workspaceRoot, activeRun.id))) {
        this.pushLog(line);
      }
      return;
    }

    for (const line of buildRepositoryKnowledgeOverviewLines(index.entries)) {
      this.pushLog(line);
    }
  }

  private async handleDoctor(): Promise<void> {
    const report = await runDoctorReport(this.codex, {
      llmMode: this.config.providers.llm_mode,
      pdfAnalysisMode: getPdfAnalysisModeForConfig(this.config),
      openAiApiKeyConfigured: await resolveOpenAiApiKey(this.workspaceRoot).then(Boolean),
      codexResearchModel: this.config.providers.codex.model,
      ollamaBaseUrl: this.config.providers.ollama?.base_url,
      ollamaChatModel: this.config.providers.ollama?.chat_model,
      ollamaResearchModel: this.config.providers.ollama?.research_model,
      ollamaVisionModel: this.config.providers.ollama?.vision_model,
      workspaceRoot: this.workspaceRoot,
      includeHarnessValidation: true,
      includeHarnessTestRecords: false,
      maxHarnessFindings: 30
    });
    for (const line of buildDoctorHighlightLines(report)) {
      this.pushLog(line);
    }
    for (const check of report.checks) {
      this.pushLog(`[${check.ok ? "OK" : "FAIL"}] ${check.name}: ${check.detail}`);
    }
    if (report.harness) {
      this.pushLog(
        `[${report.harness.status === "ok" ? "OK" : "FAIL"}] harness-validation: `
          + `${report.harness.findings.length} issue(s), ${report.harness.runsChecked} run(s) checked`
      );
      for (const finding of report.harness.findings.slice(0, 5)) {
        const runTag = finding.runId ? ` [run:${finding.runId}]` : "";
        this.pushLog(`  - (${finding.kind}) ${finding.code}${runTag}: ${finding.message}`);
        this.pushLog(`    remediation: ${finding.remediation}`);
      }
      if (report.harness.findings.length > 5) {
        this.pushLog(`  ... ${report.harness.findings.length - 5} more harness finding(s)`);
      }
    }
  }

  private async handleRuns(args: string[]): Promise<void> {
    const query = args.join(" ").trim();
    const runs = query ? await this.runStore.searchRuns(query) : await this.runStore.listRuns();
    if (runs.length === 0) {
      this.pushLog("No runs found.");
      return;
    }
    this.pushLog(`Found ${runs.length} run(s):`);
    for (const run of runs.slice(0, 20)) {
      this.pushLog(`${run.id} | ${run.title} | ${run.currentNode} | ${run.status}`);
    }
  }

  private async handleRunSelect(args: string[], resume: boolean): Promise<SlashExecutionResult> {
    const query = args.join(" ").trim();
    if (!query) {
      this.pushLog(`Usage: /${resume ? "resume" : "run"} <run>`);
      return { ok: false, reason: `missing run for /${resume ? "resume" : "run"}` };
    }
    const runs = await this.runStore.listRuns();
    const run = resolveRunByQuery(runs, query);
    if (!run) {
      this.pushLog(`Run not found for query: ${query}`);
      return { ok: false, reason: `run not found for query ${query}` };
    }
    await this.setActiveRunId(run.id);
    this.pushLog(`Selected run ${run.id}: ${run.title}`);
    if (resume) {
      await this.orchestrator.resumeRun(run.id);
      this.pushLog("Run resumed from latest checkpoint state.");
    }
    await this.refreshRunIndex();
    return { ok: true };
  }

  private async handleTitle(args: string[]): Promise<SlashExecutionResult> {
    const parsed = parseTitleCommandArgs(args);
    if (parsed.error) {
      this.pushLog(parsed.error);
      return { ok: false, reason: parsed.error };
    }
    const run = await this.resolveTargetRun(parsed.runQuery);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }
    const previousTitle = run.title;
    run.title = parsed.title;
    await this.runStore.updateRun(run);
    await this.setActiveRunId(run.id);
    await this.refreshRunIndex();
    this.pushLog(`Updated title: ${previousTitle} -> ${parsed.title}`);
    return { ok: true };
  }

  private async handleAgent(args: string[], abortSignal?: AbortSignal): Promise<SlashExecutionResult> {
    const sub = (args[0] || "").toLowerCase();
    if (!sub || sub === "list") {
      this.pushLog(`Graph nodes: ${AGENT_ORDER.join(", ")}`);
      return { ok: true };
    }
    if (sub === "run") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent run <node> [run] [--top-n <n> | --top-k <n> --branch-count <n>]");
        return { ok: false, reason: "missing or invalid node for /agent run" };
      }
      let runQuery = args.slice(2).join(" ").trim() || undefined;
      if (nodeRaw === "analyze_papers") {
        const parsed = parseAnalyzeRunArgs(args.slice(2));
        if (parsed.error) {
          this.pushLog(parsed.error);
          return { ok: false, reason: parsed.error };
        }
        runQuery = parsed.runQuery;
        const run = await this.resolveTargetRun(runQuery);
        if (!run) {
          return { ok: false, reason: "target run not found" };
        }
        const memory = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
        if (parsed.topN) {
          await memory.put("analyze_papers.request", {
            topN: parsed.topN,
            selectionMode: "top_n",
            selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
          });
        }
      } else if (nodeRaw === "generate_hypotheses") {
        const parsed = parseGenerateHypothesesRunArgs(args.slice(2));
        if (parsed.error) {
          this.pushLog(parsed.error);
          return { ok: false, reason: parsed.error };
        }
        runQuery = parsed.runQuery;
        const run = await this.resolveTargetRun(runQuery);
        if (!run) {
          return { ok: false, reason: "target run not found" };
        }
        const memory = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
        await memory.put("generate_hypotheses.request", {
          topK: parsed.topK ?? 2,
          branchCount: parsed.branchCount ?? 6
        });
      }

      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      await this.setActiveRunId(run.id);
      const response = await this.orchestrator.runAgentWithOptions(run.id, nodeRaw, { abortSignal });
      let updatedRun = response.run;
      await this.refreshRunIndex();
      const refreshedRun = (await this.runStore.getRun(run.id)) ?? response.run;
      if (this.shouldAutoContinueAfterNodeAdvance(nodeRaw, refreshedRun)) {
        const continued = await this.orchestrator.runCurrentAgentWithOptions(run.id, { abortSignal });
        await this.refreshRunIndex();
        await this.setActiveRunId(continued.run.id);
        updatedRun = continued.run;
        if (continued.result.status === "failure" || continued.run.status === "failed") {
          const failure = continued.result.error || continued.result.summary || "run failed";
          this.pushLog(`Research stopped: ${oneLine(failure)}`);
          return { ok: false, reason: failure };
        }
      }
      if (this.wasAgentRunCanceled(updatedRun, nodeRaw)) {
        throw new Error("Operation aborted by user");
      }
      if (response.result.status === "failure") {
        this.pushLog(`Node ${nodeRaw} failed: ${response.result.error || "unknown error"}`);
        return { ok: false, reason: response.result.error || `${nodeRaw} failed` };
      }
      this.pushLog(`Node ${nodeRaw} finished: ${oneLine(response.result.summary)}`);
      return { ok: true };
    }

    if (sub === "status") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      this.pushLog(`Run ${run.id}: ${run.title}`);
      this.pushLog(`Current node: ${run.currentNode} | run status: ${run.status}`);
      for (const node of AGENT_ORDER) {
        const state = run.graph.nodeStates[node];
        const retry = run.graph.retryCounters[node] ?? 0;
        const rollback = run.graph.rollbackCounters[node] ?? 0;
        this.pushLog(`- ${node}: ${state.status} (retry=${retry}, rollback=${rollback})`);
      }
      if (run.graph.pendingTransition) {
        this.pushLog(
          `Pending transition: ${run.graph.pendingTransition.action} -> ${run.graph.pendingTransition.targetNode || "stay"}`
        );
        this.pushLog(`Reason: ${run.graph.pendingTransition.reason}`);
      }
      return { ok: true };
    }

    if (sub === "review") {
      return this.handleAgentReview(args.slice(1).join(" ").trim() || undefined, abortSignal);
    }

    if (sub === "collect") {
      return this.handleAgentCollect(args.slice(1), abortSignal);
    }

    if (sub === "recollect") {
      const countRaw = args[1];
      const additional = Number(countRaw);
      if (!countRaw || !Number.isFinite(additional) || additional <= 0) {
        this.pushLog("Usage: /agent recollect <additional_count> [run]");
        return { ok: false, reason: "invalid additional count for /agent recollect" };
      }
      const runQuery = args.slice(2).join(" ").trim() || undefined;
      const collectArgs = ["--additional", String(Math.max(1, Math.floor(additional)))];
      if (runQuery) {
        collectArgs.push("--run", runQuery);
      }
      return this.handleAgentCollect(collectArgs, abortSignal, true);
    }

    if (sub === "count") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent count <node> [run]");
        return { ok: false, reason: "invalid node for /agent count" };
      }
      const run = await this.resolveTargetRun(args.slice(2).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      for (const line of await this.countNodeArtifacts(run, nodeRaw)) {
        this.pushLog(line);
      }
      return { ok: true };
    }

    if (sub === "clear") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent clear <node> [run]");
        return { ok: false, reason: "invalid node for /agent clear" };
      }
      const run = await this.resolveTargetRun(args.slice(2).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      if (run.status === "running") {
        this.pushLog("Cannot clear node artifacts while the target run is still running. Stop or pause the run first.");
        return { ok: false, reason: "target run is currently running" };
      }
      const removed = await this.clearNodeArtifacts(run, nodeRaw);
      await this.resetRunFromNode(run.id, nodeRaw, `clear ${nodeRaw}`);
      await this.setActiveRunId(run.id);
      this.pushLog(`Cleared ${nodeRaw} artifacts: ${removed} item(s).`);
      this.pushLog(`Run reset from ${nodeRaw} (pending).`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "clear_papers") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      if (run.status === "running") {
        this.pushLog("Cannot clear paper artifacts while the target run is still running. Stop or pause the run first.");
        return { ok: false, reason: "target run is currently running" };
      }
      const removed = await this.clearNodeArtifacts(run, "collect_papers");
      await this.resetRunFromNode(run.id, "collect_papers", "clear collect_papers");
      await this.setActiveRunId(run.id);
      this.pushLog(`Cleared paper artifacts: ${removed} file(s).`);
      this.pushLog("Run reset to collect_papers (pending).");
      this.pushLog("collect_papers corpus artifacts were removed. Use /agent clear analyze_papers if you only want to rerun analysis on the existing corpus.");
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "focus") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent focus <node>");
        return { ok: false, reason: "invalid node for /agent focus" };
      }
      const run = await this.resolveTargetRun(undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      await this.orchestrator.jumpToNode(run.id, nodeRaw, "safe", "focus command");
      this.pushLog(`Focused current node to ${nodeRaw}.`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "graph") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      const graph = await this.orchestrator.getGraphStatus(run.id);
      this.pushLog(`Graph checkpointSeq=${graph.checkpointSeq} current=${graph.currentNode}`);
      for (const node of AGENT_ORDER) {
        this.pushLog(`- ${node}: ${graph.nodeStates[node].status}`);
      }
      return { ok: true };
    }

    if (sub === "resume") {
      const run = await this.resolveTargetRun(args[1] || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      const checkpoint = args[2] ? Number(args[2]) : undefined;
      await this.orchestrator.resumeRun(run.id, Number.isFinite(checkpoint ?? NaN) ? checkpoint : undefined);
      this.pushLog(`Resumed run ${run.id}${checkpoint ? ` from checkpoint ${checkpoint}` : ""}.`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "retry") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      const run = await this.resolveTargetRun(args.slice(2).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      const node = nodeRaw && AGENT_ORDER.includes(nodeRaw) ? nodeRaw : undefined;
      const updated = await this.orchestrator.retryCurrent(run.id, node);
      this.pushLog(`Retry armed for ${updated.currentNode}.`);
      await this.refreshRunIndex();
      const continued = await this.orchestrator.runCurrentAgentWithOptions(run.id, { abortSignal });
      await this.refreshRunIndex();
      await this.setActiveRunId(continued.run.id);
      if (continued.result.status === "failure") {
        const failure = continued.result.error || continued.result.summary || "run failed";
        this.pushLog(`Research stopped: ${oneLine(failure)}`);
        return { ok: false, reason: failure };
      }
      this.pushLog(`Research continued: ${oneLine(continued.result.summary)}`);
      return { ok: true };
    }

    if (sub === "jump") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent jump <node> [run] [--force]");
        return { ok: false, reason: "invalid node for /agent jump" };
      }
      const force = args.includes("--force");
      const runQuery = args.slice(2).filter((value) => value !== "--force").join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      await this.orchestrator.jumpToNode(run.id, nodeRaw, force ? "force" : "safe", "manual jump command");
      this.pushLog(`Jumped to ${nodeRaw} (${force ? "force" : "safe"}).`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "transition") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      const recommendation = run.graph.pendingTransition;
      if (!recommendation) {
        this.pushLog("No pending transition recommendation.");
        return { ok: true };
      }
      this.pushLog(
        `Transition: ${recommendation.action} -> ${recommendation.targetNode || "stay"} (confidence ${recommendation.confidence})`
      );
      this.pushLog(`Reason: ${recommendation.reason}`);
      for (const evidence of recommendation.evidence) {
        this.pushLog(`- ${evidence}`);
      }
      return { ok: true };
    }

    if (sub === "apply") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      const recommendation = run.graph.pendingTransition;
      const updated = await this.orchestrator.applyPendingTransition(run.id);
      this.pushLog(
        recommendation
          ? `Applied transition ${recommendation.action} -> ${recommendation.targetNode || "stay"}.`
          : "No pending transition recommendation to apply."
      );
      this.pushLog(`Current node is ${updated.currentNode}.`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "overnight") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      this.pushLog("Starting autonomy preset: overnight (default safe policy).");
      const controller = new AutonomousRunController(this.runStore, this.orchestrator, this.eventStream);
      const outcome = await controller.runOvernight(run.id, buildDefaultOvernightPolicy(), { abortSignal });
      this.pushLog(`Overnight autonomy ${outcome.status}: ${outcome.reason}`);
      this.pushLog(
        `Iterations=${outcome.iterations}, approvals=${outcome.approvalsApplied}, transitions=${outcome.transitionsApplied}`
      );
      await this.refreshRunIndex();
      return { ok: outcome.status !== "failed", reason: outcome.status === "failed" ? outcome.reason : undefined };
    }

    if (sub === "autonomous") {
      const run = await this.resolveTargetRun(args.slice(1).join(" ").trim() || undefined);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      this.pushLog("Starting autonomous mode: long-running open-ended research exploration.");
      this.pushLog("No runtime time limit. Explores many hypothesis/experiment cycles.");
      this.pushLog("Upgrades the strongest paper candidate while gating write_paper on evidence quality.");
      this.pushLog("Stops on: user stop (Ctrl+C), emergency fuse, or sustained stagnation.");
      this.pushLog("Progress is written to .autolabos/runs/<id>/RUN_STATUS.md");
      const controller = new AutonomousRunController(this.runStore, this.orchestrator, this.eventStream);
      const policy = buildDefaultAutonomousPolicy();
      const outcome = await controller.runAutonomous(run.id, policy, { abortSignal });
      this.pushLog(`Autonomous mode ${outcome.status}: ${outcome.reason}`);
      this.pushLog(
        `Cycles=${outcome.researchCycles || 0}, iterations=${outcome.iterations}, ` +
        `approvals=${outcome.approvalsApplied}, transitions=${outcome.transitionsApplied}`
      );
      if (outcome.stopReason) {
        this.pushLog(`Stop reason: ${outcome.stopReason}`);
      }
      if (outcome.bestBranch) {
        this.pushLog(`Best branch: ${outcome.bestBranch.hypothesis} (${outcome.bestBranch.manuscriptType})`);
        if (outcome.bestBranch.evidenceGaps.length > 0) {
          this.pushLog(`Evidence gaps: ${outcome.bestBranch.evidenceGaps.join(", ")}`);
        }
      }
      if (outcome.paperStatus) {
        this.pushLog(`Paper status: ${outcome.paperStatus}`);
      }
      await this.refreshRunIndex();
      return { ok: outcome.status !== "failed", reason: outcome.status === "failed" ? outcome.reason : undefined };
    }

    this.pushLog(
      "Usage: /agent list | run | status | review | collect | recollect | clear | count | clear_papers | focus | graph | resume | retry | jump | transition | apply | overnight | autonomous"
    );
    return { ok: false, reason: `unknown /agent subcommand ${sub}` };
  }

  private async handleAgentCollect(
    rawArgs: string[],
    abortSignal?: AbortSignal,
    fromRecollectAlias = false
  ): Promise<SlashExecutionResult> {
    const parsed = parseCollectArgs(rawArgs);
    if (!parsed.ok || !parsed.request) {
      for (const error of parsed.errors) {
        this.pushLog(`Collect option error: ${error}`);
      }
      this.pushLog(parsed.usage || COLLECT_USAGE);
      return { ok: false, reason: parsed.errors[0] || "invalid collect options" };
    }

    const request = parsed.request;
    for (const warning of request.warnings) {
      this.pushLog(`Collect option warning: ${warning}`);
    }
    const run = await this.resolveTargetRun(request.runQuery?.trim() || undefined);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }

    await this.setActiveRunId(run.id);

    const corpusCount = await this.readCorpusCount(run.id);
    const configuredLimit = Math.max(1, this.config.papers.max_results);
    const fetchCount = request.additional ? corpusCount + request.additional : request.limit ?? configuredLimit;
    const targetTotal = request.additional ? corpusCount + request.additional : fetchCount;
    const query = request.query?.trim() || run.topic;
    const filters = normalizeCollectFiltersForNode(request);
    const endpoint = request.sort.field === "relevance" ? "/paper/search" : "/paper/search/bulk";
    const nodeRequest = {
      query,
      limit: fetchCount,
      additional: request.additional,
      sort: request.sort,
      filters,
      bibtexMode: request.bibtexMode
    };

    if (request.dryRun) {
      this.pushLog("Collect dry-run plan:");
      this.pushLog(`- run: ${run.id} (${run.title})`);
      this.pushLog(`- query: ${query}`);
      this.pushLog(`- fetch_count: ${fetchCount}`);
      this.pushLog(`- target_total: ${targetTotal} (current ${corpusCount})`);
      this.pushLog(`- endpoint: ${endpoint}`);
      this.pushLog(`- sort: ${request.sort.field}:${request.sort.order}`);
      this.pushLog(`- bibtex: ${request.bibtexMode}`);
      this.pushLog(`- filters: ${JSON.stringify(filters)}`);
      return { ok: true };
    }

    const runContext = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
    await runContext.put("collect_papers.request", nodeRequest);
    await runContext.put("collect_papers.requested_limit", fetchCount);

    await this.orchestrator.jumpToNode(
      run.id,
      "collect_papers",
      "safe",
      fromRecollectAlias ? `recollect +${request.additional ?? 0}` : "collect command"
    );

    this.pushLog(
      request.additional
        ? `Moving to collect_papers and requesting +${request.additional} papers (target total ${targetTotal}).`
        : `Moving to collect_papers with target total ${targetTotal}.`
    );
    if (shouldUseConservativeCollectPacing(request, fetchCount, !this.semanticScholarApiKeyConfigured)) {
      this.pushLog("Large or filtered collect request detected. Using smaller Semantic Scholar chunks to reduce rate limits.");
    }

    const response = await this.orchestrator.runAgentWithOptions(run.id, "collect_papers", { abortSignal });
    await this.refreshRunIndex();
    if (this.wasAgentRunCanceled(response.run, "collect_papers")) {
      throw new Error("Operation aborted by user");
    }
    if (response.result.status === "failure") {
      this.pushLog(`collect_papers failed: ${response.result.error || "unknown error"}`);
      return { ok: false, reason: response.result.error || "collect_papers failed" };
    }
    this.pushLog(`collect_papers finished: ${oneLine(response.result.summary)}`);
    const refreshedRun = (await this.runStore.getRun(run.id)) ?? response.run;
    if (this.shouldAutoContinueAfterCollectRecovery(refreshedRun)) {
      const continued = await this.orchestrator.runCurrentAgentWithOptions(run.id, { abortSignal });
      await this.refreshRunIndex();
      await this.setActiveRunId(continued.run.id);
      if (continued.result.status === "failure") {
        const failure = continued.result.error || continued.result.summary || "run failed";
        this.pushLog(`Research stopped: ${oneLine(failure)}`);
        return { ok: false, reason: failure };
      }
      this.pushLog(`Research continued: ${oneLine(continued.result.summary)}`);
    }
    return { ok: true };
  }

  private async handleApprove(): Promise<SlashExecutionResult> {
    const run = await this.resolveTargetRun(undefined);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }
    const state = run.graph.nodeStates[run.currentNode];
    if (state.status !== "needs_approval") {
      if (run.status === "paused") {
        this.pushLog("No pending approval. Use /retry to rerun the current node, or add steering to revise the next move.");
      } else {
        this.pushLog(`No pending approval for ${run.currentNode}.`);
      }
      await this.refreshRunIndex();
      return { ok: false, reason: "no pending approval" };
    }
    if (run.currentNode === "analyze_papers") {
      const runContext = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
      const summaryCount = toFiniteNumber(await runContext.get("analyze_papers.summary_count")) ?? 0;
      const evidenceCount = toFiniteNumber(await runContext.get("analyze_papers.evidence_count")) ?? 0;
      if (evidenceCount <= 0) {
        this.pushLog(
          `analyze_papers has no persisted evidence yet (summaries=${summaryCount}, evidence=${evidenceCount}). Use /retry to rerun analysis before approving.`
        );
        await this.refreshRunIndex();
        return { ok: false, reason: "analyze evidence missing" };
      }
    }
    const updated = await this.orchestrator.approveCurrent(run.id);
    if (
      run.currentNode === "review" &&
      updated.currentNode === "review" &&
      updated.graph.nodeStates.review.status === "needs_approval" &&
      updated.graph.pendingTransition?.action === "pause_for_human"
    ) {
      this.pushLog("Review remains blocked. Use /agent transition or follow the suggested jump command.");
    } else {
      this.pushLog(updated.status === "completed" ? "Run completed." : `Approved ${run.currentNode}. Next node is ${updated.currentNode}.`);
    }
    await this.refreshRunIndex();
    return { ok: true };
  }

  private async handleAgentReview(
    runQuery?: string,
    abortSignal?: AbortSignal
  ): Promise<SlashExecutionResult> {
    const run = await this.resolveTargetRun(runQuery);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }

    if (AGENT_ORDER.indexOf(run.currentNode) < AGENT_ORDER.indexOf("analyze_results")) {
      this.pushLog("Review is only available after analyze_results has produced a report.");
      return { ok: false, reason: "review not available yet" };
    }

    await this.setActiveRunId(run.id);
    let workingRun = run;
    const packetPath = path.join(this.workspaceRoot, ".autolabos", "runs", run.id, "review", "review_packet.json");

    if (workingRun.currentNode === "analyze_results") {
      const analyzeState = workingRun.graph.nodeStates.analyze_results;
      if (analyzeState.status === "needs_approval") {
        workingRun = await this.orchestrator.approveCurrent(workingRun.id);
        await this.refreshRunIndex();
        if (workingRun.currentNode !== "review") {
          this.pushLog(`Approved analyze_results. Next node is ${workingRun.currentNode}.`);
          return { ok: false, reason: `review not available after approval: ${workingRun.currentNode}` };
        }
        this.pushLog("Approved analyze_results and moved into review.");
      }
    }

    const packetBeforeRun = parseReviewPacket(await safeRead(packetPath));
    const reviewState = workingRun.graph.nodeStates.review;
    const shouldRunReview =
      workingRun.currentNode === "review" &&
      (!packetBeforeRun || reviewState.status === "pending" || reviewState.status === "failed");

    if (shouldRunReview) {
      const response = await this.orchestrator.runAgentWithOptions(workingRun.id, "review", { abortSignal });
      await this.refreshRunIndex();
      if (this.wasAgentRunCanceled(response.run, "review")) {
        throw new Error("Operation aborted by user");
      }
      if (response.result.status === "failure") {
        this.pushLog(`review failed: ${response.result.error || "unknown error"}`);
        return { ok: false, reason: response.result.error || "review failed" };
      }
      workingRun = response.run;
      this.pushLog(`review finished: ${oneLine(response.result.summary)}`);
    }

    const packet = parseReviewPacket(await safeRead(packetPath));
    if (!packet) {
      this.pushLog("No review packet is available yet.");
      return { ok: false, reason: "review packet missing" };
    }

    for (const line of formatReviewPacketLines(packet)) {
      this.pushLog(line);
    }
    await this.refreshActiveRunInsight();
    this.notify();
    return { ok: true };
  }

  private async handleRetry(): Promise<SlashExecutionResult> {
    const run = await this.resolveTargetRun(undefined);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }
    const updated = await this.orchestrator.retryCurrent(run.id);
    this.pushLog(`Retry set for node ${updated.currentNode}.`);
    await this.refreshRunIndex();
    const continued = await this.orchestrator.runCurrentAgentWithOptions(run.id);
    await this.refreshRunIndex();
    await this.setActiveRunId(continued.run.id);
    if (continued.result.status === "failure") {
      const failure = continued.result.error || continued.result.summary || "run failed";
      this.pushLog(`Research stopped: ${oneLine(failure)}`);
      return { ok: false, reason: failure };
    }
    this.pushLog(`Research continued: ${oneLine(continued.result.summary)}`);
    return { ok: true };
  }

  private getNaturalAssistantClient(): {
    runForText: (opts: {
      prompt: string;
      sandboxMode?: string;
      approvalPolicy?: string;
      threadId?: string;
      systemPrompt?: string;
      reasoningEffort?: string;
      abortSignal?: AbortSignal;
    }) => Promise<string>;
    runTurnStream?: CodexCliClient["runTurnStream"];
  } {
    if (this.config.providers.llm_mode === "openai_api" && this.openAiTextClient) {
      return {
        runForText: async (opts) =>
          this.openAiTextClient!.runForText({
            prompt: opts.prompt,
            systemPrompt: opts.systemPrompt,
            abortSignal: opts.abortSignal,
            model: this.config.providers.openai.chat_model || this.config.providers.openai.model,
            reasoningEffort:
              this.config.providers.openai.chat_reasoning_effort ||
              this.config.providers.openai.command_reasoning_effort
          })
      };
    }
    if (this.config.providers.llm_mode === "ollama") {
      const ollamaClient = new OllamaClient(
        this.config.providers.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL
      );
      const ollamaLlm = new OllamaLLMClient(ollamaClient, {
        model:
          this.config.providers.ollama?.chat_model ||
          this.config.providers.ollama?.research_model ||
          DEFAULT_OLLAMA_CHAT_MODEL
      });
      return {
        runForText: async (opts) =>
          (
            await ollamaLlm.complete(opts.prompt, {
              systemPrompt: opts.systemPrompt,
              abortSignal: opts.abortSignal
            })
          ).text
      };
    }
    const codexRunTurnStream = this.codex.runTurnStream.bind(this.codex);
    return {
      runForText: async (opts) =>
        (
          await codexRunTurnStream({
            prompt: opts.prompt,
            sandboxMode: (opts.sandboxMode || "read-only") as
              | "read-only"
              | "workspace-write"
              | "danger-full-access",
            approvalPolicy: (opts.approvalPolicy || "never") as "never" | "on-request" | "on-failure" | "untrusted",
            systemPrompt: opts.systemPrompt,
            reasoningEffort:
              ((opts.reasoningEffort as string | undefined) ||
                this.config.providers.codex.chat_reasoning_effort ||
                this.config.providers.codex.command_reasoning_effort) as never,
            model: this.config.providers.codex.chat_model || this.config.providers.codex.model,
            fastMode: this.config.providers.codex.chat_fast_mode,
            abortSignal: opts.abortSignal
          })
        ).finalText,
      runTurnStream: codexRunTurnStream
    };
  }

  private getCommandIntentClient(): {
    runForText: (opts: {
      prompt: string;
      sandboxMode?: string;
      approvalPolicy?: string;
      threadId?: string;
      systemPrompt?: string;
      reasoningEffort?: string;
      abortSignal?: AbortSignal;
    }) => Promise<string>;
  } {
    if (this.config.providers.llm_mode === "openai_api" && this.openAiTextClient) {
      const reasoningEffort =
        this.config.providers.openai.chat_reasoning_effort ||
        this.config.providers.openai.command_reasoning_effort ||
        this.config.providers.openai.reasoning_effort;
      return {
        runForText: async (opts) =>
          this.openAiTextClient!.runForText({
            prompt: opts.prompt,
            systemPrompt: opts.systemPrompt,
            abortSignal: opts.abortSignal,
            model: this.config.providers.openai.chat_model || this.config.providers.openai.model,
            reasoningEffort
          })
      };
    }
    if (this.config.providers.llm_mode === "ollama") {
      const ollamaClient = new OllamaClient(
        this.config.providers.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL
      );
      const ollamaLlm = new OllamaLLMClient(ollamaClient, {
        model:
          this.config.providers.ollama?.chat_model ||
          this.config.providers.ollama?.research_model ||
          DEFAULT_OLLAMA_CHAT_MODEL
      });
      return {
        runForText: async (opts) =>
          (
            await ollamaLlm.complete(opts.prompt, {
              systemPrompt: opts.systemPrompt,
              abortSignal: opts.abortSignal
            })
          ).text
      };
    }
    const reasoningEffort =
      this.config.providers.codex.chat_reasoning_effort ||
      this.config.providers.codex.command_reasoning_effort ||
      this.config.providers.codex.reasoning_effort;
    return {
      runForText: async (opts) =>
        (
          await this.codex.runTurnStream({
            prompt: opts.prompt,
            sandboxMode: (opts.sandboxMode || "read-only") as
              | "read-only"
              | "workspace-write"
              | "danger-full-access",
            approvalPolicy: (opts.approvalPolicy || "never") as "never" | "on-request" | "on-failure" | "untrusted",
            systemPrompt: opts.systemPrompt,
            reasoningEffort: reasoningEffort as never,
            model: this.config.providers.codex.chat_model || this.config.providers.codex.model,
            fastMode: this.config.providers.codex.chat_fast_mode,
            abortSignal: opts.abortSignal
          })
        ).finalText
    };
  }

  private async resolveTargetRun(explicitQuery?: string): Promise<RunRecord | undefined> {
    if (explicitQuery) {
      const runs = await this.runStore.listRuns();
      const byQuery = resolveRunByQuery(runs, explicitQuery);
      if (!byQuery) {
        this.pushLog(`Run not found: ${explicitQuery}`);
        return undefined;
      }
      return (await this.runStore.getRun(byQuery.id)) ?? byQuery;
    }
    if (!this.activeRunId) {
      this.pushLog("No active run. Use the new run form or /run <run>.");
      return undefined;
    }
    const active = await this.runStore.getRun(this.activeRunId);
    if (!active) {
      this.pushLog(`Active run not found: ${this.activeRunId}`);
      return undefined;
    }
    return active;
  }

  private getActiveIndexedRun(): RunRecord | undefined {
    if (this.activeRunId) {
      return this.runIndex.find((run) => run.id === this.activeRunId) || this.runIndex[0];
    }
    return this.runIndex[0];
  }

  private resolveWorkspacePath(maybeRelative: string): string {
    if (path.isAbsolute(maybeRelative)) {
      return maybeRelative;
    }
    return path.join(this.workspaceRoot, maybeRelative);
  }

  private armPendingNaturalCommands(
    sourceInput: string,
    commands: string[],
    options?: {
      stepIndex?: number;
      totalSteps?: number;
      continuation?: boolean;
      presentation?: "default" | "collect_replan_summary";
      displayCommands?: string[];
    }
  ): void {
    const normalizedCommands = commands.map((command) => command.trim()).filter(Boolean);
    if (normalizedCommands.length === 0) {
      return;
    }
    this.pendingNaturalCommand = {
      command: normalizedCommands[0],
      commands: normalizedCommands,
      displayCommands: options?.displayCommands?.slice(0, normalizedCommands.length),
      sourceInput,
      createdAt: new Date().toISOString(),
      stepIndex: options?.stepIndex ?? 0,
      totalSteps: options?.totalSteps ?? normalizedCommands.length,
      presentation: options?.presentation ?? "default"
    };
    const displayCommands = this.resolvePendingDisplayCommands(this.pendingNaturalCommand);
    if (this.pendingNaturalCommand.totalSteps === 1) {
      if (displayCommands[0] && displayCommands[0] !== this.pendingNaturalCommand.command) {
        this.pushLog(`Resolved slash command: ${this.pendingNaturalCommand.command}`);
      }
      this.pushLog(`Execution intent detected. Pending command: ${displayCommands[0]}`);
      this.pushLog("Type 'y' to run now, or 'n' to cancel.");
      return;
    }

    if (options?.continuation) {
      this.pushLog(
        `Type 'y' to run step ${this.pendingNaturalCommand.stepIndex + 1}/${this.pendingNaturalCommand.totalSteps}, 'a' to run all remaining steps, or 'n' to cancel the remaining plan.`
      );
      this.notify();
      return;
    }

    this.pushLog(`Execution plan detected. Pending ${this.pendingNaturalCommand.totalSteps}-step plan:`);
    displayCommands.forEach((command, index) => {
      this.pushLog(`- [${this.pendingNaturalCommand!.stepIndex + index + 1}/${this.pendingNaturalCommand!.totalSteps}] ${command}`);
    });
    this.pushLog(
      `Type 'y' to run step ${this.pendingNaturalCommand.stepIndex + 1}/${this.pendingNaturalCommand.totalSteps}, 'a' to run all remaining steps, or 'n' to cancel the plan.`
    );
    this.notify();
  }

  private buildPendingPlanReminderLine(pending: PendingNaturalCommandState): string {
    return `Pending plan from step ${pending.stepIndex + 1}/${pending.totalSteps}: ${this.describePendingNaturalCommands(pending)}`;
  }

  private describePendingNaturalCommands(pending: PendingNaturalCommandState): string {
    const displayCommands = this.resolvePendingDisplayCommands(pending);
    return displayCommands.length <= 1 ? displayCommands[0] ?? "" : displayCommands.join(" -> ");
  }

  private resolvePendingDisplayCommands(pending: Pick<PendingNaturalCommandState, "commands" | "displayCommands">): string[] {
    return pending.commands.map((command, index) => pending.displayCommands?.[index] ?? command);
  }

  private async setActiveRunId(runId?: string): Promise<void> {
    this.activeRunId = runId;
    await this.replayPersistedRunEvents(runId);
    await this.refreshActiveRunInsight();
    this.notify();
  }

  private async replayPersistedRunEvents(runId?: string): Promise<void> {
    if (!runId) {
      return;
    }
    const events = readPersistedRunEvents({
      runsDir: path.join(this.workspaceRoot, ".autolabos", "runs"),
      runId,
      limit: 40
    });
    for (const event of events) {
      if (!this.rememberEventId(event.id)) {
        continue;
      }
      const line = formatEventLog(event);
      if (!line) {
        continue;
      }
      this.pushReplayLog(line);
    }
  }

  private rememberEventId(eventId: string): boolean {
    if (this.seenEventIds.has(eventId)) {
      return false;
    }
    this.seenEventIds.add(eventId);
    return true;
  }

  private async refreshActiveRunInsight(): Promise<void> {
    if (!this.activeRunId) {
      this.activeRunInsight = undefined;
      return;
    }

    const runDir = path.join(this.workspaceRoot, ".autolabos", "runs", this.activeRunId);
    try {
      const run = await this.runStore.getRun(this.activeRunId);
      if (run?.currentNode === "write_paper") {
        const manuscriptQualityInsight = await loadManuscriptQualityInsightCard({
          runDir,
          readText: safeRead
        });
        if (manuscriptQualityInsight) {
          this.activeRunInsight = manuscriptQualityInsight;
          return;
        }
      }
      const reviewPacket = parseReviewPacket(await safeRead(path.join(runDir, "review", "review_packet.json")));
      if (shouldSurfaceReviewInsight(run?.currentNode) && reviewPacket) {
        this.activeRunInsight = buildReviewInsightCard(reviewPacket);
        return;
      }
      const report = shouldSurfaceAnalyzeResultsInsight(run?.currentNode)
        ? parseAnalysisReport(await safeRead(path.join(runDir, "result_analysis.json")))
        : undefined;
      if (report) {
        this.activeRunInsight = buildAnalyzeResultsInsightCard(report);
        return;
      }
      this.activeRunInsight = shouldSurfaceReviewInsight(run?.currentNode) && reviewPacket
        ? buildReviewInsightCard(reviewPacket)
        : undefined;
    } catch {
      this.activeRunInsight = undefined;
    }
  }

  private startThinking(): void {
    this.thinking = true;
    this.notify();
  }

  private stopThinking(): void {
    this.thinking = false;
    this.notify();
  }

  private describeBusyLabelForSlash(command: string, args: string[]): string {
    if (command === "agent") {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "collect" || sub === "recollect") {
        return "Collecting...";
      }
      if (sub === "review") {
        return "Preparing review...";
      }
      if (sub === "run" && isGraphNodeId(args[1])) {
        return describeNodeActivity(args[1]);
      }
    }
    if (command === "title") {
      return "Updating title...";
    }
    return `/${command}`;
  }

  private async readCorpusCount(runId: string): Promise<number> {
    const insights = await this.readCorpusInsights(runId);
    return insights.totalPapers;
  }

  private async readCorpusInsights(runId: string): Promise<CorpusInsights> {
    const filePath = path.join(this.workspaceRoot, ".autolabos", "runs", runId, "corpus.jsonl");
    try {
      const stat = await fs.stat(filePath);
      const cache = this.corpusInsightsCache.get(runId);
      if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
        return cache.insights;
      }
      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
      const insights: CorpusInsights = { totalPapers: lines.length, missingPdfCount: 0, titles: [] };
      let bestCitation = -1;
      for (const line of lines) {
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          const title = toNonEmptyString(row.title);
          if (title && insights.titles.length < 200) {
            insights.titles.push(title);
          }
          const pdfPath =
            toNonEmptyString(row.pdf_url) ||
            toNonEmptyString(row.open_access_pdf_url) ||
            readNestedUrl(row.open_access_pdf);
          const canonicalUrl = toNonEmptyString(row.url);
          const hasPdf = Boolean(pdfPath) || looksLikePdfUrl(canonicalUrl);
          if (!hasPdf) {
            insights.missingPdfCount += 1;
          }
          const citation = toFiniteNumber(row.citation_count ?? row.citationCount);
          if (title && citation !== undefined && citation > bestCitation) {
            bestCitation = citation;
            insights.topCitation = { title, citationCount: citation };
          }
        } catch {
          insights.missingPdfCount += 1;
        }
      }
      this.corpusInsightsCache.set(runId, { mtimeMs: stat.mtimeMs, size: stat.size, insights });
      return insights;
    } catch {
      return { totalPapers: 0, missingPdfCount: 0, titles: [] };
    }
  }

  private async clearNodeArtifacts(run: RunRecord, node: GraphNodeId): Promise<number> {
    const runDir = path.join(this.workspaceRoot, ".autolabos", "runs", run.id);
    const targets = resetArtifactTargets(node);
    let removed = 0;
    for (const relative of targets) {
      const fullPath = path.join(runDir, relative);
      try {
        const stat = await fs.stat(fullPath).catch(() => undefined);
        await fs.rm(fullPath, { force: true, recursive: stat?.isDirectory() || false });
        removed += 1;
      } catch {
        // ignore
      }
    }
    const runContext = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
    for (const key of await resolveResetContextKeys(runContext, node)) {
      await runContext.put(key, null);
    }
    return removed;
  }

  private async resetRunFromNode(runId: string, node: GraphNodeId, reason: string): Promise<void> {
    const run = await this.runStore.getRun(runId);
    if (!run) {
      return;
    }
    const targetIdx = AGENT_ORDER.indexOf(node);
    if (targetIdx < 0) {
      return;
    }
    const now = new Date().toISOString();
    run.currentNode = node;
    run.graph.currentNode = node;
    run.status = "paused";
    run.latestSummary = `Artifacts cleared for ${node}; ready to rerun.`;
    for (let index = targetIdx; index < AGENT_ORDER.length; index += 1) {
      const nodeId = AGENT_ORDER[index];
      run.graph.nodeStates[nodeId] = {
        ...run.graph.nodeStates[nodeId],
        status: "pending",
        updatedAt: now,
        note: `Reset by ${reason}`,
        lastError: undefined
      };
      delete run.graph.retryCounters[nodeId];
      delete run.graph.rollbackCounters[nodeId];
      delete run.nodeThreads[nodeId];
    }
    await this.runStore.updateRun(run);
  }

  private async countNodeArtifacts(run: RunRecord, node: GraphNodeId): Promise<string[]> {
    const runDir = path.join(this.workspaceRoot, ".autolabos", "runs", run.id);
    switch (node) {
      case "collect_papers":
        return [`Count(${node}): ${await countJsonl(path.join(runDir, "corpus.jsonl"))} papers`];
      case "analyze_papers": {
        const evidence = await countJsonl(path.join(runDir, "evidence_store.jsonl"));
        const summaries = await countJsonl(path.join(runDir, "paper_summaries.jsonl"));
        const selection = await readAnalyzeSelectionCount(path.join(runDir, "analysis_manifest.json"));
        return [
          selection
            ? `Count(${node}): ${evidence} evidences, ${summaries} summaries, selected ${selection.selected}/${selection.total}`
            : `Count(${node}): ${evidence} evidences, ${summaries} summaries`
        ];
      }
      case "generate_hypotheses":
        return [`Count(${node}): ${await countJsonl(path.join(runDir, "hypotheses.jsonl"))} hypotheses`];
      case "design_experiments":
        return [`Count(${node}): ${await countYamlList(path.join(runDir, "experiment_plan.yaml"), "hypotheses:")} planned hypotheses`];
      case "implement_experiments":
        return [`Count(${node}): ${(await pathExists(path.join(runDir, "experiment.py"))) ? 1 : 0} implementation file`];
      case "run_experiments":
        return [`Count(${node}): ${await countJsonl(path.join(runDir, "exec_logs", "observations.jsonl"))} execution logs, metrics ${(await pathExists(path.join(runDir, "metrics.json"))) ? "present" : "missing"}`];
      case "analyze_results": {
        const figures = await countDirFiles(path.join(runDir, "figures"));
        const metricsPresent = await pathExists(path.join(runDir, "metrics.json"));
        const report = parseAnalysisReport(await safeRead(path.join(runDir, "result_analysis.json")));
        return formatAnalyzeResultsArtifactLines({
          figureCount: figures,
          metricsPresent,
          report
        });
      }
      case "review": {
        const reviewFiles = [
          "review/review_packet.json",
          "review/checklist.md",
          "review/findings.jsonl",
          "review/scorecard.json",
          "review/consistency_report.json",
          "review/bias_report.json",
          "review/revision_plan.json",
          "review/decision.json"
        ];
        let count = 0;
        for (const relative of reviewFiles) {
          if (await pathExists(path.join(runDir, relative))) {
            count += 1;
          }
        }
        const packet = parseReviewPacket(await safeRead(path.join(runDir, "review", "review_packet.json")));
        return packet
          ? [`Count(${node}): ${count}/${reviewFiles.length} review artifacts`, ...formatReviewPacketLines(packet)]
          : [`Count(${node}): ${count}/${reviewFiles.length} review artifacts`];
      }
      case "write_paper": {
        const paperFiles = [
          "paper/main.tex",
          "paper/references.bib",
          "paper/manuscript.json",
          "paper/traceability.json",
          "paper/evidence_links.json"
        ];
        let count = 0;
        for (const relative of paperFiles) {
          if (await pathExists(path.join(runDir, relative))) {
            count += 1;
          }
        }
        return [`Count(${node}): ${count}/${paperFiles.length} paper artifacts`];
      }
    }
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function isSlashPrefixed(text: string): boolean {
  return text.startsWith("/") || text.startsWith("／");
}

function normalizeSteeringInput(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed || undefined;
}

function formatEventLog(event: AutoLabOSEvent): string | undefined {
  switch (event.type) {
    case "TOOL_CALLED":
      return `Tool: ${oneLine(String(event.payload.command || event.payload.tool || "unknown"))}`;
    case "PATCH_APPLIED":
      return `Patch: ${oneLine(String(event.payload.file || "workspace updated"))}`;
    case "OBS_RECEIVED":
      return typeof event.payload.text === "string" ? oneLine(event.payload.text) : undefined;
    case "TEST_FAILED":
      return `Test failed: ${oneLine(String(event.payload.stderr || event.payload.error || event.payload.text || "unknown"))}`;
    case "TRANSITION_RECOMMENDED":
      return `Transition recommended: ${oneLine(String(event.payload.action || "unknown"))} -> ${oneLine(String(event.payload.targetNode || "stay"))}`;
    case "TRANSITION_APPLIED":
      return `Transition applied: ${oneLine(String(event.payload.action || "unknown"))} -> ${oneLine(String(event.payload.targetNode || "advance"))}`;
    default:
      return undefined;
  }
}

function isGraphNodeId(value: string | undefined): value is GraphNodeId {
  return Boolean(value) && AGENT_ORDER.includes(value as GraphNodeId);
}

function describeNodeActivity(node: GraphNodeId): string {
  switch (node) {
    case "collect_papers":
      return "Collecting...";
    case "analyze_papers":
      return "Analyzing papers...";
    case "generate_hypotheses":
      return "Generating hypotheses...";
    case "design_experiments":
      return "Designing experiments...";
    case "implement_experiments":
      return "Implementing experiments...";
    case "run_experiments":
      return "Running experiments...";
    case "analyze_results":
      return "Analyzing results...";
    case "review":
      return "Reviewing...";
    case "write_paper":
      return "Writing paper...";
  }
}

function samePendingPlan(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((command, index) => command.trim() === (right[index] || "").trim());
}

function parseTitleCommandArgs(args: string[]): { title: string; runQuery?: string; error?: string } {
  if (args.length === 0) {
    return { title: "", error: "Usage: /title <new title> [--run <run>]" };
  }
  let runQuery: string | undefined;
  const titleParts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--run") {
      runQuery = args[index + 1];
      if (!runQuery) {
        return { title: "", error: "Usage: /title <new title> [--run <run>]" };
      }
      index += 1;
      continue;
    }
    titleParts.push(token);
  }
  const title = sanitizeTitle(titleParts.join(" "));
  if (!title) {
    return { title: "", error: "Usage: /title <new title> [--run <run>]" };
  }
  return { title, runQuery };
}

function sanitizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").slice(0, 120);
}

function extractTitleChangeIntent(text: string): { title: string } | undefined {
  const raw = text.trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  const hasTitleWord = /(?:\btitle\b|제목)/iu.test(raw);
  const hasChangeWord = /바꿔|바꾸|변경|수정|rename|change/u.test(lower);
  if (!hasTitleWord || !hasChangeWord) {
    return undefined;
  }
  const quoted = raw.match(/["'“”‘’]([^"'“”‘’]{1,120})["'“”‘’]/u)?.[1]?.trim();
  if (quoted) {
    const title = sanitizeTitle(quoted);
    if (title) {
      return { title };
    }
  }
  const plain = raw.match(/(?:title|제목).+?(?:to|으로|로)\s+(.+)$/iu)?.[1]?.trim();
  if (!plain) {
    return undefined;
  }
  const title = sanitizeTitle(plain);
  return title ? { title } : undefined;
}

function buildTitleCommand(title: string, runId: string): string {
  const escaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `/title "${escaped}" --run ${runId}`;
}

function isPaperCountIntent(text: string): boolean {
  return /논문|paper|papers/u.test(text) && /몇|개수|갯수|how many|count|number/u.test(text.toLowerCase());
}

function isMissingPdfCountIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /논문|paper|papers/u.test(text) && /pdf|피디에프/u.test(lower) && /없|누락|missing|without|no\s+pdf/u.test(lower);
}

function isTopCitationIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /논문|paper|papers/u.test(text) && /citation|cited|인용|피인용/u.test(lower) && /가장|최고|높|top|highest|max|maximum|most|최다/u.test(lower);
}

function isPaperTitleIntent(text: string): boolean {
  return /논문|paper|papers/u.test(text) && /제목|title|titles|목록|리스트|list/u.test(text.toLowerCase());
}

function extractRequestedTitleCount(text: string): number {
  const match = text.toLowerCase().match(/(\d+)/);
  if (!match?.[1]) {
    return 5;
  }
  return Math.min(20, Math.max(1, Math.floor(Number(match[1]))));
}

function parseAnalyzeRunArgs(args: string[]): { runQuery?: string; topN?: number; error?: string } {
  const runParts: string[] = [];
  let topN: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--top-n") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        return { error: "Usage: /agent run analyze_papers [run] [--top-n <n>]" };
      }
      topN = Math.floor(value);
      index += 1;
      continue;
    }
    runParts.push(token);
  }
  return { runQuery: runParts.join(" ").trim() || undefined, topN };
}

function parseGenerateHypothesesRunArgs(args: string[]): {
  runQuery?: string;
  topK?: number;
  branchCount?: number;
  error?: string;
} {
  const runParts: string[] = [];
  let topK: number | undefined;
  let branchCount: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--top-k") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        return { error: "Usage: /agent run generate_hypotheses [run] [--top-k <n>] [--branch-count <n>]" };
      }
      topK = Math.floor(value);
      index += 1;
      continue;
    }
    if (token === "--branch-count") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 1) {
        return { error: "Usage: /agent run generate_hypotheses [run] [--top-k <n>] [--branch-count <n>]" };
      }
      branchCount = Math.floor(value);
      index += 1;
      continue;
    }
    runParts.push(token);
  }
  if (typeof topK === "number" && typeof branchCount === "number" && branchCount < topK) {
    return { error: "--branch-count must be greater than or equal to --top-k" };
  }
  return { runQuery: runParts.join(" ").trim() || undefined, topK, branchCount };
}

function shouldUseConservativeCollectPacing(
  request: CollectCommandRequest,
  targetTotal: number,
  missingApiKey: boolean
): boolean {
  return (
    targetTotal >= 200 ||
    missingApiKey ||
    request.filters.openAccessPdf === true ||
    (request.filters.publicationTypes?.length ?? 0) > 0 ||
    (request.filters.fieldsOfStudy?.length ?? 0) > 0 ||
    (request.filters.venues?.length ?? 0) > 0 ||
    typeof request.filters.minCitationCount === "number"
  );
}

function determineCollectReplanBatchSize(
  request: CollectCommandRequest,
  missingApiKey: boolean
): number {
  return shouldUseConservativeCollectPacing(request, 200, missingApiKey) ? 50 : 100;
}

function isSemanticScholarRateLimitFailure(message: string | undefined): boolean {
  const value = message || "";
  return Boolean(value) && /semantic scholar/i.test(value) && (/\b429\b/.test(value) || /rate limit/i.test(value));
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function readNestedUrl(value: unknown): string | undefined {
  return value && typeof value === "object" ? toNonEmptyString((value as Record<string, unknown>).url) : undefined;
}

function looksLikePdfUrl(url: string | undefined): boolean {
  const value = url || "";
  return Boolean(value) && /\.pdf($|[?#])/i.test(value);
}

function isAffirmative(text: string): boolean {
  return ["y", "yes", "ok", "okay", "ㅇ", "네", "예", "응"].includes(text);
}

function isRunAllRemainingInput(text: string): boolean {
  return ["a", "all", "run all", "remaining"].includes(text);
}

function isNegative(text: string): boolean {
  return ["n", "no", "cancel", "아니", "아니오", "취소"].includes(text);
}

function nodeArtifactTargets(node: GraphNodeId): string[] {
  switch (node) {
    case "collect_papers":
      return ["corpus.jsonl", "bibtex.bib", "collect_request.json", "collect_result.json", "collect_enrichment.jsonl"];
    case "analyze_papers":
      return ["paper_summaries.jsonl", "evidence_store.jsonl", "analysis_manifest.json", "analysis_cache"];
    case "generate_hypotheses":
      return ["hypotheses.jsonl", "hypothesis_generation"];
    case "design_experiments":
      return ["experiment_plan.yaml"];
    case "implement_experiments":
      return [
        "experiment.py",
        "implement_experiments",
        "implement_result.json",
        "implement_task_spec.json",
        "implement_attempts.json",
        "verify_report.json",
        "localization_search_result.json",
        "long_term_memory_result.json",
        "branch_search_result.json",
        "localization_result.json"
      ];
    case "run_experiments":
      return ["exec_logs", "metrics.json", "objective_evaluation.json", "run_experiments_verify_report.json"];
    case "analyze_results":
      return ["figures", "analysis", "result_analysis.json", "result_analysis_synthesis.json", "transition_recommendation.json"];
    case "review":
      return ["review"];
    case "write_paper":
      return ["paper"];
  }
}

function resetArtifactTargets(node: GraphNodeId): string[] {
  return [...new Set(resetScopeNodes(node).flatMap((nodeId) => nodeArtifactTargets(nodeId)))];
}

async function resolveResetContextKeys(runContext: RunContextMemory, node: GraphNodeId): Promise<string[]> {
  const prefixes = resetContextPrefixes(node);
  if (prefixes.length === 0) {
    return [];
  }
  const existing = await runContext.entries();
  return existing
    .map((item) => item.key)
    .filter((key, index, keys) => prefixes.some((prefix) => key.startsWith(prefix)) && keys.indexOf(key) === index);
}

function nodeContextPrefixes(node: GraphNodeId): string[] {
  switch (node) {
    case "collect_papers":
      return ["collect_papers."];
    case "analyze_papers":
      return ["analyze_papers."];
    case "generate_hypotheses":
      return ["generate_hypotheses."];
    case "design_experiments":
      return ["design_experiments."];
    case "implement_experiments":
      return ["implement_experiments."];
    case "run_experiments":
      return ["run_experiments.", "objective_metric."];
    case "analyze_results":
      return ["analyze_results."];
    case "review":
      return ["review."];
    case "write_paper":
      return ["write_paper."];
    default:
      return [];
  }
}

function resetContextPrefixes(node: GraphNodeId): string[] {
  return [...new Set(resetScopeNodes(node).flatMap((nodeId) => nodeContextPrefixes(nodeId)))];
}

function resetScopeNodes(node: GraphNodeId): GraphNodeId[] {
  const targetIndex = AGENT_ORDER.indexOf(node);
  return targetIndex >= 0 ? AGENT_ORDER.slice(targetIndex) : [node];
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function normalizeCollectFiltersForNode(request: CollectCommandRequest): {
  dateRange?: string;
  year?: string;
  lastYears?: number;
  fieldsOfStudy?: string[];
  venues?: string[];
  publicationTypes?: string[];
  minCitationCount?: number;
  openAccessPdf?: boolean;
} {
  const filters = request.filters || {};
  const normalized: {
    dateRange?: string;
    year?: string;
    lastYears?: number;
    fieldsOfStudy?: string[];
    venues?: string[];
    publicationTypes?: string[];
    minCitationCount?: number;
    openAccessPdf?: boolean;
  } = {};
  if (filters.dateRange) {
    normalized.dateRange = filters.dateRange;
  } else if (filters.year) {
    normalized.year = filters.year;
  } else if (typeof filters.lastYears === "number" && filters.lastYears > 0) {
    normalized.lastYears = Math.floor(filters.lastYears);
  }
  if (filters.fieldsOfStudy?.length) {
    normalized.fieldsOfStudy = filters.fieldsOfStudy;
  }
  if (filters.venues?.length) {
    normalized.venues = filters.venues;
  }
  if (filters.publicationTypes?.length) {
    normalized.publicationTypes = filters.publicationTypes;
  }
  if (typeof filters.minCitationCount === "number") {
    normalized.minCitationCount = filters.minCitationCount;
  }
  if (filters.openAccessPdf) {
    normalized.openAccessPdf = true;
  }
  return normalized;
}

async function countJsonl(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split("\n").map((line) => line.trim()).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function countYamlList(filePath: string, sectionHeader: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split("\n");
    let inSection = false;
    let count = 0;
    for (const line of lines) {
      if (!inSection) {
        if (line.trim() === sectionHeader) {
          inSection = true;
        }
        continue;
      }
      if (/^[a-zA-Z0-9_]+\s*:/.test(line.trim())) {
        break;
      }
      if (line.trim().startsWith("-")) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function countDirFiles(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).length;
  } catch {
    return 0;
  }
}

async function readAnalyzeSelectionCount(manifestPath: string): Promise<{ selected: number; total: number } | undefined> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { selectedPaperIds?: unknown; totalCandidates?: unknown };
    if (!Array.isArray(parsed.selectedPaperIds) || typeof parsed.totalCandidates !== "number") {
      return undefined;
    }
    return {
      selected: parsed.selectedPaperIds.length,
      total: parsed.totalCandidates
    };
  } catch {
    return undefined;
  }
}
