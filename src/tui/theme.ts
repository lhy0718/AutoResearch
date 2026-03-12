import process from "node:process";

export interface PaintStyle {
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
}

export interface TuiThemePalette {
  accent: number;
  text: number;
  muted: number;
  subtle: number;
  panel: number;
  selected: number;
  success: number;
  warning: number;
  danger: number;
}

export const reset = "\x1b[0m";

export const TUI_THEME: TuiThemePalette = {
  accent: 110,
  text: 255,
  muted: 245,
  subtle: 239,
  panel: 240,
  selected: 237,
  success: 150,
  warning: 179,
  danger: 210
};

export function supportsColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

export function fg(text: string, code: number, enabled = supportsColor()): string {
  return paint(text, { fg: code }, enabled);
}

export function bg(text: string, code: number, enabled = supportsColor()): string {
  return paint(text, { bg: code }, enabled);
}

export function bold(text: string, enabled = supportsColor()): string {
  return paint(text, { bold: true }, enabled);
}

export function dim(text: string, enabled = supportsColor()): string {
  return paint(text, { dim: true }, enabled);
}

export function paint(text: string, style: PaintStyle, enabled = supportsColor()): string {
  if (!enabled) {
    return text;
  }

  const codes: string[] = [];
  if (style.bold) {
    codes.push("1");
  }
  if (style.dim) {
    codes.push("2");
  }
  if (typeof style.fg === "number") {
    appendColorCode(codes, style.fg, false);
  }
  if (typeof style.bg === "number") {
    appendColorCode(codes, style.bg, true);
  }

  if (codes.length === 0) {
    return text;
  }
  return `\x1b[${codes.join(";")}m${text}${reset}`;
}

function appendColorCode(codes: string[], code: number, background: boolean): void {
  if (isStandardAnsiCode(code, background)) {
    codes.push(String(code));
    return;
  }

  if (Number.isInteger(code) && code >= 0 && code <= 255) {
    codes.push(background ? "48" : "38", "5", String(code));
    return;
  }

  codes.push(String(code));
}

function isStandardAnsiCode(code: number, background: boolean): boolean {
  if (background) {
    return (code >= 40 && code <= 47) || (code >= 100 && code <= 107);
  }
  return (code >= 30 && code <= 37) || (code >= 90 && code <= 97);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
