import path from "node:path";
import os, { tmpdir } from "node:os";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodexNativeClient,
  normalizeCodexWorkspacePath,
  presentCodexPath,
  selectPreferredCodexFinalText
} from "../src/integrations/codex/codexCliClient.js";

describe("CodexNativeClient fake response sequence", () => {
  const tempDirs: string[] = [];
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(async () => {
    delete process.env.AUTOLABOS_FAKE_CODEX_RESPONSE;
    delete process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE;
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("consumes fake response sequence entries in order", async () => {
    process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE = JSON.stringify([
      { reply_lines: ["first"] },
      { reply_lines: ["second"] }
    ]);

    const client = new CodexNativeClient(process.cwd());
    const first = await client.runForText({
      prompt: "one",
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });
    const second = await client.runForText({
      prompt: "two",
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });

    expect(first).toContain("first");
    expect(second).toContain("second");
  });

  it("maps /private sandbox aliases to writable workspace paths", () => {
    expect(presentCodexPath("/private/tmp/demo")).toBe("/tmp/demo");
    expect(
      normalizeCodexWorkspacePath("/tmp/demo/outputs/experiment.py", "/private/tmp/demo")
    ).toBe("/private/tmp/demo/outputs/experiment.py");
    expect(
      normalizeCodexWorkspacePath("/var/folders/x/demo/run.py", "/private/var/folders/x/demo")
    ).toBe("/private/var/folders/x/demo/run.py");
  });

  it("checks writable Codex home and shell snapshot directories via CODEX_HOME", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-codex-home-"));
    tempDirs.push(root);
    process.env.CODEX_HOME = path.join(root, ".codex");

    const client = new CodexNativeClient(process.cwd());
    const checks = await client.checkEnvironmentReadiness({
      models: ["gpt-5.4"],
      includeModelCapacity: true
    });

    expect(checks.find((check) => check.name === "codex-home")).toMatchObject({ ok: true, blocking: true });
    expect(checks.find((check) => check.name === "codex-shell-snapshots")).toMatchObject({
      ok: true,
      blocking: true
    });
    expect(checks.find((check) => check.name === "codex-model-capacity")).toMatchObject({
      ok: true,
      blocking: false
    });
  });

  it("falls back to a workspace-local Codex home when the default home is not writable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-codex-home-fallback-"));
    const workspace = await mkdtemp(path.join(tmpdir(), "autolabos-codex-workspace-"));
    tempDirs.push(root, workspace);
    const readonlyCodexHome = path.join(root, ".codex");
    await writeFile(path.join(root, ".placeholder"), "keep", "utf8");
    await rm(path.join(root, ".placeholder"), { force: true });
    await mkdir(readonlyCodexHome, { recursive: true });
    await chmod(readonlyCodexHome, 0o555);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    delete process.env.CODEX_HOME;

    const client = new CodexNativeClient(workspace);
    const checks = await client.checkEnvironmentReadiness();

    const fallbackHome = path.join(workspace, ".autolabos", "runtime", "codex-home");
    expect(checks.find((check) => check.name === "codex-home")).toMatchObject({
      ok: true,
      blocking: true
    });
    expect(checks.find((check) => check.name === "codex-home")?.detail).toContain(fallbackHome);
    expect(checks.find((check) => check.name === "codex-home")?.detail).toContain(
      "Using workspace-local fallback"
    );
    expect(checks.find((check) => check.name === "codex-shell-snapshots")).toMatchObject({
      ok: true,
      blocking: true
    });
  });

  it("reports a non-directory CODEX_HOME as a blocking readiness failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-codex-home-file-"));
    tempDirs.push(root);
    const codexHomeFile = path.join(root, ".codex");
    await writeFile(codexHomeFile, "not-a-directory", "utf8");
    process.env.CODEX_HOME = codexHomeFile;

    const client = new CodexNativeClient(process.cwd());
    const checks = await client.checkEnvironmentReadiness();

    expect(checks.find((check) => check.name === "codex-home")).toMatchObject({
      ok: false,
      blocking: true
    });
    expect(checks.find((check) => check.name === "codex-home")?.detail).toContain("not a directory");
  });

  it("flags Spark research models as a non-blocking capacity risk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-codex-spark-"));
    tempDirs.push(root);
    process.env.CODEX_HOME = path.join(root, ".codex");

    const client = new CodexNativeClient(process.cwd());
    const checks = await client.checkEnvironmentReadiness({
      models: ["gpt-5.3-codex-spark"],
      includeModelCapacity: true
    });

    expect(checks.find((check) => check.name === "codex-model-capacity")).toMatchObject({
      ok: false,
      blocking: false
    });
    expect(checks.find((check) => check.name === "codex-model-capacity")?.detail).toContain("gpt-5.4");
  });

  it("prefers the richer streamed delta text over a truncated completed payload", () => {
    const completedText = `{"summary":"${"a".repeat(65_520)}`;
    const deltaText = `${completedText}","key_findings":["kept"],"limitations":[],"datasets":[],"metrics":[],"novelty":"ok","reproducibility_notes":[],"evidence_items":[]}`;

    expect(
      selectPreferredCodexFinalText({
        completedText,
        deltaText,
        fallbackText: "fallback"
      })
    ).toBe(deltaText);
  });
});
