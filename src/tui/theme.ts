import process from "node:process";

export type RgbColor = readonly [number, number, number];
export type PaintColor = number | RgbColor;

export interface PaintStyle {
  fg?: PaintColor;
  bg?: PaintColor;
  bold?: boolean;
  dim?: boolean;
}

export interface TuiThemePalette {
  accent: PaintColor;
  text: PaintColor;
  muted: PaintColor;
  subtle: PaintColor;
  panel: PaintColor;
  panelBg?: PaintColor;
  composerBg?: PaintColor;
  selected: PaintColor;
  success: PaintColor;
  warning: PaintColor;
  danger: PaintColor;
}

export const reset = "\x1b[0m";
const DEFAULT_SURFACE_INDEX = 237;

export const TUI_THEME: TuiThemePalette = {
  accent: 110,
  text: 255,
  muted: 245,
  subtle: 239,
  panel: 240,
  panelBg: undefined,
  composerBg: undefined,
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

export function fg(text: string, code: PaintColor, enabled = supportsColor()): string {
  return paint(text, { fg: code }, enabled);
}

export function bg(text: string, code: PaintColor, enabled = supportsColor()): string {
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
  if (style.fg !== undefined) {
    appendColorCode(codes, style.fg, false);
  }
  if (style.bg !== undefined) {
    appendColorCode(codes, style.bg, true);
  }

  if (codes.length === 0) {
    return text;
  }
  return `\x1b[${codes.join(";")}m${text}${reset}`;
}

function appendColorCode(codes: string[], code: PaintColor, background: boolean): void {
  if (isRgbColor(code)) {
    codes.push(background ? "48" : "38", "2", String(code[0]), String(code[1]), String(code[2]));
    return;
  }

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

function isRgbColor(code: PaintColor): code is RgbColor {
  return Array.isArray(code);
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

export function parseTerminalBackgroundResponse(text: string): RgbColor | undefined {
  const rgbMatch = text.match(/\x1b\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})(?:\x07|\x1b\\)/u);
  if (rgbMatch) {
    return [
      parseTerminalChannel(rgbMatch[1]),
      parseTerminalChannel(rgbMatch[2]),
      parseTerminalChannel(rgbMatch[3])
    ];
  }

  const hexMatch = text.match(/\x1b\]11;#([0-9a-fA-F]{6})(?:\x07|\x1b\\)/u);
  if (hexMatch) {
    return [
      Number.parseInt(hexMatch[1].slice(0, 2), 16),
      Number.parseInt(hexMatch[1].slice(2, 4), 16),
      Number.parseInt(hexMatch[1].slice(4, 6), 16)
    ];
  }

  return undefined;
}

export function applyCodexSurfaceTheme(background: RgbColor | undefined): void {
  const nextSurface = background ? resolveCodexSurfaceColor(background) : undefined;
  TUI_THEME.panelBg = nextSurface;
  TUI_THEME.composerBg = nextSurface;
}

export function resolveCodexSurfaceColor(background: RgbColor, preferTrueColor = supportsTrueColor()): PaintColor {
  const [top, alpha] = isLight(background) ? ([[0, 0, 0] as const, 0.04] as const) : ([[255, 255, 255] as const, 0.12] as const);
  const blended = blend(top, background, alpha);
  if (preferTrueColor) {
    return blended;
  }
  return nearestXtermColor(blended);
}

function parseTerminalChannel(hex: string): number {
  if (hex.length <= 2) {
    return Number.parseInt(hex, 16);
  }
  return Math.round(Number.parseInt(hex, 16) / 257);
}

function supportsTrueColor(): boolean {
  if (typeof process.stdout.getColorDepth !== "function") {
    return false;
  }
  return process.stdout.getColorDepth() >= 24;
}

function isLight(background: RgbColor): boolean {
  const [r, g, b] = background;
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

function blend(foreground: RgbColor, background: RgbColor, alpha: number): RgbColor {
  return [
    Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
    Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
    Math.round(foreground[2] * alpha + background[2] * (1 - alpha))
  ];
}

function nearestXtermColor(target: RgbColor): number {
  let bestIndex = DEFAULT_SURFACE_INDEX;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [index, color] of buildXtermPalette()) {
    const distance = squaredDistance(color, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function squaredDistance(left: RgbColor, right: RgbColor): number {
  const dr = left[0] - right[0];
  const dg = left[1] - right[1];
  const db = left[2] - right[2];
  return dr * dr + dg * dg + db * db;
}

function buildXtermPalette(): Array<[number, RgbColor]> {
  const colors: Array<[number, RgbColor]> = [];
  const cubeLevels = [0, 95, 135, 175, 215, 255] as const;

  let index = 16;
  for (const red of cubeLevels) {
    for (const green of cubeLevels) {
      for (const blue of cubeLevels) {
        colors.push([index, [red, green, blue]]);
        index += 1;
      }
    }
  }

  for (let step = 0; step < 24; step += 1) {
    const value = 8 + step * 10;
    colors.push([232 + step, [value, value, value]]);
  }

  return colors;
}
