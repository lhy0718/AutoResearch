import path from "node:path";

import { EventStream } from "../events.js";
import { RunStore } from "../runs/runStore.js";
import { GRAPH_NODE_ORDER, GraphNodeId, RunRecord, TransitionRecommendation } from "../../types.js";
import { AgentOrchestrator } from "./agentOrchestrator.js";
import { AutonomousProgressReporter, AutonomousCycleSnapshot, BestBranchInfo } from "./autonomousProgressReporter.js";
import { writeRunArtifact, safeRead } from "../nodes/helpers.js";

// ---------------------------------------------------------------------------
// Policy types
// ---------------------------------------------------------------------------

export type AutonomousRunMode = "overnight" | "autonomous";

export interface OvernightRunPolicy {
  mode: "overnight";
  maxMinutes: number;
  minTransitionConfidence: number;
  minDeepBacktrackConfidence: number;
  autoApproveNodes: GraphNodeId[];
  allowedBacktracks: GraphNodeId[];
  maxBackwardJumps: number;
  maxDeepBacktracks: number;
  stopOnRepeatedRecommendation: number;
  stopBeforeWritePaper: boolean;
}

export interface AutonomousNoveltyConfig {
  /** How many recent cycles to inspect for novelty signals */
  windowSize: number;
  /** Minimum novel signals required per window to avoid stagnation */
  minNovelSignalsPerWindow: number;
  /** Maximum consecutive stagnant windows before stopping */
  maxStagnantWindows: number;
}

export interface AutonomousPaperPressureConfig {
  /** Run paper-quality improvement every N cycles */
  checkIntervalCycles: number;
  /** Force write_paper pass if the best branch has not been upgraded in N cycles */
  forceUpgradeAfterCycles: number;
}

export interface AutonomousFuseConfig {
  /** Max total iterations before emergency stop */
  maxTotalIterations: number;
  /** Max consecutive failures before emergency stop */
  maxConsecutiveFailures: number;
  /** Max identical recommendation repeats before emergency stop */
  maxRepeatedRecommendation: number;
}

export interface AutonomousModePolicy {
  mode: "autonomous";
  maxMinutes: number;
  minTransitionConfidence: number;
  minDeepBacktrackConfidence: number;
  autoApproveNodes: GraphNodeId[];
  allowedBacktracks: GraphNodeId[];
  maxBackwardJumps: number;
  maxDeepBacktracks: number;
  stopBeforeWritePaper: boolean;
  novelty: AutonomousNoveltyConfig;
  paperPressure: AutonomousPaperPressureConfig;
  fuse: AutonomousFuseConfig;
}

export type AutonomousRunPolicy = OvernightRunPolicy | AutonomousModePolicy;

// ---------------------------------------------------------------------------
// Stop reasons
// ---------------------------------------------------------------------------

export type AutonomousStopReason =
  | "user_stop"
  | "time_limit"
  | "resource_limit"
  | "run_completed"
  | "run_failed"
  | "write_paper_gate"
  | "manual_review_required"
  | "repeated_recommendation"
  | "stagnation"
  | "catastrophic_fuse"
  | "consecutive_failures";

// ---------------------------------------------------------------------------
// Novelty signals
// ---------------------------------------------------------------------------

export interface NoveltySignal {
  cycle: number;
  type:
    | "new_hypothesis"
    | "new_comparator"
    | "new_experiment_artifact"
    | "different_analysis_outcome"
    | "new_research_risk_resolved"
    | "paper_quality_upgrade"
    | "new_backtrack_target";
  detail: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AutonomousRunResult {
  run: RunRecord;
  status: "completed" | "stopped" | "failed" | "canceled";
  reason: string;
  stopReason?: AutonomousStopReason;
  approvalsApplied: number;
  transitionsApplied: number;
  iterations: number;
  researchCycles?: number;
  noveltySignals?: NoveltySignal[];
  paperStatus?: string;
  bestBranch?: BestBranchInfo;
}

// ---------------------------------------------------------------------------
// Policy builders
// ---------------------------------------------------------------------------

export function buildDefaultOvernightPolicy(): OvernightRunPolicy {
  return {
    mode: "overnight",
    maxMinutes: 8 * 60,
    minTransitionConfidence: 0.75,
    minDeepBacktrackConfidence: 0.88,
    autoApproveNodes: [
      "design_experiments",
      "implement_experiments",
      "run_experiments",
      "analyze_results"
    ],
    allowedBacktracks: ["implement_experiments", "design_experiments", "generate_hypotheses"],
    maxBackwardJumps: 4,
    maxDeepBacktracks: 1,
    stopOnRepeatedRecommendation: 2,
    stopBeforeWritePaper: true
  };
}

export function buildDefaultAutonomousPolicy(): AutonomousModePolicy {
  return {
    mode: "autonomous",
    maxMinutes: 24 * 60,
    minTransitionConfidence: 0.60,
    minDeepBacktrackConfidence: 0.70,
    autoApproveNodes: [
      "generate_hypotheses",
      "design_experiments",
      "implement_experiments",
      "run_experiments",
      "analyze_results",
      "review",
      "write_paper"
    ],
    allowedBacktracks: [
      "generate_hypotheses",
      "design_experiments",
      "implement_experiments"
    ],
    maxBackwardJumps: 50,
    maxDeepBacktracks: 20,
    stopBeforeWritePaper: false,
    novelty: {
      windowSize: 5,
      minNovelSignalsPerWindow: 1,
      maxStagnantWindows: 3
    },
    paperPressure: {
      checkIntervalCycles: 3,
      forceUpgradeAfterCycles: 6
    },
    fuse: {
      maxTotalIterations: 500,
      maxConsecutiveFailures: 10,
      maxRepeatedRecommendation: 5
    }
  };
}

export class AutonomousRunController {
  constructor(
    private readonly runStore: RunStore,
    private readonly orchestrator: AgentOrchestrator,
    private readonly eventStream: EventStream
  ) {}

  // -------------------------------------------------------------------------
  // Overnight mode (unchanged behavior, refactored to use shared helpers)
  // -------------------------------------------------------------------------

  async runOvernight(
    runId: string,
    policy: AutonomousRunPolicy = buildDefaultOvernightPolicy(),
    opts?: { abortSignal?: AbortSignal }
  ): Promise<AutonomousRunResult> {
    const startedAt = Date.now();
    let approvalsApplied = 0;
    let transitionsApplied = 0;
    let iterations = 0;
    let repeatedRecommendationCount = 0;
    let lastRecommendationKey: string | undefined;

    let run = await this.getRunOrThrow(runId);
    this.emit(run, `Overnight autonomy started. Max ${policy.maxMinutes} minutes, stop_before_write_paper=${policy.stopBeforeWritePaper}.`);

    while (true) {
      this.throwIfAborted(opts?.abortSignal);
      run = await this.getRunOrThrow(runId);

      if (Date.now() - startedAt > policy.maxMinutes * 60 * 1000) {
        this.emit(run, "Overnight autonomy stopped: time limit reached.");
        return {
          run,
          status: "stopped",
          reason: "Overnight time limit reached.",
          stopReason: "time_limit",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      if (policy.stopBeforeWritePaper && run.currentNode === "write_paper") {
        this.emit(run, "Overnight autonomy stopped before write_paper for manual review.");
        return {
          run,
          status: "stopped",
          reason: "Reached write_paper gate.",
          stopReason: "write_paper_gate",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      if (run.status === "completed") {
        this.emit(run, "Overnight autonomy completed the run.");
        return {
          run,
          status: "completed",
          reason: "Run completed.",
          stopReason: "run_completed",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      if (run.status === "failed") {
        this.emit(run, `Overnight autonomy stopped because the run ${run.status}.`);
        return {
          run,
          status: "failed",
          reason: `Run ${run.status}.`,
          stopReason: "run_failed",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      const state = run.graph.nodeStates[run.currentNode];
      if (run.status === "paused" && state.status === "needs_approval") {
        const recommendation = run.graph.pendingTransition;
        if (recommendation) {
          const key = recommendationKey(recommendation);
          repeatedRecommendationCount = key === lastRecommendationKey ? repeatedRecommendationCount + 1 : 1;
          lastRecommendationKey = key;
          const stopThreshold = policy.mode === "overnight"
            ? (policy as OvernightRunPolicy).stopOnRepeatedRecommendation
            : 5;
          if (repeatedRecommendationCount > stopThreshold) {
            this.emit(run, `Overnight autonomy stopped after repeated recommendation: ${key}.`);
            return {
              run,
              status: "stopped",
              reason: `Repeated recommendation: ${key}.`,
              stopReason: "repeated_recommendation",
              approvalsApplied,
              transitionsApplied,
              iterations
            };
          }

          if (this.canApplyRecommendation(run, recommendation, policy)) {
            this.emit(
              run,
              `Applying recommended transition ${recommendation.action} -> ${recommendation.targetNode || "stay"}.`
            );
            run = await this.orchestrator.applyPendingTransition(run.id);
            transitionsApplied += 1;
            continue;
          }

          this.emit(
            run,
            `Overnight autonomy paused for manual review at ${run.currentNode}: pending recommendation ${key}.`
          );
          return {
            run,
            status: "stopped",
            reason: `Manual review required for recommendation ${key} at ${run.currentNode}.`,
            stopReason: "manual_review_required",
            approvalsApplied,
            transitionsApplied,
            iterations
          };
        }

        if (policy.autoApproveNodes.includes(run.currentNode)) {
          this.emit(run, `Auto-approving ${run.currentNode}.`);
          run = await this.orchestrator.approveCurrent(run.id);
          approvalsApplied += 1;
          continue;
        }

        this.emit(run, `Overnight autonomy paused for manual review at ${run.currentNode}.`);
        return {
          run,
          status: "stopped",
          reason: `Manual review required at ${run.currentNode}.`,
          stopReason: "manual_review_required",
          approvalsApplied,
          transitionsApplied,
          iterations
        };
      }

      const response = await this.orchestrator.runCurrentAgentWithOptions(run.id, {
        abortSignal: opts?.abortSignal
      });
      run = response.run;
      iterations += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Autonomous mode — long-running dual-loop research exploration
  // -------------------------------------------------------------------------

  async runAutonomous(
    runId: string,
    policy: AutonomousModePolicy = buildDefaultAutonomousPolicy(),
    opts?: { abortSignal?: AbortSignal }
  ): Promise<AutonomousRunResult> {
    const startedAt = Date.now();
    let approvalsApplied = 0;
    let transitionsApplied = 0;
    let iterations = 0;
    let consecutiveFailures = 0;
    let repeatedRecommendationCount = 0;
    let lastRecommendationKey: string | undefined;
    let researchCycles = 0;
    let lastCompletionCycle = -1;
    let stagnantWindows = 0;
    let lastPaperPressureCycle = 0;
    const noveltySignals: NoveltySignal[] = [];
    let previousHypothesisNode = "";
    let previousAnalysisNote = "";
    let previousDesignNote = "";
    let previousMetricsHash = "";
    let loopDirection: "exploring" | "consolidating" = "exploring";
    let bestBranch: BestBranchInfo | undefined;

    const reporter = new AutonomousProgressReporter();

    let run = await this.getRunOrThrow(runId);
    this.emit(
      run,
      `Autonomous mode started. Max ${policy.maxMinutes} min, ` +
      `max ${policy.fuse.maxTotalIterations} iterations, ` +
      `novelty window=${policy.novelty.windowSize} cycles.`
    );

    await reporter.writeSnapshot(run, {
      mode: "autonomous",
      cycle: researchCycles,
      iteration: iterations,
      currentNode: run.currentNode,
      status: "running",
      noveltySignals: [],
      paperStatus: "not_started",
      stopRisk: "none",
      message: "Autonomous mode started.",
      loopDirection: "exploring"
    });

    const buildStopResult = async (
      status: "completed" | "stopped" | "failed" | "canceled",
      reason: string,
      stopReason: AutonomousStopReason,
      message?: string
    ): Promise<AutonomousRunResult> => {
      run = await this.getRunOrThrow(runId);
      const paperStatus = await this.readPaperStatus(run);
      const snap: AutonomousCycleSnapshot = {
        mode: "autonomous", cycle: researchCycles, iteration: iterations,
        currentNode: run.currentNode, status,
        noveltySignals, paperStatus,
        stopRisk: stopReason,
        message: message || reason,
        bestBranch: bestBranch?.hypothesis,
        paperCandidateStatus: bestBranch?.manuscriptType,
        evidenceGaps: bestBranch?.evidenceGaps,
        loopDirection
      };
      await reporter.writeFinalSummary(run, snap, stopReason);
      return {
        run, status, reason, stopReason,
        approvalsApplied, transitionsApplied, iterations,
        researchCycles, noveltySignals,
        paperStatus, bestBranch
      };
    };

    while (true) {
      if (opts?.abortSignal?.aborted) {
        this.emit(run, "Autonomous mode: user abort.");
        return buildStopResult("canceled", "User abort.", "user_stop");
      }
      run = await this.getRunOrThrow(runId);

      // --- Emergency fuse: total iterations ---
      if (iterations >= policy.fuse.maxTotalIterations) {
        this.emit(run, `Autonomous mode emergency stop: ${iterations} iterations reached.`);
        return buildStopResult("stopped", "Catastrophic fuse: max iterations.", "catastrophic_fuse",
          `Emergency stop: ${iterations} total iterations reached.`);
      }

      // --- Time limit ---
      if (Date.now() - startedAt > policy.maxMinutes * 60 * 1000) {
        this.emit(run, "Autonomous mode stopped: time limit reached.");
        return buildStopResult("stopped", "Time limit reached.", "time_limit");
      }

      // --- Emergency fuse: consecutive failures ---
      if (consecutiveFailures >= policy.fuse.maxConsecutiveFailures) {
        this.emit(run, `Autonomous mode emergency stop: ${consecutiveFailures} consecutive failures.`);
        return buildStopResult("stopped", "Catastrophic fuse: consecutive failures.", "consecutive_failures");
      }

      // --- Run completed: in autonomous mode, this triggers re-cycle ---
      if (run.status === "completed") {
        researchCycles += 1;
        this.emit(run, `Autonomous mode: run completed (cycle ${researchCycles}). Evaluating continuation.`);

        // Detect novelty from this completed cycle
        const cycleNovelty = await this.detectCycleNovelty(run, researchCycles, previousHypothesisNode, previousAnalysisNote, previousDesignNote, previousMetricsHash);
        noveltySignals.push(...cycleNovelty);
        previousHypothesisNode = run.graph.nodeStates.generate_hypotheses?.note || "";
        previousAnalysisNote = run.graph.nodeStates.analyze_results?.note || "";
        previousDesignNote = run.graph.nodeStates.design_experiments?.note || "";
        previousMetricsHash = await this.readMetricsHash(run);

        // Update best-branch tracking
        bestBranch = await this.evaluateBestBranch(run, bestBranch, researchCycles);

        // Check stagnation
        const windowSignals = noveltySignals.filter(
          (s) => s.cycle > researchCycles - policy.novelty.windowSize
        );
        if (windowSignals.length < policy.novelty.minNovelSignalsPerWindow) {
          stagnantWindows += 1;
          this.emit(run, `Stagnation detected: ${stagnantWindows}/${policy.novelty.maxStagnantWindows} windows.`);
        } else {
          stagnantWindows = 0;
        }

        if (stagnantWindows >= policy.novelty.maxStagnantWindows) {
          this.emit(run, "Autonomous mode stopped: sustained stagnation.");
          return buildStopResult("stopped", "Sustained stagnation: no novelty.", "stagnation",
            `Stopped after ${policy.novelty.maxStagnantWindows} stagnant windows with no meaningful novelty.`);
        }

        // Determine loop direction: explore vs consolidate
        const shouldConsolidate = this.shouldConsolidate(bestBranch, researchCycles, lastPaperPressureCycle, policy);
        loopDirection = shouldConsolidate ? "consolidating" : "exploring";

        // Paper pressure: periodically consolidate the strongest branch
        if (shouldConsolidate && bestBranch) {
          lastPaperPressureCycle = researchCycles;
          loopDirection = "consolidating";
          this.emit(run, `Paper pressure: consolidating best branch at cycle ${researchCycles}.`);

          const upgradeAction = this.determineUpgradeAction(bestBranch);
          if (bestBranch) {
            bestBranch.upgradeActions.push(upgradeAction);
          }

          // Record paper quality upgrade as novelty
          noveltySignals.push({
            cycle: researchCycles,
            type: "paper_quality_upgrade",
            detail: upgradeAction
          });

          await reporter.writeSnapshot(run, {
            mode: "autonomous", cycle: researchCycles, iteration: iterations,
            currentNode: run.currentNode, status: "running",
            noveltySignals: noveltySignals.slice(-10),
            paperStatus: await this.readPaperStatus(run),
            stopRisk: stagnantWindows > 0 ? "stagnation_risk" : "none",
            message: `Cycle ${researchCycles}: consolidating best branch for paper quality.`,
            bestBranch: bestBranch?.hypothesis,
            latestUpgradeAction: upgradeAction,
            paperCandidateStatus: bestBranch?.manuscriptType,
            evidenceGaps: bestBranch?.evidenceGaps,
            nextUpgradeAction: upgradeAction,
            loopDirection: "consolidating",
            whyContinued: `Best branch has upgrade potential: ${upgradeAction}`
          });

          // Jump to review to trigger paper-quality improvement
          try {
            await this.orchestrator.jumpToNode(run.id, "review", "force", `Paper pressure consolidation at cycle ${researchCycles}`);
            this.emit(run, `Jumped to review for paper-quality consolidation (cycle ${researchCycles}).`);
            if (bestBranch) {
              bestBranch.lastUpgradeCycle = researchCycles;
            }
          } catch {
            this.emit(run, "Paper pressure: failed to jump to review. Continuing exploration.");
          }
          continue;
        }

        // Standard exploration: report and re-cycle
        const whyContinued = this.buildContinuationReason(windowSignals, bestBranch, stagnantWindows);
        await reporter.writeSnapshot(run, {
          mode: "autonomous", cycle: researchCycles, iteration: iterations,
          currentNode: run.currentNode, status: "running",
          noveltySignals: noveltySignals.slice(-10),
          paperStatus: await this.readPaperStatus(run),
          stopRisk: stagnantWindows > 0 ? "stagnation_risk" : "none",
          message: `Cycle ${researchCycles} completed. Continuing exploration.`,
          bestBranch: bestBranch?.hypothesis,
          paperCandidateStatus: bestBranch?.manuscriptType,
          evidenceGaps: bestBranch?.evidenceGaps,
          loopDirection: "exploring",
          whyContinued,
          hypothesis: run.graph.nodeStates.generate_hypotheses?.note?.slice(0, 100)
        });

        // Re-cycle: backtrack to generate_hypotheses for next research cycle
        lastCompletionCycle = researchCycles;
        consecutiveFailures = 0;

        try {
          await this.orchestrator.jumpToNode(run.id, "generate_hypotheses", "force", `Re-cycle for exploration cycle ${researchCycles + 1}`);
          this.emit(run, `Re-cycling to generate_hypotheses for cycle ${researchCycles + 1}.`);
        } catch {
          this.emit(run, "Autonomous mode: failed to re-cycle. Stopping.");
          return buildStopResult("stopped", "Failed to re-cycle.", "catastrophic_fuse");
        }
        continue;
      }

      // --- Run failed ---
      if (run.status === "failed") {
        consecutiveFailures += 1;
        this.emit(run, `Autonomous mode: run failed (failure ${consecutiveFailures}).`);
        if (consecutiveFailures >= policy.fuse.maxConsecutiveFailures) {
          return buildStopResult("failed", "Too many consecutive failures.", "consecutive_failures");
        }
        // Attempt recovery by retrying current node
        try {
          await this.orchestrator.retryCurrent(run.id);
          this.emit(run, "Autonomous mode: retrying after failure.");
        } catch {
          return buildStopResult("failed",
            `Run failed: ${run.graph.nodeStates[run.currentNode]?.lastError || "unknown"}.`,
            "run_failed");
        }
        continue;
      }

      // --- Needs approval ---
      const state = run.graph.nodeStates[run.currentNode];
      if (run.status === "paused" && state.status === "needs_approval") {
        const recommendation = run.graph.pendingTransition;
        if (recommendation) {
          const key = recommendationKey(recommendation);
          repeatedRecommendationCount = key === lastRecommendationKey ? repeatedRecommendationCount + 1 : 1;
          lastRecommendationKey = key;

          if (repeatedRecommendationCount > policy.fuse.maxRepeatedRecommendation) {
            this.emit(run, `Autonomous mode: emergency stop after ${repeatedRecommendationCount} repeated recommendations: ${key}.`);
            return buildStopResult("stopped", `Catastrophic fuse: repeated recommendation ${key}.`, "catastrophic_fuse");
          }

          if (this.canApplyRecommendation(run, recommendation, policy)) {
            this.emit(
              run,
              `[autonomous] Applying ${recommendation.action} -> ${recommendation.targetNode || "stay"}.`
            );

            // Track novelty from backtracks
            if (recommendation.targetNode && GRAPH_NODE_ORDER.indexOf(recommendation.targetNode) < GRAPH_NODE_ORDER.indexOf(run.currentNode)) {
              noveltySignals.push({
                cycle: researchCycles,
                type: "new_backtrack_target",
                detail: `Backtrack from ${run.currentNode} to ${recommendation.targetNode}: ${recommendation.reason.slice(0, 80)}`
              });
            }

            run = await this.orchestrator.applyPendingTransition(run.id);
            transitionsApplied += 1;
            continue;
          }

          // In autonomous mode: auto-approve even non-auto-executable recommendations with relaxed confidence
          if (recommendation.confidence >= policy.minTransitionConfidence) {
            this.emit(run, `[autonomous] Force-applying recommendation ${key} (confidence=${recommendation.confidence}).`);
            run = await this.orchestrator.applyPendingTransition(run.id);
            transitionsApplied += 1;
            continue;
          }

          // Last resort: auto-approve the node itself
          if (policy.autoApproveNodes.includes(run.currentNode)) {
            this.emit(run, `[autonomous] Auto-approving ${run.currentNode} despite low-confidence recommendation.`);
            run = await this.orchestrator.approveCurrent(run.id);
            approvalsApplied += 1;
            continue;
          }

          this.emit(run, `[autonomous] Paused: cannot resolve recommendation ${key} at ${run.currentNode}.`);
          return buildStopResult("stopped", `Manual review required: ${key} at ${run.currentNode}.`, "manual_review_required");
        }

        // No recommendation, but needs approval
        if (policy.autoApproveNodes.includes(run.currentNode)) {
          this.emit(run, `[autonomous] Auto-approving ${run.currentNode}.`);
          run = await this.orchestrator.approveCurrent(run.id);
          approvalsApplied += 1;
          continue;
        }

        this.emit(run, `[autonomous] Paused for manual review at ${run.currentNode}.`);
        return buildStopResult("stopped", `Manual review required at ${run.currentNode}.`, "manual_review_required");
      }

      // --- Execute current node ---
      try {
        const response = await this.orchestrator.runCurrentAgentWithOptions(run.id, {
          abortSignal: opts?.abortSignal
        });
        run = response.run;
        iterations += 1;

        if (run.status === "failed") {
          consecutiveFailures += 1;
        } else {
          consecutiveFailures = 0;
        }

        // Periodic progress report
        if (iterations % 5 === 0) {
          await reporter.writeSnapshot(run, {
            mode: "autonomous", cycle: researchCycles, iteration: iterations,
            currentNode: run.currentNode, status: "running",
            noveltySignals: noveltySignals.slice(-10),
            paperStatus: await this.readPaperStatus(run),
            stopRisk: stagnantWindows > 0 ? "stagnation_risk" : "none",
            message: `Iteration ${iterations}, cycle ${researchCycles}, node ${run.currentNode}.`,
            bestBranch: bestBranch?.hypothesis,
            paperCandidateStatus: bestBranch?.manuscriptType,
            evidenceGaps: bestBranch?.evidenceGaps,
            loopDirection,
            hypothesis: run.graph.nodeStates.generate_hypotheses?.note?.slice(0, 100),
            experimentTarget: run.graph.nodeStates.design_experiments?.note?.slice(0, 100)
          });
        }
      } catch (err) {
        iterations += 1;
        consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Operation aborted")) {
          this.emit(run, "Autonomous mode: user abort.");
          return buildStopResult("canceled", "User abort.", "user_stop");
        }
        this.emit(run, `[autonomous] Node execution error (failure ${consecutiveFailures}): ${msg.slice(0, 120)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Best-branch evaluation
  // -------------------------------------------------------------------------

  async evaluateBestBranch(
    run: RunRecord,
    current: BestBranchInfo | undefined,
    cycle: number
  ): Promise<BestBranchInfo> {
    const runDir = path.join(".autolabos", "runs", run.id);

    const hypothesis = run.graph.nodeStates.generate_hypotheses?.note || run.topic;

    // Read key artifacts to assess evidence quality
    const [metricsRaw, baselineRaw, resultTableRaw, analysisRaw, critiqueRaw] = await Promise.all([
      safeRead(path.join(runDir, "metrics.json")),
      safeRead(path.join(runDir, "baseline_summary.json")),
      safeRead(path.join(runDir, "result_table.json")),
      safeRead(path.join(runDir, "result_analysis.json")),
      safeRead(path.join(runDir, "review", "paper_critique.json"))
    ]);

    const hasBaseline = baselineRaw.trim().length > 10;
    const hasQuantitativeResults = metricsRaw.trim().length > 10;
    const hasResultTable = resultTableRaw.trim().length > 10;

    let manuscriptType = "not_analyzed";
    let hasComparator = hasBaseline;
    try {
      if (critiqueRaw.trim()) {
        const critique = JSON.parse(critiqueRaw);
        manuscriptType = critique.manuscript_type || manuscriptType;
      } else if (analysisRaw.trim()) {
        const analysis = JSON.parse(analysisRaw);
        manuscriptType = analysis.manuscript_type || analysis.paper_status || manuscriptType;
        if (analysis.compared_systems && analysis.compared_systems.length > 1) {
          hasComparator = true;
        }
      }
    } catch { /* ignore parse errors */ }

    // Determine evidence gaps
    const evidenceGaps: string[] = [];
    if (!hasBaseline) evidenceGaps.push("Missing explicit baseline or comparator");
    if (!hasQuantitativeResults) evidenceGaps.push("No quantitative results (metrics.json)");
    if (!hasResultTable) evidenceGaps.push("No result table artifact");
    if (!hasComparator) evidenceGaps.push("No comparator identified");
    if (manuscriptType === "not_analyzed" || manuscriptType === "system_validation_note") {
      evidenceGaps.push("Manuscript not at paper-scale level");
    }

    const branch: BestBranchInfo = {
      branchId: `cycle-${cycle}`,
      hypothesis: hypothesis.slice(0, 120),
      hasBaseline,
      hasComparator,
      hasQuantitativeResults,
      hasResultTable,
      manuscriptType,
      lastUpgradeCycle: current?.lastUpgradeCycle || 0,
      evidenceGaps,
      upgradeActions: current?.upgradeActions || []
    };

    // Keep current if it's stronger
    if (current && this.branchScore(current) > this.branchScore(branch)) {
      return { ...current, evidenceGaps: current.evidenceGaps };
    }

    return branch;
  }

  /** Simple numeric score for comparing branch quality */
  private branchScore(b: BestBranchInfo): number {
    let score = 0;
    if (b.hasBaseline) score += 2;
    if (b.hasComparator) score += 2;
    if (b.hasQuantitativeResults) score += 3;
    if (b.hasResultTable) score += 2;
    const typeScores: Record<string, number> = {
      paper_ready: 10,
      paper_scale_candidate: 7,
      research_memo: 3,
      system_validation_note: 1,
      not_analyzed: 0,
      blocked_for_paper_scale: 2
    };
    score += typeScores[b.manuscriptType] || 0;
    return score;
  }

  // -------------------------------------------------------------------------
  // Paper pressure decision
  // -------------------------------------------------------------------------

  private shouldConsolidate(
    bestBranch: BestBranchInfo | undefined,
    currentCycle: number,
    lastPaperPressureCycle: number,
    policy: AutonomousModePolicy
  ): boolean {
    if (!bestBranch) return false;

    // Regular interval check
    const cyclesSinceLastPressure = currentCycle - lastPaperPressureCycle;
    if (cyclesSinceLastPressure >= policy.paperPressure.checkIntervalCycles) {
      // Only consolidate if there's something worth consolidating
      if (bestBranch.hasQuantitativeResults || bestBranch.hasBaseline) {
        return true;
      }
    }

    // Force upgrade if best branch has not been upgraded in too long
    const cyclesSinceUpgrade = currentCycle - bestBranch.lastUpgradeCycle;
    if (cyclesSinceUpgrade >= policy.paperPressure.forceUpgradeAfterCycles) {
      if (bestBranch.hasQuantitativeResults) {
        return true;
      }
    }

    return false;
  }

  private determineUpgradeAction(bestBranch: BestBranchInfo): string {
    if (!bestBranch.hasBaseline && !bestBranch.hasComparator) {
      return "Add baseline or comparator to strengthen evidence";
    }
    if (!bestBranch.hasResultTable) {
      return "Generate structured result table with quantitative comparison";
    }
    if (!bestBranch.hasQuantitativeResults) {
      return "Execute experiment to produce quantitative metrics";
    }
    if (bestBranch.manuscriptType === "system_validation_note" || bestBranch.manuscriptType === "research_memo") {
      return "Upgrade manuscript from memo/note toward paper-scale candidate";
    }
    if (bestBranch.manuscriptType === "paper_scale_candidate") {
      return "Strengthen claim-evidence linkage and review readiness";
    }
    return "Revise manuscript structure and improve analysis quality";
  }

  private buildContinuationReason(
    windowSignals: NoveltySignal[],
    bestBranch: BestBranchInfo | undefined,
    stagnantWindows: number
  ): string {
    const parts: string[] = [];
    if (windowSignals.length > 0) {
      const types = [...new Set(windowSignals.map(s => s.type))];
      parts.push(`${windowSignals.length} novelty signals (${types.join(", ")})`);
    }
    if (bestBranch) {
      parts.push(`best branch: ${bestBranch.manuscriptType}`);
      if (bestBranch.evidenceGaps.length > 0) {
        parts.push(`${bestBranch.evidenceGaps.length} evidence gaps remain`);
      }
    }
    if (stagnantWindows > 0) {
      parts.push(`stagnation risk: ${stagnantWindows} windows`);
    }
    return parts.length > 0 ? parts.join("; ") : "Continuing exploration.";
  }

  // -------------------------------------------------------------------------
  // Novelty detection (enhanced)
  // -------------------------------------------------------------------------

  async detectCycleNovelty(
    run: RunRecord,
    cycle: number,
    previousHypothesisNote: string,
    previousAnalysisNote: string,
    previousDesignNote: string,
    previousMetricsHash: string
  ): Promise<NoveltySignal[]> {
    const signals: NoveltySignal[] = [];

    const hypothesisNote = run.graph.nodeStates.generate_hypotheses?.note || "";
    if (hypothesisNote && hypothesisNote !== previousHypothesisNote) {
      signals.push({ cycle, type: "new_hypothesis", detail: hypothesisNote.slice(0, 100) });
    }

    const analysisNote = run.graph.nodeStates.analyze_results?.note || "";
    if (analysisNote && analysisNote !== previousAnalysisNote) {
      signals.push({ cycle, type: "different_analysis_outcome", detail: analysisNote.slice(0, 100) });
    }

    const designNote = run.graph.nodeStates.design_experiments?.note || "";
    if (designNote && designNote !== previousDesignNote) {
      // Check for new comparators or ablations
      const lower = designNote.toLowerCase();
      if (lower.includes("comparator") || lower.includes("ablation") || lower.includes("baseline")) {
        signals.push({ cycle, type: "new_comparator", detail: designNote.slice(0, 100) });
      }
    }

    // Check for new experiment artifacts via metrics hash change
    const currentMetricsHash = await this.readMetricsHash(run);
    if (currentMetricsHash && currentMetricsHash !== previousMetricsHash) {
      signals.push({ cycle, type: "new_experiment_artifact", detail: "New metrics.json content detected" });
    }

    // Check transition history for backtracks
    const history = run.graph.transitionHistory || [];
    const recentBt = history.filter((h) => h.toNode === "generate_hypotheses" || h.toNode === "design_experiments");
    if (recentBt.length > 0) {
      signals.push({
        cycle, type: "new_backtrack_target",
        detail: `${recentBt.length} backtracks in transition history`
      });
    }

    return signals;
  }

  // -------------------------------------------------------------------------
  // Artifact readers
  // -------------------------------------------------------------------------

  private async readPaperStatus(run: RunRecord): Promise<string> {
    try {
      const raw = await safeRead(path.join(".autolabos", "runs", run.id, "result_analysis.json"));
      if (raw.trim()) {
        const data = JSON.parse(raw);
        return data.manuscript_type || data.paper_status || "unknown";
      }
    } catch { /* ignore */ }
    return "not_analyzed";
  }

  async readMetricsHash(run: RunRecord): Promise<string> {
    try {
      const raw = await safeRead(path.join(".autolabos", "runs", run.id, "metrics.json"));
      if (raw.trim()) {
        // Simple hash: length + first 50 chars
        return `${raw.length}:${raw.trim().slice(0, 50)}`;
      }
    } catch { /* ignore */ }
    return "";
  }

  private canApplyRecommendation(
    run: RunRecord,
    recommendation: TransitionRecommendation,
    policy: AutonomousRunPolicy
  ): boolean {
    if (!recommendation.autoExecutable) {
      return false;
    }
    if (recommendation.confidence < policy.minTransitionConfidence) {
      return false;
    }
    if (recommendation.action === "pause_for_human") {
      return false;
    }
    if (recommendation.action === "advance") {
      return true;
    }
    if (!recommendation.targetNode) {
      return false;
    }
    if (!policy.allowedBacktracks.includes(recommendation.targetNode)) {
      return false;
    }

    const backwardJumps = (run.graph.transitionHistory || []).filter((item) => {
      if (!item.toNode) {
        return false;
      }
      return GRAPH_NODE_ORDER.indexOf(item.toNode) < GRAPH_NODE_ORDER.indexOf(item.fromNode);
    }).length;
    const deepBacktracks = (run.graph.transitionHistory || []).filter((item) => {
      return item.toNode === "generate_hypotheses";
    }).length;
    const isDeepBacktrack = recommendation.targetNode === "generate_hypotheses";

    if (backwardJumps >= policy.maxBackwardJumps) {
      return false;
    }
    if (isDeepBacktrack && recommendation.confidence < policy.minDeepBacktrackConfidence) {
      return false;
    }
    if (isDeepBacktrack && deepBacktracks >= policy.maxDeepBacktracks) {
      return false;
    }
    if (isDeepBacktrack && !supportsHypothesisBacktrack(recommendation)) {
      return false;
    }
    return true;
  }

  private async getRunOrThrow(runId: string): Promise<RunRecord> {
    const run = await this.runStore.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }

  private emit(run: RunRecord, text: string): void {
    this.eventStream.emit({
      type: "OBS_RECEIVED",
      runId: run.id,
      node: run.currentNode,
      payload: { text }
    });
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Operation aborted by user");
    }
  }
}

function recommendationKey(recommendation: TransitionRecommendation): string {
  return `${recommendation.action}:${recommendation.targetNode || "stay"}`;
}

function supportsHypothesisBacktrack(recommendation: TransitionRecommendation): boolean {
  const text = [recommendation.reason, ...recommendation.evidence].join(" ").toLowerCase();
  const hasHypothesisSignal =
    text.includes("hypothesis") ||
    text.includes("idea set") ||
    text.includes("shortlisted") ||
    text.includes("not support");
  const hasExecutionSignal =
    text.includes("runtime") ||
    text.includes("verifier") ||
    text.includes("metrics file") ||
    text.includes("missing metrics");
  return hasHypothesisSignal && !hasExecutionSignal;
}
