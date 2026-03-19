import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { EventStream } from "../events.js";
import { RunStore } from "../runs/runStore.js";
import { AppConfig, RunRecord } from "../../types.js";
import { CodexCliClient, CodexEvent, RunTurnResult } from "../../integrations/codex/codexCliClient.js";
import { mapCodexEventToAutoLabOSEvents } from "../../integrations/codex/codexEventMapper.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { EpisodeMemory, EpisodeRecord } from "../memory/episodeMemory.js";
import { LongTermEntry, LongTermStore } from "../memory/longTermStore.js";
import { ensureDir, fileExists, normalizeFsPath, writeJsonFile } from "../../utils/fs.js";
import { safeRead } from "../nodes/helpers.js";
import { buildPublicExperimentDir } from "../publicArtifacts.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
import { resolveExperimentLlmProfile } from "../experimentLlmProfile.js";
import { supportsRealExecutionBundle, writeRealExecutionBundle } from "../experiments/realExecutionBundle.js";
import { RunVerifierReport } from "../experiments/runVerifierFeedback.js";
import { AgentComputerInterface, AciObservation } from "../../tools/aci.js";
import {
  buildExperimentImplementationContext,
  CandidateIsolationAttemptReport,
  CandidateIsolationReport,
  EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY,
  loadExperimentComparisonContract,
  storeExperimentGovernanceDecision
} from "../experimentGovernance.js";
import {
  ImplementationLocalizer,
  LocalizationCandidate,
  LocalizationResult,
  LocalizationSearchHit
} from "./implementationLocalizer.js";

export interface ImplementSessionSummary {
  summary: string;
  threadId?: string;
  runCommand: string;
  testCommand?: string;
  scriptPath?: string;
  metricsPath: string;
  workingDir: string;
  experimentMode: string;
  publicDir: string;
  changedFiles: string[];
  artifacts: string[];
  publicArtifacts: string[];
  rawResponse: string;
  verifyReport: VerifyReport;
  autoHandoffToRunExperiments: boolean;
  handoffReason?: string;
}

export class ImplementSessionStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImplementSessionStopError";
  }
}

interface ImplementSessionDeps {
  config: AppConfig;
  codex: CodexCliClient;
  aci: AgentComputerInterface;
  eventStream: EventStream;
  runStore: RunStore;
  workspaceRoot: string;
}

interface StructuredImplementResponse {
  summary?: string;
  run_command?: string;
  test_command?: string;
  working_dir?: string;
  experiment_mode?: string;
  changed_files?: string[];
  artifacts?: string[];
  public_dir?: string;
  public_artifacts?: string[];
  script_path?: string;
  metrics_path?: string;
  localization?: unknown;
  assumptions?: string[];
}

interface ParsedStructuredImplementResponse {
  value: StructuredImplementResponse;
  isStructured: boolean;
}

interface CachedConstraintProfile {
  profile?: {
    source?: string;
    collect?: Record<string, unknown>;
    writing?: Record<string, unknown>;
    experiment?: Record<string, unknown>;
    assumptions?: string[];
  };
}

const MAX_IMPLEMENT_ATTEMPTS = 3;
const SEARCH_BRANCH_FOCUS_LIMIT = 1;
const IMPLEMENT_PROGRESS_STATUS_ARTIFACT = path.join("implement_experiments", "status.json");
const IMPLEMENT_PROGRESS_LOG_ARTIFACT = path.join("implement_experiments", "progress.jsonl");
const NON_RESTORABLE_RUN_DIR_ENTRIES = new Set([
  "implement_experiments",
  "memory",
  "implement_attempts.json",
  "verify_report.json",
  "branch_search_result.json",
  "localization_search_result.json",
  "implement_task_spec.json",
  "long_term_memory_result.json"
]);
const execFile = promisify(execFileCallback);

type CandidateIsolationStrategy = "attempt_snapshot_restore" | "attempt_worktree";

type ImplementFailureType =
  | "implementation"
  | "localization"
  | "environment"
  | "policy"
  | "spec"
  | "missing_check";

interface ImplementTaskSpec {
  goal: string;
  acceptance_criteria: string[];
  non_goals: string[];
  constraints: string[];
  workspace: {
    root: string;
    run_dir: string;
    public_dir: string;
    metrics_path: string;
  };
  context: {
    topic: string;
    objective_metric: string;
    plan_excerpt: string;
    hypotheses_excerpt: string;
    repo_listing: string;
    previous_summary?: string;
    previous_run_command?: string;
    previous_script?: string;
    long_term_memory: LongTermMemorySnapshot;
    runner_feedback?: RunVerifierReport;
    paper_critique_feedback?: {
      overall_decision?: string;
      manuscript_type?: string;
      needs_additional_experiments?: boolean;
      blocking_issue_summaries: string[];
      recommended_fixes: string[];
      summary?: string;
    };
    resolved_constraint_profile?: CachedConstraintProfile["profile"];
    comparison_contract?: {
      plan_id: string;
      comparison_mode: "baseline_first_locked" | "objective_only";
      baseline_first_required: boolean;
      baseline_candidate_ids: string[];
      budget_profile: {
        mode: string;
        timeout_sec: number;
        total_trials?: number;
      };
      evaluator_contract_id: string;
    };
    plan_changed: boolean;
    plan_hash: string;
  };
}

interface VerifyReport {
  status: "pass" | "fail" | "not_run";
  command?: string;
  cwd?: string;
  exit_code?: number;
  failure_type?: ImplementFailureType;
  policy_rule_id?: string;
  policy_reason?: string;
  next_action:
    | "accept"
    | "retry_patch"
    | "relocalize"
    | "handoff_to_run_experiments"
    | "stop_for_environment"
    | "stop_for_policy";
  stdout_excerpt?: string;
  stderr_excerpt?: string;
  summary: string;
}

type ImplementProgressStage = "preflight" | "attempt" | "localize" | "codex" | "verify" | "publish" | "completed" | "failed";

interface ImplementProgressStatus {
  status: "running" | "completed" | "failed";
  stage: ImplementProgressStage;
  message: string;
  startedAt: string;
  updatedAt: string;
  progressCount: number;
  attempt?: number;
  maxAttempts: number;
  threadId?: string;
  publicDir?: string;
  scriptPath?: string;
  runCommand?: string;
  testCommand?: string;
  verificationCommand?: string;
  verifyStatus?: VerifyReport["status"];
}

interface AttemptRecord {
  attempt: number;
  summary: string;
  branch_plan: BranchPlan;
  localization: LocalizationResult;
  search_localization?: LocalizationResult;
  verify_report: VerifyReport;
  reflection?: EpisodeRecord;
  changed_files: string[];
  artifacts: string[];
  public_artifacts: string[];
  raw_response: string;
  restored_after_failure?: boolean;
  restored_paths?: string[];
}

interface PreparedImplementAttempt {
  threadId?: string;
  branchPlan: BranchPlan;
  workspaceRoot: string;
  rawResponse: string;
  summary: string;
  runCommand: string;
  testCommand?: string;
  originalScriptPath?: string;
  scriptPath?: string;
  metricsPath: string;
  workingDir: string;
  experimentMode: string;
  publicDir: string;
  changedFiles: string[];
  artifacts: string[];
  publicArtifacts: string[];
  localization: LocalizationResult;
  assumptions: string[];
  verifyReport: VerifyReport;
}

interface ImplementAttemptSnapshot {
  snapshotRoot: string;
  orphanedResiduePaths: string[];
  capturePaths(paths: Array<string | undefined>): Promise<void>;
  markCreatedPaths(paths: Array<string | undefined>): void;
  restore(): Promise<{ restoredPaths: string[] }>;
  cleanup(): Promise<void>;
}

interface AttemptIsolationContext {
  requestedStrategy: CandidateIsolationStrategy;
  effectiveStrategy: CandidateIsolationStrategy;
  fallbackFrom?: "attempt_worktree";
  fallbackReason?: string;
  controlWorkspaceRoot: string;
  workspaceRoot: string;
  runDir: string;
  publicDir: string;
  metricsPath: string;
  attemptSnapshot?: ImplementAttemptSnapshot;
  worktreePath?: string;
  orphanedResiduePaths: string[];
}

interface BranchPlan {
  branch_id: string;
  source: "search_primary" | "search_alternate" | "repair_retry";
  summary: string;
  rationale: string;
  focus_files: string[];
  candidate_pool: string[];
}

interface LongTermMemoryHint {
  id: string;
  category: string;
  text: string;
  tags: string[];
  created_at: string;
}

interface LongTermMemorySnapshot {
  search_queries: string[];
  retrieved: LongTermMemoryHint[];
  saved?: LongTermMemoryHint;
}

export class ImplementSessionManager {
  private readonly localizer: ImplementationLocalizer;

  constructor(private readonly deps: ImplementSessionDeps) {
    this.localizer = new ImplementationLocalizer(deps.aci);
  }

  async run(run: RunRecord, abortSignal?: AbortSignal): Promise<ImplementSessionSummary> {
    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    const episodeMemory = new EpisodeMemory(run.memoryRefs.episodePath);
    const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
    const runDir = path.join(this.deps.workspaceRoot, ".autolabos", "runs", run.id);
    const metricsPath = path.join(runDir, "metrics.json");
    const defaultPublicDir = buildPublicExperimentDir(this.deps.workspaceRoot, run);
    const experimentLlmProfile = resolveExperimentLlmProfile(this.deps.config);
    const currentThreadId =
      run.nodeThreads.implement_experiments ||
      (await runContext.get<string>("implement_experiments.thread_id"));

    const changedFiles = new Set<string>();
    const artifacts = new Set<string>();
    const publicArtifacts = new Set<string>();
    const historicalChangedFiles = new Set<string>();
    const rawEvents: CodexEvent[] = [];
    const startedAt = new Date().toISOString();
    let progressCount = 0;
    let progressQueue: Promise<void> = Promise.resolve();
    await ensureDir(defaultPublicDir);
    await ensureDir(path.join(runDir, "implement_experiments"));
    const longTermMemory = await loadImplementationLongTermMemory(longTermStore, run);
    const taskSpec = await this.buildTaskSpec(
      run,
      runDir,
      defaultPublicDir,
      metricsPath,
      runContext,
      longTermMemory
    );
    await writeJsonFile(path.join(runDir, "implement_task_spec.json"), taskSpec);

    const queueProgressUpdate = (
      stage: ImplementProgressStage,
      message: string,
      extras: Partial<Omit<ImplementProgressStatus, "status" | "stage" | "message" | "startedAt" | "updatedAt" | "progressCount" | "maxAttempts">> = {}
    ) => {
      const updatedAt = new Date().toISOString();
      progressCount += 1;
      const nextStatus: ImplementProgressStatus = {
        status: "running",
        stage,
        message,
        startedAt,
        updatedAt,
        progressCount,
        maxAttempts: MAX_IMPLEMENT_ATTEMPTS,
        threadId: extras.threadId,
        attempt: extras.attempt,
        publicDir: extras.publicDir,
        scriptPath: extras.scriptPath,
        runCommand: extras.runCommand,
        testCommand: extras.testCommand,
        verificationCommand: extras.verificationCommand,
        verifyStatus: extras.verifyStatus
      };
      progressQueue = progressQueue.then(async () => {
        await appendImplementProgressItem(runDir, {
          index: nextStatus.progressCount,
          timestamp: updatedAt,
          stage,
          message,
          attempt: nextStatus.attempt,
          threadId: nextStatus.threadId,
          verifyStatus: nextStatus.verifyStatus
        });
        await writeImplementProgressStatus(runDir, nextStatus);
      });
    };
    const flushProgressUpdates = async () => {
      await progressQueue;
    };
    const emitImplementObservation = (
      stage: ImplementProgressStage,
      text: string,
      extras: Partial<Omit<ImplementProgressStatus, "status" | "stage" | "message" | "startedAt" | "updatedAt" | "progressCount" | "maxAttempts">> = {}
    ) => {
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text
        }
      });
      queueProgressUpdate(stage, text, extras);
    };

    await writeImplementProgressStatus(runDir, {
      status: "running",
      stage: "preflight",
      message: "Implementation task spec prepared.",
      startedAt,
      updatedAt: startedAt,
      progressCount,
      maxAttempts: MAX_IMPLEMENT_ATTEMPTS,
      publicDir: defaultPublicDir
    });

    this.deps.eventStream.emit({
      type: "PLAN_CREATED",
      runId: run.id,
      node: "implement_experiments",
      agentRole: "implementer",
      payload: {
        text: "Implementation task spec prepared.",
        task_spec: taskSpec
      }
    });
    if (longTermMemory.retrieved.length > 0) {
      emitImplementObservation(
        "preflight",
        `Loaded ${longTermMemory.retrieved.length} long-term implementation hint(s).`,
        { publicDir: defaultPublicDir }
      );
    }
    if (taskSpec.context.runner_feedback) {
      emitImplementObservation(
        "preflight",
        `Loaded runner feedback from run_experiments: ${taskSpec.context.runner_feedback.summary}`,
        { publicDir: defaultPublicDir }
      );
    }
    if (taskSpec.context.paper_critique_feedback) {
      emitImplementObservation(
        "preflight",
        `Loaded paper critique feedback from write_paper: ${taskSpec.context.paper_critique_feedback.summary || "additional experimental evidence is required"}`,
        { publicDir: defaultPublicDir }
      );
    }

    let activeThreadId = currentThreadId;
    if (
      activeThreadId &&
      (
        taskSpec.context.plan_changed ||
        taskSpec.context.runner_feedback ||
        taskSpec.context.paper_critique_feedback
      )
    ) {
      activeThreadId = undefined;
      await runContext.put("implement_experiments.thread_id", null);
      const latestRun = (await this.deps.runStore.getRun(run.id)) || run;
      if (latestRun.nodeThreads.implement_experiments) {
        delete latestRun.nodeThreads.implement_experiments;
        await this.deps.runStore.updateRun(latestRun);
      }
      emitImplementObservation(
        "preflight",
        taskSpec.context.plan_changed
          ? "Experiment plan changed since the last implement cycle; starting a fresh implementation thread."
          : taskSpec.context.runner_feedback
            ? "Runner feedback changed the repair target; starting a fresh implementation thread."
            : "Paper critique requested additional implementation evidence; starting a fresh implementation thread.",
        { publicDir: defaultPublicDir }
      );
    }
    let finalAttempt: PreparedImplementAttempt | undefined;
    let finalIsolation: AttemptIsolationContext | undefined;
    const attemptRecords: AttemptRecord[] = [];
    let latestSearchLocalization: LocalizationResult | undefined;
    let recentReflections = await episodeMemory.recent(run.id, "implement_experiments", 3);
    let restoredAttemptCount = 0;
    const requestedIsolationStrategy = resolveConfiguredCandidateIsolationStrategy(this.deps.config);
    const candidateIsolationAttempts: CandidateIsolationAttemptReport[] = [];

    for (let attempt = 1; attempt <= MAX_IMPLEMENT_ATTEMPTS; attempt += 1) {
      emitImplementObservation("attempt", `Implementation attempt ${attempt}/${MAX_IMPLEMENT_ATTEMPTS} started.`, {
        attempt,
        threadId: activeThreadId,
        publicDir: defaultPublicDir
      });

      const attemptStartedAt = new Date().toISOString();
      const branchContextFiles = dedupeStrings([...changedFiles, ...historicalChangedFiles]);
      const searchLocalization = await this.localizer.localize(
        this.buildLocalizerInput(taskSpec, attemptRecords.at(-1), branchContextFiles)
      );
      latestSearchLocalization = searchLocalization;
      await writeJsonFile(path.join(runDir, "localization_search_result.json"), latestSearchLocalization || {});
      const branchPlan = chooseBranchPlan(
        searchLocalization,
        attemptRecords,
        branchContextFiles,
        await buildDefaultImplementFocusFiles(taskSpec)
      );
      const isolation = await createAttemptIsolationContext({
        config: this.deps.config,
        workspaceRoot: this.deps.workspaceRoot,
        run,
        runDir,
        defaultPublicDir,
        metricsPath,
        attempt,
        requestedStrategy: requestedIsolationStrategy
      });
      await isolation.attemptSnapshot?.capturePaths([
        defaultPublicDir,
        metricsPath,
        ...(await listRestorableRunDirEntries(runDir)),
        ...branchContextFiles,
        ...branchPlan.focus_files,
        ...branchPlan.candidate_pool,
        ...searchLocalization.selected_files,
        ...searchLocalization.candidates.map((candidate) => candidate.path)
      ]);
      const attemptChangedFiles = new Set<string>(changedFiles);
      const attemptArtifacts = new Set<string>(artifacts);
      const attemptPublicArtifacts = new Set<string>(publicArtifacts);
      const promptTaskSpec = translateTaskSpecToWorkspace(taskSpec, {
        fromWorkspaceRoot: this.deps.workspaceRoot,
        toWorkspaceRoot: isolation.workspaceRoot,
        runDir: isolation.runDir,
        publicDir: isolation.publicDir,
        metricsPath: isolation.metricsPath
      });
      const promptSearchLocalization = translateLocalizationResultWorkspace(searchLocalization, {
        fromWorkspaceRoot: this.deps.workspaceRoot,
        toWorkspaceRoot: isolation.workspaceRoot
      });
      const actualSearchLocalization = promptSearchLocalization;
      const promptBranchPlan = translateBranchPlanWorkspace(branchPlan, {
        fromWorkspaceRoot: this.deps.workspaceRoot,
        toWorkspaceRoot: isolation.workspaceRoot
      });
      const promptPreviousAttempt = translateAttemptRecordWorkspace(attemptRecords.at(-1), {
        fromWorkspaceRoot: this.deps.workspaceRoot,
        toWorkspaceRoot: isolation.workspaceRoot
      });

      emitImplementObservation("localize", `Search-backed localization: ${formatLocalizationSummary(searchLocalization)}`, {
        attempt,
        threadId: activeThreadId,
        publicDir: defaultPublicDir
      });
      emitImplementObservation(
        "localize",
        `Branch focus ${branchPlan.branch_id}: ${branchPlan.focus_files.join(", ") || "(no explicit file focus)"}`,
        {
          attempt,
          threadId: activeThreadId,
          publicDir: defaultPublicDir
        }
      );

      const streamProgress = createCodexProgressEmitter((text) => {
        emitImplementObservation("codex", text, {
          attempt,
          threadId: activeThreadId,
          publicDir: defaultPublicDir
        });
      });

      let result: RunTurnResult;
      const recoveredBeforeTurn = await recoverStructuredResultFromPublicBundle({
        publicDir: isolation.publicDir,
        runDir: isolation.runDir,
        metricsPath: isolation.metricsPath,
        workspaceRoot: isolation.workspaceRoot,
        errorMessage: "Recovered an already materialized governed experiment bundle before re-entering Codex.",
        requireFreshPlanAlignment:
          promptTaskSpec.context.plan_changed ||
          Boolean(promptTaskSpec.context.runner_feedback) ||
          Boolean(promptTaskSpec.context.paper_critique_feedback)
      });
      if (recoveredBeforeTurn && (await hasRecoverableExecutionEvidence(isolation.publicDir, isolation.metricsPath))) {
        emitImplementObservation(
          "codex",
          "Reused the existing governed experiment bundle and execution evidence instead of re-entering Codex.",
          {
            attempt,
            threadId: activeThreadId,
            publicDir: isolation.publicDir
          }
        );
        result = recoveredBeforeTurn;
      } else {
        try {
          result = await this.deps.codex.runTurnStream({
          prompt: this.buildAttemptPrompt({
            taskSpec: promptTaskSpec,
            searchLocalization: promptSearchLocalization,
            branchPlan: promptBranchPlan,
            recentReflections,
            attempt,
            previousAttempt: promptPreviousAttempt,
            existingChangedFiles: translatePathsBetweenWorkspaces([...changedFiles], {
              fromWorkspaceRoot: this.deps.workspaceRoot,
              toWorkspaceRoot: isolation.workspaceRoot
            }),
            historicalChangedFiles: translatePathsBetweenWorkspaces([...historicalChangedFiles], {
              fromWorkspaceRoot: this.deps.workspaceRoot,
              toWorkspaceRoot: isolation.workspaceRoot
            })
          }),
          threadId: activeThreadId,
          agentId: `implementer:${run.id}`,
          systemPrompt: this.buildSystemPrompt(
            isolation.runDir,
            isolation.publicDir,
            isolation.metricsPath,
            experimentLlmProfile
          ),
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          workingDirectory: toSandboxFriendlyWorkspaceRoot(isolation.workspaceRoot),
          abortSignal,
          onEvent: (event) => {
            rawEvents.push(event);
            streamProgress.onEvent(event);
            const mapped = mapCodexEventToAutoLabOSEvents({
              event,
              runId: run.id,
              node: "implement_experiments",
              agentRole: "implementer",
              workspaceRoot: isolation.workspaceRoot
            });
            for (const item of mapped) {
              const nextItem = translateMappedCodexEventToPrimaryWorkspace(item, {
                fromWorkspaceRoot: isolation.workspaceRoot,
                toWorkspaceRoot: this.deps.workspaceRoot
              });
              if (item.type === "PATCH_APPLIED" && !shouldTrackPatchEvent(item.payload)) {
                continue;
              }
              this.deps.eventStream.emit(nextItem);
              const fileValue = typeof item.payload.file === "string" ? item.payload.file : undefined;
              if (fileValue && item.type === "PATCH_APPLIED") {
                attemptChangedFiles.add(fileValue);
                attemptArtifacts.add(fileValue);
              }
            }
          }
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const recovered = await recoverStructuredResultFromPublicBundle({
            publicDir: isolation.publicDir,
            runDir: isolation.runDir,
            metricsPath: isolation.metricsPath,
            workspaceRoot: isolation.workspaceRoot,
            errorMessage,
            requireFreshPlanAlignment:
              promptTaskSpec.context.plan_changed ||
              Boolean(promptTaskSpec.context.paper_critique_feedback)
          });
          if (!recovered) {
            const verifyReport = buildCodexTurnFailureReport(errorMessage);
            attemptRecords.push({
              attempt,
              summary: verifyReport.summary,
              branch_plan: branchPlan,
              localization: actualSearchLocalization,
              search_localization: searchLocalization,
              verify_report: verifyReport,
              changed_files: [],
              artifacts: [],
              public_artifacts: [],
              raw_response: ""
            });
            await writeJsonFile(path.join(runDir, "verify_report.json"), verifyReport);
            await writeJsonFile(path.join(runDir, "implement_attempts.json"), {
              attempts: attemptRecords
            });
            emitImplementObservation("failed", verifyReport.summary, {
              attempt,
              threadId: activeThreadId,
              publicDir: isolation.publicDir
            });
            await flushProgressUpdates();
            await writeImplementProgressStatus(runDir, {
              status: "failed",
              stage: "failed",
              message: verifyReport.summary,
              startedAt,
              updatedAt: new Date().toISOString(),
              progressCount,
              maxAttempts: MAX_IMPLEMENT_ATTEMPTS,
              threadId: activeThreadId,
              attempt,
              publicDir: isolation.publicDir
            });
            throw new ImplementSessionStopError(verifyReport.summary);
          }
          emitImplementObservation(
            "codex",
            "Recovered implement result from a materialized public bundle after Codex stream failure.",
            {
              attempt,
              threadId: activeThreadId,
              publicDir: isolation.publicDir
            }
          );
          result = recovered;
        }
      }
      streamProgress.flush();

      activeThreadId = result.threadId || activeThreadId;
      queueProgressUpdate("codex", "Codex implementation turn completed.", {
        attempt,
        threadId: activeThreadId,
        publicDir: defaultPublicDir
      });
      const prepared = await this.prepareAttemptResult({
        run,
        workspaceRoot: isolation.workspaceRoot,
        runDir: isolation.runDir,
        defaultPublicDir: isolation.publicDir,
        metricsPath: isolation.metricsPath,
        branchPlan,
        result,
        changedFiles: attemptChangedFiles,
        artifacts: attemptArtifacts,
        publicArtifacts: attemptPublicArtifacts,
        attemptSnapshot: isolation.attemptSnapshot,
        experimentLlmProfile
      });
      const preparedDisplay = translatePreparedAttemptToWorkspace(prepared, {
        fromWorkspaceRoot: isolation.workspaceRoot,
        toWorkspaceRoot: this.deps.workspaceRoot
      });
      prepared.localization = mergeLocalizationResults(
        actualSearchLocalization,
        prepared.localization,
        inferLocalizationFromArtifacts({
          changedFiles: prepared.changedFiles,
          scriptPath: prepared.scriptPath,
          publicDir: prepared.publicDir
        })
      );

      emitImplementObservation("localize", formatLocalizationSummary(prepared.localization), {
        attempt,
        threadId: activeThreadId,
        publicDir: prepared.publicDir,
        scriptPath: prepared.scriptPath,
        runCommand: prepared.runCommand,
        testCommand: prepared.testCommand
      });

      const verifyReport = await this.verifyAttempt(prepared, abortSignal, run.id, attempt, (text, extras) => {
        queueProgressUpdate("verify", text, {
          attempt,
          threadId: activeThreadId,
          publicDir: prepared.publicDir,
          scriptPath: prepared.scriptPath,
          runCommand: prepared.runCommand,
          testCommand: prepared.testCommand,
          ...extras
        });
      });
      prepared.verifyReport = verifyReport;
      finalAttempt = prepared;
      attemptRecords.push({
        attempt,
        summary: preparedDisplay.summary,
        branch_plan: branchPlan,
        localization: preparedDisplay.localization,
        search_localization: searchLocalization,
        verify_report: verifyReport,
        reflection:
          verifyReport.status === "fail"
            ? await this.saveFailureReflection({
                episodeMemory,
                run,
                taskSpec,
                branchPlan,
                attempt,
                verifyReport,
                prepared: preparedDisplay,
                searchLocalization
              })
            : undefined,
        changed_files: preparedDisplay.changedFiles,
        artifacts: preparedDisplay.artifacts,
        public_artifacts: preparedDisplay.publicArtifacts,
        raw_response: prepared.rawResponse,
        restored_after_failure: false,
        restored_paths: []
      });
      await writeJsonFile(path.join(runDir, "verify_report.json"), verifyReport);
      await writeJsonFile(path.join(runDir, "implement_attempts.json"), {
        attempts: attemptRecords
      });
      recentReflections = await episodeMemory.recent(run.id, "implement_experiments", 3);
      isolation.attemptSnapshot?.markCreatedPaths([
        prepared.scriptPath,
        prepared.metricsPath,
        prepared.publicDir,
        ...prepared.changedFiles,
        ...prepared.artifacts,
        ...prepared.publicArtifacts
      ]);

      if (verifyReport.status !== "fail") {
        finalIsolation = isolation;
        replaceSetContents(changedFiles, preparedDisplay.changedFiles);
        replaceSetContents(artifacts, preparedDisplay.artifacts);
        replaceSetContents(publicArtifacts, preparedDisplay.publicArtifacts);
        candidateIsolationAttempts.push({
          attempt,
          requested_strategy: requestedIsolationStrategy,
          effective_strategy: isolation.effectiveStrategy,
          fallback_from: isolation.fallbackFrom,
          fallback_reason: isolation.fallbackReason,
          workspace_root: this.deps.workspaceRoot,
          isolated_workspace_root:
            isolation.effectiveStrategy === "attempt_worktree" ? isolation.workspaceRoot : undefined,
          snapshot_root: isolation.attemptSnapshot?.snapshotRoot,
          worktree_path: isolation.worktreePath,
          restored_paths: [],
          restored_after_failure: false,
          cleanup_status: "skipped",
          cleanup_notes: [],
          orphaned_residue_paths: isolation.orphanedResiduePaths,
          started_at: attemptStartedAt,
          finished_at: new Date().toISOString()
        });
        break;
      }

      if (verifyReport.next_action === "stop_for_environment" || verifyReport.next_action === "stop_for_policy") {
        finalIsolation = isolation;
        replaceSetContents(changedFiles, preparedDisplay.changedFiles);
        replaceSetContents(artifacts, preparedDisplay.artifacts);
        replaceSetContents(publicArtifacts, preparedDisplay.publicArtifacts);
        candidateIsolationAttempts.push({
          attempt,
          requested_strategy: requestedIsolationStrategy,
          effective_strategy: isolation.effectiveStrategy,
          fallback_from: isolation.fallbackFrom,
          fallback_reason: isolation.fallbackReason,
          workspace_root: this.deps.workspaceRoot,
          isolated_workspace_root:
            isolation.effectiveStrategy === "attempt_worktree" ? isolation.workspaceRoot : undefined,
          snapshot_root: isolation.attemptSnapshot?.snapshotRoot,
          worktree_path: isolation.worktreePath,
          restored_paths: [],
          restored_after_failure: false,
          cleanup_status: "skipped",
          cleanup_notes: [],
          orphaned_residue_paths: isolation.orphanedResiduePaths,
          started_at: attemptStartedAt,
          finished_at: new Date().toISOString()
        });
        break;
      }
      if (attempt >= MAX_IMPLEMENT_ATTEMPTS) {
        finalIsolation = isolation;
        replaceSetContents(changedFiles, preparedDisplay.changedFiles);
        replaceSetContents(artifacts, preparedDisplay.artifacts);
        replaceSetContents(publicArtifacts, preparedDisplay.publicArtifacts);
        candidateIsolationAttempts.push({
          attempt,
          requested_strategy: requestedIsolationStrategy,
          effective_strategy: isolation.effectiveStrategy,
          fallback_from: isolation.fallbackFrom,
          fallback_reason: isolation.fallbackReason,
          workspace_root: this.deps.workspaceRoot,
          isolated_workspace_root:
            isolation.effectiveStrategy === "attempt_worktree" ? isolation.workspaceRoot : undefined,
          snapshot_root: isolation.attemptSnapshot?.snapshotRoot,
          worktree_path: isolation.worktreePath,
          restored_paths: [],
          restored_after_failure: false,
          cleanup_status: "skipped",
          cleanup_notes: [],
          orphaned_residue_paths: isolation.orphanedResiduePaths,
          started_at: attemptStartedAt,
          finished_at: new Date().toISOString()
        });
        break;
      }

      for (const filePath of preparedDisplay.changedFiles) {
        historicalChangedFiles.add(filePath);
      }
      const restoreResult = await restoreIsolationContextForRetry(isolation);
      if (restoreResult.restoredPaths.length > 0 || isolation.effectiveStrategy === "attempt_snapshot_restore") {
        restoredAttemptCount += 1;
      }
      const lastAttempt = attemptRecords.at(-1);
      if (lastAttempt) {
        lastAttempt.restored_after_failure = true;
        lastAttempt.restored_paths = restoreResult.restoredPaths;
      }
      await writeJsonFile(path.join(runDir, "implement_attempts.json"), {
        attempts: attemptRecords
      });
      replaceSetContents(changedFiles, []);
      replaceSetContents(artifacts, []);
      replaceSetContents(publicArtifacts, []);
      emitImplementObservation(
        "attempt",
        `Restored ${restoreResult.restoredPaths.length} path(s) before retrying the next candidate branch.`,
        {
          attempt,
          threadId: activeThreadId,
          publicDir: defaultPublicDir
        }
      );
      const retryIsolationAttempt: CandidateIsolationAttemptReport = {
        attempt,
        requested_strategy: requestedIsolationStrategy,
        effective_strategy: isolation.effectiveStrategy,
        fallback_from: isolation.fallbackFrom,
        fallback_reason: isolation.fallbackReason,
        workspace_root: this.deps.workspaceRoot,
        isolated_workspace_root:
          isolation.effectiveStrategy === "attempt_worktree" ? isolation.workspaceRoot : undefined,
        snapshot_root: isolation.attemptSnapshot?.snapshotRoot,
        worktree_path: isolation.worktreePath,
        restored_paths: restoreResult.restoredPaths,
        restored_after_failure: true,
        cleanup_status: "completed",
        cleanup_notes: [],
        orphaned_residue_paths: isolation.orphanedResiduePaths,
        started_at: attemptStartedAt,
        finished_at: new Date().toISOString()
      };
      candidateIsolationAttempts.push(retryIsolationAttempt);
      const retryCleanup = await cleanupIsolationContext(isolation);
      retryIsolationAttempt.cleanup_status = retryCleanup.status;
      retryIsolationAttempt.cleanup_notes = retryCleanup.notes;
    }

    if (!finalAttempt) {
      throw new Error("Codex implementation session did not return an implementation attempt.");
    }
    if (finalIsolation?.effectiveStrategy === "attempt_worktree") {
      finalAttempt = await materializeWorktreeAttemptToPrimaryWorkspace(finalAttempt, {
        fromWorkspaceRoot: finalIsolation.workspaceRoot,
        toWorkspaceRoot: this.deps.workspaceRoot
      });
    }
    if (finalIsolation) {
      const cleanup = await cleanupIsolationContext(finalIsolation);
      const lastIsolationAttempt = candidateIsolationAttempts.at(-1);
      if (lastIsolationAttempt) {
        lastIsolationAttempt.cleanup_status = cleanup.status;
        lastIsolationAttempt.cleanup_notes = cleanup.notes;
      }
    }

    const publishedArtifacts = await publishReusableArtifacts({
      changedFiles: [...changedFiles],
      artifacts: [...artifacts],
      explicitPublicArtifacts: [...publicArtifacts],
      runDir,
      publicDir: finalAttempt.publicDir
    });
    for (const filePath of publishedArtifacts) {
      changedFiles.add(filePath);
      publicArtifacts.add(filePath);
      artifacts.add(filePath);
    }

    let publishedScriptPath = finalAttempt.scriptPath;
    if (publishedScriptPath && isSubpath(publishedScriptPath, runDir)) {
      const candidate = path.join(finalAttempt.publicDir, path.relative(runDir, publishedScriptPath));
      if (await fileExists(candidate)) {
        publishedScriptPath = candidate;
      }
    }

    const rewrittenRunCommand = rewriteCommandScriptPath(
      finalAttempt.runCommand,
      finalAttempt.originalScriptPath,
      publishedScriptPath
    );
    const rewrittenTestCommand = rewriteCommandScriptPath(
      finalAttempt.testCommand || "",
      finalAttempt.originalScriptPath,
      publishedScriptPath
    ) || undefined;
    const workspaceChangedFiles = collectWorkspaceChangedFiles({
      changedFiles: [...changedFiles],
      workspaceRoot: this.deps.workspaceRoot,
      publicDir: finalAttempt.publicDir
    });
    const workspaceChangedManifestPath = path.join(finalAttempt.publicDir, "workspace_changed_files.json");
    await writeJsonFile(workspaceChangedManifestPath, {
      workspace_root: this.deps.workspaceRoot,
      files: workspaceChangedFiles,
      updated_at: new Date().toISOString()
    });
    publicArtifacts.add(workspaceChangedManifestPath);
    artifacts.add(workspaceChangedManifestPath);
    const summary = formatImplementSummary(finalAttempt.summary, finalAttempt.experimentMode, finalAttempt.verifyReport);

    const latestRun = (await this.deps.runStore.getRun(run.id)) || run;
    if (activeThreadId && latestRun.nodeThreads.implement_experiments !== activeThreadId) {
      latestRun.nodeThreads.implement_experiments = activeThreadId;
      await this.deps.runStore.updateRun(latestRun);
    }

    const finalLocalization =
      finalAttempt.localization.selected_files.length > 0 || finalAttempt.localization.candidates.length > 0
        ? finalAttempt.localization
        : mergeLocalizationResults(
            latestSearchLocalization,
            undefined,
            inferLocalizationFromArtifacts({
              changedFiles: [...changedFiles],
              scriptPath: publishedScriptPath,
              publicDir: finalAttempt.publicDir
            })
          );
    const finalVerifyReport = {
      ...finalAttempt.verifyReport,
      command: rewrittenTestCommand || finalAttempt.verifyReport.command
    };
    const baseAutoHandoff = shouldAutoHandoffToRunExperiments(finalVerifyReport);
    const autoHandoffToRunExperiments = baseAutoHandoff && !(taskSpec.context.plan_changed && workspaceChangedFiles.length === 0);
    const handoffReason = autoHandoffToRunExperiments
      ? buildRunExperimentsHandoffReason(finalVerifyReport)
      : undefined;
    const savedLongTermMemory =
      finalVerifyReport.status === "pass"
        ? await saveSuccessfulImplementationMemory(longTermStore, {
            run,
            attempt: finalAttempt,
            taskSpec,
            verifyReport: finalVerifyReport,
            localization: finalLocalization
          })
        : undefined;
    const finalLongTermMemory: LongTermMemorySnapshot = {
      search_queries: taskSpec.context.long_term_memory.search_queries,
      retrieved: taskSpec.context.long_term_memory.retrieved,
      saved: savedLongTermMemory
    };
    if (savedLongTermMemory) {
      emitImplementObservation("publish", `Saved long-term implementation lesson ${savedLongTermMemory.id}.`, {
        threadId: activeThreadId,
        publicDir: finalAttempt.publicDir,
        scriptPath: publishedScriptPath,
        runCommand: rewrittenRunCommand,
        testCommand: rewrittenTestCommand
      });
    }

    await runContext.put("implement_experiments.thread_id", activeThreadId);
    await runContext.put("implement_experiments.task_spec", taskSpec);
    await runContext.put("implement_experiments.plan_hash", taskSpec.context.plan_hash);
    await runContext.put("implement_experiments.long_term_memory", finalLongTermMemory);
    await runContext.put("implement_experiments.long_term_entry", savedLongTermMemory || null);
    await runContext.put("implement_experiments.auto_handoff_to_run_experiments", autoHandoffToRunExperiments);
    await runContext.put("implement_experiments.pending_handoff_to_run_experiments", autoHandoffToRunExperiments);
    await runContext.put("implement_experiments.handoff_reason", handoffReason || null);
    await runContext.put("implement_experiments.localization", finalLocalization);
    await runContext.put("implement_experiments.search_localization", latestSearchLocalization);
    await runContext.put("implement_experiments.current_branch", finalAttempt.branchPlan);
    await runContext.put("implement_experiments.branch_history", attemptRecords.map((record) => record.branch_plan));
    await runContext.put("implement_experiments.recent_reflections", recentReflections);
    await runContext.put("implement_experiments.attempts", attemptRecords);
    await runContext.put("implement_experiments.attempt_count", attemptRecords.length);
    await runContext.put("implement_experiments.verify_report", finalVerifyReport);
    await runContext.put("implement_experiments.failure_type", finalVerifyReport.failure_type);
    await runContext.put("implement_experiments.run_command", rewrittenRunCommand);
    await runContext.put("implement_experiments.test_command", rewrittenTestCommand);
    await runContext.put("implement_experiments.changed_files", [...changedFiles]);
    await runContext.put("implement_experiments.artifacts", [...artifacts]);
    await runContext.put("implement_experiments.public_dir", finalAttempt.publicDir);
    await runContext.put("implement_experiments.public_artifacts", [...publicArtifacts]);
    await runContext.put("implement_experiments.workspace_changed_files", workspaceChangedFiles);
    await runContext.put("implement_experiments.mode", finalAttempt.experimentMode);
    await runContext.put("implement_experiments.llm_profile", experimentLlmProfile);
    await runContext.put("implement_experiments.metrics_path", finalAttempt.metricsPath);
    await runContext.put("implement_experiments.script", publishedScriptPath);
    await runContext.put("implement_experiments.cwd", finalAttempt.workingDir);
    await runContext.put("implement_experiments.last_summary", summary);
    await runContext.put("implement_experiments.raw_response", finalAttempt.rawResponse);
    await runContext.put("implement_experiments.assumptions", finalAttempt.assumptions);
    const candidateIsolationReport: CandidateIsolationReport = {
      version: 1,
      run_id: run.id,
      requested_strategy: requestedIsolationStrategy,
      final_strategy:
        candidateIsolationAttempts.at(-1)?.effective_strategy || requestedIsolationStrategy,
      fallback_occurred: candidateIsolationAttempts.some((attempt) => Boolean(attempt.fallback_from)),
      attempts: candidateIsolationAttempts,
      updated_at: new Date().toISOString()
    };
    await runContext.put("implement_experiments.candidate_isolation_report", candidateIsolationReport);
    const comparisonContract = await loadExperimentComparisonContract(run, runContext);
    const implementationContext = comparisonContract
      ? buildExperimentImplementationContext({
          contract: comparisonContract,
          branchPlan: finalAttempt.branchPlan,
          changedFiles: [...changedFiles],
          scriptPath: publishedScriptPath,
          runCommand: rewrittenRunCommand,
          testCommand: rewrittenTestCommand,
          workingDir: finalAttempt.workingDir,
          threadId: activeThreadId,
          candidateIsolationStrategy: candidateIsolationReport.final_strategy,
          requestedCandidateIsolationStrategy: candidateIsolationReport.requested_strategy,
          fallbackFrom: candidateIsolationAttempts.at(-1)?.fallback_from,
          fallbackReason: candidateIsolationAttempts.at(-1)?.fallback_reason,
          restoredAttempts: restoredAttemptCount,
          snapshotRoot: candidateIsolationAttempts.at(-1)?.snapshot_root,
          worktreePath: candidateIsolationAttempts.at(-1)?.worktree_path,
          cleanupStatus: candidateIsolationAttempts.at(-1)?.cleanup_status,
          orphanedResidueDetected: candidateIsolationAttempts.some(
            (attempt) => attempt.orphaned_residue_paths.length > 0
          )
        })
      : undefined;
    if (implementationContext) {
      await storeExperimentGovernanceDecision(run, runContext, {
        implementationContext,
        candidateIsolationReport,
        entries: []
      });
      await runContext.put(EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY, implementationContext);
    } else {
      await storeExperimentGovernanceDecision(run, runContext, {
        candidateIsolationReport,
        entries: []
      });
    }

    await ensureDir(runDir);
    await writeJsonFile(path.join(runDir, "implement_task_spec.json"), taskSpec);
    await writeJsonFile(path.join(runDir, "long_term_memory_result.json"), finalLongTermMemory);
    await writeJsonFile(path.join(runDir, "localization_search_result.json"), latestSearchLocalization || {});
    await writeJsonFile(path.join(runDir, "branch_search_result.json"), {
      branches: attemptRecords.map((record) => ({
        attempt: record.attempt,
        branch_plan: record.branch_plan,
        verify_report: record.verify_report,
        reflection_id: record.reflection?.episode_id
      })),
      recent_reflections: recentReflections
    });
    await writeJsonFile(path.join(runDir, "localization_result.json"), finalLocalization);
    await writeJsonFile(path.join(runDir, "verify_report.json"), finalVerifyReport);
    await writeJsonFile(path.join(runDir, "implement_attempts.json"), {
      attempts: attemptRecords
    });
    await writeJsonFile(
      path.join(runDir, "experiment_governance", "candidate_isolation_report.json"),
      candidateIsolationReport
    );
    await writeJsonFile(path.join(runDir, "implement_result.json"), {
      thread_id: activeThreadId,
      summary,
      experiment_mode: finalAttempt.experimentMode,
      run_command: rewrittenRunCommand,
      test_command: rewrittenTestCommand,
      working_dir: finalAttempt.workingDir,
      public_dir: finalAttempt.publicDir,
      public_artifacts: [...publicArtifacts],
      llm_profile: experimentLlmProfile,
      metrics_path: finalAttempt.metricsPath,
      script_path: publishedScriptPath,
      changed_files: [...changedFiles],
      artifacts: [...artifacts],
      branch_plan: finalAttempt.branchPlan,
      localization: finalLocalization,
      assumptions: finalAttempt.assumptions,
      verify_report: finalVerifyReport,
      auto_handoff_to_run_experiments: autoHandoffToRunExperiments,
      handoff_reason: handoffReason,
      attempt_count: attemptRecords.length,
      raw_response: finalAttempt.rawResponse,
      raw_event_count: rawEvents.length,
      updated_at: new Date().toISOString()
    });

    const publicOutputs = await publishPublicRunOutputs({
      workspaceRoot: this.deps.workspaceRoot,
      run,
      runContext,
      section: "experiment",
      files: [...publicArtifacts].map((filePath) => ({
        sourcePath: filePath
      })),
      workspaceChangedFiles
    });
    emitImplementObservation("publish", `Public experiment outputs are available at ${publicOutputs.sectionDirRelative}.`, {
      threadId: activeThreadId,
      publicDir: finalAttempt.publicDir,
      scriptPath: publishedScriptPath,
      runCommand: rewrittenRunCommand,
      testCommand: rewrittenTestCommand,
      verificationCommand: finalVerifyReport.command,
      verifyStatus: finalVerifyReport.status
    });

    await flushProgressUpdates();
    await writeImplementProgressStatus(runDir, {
      status: finalVerifyReport.status === "fail" ? "failed" : "completed",
      stage: finalVerifyReport.status === "fail" ? "failed" : "completed",
      message: finalVerifyReport.status === "fail" ? finalVerifyReport.summary : summary,
      startedAt,
      updatedAt: new Date().toISOString(),
      progressCount,
      maxAttempts: MAX_IMPLEMENT_ATTEMPTS,
      threadId: activeThreadId,
      publicDir: finalAttempt.publicDir,
      scriptPath: publishedScriptPath,
      runCommand: rewrittenRunCommand,
      testCommand: rewrittenTestCommand,
      verificationCommand: finalVerifyReport.command,
      verifyStatus: finalVerifyReport.status
    });

    if (finalVerifyReport.status === "fail") {
      throw new Error(finalVerifyReport.summary);
    }

    return {
      summary,
      threadId: activeThreadId,
      runCommand: rewrittenRunCommand,
      testCommand: rewrittenTestCommand,
      scriptPath: publishedScriptPath,
      metricsPath: finalAttempt.metricsPath,
      workingDir: finalAttempt.workingDir,
      experimentMode: finalAttempt.experimentMode,
      publicDir: finalAttempt.publicDir,
      changedFiles: [...changedFiles],
      artifacts: [...artifacts],
      publicArtifacts: [...publicArtifacts],
      rawResponse: finalAttempt.rawResponse,
      verifyReport: finalVerifyReport,
      autoHandoffToRunExperiments,
      handoffReason
    };
  }

  private buildSystemPrompt(
    runDir: string,
    publicDir: string,
    metricsPath: string,
    experimentLlmProfile: ReturnType<typeof resolveExperimentLlmProfile>
  ): string {
    const sandboxRunDir = rewriteWorkspacePathsForSandbox(runDir, this.deps.workspaceRoot);
    const sandboxPublicDir = rewriteWorkspacePathsForSandbox(publicDir, this.deps.workspaceRoot);
    const sandboxMetricsPath = rewriteWorkspacePathsForSandbox(metricsPath, this.deps.workspaceRoot);
    return [
      "You are the AutoLabOS implementer role.",
      "Work directly in the workspace using Codex tools.",
      "Prefer concrete, runnable changes over prose.",
      "Do not modify git history or perform destructive cleanup.",
      `Private AutoLabOS run artifact directory: ${sandboxRunDir}`,
      `Preferred public experiment directory: ${sandboxPublicDir}`,
      `The experiment execution must produce JSON metrics at: ${sandboxMetricsPath}`,
      `Configured real-execution LLM: provider=${experimentLlmProfile.provider}, model=${experimentLlmProfile.model}, reasoning=${experimentLlmProfile.reasoningEffort}, fast_mode=${experimentLlmProfile.fastMode ? "true" : "false"}`,
      "CRITICAL — GPU / device selection (MUST follow for any ML experiment):",
      "Every generated Python script that loads a neural network or language model MUST:",
      "1. Detect the device at startup: device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')",
      "2. Load models onto the detected device: model = AutoModelForCausalLM.from_pretrained(..., device_map='auto', torch_dtype=torch.float16) if CUDA is available, or model.to(device) after loading.",
      "3. Move input tensors to the same device before inference: inputs = {k: v.to(device) for k, v in inputs.items()}",
      "4. Log device info in metrics: torch.cuda.get_device_name(0), torch.cuda.max_memory_allocated().",
      "5. NEVER hardcode CPU-only execution. NEVER omit .to(device) or device_map. Using CPU when a GPU is available is a critical performance bug.",
      "Put reusable code, configs, READMEs, and documentation in the public experiment directory whenever possible.",
      "Use the private run artifact directory only for AutoLabOS metadata, logs, and required metric outputs.",
      "Prefer real executable experiments against actual repo code, benchmarks, and model calls when the workspace supports them.",
      "Use a synthetic validation harness only as a fallback when a real execution path is impossible or clearly underspecified.",
      "Before editing, identify the smallest viable set of files to inspect or change.",
      "Return ONLY one JSON object with keys: summary, experiment_mode, run_command, test_command, working_dir, changed_files, artifacts, public_dir, public_artifacts, script_path, metrics_path, localization, assumptions.",
      "Use experiment_mode = real_execution | hybrid_validation | synthetic_validation.",
      "changed_files, artifacts, and public_artifacts must be arrays of workspace paths.",
      "localization must be an object with keys: summary, strategy, reasoning, selected_files, candidate_files, confidence.",
      "candidate_files must be an array of objects with keys: path, symbol, reason, confidence."
    ].join("\n");
  }

  private async buildTaskSpec(
    run: RunRecord,
    runDir: string,
    publicDir: string,
    metricsPath: string,
    runContext: RunContextMemory,
    longTermMemory: LongTermMemorySnapshot
  ): Promise<ImplementTaskSpec> {
    const plan = trimBlock(await safeRead(path.join(runDir, "experiment_plan.yaml")), 12_000);
    const planHash = plan ? createHash("sha256").update(plan).digest("hex").slice(0, 16) : "";
    const previousPlanHash = await runContext.get<string>("implement_experiments.plan_hash");
    const planChanged = !!(plan && previousPlanHash && planHash !== previousPlanHash);
    const hypotheses = trimBlock(await safeRead(path.join(runDir, "hypotheses.jsonl")), 12_000);
    const previousSummary = await runContext.get<string>("implement_experiments.last_summary");
    const previousRunCommand = await runContext.get<string>("implement_experiments.run_command");
    const previousScript = await runContext.get<string>("implement_experiments.script");
    const runnerFeedback =
      (await runContext.get<RunVerifierReport>("implement_experiments.runner_feedback")) ||
      (await runContext.get<RunVerifierReport>("run_experiments.feedback_for_implementer"));
    const paperCritique = await runContext.get<{
      overall_decision?: string;
      manuscript_type?: string;
      needs_additional_experiments?: boolean;
      manuscript_claim_risk_summary?: string;
      blocking_issues?: Array<{ summary?: string; recommended_fix?: string }>;
    }>("write_paper.paper_critique");
    const paperCritiqueFeedback =
      paperCritique?.needs_additional_experiments || paperCritique?.overall_decision === "backtrack_to_implement"
        ? {
            overall_decision: paperCritique.overall_decision,
            manuscript_type: paperCritique.manuscript_type,
            needs_additional_experiments: paperCritique.needs_additional_experiments,
            blocking_issue_summaries: (paperCritique.blocking_issues || [])
              .map((item) => trimBlock(item.summary || "", 240))
              .filter(Boolean)
              .slice(0, 6),
            recommended_fixes: (paperCritique.blocking_issues || [])
              .map((item) => trimBlock(item.recommended_fix || "", 240))
              .filter(Boolean)
              .slice(0, 6),
            summary: trimBlock(paperCritique.manuscript_claim_risk_summary || "", 500)
          }
        : undefined;
    const cachedConstraintProfile = await runContext.get<CachedConstraintProfile>("constraints.profile");
    const comparisonContract = await loadExperimentComparisonContract(run, runContext);
    const repoListing = await topLevelWorkspaceListing(this.deps.workspaceRoot);
    const sandboxWorkspaceRoot = toSandboxFriendlyWorkspaceRoot(this.deps.workspaceRoot);
    const sandboxRunDir = rewriteWorkspacePathsForSandbox(runDir, this.deps.workspaceRoot);
    const sandboxPublicDir = rewriteWorkspacePathsForSandbox(publicDir, this.deps.workspaceRoot);
    const sandboxMetricsPath = rewriteWorkspacePathsForSandbox(metricsPath, this.deps.workspaceRoot);

    return {
      goal: `Implement a runnable experiment for "${run.topic}" and produce metrics for ${run.objectiveMetric}.`,
      acceptance_criteria: [
        "Return a runnable command for the experiment.",
        `Ensure the workflow can write metrics JSON to ${sandboxMetricsPath}.`,
        "Keep reusable scripts, configs, and documentation in the public experiment directory.",
        "Prefer a real execution path over synthetic validation whenever the workspace supports it."
      ],
      non_goals: [
        "Do not rewrite git history or perform destructive cleanup.",
        "Do not redesign unrelated project structure.",
        "Do not place reusable artifacts only in the private run directory."
      ],
      constraints: [
        ...run.constraints,
        `required_metrics_path=${sandboxMetricsPath}`
      ],
      workspace: {
        root: sandboxWorkspaceRoot,
        run_dir: sandboxRunDir,
        public_dir: sandboxPublicDir,
        metrics_path: sandboxMetricsPath
      },
      context: {
        topic: run.topic,
        objective_metric: run.objectiveMetric,
        plan_excerpt: rewriteWorkspacePathsForSandbox(plan || "(missing)", this.deps.workspaceRoot),
        hypotheses_excerpt: rewriteWorkspacePathsForSandbox(hypotheses || "(missing)", this.deps.workspaceRoot),
        repo_listing: repoListing,
        previous_summary: rewriteWorkspacePathsForSandbox(previousSummary, this.deps.workspaceRoot),
        previous_run_command: rewriteWorkspacePathsForSandbox(previousRunCommand, this.deps.workspaceRoot),
        previous_script: rewriteWorkspacePathsForSandbox(previousScript, this.deps.workspaceRoot),
        long_term_memory: rewriteWorkspacePathsForSandbox(longTermMemory, this.deps.workspaceRoot),
        runner_feedback: rewriteWorkspacePathsForSandbox(runnerFeedback, this.deps.workspaceRoot),
        paper_critique_feedback: rewriteWorkspacePathsForSandbox(
          paperCritiqueFeedback,
          this.deps.workspaceRoot
        ),
        resolved_constraint_profile: rewriteWorkspacePathsForSandbox(cachedConstraintProfile?.profile, this.deps.workspaceRoot),
        comparison_contract: comparisonContract
          ? rewriteWorkspacePathsForSandbox(
              {
                plan_id: comparisonContract.plan_id,
                comparison_mode: comparisonContract.comparison_mode,
                baseline_first_required: comparisonContract.baseline_first_required,
                baseline_candidate_ids: comparisonContract.baseline_candidate_ids,
                budget_profile: comparisonContract.budget_profile,
                evaluator_contract_id: comparisonContract.evaluator_contract_id
              },
              this.deps.workspaceRoot
            )
          : undefined,
        plan_changed: planChanged,
        plan_hash: planHash
      }
    };
  }

  private buildAttemptPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    recentReflections: EpisodeRecord[];
    attempt: number;
    previousAttempt?: AttemptRecord;
    existingChangedFiles: string[];
    historicalChangedFiles: string[];
  }): string {
    const sandboxTaskSpec = rewriteWorkspacePathsForSandbox(params.taskSpec, this.deps.workspaceRoot);
    const sandboxSearchLocalization = rewriteWorkspacePathsForSandbox(params.searchLocalization, this.deps.workspaceRoot);
    const sandboxBranchPlan = rewriteWorkspacePathsForSandbox(params.branchPlan, this.deps.workspaceRoot);
    const sandboxRecentReflections = rewriteWorkspacePathsForSandbox(
      params.recentReflections.map((item) => ({
        attempt: item.attempt,
        error_class: item.error_class,
        lesson: item.lesson,
        next_try_instruction: item.next_try_instruction
      })),
      this.deps.workspaceRoot
    );
    const sandboxExistingChangedFiles = rewriteWorkspacePathsForSandbox(
      params.existingChangedFiles,
      this.deps.workspaceRoot
    );
    const sandboxHistoricalChangedFiles = rewriteWorkspacePathsForSandbox(
      params.historicalChangedFiles,
      this.deps.workspaceRoot
    );
    const sandboxPreviousAttempt = params.previousAttempt
      ? rewriteWorkspacePathsForSandbox(
          {
            verify_report: params.previousAttempt.verify_report,
            localization: params.previousAttempt.localization,
            summary: params.previousAttempt.summary
          },
          this.deps.workspaceRoot
        )
      : undefined;
    const lines = [
      `Implementation attempt ${params.attempt}/${MAX_IMPLEMENT_ATTEMPTS}.`,
      "Task spec:",
      JSON.stringify(sandboxTaskSpec, null, 2),
      "",
      "Implementation protocol:",
      "1. Localize the smallest set of files you need to inspect or edit.",
      "2. Start from the branch focus files unless you find stronger contradictory evidence.",
      "3. Implement the runnable experiment.",
      "4. Provide a lightweight verification command. If nothing else is available, prefer a syntax or compile check.",
      "5. Return only the required JSON object.",
      "",
      "Additional guidance:",
      "Prefer minimal changes and explain localization clearly.",
      "If localization is uncertain, say so in localization.reasoning and candidate_files.",
      "If you create a new script, include it in changed_files and localization.selected_files.",
      "Reuse long-term implementation memory when it directly applies to the current branch focus.",
      "",
      "Hardware / device selection (MANDATORY for all ML scripts):",
      "- At the top of any generated ML script: device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')",
      "- Load models with GPU support: model = AutoModelForCausalLM.from_pretrained(..., device_map='auto', torch_dtype=torch.float16) — this auto-places on GPU.",
      "- If device_map='auto' is not used, MUST call model = model.to(device) immediately after loading.",
      "- Before model.generate() or forward pass, move inputs: inputs = {k: v.to(device) for k, v in inputs.items()}",
      "- In metrics output, include: 'device': str(device), 'gpu_name': torch.cuda.get_device_name(0) if available, 'peak_vram_gb': torch.cuda.max_memory_allocated()/1e9.",
      "- FAILURE TO USE GPU WHEN AVAILABLE IS A BLOCKING BUG. CPU inference on a 3B model takes ~17s/example; GPU takes <0.5s/example.",
      "- If an existing script already exists and uses CPU-only, you MUST patch it to use GPU."
    ];

    lines.push("", "Search-backed localization hints:", JSON.stringify(sandboxSearchLocalization, null, 2));
    lines.push("", "Branch focus:", JSON.stringify(sandboxBranchPlan, null, 2));
    if (sandboxTaskSpec.context.long_term_memory.retrieved.length > 0) {
      lines.push(
        "",
        "Long-term implementation memory:",
        JSON.stringify(sandboxTaskSpec.context.long_term_memory, null, 2)
      );
    }
    if (sandboxTaskSpec.context.runner_feedback) {
      lines.push(
        "",
        "Runner feedback from run_experiments:",
        JSON.stringify(sandboxTaskSpec.context.runner_feedback, null, 2)
      );
    }
    if (sandboxTaskSpec.context.paper_critique_feedback) {
      lines.push(
        "",
        "Post-draft critique requiring stronger experimental evidence:",
        JSON.stringify(sandboxTaskSpec.context.paper_critique_feedback, null, 2),
        "",
        "Treat this as a fresh implementation target. Do NOT reuse the previous script unchanged.",
        "Expand the implementation so the next governed run can add the missing evidence categories called out by the critique when possible within budget."
      );
    }
    if (sandboxTaskSpec.context.comparison_contract) {
      lines.push(
        "",
        "Locked experiment comparison contract:",
        JSON.stringify(sandboxTaskSpec.context.comparison_contract, null, 2),
        "",
        "Do not silently change the comparison metric, baseline binding, or locked budget profile."
      );
    }

    if (sandboxTaskSpec.context.plan_changed) {
      lines.push(
        "",
        "⚠ CRITICAL: The experiment plan has changed since the last implementation (plan hash mismatch).",
        "You MUST re-implement the experiment script to match the new plan.",
        "Do NOT reuse the previous script unchanged. Read the updated plan_excerpt carefully",
        "and ensure the script reflects the new datasets, conditions, baselines, sample sizes,",
        "and evaluation criteria specified in the current plan.",
        "The previous script is provided only as reference for code patterns, not as a valid implementation."
      );
    }

    if (params.recentReflections.length > 0) {
      lines.push("", "Recent failure reflections:", JSON.stringify(sandboxRecentReflections, null, 2));
    }

    if (sandboxExistingChangedFiles.length > 0) {
      lines.push("", "Files already changed in this workspace:", sandboxExistingChangedFiles.join("\n"));
    }
    if (sandboxHistoricalChangedFiles.length > 0) {
      lines.push(
        "",
        "Files touched in previous attempts (now restored unless reintroduced):",
        sandboxHistoricalChangedFiles.join("\n")
      );
    }

    if (sandboxPreviousAttempt) {
      lines.push(
        "",
        "Previous local verification:",
        JSON.stringify(sandboxPreviousAttempt.verify_report, null, 2),
        "",
        "Previous localization:",
        JSON.stringify(sandboxPreviousAttempt.localization, null, 2),
        "",
        "Previous summary:",
        sandboxPreviousAttempt.summary
      );
      if (sandboxPreviousAttempt.verify_report.failure_type === "localization") {
        lines.push("Revisit which files you edit before making another patch.");
      } else if (sandboxPreviousAttempt.verify_report.failure_type === "implementation") {
        lines.push("Keep the fix focused and address the verification failure directly.");
      }
    }

    return lines.join("\n");
  }

  private buildLocalizerInput(
    taskSpec: ImplementTaskSpec,
    previousAttempt: AttemptRecord | undefined,
    existingChangedFiles: string[]
  ): {
    workspaceRoot: string;
    goal: string;
    topic: string;
    objectiveMetric: string;
    constraints: string[];
    planExcerpt: string;
    hypothesesExcerpt: string;
    previousSummary?: string;
    previousFailureSummary?: string;
    previousRunCommand?: string;
    previousScript?: string;
    existingChangedFiles?: string[];
  } {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      goal: taskSpec.goal,
      topic: taskSpec.context.topic,
      objectiveMetric: taskSpec.context.objective_metric,
      constraints: taskSpec.constraints,
      planExcerpt: taskSpec.context.plan_excerpt,
      hypothesesExcerpt: taskSpec.context.hypotheses_excerpt,
      previousSummary: taskSpec.context.previous_summary,
      previousFailureSummary: previousAttempt?.verify_report.summary || taskSpec.context.runner_feedback?.summary,
      previousRunCommand: taskSpec.context.previous_run_command,
      previousScript: taskSpec.context.previous_script,
      existingChangedFiles
    };
  }

  private async prepareAttemptResult(params: {
    workspaceRoot: string;
    run: RunRecord;
    runDir: string;
    defaultPublicDir: string;
    metricsPath: string;
    branchPlan: BranchPlan;
    result: { threadId?: string; finalText: string };
    changedFiles: Set<string>;
    artifacts: Set<string>;
    publicArtifacts: Set<string>;
    attemptSnapshot?: ImplementAttemptSnapshot;
    experimentLlmProfile: ReturnType<typeof resolveExperimentLlmProfile>;
  }): Promise<PreparedImplementAttempt> {
    const parsedResponse = parseStructuredResponse(params.result.finalText);
    const parsed = parsedResponse.value;
    const normalizedPublicDir =
      normalizeStoredPath(parsed.public_dir, params.workspaceRoot) || params.defaultPublicDir;
    const normalizedMetricsPath =
      normalizeStoredPath(parsed.metrics_path, params.workspaceRoot) || params.metricsPath;
    let normalizedWorkingDir =
      normalizeStoredPath(parsed.working_dir, params.workspaceRoot) || normalizedPublicDir;
    const originalScriptPath =
      normalizeStoredPath(parsed.script_path, params.workspaceRoot) ||
      (await inferScriptPath(params.runDir, normalizedPublicDir, params.workspaceRoot, parsed.run_command));
    let normalizedScriptPath = originalScriptPath;
    let experimentMode = normalizeExperimentMode(parsed.experiment_mode, parsed.summary);

    await params.attemptSnapshot?.capturePaths([
      normalizedPublicDir,
      normalizedMetricsPath
    ]);

    for (const filePath of parsed.changed_files || []) {
      const normalized = normalizeStoredPath(filePath, params.workspaceRoot);
      if (normalized) {
        params.changedFiles.add(normalized);
        params.artifacts.add(normalized);
      }
    }
    for (const filePath of parsed.artifacts || []) {
      const normalized = normalizeStoredPath(filePath, params.workspaceRoot);
      if (normalized) {
        params.artifacts.add(normalized);
      }
    }
    for (const filePath of parsed.public_artifacts || []) {
      const normalized = normalizeStoredPath(filePath, params.workspaceRoot);
      if (normalized) {
        params.publicArtifacts.add(normalized);
        params.artifacts.add(normalized);
      }
    }
    if (normalizedScriptPath) {
      params.changedFiles.add(normalizedScriptPath);
      params.artifacts.add(normalizedScriptPath);
    }

    let baseSummary =
      parsed.summary?.trim() ||
      `Codex implementation session updated ${Math.max(1, params.changedFiles.size)} file(s).`;
    let runCommand =
      parsed.run_command?.trim() ||
      (normalizedScriptPath ? inferRunCommand(normalizedScriptPath, params.workspaceRoot, params.run.id) : "");
    let testCommand = parsed.test_command?.trim() || deriveFallbackTestCommand(normalizedScriptPath);
    const hasRunnableArtifact = Boolean(runCommand || normalizedScriptPath);
    const bundleSupported = supportsRealExecutionBundle({
      topic: params.run.topic,
      objectiveMetric: params.run.objectiveMetric,
      constraints: params.run.constraints
    });
    const needsManagedRealExecutionBundle =
      bundleSupported &&
      (experimentMode !== "real_execution" ||
        /\s--metadata-dir(?:\s|=)/u.test(runCommand) ||
        /\s--metadata-dir(?:\s|=)/u.test(testCommand || ""));

    if (needsManagedRealExecutionBundle) {
      const promoted = await writeRealExecutionBundle({
        run: {
          id: params.run.id,
          title: params.run.title,
          topic: params.run.topic,
          objectiveMetric: params.run.objectiveMetric,
          constraints: params.run.constraints
        },
        runDir: params.runDir,
        publicDir: normalizedPublicDir,
        metricsPath: normalizedMetricsPath,
        experimentLlmProfile: params.experimentLlmProfile,
        timeoutSec: this.deps.config.experiments.timeout_sec,
        allowNetwork: this.deps.config.experiments.allow_network
      });
      experimentMode = promoted.experimentMode;
      baseSummary = promoted.summary;
      runCommand = promoted.runCommand;
      testCommand = promoted.testCommand;
      normalizedScriptPath = promoted.scriptPath;
      normalizedWorkingDir = promoted.workingDir;
      for (const filePath of promoted.publicArtifacts) {
        params.changedFiles.add(filePath);
        params.artifacts.add(filePath);
        params.publicArtifacts.add(filePath);
      }
    }

    const materialized = await materializeDeclaredArtifacts({
      changedFiles: [...params.changedFiles],
      artifacts: [...params.artifacts],
      explicitPublicArtifacts: [...params.publicArtifacts],
      runDir: params.runDir,
      publicDir: normalizedPublicDir,
      scriptPath: normalizedScriptPath
    });
    replaceSetContents(params.changedFiles, materialized.changedFiles);
    replaceSetContents(params.artifacts, materialized.artifacts);
    replaceSetContents(params.publicArtifacts, materialized.publicArtifacts);
    normalizedScriptPath = materialized.scriptPath;

    const localization =
      normalizeLocalizationResult(parsed.localization, params.workspaceRoot) ||
      emptyLocalizationResult();
    runCommand = rewriteWorkspacePathsToPrimary(
      rewriteCommandScriptPath(runCommand, originalScriptPath, normalizedScriptPath),
      params.workspaceRoot
    );
    testCommand =
      rewriteWorkspacePathsToPrimary(
        rewriteCommandScriptPath(testCommand || "", originalScriptPath, normalizedScriptPath),
        params.workspaceRoot
      ) || undefined;
    const verificationCommand = testCommand || deriveFallbackTestCommand(normalizedScriptPath);
    const verificationArtifactCandidates = new Set(
      dedupeStrings([
        ...(normalizedScriptPath ? [normalizedScriptPath] : []),
        ...(verificationCommand
          ? extractWorkspacePathsFromCommand(verificationCommand, normalizedWorkingDir, params.workspaceRoot)
          : [])
      ])
    );
    const missingSupplementalArtifacts = materialized.missingArtifacts.filter(
      (filePath) => !verificationArtifactCandidates.has(filePath)
    );
    const verifyReport = !hasRunnableArtifact
      ? buildMissingArtifactVerifyReport(parsedResponse.isStructured)
      : missingSupplementalArtifacts.length > 0
        ? buildMissingArtifactVerifyReport(parsedResponse.isStructured, {
            missingArtifacts: missingSupplementalArtifacts,
            workspaceRoot: params.workspaceRoot
          })
      : {
          status: "not_run" as const,
          next_action: "handoff_to_run_experiments" as const,
          summary: "Local verification has not run yet."
        };

    return {
      threadId: params.result.threadId,
      branchPlan: params.branchPlan,
      workspaceRoot: params.workspaceRoot,
      rawResponse: params.result.finalText,
      summary: baseSummary,
      runCommand,
      testCommand,
      originalScriptPath,
      scriptPath: normalizedScriptPath,
      metricsPath: normalizedMetricsPath,
      workingDir: normalizedWorkingDir,
      experimentMode,
      publicDir: normalizedPublicDir,
      changedFiles: [...params.changedFiles],
      artifacts: [...params.artifacts],
      publicArtifacts: [...params.publicArtifacts],
      localization,
      assumptions: parsed.assumptions || [],
      verifyReport
    };
  }

  private async saveFailureReflection(args: {
    episodeMemory: EpisodeMemory;
    run: RunRecord;
    taskSpec: ImplementTaskSpec;
    branchPlan: BranchPlan;
    attempt: number;
    verifyReport: VerifyReport;
    prepared: PreparedImplementAttempt;
    searchLocalization: LocalizationResult;
  }): Promise<EpisodeRecord> {
    const lesson = deriveLesson(args.verifyReport.failure_type, args.branchPlan);
    const nextTryInstruction = deriveNextTryInstruction(args.verifyReport, args.branchPlan);
    const reflection = await args.episodeMemory.save({
      run_id: args.run.id,
      node_id: "implement_experiments",
      attempt: args.attempt,
      error_class: args.verifyReport.failure_type || "implementation",
      error_message: args.verifyReport.summary,
      plan_excerpt: trimBlock(
        `${args.taskSpec.goal}\nBranch: ${args.branchPlan.summary}\nRationale: ${args.branchPlan.rationale}`,
        800
      ),
      observations: [
        args.verifyReport.stderr_excerpt || "",
        args.verifyReport.stdout_excerpt || "",
        `Localization: ${formatLocalizationSummary(args.prepared.localization)}`,
        `Search localization: ${formatLocalizationSummary(args.searchLocalization)}`
      ].filter(Boolean),
      lesson,
      next_try_instruction: nextTryInstruction
    });

    this.deps.eventStream.emit({
      type: "REFLECTION_SAVED",
      runId: args.run.id,
      node: "implement_experiments",
      agentRole: "implementer",
      payload: {
        episode_id: reflection.episode_id,
        lesson: reflection.lesson,
        next_try_instruction: reflection.next_try_instruction
      }
    });

    return reflection;
  }

  private async verifyAttempt(
    attempt: PreparedImplementAttempt,
    abortSignal: AbortSignal | undefined,
    runId: string,
    attemptNumber: number,
    onProgress?: (
      text: string,
      extras?: Partial<
        Omit<ImplementProgressStatus, "status" | "stage" | "message" | "startedAt" | "updatedAt" | "progressCount" | "maxAttempts">
      >
    ) => void
  ): Promise<VerifyReport> {
    if (attempt.verifyReport.status === "fail") {
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: attempt.verifyReport.summary
        }
      });
      onProgress?.(attempt.verifyReport.summary, { verifyStatus: "fail" });
      return attempt.verifyReport;
    }

    const command = attempt.testCommand?.trim() || deriveFallbackTestCommand(attempt.scriptPath);
    if (!command) {
      const report: VerifyReport = {
        status: "not_run",
        next_action: "handoff_to_run_experiments",
        summary: "No lightweight local verification command was available."
      };
      onProgress?.(report.summary, { verifyStatus: report.status });
      return report;
    }

    const verificationWorkspaceRoot = await resolveLocalVerificationWorkspaceRoot(
      this.deps.workspaceRoot
    );
    const executionCommand = rewriteWorkspacePathsForExecution(
      command,
      this.deps.workspaceRoot,
      verificationWorkspaceRoot
    );
    const executionCwd =
      rewriteWorkspacePathsForExecution(
        attempt.workingDir,
        this.deps.workspaceRoot,
        verificationWorkspaceRoot
      ) || attempt.workingDir;
    const executionScriptPath = rewriteWorkspacePathsForExecution(
      attempt.scriptPath,
      this.deps.workspaceRoot,
      verificationWorkspaceRoot
    );

    const missingArtifacts = await collectMissingVerificationArtifacts({
      command: executionCommand,
      cwd: executionCwd,
      workspaceRoot: verificationWorkspaceRoot,
      scriptPath: executionScriptPath
    });
    if (missingArtifacts.length > 0) {
      const report = buildMissingArtifactVerifyReport(true, {
        command,
        missingArtifacts,
        workspaceRoot: attempt.workspaceRoot
      });
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: report.summary
        }
      });
      onProgress?.(report.summary, {
        verificationCommand: command,
        verifyStatus: report.status
      });
      return report;
    }

    onProgress?.(`Starting local verification via ${command}.`, {
      verificationCommand: command
    });
    this.deps.eventStream.emit({
      type: "TOOL_CALLED",
      runId,
      node: "implement_experiments",
      agentRole: "implementer",
      payload: {
        command,
        cwd: attempt.workingDir,
        source: "local_verification",
        attempt: attemptNumber
      }
    });

    const obs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
    const baseReport = summarizeVerification(command, attempt.workingDir, obs, attempt.localization);

    if (baseReport.status === "fail") {
      this.deps.eventStream.emit({
        type: "TEST_FAILED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          command,
          cwd: attempt.workingDir,
          failure_type: baseReport.failure_type,
          stderr: baseReport.stderr_excerpt || baseReport.summary,
          attempt: attemptNumber
        }
      });
      onProgress?.(baseReport.summary, {
        verificationCommand: command,
        verifyStatus: baseReport.status
      });
      return baseReport;
    }

    const pythonLiteralLeak = await detectPythonJsonLiteralLeak(executionScriptPath);
    if (pythonLiteralLeak) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonLiteralLeak,
        summary: buildVerificationFailureSummary(command, "implementation", pythonLiteralLeak)
      };
      this.deps.eventStream.emit({
        type: "TEST_FAILED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          command,
          cwd: attempt.workingDir,
          failure_type: report.failure_type,
          stderr: report.stderr_excerpt || report.summary,
          attempt: attemptNumber
        }
      });
      onProgress?.(report.summary, {
        verificationCommand: command,
        verifyStatus: report.status
      });
      return report;
    }

    this.deps.eventStream.emit({
      type: "OBS_RECEIVED",
      runId,
      node: "implement_experiments",
      agentRole: "implementer",
      payload: {
        text: baseReport.summary
      }
    });
    onProgress?.(baseReport.summary, {
      verificationCommand: command,
      verifyStatus: baseReport.status
    });
    return baseReport;
  }
}

async function writeImplementProgressStatus(runDir: string, status: ImplementProgressStatus): Promise<void> {
  await writeJsonFile(path.join(runDir, IMPLEMENT_PROGRESS_STATUS_ARTIFACT), status);
}

async function appendImplementProgressItem(
  runDir: string,
  item: {
    index: number;
    timestamp: string;
    stage: ImplementProgressStage;
    message: string;
    attempt?: number;
    threadId?: string;
    verifyStatus?: VerifyReport["status"];
  }
): Promise<void> {
  const filePath = normalizeFsPath(path.join(runDir, IMPLEMENT_PROGRESS_LOG_ARTIFACT));
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(item)}\n`, "utf8");
}

function createCodexProgressEmitter(onText: (text: string) => void): {
  onEvent: (event: CodexEvent) => void;
  flush: () => void;
} {
  const state = {
    buffer: "",
    lastEmitMs: 0
  };

  const emitBuffer = () => {
    const text = oneLine(state.buffer);
    if (!text) {
      state.buffer = "";
      return;
    }
    onText(text);
    state.buffer = "";
    state.lastEmitMs = Date.now();
  };

  return {
    onEvent(event: CodexEvent) {
      const delta = extractEventDelta(event);
      if (delta) {
        state.buffer += delta;
        const now = Date.now();
        const hasBreak = /[\n\r]/u.test(state.buffer);
        const longEnough = state.buffer.length >= 24;
        if (state.lastEmitMs === 0) {
          state.lastEmitMs = now;
        }
        const stale = now - state.lastEmitMs >= 350;
        if (hasBreak || longEnough || stale) {
          emitBuffer();
        }
        return;
      }

      const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
      if (type.endsWith(".completed") || type === "response.completed" || type === "item.completed") {
        emitBuffer();
      }
    },
    flush() {
      emitBuffer();
    }
  };
}

function extractEventDelta(event: CodexEvent): string {
  if (!event || typeof event !== "object") {
    return "";
  }
  const type = typeof event.type === "string" ? event.type : "";
  if (!type.includes("delta")) {
    return "";
  }

  const direct =
    (typeof event.delta === "string" ? event.delta : "") ||
    (typeof event.text === "string" ? event.text : "") ||
    extractTextFromUnknown((event as Record<string, unknown>).item) ||
    extractTextFromUnknown((event as Record<string, unknown>).content);

  return direct;
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromUnknown(item)).join("");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct =
    (typeof record.text === "string" ? record.text : "") ||
    (typeof record.output_text === "string" ? record.output_text : "") ||
    (typeof record.delta === "string" ? record.delta : "");
  if (direct) {
    return direct;
  }

  return extractTextFromUnknown(record.content);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function parseStructuredResponse(text: string): ParsedStructuredImplementResponse {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return {
      value: {},
      isStructured: false
    };
  }
  const record = parsed as Record<string, unknown>;
  return {
    value: {
      summary: asString(record.summary),
      run_command: asString(record.run_command),
      test_command: asString(record.test_command),
      working_dir: asString(record.working_dir),
      experiment_mode: asString(record.experiment_mode),
      changed_files: asStringArray(record.changed_files),
      artifacts: asStringArray(record.artifacts),
      public_dir: asString(record.public_dir),
      public_artifacts: asStringArray(record.public_artifacts),
      script_path: asString(record.script_path),
      metrics_path: asString(record.metrics_path),
      localization: record.localization,
      assumptions: asStringArray(record.assumptions)
    },
    isStructured: true
  };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeStoredPath(filePath: string | undefined, workspaceRoot: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const candidate = mapAliasedWorkspacePathToPrimary(filePath, workspaceRoot);
  const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
  if (!isPathInsideOrEqual(resolved, workspaceRoot)) {
    return undefined;
  }
  return resolved;
}

function trimBlock(text: string, limit: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}\n...<truncated>`;
}

function toSandboxFriendlyWorkspaceRoot(workspaceRoot: string): string {
  return resolveWorkspaceRootAliases(workspaceRoot)[0] || workspaceRoot;
}

function resolveWorkspaceRootAliases(workspaceRoot: string): string[] {
  const aliases = new Set<string>();
  const push = (value: string | undefined) => {
    if (value) {
      aliases.add(value);
    }
  };

  push(preferSandboxAlias(workspaceRoot));
  push(workspaceRoot);

  if (workspaceRoot === "/private/tmp" || workspaceRoot.startsWith("/private/tmp/")) {
    push(workspaceRoot.replace(/^\/private\/tmp(?=\/|$)/u, "/tmp"));
  }
  if (workspaceRoot === "/tmp" || workspaceRoot.startsWith("/tmp/")) {
    push(workspaceRoot.replace(/^\/tmp(?=\/|$)/u, "/private/tmp"));
  }
  if (workspaceRoot === "/private/var/folders" || workspaceRoot.startsWith("/private/var/folders/")) {
    push(workspaceRoot.replace(/^\/private\/var\/folders(?=\/|$)/u, "/var/folders"));
  }
  if (workspaceRoot === "/var/folders" || workspaceRoot.startsWith("/var/folders/")) {
    push(workspaceRoot.replace(/^\/var\/folders(?=\/|$)/u, "/private/var/folders"));
  }

  return [...aliases];
}

function preferSandboxAlias(value: string): string {
  if (value === "/private/tmp" || value.startsWith("/private/tmp/")) {
    return value.replace(/^\/private\/tmp(?=\/|$)/u, "/tmp");
  }
  if (value === "/private/var/folders" || value.startsWith("/private/var/folders/")) {
    return value.replace(/^\/private\/var\/folders(?=\/|$)/u, "/var/folders");
  }
  return value;
}

function rewriteWorkspacePathsForSandbox<T>(value: T, workspaceRoot: string): T {
  if (typeof value === "string") {
    return rewriteWorkspaceStringForSandbox(value, workspaceRoot) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteWorkspacePathsForSandbox(item, workspaceRoot)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      rewriteWorkspacePathsForSandbox(nested, workspaceRoot)
    ])
  ) as T;
}

function rewriteWorkspaceStringForSandbox(value: string | undefined, workspaceRoot: string): string | undefined {
  if (!value) {
    return value;
  }
  const primary = toSandboxFriendlyWorkspaceRoot(workspaceRoot);
  const aliases = resolveWorkspaceRootAliases(workspaceRoot)
    .filter((alias) => alias !== primary)
    .sort((left, right) => right.length - left.length);

  let rewritten = value;
  for (const alias of aliases) {
    rewritten = rewritten.replaceAll(alias, primary);
  }
  return rewritten;
}

function rewriteWorkspacePathsToPrimary<T>(value: T, workspaceRoot: string): T {
  if (typeof value === "string") {
    return rewriteWorkspaceStringToPrimary(value, workspaceRoot) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteWorkspacePathsToPrimary(item, workspaceRoot)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      rewriteWorkspacePathsToPrimary(nested, workspaceRoot)
    ])
  ) as T;
}

function rewriteWorkspaceStringToPrimary(value: string | undefined, workspaceRoot: string): string | undefined {
  if (!value) {
    return value;
  }
  const aliases = resolveWorkspaceRootAliases(workspaceRoot)
    .filter((alias) => alias !== workspaceRoot)
    .sort((left, right) => right.length - left.length);

  let rewritten = value;
  for (const alias of aliases) {
    rewritten = replaceWorkspaceRootReference(rewritten, alias, workspaceRoot);
  }
  return rewritten;
}

async function resolveLocalVerificationWorkspaceRoot(workspaceRoot: string): Promise<string> {
  for (const alias of resolveWorkspaceRootAliases(workspaceRoot)) {
    if (await fileExists(alias)) {
      return alias;
    }
  }
  return toSandboxFriendlyWorkspaceRoot(workspaceRoot);
}

function rewriteWorkspacePathsForExecution<T>(
  value: T,
  workspaceRoot: string,
  executionWorkspaceRoot: string
): T {
  if (typeof value === "string") {
    return rewriteWorkspaceStringForExecution(
      value,
      workspaceRoot,
      executionWorkspaceRoot
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      rewriteWorkspacePathsForExecution(item, workspaceRoot, executionWorkspaceRoot)
    ) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      rewriteWorkspacePathsForExecution(nested, workspaceRoot, executionWorkspaceRoot)
    ])
  ) as T;
}

function rewriteWorkspaceStringForExecution(
  value: string | undefined,
  workspaceRoot: string,
  executionWorkspaceRoot: string
): string | undefined {
  if (!value) {
    return value;
  }
  const aliases = resolveWorkspaceRootAliases(workspaceRoot)
    .filter((alias) => alias !== executionWorkspaceRoot)
    .sort((left, right) => right.length - left.length);

  let rewritten = value;
  for (const alias of aliases) {
    rewritten = replaceWorkspaceRootReference(rewritten, alias, executionWorkspaceRoot);
  }
  return rewritten;
}

function replaceWorkspaceRootReference(value: string, fromRoot: string, toRoot: string): string {
  if (!value || fromRoot === toRoot) {
    return value;
  }
  const escaped = escapeRegex(fromRoot);
  const pattern = new RegExp(`(^|[\\s"'=:(\\[{,])${escaped}(?=$|[\\/\\s"'=)\\]};,])`, "g");
  return value.replace(pattern, (_match, prefix: string) => `${prefix}${toRoot}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapAliasedWorkspacePathToPrimary(filePath: string, workspaceRoot: string): string {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }
  for (const alias of resolveWorkspaceRootAliases(workspaceRoot)) {
    if (!isPathInsideOrEqual(filePath, alias)) {
      continue;
    }
    const relative = path.relative(alias, filePath);
    return relative ? path.join(workspaceRoot, relative) : workspaceRoot;
  }
  return filePath;
}

async function topLevelWorkspaceListing(workspaceRoot: string): Promise<string> {
  try {
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .slice(0, 80)
      .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`)
      .join("\n");
  } catch {
    return "(unavailable)";
  }
}

async function inferScriptPath(
  runDir: string,
  publicDir: string,
  workspaceRoot: string,
  runCommand?: string
): Promise<string | undefined> {
  const candidates = [
    path.join(publicDir, "experiment.py"),
    path.join(publicDir, "experiment.js"),
    path.join(publicDir, "experiment.sh"),
    path.join(runDir, "experiment.py"),
    path.join(runDir, "experiment.js"),
    path.join(runDir, "experiment.sh")
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  if (runCommand) {
    const token = runCommand
      .split(/\s+/)
      .find((part) => /\.(py|js|sh|mjs|cjs)$/i.test(part.replace(/^['"]|['"]$/g, "")));
    if (token) {
      return normalizeStoredPath(token.replace(/^['"]|['"]$/g, ""), workspaceRoot);
    }
  }

  return undefined;
}

function inferRunCommand(scriptPath: string | undefined, workspaceRoot: string, runId: string): string {
  if (scriptPath) {
    const quoted = JSON.stringify(scriptPath);
    if (/\.py$/i.test(scriptPath)) {
      return `python3 ${quoted}`;
    }
    if (/\.(js|mjs|cjs)$/i.test(scriptPath)) {
      return `node ${quoted}`;
    }
    if (/\.sh$/i.test(scriptPath)) {
      return `bash ${quoted}`;
    }
  }

  const fallback = path.join(workspaceRoot, ".autolabos", "runs", runId, "experiment.py");
  return `python3 ${JSON.stringify(fallback)}`;
}

async function recoverStructuredResultFromPublicBundle(params: {
  publicDir: string;
  runDir: string;
  metricsPath: string;
  workspaceRoot: string;
  errorMessage: string;
  requireFreshPlanAlignment?: boolean;
}): Promise<RunTurnResult | undefined> {
  if (params.requireFreshPlanAlignment) {
    return undefined;
  }
  const entries = await fs.readdir(params.publicDir).catch(() => []);
  const scriptName = entries.find((entry) => /\.(py|js|sh|mjs|cjs)$/i.test(entry));
  if (!scriptName) {
    return undefined;
  }

  const scriptPath = path.join(params.publicDir, scriptName);
  const readmePath = path.join(params.publicDir, "README.md");
  const frozenConfigPath = path.join(params.publicDir, "frozen_config.json");
  const baselineSummaryPath = path.join(params.publicDir, "baseline_summary.json");
  const experimentPlanPath = path.join(params.publicDir, "experiment_plan.yaml");
  if (
    !(await recoveredBundleMatchesCurrentPlan({
      runDir: params.runDir,
      publicDir: params.publicDir,
      scriptPath,
      readmePath,
      frozenConfigPath
    }))
  ) {
    return undefined;
  }
  const publicArtifacts = await filterExistingFiles([
    scriptPath,
    readmePath,
    frozenConfigPath,
    baselineSummaryPath,
    experimentPlanPath
  ]);
  if (publicArtifacts.length === 0) {
    return undefined;
  }

  const runCommand =
    normalizeRecoveredBundleRunCommand(
      (await readRunnableCommandFromReadme(readmePath)) ||
        inferRecoveredBundleRunCommand({
          scriptPath,
          frozenConfigPath,
          publicDir: params.publicDir,
          runDir: params.runDir,
          metricsPath: params.metricsPath
        }),
      params.workspaceRoot
    );
  if (!runCommand) {
    return undefined;
  }
  if (!(await recoveredBundleSatisfiesRetryScope({ frozenConfigPath, runCommand }))) {
    return undefined;
  }

  return {
    finalText: JSON.stringify({
      summary: "Recovered implement result from a materialized public experiment bundle after Codex stream failure.",
      experiment_mode: "real_execution",
      run_command: runCommand,
      test_command: deriveFallbackTestCommand(scriptPath),
      working_dir: params.publicDir,
      changed_files: publicArtifacts,
      artifacts: publicArtifacts,
      public_dir: params.publicDir,
      public_artifacts: publicArtifacts,
      script_path: scriptPath,
      metrics_path: params.metricsPath,
      localization: {
        summary: "Recovered localization from the materialized public experiment bundle after stream failure.",
        selected_files: publicArtifacts,
        candidate_files: publicArtifacts.map((filePath) => ({
          path: filePath,
          reason: "Recovered from an existing public experiment bundle artifact.",
          confidence: 0.7
        }))
      },
      assumptions: [
        `Recovered from materialized public artifacts because Codex stream ended with: ${params.errorMessage}`
      ]
    }),
    events: []
  };
}

async function hasRecoverableExecutionEvidence(publicDir: string, metricsPath: string): Promise<boolean> {
  if (await fileExists(metricsPath)) {
    return true;
  }
  const artifactsDir = path.join(publicDir, "artifacts");
  try {
    const stack = [artifactsDir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isFile()) {
          return true;
        }
        if (entry.isDirectory()) {
          stack.push(fullPath);
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function recoveredBundleMatchesCurrentPlan(args: {
  runDir: string;
  publicDir: string;
  scriptPath: string;
  readmePath: string;
  frozenConfigPath: string;
}): Promise<boolean> {
  const planMtimeMs = await latestMtimeMs([
    path.join(args.runDir, "experiment_plan.yaml"),
    path.join(args.publicDir, "experiment_plan.yaml")
  ]);
  if (planMtimeMs === undefined) {
    return false;
  }
  const implementationMtimeMs = await latestMtimeMs([
    args.scriptPath,
    args.readmePath,
    args.frozenConfigPath
  ]);
  if (implementationMtimeMs === undefined) {
    return false;
  }
  return implementationMtimeMs >= planMtimeMs;
}

async function latestMtimeMs(paths: string[]): Promise<number | undefined> {
  let latest: number | undefined;
  for (const candidatePath of paths) {
    try {
      const stat = await fs.stat(candidatePath);
      latest = latest === undefined ? stat.mtimeMs : Math.max(latest, stat.mtimeMs);
    } catch {
      continue;
    }
  }
  return latest;
}

async function readRunnableCommandFromReadme(readmePath: string): Promise<string | undefined> {
  if (!(await fileExists(readmePath))) {
    return undefined;
  }
  const content = await fs.readFile(readmePath, "utf8").catch(() => "");
  if (!content) {
    return undefined;
  }
  const match = content.match(/```(?:bash|sh)?\n([\s\S]*?)```/u);
  if (!match?.[1]) {
    return undefined;
  }
  const collapsed = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s*\\\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return collapsed || undefined;
}

function normalizeRecoveredBundleRunCommand(
  command: string | undefined,
  workspaceRoot: string
): string | undefined {
  if (!command) {
    return undefined;
  }
  let tokenIndex = 0;
  return command.replace(/"[^"]+"|'[^']+'|\S+/g, (rawToken) => {
    const token = unquoteShellToken(rawToken);
    const currentIndex = tokenIndex;
    tokenIndex += 1;
    if (currentIndex === 0 || token.startsWith("-") || !looksLikeWorkspacePathToken(token)) {
      return rawToken;
    }
    return JSON.stringify(path.resolve(workspaceRoot, token));
  });
}

function looksLikeWorkspacePathToken(token: string): boolean {
  if (!token || path.isAbsolute(token)) {
    return false;
  }
  return (
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith(".autolabos/") ||
    token.startsWith("outputs/") ||
    /\.(py|js|sh|mjs|cjs|json|ya?ml)$/i.test(token)
  );
}

function unquoteShellToken(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function inferRecoveredBundleRunCommand(params: {
  scriptPath: string;
  frozenConfigPath: string;
  publicDir: string;
  runDir: string;
  metricsPath: string;
}): string {
  if (/\.py$/i.test(params.scriptPath)) {
    const segments = [`python3 ${JSON.stringify(params.scriptPath)}`];
    if (path.basename(params.frozenConfigPath) && params.frozenConfigPath !== params.scriptPath) {
      segments.push(`--config ${JSON.stringify(params.frozenConfigPath)}`);
    }
    segments.push(`--public-dir ${JSON.stringify(params.publicDir)}`);
    segments.push(`--run-dir ${JSON.stringify(params.runDir)}`);
    segments.push(`--metrics-path ${JSON.stringify(params.metricsPath)}`);
    return segments.join(" ");
  }
  return inferRunCommand(params.scriptPath, params.publicDir, path.basename(params.runDir));
}

async function recoveredBundleSatisfiesRetryScope(args: {
  frozenConfigPath: string;
  runCommand: string;
}): Promise<boolean> {
  const config = parseJsonObject(await fs.readFile(args.frozenConfigPath, "utf8").catch(() => ""));
  if (!config || typeof config !== "object") {
    return true;
  }
  const record = config as Record<string, unknown>;
  const split = record.split && typeof record.split === "object" ? (record.split as Record<string, unknown>) : undefined;
  const repeats = record.repeats && typeof record.repeats === "object" ? (record.repeats as Record<string, unknown>) : undefined;
  const negativeControl =
    record.negative_control && typeof record.negative_control === "object"
      ? (record.negative_control as Record<string, unknown>)
      : undefined;
  const previousScope =
    negativeControl?.previous_scope && typeof negativeControl.previous_scope === "object"
      ? (negativeControl.previous_scope as Record<string, unknown>)
      : undefined;

  const previousPilotSize =
    asFiniteNumber(previousScope?.pilot_size) ?? asFiniteNumber(split?.previous_local_pilot_size);
  const previousRepeats = asFiniteNumber(previousScope?.repeats);
  if (previousPilotSize === undefined && previousRepeats === undefined) {
    return true;
  }

  const nextPilotSize =
    extractNumericFlag(args.runCommand, "--pilot-size") ?? asFiniteNumber(split?.default_local_pilot_size);
  const nextRepeats =
    extractNumericFlag(args.runCommand, "--repeats") ?? asFiniteNumber(repeats?.default_local_repeats);

  if (previousPilotSize !== undefined && nextPilotSize !== undefined && nextPilotSize > previousPilotSize) {
    return true;
  }
  if (previousRepeats !== undefined && nextRepeats !== undefined && nextRepeats > previousRepeats) {
    return true;
  }
  if (previousPilotSize === undefined && previousRepeats !== undefined && nextRepeats === undefined) {
    return false;
  }
  if (previousRepeats === undefined && previousPilotSize !== undefined && nextPilotSize === undefined) {
    return false;
  }
  return previousPilotSize === undefined && previousRepeats === undefined;
}

function extractNumericFlag(command: string, flag: string): number | undefined {
  const escapedFlag = escapeRegex(flag);
  const pattern = new RegExp(`${escapedFlag}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`, "u");
  const match = command.match(pattern);
  if (!match) {
    return undefined;
  }
  return asFiniteNumber(match[1] || match[2] || match[3]);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeExperimentMode(mode: string | undefined, summary: string | undefined): string {
  const normalized = (mode || "").trim().toLowerCase();
  if (normalized === "real_execution" || normalized === "hybrid_validation" || normalized === "synthetic_validation") {
    return normalized;
  }
  const lowerSummary = (summary || "").toLowerCase();
  if (/(synthetic|simulate|simulated|deterministic metrics)/u.test(lowerSummary)) {
    return "synthetic_validation";
  }
  if (/(hybrid|mixed)/u.test(lowerSummary)) {
    return "hybrid_validation";
  }
  return "real_execution";
}

function formatImplementSummary(summary: string, experimentMode: string, verifyReport?: VerifyReport): string {
  const trimmed = summary.trim();
  let base = trimmed;
  if (!trimmed) {
    base = experimentMode === "synthetic_validation"
      ? "Implemented a synthetic validation experiment."
      : "Implemented a runnable experiment.";
  } else if (trimmed.toLowerCase().includes(experimentMode.replace(/_/g, " "))) {
    base = trimmed;
  } else if (experimentMode === "synthetic_validation") {
    base = `Synthetic validation: ${trimmed}`;
  } else if (experimentMode === "hybrid_validation") {
    base = `Hybrid validation: ${trimmed}`;
  }

  if (!verifyReport) {
    return base;
  }

  if (verifyReport.status === "pass" && verifyReport.command) {
    return `${base} Verified locally with ${verifyReport.command}.`;
  }
  if (verifyReport.status === "not_run") {
    return `${base} Local verification deferred to run_experiments.`;
  }
  return `${base} Local verification failed: ${verifyReport.summary}`;
}

function rewriteCommandScriptPath(
  command: string,
  originalScriptPath: string | undefined,
  publishedScriptPath: string | undefined
): string {
  if (!command || !originalScriptPath || !publishedScriptPath || originalScriptPath === publishedScriptPath) {
    return command;
  }
  const replacements: Array<[string, string]> = [
    [JSON.stringify(originalScriptPath), JSON.stringify(publishedScriptPath)],
    [`'${originalScriptPath}'`, `'${publishedScriptPath}'`],
    [originalScriptPath, publishedScriptPath]
  ];
  let rewritten = command;
  for (const [from, to] of replacements) {
    rewritten = rewritten.split(from).join(to);
  }
  return rewritten;
}

function shouldTrackPatchEvent(payload: Record<string, unknown>): boolean {
  const sourceEvent = typeof payload.source_event === "string" ? payload.source_event.toLowerCase() : "";
  if (!sourceEvent) {
    return false;
  }
  if (sourceEvent === "item.completed" || sourceEvent === "message.completed" || sourceEvent.endsWith(".completed")) {
    return false;
  }
  return (
    sourceEvent.includes("patch") ||
    sourceEvent.includes("file.changed") ||
    sourceEvent.includes("write") ||
    sourceEvent.includes("edit")
  );
}

async function materializeDeclaredArtifacts(params: {
  changedFiles: string[];
  artifacts: string[];
  explicitPublicArtifacts: string[];
  runDir: string;
  publicDir: string;
  scriptPath?: string;
}): Promise<{
  changedFiles: string[];
  artifacts: string[];
  publicArtifacts: string[];
  missingArtifacts: string[];
  scriptPath?: string;
}> {
  const publishedArtifacts = await publishReusableArtifacts({
    changedFiles: params.changedFiles,
    artifacts: params.artifacts,
    explicitPublicArtifacts: params.explicitPublicArtifacts,
    runDir: params.runDir,
    publicDir: params.publicDir
  });
  const publicArtifactCandidates = dedupeStrings([
    ...params.explicitPublicArtifacts,
    ...params.changedFiles.filter((filePath) => isPathInsideOrEqual(filePath, params.publicDir)),
    ...params.artifacts.filter((filePath) => isPathInsideOrEqual(filePath, params.publicDir)),
    ...publishedArtifacts
  ]);
  let scriptPath = params.scriptPath;
  if (scriptPath && isSubpath(scriptPath, params.runDir)) {
    const candidate = path.join(params.publicDir, path.relative(params.runDir, scriptPath));
    if (await fileExists(candidate)) {
      scriptPath = candidate;
      publicArtifactCandidates.push(candidate);
    }
  }
  if (scriptPath && isPathInsideOrEqual(scriptPath, params.publicDir)) {
    publicArtifactCandidates.push(scriptPath);
  }

  const existingChangedFiles = await filterExistingFiles([
    ...params.changedFiles,
    ...publishedArtifacts
  ]);
  const existingArtifacts = await filterExistingFiles([
    ...params.artifacts,
    ...publishedArtifacts,
    ...(scriptPath ? [scriptPath] : [])
  ]);
  const existingPublicArtifacts = await filterExistingFiles(publicArtifactCandidates);
  const missingArtifacts = await filterMissingFiles(
    dedupeStrings([
      ...params.artifacts,
      ...params.explicitPublicArtifacts,
      ...(params.scriptPath ? [params.scriptPath] : [])
    ])
  );

  return {
    changedFiles: existingChangedFiles,
    artifacts: existingArtifacts,
    publicArtifacts: existingPublicArtifacts,
    missingArtifacts,
    scriptPath: scriptPath && (await fileExists(scriptPath)) ? scriptPath : undefined
  };
}

async function publishReusableArtifacts(params: {
  changedFiles: string[];
  artifacts: string[];
  explicitPublicArtifacts: string[];
  runDir: string;
  publicDir: string;
}): Promise<string[]> {
  await ensureDir(params.publicDir);
  const candidates = new Set<string>([...params.changedFiles, ...params.artifacts, ...params.explicitPublicArtifacts]);
  const published = new Set<string>();
  for (const sourcePath of candidates) {
    if (!sourcePath) {
      continue;
    }
    if (isSubpath(sourcePath, params.publicDir)) {
      published.add(sourcePath);
      continue;
    }
    if (!isSubpath(sourcePath, params.runDir) || !isReusablePublicArtifact(sourcePath)) {
      continue;
    }
    if (!(await fileExists(sourcePath))) {
      continue;
    }
    const destinationPath = path.join(params.publicDir, path.relative(params.runDir, sourcePath));
    await ensureDir(path.dirname(destinationPath));
    await fs.copyFile(sourcePath, destinationPath);
    published.add(destinationPath);
  }
  return [...published];
}

function isReusablePublicArtifact(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (
    /^metrics(?:\.|$)/u.test(base) ||
    /^results(?:\.|$)/u.test(base) ||
    base === "implement_result.json" ||
    base === "objective_evaluation.json" ||
    base === "recent_paper_reproducibility.json"
  ) {
    return false;
  }
  const ext = path.extname(base);
  return [
    ".py",
    ".js",
    ".mjs",
    ".cjs",
    ".sh",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".json",
    ".toml",
    ".cfg",
    ".ini"
  ].includes(ext);
}

async function filterExistingFiles(filePaths: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const filePath of dedupeStrings(filePaths)) {
    if (filePath && (await fileExists(filePath))) {
      existing.push(filePath);
    }
  }
  return existing;
}

async function filterMissingFiles(filePaths: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const filePath of dedupeStrings(filePaths)) {
    if (filePath && !(await fileExists(filePath))) {
      missing.push(filePath);
    }
  }
  return missing;
}

function collectWorkspaceChangedFiles(params: {
  changedFiles: string[];
  workspaceRoot: string;
  publicDir: string;
}): string[] {
  const privateDir = path.join(params.workspaceRoot, ".autolabos");
  const outputsDir = path.join(params.workspaceRoot, "outputs");
  return [...new Set(params.changedFiles.map((filePath) => normalizeStoredPath(filePath, params.workspaceRoot)))]
    .filter((filePath): filePath is string => Boolean(filePath))
    .filter((filePath) => isPathInsideOrEqual(filePath, params.workspaceRoot))
    .filter((filePath) => !isPathInsideOrEqual(filePath, privateDir))
    .filter((filePath) => !isPathInsideOrEqual(filePath, outputsDir))
    .filter((filePath) => !isPathInsideOrEqual(filePath, params.publicDir))
    .map((filePath) => path.relative(params.workspaceRoot, filePath).replace(/\\/g, "/"))
    .sort();
}

async function createImplementAttemptSnapshot(params: {
  workspaceRoot: string;
  runDir: string;
  attempt: number;
}): Promise<ImplementAttemptSnapshot> {
  const snapshotRoot = path.join(
    params.runDir,
    "implement_experiments",
    "attempt_snapshots",
    `attempt_${params.attempt}`
  );
  const orphanedResiduePaths: string[] = [];
  try {
    await fs.access(snapshotRoot);
    orphanedResiduePaths.push(snapshotRoot);
  } catch {
    // no prior residue
  }
  await fs.rm(snapshotRoot, { recursive: true, force: true });
  await ensureDir(snapshotRoot);
  const captured = new Map<
    string,
    {
      targetPath: string;
      kind: "file" | "directory" | "missing";
      snapshotPath?: string;
    }
  >();
  const createdPaths = new Set<string>();
  const protectedDir = path.join(params.runDir, "implement_experiments");

  const capturePath = async (filePath: string | undefined) => {
    const normalized = normalizeStoredPath(filePath, params.workspaceRoot);
    if (!normalized || !isPathInsideOrEqual(normalized, params.workspaceRoot)) {
      return;
    }
    if (isPathInsideOrEqual(normalized, protectedDir)) {
      return;
    }
    for (const existingPath of [...captured.keys()]) {
      if (existingPath === normalized || isPathInsideOrEqual(normalized, existingPath)) {
        return;
      }
      if (isPathInsideOrEqual(existingPath, normalized)) {
        captured.delete(existingPath);
      }
    }

    const relativeSnapshotPath = path.join("captured", String(captured.size + 1));
    const snapshotPath = path.join(snapshotRoot, relativeSnapshotPath);
    try {
      const stat = await fs.stat(normalized);
      if (stat.isDirectory()) {
        await ensureDir(path.dirname(snapshotPath));
        await fs.cp(normalized, snapshotPath, { recursive: true });
        captured.set(normalized, {
          targetPath: normalized,
          kind: "directory",
          snapshotPath
        });
        return;
      }
      if (stat.isFile()) {
        await ensureDir(path.dirname(snapshotPath));
        await fs.copyFile(normalized, snapshotPath);
        captured.set(normalized, {
          targetPath: normalized,
          kind: "file",
          snapshotPath
        });
        return;
      }
    } catch {
      captured.set(normalized, {
        targetPath: normalized,
        kind: "missing"
      });
      return;
    }
  };

  return {
    snapshotRoot,
    orphanedResiduePaths,
    async capturePaths(paths) {
      for (const filePath of dedupeStrings(
        paths.filter((item): item is string => typeof item === "string")
      )) {
        await capturePath(filePath);
      }
    },
    markCreatedPaths(paths) {
      for (const filePath of dedupeStrings(paths.filter((item): item is string => typeof item === "string"))) {
        const normalized = normalizeStoredPath(filePath, params.workspaceRoot);
        if (!normalized || isPathInsideOrEqual(normalized, protectedDir)) {
          continue;
        }
        if (!isPathInsideOrEqual(normalized, params.workspaceRoot)) {
          continue;
        }
        createdPaths.add(normalized);
      }
    },
    async restore() {
      const restoredPaths = [...captured.values()]
        .map((entry) => entry.targetPath)
        .sort((left, right) => right.length - left.length);
      for (const filePath of [...createdPaths].sort((left, right) => right.length - left.length)) {
        if (captured.has(filePath)) {
          continue;
        }
        await fs.rm(filePath, { recursive: true, force: true });
      }
      for (const entry of [...captured.values()].sort((left, right) => right.targetPath.length - left.targetPath.length)) {
        if (entry.kind === "missing") {
          await fs.rm(entry.targetPath, { recursive: true, force: true });
          continue;
        }
        await fs.rm(entry.targetPath, { recursive: true, force: true });
        if (entry.snapshotPath) {
          if (entry.kind === "directory") {
            await ensureDir(path.dirname(entry.targetPath));
            await fs.cp(entry.snapshotPath, entry.targetPath, { recursive: true });
          } else {
            await ensureDir(path.dirname(entry.targetPath));
            await fs.copyFile(entry.snapshotPath, entry.targetPath);
          }
        }
      }
      return {
        restoredPaths
      };
    },
    async cleanup() {
      await fs.rm(snapshotRoot, { recursive: true, force: true });
    }
  };
}

function resolveConfiguredCandidateIsolationStrategy(config: AppConfig): CandidateIsolationStrategy {
  const configured = asString(
    (config as AppConfig & {
      experiments?: AppConfig["experiments"] & {
        candidate_isolation?: unknown;
        candidate_isolation_strategy?: unknown;
      };
    }).experiments?.candidate_isolation
  ) || asString(
    (config as AppConfig & {
      experiments?: AppConfig["experiments"] & {
        candidate_isolation_strategy?: unknown;
      };
    }).experiments?.candidate_isolation_strategy
  );
  const envOverride = process.env.AUTOLABOS_CANDIDATE_ISOLATION_STRATEGY;
  const raw = (envOverride || configured || "").trim().toLowerCase();
  if (raw === "attempt_worktree" || raw === "worktree") {
    return "attempt_worktree";
  }
  return "attempt_snapshot_restore";
}

async function createAttemptIsolationContext(params: {
  config: AppConfig;
  workspaceRoot: string;
  run: RunRecord;
  runDir: string;
  defaultPublicDir: string;
  metricsPath: string;
  attempt: number;
  requestedStrategy: CandidateIsolationStrategy;
}): Promise<AttemptIsolationContext> {
  if (params.requestedStrategy !== "attempt_worktree") {
    const attemptSnapshot = await createImplementAttemptSnapshot({
      workspaceRoot: params.workspaceRoot,
      runDir: params.runDir,
      attempt: params.attempt
    });
    return {
      requestedStrategy: params.requestedStrategy,
      effectiveStrategy: "attempt_snapshot_restore",
      controlWorkspaceRoot: params.workspaceRoot,
      workspaceRoot: params.workspaceRoot,
      runDir: params.runDir,
      publicDir: params.defaultPublicDir,
      metricsPath: params.metricsPath,
      attemptSnapshot,
      orphanedResiduePaths: attemptSnapshot.orphanedResiduePaths
    };
  }

  try {
    const worktreePath = resolveAttemptWorktreePath(params.runDir, params.attempt);
    const orphanedResiduePaths = await cleanupAttemptWorktreeResidue({
      workspaceRoot: params.workspaceRoot,
      worktreeRoot: resolveAttemptWorktreeRoot(params.runDir),
      worktreePath
    });
    await assertAttemptWorktreeReady({
      workspaceRoot: params.workspaceRoot,
      runId: params.run.id
    });
    await ensureDir(path.dirname(worktreePath));
    await execFile("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
      cwd: params.workspaceRoot
    });
    const worktreeRunDir = path.join(worktreePath, ".autolabos", "runs", params.run.id);
    const worktreePublicDir = buildPublicExperimentDir(worktreePath, params.run);
    const worktreeMetricsPath = path.join(worktreeRunDir, "metrics.json");
    await ensureDir(worktreeRunDir);
    await ensureDir(worktreePublicDir);
    return {
      requestedStrategy: params.requestedStrategy,
      effectiveStrategy: "attempt_worktree",
      controlWorkspaceRoot: params.workspaceRoot,
      workspaceRoot: worktreePath,
      runDir: worktreeRunDir,
      publicDir: worktreePublicDir,
      metricsPath: worktreeMetricsPath,
      worktreePath,
      orphanedResiduePaths
    };
  } catch (error) {
    const attemptSnapshot = await createImplementAttemptSnapshot({
      workspaceRoot: params.workspaceRoot,
      runDir: params.runDir,
      attempt: params.attempt
    });
    return {
      requestedStrategy: params.requestedStrategy,
      effectiveStrategy: "attempt_snapshot_restore",
      fallbackFrom: "attempt_worktree",
      fallbackReason: `attempt_worktree fallback to snapshot/restore: ${
        error instanceof Error ? error.message : String(error)
      }`,
      controlWorkspaceRoot: params.workspaceRoot,
      workspaceRoot: params.workspaceRoot,
      runDir: params.runDir,
      publicDir: params.defaultPublicDir,
      metricsPath: params.metricsPath,
      attemptSnapshot,
      orphanedResiduePaths: [
        ...(attemptSnapshot.orphanedResiduePaths || [])
      ]
    };
  }
}

async function restoreIsolationContextForRetry(
  isolation: AttemptIsolationContext
): Promise<{ restoredPaths: string[] }> {
  if (isolation.effectiveStrategy === "attempt_snapshot_restore" && isolation.attemptSnapshot) {
    return isolation.attemptSnapshot.restore();
  }
  return { restoredPaths: [] };
}

async function cleanupIsolationContext(isolation: AttemptIsolationContext): Promise<{
  status: "completed" | "failed";
  notes: string[];
}> {
  if (isolation.effectiveStrategy === "attempt_snapshot_restore") {
    if (isolation.attemptSnapshot) {
      await isolation.attemptSnapshot.cleanup();
    }
    return {
      status: "completed",
      notes: []
    };
  }
  if (!isolation.worktreePath) {
    return {
      status: "completed",
      notes: []
    };
  }
  try {
    await cleanupManagedWorktree({
      workspaceRoot: isolation.controlWorkspaceRoot,
      worktreePath: isolation.worktreePath,
      isIsolatedWorkspaceRoot: false
    });
    return {
      status: "completed",
      notes: []
    };
  } catch (error) {
    return {
      status: "failed",
      notes: [error instanceof Error ? error.message : String(error)]
    };
  }
}

async function materializeWorktreeAttemptToPrimaryWorkspace(
  attempt: PreparedImplementAttempt,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): Promise<PreparedImplementAttempt> {
  const translated = translatePreparedAttemptToWorkspace(attempt, params);
  await ensureDir(translated.publicDir);
  const candidates = dedupeStrings([
    attempt.publicDir,
    attempt.scriptPath,
    attempt.metricsPath,
    ...attempt.changedFiles,
    ...attempt.artifacts,
    ...attempt.publicArtifacts
  ]);
  for (const sourcePath of candidates) {
    const normalizedSource = normalizeStoredPath(sourcePath, params.fromWorkspaceRoot);
    if (!normalizedSource || !isPathInsideOrEqual(normalizedSource, params.fromWorkspaceRoot)) {
      continue;
    }
    const targetPath = translatePathBetweenWorkspaces(normalizedSource, params);
    if (!targetPath) {
      continue;
    }
    if (normalizedSource === attempt.publicDir) {
      await ensureDir(targetPath);
      continue;
    }
    await copyPathBetweenRoots(normalizedSource, targetPath);
  }
  return translated;
}

function translateTaskSpecToWorkspace(
  taskSpec: ImplementTaskSpec,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
    runDir: string;
    publicDir: string;
    metricsPath: string;
  }
): ImplementTaskSpec {
  const translated = translateValueBetweenWorkspaces(taskSpec, params);
  translated.workspace = {
    root: params.toWorkspaceRoot,
    run_dir: params.runDir,
    public_dir: params.publicDir,
    metrics_path: params.metricsPath
  };
  return translated;
}

function translateLocalizationResultWorkspace(
  value: LocalizationResult,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): LocalizationResult {
  return translateValueBetweenWorkspaces(value, params);
}

function translateBranchPlanWorkspace(
  value: BranchPlan,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): BranchPlan {
  return translateValueBetweenWorkspaces(value, params);
}

function translateAttemptRecordWorkspace(
  value: AttemptRecord | undefined,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): AttemptRecord | undefined {
  if (!value) {
    return undefined;
  }
  return translateValueBetweenWorkspaces(value, params);
}

function translatePreparedAttemptToWorkspace(
  value: PreparedImplementAttempt,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): PreparedImplementAttempt {
  const translated = translateValueBetweenWorkspaces(value, params);
  translated.workspaceRoot = params.toWorkspaceRoot;
  return translated;
}

function translateMappedCodexEventToPrimaryWorkspace<T extends { payload: Record<string, unknown> }>(
  event: T,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): T {
  return {
    ...event,
    payload: translateValueBetweenWorkspaces(event.payload, params)
  };
}

function translatePathsBetweenWorkspaces(
  values: string[],
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): string[] {
  return dedupeStrings(
    values.map((value) => translatePathBetweenWorkspaces(value, params) || value)
  );
}

function translatePathBetweenWorkspaces(
  value: string | undefined,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): string | undefined {
  if (!value) {
    return value;
  }
  const normalized = normalizeStoredPath(value, params.fromWorkspaceRoot);
  if (!normalized || !isPathInsideOrEqual(normalized, params.fromWorkspaceRoot)) {
    return translateWorkspaceStringBetweenRoots(value, params);
  }
  const relative = path.relative(params.fromWorkspaceRoot, normalized);
  return normalizeFsPath(
    relative ? path.join(params.toWorkspaceRoot, relative) : params.toWorkspaceRoot
  );
}

function translateValueBetweenWorkspaces<T>(
  value: T,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): T {
  if (typeof value === "string") {
    return translateWorkspaceStringBetweenRoots(value, params) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => translateValueBetweenWorkspaces(item, params)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      translateValueBetweenWorkspaces(nested, params)
    ])
  ) as T;
}

function translateWorkspaceStringBetweenRoots(
  value: string,
  params: {
    fromWorkspaceRoot: string;
    toWorkspaceRoot: string;
  }
): string {
  const aliases = resolveWorkspaceRootAliases(params.fromWorkspaceRoot)
    .concat([params.fromWorkspaceRoot])
    .sort((left, right) => right.length - left.length);
  let rewritten = value;
  for (const alias of aliases) {
    rewritten = replaceWorkspaceRootReference(rewritten, alias, params.toWorkspaceRoot);
  }
  return rewritten;
}

function resolveAttemptWorktreePath(runDir: string, attempt: number): string {
  return path.join(resolveAttemptWorktreeRoot(runDir), `attempt_${attempt}`);
}

function resolveAttemptWorktreeRoot(runDir: string): string {
  return path.join(runDir, "implement_experiments", "attempt_worktrees");
}

async function assertAttemptWorktreeReady(params: {
  workspaceRoot: string;
  runId: string;
}): Promise<void> {
  const repoRoot = normalizeFsPath(
    (await execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd: params.workspaceRoot
    })).stdout.trim()
  );
  if (repoRoot !== normalizeFsPath(params.workspaceRoot)) {
    throw new Error("attempt_worktree requires the workspace root to be the git repository root");
  }

  const blockingDirtyPaths = await listBlockingWorktreeDirtyPaths(params);
  if (blockingDirtyPaths.length > 0) {
    throw new Error(
      `attempt_worktree requires a clean git workspace outside managed run artifacts; found ${blockingDirtyPaths
        .slice(0, 4)
        .join(", ")}${blockingDirtyPaths.length > 4 ? ", ..." : ""}`
    );
  }
}

async function listBlockingWorktreeDirtyPaths(params: {
  workspaceRoot: string;
  runId: string;
}): Promise<string[]> {
  const statusOutput = (
    await execFile("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: params.workspaceRoot
    })
  ).stdout;
  const allowedPrefixes = [
    normalizeFsPath(path.join(params.workspaceRoot, ".autolabos"))
  ];
  return statusOutput
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((entry) => entry.split(" -> ").at(-1) || entry)
    .map((entry) => normalizeStoredPath(entry, params.workspaceRoot) || "")
    .filter(Boolean)
    .filter(
      (filePath) => !allowedPrefixes.some((prefix) => isPathInsideOrEqual(normalizeFsPath(filePath), prefix))
    );
}

async function cleanupAttemptWorktreeResidue(params: {
  workspaceRoot: string;
  worktreeRoot: string;
  worktreePath: string;
}): Promise<string[]> {
  const orphanedResiduePaths: string[] = [];
  const candidates = new Set<string>();
  try {
    const entries = await fs.readdir(params.worktreeRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      candidates.add(path.join(params.worktreeRoot, entry.name));
    }
  } catch {
    // no managed residue root yet
  }
  candidates.add(params.worktreePath);
  for (const candidatePath of candidates) {
    try {
      await fs.access(candidatePath);
    } catch {
      continue;
    }
    orphanedResiduePaths.push(candidatePath);
    await cleanupManagedWorktree({
      workspaceRoot: params.workspaceRoot,
      worktreePath: candidatePath,
      isIsolatedWorkspaceRoot: false
    });
  }
  return orphanedResiduePaths;
}

async function cleanupManagedWorktree(params: {
  workspaceRoot: string;
  worktreePath: string;
  isIsolatedWorkspaceRoot: boolean;
}): Promise<void> {
  const normalizedWorktreePath = normalizeFsPath(params.worktreePath);
  if (!isManagedAttemptWorktreePath(normalizedWorktreePath, params.workspaceRoot)) {
    throw new Error(`Refusing to cleanup non-managed attempt worktree path: ${normalizedWorktreePath}`);
  }
  const controlCwd = params.isIsolatedWorkspaceRoot ? process.cwd() : params.workspaceRoot;
  try {
    await execFile("git", ["worktree", "remove", "--force", normalizedWorktreePath], {
      cwd: controlCwd
    });
  } catch {
    // Fall back to managed-path cleanup below.
  }
  try {
    await execFile("git", ["worktree", "prune"], {
      cwd: controlCwd
    });
  } catch {
    // best effort only
  }
  await fs.rm(normalizedWorktreePath, { recursive: true, force: true });
}

function isManagedAttemptWorktreePath(worktreePath: string, workspaceRoot: string): boolean {
  const managedRunsRoot = normalizeFsPath(path.join(workspaceRoot, ".autolabos", "runs"));
  const managedAttemptSegment = `${path.sep}implement_experiments${path.sep}attempt_worktrees${path.sep}`;
  return (
    isPathInsideOrEqual(worktreePath, managedRunsRoot) &&
    worktreePath.includes(managedAttemptSegment)
  );
}

async function copyPathBetweenRoots(sourcePath: string, targetPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(sourcePath);
    await fs.rm(targetPath, { recursive: true, force: true });
    await ensureDir(path.dirname(targetPath));
    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.readlink(sourcePath);
      await fs.symlink(linkTarget, targetPath);
      return;
    }
    if (stat.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true });
      return;
    }
    if (stat.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  } catch {
    // Missing ephemeral files do not block materialization.
  }
}

async function listRestorableRunDirEntries(runDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(runDir);
    return entries
      .filter((entry) => !NON_RESTORABLE_RUN_DIR_ENTRIES.has(entry))
      .map((entry) => path.join(runDir, entry));
  } catch {
    return [];
  }
}

function isSubpath(filePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isPathInsideOrEqual(filePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function replaceSetContents(target: Set<string>, values: string[]): void {
  target.clear();
  for (const value of values) {
    target.add(value);
  }
}

function normalizeLocalizationResult(
  value: unknown,
  workspaceRoot: string
): LocalizationResult | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const selectedFiles = (asStringArray(record.selected_files) || [])
    .map((item) => normalizeStoredPath(item, workspaceRoot))
    .filter((item): item is string => Boolean(item));
  const rawCandidates = Array.isArray(record.candidate_files) ? record.candidate_files : [];
  const candidates = rawCandidates
    .map((item) => normalizeLocalizationCandidate(item, workspaceRoot))
    .filter((item): item is LocalizationCandidate => Boolean(item));

  return {
    summary: asString(record.summary),
    strategy: asString(record.strategy),
    reasoning: asString(record.reasoning),
    selected_files: dedupeStrings(selectedFiles),
    candidates,
    confidence: asNumber(record.confidence),
    search_queries: asStringArray(record.search_queries),
    hits: normalizeLocalizationHits(record.hits, workspaceRoot)
  };
}

function normalizeLocalizationCandidate(
  value: unknown,
  workspaceRoot: string
): LocalizationCandidate | undefined {
  if (typeof value === "string") {
    const normalized = normalizeStoredPath(value, workspaceRoot);
    if (!normalized) {
      return undefined;
    }
    return {
      path: normalized,
      reason: "Candidate file selected by implementer."
    };
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalizedPath = normalizeStoredPath(asString(record.path), workspaceRoot);
  if (!normalizedPath) {
    return undefined;
  }
  return {
    path: normalizedPath,
    symbol: asString(record.symbol),
    reason: asString(record.reason) || "Candidate file selected by implementer.",
    confidence: asNumber(record.confidence)
  };
}

function normalizeLocalizationHits(
  value: unknown,
  workspaceRoot: string
): LocalizationSearchHit[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const hits: LocalizationSearchHit[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const normalizedPath = normalizeStoredPath(asString(record.path), workspaceRoot);
    const query = asString(record.query);
    const source = asString(record.source);
    if (
      !normalizedPath ||
      !query ||
      !source ||
      !["search_code", "find_symbol", "list_files"].includes(source)
    ) {
      continue;
    }
    hits.push({
      path: normalizedPath,
      line: asNumber(record.line) || undefined,
      excerpt: asString(record.excerpt),
      query,
      source: source as LocalizationSearchHit["source"]
    });
  }
  return hits;
}

function inferLocalizationFromArtifacts(params: {
  changedFiles: string[];
  scriptPath?: string;
  publicDir?: string;
}): LocalizationResult {
  const selected = dedupeStrings(
    [params.scriptPath, ...params.changedFiles]
      .filter((item): item is string => typeof item === "string")
      .filter((item) => item !== params.publicDir)
      .slice(0, 8)
  );
  return {
    summary: selected.length > 0 ? "Inferred localization from changed files." : "Localization unavailable.",
    strategy: "artifact_inference",
    reasoning:
      selected.length > 0
        ? "Used the generated script path and changed files because the model did not return explicit localization."
        : "No changed files were available to infer localization.",
    selected_files: selected,
    candidates: selected.map((filePath) => ({
      path: filePath,
      reason: "Changed during the implementation attempt."
    }))
  };
}

function emptyLocalizationResult(): LocalizationResult {
  return {
    summary: "Localization unavailable.",
    strategy: "model_localization",
    reasoning: "The implementation response did not include localization metadata.",
    selected_files: [],
    candidates: []
  };
}

async function buildDefaultImplementFocusFiles(taskSpec: ImplementTaskSpec): Promise<string[]> {
  const publicScripts = await listImplementationScripts(taskSpec.workspace.public_dir);
  return dedupeStrings([
    ...publicScripts,
    path.join(taskSpec.workspace.public_dir, "experiment.py"),
    path.join(taskSpec.workspace.run_dir, "experiment_plan.yaml")
  ]);
}

async function listImplementationScripts(publicDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(publicDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(py|js|sh|mjs|cjs)$/i.test(entry.name))
      .map((entry) => path.join(publicDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function chooseBranchPlan(
  searchLocalization: LocalizationResult,
  attemptRecords: AttemptRecord[],
  changedFiles: string[],
  defaultFocusFiles: string[]
): BranchPlan {
  const focusPool = dedupeStrings([
    ...searchLocalization.selected_files,
    ...searchLocalization.candidates.map((candidate) => candidate.path),
    ...changedFiles,
    ...defaultFocusFiles
  ]).filter(isLikelyBranchFocusFile);
  const triedPaths = new Set(
    attemptRecords.flatMap((record) => record.branch_plan.focus_files)
  );
  const primaryPool = focusPool.length > 0
    ? focusPool
    : dedupeStrings([
        ...searchLocalization.selected_files,
        ...searchLocalization.candidates.map((candidate) => candidate.path),
        ...changedFiles,
        ...defaultFocusFiles
      ]);
  const untried = primaryPool.filter((filePath) => !triedPaths.has(filePath));

  if (attemptRecords.length === 0) {
    const focusFiles = primaryPool.slice(0, SEARCH_BRANCH_FOCUS_LIMIT);
    return {
      branch_id: "branch_primary",
      source: "search_primary",
      summary: "Primary search-guided implementation branch.",
      rationale:
        searchLocalization.reasoning ||
        "Use the highest-confidence search-backed candidate files first.",
      focus_files: focusFiles,
      candidate_pool: primaryPool.slice(0, 6)
    };
  }

  if (untried.length > 0) {
    return {
      branch_id: `branch_alternate_${attemptRecords.length + 1}`,
      source: "search_alternate",
      summary: "Alternate search-guided implementation branch.",
      rationale:
        "Prior branch failed local verification, so this branch explores the next-best untried candidates.",
      focus_files: untried.slice(0, SEARCH_BRANCH_FOCUS_LIMIT),
      candidate_pool: primaryPool.slice(0, 6)
    };
  }

  const fallbackFocus = dedupeStrings([
    ...changedFiles,
    ...primaryPool
  ]).slice(0, 2);
  return {
    branch_id: `branch_repair_${attemptRecords.length + 1}`,
    source: "repair_retry",
    summary: "Repair branch that stays close to the previously edited files.",
    rationale:
      "No untried localization candidates remained, so this branch revisits the changed files and strongest prior candidates.",
    focus_files: fallbackFocus,
    candidate_pool: primaryPool.slice(0, 6)
  };
}

async function loadImplementationLongTermMemory(
  longTermStore: LongTermStore,
  run: RunRecord
): Promise<LongTermMemorySnapshot> {
  const queries = buildImplementationMemoryQueries(run);
  const entries = (await longTermStore.readAll()).filter(isImplementationLongTermEntry);
  const retrieved = entries
    .map((entry) => ({
      entry,
      score: scoreImplementationMemoryEntry(entry, queries)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.entry.createdAt) - Date.parse(a.entry.createdAt))
    .slice(0, 3)
    .map((row) => summarizeLongTermEntry(row.entry));

  return {
    search_queries: queries,
    retrieved
  };
}

async function saveSuccessfulImplementationMemory(
  longTermStore: LongTermStore,
  params: {
    run: RunRecord;
    attempt: PreparedImplementAttempt;
    taskSpec: ImplementTaskSpec;
    verifyReport: VerifyReport;
    localization: LocalizationResult;
  }
): Promise<LongTermMemoryHint> {
  const focusFiles = dedupeStrings([
    ...params.attempt.branchPlan.focus_files,
    ...params.localization.selected_files
  ])
    .map((filePath) => path.basename(filePath))
    .slice(0, 4);
  const entry = await longTermStore.append({
    runId: params.run.id,
    category: "implementation",
    text: buildSuccessfulImplementationLesson(params),
    tags: dedupeStrings([
      "implement_experiments",
      params.attempt.experimentMode,
      params.run.topic,
      params.run.objectiveMetric,
      ...focusFiles
    ]).slice(0, 8)
  });
  return summarizeLongTermEntry(entry);
}

function buildImplementationMemoryQueries(run: RunRecord): string[] {
  return dedupeStrings([
    "implement_experiments",
    oneLine(run.topic),
    oneLine(run.objectiveMetric),
    ...run.constraints.map((constraint) => oneLine(constraint)).filter((constraint) => constraint.length <= 80)
  ]).slice(0, 6);
}

function isImplementationLongTermEntry(entry: LongTermEntry): boolean {
  return entry.category === "implementation" || entry.tags.some((tag) => tag.toLowerCase() === "implement_experiments");
}

function scoreImplementationMemoryEntry(entry: LongTermEntry, queries: string[]): number {
  const haystack = `${entry.category}\n${entry.text}\n${entry.tags.join("\n")}`.toLowerCase();
  let score = entry.category === "implementation" ? 5 : 0;
  if (entry.tags.some((tag) => tag.toLowerCase() === "implement_experiments")) {
    score += 3;
  }
  for (const query of queries) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (haystack.includes(normalized)) {
      score += 2;
    }
    if (entry.tags.some((tag) => tag.toLowerCase() === normalized)) {
      score += 2;
    }
  }
  return score;
}

function summarizeLongTermEntry(entry: LongTermEntry): LongTermMemoryHint {
  return {
    id: entry.id,
    category: entry.category,
    text: trimBlock(entry.text, 320),
    tags: entry.tags.slice(0, 8),
    created_at: entry.createdAt
  };
}

function buildSuccessfulImplementationLesson(params: {
  run: RunRecord;
  attempt: PreparedImplementAttempt;
  taskSpec: ImplementTaskSpec;
  verifyReport: VerifyReport;
  localization: LocalizationResult;
}): string {
  const focusFiles = dedupeStrings([
    ...params.attempt.branchPlan.focus_files,
    ...params.localization.selected_files
  ])
    .map((filePath) => path.basename(filePath))
    .slice(0, 4);
  const verificationCommand = params.verifyReport.command || params.attempt.testCommand || "local verification";
  const lesson = [
    `Successful implement_experiments lesson for topic "${params.run.topic}" targeting ${params.run.objectiveMetric}.`,
    focusFiles.length > 0 ? `Prefer the focused files ${focusFiles.join(", ")}.` : "Keep the patch tightly focused.",
    `Verification passed via ${oneLine(verificationCommand)}.`,
    `Keep reusable artifacts in ${path.basename(params.taskSpec.workspace.public_dir)} and metrics at ${path.basename(params.taskSpec.workspace.metrics_path)}.`,
    oneLine(params.attempt.summary)
  ].join(" ");
  return trimBlock(lesson, 480);
}

function shouldAutoHandoffToRunExperiments(verifyReport: VerifyReport): boolean {
  if (verifyReport.status !== "pass") {
    return false;
  }
  return verifyReport.next_action === "accept" || verifyReport.next_action === "handoff_to_run_experiments";
}

function buildRunExperimentsHandoffReason(verifyReport: VerifyReport): string {
  if (verifyReport.status === "pass" && verifyReport.command) {
    return `Local verification passed via ${verifyReport.command}; continue with run_experiments as the second-stage verifier.`;
  }
  if (verifyReport.status === "not_run") {
    return "No lightweight local verification command was available; defer verification to run_experiments.";
  }
  return "Implementation is ready for second-stage verification in run_experiments.";
}

function mergeLocalizationResults(
  searchLocalization: LocalizationResult | undefined,
  modelLocalization: LocalizationResult | undefined,
  fallbackLocalization: LocalizationResult
): LocalizationResult {
  const search = searchLocalization || emptyLocalizationResult();
  const model = modelLocalization || emptyLocalizationResult();
  const selectedFiles = dedupeStrings([
    ...model.selected_files,
    ...search.selected_files,
    ...fallbackLocalization.selected_files
  ]).slice(0, 6);

  const mergedCandidates = mergeLocalizationCandidates([
    ...model.candidates,
    ...search.candidates,
    ...fallbackLocalization.candidates
  ]);

  const confidenceValues = [model.confidence, search.confidence, fallbackLocalization.confidence]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const hits = dedupeLocalizationHits([
    ...(search.hits || []),
    ...(model.hits || [])
  ]);
  const searchQueries = dedupeStrings([
    ...(search.search_queries || []),
    ...(model.search_queries || [])
  ]);

  return {
    summary:
      model.summary ||
      search.summary ||
      fallbackLocalization.summary,
    strategy: dedupeStrings([
      model.strategy || "",
      search.strategy || "",
      fallbackLocalization.strategy || ""
    ])
      .filter(Boolean)
      .join("+"),
    reasoning: [model.reasoning, search.reasoning, fallbackLocalization.reasoning]
      .filter((value): value is string => Boolean(value))
      .join(" | "),
    selected_files: selectedFiles.length > 0 ? selectedFiles : fallbackLocalization.selected_files,
    candidates: mergedCandidates.length > 0 ? mergedCandidates : fallbackLocalization.candidates,
    confidence:
      confidenceValues.length > 0
        ? Math.max(...confidenceValues)
        : fallbackLocalization.confidence,
    search_queries: searchQueries.length > 0 ? searchQueries : undefined,
    hits: hits.length > 0 ? hits : undefined
  };
}

function deriveLesson(
  failureType: ImplementFailureType | undefined,
  branchPlan: BranchPlan
): string {
  if (failureType === "environment") {
    return "The branch failed because the local environment or command was not runnable, not because the patch itself was clearly wrong.";
  }
  if (failureType === "policy") {
    return "The branch failed because the verification command violated the execution policy, so the next attempt should replace the blocked command instead of retrying it.";
  }
  if (failureType === "localization") {
    return `The branch focus ${branchPlan.branch_id} likely targeted the wrong files, so the next branch should pivot to different candidates.`;
  }
  if (failureType === "spec") {
    return "The command or implementation disagreed with the task contract, so the next branch should re-check the required run/test contract.";
  }
  return `The branch focus ${branchPlan.branch_id} was close enough to edit, but the resulting patch still failed local verification.`;
}

function deriveNextTryInstruction(
  verifyReport: VerifyReport,
  branchPlan: BranchPlan
): string {
  if (verifyReport.next_action === "relocalize") {
    return "Select a different branch focus and avoid reusing the same file subset unless new evidence supports it.";
  }
  if (verifyReport.next_action === "stop_for_environment") {
    return "Do not keep patching blindly; resolve the missing runtime dependency or command issue first.";
  }
  if (verifyReport.next_action === "stop_for_policy") {
    return "Do not retry the blocked command; replace it with a policy-compliant local check or hand the verification off safely.";
  }
  if (branchPlan.source === "repair_retry") {
    return "Keep the fix narrow and address the exact local verification failure in the current focus files.";
  }
  return "Try the next branch candidate set and make the smallest patch that addresses the failing verification signal.";
}

function mergeLocalizationCandidates(candidates: LocalizationCandidate[]): LocalizationCandidate[] {
  const merged = new Map<string, LocalizationCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.path);
    if (!existing) {
      merged.set(candidate.path, { ...candidate });
      continue;
    }
    merged.set(candidate.path, {
      path: candidate.path,
      symbol: existing.symbol || candidate.symbol,
      reason: dedupeStrings([existing.reason, candidate.reason]).join("; "),
      confidence: Math.max(existing.confidence || 0, candidate.confidence || 0) || undefined
    });
  }
  return [...merged.values()].slice(0, 8);
}

function dedupeLocalizationHits(hits: LocalizationSearchHit[]): LocalizationSearchHit[] {
  const seen = new Set<string>();
  const out: LocalizationSearchHit[] = [];
  for (const hit of hits) {
    const key = `${hit.source}:${hit.query}:${hit.path}:${hit.line || 0}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  return out.slice(0, 24);
}

function isLikelyBranchFocusFile(filePath: string): boolean {
  if (filePath.includes(`${path.sep}.autolabos${path.sep}`)) {
    return false;
  }
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|sh|json|yaml|yml)$/iu.test(filePath);
}

function formatLocalizationSummary(localization: LocalizationResult): string {
  if (localization.selected_files.length === 0 && localization.candidates.length === 0) {
    return "Localization did not identify any concrete files.";
  }
  const targets = localization.selected_files.length > 0
    ? localization.selected_files
    : localization.candidates.map((candidate) => candidate.path).slice(0, 3);
  return `Localized implementation to: ${targets.join(", ")}`;
}

function deriveFallbackTestCommand(scriptPath: string | undefined): string | undefined {
  if (!scriptPath) {
    return undefined;
  }
  const quoted = JSON.stringify(scriptPath);
  if (/\.py$/i.test(scriptPath)) {
    return `python3 -m py_compile ${quoted}`;
  }
  if (/\.(js|mjs|cjs)$/i.test(scriptPath)) {
    return `node --check ${quoted}`;
  }
  if (/\.sh$/i.test(scriptPath)) {
    return `bash -n ${quoted}`;
  }
  return undefined;
}

function buildMissingArtifactVerifyReport(
  isStructured: boolean,
  options?: {
    command?: string;
    missingArtifacts?: string[];
    workspaceRoot?: string;
  }
): VerifyReport {
  const missingArtifacts = options?.missingArtifacts || [];
  if (missingArtifacts.length > 0) {
    const renderedMissingArtifacts = missingArtifacts
      .map((filePath) => formatArtifactPath(filePath, options?.workspaceRoot))
      .join(", ");
    const summary = options?.command
      ? `Local verification could not start because required artifact(s) were not materialized for ${options.command}: ${renderedMissingArtifacts}`
      : `Implementer referenced artifact(s) that were not materialized: ${renderedMissingArtifacts}`;
    return {
      status: "fail",
      failure_type: "spec",
      next_action: "retry_patch",
      command: options?.command,
      stderr_excerpt: `Missing artifact(s): ${renderedMissingArtifacts}`,
      summary
    };
  }
  return {
    status: "fail",
    failure_type: "spec",
    next_action: "retry_patch",
    summary: isStructured
      ? "Implementer did not return a runnable artifact or run_command."
      : "Implementer did not return the required JSON result or any runnable artifact."
  };
}

function buildCodexTurnFailureReport(errorMessage: string): VerifyReport {
  return {
    status: "fail",
    failure_type: "environment",
    next_action: "stop_for_environment",
    stderr_excerpt: trimBlock(errorMessage, 1200) || errorMessage,
    summary: `Codex execution failed before any runnable implementation was produced: ${errorMessage}`
  };
}

async function collectMissingVerificationArtifacts(params: {
  command: string;
  cwd: string;
  workspaceRoot: string;
  scriptPath?: string;
}): Promise<string[]> {
  const candidates = dedupeStrings([
    ...(params.scriptPath ? [params.scriptPath] : []),
    ...extractWorkspacePathsFromCommand(params.command, params.cwd, params.workspaceRoot)
  ]);
  const missing: string[] = [];
  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      missing.push(candidate);
    }
  }
  return missing.sort();
}

function extractWorkspacePathsFromCommand(command: string, cwd: string, workspaceRoot: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const paths = new Set<string>();
  for (const token of tokens) {
    const normalized = token.replace(/^['"]|['"]$/g, "");
    if (!looksLikeWorkspacePath(normalized)) {
      continue;
    }
    const resolved = normalizeStoredPath(
      path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized),
      workspaceRoot
    );
    if (resolved) {
      paths.add(resolved);
    }
  }
  return [...paths];
}

function looksLikeWorkspacePath(value: string): boolean {
  if (/^[a-z]+:\/\//iu.test(value)) {
    return false;
  }
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.includes("/") ||
    /\.(py|js|mjs|cjs|sh|json|yaml|yml|md|txt|toml|cfg|ini)$/iu.test(value)
  );
}

function formatArtifactPath(filePath: string, workspaceRoot?: string): string {
  if (workspaceRoot && isPathInsideOrEqual(filePath, workspaceRoot)) {
    return path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  }
  return filePath.replace(/\\/g, "/");
}

function summarizeVerification(
  command: string,
  cwd: string,
  obs: AciObservation,
  localization: LocalizationResult
): VerifyReport {
  const stdoutExcerpt = trimBlock(obs.stdout || "", 1200);
  const stderrExcerpt = trimBlock(obs.stderr || "", 1200);
  if (obs.status === "ok") {
    return {
      status: "pass",
      command,
      cwd,
      exit_code: obs.exit_code ?? 0,
      next_action: "accept",
      stdout_excerpt: stdoutExcerpt || undefined,
      stderr_excerpt: stderrExcerpt || undefined,
      summary: `Local verification passed via ${command}.`
    };
  }

  const failureType = classifyVerificationFailure(obs, localization);
  const policyRuleId =
    failureType === "policy" ? obs.policy?.rule_id || extractPolicyRuleId(stderrExcerpt || stdoutExcerpt || "") : undefined;
  return {
    status: "fail",
    command,
    cwd,
    exit_code: obs.exit_code ?? 1,
    failure_type: failureType,
    policy_rule_id: policyRuleId,
    policy_reason: failureType === "policy" ? obs.policy?.reason : undefined,
    next_action:
      failureType === "environment"
        ? "stop_for_environment"
        : failureType === "policy"
          ? "stop_for_policy"
        : failureType === "localization"
          ? "relocalize"
          : "retry_patch",
    stdout_excerpt: stdoutExcerpt || undefined,
    stderr_excerpt: stderrExcerpt || undefined,
    summary: buildVerificationFailureSummary(command, failureType, stderrExcerpt || stdoutExcerpt || "unknown error")
  };
}

async function detectPythonJsonLiteralLeak(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/["'][^"'\\]+["']\s*:\s*(true|false|null)\b/u);
    if (match) {
      return `Python source contains JSON literal ${match[1]} at ${path.basename(scriptPath)}:${index + 1}; use Python ${match[1] === "null" ? "None" : match[1] === "true" ? "True" : "False"} instead.`;
    }
  }

  return undefined;
}

function classifyVerificationFailure(
  obs: AciObservation,
  localization: LocalizationResult
): ImplementFailureType {
  const text = `${obs.stderr || ""}\n${obs.stdout || ""}`.toLowerCase();
  if (obs.policy?.allowed === false || /policy blocked (?:test command|command)/u.test(text)) {
    return "policy";
  }
  if (
    /(command not found|no such file or directory|cannot find module|no module named|not recognized as an internal|enoent)/u
      .test(text)
  ) {
    return "environment";
  }
  if (localization.selected_files.length === 0 && localization.candidates.length === 0) {
    return "localization";
  }
  if (/(usage:|argument error|missing required)/u.test(text)) {
    return "spec";
  }
  return "implementation";
}

function buildVerificationFailureSummary(
  command: string,
  failureType: ImplementFailureType,
  detail: string
): string {
  return `Local verification failed via ${command} (${failureType}): ${oneLine(detail)}`;
}

function extractPolicyRuleId(text: string): string | undefined {
  return text.match(/rule=([a-z0-9_]+)/i)?.[1];
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
