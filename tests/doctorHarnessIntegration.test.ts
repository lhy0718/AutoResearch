import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as nodeFs } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as doctorModule from "../src/core/doctor.js";
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
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: true,
        includeHarnessTestRecords: false,
        maxHarnessFindings: 10
      })
    );

    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.harness).toBeDefined();
    expect(report.harness?.status).toBe("ok");
    expect(report.harness?.findings).toEqual([]);
    expect(report.harness?.targets.find((target) => target.scope === "workspace")?.runStoreCount).toBe(1);
    expect(report.readiness.blocked).toBe(false);
    expect(report.readiness.executionApprovalMode).toBe("manual");
    expect(report.readiness.failedChecks).toEqual([]);
  });

  it("includes the latest compiled paper page-budget check when available", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-page-budget-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), {
      runs: [{ id: "run-1", updatedAt: "2026-03-19T12:00:00.000Z" }]
    });
    await writeJson(path.join(workspace, ".autolabos", "runs", "run-1", "paper", "compiled_page_validation.json"), {
      status: "warn",
      compiled_pdf_page_count: 3,
      minimum_main_pages: 8,
      target_main_pages: 8,
      main_page_limit: 8,
      message: "Compiled PDF is only 3 pages, below the configured minimum_main_pages of 8."
    });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false
      })
    );

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "paper-page-budget",
        ok: false,
        detail: expect.stringContaining("pages=3, minimum_main_pages=8")
      })
    );
    expect(doctorModule.buildDoctorHighlightLines(report)).toEqual([
      expect.stringContaining("profile: llm="),
      expect.stringContaining("[ATTN] paper page budget:")
    ]);
  });

  it("captures readiness snapshot fields for approval mode and workspace write probing", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-readiness-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false,
        approvalMode: "manual",
        executionApprovalMode: "risk_ack",
        dependencyMode: "docker",
        sessionMode: "existing",
        codeExecutionExpected: true,
        candidateIsolation: "attempt_worktree"
      })
    );

    expect(report.readiness.approvalMode).toBe("manual");
    expect(report.readiness.executionApprovalMode).toBe("risk_ack");
    expect(report.readiness.dependencyMode).toBe("docker");
    expect(report.readiness.sessionMode).toBe("existing");
    expect(report.readiness.candidateIsolation).toBe("attempt_worktree");
    expect(report.readiness.workspaceProbePath).toContain(workspace);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "workspace-write",
        ok: true
      })
    );
  });

  it("treats local snapshot isolation plus disabled network as ready for code execution", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-local-isolation-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false,
        approvalMode: "manual",
        executionApprovalMode: "manual",
        dependencyMode: "local",
        sessionMode: "existing",
        codeExecutionExpected: true,
        candidateIsolation: "attempt_snapshot_restore",
        allowNetwork: false
      })
    );

    expect(report.readiness.blocked).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "experiment-containerization",
        ok: true,
        detail: expect.stringContaining("attempt_snapshot_restore")
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "experiment-web-restriction",
        ok: true,
        status: "ok",
        detail: expect.stringContaining("network access remains disabled")
      })
    );
  });

  it("downgrades declared networked execution to a warning instead of a hard failure", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-network-declared-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false,
        approvalMode: "manual",
        executionApprovalMode: "risk_ack",
        dependencyMode: "local",
        sessionMode: "fresh",
        codeExecutionExpected: true,
        candidateIsolation: "attempt_snapshot_restore",
        allowNetwork: true,
        networkPolicy: "declared",
        networkPurpose: "logging"
      })
    );

    expect(report.readiness.blocked).toBe(false);
    expect(report.readiness.networkPolicy).toBe("declared");
    expect(report.readiness.networkPurpose).toBe("logging");
    expect(report.readiness.networkDeclarationPresent).toBe(true);
    expect(report.readiness.warningChecks).toContain("experiment-web-restriction");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "experiment-web-restriction",
        ok: true,
        status: "warning",
        detail: expect.stringContaining("network dependency for logging")
      })
    );
    expect(doctorModule.buildDoctorHighlightLines(report)).toContain(
      "[WARN] declared network dependency: logging. Results should remain auditable as a network-assisted run."
    );
  });

  it("surfaces required networked execution as a stronger warning with explicit highlight guidance", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-network-required-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false,
        approvalMode: "manual",
        executionApprovalMode: "risk_ack",
        dependencyMode: "remote_gpu",
        sessionMode: "fresh",
        codeExecutionExpected: true,
        candidateIsolation: "attempt_snapshot_restore",
        allowNetwork: true,
        networkPolicy: "required",
        networkPurpose: "remote_inference"
      })
    );

    expect(report.readiness.blocked).toBe(false);
    expect(report.readiness.networkPolicy).toBe("required");
    expect(report.readiness.networkPurpose).toBe("remote_inference");
    expect(report.readiness.warningChecks).toContain("experiment-web-restriction");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "experiment-web-restriction",
        ok: true,
        status: "warning",
        detail: expect.stringContaining("network-critical dependency for remote_inference")
      })
    );
    expect(doctorModule.buildDoctorHighlightLines(report)).toContain(
      "[ATTN] required network dependency: remote_inference. Treat this run as network-assisted and keep explicit operator review in the loop."
    );
  });

  it("fails doctor readiness when network access is enabled without a declared policy", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-network-undeclared-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await writeJson(path.join(workspace, ".autolabos", "runs", "runs.json"), { runs: [] });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false,
        approvalMode: "manual",
        executionApprovalMode: "manual",
        dependencyMode: "local",
        sessionMode: "fresh",
        codeExecutionExpected: true,
        candidateIsolation: "attempt_snapshot_restore",
        allowNetwork: true
      })
    );

    expect(report.readiness.blocked).toBe(true);
    expect(report.readiness.networkDeclarationPresent).toBe(false);
    expect(report.readiness.failedChecks).toContain("experiment-web-restriction");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "experiment-web-restriction",
        ok: false,
        status: "fail",
        detail: expect.stringContaining("missing a declared network_policy/network_purpose")
      })
    );
  });

  it("fails when the workspace config is missing and exposes api-style doctor fields", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-config-missing-");
    await seedDoctorTooling(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    await mkdir(path.join(workspace, ".autolabos", "runs"), { recursive: true });

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false
      })
    );

    expect(report.readiness.blocked).toBe(true);
    expect(report.readiness.failedChecks).toContain("workspace-config");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "workspace-config",
        ok: false,
        detail: "workspace not initialized – run setup first"
      })
    );
    const apiChecks = report.checks.map((check) => doctorModule.mapDoctorCheckForApi(check));
    expect(apiChecks).toContainEqual(
      expect.objectContaining({
        check: "workspace-config",
        status: "fail",
        message: "workspace not initialized – run setup first"
      })
    );
    expect(doctorModule.getDoctorAggregateStatus({ checks: report.checks, harness: report.harness })).toBe("fail");
  });

  it("fails when the runs directory is not writable", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-runs-dir-write-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    const runsDir = path.join(workspace, ".autolabos", "runs");
    await chmod(runsDir, 0o555);

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false
      })
    );

    expect(report.readiness.blocked).toBe(true);
    expect(report.readiness.failedChecks).toContain("runs-dir-write");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "runs-dir-write",
        ok: false
      })
    );
  });

  it("warns when disk space falls below the preflight threshold", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-disk-space-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    vi.spyOn(nodeFs, "statfs").mockResolvedValue({
      bavail: BigInt(128),
      bsize: BigInt(1024 * 1024)
    } as any);

    const report = await withWorkspacePath(workspace, () =>
      doctorModule.runDoctorReport(createCodexStub(), {
        workspaceRoot: workspace,
        includeHarnessValidation: false
      })
    );

    expect(report.readiness.blocked).toBe(false);
    expect(report.readiness.warningChecks).toContain("disk-free-space");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "disk-free-space",
        ok: true,
        status: "warning",
        detail: expect.stringContaining("Low disk space")
      })
    );
  });

  it("warns when the current Node.js version is below the supported floor", async () => {
    const workspace = createTempWorkspace("autolabos-doctor-node-version-");
    await seedDoctorTooling(workspace);
    await seedDoctorWorkspace(workspace);
    await writeFile(path.join(workspace, "ISSUES.md"), VALID_ISSUE_MARKDOWN, "utf8");
    const originalVersions = process.versions;
    Object.defineProperty(process, "versions", {
      value: { ...originalVersions, node: "16.20.2" },
      configurable: true
    });

    try {
      const report = await withWorkspacePath(workspace, () =>
        doctorModule.runDoctorReport(createCodexStub(), {
          workspaceRoot: workspace,
          includeHarnessValidation: false
        })
      );

      expect(report.readiness.blocked).toBe(false);
      expect(report.readiness.warningChecks).toContain("node-version");
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          name: "node-version",
          ok: true,
          status: "warning",
          detail: expect.stringContaining("Upgrade to Node.js 18 or newer")
        })
      );
    } finally {
      Object.defineProperty(process, "versions", {
        value: originalVersions,
        configurable: true
      });
    }
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

async function seedDoctorTooling(workspace: string): Promise<void> {
  const binDir = path.join(workspace, "bin");
  await mkdir(binDir, { recursive: true });
  await writeExecutable(path.join(binDir, "python3"), "#!/bin/sh\nexit 0\n");
  await writeExecutable(path.join(binDir, "pip3"), "#!/bin/sh\nexit 0\n");
  await writeExecutable(path.join(binDir, "pdflatex"), "#!/bin/sh\nexit 0\n");
}

async function seedDoctorWorkspace(workspace: string): Promise<void> {
  await mkdir(path.join(workspace, ".autolabos", "runs"), { recursive: true });
  await writeFile(path.join(workspace, ".autolabos", "config.yaml"), "version: 1\n", "utf8");
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf8");
  await chmod(filePath, 0o755);
}

async function withWorkspacePath<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  const originalPath = process.env.PATH;
  const binDir = path.join(workspace, "bin");
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ""}`;
  try {
    return await fn();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
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
