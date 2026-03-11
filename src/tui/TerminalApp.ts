import process from "node:process";
import readline from "node:readline";
import path from "node:path";
import { promises as fs } from "node:fs";

import { AGENT_ORDER, AgentId, AppConfig, GraphNodeId, RunInsightCard, RunRecord, SuggestionItem } from "../types.js";
import { RunStore } from "../core/runs/runStore.js";
import { TitleGenerator } from "../core/runs/titleGenerator.js";
import { CodexCliClient, CodexReasoningEffort } from "../integrations/codex/codexCliClient.js";
import { AutoLabOSEvent, EventStream } from "../core/events.js";
import {
  buildCodexModelSelectionChoices,
  DEFAULT_CODEX_MODEL,
  getCodexModelSelectionDescription,
  getCurrentCodexModelSelectionValue,
  getReasoningEffortChoicesForModel,
  normalizeReasoningEffortForModel,
  resolveCodexModelSelection
} from "../integrations/codex/modelCatalog.js";
import {
  RESPONSES_PDF_MODEL_OPTIONS,
  normalizeResponsesPdfModel
} from "../integrations/openai/pdfModelCatalog.js";
import {
  OPENAI_RESPONSES_MODEL_OPTIONS,
  getOpenAiResponsesReasoningOptions,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "../integrations/openai/modelCatalog.js";
import { buildSuggestions } from "./commandPalette/suggest.js";
import { parseSlashCommand } from "../core/commands/parseSlash.js";
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
import { runDoctor } from "../core/doctor.js";
import { resolveRunByQuery } from "../core/runs/runResolver.js";
import { askLine } from "../utils/prompt.js";
import { ensureDir } from "../utils/fs.js";
import { resolveOpenAiApiKey, upsertEnvVar } from "../config.js";
import { AgentOrchestrator } from "../core/agents/agentOrchestrator.js";
import { AutonomousRunController, buildDefaultOvernightPolicy } from "../core/agents/autonomousRunController.js";
import { RunContextMemory } from "../core/memory/runContextMemory.js";
import { parseAnalysisReport } from "../core/resultAnalysis.js";
import {
  buildReviewInsightCard,
  formatReviewPacketLines,
  parseReviewPacket
} from "../core/reviewPacket.js";
import {
  buildAnalyzeResultsInsightCard,
  formatAnalyzeResultsArtifactLines
} from "../core/resultAnalysisPresentation.js";
import { getAppVersion } from "./version.js";
import { buildAnimatedStatusText, buildFrame, buildThinkingText, RenderFrameOutput, SelectionMenuOption } from "./renderFrame.js";
import { supportsColor } from "./theme.js";
import { OpenAiResponsesTextClient } from "../integrations/openai/responsesTextClient.js";
import { buildContextualGuidance, detectGuidanceLanguageFromText, GuidanceLanguage } from "./contextualGuidance.js";
import {
  AnalyzeProgressState,
  CollectProgressState,
  formatAnalyzeProgressLogLine,
  formatCollectActivityLabel,
  isAnalyzeProgressLog,
  isCollectProgressLog,
  shouldClearAnalyzeProgress,
  shouldClearCollectProgress,
  updateAnalyzeProgressFromLog,
  updateCollectProgressFromLog
} from "./activityStatus.js";
import {
  deleteBackward,
  deleteToLineStart,
  deletePreviousWord,
  insertAtCursor,
  moveCursorLineEnd,
  moveCursorLineStart,
  moveCursorWordLeft,
  moveCursorWordRight
} from "./inputEditing.js";
import {
  COLLECT_USAGE,
  CollectCommandRequest,
  parseCollectArgs
} from "../core/commands/collectOptions.js";

interface TerminalAppDeps {
  config: AppConfig;
  runStore: RunStore;
  titleGenerator: TitleGenerator;
  codex: CodexCliClient;
  openAiTextClient?: OpenAiResponsesTextClient;
  eventStream: EventStream;
  orchestrator: AgentOrchestrator;
  initialRunId?: string;
  semanticScholarApiKeyConfigured: boolean;
  onQuit: () => void;
  saveConfig: (nextConfig: AppConfig) => Promise<void>;
}

interface ActiveNaturalRequest {
  input: string;
  steeringHints: string[];
  abortController: AbortController;
}

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

interface ActiveSelectionMenu {
  title: string;
  options: SelectionMenuOption[];
  selectedIndex: number;
  resolve: (value: string | undefined) => void;
}

interface RunHistoryFile {
  version: 1;
  items: string[];
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

interface HypothesisInsights {
  totalHypotheses: number;
  texts: string[];
}

interface CorpusInsightsCacheEntry {
  mtimeMs: number;
  size: number;
  insights: CorpusInsights;
}

interface SlashExecutionResult {
  ok: boolean;
  reason?: string;
}

export class TerminalApp {
  private readonly config: AppConfig;
  private readonly runStore: RunStore;
  private readonly titleGenerator: TitleGenerator;
  private readonly codex: CodexCliClient;
  private readonly openAiTextClient?: OpenAiResponsesTextClient;
  private readonly eventStream: EventStream;
  private readonly orchestrator: AgentOrchestrator;
  private readonly onQuit: () => void;
  private readonly saveConfigFn: (nextConfig: AppConfig) => Promise<void>;
  private readonly semanticScholarApiKeyConfigured: boolean;
  private readonly appVersion = getAppVersion();
  private readonly colorEnabled = supportsColor();

  private input = "";
  private cursorIndex = 0;
  private commandHistory: string[] = [];
  private historyCursor = -1;
  private historyDraft = "";
  private historyLoadedRunId?: string;
  private logs: string[] = [];
  private suggestions: SuggestionItem[] = [];
  private selectedSuggestion = 0;
  private runIndex: RunRecord[] = [];
  private activeRunId?: string;
  private activeRunInsight?: RunInsightCard;
  private busy = false;
  private thinking = false;
  private thinkingFrame = 0;
  private thinkingTimer?: NodeJS.Timeout;
  private queuedInputs: string[] = [];
  private activeSelectionMenu?: ActiveSelectionMenu;
  private drainingQueuedInputs = false;
  private activeNaturalRequest?: ActiveNaturalRequest;
  private steeringBufferDuringThinking: string[] = [];
  private activeBusyAbortController?: AbortController;
  private activeBusyLabel?: string;
  private collectProgress?: CollectProgressState;
  private analyzeProgress?: AnalyzeProgressState;
  private readonly corpusInsightsCache = new Map<string, CorpusInsightsCacheEntry>();
  private stopped = false;
  private resolver?: () => void;
  private unsubscribeEvents?: () => void;
  private lastRenderedFrame?: RenderFrameOutput;
  private pendingNaturalCommand?: PendingNaturalCommandState;
  private guidanceLanguage: GuidanceLanguage = detectInitialGuidanceLanguage();

  private readonly keypressHandler = (str: string, key: readline.Key) => {
    void this.handleKeypress(str, key);
  };

  constructor(deps: TerminalAppDeps) {
    this.config = deps.config;
    this.runStore = deps.runStore;
    this.titleGenerator = deps.titleGenerator;
    this.codex = deps.codex;
    this.openAiTextClient = deps.openAiTextClient;
    this.eventStream = deps.eventStream;
    this.orchestrator = deps.orchestrator;
    this.activeRunId = deps.initialRunId;
    this.semanticScholarApiKeyConfigured = deps.semanticScholarApiKeyConfigured;
    this.onQuit = deps.onQuit;
    this.saveConfigFn = deps.saveConfig;
  }

  async start(): Promise<void> {
    await this.refreshRunIndex();
    if (this.activeRunId) {
      await this.loadHistoryForRun(this.activeRunId);
    }
    this.unsubscribeEvents = this.eventStream.subscribe((event) => {
      const line = formatEventLog(event);
      if (!line) {
        return;
      }
      this.pushLog(line);
      this.render();
    });
    this.pushLog("Slash command palette is ready. Type /help to see commands.");
    this.attachKeyboard();
    this.render();

    await new Promise<void>((resolve) => {
      this.resolver = resolve;
    });
  }

  private attachKeyboard(): void {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", this.keypressHandler);
  }

  private detachKeyboard(): void {
    process.stdin.off("keypress", this.keypressHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  private async handleKeypress(str: string, key: readline.Key): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (this.activeSelectionMenu) {
      if (key.ctrl && key.name === "c") {
        this.cancelSelectionMenu();
        return;
      }
      if (key.name === "up") {
        this.moveSelectionMenu(-1);
        return;
      }
      if (key.name === "down") {
        this.moveSelectionMenu(1);
        return;
      }
      if (key.name === "return") {
        this.commitSelectionMenu();
        return;
      }
      if (key.name === "escape") {
        this.cancelSelectionMenu();
        return;
      }
      return;
    }

    if (key.ctrl && key.name === "c") {
      if (this.busy) {
        this.cancelCurrentBusyOperation();
        return;
      }
      await this.shutdown();
      return;
    }

    if (key.name === "return") {
      await this.handleEnter();
      return;
    }

    if (isWordDeleteShortcut(str, key)) {
      this.exitHistoryBrowsing();
      const next = deletePreviousWord(this.input, this.cursorIndex);
      this.input = next.input;
      this.cursorIndex = next.cursor;
      this.updateSuggestions();
      this.render();
      return;
    }

    if (isLineDeleteShortcut(str, key)) {
      this.exitHistoryBrowsing();
      const next = deleteToLineStart(this.input, this.cursorIndex);
      this.input = next.input;
      this.cursorIndex = next.cursor;
      this.updateSuggestions();
      this.render();
      return;
    }

    if (key.name === "backspace") {
      this.exitHistoryBrowsing();
      const next = deleteBackward(this.input, this.cursorIndex);
      this.input = next.input;
      this.cursorIndex = next.cursor;
      this.updateSuggestions();
      this.render();
      return;
    }

    if (isWordMoveLeftShortcut(str, key)) {
      this.cursorIndex = moveCursorWordLeft(this.input, this.cursorIndex);
      this.render();
      return;
    }

    if (isWordMoveRightShortcut(str, key)) {
      this.cursorIndex = moveCursorWordRight(this.input, this.cursorIndex);
      this.render();
      return;
    }

    if (isLineMoveLeftShortcut(str, key)) {
      this.cursorIndex = moveCursorLineStart();
      this.render();
      return;
    }

    if (isLineMoveRightShortcut(str, key)) {
      this.cursorIndex = moveCursorLineEnd(this.input);
      this.updateSuggestions();
      this.render();
      return;
    }

    if (key.name === "left") {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      this.render();
      return;
    }

    if (key.name === "right") {
      const len = Array.from(this.input).length;
      this.cursorIndex = Math.min(len, this.cursorIndex + 1);
      this.updateSuggestions();
      this.render();
      return;
    }

    if (key.name === "tab") {
      this.autocompleteSelectedSuggestion();
      this.render();
      return;
    }

    if (key.name === "up") {
      if (this.historyCursor !== -1) {
        if (this.recallPreviousHistory()) {
          this.render();
        }
      } else if (this.suggestions.length > 0) {
        this.exitHistoryBrowsing();
        this.selectedSuggestion =
          (this.selectedSuggestion - 1 + this.suggestions.length) % this.suggestions.length;
        this.previewSelectedSuggestion();
        this.render();
      } else if (this.recallPreviousHistory()) {
        this.render();
      }
      return;
    }

    if (key.name === "down") {
      if (this.historyCursor !== -1) {
        if (this.recallNextHistory()) {
          this.render();
        }
      } else if (this.suggestions.length > 0) {
        this.exitHistoryBrowsing();
        this.selectedSuggestion = (this.selectedSuggestion + 1) % this.suggestions.length;
        this.previewSelectedSuggestion();
        this.render();
      } else if (this.recallNextHistory()) {
        this.render();
      }
      return;
    }

    if (key.name === "escape") {
      if (this.busy) {
        this.cancelCurrentBusyOperation();
        return;
      }
      this.suggestions = [];
      this.selectedSuggestion = 0;
      this.render();
      return;
    }

    if (str && !key.ctrl && !key.meta) {
      this.exitHistoryBrowsing();
      const next = insertAtCursor(this.input, this.cursorIndex, str);
      this.input = next.input;
      this.cursorIndex = next.cursor;
      this.updateSuggestions();
      this.render();
    }
  }

  private updateSuggestions(): void {
    if (!isSlashPrefixed(this.input)) {
      this.suggestions = [];
      this.selectedSuggestion = 0;
      return;
    }

    this.suggestions = buildSuggestions({
      input: normalizeSlashPrefix(this.input),
      activeRunId: this.activeRunId,
      runs: this.runIndex.map((run) => ({
        id: run.id,
        title: run.title,
        currentNode: run.currentNode,
        status: run.status,
        updatedAt: run.updatedAt
      }))
    });

    if (this.selectedSuggestion >= this.suggestions.length) {
      this.selectedSuggestion = 0;
    }
  }

  private autocompleteSelectedSuggestion(): void {
    if (this.suggestions.length > 0) {
      this.exitHistoryBrowsing();
      const suggestion = this.suggestions[this.selectedSuggestion];
      this.input = suggestion.applyValue;
      this.cursorIndex = Array.from(this.input).length;
      this.updateSuggestions();
      return;
    }

    const guidance = this.getContextualGuidance();
    const firstItem = guidance?.items[0];
    if (!firstItem) {
      return;
    }

    this.exitHistoryBrowsing();
    this.input = firstItem.applyValue ?? firstItem.label;
    this.cursorIndex = Array.from(this.input).length;
    this.updateSuggestions();
  }

  private previewSelectedSuggestion(): void {
    if (this.suggestions.length === 0) {
      return;
    }
    const selected = this.suggestions[this.selectedSuggestion];
    this.input = selected.applyValue;
    this.cursorIndex = Array.from(this.input).length;
  }

  private moveSelectionMenu(step: number): void {
    const menu = this.activeSelectionMenu;
    if (!menu || menu.options.length === 0) {
      return;
    }
    menu.selectedIndex = (menu.selectedIndex + step + menu.options.length) % menu.options.length;
    this.render();
  }

  private commitSelectionMenu(): void {
    const menu = this.activeSelectionMenu;
    if (!menu) {
      return;
    }
    const value = menu.options[menu.selectedIndex]?.value;
    const resolve = menu.resolve;
    this.activeSelectionMenu = undefined;
    resolve(value);
    this.render();
  }

  private cancelSelectionMenu(): void {
    const menu = this.activeSelectionMenu;
    if (!menu) {
      return;
    }
    const resolve = menu.resolve;
    this.activeSelectionMenu = undefined;
    resolve(undefined);
    this.render();
  }

  private async handleEnter(): Promise<void> {
    const text = normalizeSlashPrefix(this.input).trim();
    this.input = "";
    this.cursorIndex = 0;
    this.suggestions = [];
    this.selectedSuggestion = 0;
    this.render();

    if (!text) {
      return;
    }

    this.updateGuidanceLanguage(text);

    if (!(this.pendingNaturalCommand && !isSlashPrefixed(text) && isConfirmationInput(text))) {
      await this.recordHistory(text);
    }

    if (this.busy) {
      if (this.activeNaturalRequest) {
        const steering = normalizeSteeringInput(text);
        if (!steering) {
          return;
        }
        this.applySteeringInput(steering);
        return;
      }
      this.queuedInputs.push(text);
      this.pushLog(`Queued turn: ${oneLine(text)}`);
      this.render();
      return;
    }

    await this.executeInput(text);
  }

  private async executeInput(text: string): Promise<void> {
    if (!text) {
      return;
    }

    if (this.pendingNaturalCommand && !isSlashPrefixed(text)) {
      await this.handlePendingNaturalConfirmation(text);
      return;
    }

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
      this.render();
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
        this.render();

        let response: Awaited<ReturnType<typeof buildNaturalAssistantResponseWithLlm>> | undefined;
        try {
          response = await buildNaturalAssistantResponseWithLlm({
            input: text,
            runs: this.runIndex,
            activeRunId: this.activeRunId,
            logs: this.logs,
            llm: this.getNaturalAssistantClient(),
            workspaceRoot: process.cwd(),
            steeringHints,
            abortSignal: abortController.signal,
            onProgress: (line) => {
              this.pushLog(oneLine(line));
              this.advanceThinkingFrame();
              this.render();
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

        if (response.pendingCommands && response.pendingCommands.length > 0) {
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
      await this.runBusyAction(async (abortSignal) => {
        if (abortSignal.aborted) {
          return;
        }
        const stepNumber = pending.stepIndex + 1;
        if (pending.totalSteps === 1) {
          this.pushLog(`Confirmed. Running: ${displayCommands[0] ?? pending.command}`);
        } else if (runAllRemaining) {
          this.pushLog(
            `Confirmed. Running all remaining steps from ${stepNumber}/${pending.totalSteps}.`
          );
        } else {
          this.pushLog(
            `Confirmed. Running step ${stepNumber}/${pending.totalSteps}: ${displayCommands[0] ?? pending.command}`
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
          this.render();

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
      if (pending.totalSteps === 1) {
        this.pushLog(`Canceled pending command: ${displayCommands[0] ?? pending.command}`);
      } else {
        this.pushLog(
          `Canceled pending plan from step ${pending.stepIndex + 1}/${pending.totalSteps}: ${this.describePendingNaturalCommands(pending)}`
        );
      }
      this.render();
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
    this.render();
  }

  private async runBusyAction(
    action: (abortSignal: AbortSignal) => Promise<void>,
    label = "operation"
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeBusyAbortController = abortController;
    this.activeBusyLabel = label;
    this.busy = true;
    this.ensureStatusAnimationTimer();
    this.render();
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
      this.stopStatusAnimationIfIdle();
      this.updateSuggestions();
      this.render();
      void this.drainQueuedInputs();
    }
  }

  private async handleFastNaturalIntent(text: string, abortSignal: AbortSignal): Promise<boolean> {
    if (abortSignal.aborted) {
      return true;
    }

    const language = detectQueryLanguage(text);
    const titleChange = extractTitleChangeIntent(text);
    if (titleChange) {
      const run = await this.resolveTargetRun(undefined);
      if (!run) {
        return true;
      }
      const command = buildTitleCommand(titleChange.title, run.id);
      this.pushLog(
        language === "ko"
          ? `run title을 "${titleChange.title}"로 변경합니다.`
          : `I can rename the run title to "${titleChange.title}".`
      );
      this.armPendingNaturalCommands(text, [command]);
      return true;
    }

    if (isSupportedNaturalInputsQuery(text)) {
      for (const line of formatSupportedNaturalInputLines(language)) {
        this.pushLog(line);
      }
      this.pushLog(
        language === "ko"
          ? "이 목록 밖의 질문은 workspace 기반 LLM 응답으로 계속 처리합니다."
          : "Questions outside this list continue to use the workspace-grounded LLM fallback."
      );
      return true;
    }

    const run = await this.resolveTargetRun(undefined);
    if (run) {
      const hypothesisInsights = await this.readHypothesisInsights(run.id);

      if (isHypothesisCountIntent(text)) {
        this.pushLog(
          language === "ko"
            ? `현재 저장된 가설은 ${hypothesisInsights.totalHypotheses}개입니다.`
            : `There are ${hypothesisInsights.totalHypotheses} saved hypotheses in the current run.`
        );
        return true;
      }

      if (isHypothesisListIntent(text)) {
        if (hypothesisInsights.totalHypotheses === 0) {
          this.pushLog(
            language === "ko"
              ? "현재 run에 저장된 가설이 없습니다."
              : "No saved hypotheses were found in the current run."
          );
          return true;
        }

        const limit = extractRequestedHypothesisCount(text);
        const texts = hypothesisInsights.texts.slice(0, limit);
        this.pushLog(
          language === "ko"
            ? `현재 저장된 가설 ${hypothesisInsights.totalHypotheses}개 중 ${texts.length}개를 보여드립니다.`
            : `Showing ${texts.length} of ${hypothesisInsights.totalHypotheses} saved hypotheses.`
        );
        texts.forEach((item, idx) => {
          this.pushLog(`${idx + 1}. ${item}`);
        });
        return true;
      }

      const insights = await this.readCorpusInsights(run.id);

      if (isMissingPdfCountIntent(text)) {
        if (insights.totalPapers === 0) {
          this.pushLog(
            language === "ko"
              ? "현재 run에 수집된 논문이 없습니다."
              : "No collected papers were found in the current run."
          );
          return true;
        }
        this.pushLog(
          language === "ko"
            ? `PDF 경로가 없는 논문은 ${insights.missingPdfCount}편입니다. (총 ${insights.totalPapers}편)`
            : `Papers without a PDF path: ${insights.missingPdfCount} (out of ${insights.totalPapers}).`
        );
        return true;
      }

      if (isTopCitationIntent(text)) {
        if (insights.totalPapers === 0) {
          this.pushLog(
            language === "ko"
              ? "현재 run에 수집된 논문이 없습니다."
              : "No collected papers were found in the current run."
          );
          return true;
        }
        if (!insights.topCitation) {
          this.pushLog(
            language === "ko"
              ? "수집된 논문에 citation 정보가 없어 최고 citation 논문을 계산할 수 없습니다."
              : "Citation metadata is missing, so I cannot compute the top-cited paper."
          );
          return true;
        }
        this.pushLog(
          language === "ko"
            ? `citation이 가장 높은 논문은 "${insights.topCitation.title}"이며 citation_count는 ${insights.topCitation.citationCount}회입니다.`
            : `The top-cited paper is "${insights.topCitation.title}" with ${insights.topCitation.citationCount} citations.`
        );
        return true;
      }

      if (isPaperCountIntent(text)) {
        this.pushLog(
          language === "ko"
            ? `현재 수집된 논문은 ${insights.totalPapers}편입니다.`
            : `The current run has ${insights.totalPapers} collected papers.`
        );
        return true;
      }

      if (isPaperTitleIntent(text)) {
        const limit = extractRequestedTitleCount(text);
        const titles = insights.titles.slice(0, limit);
        if (titles.length === 0) {
          this.pushLog(
            language === "ko"
              ? "현재 run에 수집된 논문 제목이 없습니다."
              : "No collected paper titles were found in the current run."
          );
          return true;
        }

        this.pushLog(
          language === "ko"
            ? `논문 제목 ${titles.length}개입니다.`
            : `Here are ${titles.length} paper title(s).`
        );
        titles.forEach((title, idx) => {
          this.pushLog(`${idx + 1}. ${title}`);
        });
        return true;
      }
    }

    if (looksLikeStructuredActionRequest(text)) {
      this.startThinking();
      this.render();
      try {
        const structuredPlan = await extractStructuredActionPlan({
          input: text,
          runs: this.runIndex,
          activeRunId: this.activeRunId,
          llm: this.getCommandIntentClient(),
          abortSignal,
          onProgress: (line) => {
            this.pushLog(oneLine(line));
            this.render();
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
      if (samePendingPlan(pending.commands, deterministicReplan.commands)) {
        this.pushLog("Replan matched the failed plan. Not re-arming the same commands.");
        return;
      }
        this.armPendingNaturalCommands(pending.sourceInput, deterministicReplan.commands, {
          presentation: "collect_replan_summary"
        });
        return;
    }

    try {
      const response = await buildNaturalAssistantResponseWithLlm({
        input: pending.sourceInput,
        runs: this.runIndex,
        activeRunId: this.activeRunId,
        logs: this.logs,
        llm: this.getNaturalAssistantClient(),
        workspaceRoot: process.cwd(),
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
          this.render();
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

      if (proposedCommands.length === 0) {
        this.pushLog("No revised execution plan was suggested.");
        return;
      }

      if (samePendingPlan(pending.commands, proposedCommands)) {
        this.pushLog("Replan matched the failed plan. Not re-arming the same commands.");
        return;
      }

      this.armPendingNaturalCommands(pending.sourceInput, proposedCommands);
    } catch (error) {
      if (this.isAbortError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.pushLog(`Automatic replan failed: ${message}`);
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

    const request = {
      ...collectParsed.request,
      warnings: []
    };
    const targetRun =
      (request.runQuery ? this.runIndex.find((run) => run.id === request.runQuery) : undefined) ||
      this.getActiveIndexedRun();
    const query = request.query?.trim() || targetRun?.topic;
    if (!query) {
      return undefined;
    }

    const batchSize = determineCollectReplanBatchSize(
      request,
      !this.semanticScholarApiKeyConfigured
    );
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
        {
          ...baseRequest,
          additional: undefined,
          limit: firstFetch
        },
        runId
      )
    );
    remaining -= firstFetch;

    while (remaining > 0) {
      const additional = Math.min(batchSize, remaining);
      commands.push(
        buildCollectSlashCommand(
          {
            ...baseRequest,
            limit: undefined,
            additional
          },
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
    if (this.drainingQueuedInputs || this.stopped || this.busy || this.queuedInputs.length === 0) {
      return;
    }

    this.drainingQueuedInputs = true;
    try {
      while (!this.stopped && !this.busy && this.queuedInputs.length > 0) {
        const next = this.queuedInputs.shift();
        if (!next) {
          break;
        }
        this.pushLog(`Running queued input: ${oneLine(next)}`);
        this.render();
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
      if (!merged.some((x) => oneLine(x) === normalized)) {
        merged.push(hint);
      }
    }
    return merged.slice(-8);
  }

  private async recordHistory(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    const last = this.commandHistory[this.commandHistory.length - 1];
    if (last !== normalized) {
      this.commandHistory.push(normalized);
      if (this.commandHistory.length > 300) {
        this.commandHistory = this.commandHistory.slice(-300);
      }
    }
    this.historyCursor = -1;
    this.historyDraft = "";
    await this.persistHistoryForActiveRun();
  }

  private recallPreviousHistory(): boolean {
    if (this.commandHistory.length === 0) {
      return false;
    }

    if (this.historyCursor === -1) {
      this.historyDraft = this.input;
      this.historyCursor = this.commandHistory.length - 1;
    } else if (this.historyCursor > 0) {
      this.historyCursor -= 1;
    } else {
      return false;
    }

    this.input = this.commandHistory[this.historyCursor] || "";
    this.cursorIndex = Array.from(this.input).length;
    this.updateSuggestions();
    return true;
  }

  private recallNextHistory(): boolean {
    if (this.historyCursor === -1) {
      return false;
    }

    if (this.historyCursor < this.commandHistory.length - 1) {
      this.historyCursor += 1;
      this.input = this.commandHistory[this.historyCursor] || "";
    } else {
      this.historyCursor = -1;
      this.input = this.historyDraft;
      this.historyDraft = "";
    }

    this.cursorIndex = Array.from(this.input).length;
    this.updateSuggestions();
    return true;
  }

  private exitHistoryBrowsing(): void {
    if (this.historyCursor !== -1) {
      this.historyCursor = -1;
      this.historyDraft = "";
    }
  }

  private cancelCurrentBusyOperation(): void {
    if (!this.busy) {
      return;
    }

    if (this.activeNaturalRequest && !this.activeNaturalRequest.abortController.signal.aborted) {
      this.pushLog(`Cancel requested: ${oneLine(this.activeNaturalRequest.input)}`);
      this.activeNaturalRequest.abortController.abort();
      this.render();
      return;
    }

    if (this.activeBusyAbortController && !this.activeBusyAbortController.signal.aborted) {
      const label = this.activeBusyLabel || "operation";
      this.pushLog(`Cancel requested: ${label}`);
      this.activeBusyAbortController.abort();
      this.render();
      return;
    }
  }

  private isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return message.includes("aborted") || message.includes("abort");
  }

  private isSteeringAbort(error: unknown): boolean {
    return this.isAbortError(error);
  }

  private wasAgentRunCanceled(run: RunRecord, node: GraphNodeId): boolean {
    const state = run.graph.nodeStates[node];
    return run.status === "paused" && state.status === "pending" && state.note === "Canceled by user";
  }

  private applySteeringInput(instruction: string): void {
    if (!this.activeNaturalRequest) {
      return;
    }
    this.steeringBufferDuringThinking.push(instruction);
    this.pushLog(`Natural query: ${oneLine(instruction)}`);
    this.pushLog("Replanning current natural query with latest steering...");
    this.activeNaturalRequest.abortController.abort();
    this.render();
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
        await this.handleNewRun();
        return { ok: true };
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
      case "agent":
        return this.handleAgent(args, abortSignal);
      case "approve":
        return this.handleApprove();
      case "retry":
        return this.handleRetry();
      case "settings":
        await this.handleSettings();
        return { ok: true };
      case "model":
        await this.handleModel(args);
        return { ok: true };
      case "quit":
        await this.shutdown();
        return { ok: true };
      default:
        this.pushLog(`Unknown command: /${command}`);
        return { ok: false, reason: `unknown command /${command}` };
    }
  }

  private printHelp(): void {
    this.pushLog("Help");
    this.pushLog("");
    this.pushLog("Core:");
    this.pushLog("/help | /new | /runs | /run <run> | /resume <run> | /title <new title>");
    this.pushLog("/doctor | /model | /settings | /quit");
    this.pushLog("");
    this.pushLog("Workflow:");
    this.pushLog("/approve | /retry");
    this.pushLog("/agent list | /agent status [run] | /agent graph [run] | /agent budget [run]");
    this.pushLog("/agent review [run] | /agent transition [run] | /agent apply [run] | /agent overnight [run]");
    this.pushLog(
      "/agent run <node> [run] [--top-n <n> | --top-k <n> --branch-count <n>] | /agent retry [node] [run] | /agent jump <node> [run] [--force]"
    );
    this.pushLog("/agent focus <node> | /agent resume [run] [checkpoint]");
    this.pushLog("");
    this.pushLog("Collection:");
    this.pushLog("/agent collect [query] [options] | /agent recollect <n> [run]");
    this.pushLog("/agent clear <node> [run] | /agent count <node> [run] | /agent clear_papers [run]");
    this.pushLog("Collect options: --run --limit --additional --last-years --year --date-range --sort --order --field --venue --type --min-citations --open-access --bibtex --dry-run");
    this.pushLog("");
    this.pushLog("Natural language:");
    this.pushLog("Ask 'what natural inputs are supported?' to list the live intent catalog.");
    this.pushLog("Examples: What should I do next? | Show current status | Collect 100 papers from the last 5 years by relevance");
    this.pushLog("Examples: Show artifact count for the analyze_results node | Change the run title to Multi-agent collaboration");
    this.pushLog("Execution requests require 'y' to run or 'n' to cancel.");
    this.pushLog("Multi-step plans: 'y' runs the next step, 'a' runs all remaining steps, 'n' cancels the rest.");
    this.pushLog("While thinking, any new input is treated as steering.");
  }

  private async handleNewRun(): Promise<void> {
    const topic = await this.askWithinTui("Topic", this.config.research.default_topic);
    const constraintsRaw = await this.askWithinTui(
      "Constraints (comma-separated)",
      this.config.research.default_constraints.join(", ")
    );
    const objectiveMetric = await this.askWithinTui(
      "Objective metric",
      this.config.research.default_objective_metric
    );

    const constraints = constraintsRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    this.pushLog(`Generating run title with ${this.describePrimaryLlmProvider(this.config.providers.llm_mode)}...`);
    this.render();

    const title = await this.titleGenerator.generateTitle(topic, constraints, objectiveMetric);
    const run = await this.runStore.createRun({
      title,
      topic,
      constraints,
      objectiveMetric
    });

    await this.setActiveRunId(run.id);
    this.pushLog(`Created run ${run.id}`);
    this.pushLog(`Title: ${run.title}`);
    await this.refreshRunIndex();
  }

  private async handleDoctor(): Promise<void> {
    const checks = await runDoctor(this.codex, {
      llmMode: this.config.providers.llm_mode,
      pdfAnalysisMode: this.config.analysis.pdf_mode,
      openAiApiKeyConfigured: await resolveOpenAiApiKey(process.cwd()).then(Boolean)
    });
    for (const check of checks) {
      const mark = check.ok ? "OK" : "FAIL";
      this.pushLog(`[${mark}] ${check.name}: ${check.detail}`);
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

    if (run.title === parsed.title) {
      this.pushLog(`Title is already set: ${run.title}`);
      return { ok: true };
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
    if (abortSignal?.aborted) {
      throw new Error("Operation aborted by user");
    }
    const sub = (args[0] || "").toLowerCase();

    if (!sub || sub === "list") {
      this.pushLog(`Graph nodes: ${AGENT_ORDER.join(", ")}`);
      return { ok: true };
    }

    if (sub === "run") {
      const nodeRaw = args[1] as AgentId | undefined;
      if (!nodeRaw) {
        this.pushLog("Usage: /agent run <node> [run] [--top-n <n> | --top-k <n> --branch-count <n>]");
        return { ok: false, reason: "missing node for /agent run" };
      }
      if (!AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog(`Unknown node: ${nodeRaw}`);
        return { ok: false, reason: `unknown node ${nodeRaw}` };
      }

      let runQuery = args.slice(2).join(" ").trim() || undefined;
      if (nodeRaw === "analyze_papers") {
        const parsed = parseAnalyzeRunArgs(args.slice(2));
        if (parsed.error) {
          this.pushLog(parsed.error);
          return { ok: false, reason: parsed.error };
        }
        runQuery = parsed.runQuery;
      } else if (nodeRaw === "generate_hypotheses") {
        const parsed = parseGenerateHypothesesRunArgs(args.slice(2));
        if (parsed.error) {
          this.pushLog(parsed.error);
          return { ok: false, reason: parsed.error };
        }
        runQuery = parsed.runQuery;
      } else if (args.slice(2).includes("--top-n")) {
        this.pushLog("--top-n is only supported for /agent run analyze_papers");
        return { ok: false, reason: "unsupported --top-n option" };
      } else if (args.slice(2).includes("--top-k") || args.slice(2).includes("--branch-count")) {
        this.pushLog("--top-k and --branch-count are only supported for /agent run generate_hypotheses");
        return { ok: false, reason: "unsupported generate_hypotheses options" };
      }
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      if (nodeRaw === "analyze_papers") {
        const parsed = parseAnalyzeRunArgs(args.slice(2));
        const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
        await runContext.put("analyze_papers.request", {
          topN: parsed.topN ?? null,
          selectionMode: parsed.topN ? "top_n" : "all",
          selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
        });
      } else if (nodeRaw === "generate_hypotheses") {
        const parsed = parseGenerateHypothesesRunArgs(args.slice(2));
        const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
        await runContext.put("generate_hypotheses.request", {
          topK: parsed.topK ?? 2,
          branchCount: parsed.branchCount ?? 6
        });
      }

      await this.setActiveRunId(run.id);
      const response = await this.orchestrator.runAgentWithOptions(run.id, nodeRaw, { abortSignal });
      await this.refreshRunIndex();
      if (this.wasAgentRunCanceled(response.run, nodeRaw)) {
        throw new Error("Operation aborted by user");
      }

      if (response.result.status === "failure") {
        this.pushLog(`Node ${nodeRaw} failed: ${response.result.error || "unknown error"}`);
        return { ok: false, reason: response.result.error || `${nodeRaw} failed` };
      }

      this.pushLog(`Node ${nodeRaw} finished: ${oneLine(response.result.summary, 480)}`);
      return { ok: true };
    }

    if (sub === "status") {
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      await this.setActiveRunId(run.id);
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

      const normalizedAdditional = Math.max(1, Math.floor(additional));
      const runQuery = args.slice(2).join(" ").trim() || undefined;
      const collectArgs = ["--additional", String(normalizedAdditional)];
      if (runQuery) {
        collectArgs.push("--run", runQuery);
      }
      return this.handleAgentCollect(collectArgs, abortSignal, true);
    }

    if (sub === "count" || sub === "개수조회") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent count <node> [run]");
        return { ok: false, reason: "invalid node for /agent count" };
      }
      const runQuery = args.slice(2).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
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
      const runQuery = args.slice(2).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
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
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      const removed = await this.clearNodeArtifacts(run, "collect_papers");
      await this.resetRunFromNode(run.id, "collect_papers", "clear collect_papers");
      await this.setActiveRunId(run.id);
      this.pushLog(`Cleared paper artifacts: ${removed} file(s).`);
      this.pushLog("Run reset to collect_papers (pending).");
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
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
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
      const runQuery = args[1] || undefined;
      const checkpointRaw = args[2] || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      const checkpoint = checkpointRaw ? Number(checkpointRaw) : undefined;
      await this.orchestrator.resumeRun(run.id, Number.isFinite(checkpoint ?? NaN) ? checkpoint : undefined);
      this.pushLog(`Resumed run ${run.id}${checkpoint ? ` from checkpoint ${checkpoint}` : ""}.`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "retry") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      const runQuery = args.slice(2).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      const node = nodeRaw && AGENT_ORDER.includes(nodeRaw) ? nodeRaw : undefined;
      const updated = await this.orchestrator.retryCurrent(run.id, node);
      this.pushLog(`Retry armed for ${updated.currentNode}.`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "jump") {
      const nodeRaw = args[1] as GraphNodeId | undefined;
      if (!nodeRaw || !AGENT_ORDER.includes(nodeRaw)) {
        this.pushLog("Usage: /agent jump <node> [run] [--force]");
        return { ok: false, reason: "invalid node for /agent jump" };
      }

      const force = args.includes("--force");
      const runQuery = args
        .slice(2)
        .filter((x) => x !== "--force")
        .join(" ")
        .trim() || undefined;

      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      const mode = force ? "force" : "safe";
      await this.orchestrator.jumpToNode(run.id, nodeRaw, mode, "manual jump command");
      this.pushLog(`Jumped to ${nodeRaw} (${mode}).`);
      await this.refreshRunIndex();
      return { ok: true };
    }

    if (sub === "budget") {
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }

      const budget = await this.orchestrator.getBudgetStatus(run.id);
      this.pushLog(
        `Budget: tools ${budget.toolCallsUsed}/${budget.policy.maxToolCalls}, time ${(budget.wallClockMsUsed / 60000).toFixed(1)}m/${budget.policy.maxWallClockMinutes}m, usd ${budget.usdUsed ?? 0}/${budget.policy.maxUsd}`
      );
      return { ok: true };
    }

    if (sub === "transition") {
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
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
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
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
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      this.pushLog("Starting overnight autonomy with the default safe policy.");
      const controller = new AutonomousRunController(this.runStore, this.orchestrator, this.eventStream);
      const outcome = await controller.runOvernight(run.id, buildDefaultOvernightPolicy(), { abortSignal });
      this.pushLog(`Overnight autonomy ${outcome.status}: ${outcome.reason}`);
      this.pushLog(
        `Iterations=${outcome.iterations}, approvals=${outcome.approvalsApplied}, transitions=${outcome.transitionsApplied}`
      );
      await this.refreshRunIndex();
      return { ok: outcome.status !== "failed", reason: outcome.status === "failed" ? outcome.reason : undefined };
    }

    this.pushLog(
      "Usage: /agent list | run | status | review | collect | recollect | clear | count | clear_papers | focus | graph | resume | retry | jump | budget | transition | apply | overnight"
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

    const runQuery = request.runQuery?.trim() || undefined;
    const run = await this.resolveTargetRun(runQuery);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }

    if (abortSignal?.aborted) {
      throw new Error("Operation aborted by user");
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

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    await runContext.put("collect_papers.request", nodeRequest);
    await runContext.put("collect_papers.requested_limit", fetchCount);

    await this.orchestrator.jumpToNode(
      run.id,
      "collect_papers",
      "safe",
      fromRecollectAlias ? `recollect +${request.additional ?? 0}` : "collect command"
    );

    const summaryPrefix = request.additional
      ? `Moving to collect_papers and requesting +${request.additional} papers (target total ${targetTotal}).`
      : `Moving to collect_papers with target total ${targetTotal}.`;
    this.pushLog(summaryPrefix);
    if (shouldUseConservativeCollectPacing(request, fetchCount, !this.semanticScholarApiKeyConfigured)) {
      this.pushLog(
        "Large or filtered collect request detected. Using smaller Semantic Scholar chunks to reduce rate limits."
      );
    }

    const response = await this.orchestrator.runAgentWithOptions(run.id, "collect_papers", {
      abortSignal
    });
    await this.refreshRunIndex();
    if (this.wasAgentRunCanceled(response.run, "collect_papers")) {
      throw new Error("Operation aborted by user");
    }
    if (response.result.status === "failure") {
      this.pushLog(`collect_papers failed: ${response.result.error || "unknown error"}`);
      return { ok: false, reason: response.result.error || "collect_papers failed" };
    }

    this.pushLog(`collect_papers finished: ${oneLine(response.result.summary, 480)}`);
    return { ok: true };
  }

  private async handleApprove(): Promise<SlashExecutionResult> {
    const run = await this.resolveTargetRun(undefined);
    if (!run) {
      return { ok: false, reason: "target run not found" };
    }

    const updated = await this.orchestrator.approveCurrent(run.id);
    if (
      run.currentNode === "review" &&
      updated.currentNode === "review" &&
      updated.graph.nodeStates.review.status === "needs_approval" &&
      updated.graph.pendingTransition?.action === "pause_for_human"
    ) {
      this.pushLog("Review remains blocked. Use /agent transition or follow the suggested jump command.");
    } else if (updated.status === "completed") {
      this.pushLog("Run completed.");
    } else {
      this.pushLog(`Approved ${run.currentNode}. Next node is ${updated.currentNode}.`);
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
    const packetPath = path.join(process.cwd(), ".autolabos", "runs", run.id, "review", "review_packet.json");

    if (workingRun.currentNode === "analyze_results") {
      const analyzeState = workingRun.graph.nodeStates.analyze_results;
      if (analyzeState.status === "needs_approval") {
        workingRun = await this.orchestrator.approveCurrent(workingRun.id);
        this.pushLog("Approved analyze_results and moved into review.");
        await this.refreshRunIndex();
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
      this.pushLog(`review finished: ${oneLine(response.result.summary, 480)}`);
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
    return { ok: true };
  }

  private async handleSettings(): Promise<void> {
    const topic = await this.askWithinTui("Default topic", this.config.research.default_topic);
    const constraintsRaw = await this.askWithinTui(
      "Default constraints",
      this.config.research.default_constraints.join(", ")
    );
    const metric = await this.askWithinTui(
      "Default objective metric",
      this.config.research.default_objective_metric
    );
    const llmMode = await this.openSelectionMenu(
      "Select primary LLM provider",
      this.buildPrimaryLlmProviderOptions(),
      this.config.providers.llm_mode
    );
    if (!llmMode) {
      this.pushLog("Settings update canceled.");
      return;
    }
    if (llmMode === "openai_api" && !(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for OpenAI API provider mode.");
        return;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }
    const pdfMode = await this.openSelectionMenu(
      "Select PDF analysis mode",
      this.buildPdfAnalysisModeOptions(),
      this.config.analysis.pdf_mode
    );
    if (!pdfMode) {
      this.pushLog("Settings update canceled.");
      return;
    }

    if (pdfMode === "responses_api_pdf" && !(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for Responses API PDF analysis.");
        return;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }

    if (llmMode === "codex_chatgpt_only") {
      const chatSlot = await this.selectCodexSlot(
        "general chat",
        this.getCurrentCodexSlotSelection("chat"),
        this.config.providers.codex.chat_reasoning_effort || "low",
        "command"
      );
      if (!chatSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.applyCodexSlotSelection("chat", chatSlot.selection, chatSlot.effort);

      const taskSlot = await this.selectCodexSlot(
        "analysis/hypothesis",
        this.getCurrentCodexSlotSelection("task"),
        this.config.providers.codex.reasoning_effort,
        "task"
      );
      if (!taskSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.applyCodexSlotSelection("task", taskSlot.selection, taskSlot.effort);
    } else {
      const chatSlot = await this.selectOpenAiSlot(
        "general chat",
        this.config.providers.openai.chat_model || this.config.providers.openai.model,
        this.config.providers.openai.chat_reasoning_effort || "low",
        "command"
      );
      if (!chatSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.applyOpenAiSlotSelection("chat", chatSlot.model, chatSlot.effort);

      const taskSlot = await this.selectOpenAiSlot(
        "analysis/hypothesis",
        this.config.providers.openai.model,
        this.config.providers.openai.reasoning_effort,
        "task"
      );
      if (!taskSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.applyOpenAiSlotSelection("task", taskSlot.model, taskSlot.effort);
      this.openAiTextClient?.updateDefaults({
        model: this.config.providers.openai.model,
        reasoningEffort: this.config.providers.openai.reasoning_effort
      });
    }

    let responsesPdfModel = this.config.analysis.responses_model;
    let responsesPdfReasoningEffort: AppConfig["analysis"]["responses_reasoning_effort"] =
      (this.config.analysis.responses_reasoning_effort || "xhigh") as AppConfig["analysis"]["responses_reasoning_effort"];
    if (pdfMode === "responses_api_pdf") {
      const selectedResponsesSlot = await this.selectResponsesPdfSlot(
        normalizeResponsesPdfModel(this.config.analysis.responses_model),
        this.config.analysis.responses_reasoning_effort || "xhigh"
      );
      if (!selectedResponsesSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      responsesPdfModel = selectedResponsesSlot.model;
      responsesPdfReasoningEffort =
        selectedResponsesSlot.effort as AppConfig["analysis"]["responses_reasoning_effort"];
    } else if (llmMode === "codex_chatgpt_only") {
      const pdfSlot = await this.selectCodexSlot(
        "PDF analysis",
        this.getCurrentCodexSlotSelection("pdf"),
        this.config.providers.codex.pdf_reasoning_effort || this.config.providers.codex.reasoning_effort,
        "pdf"
      );
      if (!pdfSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.applyCodexSlotSelection("pdf", pdfSlot.selection, pdfSlot.effort);
    } else {
      const pdfSlot = await this.selectOpenAiSlot(
        "PDF text analysis",
        this.config.providers.openai.pdf_model || this.config.providers.openai.model,
        this.config.providers.openai.pdf_reasoning_effort || this.config.providers.openai.reasoning_effort,
        "pdf"
      );
      if (!pdfSlot) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.applyOpenAiSlotSelection("pdf", pdfSlot.model, pdfSlot.effort);
    }

    this.config.research.default_topic = topic;
    this.config.research.default_constraints = constraintsRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    this.config.research.default_objective_metric = metric;
    this.config.providers.llm_mode = llmMode as AppConfig["providers"]["llm_mode"];
    this.config.analysis.pdf_mode = pdfMode as AppConfig["analysis"]["pdf_mode"];
    this.config.analysis.responses_model = responsesPdfModel;
    this.config.analysis.responses_reasoning_effort =
      responsesPdfReasoningEffort as AppConfig["analysis"]["responses_reasoning_effort"];

    await this.saveConfigFn(this.config);
    const analysisSummary =
      this.config.analysis.pdf_mode === "responses_api_pdf"
        ? `${this.describePdfAnalysisMode(this.config.analysis.pdf_mode)} (${this.config.analysis.responses_model})`
        : this.describePdfAnalysisMode(this.config.analysis.pdf_mode);
    this.pushLog(
      `Settings saved. LLM provider: ${this.describePrimaryLlmProvider(this.config.providers.llm_mode)}. PDF analysis mode: ${analysisSummary}.`
    );
  }

  private async handleModel(args: string[]): Promise<void> {
    if (args.length > 0) {
      this.pushLog("`/model` has no subcommands. Run `/model` and choose from the selector.");
      return;
    }

    this.pushLog(`Current model backend: ${this.describePrimaryLlmProvider(this.config.providers.llm_mode)}`);
    this.pushModelSlotSummary();
    const llmMode = await this.openSelectionMenu(
      "Select model backend",
      this.buildPrimaryLlmProviderOptions(),
      this.config.providers.llm_mode
    );
    if (!llmMode) {
      this.pushLog("Model selection canceled.");
      return;
    }
    if (
      !(await this.applyModelBackendSelection(
        llmMode as AppConfig["providers"]["llm_mode"]
      ))
    ) {
      return;
    }
    const slot = await this.openSelectionMenu(
      "Select model slot",
      this.buildModelSlotOptions(),
      "task"
    );
    if (!slot) {
      this.pushLog("Model selection canceled.");
      return;
    }

    if (this.config.providers.llm_mode === "openai_api") {
      await this.handleOpenAiApiModelSelection(slot as "chat" | "task" | "pdf");
      return;
    }
    await this.handleCodexModelSelection(slot as "chat" | "task" | "pdf");
  }

  private async applyModelBackendSelection(
    llmMode: AppConfig["providers"]["llm_mode"]
  ): Promise<boolean> {
    const nextMode = llmMode === "openai_api" ? "openai_api" : "codex_chatgpt_only";
    if (nextMode === "openai_api" && !(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for the OpenAI API backend.");
        return false;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }

    if (this.config.providers.llm_mode === nextMode) {
      return true;
    }

    this.config.providers.llm_mode = nextMode;
    await this.saveConfigFn(this.config);
    this.pushLog(`Model backend updated to ${this.describePrimaryLlmProvider(nextMode)}.`);
    return true;
  }

  private async handleCodexModelSelection(slot: "chat" | "task" | "pdf"): Promise<void> {
    this.pushCurrentModelDefaults();
    const selected = await this.selectCodexSlot(
      slot === "chat" ? "general chat" : slot === "pdf" ? "PDF analysis" : "analysis/hypothesis",
      this.getCurrentCodexSlotSelection(slot),
      this.getCurrentCodexSlotReasoning(slot),
      slot === "chat" ? "command" : slot === "pdf" ? "pdf" : "task"
    );
    if (!selected) {
      this.pushLog("Model selection canceled.");
      return;
    }

    this.applyCodexSlotSelection(slot, selected.selection, selected.effort);
    this.codex.updateDefaults({
      model: this.config.providers.codex.model,
      reasoningEffort: this.config.providers.codex.reasoning_effort,
      fastMode: this.config.providers.codex.fast_mode
    });
    await this.saveConfigFn(this.config);
    this.pushLog(`Codex ${this.describeModelSlot(slot)} model updated.`);
    this.pushCurrentModelDefaults();
  }

  private async handleOpenAiApiModelSelection(slot: "chat" | "task" | "pdf"): Promise<void> {
    this.pushCurrentModelDefaults();
    if (!(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for OpenAI API provider mode.");
        return;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }

    if (slot === "pdf" && this.config.analysis.pdf_mode === "responses_api_pdf") {
      const selectedResponsesSlot = await this.selectResponsesPdfSlot(
        normalizeResponsesPdfModel(this.config.analysis.responses_model),
        this.config.analysis.responses_reasoning_effort || "xhigh"
      );
      if (!selectedResponsesSlot) {
        this.pushLog("Model selection canceled.");
        return;
      }
      this.config.analysis.responses_model = selectedResponsesSlot.model;
      this.config.analysis.responses_reasoning_effort =
        selectedResponsesSlot.effort as AppConfig["analysis"]["responses_reasoning_effort"];
      await this.saveConfigFn(this.config);
      this.pushLog("Responses API PDF model updated.");
      this.pushCurrentModelDefaults();
      return;
    }

    const selected = await this.selectOpenAiSlot(
      slot === "chat" ? "general chat" : slot === "pdf" ? "PDF text analysis" : "analysis/hypothesis",
      this.getCurrentOpenAiSlotModel(slot),
      this.getCurrentOpenAiSlotReasoning(slot),
      slot === "chat" ? "command" : slot === "pdf" ? "pdf" : "task"
    );
    if (!selected) {
      this.pushLog("Model selection canceled.");
      return;
    }

    this.applyOpenAiSlotSelection(slot, selected.model, selected.effort);
    this.openAiTextClient?.updateDefaults({
      model: this.config.providers.openai.model,
      reasoningEffort: this.config.providers.openai.reasoning_effort
    });
    await this.saveConfigFn(this.config);
    this.pushLog(`OpenAI API ${this.describeModelSlot(slot)} model updated.`);
    this.pushCurrentModelDefaults();
  }

  private pushCurrentModelDefaults(): void {
    this.pushModelSlotSummary();
  }

  private buildModelSelectionChoices(): string[] {
    return buildCodexModelSelectionChoices(
      this.config.providers.codex.model,
      process.env.AUTOLABOS_MODEL_CHOICES || ""
    );
  }

  private buildModelSelectionOptions(slot: "chat" | "task" | "pdf"): SelectionMenuOption[] {
    const recommended = this.getRecommendedCodexSelection(slot);
    return this.buildModelSelectionChoices().map((value) => ({
      value,
      label: value,
      description: this.annotateRecommendedDescription(
        getCodexModelSelectionDescription(value),
        value === recommended
      )
    }));
  }

  private buildPdfAnalysisModeOptions(): SelectionMenuOption[] {
    return [
      {
        value: "codex_text_image_hybrid",
        label: "codex_text_image_hybrid",
        description: "Default. Download/extract PDF text locally, then attach rendered page images for hybrid analysis."
      },
      {
        value: "responses_api_pdf",
        label: "responses_api_pdf",
        description: "Fallback. Send PDF file input to Responses API (requires OPENAI_API_KEY)."
      }
    ];
  }

  private buildResponsesPdfModelOptions(): SelectionMenuOption[] {
    const recommended = this.getRecommendedResponsesPdfModel();
    return RESPONSES_PDF_MODEL_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      description: this.annotateRecommendedDescription(
        option.description,
        option.value === recommended
      )
    }));
  }

  private buildPrimaryLlmProviderOptions(): SelectionMenuOption[] {
    return [
      {
        value: "codex_chatgpt_only",
        label: "codex_cli",
        description: "Use the Codex CLI backend (ChatGPT sign-in)."
      },
      {
        value: "openai_api",
        label: "openai_api",
        description: "Use the OpenAI API backend (OPENAI_API_KEY required)."
      }
    ];
  }

  private buildOpenAiModelOptions(slot: "chat" | "task" | "pdf"): SelectionMenuOption[] {
    const recommended = this.getRecommendedOpenAiModel(slot);
    return OPENAI_RESPONSES_MODEL_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      description: this.annotateRecommendedDescription(
        option.description,
        option.value === recommended
      )
    }));
  }

  private buildOpenAiReasoningEffortOptions(
    model: string,
    recommended: "command" | "task" | "pdf"
  ): SelectionMenuOption[] {
    return getOpenAiResponsesReasoningOptions(model).map((option) => ({
      value: option.value,
      label: option.label,
      description: this.describeReasoningEffort(option.description, option.value, recommended)
    }));
  }

  private async selectOpenAiReasoningEffortOrDefault(
    model: string,
    currentEffort: AppConfig["providers"]["openai"]["reasoning_effort"],
    recommended: "command" | "task" | "pdf"
  ): Promise<AppConfig["providers"]["openai"]["reasoning_effort"] | undefined> {
    const normalizedEffort = normalizeOpenAiResponsesReasoningEffort(
      model,
      currentEffort
    ) as AppConfig["providers"]["openai"]["reasoning_effort"];
    if (!supportsOpenAiResponsesReasoning(model)) {
      return normalizedEffort;
    }
    const selected = await this.openSelectionMenu(
      recommended === "command"
        ? "Select command/query reasoning effort"
        : recommended === "task"
          ? "Select analysis/hypothesis reasoning effort"
          : "Select PDF analysis reasoning effort",
      this.buildOpenAiReasoningEffortOptions(model, recommended),
      normalizedEffort
    );
    return selected as AppConfig["providers"]["openai"]["reasoning_effort"] | undefined;
  }

  private async selectCodexReasoningEffort(
    model: string,
    currentEffort: CodexReasoningEffort,
    recommended: "command" | "task" | "pdf"
  ): Promise<CodexReasoningEffort | undefined> {
    const normalizedEffort = normalizeReasoningEffortForModel(model, currentEffort);
    const selected = await this.openSelectionMenu(
      recommended === "command"
        ? "Select command/query reasoning effort"
        : recommended === "task"
          ? "Select analysis/hypothesis reasoning effort"
          : "Select PDF analysis reasoning effort",
      getReasoningEffortChoicesForModel(model).map((value) => ({
        value,
        label: value,
        description: this.describeReasoningEffort("", value, recommended)
      })),
      normalizedEffort
    );
    return selected as CodexReasoningEffort | undefined;
  }

  private describeReasoningEffort(
    baseDescription: string,
    value: string,
    recommended: "command" | "task" | "pdf"
  ): string {
    const recommendation =
      recommended === "command"
        ? value === "low"
          ? "recommended for commands"
          : ""
        : recommended === "task"
          ? value === "xhigh"
            ? "recommended for analysis/hypothesis"
            : ""
          : value === "xhigh"
            ? "recommended for PDF analysis"
            : "";
    const parts = [baseDescription, recommendation].map((part) => part.trim()).filter(Boolean);
    return parts.join(" | ");
  }

  private describePdfAnalysisMode(mode: AppConfig["analysis"]["pdf_mode"]): string {
    return mode === "responses_api_pdf" ? "Responses API PDF input" : "Codex text + image hybrid";
  }

  private describePrimaryLlmProvider(mode: AppConfig["providers"]["llm_mode"]): string {
    return mode === "openai_api" ? "OpenAI API" : "Codex CLI";
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
    const codexRunForText =
      typeof this.codex.runForText === "function"
        ? this.codex.runForText.bind(this.codex)
        : undefined;
    const codexRunTurnStream =
      typeof this.codex.runTurnStream === "function"
        ? this.codex.runTurnStream.bind(this.codex)
        : undefined;
    return {
      runForText: async (opts) =>
        codexRunTurnStream
          ? (
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
            ).finalText
          : codexRunForText!(
              {
                prompt: opts.prompt,
                sandboxMode: opts.sandboxMode,
                approvalPolicy: opts.approvalPolicy,
                threadId: opts.threadId,
                systemPrompt: opts.systemPrompt,
                reasoningEffort:
                  opts.reasoningEffort ||
                  this.config.providers.codex.chat_reasoning_effort ||
                  this.config.providers.codex.command_reasoning_effort
              } as Parameters<NonNullable<typeof codexRunForText>>[0]
            ),
      runTurnStream: codexRunTurnStream
        ? (options) =>
            codexRunTurnStream({
              ...options,
              model: options.model || this.config.providers.codex.chat_model || this.config.providers.codex.model,
              reasoningEffort:
                (options.reasoningEffort ||
                  this.config.providers.codex.chat_reasoning_effort ||
                  this.config.providers.codex.command_reasoning_effort) as never,
              fastMode:
                typeof options.fastMode === "boolean"
                  ? options.fastMode
                  : this.config.providers.codex.chat_fast_mode
            })
        : undefined
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
    const reasoningEffort =
      this.config.providers.codex.chat_reasoning_effort ||
      this.config.providers.codex.command_reasoning_effort ||
      this.config.providers.codex.reasoning_effort;
    const codexRunForText =
      typeof this.codex.runForText === "function"
        ? this.codex.runForText.bind(this.codex)
        : undefined;
    const codexRunTurnStream =
      typeof this.codex.runTurnStream === "function"
        ? this.codex.runTurnStream.bind(this.codex)
        : undefined;
    return {
      runForText: async (opts) =>
        codexRunTurnStream
          ? (
              await codexRunTurnStream({
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
          : codexRunForText!(
              {
                prompt: opts.prompt,
                sandboxMode: opts.sandboxMode,
                approvalPolicy: opts.approvalPolicy,
                threadId: opts.threadId,
                systemPrompt: opts.systemPrompt,
                reasoningEffort
              } as Parameters<NonNullable<typeof codexRunForText>>[0]
            )
    };
  }

  private buildModelSlotOptions(): SelectionMenuOption[] {
    return [
      {
        value: "chat",
        label: "general_chat",
        description: `Current: ${this.getCurrentSlotPreset("chat")} | Recommended: ${this.getRecommendedSlotPreset("chat")}`
      },
      {
        value: "task",
        label: "analysis_hypothesis",
        description: `Current: ${this.getCurrentSlotPreset("task")} | Recommended: ${this.getRecommendedSlotPreset("task")}`
      },
      {
        value: "pdf",
        label: "pdf_analysis",
        description: `Current: ${this.getCurrentSlotPreset("pdf")} | Recommended: ${this.getRecommendedSlotPreset("pdf")}`
      }
    ];
  }

  private describeModelSlot(slot: "chat" | "task" | "pdf"): string {
    switch (slot) {
      case "chat":
        return "general chat";
      case "pdf":
        return "PDF analysis";
      default:
        return "analysis/hypothesis";
    }
  }

  private getCurrentCodexSlotSelection(slot: "chat" | "task" | "pdf"): string {
    if (slot === "chat") {
      return getCurrentCodexModelSelectionValue(
        this.config.providers.codex.chat_model || this.config.providers.codex.model,
        this.config.providers.codex.chat_fast_mode
      );
    }
    if (slot === "pdf") {
      return getCurrentCodexModelSelectionValue(
        this.config.providers.codex.pdf_model || this.config.providers.codex.model,
        this.config.providers.codex.pdf_fast_mode
      );
    }
    return getCurrentCodexModelSelectionValue(
      this.config.providers.codex.model,
      this.config.providers.codex.fast_mode
    );
  }

  private getCurrentCodexSlotReasoning(slot: "chat" | "task" | "pdf"): CodexReasoningEffort {
    if (slot === "chat") {
      return (this.config.providers.codex.chat_reasoning_effort ||
        this.config.providers.codex.command_reasoning_effort ||
        "low") as CodexReasoningEffort;
    }
    if (slot === "pdf") {
      return (this.config.providers.codex.pdf_reasoning_effort ||
        this.config.providers.codex.reasoning_effort) as CodexReasoningEffort;
    }
    return this.config.providers.codex.reasoning_effort;
  }

  private async selectCodexSlot(
    label: string,
    currentSelection: string,
    currentEffort: CodexReasoningEffort,
    recommended: "command" | "task" | "pdf"
  ): Promise<{ selection: string; effort: CodexReasoningEffort } | undefined> {
    const selectedSelection = await this.openSelectionMenu(
      `Select ${label} model`,
      this.buildModelSelectionOptions(
        recommended === "command" ? "chat" : recommended === "pdf" ? "pdf" : "task"
      ),
      currentSelection
    );
    if (!selectedSelection) {
      return undefined;
    }
    const effort = await this.selectCodexReasoningEffort(
      resolveCodexModelSelection(selectedSelection).model,
      currentEffort,
      recommended
    );
    if (!effort) {
      return undefined;
    }
    return { selection: selectedSelection, effort };
  }

  private applyCodexSlotSelection(
    slot: "chat" | "task" | "pdf",
    selection: string,
    effort: CodexReasoningEffort
  ): void {
    const resolved = resolveCodexModelSelection(selection);
    if (slot === "chat") {
      this.config.providers.codex.chat_model = resolved.model;
      this.config.providers.codex.chat_reasoning_effort = effort;
      this.config.providers.codex.command_reasoning_effort = effort;
      this.config.providers.codex.chat_fast_mode = resolved.model === "gpt-5.4" ? resolved.fastMode : false;
      return;
    }
    if (slot === "pdf") {
      this.config.providers.codex.pdf_model = resolved.model;
      this.config.providers.codex.pdf_reasoning_effort = effort;
      this.config.providers.codex.pdf_fast_mode = resolved.model === "gpt-5.4" ? resolved.fastMode : false;
      return;
    }
    this.config.providers.codex.model = resolved.model;
    this.config.providers.codex.reasoning_effort = effort;
    this.config.providers.codex.fast_mode = resolved.model === "gpt-5.4" ? resolved.fastMode : false;
  }

  private getCurrentOpenAiSlotModel(slot: "chat" | "task" | "pdf"): string {
    if (slot === "chat") {
      return normalizeOpenAiResponsesModel(
        this.config.providers.openai.chat_model || this.config.providers.openai.model
      );
    }
    if (slot === "pdf") {
      return normalizeOpenAiResponsesModel(
        this.config.providers.openai.pdf_model || this.config.providers.openai.model
      );
    }
    return normalizeOpenAiResponsesModel(this.config.providers.openai.model);
  }

  private getCurrentOpenAiSlotReasoning(
    slot: "chat" | "task" | "pdf"
  ): AppConfig["providers"]["openai"]["reasoning_effort"] {
    if (slot === "chat") {
      return (this.config.providers.openai.chat_reasoning_effort ||
        this.config.providers.openai.command_reasoning_effort ||
        "low") as AppConfig["providers"]["openai"]["reasoning_effort"];
    }
    if (slot === "pdf") {
      return (this.config.providers.openai.pdf_reasoning_effort ||
        this.config.providers.openai.reasoning_effort) as AppConfig["providers"]["openai"]["reasoning_effort"];
    }
    return this.config.providers.openai.reasoning_effort;
  }

  private async selectOpenAiSlot(
    label: string,
    currentModel: string,
    currentEffort: AppConfig["providers"]["openai"]["reasoning_effort"],
    recommended: "command" | "task" | "pdf"
  ): Promise<{ model: string; effort: AppConfig["providers"]["openai"]["reasoning_effort"] } | undefined> {
    const selectedModel = await this.openSelectionMenu(
      `Select ${label} model`,
      this.buildOpenAiModelOptions(
        recommended === "command" ? "chat" : recommended === "pdf" ? "pdf" : "task"
      ),
      normalizeOpenAiResponsesModel(currentModel)
    );
    if (!selectedModel) {
      return undefined;
    }
    const effort = await this.selectOpenAiReasoningEffortOrDefault(
      selectedModel,
      currentEffort,
      recommended
    );
    if (!effort) {
      return undefined;
    }
    return { model: selectedModel, effort };
  }

  private applyOpenAiSlotSelection(
    slot: "chat" | "task" | "pdf",
    model: string,
    effort: AppConfig["providers"]["openai"]["reasoning_effort"]
  ): void {
    if (slot === "chat") {
      this.config.providers.openai.chat_model = model;
      this.config.providers.openai.chat_reasoning_effort = effort;
      this.config.providers.openai.command_reasoning_effort = effort;
      return;
    }
    if (slot === "pdf") {
      this.config.providers.openai.pdf_model = model;
      this.config.providers.openai.pdf_reasoning_effort = effort;
      return;
    }
    this.config.providers.openai.model = model;
    this.config.providers.openai.reasoning_effort = effort;
  }

  private async selectResponsesPdfSlot(
    currentModel: string,
    currentEffort: AppConfig["analysis"]["responses_reasoning_effort"]
  ): Promise<{ model: string; effort: AppConfig["analysis"]["responses_reasoning_effort"] } | undefined> {
    const model = await this.openSelectionMenu(
      "Select Responses API PDF model",
      this.buildResponsesPdfModelOptions(),
      normalizeResponsesPdfModel(currentModel)
    );
    if (!model) {
      return undefined;
    }
    const effort = await this.selectOpenAiReasoningEffortOrDefault(model, currentEffort || "xhigh", "pdf");
    if (!effort) {
      return undefined;
    }
    return {
      model,
      effort: effort as AppConfig["analysis"]["responses_reasoning_effort"]
    };
  }

  private pushModelSlotSummary(): void {
    this.pushLog("Current model slots:");
    this.pushLog(`- ${this.describeModelSlot("chat")}: ${this.getCurrentSlotPreset("chat")} | Recommended: ${this.getRecommendedSlotPreset("chat")}`);
    this.pushLog(`- ${this.describeModelSlot("task")}: ${this.getCurrentSlotPreset("task")} | Recommended: ${this.getRecommendedSlotPreset("task")}`);
    this.pushLog(`- ${this.describeModelSlot("pdf")}: ${this.getCurrentSlotPreset("pdf")} | Recommended: ${this.getRecommendedSlotPreset("pdf")}`);
  }

  private getCurrentSlotPreset(slot: "chat" | "task" | "pdf"): string {
    if (this.config.providers.llm_mode === "openai_api") {
      if (slot === "pdf" && this.config.analysis.pdf_mode === "responses_api_pdf") {
        return `${this.config.analysis.responses_model} + ${this.config.analysis.responses_reasoning_effort || "xhigh"}`;
      }
      return `${this.getCurrentOpenAiSlotModel(slot)} + ${this.getCurrentOpenAiSlotReasoning(slot)}`;
    }
    return `${this.getCurrentCodexSlotSelection(slot)} + ${this.getCurrentCodexSlotReasoning(slot)}`;
  }

  private getRecommendedSlotPreset(slot: "chat" | "task" | "pdf"): string {
    if (this.config.providers.llm_mode === "openai_api") {
      if (slot === "pdf" && this.config.analysis.pdf_mode === "responses_api_pdf") {
        return `${this.getRecommendedResponsesPdfModel()} + xhigh`;
      }
      return `${this.getRecommendedOpenAiModel(slot)} + ${slot === "chat" ? "low" : "xhigh"}`;
    }
    return `${this.getRecommendedCodexSelection(slot)} + ${slot === "chat" ? "low" : "xhigh"}`;
  }

  private getRecommendedCodexSelection(slot: "chat" | "task" | "pdf"): string {
    return "gpt-5.4";
  }

  private getRecommendedOpenAiModel(slot: "chat" | "task" | "pdf"): string {
    return "gpt-5.4";
  }

  private getRecommendedResponsesPdfModel(): string {
    return "gpt-5.4";
  }

  private annotateRecommendedDescription(
    baseDescription: string | undefined,
    isRecommended: boolean
  ): string | undefined {
    if (!isRecommended) {
      return baseDescription;
    }
    if (!baseDescription) {
      return "Recommended preset.";
    }
    return `${baseDescription} | Recommended preset.`;
  }

  private async openSelectionMenu(
    label: string,
    options: readonly string[] | readonly SelectionMenuOption[],
    currentValue: string
  ): Promise<string | undefined> {
    if (options.length === 0) {
      return undefined;
    }

    const normalizedOptions: SelectionMenuOption[] = options.map((option) =>
      typeof option === "string"
        ? { value: option, label: option }
        : { value: option.value, label: option.label, description: option.description }
    );
    const selectedIndex = Math.max(0, normalizedOptions.findIndex((option) => option.value === currentValue));
    return new Promise<string | undefined>((resolve) => {
      this.activeSelectionMenu = {
        title: label,
        options: normalizedOptions,
        selectedIndex,
        resolve
      };
      this.render();
    });
  }

  private async resolveTargetRun(explicitQuery?: string): Promise<RunRecord | undefined> {
    const runs = await this.runStore.listRuns();

    if (explicitQuery) {
      const byQuery = resolveRunByQuery(runs, explicitQuery);
      if (!byQuery) {
        this.pushLog(`Run not found: ${explicitQuery}`);
      }
      return byQuery;
    }

    if (!this.activeRunId) {
      this.pushLog("No active run. Use /new or /run <run>.");
      return undefined;
    }

    const active = runs.find((run) => run.id === this.activeRunId);
    if (!active) {
      this.pushLog(`Active run not found: ${this.activeRunId}`);
      return undefined;
    }

    return active;
  }

  private getActiveIndexedRun(): RunRecord | undefined {
    if (this.activeRunId) {
      const active = this.runIndex.find((run) => run.id === this.activeRunId);
      if (active) {
        return active;
      }
    }
    return this.runIndex[0];
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
    const stepIndex = options?.stepIndex ?? 0;
    const totalSteps = options?.totalSteps ?? normalizedCommands.length;
    const pendingState: PendingNaturalCommandState = {
      command: normalizedCommands[0],
      commands: normalizedCommands,
      displayCommands: options?.displayCommands?.slice(0, normalizedCommands.length),
      sourceInput,
      createdAt: new Date().toISOString(),
      stepIndex,
      totalSteps,
      presentation: options?.presentation ?? "default"
    };
    this.pendingNaturalCommand = pendingState;

    const displayCommands = this.resolvePendingDisplayCommands(pendingState);

    if (totalSteps === 1) {
      if (displayCommands[0] && displayCommands[0] !== pendingState.command) {
        this.pushLog(`Resolved slash command: ${pendingState.command}`);
      }
      this.pushLog(`Execution intent detected. Pending command: ${displayCommands[0]}`);
      this.pushLog("Type 'y' to run now, or 'n' to cancel.");
      return;
    }

    if (options?.continuation) {
      if (this.pendingNaturalCommand.presentation === "collect_replan_summary") {
        this.pushLog(`Next recovery collect step ready (${stepIndex + 1}/${totalSteps}).`);
      } else if (normalizedCommands.length === 1) {
        this.pushLog(`Next plan step ready (${stepIndex + 1}/${totalSteps}): ${displayCommands[0]}`);
      } else {
        this.pushLog(`Remaining plan steps (${stepIndex + 1}-${totalSteps}/${totalSteps}):`);
        displayCommands.forEach((command, index) => {
          this.pushLog(`- [${stepIndex + index + 1}/${totalSteps}] ${command}`);
        });
      }
      this.pushLog(
        `Type 'y' to run step ${stepIndex + 1}/${totalSteps}, 'a' to run all remaining steps, or 'n' to cancel the remaining plan.`
      );
      return;
    }

    if (this.pendingNaturalCommand.presentation === "collect_replan_summary") {
      this.pushLog(`Recovery collect plan prepared with ${totalSteps} smaller step(s).`);
    } else {
      this.pushLog(`Execution plan detected. Pending ${totalSteps}-step plan:`);
      displayCommands.forEach((command, index) => {
        this.pushLog(`- [${stepIndex + index + 1}/${totalSteps}] ${command}`);
      });
    }
    this.pushLog(
      `Type 'y' to run step ${stepIndex + 1}/${totalSteps}, 'a' to run all remaining steps, or 'n' to cancel the plan.`
    );
  }

  private buildPendingPlanReminderLine(pending: PendingNaturalCommandState): string {
    if (pending.presentation === "collect_replan_summary") {
      return `Pending recovery collect plan from step ${pending.stepIndex + 1}/${pending.totalSteps}.`;
    }
    return `Pending plan from step ${pending.stepIndex + 1}/${pending.totalSteps}: ${this.describePendingNaturalCommands(pending)}`;
  }

  private describePendingNaturalCommands(pending: PendingNaturalCommandState): string {
    if (pending.presentation === "collect_replan_summary") {
      return `recovery collect plan (${pending.totalSteps} step${pending.totalSteps === 1 ? "" : "s"})`;
    }
    const displayCommands = this.resolvePendingDisplayCommands(pending);
    if (displayCommands.length <= 1) {
      return displayCommands[0] ?? "";
    }
    return displayCommands.join(" -> ");
  }

  private resolvePendingDisplayCommands(pending: Pick<PendingNaturalCommandState, "commands" | "displayCommands">): string[] {
    return pending.commands.map((command, index) => pending.displayCommands?.[index] ?? command);
  }

  private async setActiveRunId(runId?: string): Promise<void> {
    if (this.activeRunId === runId) {
      return;
    }
    this.activeRunId = runId;
    this.collectProgress = undefined;
    await this.loadHistoryForRun(runId);
    await this.refreshActiveRunInsight();
  }

  private async refreshActiveRunInsight(): Promise<void> {
    if (!this.activeRunId) {
      this.activeRunInsight = undefined;
      return;
    }

    const runDir = path.join(process.cwd(), ".autolabos", "runs", this.activeRunId);
    try {
      const run = await this.runStore.getRun?.(this.activeRunId);
      const reviewPacket = parseReviewPacket(await safeRead(path.join(runDir, "review", "review_packet.json")));
      if ((run?.currentNode === "review" || run?.currentNode === "write_paper") && reviewPacket) {
        this.activeRunInsight = buildReviewInsightCard(reviewPacket);
        return;
      }
      const report = parseAnalysisReport(await safeRead(path.join(runDir, "result_analysis.json")));
      if (report) {
        this.activeRunInsight = buildAnalyzeResultsInsightCard(report);
        return;
      }
      this.activeRunInsight = reviewPacket ? buildReviewInsightCard(reviewPacket) : undefined;
    } catch {
      this.activeRunInsight = undefined;
    }
  }

  private async loadHistoryForRun(runId?: string): Promise<void> {
    this.exitHistoryBrowsing();
    if (!runId) {
      this.commandHistory = [];
      this.historyLoadedRunId = undefined;
      return;
    }

    if (this.historyLoadedRunId === runId) {
      return;
    }

    const filePath = this.historyFilePath(runId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as RunHistoryFile;
      const items = Array.isArray(parsed.items)
        ? parsed.items
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(-300)
        : [];
      this.commandHistory = items;
    } catch {
      this.commandHistory = [];
    }
    this.historyLoadedRunId = runId;
  }

  private historyFilePath(runId: string): string {
    return path.join(process.cwd(), ".autolabos", "runs", runId, "tui_history.json");
  }

  private async persistHistoryForActiveRun(): Promise<void> {
    const runId = this.activeRunId;
    if (!runId) {
      return;
    }
    const payload: RunHistoryFile = {
      version: 1,
      items: this.commandHistory.slice(-300)
    };
    const filePath = this.historyFilePath(runId);
    try {
      await ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
      this.historyLoadedRunId = runId;
    } catch {
      // Ignore history persistence failures to keep TUI responsive.
    }
  }

  private async askWithinTui(question: string, defaultValue = ""): Promise<string> {
    this.detachKeyboard();
    process.stdout.write("\n");
    const answer = await askLine(question, defaultValue);
    this.attachKeyboard();
    return answer;
  }

  private pushLog(line: string): void {
    this.collectProgress = updateCollectProgressFromLog(this.collectProgress, line);
    this.analyzeProgress = updateAnalyzeProgressFromLog(this.analyzeProgress, line);
    if (shouldClearCollectProgress(line)) {
      this.collectProgress = undefined;
    }
    if (shouldClearAnalyzeProgress(line)) {
      this.analyzeProgress = undefined;
    }
    if (isCollectProgressLog(line) || isAnalyzeProgressLog(line)) {
      return;
    }
    this.logs.push(line);
    if (this.logs.length > 200) {
      this.logs = this.logs.slice(-200);
    }
  }

  private async refreshRunIndex(): Promise<void> {
    this.runIndex = await this.runStore.listRuns();
    if (this.runIndex.length > 0) {
      if (!this.activeRunId) {
        await this.setActiveRunId(this.runIndex[0].id);
      } else if (!this.runIndex.some((run) => run.id === this.activeRunId)) {
        await this.setActiveRunId(this.runIndex[0].id);
      }
    } else if (this.activeRunId) {
      await this.setActiveRunId(undefined);
    }
    await this.refreshActiveRunInsight();
    this.updateSuggestions();
  }

  private render(): void {
    const run = this.activeRunId ? this.runIndex.find((x) => x.id === this.activeRunId) : undefined;
    const guidance =
      this.input.trim().length === 0 && this.suggestions.length === 0 && !this.activeSelectionMenu
        ? this.getContextualGuidance(run)
        : undefined;
    const frame = buildFrame({
      appVersion: this.appVersion,
      busy: this.busy,
      activityLabel: this.getActivityLabel(run),
      thinking: this.thinking,
      thinkingFrame: this.thinkingFrame,
      terminalWidth: this.resolveTerminalWidth(),
      run,
      runInsight: this.activeRunInsight,
      logs: this.getRenderableLogs(run),
      input: this.input,
      inputCursor: this.cursorIndex,
      suggestions: this.suggestions,
      selectedSuggestion: this.selectedSuggestion,
      colorEnabled: this.colorEnabled,
      guidance,
      selectionMenu: this.activeSelectionMenu
        ? {
            title: this.activeSelectionMenu.title,
            options: this.activeSelectionMenu.options,
            selectedIndex: this.activeSelectionMenu.selectedIndex
          }
        : undefined
    });
    this.lastRenderedFrame = frame;

    process.stdout.write("\x1Bc");
    process.stdout.write(frame.lines.join("\n"));

    const up = frame.lines.length - frame.inputLineIndex;
    if (up > 0) {
      process.stdout.write(`\x1b[${up}A`);
    }
    process.stdout.write(`\x1b[${frame.inputColumn}G`);
  }

  private getContextualGuidance(run = this.activeRunId ? this.runIndex.find((x) => x.id === this.activeRunId) : undefined) {
    return buildContextualGuidance({
      run,
      language: this.guidanceLanguage,
      pendingPlan: this.pendingNaturalCommand
        ? {
            command: this.pendingNaturalCommand.command,
            commands: this.pendingNaturalCommand.commands,
            displayCommands: this.pendingNaturalCommand.displayCommands,
            stepIndex: this.pendingNaturalCommand.stepIndex,
            totalSteps: this.pendingNaturalCommand.totalSteps
          }
        : undefined
    });
  }

  private updateGuidanceLanguage(text: string): void {
    const detected = detectGuidanceLanguageFromText(text);
    if (detected) {
      this.guidanceLanguage = detected;
    }
  }

  private resolveTerminalWidth(): number {
    const envWidth = Number.parseInt(process.env.COLUMNS ?? "", 10);
    if (Number.isFinite(envWidth) && envWidth >= 20) {
      return envWidth;
    }
    return process.stdout.columns ?? 120;
  }

  private getActivityLabel(run?: RunRecord): string | undefined {
    if (!this.busy || this.thinking) {
      return undefined;
    }

    const explicit = this.activeBusyLabel?.trim();
    if (explicit && explicit !== "operation") {
      if (explicit.startsWith("Collecting")) {
        return formatCollectActivityLabel(this.collectProgress);
      }
      return explicit;
    }

    if (!run) {
      return undefined;
    }

    const nodeStatus = run.graph.nodeStates[run.currentNode]?.status;
    if (nodeStatus !== "running") {
      return undefined;
    }
    if (run.currentNode === "collect_papers") {
      return formatCollectActivityLabel(this.collectProgress);
    }
    return describeNodeActivity(run.currentNode);
  }

  private getRenderableLogs(run?: RunRecord): string[] {
    const progressLine = this.getTransientProgressLog(run);
    if (!progressLine) {
      return this.logs;
    }
    return [...this.logs, progressLine];
  }

  private getTransientProgressLog(run?: RunRecord): string | undefined {
    if (!this.busy) {
      return undefined;
    }

    const explicit = this.activeBusyLabel?.trim() ?? "";
    if (explicit.startsWith("Collecting") || run?.currentNode === "collect_papers") {
      return formatCollectActivityLabel(this.collectProgress);
    }

    if (explicit.startsWith("Analyzing") || run?.currentNode === "analyze_papers") {
      return formatAnalyzeProgressLogLine(this.analyzeProgress);
    }

    return undefined;
  }

  private renderThinkingLineOnly(): void {
    const frame = this.lastRenderedFrame;
    if (!frame?.thinkingLineIndex || !process.stdout.isTTY) {
      this.render();
      return;
    }

    const up = frame.inputLineIndex - frame.thinkingLineIndex;
    const text = this.thinking
      ? buildThinkingText(this.thinkingFrame, this.colorEnabled)
      : this.activeBusyLabel
        ? buildAnimatedStatusText(this.activeBusyLabel, this.thinkingFrame, this.colorEnabled)
        : "";
    if (!text) {
      this.render();
      return;
    }
    frame.lines[frame.thinkingLineIndex - 1] = text;

    process.stdout.write("\x1b[s");
    if (up > 0) {
      process.stdout.write(`\x1b[${up}A`);
    }
    process.stdout.write("\x1b[1G\x1b[2K");
    process.stdout.write(text);
    process.stdout.write("\x1b[u");
  }

  private async readCorpusCount(runId: string): Promise<number> {
    const insights = await this.readCorpusInsights(runId);
    return insights.totalPapers;
  }

  private async readPaperTitles(runId: string, maxItems: number): Promise<string[]> {
    const insights = await this.readCorpusInsights(runId);
    return insights.titles.slice(0, maxItems);
  }

  private async readHypothesisInsights(runId: string): Promise<HypothesisInsights> {
    const filePath = path.join(process.cwd(), ".autolabos", "runs", runId, "hypotheses.jsonl");
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const insights: HypothesisInsights = {
        totalHypotheses: lines.length,
        texts: []
      };

      for (const line of lines) {
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          const text = toOptionalString(row.text) || toOptionalString(row.hypothesis) || toOptionalString(row.hypothesis_id);
          if (text) {
            insights.texts.push(text);
          }
        } catch {
          // Ignore malformed rows and keep the line-count-based total.
        }
      }

      return insights;
    } catch {
      return {
        totalHypotheses: 0,
        texts: []
      };
    }
  }

  private async readCorpusInsights(runId: string): Promise<CorpusInsights> {
    const filePath = path.join(process.cwd(), ".autolabos", "runs", runId, "corpus.jsonl");
    try {
      const stat = await fs.stat(filePath);
      const cache = this.corpusInsightsCache.get(runId);
      if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
        return cache.insights;
      }

      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      const insights: CorpusInsights = {
        totalPapers: lines.length,
        missingPdfCount: 0,
        titles: []
      };

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

          const citationRaw = row.citation_count ?? row.citationCount;
          const citation = toFiniteNumber(citationRaw);
          if (title && citation !== undefined && citation > bestCitation) {
            bestCitation = citation;
            insights.topCitation = {
              title,
              citationCount: citation
            };
          }
        } catch {
          insights.missingPdfCount += 1;
        }
      }

      this.corpusInsightsCache.set(runId, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        insights
      });
      return insights;
    } catch {
      return {
        totalPapers: 0,
        missingPdfCount: 0,
        titles: []
      };
    }
  }

  private async clearNodeArtifacts(run: RunRecord, node: GraphNodeId): Promise<number> {
    const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
    const targets = nodeArtifactTargets(node);

    let removed = 0;
    for (const relative of targets) {
      const fullPath = path.join(runDir, relative);
      try {
        const stat = await fs.stat(fullPath).catch(() => undefined);
        await fs.rm(fullPath, { force: true, recursive: stat?.isDirectory() || false });
        removed += 1;
      } catch {
        // ignore missing files
      }
    }

    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    for (const key of nodeContextKeys(node)) {
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
    run.graph.budget.toolCallsUsed = 0;
    run.graph.budget.wallClockMsUsed = 0;
    run.graph.budget.usdUsed = 0;
    for (let idx = targetIdx; idx < AGENT_ORDER.length; idx += 1) {
      const nodeId = AGENT_ORDER[idx];
      run.graph.nodeStates[nodeId] = {
        ...run.graph.nodeStates[nodeId],
        status: "pending",
        updatedAt: now,
        note: `Reset by ${reason}`,
        lastError: undefined
      };
      delete run.graph.retryCounters[nodeId];
      delete run.graph.rollbackCounters[nodeId];
    }
    await this.runStore.updateRun(run);
  }

  private async countNodeArtifacts(run: RunRecord, node: GraphNodeId): Promise<string[]> {
    const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
    switch (node) {
      case "collect_papers": {
        const count = await countJsonl(path.join(runDir, "corpus.jsonl"));
        return [`Count(${node}): ${count} papers`];
      }
      case "analyze_papers": {
        const evidence = await countJsonl(path.join(runDir, "evidence_store.jsonl"));
        const summaries = await countJsonl(path.join(runDir, "paper_summaries.jsonl"));
        const selection = await readAnalyzeSelectionCount(path.join(runDir, "analysis_manifest.json"));
        if (selection) {
          return [`Count(${node}): ${evidence} evidences, ${summaries} summaries, selected ${selection.selected}/${selection.total}`];
        }
        return [`Count(${node}): ${evidence} evidences, ${summaries} summaries`];
      }
      case "generate_hypotheses": {
        const count = await countJsonl(path.join(runDir, "hypotheses.jsonl"));
        return [`Count(${node}): ${count} hypotheses`];
      }
      case "design_experiments": {
        const count = await countYamlList(path.join(runDir, "experiment_plan.yaml"), "hypotheses:");
        return [`Count(${node}): ${count} planned hypotheses`];
      }
      case "implement_experiments": {
        const exists = await pathExists(path.join(runDir, "experiment.py"));
        return [`Count(${node}): ${exists ? 1 : 0} implementation file`];
      }
      case "run_experiments": {
        const runs = await countJsonl(path.join(runDir, "exec_logs", "observations.jsonl"));
        const metrics = await pathExists(path.join(runDir, "metrics.json"));
        return [`Count(${node}): ${runs} execution logs, metrics ${metrics ? "present" : "missing"}`];
      }
      case "analyze_results": {
        const figures = await countDirFiles(path.join(runDir, "figures"));
        const metrics = await pathExists(path.join(runDir, "metrics.json"));
        const report = parseAnalysisReport(await safeRead(path.join(runDir, "result_analysis.json")));
        return formatAnalyzeResultsArtifactLines({
          figureCount: figures,
          metricsPresent: metrics,
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
      default:
        return [`Count(${node}): unsupported`];
    }
  }

  private async shutdown(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (this.activeSelectionMenu) {
      const resolve = this.activeSelectionMenu.resolve;
      this.activeSelectionMenu = undefined;
      resolve(undefined);
    }
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.stopThinking();
    this.detachKeyboard();
    process.stdin.pause();
    this.onQuit();
    this.resolver?.();
  }

  private startThinking(): void {
    if (this.thinking) {
      return;
    }
    this.thinking = true;
    this.thinkingFrame = 0;
    this.ensureStatusAnimationTimer();
    this.render();
  }

  private stopThinking(): void {
    this.thinking = false;
    this.stopStatusAnimationIfIdle();
  }

  private advanceThinkingFrame(): void {
    if (!this.thinking) {
      return;
    }
    this.thinkingFrame = (this.thinkingFrame + 1) % 10_000;
  }

  private describeBusyLabelForSlash(command: string, args: string[]): string {
    const normalized = command.toLowerCase();
    if (normalized === "agent") {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "collect" || sub === "recollect") {
        return "Collecting...";
      }
      if (sub === "review") {
        return "Preparing review...";
      }
      if (sub === "run") {
        const node = args[1];
        if (isGraphNodeId(node)) {
          return describeNodeActivity(node);
        }
      }
      if (sub === "retry") {
        const node = args[1];
        if (isGraphNodeId(node)) {
          return `Retrying ${describeNodeActivity(node).toLowerCase()}`;
        }
      }
    }

    if (normalized === "title") {
      return "Updating title...";
    }
    if (normalized === "model") {
      return "Updating model settings...";
    }
    if (normalized === "settings") {
      return "Saving settings...";
    }
    return `/${command}`;
  }

  private ensureStatusAnimationTimer(): void {
    if (this.thinkingTimer) {
      return;
    }
    this.thinkingTimer = setInterval(() => {
      if ((!this.thinking && !this.busy) || this.stopped) {
        return;
      }
      this.thinkingFrame = (this.thinkingFrame + 1) % 10_000;
      this.renderThinkingLineOnly();
    }, 120);
  }

  private stopStatusAnimationIfIdle(): void {
    if (this.thinking || this.busy) {
      return;
    }
    this.thinkingFrame = 0;
    if (this.thinkingTimer) {
      clearInterval(this.thinkingTimer);
      this.thinkingTimer = undefined;
    }
  }
}

export async function launchTerminalApp(deps: TerminalAppDeps): Promise<void> {
  const app = new TerminalApp(deps);
  await app.start();
}

function oneLine(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isSlashPrefixed(text: string): boolean {
  return text.startsWith("/") || text.startsWith("／");
}

function normalizeSlashPrefix(text: string): string {
  if (text.startsWith("／")) {
    return `/${text.slice(1)}`;
  }
  return text;
}

function normalizeSteeringInput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
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

function isConfirmationInput(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return isAffirmative(normalized) || isRunAllRemainingInput(normalized) || isNegative(normalized);
}

export function extractTitleChangeIntent(text: string): { title: string } | undefined {
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

  const quotedPatterns = [
    /(?:change|rename)\s+(?:the\s+)?(?:run\s+)?title\s+to\s+["'“”‘’]([^"'“”‘’]{1,120})["'“”‘’]/iu,
    /(?:title|제목)(?:을|를)?\s*["'“”‘’]([^"'“”‘’]{1,120})["'“”‘’]\s*(?:으로|로)?\s*(?:바꿔|바꾸|변경|수정)?/iu,
    /["'“”‘’]([^"'“”‘’]{1,120})["'“”‘’]\s*(?:으로|로)\s*(?:title|제목)/iu
  ];
  for (const pattern of quotedPatterns) {
    const quoted = raw.match(pattern)?.[1]?.trim();
    if (!quoted) {
      continue;
    }
    const title = sanitizeTitle(normalizeTitleIntentCandidate(quoted));
    if (title) {
      return { title };
    }
  }

  const patterns = [
    /(.+?)(?:으로|로)\s*(?:title|제목)(?:을|를)?\s*(?:바꿔줘|바꿔|바꾸고|변경해줘|변경|수정해줘|수정)(?:\s+.*)?$/iu,
    /(?:title|제목)(?:을|를)?\s*(.+?)(?:으로|로)\s*(?:바꿔줘|바꿔|바꾸고|변경해줘|변경|수정해줘|수정)(?:\s+.*)?$/iu,
    /(?:change|rename)\s+(?:the\s+)?(?:run\s+)?title\s+to\s+(.+?)(?:\s*(?:and|then)\b.*)?$/iu,
    /(?:run\s+title|title)\s+to\s+(.+?)(?:\s*(?:and|then)\b.*)?$/iu
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern)?.[1]?.trim();
    if (!match) {
      continue;
    }
    const title = sanitizeTitle(normalizeTitleIntentCandidate(match));
    if (title) {
      return { title };
    }
  }

  return undefined;
}

export function isPaperCountIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasPaper = /논문|paper|papers/u.test(raw);
  const asksCount = /몇|개수|갯수|몇개|몇 개|몇건|몇 건|how many|count|number/u.test(lower);
  const asksTitles = /제목|title|titles|목록|리스트|list/u.test(lower);
  const asksSpecificAttribute = /pdf|citation|인용|doi|저자|author|venue|journal|year|연도|field|분야|abstract|요약/u.test(
    lower
  );
  return hasPaper && asksCount && !asksTitles && !asksSpecificAttribute;
}

export function isMissingPdfCountIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasPaper = /논문|paper|papers/u.test(raw);
  const hasPdf = /pdf|피디에프/u.test(lower);
  const asksMissing = /없|누락|missing|without|no\s+pdf/u.test(lower);
  const asksCount = /몇|개수|갯수|몇개|몇 개|몇건|몇 건|how many|count|number/u.test(lower);
  return hasPaper && hasPdf && asksMissing && asksCount;
}

export function isTopCitationIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasPaper = /논문|paper|papers/u.test(raw);
  const hasCitation = /citation|citations|cited|인용|피인용/u.test(lower);
  const asksTop = /가장|최고|높|top|highest|max|maximum|most|최다/u.test(lower);
  return hasPaper && hasCitation && asksTop;
}

function isPaperTitleIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasPaper = /논문|paper|papers/u.test(raw);
  const asksTitleOrList = /제목|title|titles|목록|리스트|list/u.test(lower);
  return hasPaper && asksTitleOrList;
}

function isHypothesisCountIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasHypothesis = /가설|hypothesis|hypotheses/u.test(raw);
  const asksCount = /몇|개수|갯수|몇개|몇 개|how many|count|number/u.test(lower);
  const asksExecution = /생성|만들|뽑|추가|다시|재생성|generate|create|make|extract|derive|run|execute|실행/u.test(lower);
  return hasHypothesis && asksCount && !asksExecution;
}

function isHypothesisListIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  const hasHypothesis = /가설|hypothesis|hypotheses/u.test(raw);
  const asksList =
    /확인|보여|목록|리스트|정리|알려|내용|what are|show|list|display|review|check/u.test(lower);
  const asksExecution = /생성|만들|뽑|추가|다시|재생성|generate|create|make|extract|derive|run|execute|실행/u.test(lower);
  return hasHypothesis && asksList && !asksExecution;
}

function extractRequestedHypothesisCount(text: string): number {
  const lower = text.toLowerCase();
  if (/하나|한 개|한개|one\b/u.test(lower)) {
    return 1;
  }
  if (/두 개|두개|둘|two\b/u.test(lower)) {
    return 2;
  }
  if (/세 개|세개|셋|three\b/u.test(lower)) {
    return 3;
  }

  const match = lower.match(/(\d+)\s*(개|건|hypotheses?|hypothesis)?/u);
  if (match?.[1]) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(20, Math.floor(value));
    }
  }

  return 5;
}

function extractRequestedTitleCount(text: string): number {
  const lower = text.toLowerCase();
  if (/하나|한 개|한개|one\b/u.test(lower)) {
    return 1;
  }
  if (/두 개|두개|둘|two\b/u.test(lower)) {
    return 2;
  }
  if (/세 개|세개|셋|three\b/u.test(lower)) {
    return 3;
  }

  const match = lower.match(/(\d+)\s*(개|편|titles?|papers?)?/u);
  if (match?.[1]) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(20, Math.floor(value));
    }
  }

  return 5;
}

function detectQueryLanguage(text: string): "ko" | "en" {
  return /[\p{Script=Hangul}]/u.test(text) ? "ko" : "en";
}

function isGraphNodeId(value: string | undefined): value is GraphNodeId {
  if (!value) {
    return false;
  }
  return AGENT_ORDER.includes(value as GraphNodeId);
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
  if (left.length !== right.length) {
    return false;
  }
  return left.every((command, index) => command.trim() === (right[index] || "").trim());
}

function parseTitleCommandArgs(args: string[]): { title: string; runQuery?: string; error?: string } {
  if (args.length === 0) {
    return {
      title: "",
      error: "Usage: /title <new title> [--run <run>]"
    };
  }

  let runQuery: string | undefined;
  const titleParts: string[] = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    const token = args[idx];
    if (token === "--run") {
      const runId = args[idx + 1];
      if (!runId) {
        return {
          title: "",
          error: "Usage: /title <new title> [--run <run>]"
        };
      }
      runQuery = runId;
      idx += 1;
      continue;
    }
    titleParts.push(token);
  }

  const title = sanitizeTitle(titleParts.join(" "));
  if (!title) {
    return {
      title: "",
      error: "Usage: /title <new title> [--run <run>]"
    };
  }

  return { title, runQuery };
}

function sanitizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").slice(0, 120);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTitleIntentCandidate(raw: string): string {
  let out = raw.replace(/\s+/g, " ").trim();
  const leadingPatterns = [
    /^(?:논문(?:을|들)?\s*(?:모두|전부|전체)?\s*(?:삭제|제거|지워|없애)(?:하고|한 뒤|후에)\s*)/u,
    /^(?:현재\s*논문(?:을|들)?\s*(?:모두|전부|전체)?\s*(?:삭제|제거|지워|없애)(?:하고|한 뒤|후에)\s*)/u,
    /^(?:clear|delete|remove)\s+(?:all\s+)?papers?\s*(?:and|then)\s*/iu
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadingPatterns) {
      const next = out.replace(pattern, "").trim();
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

function buildTitleCommand(title: string, runId: string): string {
  const escaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `/title "${escaped}" --run ${runId}`;
}

function parseAnalyzeRunArgs(args: string[]): { runQuery?: string; topN?: number; error?: string } {
  const runParts: string[] = [];
  let topN: number | undefined;

  for (let idx = 0; idx < args.length; idx += 1) {
    const token = args[idx];
    if (token === "--top-n") {
      const value = args[idx + 1];
      if (!value) {
        return { error: "Usage: /agent run analyze_papers [run] [--top-n <n>]" };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: "Usage: /agent run analyze_papers [run] [--top-n <n>]" };
      }
      topN = Math.floor(parsed);
      idx += 1;
      continue;
    }
    runParts.push(token);
  }

  return {
    runQuery: runParts.join(" ").trim() || undefined,
    topN
  };
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

  for (let idx = 0; idx < args.length; idx += 1) {
    const token = args[idx];
    if (token === "--top-k") {
      const value = args[idx + 1];
      if (!value) {
        return { error: "Usage: /agent run generate_hypotheses [run] [--top-k <n>] [--branch-count <n>]" };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: "Usage: /agent run generate_hypotheses [run] [--top-k <n>] [--branch-count <n>]" };
      }
      topK = Math.floor(parsed);
      idx += 1;
      continue;
    }
    if (token === "--branch-count") {
      const value = args[idx + 1];
      if (!value) {
        return { error: "Usage: /agent run generate_hypotheses [run] [--top-k <n>] [--branch-count <n>]" };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 1) {
        return { error: "Usage: /agent run generate_hypotheses [run] [--top-k <n>] [--branch-count <n>]" };
      }
      branchCount = Math.floor(parsed);
      idx += 1;
      continue;
    }
    runParts.push(token);
  }

  if (typeof topK === "number" && typeof branchCount === "number" && branchCount < topK) {
    return { error: "--branch-count must be greater than or equal to --top-k" };
  }

  return {
    runQuery: runParts.join(" ").trim() || undefined,
    topK,
    branchCount
  };
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
  if (
    missingApiKey ||
    request.filters.openAccessPdf === true ||
    (request.filters.publicationTypes?.length ?? 0) > 0 ||
    (request.filters.fieldsOfStudy?.length ?? 0) > 0 ||
    (request.filters.venues?.length ?? 0) > 0 ||
    typeof request.filters.minCitationCount === "number"
  ) {
    return 50;
  }
  return 100;
}

function isSemanticScholarRateLimitFailure(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /semantic scholar/i.test(message) && (/\b429\b/.test(message) || /rate limit/i.test(message));
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function readNestedUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return toNonEmptyString(record.url);
}

function looksLikePdfUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return /\.pdf($|[?#])/i.test(url);
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

function isWordDeleteShortcut(str: string, key: readline.Key): boolean {
  if (key.ctrl && key.name === "w") {
    return true;
  }

  // Some terminals encode Option+Backspace as ESC + DEL in raw mode.
  return str === "\u001b\u007f";
}

function isLineDeleteShortcut(str: string, key: readline.Key): boolean {
  if (key.ctrl && key.name === "u") {
    return true;
  }

  // Command+Backspace is often mapped to meta+backspace in terminal emulators.
  if (key.meta && key.name === "backspace" && str !== "\u001b\u007f") {
    return true;
  }

  return str === "\u0015";
}

function isWordMoveLeftShortcut(str: string, key: readline.Key): boolean {
  if (key.meta && key.name === "b") {
    return true;
  }

  // Common encodings for Option/Alt + Left.
  return str === "\u001bb" || str === "\u001b[1;3D";
}

function isWordMoveRightShortcut(str: string, key: readline.Key): boolean {
  if (key.meta && key.name === "f") {
    return true;
  }

  // Common encodings for Option/Alt + Right.
  return str === "\u001bf" || str === "\u001b[1;3C";
}

function isLineMoveLeftShortcut(str: string, key: readline.Key): boolean {
  if (key.ctrl && key.name === "a") {
    return true;
  }
  if (key.name === "home") {
    return true;
  }
  if (key.meta && key.name === "left") {
    return true;
  }

  // Common encodings for Home / Command+Left.
  return str === "\u001b[H" || str === "\u001bOH" || str === "\u001b[1~" || str === "\u001b[1;9D";
}

function isLineMoveRightShortcut(str: string, key: readline.Key): boolean {
  if (key.ctrl && key.name === "e") {
    return true;
  }
  if (key.name === "end") {
    return true;
  }
  if (key.meta && key.name === "right") {
    return true;
  }

  // Common encodings for End / Command+Right.
  return str === "\u001b[F" || str === "\u001bOF" || str === "\u001b[4~" || str === "\u001b[1;9C";
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
      return ["experiment.py"];
    case "run_experiments":
      return ["exec_logs/observations.jsonl", "exec_logs/run_experiments.txt", "metrics.json"];
    case "analyze_results":
      return ["figures", "metrics.json", "result_analysis.json", "result_analysis_synthesis.json"];
    case "review":
      return [
        "review/review_packet.json",
        "review/checklist.md",
        "review/findings.jsonl",
        "review/scorecard.json",
        "review/consistency_report.json",
        "review/bias_report.json",
        "review/revision_plan.json",
        "review/decision.json"
      ];
    case "write_paper":
      return ["paper/main.tex", "paper/references.bib", "paper/evidence_links.json"];
    default:
      return [];
  }
}

function nodeContextKeys(node: GraphNodeId): string[] {
  switch (node) {
    case "collect_papers":
      return [
        "collect_papers.count",
        "collect_papers.source",
        "collect_papers.last_error",
        "collect_papers.last_attempt_count",
        "collect_papers.requested_limit",
        "collect_papers.request",
        "collect_papers.last_request",
        "collect_papers.last_result"
      ];
    case "analyze_papers":
      return [
        "analyze_papers.request",
        "analyze_papers.evidence_count",
        "analyze_papers.summary_count",
        "analyze_papers.full_text_count",
        "analyze_papers.abstract_fallback_count",
        "analyze_papers.selected_count",
        "analyze_papers.total_candidates",
        "analyze_papers.selection_fingerprint"
      ];
    case "generate_hypotheses":
      return [
        "generate_hypotheses.request",
        "generate_hypotheses.top_k",
        "generate_hypotheses.candidate_count",
        "generate_hypotheses.source",
        "generate_hypotheses.pipeline",
        "generate_hypotheses.summary"
      ];
    case "design_experiments":
      return ["design_experiments.primary"];
    case "implement_experiments":
      return ["implement_experiments.script"];
    case "analyze_results":
      return ["analyze_results.last_summary", "analyze_results.last_error", "analyze_results.last_synthesis"];
    case "review":
      return [
        "review.packet",
        "review.last_summary",
        "review.last_recommendation",
        "review.last_decision",
        "review.last_findings_count",
        "review.last_panel_agreement"
      ];
    default:
      return [];
  }
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

  if (filters.fieldsOfStudy && filters.fieldsOfStudy.length > 0) {
    normalized.fieldsOfStudy = filters.fieldsOfStudy;
  }
  if (filters.venues && filters.venues.length > 0) {
    normalized.venues = filters.venues;
  }
  if (filters.publicationTypes && filters.publicationTypes.length > 0) {
    normalized.publicationTypes = filters.publicationTypes;
  }
  if (typeof filters.minCitationCount === "number" && filters.minCitationCount > 0) {
    normalized.minCitationCount = Math.floor(filters.minCitationCount);
  }
  if (filters.openAccessPdf) {
    normalized.openAccessPdf = true;
  }

  return normalized;
}

async function countJsonl(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
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
    let count = 0;
    for (const entry of entries) {
      if (entry.isFile()) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function readAnalyzeSelectionCount(manifestPath: string): Promise<{ selected: number; total: number } | undefined> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as {
      selectedPaperIds?: unknown;
      totalCandidates?: unknown;
    };
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

function detectInitialGuidanceLanguage(): GuidanceLanguage {
  const locale =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    process.env.LANGUAGE ||
    "";
  return /\bko(?:_|-|\.)?/i.test(locale) ? "ko" : "en";
}
