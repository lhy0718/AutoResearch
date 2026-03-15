import { RunInsightCard, RunRecord, SuggestionItem } from "../types.js";
import { ContextualGuidance } from "./contextualGuidance.js";
import { PaintColor, PaintStyle, paint, reset, stripAnsi, TUI_THEME } from "./theme.js";
import { getDisplayWidth } from "./displayWidth.js";

const COMPOSER_PROMPT = "› ";
const COMPOSER_PROMPT_WIDTH = getDisplayWidth(COMPOSER_PROMPT);

export interface RenderFrameInput {
  appVersion: string;
  busy: boolean;
  activityLabel?: string;
  thinking: boolean;
  thinkingFrame: number;
  terminalWidth?: number;
  terminalHeight?: number;
  modelLabel?: string;
  workspaceLabel?: string;
  footerItems?: string[];
  queueLength?: number;
  run?: RunRecord;
  runInsight?: RunInsightCard;
  logs: string[];
  input: string;
  inputCursor: number;
  newlineHintLabel?: string;
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  colorEnabled: boolean;
  transcriptScrollOffset?: number;
  guidance?: ContextualGuidance;
  selectionMenu?: {
    title: string;
    options: SelectionMenuOption[];
    selectedIndex: number;
  };
  showWelcomeBanner?: boolean;
}

export interface SelectionMenuOption {
  value: string;
  label: string;
  description?: string;
}

export interface RenderFrameOutput {
  lines: string[];
  inputLineIndex: number;
  inputColumn: number;
  thinkingLineIndex?: number;
  transcriptViewportLineCount: number;
  totalTranscriptLines: number;
  maxTranscriptScrollOffset: number;
  transcriptHiddenLineCountAbove: number;
  transcriptHiddenLineCountBelow: number;
  appliedTranscriptScrollOffset: number;
}

export function buildFrame(input: RenderFrameInput): RenderFrameOutput {
  const wrapWidth = Math.max(20, (input.terminalWidth ?? 120) - 1);
  const transcriptLines = buildTranscriptLines(input, wrapWidth);
  const bottomCore = buildBottomChrome(input, wrapWidth);

  let viewport = sliceTranscriptViewport(
    transcriptLines,
    resolveTranscriptViewportHeight(input.terminalHeight, bottomCore.lines.length + 1),
    input.transcriptScrollOffset ?? 0
  );

  let footerLine = renderFooterLine(input, viewport.hiddenLineCountAbove, viewport.hiddenLineCountBelow, wrapWidth);
  let bottomLines = footerLine ? [...bottomCore.lines, footerLine] : [...bottomCore.lines];

  viewport = sliceTranscriptViewport(
    transcriptLines,
    resolveTranscriptViewportHeight(input.terminalHeight, bottomLines.length),
    input.transcriptScrollOffset ?? 0
  );

  footerLine = renderFooterLine(input, viewport.hiddenLineCountAbove, viewport.hiddenLineCountBelow, wrapWidth);
  bottomLines = footerLine ? [...bottomCore.lines, footerLine] : [...bottomCore.lines];

  let lines = [...viewport.lines, ...bottomLines];
  let inputLineIndex = viewport.lines.length + bottomCore.inputLineIndex;
  let thinkingLineIndex =
    bottomCore.thinkingLineIndex !== undefined ? viewport.lines.length + bottomCore.thinkingLineIndex : undefined;

  if (input.terminalHeight && lines.length > input.terminalHeight) {
    const overflow = lines.length - input.terminalHeight;
    lines = lines.slice(-input.terminalHeight);
    inputLineIndex = Math.max(1, inputLineIndex - overflow);
    if (thinkingLineIndex !== undefined) {
      thinkingLineIndex = Math.max(1, thinkingLineIndex - overflow);
    }
  }

  return {
    lines,
    inputLineIndex,
    inputColumn: bottomCore.inputColumn,
    thinkingLineIndex,
    transcriptViewportLineCount: viewport.lines.length,
    totalTranscriptLines: transcriptLines.length,
    maxTranscriptScrollOffset: viewport.maxScrollOffset,
    transcriptHiddenLineCountAbove: viewport.hiddenLineCountAbove,
    transcriptHiddenLineCountBelow: viewport.hiddenLineCountBelow,
    appliedTranscriptScrollOffset: viewport.appliedScrollOffset
  };
}

interface BottomChromeOutput {
  lines: string[];
  inputLineIndex: number;
  inputColumn: number;
  thinkingLineIndex?: number;
}

interface TranscriptViewport {
  lines: string[];
  hiddenLineCountAbove: number;
  hiddenLineCountBelow: number;
  maxScrollOffset: number;
  appliedScrollOffset: number;
}

function buildTranscriptLines(input: RenderFrameInput, wrapWidth: number): string[] {
  const rawLines: string[] = [];

  if (input.showWelcomeBanner !== false) {
    rawLines.push(...renderWelcomeBannerCard(input, wrapWidth));
  }

  if (input.runInsight?.lines.length) {
    if (rawLines.length > 0) {
      rawLines.push("");
    }
    rawLines.push(renderSectionHeading(input.runInsight.title, input.colorEnabled));
    for (const line of input.runInsight.lines.slice(0, 4)) {
      rawLines.push(renderInsightLine(line, input.colorEnabled));
    }
    for (const action of input.runInsight.actions?.slice(0, 2) || []) {
      rawLines.push(renderInsightAction(action.label, action.command, input.colorEnabled));
    }
    for (const reference of input.runInsight.references?.slice(0, 5) || []) {
      rawLines.push(renderInsightReference(reference.kind, reference.label, reference.path, input.colorEnabled));
      rawLines.push(renderInsightReferenceSummary(reference.summary, input.colorEnabled));
      if (reference.facts?.length) {
        rawLines.push(renderInsightReferenceFacts(reference.facts, input.colorEnabled));
      }
      if (reference.details?.[0]) {
        rawLines.push(renderInsightReferenceDetail(reference.details[0], input.colorEnabled));
      }
    }
  }

  if (input.logs.length > 0) {
    if (rawLines.length > 0) {
      rawLines.push("");
    }
    for (const log of input.logs) {
      rawLines.push(renderLogLine(log, input.colorEnabled));
    }
  }

  return rawLines.flatMap((line) => wrapAnsiLine(line, wrapWidth));
}

function buildBottomChrome(input: RenderFrameInput, terminalWidth: number): BottomChromeOutput {
  const lines: string[] = [];
  let thinkingLineIndex: number | undefined;

  if (input.thinking || input.activityLabel) {
    lines.push(
      buildAnimatedStatusText(
        `• ${input.thinking ? "Thinking..." : input.activityLabel!}`,
        input.thinkingFrame,
        input.colorEnabled
      )
    );
    thinkingLineIndex = lines.length;
  }

  if (lines.length > 0) {
    lines.push("");
  }

  const composer = renderComposerBlock(input, terminalWidth);
  const inputLineIndex = lines.length + composer.inputLineIndex;
  lines.push(...composer.lines);

  const panelLines = buildBottomPanelLines(input, terminalWidth);
  if (panelLines.length > 0) {
    lines.push(...panelLines);
  }

  return {
    lines,
    inputLineIndex,
    inputColumn: composer.inputColumn,
    thinkingLineIndex
  };
}

function buildBottomPanelLines(input: RenderFrameInput, wrapWidth: number): string[] {
  if (input.selectionMenu) {
    return renderMenuSurface(
      [
        paint(input.selectionMenu.title, { fg: TUI_THEME.text, bg: TUI_THEME.panelBg, bold: true }, input.colorEnabled),
        ...renderSelectionRows(
          input.selectionMenu.options,
          input.selectionMenu.selectedIndex,
          input.colorEnabled,
          wrapWidth
        )
      ],
      input.colorEnabled,
      wrapWidth
    );
  }

  if (input.suggestions.length > 0) {
    return renderSuggestionPopupLines(
      renderSuggestionRows(input.suggestions, input.selectedSuggestion, input.colorEnabled, wrapWidth),
      wrapWidth
    );
  }

  return [];
}

function renderMenuSurface(rows: string[], colorEnabled: boolean, terminalWidth: number): string[] {
  const insetWidth = 2;
  const contentWidth = Math.max(1, terminalWidth - insetWidth);
  const lines: string[] = [];

  for (const row of rows) {
    for (const wrapped of wrapAnsiLine(row, contentWidth)) {
      const fillWidth = Math.max(0, contentWidth - getDisplayWidth(stripAnsi(wrapped)));
      lines.push(
        `${paint(" ".repeat(insetWidth), { bg: TUI_THEME.panelBg }, colorEnabled)}${wrapped}${paint(
          " ".repeat(fillWidth),
          { bg: TUI_THEME.panelBg },
          colorEnabled
        )}`
      );
    }
  }

  return lines;
}

function renderSuggestionPopupLines(rows: string[], terminalWidth: number): string[] {
  const contentWidth = Math.max(1, terminalWidth - 2);
  const lines: string[] = [];

  for (const row of rows) {
    for (const wrapped of wrapAnsiLine(row, contentWidth)) {
      lines.push(`  ${wrapped}`);
    }
  }

  return lines;
}

function resolveTranscriptViewportHeight(terminalHeight: number | undefined, bottomChromeHeight: number): number | undefined {
  if (!terminalHeight) {
    return undefined;
  }
  return Math.max(0, terminalHeight - bottomChromeHeight);
}

function sliceTranscriptViewport(
  transcriptLines: string[],
  viewportHeight: number | undefined,
  requestedScrollOffset: number
): TranscriptViewport {
  if (viewportHeight === undefined) {
    return {
      lines: transcriptLines,
      hiddenLineCountAbove: 0,
      hiddenLineCountBelow: 0,
      maxScrollOffset: 0,
      appliedScrollOffset: 0
    };
  }

  const maxScrollOffset = Math.max(0, transcriptLines.length - viewportHeight);
  const appliedScrollOffset = Math.min(Math.max(0, requestedScrollOffset), maxScrollOffset);
  const end = Math.max(0, transcriptLines.length - appliedScrollOffset);
  const start = Math.max(0, end - viewportHeight);

  return {
    lines: transcriptLines.slice(start, end),
    hiddenLineCountAbove: start,
    hiddenLineCountBelow: transcriptLines.length - end,
    maxScrollOffset,
    appliedScrollOffset
  };
}

function wrapAnsiLine(line: string, width: number): string[] {
  if (!line) {
    return [""];
  }
  if (getDisplayWidth(stripAnsi(line)) <= width) {
    return [line];
  }

  const tokens = line.split(/(\x1b\[[0-9;]*m)/g).filter((token) => token.length > 0);
  const out: string[] = [];
  let active = "";
  let current = "";
  let currentWidth = 0;

  const flush = (): void => {
    if (!current) {
      return;
    }
    const needsReset = active && !current.endsWith(reset);
    out.push(needsReset ? `${current}${reset}` : current);
    current = active;
    currentWidth = 0;
  };

  for (const token of tokens) {
    if (/^\x1b\[[0-9;]*m$/.test(token)) {
      current += token;
      active = token === reset ? "" : `${active}${token}`;
      if (token === reset) {
        active = "";
      }
      continue;
    }

    for (const char of Array.from(token)) {
      const charWidth = getDisplayWidth(char);
      if (currentWidth > 0 && currentWidth + charWidth > width) {
        flush();
      }
      current += char;
      currentWidth += charWidth;
    }
  }

  if (current) {
    const needsReset = active && !current.endsWith(reset);
    out.push(needsReset ? `${current}${reset}` : current);
  }

  return out.length > 0 ? out : [line];
}

function renderFooterLine(
  input: RenderFrameInput,
  hiddenLineCountAbove: number,
  hiddenLineCountBelow: number,
  terminalWidth: number
): string | undefined {
  const footerParts = fitFooterParts(
    [...buildFooterHintParts(input, hiddenLineCountAbove, hiddenLineCountBelow), ...buildFooterMetaParts(input)],
    terminalWidth
  );
  if (footerParts.length === 0) {
    return undefined;
  }
  return renderFooterParts(footerParts, input.colorEnabled);
}

interface FooterPart {
  text: string;
  kind: "hint" | "state" | "model" | "version";
}

function buildFooterHintParts(
  input: RenderFrameInput,
  hiddenLineCountAbove: number,
  hiddenLineCountBelow: number
): FooterPart[] {
  const parts: FooterPart[] = [];

  if (input.selectionMenu) {
    parts.push(createFooterPart("↑↓ navigate", "hint"));
    parts.push(createFooterPart("Enter select", "hint"));
    parts.push(createFooterPart("Esc close", "hint"));
    return parts;
  }

  if (input.suggestions.length > 0) {
    parts.push(createFooterPart("↑↓ navigate", "hint"));
    parts.push(createFooterPart("Tab complete", "hint"));
    parts.push(createFooterPart("Enter run", "hint"));
    parts.push(createFooterPart("Esc close", "hint"));
    return parts;
  }

  if (hiddenLineCountAbove > 0 || hiddenLineCountBelow > 0) {
    parts.push(createFooterPart("PgUp/PgDn scroll", "hint"));
  }
  if (hiddenLineCountBelow > 0) {
    parts.push(createFooterPart("End latest", "hint"));
  }

  return parts;
}

function buildFooterMetaParts(input: RenderFrameInput): FooterPart[] {
  const parts: FooterPart[] = [];

  for (const item of input.footerItems || []) {
    const trimmed = item.trim();
    if (trimmed) {
      parts.push(createFooterPart(trimmed, "state"));
    }
  }

  if (input.queueLength && input.queueLength > 0) {
    parts.push(createFooterPart(`queue:${input.queueLength}`, "state"));
  }

  const workspaceLabel = input.workspaceLabel?.trim();
  if (workspaceLabel) {
    const home = typeof process !== "undefined" ? process.env?.HOME : undefined;
    let displayWorkspace = workspaceLabel;
    if (home && workspaceLabel.startsWith(home)) {
      displayWorkspace = workspaceLabel === home ? "~" : `~${workspaceLabel.slice(home.length)}`;
    }
    const basename = displayWorkspace.split("/").pop() || displayWorkspace;
    parts.push(createFooterPart(basename, "state"));
  }

  const modelLabel = input.modelLabel?.trim();
  if (modelLabel) {
    parts.push(createFooterPart(modelLabel, "model"));
  }

  const versionLabel = normalizeFooterVersion(input.appVersion);
  if (versionLabel) {
    parts.push(createFooterPart(versionLabel, "version"));
  }

  return parts;
}

function fitFooterParts(parts: FooterPart[], terminalWidth: number): FooterPart[] {
  let next = [...parts];

  while (measureFooterParts(next) > terminalWidth && next.filter((part) => part.kind === "hint").length > 2) {
    const lastHintIndex = next.map((part) => part.kind).lastIndexOf("hint");
    if (lastHintIndex < 0) {
      break;
    }
    next.splice(lastHintIndex, 1);
  }

  while (measureFooterParts(next) > terminalWidth && next.some((part) => part.kind === "state")) {
    const stateIndex = next.findIndex((part) => part.kind === "state");
    if (stateIndex < 0) {
      break;
    }
    next.splice(stateIndex, 1);
  }

  while (measureFooterParts(next) > terminalWidth && next.length > 0 && next.at(-1)?.kind === "version") {
    next = next.slice(0, -1);
  }

  const modelIndex = next.findIndex((part) => part.kind === "model");
  if (modelIndex >= 0 && measureFooterParts(next) > terminalWidth) {
    const withoutModel = next.filter((_, index) => index !== modelIndex);
    const remainingWidth = Math.max(8, terminalWidth - measureFooterParts(withoutModel) - footerJoinerWidth(withoutModel.length > 0));
    next[modelIndex] = {
      ...next[modelIndex],
      text: truncatePlainText(next[modelIndex]!.text, remainingWidth)
    };
  }

  while (measureFooterParts(next) > terminalWidth && next.length > 0 && next[0]?.kind === "hint") {
    next = next.slice(1);
  }

  while (measureFooterParts(next) > terminalWidth && next.length > 1) {
    next = next.slice(0, -1);
  }

  if (measureFooterParts(next) > terminalWidth && next.length > 0) {
    const lastIndex = next.length - 1;
    next[lastIndex] = {
      ...next[lastIndex]!,
      text: truncatePlainText(next[lastIndex]!.text, Math.max(6, terminalWidth))
    };
  }

  return next;
}

function normalizeFooterVersion(appVersion: string): string {
  const trimmed = appVersion.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function createFooterPart(text: string, kind: FooterPart["kind"]): FooterPart {
  return { text, kind };
}

function measureFooterParts(parts: FooterPart[]): number {
  if (parts.length === 0) {
    return 0;
  }

  return parts.reduce((total, part, index) => {
    const partWidth = getDisplayWidth(part.text);
    if (index === 0) {
      return partWidth;
    }
    return total + footerJoinerWidth(true) + partWidth;
  }, 0);
}

function footerJoinerWidth(include: boolean): number {
  return include ? getDisplayWidth(" · ") : 0;
}

function renderFooterParts(parts: FooterPart[], colorEnabled: boolean): string {
  if (parts.length === 0) {
    return "";
  }

  const style = { fg: TUI_THEME.muted, dim: true };
  const joiner = paint(" · ", style, colorEnabled);
  return parts.map((part) => paint(part.text, style, colorEnabled)).join(joiner);
}

interface ComposerBlockOutput {
  lines: string[];
  inputLineIndex: number;
  inputColumn: number;
}

const COMPOSER_MAX_VISIBLE_LINES = 6;

function renderComposerBlock(input: RenderFrameInput, terminalWidth: number): ComposerBlockOutput {
  const contentWidth = Math.max(24, terminalWidth - 1);
  const spacerLine = renderComposerSurfaceLine({
    prefix: "",
    prefixStyle: { bg: TUI_THEME.composerBg },
    content: "",
    contentStyle: { bg: TUI_THEME.composerBg },
    contentWidth,
    fillStyle: { bg: TUI_THEME.composerBg },
    colorEnabled: input.colorEnabled
  });
  const body = renderComposerBody(input, contentWidth);

  let visibleLines = body.lines;
  let cursorLineIndex = body.cursorLineIndex;

  if (visibleLines.length > COMPOSER_MAX_VISIBLE_LINES) {
    const cursorLine = cursorLineIndex;
    const half = Math.floor(COMPOSER_MAX_VISIBLE_LINES / 2);
    let start = Math.max(0, cursorLine - half);
    let end = start + COMPOSER_MAX_VISIBLE_LINES;
    if (end > visibleLines.length) {
      end = visibleLines.length;
      start = Math.max(0, end - COMPOSER_MAX_VISIBLE_LINES);
    }
    visibleLines = visibleLines.slice(start, end);
    cursorLineIndex = cursorLine - start;
  }

  return {
    lines: [spacerLine, ...visibleLines, spacerLine],
    inputLineIndex: cursorLineIndex + 2,
    inputColumn: 1 + body.cursorOffset
  };
}

interface ComposerBodyOutput {
  lines: string[];
  cursorLineIndex: number;
  cursorOffset: number;
}

function renderComposerBody(input: RenderFrameInput, contentWidth: number): ComposerBodyOutput {
  const availableWidth = Math.max(1, contentWidth - COMPOSER_PROMPT_WIDTH);
  const backgroundStyle = { bg: TUI_THEME.composerBg };
  const promptStyle = { fg: TUI_THEME.text, bg: TUI_THEME.composerBg, bold: true };
  const textStyle = { fg: TUI_THEME.text, bg: TUI_THEME.composerBg };
  const placeholderStyle = { fg: TUI_THEME.muted, bg: TUI_THEME.composerBg, dim: true };
  const runNodeStatus = input.run ? input.run.graph.nodeStates[input.run.currentNode]?.status : undefined;
  const busyPlaceholder =
    input.busy && input.activityLabel?.startsWith("Starting research") && !input.run
      ? "Creating a new research run. Wait for the first node update."
      : "Add steering to redirect the current run.";

  if (input.input.length === 0) {
    const placeholder = input.busy
      ? busyPlaceholder
      : input.run
        ? input.run.status === "paused" && runNodeStatus !== "needs_approval"
          ? "Type a command or message… (/help for options)"
          : "Add steering, or wait for the next approval."
        : "Start with /new to create a Research Brief.";
    return {
      lines: [
      renderComposerSurfaceLine({
        prefix: COMPOSER_PROMPT,
        prefixStyle: promptStyle,
        content: truncatePlainText(placeholder, availableWidth),
        contentStyle: placeholderStyle,
        contentWidth,
        fillStyle: backgroundStyle,
        colorEnabled: input.colorEnabled
      })
      ],
      cursorLineIndex: 0,
      cursorOffset: COMPOSER_PROMPT_WIDTH
    };
  }

  const fullLines = input.input.split("\n");
  const beforeCursor = Array.from(input.input).slice(0, Math.max(0, input.inputCursor)).join("");
  const cursorLogicalLineIndex = beforeCursor.split("\n").length - 1;
  const currentLineBeforeCursor = beforeCursor.split("\n").at(-1) ?? "";
  const cursorCharCount = Array.from(currentLineBeforeCursor).length;
  const renderedLines: string[] = [];
  let cursorLineIndex = 0;
  let cursorOffset = COMPOSER_PROMPT_WIDTH;

  for (const [logicalLineIndex, line] of fullLines.entries()) {
    const segments = wrapComposerLine(line, availableWidth);
    const cursorLocation =
      logicalLineIndex === cursorLogicalLineIndex ? locateWrappedCursor(segments, cursorCharCount) : undefined;

    for (const [segmentIndex, segment] of segments.entries()) {
      const isPromptLine = renderedLines.length === 0;
      renderedLines.push(
        renderComposerSurfaceLine({
          prefix: isPromptLine ? COMPOSER_PROMPT : " ".repeat(COMPOSER_PROMPT_WIDTH),
          prefixStyle: isPromptLine ? promptStyle : backgroundStyle,
          content: segment.text,
          contentStyle: textStyle,
          contentWidth,
          fillStyle: backgroundStyle,
          colorEnabled: input.colorEnabled
        })
      );

      if (cursorLocation && cursorLocation.segmentIndex === segmentIndex) {
        cursorLineIndex = renderedLines.length - 1;
        cursorOffset = COMPOSER_PROMPT_WIDTH + cursorLocation.cursorOffset;
      }
    }
  }

  return {
    lines: renderedLines,
    cursorLineIndex,
    cursorOffset
  };
}

interface WrappedComposerSegment {
  text: string;
  charCount: number;
  width: number;
}

function wrapComposerLine(text: string, maxWidth: number): WrappedComposerSegment[] {
  const chars = Array.from(text);
  if (chars.length === 0) {
    return [{ text: "", charCount: 0, width: 0 }];
  }

  const segments: WrappedComposerSegment[] = [];
  let currentChars: string[] = [];
  let currentWidth = 0;

  for (const char of chars) {
    const charWidth = getDisplayWidth(char);
    if (currentWidth > 0 && currentWidth + charWidth > maxWidth) {
      segments.push({
        text: currentChars.join(""),
        charCount: currentChars.length,
        width: currentWidth
      });
      currentChars = [char];
      currentWidth = charWidth;
      continue;
    }

    currentChars.push(char);
    currentWidth += charWidth;
  }

  segments.push({
    text: currentChars.join(""),
    charCount: currentChars.length,
    width: currentWidth
  });

  return segments;
}

function locateWrappedCursor(
  segments: WrappedComposerSegment[],
  cursorCharCount: number
): { segmentIndex: number; cursorOffset: number } {
  let remainingChars = Math.max(0, cursorCharCount);

  for (const [segmentIndex, segment] of segments.entries()) {
    if (remainingChars <= segment.charCount) {
      const prefix = Array.from(segment.text)
        .slice(0, remainingChars)
        .join("");
      return {
        segmentIndex,
        cursorOffset: getDisplayWidth(prefix)
      };
    }
    remainingChars -= segment.charCount;
  }

  const lastSegment = segments[segments.length - 1] ?? { text: "", charCount: 0, width: 0 };
  return {
    segmentIndex: Math.max(0, segments.length - 1),
    cursorOffset: lastSegment.width
  };
}

function renderComposerSurfaceLine(args: {
  prefix: string;
  prefixStyle: PaintStyle;
  content: string;
  contentStyle: PaintStyle;
  contentWidth: number;
  fillStyle: PaintStyle;
  colorEnabled: boolean;
}): string {
  const usedWidth = getDisplayWidth(args.prefix) + getDisplayWidth(args.content);
  const fillWidth = Math.max(0, args.contentWidth - usedWidth);
  return `${paint(args.prefix, args.prefixStyle, args.colorEnabled)}${paint(args.content, args.contentStyle, args.colorEnabled)}${paint(" ".repeat(fillWidth), args.fillStyle, args.colorEnabled)}`;
}

function renderWelcomeBannerCard(input: RenderFrameInput, terminalWidth: number): string[] {
  const innerWidth = Math.max(16, Math.min(45, terminalWidth - 4));
  const colorEnabled = input.colorEnabled;
  const borderStyle = { fg: TUI_THEME.muted, dim: true };
  const mutedStyle = { fg: TUI_THEME.muted, dim: true };
  const textStyle = { fg: TUI_THEME.text };
  const labelWidth = "directory:".length;
  const modelPrefix = `${"model:".padEnd(labelWidth)} `;
  const dirPrefix = `${"directory:".padEnd(labelWidth)} `;
  const versionLabel = normalizeFooterVersion(input.appVersion);
  const title = `${paint(">_ ", mutedStyle, colorEnabled)}${paint("AutoLabOS", { fg: TUI_THEME.text, bold: true }, colorEnabled)}${paint(
    ` (${versionLabel})`,
    mutedStyle,
    colorEnabled
  )}`;
  const modelHint = `${paint("/model", { fg: TUI_THEME.accent }, colorEnabled)}${paint(" to change", mutedStyle, colorEnabled)}`;
  const modelHintWidth = getDisplayWidth("/model to change");
  const modelWidth = Math.max(8, innerWidth - getDisplayWidth(modelPrefix) - modelHintWidth - 3);
  const modelLabel = truncatePlainText(input.modelLabel?.trim() || "loading", modelWidth);
  const directory = truncatePlainText(
    formatBannerDirectory(input.workspaceLabel),
    Math.max(8, innerWidth - getDisplayWidth(dirPrefix))
  );
  const topBorder = paint(`╭${"─".repeat(innerWidth + 2)}╮`, borderStyle, colorEnabled);
  const bottomBorder = paint(`╰${"─".repeat(innerWidth + 2)}╯`, borderStyle, colorEnabled);
  const emptyRow = `${paint("│", borderStyle, colorEnabled)} ${" ".repeat(innerWidth)} ${paint("│", borderStyle, colorEnabled)}`;

  return [
    topBorder,
    renderBannerCardRow(title, innerWidth, colorEnabled),
    emptyRow,
    renderBannerCardRow(
      `${paint(modelPrefix, mutedStyle, colorEnabled)}${paint(modelLabel, textStyle, colorEnabled)}${paint("   ", mutedStyle, colorEnabled)}${modelHint}`,
      innerWidth,
      colorEnabled
    ),
    renderBannerCardRow(
      `${paint(dirPrefix, mutedStyle, colorEnabled)}${paint(directory, textStyle, colorEnabled)}`,
      innerWidth,
      colorEnabled
    ),
    bottomBorder
  ];
}

function renderBannerCardRow(content: string, innerWidth: number, colorEnabled: boolean): string {
  const border = paint("│", { fg: TUI_THEME.muted, dim: true }, colorEnabled);
  return `${border} ${padAnsiRight(content, innerWidth)} ${border}`;
}

function formatBannerDirectory(workspaceLabel: string | undefined): string {
  const workspace = workspaceLabel?.trim();
  if (!workspace) {
    return "~";
  }

  const home = process.env.HOME;
  if (home && workspace === home) {
    return "~";
  }
  if (home && workspace.startsWith(`${home}/`)) {
    return `~/${workspace.slice(home.length + 1)}`;
  }
  return workspace;
}

function takeHeadByWidth(chars: string[], maxWidth: number): string[] {
  const out: string[] = [];
  let width = 0;
  for (const char of chars) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth > maxWidth) {
      break;
    }
    out.push(char);
    width += charWidth;
  }
  return out;
}

function truncatePlainText(text: string, maxWidth: number): string {
  if (getDisplayWidth(text) <= maxWidth) {
    return text;
  }
  return `${takeHeadByWidth(Array.from(text), Math.max(1, maxWidth - 3)).join("")}...`;
}

function renderFloatingPanel(
  title: string | undefined,
  rows: string[],
  colorEnabled: boolean,
  terminalWidth: number
): string[] {
  const visibleRows = title ? [title, ...rows] : [...rows];
  const maxContentWidth = Math.max(...visibleRows.map((row) => getDisplayWidth(stripAnsi(row))), 0);
  const contentWidth = Math.min(Math.max(24, maxContentWidth), Math.max(24, terminalWidth - 4));
  const topBorder = paint(`╭${"─".repeat(contentWidth + 2)}╮`, { fg: TUI_THEME.panel }, colorEnabled);
  const bottomBorder = paint(`╰${"─".repeat(contentWidth + 2)}╯`, { fg: TUI_THEME.panel }, colorEnabled);
  const rendered = [topBorder];

  visibleRows.forEach((row, index) => {
    const body =
      index === 0 && title
        ? paint(stripAnsi(title) === title ? title : row, { fg: TUI_THEME.text, bold: true }, colorEnabled)
        : row;
    rendered.push(
      `${paint("│", { fg: TUI_THEME.panel }, colorEnabled)} ${padAnsiRight(body, contentWidth)} ${paint("│", { fg: TUI_THEME.panel }, colorEnabled)}`
    );
  });

  rendered.push(bottomBorder);
  return rendered;
}

function padAnsiRight(text: string, width: number): string {
  const plainWidth = getDisplayWidth(stripAnsi(text));
  if (plainWidth >= width) {
    return text;
  }
  return `${text}${" ".repeat(width - plainWidth)}`;
}

function renderSectionHeading(title: string, colorEnabled: boolean): string {
  return paint(title, { fg: TUI_THEME.text, bold: true }, colorEnabled);
}

interface SuggestionRowArgs {
  suggestion: SuggestionItem;
  selected: boolean;
  colorEnabled: boolean;
  descriptionColumn?: number;
}

function renderSuggestionRow(args: SuggestionRowArgs): string {
  return renderPopupMenuRow({
    label: args.suggestion.label,
    description: args.suggestion.description,
    selected: args.selected,
    colorEnabled: args.colorEnabled,
    descriptionColumn: args.descriptionColumn,
    backgroundCode: undefined
  });
}

interface SelectionRowArgs {
  option: SelectionMenuOption;
  selected: boolean;
  colorEnabled: boolean;
  descriptionColumn?: number;
}

function renderSelectionRow(args: SelectionRowArgs): string {
  return renderPopupMenuRow({
    label: args.option.label,
    description: args.option.description,
    selected: args.selected,
    colorEnabled: args.colorEnabled,
    descriptionColumn: args.descriptionColumn,
    backgroundCode: TUI_THEME.panelBg
  });
}

function renderSuggestionRows(
  suggestions: SuggestionItem[],
  selectedSuggestion: number,
  colorEnabled: boolean,
  wrapWidth: number
): string[] {
  const descriptionColumn = computeMenuDescriptionColumn(
    suggestions.map((suggestion) => suggestion.label),
    suggestions.map((suggestion) => suggestion.description),
    Math.max(1, wrapWidth - 4)
  );
  return suggestions.map((suggestion, idx) =>
    renderSuggestionRow({
      suggestion,
      selected: idx === selectedSuggestion,
      colorEnabled,
      descriptionColumn
    })
  );
}

function renderSelectionRows(
  options: SelectionMenuOption[],
  selectedIndex: number,
  colorEnabled: boolean,
  wrapWidth: number
): string[] {
  const descriptionColumn = computeMenuDescriptionColumn(
    options.map((option) => option.label),
    options.map((option) => option.description),
    Math.max(1, wrapWidth - 4)
  );
  return options.map((option, idx) =>
    renderSelectionRow({
      option,
      selected: idx === selectedIndex,
      colorEnabled,
      descriptionColumn
    })
  );
}

function computeMenuDescriptionColumn(
  labels: string[],
  descriptions: Array<string | undefined>,
  contentWidth: number
): number | undefined {
  if (!descriptions.some((description) => Boolean(description))) {
    return undefined;
  }

  const widestLabel = labels.reduce((max, label) => Math.max(max, getDisplayWidth(label)), 0);
  const maxDescriptionColumn = Math.max(12, Math.floor(contentWidth * 0.7));
  return Math.min(widestLabel + 2, maxDescriptionColumn);
}

function renderPopupMenuRow(args: {
  label: string;
  description?: string;
  selected: boolean;
  colorEnabled: boolean;
  descriptionColumn?: number;
  backgroundCode?: PaintColor;
}): string {
  const labelStyle = args.selected
    ? { fg: TUI_THEME.accent, bold: true, bg: args.backgroundCode }
    : { fg: TUI_THEME.text, bg: args.backgroundCode };
  const descriptionStyle = args.selected
    ? { fg: TUI_THEME.accent, bold: true, bg: args.backgroundCode }
    : { fg: TUI_THEME.muted, dim: true, bg: args.backgroundCode };
  const label = paint(args.label, labelStyle, args.colorEnabled);
  if (!args.description || args.descriptionColumn === undefined) {
    return label;
  }

  const gap = Math.max(2, args.descriptionColumn - getDisplayWidth(args.label));
  const gapText =
    args.backgroundCode === undefined
      ? " ".repeat(gap)
      : paint(" ".repeat(gap), { bg: args.backgroundCode }, args.colorEnabled);
  return `${label}${gapText}${paint(args.description, descriptionStyle, args.colorEnabled)}`;
}

function renderInsightLine(line: string, colorEnabled: boolean): string {
  return `${paint("•", { fg: TUI_THEME.accent, bold: true }, colorEnabled)} ${paint(line, { fg: TUI_THEME.text }, colorEnabled)}`;
}

function renderInsightAction(label: string, command: string, colorEnabled: boolean): string {
  return `${paint(">", { fg: TUI_THEME.muted, bold: true }, colorEnabled)} ${paint(`${label}:`, { fg: TUI_THEME.muted, bold: true }, colorEnabled)} ${paint(command, { fg: TUI_THEME.accent }, colorEnabled)}`;
}

function renderInsightReference(
  kind: "figure" | "comparison" | "statistics" | "transition" | "report" | "metrics",
  label: string,
  referencePath: string,
  colorEnabled: boolean
): string {
  const kindLabel = kind.toUpperCase();
  return `${paint(">", { fg: TUI_THEME.muted, bold: true }, colorEnabled)} ${paint(`[${kindLabel}]`, { fg: TUI_THEME.accent, bold: true }, colorEnabled)} ${paint(`${label}:`, { fg: TUI_THEME.muted }, colorEnabled)} ${paint(referencePath, { fg: TUI_THEME.success }, colorEnabled)}`;
}

function renderInsightReferenceSummary(summary: string, colorEnabled: boolean): string {
  return `  ${paint(truncateForInsight(summary), { fg: TUI_THEME.muted, dim: true }, colorEnabled)}`;
}

function renderInsightReferenceFacts(
  facts: Array<{ label: string; value: string }>,
  colorEnabled: boolean
): string {
  const joined = facts.map((fact) => `${fact.label} ${fact.value}`).join(" | ");
  return `  ${paint(truncateForInsight(joined), { fg: TUI_THEME.accent }, colorEnabled)}`;
}

function renderInsightReferenceDetail(detail: string, colorEnabled: boolean): string {
  return `  ${paint(truncateForInsight(detail), { fg: TUI_THEME.muted }, colorEnabled)}`;
}

function truncateForInsight(text: string, maxLength = 170): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function renderLogLine(log: string, colorEnabled: boolean): string {
  if (!log) {
    return "";
  }

  const classified = classifyLogLine(log);
  const prefix = paint(classified.marker, classified.prefixStyle, colorEnabled);
  const text = paint(log, classified.textStyle, colorEnabled);
  return `${prefix} ${text}`;
}

interface ClassifiedLogLine {
  marker: "•" | "!" | "+" | "x";
  prefixStyle: PaintStyle;
  textStyle: PaintStyle;
}

function classifyLogLine(log: string): ClassifiedLogLine {
  const lower = log.toLowerCase();

  if (
    log === "Help" ||
    log === "Flow:" ||
    log === "Controls:" ||
    log === "Notes:"
  ) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.accent, bold: true }
    };
  }
  if (log.startsWith("/")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text }
    };
  }
  if (log.startsWith("Examples:") || log.startsWith("Ask 'what natural inputs are supported?'")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (log.startsWith("Collect options:")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.muted }
    };
  }
  if (log.startsWith("Execution requests require") || log.startsWith("While thinking,")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.muted, dim: true }
    };
  }
  if (lower.startsWith("collect dry-run plan:") || lower.startsWith("graph nodes:")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.accent, bold: true }
    };
  }
  if (
    lower.startsWith("usage:") ||
    lower.startsWith("canceled") ||
    lower.startsWith("cancel requested:") ||
    lower.startsWith("collect option warning:") ||
    lower.startsWith("model selection canceled.") ||
    lower.startsWith("pending natural action cleared:") ||
    lower.startsWith("no runs found.") ||
    lower.startsWith("no active run.")
  ) {
    return {
      marker: "!",
      prefixStyle: { fg: TUI_THEME.warning, bold: true },
      textStyle: { fg: TUI_THEME.warning, bold: true }
    };
  }
  if (
    lower.startsWith("queued turn:") ||
    lower.startsWith("running queued input:") ||
    lower.startsWith("replanning current natural query") ||
    lower.startsWith("steering applied") ||
    lower.startsWith("detected paper cleanup intent.") ||
    lower.startsWith("running immediately:") ||
    lower.startsWith("generating run title with codex...")
  ) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.accent }
    };
  }
  if (
    lower.startsWith("[ok]") ||
    lower.startsWith("confirmed.") ||
    lower.startsWith("created run") ||
    lower.startsWith("updated title:") ||
    lower.startsWith("selected run") ||
    lower.startsWith("run resumed") ||
    lower.startsWith("node ") ||
    lower.startsWith("cleared ") ||
    lower.startsWith("focused current node") ||
    lower.startsWith("jumped to ") ||
    lower.startsWith("retry set ") ||
    lower.startsWith("retry armed ") ||
    lower.startsWith("approved ") ||
    lower.startsWith("settings saved.") ||
    lower.startsWith("collect_papers finished:") ||
    lower.startsWith("run completed.") ||
    lower.startsWith("plan completed after ")
  ) {
    return {
      marker: "+",
      prefixStyle: { fg: TUI_THEME.success, bold: true },
      textStyle: { fg: TUI_THEME.success, bold: true }
    };
  }
  if (
    lower.startsWith("the current run has ") ||
    lower.startsWith("papers without a pdf path:") ||
    lower.startsWith("the top-cited paper is ") ||
    lower.startsWith("here are ")
  ) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text }
    };
  }
  if (/^\d+\.\s/u.test(log)) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text }
    };
  }
  if (lower.startsWith("execution plan detected.") || /^-\s*\[\d+\/\d+\]/u.test(log) || /^step \d+\/\d+:/iu.test(log)) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (lower.startsWith("next plan step ready") || lower.startsWith("remaining plan steps")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (
    lower.startsWith("attempting automatic replan after failed step") ||
    lower.startsWith("the previous collect step failed. i can retry") ||
    lower.startsWith("replan matched the failed plan")
  ) {
    return {
      marker: lower.startsWith("replan matched") ? "!" : "•",
      prefixStyle: lower.startsWith("replan matched")
        ? { fg: TUI_THEME.warning, bold: true }
        : { fg: TUI_THEME.accent, bold: true },
      textStyle: lower.startsWith("replan matched")
        ? { fg: TUI_THEME.warning, bold: true }
        : { fg: TUI_THEME.text }
    };
  }
  if (lower.startsWith("no revised execution plan was suggested.")) {
    return {
      marker: "!",
      prefixStyle: { fg: TUI_THEME.warning, bold: true },
      textStyle: { fg: TUI_THEME.warning, bold: true }
    };
  }

  if (lower.startsWith("error:") || lower.includes("[fail]") || lower.includes("failed")) {
    return {
      marker: "x",
      prefixStyle: { fg: TUI_THEME.danger, bold: true },
      textStyle: { fg: TUI_THEME.danger, bold: true }
    };
  }
  if (lower.startsWith("next step:") || lower.startsWith("next action:") || lower.startsWith("execution intent detected")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (
    lower.startsWith("natural query:") ||
    lower.startsWith("available commands:") ||
    lower.startsWith("current node:")
  ) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (
    lower.startsWith("confirmed.") ||
    lower.startsWith("run ") ||
    lower.startsWith("run:") ||
    lower.startsWith("status:") ||
    lower.startsWith("workflow:") ||
    lower.startsWith("node ") ||
    lower.startsWith("created run") ||
    lower.startsWith("selected run") ||
    lower.startsWith("graph ") ||
    lower.startsWith("resumed run") ||
    lower.startsWith("retry ") ||
    lower.startsWith("approved ")
  ) {
    return {
      marker: "+",
      prefixStyle: { fg: TUI_THEME.success, bold: true },
      textStyle: { fg: TUI_THEME.text }
    };
  }
  if (
    lower.startsWith("next step ready:") ||
    lower.startsWith("a pending step is ready.") ||
    lower.startsWith("type 'y'") ||
    lower.startsWith("pending command:") ||
    lower.startsWith("pending plan:") ||
    lower.startsWith("pending plan from step ") ||
    lower.startsWith("stopped remaining plan")
  ) {
    return {
      marker: "!",
      prefixStyle: { fg: TUI_THEME.warning, bold: true },
      textStyle: { fg: TUI_THEME.accent, bold: true }
    };
  }
  if (lower.startsWith("use the suggested")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.muted, dim: true }
    };
  }
  return {
    marker: "•",
    prefixStyle: { fg: TUI_THEME.accent, bold: true },
    textStyle: { fg: TUI_THEME.muted }
  };
}

export function buildThinkingText(frame: number, colorEnabled: boolean): string {
  return buildAnimatedStatusText("Thinking...", frame, colorEnabled);
}

export function buildAnimatedStatusText(text: string, frame: number, colorEnabled: boolean): string {
  if (!colorEnabled) {
    return text;
  }

  const chars = Array.from(text);
  const window = [90, 37, 97, 37, 90];
  const head = frame % (chars.length + window.length) - window.length;

  const painted = chars.map((ch, idx) => {
    const dist = idx - head;
    const shade = dist >= 0 && dist < window.length ? window[dist] : 90;
    const bold = shade === 97;
    return paint(ch, { fg: shade, bold }, colorEnabled);
  });

  return painted.join("");
}
