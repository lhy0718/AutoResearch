import { describe, expect, it } from "vitest";

import { resolveCliAction } from "../src/cli/args.js";

describe("resolveCliAction", () => {
  it("runs app when no args", () => {
    expect(resolveCliAction([])).toEqual({ kind: "run" });
  });

  it("supports node option package selection for run mode", () => {
    expect(resolveCliAction(["--package", "fast"])).toEqual({ kind: "run", packageName: "fast" });
  });

  it("supports benchmark condition selection for TUI run mode", () => {
    expect(resolveCliAction(["--benchmark-condition", "gated"])).toEqual({
      kind: "run",
      benchmarkCondition: "gated"
    });
    expect(resolveCliAction(["--package", "fast", "--benchmark-condition", "ungated"])).toEqual({
      kind: "run",
      packageName: "fast",
      benchmarkCondition: "ungated"
    });
  });

  it("supports --help", () => {
    expect(resolveCliAction(["--help"]).kind).toBe("help");
  });

  it("supports web mode with host and port", () => {
    expect(resolveCliAction(["web", "--host", "0.0.0.0", "--port", "3001"])).toEqual({
      kind: "web",
      host: "0.0.0.0",
      port: 3001
    });
  });

  it("supports benchmark condition selection for web mode", () => {
    expect(resolveCliAction(["web", "--benchmark-condition", "no_review_gate"])).toEqual({
      kind: "web",
      benchmarkCondition: "no_review_gate"
    });
  });

  it("supports compare-analysis mode", () => {
    expect(resolveCliAction(["compare-analysis", "--run", "run-123", "--limit", "5", "--no-judge"])).toEqual({
      kind: "compare-analysis",
      runId: "run-123",
      limit: 5,
      judge: false
    });
  });

  it("supports eval-harness mode", () => {
    expect(resolveCliAction(["eval-harness", "--run", "run-123", "--run", "run-456", "--limit", "5", "--output", "outputs/eval.json"])).toEqual({
      kind: "eval-harness",
      runIds: ["run-123", "run-456"],
      limit: 5,
      outputPath: "outputs/eval.json",
      noHistory: false
    });
  });

  it("supports eval-harness --no-history", () => {
    expect(resolveCliAction(["eval-harness", "--limit", "5", "--no-history"])).toEqual({
      kind: "eval-harness",
      runIds: [],
      limit: 5,
      outputPath: undefined,
      noHistory: true
    });
  });

  it("supports evolve mode", () => {
    expect(resolveCliAction(["evolve", "--max-cycles", "2", "--target", "prompts", "--dry-run"])).toEqual({
      kind: "evolve",
      maxCycles: 2,
      target: "prompts",
      dryRun: true
    });
  });

  it("supports paper-readiness audit by seed and run root", () => {
    expect(resolveCliAction(["audit", "--seed", "AGB-001", "--out-dir", "outputs/audit"])).toEqual({
      kind: "audit",
      seedId: "AGB-001",
      runRoot: undefined,
      outDir: "outputs/audit"
    });
    expect(resolveCliAction(["audit", "--run", "outputs/run-a"])).toEqual({
      kind: "audit",
      runRoot: "outputs/run-a",
      seedId: undefined,
      outDir: undefined
    });
  });

  it("requires exactly one paper-readiness audit input", () => {
    expect(resolveCliAction(["audit"])).toMatchObject({
      kind: "error",
      message: expect.stringContaining("--run")
    });
    expect(resolveCliAction(["audit", "--run", "outputs/run-a", "--seed", "AGB-001"])).toMatchObject({
      kind: "error",
      message: expect.stringContaining("--run")
    });
  });

  it("supports meta-harness mode", () => {
    expect(resolveCliAction(["meta-harness", "--runs", "2", "--node", "review", "--no-apply"])).toEqual({
      kind: "meta-harness",
      runs: 2,
      nodes: ["review"],
      externalRunRoots: [],
      noApply: true,
      dryRun: false
    });
  });

  it("supports read-only external meta-harness contexts", () => {
    expect(resolveCliAction(["meta-harness", "--external-run", "runs/run-a", "--external-run", "runs/run-b", "--no-apply"])).toEqual({
      kind: "meta-harness",
      runs: 0,
      nodes: ["analyze_results", "review"],
      externalRunRoots: ["runs/run-a", "runs/run-b"],
      noApply: true,
      dryRun: false
    });
  });

  it("rejects external meta-harness contexts outside read-only mode", () => {
    expect(resolveCliAction(["meta-harness", "--external-run", "runs/run-a"])).toMatchObject({
      kind: "error",
      message: expect.stringContaining("--no-apply")
    });
    expect(resolveCliAction(["meta-harness", "--external-run", "runs/run-a", "--dry-run", "--no-apply"])).toMatchObject({
      kind: "error",
      message: expect.stringContaining("--dry-run")
    });
    expect(resolveCliAction(["meta-harness", "--external-run", "runs/run-a", "--runs", "2", "--no-apply"])).toMatchObject({
      kind: "error",
      message: expect.stringContaining("--runs")
    });
  });

  it("supports governance benchmark seed import mode", () => {
    expect(
      resolveCliAction([
        "governance-benchmark",
        "seed",
        "--source",
        "fixtures/AGB-001",
        "--task",
        "AGB-001",
        "--out-dir",
        "outputs/seeds",
        "--reference-only"
      ])
    ).toEqual({
      kind: "governance-benchmark-seed",
      sourcePath: "fixtures/AGB-001",
      taskId: "AGB-001",
      outDir: "outputs/seeds",
      referenceOnly: true
    });
  });

  it("supports governance benchmark dry-run mode", () => {
    expect(
      resolveCliAction([
        "governance-benchmark",
        "dry-run",
        "--seed",
        "outputs/governance-benchmark/seeds/AGB-001",
        "--task",
        "AGB-001",
        "--condition",
        "gated",
        "--condition",
        "ungated",
        "--out-dir",
        "outputs/governance-benchmark/AGB-001"
      ])
    ).toEqual({
      kind: "governance-benchmark-dry-run",
      seedPath: "outputs/governance-benchmark/seeds/AGB-001",
      taskId: "AGB-001",
      conditions: ["gated", "ungated"],
      outDir: "outputs/governance-benchmark/AGB-001"
    });
  });

  it("supports governance benchmark batch mode", () => {
    expect(
      resolveCliAction([
        "governance-benchmark",
        "batch",
        "--seeds",
        "outputs/governance-benchmark/seeds",
        "--task",
        "AGB-001",
        "--task",
        "AGB-002",
        "--condition",
        "gated",
        "--condition",
        "ungated",
        "--out-dir",
        "outputs/governance-benchmark/batch"
      ])
    ).toEqual({
      kind: "governance-benchmark-batch",
      seedsRoot: "outputs/governance-benchmark/seeds",
      taskIds: ["AGB-001", "AGB-002"],
      conditions: ["gated", "ungated"],
      outDir: "outputs/governance-benchmark/batch"
    });
  });

  it("supports governance benchmark demo bundle export mode", () => {
    expect(
      resolveCliAction([
        "governance-benchmark",
        "export-bundles",
        "--source",
        "outputs/run-a",
        "--source",
        "outputs/run-b",
        "--max",
        "3",
        "--out-dir",
        "outputs/governance-benchmark/demo-bundles"
      ])
    ).toEqual({
      kind: "governance-benchmark-export-bundles",
      publicOutputRoots: ["outputs/run-a", "outputs/run-b"],
      maxBundles: 3,
      outDir: "outputs/governance-benchmark/demo-bundles"
    });
  });

  it("requires a run id for compare-analysis", () => {
    const action = resolveCliAction(["compare-analysis"]);
    expect(action.kind).toBe("error");
  });

  it("requires a source for governance benchmark seed import mode", () => {
    const action = resolveCliAction(["governance-benchmark", "seed"]);
    expect(action.kind).toBe("error");
  });

  it("requires a seed for governance benchmark dry-run mode", () => {
    const action = resolveCliAction(["governance-benchmark", "dry-run"]);
    expect(action.kind).toBe("error");
  });

  it("requires seeds for governance benchmark batch mode", () => {
    const action = resolveCliAction(["governance-benchmark", "batch"]);
    expect(action.kind).toBe("error");
  });

  it("requires a source for governance benchmark demo bundle export mode", () => {
    const action = resolveCliAction(["governance-benchmark", "export-bundles"]);
    expect(action.kind).toBe("error");
  });

  it("rejects init subcommand", () => {
    const action = resolveCliAction(["init"]);
    expect(action.kind).toBe("error");
  });

  it("rejects unknown package names", () => {
    const action = resolveCliAction(["--package", "turbo"]);
    expect(action.kind).toBe("error");
  });
});
