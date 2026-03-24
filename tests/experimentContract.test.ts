import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";

import { describe, expect, it, beforeEach } from "vitest";

import {
  buildExperimentContract,
  validateExperimentContract,
  writeExperimentContract,
  loadExperimentContract,
  type ExperimentContract
} from "../src/core/experiments/experimentContract.js";
import {
  FailureMemory,
  buildErrorFingerprint
} from "../src/core/experiments/failureMemory.js";
import {
  buildAttemptDecision,
  writeAttemptDecision,
  loadAttemptDecisions
} from "../src/core/experiments/attemptDecision.js";
import { RunRecord } from "../src/types.js";

function makeMinimalRun(id: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id,
    title: "test-run",
    topic: "test topic",
    constraints: [],
    objectiveMetric: "macro-F1",
    status: "running",
    currentNode: "design_experiments",
    nodeThreads: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    graph: {
      currentNode: "design_experiments",
      nodeStates: {} as any,
      retryCounters: {},
      rollbackCounters: {},
      pendingTransition: undefined,
      researchCycle: 0,
      retryPolicy: { maxAttemptsPerNode: 3, maxAutoRollbacksPerNode: 2 }
    },
    memoryRefs: {
      runContextPath: "",
      longTermPath: "",
      episodePath: ""
    }
  };
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-contract-test-"));
  process.chdir(tempDir);
  // Create the run directory structure
  await fs.mkdir(path.join(tempDir, ".autolabos", "runs", "test-run-1"), { recursive: true });
});

// ---------------------------------------------------------------------------
// Experiment Contract
// ---------------------------------------------------------------------------
describe("ExperimentContract", () => {
  it("builds a valid contract with all fields", () => {
    const run = makeMinimalRun("test-run-1");
    const contract = buildExperimentContract({
      run,
      hypothesis: "Shared state schema improves multi-agent coordination",
      causalMechanism: "Structured JSON handoff reduces information loss between agents",
      singleChange: "Replace free-form chat with shared_state_schema",
      expectedMetricEffect: "Improve macro-F1 by at least +0.5 points",
      abortCondition: "Abort if F1 drops below baseline by more than 1 point",
      keepOrDiscardRule: "Keep if macro-F1 improves; discard if no improvement"
    });

    expect(contract.version).toBe(1);
    expect(contract.run_id).toBe("test-run-1");
    expect(contract.hypothesis).toContain("Shared state schema");
    expect(contract.confounded).toBe(false);
    expect(contract.additional_changes).toBeUndefined();
  });

  it("marks contract as confounded when multiple changes exist", () => {
    const run = makeMinimalRun("test-run-1");
    const contract = buildExperimentContract({
      run,
      hypothesis: "Test hypothesis",
      causalMechanism: "Test mechanism",
      singleChange: "Change A",
      additionalChanges: ["Change B", "Change C"],
      expectedMetricEffect: "Improve metric",
      abortCondition: "None",
      keepOrDiscardRule: "Keep if improved"
    });

    expect(contract.confounded).toBe(true);
    expect(contract.additional_changes).toEqual(["Change B", "Change C"]);
  });

  it("validates a complete contract as valid", () => {
    const contract: ExperimentContract = {
      version: 1,
      run_id: "test",
      created_at: new Date().toISOString(),
      hypothesis: "Real hypothesis",
      causal_mechanism: "Real mechanism",
      single_change: "Real change",
      confounded: false,
      expected_metric_effect: "Positive effect",
      abort_condition: "Abort if degraded",
      keep_or_discard_rule: "Keep if improved",
      baselines: ["current-system"]
    };

    const result = validateExperimentContract(contract);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("validates an incomplete contract with issues", () => {
    const contract: ExperimentContract = {
      version: 1,
      run_id: "test",
      created_at: new Date().toISOString(),
      hypothesis: "(not specified)",
      causal_mechanism: "(not specified)",
      single_change: "A change",
      confounded: true,
      additional_changes: ["extra change"],
      expected_metric_effect: "Some effect",
      abort_condition: "None",
      keep_or_discard_rule: "Default"
    };

    const result = validateExperimentContract(contract);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2); // missing hypothesis + mechanism + confounded
  });

  it("round-trips through write and load", async () => {
    const run = makeMinimalRun("test-run-1");
    const contract = buildExperimentContract({
      run,
      hypothesis: "Test round-trip",
      causalMechanism: "Mechanism",
      singleChange: "Change",
      expectedMetricEffect: "Effect",
      abortCondition: "Abort",
      keepOrDiscardRule: "Keep"
    });

    await writeExperimentContract(run, contract);
    const loaded = await loadExperimentContract("test-run-1");
    expect(loaded).toBeDefined();
    expect(loaded!.hypothesis).toBe("Test round-trip");
    expect(loaded!.version).toBe(1);
  });

  it("returns undefined when contract file does not exist", async () => {
    const loaded = await loadExperimentContract("nonexistent-run");
    expect(loaded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Failure Memory
// ---------------------------------------------------------------------------
describe("FailureMemory", () => {
  it("appends and reads failure records", async () => {
    const fm = new FailureMemory(
      path.join(tempDir, ".autolabos", "runs", "test-run-1", "failure_memory.jsonl")
    );

    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 1,
      failure_class: "structural",
      error_fingerprint: "metrics file missing",
      error_message: "metrics.json was not found after execution",
      do_not_retry: true,
      do_not_retry_reason: "Structural failure"
    });

    const all = await fm.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].failure_class).toBe("structural");
    expect(all[0].do_not_retry).toBe(true);
    expect(all[0].failure_id).toMatch(/^fail_/);
  });

  it("filters by node", async () => {
    const fm = new FailureMemory(
      path.join(tempDir, ".autolabos", "runs", "test-run-1", "failure_memory.jsonl")
    );

    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 1,
      failure_class: "transient",
      error_fingerprint: "fp1",
      error_message: "error 1",
      do_not_retry: false
    });
    await fm.append({
      run_id: "test-run-1",
      node_id: "implement_experiments",
      attempt: 1,
      failure_class: "structural",
      error_fingerprint: "fp2",
      error_message: "error 2",
      do_not_retry: true
    });

    const runExpRecords = await fm.forNode("run_experiments");
    expect(runExpRecords).toHaveLength(1);
    expect(runExpRecords[0].error_fingerprint).toBe("fp1");
  });

  it("detects do-not-retry markers", async () => {
    const fm = new FailureMemory(
      path.join(tempDir, ".autolabos", "runs", "test-run-1", "failure_memory.jsonl")
    );

    expect(await fm.hasDoNotRetry("run_experiments")).toBe(false);

    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 1,
      failure_class: "structural",
      error_fingerprint: "fp1",
      error_message: "error",
      do_not_retry: true,
      do_not_retry_reason: "Structural"
    });

    expect(await fm.hasDoNotRetry("run_experiments")).toBe(true);
    expect(await fm.hasDoNotRetry("implement_experiments")).toBe(false);
  });

  it("counts equivalent failures by fingerprint", async () => {
    const fm = new FailureMemory(
      path.join(tempDir, ".autolabos", "runs", "test-run-1", "failure_memory.jsonl")
    );

    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 1,
      failure_class: "transient",
      error_fingerprint: "same_error",
      error_message: "error A",
      do_not_retry: false
    });
    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 2,
      failure_class: "transient",
      error_fingerprint: "same_error",
      error_message: "error A again",
      do_not_retry: false
    });
    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 3,
      failure_class: "transient",
      error_fingerprint: "different_error",
      error_message: "error B",
      do_not_retry: false
    });

    expect(await fm.countEquivalentFailures("run_experiments", "same_error")).toBe(2);
    expect(await fm.countEquivalentFailures("run_experiments", "different_error")).toBe(1);
    expect(await fm.countEquivalentFailures("run_experiments", "nonexistent")).toBe(0);
  });

  it("clusters failures by fingerprint", async () => {
    const fm = new FailureMemory(
      path.join(tempDir, ".autolabos", "runs", "test-run-1", "failure_memory.jsonl")
    );

    for (let i = 0; i < 3; i++) {
      await fm.append({
        run_id: "test-run-1",
        node_id: "run_experiments",
        attempt: i + 1,
        failure_class: "transient",
        error_fingerprint: "repeated_fp",
        error_message: "repeated error",
        do_not_retry: false
      });
    }
    await fm.append({
      run_id: "test-run-1",
      node_id: "run_experiments",
      attempt: 4,
      failure_class: "structural",
      error_fingerprint: "unique_fp",
      error_message: "unique error",
      do_not_retry: true
    });

    const clusters = await fm.failureClusters("run_experiments");
    expect(clusters[0]).toEqual(["repeated_fp", 3]);
    expect(clusters[1]).toEqual(["unique_fp", 1]);
  });

  it("returns empty when file does not exist", async () => {
    const fm = new FailureMemory("/nonexistent/failure_memory.jsonl");
    const all = await fm.readAll();
    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Error Fingerprinting
// ---------------------------------------------------------------------------
describe("buildErrorFingerprint", () => {
  it("strips timestamps", () => {
    const fp = buildErrorFingerprint("Error at 2025-01-15T10:30:00.000Z in module");
    expect(fp).not.toContain("2025");
    expect(fp).toContain("<ts>");
  });

  it("strips file paths", () => {
    const fp = buildErrorFingerprint("Failed to read /home/user/project/file.txt");
    expect(fp).not.toContain("/home");
    expect(fp).toContain("<path>");
  });

  it("strips numbers", () => {
    const fp = buildErrorFingerprint("Exit code 137, retry 3 of 5");
    expect(fp).not.toContain("137");
    expect(fp).toContain("<n>");
  });

  it("truncates to 200 chars", () => {
    const long = "A".repeat(500);
    const fp = buildErrorFingerprint(long);
    expect(fp.length).toBeLessThanOrEqual(200);
  });

  it("produces same fingerprint for equivalent errors", () => {
    const fp1 = buildErrorFingerprint("metrics.json not found at /run/123/metrics.json");
    const fp2 = buildErrorFingerprint("metrics.json not found at /run/456/metrics.json");
    expect(fp1).toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// Attempt Decision
// ---------------------------------------------------------------------------
describe("AttemptDecision", () => {
  it("builds a keep decision", () => {
    const decision = buildAttemptDecision({
      runId: "test-run-1",
      attempt: 1,
      verdict: "keep",
      rationale: "Objective metric improved by +0.7 macro-F1",
      metricName: "macro-F1",
      metricValue: 0.85,
      baselineValue: 0.78,
      metricImproved: true
    });

    expect(decision.verdict).toBe("keep");
    expect(decision.metric_improved).toBe(true);
    expect(decision.discard_reason).toBeUndefined();
    expect(decision.decision_id).toMatch(/^dec_/);
  });

  it("builds a discard decision with reason", () => {
    const decision = buildAttemptDecision({
      runId: "test-run-1",
      attempt: 2,
      verdict: "discard",
      rationale: "No improvement observed",
      discardReason: "macro-F1 decreased by 0.3 points",
      metricImproved: false
    });

    expect(decision.verdict).toBe("discard");
    expect(decision.discard_reason).toContain("decreased");
  });

  it("builds a needs_replication decision", () => {
    const decision = buildAttemptDecision({
      runId: "test-run-1",
      attempt: 1,
      verdict: "needs_replication",
      rationale: "Results inconclusive",
      replicationNote: "Only one fold showed improvement"
    });

    expect(decision.verdict).toBe("needs_replication");
    expect(decision.replication_note).toContain("one fold");
  });

  it("builds a needs_design_revision decision", () => {
    const decision = buildAttemptDecision({
      runId: "test-run-1",
      attempt: 1,
      verdict: "needs_design_revision",
      rationale: "Scope gaps detected",
      designRevisionNote: "Experiment scope too narrow to test hypothesis"
    });

    expect(decision.verdict).toBe("needs_design_revision");
    expect(decision.design_revision_note).toContain("scope");
  });

  it("round-trips through write and load", async () => {
    const run = makeMinimalRun("test-run-1");
    const dec1 = buildAttemptDecision({
      runId: "test-run-1",
      attempt: 1,
      verdict: "keep",
      rationale: "Good result"
    });
    const dec2 = buildAttemptDecision({
      runId: "test-run-1",
      attempt: 2,
      verdict: "discard",
      rationale: "Bad result",
      discardReason: "Metric degraded"
    });

    await writeAttemptDecision(run, dec1);
    await writeAttemptDecision(run, dec2);

    const loaded = await loadAttemptDecisions("test-run-1");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].verdict).toBe("keep");
    expect(loaded[1].verdict).toBe("discard");
  });

  it("returns empty when file does not exist", async () => {
    const loaded = await loadAttemptDecisions("nonexistent-run");
    expect(loaded).toEqual([]);
  });
});
