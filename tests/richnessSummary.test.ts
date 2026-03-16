import { describe, it, expect } from "vitest";

describe("buildRichnessSummary", () => {
  it("classifies adequate coverage (>=5 full-text, >=50%)", async () => {
    const mod = await import("../src/core/nodes/analyzePapers.js");
    const result = mod.buildRichnessSummary({
      fullTextCount: 8,
      abstractFallbackCount: 4
    });

    expect(result.readiness).toBe("adequate");
    expect(result.total_papers).toBe(12);
    expect(result.full_text_count).toBe(8);
    expect(result.abstract_fallback_count).toBe(4);
    expect(result.fulltext_coverage_pct).toBeCloseTo(0.667, 2);
  });

  it("classifies marginal coverage (>=3 full-text, <50%)", async () => {
    const mod = await import("../src/core/nodes/analyzePapers.js");
    const result = mod.buildRichnessSummary({
      fullTextCount: 3,
      abstractFallbackCount: 10
    });

    expect(result.readiness).toBe("marginal");
    expect(result.total_papers).toBe(13);
  });

  it("classifies insufficient coverage (<3 full-text)", async () => {
    const mod = await import("../src/core/nodes/analyzePapers.js");
    const result = mod.buildRichnessSummary({
      fullTextCount: 2,
      abstractFallbackCount: 5
    });

    expect(result.readiness).toBe("insufficient");
  });

  it("handles zero papers", async () => {
    const mod = await import("../src/core/nodes/analyzePapers.js");
    const result = mod.buildRichnessSummary({
      fullTextCount: 0,
      abstractFallbackCount: 0
    });

    expect(result.readiness).toBe("insufficient");
    expect(result.total_papers).toBe(0);
    expect(result.fulltext_coverage_pct).toBe(0);
  });

  it("handles 5 full-text but <50% (needs both thresholds)", async () => {
    const mod = await import("../src/core/nodes/analyzePapers.js");
    const result = mod.buildRichnessSummary({
      fullTextCount: 5,
      abstractFallbackCount: 15
    });

    // 5 full-text but 25% coverage: marginal (has 5 but not 50%)
    expect(result.readiness).toBe("marginal");
  });
});
