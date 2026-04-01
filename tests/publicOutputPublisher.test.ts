import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import {
  generatePublicRunReadme,
  publishPublicRunOutputs
} from "../src/core/publicOutputPublisher.js";
import {
  buildPublicRunManifestPath,
  buildPublicRunOutputDir,
  buildPublicRunOutputSlug
} from "../src/core/publicArtifacts.js";
import { PersistedEventStream } from "../src/core/events.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { RunStore } from "../src/core/runs/runStore.js";
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
      output_root: `outputs/${buildPublicRunOutputSlug(run)}`,
      provenance: {
        run_id: run.id,
        node: "analyze_results",
        timestamp: "2026-03-18T00:00:00Z"
      },
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
      output_root: `outputs/${buildPublicRunOutputSlug(run)}`,
      provenance: {
        run_id: run.id,
        node: "review",
        timestamp: "2026-03-18T00:00:00Z"
      },
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
      node: "analyze_results",
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

  it("uses a slugged output directory, records manifest provenance, and keeps events under the run directory", async () => {
    const paths = resolveAppPaths(tmpDir);
    await ensureScaffold(paths);
    const store = new RunStore(paths);
    const run = await store.createRun({
      title: "Slug Provenance Audit",
      topic: "auditability",
      constraints: [],
      objectiveMetric: "consistency"
    });

    const runDir = path.join(paths.runsDir, run.id);
    const sourcePath = path.join(runDir, "review", "decision.json");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, JSON.stringify({ outcome: "advance" }, null, 2), "utf8");

    await publishPublicRunOutputs({
      workspaceRoot: tmpDir,
      run,
      node: "review",
      section: "review",
      files: [
        {
          sourcePath,
          targetRelativePath: "decision.json"
        }
      ]
    });

    const stream = new PersistedEventStream(paths.runsDir);
    stream.emit({
      type: "OBS_RECEIVED",
      runId: run.id,
      node: "review",
      payload: { text: "review artifact published" }
    });

    const outputDir = buildPublicRunOutputDir(tmpDir, run);
    expect(path.basename(outputDir)).toBe(buildPublicRunOutputSlug(run));

    const manifest = JSON.parse(await fs.readFile(buildPublicRunManifestPath(tmpDir, run), "utf8")) as {
      output_root: string;
      provenance?: { run_id: string; node: string; timestamp: string };
    };
    expect(manifest.output_root).toBe(`outputs/${buildPublicRunOutputSlug(run)}`);
    expect(manifest.provenance).toMatchObject({
      run_id: run.id,
      node: "review"
    });
    expect(typeof manifest.provenance?.timestamp).toBe("string");

    await expect(fs.stat(path.join(paths.runsDir, run.id, "events.jsonl"))).resolves.toBeTruthy();
  });
});
