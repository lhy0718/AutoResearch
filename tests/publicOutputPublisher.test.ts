import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import {
  generatePublicRunReadme,
  publishPublicRunOutputs
} from "../src/core/publicOutputPublisher.js";
import { buildPublicRunOutputDir, buildPublicRunManifestPath } from "../src/core/publicArtifacts.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import {
  buildRepositoryKnowledgeIndexPath,
  buildRepositoryKnowledgeNotePath
} from "../src/core/repositoryKnowledge.js";

describe("generatePublicRunReadme", () => {
  let tmpDir: string;
  const run = {
    id: "abc12345-dead-beef-cafe-0123456789ab",
    title: "Test Run Title",
    topic: "Adaptive reasoning under budget",
    objectiveMetric: "accuracy",
    latestSummary: "Review gate completed."
  };

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
      output_root: "outputs",
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

  it("does not create an output symlink at workspace root", async () => {
    const outputDir = buildPublicRunOutputDir(tmpDir, run);
    await fs.mkdir(outputDir, { recursive: true });
    const manifestPath = buildPublicRunManifestPath(tmpDir, run);
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 1,
      run_id: run.id,
      title: run.title,
      output_root: "outputs",
      updated_at: "2026-03-18T00:00:00Z",
      workspace_changed_files: [],
      generated_files: [],
      sections: {}
    }));

    await generatePublicRunReadme(tmpDir, run);
    await expect(fs.lstat(path.join(tmpDir, "output"))).rejects.toThrow();
  });

  it("updates a repository knowledge index when public outputs are published", async () => {
    const runContext = new RunContextMemory(path.join(tmpDir, ".autolabos", "runs", run.id, "memory", "run_context.json"));
    await runContext.put("run_brief.extracted", {
      topic: run.topic,
      researchQuestion: "Can adaptive reasoning improve accuracy under a fixed budget?"
    });
    await runContext.put("analyze_results.last_summary", {
      overview: {
        objective_summary: "Adaptive reasoning improved accuracy over the baseline."
      }
    });
    await runContext.put("review.manuscript_type", "paper_scale_candidate");

    const sourcePath = path.join(tmpDir, ".autolabos", "runs", run.id, "result_table.json");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, JSON.stringify({ rows: [{ system: "baseline", score: 0.5 }] }), "utf8");

    await publishPublicRunOutputs({
      workspaceRoot: tmpDir,
      run,
      runContext,
      section: "analysis",
      files: [
        {
          sourcePath,
          targetRelativePath: "result_table.json"
        }
      ]
    });

    const index = JSON.parse(await fs.readFile(buildRepositoryKnowledgeIndexPath(tmpDir), "utf8"));
    const note = await fs.readFile(buildRepositoryKnowledgeNotePath(tmpDir, run.id), "utf8");

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].run_id).toBe(run.id);
    expect(index.entries[0].topic).toBe(run.topic);
    expect(index.entries[0].research_question).toContain("adaptive reasoning");
    expect(index.entries[0].analysis_summary).toContain("improved accuracy");
    expect(index.entries[0].manuscript_type).toBe("paper_scale_candidate");
    expect(index.entries[0].latest_published_section).toBe("analysis");
    expect(note).toContain("## Research Question");
    expect(note).toContain("## Analysis Summary");
    expect(note).toContain("### analysis");
  });
});
