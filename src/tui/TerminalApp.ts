import process from "node:process";
import readline from "node:readline";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

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
  RECOMMENDED_CODEX_MODEL,
  resolveCodexModelSelection
} from "../integrations/codex/modelCatalog.js";
import {
  OPENAI_RESPONSES_MODEL_OPTIONS,
  getOpenAiResponsesReasoningOptions,
  normalizeOpenAiResponsesModel,
  normalizeOpenAiResponsesReasoningEffort,
  supportsOpenAiResponsesReasoning
} from "../integrations/openai/modelCatalog.js";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_RESEARCH_MODEL,
  DEFAULT_OLLAMA_EXPERIMENT_MODEL,
  DEFAULT_OLLAMA_VISION_MODEL,
  OLLAMA_CHAT_MODEL_OPTIONS,
  OLLAMA_RESEARCH_MODEL_OPTIONS,
  OLLAMA_EXPERIMENT_MODEL_OPTIONS,
  OLLAMA_VISION_MODEL_OPTIONS
} from "../integrations/ollama/modelCatalog.js";
import { buildSuggestions } from "./commandPalette/suggest.js";
import { SLASH_COMMANDS } from "./commandPalette/commands.js";
import { parseSlashCommand, tokenizeShellLike } from "../core/commands/parseSlash.js";
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
import { askLine } from "../utils/prompt.js";
import { ensureDir, fileExists } from "../utils/fs.js";
import { getDefaultPdfAnalysisModeForLlmMode, getPdfAnalysisModeForConfig, resolveOpenAiApiKey, upsertEnvVar } from "../config.js";
import { AgentOrchestrator } from "../core/agents/agentOrchestrator.js";
import { AutonomousRunController, buildDefaultOvernightPolicy, buildDefaultAutonomousPolicy } from "../core/agents/autonomousRunController.js";
import { RunContextMemory } from "../core/memory/runContextMemory.js";
import { parseAnalysisReport } from "../core/resultAnalysis.js";
import {
  extractRunBrief,
  looksLikeRunBriefRequest,
  summarizeRunBrief
} from "../core/runs/runBriefParser.js";
import { InteractiveRunSupervisor } from "../core/runs/interactiveRunSupervisor.js";
import { HumanInterventionRequest } from "../core/humanIntervention.js";
import {
  createResearchBriefFile,
  findLatestResearchBrief,
  parseManuscriptFormatFromBrief,
  resolveResearchBriefPath,
  snapshotResearchBriefToRun,
  summarizeBriefValidation,
  validateResearchBriefDraftMarkdown,
  validateResearchBriefFile
} from "../core/runs/researchBriefFiles.js";
import {
  buildReviewInsightCard,
  formatReviewPacketLines,
  parseReviewPacket
} from "../core/reviewPacket.js";
import {
  buildAnalyzeResultsInsightCard,
  formatAnalyzeResultsArtifactLines
} from "../core/resultAnalysisPresentation.js";
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
import { getAppVersion } from "./version.js";
import { buildAnimatedStatusText, buildFrame, buildThinkingText, RenderFrameOutput, SelectionMenuOption } from "./renderFrame.js";
import { applyCodexSurfaceTheme, parseTerminalBackgroundResponse, supportsColor, TUI_THEME, type RgbColor } from "./theme.js";
import { OpenAiResponsesTextClient } from "../integrations/openai/responsesTextClient.js";
import { OllamaClient } from "../integrations/ollama/ollamaClient.js";
import { OllamaLLMClient } from "../core/llm/client.js";
import {
  GENERAL_CHAT_SLOT_LABEL,
  RECOMMENDED_FOR_RESEARCH_BACKEND,
  RESEARCH_BACKEND_SLOT_LABEL,
  RESEARCH_BACKEND_UPDATED_LOG,
  SELECT_RESEARCH_BACKEND_REASONING_PROMPT,
  getSelectModelPrompt
} from "../modelSlotText.js";
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
  applyEventToRunProjection,
  mergeProjectedRunState,
  normalizeRunForDisplay,
  projectRunForDisplay,
  resolveFailedNode,
  RunDisplayProjection,
  RunProjectionHints
} from "./runProjection.js";
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

const COLLECT_SUMMARY_PREFIXES = ["Semantic Scholar stored", "Artifacts cleared for collect_papers"];

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

interface PendingHumanInterventionState {
  runId: string;
  request: HumanInterventionRequest;
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

const ENABLE_KEYBOARD_ENHANCEMENT = "\x1b[>7u";
const DISABLE_KEYBOARD_ENHANCEMENT = "\x1b[<u";
const ENABLE_MODIFY_OTHER_KEYS = "\x1b[>4;1m";
const DISABLE_MODIFY_OTHER_KEYS = "\x1b[>4;0m";
const ENABLE_MOUSE_SGR = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE_SGR = "\x1b[?1006l\x1b[?1000l";
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const X10_MOUSE_RE = /\x1b\[M[\s\S]{3}/;
const SHIFT_ENTER_SEQUENCES = new Set(["\x1b[13;2u", "\x1b[27;2;13~", "\x1b[27;13;2~"]);
const SHIFT_ENTER_CODES = new Set(["[13;2u", "[27;2;13~", "[27;13;2~"]);
const SHIFT_ENTER_SEQUENCE_LIST = [...SHIFT_ENTER_SEQUENCES];
const MAX_SHIFT_ENTER_SEQUENCE_LENGTH = SHIFT_ENTER_SEQUENCE_LIST.reduce(
  (max, sequence) => Math.max(max, sequence.length),
  0
);
const STALE_RUNNING_NODE_RECOVERY_MS = 5 * 60 * 1000;

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
  private readonly interactiveSupervisor: InteractiveRunSupervisor;
  private readonly appVersion = getAppVersion();
  private readonly colorEnabled = supportsColor();
  private recoveredStaleSessionLock = false;

  private input = "";
  private cursorIndex = 0;
  private commandHistory: string[] = [];
  private historyCursor = -1;
  private historyDraft = "";
  private historyLoadedRunId?: string;
  private logs: string[] = [];
  private transientLogs: string[] = [];
  private suggestions: SuggestionItem[] = [];
  private selectedSuggestion = 0;
  private transcriptScrollOffset = 0;
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
  private activeBusyPromise?: Promise<void>;
  private shutdownAbortGraceMs = 1500;
  private creatingRunFromBrief = false;
  private creatingRunTargetId?: string;
  private collectProgress?: CollectProgressState;
  private analyzeProgress?: AnalyzeProgressState;
  private readonly runProjectionHints = new Map<string, RunProjectionHints>();
  private readonly corpusInsightsCache = new Map<string, CorpusInsightsCacheEntry>();
  private stopped = false;
  private resolver?: () => void;
  private processTerminationCleanupStarted = false;
  private readonly signalExitHandlers = new Map<NodeJS.Signals, () => void>();
  private uncaughtExceptionHandler?: (error: Error) => void;
  private unhandledRejectionHandler?: (reason: unknown) => void;
  private unsubscribeEvents?: () => void;
  private lastRenderedFrame?: RenderFrameOutput;
  private pendingNaturalCommand?: PendingNaturalCommandState;
  private pendingHumanIntervention?: PendingHumanInterventionState;
  private announcedHumanInterventionId?: string;
  private guidanceLanguage: GuidanceLanguage = detectInitialGuidanceLanguage();
  private enhancedNewlineSupported = detectLikelyEnhancedNewlineSupport();
  private suppressEnhancedEnterUntil = 0;
  private suppressTerminalQueryKeypressesUntil = 0;
  private rawKeyboardSequenceBuffer = "";
  private rawTerminalQueryBuffer = "";
  private mouseTrackingEnabled = false;
  private commandModeDraft?: { input: string; cursor: number };
  private suppressMouseKeypresses = false;

  private readonly keypressHandler = (str: string, key: readline.Key) => {
    void this.handleKeypress(str, key);
  };

  private readonly rawInputHandler = (chunk: Buffer) => {
    this.handleRawKeyboardData(chunk);
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
    this.interactiveSupervisor = new InteractiveRunSupervisor(process.cwd(), deps.runStore, deps.orchestrator);
    this.onQuit = deps.onQuit;
    this.saveConfigFn = deps.saveConfig;
  }

  markRecoveredStaleSessionLock(): void {
    this.recoveredStaleSessionLock = true;
  }

  async start(): Promise<void> {
    // Prevent unhandled EIO/EPIPE crashes when stdout disconnects
    process.stdout.on("error", () => {
      this.stopped = true;
    });

    await this.refreshRunIndex();
    if (this.activeRunId) {
      await this.loadHistoryForRun(this.activeRunId);
      const recoverRecentNode = this.recoveredStaleSessionLock;
      this.recoveredStaleSessionLock = false;
      await this.recoverStaleRunningNode(this.activeRunId, recoverRecentNode);
    }
    this.unsubscribeEvents = this.eventStream.subscribe((event) => {
      void this.handleStreamEvent(event);
    });
    this.attachProcessTerminationHandlers();
    await this.attachKeyboard();
    this.render();

    await new Promise<void>((resolve) => {
      this.resolver = resolve;
    });
  }

  private async attachKeyboard(): Promise<void> {
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    if (process.stdout.isTTY) {
      applyCodexSurfaceTheme(await resolveTerminalBackground(process.stdin, process.stdout));
      process.stdout.write(ENABLE_KEYBOARD_ENHANCEMENT);
      process.stdout.write(ENABLE_MODIFY_OTHER_KEYS);
      this.mouseTrackingEnabled = this.shouldEnableMouseTracking();
      if (this.mouseTrackingEnabled) {
        process.stdout.write(ENABLE_MOUSE_SGR);
      }
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.prependListener("data", this.rawInputHandler);
    process.stdin.on("keypress", this.keypressHandler);
  }

  private detachKeyboard(): void {
    process.stdin.off("keypress", this.keypressHandler);
    process.stdin.off("data", this.rawInputHandler);
    if (process.stdout.isTTY) {
      if (this.mouseTrackingEnabled) {
        process.stdout.write(DISABLE_MOUSE_SGR);
      }
      process.stdout.write(DISABLE_MODIFY_OTHER_KEYS);
      process.stdout.write(DISABLE_KEYBOARD_ENHANCEMENT);
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    this.rawKeyboardSequenceBuffer = "";
    this.mouseTrackingEnabled = false;
  }

  private shouldEnableMouseTracking(): boolean {
    const term = (process.env.TERM ?? "").toLowerCase();
    const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
    return !(process.env.TMUX || termProgram === "tmux" || term.startsWith("screen"));
  }

  private isReturnKey(key: readline.Key): boolean {
    return key.name === "return" || key.name === "enter";
  }

  private isShiftEnterSequence(str: string, key: readline.Key): boolean {
    const maybeSequence = typeof (key as readline.Key & { sequence?: string }).sequence === "string"
      ? (key as readline.Key & { sequence?: string }).sequence!
      : str;
    const maybeCode = typeof (key as readline.Key & { code?: string }).code === "string"
      ? (key as readline.Key & { code?: string }).code!
      : "";
    return SHIFT_ENTER_SEQUENCES.has(maybeSequence) || SHIFT_ENTER_CODES.has(maybeCode);
  }

  private shouldIgnoreEnhancedEnterEcho(key: readline.Key): boolean {
    if (!this.isReturnKey(key)) {
      return false;
    }
    if (Date.now() > this.suppressEnhancedEnterUntil) {
      return false;
    }
    this.suppressEnhancedEnterUntil = 0;
    return true;
  }

  private handleRawKeyboardData(chunk: Buffer): void {
    if (this.stopped) {
      return;
    }

    const text = chunk.toString("utf8");
    if (!text) {
      return;
    }

    // Handle SGR mouse events
    const mouseMatch = SGR_MOUSE_RE.exec(text);
    if (mouseMatch) {
      // Suppress any keypress events readline emits from this mouse data
      this.suppressMouseKeypresses = true;
      process.nextTick(() => { this.suppressMouseKeypresses = false; });

      const button = Number.parseInt(mouseMatch[1], 10);
      // button 64 = scroll up, button 65 = scroll down
      if (button === 64) {
        this.scrollTranscriptBy(3);
        return;
      }
      if (button === 65) {
        this.scrollTranscriptBy(-3);
        return;
      }
      // Ignore other mouse events (clicks, moves)
      return;
    }

    // Handle X10/basic mouse events (fallback for terminals without SGR)
    if (X10_MOUSE_RE.test(text)) {
      this.suppressMouseKeypresses = true;
      process.nextTick(() => { this.suppressMouseKeypresses = false; });
      return;
    }

    const terminalQueryStart = `${this.rawTerminalQueryBuffer}${text}`.slice(-512);
    const osc11Index = terminalQueryStart.lastIndexOf("\x1b]11;");
    if (osc11Index !== -1) {
      this.rawTerminalQueryBuffer = terminalQueryStart.slice(osc11Index);
      this.suppressTerminalQueryKeypressesUntil = Date.now() + 120;
      if (parseTerminalBackgroundResponse(this.rawTerminalQueryBuffer)) {
        this.rawTerminalQueryBuffer = "";
      }
      return;
    }
    if (this.rawTerminalQueryBuffer) {
      this.rawTerminalQueryBuffer = `${this.rawTerminalQueryBuffer}${text}`.slice(-512);
      this.suppressTerminalQueryKeypressesUntil = Date.now() + 120;
      if (parseTerminalBackgroundResponse(this.rawTerminalQueryBuffer)) {
        this.rawTerminalQueryBuffer = "";
      }
      return;
    }

    this.rawKeyboardSequenceBuffer = `${this.rawKeyboardSequenceBuffer}${text}`.slice(
      -MAX_SHIFT_ENTER_SEQUENCE_LENGTH * 2
    );

    let detected = false;
    while (true) {
      const match = findShiftEnterSequenceRange(this.rawKeyboardSequenceBuffer);
      if (!match) {
        break;
      }

      detected = true;
      this.rawKeyboardSequenceBuffer = `${this.rawKeyboardSequenceBuffer.slice(0, match.start)}${this.rawKeyboardSequenceBuffer.slice(match.end)}`;
    }

    if (detected) {
      this.enhancedNewlineSupported = true;
      this.suppressEnhancedEnterUntil = Date.now() + 120;
      this.insertComposerNewline();
      this.rawKeyboardSequenceBuffer = retainRawKeyboardSequenceSuffix(this.rawKeyboardSequenceBuffer);
      return;
    }

    this.rawKeyboardSequenceBuffer = retainRawKeyboardSequenceSuffix(this.rawKeyboardSequenceBuffer);
  }

  private isCtrlNewlineKey(_str: string, key: readline.Key): boolean {
    return Boolean(key.ctrl && (key.name === "j" || key.name === "m"));
  }

  private insertComposerNewline(): void {
    this.exitHistoryBrowsing();
    const next = insertAtCursor(this.input, this.cursorIndex, "\n");
    this.input = next.input;
    this.cursorIndex = next.cursor;
    this.updateSuggestions();
    this.render();
  }

  private isComposerNewlineKey(str: string, key: readline.Key): boolean {
    return (this.isReturnKey(key) && key.shift) || this.isShiftEnterSequence(str, key) || this.isCtrlNewlineKey(str, key);
  }

  private getSelectedSuggestionCommandForEnter(): string | undefined {
    if (this.suggestions.length === 0) {
      return undefined;
    }

    const selected = this.suggestions[this.selectedSuggestion];
    if (!selected) {
      return undefined;
    }

    const command = normalizeSlashPrefix(selected.applyValue).trim();
    if (!isSlashPrefixed(command)) {
      return undefined;
    }

    const commandName = command.replace(/^\//u, "");
    const commandDef = SLASH_COMMANDS.find((slashCommand) => slashCommand.name === commandName);
    if (!commandDef || /[<[].+[>\]]/u.test(commandDef.usage)) {
      return undefined;
    }

    return command;
  }

  private async submitInputText(text: string): Promise<void> {
    const savedDraft = this.commandModeDraft;
    const shouldPreserveDraft = savedDraft && isSlashPrefixed(text);
    const parsedCmd = isSlashPrefixed(text) ? parseSlashCommand(text)?.command : undefined;
    const cmdDef = parsedCmd ? SLASH_COMMANDS.find((c) => c.name === parsedCmd) : undefined;
    const willRestore = shouldPreserveDraft && cmdDef?.preserveDraftOnRun;

    this.commandModeDraft = undefined;
    this.transcriptScrollOffset = 0;
    this.input = "";
    this.cursorIndex = 0;
    this.suggestions = [];
    this.selectedSuggestion = 0;
    this.clearTransientLogs();
    this.render();

    if (!text) {
      return;
    }

    this.updateGuidanceLanguage(text);

    if (!(this.pendingNaturalCommand && !isSlashPrefixed(text) && isConfirmationInput(text))) {
      await this.recordHistory(text);
    }

    if (this.busy) {
      if (this.activeNaturalRequest && !isSlashPrefixed(text)) {
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

    if (willRestore && savedDraft) {
      this.input = savedDraft.input;
      this.cursorIndex = savedDraft.cursor;
      this.updateSuggestions();
      this.render();
    }
  }

  private async handleKeypress(str: string, key: readline.Key): Promise<void> {
    if (this.stopped) {
      return;
    }

    // Suppress keypress events generated from raw terminal escape sequences.
    if (this.suppressMouseKeypresses || Date.now() <= this.suppressTerminalQueryKeypressesUntil) {
      return;
    }

    if (this.shouldIgnoreEnhancedEnterEcho(key)) {
      return;
    }

    if (this.activeSelectionMenu) {
      if (key.ctrl && key.name === "c") {
        await this.shutdown({ abortActive: true });
        return;
      }
      if (key.name === "up" || (key.ctrl && key.name === "p")) {
        this.moveSelectionMenu(-1);
        return;
      }
      if (key.name === "down" || (key.ctrl && key.name === "n")) {
        this.moveSelectionMenu(1);
        return;
      }
      if (this.isReturnKey(key)) {
        this.commitSelectionMenu();
        return;
      }
      if (key.name === "escape") {
        this.cancelSelectionMenu();
        return;
      }
      return;
    }

    if (this.pendingHumanIntervention && this.input.length === 0 && !this.busy && str && !key.ctrl && !key.meta) {
      const ch = str.toLowerCase();
      if (ch === "y") {
        await this.handlePendingHumanInterventionAnswer("y");
        return;
      }
      if (ch === "n") {
        await this.handlePendingHumanInterventionAnswer("n");
        return;
      }
      if (ch === "?") {
        this.announceHumanIntervention(this.pendingHumanIntervention.request);
        this.render();
        return;
      }
    }

    if (key.ctrl && key.name === "c") {
      await this.shutdown({ abortActive: true });
      return;
    }

    if (this.isComposerNewlineKey(str, key)) {
      if ((this.isReturnKey(key) && key.shift) || this.isShiftEnterSequence(str, key)) {
        this.enhancedNewlineSupported = true;
        this.suppressEnhancedEnterUntil = Date.now() + 120;
      }
      this.insertComposerNewline();
      return;
    }

    if (this.isReturnKey(key)) {
      await this.handleEnter();
      return;
    }

    if (key.name === "pageup") {
      this.scrollTranscriptBy(this.resolveTranscriptScrollDelta());
      return;
    }

    if (key.name === "pagedown") {
      this.scrollTranscriptBy(-this.resolveTranscriptScrollDelta());
      return;
    }

    if (key.name === "end") {
      this.scrollTranscriptToLatest();
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

    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      if (this.historyCursor !== -1) {
        if (this.recallPreviousHistory()) {
          this.render();
        }
      } else if (this.suggestions.length > 0) {
        this.exitHistoryBrowsing();
        this.selectedSuggestion =
          (this.selectedSuggestion - 1 + this.suggestions.length) % this.suggestions.length;
        this.render();
      } else if (this.recallPreviousHistory()) {
        this.render();
      }
      return;
    }

    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      if (this.historyCursor !== -1) {
        if (this.recallNextHistory()) {
          this.render();
        }
      } else if (this.suggestions.length > 0) {
        this.exitHistoryBrowsing();
        this.selectedSuggestion = (this.selectedSuggestion + 1) % this.suggestions.length;
        this.render();
      } else if (this.recallNextHistory()) {
        this.render();
      }
      return;
    }

    if (key.name === "escape") {
      if (this.commandModeDraft) {
        this.input = this.commandModeDraft.input;
        this.cursorIndex = this.commandModeDraft.cursor;
        this.commandModeDraft = undefined;
        this.suggestions = [];
        this.selectedSuggestion = 0;
        this.render();
        return;
      }
      if (this.busy) {
        this.cancelCurrentBusyOperation();
        return;
      }
      this.suggestions = [];
      this.selectedSuggestion = 0;
      this.render();
      return;
    }

    if (key.ctrl && key.name === "x") {
      if (!this.commandModeDraft && this.input.length > 0 && !isSlashPrefixed(this.input)) {
        this.commandModeDraft = { input: this.input, cursor: this.cursorIndex };
        this.input = "/";
        this.cursorIndex = 1;
        this.updateSuggestions();
        this.render();
      }
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
    if (!isSlashPrefixed(this.input) || this.input.includes("\n") || !this.isCursorInsideFirstLineSlashToken()) {
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

  private isCursorInsideFirstLineSlashToken(): boolean {
    const firstLine = this.input.split("\n")[0] ?? "";
    const firstSpaceIndex = firstLine.search(/\s/u);
    const token = firstSpaceIndex === -1 ? firstLine : firstLine.slice(0, firstSpaceIndex);
    const tokenLength = Array.from(token).length;
    const beforeCursor = Array.from(this.input).slice(0, Math.max(0, this.cursorIndex)).join("");
    if (beforeCursor.includes("\n")) {
      return false;
    }
    return this.cursorIndex <= tokenLength;
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

  private scrollTranscriptBy(delta: number): void {
    const maxOffset = this.lastRenderedFrame?.maxTranscriptScrollOffset ?? 0;
    if (maxOffset <= 0 && delta >= 0) {
      return;
    }
    this.transcriptScrollOffset = Math.min(maxOffset, Math.max(0, this.transcriptScrollOffset + delta));
    this.render();
  }

  private scrollTranscriptToLatest(): void {
    if (this.transcriptScrollOffset === 0) {
      return;
    }
    this.transcriptScrollOffset = 0;
    this.render();
  }

  private resolveTranscriptScrollDelta(): number {
    return Math.max(3, Math.floor(this.resolveTerminalHeight() * 0.5));
  }

  private resolveNewlineHintLabel(): string {
    return this.enhancedNewlineSupported ? "Shift+Enter newline" : "Ctrl+J newline";
  }

  private shouldCompleteSuggestionOnEnter(text: string): boolean {
    if (this.suggestions.length === 0 || !isSlashPrefixed(text)) {
      return false;
    }

    const trimmed = text.trim();
    if (!trimmed || /\s/u.test(trimmed)) {
      return false;
    }

    const selected = this.suggestions[this.selectedSuggestion];
    if (!selected) {
      return false;
    }

    const selectedCommand = selected.applyValue.trim();
    if (trimmed !== selectedCommand) {
      return true;
    }

    const commandName = trimmed.replace(/^\//u, "");
    const commandDef = SLASH_COMMANDS.find((command) => command.name === commandName);
    return Boolean(commandDef && /[<[].+[>\]]/u.test(commandDef.usage));
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
    const normalizedInput = normalizeSlashPrefix(this.input);
    const selectedSuggestionCommand = this.getSelectedSuggestionCommandForEnter();
    if (selectedSuggestionCommand) {
      await this.submitInputText(selectedSuggestionCommand);
      return;
    }

    if (this.shouldCompleteSuggestionOnEnter(normalizedInput)) {
      this.autocompleteSelectedSuggestion();
      this.render();
      return;
    }

    await this.submitInputText(normalizedInput.trim());
  }

  private async executeInput(text: string): Promise<void> {
    if (!text) {
      return;
    }

    if (this.pendingHumanIntervention && !isSlashPrefixed(text)) {
      await this.handlePendingHumanInterventionAnswer(text);
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
          this.pushLog("Confirmed. Running the pending step.");
        } else if (runAllRemaining) {
          this.pushLog(`Confirmed. Running all remaining steps from ${stepNumber}/${pending.totalSteps}.`);
        } else {
          this.pushLog(`Confirmed. Running step ${stepNumber}/${pending.totalSteps}.`);
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
      this.pushLog("A pending step is ready.");
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
    const busyPromise = (async () => {
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
        if (!this.stopped) {
          void this.drainQueuedInputs();
        }
      }
    })();
    this.activeBusyPromise = busyPromise;
    try {
      await busyPromise;
    } finally {
      if (this.activeBusyPromise === busyPromise) {
        this.activeBusyPromise = undefined;
      }
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

    const run = await this.resolveTargetRun(undefined);
    if (run) {
      const hypothesisInsights = await this.readHypothesisInsights(run.id);

      if (isHypothesisCountIntent(text)) {
        this.pushLog(`There are ${hypothesisInsights.totalHypotheses} saved hypotheses in the current run.`);
        return true;
      }

      if (isHypothesisListIntent(text)) {
        if (hypothesisInsights.totalHypotheses === 0) {
          this.pushLog("No saved hypotheses were found in the current run.");
          return true;
        }

        const limit = extractRequestedHypothesisCount(text);
        const texts = hypothesisInsights.texts.slice(0, limit);
        this.pushLog(`Showing ${texts.length} of ${hypothesisInsights.totalHypotheses} saved hypotheses.`);
        texts.forEach((item, idx) => {
          this.pushLog(`${idx + 1}. ${item}`);
        });
        return true;
      }

      const insights = await this.readCorpusInsights(run.id);

      if (isMissingPdfCountIntent(text)) {
        if (insights.totalPapers === 0) {
          this.pushLog("No collected papers were found in the current run.");
          return true;
        }
        this.pushLog(`Papers without a PDF path: ${insights.missingPdfCount} (out of ${insights.totalPapers}).`);
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
      case "brief":
        return this.handleBriefCommand(args, abortSignal);
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
      case "clear":
        this.handleClear();
        return { ok: true };
      case "queue":
        this.handleQueue(args);
        return { ok: true };
      case "inspect":
        this.handleInspect();
        return { ok: true };
      case "session":
        this.handleSession();
        return { ok: true };
      case "knowledge":
        await this.handleKnowledge(args);
        return { ok: true };
      case "stats":
        this.handleStats();
        return { ok: true };
      case "terminal-setup":
        this.handleTerminalSetup();
        return { ok: true };
      case "theme":
        this.handleThemeInfo();
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
    this.pushLog("Flow:");
    this.pushLog("/new");
    this.pushLog("/brief start <path|--latest>");
    this.pushLog("/approve");
    this.pushLog("/knowledge [run]");
    this.pushLog("");
    this.pushLog("Controls:");
    this.pushLog("Press Tab when the input is empty to insert the suggested next step.");
    this.pushLog("Use /approve when the run pauses for review.");
    this.pushLog("Add steering at any time to redirect the current plan.");
    this.pushLog("");
    this.pushLog("Notes:");
    this.pushLog("Create a Markdown Research Brief first. The UI then keeps the main loop to run, approve, and steering.");
    this.pushLog("Advanced slash commands still exist, but they are intentionally out of the main path.");
  }

  private handleClear(): void {
    this.logs = [];
    this.clearTransientLogs();
    this.render();
  }

  private handleQueue(args: string[]): void {
    const sub = args[0]?.toLowerCase();
    if (sub === "clear") {
      const count = this.queuedInputs.length;
      this.queuedInputs = [];
      this.pushTransientLog(`Cleared ${count} queued input(s).`);
      this.render();
      return;
    }
    if (sub === "drop" || sub === "delete") {
      const idx = Number.parseInt(args[1] ?? "", 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < this.queuedInputs.length) {
        const removed = this.queuedInputs.splice(idx, 1)[0];
        this.pushTransientLog(`Removed queued item ${idx}: ${oneLine(removed ?? "")}`);
      } else {
        this.pushTransientLog(`Invalid queue index. Queue has ${this.queuedInputs.length} item(s).`);
      }
      this.render();
      return;
    }
    if (this.queuedInputs.length === 0) {
      this.pushTransientLog("Queue is empty.");
    } else {
      this.pushTransientLog(`Queued inputs (${this.queuedInputs.length}):`);
      for (const [i, queued] of this.queuedInputs.entries()) {
        this.pushTransientLog(`  ${i}: ${oneLine(queued)}`);
      }
    }
    this.render();
  }

  private handleInspect(): void {
    const run = this.getRenderableRun();
    const termWidth = this.resolveTerminalWidth();
    const termHeight = this.resolveTerminalHeight();
    this.pushTransientLog("Session diagnostics:");
    this.pushTransientLog(`  workspace: ${this.getWorkspaceLabel()}`);
    this.pushTransientLog(`  active run: ${run ? `${run.id} (${run.title})` : "none"}`);
    this.pushTransientLog(`  current node: ${run ? `${run.currentNode} ${run.graph.nodeStates[run.currentNode]?.status ?? ""}` : "n/a"}`);
    this.pushTransientLog(`  pending approval: ${this.pendingHumanIntervention ? "yes" : "no"}`);
    this.pushTransientLog(`  model: ${this.getCompactModelLabel() || "default"}`);
    this.pushTransientLog(`  queue: ${this.queuedInputs.length}`);
    this.pushTransientLog(`  terminal: ${termWidth}×${termHeight}`);
    this.pushTransientLog(`  tmux: ${process.env.TMUX ? "yes" : "no"}`);
    this.pushTransientLog(`  multiline: ${this.enhancedNewlineSupported ? "Shift+Enter" : "Ctrl+J"}`);
    this.render();
  }

  private handleSession(): void {
    const run = this.getRenderableRun();
    if (!run) {
      this.pushTransientLog("No active run. Use /new to create a Research Brief.");
      this.render();
      return;
    }
    this.pushTransientLog("Active run:");
    this.pushTransientLog(`  id: ${run.id}`);
    this.pushTransientLog(`  title: ${run.title}`);
    this.pushTransientLog(`  status: ${run.status}`);
    this.pushTransientLog(`  node: ${run.currentNode}`);
    this.pushTransientLog(`  topic: ${run.topic || "n/a"}`);
    if (run.latestSummary) {
      this.pushTransientLog(`  summary: ${oneLine(run.latestSummary)}`);
    }
    this.pushTransientLog(`  draft: ${this.input.length > 0 ? `${this.input.length} chars` : "empty"}`);
    this.pushTransientLog(`  interaction: ${this.busy ? "busy" : this.thinking ? "thinking" : "idle"}`);
    this.render();
  }

  private async handleKnowledge(args: string[]): Promise<void> {
    const index = await readRepositoryKnowledgeIndex(process.cwd());
    const query = args.join(" ").trim() || undefined;

    if (query) {
      const run = await this.resolveTargetRun(query);
      if (!run) {
        this.render();
        return;
      }
      const entry = index.entries.find((item) => item.run_id === run.id);
      if (!entry) {
        this.pushTransientLog(`No repository knowledge entry has been published for ${run.id} yet.`);
      } else {
        for (const line of buildRepositoryKnowledgeEntryLines(entry)) {
          this.pushTransientLog(line);
        }
      }
      for (const line of buildRunLiteratureIndexLines(await writeRunLiteratureIndex(process.cwd(), run.id))) {
        this.pushTransientLog(line);
      }
      this.render();
      return;
    }

    const run = this.getRenderableRun();
    if (run) {
      const activeEntry = index.entries.find((item) => item.run_id === run.id);
      if (activeEntry) {
        for (const line of buildRepositoryKnowledgeEntryLines(activeEntry)) {
          this.pushTransientLog(line);
        }
      }
      for (const line of buildRunLiteratureIndexLines(await writeRunLiteratureIndex(process.cwd(), run.id))) {
        this.pushTransientLog(line);
      }
      this.render();
      return;
    }

    for (const line of buildRepositoryKnowledgeOverviewLines(index.entries)) {
      this.pushTransientLog(line);
    }
    this.render();
  }

  private handleStats(): void {
    this.pushTransientLog("Local session metrics:");
    this.pushTransientLog(`  history entries: ${this.commandHistory.length}`);
    this.pushTransientLog(`  queued inputs: ${this.queuedInputs.length}`);
    this.pushTransientLog(`  transcript lines: ${this.logs.length}`);
    this.pushTransientLog(`  runs loaded: ${this.runIndex.length}`);
    this.render();
  }

  private handleTerminalSetup(): void {
    const termWidth = this.resolveTerminalWidth();
    const termHeight = this.resolveTerminalHeight();
    this.pushTransientLog("Terminal setup:");
    this.pushTransientLog(`  TMUX: ${process.env.TMUX ? "detected" : "not detected"}`);
    this.pushTransientLog(`  TERM: ${process.env.TERM ?? "unset"}`);
    this.pushTransientLog(`  COLORTERM: ${process.env.COLORTERM ?? "unset"}`);
    this.pushTransientLog(`  color: ${this.colorEnabled ? "enabled" : "disabled"}`);
    this.pushTransientLog(`  size: ${termWidth}×${termHeight}`);
    this.pushTransientLog(`  multiline: ${this.enhancedNewlineSupported ? "Shift+Enter observed" : "Ctrl+J fallback"}`);
    this.pushTransientLog(`  newline hint: ${this.resolveNewlineHintLabel()}`);
    this.render();
  }

  private handleThemeInfo(): void {
    this.pushTransientLog("Current theme info:");
    this.pushTransientLog(`  color: ${this.colorEnabled ? "enabled" : "disabled"}`);
    this.pushTransientLog(`  accent: ${TUI_THEME.accent}`);
    this.pushTransientLog(`  composerBg: ${TUI_THEME.composerBg ?? "transparent"}`);
    this.pushTransientLog(`  panelBg: ${TUI_THEME.panelBg ?? "transparent"}`);
    this.render();
  }

  private async handleNewRun(): Promise<void> {
    const filePath = await createResearchBriefFile(process.cwd());
    this.pushLog(`Created research brief: ${filePath}`);

    const openedInEditor = await this.openResearchBriefInEditor(filePath);
    if (!openedInEditor) {
      this.pushLog("Edit the brief, then start it with /brief start --latest or /brief start <path>.");
      return;
    }

    const brief = await fs.readFile(filePath, "utf8");
    const draftValidation = validateResearchBriefDraftMarkdown(brief);
    for (const line of summarizeBriefValidation(draftValidation)) {
      this.pushLog(line);
    }
    if (draftValidation.errors.length > 0) {
      this.pushLog("The Research Brief needs a substantive Topic before it can be used as a working draft.");
      return;
    }

    const validation = await validateResearchBriefFile(filePath);
    if (validation.errors.length > 0) {
      this.pushLog(
        "Draft saved. Fill the remaining paper-scale sections, then start it with /brief start --latest or /brief start <path>."
      );
      return;
    }

    const autoStartAnswer = await this.askWithinTui("Start research from this brief now? (Y/n)", "Y");
    if (!["n", "no"].includes(autoStartAnswer.trim().toLowerCase())) {
      await this.startRunFromBriefPath(filePath);
    }
  }

  private async createRunFromBrief(input: {
    brief: string;
    topic?: string;
    constraints?: string[];
    objectiveMetric?: string;
    autoStart?: boolean;
    abortSignal?: AbortSignal;
    sourcePath?: string;
  }): Promise<RunRecord> {
    this.creatingRunFromBrief = true;
    this.creatingRunTargetId = undefined;
    this.render();
    try {
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
      this.pushLog(`Generating run title with ${this.describePrimaryLlmProvider(this.config.providers.llm_mode)}...`);
      this.render();

      const title = await this.titleGenerator.generateTitle(
        extracted.topic,
        extracted.constraints,
        extracted.objectiveMetric
      );
      const run = await this.runStore.createRun({
        title,
        topic: extracted.topic,
        constraints: extracted.constraints,
        objectiveMetric: extracted.objectiveMetric
      });
      this.creatingRunTargetId = run.id;
      await this.refreshRunIndex();
      await this.setActiveRunId(run.id);
      this.render();

      const runContext = new RunContextMemory(this.resolveWorkspacePath(run.memoryRefs.runContextPath));
      await runContext.put("run_brief.raw", input.brief);
      await runContext.put("run_brief.extracted", extracted);
      await runContext.put("run_brief.plan_summary", extracted.planSummary || null);
      const manuscriptFormat = parseManuscriptFormatFromBrief(input.brief);
      if (manuscriptFormat) {
        await runContext.put("run_brief.manuscript_format", manuscriptFormat);
      }
      if (input.sourcePath) {
        const resolvedSourcePath = path.isAbsolute(input.sourcePath)
          ? input.sourcePath
          : path.join(process.cwd(), input.sourcePath);
        const snapshotPath = await snapshotResearchBriefToRun(process.cwd(), run.id, resolvedSourcePath);
        await runContext.put("run_brief.source_path", resolvedSourcePath);
        await runContext.put(
          "run_brief.snapshot_path",
          path.relative(process.cwd(), snapshotPath).replace(/\\/g, "/")
        );
      }
      this.creatingRunFromBrief = false;
      this.pushLog(`Created run ${run.id}`);
      this.pushLog(`Title: ${run.title}`);
      this.updateSuggestions();
      this.render();
      if (input.autoStart) {
        await this.startRun(run.id, input.abortSignal);
      }
      return run;
    } finally {
      this.creatingRunFromBrief = false;
      this.creatingRunTargetId = undefined;
    }
  }

  private async startRun(runId: string, abortSignal?: AbortSignal): Promise<RunRecord> {
    await this.setActiveRunId(runId);
    this.pushLog(`Auto-starting research for ${runId} from collect_papers...`);
    this.render();
    return this.continueSupervisedRun(runId, abortSignal);
  }

  private async handleBriefCommand(args: string[], abortSignal?: AbortSignal): Promise<SlashExecutionResult> {
    const normalizedArgs = args.length === 0 ? ["start", "--latest"] : args;
    const [subcommand, ...rest] = normalizedArgs;
    if (subcommand !== "start") {
      this.pushLog("Usage: /brief start <path|--latest>");
      return { ok: false, reason: "invalid /brief usage" };
    }

    const briefArg = rest.join(" ").trim();
    const briefPath =
      briefArg === "--latest" || !briefArg
        ? await findLatestResearchBrief(process.cwd())
        : resolveResearchBriefPath(process.cwd(), briefArg);
    if (!briefPath) {
      this.pushLog("No research brief file was found. Use /new to create one first.");
      return { ok: false, reason: "research brief not found" };
    }
    if (!(await fileExists(briefPath))) {
      this.pushLog(`Research brief not found: ${briefPath}`);
      return { ok: false, reason: `research brief not found: ${briefPath}` };
    }

    await this.startRunFromBriefPath(briefPath, abortSignal);
    return { ok: true };
  }

  private async startRunFromBriefPath(filePath: string, abortSignal?: AbortSignal): Promise<RunRecord | undefined> {
    const validation = await validateResearchBriefFile(filePath);
    for (const line of summarizeBriefValidation(validation)) {
      this.pushLog(line);
    }
    if (validation.errors.length > 0) {
      this.pushLog("The brief still needs required sections before AutoLabOS can start the run.");
      return undefined;
    }

    const brief = await fs.readFile(filePath, "utf8");
    return this.createRunFromBrief({
      brief,
      sourcePath: filePath,
      autoStart: true,
      abortSignal
    });
  }

  private async continueSupervisedRun(runId: string, abortSignal?: AbortSignal): Promise<RunRecord> {
    const outcome = await this.interactiveSupervisor.runUntilStop(runId, { abortSignal });
    await this.refreshRunIndex();
    await this.setActiveRunId(outcome.run.id);

    if (outcome.status === "awaiting_human") {
      this.pendingHumanIntervention = {
        runId: outcome.run.id,
        request: outcome.request
      };
      this.announceHumanIntervention(outcome.request);
      return outcome.run;
    }

    this.pendingHumanIntervention = undefined;
    this.announcedHumanInterventionId = undefined;

    if (outcome.status === "paused") {
      this.pushLog(`Run paused: ${oneLine(outcome.reason, 220)}`);
      const recommendation = outcome.run.graph.pendingTransition;
      const pausedNodeState = outcome.run.graph.nodeStates[outcome.run.currentNode];
      if (recommendation) {
        this.pushLog(
          `Pending transition: ${recommendation.action} -> ${recommendation.targetNode || "stay"}`
        );
        if (recommendation.evidence[0]) {
          this.pushLog(`Evidence: ${oneLine(recommendation.evidence[0], 220)}`);
        }
      }
      if (pausedNodeState?.status === "needs_approval" || recommendation) {
        this.pushLog("Use /approve to continue, or add steering to revise the next move.");
      } else {
        this.pushLog("No pending approval. Use /retry to rerun the current node, or add steering to revise the next move.");
      }
      return outcome.run;
    }

    if (outcome.status === "completed") {
      this.pushLog(`Research finished: ${oneLine(outcome.summary, 220)}`);
      return outcome.run;
    }

    this.pushLog(`Research stopped: ${oneLine(outcome.summary, 220)}`);
    return outcome.run;
  }

  private async handlePendingHumanInterventionAnswer(answer: string): Promise<void> {
    const pending = this.pendingHumanIntervention;
    if (!pending) {
      return;
    }

    await this.runBusyAction(
      async (abortSignal) => {
        const result = await this.interactiveSupervisor.answerHumanIntervention(
          pending.runId,
          pending.request,
          answer
        );
        if (result.status === "invalid_answer") {
          this.pushLog(result.message);
          this.announcedHumanInterventionId = undefined;
          this.announceHumanIntervention(result.request);
          return;
        }

        this.pushLog(result.message);
        this.pendingHumanIntervention = undefined;
        this.announcedHumanInterventionId = undefined;
        await this.refreshRunIndex();
        await this.setActiveRunId(result.run.id);
        await this.continueSupervisedRun(result.run.id, abortSignal);
      },
      `Answering ${pending.request.sourceNode} question`
    );
  }

  private announceHumanIntervention(request: HumanInterventionRequest): void {
    if (this.announcedHumanInterventionId === request.id) {
      return;
    }
    this.announcedHumanInterventionId = request.id;
    this.pushLog(`Human input required: ${request.title}`);
    this.pushLog(request.question);
    for (const line of request.context) {
      this.pushLog(`- ${oneLine(line, 220)}`);
    }
    if (request.choices?.length) {
      for (const [index, choice] of request.choices.entries()) {
        this.pushLog(`${index + 1}) ${choice.label}${choice.description ? ` - ${choice.description}` : ""}`);
      }
    }
    this.pushLog("Type your answer directly in the TUI. Slash commands still work for manual control.");
  }

  private async openResearchBriefInEditor(filePath: string): Promise<boolean> {
    const editorCommand = process.env.VISUAL || process.env.EDITOR;
    if (!editorCommand) {
      this.pushLog(`No editor configured. Open this file manually: ${filePath}`);
      return false;
    }

    const [command, ...args] = tokenizeShellLike(editorCommand);
    if (!command) {
      this.pushLog(`Could not parse EDITOR command: ${editorCommand}`);
      return false;
    }

    this.detachKeyboard();
    process.stdout.write("\n");
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(command, [...args, filePath], {
        stdio: "inherit",
        env: process.env
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 0));
    }).catch((error) => {
      this.pushLog(`Failed to launch editor: ${error instanceof Error ? error.message : String(error)}`);
      return -1;
    });
    this.attachKeyboard();
    if (exitCode !== 0) {
      this.pushLog(`Editor exited with code ${exitCode}.`);
      return false;
    }
    return true;
  }

  private async handleDoctor(): Promise<void> {
    const report = await runDoctorReport(this.codex, {
      llmMode: this.config.providers.llm_mode,
      pdfAnalysisMode: getPdfAnalysisModeForConfig(this.config),
      openAiApiKeyConfigured: await resolveOpenAiApiKey(process.cwd()).then(Boolean),
      codexResearchModel: this.config.providers.codex.model,
      ollamaBaseUrl: this.config.providers.ollama?.base_url,
      ollamaChatModel: this.config.providers.ollama?.chat_model,
      ollamaResearchModel: this.config.providers.ollama?.research_model,
      ollamaVisionModel: this.config.providers.ollama?.vision_model,
      workspaceRoot: process.cwd(),
      includeHarnessValidation: true,
      includeHarnessTestRecords: false,
      maxHarnessFindings: 30
    });
    for (const line of buildDoctorHighlightLines(report)) {
      this.pushLog(line);
    }
    for (const check of report.checks) {
      const mark = check.ok ? "OK" : "FAIL";
      this.pushLog(`[${mark}] ${check.name}: ${check.detail}`);
    }
    if (report.harness) {
      const mark = report.harness.status === "ok" ? "OK" : "FAIL";
      this.pushLog(
        `[${mark}] harness-validation: ${report.harness.findings.length} issue(s), `
          + `${report.harness.runsChecked} run(s) checked`
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

  private resolveWorkspacePath(maybeRelative: string): string {
    if (path.isAbsolute(maybeRelative)) {
      return maybeRelative;
    }
    return path.join(process.cwd(), maybeRelative);
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
      await this.refreshRunIndex();
      void this.continueSupervisedRun(run.id);
      return { ok: true };
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
        if (parsed.topN) {
          await runContext.put("analyze_papers.request", {
            topN: parsed.topN,
            selectionMode: "top_n",
            selectionPolicy: "hybrid_title_citation_recency_pdf_v2"
          });
        }
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
      let updatedRun = response.run;
      if (this.shouldAutoContinueAfterNodeAdvance(nodeRaw, updatedRun)) {
        updatedRun = await this.continueSupervisedRun(updatedRun.id, abortSignal);
      }
      await this.refreshRunIndex();
      await this.setActiveRunId(updatedRun.id);
      const pendingRequest = await this.interactiveSupervisor.getActiveRequest(updatedRun);
      if (pendingRequest) {
        this.pendingHumanIntervention = {
          runId: updatedRun.id,
          request: pendingRequest
        };
        this.announceHumanIntervention(pendingRequest);
        return { ok: true };
      }
      if (this.wasAgentRunCanceled(updatedRun, nodeRaw)) {
        throw new Error("Operation aborted by user");
      }

      if (response.result.status === "failure" || updatedRun.status === "failed") {
        const failedNode = resolveFailedNode(updatedRun);
        const failedState = updatedRun.graph.nodeStates[failedNode];
        const fallbackFailure =
          failedState.lastError ||
          failedState.note ||
          updatedRun.latestSummary ||
          `${failedNode} failed`;
        const loggedFailureNode = resolveFailureLogNode(updatedRun, failedNode, fallbackFailure);
        const loggedFailureState = updatedRun.graph.nodeStates[loggedFailureNode];
        const failure =
          loggedFailureState.lastError ||
          loggedFailureState.note ||
          fallbackFailure;
        this.pushLog(`Node ${loggedFailureNode} failed: ${failure}`);
        return { ok: false, reason: failure };
      }

      const nodeSummary =
        response.result.summary ||
        updatedRun.graph.nodeStates[nodeRaw].note ||
        updatedRun.latestSummary ||
        `${nodeRaw} executed`;
      this.pushLog(`Node ${nodeRaw} finished: ${oneLine(nodeSummary, 480)}`);
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
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
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
      await this.setActiveRunId(run.id);
      const updatedRun = await this.continueSupervisedRun(run.id, abortSignal);
      if (updatedRun.status === "failed") {
        const failedNode = resolveFailedNode(updatedRun);
        const failedState = updatedRun.graph.nodeStates[failedNode];
        const failure =
          failedState.lastError ||
          failedState.note ||
          updatedRun.latestSummary ||
          `${failedNode} failed`;
        this.pushLog(`Node ${failedNode} failed: ${failure}`);
        return { ok: false, reason: failure };
      }
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
      this.pushLog("Starting autonomy preset: overnight (24-hour limit, conservative safe policy).");
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
      const runQuery = args.slice(1).join(" ").trim() || undefined;
      const run = await this.resolveTargetRun(runQuery);
      if (!run) {
        return { ok: false, reason: "target run not found" };
      }
      this.pushLog("┌──────────────────────────────────────────────────────────────┐");
      this.pushLog("│  AUTONOMOUS MODE — Long-running open-ended research mode    │");
      this.pushLog("│                                                              │");
      this.pushLog("│  • No runtime time limit (runs until stopped or fuse trips)  │");
      this.pushLog("│  • Explores many hypothesis/experiment cycles autonomously   │");
      this.pushLog("│  • Continuously upgrades the strongest paper candidate       │");
      this.pushLog("│  • write_paper gated by minimum evidence bar (review gate)   │");
      this.pushLog("│  • May consume substantially more time and compute           │");
      this.pushLog("│  • May revisit earlier stages many times                     │");
      this.pushLog("│  • NOT optimized for conservative early stopping             │");
      this.pushLog("│  • Stops on: user stop, emergency fuse, or stagnation        │");
      this.pushLog("│  • Progress: .autolabos/runs/<id>/RUN_STATUS.md              │");
      this.pushLog("│  • Press Ctrl+C to stop at any time                          │");
      this.pushLog("└──────────────────────────────────────────────────────────────┘");
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
      if (outcome.noveltySignals && outcome.noveltySignals.length > 0) {
        this.pushLog(`Novelty signals: ${outcome.noveltySignals.length} total`);
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
    const refreshedRun = (await this.runStore.getRun(run.id)) ?? response.run;
    if (this.shouldAutoContinueAfterCollectRecovery(refreshedRun)) {
      const updatedRun = await this.continueSupervisedRun(run.id, abortSignal);
      if (updatedRun.status === "failed") {
        return {
          ok: false,
          reason: updatedRun.latestSummary || updatedRun.graph.nodeStates[updatedRun.currentNode].lastError || "run failed"
        };
      }
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
      this.pushLog("Review remains blocked. Retry the next run step or add steering to revise the plan.");
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
    await this.setActiveRunId(run.id);
    const updatedRun = await this.continueSupervisedRun(run.id);
    if (updatedRun.status === "failed") {
      const failedNode = resolveFailedNode(updatedRun);
      const failedState = updatedRun.graph.nodeStates[failedNode];
      const failure =
        failedState.lastError ||
        failedState.note ||
        updatedRun.latestSummary ||
        `${failedNode} failed`;
      this.pushLog(`Node ${failedNode} failed: ${failure}`);
      return { ok: false, reason: failure };
    }
    return { ok: true };
  }

  private async handleSettings(): Promise<void> {
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

    if (llmMode === "ollama") {
      this.ensureOllamaConfig();
      const baseUrl = await this.askWithinTui(
        "Ollama base URL",
        this.config.providers.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL
      );
      if (!baseUrl.trim()) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.config.providers.ollama!.base_url = baseUrl.trim();

      const chatModel = await this.selectOllamaSlot("chat");
      if (!chatModel) {
        this.pushLog("Settings update canceled.");
        return;
      }
      this.config.providers.ollama!.chat_model = chatModel;
    } else if (llmMode === "codex_chatgpt_only") {
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
    }

    if (!(await this.configureResearchBackend(llmMode as AppConfig["providers"]["llm_mode"], "Settings update canceled."))) {
      return;
    }

    this.config.providers.llm_mode = llmMode as AppConfig["providers"]["llm_mode"];
    if (this.config.providers.llm_mode === "openai_api") {
      this.openAiTextClient?.updateDefaults({
        model: this.config.providers.openai.model,
        reasoningEffort: this.config.providers.openai.reasoning_effort
      });
    } else if (this.config.providers.llm_mode === "ollama") {
      // Ollama client picks model per-call from config; no runtime update needed.
    } else {
      this.codex?.updateDefaults?.({
        model: this.config.providers.codex.model,
        reasoningEffort: this.config.providers.codex.reasoning_effort,
        fastMode: this.config.providers.codex.fast_mode
      });
    }

    await this.saveConfigFn(this.config);
    const pdfAnalysisMode = getPdfAnalysisModeForConfig(this.config);
    const analysisSummary =
      pdfAnalysisMode === "ollama_vision"
          ? `${this.describePdfAnalysisMode(pdfAnalysisMode)} (${this.config.providers.ollama?.vision_model || DEFAULT_OLLAMA_VISION_MODEL})`
          : this.describePdfAnalysisMode(pdfAnalysisMode);
    const approvalSummary = this.config.workflow?.approval_mode === "manual" ? "Manual" : "Minimal";
    this.pushLog(
      `Settings saved. Workflow mode: Agent approval. Approval mode: ${approvalSummary}. LLM provider: ${this.describePrimaryLlmProvider(this.config.providers.llm_mode)}. PDF analysis mode: ${analysisSummary}.`
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
      "backend"
    );
    if (!slot) {
      this.pushLog("Model selection canceled.");
      return;
    }
    if (slot === "backend") {
      await this.handleResearchBackendSelection();
      return;
    }

    if (this.config.providers.llm_mode === "ollama") {
      await this.handleOllamaModelSelection(slot as "chat");
      return;
    }
    if (this.config.providers.llm_mode === "openai_api") {
      await this.handleOpenAiApiModelSelection(slot as "chat");
      return;
    }
    await this.handleCodexModelSelection(slot as "chat");
  }

  private async applyModelBackendSelection(
    llmMode: AppConfig["providers"]["llm_mode"]
  ): Promise<boolean> {
    const nextMode = llmMode;
    if (nextMode === "openai_api" && !(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for the OpenAI API backend.");
        return false;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }

    if (nextMode === "ollama") {
      this.ensureOllamaConfig();
      const baseUrl = await this.askWithinTui(
        "Ollama base URL",
        this.config.providers.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL
      );
      if (!baseUrl.trim()) {
        this.pushLog("Ollama base URL is required.");
        return false;
      }
      this.config.providers.ollama!.base_url = baseUrl.trim();
    }

    if (this.config.providers.llm_mode === nextMode) {
      return true;
    }

    this.config.providers.llm_mode = nextMode;
    await this.saveConfigFn(this.config);
    this.pushLog(`Model backend updated to ${this.describePrimaryLlmProvider(nextMode)}.`);
    return true;
  }

  private async handleCodexModelSelection(slot: "chat" | "task"): Promise<void> {
    this.pushCurrentModelDefaults();
    const selected = await this.selectCodexSlot(
      slot === "chat" ? GENERAL_CHAT_SLOT_LABEL : RESEARCH_BACKEND_SLOT_LABEL,
      this.getCurrentCodexSlotSelection(slot),
      this.getCurrentCodexSlotReasoning(slot),
      slot === "chat" ? "command" : "task"
    );
    if (!selected) {
      this.pushLog("Model selection canceled.");
      return;
    }

    this.applyCodexSlotSelection(slot, selected.selection, selected.effort);
    this.codex?.updateDefaults?.({
      model: this.config.providers.codex.model,
      reasoningEffort: this.config.providers.codex.reasoning_effort,
      fastMode: this.config.providers.codex.fast_mode
    });
    await this.saveConfigFn(this.config);
    this.pushLog(`Codex ${this.describeModelSlot(slot)} model updated.`);
    this.pushCurrentModelDefaults();
  }

  private async handleOpenAiApiModelSelection(slot: "chat" | "task"): Promise<void> {
    this.pushCurrentModelDefaults();
    if (!(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for OpenAI API provider mode.");
        return;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }

    const selected = await this.selectOpenAiSlot(
      slot === "chat" ? GENERAL_CHAT_SLOT_LABEL : RESEARCH_BACKEND_SLOT_LABEL,
      this.getCurrentOpenAiSlotModel(slot),
      this.getCurrentOpenAiSlotReasoning(slot),
      slot === "chat" ? "command" : "task"
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

  private async handleResearchBackendSelection(): Promise<void> {
    this.pushCurrentModelDefaults();
    if (!(await this.configureResearchBackend(this.config.providers.llm_mode, "Model selection canceled."))) {
      return;
    }
    if (this.config.providers.llm_mode === "openai_api") {
      this.openAiTextClient?.updateDefaults({
        model: this.config.providers.openai.model,
        reasoningEffort: this.config.providers.openai.reasoning_effort
      });
    } else if (this.config.providers.llm_mode !== "ollama") {
      this.codex?.updateDefaults?.({
        model: this.config.providers.codex.model,
        reasoningEffort: this.config.providers.codex.reasoning_effort,
        fastMode: this.config.providers.codex.fast_mode
      });
    }
    await this.saveConfigFn(this.config);
    this.pushLog(RESEARCH_BACKEND_UPDATED_LOG);
    this.pushCurrentModelDefaults();
  }

  private async configureResearchBackend(
    llmMode: AppConfig["providers"]["llm_mode"],
    cancelMessage: string
  ): Promise<boolean> {
    if (llmMode === "ollama") {
      this.ensureOllamaConfig();
      const researchModel = await this.selectOllamaSlot("research");
      if (!researchModel) {
        this.pushLog(cancelMessage);
        return false;
      }
      this.config.providers.ollama!.research_model = researchModel;

      const experimentModel = await this.selectOllamaSlot("experiment");
      if (!experimentModel) {
        this.pushLog(cancelMessage);
        return false;
      }
      this.config.providers.ollama!.experiment_model = experimentModel;

      const visionModel = await this.selectOllamaSlot("vision");
      if (!visionModel) {
        this.pushLog(cancelMessage);
        return false;
      }
      this.config.providers.ollama!.vision_model = visionModel;
    } else if (llmMode === "openai_api") {
      const taskSlot = await this.selectOpenAiSlot(
        RESEARCH_BACKEND_SLOT_LABEL,
        this.config.providers.openai.model,
        this.config.providers.openai.reasoning_effort,
        "task"
      );
      if (!taskSlot) {
        this.pushLog(cancelMessage);
        return false;
      }
      this.applyOpenAiSlotSelection("task", taskSlot.model, taskSlot.effort);
    } else {
      const taskSlot = await this.selectCodexSlot(
        RESEARCH_BACKEND_SLOT_LABEL,
        this.getCurrentCodexSlotSelection("task"),
        this.config.providers.codex.reasoning_effort,
        "task"
      );
      if (!taskSlot) {
        this.pushLog(cancelMessage);
        return false;
      }
      this.applyCodexSlotSelection("task", taskSlot.selection, taskSlot.effort);
    }

    const pdfMode = getDefaultPdfAnalysisModeForLlmMode(llmMode);
    if (pdfMode === "responses_api_pdf" && !(await resolveOpenAiApiKey(process.cwd()))) {
      const openAiApiKey = await this.askWithinTui("OpenAI API key", "");
      if (!openAiApiKey.trim()) {
        this.pushLog("OpenAI API key is required for Responses API PDF analysis.");
        return false;
      }
      await upsertEnvVar(path.join(process.cwd(), ".env"), "OPENAI_API_KEY", openAiApiKey.trim());
    }
    return true;
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

  private buildModelSelectionOptions(slot: "chat" | "task"): SelectionMenuOption[] {
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
      },
      {
        value: "ollama_vision",
        label: "ollama_vision",
        description: "Use local Ollama vision model for PDF page image analysis (requires pdftoppm)."
      }
    ];
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
      },
      {
        value: "ollama",
        label: "ollama",
        description: "Use a local Ollama server (no API key required, runs on your hardware)."
      }
    ];
  }

  private buildOpenAiModelOptions(slot: "chat" | "task"): SelectionMenuOption[] {
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
    recommended: "command" | "task"
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
    recommended: "command" | "task"
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
        : SELECT_RESEARCH_BACKEND_REASONING_PROMPT,
      this.buildOpenAiReasoningEffortOptions(model, recommended),
      normalizedEffort
    );
    return selected as AppConfig["providers"]["openai"]["reasoning_effort"] | undefined;
  }

  private async selectCodexReasoningEffort(
    model: string,
    currentEffort: CodexReasoningEffort,
    recommended: "command" | "task"
  ): Promise<CodexReasoningEffort | undefined> {
    const normalizedEffort = normalizeReasoningEffortForModel(model, currentEffort);
    const selected = await this.openSelectionMenu(
      recommended === "command"
        ? "Select command/query reasoning effort"
        : SELECT_RESEARCH_BACKEND_REASONING_PROMPT,
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
    recommended: "command" | "task"
  ): string {
    const recommendation =
      recommended === "command"
        ? value === "medium"
          ? "recommended for commands"
          : ""
        : value === "xhigh"
          ? RECOMMENDED_FOR_RESEARCH_BACKEND
          : "";
    const parts = [baseDescription, recommendation].map((part) => part.trim()).filter(Boolean);
    return parts.join(" | ");
  }

  private describePdfAnalysisMode(mode: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision"): string {
    if (mode === "responses_api_pdf") return "Responses API PDF input";
    if (mode === "ollama_vision") return "Ollama vision";
    return "Codex text + image hybrid";
  }

  private describePrimaryLlmProvider(mode: AppConfig["providers"]["llm_mode"]): string {
    if (mode === "openai_api") return "OpenAI API";
    if (mode === "ollama") return "Ollama";
    return "Codex CLI";
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
        value: "backend",
        label: "research_backend",
        description: `Current: ${this.getCurrentResearchBackendPreset()} | Recommended: ${this.getRecommendedResearchBackendPreset()}`
      }
    ];
  }

  private describeModelSlot(slot: "chat" | "task"): string {
    switch (slot) {
      case "chat":
        return GENERAL_CHAT_SLOT_LABEL;
      default:
        return RESEARCH_BACKEND_SLOT_LABEL;
    }
  }

  private getCurrentCodexSlotSelection(slot: "chat" | "task"): string {
    if (slot === "chat") {
      return getCurrentCodexModelSelectionValue(
        this.config.providers.codex.chat_model || this.config.providers.codex.model,
        this.config.providers.codex.chat_fast_mode
      );
    }
    return getCurrentCodexModelSelectionValue(
      this.config.providers.codex.model,
      this.config.providers.codex.fast_mode
    );
  }

  private getCurrentCodexSlotReasoning(slot: "chat" | "task"): CodexReasoningEffort {
    if (slot === "chat") {
      return (this.config.providers.codex.chat_reasoning_effort ||
        this.config.providers.codex.command_reasoning_effort ||
        "low") as CodexReasoningEffort;
    }
    return this.config.providers.codex.reasoning_effort;
  }

  private async selectCodexSlot(
    label: string,
    currentSelection: string,
    currentEffort: CodexReasoningEffort,
    recommended: "command" | "task"
  ): Promise<{ selection: string; effort: CodexReasoningEffort } | undefined> {
    const selectedSelection = await this.openSelectionMenu(
      getSelectModelPrompt(label),
      this.buildModelSelectionOptions(recommended === "command" ? "chat" : "task"),
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
    slot: "chat" | "task",
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
    this.config.providers.codex.model = resolved.model;
    this.config.providers.codex.reasoning_effort = effort;
    this.config.providers.codex.fast_mode = resolved.model === "gpt-5.4" ? resolved.fastMode : false;
  }

  private getCurrentOpenAiSlotModel(slot: "chat" | "task"): string {
    if (slot === "chat") {
      return normalizeOpenAiResponsesModel(
        this.config.providers.openai.chat_model || this.config.providers.openai.model
      );
    }
    return normalizeOpenAiResponsesModel(this.config.providers.openai.model);
  }

  private getCurrentOpenAiSlotReasoning(
    slot: "chat" | "task"
  ): AppConfig["providers"]["openai"]["reasoning_effort"] {
    if (slot === "chat") {
      return (this.config.providers.openai.chat_reasoning_effort ||
        this.config.providers.openai.command_reasoning_effort ||
        "low") as AppConfig["providers"]["openai"]["reasoning_effort"];
    }
    return this.config.providers.openai.reasoning_effort;
  }

  private async selectOpenAiSlot(
    label: string,
    currentModel: string,
    currentEffort: AppConfig["providers"]["openai"]["reasoning_effort"],
    recommended: "command" | "task"
  ): Promise<{ model: string; effort: AppConfig["providers"]["openai"]["reasoning_effort"] } | undefined> {
    const selectedModel = await this.openSelectionMenu(
      getSelectModelPrompt(label),
      this.buildOpenAiModelOptions(recommended === "command" ? "chat" : "task"),
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
    slot: "chat" | "task",
    model: string,
    effort: AppConfig["providers"]["openai"]["reasoning_effort"]
  ): void {
    if (slot === "chat") {
      this.config.providers.openai.chat_model = model;
      this.config.providers.openai.chat_reasoning_effort = effort;
      this.config.providers.openai.command_reasoning_effort = effort;
      return;
    }
    this.config.providers.openai.model = model;
    this.config.providers.openai.reasoning_effort = effort;
  }

  private pushModelSlotSummary(): void {
    this.pushLog("Current model slots:");
    this.pushLog(`- ${this.describeModelSlot("chat")}: ${this.getCurrentSlotPreset("chat")} | Recommended: ${this.getRecommendedSlotPreset("chat")}`);
    this.pushLog(`- ${RESEARCH_BACKEND_SLOT_LABEL}: ${this.getCurrentResearchBackendPreset()} | Recommended: ${this.getRecommendedResearchBackendPreset()}`);
  }

  private getCompactModelLabel(): string {
    return `chat ${this.getCurrentSlotPreset("chat")} | backend ${this.getCurrentSlotPreset("task")}`;
  }

  private getCurrentSlotPreset(slot: "chat" | "task"): string {
    if (this.config.providers.llm_mode === "ollama") {
      return this.getCurrentOllamaSlotModel(slot);
    }
    if (this.config.providers.llm_mode === "openai_api") {
      return `${this.getCurrentOpenAiSlotModel(slot)} + ${this.getCurrentOpenAiSlotReasoning(slot)}`;
    }
    return `${this.getCurrentCodexSlotSelection(slot)} + ${this.getCurrentCodexSlotReasoning(slot)}`;
  }

  private getRecommendedSlotPreset(slot: "chat" | "task"): string {
    if (this.config.providers.llm_mode === "ollama") {
      return this.getRecommendedOllamaModel(slot);
    }
    if (this.config.providers.llm_mode === "openai_api") {
      return `${this.getRecommendedOpenAiModel(slot)} + ${slot === "chat" ? "low" : "high"}`;
    }
    return `${this.getRecommendedCodexSelection(slot)} + ${slot === "chat" ? "low" : "high"}`;
  }

  private getRecommendedCodexSelection(slot: "chat" | "task"): string {
    return "gpt-5.4";
  }

  private getRecommendedOpenAiModel(slot: "chat" | "task"): string {
    return "gpt-5.4";
  }

  private getCurrentOllamaSlotModel(slot: "chat" | "task"): string {
    const ollama = this.config.providers.ollama;
    if (!ollama) return "(not configured)";
    if (slot === "chat") return ollama.chat_model || DEFAULT_OLLAMA_CHAT_MODEL;
    return ollama.research_model || DEFAULT_OLLAMA_RESEARCH_MODEL;
  }

  private getRecommendedOllamaModel(slot: "chat" | "task"): string {
    if (slot === "chat") return DEFAULT_OLLAMA_CHAT_MODEL;
    return DEFAULT_OLLAMA_RESEARCH_MODEL;
  }

  private ensureOllamaConfig(): void {
    if (!this.config.providers.ollama) {
      this.config.providers.ollama = {
        base_url: DEFAULT_OLLAMA_BASE_URL,
        chat_model: DEFAULT_OLLAMA_CHAT_MODEL,
        research_model: DEFAULT_OLLAMA_RESEARCH_MODEL,
        experiment_model: DEFAULT_OLLAMA_EXPERIMENT_MODEL,
        vision_model: DEFAULT_OLLAMA_VISION_MODEL
      };
    }
  }

  private buildOllamaSlotOptions(
    slotType: "chat" | "research" | "experiment" | "vision"
  ): SelectionMenuOption[] {
    const catalogMap = {
      chat: OLLAMA_CHAT_MODEL_OPTIONS,
      research: OLLAMA_RESEARCH_MODEL_OPTIONS,
      experiment: OLLAMA_EXPERIMENT_MODEL_OPTIONS,
      vision: OLLAMA_VISION_MODEL_OPTIONS
    };
    const defaultMap = {
      chat: DEFAULT_OLLAMA_CHAT_MODEL,
      research: DEFAULT_OLLAMA_RESEARCH_MODEL,
      experiment: DEFAULT_OLLAMA_EXPERIMENT_MODEL,
      vision: DEFAULT_OLLAMA_VISION_MODEL
    };
    const recommended = defaultMap[slotType];
    return catalogMap[slotType].map((o) => ({
      value: o.value,
      label: o.label,
      description: this.annotateRecommendedDescription(o.description, o.value === recommended)
    }));
  }

  private async selectOllamaSlot(
    slotType: "chat" | "research" | "experiment" | "vision"
  ): Promise<string | undefined> {
    this.ensureOllamaConfig();
    const ollama = this.config.providers.ollama!;
    const currentMap: Record<string, string> = {
      chat: ollama.chat_model || DEFAULT_OLLAMA_CHAT_MODEL,
      research: ollama.research_model || DEFAULT_OLLAMA_RESEARCH_MODEL,
      experiment: ollama.experiment_model || DEFAULT_OLLAMA_EXPERIMENT_MODEL,
      vision: ollama.vision_model || DEFAULT_OLLAMA_VISION_MODEL
    };
    const label = slotType === "chat" ? "general chat"
      : slotType === "research" ? RESEARCH_BACKEND_SLOT_LABEL
      : slotType === "experiment" ? "experiment/code"
      : "vision/PDF";
    return this.openSelectionMenu(
      `Select Ollama ${label} model`,
      this.buildOllamaSlotOptions(slotType),
      currentMap[slotType]
    );
  }

  private async handleOllamaModelSelection(slot: "chat" | "task"): Promise<void> {
    this.pushCurrentModelDefaults();
    this.ensureOllamaConfig();
    const slotType = slot === "chat" ? "chat" as const : "research" as const;
    const selected = await this.selectOllamaSlot(slotType);
    if (!selected) {
      this.pushLog("Model selection canceled.");
      return;
    }
    const ollama = this.config.providers.ollama!;
    if (slotType === "chat") ollama.chat_model = selected;
    else if (slotType === "research") ollama.research_model = selected;
    else ollama.vision_model = selected;

    await this.saveConfigFn(this.config);
    this.pushLog(`Ollama ${this.describeModelSlot(slot)} model updated.`);
    this.pushCurrentModelDefaults();
  }

  private getCurrentResearchBackendPreset(): string {
    return this.getCurrentSlotPreset("task");
  }

  private getRecommendedResearchBackendPreset(): string {
    return this.getRecommendedSlotPreset("task");
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
      this.pushLog("No active run. Create a Research Brief with /new, then start it with /brief start --latest.");
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
      return undefined;
    }
    return this.runIndex[0];
  }

  private getRenderableRun(): RunRecord | undefined {
    const active = this.getActiveIndexedRun();
    if (this.creatingRunFromBrief) {
      if (!active || !this.creatingRunTargetId || active.id !== this.creatingRunTargetId) {
        return undefined;
      }
    }
    return active ? normalizeRunForDisplay(active, this.getRunProjectionHints(active)) : undefined;
  }

  private getRunProjectionHints(run?: RunRecord): RunProjectionHints | undefined {
    if (!run) {
      return undefined;
    }
    return this.runProjectionHints.get(run.id);
  }

  private getRunDisplayProjection(run?: RunRecord): RunDisplayProjection | undefined {
    if (!run) {
      return undefined;
    }
    return projectRunForDisplay(run, this.getRunProjectionHints(run));
  }

  private async refreshRunFromStore(runId = this.activeRunId): Promise<void> {
    if (!runId) {
      return;
    }

    const refreshed = await this.runStore.getRun(runId);
    if (!refreshed) {
      return;
    }

    const index = this.runIndex.findIndex((item) => item.id === runId);
    if (index === -1) {
      this.runIndex = [...this.runIndex, refreshed].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      return;
    }

    const merged = this.syncPersistedCurrentNodeSummary(
      mergeProjectedRunState(refreshed, this.runIndex[index]),
      refreshed
    );
    if (merged === this.runIndex[index]) {
      return;
    }

    this.runIndex = [
      ...this.runIndex.slice(0, index),
      merged,
      ...this.runIndex.slice(index + 1)
    ];
  }

  private syncPersistedCurrentNodeSummary(projected: RunRecord, persisted: RunRecord): RunRecord {
    if (
      projected.id !== persisted.id ||
      projected.currentNode !== persisted.currentNode ||
      projected.currentNode === "collect_papers" ||
      !this.isCollectSummary(projected.latestSummary) ||
      !persisted.latestSummary ||
      this.isCollectSummary(persisted.latestSummary) ||
      projected.latestSummary === persisted.latestSummary
    ) {
      return projected;
    }

    const currentNode = persisted.currentNode;
    const persistedState = persisted.graph.nodeStates[currentNode];
    const projectedState = projected.graph.nodeStates[currentNode];

    return {
      ...projected,
      latestSummary: persisted.latestSummary,
      graph: {
        ...projected.graph,
        nodeStates: {
          ...projected.graph.nodeStates,
          [currentNode]: {
            ...projectedState,
            note: persistedState?.note ?? projectedState?.note,
            lastError: persistedState?.lastError ?? projectedState?.lastError
          }
        }
      }
    };
  }

  private isCollectSummary(summary: string | undefined): boolean {
    const normalized = summary?.trim();
    if (!normalized) {
      return false;
    }
    return COLLECT_SUMMARY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  private async refreshRunProjectionHints(runId = this.activeRunId): Promise<void> {
    if (!runId) {
      return;
    }

    const index = this.runIndex.findIndex((item) => item.id === runId);
    if (index === -1) {
      this.runProjectionHints.delete(runId);
      return;
    }

    const run = this.runIndex[index];
    const hints = await readRunProjectionHints(process.cwd(), run);
    if (hints) {
      this.runProjectionHints.set(run.id, hints);
      const merged = mergeProjectedRunState(run, hints.checkpoint?.snapshot);
      if (merged !== run) {
        this.runIndex = [
          ...this.runIndex.slice(0, index),
          merged,
          ...this.runIndex.slice(index + 1)
        ];
      }
    } else {
      this.runProjectionHints.delete(run.id);
    }
  }

  private shouldLogStreamEvent(event: AutoLabOSEvent): boolean {
    if (this.creatingRunFromBrief) {
      return false;
    }
    return !this.activeRunId || event.runId === this.activeRunId;
  }

  private async handleStreamEvent(event: AutoLabOSEvent): Promise<void> {
    this.applyProjectedRunEvent(event);
    try {
      await this.refreshRunFromStore(event.runId);
      await this.refreshRunProjectionHints(event.runId);
      if (this.activeRunId === event.runId) {
        this.render();
      }
    } catch {
      // Ignore transient projection refresh errors.
    }

    const line = formatEventLog(event);
    if (!line || !this.shouldLogStreamEvent(event)) {
      return;
    }
    this.pushLog(line);
    this.render();
  }

  private applyProjectedRunEvent(event: AutoLabOSEvent): void {
    const index = this.runIndex.findIndex((run) => run.id === event.runId);
    if (index === -1) {
      return;
    }

    const projected = applyEventToRunProjection(this.runIndex[index], event);
    if (projected === this.runIndex[index]) {
      return;
    }

    this.runIndex = [
      ...this.runIndex.slice(0, index),
      projected,
      ...this.runIndex.slice(index + 1)
    ];
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
      this.pushLog(`Next step ready: ${displayCommands[0]}.`);
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
    return pending.commands.map((command, index) => pending.displayCommands?.[index] ?? describePendingSurfaceCommand(command));
  }

  private async setActiveRunId(runId?: string): Promise<void> {
    if (this.activeRunId === runId) {
      return;
    }
    this.activeRunId = runId;
    this.collectProgress = undefined;
    this.analyzeProgress = undefined;
    await this.loadHistoryForRun(runId);
    await this.refreshActiveRunInsight();
    await this.refreshRunProjectionHints(runId);
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

  private async refreshPendingHumanInterventionState(): Promise<void> {
    const run = this.activeRunId ? this.runIndex.find((item) => item.id === this.activeRunId) : undefined;
    if (!run) {
      this.pendingHumanIntervention = undefined;
      this.announcedHumanInterventionId = undefined;
      return;
    }

    const request = await this.interactiveSupervisor.getActiveRequest(run);
    if (!request) {
      this.pendingHumanIntervention = undefined;
      this.announcedHumanInterventionId = undefined;
      return;
    }

    this.pendingHumanIntervention = {
      runId: run.id,
      request
    };
    this.announceHumanIntervention(request);
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

  /**
   * Detect stale "running" nodes from a previous TUI session and reset them
   * to "pending" so they can be re-executed. When the TUI restarts, any node
   * marked "running" has lost its in-memory execution context.
   */
  private async recoverStaleRunningNode(runId: string, recoverRecentNode = false): Promise<void> {
    const run = this.runIndex.find((r) => r.id === runId);
    if (!run) return;
    const nodeState = run.graph.nodeStates[run.currentNode];
    if (nodeState?.status !== "running") return;
    const lastActivityMs = Math.max(
      Number.isFinite(Date.parse(run.updatedAt)) ? Date.parse(run.updatedAt) : Number.NEGATIVE_INFINITY,
      Number.isFinite(Date.parse(nodeState.updatedAt))
        ? Date.parse(nodeState.updatedAt)
        : Number.NEGATIVE_INFINITY
    );
    if (
      !recoverRecentNode &&
      Number.isFinite(lastActivityMs) &&
      Date.now() - lastActivityMs < STALE_RUNNING_NODE_RECOVERY_MS
    ) {
      return;
    }

    this.pushLog(`Recovering stale running node: ${run.currentNode} (reset to pending for re-execution).`);
    await this.orchestrator.retryCurrent(run.id, run.currentNode);
    await this.refreshRunIndex();
    await this.setActiveRunId(run.id);
    // Actually trigger execution (matching handleRetry behavior)
    void this.continueSupervisedRun(run.id);
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
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  private pushTransientLog(line: string): void {
    this.transientLogs.push(line);
  }

  private clearTransientLogs(): void {
    this.transientLogs = [];
  }

  private async refreshRunIndex(): Promise<void> {
    const previousRuns = new Map(this.runIndex.map((run) => [run.id, run]));
    this.runIndex = (await this.runStore.listRuns()).map((run) => mergeProjectedRunState(run, previousRuns.get(run.id)));
    if (this.runIndex.length > 0) {
      if (!this.activeRunId) {
        await this.setActiveRunId(this.runIndex[0].id);
      } else if (!this.runIndex.some((run) => run.id === this.activeRunId)) {
        await this.setActiveRunId(this.runIndex[0].id);
      }
    } else if (this.activeRunId) {
      await this.setActiveRunId(undefined);
    }
    await this.refreshRunProjectionHints(this.activeRunId);
    await this.refreshActiveRunInsight();
    await this.refreshPendingHumanInterventionState();
    this.updateSuggestions();
  }

  private render(): void {
    const run = this.getRenderableRun();
    const guidance =
      this.input.trim().length === 0 && this.suggestions.length === 0 && !this.activeSelectionMenu
        ? this.getContextualGuidance(run)
        : undefined;
    const terminalWidth = this.resolveTerminalWidth();
    const terminalHeight = this.resolveTerminalHeight();
    const previousTranscriptLines = this.lastRenderedFrame?.totalTranscriptLines ?? 0;
    let requestedScrollOffset = this.transcriptScrollOffset;

    let frame = buildFrame({
      appVersion: this.appVersion,
      busy: this.busy,
      activityLabel: this.getActivityLabel(run),
      thinking: this.thinking,
      thinkingFrame: this.thinkingFrame,
      terminalWidth,
      terminalHeight,
      modelLabel: this.getCompactModelLabel(),
      workspaceLabel: this.getWorkspaceLabel(),
      footerItems: this.buildFooterItems(run),
      queueLength: this.queuedInputs.length,
      run,
      runInsight: this.activeRunInsight,
      logs: this.getRenderableLogs(run),
      input: this.input,
      inputCursor: this.cursorIndex,
      newlineHintLabel: this.resolveNewlineHintLabel(),
      suggestions: this.suggestions,
      selectedSuggestion: this.selectedSuggestion,
      colorEnabled: this.colorEnabled,
      transcriptScrollOffset: requestedScrollOffset,
      guidance,
      selectionMenu: this.activeSelectionMenu
        ? {
            title: this.activeSelectionMenu.title,
            options: this.activeSelectionMenu.options,
            selectedIndex: this.activeSelectionMenu.selectedIndex
          }
        : undefined
    });

    if (requestedScrollOffset > 0 && previousTranscriptLines > 0 && frame.totalTranscriptLines > previousTranscriptLines) {
      requestedScrollOffset += frame.totalTranscriptLines - previousTranscriptLines;
      frame = buildFrame({
        appVersion: this.appVersion,
        busy: this.busy,
        activityLabel: this.getActivityLabel(run),
        thinking: this.thinking,
        thinkingFrame: this.thinkingFrame,
        terminalWidth,
        terminalHeight,
        modelLabel: this.getCompactModelLabel(),
        workspaceLabel: this.getWorkspaceLabel(),
        footerItems: this.buildFooterItems(run),
        queueLength: this.queuedInputs.length,
        run,
        runInsight: this.activeRunInsight,
        logs: this.getRenderableLogs(run),
        input: this.input,
        inputCursor: this.cursorIndex,
        newlineHintLabel: this.resolveNewlineHintLabel(),
        suggestions: this.suggestions,
        selectedSuggestion: this.selectedSuggestion,
        colorEnabled: this.colorEnabled,
        transcriptScrollOffset: requestedScrollOffset,
        guidance,
        selectionMenu: this.activeSelectionMenu
          ? {
              title: this.activeSelectionMenu.title,
              options: this.activeSelectionMenu.options,
              selectedIndex: this.activeSelectionMenu.selectedIndex
            }
          : undefined
      });
    }

    this.transcriptScrollOffset = frame.appliedTranscriptScrollOffset;
    this.lastRenderedFrame = frame;

    try {
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(frame.lines.join("\n"));

      const up = frame.lines.length - frame.inputLineIndex;
      if (up > 0) {
        process.stdout.write(`\x1b[${up}A`);
      }
      process.stdout.write(`\x1b[${frame.inputColumn}G`);
    } catch {
      // stdout disconnected (EIO/EPIPE) — stop rendering to avoid crash
      this.stopped = true;
    }
  }

  private getContextualGuidance(run = this.getRenderableRun()) {
    return buildContextualGuidance({
      run,
      projectionHints: this.getRunProjectionHints(run),
      humanIntervention: this.pendingHumanIntervention?.request,
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

  private resolveTerminalHeight(): number {
    const envHeight = Number.parseInt(process.env.LINES ?? "", 10);
    if (Number.isFinite(envHeight) && envHeight >= 10) {
      return envHeight;
    }
    return process.stdout.rows ?? 40;
  }

  private getWorkspaceLabel(): string {
    return process.cwd();
  }

  private buildFooterItems(run?: RunRecord): string[] {
    const items: string[] = [];

    if (this.isCreatingRunFromBrief()) {
      items.push("creating run");
    } else if (run) {
      const nodeStatus = run.graph.nodeStates[run.currentNode]?.status || run.status;
      items.push(`${run.currentNode} ${nodeStatus}`);
    } else {
      items.push("idle");
    }

    if (this.pendingHumanIntervention) {
      items.unshift("awaiting approval");
    } else if (this.pendingNaturalCommand) {
      items.unshift(`plan ${this.pendingNaturalCommand.stepIndex + 1}/${this.pendingNaturalCommand.totalSteps}`);
    } else if (this.thinking) {
      items.unshift("thinking");
    } else if (this.busy) {
      items.unshift("running");
    }
    return items;
  }

  private isCreatingRunFromBrief(): boolean {
    return this.creatingRunFromBrief && this.busy && this.activeBusyLabel?.startsWith("Starting research") === true;
  }

  private getActivityLabel(run?: RunRecord): string | undefined {
    if (!this.busy || this.thinking) {
      return undefined;
    }

    const nodeStatus = run ? run.graph.nodeStates[run.currentNode]?.status : undefined;
    if (run && nodeStatus === "running") {
      if (run.currentNode === "collect_papers") {
        return formatCollectActivityLabel(this.collectProgress);
      }
      return describeNodeActivity(run.currentNode);
    }

    const explicit = this.activeBusyLabel?.trim();
    if (explicit && explicit !== "operation") {
      if (explicit.startsWith("Collecting")) {
        return formatCollectActivityLabel(this.collectProgress);
      }
      return explicit;
    }

    return undefined;
  }

  private getRenderableLogs(run?: RunRecord): string[] {
    if (this.thinking) {
      if (this.transientLogs.length === 0) {
        return this.logs;
      }
      return [...this.logs, ...this.transientLogs];
    }

    const progressLine = this.getTransientProgressLog(run);
    const statusLines = this.buildProjectedStatusLines(run);
    const extras = [...statusLines, ...(progressLine ? [progressLine] : [])];

    if (this.transientLogs.length === 0 && extras.length === 0) {
      return [...this.logs];
    }
    return [...this.logs, ...this.transientLogs, ...extras];
  }

  private buildProjectedStatusLines(run?: RunRecord): string[] {
    const projection = this.getRunDisplayProjection(run);
    if (!projection) {
      return [];
    }

    const recentLines = new Set(this.logs.slice(-6));
    const lines: string[] = [];
    const headline = projection.headline?.trim();
    const detail = projection.detail?.trim();

    if (headline) {
      const line = `Status: ${headline}`;
      if (!recentLines.has(line)) {
        lines.push(line);
      }
    }
    if (detail) {
      const line = `Detail: ${detail}`;
      if (!recentLines.has(line)) {
        lines.push(line);
      }
    }

    return lines;
  }

  private getTransientProgressLog(run?: RunRecord): string | undefined {
    if (!this.busy || this.thinking) {
      return undefined;
    }

    if (run?.currentNode === "collect_papers") {
      return formatCollectActivityLabel(this.collectProgress);
    }

    if (run?.currentNode === "analyze_papers") {
      return formatAnalyzeProgressLogLine(this.analyzeProgress);
    }

    const explicit = this.activeBusyLabel?.trim() ?? "";
    if (explicit.startsWith("Collecting")) {
      return formatCollectActivityLabel(this.collectProgress);
    }

    if (explicit.startsWith("Analyzing")) {
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
    const activityLabel = this.getActivityLabel(this.getRenderableRun());
    const text = this.thinking
      ? buildThinkingText(this.thinkingFrame, this.colorEnabled)
      : activityLabel
        ? buildAnimatedStatusText(activityLabel, this.thinkingFrame, this.colorEnabled)
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
    const targets = resetArtifactTargets(node);

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
    for (const key of resetContextKeys(node)) {
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
      delete run.nodeThreads[nodeId];
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
      default:
        return [`Count(${node}): unsupported`];
    }
  }

  private async shutdown(options?: { abortActive?: boolean }): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.detachProcessTerminationHandlers();
    this.queuedInputs = [];
    this.pendingNaturalCommand = undefined;
    this.steeringBufferDuringThinking = [];
    if (options?.abortActive) {
      this.activeNaturalRequest?.abortController.abort();
      this.activeBusyAbortController?.abort();
      const settled = await this.waitForActiveBusyActionToFinish();
      if (!settled) {
        await this.forcePauseActiveRunIfStillRunning();
      }
    }
    if (this.activeSelectionMenu) {
      const resolve = this.activeSelectionMenu.resolve;
      this.activeSelectionMenu = undefined;
      resolve(undefined);
    }
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
    this.stopThinking();
    this.renderExitTranscript();
    this.detachKeyboard();
    process.stdin.pause();
    this.onQuit();
    this.resolver?.();
  }

  private attachProcessTerminationHandlers(): void {
    if (this.signalExitHandlers.size > 0 || this.uncaughtExceptionHandler || this.unhandledRejectionHandler) {
      return;
    }

    for (const signal of ["SIGHUP", "SIGTERM"] as const) {
      const handler = () => {
        void this.handleUnexpectedTermination(signal);
      };
      this.signalExitHandlers.set(signal, handler);
      process.once(signal, handler);
    }

    this.uncaughtExceptionHandler = (error: Error) => {
      void this.handleUnexpectedTermination("SIGTERM", error);
    };
    this.unhandledRejectionHandler = (reason: unknown) => {
      void this.handleUnexpectedTermination("SIGTERM", reason);
    };
    process.once("uncaughtException", this.uncaughtExceptionHandler);
    process.once("unhandledRejection", this.unhandledRejectionHandler);
  }

  private detachProcessTerminationHandlers(): void {
    for (const [signal, handler] of this.signalExitHandlers.entries()) {
      process.off(signal, handler);
    }
    this.signalExitHandlers.clear();

    if (this.uncaughtExceptionHandler) {
      process.off("uncaughtException", this.uncaughtExceptionHandler);
      this.uncaughtExceptionHandler = undefined;
    }
    if (this.unhandledRejectionHandler) {
      process.off("unhandledRejection", this.unhandledRejectionHandler);
      this.unhandledRejectionHandler = undefined;
    }
  }

  private async handleUnexpectedTermination(signal: NodeJS.Signals, error?: unknown): Promise<void> {
    if (this.processTerminationCleanupStarted) {
      return;
    }
    this.processTerminationCleanupStarted = true;
    try {
      await this.pauseActiveRunForUnexpectedExit();
    } finally {
      this.detachProcessTerminationHandlers();
      if (error instanceof Error) {
        process.stderr.write(`${error.stack || error.message}\n`);
      } else if (error != null) {
        process.stderr.write(`${String(error)}\n`);
      }
      process.exit(signal === "SIGHUP" ? 129 : 143);
    }
  }

  private async pauseActiveRunForUnexpectedExit(): Promise<void> {
    this.activeNaturalRequest?.abortController.abort();
    this.activeBusyAbortController?.abort();
    await this.waitForActiveBusyActionToFinish();
    await this.forcePauseActiveRunIfStillRunning();
  }

  private async waitForActiveBusyActionToFinish(): Promise<boolean> {
    const pending = this.activeBusyPromise;
    if (!pending) {
      return true;
    }

    const outcome = await Promise.race([
      pending.then(() => "settled", () => "settled"),
      new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), this.shutdownAbortGraceMs);
      })
    ]);
    return outcome === "settled";
  }

  private async forcePauseActiveRunIfStillRunning(): Promise<void> {
    if (!this.activeRunId) {
      return;
    }

    const run = await this.runStore.getRun(this.activeRunId);
    if (!run || run.status !== "running") {
      return;
    }

    const state = run.graph.nodeStates[run.currentNode];
    if (!state || (state.status !== "running" && state.status !== "pending")) {
      return;
    }

    const canceledAt = new Date().toISOString();
    run.status = "paused";
    run.updatedAt = canceledAt;
    run.graph.nodeStates[run.currentNode] = {
      ...state,
      status: "pending",
      updatedAt: canceledAt,
      note: "Canceled by user"
    };
    run.latestSummary = "Canceled by user";
    await this.runStore.updateRun(run);
  }

  private renderExitTranscript(): void {
    const transcriptLines = this.lastRenderedFrame?.lines.slice(0, this.lastRenderedFrame.transcriptViewportLineCount) ?? [];
    process.stdout.write("\x1b[2J\x1b[H");
    if (transcriptLines.length > 0) {
      process.stdout.write(transcriptLines.join("\n"));
    }
    process.stdout.write(`\x1b[${transcriptLines.length + 1};1H`);
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
    if (normalized === "brief") {
      return "Starting research...";
    }
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
      this.render();
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
  const sessionLock = await acquireTerminalSessionLock(process.cwd());
  try {
    const app = new TerminalApp(deps);
    if (sessionLock.recoveredStaleLock) {
      app.markRecoveredStaleSessionLock();
    }
    await app.start();
  } finally {
    await releaseTerminalSessionLock(sessionLock);
  }
}

interface TerminalSessionLock {
  lockPath: string;
  token: string;
  recoveredStaleLock: boolean;
}

interface PersistedTerminalSessionLock {
  pid: number;
  cwd: string;
  startedAt: string;
  token: string;
}

async function acquireTerminalSessionLock(cwd: string): Promise<TerminalSessionLock> {
  const runtimeDir = path.join(cwd, ".autolabos", "runtime");
  await ensureDir(runtimeDir);
  const lockPath = path.join(runtimeDir, "tui-session-lock.json");
  const existing = await readTerminalSessionLock(lockPath);
  let recoveredStaleLock = false;
  if (existing && existing.pid !== process.pid) {
    if (await isTerminalSessionProcessActive(existing)) {
      throw new Error(
        `Another AutoLabOS TUI session is already running for ${existing.cwd} (pid ${existing.pid}). Close that session before starting a new live validation loop.`
      );
    }
    recoveredStaleLock = true;
  }

  const token = `${process.pid}:${Date.now()}`;
  const nextLock: PersistedTerminalSessionLock = {
    pid: process.pid,
    cwd,
    startedAt: new Date().toISOString(),
    token
  };
  await fs.writeFile(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, "utf8");
  return { lockPath, token, recoveredStaleLock };
}

async function releaseTerminalSessionLock(lock: TerminalSessionLock): Promise<void> {
  const existing = await readTerminalSessionLock(lock.lockPath);
  if (!existing || existing.token !== lock.token) {
    return;
  }
  await fs.rm(lock.lockPath, { force: true }).catch(() => undefined);
}

async function readTerminalSessionLock(lockPath: string): Promise<PersistedTerminalSessionLock | undefined> {
  if (!(await fileExists(lockPath))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as Partial<PersistedTerminalSessionLock>;
    if (
      typeof parsed.pid === "number" &&
      Number.isFinite(parsed.pid) &&
      typeof parsed.cwd === "string" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.token === "string"
    ) {
      return parsed as PersistedTerminalSessionLock;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ESRCH") {
      return false;
    }
    return true;
  }
}

async function isTerminalSessionProcessActive(lock: PersistedTerminalSessionLock): Promise<boolean> {
  if (!isProcessAlive(lock.pid)) {
    return false;
  }

  const [processCwd, processCmdline] = await Promise.all([readProcessCwd(lock.pid), readProcessCmdline(lock.pid)]);
  if (!processCmdline) {
    return false;
  }
  const expectedCwd = path.resolve(lock.cwd);
  if (processCwd && path.resolve(processCwd) !== expectedCwd) {
    return false;
  }
  if (!looksLikeAutoLabosTuiCmdline(processCmdline)) {
    return false;
  }

  return true;
}

async function readProcessCwd(pid: number): Promise<string | undefined> {
  try {
    return await fs.readlink(`/proc/${pid}/cwd`);
  } catch {
    return undefined;
  }
}

async function readProcessCmdline(pid: number): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
    const normalized = raw.replace(/\0+/g, " ").trim();
    return normalized.length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeAutoLabosTuiCmdline(cmdline: string): boolean {
  const normalized = cmdline.toLowerCase();
  return (
    normalized.includes("src/cli/main.") ||
    normalized.includes("dist/cli/main.") ||
    normalized.includes("autolabos")
  );
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

function findShiftEnterSequenceRange(
  input: string
): { start: number; end: number } | undefined {
  for (const sequence of SHIFT_ENTER_SEQUENCE_LIST) {
    const start = input.indexOf(sequence);
    if (start >= 0) {
      return {
        start,
        end: start + sequence.length
      };
    }
  }
  return undefined;
}

function retainRawKeyboardSequenceSuffix(input: string): string {
  if (!input) {
    return "";
  }

  const maxSuffixLength = Math.max(0, MAX_SHIFT_ENTER_SEQUENCE_LENGTH - 1);
  for (let length = Math.min(maxSuffixLength, input.length); length > 0; length -= 1) {
    const suffix = input.slice(-length);
    if (SHIFT_ENTER_SEQUENCE_LIST.some((sequence) => sequence.startsWith(suffix))) {
      return suffix;
    }
  }

  return "";
}

async function resolveTerminalBackground(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream
): Promise<RgbColor | undefined> {
  const queried = await queryTerminalBackground(stdin, stdout);
  if (queried) {
    return queried;
  }

  return inferTerminalBackgroundFromEnv();
}

async function queryTerminalBackground(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  timeoutMs = 140
): Promise<RgbColor | undefined> {
  if (!stdin.isTTY || !stdout.isTTY) {
    return undefined;
  }

  for (const query of buildTerminalBackgroundQueries()) {
    const value = await queryTerminalBackgroundOnce(stdin, stdout, query, timeoutMs);
    if (value) {
      return value;
    }
  }

  return undefined;
}

async function queryTerminalBackgroundOnce(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  query: string,
  timeoutMs: number
): Promise<RgbColor | undefined> {
  return await new Promise<RgbColor | undefined>((resolve) => {
    let settled = false;
    let responseBuffer = "";

    const cleanup = () => {
      stdin.off("data", onData);
      clearTimeout(timer);
    };

    const finish = (value: RgbColor | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      responseBuffer = `${responseBuffer}${chunk.toString("utf8")}`.slice(-512);
      const parsed = parseTerminalBackgroundResponse(responseBuffer);
      if (parsed) {
        finish(parsed);
      }
    };

    const timer = setTimeout(() => finish(undefined), timeoutMs);
    stdin.prependListener("data", onData);
    stdout.write(query);
  });
}

function buildTerminalBackgroundQueries(): string[] {
  const queries = ["\x1b]11;?\x1b\\", "\x1b]11;?\x07"];
  if (process.env.TMUX) {
    queries.push("\x1bPtmux;\x1b\x1b]11;?\x1b\x1b\\\x1b\\", "\x1bPtmux;\x1b\x1b]11;?\x07\x1b\\");
  }
  return queries;
}

function inferTerminalBackgroundFromEnv(): RgbColor | undefined {
  const colorFgBg = process.env.COLORFGBG?.trim();
  if (colorFgBg) {
    const parsed = parseColorFgBgBackground(colorFgBg);
    if (parsed) {
      return parsed;
    }
  }

  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (process.env.TERM ?? "").toLowerCase();
  const colorTerm = (process.env.COLORTERM ?? "").toLowerCase();

  if (
    process.env.TMUX ||
    term.startsWith("screen") ||
    term.includes("256color") ||
    colorTerm === "truecolor" ||
    termProgram.includes("tmux") ||
    termProgram.includes("iterm") ||
    termProgram.includes("wezterm") ||
    termProgram.includes("ghostty")
  ) {
    return [30, 30, 30];
  }

  return undefined;
}

function parseColorFgBgBackground(value: string): RgbColor | undefined {
  const raw = value.split(";").at(-1);
  if (!raw) {
    return undefined;
  }

  const index = Number.parseInt(raw, 10);
  if (!Number.isFinite(index)) {
    return undefined;
  }

  const systemPalette: RgbColor[] = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255]
  ];

  return systemPalette[index] ?? undefined;
}

function detectLikelyEnhancedNewlineSupport(): boolean {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const term = (process.env.TERM ?? "").toLowerCase();
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();

  if (process.env.TMUX || termProgram === "tmux" || term.startsWith("screen")) {
    return false;
  }

  if (process.env.KITTY_WINDOW_ID || process.env.ITERM_SESSION_ID || process.env.WT_SESSION) {
    return true;
  }

  return (
    term.includes("kitty") ||
    term.includes("wezterm") ||
    term.includes("ghostty") ||
    term.includes("foot") ||
    termProgram.includes("wezterm") ||
    termProgram.includes("ghostty") ||
    termProgram.includes("iterm")
  );
}

function normalizeSteeringInput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function resolveFailureLogNode(run: RunRecord, fallbackNode: GraphNodeId, failure: string): GraphNodeId {
  const leadingNode = extractLeadingFailureNode(failure);
  if (!leadingNode) {
    return fallbackNode;
  }
  return run.graph.nodeStates[leadingNode]?.status === "failed" ? leadingNode : fallbackNode;
}

function extractLeadingFailureNode(failure: string): GraphNodeId | undefined {
  const match = failure.trim().match(/^([a-z_]+)\b/u);
  if (!match?.[1]) {
    return undefined;
  }
  return AGENT_ORDER.includes(match[1] as GraphNodeId) ? (match[1] as GraphNodeId) : undefined;
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
    case "NODE_STARTED":
      return event.node ? `Node ${event.node} started.` : "Node started.";
    case "NODE_COMPLETED":
      return event.node
        ? `Node ${event.node} completed: ${oneLine(String(event.payload.summary || "completed"))}`
        : `Node completed: ${oneLine(String(event.payload.summary || "completed"))}`;
    case "NODE_FAILED":
      return event.node
        ? `Node ${event.node} failed: ${oneLine(String(event.payload.error || "unknown error"))}`
        : `Node failed: ${oneLine(String(event.payload.error || "unknown error"))}`;
    case "NODE_JUMP":
      return event.node
        ? `Jumped to ${event.node} (${oneLine(String(event.payload.mode || "safe"))}).`
        : `Node jump applied (${oneLine(String(event.payload.mode || "safe"))}).`;
    case "NODE_RETRY":
      return event.node ? `Retrying ${event.node}.` : "Retrying node.";
    case "NODE_ROLLBACK": {
      const from = event.payload.from ? ` from ${oneLine(String(event.payload.from))}` : "";
      return event.node ? `Rolled back to ${event.node}${from}.` : `Rolled back${from}.`;
    }
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

function describePendingSurfaceCommand(command: string): string {
  const normalized = command.trim().toLowerCase();
  if (normalized === "/new") {
    return "new brief";
  }
  if (normalized.startsWith("/brief start")) {
    return "start brief";
  }
  if (normalized.startsWith("/approve")) {
    return "approve";
  }
  if (normalized.startsWith("/agent run") || normalized.startsWith("/agent retry")) {
    return "run";
  }
  return command;
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
    default:
      return [];
  }
}

function resetArtifactTargets(node: GraphNodeId): string[] {
  return [...new Set(resetScopeNodes(node).flatMap((nodeId) => nodeArtifactTargets(nodeId)))];
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

function resetContextKeys(node: GraphNodeId): string[] {
  return [...new Set(resetScopeNodes(node).flatMap((nodeId) => nodeContextKeys(nodeId)))];
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

async function readRunProjectionHints(workspaceRoot: string, run: RunRecord): Promise<RunProjectionHints | undefined> {
  const runDir = path.join(workspaceRoot, ".autolabos", "runs", run.id);
  const [runContextRaw, analyzeManifestRaw, implementStatusRaw, checkpointHints] = await Promise.all([
    safeRead(path.join(workspaceRoot, run.memoryRefs.runContextPath)),
    safeRead(path.join(runDir, "analysis_manifest.json")),
    safeRead(path.join(runDir, "implement_experiments", "status.json")),
    readCheckpointProjectionHints(runDir)
  ]);

  const hints: RunProjectionHints = {};
  const runContextHints = parseRunContextProjectionHints(runContextRaw);
  const analyzeManifestHints = parseAnalyzeManifestProjectionHints(analyzeManifestRaw);
  const implementStatusHints = parseImplementStatusProjectionHints(implementStatusRaw);

  if (runContextHints.collect || analyzeManifestHints?.collect) {
    hints.collect = {
      ...runContextHints.collect,
      ...analyzeManifestHints?.collect
    };
  }
  if (runContextHints.analyze || analyzeManifestHints?.analyze) {
    hints.analyze = {
      ...runContextHints.analyze,
      ...analyzeManifestHints?.analyze
    };
  }
  if (implementStatusHints?.implement) {
    hints.implement = implementStatusHints.implement;
  }
  if (checkpointHints) {
    hints.checkpoint = checkpointHints;
  }

  return hints.collect || hints.analyze || hints.implement || hints.checkpoint ? hints : undefined;
}

async function readCheckpointProjectionHints(runDir: string): Promise<RunProjectionHints["checkpoint"] | undefined> {
  const checkpointsDir = path.join(runDir, "checkpoints");
  const latestRaw = await safeRead(path.join(checkpointsDir, "latest.json"));
  if (!latestRaw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(latestRaw) as {
      seq?: unknown;
      phase?: unknown;
      createdAt?: unknown;
      file?: unknown;
    };
    const file = readString(parsed.file);
    const snapshot = file ? await readCheckpointSnapshot(path.join(checkpointsDir, file)) : undefined;
    const phase = readCheckpointPhase(parsed.phase);
    if (typeof parsed.seq !== "number" && !phase && !readString(parsed.createdAt) && !snapshot) {
      return undefined;
    }

    return {
      seq: readNumber(parsed.seq),
      phase,
      createdAt: readString(parsed.createdAt),
      snapshot
    };
  } catch {
    return undefined;
  }
}

async function readCheckpointSnapshot(filePath: string): Promise<RunRecord | undefined> {
  const raw = await safeRead(filePath);
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as {
      runSnapshot?: unknown;
    };
    return readRunRecord(parsed.runSnapshot);
  } catch {
    return undefined;
  }
}

function parseRunContextProjectionHints(raw: string): RunProjectionHints {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as {
      items?: Array<{
        key?: unknown;
        value?: unknown;
      }>;
    };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const values = new Map<string, unknown>();
    for (const item of items) {
      if (typeof item?.key === "string") {
        values.set(item.key, item.value);
      }
    }

    const collectResult = readRecord(values.get("collect_papers.last_result"));
    const collectEnrichment = readRecord(collectResult?.enrichment);
    const analyzeRequest = readRecord(values.get("analyze_papers.request"));

    return {
      collect:
        collectResult || collectEnrichment
          ? {
              storedCount: readNumber(collectResult?.stored),
              enrichmentStatus: readString(collectEnrichment?.status),
              enrichmentTargetCount: readNumber(collectEnrichment?.targetCount),
              enrichmentProcessedCount: readNumber(collectEnrichment?.processedCount)
            }
          : undefined,
      analyze:
        analyzeRequest ||
        values.has("analyze_papers.selected_count") ||
        values.has("analyze_papers.summary_count") ||
        values.has("analyze_papers.evidence_count")
          ? {
              selectionMode: readString(analyzeRequest?.selectionMode),
              requestedTopN: readNullableNumber(analyzeRequest?.topN),
              selectedCount: readNumber(values.get("analyze_papers.selected_count")),
              totalCandidates: readNumber(values.get("analyze_papers.total_candidates")),
              summaryCount: readNumber(values.get("analyze_papers.summary_count")),
              evidenceCount: readNumber(values.get("analyze_papers.evidence_count")),
              fullTextCount: readNumber(values.get("analyze_papers.full_text_count")),
              abstractFallbackCount: readNumber(values.get("analyze_papers.abstract_fallback_count"))
            }
          : undefined
    };
  } catch {
    return {};
  }
}

function parseAnalyzeManifestProjectionHints(raw: string): RunProjectionHints | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as {
      totalCandidates?: unknown;
      candidatePoolSize?: unknown;
      rerankApplied?: unknown;
      rerankFallbackReason?: unknown;
      selectedPaperIds?: unknown;
      papers?: unknown;
    };

    const selectedPaperIds = Array.isArray(parsed.selectedPaperIds)
      ? parsed.selectedPaperIds.filter((value): value is string => typeof value === "string")
      : [];
    const papers = readRecordMap(parsed.papers);
    const selectedPaperRecords = selectedPaperIds
      .map((paperId) => readRecord(papers?.[paperId]))
      .filter((paper): paper is Record<string, unknown> => Boolean(paper));
    const selectedFailedCount = selectedPaperRecords.filter((paper) => readString(paper.status) === "failed").length;
    const selectedPaper = selectedPaperRecords[0];

    return {
      analyze:
        selectedPaperIds.length > 0 || typeof parsed.rerankApplied === "boolean" || typeof parsed.totalCandidates === "number"
          ? {
              selectedCount: selectedPaperIds.length,
              totalCandidates: readNumber(parsed.totalCandidates),
              candidatePoolSize: readNumber(parsed.candidatePoolSize),
              rerankApplied: typeof parsed.rerankApplied === "boolean" ? parsed.rerankApplied : undefined,
              rerankFallbackReason: readString(parsed.rerankFallbackReason),
              selectedPaperTitle: readString(selectedPaper?.title),
              selectedPaperLastError: readString(selectedPaper?.last_error),
              selectedPaperSourceType: readString(selectedPaper?.source_type),
              selectedPaperFallbackReason: readString(selectedPaper?.fallback_reason),
              selectedFailedCount
            }
          : undefined
    };
  } catch {
    return undefined;
  }
}

function parseImplementStatusProjectionHints(raw: string): RunProjectionHints | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = readString(parsed.message);
    const stage = readString(parsed.stage);
    const status = readString(parsed.status);
    if (!message && !stage && !status) {
      return undefined;
    }

    return {
      implement: {
        status,
        stage,
        message,
        updatedAt: readString(parsed.updatedAt),
        attempt: readNumber(parsed.attempt),
        maxAttempts: readNumber(parsed.maxAttempts),
        progressCount: readNumber(parsed.progressCount),
        scriptPath: readString(parsed.scriptPath),
        publicDir: readString(parsed.publicDir),
        runCommand: readString(parsed.runCommand),
        testCommand: readString(parsed.testCommand),
        verificationCommand: readString(parsed.verificationCommand),
        verifyStatus: readString(parsed.verifyStatus)
      }
    };
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readRecordMap(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readRunRecord(value: unknown): RunRecord | undefined {
  const record = readRecord(value);
  if (!record || !readRecord(record.graph) || !readString(record.currentNode) || !readString(record.status)) {
    return undefined;
  }
  return record as unknown as RunRecord;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readNumber(value);
}

function readCheckpointPhase(value: unknown): NonNullable<RunProjectionHints["checkpoint"]>["phase"] | undefined {
  return value === "before" || value === "after" || value === "fail" || value === "jump" || value === "retry"
    ? value
    : undefined;
}

function detectInitialGuidanceLanguage(): GuidanceLanguage {
  return "en";
}
