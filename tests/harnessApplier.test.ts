import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";

import { applyWithSafetyNet } from "../src/core/metaHarness/harnessApplier.js";

const cleanupPaths: string[] = [];

describe("applyWithSafetyNet", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true }))
    );
  });

  it("applies and logs when validate:harness passes", async () => {
    const workspace = await createWorkspace();
    const targetFile = path.join(workspace, "node-prompts", "analyze_results.md");
    const result = await applyWithSafetyNet(
      {
        targetFile,
        newContent: "updated prompt\n",
        source: "meta-harness",
        candidateId: "candidate-1",
        scoreBefore: 7.5
      },
      {
        runValidateHarness: vi.fn().mockResolvedValue(undefined),
        gitRevParseHead: vi.fn().mockResolvedValue("abc123"),
        gitAdd: vi.fn().mockResolvedValue(undefined),
        gitCommit: vi.fn().mockResolvedValue(undefined)
      }
    );

    expect(result.applied).toBe(true);
    expect(result.validationPassed).toBe(true);
    expect(await fs.readFile(targetFile, "utf8")).toBe("updated prompt\n");
    const audit = await fs.readFile(result.auditLogPath, "utf8");
    expect(audit).toContain("\"applied\":true");
  });

  it("rolls back and logs when validate:harness fails", async () => {
    const workspace = await createWorkspace();
    const targetFile = path.join(workspace, "node-prompts", "analyze_results.md");
    const original = await fs.readFile(targetFile, "utf8");
    const result = await applyWithSafetyNet(
      {
        targetFile,
        newContent: "broken prompt\n",
        source: "meta-harness",
        candidateId: "candidate-2",
        scoreBefore: 6
      },
      {
        runValidateHarness: vi.fn().mockRejectedValue(new Error("validate failed")),
        gitRevParseHead: vi.fn().mockResolvedValue("abc123"),
        gitAdd: vi.fn().mockResolvedValue(undefined),
        gitCommit: vi.fn().mockResolvedValue(undefined)
      }
    );

    expect(result.applied).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(await fs.readFile(targetFile, "utf8")).toBe(original);
    const audit = await fs.readFile(result.auditLogPath, "utf8");
    expect(audit).toContain("validate failed");
  });

  it("rejects target files outside node-prompts", async () => {
    const workspace = await createWorkspace();
    const outsideFile = path.join(workspace, "outside.md");
    await fs.writeFile(outsideFile, "oops\n", "utf8");

    await expect(
      applyWithSafetyNet({
        targetFile: outsideFile,
        newContent: "new\n",
        source: "meta-harness",
        candidateId: null,
        scoreBefore: null
      })
    ).rejects.toThrow("node-prompts");
  });
});

async function createWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-harness-apply-"));
  cleanupPaths.push(workspace);
  await fs.mkdir(path.join(workspace, "node-prompts"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".autolabos"), { recursive: true });
  await fs.writeFile(path.join(workspace, "node-prompts", "analyze_results.md"), "original prompt\n", "utf8");
  return workspace;
}
