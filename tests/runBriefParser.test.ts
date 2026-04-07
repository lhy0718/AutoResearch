import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractRunBrief,
  looksLikeRunBriefRequest,
  summarizeRunBrief
} from "../src/core/runs/runBriefParser.js";

describe("runBriefParser", () => {
  const originalRunBriefTimeout = process.env.AUTOLABOS_RUN_BRIEF_TIMEOUT_MS;

  afterEach(() => {
    if (originalRunBriefTimeout === undefined) {
      delete process.env.AUTOLABOS_RUN_BRIEF_TIMEOUT_MS;
    } else {
      process.env.AUTOLABOS_RUN_BRIEF_TIMEOUT_MS = originalRunBriefTimeout;
    }
  });

  it("detects natural-language run brief requests", () => {
    expect(looksLikeRunBriefRequest("새 연구를 시작해줘\n주제: 멀티에이전트 코드 리뷰")).toBe(true);
    expect(looksLikeRunBriefRequest("Start a new research run on agentic experiment planning")).toBe(true);
    expect(looksLikeRunBriefRequest("How many papers did we collect?")).toBe(false);
  });

  it("extracts structured fields heuristically from a labeled brief", async () => {
    const extracted = await extractRunBrief({
      brief: [
        "새 연구를 시작해줘",
        "주제: 멀티에이전트 실험 설계 자동화",
        "목표: pass@1 improvement over baseline",
        "제약: 최근 3년 논문, 오픈소스 코드만, 8시간 이내",
        "계획: SWE-bench-lite 기반으로 baseline과 ablation을 비교"
      ].join("\n"),
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      }
    });

    expect(extracted).toMatchObject({
      topic: "멀티에이전트 실험 설계 자동화",
      objectiveMetric: "pass@1 improvement over baseline",
      constraints: ["최근 3년 논문", "오픈소스 코드만", "8시간 이내"],
      planSummary: "SWE-bench-lite 기반으로 baseline과 ablation을 비교",
      source: "heuristic_fallback"
    });
    expect(extracted.assumptions).toEqual([]);
    expect(summarizeRunBrief(extracted)).toEqual(
      expect.arrayContaining([
        "Topic: 멀티에이전트 실험 설계 자동화",
        "Objective: pass@1 improvement over baseline",
        "Plan hint: SWE-bench-lite 기반으로 baseline과 ablation을 비교"
      ])
    );
  });

  it("preserves markdown bullet constraints in heuristic fallback", async () => {
    const extracted = await extractRunBrief({
      brief: [
        "# Research Brief",
        "",
        "## Topic",
        "",
        "Classical machine learning baselines for tabular classification.",
        "",
        "## Constraints",
        "",
        "- Prefer CPU-only execution and lightweight Python dependencies.",
        "- Avoid large model downloads, GPU-specific methods, and heavy preprocessing pipelines.",
        "- Use a fixed train/validation/test protocol and report macro-F1, runtime, and memory consistently."
      ].join("\n"),
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      }
    });

    expect(extracted.source).toBe("heuristic_fallback");
    expect(extracted.constraints).toEqual([
      "Prefer CPU-only execution and lightweight Python dependencies.",
      "Avoid large model downloads, GPU-specific methods, and heavy preprocessing pipelines.",
      "Use a fixed train/validation/test protocol and report macro-F1, runtime, and memory consistently."
    ]);
  });

  it("prefers the LLM extraction when valid JSON is returned", async () => {
    const llm = {
      runForText: vi.fn(async () =>
        [
          "```json",
          JSON.stringify({
            topic: "LLM-designed evaluation pipeline",
            objective_metric: "robust accuracy >= 0.8",
            constraints: ["latest papers", "single GPU"],
            plan_summary: "Compare baseline, ablation, and confirmatory runs.",
            assumptions: ["Assumed the benchmark is public."]
          }),
          "```"
        ].join("\n")
      )
    };

    const extracted = await extractRunBrief({
      brief: "Start a new research run for evaluation planning.",
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      },
      llm
    });

    expect(llm.runForText).toHaveBeenCalledOnce();
    expect(extracted).toMatchObject({
      topic: "LLM-designed evaluation pipeline",
      objectiveMetric: "robust accuracy >= 0.8",
      constraints: ["latest papers", "single GPU"],
      planSummary: "Compare baseline, ablation, and confirmatory runs.",
      assumptions: ["Assumed the benchmark is public."],
      source: "llm"
    });
  });

  it("keeps an explicit topic from the brief even when the llm narrows it", async () => {
    const llm = {
      runForText: vi.fn(async () =>
        JSON.stringify({
          topic: "Laptop-safe benchmarking of lightweight tabular classifiers versus logistic regression on small public datasets",
          objective_metric: "robust macro-F1",
          constraints: ["single GPU"],
          plan_summary: "Compare a few classical models.",
          assumptions: []
        })
      )
    };

    const extracted = await extractRunBrief({
      brief: [
        "# Research Brief",
        "",
        "## Topic",
        "",
        "Classical machine learning baselines for tabular classification.",
        "",
        "## Constraints",
        "",
        "- Prefer CPU-only execution and lightweight Python dependencies.",
        "- Avoid large model downloads, GPU-specific methods, and heavy preprocessing pipelines."
      ].join("\n"),
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      },
      llm
    });

    expect(extracted.source).toBe("llm");
    expect(extracted.topic).toBe("Classical machine learning baselines for tabular classification.");
    expect(extracted.constraints).toEqual([
      "Prefer CPU-only execution and lightweight Python dependencies.",
      "Avoid large model downloads, GPU-specific methods, and heavy preprocessing pipelines."
    ]);
    expect(extracted.planSummary).toBe("Compare a few classical models.");
  });

  it("keeps the broader brief topic when the llm injects constraint qualifiers into an unlabeled brief", async () => {
    const llm = {
      runForText: vi.fn(async () =>
        JSON.stringify({
          topic: "Resource-aware baselines for tabular classification on small public datasets",
          objective_metric: "macro-F1 over logistic regression",
          constraints: ["CPU-only execution"],
          plan_summary: "Compare a few classical models.",
          assumptions: []
        })
      )
    };

    const extracted = await extractRunBrief({
      brief: [
        "Start a new research run on classical machine learning baselines for tabular classification.",
        "Objective: improve macro-F1 over a logistic regression baseline while preserving reproducible local runtime and memory efficiency.",
        "Constraints: CPU-only execution, lightweight Python dependencies."
      ].join("\n"),
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      },
      llm
    });

    expect(extracted.source).toBe("llm");
    expect(extracted.topic).toBe("classical machine learning baselines for tabular classification.");
    expect(extracted.assumptions).toContain(
      "Preserved broader topic wording from the brief for literature collection stability."
    );
  });

  it("recovers inline bullet-like constraints without fragmenting comma-rich items", async () => {
    const extracted = await extractRunBrief({
      brief: [
        "# Research Brief",
        "",
        "## Topic",
        "",
        "Classical machine learning baselines for tabular classification.",
        "",
        "## Constraints",
        "",
        "Prefer CPU-only execution and lightweight Python dependencies. - Avoid large model downloads, GPU-specific methods, and heavy preprocessing pipelines. - Use a fixed train/validation/test protocol and report macro-F1, runtime, and memory consistently."
      ].join("\n"),
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      }
    });

    expect(extracted.constraints).toEqual([
      "Prefer CPU-only execution and lightweight Python dependencies.",
      "Avoid large model downloads, GPU-specific methods, and heavy preprocessing pipelines.",
      "Use a fixed train/validation/test protocol and report macro-F1, runtime, and memory consistently."
    ]);
  });

  it("falls back heuristically when the run-brief llm hangs", async () => {
    process.env.AUTOLABOS_RUN_BRIEF_TIMEOUT_MS = "5";

    const llm = {
      runForText: vi.fn(async () => await new Promise<string>(() => {}))
    };

    const extracted = await extractRunBrief({
      brief: [
        "# Research Brief",
        "",
        "## Topic",
        "",
        "Compact instruction tuning recipes for open models.",
        "",
        "## Objective Metric",
        "",
        "Average 0-shot accuracy on ARC-Challenge and HellaSwag",
        "",
        "## Constraints",
        "",
        "- Use a bounded real experiment.",
        "- Keep seed 42 fixed."
      ].join("\n"),
      defaults: {
        topic: "default topic",
        constraints: ["default constraint"],
        objectiveMetric: "default metric"
      },
      llm
    });

    expect(extracted.source).toBe("heuristic_fallback");
    expect(extracted.topic).toBe("Compact instruction tuning recipes for open models.");
    expect(extracted.objectiveMetric).toBe("Average 0-shot accuracy on ARC-Challenge and HellaSwag");
    expect(extracted.constraints).toEqual([
      "Use a bounded real experiment.",
      "Keep seed 42 fixed."
    ]);
  });
});
