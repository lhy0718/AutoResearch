import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { listRunArtifacts, readRunArtifact, resolveRunArtifactPath } from "../src/web/artifacts.js";

describe("web artifacts", () => {
  it("lists nested artifacts and blocks path traversal", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-artifacts-"));
    const paths = resolveAppPaths(cwd);
    await ensureScaffold(paths);
    const runId = "run-1";
    const runDir = path.join(paths.runsDir, runId, "paper");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(paths.runsDir, runId, "metrics.json"), '{"score":1}\n', "utf8");
    await fs.writeFile(path.join(runDir, "main.tex"), "\\section{Test}\n", "utf8");

    const artifacts = await listRunArtifacts(paths, runId);
    expect(artifacts.map((item) => item.path)).toEqual(
      expect.arrayContaining(["metrics.json", "paper", "paper/main.tex"])
    );

    await expect(() => resolveRunArtifactPath(paths, runId, "../config.yaml")).toThrow();
    const artifact = await readRunArtifact(paths, runId, "metrics.json");
    expect(artifact.contentType).toContain("application/json");
    expect(artifact.data.toString("utf8")).toContain('"score":1');
  });
});
