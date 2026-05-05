import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { generateAuditBlockerDemo } from "../src/core/audit/auditDemoBundle.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("audit blocker demo bundle", () => {
  it("generates a repo-safe AGB false-paper-ready blocking demo", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "autolabos-audit-demo-"));
    tempDirs.push(workspace);

    const manifest = await generateAuditBlockerDemo({
      cwd: workspace,
      outDir: "outputs/audit-demo"
    });

    expect(manifest.output_dir).toBe("outputs/audit-demo");
    expect(manifest.all_expected_blocked).toBe(true);
    expect(manifest.entries.map((entry) => entry.seed_id)).toEqual(["AGB-001", "AGB-003", "AGB-010"]);
    expect(manifest.entries.every((entry) => entry.actual_verdict === "blocked")).toBe(true);
    expect(manifest.entries.every((entry) => entry.false_paper_ready_blocked)).toBe(true);
    expect(manifest.entries[0].actual_blockers).toContain("baseline_or_comparator_missing");
    expect(manifest.entries[2].actual_blockers).toContain("fallback_only_evidence");

    const manifestRaw = await readFile(path.join(workspace, "outputs", "audit-demo", "demo-manifest.json"), "utf8");
    expect(manifestRaw).not.toContain(workspace);
    expect(manifestRaw).toContain("outputs/audit-demo/AGB-001/paper-readiness-audit.md");

    const readme = await readFile(path.join(workspace, "outputs", "audit-demo", "README.md"), "utf8");
    expect(readme).toContain("AGB-001 blocks missing-baseline improvement claims.");
    expect(readme).toContain("AGB-010 blocks quantitative research claims when only fallback evidence exists.");
  });
});
