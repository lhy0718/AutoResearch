import { RunRecord } from "../../types.js";
import { writeRunArtifact, safeRead } from "../nodes/helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutonomousCycleSnapshot {
  mode: "overnight" | "autonomous";
  cycle: number;
  iteration: number;
  currentNode: string;
  status: string;
  noveltySignals: Array<{ cycle: number; type: string; detail: string }>;
  paperStatus: string;
  stopRisk: string;
  message: string;
  bestBranch?: string;
  latestResults?: string;
  latestUpgradeAction?: string;
  openIssues?: string[];
  hypothesis?: string;
  experimentTarget?: string;
  benchmark?: string;
  paperCandidateStatus?: string;
  loopDirection?: "exploring" | "consolidating";
  evidenceGaps?: string[];
  nextUpgradeAction?: string;
  whyContinued?: string;
  /** Runtime policy description: "24h" or "unbounded" */
  runtimePolicy?: string;
  /** Whether write_paper is currently blocked by the evidence gate */
  writePaperGateBlocked?: boolean;
  /** Specific conditions blocking write_paper entry */
  writePaperGateBlockers?: string[];
}

// ---------------------------------------------------------------------------
// BestBranchInfo — tracks the strongest research branch for paper pressure
// ---------------------------------------------------------------------------

export interface BestBranchInfo {
  branchId: string;
  hypothesis: string;
  hasBaseline: boolean;
  hasComparator: boolean;
  hasQuantitativeResults: boolean;
  hasResultTable: boolean;
  manuscriptType: string;
  lastUpgradeCycle: number;
  evidenceGaps: string[];
  upgradeActions: string[];
}

// ---------------------------------------------------------------------------
// AutonomousProgressReporter
//
// Writes and appends to RUN_STATUS.md inside a run's artifact directory.
// Designed for human-readable progress visibility during long autonomous runs.
// ---------------------------------------------------------------------------

export class AutonomousProgressReporter {

  async writeSnapshot(run: RunRecord, snap: AutonomousCycleSnapshot): Promise<void> {
    const existing = await safeRead(`.autolabos/runs/${run.id}/RUN_STATUS.md`);

    const header = existing.trim()
      ? ""
      : `# Autonomous Run Status — ${run.id.slice(0, 8)}\n\n` +
        `**Topic:** ${run.topic}\n` +
        `**Mode:** ${snap.mode}\n` +
        `**Runtime policy:** ${snap.runtimePolicy || (snap.mode === "autonomous" ? "unbounded" : "24h")}\n` +
        `**Started:** ${new Date().toISOString()}\n\n` +
        `---\n\n`;

    const section = this.formatSection(snap);

    const content = header + existing.trim() + (existing.trim() ? "\n\n" : "") + section + "\n";
    await writeRunArtifact(run as RunRecord, "RUN_STATUS.md", content);
  }

  async writeFinalSummary(run: RunRecord, snap: AutonomousCycleSnapshot, stopReason: string): Promise<void> {
    const existing = await safeRead(`.autolabos/runs/${run.id}/RUN_STATUS.md`);

    const summary = this.formatFinalSummary(snap, stopReason);
    const content = existing.trim() + "\n\n" + summary + "\n";
    await writeRunArtifact(run as RunRecord, "RUN_STATUS.md", content);
  }

  private formatSection(snap: AutonomousCycleSnapshot): string {
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const lines: string[] = [];

    lines.push(`## Cycle ${snap.cycle} / Iteration ${snap.iteration} — ${ts}`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Mode | ${snap.mode} |`);
    if (snap.runtimePolicy) {
      lines.push(`| Runtime Policy | ${snap.runtimePolicy} |`);
    }
    lines.push(`| Current Node | ${snap.currentNode} |`);
    lines.push(`| Status | ${snap.status} |`);
    lines.push(`| Paper Status | ${snap.paperStatus} |`);
    lines.push(`| Stop Risk | ${snap.stopRisk} |`);

    if (snap.bestBranch) {
      lines.push(`| Best Branch | ${snap.bestBranch} |`);
    }
    if (snap.hypothesis) {
      lines.push(`| Current Hypothesis | ${snap.hypothesis} |`);
    }
    if (snap.experimentTarget) {
      lines.push(`| Experiment Target | ${snap.experimentTarget} |`);
    }
    if (snap.benchmark) {
      lines.push(`| Benchmark/Task | ${snap.benchmark} |`);
    }
    if (snap.latestResults) {
      lines.push(`| Latest Results | ${snap.latestResults} |`);
    }
    if (snap.paperCandidateStatus) {
      lines.push(`| Paper Candidate | ${snap.paperCandidateStatus} |`);
    }
    if (snap.loopDirection) {
      lines.push(`| Loop Direction | ${snap.loopDirection} |`);
    }
    if (snap.latestUpgradeAction) {
      lines.push(`| Paper Upgrade Action | ${snap.latestUpgradeAction} |`);
    }
    if (snap.nextUpgradeAction) {
      lines.push(`| Next Upgrade Action | ${snap.nextUpgradeAction} |`);
    }

    // Write-paper gate status
    if (snap.writePaperGateBlocked != null) {
      lines.push(`| Write-Paper Gate | ${snap.writePaperGateBlocked ? "⛔ BLOCKED" : "✅ PASSED"} |`);
    }

    lines.push("");
    lines.push(`**Message:** ${snap.message}`);

    if (snap.whyContinued) {
      lines.push("");
      lines.push(`**Why continued:** ${snap.whyContinued}`);
    }

    // Write-paper gate blockers
    if (snap.writePaperGateBlocked && snap.writePaperGateBlockers && snap.writePaperGateBlockers.length > 0) {
      lines.push("");
      lines.push("**Write-paper gate blockers (conditions not met for drafting):**");
      for (const blocker of snap.writePaperGateBlockers) {
        lines.push(`- ${blocker}`);
      }
    }

    if (snap.noveltySignals.length > 0) {
      lines.push("");
      lines.push("**Recent Novelty Signals:**");
      for (const sig of snap.noveltySignals.slice(-5)) {
        lines.push(`- [cycle ${sig.cycle}] ${sig.type}: ${sig.detail}`);
      }
    }

    if (snap.evidenceGaps && snap.evidenceGaps.length > 0) {
      lines.push("");
      lines.push("**Evidence Gaps (best branch):**");
      for (const gap of snap.evidenceGaps) {
        lines.push(`- ${gap}`);
      }
    }

    if (snap.openIssues && snap.openIssues.length > 0) {
      lines.push("");
      lines.push("**Open Issues:**");
      for (const issue of snap.openIssues) {
        lines.push(`- ${issue}`);
      }
    }

    lines.push("");
    lines.push("---");

    return lines.join("\n");
  }

  private formatFinalSummary(snap: AutonomousCycleSnapshot, stopReason: string): string {
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const lines: string[] = [];

    lines.push(`# Final Summary — ${ts}`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Mode | ${snap.mode} |`);
    if (snap.runtimePolicy) {
      lines.push(`| Runtime Policy | ${snap.runtimePolicy} |`);
    }
    lines.push(`| Total Cycles | ${snap.cycle} |`);
    lines.push(`| Total Iterations | ${snap.iteration} |`);
    lines.push(`| Final Node | ${snap.currentNode} |`);
    lines.push(`| Final Status | ${snap.status} |`);
    lines.push(`| Stop Reason | ${stopReason} |`);
    lines.push(`| Paper Status | ${snap.paperStatus} |`);

    if (snap.bestBranch) {
      lines.push(`| Best Branch | ${snap.bestBranch} |`);
    }
    if (snap.paperCandidateStatus) {
      lines.push(`| Paper Candidate | ${snap.paperCandidateStatus} |`);
    }
    if (snap.writePaperGateBlocked != null) {
      lines.push(`| Write-Paper Gate | ${snap.writePaperGateBlocked ? "⛔ BLOCKED" : "✅ PASSED"} |`);
    }

    lines.push("");
    lines.push(`**Why stopped:** ${snap.message}`);

    if (snap.noveltySignals.length > 0) {
      lines.push("");
      lines.push(`**Total novelty signals:** ${snap.noveltySignals.length}`);
      lines.push("");
      lines.push("**Last 5 novelty signals:**");
      for (const sig of snap.noveltySignals.slice(-5)) {
        lines.push(`- [cycle ${sig.cycle}] ${sig.type}: ${sig.detail}`);
      }
    }

    if (snap.evidenceGaps && snap.evidenceGaps.length > 0) {
      lines.push("");
      lines.push("**Remaining evidence gaps:**");
      for (const gap of snap.evidenceGaps) {
        lines.push(`- ${gap}`);
      }
    }

    if (snap.openIssues && snap.openIssues.length > 0) {
      lines.push("");
      lines.push("**Open issues:**");
      for (const issue of snap.openIssues) {
        lines.push(`- ${issue}`);
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("*This is the final status snapshot. The run has stopped.*");

    return lines.join("\n");
  }
}
