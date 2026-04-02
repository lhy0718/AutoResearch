/**
 * Regression test: ensure no test file creates `.autolabos/runs/` at the
 * project root.  The test suite sets process.cwd() to temp directories so
 * relative artifact paths resolve there — not here.
 *
 * This file must be listed LAST alphabetically (prefix "no") so vitest
 * runs it after all other tests (fileParallelism: false).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

describe("project-root leak guard", () => {
  it("no .autolabos directory should exist at the project root", () => {
    const rootAppDir = path.join(PROJECT_ROOT, ".autolabos");
    expect(existsSync(rootAppDir)).toBe(false);
  });
});
