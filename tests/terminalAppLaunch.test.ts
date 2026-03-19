import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { launchTerminalApp, TerminalApp } from "../src/tui/TerminalApp.js";

const ORIGINAL_CWD = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeDeps() {
  return {
    config: {
      papers: { max_results: 100 },
      providers: {
        llm_mode: "openai_api",
        openai: { model: "gpt-5.4", reasoning_effort: "medium" }
      }
    } as any,
    runStore: {} as any,
    titleGenerator: {} as any,
    codex: {} as any,
    openAiTextClient: {} as any,
    eventStream: { subscribe: () => () => {} } as any,
    orchestrator: {} as any,
    semanticScholarApiKeyConfigured: false,
    onQuit: () => {},
    saveConfig: async () => {}
  };
}

describe("launchTerminalApp session locking", () => {
  it("refuses to start when another live TUI session lock is active", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-tui-lock-"));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const runtimeDir = path.join(workspace, ".autolabos", "runtime");
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      path.join(runtimeDir, "tui-session-lock.json"),
      `${JSON.stringify({
        pid: 424242,
        cwd: workspace,
        startedAt: new Date().toISOString(),
        token: "foreign-lock"
      })}\n`,
      "utf8"
    );

    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 424242 && signal === 0) {
        return true as never;
      }
      return true as never;
    }) as typeof process.kill);
    const realReadlink = fs.readlink.bind(fs);
    const realReadFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readlink").mockImplementation(async (targetPath: fs.PathLike) => {
      if (String(targetPath) === "/proc/424242/cwd") {
        return workspace;
      }
      return realReadlink(targetPath);
    });
    vi.spyOn(fs, "readFile").mockImplementation(async (targetPath: fs.PathLike) => {
      if (String(targetPath) === "/proc/424242/cmdline") {
        return "node ../node_modules/.bin/tsx ../src/cli/main.ts" as never;
      }
      return realReadFile(targetPath, "utf8") as never;
    });
    const startSpy = vi.spyOn(TerminalApp.prototype, "start").mockResolvedValue(undefined);

    await expect(launchTerminalApp(makeDeps())).rejects.toThrow("Another AutoLabOS TUI session is already running");
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("clears a stale dead-session lock and proceeds", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-tui-stale-lock-"));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const runtimeDir = path.join(workspace, ".autolabos", "runtime");
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      path.join(runtimeDir, "tui-session-lock.json"),
      `${JSON.stringify({
        pid: 525252,
        cwd: workspace,
        startedAt: new Date().toISOString(),
        token: "stale-lock"
      })}\n`,
      "utf8"
    );

    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 525252 && signal === 0) {
        const error = new Error("ESRCH") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return true as never;
    }) as typeof process.kill);
    const startSpy = vi.spyOn(TerminalApp.prototype, "start").mockResolvedValue(undefined);

    await launchTerminalApp(makeDeps());

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(runtimeDir, "tui-session-lock.json"))).toBe(false);
  });

  it("clears a stale reused-pid lock when the live pid is not an AutoLabOS TUI process", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-tui-reused-pid-lock-"));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const runtimeDir = path.join(workspace, ".autolabos", "runtime");
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      path.join(runtimeDir, "tui-session-lock.json"),
      `${JSON.stringify({
        pid: 2,
        cwd: workspace,
        startedAt: new Date().toISOString(),
        token: "reused-pid-lock"
      })}\n`,
      "utf8"
    );

    vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 2 && signal === 0) {
        return true as never;
      }
      return true as never;
    }) as typeof process.kill);
    const realReadlink = fs.readlink.bind(fs);
    const realReadFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readlink").mockImplementation(async (targetPath: fs.PathLike) => {
      if (String(targetPath) === "/proc/2/cwd") {
        return workspace;
      }
      return realReadlink(targetPath);
    });
    vi.spyOn(fs, "readFile").mockImplementation(async (targetPath: fs.PathLike) => {
      if (String(targetPath) === "/proc/2/cmdline") {
        return "ps -p 2 -o pid=,comm=,args=" as never;
      }
      return realReadFile(targetPath, "utf8") as never;
    });
    const startSpy = vi.spyOn(TerminalApp.prototype, "start").mockResolvedValue(undefined);

    await launchTerminalApp(makeDeps());

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(runtimeDir, "tui-session-lock.json"))).toBe(false);
  });
});
