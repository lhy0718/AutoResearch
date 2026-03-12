import { RunInsightCard, RunRecord, SuggestionItem } from "../types.js";
import { ContextualGuidance, GuidanceItem } from "./contextualGuidance.js";
import { PaintStyle, paint, reset, stripAnsi, TUI_THEME } from "./theme.js";
import { getDisplayWidth } from "./displayWidth.js";

export interface RenderFrameInput {
  appVersion: string;
  busy: boolean;
  activityLabel?: string;
  thinking: boolean;
  thinkingFrame: number;
  terminalWidth?: number;
  modelLabel?: string;
  workspaceLabel?: string;
  footerItems?: string[];
  run?: RunRecord;
  runInsight?: RunInsightCard;
  logs: string[];
  input: string;
  inputCursor: number;
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  colorEnabled: boolean;
  guidance?: ContextualGuidance;
  selectionMenu?: {
    title: string;
    options: SelectionMenuOption[];
    selectedIndex: number;
  };
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
}

export function buildFrame(input: RenderFrameInput): RenderFrameOutput {
  const rawLines: string[] = [];
  let rawThinkingLineIndex: number | undefined;
  const wrapWidth = Math.max(20, (input.terminalWidth ?? 120) - 1);
  const tipLine = buildTipLine(input);

  rawLines.push(...renderHeaderCard(input, wrapWidth));

  if (tipLine) {
    rawLines.push("");
    rawLines.push(tipLine);
  }

  if (input.runInsight?.lines.length) {
    rawLines.push("");
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

  const recentLogs = input.logs.slice(-12);
  rawLines.push("");
  if (recentLogs.length === 0) {
    rawLines.push(paint("No transcript yet. Try /new, /help, or describe the task you want to run.", { fg: TUI_THEME.muted }, input.colorEnabled));
  } else {
    for (const log of recentLogs) {
      rawLines.push(renderLogLine(log, input.colorEnabled));
    }
  }

  if (input.thinking || input.activityLabel) {
    rawLines.push("");
    rawLines.push(
      buildAnimatedStatusText(
        `• ${input.thinking ? "Thinking..." : input.activityLabel!}`,
        input.thinkingFrame,
        input.colorEnabled
      )
    );
    rawThinkingLineIndex = rawLines.length;
  }

  if (input.suggestions.length > 0) {
    rawLines.push("");
    rawLines.push(
      ...renderFloatingPanel(
        "Command suggestions",
        input.suggestions.map((suggestion, idx) =>
          renderSuggestionRow({
            suggestion,
            selected: idx === input.selectedSuggestion,
            colorEnabled: input.colorEnabled
          })
        ),
        input.colorEnabled,
        wrapWidth
      )
    );
  }

  if (input.guidance && input.guidance.items.length > 0) {
    rawLines.push("");
    rawLines.push(
      ...renderFloatingPanel(
        input.guidance.title,
        input.guidance.items.map((item) =>
          renderGuidanceRow({
            item,
            colorEnabled: input.colorEnabled
          })
        ),
        input.colorEnabled,
        wrapWidth
      )
    );
  }

  if (input.selectionMenu) {
    rawLines.push("");
    rawLines.push(
      ...renderFloatingPanel(
        `${input.selectionMenu.title}  (↑/↓ move, Enter select, Esc cancel)`,
        input.selectionMenu.options.map((option, idx) =>
          renderSelectionRow({
            option,
            selected: idx === input.selectionMenu?.selectedIndex,
            colorEnabled: input.colorEnabled
          })
        ),
        input.colorEnabled,
        wrapWidth
      )
    );
  }

  rawLines.push("");
  rawLines.push(renderComposerLine(input));
  const rawInputLineIndex = rawLines.length;
  const inputColumn = 3 + getDisplayWidth(sliceByChars(input.input, input.inputCursor));

  const footerLine = renderFooterLine(input);
  if (footerLine) {
    rawLines.push(footerLine);
  }

  const lines: string[] = [];
  let inputLineIndex = 0;
  let thinkingLineIndex: number | undefined;

  rawLines.forEach((line, rawIndex) => {
    const oneBasedIndex = rawIndex + 1;
    const wrapped =
      oneBasedIndex === rawInputLineIndex || oneBasedIndex === rawThinkingLineIndex
        ? [line]
        : wrapAnsiLine(line, wrapWidth);
    lines.push(...wrapped);
    if (oneBasedIndex === rawThinkingLineIndex) {
      thinkingLineIndex = lines.length;
    }
    if (oneBasedIndex === rawInputLineIndex) {
      inputLineIndex = lines.length;
    }
  });

  return {
    lines,
    inputLineIndex,
    inputColumn,
    thinkingLineIndex
  };
}

function sliceByChars(text: string, count: number): string {
  return Array.from(text).slice(0, Math.max(0, count)).join("");
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

function renderHeaderCard(input: RenderFrameInput, terminalWidth: number): string[] {
  const lines = [
    `${paint(">_", { fg: TUI_THEME.accent, bold: true }, input.colorEnabled)} ${paint("AutoLabOS", { fg: TUI_THEME.text, bold: true }, input.colorEnabled)} ${paint(`(v${input.appVersion})`, { fg: TUI_THEME.muted }, input.colorEnabled)}`,
    renderHeaderMetaLine("model", input.modelLabel || "not configured", input.colorEnabled, "/model to change"),
    renderHeaderMetaLine("directory", input.workspaceLabel || ".", input.colorEnabled)
  ];

  return renderFloatingPanel(undefined, lines, input.colorEnabled, Math.min(terminalWidth, 72));
}

function renderHeaderMetaLine(
  label: string,
  value: string,
  colorEnabled: boolean,
  hint?: string
): string {
  const labelText = paint(`${label}:`, { fg: TUI_THEME.muted }, colorEnabled);
  const valueText = paint(value, { fg: TUI_THEME.text, bold: label === "model" }, colorEnabled);
  if (!hint) {
    return `${labelText} ${valueText}`;
  }
  return `${labelText} ${valueText}  ${paint(hint, { fg: TUI_THEME.accent }, colorEnabled)}`;
}

function buildTipLine(input: RenderFrameInput): string | undefined {
  let tip: string | undefined;
  if (input.selectionMenu) {
    tip = "Tip: Use arrow keys to move, Enter to select, and Esc to cancel.";
  } else if (input.thinking) {
    tip = "Tip: While thinking, new input is treated as steering.";
  } else if (input.suggestions.length > 0) {
    tip = "Tip: Tab inserts the highlighted command suggestion.";
  } else if (input.busy) {
    tip = "Tip: Activity updates stream inline while the active node is running.";
  } else if (!input.run) {
    tip = "Tip: Start with /new, /help, or a natural-language request.";
  } else {
    tip = "Tip: Use slash commands or plain language in the same prompt.";
  }

  return tip ? paint(tip, { fg: TUI_THEME.muted }, input.colorEnabled) : undefined;
}

function renderFooterLine(input: RenderFrameInput): string | undefined {
  const items = input.footerItems?.filter((item) => item.trim().length > 0) || [];
  if (items.length === 0) {
    return undefined;
  }
  return paint(items.join(" · "), { fg: TUI_THEME.muted, dim: true }, input.colorEnabled);
}

function renderComposerLine(input: RenderFrameInput): string {
  const prompt = paint(">", { fg: TUI_THEME.text, bold: true }, input.colorEnabled);
  const hasInput = input.input.length > 0;
  const content = hasInput
    ? paint(input.input, { fg: TUI_THEME.text }, input.colorEnabled)
    : paint("Ask AutoLabOS to collect, analyze, or run...", { fg: TUI_THEME.muted, dim: true }, input.colorEnabled);
  const hint = resolveComposerHint(input);
  return `${prompt} ${content}${hint ? `  ${paint(hint, { fg: TUI_THEME.subtle, dim: true }, input.colorEnabled)}` : ""}`;
}

function resolveComposerHint(input: RenderFrameInput): string | undefined {
  if (input.selectionMenu) {
    return "Esc to cancel";
  }
  if (input.suggestions.length > 0) {
    return "Tab to insert";
  }
  if (input.input.trim().length > 0) {
    return "Enter to submit";
  }
  return "/help";
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
  const border = paint(`+${"-".repeat(contentWidth + 2)}+`, { fg: TUI_THEME.panel }, colorEnabled);
  const rendered = [border];

  visibleRows.forEach((row, index) => {
    const body =
      index === 0 && title
        ? paint(stripAnsi(title) === title ? title : row, { fg: TUI_THEME.text, bold: true }, colorEnabled)
        : row;
    rendered.push(
      `${paint("|", { fg: TUI_THEME.panel }, colorEnabled)} ${padAnsiRight(body, contentWidth)} ${paint("|", { fg: TUI_THEME.panel }, colorEnabled)}`
    );
  });

  rendered.push(border);
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
}

function renderSuggestionRow(args: SuggestionRowArgs): string {
  const marker = args.selected
    ? paint(">", { fg: TUI_THEME.accent, bold: true }, args.colorEnabled)
    : paint(" ", { fg: TUI_THEME.subtle }, args.colorEnabled);
  const commandStyle = args.selected
    ? { fg: TUI_THEME.text, bg: TUI_THEME.selected, bold: true }
    : { fg: TUI_THEME.text };
  const descriptionStyle = args.selected
    ? { fg: TUI_THEME.text, bg: TUI_THEME.selected }
    : { fg: TUI_THEME.muted };
  return `${marker} ${paint(args.suggestion.label, commandStyle, args.colorEnabled)}  ${paint(args.suggestion.description, descriptionStyle, args.colorEnabled)}`;
}

interface GuidanceRowArgs {
  item: GuidanceItem;
  colorEnabled: boolean;
}

function renderGuidanceRow(args: GuidanceRowArgs): string {
  return `${paint("-", { fg: TUI_THEME.accent }, args.colorEnabled)} ${paint(args.item.label, { fg: TUI_THEME.text }, args.colorEnabled)}  ${paint(args.item.description, { fg: TUI_THEME.muted }, args.colorEnabled)}`;
}

interface SelectionRowArgs {
  option: SelectionMenuOption;
  selected: boolean;
  colorEnabled: boolean;
}

function renderSelectionRow(args: SelectionRowArgs): string {
  const marker = args.selected
    ? paint(">", { fg: TUI_THEME.accent, bold: true }, args.colorEnabled)
    : paint(" ", { fg: TUI_THEME.subtle }, args.colorEnabled);
  const labelStyle = args.selected
    ? { fg: TUI_THEME.text, bg: TUI_THEME.selected, bold: true }
    : { fg: TUI_THEME.text };
  const descriptionStyle = args.selected
    ? { fg: TUI_THEME.text, bg: TUI_THEME.selected }
    : { fg: TUI_THEME.muted };
  const text = paint(args.option.label, labelStyle, args.colorEnabled);
  if (!args.option.description) {
    return `${marker} ${text}`;
  }
  return `${marker} ${text}  ${paint(args.option.description, descriptionStyle, args.colorEnabled)}`;
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
    log === "Core:" ||
    log === "Workflow:" ||
    log === "Collection:" ||
    log === "Natural language:"
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
    lower.startsWith("현재 수집된 논문은") ||
    lower.startsWith("pdf 경로가 없는 논문은") ||
    lower.startsWith("citation이 가장 높은 논문은") ||
    lower.startsWith("논문 제목 ") ||
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
  if (lower.startsWith("next step:") || lower.startsWith("execution intent detected")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (log.startsWith("다음 단계:") || log.startsWith("실행 의도 감지")) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (
    lower.startsWith("natural query:") ||
    lower.startsWith("available commands:") ||
    lower.startsWith("current node:") ||
    lower.startsWith("budget:")
  ) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text, bold: true }
    };
  }
  if (log.startsWith("자연어 질의:") || log.startsWith("현재 노드:") || log.startsWith("예산:")) {
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
    log.startsWith("런:") ||
    log.startsWith("상태:") ||
    log.startsWith("워크플로:") ||
    log.startsWith("노드 ") ||
    log.startsWith("생성된 run") ||
    log.startsWith("선택된 run") ||
    log.startsWith("그래프 ") ||
    log.startsWith("재개됨") ||
    log.startsWith("재시도 ") ||
    log.startsWith("승인됨")
  ) {
    return {
      marker: "•",
      prefixStyle: { fg: TUI_THEME.accent, bold: true },
      textStyle: { fg: TUI_THEME.text }
    };
  }
  if (
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
