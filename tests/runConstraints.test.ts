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

  it("returns no automatic topic-derived candidates when llm queries are absent", () => {
    const candidates = buildLiteratureQueryCandidates({
      runTopic: "Resource-aware baselines for tabular classification on small public datasets"
    });

    expect(candidates).toEqual([]);
  });

  it("prefers an explicit requested query and does not append llm-generated fallbacks", () => {
    const candidates = buildLiteratureQueryCandidates({
      requestedQuery: '"tabular classification" +baseline',
      runTopic: "Classical machine learning baselines for tabular classification",
      llmGeneratedQueries: ['"tabular classification" +(baseline | benchmark)']
    });

    expect(candidates).toEqual([{ query: '"tabular classification" +baseline', reason: "requested_query" }]);
  });

  it("sanitizes llm-generated queries to Semantic Scholar-friendly bulk syntax and prioritizes them", () => {
    const candidates = buildLiteratureQueryCandidates({
      runTopic: "Budget-aware test-time reasoning for small language models",
      llmGeneratedQueries: [
        "adaptive test-time reasoning",
        'title:"test-time reasoning" AND ("small language models" OR "compact language models") NOT survey'
      ]
    });

    expect(candidates[0]).toEqual({
      query: "adaptive test-time reasoning",
      reason: "llm_generated"
    });
    expect(candidates).toContainEqual({
      query: '"test-time reasoning" +("small language models" | "compact language models") -survey',
      reason: "llm_generated"
    });
    expect(candidates).not.toContainEqual({
      query: 'title:"test-time reasoning" AND ("small language models" OR "compact language models") NOT survey',
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
