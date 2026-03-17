import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { generatePublicRunReadme } from "../src/core/publicOutputPublisher.js";
import { buildPublicRunOutputDir, buildPublicRunManifestPath } from "../src/core/publicArtifacts.js";

describe("generatePublicRunReadme", () => {
  let tmpDir: string;
  const run = { id: "abc12345-dead-beef-cafe-0123456789ab", title: "Test Run Title" };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pub-out-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates README.md with run metadata", async () => {
    const outputDir = buildPublicRunOutputDir(tmpDir, run);
    await fs.mkdir(outputDir, { recursive: true });
    const manifestPath = buildPublicRunManifestPath(tmpDir, run);
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 1,
      run_id: run.id,
      title: run.title,
      output_root: "outputs/test-run-title-abc12345",
      updated_at: "2026-03-18T00:00:00Z",
      workspace_changed_files: [],
      generated_files: ["paper/main.tex", "paper/references.bib", "analysis/result_table.json"],
      sections: {
        paper: { dir: "paper", generated_files: ["main.tex", "references.bib"], updated_at: "2026-03-18T00:00:00Z" },
        analysis: { dir: "analysis", generated_files: ["result_table.json"], updated_at: "2026-03-18T00:00:00Z" }
      }
    }));

    const readmePath = await generatePublicRunReadme(tmpDir, run);
    expect(readmePath).toContain("README.md");
    const content = await fs.readFile(readmePath, "utf8");
    expect(content).toContain("# Test Run Title");
    expect(content).toContain(run.id);
    expect(content).toContain("main.tex");
    expect(content).toContain("result_table.json");
  });

  it("creates output symlink at workspace root", async () => {
    const outputDir = buildPublicRunOutputDir(tmpDir, run);
    await fs.mkdir(outputDir, { recursive: true });
    const manifestPath = buildPublicRunManifestPath(tmpDir, run);
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 1,
      run_id: run.id,
      title: run.title,
      output_root: "outputs/test-run-title-abc12345",
      updated_at: "2026-03-18T00:00:00Z",
      workspace_changed_files: [],
      generated_files: [],
      sections: {}
    }));

    await generatePublicRunReadme(tmpDir, run);
    const symlinkPath = path.join(tmpDir, "output");
    const stat = await fs.lstat(symlinkPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const target = await fs.readlink(symlinkPath);
    expect(target).toContain("test-run-title-abc12345");
  });
});
