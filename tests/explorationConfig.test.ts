import { describe, expect, it } from "vitest";

import type { ExplorationStage } from "../src/core/exploration/types.js";
import { loadExplorationConfig } from "../src/core/exploration/explorationConfig.js";

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
});
