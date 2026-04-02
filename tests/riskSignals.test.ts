import { describe, expect, it } from "vitest";

import {
  detectNaNInf,
  detectStatisticalAnomaly,
  detectUnverifiedCitations
} from "../src/core/analysis/riskSignals.js";

describe("riskSignals", () => {
  it("detects NaN and Inf values as critical", () => {
    const signal = detectNaNInf({
      accuracy: 0.91,
      diagnostics: {
        loss: "NaN",
        throughput: "Inf"
      }
    });

    expect(signal).toMatchObject({
      type: "nan_inf",
      severity: "critical"
    });
    expect(signal?.detail).toContain("diagnostics.loss");
  });

  it("detects statistical anomalies as critical", () => {
    const signal = detectStatisticalAnomaly({
      significance: {
        p_value: 1.4
      },
      ci: {
        lower: 0.9,
        upper: 0.7
      }
    });

    expect(signal).toMatchObject({
      type: "statistical_anomaly",
      severity: "critical"
    });
    expect(signal?.detail).toContain("outside [0,1]");
  });

  it("detects explicitly unverified citations as critical", () => {
    const signal = detectUnverifiedCitations([
      {
        evidence_id: "ev_1",
        paper_id: "paper_1",
        verification_status: "unverified"
      }
    ]);

    expect(signal).toMatchObject({
      type: "unverified_citations",
      severity: "critical"
    });
    expect(signal?.detail).toContain("ev_1");
  });
});
