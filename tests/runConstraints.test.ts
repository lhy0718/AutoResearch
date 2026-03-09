import { describe, expect, it } from "vitest";

import { normalizeConstraintProfile } from "../src/core/runConstraints.js";

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
});
