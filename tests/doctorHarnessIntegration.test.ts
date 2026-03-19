import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { buildDoctorHighlightLines, runDoctorReport } from "../src/core/doctor.js";
import { CodexCliClient } from "../src/integrations/codex/codexCliClient.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("runDoctorReport", () => {
  it("includes harness diagnostics for current workspace runs", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-harness-");
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await runDoctorReport(createCodexStub(), {
      workspaceRoot: workspace,
      includeHarnessValidation: true,
      includeHarnessTestRecords: false,
      maxHarnessFindings: 10
    });

    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.harness).toBeDefined();
    expect(report.harness?.status).toBe("ok");
    expect(report.harness?.findings).toEqual([]);
    expect(report.harness?.targets.find((target) => target.scope === "workspace")?.runStoreCount).toBe(1);
  });

  it("includes the latest compiled paper page-budget check when available", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-page-budget-");
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), {
      runs: [{ id: "run-1", updatedAt: "2026-03-19T12:00:00.000Z" }]
    });
    await writeJson(path.join(workspace, ".autolabos", "runs", "run-1", "paper", "compiled_page_validation.json"), {
      status: "warn",
      compiled_pdf_page_count: 3,
      main_page_limit: 8,
      message: "Compiled PDF is only 3 pages, below the configured main_page_limit of 8."
    });

    const report = await runDoctorReport(createCodexStub(), {
      workspaceRoot: workspace,
      includeHarnessValidation: false
    });

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "paper-page-budget",
        ok: false,
        detail: expect.stringContaining("pages=3, main_page_limit=8")
      })
    );
    expect(buildDoctorHighlightLines(report)).toEqual([
      expect.stringContaining("[ATTN] paper page budget:")
    ]);
  });
});

function createCodexStub(): CodexCliClient {
  return {
    checkCliAvailable: async () => ({ ok: true, detail: "stub cli" }),
    checkLoginStatus: async () => ({ ok: true, detail: "stub login" }),
    checkEnvironmentReadiness: async () => []
  } as unknown as CodexCliClient;
}

function createTempWorkspace(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const VALID_ISSUE_MARKDOWN = `
## Issue: LV-DOCTOR
- Status: open
- Validation target: /doctor harness summary
- Environment/session context: test workspace
- Reproduction steps:
  1. Run /doctor in TUI or web.
  2. Confirm harness summary appears.
- Expected behavior: Doctor includes harness diagnostics.
- Actual behavior: Under verification.
- Fresh vs existing session comparison:
  - Fresh session: pending
  - Existing session: pending
  - Divergence: none yet
- Root cause hypothesis: n/a
- Code/test changes: this is a test fixture entry
- Regression status: pending
- Follow-up risks: low
`.trim();
