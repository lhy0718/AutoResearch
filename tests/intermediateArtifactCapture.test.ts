import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  buildIntermediateArtifactCaptureManifest,
  validateIntermediateArtifactCaptureManifest
} from "../src/core/artifacts/intermediateArtifactCapture.js";

describe("intermediate artifact capture manifest", () => {
  it("records run-scoped artifacts without leaking absolute paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-intermediate-capture-"));
    const runId = "run-capture";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "run_experiments_verify_report.json"), JSON.stringify({ status: "pass" }), "utf8");
    await writeFile(path.join(runDir, "metrics.json"), JSON.stringify({ accuracy: 0.91 }), "utf8");

    const manifest = await buildIntermediateArtifactCaptureManifest({
      runId,
      runDir,
      node: "run_experiments",
      phase: "metrics",
      status: "pass",
      generatedAt: "2026-05-05T00:00:00.000Z",
      artifacts: [
        {
          artifactId: "run_experiments_verify_report",
          filePath: path.join(runDir, "run_experiments_verify_report.json"),
          role: "verification",
          required: true,
          parseAs: "json"
        },
        {
          artifactId: "metrics",
          filePath: `.autolabos/runs/${runId}/metrics.json`,
          role: "metric",
          required: true,
          parseAs: "json"
        }
      ]
    });

    expect(manifest.summary).toMatchObject({
      total: 2,
      present: 2,
      missing_required: 0,
      malformed: 0
    });
    expect(manifest.entries.map((entry) => entry.relative_path)).toEqual([
      "run_experiments_verify_report.json",
      "metrics.json"
    ]);
    expect(JSON.stringify(manifest)).not.toContain(root);
    expect(validateIntermediateArtifactCaptureManifest(manifest)).toEqual([]);
  });

  it("flags malformed required JSON artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-intermediate-malformed-"));
    const runId = "run-malformed";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "metrics.json"), "{bad json", "utf8");

    const manifest = await buildIntermediateArtifactCaptureManifest({
      runId,
      runDir,
      node: "run_experiments",
      phase: "metrics",
      status: "fail",
      artifacts: [
        {
          artifactId: "metrics",
          filePath: path.join(runDir, "metrics.json"),
          role: "metric",
          required: true,
          parseAs: "json"
        }
      ]
    });

    expect(manifest.summary.malformed).toBe(1);
    expect(manifest.entries[0]).toMatchObject({
      artifact_id: "metrics",
      status: "present",
      parse_status: "malformed"
    });
    expect(validateIntermediateArtifactCaptureManifest(manifest)).toEqual([
      {
        code: "intermediate_capture_malformed",
        artifact_id: "metrics",
        message: "Intermediate artifact is malformed: metrics"
      }
    ]);
  });

  it("redacts external artifact paths instead of recording machine-local locations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-intermediate-external-"));
    const runId = "run-external";
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(runDir, { recursive: true });

    const manifest = await buildIntermediateArtifactCaptureManifest({
      runId,
      runDir,
      node: "run_experiments",
      phase: "command",
      status: "fail",
      artifacts: [
        {
          artifactId: "external_log",
          filePath: path.join(root, "outside-run.log"),
          role: "log",
          required: false,
          parseAs: "text"
        }
      ]
    });

    expect(manifest.entries[0]).toMatchObject({
      relative_path: "<external-artifact>",
      path_kind: "external",
      status: "external_not_checked",
      parse_status: "not_checked"
    });
    expect(JSON.stringify(manifest)).not.toContain(root);
  });
});
