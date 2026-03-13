import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunContextMemory } from "../src/core/memory/runContextMemory.js";

const ORIGINAL_CWD = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("RunContextMemory", () => {
  it("pins relative file paths to the construction cwd", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-run-context-"));
    const otherDir = mkdtempSync(path.join(os.tmpdir(), "autolabos-run-context-other-"));
    tempDirs.push(workspace, otherDir);

    const runContextPath = path.join(".autolabos", "runs", "run-1", "memory", "run_context.json");
    process.chdir(workspace);
    mkdirSync(path.join(workspace, ".autolabos", "runs", "run-1", "memory"), { recursive: true });
    writeFileSync(
      path.join(workspace, runContextPath),
      JSON.stringify({ version: 1, items: [] }),
      "utf8"
    );

    const memory = new RunContextMemory(runContextPath);
    process.chdir(otherDir);

    await memory.put("stage", "axes");

    process.chdir(workspace);
    await expect(memory.get("stage")).resolves.toBe("axes");
    expect(existsSync(path.join(otherDir, ".autolabos"))).toBe(false);
  });
});
