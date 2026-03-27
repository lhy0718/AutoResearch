import { describe, expect, it } from "vitest";

import { buildNetworkDependencyReadinessRisks, formatReadinessRiskSection } from "../src/core/readinessRisks.js";

describe("buildNetworkDependencyReadinessRisks", () => {
  it("returns no risks for offline runs", () => {
    expect(
      buildNetworkDependencyReadinessRisks({
        source: "review",
        allowNetwork: false
      })
    ).toEqual([]);
  });

  it("creates a warning for declared network-assisted runs", () => {
    const risks = buildNetworkDependencyReadinessRisks({
      source: "paper",
      allowNetwork: true,
      networkPolicy: "declared",
      networkPurpose: "logging",
      executionApprovalMode: "risk_ack"
    });

    expect(risks).toEqual([
      expect.objectContaining({
        risk_code: "paper_network_dependency_declared_logging",
        severity: "warning",
        category: "network_dependency",
        status: "unverified"
      })
    ]);
  });

  it("blocks undeclared network-enabled runs", () => {
    const risks = buildNetworkDependencyReadinessRisks({
      source: "review",
      allowNetwork: true,
      executionApprovalMode: "manual"
    });

    expect(risks).toEqual([
      expect.objectContaining({
        risk_code: "review_network_dependency_undeclared",
        severity: "blocked",
        category: "network_dependency",
        status: "blocked"
      })
    ]);
  });

  it("blocks full_auto when network access is enabled", () => {
    const risks = buildNetworkDependencyReadinessRisks({
      source: "paper",
      allowNetwork: true,
      networkPolicy: "required",
      networkPurpose: "remote_inference",
      executionApprovalMode: "full_auto"
    });

    expect(risks).toEqual([
      expect.objectContaining({
        risk_code: "paper_network_dependency_full_auto_conflict",
        severity: "blocked",
        category: "network_dependency",
        status: "blocked"
      })
    ]);
  });
});

describe("formatReadinessRiskSection", () => {
  it("labels network dependency risks", () => {
    expect(formatReadinessRiskSection("network_dependency")).toBe("Network dependency");
  });
});
