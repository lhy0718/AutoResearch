import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";

import { runEvolveLoop } from "../src/core/evolution/evolveRun.js";

const cleanupPaths: string[] = [];

describe("runEvolveLoop", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0).map(async (target) => {
        await fs.rm(target, { recursive: true, force: true });
      })
    );
  });

  it("creates git tag evo-1 when the first cycle improves fitness", async () => {
    const workspace = await createWorkspaceWithGit();
    const report = await runEvolveLoop(
      {
        cwd: workspace,
        maxCycles: 1,
        target: "all"
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(),
        executeCycle: vi.fn().mockResolvedValue({
          runId: "run-1",
          fitnessScore: 8,
          runStatus: "completed"
        }),
        runValidateHarness: vi.fn().mockResolvedValue(undefined)
      }
    );

    const tags = execGit(workspace, ["tag"]).trim().split("\n").filter(Boolean);
    expect(tags).toContain("evo-1");
    expect(report.rows).toEqual([
      {
        cycle: 1,
        fitness: 8,
        delta: null,
        mutation_target: "none",
        status: "IMPROVED"
      }
    ]);
  });

  it("restores .codex and node-prompts from the last good tag when a later cycle regresses", async () => {
    const workspace = await createWorkspaceWithGit();
    const promptPath = path.join(workspace, "node-prompts", "analyze_results.md");
    const originalPrompt = await fs.readFile(promptPath, "utf8");
    const executeCycle = vi
      .fn()
      .mockResolvedValueOnce({
        runId: "run-1",
        fitnessScore: 8,
        runStatus: "completed"
      })
      .mockResolvedValueOnce({
        runId: "run-2",
        fitnessScore: 6,
        runStatus: "completed"
      });

    await runEvolveLoop(
      {
        cwd: workspace,
        maxCycles: 2,
        target: "all"
      },
      {
        bootstrapRuntime: fakeBootstrapRuntime(),
        executeCycle,
        runValidateHarness: vi.fn().mockResolvedValue(undefined)
      }
    );

    const restoredPrompt = await fs.readFile(promptPath, "utf8");
    expect(restoredPrompt).toBe(originalPrompt);
    const tags = execGit(workspace, ["tag"]).trim().split("\n").filter(Boolean);
    expect(tags).toContain("evo-1");
  });

  it("supports dry-run mode without requiring a real runtime", async () => {
    const workspace = await createWorkspaceWithGit();
    const report = await runEvolveLoop({
      cwd: workspace,
      maxCycles: 1,
      target: "all",
      dryRun: true
    });

    expect(report.rows[0]).toEqual({
      cycle: 1,
      fitness: 0,
      delta: null,
      mutation_target: "none",
      status: "DRY_RUN"
    });
    expect(report.lines[0]).toContain("Dry run");
  });
});

function fakeBootstrapRuntime() {
  return vi.fn().mockResolvedValue({
    configured: true,
    firstRunSetup: false,
    paths: { cwd: process.cwd() },
    runtime: {} as never
  });
}

async function createWorkspaceWithGit(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-evolve-"));
  cleanupPaths.push(workspace);
  await fs.mkdir(path.join(workspace, ".codex", "skills", "paper-build-output-hygiene"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".codex", "skills", "paper-scale-research-loop"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".codex", "skills", "tui-state-validation"), { recursive: true });
  await fs.mkdir(path.join(workspace, ".codex", "skills", "tui-validation-loop-automation"), { recursive: true });
  await fs.mkdir(path.join(workspace, "node-prompts"), { recursive: true });

  await fs.writeFile(
    path.join(workspace, ".codex", "skills", "paper-build-output-hygiene", "SKILL.md"),
    "# skill\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(workspace, ".codex", "skills", "paper-scale-research-loop", "SKILL.md"),
    "# skill\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(workspace, ".codex", "skills", "tui-state-validation", "SKILL.md"),
    "# skill\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(workspace, ".codex", "skills", "tui-validation-loop-automation", "SKILL.md"),
    "# skill\n",
    "utf8"
  );

  await fs.writeFile(path.join(workspace, "node-prompts", "generate_hypotheses.md"), "## system\nPrompt\n", "utf8");
  await fs.writeFile(path.join(workspace, "node-prompts", "design_experiments.md"), "## system\nPrompt\n", "utf8");
  await fs.writeFile(path.join(workspace, "node-prompts", "analyze_results.md"), "## system\nPrompt\n", "utf8");
  await fs.writeFile(path.join(workspace, "node-prompts", "review.md"), "## reviewer_system_template\nPrompt\n", "utf8");

  execGit(workspace, ["init"]);
  execGit(workspace, ["config", "user.email", "codex@example.com"]);
  execGit(workspace, ["config", "user.name", "Codex"]);
  execGit(workspace, ["add", "."]);
  execGit(workspace, ["commit", "-m", "init"]);
  return workspace;
}

function execGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8"
  });
}
