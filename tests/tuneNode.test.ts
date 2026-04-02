import { describe, expect, it } from "vitest";

import { DefaultTuneNodeRunner, TuneNodeEvaluator } from "../src/core/agents/tuneNode.js";

describe("DefaultTuneNodeRunner", () => {
  it("renders a comparison report from mocked node evaluations", async () => {
    const evaluator: TuneNodeEvaluator = async (input) => ({
      label: input.variant,
      score: input.variant === "original" ? 0.62 : 0.79,
      notes: input.variant === "original" ? ["baseline prompt"] : ["mutant prompt"]
    });

    const runner = new DefaultTuneNodeRunner(evaluator);
    const report = await runner.run({
      workspaceRoot: "/workspace",
      run: {
        id: "run-12345678",
        title: "Tune run",
        topic: "topic",
        objectiveMetric: "metric",
        constraints: []
      },
      node: "generate_hypotheses"
    });

    expect(report.original.score).toBe(0.62);
    expect(report.mutant.score).toBe(0.79);
    expect(report.delta).toBe(0.17);
    expect(report.recommendation).toBe("keep");
    expect(report.lines.some((line) => line.includes("ORIGINAL score: 0.62"))).toBe(true);
    expect(report.lines.some((line) => line.includes("MUTANT score: 0.79"))).toBe(true);
    expect(report.lines.some((line) => line.includes("DELTA: +0.17"))).toBe(true);
    expect(report.lines.some((line) => line.includes("RECOMMENDATION: keep"))).toBe(true);
  });

  it("rejects unsupported nodes clearly", async () => {
    const runner = new DefaultTuneNodeRunner(async () => ({
      label: "original",
      score: 0.5,
      notes: []
    }));

    await expect(
      runner.run({
        workspaceRoot: "/workspace",
        run: {
          id: "run-unsupported",
          title: "Tune run",
          topic: "topic",
          objectiveMetric: "metric",
          constraints: []
        },
        node: "collect_papers" as never
      })
    ).rejects.toThrow("Unsupported node for tune-node");
  });
});

