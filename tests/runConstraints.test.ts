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
});
