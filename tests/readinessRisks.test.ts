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

  it("does not invent a network risk when no network metadata is declared", () => {
    const risks = buildNetworkDependencyReadinessRisks({
      source: "review",
      allowNetwork: true,
      executionApprovalMode: "manual"
    });

    expect(risks).toEqual([]);
  });

  it("warns when a required network-assisted run uses full_auto", () => {
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
        severity: "warning",
        category: "network_dependency",
        status: "unverified"
      })
    ]);
  });
});

describe("formatReadinessRiskSection", () => {
  it("labels network dependency risks", () => {
    expect(formatReadinessRiskSection("network_dependency")).toBe("Network dependency");
  });
});
