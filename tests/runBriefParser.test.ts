import { describe, expect, it, vi } from "vitest";

import {
  extractRunBrief,
  looksLikeRunBriefRequest,
  summarizeRunBrief
} from "../src/core/runs/runBriefParser.js";

describe("runBriefParser", () => {
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
});
