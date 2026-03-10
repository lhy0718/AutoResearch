import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  supportsRealExecutionBundle,
  writeRealExecutionBundle
} from "../src/core/experiments/realExecutionBundle.js";

describe("realExecutionBundle", () => {
  it("writes a public real_execution runner bundle with the configured llm profile", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-real-bundle-"));
    try {
      const runDir = path.join(workspace, ".autolabos", "runs", "run-123");
      const publicDir = path.join(workspace, "outputs", "demo-run", "experiment");
      const metricsPath = path.join(runDir, "metrics.json");

      const result = await writeRealExecutionBundle({
        run: {
          id: "run-123",
          title: "Shared-state schema reproducibility",
          topic: "Multi-agent collaboration",
          objectiveMetric: "state-of-the-art reproducibility",
          constraints: ["recent papers", "five years"]
        },
        runDir,
        publicDir,
        metricsPath,
        experimentLlmProfile: {
          provider: "codex",
          model: "gpt-5.4",
          reasoningEffort: "xhigh",
          fastMode: false
        },
        timeoutSec: 1800,
        allowNetwork: true
      });

      expect(result.experimentMode).toBe("real_execution");
      expect(result.runCommand).toContain("run_experiment.py");
      expect(result.testCommand).toContain("py_compile");
      expect(result.publicArtifacts.some((file) => file.endsWith("README.md"))).toBe(true);

      const config = JSON.parse(readFileSync(path.join(publicDir, "experiment_config.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect(config.llm_profile).toMatchObject({
        provider: "codex",
        model: "gpt-5.4",
        reasoning_effort: "xhigh",
        fast_mode: false
      });

      const compiled = spawnSync("python3", ["-m", "py_compile", path.join(publicDir, "run_experiment.py")], {
        encoding: "utf8"
      });
      expect(compiled.status).toBe(0);
      expect(compiled.stderr).toBe("");

      const quickCheck = spawnSync(
        "python3",
        [
          path.join(publicDir, "run_experiment.py"),
          "--quick-check",
          "--metadata-dir",
          runDir,
          "--metrics-out",
          path.join(publicDir, "quick_check_metrics.json")
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            AUTOLABOS_FAKE_EXPERIMENT_RESPONSE: JSON.stringify({
              final_answer: "Ottawa",
              code: [
                "def alternating_sum(nums):",
                "    return 0",
                "",
                "def reverse_words(text):",
                "    return text"
              ].join("\n"),
              slots: {},
              verdict: "ok",
              notes: []
            })
          }
        }
      );
      expect(quickCheck.status).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("only applies to reproducibility-focused multi-agent runs", () => {
    expect(
      supportsRealExecutionBundle({
        topic: "Multi-agent collaboration",
        objectiveMetric: "state-of-the-art reproducibility",
        constraints: ["recent papers"]
      } as never)
    ).toBe(true);
    expect(
      supportsRealExecutionBundle({
        topic: "Single-agent summarization",
        objectiveMetric: "BLEU",
        constraints: ["news"]
      } as never)
    ).toBe(false);
  });

  it("supports confirmatory profile resume with cached partial results", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "autolabos-real-bundle-confirmatory-"));
    try {
      const runDir = path.join(workspace, ".autolabos", "runs", "run-456");
      const publicDir = path.join(workspace, "outputs", "demo-run", "experiment");
      const metricsPath = path.join(runDir, "metrics.json");

      await writeRealExecutionBundle({
        run: {
          id: "run-456",
          title: "Shared-state schema reproducibility",
          topic: "Multi-agent collaboration",
          objectiveMetric: "state-of-the-art reproducibility",
          constraints: ["recent papers", "five years"]
        },
        runDir,
        publicDir,
        metricsPath,
        experimentLlmProfile: {
          provider: "codex",
          model: "gpt-5.4",
          reasoningEffort: "xhigh",
          fastMode: false
        },
        timeoutSec: 1800,
        allowNetwork: true
      });

      const configPath = path.join(publicDir, "experiment_config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, any>;
      config.sampling.confirmatory = {
        repeats: 1,
        prompt_count: 1,
        tasks_per_dataset: 1
      };
      config.execution.max_workers = 2;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

      const scriptPath = path.join(publicDir, "run_experiment.py");
      const confirmatoryMetricsPath = path.join(publicDir, "confirmatory_metrics.json");
      const env = {
        ...process.env,
        AUTOLABOS_FAKE_EXPERIMENT_RESPONSE: JSON.stringify({
          final_answer: "Ottawa",
          code: [
            "def alternating_sum(nums):",
            "    return 0",
            "",
            "def reverse_words(text):",
            "    return text"
          ].join("\n"),
          slots: {},
          verdict: "ok",
          notes: []
        })
      };

      const first = spawnSync(
        "python3",
        [scriptPath, "--profile", "confirmatory", "--metrics-out", confirmatoryMetricsPath],
        {
          encoding: "utf8",
          env
        }
      );
      expect(first.status).toBe(0);

      const firstMetrics = JSON.parse(readFileSync(confirmatoryMetricsPath, "utf8")) as Record<string, any>;
      expect(firstMetrics.sampling_profile).toMatchObject({
        name: "confirmatory",
        total_trials: 6,
        cached_trials: 0,
        executed_trials: 6
      });
      expect(firstMetrics.execution).toMatchObject({
        max_workers: 1,
        resume_partial_results: true,
        write_progress: true
      });
      const progressPath = path.join(publicDir, "run_progress.json");
      expect(JSON.parse(readFileSync(progressPath, "utf8"))).toMatchObject({
        status: "completed",
        sampling_profile: "confirmatory",
        total_trials: 6
      });

      const second = spawnSync(
        "python3",
        [scriptPath, "--profile", "confirmatory", "--metrics-out", confirmatoryMetricsPath],
        {
          encoding: "utf8",
          env
        }
      );
      expect(second.status).toBe(0);

      const secondMetrics = JSON.parse(readFileSync(confirmatoryMetricsPath, "utf8")) as Record<string, any>;
      expect(secondMetrics.sampling_profile).toMatchObject({
        name: "confirmatory",
        total_trials: 6,
        cached_trials: 6,
        executed_trials: 0
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
