import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { shouldPreserveValidationRootEntry } from "./globalTeardown.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("p6 continue helper", () => {
  it("treats active target-node progress as a resumeable TUI command path", async () => {
    const script = path.join(repoRoot, "scripts", "p6-approve-and-run-next.py");
    const result = await execFileAsync("python3", [script], {
      env: {
        ...process.env,
        AUTOLABOS_P6_CONTINUE_SELFTEST: "1",
      },
    });

    expect(result.stdout).toContain("PASS: p6 continue command selection self-test");
  });

  it("preserves the real P6 live validation workspace during test cleanup", () => {
    expect(shouldPreserveValidationRootEntry("p6-paper-ready-live")).toBe(true);
  });
});
