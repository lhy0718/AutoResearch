import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  appendExplorationFailure,
  isEquivalentFailure,
  loadExplorationFailureEntries,
  shouldBlockSubtree
} from "../src/core/exploration/failureMemoryIntegration.js";
import type { FailureMemoryEntry } from "../src/core/exploration/types.js";

describe("failureMemoryIntegration", () => {
  it("ignores legacy failure records without exploration fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-failure-memory-"));
    const memoryPath = path.join(root, ".autolabos", "runs", "run-1", "failure_memory.jsonl");
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await writeFile(
      memoryPath,
      `${JSON.stringify({
        failure_id: "fail_1",
        run_id: "run-1",
        node_id: "run_experiments",
        attempt: 1,
        timestamp: new Date().toISOString(),
        failure_class: "structural",
        error_fingerprint: "legacy-failure",
        error_message: "legacy",
        do_not_retry: false
      })}\n`,
      "utf8"
    );

    const entries = loadExplorationFailureEntries(memoryPath);
    expect(entries).toEqual([]);
  });

  it("appends exploration failure entries without breaking the JSONL structure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-failure-memory-append-"));
    const memoryPath = path.join(root, ".autolabos", "runs", "run-2", "failure_memory.jsonl");
    const entry: FailureMemoryEntry = {
      failure_fingerprint: "fp-1",
      failure_class: "design",
      retry_policy: "block",
      equivalent_to: null,
      affects_stage: ["main_agenda"],
      first_seen_at: new Date().toISOString(),
      occurrence_count: 1
    };

    appendExplorationFailure(memoryPath, entry);

    const raw = await readFile(memoryPath, "utf8");
    expect(raw).toContain("\"exploration_failure_class\":\"design\"");
    expect(raw).toContain("\"error_fingerprint\":\"fp-1\"");
  });

  it("blocks subtrees when an explicit block entry exists", () => {
    const entries: FailureMemoryEntry[] = [
      {
        failure_fingerprint: "fp-block",
        failure_class: "evaluation",
        retry_policy: "block",
        equivalent_to: null,
        affects_stage: ["main_agenda"],
        first_seen_at: new Date().toISOString(),
        occurrence_count: 1
      }
    ];

    expect(shouldBlockSubtree("fp-block", entries)).toBe(true);
  });

  it("treats equivalent failures as blocked when the canonical failure is blocked", () => {
    const entries: FailureMemoryEntry[] = [
      {
        failure_fingerprint: "fp-root",
        failure_class: "evaluation",
        retry_policy: "block",
        equivalent_to: null,
        affects_stage: ["main_agenda"],
        first_seen_at: new Date().toISOString(),
        occurrence_count: 1
      },
      {
        failure_fingerprint: "fp-child",
        failure_class: "evaluation",
        retry_policy: "allow_with_change",
        equivalent_to: "fp-root",
        affects_stage: ["main_agenda"],
        first_seen_at: new Date().toISOString(),
        occurrence_count: 1
      }
    ];

    expect(isEquivalentFailure("fp-root", "fp-child", entries)).toBe(true);
    expect(shouldBlockSubtree("fp-child", entries)).toBe(true);
  });
});
