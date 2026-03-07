import { describe, expect, it } from "vitest";

import {
  buildCompositeNaturalCommandPlan,
  extractTitleChangeIntent,
  isMissingPdfCountIntent,
  isPaperCountIntent,
  isTopCitationIntent
} from "../src/tui/TerminalApp.js";

describe("natural fast intent detection", () => {
  it("detects missing pdf count intent", () => {
    expect(isMissingPdfCountIntent("논문들 중 pdf 경로가 없는 논문들이 몇개야?")).toBe(true);
    expect(isMissingPdfCountIntent("How many papers are missing PDF paths?")).toBe(true);
  });

  it("does not misclassify attribute-specific query as plain paper count", () => {
    expect(isPaperCountIntent("논문들 중 pdf 경로가 없는 논문들이 몇개야?")).toBe(false);
    expect(isPaperCountIntent("논문 몇 개 모았어?")).toBe(true);
  });

  it("detects top citation intent", () => {
    expect(isTopCitationIntent("논문들 중 citation이 가장 높은 논문이 뭐야?")).toBe(true);
    expect(isTopCitationIntent("What is the highest-citation paper?")).toBe(true);
  });

  it("extracts title change intent", () => {
    expect(extractTitleChangeIntent("멀티에이전트 협업으로 title을 바꿔줘")).toEqual({
      title: "멀티에이전트 협업"
    });
    expect(extractTitleChangeIntent("change the run title to Multi-agent collaboration")).toEqual({
      title: "Multi-agent collaboration"
    });
  });

  it("builds a multi-step plan for clear + collect prompts", () => {
    const plan = buildCompositeNaturalCommandPlan(
      "지금 논문을 모두 삭제하고 최근 5년의 논문을 관련도순으로 pdf 있는 것들만 가져와줘",
      { runId: "run-123" }
    );

    expect(plan?.commands).toEqual([
      "/agent clear collect_papers run-123",
      "/agent collect --last-years 5 --sort relevance --open-access --run run-123"
    ]);
  });

  it("builds a multi-step plan for title + collect prompts", () => {
    const plan = buildCompositeNaturalCommandPlan('멀티에이전트 협업으로 title을 바꾸고 "agent planning" 논문 20개 수집해줘', {
      runId: "run-123"
    });

    expect(plan?.commands).toEqual([
      '/title "멀티에이전트 협업" --run run-123',
      '/agent collect "agent planning" --sort relevance --limit 20 --run run-123'
    ]);
  });

  it("builds a multi-step plan for jump + collect prompts", () => {
    const plan = buildCompositeNaturalCommandPlan("수집 단계로 이동해서 최근 5년 논문 100개 수집해줘", {
      runId: "run-123"
    });

    expect(plan?.commands).toEqual([
      "/agent jump collect_papers run-123",
      "/agent collect --last-years 5 --sort relevance --limit 100 --run run-123"
    ]);
  });

  it("builds a multi-step plan for clear + title + collect prompts", () => {
    const plan = buildCompositeNaturalCommandPlan(
      '논문을 모두 삭제하고 멀티에이전트 협업으로 title을 바꾸고 "agent planning" 논문 20개 수집해줘',
      { runId: "run-123" }
    );

    expect(plan?.commands).toEqual([
      "/agent clear collect_papers run-123",
      '/title "멀티에이전트 협업" --run run-123',
      '/agent collect "agent planning" --sort relevance --limit 20 --run run-123'
    ]);
  });

  it("uses the active run title when a composite collect prompt references title", () => {
    const plan = buildCompositeNaturalCommandPlan(
      "논문을 모두 삭제하고 title과 관련한 논문들을 최근 5년 30개, pdf 링크 있는 것으로 모아줘",
      {
        runId: "run-123",
        run: {
          title: "Multi-Agent Collaboration",
          topic: "AI agent automation"
        }
      }
    );

    expect(plan?.commands).toEqual([
      "/agent clear collect_papers run-123",
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 30 --open-access --run run-123'
    ]);
  });
});
