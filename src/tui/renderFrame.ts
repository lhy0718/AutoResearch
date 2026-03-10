import { RunInsightCard, RunRecord, SuggestionItem } from "../types.js";
import { ContextualGuidance, GuidanceItem } from "./contextualGuidance.js";
import { PaintStyle, paint, reset, stripAnsi } from "./theme.js";
import { getDisplayWidth } from "./displayWidth.js";

export interface RenderFrameInput {
  appVersion: string;
  busy: boolean;
  activityLabel?: string;
  thinking: boolean;
  thinkingFrame: number;
  terminalWidth?: number;
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

  rawLines.push(paint(`AutoLabOS v${input.appVersion}`, { fg: 96, bold: true }, input.colorEnabled));

  if (input.run) {
    rawLines.push(renderLabelValue("Run", input.run.id, input.colorEnabled, true));
    rawLines.push(renderLabelValue("Title", input.run.title, input.colorEnabled, true));
    rawLines.push(
      renderLabelValue(
        "Node",
        `${input.run.currentNode} (${input.run.graph.nodeStates[input.run.currentNode].status})`,
        input.colorEnabled,
        true
      )
    );
  } else {
    rawLines.push(renderLabelValue("Run", "none", input.colorEnabled, true));
  }

  if (input.runInsight?.lines.length) {
    rawLines.push("");
    rawLines.push(paint(input.runInsight.title, { fg: 97, bold: true }, input.colorEnabled));
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

  rawLines.push("");
  rawLines.push(paint("Recent logs", { fg: 97, bold: true }, input.colorEnabled));

  const recentLogs = input.logs.slice(-12);
  if (recentLogs.length === 0) {
    rawLines.push(paint("no logs yet", { fg: 90 }, input.colorEnabled));
  } else {
    for (const log of recentLogs) {
      rawLines.push(renderLogLine(log, input.colorEnabled));
    }
  }

  if (input.thinking || input.activityLabel) {
    rawLines.push("");
    rawLines.push(buildAnimatedStatusText(input.thinking ? "Thinking..." : input.activityLabel!, input.thinkingFrame, input.colorEnabled));
    rawThinkingLineIndex = rawLines.length;
  }

  rawLines.push("");
  const prompt = `${paint(">", { fg: 96, bold: true }, input.colorEnabled)} ${paint(input.input, { fg: 97 }, input.colorEnabled)}`;
  rawLines.push(prompt);
  const rawInputLineIndex = rawLines.length;
  const inputColumn = 3 + getDisplayWidth(sliceByChars(input.input, input.inputCursor));

  if (input.suggestions.length > 0) {
    rawLines.push("");
    input.suggestions.forEach((suggestion, idx) => {
      rawLines.push(renderSuggestionRow({
        suggestion,
        selected: idx === input.selectedSuggestion,
        colorEnabled: input.colorEnabled
      }));
    });
  }

  if (input.guidance && input.guidance.items.length > 0) {
    rawLines.push("");
    rawLines.push(paint(input.guidance.title, { fg: 97, bold: true }, input.colorEnabled));
    input.guidance.items.forEach((item) => {
      rawLines.push(renderGuidanceRow({
        item,
        colorEnabled: input.colorEnabled
      }));
    });
  }

  if (input.selectionMenu) {
    rawLines.push("");
    rawLines.push(
      paint(
        `${input.selectionMenu.title}  (↑/↓ move, Enter select, Esc cancel)`,
        { fg: 97, bold: true },
        input.colorEnabled
      )
    );
    input.selectionMenu.options.forEach((option, idx) => {
      rawLines.push(
        renderSelectionRow({
          option,
          selected: idx === input.selectionMenu?.selectedIndex,
          colorEnabled: input.colorEnabled
        })
      );
    });
  }

  const wrapWidth = Math.max(20, (input.terminalWidth ?? 120) - 1);
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

interface SuggestionRowArgs {
  suggestion: SuggestionItem;
  selected: boolean;
  colorEnabled: boolean;
}

function renderSuggestionRow(args: SuggestionRowArgs): string {
  const rowText = `${args.suggestion.label}  ${args.suggestion.description}`;
  if (args.selected) {
    return paint(rowText, { fg: 97, bg: 44, bold: true }, args.colorEnabled);
  }

  const command = paint(args.suggestion.label, { fg: 97 }, args.colorEnabled);
  const description = paint(args.suggestion.description, { fg: 90 }, args.colorEnabled);
  return `${command}  ${description}`;
}

interface GuidanceRowArgs {
  item: GuidanceItem;
  colorEnabled: boolean;
}

function renderGuidanceRow(args: GuidanceRowArgs): string {
  const label = paint(args.item.label, { fg: 97 }, args.colorEnabled);
  const description = paint(args.item.description, { fg: 90 }, args.colorEnabled);
  return `  ${label}  ${description}`;
}

interface SelectionRowArgs {
  option: SelectionMenuOption;
  selected: boolean;
  colorEnabled: boolean;
}

function renderSelectionRow(args: SelectionRowArgs): string {
  const text = args.option.description
    ? `  ${args.option.label}  ${args.option.description}`
    : `  ${args.option.label}`;
  if (args.selected) {
    return paint(text, { fg: 97, bg: 44, bold: true }, args.colorEnabled);
  }
  if (!args.option.description) {
    return paint(text, { fg: 97 }, args.colorEnabled);
  }
  return `  ${paint(args.option.label, { fg: 97 }, args.colorEnabled)}  ${paint(args.option.description, { fg: 90 }, args.colorEnabled)}`;
}

function renderLabelValue(label: string, value: string, colorEnabled: boolean, emphasizeValue = false): string {
  return `${paint(`${label}:`, { fg: 97, bold: true }, colorEnabled)} ${paint(value, emphasizeValue ? { fg: 97 } : { fg: 90 }, colorEnabled)}`;
}

function renderInsightLine(line: string, colorEnabled: boolean): string {
  return `${paint("•", { fg: 96, bold: true }, colorEnabled)} ${paint(line, { fg: 97 }, colorEnabled)}`;
}

function renderInsightAction(label: string, command: string, colorEnabled: boolean): string {
  return `${paint("›", { fg: 90, bold: true }, colorEnabled)} ${paint(`${label}:`, { fg: 90, bold: true }, colorEnabled)} ${paint(command, { fg: 96 }, colorEnabled)}`;
}

function renderInsightReference(
  kind: "figure" | "comparison" | "statistics" | "transition" | "report" | "metrics",
  label: string,
  referencePath: string,
  colorEnabled: boolean
): string {
  const kindLabel = kind.toUpperCase();
  return `${paint(">", { fg: 90, bold: true }, colorEnabled)} ${paint(`[${kindLabel}]`, { fg: 96, bold: true }, colorEnabled)} ${paint(`${label}:`, { fg: 90 }, colorEnabled)} ${paint(referencePath, { fg: 92 }, colorEnabled)}`;
}

function renderInsightReferenceSummary(summary: string, colorEnabled: boolean): string {
  return `  ${paint(truncateForInsight(summary), { fg: 90, dim: true }, colorEnabled)}`;
}

function renderInsightReferenceFacts(
  facts: Array<{ label: string; value: string }>,
  colorEnabled: boolean
): string {
  const joined = facts.map((fact) => `${fact.label} ${fact.value}`).join(" | ");
  return `  ${paint(truncateForInsight(joined), { fg: 96 }, colorEnabled)}`;
}

function renderInsightReferenceDetail(detail: string, colorEnabled: boolean): string {
  return `  ${paint(truncateForInsight(detail), { fg: 90 }, colorEnabled)}`;
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
  const prefix = paint(`[${classified.level}]`, classified.prefixStyle, colorEnabled);
  const text = paint(log, classified.textStyle, colorEnabled);
  return `${prefix} ${text}`;
}

interface ClassifiedLogLine {
  level: "INFO" | "WARN" | "OK" | "ERR";
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
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 96, bold: true }
    };
  }
  if (log.startsWith("/")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97 }
    };
  }
  if (log.startsWith("Examples:") || log.startsWith("Ask 'what natural inputs are supported?'")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
    };
  }
  if (log.startsWith("Collect options:")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 90 }
    };
  }
  if (log.startsWith("Execution requests require") || log.startsWith("While thinking,")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 90, dim: true }
    };
  }
  if (lower.startsWith("collect dry-run plan:") || lower.startsWith("graph nodes:")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 96, bold: true }
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
      level: "WARN",
      prefixStyle: { fg: 93, bold: true },
      textStyle: { fg: 93, bold: true }
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
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 96 }
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
      level: "OK",
      prefixStyle: { fg: 92, bold: true },
      textStyle: { fg: 92, bold: true }
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
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97 }
    };
  }
  if (/^\d+\.\s/u.test(log)) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97 }
    };
  }
  if (lower.startsWith("execution plan detected.") || /^-\s*\[\d+\/\d+\]/u.test(log) || /^step \d+\/\d+:/iu.test(log)) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
    };
  }
  if (lower.startsWith("next plan step ready") || lower.startsWith("remaining plan steps")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
    };
  }
  if (
    lower.startsWith("attempting automatic replan after failed step") ||
    lower.startsWith("the previous collect step failed. i can retry") ||
    lower.startsWith("replan matched the failed plan")
  ) {
    return {
      level: lower.startsWith("replan matched") ? "WARN" : "INFO",
      prefixStyle: lower.startsWith("replan matched") ? { fg: 93, bold: true } : { fg: 96, bold: true },
      textStyle: lower.startsWith("replan matched") ? { fg: 93, bold: true } : { fg: 97 }
    };
  }
  if (lower.startsWith("no revised execution plan was suggested.")) {
    return {
      level: "WARN",
      prefixStyle: { fg: 93, bold: true },
      textStyle: { fg: 93, bold: true }
    };
  }

  if (lower.startsWith("error:") || lower.includes("[fail]") || lower.includes("failed")) {
    return {
      level: "ERR",
      prefixStyle: { fg: 91, bold: true },
      textStyle: { fg: 91, bold: true }
    };
  }
  if (lower.startsWith("next step:") || lower.startsWith("execution intent detected")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
    };
  }
  if (log.startsWith("다음 단계:") || log.startsWith("실행 의도 감지")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
    };
  }
  if (
    lower.startsWith("natural query:") ||
    lower.startsWith("available commands:") ||
    lower.startsWith("current node:") ||
    lower.startsWith("budget:")
  ) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
    };
  }
  if (log.startsWith("자연어 질의:") || log.startsWith("현재 노드:") || log.startsWith("예산:")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97, bold: true }
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
      level: "OK",
      prefixStyle: { fg: 92, bold: true },
      textStyle: { fg: 97 }
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
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 97 }
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
      level: "WARN",
      prefixStyle: { fg: 93, bold: true },
      textStyle: { fg: 96, bold: true }
    };
  }
  if (lower.startsWith("use the suggested")) {
    return {
      level: "INFO",
      prefixStyle: { fg: 96, bold: true },
      textStyle: { fg: 90, dim: true }
    };
  }
  return {
    level: "INFO",
    prefixStyle: { fg: 96, bold: true },
    textStyle: { fg: 90 }
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
