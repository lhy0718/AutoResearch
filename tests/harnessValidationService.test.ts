import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyHarnessIssueCode,
  runHarnessValidation
} from "../src/core/validation/harnessValidationService.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("harnessValidationService", () => {
  it("scans workspace and test run stores with classified findings", async () => {
    const workspace = createTempWorkspace("autolabos-harness-service-");
    await writeFile(path.join(workspace, "ISSUES.md"), "## Issue: missing-fields\n- Status: open\n", "utf8");

    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), {
      runs: [{ id: "workspace-run", status: "completed", graph: { nodeStates: {} } }]
    });
    await mkdir(path.join(workspace, ".autolabos", "runs", "workspace-run"), { recursive: true });

    await writeJson(path.join(workspace, "test", "fixtures", ".autolabos", "runs", "runs.json"), {
      runs: [{ id: "test-run", status: "running", graph: { nodeStates: {} } }]
    });

    const report = await runHarnessValidation({
      workspaceRoot: workspace,
      includeWorkspaceRuns: true,
      includeTestRunStores: true
    });

    expect(report.runStoresChecked).toBe(2);
    expect(report.runsChecked).toBe(2);
    expect(report.findings.some((item) => item.scope === "workspace")).toBe(true);
    expect(report.findings.some((item) => item.scope === "test_records")).toBe(true);
    expect(report.findings.some((item) => item.code === "run_directory_missing")).toBe(true);
    expect(report.countsByKind.malformed_issue).toBeGreaterThan(0);
    expect(report.countsByKind.missing_artifact).toBeGreaterThan(0);
  });

  it("classifies source path linkage failures as broken evidence links", () => {
    expect(classifyHarnessIssueCode("paper_claim_source_path_missing")).toBe("broken_evidence_link");
    expect(classifyHarnessIssueCode("paper_claim_source_path_placeholder")).toBe("broken_evidence_link");
  });

  it("falls back to parent directory ISSUES.md when not present in workspace root (LV-028)", async () => {
    const parent = createTempWorkspace("autolabos-harness-parent-");
    const child = path.join(parent, "child");
    await mkdir(child, { recursive: true });

    // Place ISSUES.md only in the parent directory
    await writeFile(path.join(parent, "ISSUES.md"), "## Issue: parent-level\n- Status: open\n", "utf8");

    const report = await runHarnessValidation({
      workspaceRoot: child,
      includeWorkspaceRuns: false,
      includeTestRunStores: false
    });

    expect(report.findings.some((f) => f.code === "issues_file_missing")).toBe(false);
  });

  it("reports issues_file_missing when ISSUES.md absent from both workspace and parent (LV-028)", async () => {
    const parent = createTempWorkspace("autolabos-harness-noissuefile-");
    const child = path.join(parent, "child");
    await mkdir(child, { recursive: true });

    // No ISSUES.md anywhere

    const report = await runHarnessValidation({
      workspaceRoot: child,
      includeWorkspaceRuns: false,
      includeTestRunStores: false
    });

    expect(report.findings.some((f) => f.code === "issues_file_missing")).toBe(true);
  });

  it("ignores transient test/.tmp run stores when scanning reproducibility records", async () => {
    const workspace = createTempWorkspace("autolabos-harness-ignore-tmp-");
    await writeFile(path.join(workspace, "ISSUES.md"), "## Issue: ok\n- Status: open\n", "utf8");

    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), {
      runs: [{ id: "workspace-run", status: "completed", graph: { nodeStates: {} } }]
    });
    await mkdir(path.join(workspace, ".autolabos", "runs", "workspace-run"), { recursive: true });

    await writeJson(path.join(workspace, "test", ".tmp", "session-1", ".autolabos", "runs", "runs.json"), {
      runs: [{ id: "tmp-run", status: "running", graph: { nodeStates: {} } }]
    });

    const report = await runHarnessValidation({
      workspaceRoot: workspace,
      includeWorkspaceRuns: true,
      includeTestRunStores: true
    });

    expect(report.targets.find((target) => target.scope === "test_records")?.runStoreCount).toBe(0);
    expect(report.runsChecked).toBe(1);
  });
});

function createTempWorkspace(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
