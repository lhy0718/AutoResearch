import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  createResearchBriefFile,
  findLatestResearchBrief,
  getWorkspaceResearchBriefPath,
  resolveResearchBriefPath
} from "../src/core/runs/researchBriefFiles.js";

describe("researchBriefFiles", () => {
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
    );
  });

  async function createWorkspace(): Promise<string> {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-files-"));
    workspaces.push(workspace);
    return workspace;
  }

  it("creates Brief.md at the workspace root", async () => {
    const workspace = await createWorkspace();

    const filePath = await createResearchBriefFile(workspace);

    expect(filePath).toBe(path.join(workspace, "Brief.md"));
    expect(await readFile(filePath, "utf8")).toContain("# Research Brief");
  });

  it("does not overwrite an existing workspace Brief.md", async () => {
    const workspace = await createWorkspace();
    const filePath = getWorkspaceResearchBriefPath(workspace);
    await writeFile(filePath, "# Research Brief\n\n## Topic\n\nKeep this content.", "utf8");

    const ensuredPath = await createResearchBriefFile(workspace);

    expect(ensuredPath).toBe(filePath);
    expect(await readFile(filePath, "utf8")).toContain("Keep this content.");
  });

  it("prefers workspace Brief.md over legacy latest-brief files", async () => {
    const workspace = await createWorkspace();
    const workspaceBriefPath = getWorkspaceResearchBriefPath(workspace);
    await writeFile(workspaceBriefPath, "# Research Brief\n\n## Topic\n\nWorkspace brief.", "utf8");
    const legacyDir = path.join(workspace, ".autolabos", "briefs");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      path.join(legacyDir, "20260325-legacy.md"),
      "# Research Brief\n\n## Topic\n\nLegacy brief.",
      "utf8"
    );

    const latest = await findLatestResearchBrief(workspace);

    expect(latest).toBe(workspaceBriefPath);
  });

  it("falls back to the latest legacy brief when workspace Brief.md is absent", async () => {
    const workspace = await createWorkspace();
    const legacyDir = path.join(workspace, ".autolabos", "briefs");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      path.join(legacyDir, "20260324-older.md"),
      "# Research Brief\n\n## Topic\n\nOlder brief.",
      "utf8"
    );
    const latestLegacyPath = path.join(legacyDir, "20260325-newer.md");
    await writeFile(latestLegacyPath, "# Research Brief\n\n## Topic\n\nNewer brief.", "utf8");

    const latest = await findLatestResearchBrief(workspace);

    expect(latest).toBe(latestLegacyPath);
  });

  it("resolves bare Brief.md to the workspace root while keeping other bare names as legacy brief paths", () => {
    const workspace = path.join("/tmp", "autolabos-brief-resolution");

    expect(resolveResearchBriefPath(workspace, "Brief.md")).toBe(path.join(workspace, "Brief.md"));
    expect(resolveResearchBriefPath(workspace, "legacy-brief.md")).toBe(
      path.join(workspace, ".autolabos", "briefs", "legacy-brief.md")
    );
  });
});
