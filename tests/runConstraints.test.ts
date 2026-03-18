import { describe, expect, it } from "vitest";

import { buildLiteratureQueryCandidates, normalizeConstraintProfile } from "../src/core/runConstraints.js";

describe("normalizeConstraintProfile", () => {
  it("drops generic publication types inferred from phrases like recent papers", () => {
    const profile = normalizeConstraintProfile(
      {
        source: "llm",
        collect: {
          lastYears: 5,
          publicationTypes: ["paper", "Review", "articles"]
        }
      },
      ["recent papers", "last 5 years"]
    );

    expect(profile.collect.lastYears).toBe(5);
    expect(profile.collect.publicationTypes).toEqual(["Review"]);
  });

  it("prefers stripped run-topic candidates before the raw run topic", () => {
    const candidates = buildLiteratureQueryCandidates({
      runTopic: "Resource-aware baselines for tabular classification on small public datasets"
    });

    expect(candidates[0]).toEqual({
      query: "baselines for tabular classification",
      reason: "constraint_stripped"
    });
    expect(
      candidates.findIndex(
        (candidate) => candidate.query === "Resource-aware baselines for tabular classification on small public datasets"
      )
    ).toBeGreaterThan(0);
  });

  it("keeps domain anchors in keyword fallback instead of generic research-planning tokens", () => {
    const candidates = buildLiteratureQueryCandidates({
      runTopic:
        "Research-grade literature review and reproducible benchmarking plan for classical and lightweight modern baselines for tabular classification on public datasets"
    });

    expect(candidates).toContainEqual({
      query: "classical modern baselines tabular classification datasets",
      reason: "keyword_anchor"
    });
    expect(candidates).not.toContainEqual({
      query: "research grade literature review benchmarking plan",
      reason: "keyword_anchor"
    });
  });

  it("sanitizes llm-generated queries to Semantic Scholar-friendly free text and prioritizes them", () => {
    const candidates = buildLiteratureQueryCandidates({
      runTopic: "Budget-aware test-time reasoning for small language models",
      llmGeneratedQueries: ["adaptive test-time reasoning", 'title:"test-time reasoning" AND small language models']
    });

    expect(candidates[0]).toEqual({
      query: "adaptive test-time reasoning",
      reason: "llm_generated"
    });
    expect(candidates).not.toContainEqual({
      query: 'title:"test-time reasoning" AND small language models',
      reason: "llm_generated"
    });
  });

  it("drops invalid llm-derived collect date filters instead of treating freeform prose as a date range", () => {
    const profile = normalizeConstraintProfile(
      {
        source: "llm",
        collect: {
          dateRange: "recent papers plus core older benchmark/evaluation papers where relevant",
          year: "recent"
        }
      },
      ["Include both recent papers and core older benchmark or evaluation papers where relevant."]
    );

    expect(profile.collect.dateRange).toBeUndefined();
    expect(profile.collect.year).toBeUndefined();
  });
});
