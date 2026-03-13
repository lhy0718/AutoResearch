import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TUI_THEME,
  applyCodexSurfaceTheme,
  parseTerminalBackgroundResponse,
  resolveCodexSurfaceColor
} from "../src/tui/theme.js";

describe("theme", () => {
  afterEach(() => {
    applyCodexSurfaceTheme(undefined);
    vi.restoreAllMocks();
  });

  it("parses OSC 11 rgb background responses", () => {
    expect(parseTerminalBackgroundResponse("\x1b]11;rgb:1f1f/2020/2121\x07")).toEqual([31, 32, 33]);
  });

  it("clears the composer surface when applyCodexSurfaceTheme receives no background", () => {
    applyCodexSurfaceTheme(undefined);

    expect(TUI_THEME.composerBg).toBeUndefined();
    expect(TUI_THEME.panelBg).toBeUndefined();
  });

  it("matches Codex-style blending against the terminal background", () => {
    expect(resolveCodexSurfaceColor([30, 30, 30], true)).toEqual([57, 57, 57]);
    expect(resolveCodexSurfaceColor([250, 250, 250], true)).toEqual([240, 240, 240]);
  });
});
