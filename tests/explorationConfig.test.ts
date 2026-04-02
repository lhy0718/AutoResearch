import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { ExplorationStage } from "../src/core/exploration/types.js";
import { loadExplorationConfig, resolveExplorationConfig } from "../src/core/exploration/explorationConfig.js";

describe("explorationConfig", () => {
  it("loads the default exploration config", () => {
    const config = loadExplorationConfig();

    expect(config.stage_budgets.main_agenda.max_nodes).toBe(6);
    expect(config.figure_auditor.require_reference_alignment).toBe(true);
  });

  it("defaults enabled to false", () => {
    const config = loadExplorationConfig();

    expect(config.enabled).toBe(false);
  });

  it("accepts all declared exploration stages", () => {
    const stages: ExplorationStage[] = [
      "feasibility",
      "baseline_hardening",
      "main_agenda",
      "ablation"
    ];

    expect(stages).toHaveLength(4);
    expect(stages).toEqual([
      "feasibility",
      "baseline_hardening",
      "main_agenda",
      "ablation"
    ]);
  });

  it("reads workspace exploration overrides from .autolabos/config.yaml", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-exploration-config-"));
    await mkdir(path.join(root, ".autolabos"), { recursive: true });
    await writeFile(
      path.join(root, ".autolabos", "config.yaml"),
      [
        "exploration:",
        "  enabled: true",
        "  figure_auditor:",
        "    enabled: false",
        ""
      ].join("\n"),
      "utf8"
    );

    const config = resolveExplorationConfig({ workspaceRoot: root });

    expect(config.enabled).toBe(true);
    expect(config.figure_auditor.enabled).toBe(false);
  });
});
