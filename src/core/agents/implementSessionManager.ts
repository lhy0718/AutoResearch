import path from "node:path";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";

import { EventStream } from "../events.js";
import { LLMClient } from "../llm/client.js";
import { RunStore } from "../runs/runStore.js";
import { AppConfig, RunRecord } from "../../types.js";
import { CodexEvent, CodexNativeClient, RunTurnResult } from "../../integrations/codex/codexCliClient.js";
import { mapCodexEventToAutoLabOSEvents } from "../../integrations/codex/codexEventMapper.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { EpisodeMemory, EpisodeRecord } from "../memory/episodeMemory.js";
import { LongTermEntry, LongTermStore } from "../memory/longTermStore.js";
import { ensureDir, fileExists, normalizeFsPath, writeJsonFile } from "../../utils/fs.js";
import { safeRead } from "../nodes/helpers.js";
import { buildPublicExperimentDir } from "../publicArtifacts.js";
import { publishPublicRunOutputs } from "../publicOutputPublisher.js";
import { resolveExperimentLlmProfile } from "../experimentLlmProfile.js";
import {
  ExperimentDesignImplementationValidationReport,
  validateDesignImplementationAlignment,
  validateVerificationCommandSurface
} from "../experiments/designImplementationValidator.js";
import { supportsRealExecutionBundle, writeRealExecutionBundle } from "../experiments/realExecutionBundle.js";
import { RunVerifierReport } from "../experiments/runVerifierFeedback.js";
import { AgentComputerInterface, AciObservation } from "../../tools/aci.js";
import {
  ExperimentComparisonContract,
  buildExperimentImplementationContext,
  CandidateIsolationAttemptReport,
  CandidateIsolationReport,
  EXPERIMENT_GOVERNANCE_DESIGN_IMPLEMENTATION_VALIDATION_KEY,
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
import { EnvironmentSnapshot } from "../environmentSnapshot.js";
import {
  DynamicDecompositionPlan,
  DynamicDecompositionUnit,
  parseDynamicDecompositionPlan
} from "../decompositionPlan.js";

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

const IMPLEMENT_DELTA_PROGRESS_MIN_CHARS = 4_000;
const IMPLEMENT_DELTA_PROGRESS_MIN_MS = 5_000;
const IMPLEMENT_STAGED_LLM_TRANSIENT_RETRY_MAX_ATTEMPTS = 5;
const IMPLEMENT_STAGED_LLM_TRANSIENT_RETRY_DELAY_MS = 1_000;

interface ImplementSessionDeps {
  config: AppConfig;
  codex: CodexNativeClient;
  llm?: LLMClient;
  aci: AgentComputerInterface;
  eventStream: EventStream;
  runStore: RunStore;
  workspaceRoot: string;
}

interface StructuredImplementFileEdit {
  path: string;
  content: string;
}

interface DynamicMaterializationChunk {
  id: string;
  title: string;
  purpose: string;
  content_kind: "code_section" | "config_block" | "documentation_section" | "text_section";
  include_imports?: boolean;
  include_entrypoint?: boolean;
  depends_on?: string[];
  verification_focus?: string[];
}

interface DynamicMaterializationPlan {
  strategy?: string;
  rationale?: string;
  chunks: DynamicMaterializationChunk[];
}

interface PlannedMaterializationSection {
  section: DynamicMaterializationChunk;
  parentChunk?: DynamicMaterializationChunk;
  chunkSubdivisionPlan?: DynamicMaterializationPlan;
  chunkIndex: number;
  chunkTotal: number;
  chunkLabel: string;
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
  decomposition_plan?: DynamicDecompositionPlan;
  file_plan?: string[];
  file_edits?: StructuredImplementFileEdit[];
}

interface ImplementBootstrapRequirement {
  id: string;
  kind: "model" | "tokenizer" | "dataset" | "binary" | "library" | "reference_data" | "service";
  source: "huggingface" | "local" | "python" | "system" | "other";
  required_for: string[];
  local_path?: string;
  availability?: "assumed_local" | "download_required" | "unknown";
  summary?: string;
  remediation?: string;
}

interface ImplementBootstrapCheck {
  id: string;
  check_type: "path_exists" | "command_available" | "python_module_available";
  target: string;
  reason: string;
}

interface ImplementBootstrapContract {
  version: number;
  strategy?: string;
  summary?: string;
  requires_network?: boolean;
  requires_warm_cache?: boolean;
  blocking_reason?: string;
  remediation?: string[];
  requirements: ImplementBootstrapRequirement[];
  checks: ImplementBootstrapCheck[];
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
const IMPLEMENT_PARTIAL_RESPONSE_ARTIFACT = path.join("implement_experiments", "partial_response.txt");
const IMPLEMENT_SCAFFOLD_ARTIFACT = path.join("implement_experiments", "scaffold.json");
const IMPLEMENT_SCAFFOLD_PROMPT_ARTIFACT = path.join("implement_experiments", "scaffold_prompt.txt");
const IMPLEMENT_SCAFFOLD_RAW_RESPONSE_ARTIFACT = path.join("implement_experiments", "scaffold_raw_response.txt");
const IMPLEMENT_DECOMPOSITION_PLAN_ARTIFACT = path.join("implement_experiments", "decomposition_plan.json");
const IMPLEMENT_DECOMPOSITION_PLAN_RAW_RESPONSE_ARTIFACT = path.join(
  "implement_experiments",
  "decomposition_plan_raw_response.txt"
);
const IMPLEMENT_BOOTSTRAP_CONTRACT_ARTIFACT = path.join("implement_experiments", "bootstrap_contract.json");
const IMPLEMENT_BOOTSTRAP_CONTRACT_PROMPT_ARTIFACT = path.join(
  "implement_experiments",
  "bootstrap_contract_prompt.txt"
);
const IMPLEMENT_BOOTSTRAP_CONTRACT_RAW_RESPONSE_ARTIFACT = path.join(
  "implement_experiments",
  "bootstrap_contract_raw_response.txt"
);
const IMPLEMENT_FILE_PLAN_ARTIFACT = path.join("implement_experiments", "file_plan.json");
const IMPLEMENT_UNIT_PLAN_DIR = path.join("implement_experiments", "unit_plans");
const IMPLEMENT_UNIT_SECTION_DIR = path.join("implement_experiments", "unit_sections");
const IMPLEMENT_UNIT_SKELETON_DIR = path.join("implement_experiments", "unit_skeletons");
const IMPLEMENT_UNIT_CHUNK_PROMPT_DIR = path.join("implement_experiments", "unit_chunk_prompts");
const IMPLEMENT_UNIT_CHUNK_RESPONSE_DIR = path.join("implement_experiments", "unit_chunk_responses");
const MAX_DYNAMIC_CHUNK_SUBDIVISION_DEPTH = 3;
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
  execution: {
    runner: AppConfig["experiments"]["runner"];
    timeout_sec: number;
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
    environment_snapshot?: EnvironmentSnapshot;
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
  comparisonContract?: ExperimentComparisonContract;
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

  async run(
    run: RunRecord,
    abortSignal?: AbortSignal,
    environmentSnapshot?: EnvironmentSnapshot
  ): Promise<ImplementSessionSummary> {
    const runContext = new RunContextMemory(run.memoryRefs.runContextPath);
    const episodeMemory = new EpisodeMemory(run.memoryRefs.episodePath);
    const longTermStore = new LongTermStore(run.memoryRefs.longTermPath);
    const runDir = path.join(this.deps.workspaceRoot, ".autolabos", "runs", run.id);
    const metricsPath = path.join(runDir, "metrics.json");
    const defaultPublicDir = buildPublicExperimentDir(this.deps.workspaceRoot, run);
    const experimentLlmProfile = resolveExperimentLlmProfile(this.deps.config);
    const canUseCodexSession = !hasStructuredLlmClient(this.deps.llm);
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
    if (environmentSnapshot) {
      await writeJsonFile(path.join(runDir, "environment_snapshot.json"), environmentSnapshot);
      await runContext.put("implement_experiments.environment_snapshot", environmentSnapshot);
    }
    const longTermMemory = await loadImplementationLongTermMemory(longTermStore, run);
    const taskSpec = await this.buildTaskSpec(
      run,
      runDir,
      defaultPublicDir,
      metricsPath,
      runContext,
      longTermMemory,
      environmentSnapshot
    );
    const useCodexSession =
      canUseCodexSession && !shouldFallbackToStagedImplementLlm(taskSpec.context.previous_summary || "");
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
    emitImplementObservation(
      "preflight",
      `Implementation session starting in ${useCodexSession ? "codex_native" : "staged_llm"} mode.`,
      { publicDir: defaultPublicDir }
    );

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
    let finalDesignImplementationValidation: ExperimentDesignImplementationValidationReport | undefined;
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
      const attemptPrompt = this.buildAttemptPrompt({
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
        }),
        sessionMode: useCodexSession ? "codex_native" : "staged_llm"
      });
      const attemptSystemPrompt = this.buildSystemPrompt(
        isolation.runDir,
        isolation.publicDir,
        isolation.metricsPath,
        experimentLlmProfile,
        useCodexSession ? "codex_native" : "staged_llm",
        taskSpec.context.environment_snapshot
      );

      let result: RunTurnResult;
      const recoveredBeforeTurn = await recoverStructuredResultFromPublicBundle({
        publicDir: isolation.publicDir,
        runDir: isolation.runDir,
        metricsPath: isolation.metricsPath,
        workspaceRoot: isolation.workspaceRoot,
        errorMessage: "Recovered an already materialized governed experiment bundle before re-entering Codex.",
        requireFreshPlanAlignment:
          promptTaskSpec.context.plan_changed ||
          (Boolean(promptTaskSpec.context.runner_feedback) &&
            !isRecoverableBundleCommandRepairFeedback(promptTaskSpec.context.runner_feedback)) ||
          Boolean(promptTaskSpec.context.paper_critique_feedback),
        runnerFeedback: promptTaskSpec.context.runner_feedback
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
          if (useCodexSession) {
            result = await this.deps.codex.runTurnStream({
              prompt: attemptPrompt,
              threadId: activeThreadId,
              agentId: `implementer:${run.id}`,
              systemPrompt: attemptSystemPrompt,
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
            if (this.deps.llm && shouldFallbackToStagedImplementLlm(result.finalText)) {
              emitImplementObservation(
                "codex",
                "Codex implement turn reported a filesystem tooling blocker; retrying this attempt in staged_llm mode.",
                {
                  attempt,
                  threadId: activeThreadId,
                  publicDir: defaultPublicDir
                }
              );
              const llmTimeoutMs = getImplementLlmTimeoutMs(this.deps.config);
              const filesystemFallbackPrompt = this.buildFilesystemFallbackRecoveryPrompt({
                taskSpec,
                searchLocalization,
                branchPlan,
                attempt
              });
              const filesystemFallbackSystemPrompt = appendFilesystemFallbackOverrideToPrompt(attemptSystemPrompt);
              const completion = await this.completeStagedLlmImplementationBundle({
                runDir,
                workspaceRoot: isolation.workspaceRoot,
                taskSpec: promptTaskSpec,
                searchLocalization: promptSearchLocalization,
                branchPlan: promptBranchPlan,
                scaffoldPrompt: filesystemFallbackPrompt,
                systemPrompt: filesystemFallbackSystemPrompt,
                timeoutMs: llmTimeoutMs,
                abortSignal,
                attempt,
                threadId: activeThreadId,
                publicDir: defaultPublicDir,
                emitImplementObservation,
                reasoningEffort: experimentLlmProfile.reasoningEffort
              });
              result = {
                threadId: completion.threadId || activeThreadId,
                finalText: completion.text,
                events: []
              };
            }
          } else {
            if (!this.deps.llm) {
              throw new Error("implement_experiments is configured for staged_llm mode, but no LLM client is available.");
            }
            const llmTimeoutMs = getImplementLlmTimeoutMs(this.deps.config);
            const completion = await this.completeStagedLlmImplementationBundle({
              runDir,
              workspaceRoot: isolation.workspaceRoot,
              taskSpec: promptTaskSpec,
              searchLocalization: promptSearchLocalization,
              branchPlan: promptBranchPlan,
              scaffoldPrompt: attemptPrompt,
              systemPrompt: attemptSystemPrompt,
              timeoutMs: llmTimeoutMs,
              abortSignal,
              attempt,
              threadId: activeThreadId,
              publicDir: defaultPublicDir,
              emitImplementObservation
            });
            result = {
              threadId: completion.threadId || activeThreadId,
              finalText: completion.text,
              events: []
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const allowCurrentAttemptBundleRecovery =
            isRetryableImplementStagedLlmMaterializationError(error) &&
            isProviderTerminatedStagedLlmError(error);
          const recovered = await recoverStructuredResultFromPublicBundle({
            publicDir: isolation.publicDir,
            runDir: isolation.runDir,
            metricsPath: isolation.metricsPath,
            workspaceRoot: isolation.workspaceRoot,
            errorMessage,
            materializedAfterMs: allowCurrentAttemptBundleRecovery
              ? Date.parse(attemptStartedAt)
              : undefined,
            requireFreshPlanAlignment:
              !allowCurrentAttemptBundleRecovery &&
              (promptTaskSpec.context.plan_changed ||
                Boolean(promptTaskSpec.context.paper_critique_feedback) ||
                (Boolean(promptTaskSpec.context.runner_feedback) &&
                  !isRecoverableBundleCommandRepairFeedback(promptTaskSpec.context.runner_feedback))),
            runnerFeedback: promptTaskSpec.context.runner_feedback
          });
          if (!recovered) {
            if (isRetryableImplementStagedLlmMaterializationError(error) && attempt < MAX_IMPLEMENT_ATTEMPTS) {
              const verifyReport: VerifyReport = {
                status: "fail",
                failure_type: "implementation",
                next_action: "retry_patch",
                stderr_excerpt: trimBlock(errorMessage, 1200) || errorMessage,
                summary: `Implementation materialization failed before a runnable bundle was produced; retrying with a fresh attempt: ${errorMessage}`
              };
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
                raw_response: "",
                restored_after_failure: false,
                restored_paths: []
              });
              await writeJsonFile(path.join(runDir, "verify_report.json"), verifyReport);
              await writeJsonFile(path.join(runDir, "implement_attempts.json"), {
                attempts: attemptRecords
              });
              emitImplementObservation("attempt", verifyReport.summary, {
                attempt,
                threadId: activeThreadId,
                publicDir: isolation.publicDir
              });

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
                `Restored ${restoreResult.restoredPaths.length} path(s) before retrying after staged materialization failure.`,
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
              continue;
            }
            const verifyReport = buildImplementationTurnFailureReport(errorMessage);
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
      queueProgressUpdate("codex", "Implementation turn completed.", {
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

      const comparisonContract = await loadExperimentComparisonContract(run, runContext);
      const designImplementationValidation = await validateDesignImplementationAlignment({
        comparisonContract,
        attempt: {
          runCommand: prepared.runCommand,
          testCommand: prepared.testCommand,
          scriptPath: prepared.scriptPath,
          metricsPath: prepared.metricsPath,
          workingDir: prepared.workingDir,
          publicDir: prepared.publicDir,
          changedFiles: prepared.changedFiles,
          publicArtifacts: prepared.publicArtifacts
        }
      });
      prepared.comparisonContract = comparisonContract;
      finalDesignImplementationValidation = designImplementationValidation;
      if (designImplementationValidation.verdict === "block") {
        prepared.verifyReport = buildDesignImplementationValidationVerifyReport(
          designImplementationValidation
        );
      }

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
      throw new Error("Implementation session did not return an implementation attempt.");
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
    await runContext.put(
      "implement_experiments.design_implementation_validation",
      finalDesignImplementationValidation
    );
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
        designImplementationValidation: finalDesignImplementationValidation,
        entries: []
      });
      await runContext.put(EXPERIMENT_GOVERNANCE_IMPLEMENTATION_CONTEXT_KEY, implementationContext);
    } else {
      await storeExperimentGovernanceDecision(run, runContext, {
        candidateIsolationReport,
        designImplementationValidation: finalDesignImplementationValidation,
        entries: []
      });
    }
    await runContext.put(
      EXPERIMENT_GOVERNANCE_DESIGN_IMPLEMENTATION_VALIDATION_KEY,
      finalDesignImplementationValidation
    );

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
      design_implementation_validation: finalDesignImplementationValidation,
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
      node: "implement_experiments",
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
    experimentLlmProfile: ReturnType<typeof resolveExperimentLlmProfile>,
    sessionMode: "codex_native" | "staged_llm",
    environmentSnapshot?: EnvironmentSnapshot
  ): string {
    const sandboxRunDir = rewriteWorkspacePathsForSandbox(runDir, this.deps.workspaceRoot);
    const sandboxPublicDir = rewriteWorkspacePathsForSandbox(publicDir, this.deps.workspaceRoot);
    const sandboxMetricsPath = rewriteWorkspacePathsForSandbox(metricsPath, this.deps.workspaceRoot);
    const environmentBlock = formatEnvironmentSnapshotBlock(environmentSnapshot);
    return [
      ...environmentBlock,
      "You are the AutoLabOS implementer role.",
      sessionMode === "codex_native"
        ? "Work directly in the workspace using Codex tools."
        : "You cannot edit files directly. Return full file contents in file_edits so AutoLabOS can materialize the implementation exactly as specified.",
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
      "Return ONLY one JSON object with keys: summary, experiment_mode, run_command, test_command, working_dir, changed_files, artifacts, public_dir, public_artifacts, script_path, metrics_path, localization, assumptions, file_edits.",
      "Use experiment_mode = real_execution | hybrid_validation | synthetic_validation.",
      "changed_files, artifacts, and public_artifacts must be arrays of workspace paths.",
      "List only artifacts materialized during implement_experiments in changed_files, artifacts, and public_artifacts; do not list deferred runtime outputs such as metrics_path, results*.json, *_results.json, study_results.json, latest_results.json, or run.log unless you actually write them now.",
      "file_edits must be an array of objects with keys: path, content.",
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
    longTermMemory: LongTermMemorySnapshot,
    environmentSnapshot?: EnvironmentSnapshot
  ): Promise<ImplementTaskSpec> {
    const plan = trimBlock(await safeRead(path.join(runDir, "experiment_plan.yaml")), 12_000);
    const planHash = plan ? createHash("sha256").update(plan).digest("hex").slice(0, 16) : "";
    const previousPlanHash = await runContext.get<string>("implement_experiments.plan_hash");
    const planChanged = !!(plan && previousPlanHash && planHash !== previousPlanHash);
    const hypotheses = trimBlock(await safeRead(path.join(runDir, "hypotheses.jsonl")), 12_000);
    const previousSummary = await runContext.get<string>("implement_experiments.last_summary");
    const previousRunCommand = await runContext.get<string>("implement_experiments.run_command");
    const previousScript = await runContext.get<string>("implement_experiments.script");
    const runnerFeedback = await this.loadApplicableRunnerFeedback(run, runContext);
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
      execution: {
        runner: this.deps.config.experiments.runner,
        timeout_sec: this.deps.config.experiments.timeout_sec
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
        environment_snapshot: rewriteWorkspacePathsForSandbox(environmentSnapshot, this.deps.workspaceRoot),
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

  private async loadApplicableRunnerFeedback(
    run: RunRecord,
    runContext: RunContextMemory
  ): Promise<RunVerifierReport | undefined> {
    const runnerFeedback =
      (await runContext.get<RunVerifierReport>("implement_experiments.runner_feedback")) ||
      (await runContext.get<RunVerifierReport>("run_experiments.feedback_for_implementer"));
    if (!runnerFeedback) {
      return undefined;
    }
    if (run.graph.nodeStates.run_experiments?.status === "failed") {
      return runnerFeedback;
    }
    const feedbackRecordedAt = Date.parse(runnerFeedback.recorded_at || "");
    const designUpdatedAt = Date.parse(run.graph.nodeStates.design_experiments?.updatedAt || "");
    if (
      Number.isFinite(feedbackRecordedAt) &&
      Number.isFinite(designUpdatedAt) &&
      designUpdatedAt > feedbackRecordedAt
    ) {
      await runContext.put("implement_experiments.runner_feedback", null);
      await runContext.put("run_experiments.feedback_for_implementer", null);
      return undefined;
    }
    return runnerFeedback;
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
    sessionMode: "codex_native" | "staged_llm";
  }): string {
    const useCompactApiPrompt = params.sessionMode === "staged_llm";
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
    const promptTaskSpec = useCompactApiPrompt
      ? compactTaskSpecForStagedLlmPrompt(sandboxTaskSpec)
      : sandboxTaskSpec;
    const promptSearchLocalization = useCompactApiPrompt
      ? compactLocalizationForStagedLlmPrompt(sandboxSearchLocalization)
      : sandboxSearchLocalization;
    const promptBranchPlan = useCompactApiPrompt
      ? compactBranchPlanForStagedLlmPrompt(sandboxBranchPlan)
      : sandboxBranchPlan;
    const promptLongTermMemory = useCompactApiPrompt
      ? compactLongTermMemoryForStagedLlmPrompt(sandboxTaskSpec.context.long_term_memory)
      : sandboxTaskSpec.context.long_term_memory;
    const promptRunnerFeedback = useCompactApiPrompt
      ? compactRunnerFeedbackForStagedLlmPrompt(sandboxTaskSpec.context.runner_feedback)
      : sandboxTaskSpec.context.runner_feedback;
    const promptPaperCritiqueFeedback = useCompactApiPrompt
      ? compactPaperCritiqueForStagedLlmPrompt(sandboxTaskSpec.context.paper_critique_feedback)
      : sandboxTaskSpec.context.paper_critique_feedback;
    const promptRecentReflections = useCompactApiPrompt
      ? compactReflectionsForStagedLlmPrompt(sandboxRecentReflections)
      : sandboxRecentReflections;
    const promptExistingChangedFiles = useCompactApiPrompt
      ? compactStringListForStagedLlmPrompt(sandboxExistingChangedFiles, 8)
      : sandboxExistingChangedFiles;
    const promptHistoricalChangedFiles = useCompactApiPrompt
      ? compactStringListForStagedLlmPrompt(sandboxHistoricalChangedFiles, 8)
      : sandboxHistoricalChangedFiles;
    const promptPreviousAttempt = useCompactApiPrompt
      ? compactPreviousAttemptForStagedLlmPrompt(sandboxPreviousAttempt)
      : sandboxPreviousAttempt;
    const lines = [
      `Implementation attempt ${params.attempt}/${MAX_IMPLEMENT_ATTEMPTS}.`,
      "Task spec:",
      JSON.stringify(promptTaskSpec, null, 2),
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
      "- Do NOT pass generator= or generation_kwargs['generator'] into model.generate(); seed sampling outside the generate() call instead.",
      "- In metrics output, include: 'device': str(device), 'gpu_name': torch.cuda.get_device_name(0) if available, 'peak_vram_gb': torch.cuda.max_memory_allocated()/1e9.",
      "- FAILURE TO USE GPU WHEN AVAILABLE IS A BLOCKING BUG. CPU inference on a 3B model takes ~17s/example; GPU takes <0.5s/example.",
      "- If an existing script already exists and uses CPU-only, you MUST patch it to use GPU."
    ];
    if (params.sessionMode === "staged_llm") {
      lines.splice(10, 0, "6. This staged_llm attempt uses a scaffold-first contract.");
      lines.splice(11, 0, "7. Return scaffold metadata only in the first response. Do NOT include file contents in the scaffold response.");
      lines.splice(12, 0, "8. Decomposition planning may happen in a follow-up repair turn, so focus this scaffold on the minimal runnable metadata and localization surface.");
      lines.splice(13, 0, "9. The API-mode context below is compacted to the highest-signal fields only; do not assume omitted fields are required.");
    }

    lines.push("", "Search-backed localization hints:", JSON.stringify(promptSearchLocalization, null, 2));
    lines.push("", "Branch focus:", JSON.stringify(promptBranchPlan, null, 2));
    if (promptLongTermMemory.retrieved.length > 0) {
      lines.push(
        "",
        "Long-term implementation memory:",
        JSON.stringify(promptLongTermMemory, null, 2)
      );
    }
    if (promptRunnerFeedback) {
      lines.push(
        "",
        "Runner feedback from run_experiments:",
        JSON.stringify(promptRunnerFeedback, null, 2)
      );
    }
    if (promptPaperCritiqueFeedback) {
      lines.push(
        "",
        "Post-draft critique requiring stronger experimental evidence:",
        JSON.stringify(promptPaperCritiqueFeedback, null, 2),
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

    if (promptRecentReflections.length > 0) {
      lines.push("", "Recent failure reflections:", JSON.stringify(promptRecentReflections, null, 2));
    }

    if (promptExistingChangedFiles.length > 0) {
      lines.push("", "Files already changed in this workspace:", promptExistingChangedFiles.join("\n"));
    }
    if (promptHistoricalChangedFiles.length > 0) {
      lines.push(
        "",
        "Files touched in previous attempts (now restored unless reintroduced):",
        promptHistoricalChangedFiles.join("\n")
      );
    }

    if (promptPreviousAttempt) {
      lines.push(
        "",
        "Previous local verification:",
        JSON.stringify(promptPreviousAttempt.verify_report, null, 2),
        "",
        "Previous localization:",
        JSON.stringify(promptPreviousAttempt.localization, null, 2),
        "",
        "Previous summary:",
        promptPreviousAttempt.summary
      );
      if (promptPreviousAttempt.verify_report.failure_type === "localization") {
        lines.push("Revisit which files you edit before making another patch.");
      } else if (promptPreviousAttempt.verify_report.failure_type === "implementation") {
        lines.push("Keep the fix focused and address the verification failure directly.");
      }
    }

    return lines.join("\n");
  }

  private buildFilesystemFallbackRecoveryPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    attempt: number;
  }): string {
    const sandboxTaskSpec = rewriteWorkspacePathsForSandbox(params.taskSpec, this.deps.workspaceRoot);
    const sandboxSearchLocalization = rewriteWorkspacePathsForSandbox(params.searchLocalization, this.deps.workspaceRoot);
    const sandboxBranchPlan = rewriteWorkspacePathsForSandbox(params.branchPlan, this.deps.workspaceRoot);
    const promptTaskSpec = compactTaskSpecForStagedLlmPrompt(sandboxTaskSpec);
    const promptSearchLocalization = compactLocalizationForStagedLlmPrompt(sandboxSearchLocalization);
    const promptBranchPlan = compactBranchPlanForStagedLlmPrompt(sandboxBranchPlan);

    return [
      `Implementation attempt ${params.attempt}/${MAX_IMPLEMENT_ATTEMPTS} (filesystem-blocker recovery mode).`,
      "The previous Codex filesystem/tooling blocker has already been detected and handled by AutoLabOS.",
      "Do NOT repeat the blocker narrative, sandbox explanation, or any request to retry Codex filesystem actions.",
      "Treat this as a fresh staged_llm implementation task and return ONLY one JSON object.",
      "A valid response MUST include non-empty file_edits for every created or modified text artifact needed for the runnable experiment bundle.",
      "At minimum, emit file_edits for the runnable script and any required config or README referenced by your commands.",
      "If inspection is incomplete, synthesize the smallest bounded implementation that satisfies the locked task spec, branch focus, and localization hints.",
      "Task spec:",
      JSON.stringify(promptTaskSpec, null, 2),
      "",
      "Search-backed localization hints:",
      JSON.stringify(promptSearchLocalization, null, 2),
      "",
      "Branch focus:",
      JSON.stringify(promptBranchPlan, null, 2),
      "",
      "Output contract reminder:",
      "- Return ONLY one JSON object with keys: summary, experiment_mode, run_command, test_command, working_dir, changed_files, artifacts, public_dir, public_artifacts, script_path, metrics_path, localization, assumptions, file_edits.",
      "- file_edits must contain full UTF-8 contents for each referenced file.",
      "- changed_files, artifacts, and public_artifacts must list only files materialized during implement_experiments, not deferred runtime outputs such as metrics_path, results*.json, *_results.json, study_results.json, latest_results.json, or run.log.",
      "- Responses that only describe the blocker or omit file_edits are invalid."
    ].join("\n");
  }

  private async completeStagedLlmRequest(input: {
    runDir: string;
    prompt: string;
    systemPrompt: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
  }): Promise<{ text: string; threadId?: string }> {
    const partialResponsePath = normalizeFsPath(path.join(input.runDir, IMPLEMENT_PARTIAL_RESPONSE_ARTIFACT));
    const heartbeatMs = getImplementLlmProgressHeartbeatMs();
    let partialText = "";
    let lastSnapshotLength = 0;
    let sawProgressEvent = false;
    let sawDeltaEvent = false;
    let lastProgressAt = Date.now();
    let lastDeltaObservationAt = 0;
    let lastDeltaObservationChars = 0;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    const persistPartialSnapshot = async () => {
      if (!partialText.trim()) {
        return;
      }
      await ensureDir(path.dirname(partialResponsePath));
      await fs.writeFile(partialResponsePath, partialText, "utf8");
      lastSnapshotLength = partialText.length;
    };
    const maybePersistPartialSnapshot = async () => {
      if (partialText.length === lastSnapshotLength) {
        return;
      }
      if (partialText.length - lastSnapshotLength < 64 && partialText.length < 256) {
        return;
      }
      await persistPartialSnapshot();
    };
    try {
      await fs.rm(partialResponsePath, { force: true });
    } catch {
      // Best effort only: a stale partial snapshot should never block a provider request.
    }
    const emitDeltaProgressSummary = (force = false) => {
      if (!sawDeltaEvent) {
        return;
      }
      const now = Date.now();
      const charCount = partialText.trim().length;
      if (
        !force &&
        now - lastDeltaObservationAt < IMPLEMENT_DELTA_PROGRESS_MIN_MS &&
        charCount - lastDeltaObservationChars < IMPLEMENT_DELTA_PROGRESS_MIN_CHARS
      ) {
        return;
      }
      lastDeltaObservationAt = now;
      lastDeltaObservationChars = charCount;
      input.emitImplementObservation(
        "codex",
        `LLM streamed ${charCount} chars; partial snapshot updated at ${formatArtifactPath(partialResponsePath)}.`,
        {
          attempt: input.attempt,
          threadId: input.threadId,
          publicDir: input.publicDir
        }
      );
    };
    const timeoutController = input.timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutId = timeoutController
      ? setTimeout(() => timeoutController.abort(), input.timeoutMs)
      : undefined;
    const llmAbortSignal = timeoutController
      ? input.abortSignal
        ? AbortSignal.any([input.abortSignal, timeoutController.signal])
        : timeoutController.signal
      : input.abortSignal;
    if (heartbeatMs > 0) {
      heartbeatTimer = setInterval(() => {
        const silenceMs = Date.now() - lastProgressAt;
        const silenceSec = Math.max(1, Math.floor(silenceMs / 1000));
        const heartbeatMessage = sawProgressEvent
          ? `Still waiting on staged_llm provider output; no new provider progress for ${silenceSec}s.`
          : `Still waiting on staged_llm provider output; no provider progress observed for ${silenceSec}s.`;
        input.emitImplementObservation("codex", heartbeatMessage, {
          attempt: input.attempt,
          threadId: input.threadId,
          publicDir: input.publicDir
        });
      }, heartbeatMs);
    }
    try {
      let completion: { text: string; threadId?: string } | undefined;
      for (let requestAttempt = 1; requestAttempt <= IMPLEMENT_STAGED_LLM_TRANSIENT_RETRY_MAX_ATTEMPTS; requestAttempt += 1) {
        try {
          completion = await this.deps.llm!.complete(input.prompt, {
            threadId: input.threadId,
            systemPrompt: input.systemPrompt,
            reasoningEffort: input.reasoningEffort,
            abortSignal: llmAbortSignal,
            onProgress: (event) => {
              const text = event.text.trim();
              lastProgressAt = Date.now();
              sawProgressEvent = true;
              if (!text) {
                return;
              }
              if (event.type === "delta") {
                sawDeltaEvent = true;
                partialText += `${text}\n`;
                void maybePersistPartialSnapshot();
                emitDeltaProgressSummary();
                return;
              }
              input.emitImplementObservation("codex", text, {
                attempt: input.attempt,
                threadId: input.threadId,
                publicDir: input.publicDir
              });
            }
          });
          break;
        } catch (error) {
          const canRetryTransient =
            !llmAbortSignal?.aborted &&
            isTransientStagedLlmProviderError(error) &&
            requestAttempt < IMPLEMENT_STAGED_LLM_TRANSIENT_RETRY_MAX_ATTEMPTS;
          if (!canRetryTransient) {
            throw error;
          }
          const discardedPartialChars = partialText.trim().length;
          if (discardedPartialChars > 0) {
            await persistPartialSnapshot();
            partialText = "";
            lastDeltaObservationChars = 0;
            lastDeltaObservationAt = 0;
            sawDeltaEvent = false;
          }
          input.emitImplementObservation(
            "codex",
            [
              `Transient staged_llm provider error; retrying request ${requestAttempt + 1}/${IMPLEMENT_STAGED_LLM_TRANSIENT_RETRY_MAX_ATTEMPTS}: ${trimBlock(
                error instanceof Error ? error.message : String(error),
                400
              )}`,
              discardedPartialChars > 0
                ? `Discarded ${discardedPartialChars} chars of incomplete provider output before retrying the same request.`
                : undefined
            ]
              .filter(Boolean)
              .join(" "),
            {
              attempt: input.attempt,
              threadId: input.threadId,
              publicDir: input.publicDir
            }
          );
          await delay(IMPLEMENT_STAGED_LLM_TRANSIENT_RETRY_DELAY_MS * requestAttempt, llmAbortSignal);
        }
      }
      if (!completion) {
        throw new Error("staged_llm provider did not return a completion");
      }
      emitDeltaProgressSummary(true);
      if (completion.text.trim()) {
        partialText = completion.text;
        await persistPartialSnapshot();
      }
      return {
        text: completion.text,
        threadId: completion.threadId
      };
    } catch (error) {
      await persistPartialSnapshot();
      if (timeoutController?.signal.aborted && !input.abortSignal?.aborted) {
        const timeoutMessage = sawDeltaEvent
          ? `staged_llm timeout preserved ${partialText.trim().length} chars of partial output in ${formatArtifactPath(partialResponsePath)}.`
          : sawProgressEvent
            ? `staged_llm timed out after provider progress without any text delta; partial snapshot remains empty.`
            : `staged_llm timed out before any provider progress was observed.`;
        input.emitImplementObservation("codex", timeoutMessage, {
          attempt: input.attempt,
          threadId: input.threadId,
          publicDir: input.publicDir
        });
        throw new Error(`implement_experiments staged_llm request timed out after ${input.timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async completeStagedLlmImplementationBundle(input: {
    runDir: string;
    workspaceRoot: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffoldPrompt: string;
    systemPrompt: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
  }): Promise<{ text: string; threadId?: string }> {
    await clearStagedLlmAttemptArtifacts(input.runDir);
    if (!shouldDecomposeStagedImplementLlm(this.deps.config)) {
      return this.completeStagedLlmRequest({
        runDir: input.runDir,
        prompt: input.scaffoldPrompt,
        systemPrompt: input.systemPrompt,
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir,
        emitImplementObservation: input.emitImplementObservation,
        reasoningEffort: input.reasoningEffort
      });
    }

    input.emitImplementObservation(
      "codex",
      "Planning staged_llm implementation scaffold before generating file contents.",
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );
    await ensureDir(path.dirname(path.join(input.runDir, IMPLEMENT_SCAFFOLD_PROMPT_ARTIFACT)));
    await fs.writeFile(path.join(input.runDir, IMPLEMENT_SCAFFOLD_PROMPT_ARTIFACT), input.scaffoldPrompt, "utf8");
    const scaffoldCompletion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: input.scaffoldPrompt,
      systemPrompt: appendStagedImplementScaffoldOverrideToPrompt(input.systemPrompt),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    await fs.writeFile(
      path.join(input.runDir, IMPLEMENT_SCAFFOLD_RAW_RESPONSE_ARTIFACT),
      scaffoldCompletion.text,
      "utf8"
    );
    const scaffoldParsed = parseStructuredResponse(scaffoldCompletion.text);
    let activeThreadId = scaffoldCompletion.threadId || input.threadId;
    const bootstrapPlanningRequired = shouldRequireExplicitBootstrapPlanning(input.taskSpec, scaffoldParsed.value);
    const bootstrapContractResult = bootstrapPlanningRequired
      ? await this.completeStagedLlmBootstrapContract({
          runDir: input.runDir,
          taskSpec: input.taskSpec,
          scaffold: scaffoldParsed.value,
          systemPrompt: input.systemPrompt,
          timeoutMs: input.timeoutMs,
          abortSignal: input.abortSignal,
          attempt: input.attempt,
          threadId: activeThreadId,
          publicDir: input.publicDir,
          emitImplementObservation: input.emitImplementObservation,
          reasoningEffort: input.reasoningEffort
        })
      : {
          contract: buildDefaultImplementBootstrapContract(input.taskSpec),
          threadId: activeThreadId
        };
    activeThreadId = bootstrapContractResult.threadId || activeThreadId;
    await writeJsonFile(
      path.join(input.runDir, IMPLEMENT_BOOTSTRAP_CONTRACT_ARTIFACT),
      bootstrapContractResult.contract
    );
    const bootstrapContractPublicPath = path.join(input.publicDir, "bootstrap_contract.json");
    await ensureDir(path.dirname(bootstrapContractPublicPath));
    await writeJsonFile(bootstrapContractPublicPath, bootstrapContractResult.contract);
    scaffoldParsed.value.artifacts = dedupeStrings([
      ...(scaffoldParsed.value.artifacts || []),
      path.join(input.runDir, IMPLEMENT_BOOTSTRAP_CONTRACT_ARTIFACT)
    ]);
    scaffoldParsed.value.public_artifacts = dedupeStrings([
      ...(scaffoldParsed.value.public_artifacts || []),
      bootstrapContractPublicPath
    ]);
    const bootstrapEvaluation = await evaluateImplementBootstrapContract({
      contract: bootstrapContractResult.contract,
      workspaceRoot: input.workspaceRoot
    });
    if (bootstrapEvaluation.status === "block") {
      throw new Error(`bootstrap contract blocked implementation before code generation: ${bootstrapEvaluation.summary}`);
    }
    const decompositionPlanRepair =
      scaffoldParsed.value.decomposition_plan
        ? undefined
        : await this.completeStagedLlmDecompositionPlan({
        runDir: input.runDir,
        workspaceRoot: input.workspaceRoot,
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: scaffoldParsed.value,
        systemPrompt: input.systemPrompt,
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
        attempt: input.attempt,
        threadId: activeThreadId,
        publicDir: input.publicDir,
        emitImplementObservation: input.emitImplementObservation,
        reasoningEffort: input.reasoningEffort
      });
    activeThreadId = decompositionPlanRepair?.threadId || activeThreadId;
    const decompositionPlan =
      normalizeDynamicDecompositionPlan(scaffoldParsed.value.decomposition_plan, input.workspaceRoot) ||
      decompositionPlanRepair?.plan;
    if (!decompositionPlan) {
      throw new Error(
        "staged_llm scaffold did not return a parseable decomposition_plan and the decomposition repair turn did not recover one"
      );
    }
    const materializableUnitRepair =
      decompositionPlan.units.some(isMaterializableTextUnit)
        ? undefined
        : await this.completeStagedLlmMaterializableUnitRepair({
            runDir: input.runDir,
            workspaceRoot: input.workspaceRoot,
            taskSpec: input.taskSpec,
            searchLocalization: input.searchLocalization,
            branchPlan: input.branchPlan,
            scaffold: scaffoldParsed.value,
            decompositionPlan,
            systemPrompt: input.systemPrompt,
            timeoutMs: input.timeoutMs,
            abortSignal: input.abortSignal,
            attempt: input.attempt,
            threadId: activeThreadId,
            publicDir: input.publicDir,
            emitImplementObservation: input.emitImplementObservation,
            reasoningEffort: input.reasoningEffort
          });
    activeThreadId = materializableUnitRepair?.threadId || activeThreadId;
    const finalDecompositionPlan = materializableUnitRepair?.plan || decompositionPlan;
    const materializationUnits = finalDecompositionPlan.units.filter(isMaterializableTextUnit);
    if (materializationUnits.length === 0) {
      throw new Error("staged_llm scaffold did not declare any materializable text units");
    }
    await writeJsonFile(path.join(input.runDir, IMPLEMENT_SCAFFOLD_ARTIFACT), scaffoldParsed.value);
    await writeJsonFile(path.join(input.runDir, IMPLEMENT_DECOMPOSITION_PLAN_ARTIFACT), finalDecompositionPlan);
    await writeJsonFile(path.join(input.runDir, IMPLEMENT_FILE_PLAN_ARTIFACT), {
      files: materializationUnits.map((unit) => unit.target_path),
      units: materializationUnits.map((unit) => ({
        id: unit.id,
        unit_type: unit.unit_type,
        title: unit.title,
        purpose: unit.purpose,
        target_path: unit.target_path,
        depends_on: unit.depends_on,
        verification_focus: unit.verification_focus
      }))
    });

    const fileEdits: StructuredImplementFileEdit[] = [];
    for (const [index, unit] of materializationUnits.entries()) {
      const filePath = unit.target_path!;
      const materializationPlanResult = await this.completeStagedLlmMaterializationPlan({
        runDir: input.runDir,
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: scaffoldParsed.value,
        decompositionPlan: finalDecompositionPlan,
        unit,
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
        attempt: input.attempt,
        threadId: activeThreadId,
        publicDir: input.publicDir,
        emitImplementObservation: input.emitImplementObservation,
        reasoningEffort: input.reasoningEffort
      });
      const materializationPlan = materializationPlanResult.plan;
      activeThreadId = materializationPlanResult.threadId || activeThreadId;
      await ensureDir(path.join(input.runDir, IMPLEMENT_UNIT_PLAN_DIR));
      await writeJsonFile(
        path.join(input.runDir, IMPLEMENT_UNIT_PLAN_DIR, `${sanitizeArtifactId(unit.id)}.json`),
        materializationPlan
      );

      const useSectionedSkeleton =
        shouldUseSectionedSkeletonForTarget(filePath) && materializationPlan.chunks.length > 1;

      const useDirectFileMaterialization =
        materializationPlan.chunks.length === 1 &&
        !useSectionedSkeleton &&
        !isPythonMaterializationPath(filePath);

      if (useDirectFileMaterialization) {
        input.emitImplementObservation(
          "codex",
          `Generating staged_llm unit ${index + 1}/${materializationUnits.length}: ${unit.title} (${formatArtifactPath(filePath)})`,
          {
            attempt: input.attempt,
            threadId: activeThreadId,
            publicDir: input.publicDir
          }
        );
        const fileCompletion = await this.completeStagedLlmRequest({
          runDir: input.runDir,
          prompt: this.buildStagedImplementFilePrompt({
            taskSpec: input.taskSpec,
            searchLocalization: input.searchLocalization,
            branchPlan: input.branchPlan,
            scaffold: scaffoldParsed.value,
            decompositionPlan: finalDecompositionPlan,
            unit,
            index: index + 1,
            total: materializationUnits.length
          }),
          systemPrompt: appendStagedImplementFileOverrideToPrompt(input.systemPrompt, filePath),
          timeoutMs: input.timeoutMs,
          abortSignal: input.abortSignal,
          attempt: input.attempt,
          threadId: activeThreadId,
          publicDir: input.publicDir,
          emitImplementObservation: input.emitImplementObservation,
          reasoningEffort: input.reasoningEffort
        });
        activeThreadId = fileCompletion.threadId || activeThreadId;
        fileEdits.push(parseStructuredFileEditResponse(fileCompletion.text, input.workspaceRoot, filePath));
        continue;
      }

      const plannedSections: PlannedMaterializationSection[] = [];
      for (const [chunkIndex, chunk] of materializationPlan.chunks.entries()) {
        const chunkSubdivisionPlanResult =
          materializationPlan.chunks.length > 1
            ? await this.completeStagedLlmChunkSubdivisionPlan({
                runDir: input.runDir,
                taskSpec: input.taskSpec,
                searchLocalization: input.searchLocalization,
                branchPlan: input.branchPlan,
                scaffold: scaffoldParsed.value,
                decompositionPlan: finalDecompositionPlan,
                unit,
                materializationPlan,
                chunk,
                timeoutMs: input.timeoutMs,
                abortSignal: input.abortSignal,
                attempt: input.attempt,
                threadId: activeThreadId,
                publicDir: input.publicDir,
                emitImplementObservation: input.emitImplementObservation,
                reasoningEffort: input.reasoningEffort
              })
            : undefined;
        activeThreadId = chunkSubdivisionPlanResult?.threadId || activeThreadId;
        const executableChunks =
          chunkSubdivisionPlanResult?.plan?.chunks && chunkSubdivisionPlanResult.plan.chunks.length > 0
            ? chunkSubdivisionPlanResult.plan.chunks
            : [chunk];

        for (const [subchunkIndex, executableChunk] of executableChunks.entries()) {
          const chunkLabel =
            executableChunks.length > 1
              ? `chunk ${chunkIndex + 1}/${materializationPlan.chunks.length} subchunk ${subchunkIndex + 1}/${executableChunks.length}`
              : `chunk ${chunkIndex + 1}/${materializationPlan.chunks.length}`;
          plannedSections.push({
            section: executableChunk,
            parentChunk: executableChunks.length > 1 ? chunk : undefined,
            chunkSubdivisionPlan: executableChunks.length > 1 ? chunkSubdivisionPlanResult?.plan : undefined,
            chunkIndex: chunkIndex + 1,
            chunkTotal: materializationPlan.chunks.length,
            chunkLabel
          });
        }
      }

      if (plannedSections.length === 0) {
        throw new Error(`staged_llm materialization planning produced no executable sections for ${filePath}`);
      }

      let draftContent = "";
      const completedSectionIds: string[] = [];
      const sectionOutputs = new Map<string, string>();
      let currentFileContent = "";
      if (useSectionedSkeleton) {
        const skeleton = buildCanonicalSectionedSkeleton({
          filePath,
          unit,
          materializationPlan,
          sections: plannedSections
        });
        await ensureDir(path.join(input.runDir, IMPLEMENT_UNIT_SKELETON_DIR));
        await fs.writeFile(
          path.join(input.runDir, IMPLEMENT_UNIT_SKELETON_DIR, `${sanitizeArtifactId(unit.id)}.txt`),
          skeleton,
          "utf8"
        );
        await ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, skeleton, "utf8");
        currentFileContent = skeleton;
      }

      const chunkDraftsByParent = new Map<string, string>();
      for (const [sectionIndex, plannedSection] of plannedSections.entries()) {
        const parentDraftKey = plannedSection.parentChunk?.id;
        const chunkDraftSoFar = parentDraftKey ? chunkDraftsByParent.get(parentDraftKey) || "" : "";
        const chunkCompletion = await this.materializeStagedLlmChunkWithDynamicSubdivision({
          runDir: input.runDir,
          workspaceRoot: input.workspaceRoot,
          taskSpec: input.taskSpec,
          searchLocalization: input.searchLocalization,
          branchPlan: input.branchPlan,
          scaffold: scaffoldParsed.value,
          decompositionPlan: finalDecompositionPlan,
          unit,
          materializationPlan,
          chunk: plannedSection.section,
          parentChunk: plannedSection.parentChunk,
          chunkSubdivisionPlan: plannedSection.chunkSubdivisionPlan,
          chunkIndex: plannedSection.chunkIndex,
          chunkTotal: plannedSection.chunkTotal,
          draftSoFar: draftContent,
          chunkDraftSoFar,
          timeoutMs: input.timeoutMs,
          abortSignal: input.abortSignal,
          attempt: input.attempt,
          threadId: activeThreadId,
          publicDir: input.publicDir,
          emitImplementObservation: input.emitImplementObservation,
          reasoningEffort: input.reasoningEffort,
          unitIndex: index + 1,
          unitTotal: materializationUnits.length,
          chunkLabel: plannedSection.chunkLabel,
          subdivisionDepth: 0,
          systemPrompt: input.systemPrompt,
          completedSectionIds,
          currentFileContent,
          validateContent:
            useSectionedSkeleton && isPythonMaterializationPath(filePath)
              ? async (sectionContent) => {
                  const candidateContent = applySectionContentToCanonicalSkeleton(
                    currentFileContent,
                    plannedSection.section.id,
                    sectionContent,
                    filePath
                  );
                  const candidatePath = path.join(
                    input.runDir,
                    IMPLEMENT_UNIT_SECTION_DIR,
                    `${sanitizeArtifactId(unit.id)}__${sanitizeArtifactId(plannedSection.section.id)}__candidate.py`
                  );
                  await ensureDir(path.dirname(candidatePath));
                  await fs.writeFile(candidatePath, candidateContent, "utf8");
                  const syntaxObs = await this.deps.aci.runTests(
                    `python3 -m py_compile ${JSON.stringify(candidatePath)}`,
                    path.dirname(candidatePath),
                    input.abortSignal
                  );
                  if (syntaxObs.status === "ok") {
                    return detectPythonUndefinedUppercaseReferences(candidatePath);
                  }
                  return trimBlock(syntaxObs.stderr || syntaxObs.stdout || "unknown py_compile failure", 800);
                }
              : undefined
        });
        activeThreadId = chunkCompletion.threadId || activeThreadId;
        const sectionContent = chunkCompletion.content;
        ensureMaterializedChunkHasSubstance(sectionContent, filePath, plannedSection.section.id);
        completedSectionIds.push(plannedSection.section.id);
        if (parentDraftKey) {
          chunkDraftsByParent.set(parentDraftKey, appendDraftSection(chunkDraftSoFar, sectionContent));
        }

        if (useSectionedSkeleton) {
          sectionOutputs.set(plannedSection.section.id, sectionContent);
          currentFileContent = applySectionContentToCanonicalSkeleton(
            currentFileContent,
            plannedSection.section.id,
            sectionContent,
            filePath
          );
          await fs.writeFile(filePath, currentFileContent, "utf8");
          await ensureDir(path.join(input.runDir, IMPLEMENT_UNIT_SECTION_DIR));
          await fs.writeFile(
            path.join(
              input.runDir,
              IMPLEMENT_UNIT_SECTION_DIR,
              `${sanitizeArtifactId(unit.id)}__${sanitizeArtifactId(plannedSection.section.id)}.txt`
            ),
            sectionContent,
            "utf8"
          );
          if (isPythonMaterializationPath(filePath)) {
            const syntaxObs = await this.deps.aci.runTests(
              `python3 -m py_compile ${JSON.stringify(filePath)}`,
              path.dirname(filePath),
              input.abortSignal
            );
            if (syntaxObs.status !== "ok") {
              throw new Error(
                `section materialization for ${filePath}:${plannedSection.section.id} introduced a Python syntax error: ${trimBlock(
                  syntaxObs.stderr || syntaxObs.stdout || "unknown py_compile failure",
                  800
                )}`
              );
            }
          }
        } else {
          draftContent =
            draftContent.trim().length > 0
              ? `${draftContent.trimEnd()}\n\n${sectionContent.trimStart()}`
              : sectionContent;
        }
      }
      if (useSectionedSkeleton) {
        draftContent = stripCanonicalSkeletonMarkers(currentFileContent, filePath);
        await fs.writeFile(filePath, draftContent, "utf8");
      } else {
        await ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, draftContent, "utf8");
      }
      ensureMaterializedFileHasSubstance(draftContent, filePath);
      fileEdits.push({
        path: filePath,
        content: draftContent
      });
    }

    return {
      threadId: activeThreadId,
      text: JSON.stringify({
        ...scaffoldParsed.value,
        file_edits: fileEdits
      })
    };
  }

  private async materializeStagedLlmChunkWithDynamicSubdivision(input: {
    runDir: string;
    workspaceRoot: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    materializationPlan: DynamicMaterializationPlan;
    chunk: DynamicMaterializationChunk;
    parentChunk?: DynamicMaterializationChunk;
    chunkSubdivisionPlan?: DynamicMaterializationPlan;
    chunkIndex: number;
    chunkTotal: number;
    draftSoFar: string;
    chunkDraftSoFar: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
    unitIndex: number;
    unitTotal: number;
    chunkLabel: string;
    subdivisionDepth: number;
    systemPrompt: string;
    completedSectionIds: string[];
    currentFileContent: string;
    validateContent?: (content: string) => Promise<string | undefined>;
  }): Promise<{ content: string; threadId?: string }> {
    const chunkArtifactId = buildMaterializationChunkArtifactId(input);
    const chunkPrompt = this.buildStagedImplementFileChunkPrompt({
      taskSpec: input.taskSpec,
      searchLocalization: input.searchLocalization,
      branchPlan: input.branchPlan,
      scaffold: input.scaffold,
      decompositionPlan: input.decompositionPlan,
      unit: input.unit,
      materializationPlan: input.materializationPlan,
      chunk: input.chunk,
      parentChunk: input.parentChunk,
      chunkSubdivisionPlan: input.chunkSubdivisionPlan,
      chunkIndex: input.chunkIndex,
      chunkTotal: input.chunkTotal,
      draftSoFar: input.draftSoFar,
      chunkDraftSoFar: input.chunkDraftSoFar,
      completedSectionIds: input.completedSectionIds,
      currentFileContent: input.currentFileContent
    });
    const chunkPromptPath = path.join(input.runDir, IMPLEMENT_UNIT_CHUNK_PROMPT_DIR, `${chunkArtifactId}.txt`);
    await ensureDir(path.dirname(chunkPromptPath));
    await fs.writeFile(chunkPromptPath, chunkPrompt, "utf8");
    input.emitImplementObservation(
      "codex",
      `Generating staged_llm unit ${input.unitIndex}/${input.unitTotal} ${input.chunkLabel}: ${input.chunk.title} (${formatArtifactPath(input.unit.target_path || "")})`,
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );

    try {
      const chunkCompletion = await this.completeStagedLlmRequest({
        runDir: input.runDir,
        prompt: chunkPrompt,
        systemPrompt: appendStagedImplementChunkOverrideToPrompt(
          input.systemPrompt,
          input.unit.target_path || "",
          input.chunk.id
        ),
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir,
        emitImplementObservation: input.emitImplementObservation,
        reasoningEffort: input.reasoningEffort
      });
      const chunkRawPath = path.join(input.runDir, IMPLEMENT_UNIT_CHUNK_RESPONSE_DIR, `${chunkArtifactId}.txt`);
      await ensureDir(path.dirname(chunkRawPath));
      await fs.writeFile(chunkRawPath, chunkCompletion.text, "utf8");
      const content = normalizeStagedLlmChunkContent(
        parseStructuredChunkResponse(chunkCompletion.text, input.chunk.id),
        input.unit.target_path || ""
      );
      ensureMaterializedChunkHasSubstance(content, input.unit.target_path || "", input.chunk.id);
      let materializedContent = content;
      let validationContent = appendDraftSection(input.chunkDraftSoFar, materializedContent);
      let validationError = await input.validateContent?.(validationContent);
      const missingConstants = extractUndefinedUppercaseConstantNames(validationError);
      if (validationError && missingConstants.length > 0) {
        const repairResult = await this.completeStagedLlmMissingUppercaseConstantsRepair({
          ...input,
          chunkArtifactId,
          content,
          missingConstants,
          validationError
        });
        const repairedContent = appendDraftSection(repairResult.content, content);
        const repairedValidationContent = appendDraftSection(input.chunkDraftSoFar, repairedContent);
        const repairedValidationError = await input.validateContent?.(repairedValidationContent);
        if (!repairedValidationError) {
          materializedContent = repairedContent;
          validationContent = repairedValidationContent;
          validationError = undefined;
        } else {
          validationContent = repairedValidationContent;
          validationError = repairedValidationError;
        }
      }
      if (validationError) {
        throw new Error(
          `staged_llm chunk response for ${input.chunk.id} failed candidate validation: ${validationError}`
        );
      }
      return {
        content: materializedContent,
        threadId: chunkCompletion.threadId || input.threadId
      };
    } catch (error) {
      const chunkErrorPath = path.join(
        input.runDir,
        IMPLEMENT_UNIT_CHUNK_RESPONSE_DIR,
        `${chunkArtifactId}_error.txt`
      );
      await ensureDir(path.dirname(chunkErrorPath));
      await fs.writeFile(chunkErrorPath, error instanceof Error ? error.message : String(error), "utf8");
      const partialSnapshot = await safeRead(path.join(input.runDir, IMPLEMENT_PARTIAL_RESPONSE_ARTIFACT));
      if (partialSnapshot.trim().length > 0) {
        const chunkPartialPath = path.join(
          input.runDir,
          IMPLEMENT_UNIT_CHUNK_RESPONSE_DIR,
          `${chunkArtifactId}_partial_on_error.txt`
        );
        await ensureDir(path.dirname(chunkPartialPath));
        await fs.writeFile(chunkPartialPath, partialSnapshot, "utf8");
      }
      if (
        !isRetryableImplementStagedLlmMaterializationError(error) ||
        input.subdivisionDepth >= MAX_DYNAMIC_CHUNK_SUBDIVISION_DEPTH
      ) {
        throw error;
      }

      const retryReason = isImplementStagedLlmTimeoutError(error)
        ? "timed out"
        : isCandidateValidationStagedLlmError(error)
          ? "failed candidate validation"
          : "was terminated";
      input.emitImplementObservation(
        "codex",
        `Chunk generation ${retryReason} for ${input.chunk.title}; asking staged_llm to re-subdivide it into smaller work units.`,
        {
          attempt: input.attempt,
          threadId: input.threadId,
          publicDir: input.publicDir
        }
      );

      const retrySubdivisionPlan = await this.completeStagedLlmChunkSubdivisionPlan({
        runDir: input.runDir,
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: input.scaffold,
        decompositionPlan: input.decompositionPlan,
        unit: input.unit,
        materializationPlan: input.chunkSubdivisionPlan || input.materializationPlan,
        chunk: input.chunk,
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal,
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir,
        emitImplementObservation: input.emitImplementObservation,
        reasoningEffort: input.reasoningEffort,
        forceSmallerSubdivision: true,
        previousFailure: trimBlock(error instanceof Error ? error.message : String(error), 1200)
      });
      const retryChunks = retrySubdivisionPlan.plan.chunks;
      if (retryChunks.length < 2) {
        throw error;
      }

      let activeThreadId = retrySubdivisionPlan.threadId || input.threadId;
      let subdividedDraft = "";
      for (const [retryIndex, retryChunk] of retryChunks.entries()) {
        const retryResult = await this.materializeStagedLlmChunkWithDynamicSubdivision({
          ...input,
          chunk: retryChunk,
          parentChunk: input.chunk,
          chunkSubdivisionPlan: retrySubdivisionPlan.plan,
          draftSoFar: input.draftSoFar,
          chunkDraftSoFar: appendDraftSection(input.chunkDraftSoFar, subdividedDraft),
          threadId: activeThreadId,
          chunkLabel: `${input.chunkLabel} resubchunk ${retryIndex + 1}/${retryChunks.length}`,
          subdivisionDepth: input.subdivisionDepth + 1,
          completedSectionIds: input.completedSectionIds,
          currentFileContent: input.currentFileContent
        });
        activeThreadId = retryResult.threadId || activeThreadId;
        subdividedDraft =
          subdividedDraft.trim().length > 0
            ? `${subdividedDraft.trimEnd()}\n\n${retryResult.content.trimStart()}`
            : retryResult.content;
      }
      const combinedValidationError = await input.validateContent?.(
        appendDraftSection(input.chunkDraftSoFar, subdividedDraft)
      );
      if (combinedValidationError) {
        throw new Error(
          `staged_llm chunk response for ${input.chunk.id} failed candidate validation: ${combinedValidationError}`
        );
      }
      return {
        content: subdividedDraft,
        threadId: activeThreadId
      };
    }
  }

  private async completeStagedLlmMissingUppercaseConstantsRepair(input: {
    runDir: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    materializationPlan: DynamicMaterializationPlan;
    chunk: DynamicMaterializationChunk;
    parentChunk?: DynamicMaterializationChunk;
    chunkSubdivisionPlan?: DynamicMaterializationPlan;
    chunkIndex: number;
    chunkTotal: number;
    draftSoFar: string;
    chunkDraftSoFar: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
    systemPrompt: string;
    completedSectionIds: string[];
    currentFileContent: string;
    chunkLabel: string;
    chunkArtifactId: string;
    content: string;
    missingConstants: string[];
    validationError: string;
  }): Promise<{ content: string; threadId?: string }> {
    const repairPrompt = this.buildStagedImplementMissingUppercaseConstantsRepairPrompt(input);
    const promptPath = path.join(
      input.runDir,
      IMPLEMENT_UNIT_CHUNK_PROMPT_DIR,
      `${input.chunkArtifactId}_constant_repair.txt`
    );
    await ensureDir(path.dirname(promptPath));
    await fs.writeFile(promptPath, repairPrompt, "utf8");
    input.emitImplementObservation(
      "codex",
      `Repairing missing uppercase constants for ${input.chunk.title}: ${input.missingConstants.join(", ")}`,
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );
    const completion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: repairPrompt,
      systemPrompt: appendStagedImplementChunkOverrideToPrompt(
        input.systemPrompt,
        input.unit.target_path || "",
        input.chunk.id
      ),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    const rawPath = path.join(
      input.runDir,
      IMPLEMENT_UNIT_CHUNK_RESPONSE_DIR,
      `${input.chunkArtifactId}_constant_repair.txt`
    );
    await ensureDir(path.dirname(rawPath));
    await fs.writeFile(rawPath, completion.text, "utf8");
    const content = normalizeStagedLlmChunkContent(
      parseStructuredChunkResponse(completion.text, input.chunk.id),
      input.unit.target_path || ""
    );
    ensureMaterializedChunkHasSubstance(content, input.unit.target_path || "", `${input.chunk.id}_constant_repair`);
    return {
      content,
      threadId: completion.threadId || input.threadId
    };
  }

  private buildStagedImplementMissingUppercaseConstantsRepairPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    materializationPlan: DynamicMaterializationPlan;
    chunk: DynamicMaterializationChunk;
    parentChunk?: DynamicMaterializationChunk;
    chunkSubdivisionPlan?: DynamicMaterializationPlan;
    chunkIndex: number;
    chunkTotal: number;
    draftSoFar: string;
    chunkDraftSoFar: string;
    completedSectionIds: string[];
    currentFileContent: string;
    content: string;
    missingConstants: string[];
    validationError: string;
  }): string {
    return [
      `Staged implement missing uppercase constant repair for chunk ${params.chunkIndex}/${params.chunkTotal}.`,
      `Target file: ${params.unit.target_path}`,
      `Target chunk: ${params.chunk.id} — ${params.chunk.title}`,
      "Return ONLY one JSON object with keys: chunk_id, content.",
      `Set chunk_id exactly to ${JSON.stringify(params.chunk.id)}.`,
      "Return only Python definitions that must be prepended before the attempted chunk content.",
      "Do not repeat the attempted chunk content. Do not emit markdown fences.",
      "Define every missing uppercase constant listed below before any code can reference it.",
      "Use concrete, bounded values appropriate to the task, current file, and chunk purpose.",
      "If a value should be configurable, define a safe default constant and let later config code override it explicitly.",
      "Do not use globals() guards, placeholder strings, TODOs, or undefined names in the repair content.",
      "The repair content must be syntactically valid Python by itself when inserted into the current section.",
      "",
      "Missing uppercase constants:",
      JSON.stringify(params.missingConstants, null, 2),
      "",
      "Candidate validation failure:",
      params.validationError,
      "",
      "Compact task spec:",
      JSON.stringify(compactTaskSpecForChunkPrompt(params.taskSpec), null, 2),
      "",
      "Branch focus:",
      JSON.stringify(compactBranchPlanForStagedLlmPrompt(params.branchPlan), null, 2),
      "",
      "Localization hints:",
      JSON.stringify(compactLocalizationForStagedLlmPrompt(params.searchLocalization), null, 2),
      "",
      "Approved scaffold summary:",
      JSON.stringify(
        {
          summary: params.scaffold.summary,
          script_path: params.scaffold.script_path,
          metrics_path: params.scaffold.metrics_path
        },
        null,
        2
      ),
      "",
      "Approved decomposition unit:",
      JSON.stringify(compactDecompositionUnitForChunkPrompt(params.unit), null, 2),
      "",
      "Approved materialization chunk plan summary:",
      JSON.stringify(compactMaterializationPlanForChunkPrompt(params.materializationPlan), null, 2),
      "",
      ...(params.chunkDraftSoFar.trim().length > 0
        ? [
            "Parent chunk draft so far:",
            JSON.stringify(compactDraftForChunkPrompt(params.chunkDraftSoFar), null, 2),
            ""
          ]
        : []),
      ...(params.parentChunk
        ? [
            "Parent chunk being decomposed:",
            JSON.stringify(compactMaterializationChunkForChunkPrompt(params.parentChunk), null, 2),
            ""
          ]
        : []),
      ...(params.chunkSubdivisionPlan
        ? [
            "Approved chunk subdivision plan summary:",
            JSON.stringify(compactMaterializationPlanForChunkPrompt(params.chunkSubdivisionPlan), null, 2),
            ""
          ]
        : []),
      "Completed section ids:",
      JSON.stringify(params.completedSectionIds, null, 2),
      "",
      "Requested chunk:",
      JSON.stringify(compactMaterializationChunkForChunkPrompt(params.chunk), null, 2),
      "",
      "Attempted chunk content that failed validation:",
      JSON.stringify(compactDraftForChunkPrompt(params.content), null, 2),
      "",
      "Current file excerpt:",
      JSON.stringify(compactDraftForChunkPrompt(params.currentFileContent), null, 2)
    ].join("\n");
  }

  private buildStagedImplementFilePrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    index: number;
    total: number;
  }): string {
    return [
      `Staged implement unit generation ${params.index}/${params.total}.`,
      `Target file: ${params.unit.target_path}`,
      "Return ONLY one JSON object with keys: path, content.",
      "Use UTF-8 text. Do not wrap the file content in markdown fences.",
      "",
      "Focused task spec:",
      JSON.stringify(compactTaskSpecForChunkPrompt(params.taskSpec), null, 2),
      "",
      "Search-backed localization hints:",
      JSON.stringify(compactLocalizationForStagedLlmPrompt(params.searchLocalization), null, 2),
      "",
      "Branch focus:",
      JSON.stringify(compactBranchPlanForStagedLlmPrompt(params.branchPlan), null, 2),
      "",
      "Approved scaffold contract:",
      JSON.stringify(
        {
          summary: params.scaffold.summary,
          experiment_mode: params.scaffold.experiment_mode,
          run_command: params.scaffold.run_command,
          test_command: params.scaffold.test_command,
          working_dir: params.scaffold.working_dir,
          changed_files: params.scaffold.changed_files,
          artifacts: params.scaffold.artifacts,
          public_dir: params.scaffold.public_dir,
          public_artifacts: params.scaffold.public_artifacts,
          script_path: params.scaffold.script_path,
          metrics_path: params.scaffold.metrics_path,
          assumptions: params.scaffold.assumptions,
          file_plan: params.scaffold.file_plan,
          decomposition_plan: params.scaffold.decomposition_plan
        },
        null,
        2
      ),
      "",
      "Approved decomposition plan:",
      JSON.stringify(params.decompositionPlan, null, 2),
      "",
      "Requested decomposition unit:",
      JSON.stringify(params.unit, null, 2),
      "",
      "Generate only the requested target file content needed to satisfy the approved scaffold and decomposition unit."
    ].join("\n");
  }

  private async completeStagedLlmBootstrapContract(input: {
    runDir: string;
    taskSpec: ImplementTaskSpec;
    scaffold: StructuredImplementResponse;
    systemPrompt: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
  }): Promise<{ contract: ImplementBootstrapContract; threadId?: string }> {
    input.emitImplementObservation(
      "codex",
      "Planning implementation bootstrap/environment contract before code generation.",
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );
    const bootstrapPrompt = this.buildStagedImplementBootstrapContractPrompt({
      taskSpec: input.taskSpec,
      scaffold: input.scaffold
    });
    await ensureDir(path.dirname(path.join(input.runDir, IMPLEMENT_BOOTSTRAP_CONTRACT_PROMPT_ARTIFACT)));
    await fs.writeFile(
      path.join(input.runDir, IMPLEMENT_BOOTSTRAP_CONTRACT_PROMPT_ARTIFACT),
      bootstrapPrompt,
      "utf8"
    );
    const completion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: bootstrapPrompt,
      systemPrompt: appendStagedImplementBootstrapContractOverrideToPrompt(input.systemPrompt),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    await fs.writeFile(
      path.join(input.runDir, IMPLEMENT_BOOTSTRAP_CONTRACT_RAW_RESPONSE_ARTIFACT),
      completion.text,
      "utf8"
    );
    const contract = parseImplementBootstrapContract(parseJsonObject(completion.text));
    if (!contract) {
      throw new Error("staged_llm bootstrap planning did not return a parseable bootstrap contract");
    }
    return {
      contract,
      threadId: completion.threadId || input.threadId
    };
  }

  private buildStagedImplementBootstrapContractPrompt(params: {
    taskSpec: ImplementTaskSpec;
    scaffold: StructuredImplementResponse;
  }): string {
    return [
      "Staged implement bootstrap contract planning.",
      "Return only a single bare JSON object with keys: version, strategy, summary, requires_network, requires_warm_cache, blocking_reason, remediation, requirements, checks.",
      "requirements schema: {\"id\": string, \"kind\": \"model\"|\"tokenizer\"|\"dataset\"|\"binary\"|\"library\"|\"reference_data\"|\"service\", \"source\": \"huggingface\"|\"local\"|\"python\"|\"system\"|\"other\", \"required_for\": string[], \"local_path\"?: string, \"availability\"?: \"assumed_local\"|\"download_required\"|\"unknown\", \"summary\"?: string, \"remediation\"?: string}.",
      "checks schema: {\"id\": string, \"check_type\": \"path_exists\"|\"command_available\"|\"python_module_available\", \"target\": string, \"reason\": string}.",
      "When Hugging Face models/tokenizers or remote datasets are needed, list them explicitly in requirements instead of assuming they are present.",
      "Use blocking_reason only for non-network blockers that would still fail even if remote assets can be fetched, such as missing local paths, unavailable binaries, or missing required Python packages.",
      "",
      "Compact task spec:",
      JSON.stringify(compactTaskSpecForBootstrapPrompt(params.taskSpec), null, 2),
      "",
      "Approved scaffold summary:",
      JSON.stringify(compactScaffoldSummaryForBootstrapPrompt(params.scaffold), null, 2)
    ].join("\n");
  }

  private async completeStagedLlmMaterializationPlan(input: {
    runDir: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
  }): Promise<{ plan: DynamicMaterializationPlan; threadId?: string }> {
    input.emitImplementObservation(
      "codex",
      `Planning dynamic materialization chunks for ${input.unit.title}.`,
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );
    const completion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: this.buildStagedImplementMaterializationPlanPrompt({
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: input.scaffold,
        decompositionPlan: input.decompositionPlan,
        unit: input.unit
      }),
      systemPrompt: appendStagedImplementMaterializationPlanOverrideToPrompt(input.unit.target_path || ""),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    const rawPath = path.join(
      input.runDir,
      IMPLEMENT_UNIT_PLAN_DIR,
      `${sanitizeArtifactId(input.unit.id)}_raw_response.txt`
    );
    await ensureDir(path.dirname(rawPath));
    await fs.writeFile(rawPath, completion.text, "utf8");
    const plan = parseDynamicMaterializationPlan(parseJsonObject(completion.text));
    if (!plan) {
      throw new Error(
        `staged_llm materialization planning did not return a parseable dynamic plan for ${input.unit.target_path || input.unit.id}`
      );
    }
    return {
      plan,
      threadId: completion.threadId || input.threadId
    };
  }

  private buildStagedImplementMaterializationPlanPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
  }): string {
    return [
      "Staged implement materialization subplan.",
      "Return only a single bare JSON object with keys: strategy, rationale, chunks.",
      "Each chunk must be a non-overlapping ordered unit of work for the requested file.",
      "Chunk schema: {\"id\": string, \"title\": string, \"purpose\": string, \"content_kind\": \"code_section\"|\"config_block\"|\"documentation_section\"|\"text_section\", \"include_imports\"?: boolean, \"include_entrypoint\"?: boolean, \"depends_on\"?: string[], \"verification_focus\"?: string[]}.",
      "Choose the smallest ordered set of chunks that matches the experiment purpose, target artifact, and verification focus.",
      "Returning one chunk is valid when the unit is already minimal. Returning multiple chunks is valid when that makes the implementation materially clearer or more reliable.",
      "",
      "Compact task spec:",
      JSON.stringify(compactTaskSpecForStagedLlmPrompt(params.taskSpec), null, 2),
      "",
      "Branch focus:",
      JSON.stringify(compactBranchPlanForStagedLlmPrompt(params.branchPlan), null, 2),
      "",
      "Localization hints:",
      JSON.stringify(compactLocalizationForStagedLlmPrompt(params.searchLocalization), null, 2),
      "",
      "Approved scaffold summary:",
      JSON.stringify(
        {
          summary: params.scaffold.summary,
          run_command: params.scaffold.run_command,
          test_command: params.scaffold.test_command,
          script_path: params.scaffold.script_path,
          metrics_path: params.scaffold.metrics_path
        },
        null,
        2
      ),
      "",
      "Approved decomposition unit:",
      JSON.stringify(params.unit, null, 2),
      "",
      "Approved top-level decomposition plan:",
      JSON.stringify(params.decompositionPlan, null, 2)
    ].join("\n");
  }

  private buildStagedImplementFileChunkPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    materializationPlan: DynamicMaterializationPlan;
    chunk: DynamicMaterializationChunk;
    parentChunk?: DynamicMaterializationChunk;
    chunkSubdivisionPlan?: DynamicMaterializationPlan;
    chunkIndex: number;
    chunkTotal: number;
    draftSoFar: string;
    chunkDraftSoFar: string;
    completedSectionIds: string[];
    currentFileContent: string;
  }): string {
    return [
      `Staged implement unit chunk generation ${params.chunkIndex}/${params.chunkTotal}.`,
      `Target file: ${params.unit.target_path}`,
      `Target chunk: ${params.chunk.id} — ${params.chunk.title}`,
      "Return ONLY one JSON object with keys: chunk_id, content.",
      "Return only the requested chunk content. Do not repeat earlier chunks. Do not emit markdown fences.",
      "Assume planning is already complete. Focus only on materializing the requested section for the approved file.",
      "Do not redesign the file. Treat the current file state and completed sections as the canonical skeleton you are filling.",
      "Materialize executable source now. Do not return placeholder scaffolding, section summaries, or purpose restatements.",
      ...(isPythonMaterializationPath(params.unit.target_path || "")
        ? [
            "Because the target is a Python source file, content must include concrete Python statements such as imports, assignments, defs, classes, or executable logic.",
            "Do not return comment-only, TODO-only, or doc-outline-only content."
          ]
        : []),
      "",
      "Compact task spec:",
      JSON.stringify(compactTaskSpecForChunkPrompt(params.taskSpec), null, 2),
      "",
      "Approved scaffold summary:",
      JSON.stringify(
        {
          summary: params.scaffold.summary,
          script_path: params.scaffold.script_path,
          metrics_path: params.scaffold.metrics_path
        },
        null,
        2
      ),
      "",
      "Approved decomposition unit:",
      JSON.stringify(compactDecompositionUnitForChunkPrompt(params.unit), null, 2),
      "",
      "Approved materialization chunk plan summary:",
      JSON.stringify(compactMaterializationPlanForChunkPrompt(params.materializationPlan), null, 2),
      "",
      ...(params.chunkDraftSoFar.trim().length > 0
        ? [
            "Parent chunk draft so far:",
            JSON.stringify(compactDraftForChunkPrompt(params.chunkDraftSoFar), null, 2),
            ""
          ]
        : []),
      ...(params.parentChunk
        ? [
            "Parent chunk being decomposed:",
            JSON.stringify(compactMaterializationChunkForChunkPrompt(params.parentChunk), null, 2),
            ""
          ]
        : []),
      ...(params.chunkSubdivisionPlan
        ? [
            "Approved chunk subdivision plan summary:",
            JSON.stringify(compactMaterializationPlanForChunkPrompt(params.chunkSubdivisionPlan), null, 2),
            ""
          ]
        : []),
      "Completed section ids:",
      JSON.stringify(params.completedSectionIds, null, 2),
      "",
      "Requested chunk:",
      JSON.stringify(compactMaterializationChunkForChunkPrompt(params.chunk), null, 2),
      "",
      "Current file excerpt:",
      JSON.stringify(compactDraftForChunkPrompt(params.currentFileContent), null, 2)
    ].join("\n");
  }

  private async completeStagedLlmChunkSubdivisionPlan(input: {
    runDir: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    materializationPlan: DynamicMaterializationPlan;
    chunk: DynamicMaterializationChunk;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
    forceSmallerSubdivision?: boolean;
    previousFailure?: string;
  }): Promise<{ plan: DynamicMaterializationPlan; threadId?: string }> {
    input.emitImplementObservation(
      "codex",
      `Planning dynamic subchunks for ${input.chunk.title}.`,
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );
    const completion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: this.buildStagedImplementChunkSubdivisionPlanPrompt({
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: input.scaffold,
        decompositionPlan: input.decompositionPlan,
        unit: input.unit,
        materializationPlan: input.materializationPlan,
        chunk: input.chunk,
        forceSmallerSubdivision: input.forceSmallerSubdivision,
        previousFailure: input.previousFailure
      }),
      systemPrompt: appendStagedImplementMaterializationPlanOverrideToPrompt(input.unit.target_path || ""),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    const baseId = `${sanitizeArtifactId(input.unit.id)}__${sanitizeArtifactId(input.chunk.id)}`;
    const rawPath = path.join(input.runDir, IMPLEMENT_UNIT_PLAN_DIR, `${baseId}_raw_response.txt`);
    await ensureDir(path.dirname(rawPath));
    await fs.writeFile(rawPath, completion.text, "utf8");
    const plan = parseDynamicMaterializationPlan(parseJsonObject(completion.text));
    if (!plan) {
      throw new Error(
        `staged_llm chunk subdivision planning did not return a parseable dynamic plan for ${input.unit.target_path || input.unit.id}:${input.chunk.id}`
      );
    }
    await writeJsonFile(path.join(input.runDir, IMPLEMENT_UNIT_PLAN_DIR, `${baseId}.json`), plan);
    return {
      plan,
      threadId: completion.threadId || input.threadId
    };
  }

  private buildStagedImplementChunkSubdivisionPlanPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    unit: DynamicDecompositionUnit;
    materializationPlan: DynamicMaterializationPlan;
    chunk: DynamicMaterializationChunk;
    forceSmallerSubdivision?: boolean;
    previousFailure?: string;
  }): string {
    return [
      "Staged implement chunk subdivision plan.",
      "Return only a single bare JSON object with keys: strategy, rationale, chunks.",
      "Subdivide only the requested parent chunk into smaller non-overlapping ordered subchunks.",
      "Chunk schema: {\"id\": string, \"title\": string, \"purpose\": string, \"content_kind\": \"code_section\"|\"config_block\"|\"documentation_section\"|\"text_section\", \"include_imports\"?: boolean, \"include_entrypoint\"?: boolean, \"depends_on\"?: string[], \"verification_focus\"?: string[]}.",
      "Choose the smallest ordered set of subchunks that matches the experiment purpose and verification focus.",
      "Split executable source by function responsibility whenever a parent chunk combines data access, model setup, training/execution, evaluation, or metrics aggregation.",
      "Keep each subchunk narrow enough to materialize as one coherent helper group plus any directly associated call sites.",
      "Returning a single subchunk is valid only when the parent chunk is already one narrow responsibility.",
      ...(params.forceSmallerSubdivision
        ? [
            "The previous attempt to materialize this parent chunk did not complete.",
            "Return a strictly smaller ordered subdivision with at least 2 subchunks.",
            "Use the failure below to choose dependency-safe subchunk boundaries.",
            "If the failure names undefined uppercase constants, the earliest subchunk must define those constants before any dataclass, config, or helper references them; otherwise replace them with literal values or explicit config lookups in the same subchunk.",
            ...(params.previousFailure ? ["Previous materialization failure:", params.previousFailure] : [])
          ]
        : []),
      "",
      "Compact task spec:",
      JSON.stringify(compactTaskSpecForStagedLlmPrompt(params.taskSpec), null, 2),
      "",
      "Branch focus:",
      JSON.stringify(compactBranchPlanForStagedLlmPrompt(params.branchPlan), null, 2),
      "",
      "Localization hints:",
      JSON.stringify(compactLocalizationForStagedLlmPrompt(params.searchLocalization), null, 2),
      "",
      "Approved scaffold summary:",
      JSON.stringify(
        {
          summary: params.scaffold.summary,
          run_command: params.scaffold.run_command,
          test_command: params.scaffold.test_command,
          script_path: params.scaffold.script_path,
          metrics_path: params.scaffold.metrics_path
        },
        null,
        2
      ),
      "",
      "Approved decomposition unit:",
      JSON.stringify(params.unit, null, 2),
      "",
      "Approved materialization plan:",
      JSON.stringify(params.materializationPlan, null, 2),
      "",
      "Requested parent chunk to subdivide:",
      JSON.stringify(params.chunk, null, 2)
    ].join("\n");
  }

  private async completeStagedLlmDecompositionPlan(input: {
    runDir: string;
    workspaceRoot: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    systemPrompt: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
  }): Promise<{ plan?: DynamicDecompositionPlan; threadId?: string } | undefined> {
    input.emitImplementObservation(
      "codex",
      "Scaffold omitted decomposition_plan; synthesizing a purpose-aligned staged_llm decomposition plan.",
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );

    const completion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: this.buildStagedImplementDecompositionPlanPrompt({
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: input.scaffold
      }),
      systemPrompt: appendStagedImplementDecompositionOverrideToPrompt(input.systemPrompt),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    await ensureDir(path.dirname(path.join(input.runDir, IMPLEMENT_DECOMPOSITION_PLAN_RAW_RESPONSE_ARTIFACT)));
    await fs.writeFile(
      path.join(input.runDir, IMPLEMENT_DECOMPOSITION_PLAN_RAW_RESPONSE_ARTIFACT),
      completion.text,
      "utf8"
    );
    const parsed = parseDynamicDecompositionPlan(parseJsonObject(completion.text));
    if (!parsed) {
      return {
        threadId: completion.threadId || input.threadId
      };
    }
    return {
      plan: normalizeDynamicDecompositionPlan(parsed, input.workspaceRoot),
      threadId: completion.threadId || input.threadId
    };
  }

  private async completeStagedLlmMaterializableUnitRepair(input: {
    runDir: string;
    workspaceRoot: string;
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
    systemPrompt: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
    attempt: number;
    threadId?: string;
    publicDir: string;
    emitImplementObservation: (
      stage: ImplementProgressStage,
      message: string,
      extras?: Partial<ImplementProgressStatus>
    ) => void;
    reasoningEffort?: string;
  }): Promise<{ plan?: DynamicDecompositionPlan; threadId?: string } | undefined> {
    input.emitImplementObservation(
      "codex",
      "Decomposition plan omitted materializable text units; requesting a narrower staged_llm repair pass.",
      {
        attempt: input.attempt,
        threadId: input.threadId,
        publicDir: input.publicDir
      }
    );

    const completion = await this.completeStagedLlmRequest({
      runDir: input.runDir,
      prompt: this.buildStagedImplementMaterializableUnitRepairPrompt({
        taskSpec: input.taskSpec,
        searchLocalization: input.searchLocalization,
        branchPlan: input.branchPlan,
        scaffold: input.scaffold,
        decompositionPlan: input.decompositionPlan
      }),
      systemPrompt: appendStagedImplementMaterializableUnitRepairOverrideToPrompt(input.systemPrompt),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      attempt: input.attempt,
      threadId: input.threadId,
      publicDir: input.publicDir,
      emitImplementObservation: input.emitImplementObservation,
      reasoningEffort: input.reasoningEffort
    });
    const repairRawPath = path.join(input.runDir, "implement_experiments", "decomposition_plan_materializable_raw_response.txt");
    await ensureDir(path.dirname(repairRawPath));
    await fs.writeFile(repairRawPath, completion.text, "utf8");
    const parsed = parseDynamicDecompositionPlan(parseJsonObject(completion.text));
    if (!parsed) {
      return {
        threadId: completion.threadId || input.threadId
      };
    }
    return {
      plan: normalizeDynamicDecompositionPlan(parsed, input.workspaceRoot),
      threadId: completion.threadId || input.threadId
    };
  }

  private buildStagedImplementDecompositionPlanPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
  }): string {
    const repairContext = buildCompactImplementDecompositionRepairContext({
      taskSpec: params.taskSpec,
      searchLocalization: params.searchLocalization,
      branchPlan: params.branchPlan,
      scaffold: params.scaffold
    });
    return [
      "Staged implement decomposition planning repair.",
      "Return only a single bare JSON object. Do not use markdown fences. Do not add commentary.",
      "Schema: {\"objective\": string, \"strategy\": string, \"rationale\": string, \"units\": DynamicUnit[]}.",
      "DynamicUnit schema: {\"id\": string, \"unit_type\": \"text_file\"|\"config_file\"|\"documentation_file\"|\"analysis_step\"|\"execution_step\"|\"verification_step\", \"title\": string, \"purpose\": string, \"generation_mode\": \"materialize_text_file\"|\"plan_only\", \"target_path\"?: string, \"depends_on\"?: string[], \"verification_focus\"?: string[]}.",
      "Use generation_mode=materialize_text_file only for text artifacts AutoLabOS must materialize now.",
      "Return only the smallest set of units actually required for this experiment bundle.",
      "Make the decomposition purpose-aligned to this experiment only. Do not invent generic units that the current research goal does not need.",
      "",
      "Example valid shape:",
      JSON.stringify(
        {
          objective: "Materialize a bounded experiment bundle for the selected research goal.",
          strategy: "purpose_adaptive_minimal_bundle",
          rationale: "This experiment needs one runner, one config, and one README.",
          units: [
            {
              id: "runner",
              unit_type: "text_file",
              title: "Primary experiment runner",
              purpose: "Run the main bounded experiment.",
              generation_mode: "materialize_text_file",
              target_path: params.scaffold.script_path || "outputs/example/experiment/run_experiment.py",
              verification_focus: ["run_command", "script_exists"]
            }
          ]
        },
        null,
        2
      ),
      "",
      "Repair context:",
      JSON.stringify(repairContext, null, 2)
    ].join("\n");
  }

  private buildStagedImplementMaterializableUnitRepairPrompt(params: {
    taskSpec: ImplementTaskSpec;
    searchLocalization: LocalizationResult;
    branchPlan: BranchPlan;
    scaffold: StructuredImplementResponse;
    decompositionPlan: DynamicDecompositionPlan;
  }): string {
    const materializableTargets = [
      params.scaffold.script_path,
      ...(params.scaffold.changed_files || []),
      ...(params.scaffold.file_plan || [])
    ].filter((value, index, array): value is string => typeof value === "string" && value.length > 0 && array.indexOf(value) === index);
    return [
      "Staged implement decomposition repair for materializable text units.",
      "Return only a single bare JSON object. Do not use markdown fences. Do not add commentary.",
      "Schema: {\"objective\": string, \"strategy\": string, \"rationale\": string, \"units\": DynamicUnit[]}.",
      "DynamicUnit schema: {\"id\": string, \"unit_type\": \"text_file\"|\"config_file\"|\"documentation_file\"|\"analysis_step\"|\"execution_step\"|\"verification_step\", \"title\": string, \"purpose\": string, \"generation_mode\": \"materialize_text_file\"|\"plan_only\", \"target_path\"?: string, \"depends_on\"?: string[], \"verification_focus\"?: string[]}.",
      "The previous decomposition omitted materializable text units. Repair it.",
      "You MUST return at least one unit with generation_mode=\"materialize_text_file\".",
      "If the scaffold names script_path, changed_files, or file_plan entries, use those paths for the materialized units unless they are clearly wrong.",
      "Return only the smallest set of materializable text units needed for the current experiment bundle.",
      "",
      "Compact task spec:",
      JSON.stringify(compactTaskSpecForStagedLlmPrompt(params.taskSpec), null, 2),
      "",
      "Branch focus:",
      JSON.stringify(compactBranchPlanForStagedLlmPrompt(params.branchPlan), null, 2),
      "",
      "Localization hints:",
      JSON.stringify(compactLocalizationForStagedLlmPrompt(params.searchLocalization), null, 2),
      "",
      "Approved scaffold:",
      JSON.stringify(
        {
          summary: params.scaffold.summary,
          run_command: params.scaffold.run_command,
          test_command: params.scaffold.test_command,
          script_path: params.scaffold.script_path,
          changed_files: params.scaffold.changed_files,
          file_plan: params.scaffold.file_plan,
          public_dir: params.scaffold.public_dir,
          metrics_path: params.scaffold.metrics_path
        },
        null,
        2
      ),
      "",
      "Current decomposition plan that needs repair:",
      JSON.stringify(params.decompositionPlan, null, 2),
      "",
      "Candidate materializable target paths:",
      JSON.stringify(materializableTargets, null, 2)
    ].join("\n");
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
    const normalizedFileEdits = normalizeStructuredFileEdits(parsed.file_edits, params.workspaceRoot);

    await params.attemptSnapshot?.capturePaths([
      normalizedPublicDir,
      normalizedMetricsPath,
      ...normalizedFileEdits.map((item) => item.path)
    ]);
    await materializeStructuredFileEdits(normalizedFileEdits);
    for (const item of normalizedFileEdits) {
      params.changedFiles.add(item.path);
      params.artifacts.add(item.path);
      if (isSubpath(item.path, normalizedPublicDir)) {
        params.publicArtifacts.add(item.path);
      }
    }

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
        timeoutSec: this.deps.config.experiments.timeout_sec
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

    const pythonUnfilledSections = await detectPythonUnfilledAutolabosSections(executionScriptPath);
    if (pythonUnfilledSections) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUnfilledSections,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUnfilledSections)
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

    const verificationSurfaceReport = validateVerificationCommandSurface({
      comparisonContract: attempt.comparisonContract,
      verificationCommand: command,
      workingDir: attempt.workingDir,
      scriptPath: attempt.scriptPath,
      metricsPath: attempt.metricsPath,
      runCommand: attempt.runCommand
    });
    if (verificationSurfaceReport.verdict === "block") {
      const report = buildDesignImplementationValidationVerifyReport(verificationSurfaceReport);
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

    const pythonCsvFieldMismatch = await detectPythonCsvFieldnameMismatch(executionScriptPath);
    if (pythonCsvFieldMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonCsvFieldMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonCsvFieldMismatch)
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

    const pythonNonExecutableRunner = await detectPythonNonExecutableRunnerSurface(executionScriptPath);
    if (pythonNonExecutableRunner) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonNonExecutableRunner,
        summary: buildVerificationFailureSummary(command, "implementation", pythonNonExecutableRunner)
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

    const pythonUnsupportedGenerateKwarg = await detectPythonUnsupportedGenerateKwarg(executionScriptPath);
    if (pythonUnsupportedGenerateKwarg) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUnsupportedGenerateKwarg,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUnsupportedGenerateKwarg)
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

    const trainingArgumentsRepair = await repairPythonUnsupportedTrainingArgumentsKwargs(executionScriptPath);
    if (trainingArgumentsRepair.repaired) {
      onProgress?.(
        trainingArgumentsRepair.message ||
          "Removed unsupported TrainingArguments kwargs before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            trainingArgumentsRepair.message ||
            "Removed unsupported TrainingArguments kwargs before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const trainerTokenizerRepair = await repairPythonUnsupportedTrainerKwargs(executionScriptPath);
    if (trainerTokenizerRepair.repaired) {
      onProgress?.(
        trainerTokenizerRepair.message ||
          "Removed unsupported Trainer kwargs before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            trainerTokenizerRepair.message ||
            "Removed unsupported Trainer kwargs before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const trainerLabelPaddingRepair = await repairPythonTrainerLabelPaddingCollatorSurface(executionScriptPath);
    if (trainerLabelPaddingRepair.repaired) {
      onProgress?.(
        trainerLabelPaddingRepair.message ||
          "Repaired Trainer collator label padding before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            trainerLabelPaddingRepair.message ||
            "Repaired Trainer collator label padding before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const helperAdapterRepair = await repairPythonBroadCompatibleCallAdapterSurface(executionScriptPath);
    if (helperAdapterRepair.repaired) {
      onProgress?.(
        helperAdapterRepair.message ||
          "Repaired broad helper compatibility adapter before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            helperAdapterRepair.message ||
            "Repaired broad helper compatibility adapter before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const orchestrationArgumentRepair = await repairPythonOrchestrationArgumentSurface(executionScriptPath);
    if (orchestrationArgumentRepair.repaired) {
      onProgress?.(
        orchestrationArgumentRepair.message ||
          "Repaired orchestration argument preparation before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            orchestrationArgumentRepair.message ||
            "Repaired orchestration argument preparation before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const jsonSafeAliasRepair = await repairPythonJsonSafeHelperAlias(executionScriptPath);
    if (jsonSafeAliasRepair.repaired) {
      onProgress?.(
        jsonSafeAliasRepair.message ||
          "Repaired JSON-safe helper alias before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            jsonSafeAliasRepair.message ||
            "Repaired JSON-safe helper alias before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const ensureDirRepair = await repairPythonEnsureDirHelperSurface(executionScriptPath);
    if (ensureDirRepair.repaired) {
      onProgress?.(
        ensureDirRepair.message ||
          "Added missing ensure_dir directory helper before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            ensureDirRepair.message ||
            "Added missing ensure_dir directory helper before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const pythonUnsupportedTrainingArgumentsKwarg = await detectPythonUnsupportedTrainingArgumentsKwarg(executionScriptPath);
    if (pythonUnsupportedTrainingArgumentsKwarg) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUnsupportedTrainingArgumentsKwarg,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUnsupportedTrainingArgumentsKwarg)
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

    const pythonUndefinedConstantReferences = await detectPythonUndefinedUppercaseReferences(executionScriptPath);
    if (pythonUndefinedConstantReferences) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUndefinedConstantReferences,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUndefinedConstantReferences)
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

    const peftRecipeAliasRepair = await repairPythonMissingPeftRecipeSurface(executionScriptPath);
    if (peftRecipeAliasRepair.repaired) {
      onProgress?.(
        peftRecipeAliasRepair.message ||
          "Repaired missing PEFTRecipe compatibility surface before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            peftRecipeAliasRepair.message ||
            "Repaired missing PEFTRecipe compatibility surface before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const annotationRepair = await repairPythonUndefinedAnnotationReferences(executionScriptPath);
    if (annotationRepair.repaired) {
      onProgress?.(
        annotationRepair.message ||
          "Postponed Python annotation evaluation before local verification.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            annotationRepair.message ||
            "Postponed Python annotation evaluation before local verification."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const pythonUndefinedAnnotationReferences = await detectPythonUndefinedAnnotationReferences(executionScriptPath);
    if (pythonUndefinedAnnotationReferences) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUndefinedAnnotationReferences,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUndefinedAnnotationReferences)
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

    const pythonUndefinedSlugifyReference = await detectPythonUndefinedSlugifyReference(executionScriptPath);
    if (pythonUndefinedSlugifyReference) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUndefinedSlugifyReference,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUndefinedSlugifyReference)
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

    const pythonUndefinedRuntimeHelper = await detectPythonUndefinedRuntimeHelperReferences(executionScriptPath);
    if (pythonUndefinedRuntimeHelper) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUndefinedRuntimeHelper,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUndefinedRuntimeHelper)
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

    const pythonGlobalsHelperArityMismatch =
      await detectPythonGlobalsHelperCallArityMismatch(executionScriptPath);
    if (pythonGlobalsHelperArityMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonGlobalsHelperArityMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonGlobalsHelperArityMismatch)
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

    const pythonMissingRecipeWorkflow = await detectPythonMissingRegisteredRecipeWorkflow(executionScriptPath);
    if (pythonMissingRecipeWorkflow) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonMissingRecipeWorkflow,
        summary: buildVerificationFailureSummary(command, "implementation", pythonMissingRecipeWorkflow)
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

    const pythonEmptyPeftRecipeRegistry = await detectPythonEmptyPeftRecipeRegistry(executionScriptPath);
    if (pythonEmptyPeftRecipeRegistry) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonEmptyPeftRecipeRegistry,
        summary: buildVerificationFailureSummary(command, "implementation", pythonEmptyPeftRecipeRegistry)
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

    const pythonUnguardedOptionalHelperCall = await detectPythonUnguardedOptionalHelperCall(executionScriptPath);
    if (pythonUnguardedOptionalHelperCall) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonUnguardedOptionalHelperCall,
        summary: buildVerificationFailureSummary(command, "implementation", pythonUnguardedOptionalHelperCall)
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

    const pythonMissingBenchmarkEvaluator = await detectPythonMissingBenchmarkEvaluatorDispatch(executionScriptPath);
    if (pythonMissingBenchmarkEvaluator) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonMissingBenchmarkEvaluator,
        summary: buildVerificationFailureSummary(command, "implementation", pythonMissingBenchmarkEvaluator)
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

    const pythonBenchmarkLoaderMismatch = await detectPythonBenchmarkLoaderDispatchMismatch(executionScriptPath);
    if (pythonBenchmarkLoaderMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonBenchmarkLoaderMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonBenchmarkLoaderMismatch)
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

    const pythonInvokeHelperMismatch = await detectPythonInvokeHelperDispatchMismatch(executionScriptPath);
    if (pythonInvokeHelperMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonInvokeHelperMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonInvokeHelperMismatch)
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

    const pythonMetricsWriterMismatch = await detectPythonMetricsWriterAdapterMismatch(executionScriptPath);
    if (pythonMetricsWriterMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonMetricsWriterMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonMetricsWriterMismatch)
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

    const pythonAtomicJsonMismatch = await detectPythonAtomicWriteJsonCallOrderMismatch(executionScriptPath);
    if (pythonAtomicJsonMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonAtomicJsonMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonAtomicJsonMismatch)
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

    const pythonEvaluationSampleAccessMismatch =
      await detectPythonEvaluationSampleDictAccessMismatch(executionScriptPath);
    if (pythonEvaluationSampleAccessMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonEvaluationSampleAccessMismatch,
        summary: buildVerificationFailureSummary(
          command,
          "implementation",
          pythonEvaluationSampleAccessMismatch
        )
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

    const pythonDictRecipeAttributeAccess = await detectPythonDictRecipeAttributeAccess(executionScriptPath);
    if (pythonDictRecipeAttributeAccess) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonDictRecipeAttributeAccess,
        summary: buildVerificationFailureSummary(command, "implementation", pythonDictRecipeAttributeAccess)
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

    const pythonRecipeSpecConstructorMismatch =
      await detectPythonRecipeSpecConstructorKeywordMismatch(executionScriptPath);
    if (pythonRecipeSpecConstructorMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: pythonRecipeSpecConstructorMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", pythonRecipeSpecConstructorMismatch)
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

    const executionConfigPath =
      extractConfigPathFromCommand(attempt.runCommand, attempt.workingDir) ||
      (attempt.publicDir ? path.join(attempt.publicDir, "experiment_config.yaml") : undefined);

    const parseArgsRepair = await repairPythonMissingParseArgsSurface(executionScriptPath);
    if (parseArgsRepair.repaired) {
      onProgress?.(parseArgsRepair.message || "Repaired runner CLI compatibility before handoff.", {
        verificationCommand: command
      });
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: parseArgsRepair.message || "Repaired runner CLI compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const outputDirArgparseRepair = await repairPythonOutputDirArgparseAlias(
      executionScriptPath,
      attempt.runCommand
    );
    if (outputDirArgparseRepair.repaired) {
      onProgress?.(outputDirArgparseRepair.message || "Repaired runner --output-dir CLI compatibility before handoff.", {
        verificationCommand: command
      });
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: outputDirArgparseRepair.message || "Repaired runner --output-dir CLI compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const runCommandArgparseMismatch = await detectPythonRunCommandArgparseMismatch(
      executionScriptPath,
      attempt.runCommand
    );
    if (runCommandArgparseMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command: attempt.runCommand,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: runCommandArgparseMismatch,
        summary: buildVerificationFailureSummary(
          attempt.runCommand,
          "implementation",
          runCommandArgparseMismatch
        )
      };
      this.deps.eventStream.emit({
        type: "TEST_FAILED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          command: attempt.runCommand,
          cwd: attempt.workingDir,
          failure_type: report.failure_type,
          stderr: report.stderr_excerpt || report.summary,
          attempt: attemptNumber
        }
      });
      onProgress?.(report.summary, {
        verificationCommand: attempt.runCommand,
        verifyStatus: report.status
      });
      return report;
    }

    const lockedConditionCountRepair = await repairPythonLockedConditionCountSurface(executionScriptPath);
    if (lockedConditionCountRepair.repaired) {
      onProgress?.(
        lockedConditionCountRepair.message ||
          "Aligned locked-condition counting compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            lockedConditionCountRepair.message ||
            "Aligned locked-condition counting compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const conditionHelperRepair = await repairPythonConditionHelperSurface(executionScriptPath);
    if (conditionHelperRepair.repaired) {
      onProgress?.(
        conditionHelperRepair.message || "Aligned condition-helper invocation compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            conditionHelperRepair.message || "Aligned condition-helper invocation compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const experimentConfigMetadataRepair = await repairPythonExperimentConfigMetadataSurface(executionScriptPath);
    if (experimentConfigMetadataRepair.repaired) {
      onProgress?.(
        experimentConfigMetadataRepair.message ||
          "Repaired ExperimentConfig metadata compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            experimentConfigMetadataRepair.message ||
            "Repaired ExperimentConfig metadata compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const recipeSpecPeftTypeRepair = await repairPythonRecipeSpecPeftTypeSurface(executionScriptPath);
    if (recipeSpecPeftTypeRepair.repaired) {
      onProgress?.(
        recipeSpecPeftTypeRepair.message ||
          "Repaired RecipeSpec peft_type compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            recipeSpecPeftTypeRepair.message ||
            "Repaired RecipeSpec peft_type compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const recipeSpecAdapterTypeRepair = await repairPythonRecipeSpecAdapterTypeSurface(executionScriptPath);
    if (recipeSpecAdapterTypeRepair.repaired) {
      onProgress?.(
        recipeSpecAdapterTypeRepair.message ||
          "Repaired RecipeSpec adapter_type compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            recipeSpecAdapterTypeRepair.message ||
            "Repaired RecipeSpec adapter_type compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const recipeSpecNameRepair = await repairPythonRecipeSpecNameSurface(executionScriptPath);
    if (recipeSpecNameRepair.repaired) {
      onProgress?.(
        recipeSpecNameRepair.message ||
          "Repaired RecipeSpec name compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            recipeSpecNameRepair.message ||
            "Repaired RecipeSpec name compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const objectRecipeSubscriptRepair = await repairPythonObjectRecipeSubscriptSurface(executionScriptPath);
    if (objectRecipeSubscriptRepair.repaired) {
      onProgress?.(
        objectRecipeSubscriptRepair.message ||
          "Repaired object-backed recipe subscript compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            objectRecipeSubscriptRepair.message ||
            "Repaired object-backed recipe subscript compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const orchestrationCandidateRepair = await repairPythonOrchestrationCandidateSurface(executionScriptPath);
    if (orchestrationCandidateRepair.repaired) {
      onProgress?.(
        orchestrationCandidateRepair.message ||
          "Aligned experiment orchestration entrypoint compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            orchestrationCandidateRepair.message ||
            "Aligned experiment orchestration entrypoint compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const baselineExecutionCandidateRepair =
      await repairPythonBaselineFirstExecutionCandidateSurface(executionScriptPath);
    if (baselineExecutionCandidateRepair.repaired) {
      onProgress?.(
        baselineExecutionCandidateRepair.message ||
          "Aligned baseline-first execution helper compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            baselineExecutionCandidateRepair.message ||
            "Aligned baseline-first execution helper compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const entrypointTypeErrorFallbackRepair = await repairPythonEntrypointTypeErrorFallbackSurface(executionScriptPath);
    if (entrypointTypeErrorFallbackRepair.repaired) {
      onProgress?.(
        entrypointTypeErrorFallbackRepair.message ||
          "Repaired entrypoint TypeError fallback compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            entrypointTypeErrorFallbackRepair.message ||
            "Repaired entrypoint TypeError fallback compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const lockedStandardLoraBaselineIdRepair =
      await repairPythonLockedStandardLoraBaselineIdSurface(executionScriptPath);
    if (lockedStandardLoraBaselineIdRepair.repaired) {
      onProgress?.(
        lockedStandardLoraBaselineIdRepair.message ||
          "Aligned locked standard LoRA baseline recipe id before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            lockedStandardLoraBaselineIdRepair.message ||
            "Aligned locked standard LoRA baseline recipe id before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const baselineFirstRecipeOrderRepair = await repairPythonBaselineFirstRecipeOrderSurface(executionScriptPath);
    if (baselineFirstRecipeOrderRepair.repaired) {
      onProgress?.(
        baselineFirstRecipeOrderRepair.message ||
          "Aligned baseline-first recipe ordering compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            baselineFirstRecipeOrderRepair.message ||
            "Aligned baseline-first recipe ordering compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const baselineFirstTunedBaselineMismatch = await detectPythonBaselineFirstTunedBaselineMismatch(executionScriptPath);
    if (baselineFirstTunedBaselineMismatch) {
      const report: VerifyReport = {
        status: "fail",
        command,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: baselineFirstTunedBaselineMismatch,
        summary: buildVerificationFailureSummary(command, "implementation", baselineFirstTunedBaselineMismatch)
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

    const transformersSetSeedRepair = await repairPythonTransformersSetSeedAliasSurface(executionScriptPath);
    if (transformersSetSeedRepair.repaired) {
      onProgress?.(
        transformersSetSeedRepair.message ||
          "Aligned Transformers set_seed compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            transformersSetSeedRepair.message ||
            "Aligned Transformers set_seed compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const strictJsonMetricsRepair = await repairPythonStrictJsonMetricsSurface(executionScriptPath);
    if (strictJsonMetricsRepair.repaired) {
      onProgress?.(
        strictJsonMetricsRepair.message ||
          "Normalized metrics JSON serialization before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            strictJsonMetricsRepair.message ||
            "Normalized metrics JSON serialization before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    const lockedConfigRepair = await repairLockedPeftStudyConfigSurface(executionConfigPath);
    if (lockedConfigRepair.repaired) {
      onProgress?.(
        lockedConfigRepair.message || "Normalized locked PEFT study config compatibility before handoff.",
        {
          verificationCommand: command
        }
      );
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text:
            lockedConfigRepair.message || "Normalized locked PEFT study config compatibility before handoff."
        }
      });
      const repairedObs = await this.deps.aci.runTests(executionCommand, executionCwd, abortSignal);
      const repairedReport = summarizeVerification(command, attempt.workingDir, repairedObs, attempt.localization);
      if (repairedReport.status === "fail") {
        this.deps.eventStream.emit({
          type: "TEST_FAILED",
          runId,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            command,
            cwd: attempt.workingDir,
            failure_type: repairedReport.failure_type,
            stderr: repairedReport.stderr_excerpt || repairedReport.summary,
            attempt: attemptNumber
          }
        });
        onProgress?.(repairedReport.summary, {
          verificationCommand: command,
          verifyStatus: repairedReport.status
        });
        return repairedReport;
      }
    }

    if (attempt.experimentMode === "real_execution" && commandRequestsDryRun(attempt.runCommand)) {
      const dryRunSummary =
        "Real-execution handoff is blocked because the generated run_command still includes --dry-run and would never emit governed metrics.";
      const report: VerifyReport = {
        status: "fail",
        command: attempt.runCommand,
        cwd: attempt.workingDir,
        exit_code: 0,
        failure_type: "implementation",
        next_action: "retry_patch",
        stderr_excerpt: dryRunSummary,
        summary: buildVerificationFailureSummary(attempt.runCommand, "implementation", dryRunSummary)
      };
      this.deps.eventStream.emit({
        type: "TEST_FAILED",
        runId,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          command: attempt.runCommand,
          cwd: attempt.workingDir,
          failure_type: report.failure_type,
          stderr: report.stderr_excerpt || report.summary,
          attempt: attemptNumber
        }
      });
      onProgress?.(report.summary, {
        verificationCommand: attempt.runCommand,
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
      assumptions: asStringArray(record.assumptions),
      decomposition_plan: parseDynamicDecompositionPlan(record.decomposition_plan),
      file_plan: asStringArray(record.file_plan),
      file_edits: asStructuredFileEdits(record.file_edits)
    },
    isStructured: true
  };
}

function asStructuredFileEdits(value: unknown): StructuredImplementFileEdit[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const edits = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const filePath = asString(record.path);
      const content = asString(record.content);
      if (!filePath || content === undefined) {
        return undefined;
      }
      return { path: filePath, content };
    })
    .filter((item): item is StructuredImplementFileEdit => Boolean(item));
  return edits.length > 0 ? edits : undefined;
}

function normalizeStructuredFileEdits(
  fileEdits: StructuredImplementFileEdit[] | undefined,
  workspaceRoot: string
): StructuredImplementFileEdit[] {
  return (fileEdits || [])
    .map((item) => {
      const normalizedPath = normalizeStoredPath(item.path, workspaceRoot);
      if (!normalizedPath) {
        return undefined;
      }
      return {
        path: normalizedPath,
        content: item.content
      };
    })
    .filter((item): item is StructuredImplementFileEdit => Boolean(item));
}

function parseStructuredChunkResponse(text: string, expectedChunkId: string): string {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("staged_llm chunk response did not contain a valid JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const chunkId = typeof record.chunk_id === "string" ? record.chunk_id.trim() : "";
  const content = typeof record.content === "string" ? record.content : "";
  if (chunkId !== expectedChunkId) {
    throw new Error(`staged_llm chunk response returned chunk_id=${chunkId || "<missing>"} but expected ${expectedChunkId}`);
  }
  if (!content.trim()) {
    throw new Error(`staged_llm chunk response for ${expectedChunkId} contained no content`);
  }
  return content;
}

function normalizeStagedLlmChunkContent(content: string, filePath: string): string {
  if (!isPythonMaterializationPath(filePath)) {
    return content;
  }
  const lines = content.split(/\r?\n/u);
  const withoutFutureImports = lines.filter(
    (line) => !/^\s*from\s+__future__\s+import\s+annotations\s*(?:#.*)?$/u.test(line)
  );
  return withoutFutureImports.join("\n");
}

function ensureMaterializedChunkHasSubstance(content: string, filePath: string, chunkId: string): void {
  if (hasSubstantiveMaterializedContent(content, filePath)) {
    return;
  }
  throw new Error(
    `staged_llm chunk response for ${chunkId} on ${filePath} only contained placeholder/comment scaffolding`
  );
}

function ensureMaterializedFileHasSubstance(content: string, filePath: string): void {
  if (hasSubstantiveMaterializedContent(content, filePath)) {
    return;
  }
  throw new Error(`staged_llm materialization for ${filePath} produced no substantive source content`);
}

function hasSubstantiveMaterializedContent(content: string, filePath: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  if (!isPythonMaterializationPath(filePath)) {
    return true;
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => !line.startsWith("#"));
}

async function detectPythonUnfilledAutolabosSections(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }
  if (!source.includes("AUTOLABOS SECTION")) {
    return undefined;
  }
  const sectionIds = Array.from(source.matchAll(/^\s*#\s*BEGIN AUTOLABOS SECTION\s+([^\s:]+)/gmu))
    .map((match) => match[1])
    .filter(Boolean);
  const uniqueIds = dedupeStrings(sectionIds);
  const visible = uniqueIds.slice(0, 8).join(", ");
  return [
    "Generated Python runner still contains AUTOLABOS SECTION skeleton markers after staged materialization.",
    "Final experiment scripts must contain executable code, not planning-only section placeholders.",
    visible ? `Unfilled or unstripped section marker(s): ${visible}.` : "Unfilled section markers are present.",
    "Regenerate the affected sections, including the CLI entrypoint and metrics writer, before handoff."
  ].join(" ");
}

const RECIPE_WORKFLOW_ENTRYPOINT_NAMES = [
  "run_baseline_first_peft_comparison",
  "run_baseline_first_candidate_evaluation",
  "run_baseline_first_recipe_comparison",
  "run_peft_recipe_comparison",
  "execute_recipe_comparison",
  "run_recipe_comparison",
  "run_recipe_execution_and_evaluation_loop",
  "execute_recipe_execution_and_evaluation_loop",
  "run_recipe_execution_evaluation_loop",
  "run_baseline_first_peft_study",
  "run_locked_peft_instruction_study",
  "run_locked_peft_study",
  "run_peft_study",
  "run_experiment_rows",
  "run_locked_recipe_rows",
  "run_recipe_experiment_loop",
  "run_locked_peft_experiment_rows",
  "run_study_comparison",
  "run_study_orchestration",
  "run_orchestration_and_status_handling",
  "run_study",
  "run_study_execution",
  "execute_study_with_status",
  "run_study_with_status",
  "run_full_study_with_status",
  "execute_study_from_args",
  "run_peft_instruction_study",
  "execute_peft_instruction_study",
  "orchestrate_experiment",
  "orchestrate_study",
  "execute_experiment",
  "execute_baseline_first_study",
  "run_baseline_first_execution",
  "execute_baseline_first_execution",
  "run_experiment_with_status",
  "run_experiment",
  "run_baseline_first_experiment",
  "run_baseline_first_study",
  "build_and_write_metrics_payload",
  "compare_peft_recipes",
  "run_all_recipes"
];

async function detectPythonMissingRegisteredRecipeWorkflow(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const referencedNames = RECIPE_WORKFLOW_ENTRYPOINT_NAMES.filter(
    (name) => source.includes(`"${name}"`) || source.includes(`'${name}'`)
  );
  if (referencedNames.length === 0) {
    return undefined;
  }

  const hasRegisteredWorkflowDispatcher =
    source.includes("_call_registered_study_workflow") ||
    source.includes("def _autolabos_invoke_orchestration(") ||
    source.includes("No recipe comparison workflow function was registered") ||
    source.includes("No compatible experiment orchestration function was found") ||
    source.includes("No experiment orchestration function was found") ||
    source.includes("No experiment orchestration helper is available from earlier sections") ||
    source.includes("No study orchestration function was found") ||
    source.includes("No baseline-first PEFT study execution helper was found") ||
    source.includes("No executable study helper was found in completed sections") ||
    source.includes("None of the required functions are available");
  if (!hasRegisteredWorkflowDispatcher) {
    return undefined;
  }

  const definedNames = referencedNames.filter((name) =>
    new RegExp(`\\ndef\\s+${escapeRegex(name)}\\s*\\(`, "u").test(`\n${source}`)
  );
  if (definedNames.length > 0) {
    return undefined;
  }

  const repairableOrchestrationCandidates = [
    "execute_locked_recipe_plan",
    "orchestrate_locked_recipe_plan",
    "run_locked_recipe_plan"
  ].filter((name) => new RegExp(`\\ndef\\s+${escapeRegex(name)}\\s*\\(`, "u").test(`\n${source}`));
  if (
    repairableOrchestrationCandidates.length > 0 &&
    source.includes("def _invoke_experiment_orchestration(") &&
    source.includes("candidate_names")
  ) {
    return undefined;
  }

  const visible = referencedNames.slice(0, 8).join(", ");
  return [
    "Generated Python runner dispatches to recipe/study workflow function names that are never defined.",
    visible ? `Undefined searched workflow function(s): ${visible}.` : undefined,
    "Define one executable baseline-first recipe/study workflow function, or align the dispatcher with the generated workflow before handoff."
  ].filter(Boolean).join(" ");
}

async function detectPythonEmptyPeftRecipeRegistry(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (
    !source.includes("No PEFT recipes selected") ||
    !source.includes("PEFT_RECIPES") ||
    !source.includes("parse_args")
  ) {
    return undefined;
  }

  const peftRecipesAssignment = /^\s*PEFT_RECIPES\s*(?::[^\n=]+)?=\s*([^\n#]+)/mu.exec(source);
  if (!peftRecipesAssignment) {
    return [
      "Generated Python runner can select no PEFT recipes by default.",
      "CLI normalization raises 'No PEFT recipes selected' but no PEFT_RECIPES registry is defined.",
      "Define a non-empty PEFT_RECIPES registry with the locked baseline-first trainable recipe before handoff."
    ].join(" ");
  }

  const assignmentValue = peftRecipesAssignment[1]?.trim() || "";
  if (/^(?:\[\s*\]|\(\s*\)|list\s*\(\s*\)|tuple\s*\(\s*\))$/u.test(assignmentValue)) {
    return [
      "Generated Python runner can select no PEFT recipes by default.",
      "PEFT_RECIPES is defined as an empty registry while CLI normalization rejects empty recipe selections.",
      "Populate PEFT_RECIPES with at least the locked standard LoRA baseline before handoff."
    ].join(" ");
  }

  return undefined;
}

async function detectPythonUnguardedOptionalHelperCall(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const optionalHelperNames = ["set_seed"];
  for (const helperName of optionalHelperNames) {
    const helperDefinitionPattern = new RegExp(`^\\s*def\\s+${escapeRegex(helperName)}\\s*\\(`, "mu");
    if (helperDefinitionPattern.test(source)) {
      continue;
    }

    const helperAvailabilityGuardPattern = new RegExp(
      `["']${escapeRegex(helperName)}["']\\s+in\\s+globals\\s*\\(\\s*\\)|globals\\s*\\(\\s*\\)\\s*\\.\\s*get\\s*\\(\\s*["']${escapeRegex(helperName)}["']`,
      "u"
    );
    if (!helperAvailabilityGuardPattern.test(source)) {
      continue;
    }

    const callLines = source.split(/\r?\n/u)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => new RegExp(`\\b${escapeRegex(helperName)}\\s*\\(`, "u").test(line));
    const unsafeCall = callLines.find(({ line }) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("def ")) {
        return false;
      }
      return new RegExp(
        `\\b${escapeRegex(helperName)}\\s*\\([^\\n]*\\bif\\s+["']${escapeRegex(helperName)}["']\\s+in\\s+globals\\s*\\(\\s*\\)\\s+else\\b`,
        "u"
      ).test(line);
    });
    if (!unsafeCall) {
      continue;
    }

    return [
      `Generated Python runner calls optional helper ${helperName} without defining it.`,
      `Line ${unsafeCall.lineNumber} checks ${helperName} availability only inside the call argument, so the ${helperName}(...) call still raises NameError when the helper is absent.`,
      `Define ${helperName}, import it, or guard the call itself before handoff.`
    ].join(" ");
  }

  return undefined;
}

const BENCHMARK_EVALUATOR_ENTRYPOINT_NAMES = [
  "evaluate_zero_shot_benchmarks",
  "evaluate_model_on_benchmarks",
  "evaluate_benchmarks",
  "compute_benchmark_accuracies",
  "run_zero_shot_benchmark_evaluation",
  "evaluate_multiple_choice_benchmarks"
];

const KNOWN_GENERATED_BENCHMARK_EVALUATOR_NAMES = [
  "evaluate_multiple_choice_accuracy",
  "evaluate_candidate_model",
  "evaluate_arc_challenge_and_hellaswag",
  "evaluate_zero_shot_benchmarks",
  "evaluate_benchmarks_for_candidate",
  "run_benchmark_evaluation"
];

const BENCHMARK_LOADER_ENTRYPOINT_NAMES = [
  "load_benchmark_eval_examples",
  "load_benchmark_datasets",
  "load_evaluation_benchmarks",
  "load_evaluation_sets",
  "load_benchmark_eval_sets",
  "load_eval_subsets",
  "prepare_evaluation_sets"
];

async function detectPythonMissingBenchmarkEvaluatorDispatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const hasBaselineCandidateEvaluator =
    source.includes("No benchmark evaluator was defined by the evaluation_metrics_logic section") ||
    source.includes("No zero-shot benchmark evaluation function was defined in earlier sections") ||
    source.includes("evaluation_metrics_logic section") ||
    source.includes("_evaluate_candidate_for_run");
  if (!hasBaselineCandidateEvaluator) {
    return undefined;
  }

  const referencedEntrypoints = BENCHMARK_EVALUATOR_ENTRYPOINT_NAMES.filter(
    (name) => source.includes(`"${name}"`) || source.includes(`'${name}'`)
  );
  if (referencedEntrypoints.length === 0) {
    return undefined;
  }

  const definedEntrypoints = referencedEntrypoints.filter((name) =>
    pythonSourceDefinesName(source, name)
  );
  if (definedEntrypoints.length > 0) {
    return undefined;
  }

  const generatedEvaluatorNames = KNOWN_GENERATED_BENCHMARK_EVALUATOR_NAMES.filter((name) =>
    pythonSourceDefinesName(source, name)
  );
  const explicitMissingEvaluatorRuntimeError = source.includes(
    "No zero-shot benchmark evaluation function was defined in earlier sections"
  );
  if (generatedEvaluatorNames.length === 0 && !explicitMissingEvaluatorRuntimeError) {
    return undefined;
  }

  const visibleReferenced = referencedEntrypoints.join(", ");
  const visibleGenerated = generatedEvaluatorNames.slice(0, 6).join(", ") || "none";
  return [
    "Generated Python runner has a benchmark evaluator dispatch mismatch.",
    `Baseline-first candidate evaluation searches for undefined evaluator entrypoint(s): ${visibleReferenced}.`,
    `Generated evaluator function(s) exist under different name(s): ${visibleGenerated}.`,
    "Define one searched evaluator entrypoint, or align the candidate evaluator lookup with the generated benchmark evaluator before handoff."
  ].join(" ");
}

async function detectPythonBenchmarkLoaderDispatchMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const hasExplicitMissingLoaderRuntimeError = source.includes(
    "No benchmark examples were provided and no benchmark-loading helper is available"
  );
  if (!hasExplicitMissingLoaderRuntimeError) {
    return undefined;
  }

  const referencedLoaderNames = BENCHMARK_LOADER_ENTRYPOINT_NAMES.filter(
    (name) => source.includes(`"${name}"`) || source.includes(`'${name}'`)
  );
  if (referencedLoaderNames.length === 0) {
    return undefined;
  }

  const definedReferencedLoaders = referencedLoaderNames.filter((name) =>
    pythonSourceDefinesName(source, name)
  );
  if (definedReferencedLoaders.length > 0) {
    return undefined;
  }

  const generatedLoaderNames = BENCHMARK_LOADER_ENTRYPOINT_NAMES.filter((name) =>
    pythonSourceDefinesName(source, name)
  );
  if (generatedLoaderNames.length === 0) {
    return undefined;
  }

  const visibleReferenced = referencedLoaderNames.join(", ");
  const visibleGenerated = generatedLoaderNames.slice(0, 6).join(", ");
  return [
    "Generated Python runner has a benchmark loader dispatch mismatch.",
    `Benchmark evaluation searches for undefined loader helper(s): ${visibleReferenced}.`,
    `Generated loader helper(s) exist under different name(s): ${visibleGenerated}.`,
    "Define one searched benchmark loader helper, or align the evaluator loader lookup with the generated loader before handoff."
  ].join(" ");
}

async function detectPythonInvokeHelperDispatchMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!/\bdef\s+_invoke_helper\s*\(/u.test(source) || !/\b_invoke_helper\s*\(/u.test(source)) {
    return undefined;
  }

  const missingGroups: string[][] = [];
  for (const match of source.matchAll(/\b_invoke_helper\s*\(\s*\(([\s\S]{0,1400}?)\)\s*,/gmu)) {
    const names = Array.from(match[1].matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']/gu), (nameMatch) => nameMatch[1]);
    const helperNames = names.filter((name) => !name.startsWith("_"));
    if (helperNames.length === 0) {
      continue;
    }
    const defined = helperNames.filter((name) => pythonSourceDefinesName(source, name));
    if (defined.length === 0) {
      missingGroups.push(helperNames);
    }
  }
  if (missingGroups.length === 0) {
    return undefined;
  }

  const visibleGroups = missingGroups
    .slice(0, 3)
    .map((group) => `[${group.slice(0, 6).join(", ")}]`)
    .join("; ");
  return [
    "Generated Python runner has an unresolved helper dispatch mismatch.",
    `_invoke_helper searches helper group(s) with no defined implementation: ${visibleGroups}.`,
    "Define at least one searched helper in each group, or align the helper lookup names with the generated implementation before handoff."
  ].join(" ");
}

async function detectPythonMetricsWriterAdapterMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const hasMetricsWriterAdapter =
    source.includes("def _entrypoint_write_metrics") ||
    source.includes("def _write_metrics_payload");
  const hasWriterInvoker =
    source.includes("_entrypoint_invoke(writer,") ||
    source.includes("_call_with_supported_kwargs(writer,") ||
    /\bwriter\s*\(\s*metrics\s*,\s*metrics_path\s*\)/u.test(source) ||
    /\bwriter\s*\(\s*metrics_path\s*,\s*metrics\s*\)/u.test(source);
  if (!hasMetricsWriterAdapter || !hasWriterInvoker) {
    return undefined;
  }

  const writerNames = ["write_metrics_json", "write_metrics", "persist_metrics_json", "save_metrics_json"];
  const writerName = writerNames.find((name) => pythonSourceDefinesName(source, name));
  if (!writerName) {
    return undefined;
  }

  const signature = extractPythonFunctionSignature(source, writerName);
  if (!signature) {
    return undefined;
  }

  const writerParams = extractPythonParameterNames(signature);
  if (writerParams.includes("kwargs")) {
    return undefined;
  }

  const firstParam = writerParams[0] || "unknown";
  const secondParam = writerParams[1] || "unknown";
  const directPositionalWriterAdapter =
    /\bwriter\s*\(\s*metrics\s*,\s*metrics_path\s*\)/u.test(source) ||
    /\bwriter\s*\(\s*metrics_path\s*,\s*metrics\s*\)/u.test(source);
  if (
    directPositionalWriterAdapter &&
    ["config", "runtime_config", "experiment_config"].includes(firstParam) &&
    ["metrics", "payload", "metrics_payload", "aggregated_metrics"].includes(secondParam)
  ) {
    return [
      "Generated Python runner has a metrics writer adapter mismatch.",
      `Entrypoint adapter calls ${writerName}() with metrics/path positional arguments, but ${writerName}() expects '${firstParam}' then '${secondParam}'.`,
      "Pass the generated RuntimeConfig object to the writer or call a path/payload writer whose signature matches the adapter before handoff."
    ].join(" ");
  }

  const requiredParams = writerParams.filter((name) => !name.startsWith("*"));
  const pathParamNames = ["metrics_path", "path", "output_path", "destination"];
  const adapterPathNames = pathParamNames.filter((name) =>
    new RegExp(`\\b${escapeRegex(name)}\\s*=\\s*metrics_path\\b`, "u").test(source)
  );
  const missingRequiredPathParam = requiredParams.find(
    (name) => pathParamNames.includes(name) && !adapterPathNames.includes(name)
  );
  if (missingRequiredPathParam) {
    return [
      "Generated Python runner has a metrics writer adapter mismatch.",
      `Entrypoint adapter does not pass required path argument '${missingRequiredPathParam}' to ${writerName}().`,
      "Pass the writer's actual metrics path parameter name before handoff, or align the writer signature with the adapter."
    ].join(" ");
  }

  const payloadParamNames = ["metrics", "payload", "metrics_payload"];
  if (payloadParamNames.some((name) => writerParams.includes(name))) {
    return undefined;
  }

  const adapterPassesPayloadKeywords = payloadParamNames.some((name) =>
    new RegExp(`\\b${escapeRegex(name)}\\s*=\\s*payload\\b`, "u").test(source)
  );
  if (!adapterPassesPayloadKeywords) {
    return undefined;
  }

  return [
    "Generated Python runner has a metrics writer adapter mismatch.",
    `Entrypoint adapter passes payload as metrics/payload/metrics_payload, but ${writerName}() requires '${firstParam}'.`,
    "Rename the writer payload parameter to one accepted by the adapter, accept **kwargs, or call the writer with its actual required payload parameter before handoff."
  ].join(" ");
}

async function detectPythonAtomicWriteJsonCallOrderMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const payloadFirstDefinition = source.match(
    /\ndef\s+atomic_write_json\s*\(\s*(payload|data|obj|metrics|metrics_payload)\b[\s\S]{0,300}?,\s*(path|metrics_path|output_path|destination)\b/u
  );
  if (!payloadFirstDefinition) {
    return undefined;
  }
  const firstParam = payloadFirstDefinition[1] || "payload";
  const secondParam = payloadFirstDefinition[2] || "path";

  const reversedPathCalls = Array.from(
    source.matchAll(/\batomic_write_json\s*\(\s*([^,\n]+(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*,/gmu),
    (match) => match[1].trim()
  ).filter((arg) =>
    /(?:^|\.)(?:metrics_path|results_path|output_path|destination|path)$/u.test(arg) ||
    /\bPath\s*\(/u.test(arg)
  );
  if (reversedPathCalls.length === 0) {
    return undefined;
  }

  const visibleCalls = Array.from(new Set(reversedPathCalls)).slice(0, 4).join(", ");
  return [
    "Generated Python runner has an atomic JSON writer call-order mismatch.",
    `atomic_write_json() is defined as ${firstParam}/${secondParam}, but path-like argument(s) are passed first: ${visibleCalls}.`,
    "Call atomic_write_json(payload, path), or redefine the helper with a path-first signature before handoff."
  ].join(" ");
}

async function detectPythonEvaluationSampleDictAccessMismatch(
  scriptPath?: string
): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!/\bclass\s+EvaluationSample\b/u.test(source) || !/\bEvaluationSample\s*\(/u.test(source)) {
    return undefined;
  }
  if (!/\bdef\s+_entrypoint_evaluate_model\s*\(/u.test(source)) {
    return undefined;
  }

  const evaluatorMatch = source.match(
    /\ndef\s+_entrypoint_evaluate_model\s*\([\s\S]*?\n(?=def\s+|class\s+|if\s+__name__\s*==|$)/u
  );
  const evaluatorSource = evaluatorMatch?.[0] || "";
  const objectBackedLoader =
    /\bdef\s+load_evaluation_samples\s*\([\s\S]*?Dict\s*\[[^\]]*List\s*\[\s*EvaluationSample\s*\]/u.test(
      source
    ) ||
    /\bdef\s+load_arc_challenge_eval_samples\s*\([\s\S]*?\)\s*->\s*List\s*\[\s*EvaluationSample\s*\]/u.test(
      source
    ) ||
    /\bdef\s+load_hellaswag_eval_samples\s*\([\s\S]*?\)\s*->\s*List\s*\[\s*EvaluationSample\s*\]/u.test(
      source
    );
  const evaluatorUsesDictAccess =
    /\bfor\s+sample\s+in\s+samples\s*:[\s\S]{0,1600}\bsample\.get\s*\(/u.test(evaluatorSource);
  if (!objectBackedLoader || !evaluatorUsesDictAccess) {
    return undefined;
  }

  return [
    "Generated Python runner has an evaluation sample access mismatch.",
    "Evaluation loaders materialize EvaluationSample objects, but _entrypoint_evaluate_model reads samples with dict-only sample.get(...).",
    "Normalize EvaluationSample objects to mappings before evaluation, or read object attributes such as choices, correct_index, and prompt before handoff."
  ].join(" ");
}

async function detectPythonDictRecipeAttributeAccess(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const dictBackedRecipeContainers = new Set<string>();
  for (const match of source.matchAll(
    /^\s*([A-Z][A-Z0-9_]*)\s*(?::\s*(?:List|list|Tuple|tuple)\s*\[[^\n=]*Dict[^\n=]*\])?\s*=\s*(?:\[\s*\{|\(\s*\{)/gmu
  )) {
    dictBackedRecipeContainers.add(match[1]);
  }
  if (dictBackedRecipeContainers.size === 0) {
    return undefined;
  }

  const mismatches: string[] = [];
  for (const container of dictBackedRecipeContainers) {
    const accessPattern = new RegExp(`\\brecipe\\.(?:name|recipe_id|display_name)\\b[^\\n]*\\b${escapeRegex(container)}\\b`, "u");
    const match = source.match(accessPattern);
    if (match?.index !== undefined) {
      const line = source.slice(0, match.index).split(/\r?\n/u).length;
      mismatches.push(`${container} at ${path.basename(scriptPath)}:${line}`);
    }
  }
  if (mismatches.length === 0) {
    return undefined;
  }

  return [
    "Generated Python runner treats dict-backed recipe config entries as objects.",
    `Attribute-style recipe access over dict container(s): ${mismatches.slice(0, 6).join(", ")}.`,
    "Use recipe['name'] / recipe.get('name') for dict configs, or keep the recipe container as dataclass/object instances before handoff."
  ].join(" ");
}

async function detectPythonRecipeSpecConstructorKeywordMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!source.includes("class RecipeSpec:") || !source.includes("RecipeSpec(")) {
    return undefined;
  }

  const classStart = source.indexOf("class RecipeSpec:\n");
  if (classStart < 0) {
    return undefined;
  }
  const bodyStart = classStart + "class RecipeSpec:\n".length;
  const bodyEnd = findPythonClassBodyEnd(source, bodyStart);
  const classBody = source.slice(bodyStart, bodyEnd);
  if (/\n\s+def\s+__init__\s*\(/u.test(`\n${classBody}`)) {
    return undefined;
  }

  const fieldNames = new Set<string>();
  for (const match of classBody.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gmu)) {
    fieldNames.add(match[1]);
  }
  if (fieldNames.size === 0) {
    return undefined;
  }

  const unexpectedKeywords = new Set<string>();
  for (const call of source.matchAll(/\bRecipeSpec\s*\(([\s\S]*?)\)/gu)) {
    const callBody = call[1] || "";
    for (const keyword of callBody.matchAll(/(?:^|[,\n(])\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gu)) {
      const name = keyword[1];
      if (!fieldNames.has(name)) {
        unexpectedKeywords.add(name);
      }
    }
  }

  if (unexpectedKeywords.size === 0) {
    return undefined;
  }

  const visibleUnexpected = Array.from(unexpectedKeywords).slice(0, 8).join(", ");
  const visibleFields = Array.from(fieldNames).slice(0, 10).join(", ");
  return [
    "Generated Python runner has a RecipeSpec constructor keyword mismatch.",
    `RecipeSpec(...) uses keyword field(s) not accepted by the generated dataclass: ${visibleUnexpected}.`,
    visibleFields ? `Accepted RecipeSpec field(s) include: ${visibleFields}.` : undefined,
    "Keep one consistent RecipeSpec schema, or translate recipe metadata through an explicit factory before handoff."
  ].filter(Boolean).join(" ");
}

function pythonSourceDefinesName(source: string, name: string): boolean {
  const escaped = escapeRegex(name);
  return (
    new RegExp(`\\ndef\\s+${escaped}\\s*\\(`, "u").test(`\n${source}`) ||
    new RegExp(`\\n${escaped}\\s*=`, "u").test(`\n${source}`)
  );
}

function pythonSourceDefinesOrImportsName(source: string, name: string): boolean {
  const escaped = escapeRegex(name);
  return (
    pythonSourceDefinesName(source, name) ||
    new RegExp(`\\n\\s*from\\s+[\\w.]+\\s+import\\s+[^\\n#]*\\b${escaped}\\b`, "u").test(`\n${source}`) ||
    new RegExp(`\\n\\s*import\\s+${escaped}\\b`, "u").test(`\n${source}`)
  );
}

function extractPythonFunctionSignature(source: string, name: string): string | undefined {
  const escaped = escapeRegex(name);
  const match = new RegExp(`\\ndef\\s+${escaped}\\s*\\(`, "u").exec(`\n${source}`);
  if (!match || match.index < 0) {
    return undefined;
  }
  const normalized = `\n${source}`;
  const openIndex = match.index + match[0].length - 1;
  let depth = 0;
  let signature = "";
  for (let index = openIndex; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "(") {
      depth += 1;
      if (depth === 1) {
        continue;
      }
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return signature;
      }
    }
    if (depth >= 1) {
      signature += char;
    }
  }
  return undefined;
}

function extractPythonParameterNames(signature: string): string[] {
  return signature
    .split(",")
    .map((rawParam) => rawParam.replace(/#.*/u, "").trim())
    .filter((param) => param.length > 0 && param !== "/" && param !== "*")
    .map((param) => param.split("=")[0]?.trim() || "")
    .map((param) => param.split(":")[0]?.trim() || "")
    .map((param) => param.replace(/^\*+/u, "").trim())
    .filter((param) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(param));
}

function extractPythonRequiredParameterNames(signature: string): string[] {
  return splitPythonSignatureParameters(signature)
    .map((rawParam) => rawParam.replace(/#.*/u, "").trim())
    .filter((param) => param.length > 0 && param !== "/" && param !== "*")
    .filter((param) => !param.startsWith("*"))
    .filter((param) => !pythonSignatureParamHasTopLevelDefault(param))
    .map((param) => param.split(":")[0]?.trim() || "")
    .filter((param) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(param));
}

function splitPythonSignatureParameters(signature: string): string[] {
  const params: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | "\"" | undefined;
  let escaped = false;

  for (const char of signature) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === "]" || char === ")" || char === "}") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      params.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) {
    params.push(current);
  }

  return params;
}

function pythonSignatureParamHasTopLevelDefault(param: string): boolean {
  let depth = 0;
  let quote: "'" | "\"" | undefined;
  let escaped = false;

  for (const char of param) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === "]" || char === ")" || char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === "=" && depth === 0) {
      return true;
    }
  }

  return false;
}

function isImplementStagedLlmTimeoutError(error: unknown): boolean {
  return error instanceof Error && /implement_experiments staged_llm request timed out after \d+ms/.test(error.message);
}

async function clearStagedLlmAttemptArtifacts(runDir: string): Promise<void> {
  const targets = [
    IMPLEMENT_PARTIAL_RESPONSE_ARTIFACT,
    IMPLEMENT_SCAFFOLD_ARTIFACT,
    IMPLEMENT_SCAFFOLD_PROMPT_ARTIFACT,
    IMPLEMENT_SCAFFOLD_RAW_RESPONSE_ARTIFACT,
    IMPLEMENT_DECOMPOSITION_PLAN_ARTIFACT,
    IMPLEMENT_DECOMPOSITION_PLAN_RAW_RESPONSE_ARTIFACT,
    IMPLEMENT_BOOTSTRAP_CONTRACT_ARTIFACT,
    IMPLEMENT_BOOTSTRAP_CONTRACT_PROMPT_ARTIFACT,
    IMPLEMENT_BOOTSTRAP_CONTRACT_RAW_RESPONSE_ARTIFACT,
    IMPLEMENT_FILE_PLAN_ARTIFACT,
    IMPLEMENT_UNIT_PLAN_DIR,
    IMPLEMENT_UNIT_SECTION_DIR,
    IMPLEMENT_UNIT_SKELETON_DIR,
    IMPLEMENT_UNIT_CHUNK_PROMPT_DIR,
    IMPLEMENT_UNIT_CHUNK_RESPONSE_DIR
  ];
  await Promise.all(
    targets.map(async (target) => {
      try {
        await fs.rm(path.join(runDir, target), { force: true, recursive: true });
      } catch {
        // Best effort cleanup only; stale diagnostics should not block a new staged attempt.
      }
    })
  );
}

function isRetryableImplementStagedLlmMaterializationError(error: unknown): boolean {
  return (
    isImplementStagedLlmTimeoutError(error) ||
    isProviderTerminatedStagedLlmError(error) ||
    isMalformedJsonStagedLlmChunkError(error) ||
    isCandidateValidationStagedLlmError(error)
  );
}

export function isMalformedJsonStagedLlmChunkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (
      error.message === "staged_llm chunk response did not contain a valid JSON object" ||
      /staged_llm chunk response returned chunk_id=.+ but expected/u.test(error.message) ||
      /staged_llm chunk response for .+ contained no content/u.test(error.message)
    )
  );
}

function isCandidateValidationStagedLlmError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /staged_llm chunk response for .+ failed candidate validation:/u.test(error.message)
  );
}

function extractUndefinedUppercaseConstantNames(validationError?: string): string[] {
  if (!validationError || !validationError.includes("uppercase constant")) {
    return [];
  }

  const names: string[] = [];
  for (const match of validationError.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b(?=\s+at\s+)/gu)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

function isProviderTerminatedStagedLlmError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.trim().toLowerCase();
  return message === "terminated" || message === "codex oauth backend returned an error: terminated";
}

export function isTransientStagedLlmProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    /\b(?:502|503|504|520|521|522|523|524)\b/u.test(message) ||
    message.includes("our servers are currently overloaded") ||
    message.includes("please try again later") ||
    message.includes("you can retry your request") ||
    message.includes("an error occurred while processing your request") ||
    message.includes("upstream connect error") ||
    message.includes("disconnect/reset before headers") ||
    message.includes("connection termination") ||
    message.includes("failed before receiving an http response") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  );
}

async function delay(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeDynamicDecompositionPlan(
  plan: DynamicDecompositionPlan | undefined,
  workspaceRoot: string
): DynamicDecompositionPlan | undefined {
  if (!plan) {
    return undefined;
  }
  const normalizedUnits = plan.units
    .map((unit) => {
      const normalizedTargetPath = normalizeStoredPath(unit.target_path, workspaceRoot);
      if (unit.generation_mode === "materialize_text_file" && (!normalizedTargetPath || !isMaterializableImplementTextPath(normalizedTargetPath))) {
        return undefined;
      }
      const normalizedUnit: DynamicDecompositionUnit = {
        ...unit,
        target_path: normalizedTargetPath || unit.target_path
      };
      return normalizedUnit;
    })
    .filter((unit): unit is DynamicDecompositionUnit => unit !== undefined);
  if (normalizedUnits.length === 0) {
    return undefined;
  }
  return {
    ...plan,
    units: normalizedUnits
  };
}

function parseDynamicMaterializationPlan(value: unknown): DynamicMaterializationPlan | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const chunks = Array.isArray(record.chunks)
    ? record.chunks
        .map((item) => parseDynamicMaterializationChunk(item))
        .filter((item): item is DynamicMaterializationChunk => Boolean(item))
    : [];
  if (chunks.length === 0) {
    return undefined;
  }
  return {
    strategy:
      typeof record.strategy === "string" && record.strategy.trim().length > 0
        ? record.strategy.trim()
        : "provider_generated_dynamic_plan",
    rationale:
      typeof record.rationale === "string" && record.rationale.trim().length > 0
        ? record.rationale.trim()
        : "The provider returned a dynamic plan without explicit rationale metadata.",
    chunks
  };
}

function parseDynamicMaterializationChunk(value: unknown): DynamicMaterializationChunk | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : undefined;
  const title = typeof record.title === "string" && record.title.trim().length > 0 ? record.title.trim() : undefined;
  const purpose =
    typeof record.purpose === "string" && record.purpose.trim().length > 0 ? record.purpose.trim() : undefined;
  const contentKind = normalizeMaterializationChunkKind(record.content_kind);
  if (!id || !title || !purpose || !contentKind) {
    return undefined;
  }
  return {
    id,
    title,
    purpose,
    content_kind: contentKind,
    include_imports: record.include_imports === true,
    include_entrypoint: record.include_entrypoint === true,
    depends_on: Array.isArray(record.depends_on)
      ? record.depends_on.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined,
    verification_focus: Array.isArray(record.verification_focus)
      ? record.verification_focus.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined
  };
}

function normalizeMaterializationChunkKind(
  value: unknown
): DynamicMaterializationChunk["content_kind"] | undefined {
  return value === "code_section" ||
    value === "config_block" ||
    value === "documentation_section" ||
    value === "text_section"
    ? value
    : undefined;
}

function parseImplementBootstrapContract(value: unknown): ImplementBootstrapContract | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const requirements = Array.isArray(record.requirements)
    ? record.requirements
        .map((item) => parseImplementBootstrapRequirement(item))
        .filter((item): item is ImplementBootstrapRequirement => Boolean(item))
    : [];
  const checks = Array.isArray(record.checks)
    ? record.checks
        .map((item) => parseImplementBootstrapCheck(item))
        .filter((item): item is ImplementBootstrapCheck => Boolean(item))
    : [];
  if (requirements.length === 0 && checks.length === 0 && typeof record.summary !== "string") {
    return undefined;
  }
  return {
    version: asNumber(record.version) || 1,
    strategy: asOptionalString(record.strategy),
    summary: asOptionalString(record.summary),
    requires_network: record.requires_network === true,
    requires_warm_cache: record.requires_warm_cache === true,
    blocking_reason: asOptionalString(record.blocking_reason),
    remediation: asOptionalStringArray(record.remediation),
    requirements,
    checks
  };
}

function shouldRequireExplicitBootstrapPlanning(
  taskSpec: ImplementTaskSpec,
  scaffold: StructuredImplementResponse
): boolean {
  const signals = [
    taskSpec.goal,
    taskSpec.context.topic,
    taskSpec.context.plan_excerpt,
    taskSpec.context.hypotheses_excerpt,
    taskSpec.context.previous_summary || "",
    taskSpec.context.runner_feedback?.summary || "",
    scaffold.summary || "",
    scaffold.run_command || ""
  ]
    .join("\n")
    .toLowerCase();
  return (
    taskSpec.context.comparison_contract?.comparison_mode === "baseline_first_locked" ||
    /(peft|huggingface|transformer|tokenizer|language model|autotokenizer|automodelforcausallm)/u.test(
      signals
    )
  );
}

function buildDefaultImplementBootstrapContract(taskSpec: ImplementTaskSpec): ImplementBootstrapContract {
  return {
    version: 1,
    strategy: "deterministic_default",
    summary: "No explicit bootstrap risks were identified before code generation.",
    requires_network: false,
    requires_warm_cache: false,
    requirements: [],
    checks: []
  };
}

function parseImplementBootstrapRequirement(value: unknown): ImplementBootstrapRequirement | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = asOptionalString(record.id);
  const kind = normalizeBootstrapRequirementKind(record.kind);
  const source = normalizeBootstrapRequirementSource(record.source);
  const requiredFor = asOptionalStringArray(record.required_for);
  if (!id || !kind || !source || !requiredFor || requiredFor.length === 0) {
    return undefined;
  }
  return {
    id,
    kind,
    source,
    required_for: requiredFor,
    local_path: asOptionalString(record.local_path),
    availability: normalizeBootstrapAvailability(record.availability),
    summary: asOptionalString(record.summary),
    remediation: asOptionalString(record.remediation)
  };
}

function parseImplementBootstrapCheck(value: unknown): ImplementBootstrapCheck | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = asOptionalString(record.id);
  const checkType = normalizeBootstrapCheckType(record.check_type);
  const target = asOptionalString(record.target);
  const reason = asOptionalString(record.reason);
  if (!id || !checkType || !target || !reason) {
    return undefined;
  }
  return {
    id,
    check_type: checkType,
    target,
    reason
  };
}

function normalizeBootstrapRequirementKind(value: unknown): ImplementBootstrapRequirement["kind"] | undefined {
  const normalized = asOptionalString(value);
  return normalized === "model" ||
    normalized === "tokenizer" ||
    normalized === "dataset" ||
    normalized === "binary" ||
    normalized === "library" ||
    normalized === "reference_data" ||
    normalized === "service"
    ? normalized
    : undefined;
}

function normalizeBootstrapRequirementSource(value: unknown): ImplementBootstrapRequirement["source"] | undefined {
  const normalized = asOptionalString(value);
  return normalized === "huggingface" ||
    normalized === "local" ||
    normalized === "python" ||
    normalized === "system" ||
    normalized === "other"
    ? normalized
    : undefined;
}

function normalizeBootstrapAvailability(
  value: unknown
): ImplementBootstrapRequirement["availability"] | undefined {
  const normalized = asOptionalString(value);
  return normalized === "assumed_local" ||
    normalized === "download_required" ||
    normalized === "unknown"
    ? normalized
    : undefined;
}

function normalizeBootstrapCheckType(value: unknown): ImplementBootstrapCheck["check_type"] | undefined {
  const normalized = asOptionalString(value);
  return normalized === "path_exists" ||
    normalized === "command_available" ||
    normalized === "python_module_available"
    ? normalized
    : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

async function evaluateImplementBootstrapContract(params: {
  contract: ImplementBootstrapContract;
  workspaceRoot: string;
}): Promise<{ status: "pass" | "warn" | "block"; summary: string; missing: string[] }> {
  const missing: string[] = [];
  for (const requirement of params.contract.requirements) {
    const localPath = normalizeStoredPath(requirement.local_path, params.workspaceRoot);
    if (localPath && !(await fileExists(localPath))) {
      if (requirement.source === "huggingface") {
        continue;
      }
      missing.push(`${requirement.id}: expected local path is missing (${formatArtifactPath(localPath, params.workspaceRoot)})`);
    }
  }

  for (const check of params.contract.checks) {
    if (check.check_type === "path_exists") {
      const targetPath = normalizeStoredPath(check.target, params.workspaceRoot);
      if (!targetPath || !(await fileExists(targetPath))) {
        missing.push(`${check.id}: required path is missing (${check.target})`);
      }
    }
  }

  const blockingReason = normalizeActionableBootstrapBlockingReason(params.contract.blocking_reason);
  if (blockingReason || missing.length > 0) {
    return {
      status: "block",
      summary:
        blockingReason ||
        `Bootstrap contract failed under the current execution policy: ${missing.join("; ")}`,
      missing
    };
  }
  if (params.contract.requires_network) {
    return {
      status: "warn",
      summary:
        params.contract.summary ||
        "Bootstrap contract indicates remote assets and will proceed as a network-assisted run if fetched on demand.",
      missing
    };
  }
  return {
    status: "pass",
    summary: params.contract.summary || "Bootstrap contract is compatible with the current execution policy.",
    missing
  };
}

function normalizeActionableBootstrapBlockingReason(reason: string | undefined): string | undefined {
  if (!reason) {
    return undefined;
  }
  const normalized = reason.trim();
  const lower = normalized.toLowerCase();
  const uncertaintySignals = [
    "none known except",
    "if ",
    "if torch",
    "if the",
    "unless",
    "may fail",
    "might fail",
    "could fail",
    "availability is unknown",
    "unknown"
  ];
  const concreteBlockSignals = [
    "is missing",
    "not found",
    "does not exist",
    "unavailable",
    "cannot execute",
    "permission denied",
    "requires manual",
    "blocked by policy"
  ];
  const describesUncertainty = uncertaintySignals.some((signal) => lower.includes(signal));
  const describesConcreteBlock = concreteBlockSignals.some((signal) => lower.includes(signal));
  if (describesUncertainty && !describesConcreteBlock) {
    return undefined;
  }
  return normalized;
}

function shouldUseSectionedSkeletonForTarget(filePath: string): boolean {
  return isPythonMaterializationPath(filePath);
}

function isPythonMaterializationPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".py";
}

function buildCanonicalSectionedSkeleton(params: {
  filePath: string;
  unit: DynamicDecompositionUnit;
  materializationPlan: DynamicMaterializationPlan;
  sections: PlannedMaterializationSection[];
}): string {
  const commentPrefix = isPythonMaterializationPath(params.filePath) ? "# " : "";
  const header = [
    `${commentPrefix}AUTOLABOS CANONICAL SKELETON`,
    `${commentPrefix}Target: ${params.filePath}`,
    `${commentPrefix}Unit: ${params.unit.title}`,
    `${commentPrefix}Strategy: ${params.materializationPlan.strategy || "dynamic_materialization"}`,
    ""
  ];
  const sectionBlocks = params.sections.flatMap((entry, index) => [
    `${commentPrefix}BEGIN AUTOLABOS SECTION ${entry.section.id} :: ${entry.section.title}`,
    `${commentPrefix}Purpose: ${entry.section.purpose}`,
    `${commentPrefix}Order: ${index + 1}/${params.sections.length}`,
    `${commentPrefix}END AUTOLABOS SECTION ${entry.section.id}`,
    ""
  ]);
  return [...header, ...sectionBlocks].join("\n").trimEnd() + "\n";
}

function applySectionContentToCanonicalSkeleton(
  skeleton: string,
  sectionId: string,
  sectionContent: string,
  filePath: string
): string {
  const commentPrefix = isPythonMaterializationPath(filePath) ? "# " : "";
  const startMarkerPattern = new RegExp(
    `${escapeRegex(`${commentPrefix}BEGIN AUTOLABOS SECTION ${sectionId}`)}[^\\n]*\\n${escapeRegex(commentPrefix)}Purpose:[^\\n]*\\n${escapeRegex(commentPrefix)}Order:[^\\n]*\\n`,
    "u"
  );
  const endMarker = `${commentPrefix}END AUTOLABOS SECTION ${sectionId}`;
  const startMatch = skeleton.match(startMarkerPattern);
  if (!startMatch || startMatch.index == null) {
    throw new Error(`canonical skeleton is missing section marker for ${sectionId}`);
  }
  const contentStart = startMatch.index + startMatch[0].length;
  const endIndex = skeleton.indexOf(endMarker, contentStart);
  if (endIndex < 0) {
    throw new Error(`canonical skeleton is missing end marker for ${sectionId}`);
  }
  return `${skeleton.slice(0, contentStart)}${sectionContent.trimEnd()}\n${skeleton.slice(endIndex)}`;
}

function stripCanonicalSkeletonMarkers(content: string, filePath: string): string {
  const commentPrefix = isPythonMaterializationPath(filePath) ? "# " : "";
  const stripped = content
    .split("\n")
    .filter((line) => {
      return !line.startsWith(`${commentPrefix}AUTOLABOS CANONICAL SKELETON`) &&
        !line.startsWith(`${commentPrefix}Target:`) &&
        !line.startsWith(`${commentPrefix}Unit:`) &&
        !line.startsWith(`${commentPrefix}Strategy:`) &&
        !line.startsWith(`${commentPrefix}BEGIN AUTOLABOS SECTION`) &&
        !line.startsWith(`${commentPrefix}Purpose:`) &&
        !line.startsWith(`${commentPrefix}Order:`) &&
        !line.startsWith(`${commentPrefix}END AUTOLABOS SECTION`);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped.length > 0 ? `${stripped}\n` : "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMaterializableTextUnit(unit: DynamicDecompositionUnit): boolean {
  return unit.generation_mode === "materialize_text_file" && typeof unit.target_path === "string" && unit.target_path.length > 0;
}

function compactDraftForChunkPrompt(draft: string): { has_content: boolean; excerpt?: string } {
  const trimmed = draft.trim();
  if (!trimmed) {
    return { has_content: false };
  }
  return {
    has_content: true,
    excerpt: trimBlock(trimmed, 4000)
  };
}

function appendDraftSection(draft: string, section: string): string {
  return draft.trim().length > 0 ? `${draft.trimEnd()}\n\n${section.trimStart()}` : section;
}

function sanitizeArtifactId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseStructuredFileEditResponse(
  text: string,
  workspaceRoot: string,
  expectedPath: string
): StructuredImplementFileEdit {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`staged_llm file generation for ${expectedPath} did not return a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  const normalizedPath = normalizeStoredPath(asString(record.path) || expectedPath, workspaceRoot);
  const content = asString(record.content);
  if (!normalizedPath || content === undefined) {
    throw new Error(`staged_llm file generation for ${expectedPath} omitted path/content`);
  }
  return {
    path: normalizedPath,
    content
  };
}

async function materializeStructuredFileEdits(fileEdits: StructuredImplementFileEdit[]): Promise<void> {
  for (const item of fileEdits) {
    await ensureDir(path.dirname(item.path));
    await fs.writeFile(item.path, item.content, "utf8");
  }
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

function compactTaskSpecForStagedLlmPrompt(taskSpec: ImplementTaskSpec): Record<string, unknown> {
  return {
    goal: trimBlock(taskSpec.goal, 160),
    acceptance_criteria: taskSpec.acceptance_criteria.slice(0, 2).map((item) => trimBlock(item, 120)),
    non_goals: taskSpec.non_goals.slice(0, 2).map((item) => trimBlock(item, 100)),
    constraints: taskSpec.constraints.slice(0, 3).map((item) => trimBlock(item, 120)),
    workspace: {
      public_dir: taskSpec.workspace.public_dir,
      metrics_path: taskSpec.workspace.metrics_path
    },
    execution: taskSpec.execution,
    context: {
      topic: trimBlock(taskSpec.context.topic, 160),
      objective_metric: trimBlock(taskSpec.context.objective_metric, 140),
      plan_excerpt: trimBlock(taskSpec.context.plan_excerpt, 600),
      hypotheses_excerpt: trimBlock(taskSpec.context.hypotheses_excerpt, 200),
      previous_summary: trimBlock(taskSpec.context.previous_summary || "", 120) || undefined,
      previous_run_command: trimBlock(taskSpec.context.previous_run_command || "", 120) || undefined,
      previous_script: taskSpec.context.previous_script,
      comparison_contract: taskSpec.context.comparison_contract
        ? {
            plan_id: taskSpec.context.comparison_contract.plan_id,
            comparison_mode: taskSpec.context.comparison_contract.comparison_mode,
            baseline_first_required: taskSpec.context.comparison_contract.baseline_first_required,
            baseline_candidate_ids: taskSpec.context.comparison_contract.baseline_candidate_ids.slice(0, 2),
            budget_profile: taskSpec.context.comparison_contract.budget_profile,
            evaluator_contract_id: taskSpec.context.comparison_contract.evaluator_contract_id
          }
        : undefined,
      plan_changed: taskSpec.context.plan_changed,
      plan_hash: taskSpec.context.plan_hash
    }
  };
}

function compactTaskSpecForBootstrapPrompt(taskSpec: ImplementTaskSpec): Record<string, unknown> {
  return {
    goal: trimBlock(taskSpec.goal, 120),
    workspace: {
      public_dir: taskSpec.workspace.public_dir,
      metrics_path: taskSpec.workspace.metrics_path
    },
    execution: {
      runner: taskSpec.execution.runner,
      timeout_sec: taskSpec.execution.timeout_sec
    },
    context: {
      topic: trimBlock(taskSpec.context.topic, 120),
      objective_metric: trimBlock(taskSpec.context.objective_metric, 100),
      previous_script: taskSpec.context.previous_script,
      comparison_contract: taskSpec.context.comparison_contract
        ? {
            comparison_mode: taskSpec.context.comparison_contract.comparison_mode,
            baseline_first_required: taskSpec.context.comparison_contract.baseline_first_required,
            budget_profile: taskSpec.context.comparison_contract.budget_profile
          }
        : undefined
    }
  };
}

function compactTaskSpecForChunkPrompt(taskSpec: ImplementTaskSpec): Record<string, unknown> {
  return {
    goal: trimBlock(taskSpec.goal, 220),
    acceptance_criteria: taskSpec.acceptance_criteria.slice(0, 3).map((item) => trimBlock(item, 140)),
    constraints: taskSpec.constraints.slice(0, 4).map((item) => trimBlock(item, 160)),
    workspace: {
      public_dir: taskSpec.workspace.public_dir,
      metrics_path: taskSpec.workspace.metrics_path
    },
    execution: {
      runner: taskSpec.execution.runner
    },
    context: {
      topic: trimBlock(taskSpec.context.topic, 240),
      objective_metric: trimBlock(taskSpec.context.objective_metric, 180),
      previous_script: taskSpec.context.previous_script,
      previous_run_command: trimBlock(taskSpec.context.previous_run_command || "", 160) || undefined,
      comparison_contract: taskSpec.context.comparison_contract
        ? {
            plan_id: taskSpec.context.comparison_contract.plan_id,
            comparison_mode: taskSpec.context.comparison_contract.comparison_mode,
            baseline_first_required: taskSpec.context.comparison_contract.baseline_first_required,
            budget_profile: taskSpec.context.comparison_contract.budget_profile
          }
        : undefined
    }
  };
}

function compactLocalizationForStagedLlmPrompt(localization: LocalizationResult): Record<string, unknown> {
  return {
    summary: trimBlock(localization.summary || "", 120) || undefined,
    strategy: localization.strategy,
    reasoning: trimBlock(localization.reasoning || "", 120) || undefined,
    selected_files: localization.selected_files.slice(0, 3),
    candidate_files: localization.candidates.slice(0, 2).map((candidate) => ({
      path: candidate.path,
      symbol: candidate.symbol,
      confidence: candidate.confidence
    })),
    search_queries: localization.search_queries?.slice(0, 2),
    confidence: localization.confidence
  };
}

function compactBranchPlanForStagedLlmPrompt(branchPlan: BranchPlan): Record<string, unknown> {
  return {
    branch_id: branchPlan.branch_id,
    source: branchPlan.source,
    summary: trimBlock(branchPlan.summary, 120),
    rationale: trimBlock(branchPlan.rationale, 120),
    focus_files: branchPlan.focus_files.slice(0, 2),
    candidate_pool: branchPlan.candidate_pool.slice(0, 2)
  };
}

function compactDecompositionUnitForChunkPrompt(unit: DynamicDecompositionUnit): Record<string, unknown> {
  return {
    id: unit.id,
    unit_type: unit.unit_type,
    title: unit.title,
    purpose: trimBlock(unit.purpose, 260),
    generation_mode: unit.generation_mode,
    target_path: unit.target_path,
    depends_on: unit.depends_on?.slice(0, 4),
    verification_focus: unit.verification_focus?.slice(0, 5)
  };
}

function compactMaterializationPlanForChunkPrompt(plan: DynamicMaterializationPlan): Record<string, unknown> {
  return {
    strategy: plan.strategy,
    rationale: trimBlock(plan.rationale || "", 240) || undefined,
    chunks: plan.chunks.map((chunk) => compactMaterializationChunkForChunkPrompt(chunk))
  };
}

function compactMaterializationChunkForChunkPrompt(chunk: DynamicMaterializationChunk): Record<string, unknown> {
  return {
    id: chunk.id,
    title: chunk.title,
    purpose: trimBlock(chunk.purpose, 220),
    content_kind: chunk.content_kind,
    include_imports: chunk.include_imports === true ? true : undefined,
    include_entrypoint: chunk.include_entrypoint === true ? true : undefined,
    depends_on: chunk.depends_on?.slice(0, 4),
    verification_focus: chunk.verification_focus?.slice(0, 4)
  };
}

function buildMaterializationChunkArtifactId(input: {
  unit: DynamicDecompositionUnit;
  chunk: DynamicMaterializationChunk;
  chunkLabel: string;
  subdivisionDepth: number;
}): string {
  return [
    sanitizeArtifactId(input.unit.id),
    sanitizeArtifactId(input.chunk.id),
    `d${input.subdivisionDepth}`,
    sanitizeArtifactId(input.chunkLabel)
  ].join("__");
}

function buildCompactImplementDecompositionRepairContext(params: {
  taskSpec: ImplementTaskSpec;
  searchLocalization: LocalizationResult;
  branchPlan: BranchPlan;
  scaffold: StructuredImplementResponse;
}): Record<string, unknown> {
  const compactTaskSpec = compactTaskSpecForStagedLlmPrompt(params.taskSpec) as {
    goal?: string;
    context?: {
      topic?: string;
      objective_metric?: string;
    };
  };
  return {
    goal: compactTaskSpec.goal,
    topic: compactTaskSpec.context?.topic,
    objective_metric: compactTaskSpec.context?.objective_metric,
    public_dir: params.taskSpec.workspace.public_dir,
    metrics_path: params.taskSpec.workspace.metrics_path,
    branch: {
      summary: trimBlock(params.branchPlan.summary, 220),
      rationale: trimBlock(params.branchPlan.rationale, 220),
      focus_files: params.branchPlan.focus_files.slice(0, 3)
    },
    localization: {
      selected_files: params.searchLocalization.selected_files.slice(0, 4),
      candidate_files: params.searchLocalization.candidates.slice(0, 4).map((candidate) => ({
        path: candidate.path,
        reason: trimBlock(candidate.reason || "", 140) || undefined,
        confidence: candidate.confidence
      }))
    },
    scaffold: {
      summary: trimBlock(params.scaffold.summary || "", 260) || undefined,
      experiment_mode: params.scaffold.experiment_mode,
      run_command: trimBlock(params.scaffold.run_command || "", 260) || undefined,
      test_command: trimBlock(params.scaffold.test_command || "", 220) || undefined,
      public_dir: params.scaffold.public_dir,
      script_path: params.scaffold.script_path,
      metrics_path: params.scaffold.metrics_path,
      changed_files: (params.scaffold.changed_files || []).slice(0, 6),
      public_artifacts: (params.scaffold.public_artifacts || []).slice(0, 6),
      file_plan: (params.scaffold.file_plan || []).slice(0, 6),
      assumptions: (params.scaffold.assumptions || []).slice(0, 4).map((item) => trimBlock(item, 160))
    }
  };
}

function compactLongTermMemoryForStagedLlmPrompt(snapshot: LongTermMemorySnapshot): LongTermMemorySnapshot {
  return {
    search_queries: snapshot.search_queries.slice(0, 2).map((item) => trimBlock(item, 80)),
    retrieved: snapshot.retrieved.slice(0, 1).map((entry) => ({
      ...entry,
      text: trimBlock(entry.text, 120),
      tags: entry.tags.slice(0, 2)
    })),
    saved: snapshot.saved
      ? {
          ...snapshot.saved,
          text: trimBlock(snapshot.saved.text, 120),
          tags: snapshot.saved.tags.slice(0, 2)
        }
      : undefined
  };
}

function compactRunnerFeedbackForStagedLlmPrompt(
  feedback: RunVerifierReport | undefined
): Record<string, unknown> | undefined {
  if (!feedback) {
    return undefined;
  }
  return {
    source: feedback.source,
    status: feedback.status,
    trigger: feedback.trigger,
    stage: feedback.stage,
    summary: trimBlock(feedback.summary || "", 320) || undefined,
    command: trimBlock(feedback.command || "", 220) || undefined,
    metrics_path: feedback.metrics_path,
    suggested_next_action: trimBlock(feedback.suggested_next_action || "", 220) || undefined,
    recorded_at: feedback.recorded_at
  };
}

function compactScaffoldSummaryForBootstrapPrompt(scaffold: StructuredImplementResponse): Record<string, unknown> {
  return {
    summary: trimBlock(scaffold.summary || "", 120) || undefined,
    experiment_mode: scaffold.experiment_mode,
    run_command: trimBlock(scaffold.run_command || "", 160) || undefined,
    test_command: trimBlock(scaffold.test_command || "", 120) || undefined,
    script_path: scaffold.script_path,
    metrics_path: scaffold.metrics_path
  };
}

function compactPaperCritiqueForStagedLlmPrompt(
  critique:
    | {
        overall_decision?: string;
        manuscript_type?: string;
        needs_additional_experiments?: boolean;
        blocking_issue_summaries: string[];
        recommended_fixes: string[];
        summary?: string;
      }
    | undefined
): Record<string, unknown> | undefined {
  if (!critique) {
    return undefined;
  }
  return {
    overall_decision: critique.overall_decision,
    manuscript_type: critique.manuscript_type,
    needs_additional_experiments: critique.needs_additional_experiments,
    blocking_issue_summaries: critique.blocking_issue_summaries.slice(0, 4).map((item) => trimBlock(item, 180)),
    recommended_fixes: critique.recommended_fixes.slice(0, 4).map((item) => trimBlock(item, 180)),
    summary: trimBlock(critique.summary || "", 280) || undefined
  };
}

function compactReflectionsForStagedLlmPrompt(reflections: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return reflections.slice(0, 2).map((item) => ({
    ...item,
    lesson: trimBlock(String(item.lesson || ""), 220),
    next_try_instruction: trimBlock(String(item.next_try_instruction || ""), 220)
  }));
}

function compactStringListForStagedLlmPrompt(values: string[], limit: number): string[] {
  return values.slice(0, limit);
}

function compactPreviousAttemptForStagedLlmPrompt(
  attempt:
    | {
        verify_report: VerifyReport;
        localization: LocalizationResult;
        summary: string;
      }
    | undefined
):
  | {
      verify_report: Record<string, unknown>;
      localization: Record<string, unknown>;
      summary: string;
    }
  | undefined {
  if (!attempt) {
    return undefined;
  }
  return {
    verify_report: {
      status: attempt.verify_report.status,
      failure_type: attempt.verify_report.failure_type,
      next_action: attempt.verify_report.next_action,
      summary: trimBlock(attempt.verify_report.summary || "", 320),
      command: trimBlock(attempt.verify_report.command || "", 220) || undefined,
      stdout_excerpt: trimBlock(attempt.verify_report.stdout_excerpt || "", 240) || undefined,
      stderr_excerpt: trimBlock(attempt.verify_report.stderr_excerpt || "", 240) || undefined
    },
    localization: compactLocalizationForStagedLlmPrompt(attempt.localization),
    summary: trimBlock(attempt.summary, 280)
  };
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
  materializedAfterMs?: number;
  requireFreshPlanAlignment?: boolean;
  runnerFeedback?: RunVerifierReport;
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
  if (typeof params.materializedAfterMs === "number" && Number.isFinite(params.materializedAfterMs)) {
    const scriptStats = await fs.stat(scriptPath).catch(() => undefined);
    if (!scriptStats || scriptStats.mtimeMs + 1000 < params.materializedAfterMs) {
      return undefined;
    }
  }
  const scriptContent = await fs.readFile(scriptPath, "utf8").catch(() => "");
  if (!hasSubstantiveMaterializedContent(scriptContent, scriptPath)) {
    return undefined;
  }
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

  const inferredRunCommand = normalizeRecoveredBundleRunCommand(
    inferRecoveredBundleRunCommand({
      scriptPath,
      frozenConfigPath,
      publicDir: params.publicDir,
      runDir: params.runDir,
      metricsPath: params.metricsPath
    }),
    params.workspaceRoot
  );
  const readmeRunCommand = normalizeRecoveredBundleRunCommand(
    await readRunnableCommandFromReadme(readmePath),
    params.workspaceRoot
  );
  let runCommand = readmeRunCommand || inferredRunCommand;
  if (!runCommand) {
    return undefined;
  }
  if (commandRequestsDryRun(runCommand)) {
    if (!isDryRunMetricsRepairFeedback(params.runnerFeedback)) {
      return undefined;
    }
    const promotedReadmeCommand = stripDryRunFlag(runCommand);
    if (promotedReadmeCommand) {
      runCommand = promotedReadmeCommand;
    } else if (inferredRunCommand && !commandRequestsDryRun(inferredRunCommand)) {
      runCommand = inferredRunCommand;
    } else {
      return undefined;
    }
  }
  if (
    !isDryRunMetricsRepairFeedback(params.runnerFeedback) &&
    !(await recoveredBundleSatisfiesRetryScope({ frozenConfigPath, runCommand }))
  ) {
    return undefined;
  }
  if (await detectPythonBaselineFirstTunedBaselineMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonMissingRegisteredRecipeWorkflow(scriptPath)) {
    return undefined;
  }
  if (await detectPythonEmptyPeftRecipeRegistry(scriptPath)) {
    return undefined;
  }
  if (await detectPythonUnguardedOptionalHelperCall(scriptPath)) {
    return undefined;
  }
  if (await detectPythonMissingBenchmarkEvaluatorDispatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonBenchmarkLoaderDispatchMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonInvokeHelperDispatchMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonMetricsWriterAdapterMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonAtomicWriteJsonCallOrderMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonEvaluationSampleDictAccessMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonDictRecipeAttributeAccess(scriptPath)) {
    return undefined;
  }
  if (await detectPythonRecipeSpecConstructorKeywordMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonUndefinedSlugifyReference(scriptPath)) {
    return undefined;
  }
  if (await detectPythonUndefinedRuntimeHelperReferences(scriptPath)) {
    return undefined;
  }
  if (await detectPythonGlobalsHelperCallArityMismatch(scriptPath)) {
    return undefined;
  }
  if (await detectPythonNonExecutableRunnerSurface(scriptPath)) {
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
  const matches = [...content.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/gu)];
  if (matches.length === 0) {
    return undefined;
  }
  const commands = matches
    .map((match) => collapseRunnableCommandBlock(match[1]))
    .filter((value): value is string => Boolean(value));
  if (commands.length === 0) {
    return undefined;
  }
  return (
    commands.find((command) => command.includes("--metrics-path") && !commandRequestsDryRun(command)) ||
    commands.find((command) => !commandRequestsDryRun(command)) ||
    commands[0]
  );
}

function collapseRunnableCommandBlock(block: string | undefined): string | undefined {
  if (!block) {
    return undefined;
  }
  const collapsed = block
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

function commandRequestsDryRun(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  return /(^|\s)--dry-run(?=\s|$)/u.test(command);
}

function stripDryRunFlag(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }
  const stripped = command.replace(/(^|\s)--dry-run(?=\s|$)/gu, '$1').replace(/\s+/gu, ' ').trim();
  return stripped || undefined;
}

const DEFAULT_IMPLEMENT_LLM_TIMEOUT_MS = 1_800_000;

export function getImplementLlmTimeoutMs(config: AppConfig): number {
  const raw = process.env.AUTOLABOS_IMPLEMENT_LLM_TIMEOUT_MS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  void config;
  return DEFAULT_IMPLEMENT_LLM_TIMEOUT_MS;
}

function isDryRunMetricsRepairFeedback(report: RunVerifierReport | undefined): boolean {
  if (!report) {
    return false;
  }
  if (!commandRequestsDryRun(report.command)) {
    return false;
  }
  const summary = `${report.summary || ""} ${report.suggested_next_action || ""}`.toLowerCase();
  return report.stage === "metrics" || /without metrics output|writes? json metrics|emit governed metrics|metrics.json/u.test(summary);
}

function isRecoverableBundleCommandRepairFeedback(report: RunVerifierReport | undefined): boolean {
  if (isDryRunMetricsRepairFeedback(report)) {
    return true;
  }
  if (!report) {
    return false;
  }
  const summary = `${report.summary || ""} ${report.suggested_next_action || ""}`.toLowerCase();
  return /(?:--metrics-path|metrics path) is required for a live run/u.test(summary);
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
    ]).filter((filePath) => !isDeferredExecutionArtifact(filePath, params.runDir))
  );

  return {
    changedFiles: existingChangedFiles,
    artifacts: existingArtifacts,
    publicArtifacts: existingPublicArtifacts,
    missingArtifacts,
    scriptPath: scriptPath && (await fileExists(scriptPath)) ? scriptPath : undefined
  };
}

function isDeferredExecutionArtifact(filePath: string, runDir: string): boolean {
  if (isPathInsideOrEqual(filePath, runDir)) {
    return isDeferredExecutionArtifactPath(filePath);
  }
  return isDeferredExecutionArtifactPath(filePath);
}

function isDeferredExecutionArtifactPath(filePath: string): boolean {
  const normalizedPath = path.normalize(filePath);
  const base = path.basename(filePath).toLowerCase();
  if (normalizedPath.includes(`${path.sep}.autolabos${path.sep}runs${path.sep}`)) {
    return isDeferredExecutionArtifactBaseName(base);
  }
  const segments = normalizedPath.split(path.sep).filter(Boolean);
  const outputsIndex = segments.indexOf("outputs");
  if (outputsIndex === -1) {
    return false;
  }
  const tail = segments.slice(outputsIndex + 2);
  if (tail.length >= 2 && tail[0] === "results") {
    return true;
  }
  if (tail.length >= 3 && tail[0] === "experiment" && tail[1] === "results") {
    return true;
  }
  if (tail.length >= 2 && tail[0] === "experiment" && isDeferredExecutionArtifactBaseName(base)) {
    return true;
  }
  return false;
}

function isDeferredExecutionArtifactBaseName(base: string): boolean {
  return (
    /^metrics(?:\.|$)/u.test(base) ||
    /^results(?:\.|$)/u.test(base) ||
    /^result(?:\.|$)/u.test(base) ||
    /(?:^|[_-])metrics?\.json$/u.test(base) ||
    /(?:^|[_-])results?\.json$/u.test(base) ||
    base === "study_results.json" ||
    base === "latest_results.json" ||
    base === "run.log" ||
    base === "objective_evaluation.json" ||
    base === "recent_paper_reproducibility.json"
  );
}

function shouldFallbackToStagedImplementLlm(finalText: string): boolean {
  const normalized = finalText.toLowerCase();
  return (
    normalized.includes("bwrap: loopback: failed rtm_newaddr: operation not permitted") ||
    normalized.includes("codex local filesystem action") ||
    normalized.includes("sandbox startup failure")
  );
}

function shouldDecomposeStagedImplementLlm(config: AppConfig): boolean {
  return config.providers.llm_mode === "codex" || config.providers.llm_mode === "codex_chatgpt_only";
}

function appendStagedImplementScaffoldOverrideToPrompt(prompt: string): string {
  return [
    prompt,
    "",
    "Staged implement scaffold mode:",
    "- Return scaffold metadata first. Do NOT include file_edits or file contents in this response.",
    "- Return ONLY one JSON object with keys: summary, experiment_mode, run_command, test_command, working_dir, changed_files, artifacts, public_dir, public_artifacts, script_path, metrics_path, localization, assumptions.",
    "- changed_files, artifacts, and public_artifacts must list only files materialized during implement_experiments, not deferred runtime outputs such as metrics_path, results*.json, *_results.json, study_results.json, latest_results.json, or run.log.",
    "- Do not include decomposition_plan or file_plan in this first scaffold response unless you can do so without delaying the runnable metadata surface.",
    "- Keep the scaffold minimal, concrete, and runnable."
  ].join("\n");
}

function appendStagedImplementFileOverrideToPrompt(prompt: string, targetPath: string): string {
  return [
    prompt,
    "",
    "Staged implement file materialization mode:",
    `- You are materializing exactly one text file: ${targetPath}`,
    "- Return ONLY one JSON object with keys: path, content.",
    "- Do NOT repeat the full experiment summary or any extra prose.",
    "- Emit full UTF-8 file content for the requested path."
  ].join("\n");
}

function appendStagedImplementBootstrapContractOverrideToPrompt(prompt: string): string {
  return [
    prompt,
    "",
    "Staged implement bootstrap contract mode:",
    "- Return ONLY one bare JSON object with keys: version, strategy, summary, requires_network, requires_warm_cache, can_execute_under_current_policy, blocking_reason, remediation, requirements, checks.",
    "- Do NOT use markdown fences. Do NOT add prose before or after the JSON.",
    "- This is a pre-code-generation environment/bootstrap contract, not a code scaffold.",
    "- Be explicit about remote assets, Hugging Face dependencies, local cache expectations, and command/module prerequisites."
  ].join("\n");
}

function appendStagedImplementMaterializationPlanOverrideToPrompt(targetPath: string): string {
  return [
    "You are in staged implement materialization planning mode.",
    `The requested file is: ${targetPath}`,
    "- Return ONLY one bare JSON object with keys: strategy, rationale, chunks.",
    "- Do NOT use markdown fences or any extra commentary.",
    "- Keep chunk scopes non-overlapping and ordered.",
    "- Let the chunk count follow the requested file's purpose and verification focus; do not force a fixed chunk count."
  ].join("\n");
}

function appendStagedImplementChunkOverrideToPrompt(prompt: string, targetPath: string, chunkId: string): string {
  return [
    prompt,
    "",
    "Staged implement chunk materialization mode:",
    `- You are generating only chunk ${chunkId} for ${targetPath}`,
    "- Return ONLY one JSON object with keys: chunk_id, content.",
    "- chunk_id must exactly match the requested chunk id.",
    "- Do not repeat content from earlier chunks.",
    "- Emit only raw UTF-8 code/text for this chunk.",
    "- For Python chunks, ensure the chunk can be inserted into the sectioned file without syntax errors; balance every bracket, parenthesis, quote, and indexing expression locally.",
    "- For Python chunks, do not emit `from __future__ import annotations`; future imports are only valid at the beginning of a module and chunk insertion may place this content later."
  ].join("\n");
}

function appendStagedImplementDecompositionOverrideToPrompt(prompt: string): string {
  return [
    prompt,
    "",
    "Staged implement decomposition repair mode:",
    "- The scaffold already exists but omitted decomposition_plan.",
    "- Return ONLY one bare JSON object with keys: objective, strategy, rationale, units.",
    "- Do NOT use markdown fences. Do NOT add any explanation before or after the JSON.",
    "- The decomposition must be research-purpose-aligned and dynamic, not a fixed ML template.",
    "- Each unit must include: id, unit_type, title, purpose, generation_mode, target_path (if materialized), depends_on, verification_focus.",
    "- Use generation_mode=materialize_text_file only for text artifacts AutoLabOS must materialize now.",
    "- Return only the smallest set of units the current research bundle truly needs."
  ].join("\n");
}

function appendStagedImplementMaterializableUnitRepairOverrideToPrompt(prompt: string): string {
  return [
    prompt,
    "",
    "Staged implement decomposition repair mode for materializable units:",
    "- The previous decomposition plan was parseable but omitted all materializable text units.",
    "- Return ONLY one bare JSON object with keys: objective, strategy, rationale, units.",
    "- Do NOT use markdown fences. Do NOT add any explanation before or after the JSON.",
    "- You MUST include at least one unit with generation_mode=materialize_text_file.",
    "- Prefer the scaffold's script_path, changed_files, and file_plan paths when choosing target_path values.",
    "- Return only the smallest set of materialized text units needed to make the experiment bundle runnable."
  ].join("\n");
}

function appendFilesystemFallbackOverrideToPrompt(prompt: string): string {
  return [
    prompt,
    "",
    "Filesystem-blocker recovery mode:",
    "- A previous Codex workspace filesystem/tooling blocker has already been detected and handled by AutoLabOS.",
    "- Do NOT repeat the blocker narrative, sandbox failure explanation, or any request to retry Codex filesystem actions.",
    "- In this staged_llm mode, you must synthesize the implementation directly as structured file_edits.",
    "- A valid response must include file_edits for each created or modified text artifact needed for the runnable experiment bundle.",
    "- At minimum, emit file_edits for the runnable script and any required config or README referenced by your commands.",
    "- If prior attempts failed before materializing files, treat that as resolved context rather than the answer.",
    "- If inspection is incomplete, generate the smallest bounded implementation that satisfies the task spec, localization hints, and verification command."
  ].join("\n");
}

function isMaterializableImplementTextPath(filePath: string): boolean {
  if (!filePath || isDeferredExecutionArtifactPath(filePath)) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return false;
  }
  return [
    ".py",
    ".json",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".sh",
    ".csv",
    ".tsv"
  ].includes(ext);
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

function getImplementLlmProgressHeartbeatMs(): number {
  const raw = process.env.AUTOLABOS_IMPLEMENT_LLM_PROGRESS_HEARTBEAT_MS;
  if (raw == null || raw.trim() === "") {
    return 60_000;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 60_000;
  }
  return Math.max(0, Math.floor(parsed));
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

function buildDesignImplementationValidationVerifyReport(
  report: ExperimentDesignImplementationValidationReport
): VerifyReport {
  const blockingFindings = report.findings.filter((finding) => finding.severity === "block");
  const renderedFinding = blockingFindings
    .map((finding) => `${finding.code}: ${finding.message}${finding.evidence ? ` (${finding.evidence})` : ""}`)
    .join("; ");
  return {
    status: "fail",
    failure_type: "spec",
    next_action: "retry_patch",
    stderr_excerpt: renderedFinding || report.summary,
    summary: renderedFinding
      ? `Design-to-implementation contract validation failed: ${renderedFinding}`
      : report.summary
  };
}

function buildImplementationTurnFailureReport(errorMessage: string): VerifyReport {
  return {
    status: "fail",
    failure_type: "environment",
    next_action: "stop_for_environment",
    stderr_excerpt: trimBlock(errorMessage, 1200) || errorMessage,
    summary: `Implementation execution failed before any runnable implementation was produced: ${errorMessage}`
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
    if (isDeferredExecutionArtifactPath(candidate)) {
      continue;
    }
    if (!(await fileExists(candidate))) {
      missing.push(candidate);
    }
  }
  return missing.sort();
}

export function extractWorkspacePathsFromCommand(command: string, cwd: string, workspaceRoot: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const paths = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeWorkspacePathToken(token);
    if (!normalized) {
      continue;
    }
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

function normalizeWorkspacePathToken(token: string): string | null {
  const value = token.replace(/^['"]|['"]$/g, "");
  const assignmentMatch = value.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/u);
  if (!assignmentMatch) {
    return value;
  }
  const rhs = assignmentMatch[2]?.replace(/^['"]|['"]$/g, "") || "";
  if (!rhs) {
    return null;
  }
  if (
    rhs.startsWith("./") ||
    rhs.startsWith("../") ||
    rhs.startsWith("/") ||
    rhs.includes("/") ||
    /\.(py|js|mjs|cjs|sh|json|yaml|yml|md|txt|toml|cfg|ini)$/iu.test(rhs)
  ) {
    return rhs;
  }
  return null;
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

async function detectPythonCsvFieldnameMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!/\bcsv\.DictWriter\s*\(/u.test(source) || !/writer\.writerow\s*\(/u.test(source)) {
    return undefined;
  }
  if (/extrasaction\s*=\s*["']ignore["']/u.test(source)) {
    return undefined;
  }

  const lines = source.split(/\r?\n/u);
  const fieldnames = extractPythonDictWriterFieldnames(lines);
  if (!fieldnames || fieldnames.length === 0) {
    return undefined;
  }

  const fieldnameSet = new Set(fieldnames);
  let insideReturn = false;
  let braceDepth = 0;
  const currentKeys = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!insideReturn) {
      if (!/\breturn\s*\{/u.test(line)) {
        continue;
      }
      insideReturn = true;
      braceDepth = countOccurrences(line, "{") - countOccurrences(line, "}");
      currentKeys.clear();
    } else {
      braceDepth += countOccurrences(line, "{") - countOccurrences(line, "}");
    }

    for (const match of line.matchAll(/["']([^"'\\]+)["']\s*:/gu)) {
      if (!currentKeys.has(match[1])) {
        currentKeys.set(match[1], index + 1);
      }
    }

    if (insideReturn && braceDepth <= 0) {
      const overlappingKeys = [...currentKeys.keys()].filter((key) => fieldnameSet.has(key));
      const extraKeys = [...currentKeys.entries()].filter(([key]) => !fieldnameSet.has(key));
      if (overlappingKeys.length >= 4 && extraKeys.length > 0) {
        const renderedExtras = extraKeys.map(([key]) => key).join(", ");
        const firstLine = extraKeys[0]?.[1] ?? 1;
        return `Python source writes CSV row keys not present in fieldnames at ${path.basename(scriptPath)}:${firstLine} (${renderedExtras}).`;
      }
      insideReturn = false;
      braceDepth = 0;
      currentKeys.clear();
    }
  }

  return undefined;
}

async function detectPythonUnsupportedGenerateKwarg(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!/\bmodel\.generate\s*\(/u.test(source)) {
    return undefined;
  }

  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bmodel\.generate\s*\(/u.test(lines[index])) {
      continue;
    }
    const call = extractPythonCallExpression(lines, index);
    if (!call) {
      continue;
    }

    if (/\bgenerator\s*=/u.test(call.text) || /\*\*\s*\{[\s\S]*?["']generator["']\s*:/u.test(call.text)) {
      return `Python source passes unsupported generator kwarg to model.generate at ${path.basename(scriptPath)}:${call.startLine}; seed sampling outside generate() instead.`;
    }

    for (const match of call.text.matchAll(/\*\*(\w+)/gu)) {
      const keyLine = findPythonDictKeyLine(lines, match[1], "generator", call.startLine);
      if (keyLine !== undefined) {
        return `Python source passes unsupported generator kwarg to model.generate at ${path.basename(scriptPath)}:${keyLine}; seed sampling outside generate() instead.`;
      }
    }
  }

  return undefined;
}

async function detectPythonUnsupportedTrainingArgumentsKwarg(scriptPath?: string): Promise<string | undefined> {
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
  const unsupportedTrainingArgumentsKwargs = ["overwrite_output_dir"];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bTrainingArguments\s*\(/u.test(lines[index])) {
      continue;
    }
    const call = extractPythonCallExpression(lines, index);
    if (!call) {
      continue;
    }
    const unsupported = unsupportedTrainingArgumentsKwargs.filter((name) => {
      const pattern = new RegExp(`\\b${escapeRegex(name)}\\s*=`, "u");
      return pattern.test(call.text);
    });
    if (unsupported.length > 0) {
      return `Python source passes unsupported TrainingArguments kwarg(s) at ${path.basename(scriptPath)}:${call.startLine}: ${unsupported.join(", ")}. Remove these kwargs or guard them against the installed transformers signature before handoff.`;
    }

    for (const match of call.text.matchAll(/\*\*(\w+)/gu)) {
      const unsupportedViaDict = unsupportedTrainingArgumentsKwargs.filter(
        (name) => findPythonDictKeyLine(lines, match[1], name, call.startLine) !== undefined
      );
      if (unsupportedViaDict.length > 0) {
        return `Python source passes unsupported TrainingArguments kwarg(s) via **${match[1]} at ${path.basename(scriptPath)}:${call.startLine}: ${unsupportedViaDict.join(", ")}. Remove these kwargs or guard them against the installed transformers signature before handoff.`;
      }
    }
  }

  return undefined;
}

async function repairPythonUnsupportedTrainingArgumentsKwargs(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (
    !/\bTrainingArguments\s*\(/u.test(source) ||
    (!/\boverwrite_output_dir\s*=/u.test(source) && !/["']overwrite_output_dir["']\s*:/u.test(source))
  ) {
    return { repaired: false };
  }

  const lines = source.split(/\r?\n/u);
  let nextSource = source;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bTrainingArguments\s*\(/u.test(lines[index])) {
      continue;
    }
    const call = extractPythonCallExpression(lines, index);
    if (!call || !/\boverwrite_output_dir\s*=/u.test(call.text)) {
      continue;
    }
    const repairedCall = removeUnsupportedTrainingArgumentsKwargsFromCall(call.text);
    if (repairedCall !== call.text) {
      nextSource = nextSource.replace(call.text, repairedCall);
    }
  }
  nextSource = removeUnsupportedTrainingArgumentsKwargsFromExpandedDicts(nextSource);
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Removed unsupported TrainingArguments kwarg(s) from ${path.basename(scriptPath)} before handoff.`
  };
}

function removeUnsupportedTrainingArgumentsKwargsFromCall(callText: string): string {
  let next = callText;
  for (const name of ["overwrite_output_dir"]) {
    const linePattern = new RegExp(`^\\s*${escapeRegex(name)}\\s*=.*?,?\\s*(?:#.*)?$`, "gmu");
    next = next.replace(linePattern, "");
    const leadingPattern = new RegExp(`${escapeRegex(name)}\\s*=\\s*[^,\\)\\n]+\\s*,\\s*`, "gu");
    next = next.replace(leadingPattern, "");
    const trailingPattern = new RegExp(`,\\s*${escapeRegex(name)}\\s*=\\s*[^,\\)\\n]+`, "gu");
    next = next.replace(trailingPattern, "");
  }
  return next
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/\(\s*,\s*/gu, "(")
    .replace(/,\s*\)/gu, ")");
}

function removeUnsupportedTrainingArgumentsKwargsFromExpandedDicts(source: string): string {
  const lines = source.split(/\r?\n/u);
  const unsupportedNames = ["overwrite_output_dir"];
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bTrainingArguments\s*\(/u.test(lines[index])) {
      continue;
    }
    const call = extractPythonCallExpression(lines, index);
    if (!call) {
      continue;
    }
    for (const match of call.text.matchAll(/\*\*(\w+)/gu)) {
      changed = removePythonDictKeysBeforeLine(lines, match[1], unsupportedNames, call.startLine) || changed;
    }
  }

  return changed ? lines.join("\n").replace(/\n{3,}/gu, "\n\n") : source;
}

async function repairPythonUnsupportedTrainerKwargs(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!/\bTrainer\s*\(/u.test(source) || !/\btokenizer\s*=/u.test(source)) {
    return { repaired: false };
  }

  const lines = source.split(/\r?\n/u);
  let nextSource = source;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bTrainer\s*\(/u.test(lines[index])) {
      continue;
    }
    const call = extractPythonCallExpression(lines, index);
    if (!call || !/\btokenizer\s*=/u.test(call.text)) {
      continue;
    }
    const repairedCall = removeUnsupportedTrainerKwargsFromCall(call.text);
    if (repairedCall !== call.text) {
      nextSource = nextSource.replace(call.text, repairedCall);
    }
  }
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Removed unsupported Trainer kwarg(s) from ${path.basename(scriptPath)} before handoff.`
  };
}

function removeUnsupportedTrainerKwargsFromCall(callText: string): string {
  let next = callText;
  for (const name of ["tokenizer"]) {
    const linePattern = new RegExp(`^\\s*${escapeRegex(name)}\\s*=.*?,?\\s*(?:#.*)?$`, "gmu");
    next = next.replace(linePattern, "");
    const leadingPattern = new RegExp(`${escapeRegex(name)}\\s*=\\s*[^,\\)\\n]+\\s*,\\s*`, "gu");
    next = next.replace(leadingPattern, "");
    const trailingPattern = new RegExp(`,\\s*${escapeRegex(name)}\\s*=\\s*[^,\\)\\n]+`, "gu");
    next = next.replace(trailingPattern, "");
  }
  return next
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/\(\s*,\s*/gu, "(")
    .replace(/,\s*\)/gu, ")");
}

async function repairPythonTrainerLabelPaddingCollatorSurface(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (
    !source.includes("Trainer(") ||
    !source.includes("data_collator=")
  ) {
    return { repaired: false };
  }

  if (
    source.includes("DataCollatorForLanguageModeling") &&
    /tokens\[\s*["']labels["']\s*\]\s*=\s*\[\s*list\s*\(\s*ids\s*\)\s+for\s+ids\s+in\s+tokens\[\s*["']input_ids["']\s*\]\s*\]/u.test(source)
  ) {
    const nextSource = source.replace(
      /^(\s*)tokens\[\s*["']labels["']\s*\]\s*=\s*\[\s*list\s*\(\s*ids\s*\)\s+for\s+ids\s+in\s+tokens\[\s*["']input_ids["']\s*\]\s*\]\s*$/mu,
      "$1# DataCollatorForLanguageModeling creates padded causal-LM labels after input padding."
    );
    if (nextSource !== source) {
      await fs.writeFile(scriptPath, nextSource, "utf8");
      return {
        repaired: true,
        message: `Removed ragged precomputed labels before DataCollatorForLanguageModeling in ${path.basename(scriptPath)} before handoff.`
      };
    }
  }

  if (
    !source.includes('tokenizer.pad(features, padding=True, return_tensors="pt")') ||
    !source.includes('batch["labels"].clone()')
  ) {
    return { repaired: false };
  }

  const collatorPattern =
    /(\n\s*def\s+collate\s*\(\s*features\s*:\s*list\s*\[dict\s*\[\s*str\s*,\s*Any\s*\]\]\s*\)\s*->\s*dict\s*\[\s*str\s*,\s*torch\.Tensor\s*\]\s*:\n)\s*batch\s*=\s*tokenizer\.pad\(features,\s*padding=True,\s*return_tensors=["']pt["']\)\n\s*labels\s*=\s*batch\["labels"\]\.clone\(\)\n\s*labels\[batch\["attention_mask"\]\s*==\s*0\]\s*=\s*-100\n\s*batch\["labels"\]\s*=\s*labels\n\s*return\s+batch/u;
  if (!collatorPattern.test(source)) {
    return { repaired: false };
  }

  const nextSource = source.replace(collatorPattern, (_match, signatureLine: string) => {
    const indentMatch = signatureLine.match(/\n(\s*)def\s+collate/u);
    const indent = indentMatch?.[1] || "";
    const body = `${indent}    `;
    return [
      signatureLine.trimEnd(),
      `${body}model_features = []`,
      `${body}label_features = []`,
      `${body}for feature in features:`,
      `${body}    copied = dict(feature)`,
      `${body}    raw_labels = copied.pop("labels", copied.get("input_ids", []))`,
      `${body}    label_features.append(list(raw_labels))`,
      `${body}    model_features.append(copied)`,
      `${body}batch = tokenizer.pad(model_features, padding=True, return_tensors="pt")`,
      `${body}max_length = int(batch["input_ids"].shape[1])`,
      `${body}padded_labels = []`,
      `${body}for labels in label_features:`,
      `${body}    labels = labels[:max_length]`,
      `${body}    labels = labels + [-100] * max(0, max_length - len(labels))`,
      `${body}    padded_labels.append(labels)`,
      `${body}labels_tensor = torch.tensor(padded_labels, dtype=torch.long)`,
      `${body}labels_tensor[batch["attention_mask"] == 0] = -100`,
      `${body}batch["labels"] = labels_tensor`,
      `${body}return batch`
    ].join("\n");
  });

  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Padded Trainer collator labels separately from tokenizer.pad(...) in ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonBroadCompatibleCallAdapterSurface(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  let nextSource = source;
  const broadFallbackPattern =
    /def _call_compatible\(fn: Callable\[\.\.\., Any\], \*args: Any, \*\*kwargs: Any\) -> Any:\n    """Call a helper while filtering keyword arguments it does not accept\."""\n    try:\n        signature = inspect\.signature\(fn\)\n        parameters = signature\.parameters\n        accepts_var_kwargs = any\(\n            parameter\.kind == inspect\.Parameter\.VAR_KEYWORD for parameter in parameters\.values\(\)\n        \)\n        if accepts_var_kwargs:\n            return fn\(\*args, \*\*kwargs\)\n        filtered_kwargs = \{key: value for key, value in kwargs\.items\(\) if key in parameters\}\n        return fn\(\*args, \*\*filtered_kwargs\)\n    except \(TypeError, ValueError\):\n        return fn\(\*args, \*\*kwargs\)/u;
  if (broadFallbackPattern.test(nextSource)) {
    nextSource = nextSource.replace(
      broadFallbackPattern,
      [
        "def _call_compatible(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:",
        "    \"\"\"Call a helper while filtering keyword arguments it does not accept.\"\"\"",
        "    try:",
        "        signature = inspect.signature(fn)",
        "    except (TypeError, ValueError):",
        "        return fn(*args, **kwargs)",
        "    parameters = signature.parameters",
        "    accepts_var_kwargs = any(",
        "        parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()",
        "    )",
        "    if accepts_var_kwargs:",
        "        return fn(*args, **kwargs)",
        "    filtered_kwargs = {key: value for key, value in kwargs.items() if key in parameters}",
        "    return fn(*args, **filtered_kwargs)"
      ].join("\n")
    );
  }

  const duplicateMetricsWriterPattern =
    /_call_compatible\(writer,\s*metrics,\s*metrics_path,\s*metrics=metrics,\s*path=metrics_path,\s*output_path=metrics_path\)/u;
  if (duplicateMetricsWriterPattern.test(nextSource)) {
    nextSource = nextSource.replace(
      duplicateMetricsWriterPattern,
      "_call_compatible(writer, metrics=metrics, metrics_path=metrics_path, path=metrics_path, output_path=metrics_path)"
    );
  }

  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Repaired broad helper adapter fallback and duplicate metrics-writer arguments in ${path.basename(scriptPath)} before handoff.`
  };
}

export async function repairPythonOrchestrationArgumentSurface(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  let nextSource = source;
  const namespaceParsePattern = /^(\s*)parsed\s*=\s*parser\.parse_args\(argv\)\s*$/mu;
  if (
    namespaceParsePattern.test(nextSource) &&
    /\bargparse\.Namespace\b/u.test(nextSource) &&
    !/isinstance\(argv,\s*argparse\.Namespace\)/u.test(nextSource)
  ) {
    nextSource = nextSource.replace(
      namespaceParsePattern,
      (_match, indent: string) => [
        `${indent}if isinstance(argv, argparse.Namespace):`,
        `${indent}    parsed = argv`,
        `${indent}else:`,
        `${indent}    parsed = parser.parse_args(argv)`
      ].join("\n")
    );
  }

  const needsWorkflowDatasetRepair =
    /def\s+_execute_baseline_first_workflow\s*\(/u.test(nextSource) &&
    /\btrain_dataset\b/u.test(nextSource) &&
    /\beval_examples\b/u.test(nextSource) &&
    /"recipes":\s*globals\(\)\.get\("PEFT_RECIPES"/u.test(nextSource) &&
    !/"train_dataset":\s*train_dataset/u.test(nextSource) &&
    !/def\s+_autolabos_prepare_workflow_train_dataset\s*\(/u.test(nextSource);

  if (needsWorkflowDatasetRepair) {
    const workflowMatch = nextSource.match(/\ndef\s+_execute_baseline_first_workflow\s*\(/u);
    if (workflowMatch?.index != null) {
      const helperBlock = [
        "",
        "def _autolabos_prepare_workflow_train_dataset(args: argparse.Namespace, runtime_context: Mapping[str, Any]) -> Any:",
        "    for helper_name in (",
        "        \"load_shared_instruction_subset\",",
        "        \"load_instruction_dataset\",",
        "        \"load_training_dataset\",",
        "        \"prepare_train_dataset\",",
        "        \"prepare_training_dataset\",",
        "    ):",
        "        helper = globals().get(helper_name)",
        "        if callable(helper):",
        "            return _call_with_compatible_signature(",
        "                helper,",
        "                args=args,",
        "                runtime_context=runtime_context,",
        "                cache_dir=runtime_context.get(\"cache_dir\"),",
        "                output_dir=runtime_context.get(\"output_dir\"),",
        "            )",
        "    raise RuntimeError(\"No train dataset preparation helper was available for the selected workflow.\")",
        "",
        "def _autolabos_prepare_workflow_eval_examples(args: argparse.Namespace, runtime_context: Mapping[str, Any]) -> Mapping[str, Sequence[Mapping[str, Any]]]:",
        "    for helper_name in (",
        "        \"load_benchmark_examples\",",
        "        \"load_benchmark_eval_examples\",",
        "        \"load_eval_examples\",",
        "        \"prepare_eval_examples\",",
        "        \"prepare_benchmark_examples\",",
        "    ):",
        "        helper = globals().get(helper_name)",
        "        if callable(helper):",
        "            value = _call_with_compatible_signature(",
        "                helper,",
        "                args=args,",
        "                runtime_context=runtime_context,",
        "                cache_dir=runtime_context.get(\"cache_dir\"),",
        "                max_eval_examples_per_benchmark=getattr(args, \"max_eval_examples_per_benchmark\", None),",
        "            )",
        "            if isinstance(value, Mapping):",
        "                return value",
        "            raise TypeError(f\"Benchmark helper {helper_name} returned {type(value).__name__}, expected mapping.\")",
        "    raise RuntimeError(\"No benchmark example preparation helper was available for the selected workflow.\")",
        ""
      ].join("\n");
      nextSource = `${nextSource.slice(0, workflowMatch.index)}${helperBlock}${nextSource.slice(workflowMatch.index)}`;
    }

    const commonKwargsPattern = /(\n\s*model_name\s*=\s*_get_arg\(args,\s*"model_name"[\s\S]*?\n)(\s*common_kwargs\s*=\s*\{)/u;
    if (commonKwargsPattern.test(nextSource)) {
      nextSource = nextSource.replace(
        commonKwargsPattern,
        (_match, prefix: string, commonKwargsLine: string) => [
          prefix.trimEnd(),
          "    train_dataset = _autolabos_prepare_workflow_train_dataset(args, runtime_context)",
          "    eval_examples = _autolabos_prepare_workflow_eval_examples(args, runtime_context)",
          commonKwargsLine
        ].join("\n")
      );
    }

    const recipesLinePattern =
      /(\n\s*"recipes":\s*globals\(\)\.get\("PEFT_RECIPES",\s*globals\(\)\.get\("RECIPE_CONFIGS",\s*None\)\),)/u;
    if (recipesLinePattern.test(nextSource)) {
      nextSource = nextSource.replace(
        recipesLinePattern,
        [
          "$1",
          "        \"train_dataset\": train_dataset,",
          "        \"eval_examples\": eval_examples,",
          "        \"benchmarks\": eval_examples,",
          "        \"benchmark_examples\": eval_examples,"
        ].join("\n")
      );
    }
  }

  const needsBaselineRecipeStudyInputRepair =
    /def\s+execute_baseline_first_recipe_study\s*\([\s\S]*?\btrain_dataset\s*:[\s\S]*?\beval_datasets\s*:[\s\S]*?\bdevice\s*:/u.test(nextSource) &&
    /\bworkflow_kwargs\s*:\s*Dict\[str,\s*Any\]\s*=\s*\{/u.test(nextSource) &&
    /\bworkflow_result\s*=\s*_call_with_supported_kwargs\(workflow,\s*\*\*workflow_kwargs\)/u.test(nextSource) &&
    !/"train_dataset":\s*train_dataset/u.test(nextSource) &&
    !/def\s+_autolabos_prepare_baseline_recipe_study_inputs\s*\(/u.test(nextSource);

  if (needsBaselineRecipeStudyInputRepair) {
    const executeStudyMatch = nextSource.match(/\ndef\s+_execute_study_from_args\s*\(/u);
    if (executeStudyMatch?.index != null) {
      const helperBlock = [
        "",
        "def _autolabos_call_generated_helper(helper_name, **kwargs):",
        "    helper = globals().get(helper_name)",
        "    if not callable(helper):",
        "        return None",
        "    caller = globals().get(\"_call_with_supported_kwargs\") or globals().get(\"_call_with_compatible_signature\")",
        "    if callable(caller):",
        "        return caller(helper, **kwargs)",
        "    return helper(**kwargs)",
        "",
        "def _autolabos_prepare_baseline_recipe_study_inputs(args, output_dir, model_name, max_train_examples, max_eval_examples, max_seq_length, seed):",
        "    device_helper = globals().get(\"detect_device\") or globals().get(\"get_device\") or globals().get(\"select_device\")",
        "    if callable(device_helper):",
        "        device = device_helper()",
        "    else:",
        "        device = torch.device(\"cuda\" if torch.cuda.is_available() else \"cpu\")",
        "",
        "    eval_datasets = None",
        "    for helper_name in (\"load_evaluation_examples\", \"load_eval_examples\", \"prepare_eval_datasets\", \"load_benchmark_examples\", \"load_benchmark_eval_examples\"):",
        "        value = _autolabos_call_generated_helper(",
        "            helper_name,",
        "            args=args,",
        "            max_eval_examples=max_eval_examples,",
        "            max_eval_examples_per_benchmark=max_eval_examples,",
        "            seed=seed,",
        "            output_dir=output_dir,",
        "        )",
        "        if isinstance(value, tuple) and value:",
        "            value = value[0]",
        "        if hasattr(value, \"items\"):",
        "            eval_datasets = value",
        "            break",
        "    if eval_datasets is None:",
        "        raise RuntimeError(\"No evaluation dataset preparation helper was available for the baseline-first recipe study.\")",
        "",
        "    tokenizer = None",
        "    for helper_name in (\"load_tokenizer\", \"build_tokenizer\", \"prepare_tokenizer\"):",
        "        tokenizer = _autolabos_call_generated_helper(helper_name, model_name=model_name, args=args)",
        "        if tokenizer is not None:",
        "            break",
        "",
        "    train_dataset = None",
        "    for helper_name in (\"build_instruction_training_dataset\", \"prepare_instruction_training_dataset\", \"tokenize_instruction_dataset_for_training\"):",
        "        value = _autolabos_call_generated_helper(",
        "            helper_name,",
        "            args=args,",
        "            tokenizer=tokenizer,",
        "            max_train_examples=max_train_examples,",
        "            max_seq_length=max_seq_length,",
        "            seed=seed,",
        "            output_dir=output_dir,",
        "        )",
        "        if isinstance(value, tuple) and value:",
        "            value = value[0]",
        "        if value is not None:",
        "            train_dataset = value",
        "            break",
        "    if train_dataset is None:",
        "        for helper_name in (\"load_instruction_dataset\", \"load_training_dataset\", \"prepare_train_dataset\", \"prepare_training_dataset\"):",
        "            value = _autolabos_call_generated_helper(",
        "                helper_name,",
        "                args=args,",
        "                max_train_examples=max_train_examples,",
        "                seed=seed,",
        "                output_dir=output_dir,",
        "            )",
        "            if isinstance(value, tuple) and value:",
        "                value = value[0]",
        "            if value is not None:",
        "                train_dataset = value",
        "                break",
        "",
        "    return {\"train_dataset\": train_dataset, \"eval_datasets\": eval_datasets, \"device\": device}",
        ""
      ].join("\n");
      nextSource = `${nextSource.slice(0, executeStudyMatch.index)}${helperBlock}${nextSource.slice(executeStudyMatch.index)}`;
    }

    const workflowKwargsPattern = /(\n\s*workflow_kwargs\s*:\s*Dict\[str,\s*Any\]\s*=\s*\{\n\s*"args":\s*args,)/u;
    if (workflowKwargsPattern.test(nextSource)) {
      nextSource = nextSource.replace(
        workflowKwargsPattern,
        (_match, workflowKwargsStart: string) => [
          "",
          "    _autolabos_recipe_inputs = _autolabos_prepare_baseline_recipe_study_inputs(",
          "        args=args,",
          "        output_dir=output_dir,",
          "        model_name=model_name,",
          "        max_train_examples=max_train_examples,",
          "        max_eval_examples=max_eval_examples,",
          "        max_seq_length=max_seq_length,",
          "        seed=seed,",
          "    )",
          "    train_dataset = _autolabos_recipe_inputs[\"train_dataset\"]",
          "    eval_datasets = _autolabos_recipe_inputs[\"eval_datasets\"]",
          "    device = _autolabos_recipe_inputs[\"device\"]",
          workflowKwargsStart,
          "        \"train_dataset\": train_dataset,",
          "        \"dataset\": train_dataset,",
          "        \"eval_datasets\": eval_datasets,",
          "        \"eval_examples\": eval_datasets,",
          "        \"benchmark_datasets\": eval_datasets,",
          "        \"device\": device,"
        ].join("\n")
      );
    }
  }

  if (
    /\bpayload\s*=\s*_call_with_supported_kwargs\(\s*\n\s*payload_builder,\s*\n\s*args=args,/u.test(nextSource) &&
    !/\braw_results\s*=\s*workflow_result/u.test(nextSource)
  ) {
    nextSource = nextSource.replace(
      /(\bpayload\s*=\s*_call_with_supported_kwargs\(\s*\n\s*payload_builder,\s*\n\s*args=args,)/u,
      [
        "$1",
        "            raw_results=workflow_result,",
        "            raw_workflow_result=workflow_result,"
      ].join("\n")
    );
  }

  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Repaired orchestration Namespace parsing and workflow dataset argument preparation in ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonJsonSafeHelperAlias(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  const missingAliasNames = ["make_json_safe", "_json_safe"].filter(
    (name) => new RegExp(`\\b${escapeRegex(name)}\\s*\\(`, "u").test(source) && !pythonSourceDefinesOrImportsName(source, name)
  );
  if (missingAliasNames.length === 0) {
    return { repaired: false };
  }

  const fallbackName = pythonSourceDefinesName(source, "_autolabos_json_safe")
    ? "_autolabos_json_safe"
    : pythonSourceDefinesName(source, "json_safe")
      ? "json_safe"
      : undefined;
  if (!fallbackName && !pythonSourceDefinesName(source, "dumps_json_safe")) {
    return { repaired: false };
  }

  const aliasBlocks = missingAliasNames.map((name) =>
    fallbackName
      ? [
          "",
          `def ${name}(value):`,
          `    return ${fallbackName}(value)`,
          ""
        ].join("\n")
      : [
          "",
          `def ${name}(value):`,
          "    return value",
          ""
        ].join("\n")
  );
  const alias = aliasBlocks.join("");

  const lastImportMatch = Array.from(source.matchAll(/^(?:from\s+\S+\s+import\s+.+|import\s+.+)$/gmu)).pop();
  let nextSource: string;
  if (lastImportMatch && typeof lastImportMatch.index === "number") {
    const insertAt = lastImportMatch.index + lastImportMatch[0].length;
    nextSource = `${source.slice(0, insertAt)}${alias}${source.slice(insertAt)}`;
  } else {
    nextSource = `${alias}${source}`;
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added JSON-safe compatibility alias(es) ${missingAliasNames.join(", ")} to ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonEnsureDirHelperSurface(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!/\bensure_dir\s*\(/u.test(source) || pythonSourceDefinesOrImportsName(source, "ensure_dir")) {
    return { repaired: false };
  }

  const helper = [
    "",
    "def ensure_dir(path):",
    "    from pathlib import Path as _AutoLabOSPath",
    "    directory = _AutoLabOSPath(path)",
    "    directory.mkdir(parents=True, exist_ok=True)",
    "    return directory",
    ""
  ].join("\n");

  const insertionMatch =
    source.match(/\ndef\s+main\s*\(/u) ||
    source.match(/\ndef\s+run_and_write_metrics\s*\(/u) ||
    source.match(/\nif\s+__name__\s*==\s*["']__main__["']/u);
  const insertionIndex = insertionMatch?.index ?? source.length;
  const nextSource = `${source.slice(0, insertionIndex)}${helper}${source.slice(insertionIndex)}`;
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added ensure_dir directory helper to ${path.basename(scriptPath)} before handoff.`
  };
}

async function detectPythonUndefinedUppercaseReferences(scriptPath?: string): Promise<string | undefined> {
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
  const defined = new Set<string>([
    "False",
    "None",
    "True",
    "__name__",
    "__file__"
  ]);
  const used = new Map<string, number>();
  const stripState: PythonLineStripState = {};

  for (let index = 0; index < lines.length; index += 1) {
    const code = stripPythonLineStringsAndComment(lines[index], stripState);

    const assignment = code.match(/^\s*([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/u);
    if (assignment) {
      defined.add(assignment[1]);
    }

    for (const importMatch of code.matchAll(/\bfrom\s+[\w.]+\s+import\s+(.+)$/gu)) {
      for (const importedName of importMatch[1].split(",")) {
        const name = importedName.trim().split(/\s+as\s+/u).pop()?.trim();
        if (name && /^[A-Z][A-Z0-9_]{2,}$/u.test(name)) {
          defined.add(name);
        }
      }
    }

    for (const nameMatch of code.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/gu)) {
      const name = nameMatch[0];
      const previous = code[nameMatch.index - 1];
      if (previous === ".") {
        continue;
      }
      if (isGlobalsGuardedUppercaseReference(lines[index], name)) {
        continue;
      }
      if (!used.has(name)) {
        used.set(name, index + 1);
      }
    }
  }

  const missing = [...used.entries()]
    .filter(([name]) => !defined.has(name))
    .slice(0, 8);
  if (missing.length === 0) {
    return undefined;
  }

  const rendered = missing.map(([name, line]) => `${name} at ${path.basename(scriptPath)}:${line}`).join(", ");
  return `Python source references uppercase constant(s) that are never defined or imported: ${rendered}. Define these constants before module-level use or load them from config.`;
}

async function detectPythonUndefinedAnnotationReferences(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (/^\s*from\s+__future__\s+import\s+.*\bannotations\b/mu.test(source)) {
    return undefined;
  }

  const lines = source.split(/\r?\n/u);
  const defined = new Set<string>([
    "Any",
    "Callable",
    "Dict",
    "Iterable",
    "Iterator",
    "List",
    "Mapping",
    "MutableMapping",
    "Optional",
    "Sequence",
    "Set",
    "Tuple",
    "Union",
    "None",
    "bool",
    "bytes",
    "dict",
    "float",
    "frozenset",
    "int",
    "list",
    "object",
    "set",
    "str",
    "tuple",
    "type"
  ]);
  const used = new Map<string, number>();
  const stripState: PythonLineStripState = {};

  for (let index = 0; index < lines.length; index += 1) {
    const code = stripPythonLineStringsAndComment(lines[index], stripState);

    const classDefinition = code.match(/^\s*class\s+([A-Za-z_]\w*)\b/u);
    if (classDefinition) {
      defined.add(classDefinition[1]);
    }

    const functionDefinition = code.match(/^\s*def\s+([A-Za-z_]\w*)\b/u);
    if (functionDefinition) {
      defined.add(functionDefinition[1]);
    }

    const assignment = code.match(/^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=/u);
    if (assignment) {
      defined.add(assignment[1]);
    }

    for (const importMatch of code.matchAll(/\b(?:from\s+[\w.]+\s+)?import\s+(.+)$/gu)) {
      for (const importedName of importMatch[1].split(",")) {
        const name = importedName.trim().split(/\s+as\s+/u).pop()?.trim();
        if (name && /^[A-Za-z_]\w*$/u.test(name)) {
          defined.add(name);
        }
      }
    }

    const defSignature = code.match(/^\s*def\s+[A-Za-z_]\w*\s*\((.*)\)\s*(?:->\s*(.*?))?\s*:/u);
    if (defSignature) {
      for (const param of splitPythonSignatureParameters(defSignature[1])) {
        const colonIndex = param.indexOf(":");
        if (colonIndex === -1) {
          continue;
        }
        const annotation = param.slice(colonIndex + 1).split("=")[0] ?? "";
        for (const name of extractPythonAnnotationNames(annotation)) {
          if (!used.has(name)) {
            used.set(name, index + 1);
          }
        }
      }
      for (const name of extractPythonAnnotationNames(defSignature[2] ?? "")) {
        if (!used.has(name)) {
          used.set(name, index + 1);
        }
      }
    }
  }

  const missing = [...used.entries()]
    .filter(([name]) => !defined.has(name))
    .slice(0, 8);
  if (missing.length === 0) {
    return undefined;
  }

  const rendered = missing.map(([name, line]) => `${name} at ${path.basename(scriptPath)}:${line}`).join(", ");
  return `Python source uses undefined type annotation name(s) that can fail at module load time: ${rendered}. Define/import the annotation target before use or rename it to the actual dataclass.`;
}

async function repairPythonUndefinedAnnotationReferences(
  scriptPath?: string
): Promise<{ repaired: boolean; message?: string }> {
  const issue = await detectPythonUndefinedAnnotationReferences(scriptPath);
  if (!scriptPath || !issue) {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  const nextSource = insertPythonFutureAnnotationsImport(source);
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Postponed Python annotation evaluation in ${path.basename(scriptPath)} before handoff.`
  };
}

function insertPythonFutureAnnotationsImport(source: string): string {
  if (/^\s*from\s+__future__\s+import\s+.*\bannotations\b/mu.test(source)) {
    return source;
  }

  const lines = source.split(/\r?\n/u);
  let insertAt = 0;
  if (/^#!/u.test(lines[insertAt] ?? "")) {
    insertAt += 1;
  }
  if (/coding[:=]\s*[-\w.]+/u.test(lines[insertAt] ?? "")) {
    insertAt += 1;
  }
  while (insertAt < lines.length && /^\s*(?:#.*)?$/u.test(lines[insertAt] ?? "")) {
    insertAt += 1;
  }

  const docstringStart = lines[insertAt]?.match(/^(\s*)(["']{3})/u);
  if (docstringStart) {
    const delimiter = docstringStart[2];
    const restOfLine = lines[insertAt]?.slice((docstringStart.index ?? 0) + delimiter.length) ?? "";
    insertAt += 1;
    if (!restOfLine.includes(delimiter)) {
      while (insertAt < lines.length && !(lines[insertAt] ?? "").includes(delimiter)) {
        insertAt += 1;
      }
      if (insertAt < lines.length) {
        insertAt += 1;
      }
    }
    while (insertAt < lines.length && /^\s*(?:#.*)?$/u.test(lines[insertAt] ?? "")) {
      insertAt += 1;
    }
  }

  while (/^\s*from\s+__future__\s+import\s+/u.test(lines[insertAt] ?? "")) {
    insertAt += 1;
  }

  lines.splice(insertAt, 0, "from __future__ import annotations");
  return lines.join("\n");
}

function extractPythonAnnotationNames(annotation: string): string[] {
  const names: string[] = [];
  for (const match of annotation.matchAll(/\b[A-Za-z_]\w*\b/gu)) {
    if (annotation[match.index - 1] === ".") {
      continue;
    }
    names.push(match[0]);
  }
  return names;
}

async function detectPythonUndefinedSlugifyReference(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!/\bslugify\s*\(/u.test(source) || pythonSourceDefinesOrImportsName(source, "slugify")) {
    return undefined;
  }

  const line = source.slice(0, source.search(/\bslugify\s*\(/u)).split(/\r?\n/u).length;
  return [
    "Python source calls slugify() but never defines or imports it.",
    `First unresolved slugify() call appears at ${path.basename(scriptPath)}:${line}.`,
    "Define a local slugify helper before module-level recipe projections, import it explicitly, or avoid using it in RecipeSpec properties before handoff."
  ].join(" ");
}

async function detectPythonNonExecutableRunnerSurface(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const lineCount = source.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  const hasEntrypoint =
    /\n\s*if\s+__name__\s*==\s*["']__main__["']\s*:/u.test(`\n${source}`) ||
    /\n\s*def\s+main\s*\(/u.test(`\n${source}`) ||
    /\n\s*def\s+run_and_write_metrics\s*\(/u.test(`\n${source}`) ||
    /\n\s*def\s+(?:run|execute|orchestrate)_[A-Za-z0-9_]*(?:experiment|study)[A-Za-z0-9_]*\s*\(/u.test(`\n${source}`);
  const hasMetricsPathSurface =
    /\bmetrics_path\b/u.test(source) ||
    /--metrics-path/u.test(source) ||
    /\bmetrics[_-](?:out|output|file|path)\b/iu.test(source);
  const hasMetricsWriterSurface =
    /\n\s*def\s+[A-Za-z0-9_]*(?:write|persist|save)[A-Za-z0-9_]*metrics[A-Za-z0-9_]*\s*\(/iu.test(`\n${source}`) ||
    /\bjson\.dump\s*\(/u.test(source) ||
    /\.write_text\s*\(/u.test(source);

  if (lineCount <= 40 && !hasEntrypoint && !(hasMetricsPathSurface && hasMetricsWriterSurface)) {
    return [
      "Python experiment runner appears truncated or non-executable after materialization.",
      `${path.basename(scriptPath)} has only ${lineCount} non-empty line(s), no executable entrypoint, and no required metrics-path writing surface.`,
      "Preserve the full runner while applying targeted repairs; do not hand off helper-only Python files that can exit without writing metrics."
    ].join(" ");
  }
  if (!hasEntrypoint && !hasMetricsWriterSurface) {
    return [
      "Python experiment runner has no executable entrypoint or metrics writer surface.",
      "Define a main/__main__ entrypoint that writes JSON metrics to the required metrics path before handoff."
    ].join(" ");
  }

  return undefined;
}

const CRITICAL_PYTHON_RUNTIME_HELPER_NAMES = [
  "_json_safe",
  "ensure_dir",
  "get_device",
  "get_device_info",
  "normalize_for_json",
  "validate_runtime_dependencies",
  "write_metrics_json"
];

async function detectPythonUndefinedRuntimeHelperReferences(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const missing = CRITICAL_PYTHON_RUNTIME_HELPER_NAMES
    .filter((name) => new RegExp(`\\b${escapeRegex(name)}\\s*\\(`, "u").test(source))
    .filter((name) => !pythonSourceDefinesOrImportsName(source, name));
  if (missing.length === 0) {
    return undefined;
  }

  const rendered = missing.map((name) => {
    const match = source.search(new RegExp(`\\b${escapeRegex(name)}\\s*\\(`, "u"));
    const line = match >= 0 ? source.slice(0, match).split(/\r?\n/u).length : 1;
    return `${name} at ${path.basename(scriptPath)}:${line}`;
  }).join(", ");
  return [
    "Python source calls critical runtime helper(s) that are never defined or imported.",
    `Undefined helper call(s): ${rendered}.`,
    "Define each helper before main() invokes it, import it explicitly, or inline the runtime check before handoff."
  ].join(" ");
}

async function detectPythonGlobalsHelperCallArityMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const mismatches: string[] = [];
  for (const match of source.matchAll(/\ndef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    const name = match[1];
    if (!name) {
      continue;
    }
    const signature = extractPythonFunctionSignature(source, name);
    if (!signature) {
      continue;
    }
    const requiredParams = extractPythonRequiredParameterNames(signature);
    if (requiredParams.length === 0) {
      continue;
    }
    const escaped = escapeRegex(name);
    const noArgGlobalsCall = new RegExp(
      `globals\\s*\\(\\s*\\)\\s*\\[\\s*["']${escaped}["']\\s*\\]\\s*\\(\\s*\\)`,
      "u"
    ).test(source);
    if (!noArgGlobalsCall) {
      continue;
    }
    const callIndex = source.search(
      new RegExp(`globals\\s*\\(\\s*\\)\\s*\\[\\s*["']${escaped}["']\\s*\\]\\s*\\(\\s*\\)`, "u")
    );
    const line = callIndex >= 0 ? source.slice(0, callIndex).split(/\r?\n/u).length : 1;
    mismatches.push(`${name} requires ${requiredParams.join(", ")} but is called with no arguments at ${path.basename(scriptPath)}:${line}`);
  }

  if (mismatches.length === 0) {
    return undefined;
  }

  return [
    "Generated Python runner has a globals helper call arity mismatch.",
    `Mismatched helper call(s): ${mismatches.slice(0, 4).join("; ")}.`,
    "Pass the required helper arguments, make those parameters optional with safe defaults, or use a signature-aware adapter before handoff."
  ].join(" ");
}

function isGlobalsGuardedUppercaseReference(line: string, name: string): boolean {
  const escapedName = escapeRegex(name);
  return new RegExp(
    `\\b${escapedName}\\b\\s+if\\s+["']${escapedName}["']\\s+in\\s+globals\\s*\\(\\s*\\)\\s+else\\b`,
    "u"
  ).test(line);
}

type PythonLineStripState = {
  tripleQuote?: "'''" | "\"\"\"";
};

function stripPythonLineStringsAndComment(line: string, state: PythonLineStripState = {}): string {
  let stripped = "";
  let quote: "'" | "\"" | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    if (state.tripleQuote) {
      if (line.startsWith(state.tripleQuote, index)) {
        stripped += " ".repeat(state.tripleQuote.length);
        index += state.tripleQuote.length - 1;
        state.tripleQuote = undefined;
        continue;
      }
      stripped += " ";
      continue;
    }

    const char = line[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      stripped += " ";
      continue;
    }
    if (char === "#") {
      break;
    }
    if (line.startsWith("'''", index) || line.startsWith("\"\"\"", index)) {
      const tripleQuote = line.slice(index, index + 3) as "'''" | "\"\"\"";
      stripped += " ".repeat(tripleQuote.length);
      index += tripleQuote.length - 1;
      state.tripleQuote = tripleQuote;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      stripped += " ";
      continue;
    }
    stripped += char;
  }
  return stripped;
}

async function repairPythonMissingParseArgsSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (/\ndef\s+parse_args\s*\(/u.test(`\n${source}`)) {
    return { repaired: false };
  }
  if (!/\ndef\s+build_arg_parser\s*\(/u.test(`\n${source}`)) {
    return { repaired: false };
  }

  const shim = [
    "",
    "def parse_args(argv=None):",
    "    parser = build_arg_parser()",
    "    return parser.parse_args(argv)",
    ""
  ].join("\n");

  const mainMatch = source.match(/\n(def\s+main\s*\()/u);
  const guardMatch = source.match(/\n(if\s+__name__\s*==\s*["']__main__["']\s*:)/u);

  let nextSource: string;
  if (mainMatch?.index != null) {
    nextSource = `${source.slice(0, mainMatch.index)}${shim}${source.slice(mainMatch.index)}`;
  } else if (guardMatch?.index != null) {
    nextSource = `${source.slice(0, guardMatch.index)}${shim}${source.slice(guardMatch.index)}`;
  } else {
    nextSource = `${source.trimEnd()}\n${shim}`;
  }

  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added a parse_args() compatibility shim to ${path.basename(scriptPath)} before handoff.`
  };
}

async function detectPythonRunCommandArgparseMismatch(
  scriptPath?: string,
  runCommand?: string
): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py" || !runCommand?.trim()) {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  if (!/\bargparse\b/u.test(source) || !/\badd_argument\s*\(/u.test(source)) {
    return undefined;
  }
  if (/\bparse_known_args\s*\(/u.test(source)) {
    return undefined;
  }

  const acceptedFlags = extractPythonArgparseLongFlags(source);
  if (acceptedFlags.size === 0) {
    return undefined;
  }

  const commandFlags = extractLongOptionFlags(runCommand);
  const unsupported = commandFlags.filter((flag) => !acceptedFlags.has(flag));
  if (unsupported.length === 0) {
    const noValueFlags = extractPythonArgparseNoValueLongFlags(source);
    const valuedNoValueFlags = extractLongOptionFlagsWithValues(runCommand).filter((flag) => noValueFlags.has(flag));
    if (valuedNoValueFlags.length === 0) {
      return undefined;
    }

    return `run_command passes value(s) to Python argparse flag(s) that do not accept values: ${valuedNoValueFlags.join(
      ", "
    )}. Align run_command with the generated runner CLI or change those flags to accept explicit values before handoff.`;
  }

  const acceptedPreview = [...acceptedFlags].sort().slice(0, 20).join(", ");
  return `run_command passes unsupported Python argparse flag(s): ${unsupported.join(
    ", "
  )}. Accepted flags include: ${acceptedPreview}. Align run_command with the generated runner CLI or add explicit argparse aliases before handoff.`;
}

async function repairPythonOutputDirArgparseAlias(
  scriptPath?: string,
  runCommand?: string
): Promise<{ repaired: boolean; message?: string }> {
  if (!scriptPath || path.extname(scriptPath) !== ".py" || !runCommand?.trim()) {
    return { repaired: false };
  }

  if (!extractLongOptionFlags(runCommand).includes("--output-dir")) {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!/\bargparse\b/u.test(source) || !/\badd_argument\s*\(/u.test(source)) {
    return { repaired: false };
  }
  const acceptedFlags = extractPythonArgparseLongFlags(source);
  if (acceptedFlags.has("--output-dir")) {
    return { repaired: false };
  }

  const returnParserPattern = /^(\s*)return\s+parser\s*$/mu;
  if (!returnParserPattern.test(source)) {
    return { repaired: false };
  }

  const nextSource = source.replace(
    returnParserPattern,
    (_match, indent: string) => [
      `${indent}parser.add_argument('--output-dir', default='.', help='Public output directory for AutoLabOS run artifacts.')`,
      `${indent}return parser`
    ].join("\n")
  );
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added --output-dir argparse alias to ${path.basename(scriptPath)} before handoff.`
  };
}

function extractPythonArgparseLongFlags(source: string): Set<string> {
  const flags = new Set<string>();
  for (const match of source.matchAll(/\badd_argument\s*\(([\s\S]*?)\)/gu)) {
    const argsText = match[1] || "";
    for (const flagMatch of argsText.matchAll(/["'](--[A-Za-z0-9][A-Za-z0-9_-]*)["']/gu)) {
      flags.add(flagMatch[1]);
    }
  }
  return flags;
}

function extractPythonArgparseNoValueLongFlags(source: string): Set<string> {
  const flags = new Set<string>();
  for (const match of source.matchAll(/\badd_argument\s*\(([\s\S]*?)\)/gu)) {
    const argsText = match[1] || "";
    if (!/\baction\s*=\s*["'](?:store_true|store_false|store_const|append_const|count)["']/u.test(argsText)) {
      continue;
    }
    for (const flagMatch of argsText.matchAll(/["'](--[A-Za-z0-9][A-Za-z0-9_-]*)["']/gu)) {
      flags.add(flagMatch[1]);
    }
  }
  return flags;
}

function extractLongOptionFlags(command: string): string[] {
  const flags: string[] = [];
  for (const match of command.matchAll(/(^|\s)(--[A-Za-z0-9][A-Za-z0-9_-]*)(?:[=\s]|$)/gu)) {
    const flag = match[2];
    if (flag === "--help" || flags.includes(flag)) {
      continue;
    }
    flags.push(flag);
  }
  return flags;
}

function extractLongOptionFlagsWithValues(command: string): string[] {
  const flags: string[] = [];
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = unquoteShellToken(tokens[index] || "");
    if (!/^--[A-Za-z0-9][A-Za-z0-9_-]*/u.test(token)) {
      continue;
    }
    const [flag, inlineValue] = token.split("=", 2);
    const next = unquoteShellToken(tokens[index + 1] || "");
    const hasValue = inlineValue !== undefined || (next.length > 0 && !next.startsWith("-"));
    if (hasValue && flag !== "--help" && !flags.includes(flag)) {
      flags.push(flag);
    }
  }
  return flags;
}

async function repairPythonExperimentConfigMetadataSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!source.includes("class ExperimentConfig:")) {
    return { repaired: false };
  }
  if (!source.includes("metadata=")) {
    return { repaired: false };
  }

  const classStart = source.indexOf("class ExperimentConfig:\n");
  if (classStart < 0) {
    return { repaired: false };
  }
  const bodyStart = classStart + "class ExperimentConfig:\n".length;
  const nextDecorator = source.indexOf("\n@dataclass", bodyStart);
  const nextClass = source.indexOf("\nclass ", bodyStart);
  const nextDef = source.indexOf("\ndef ", bodyStart);
  const bodyEndCandidates = [nextDecorator, nextClass, nextDef].filter((value) => value >= 0);
  const bodyEnd = bodyEndCandidates.length > 0 ? Math.min(...bodyEndCandidates) : source.length;
  const classBody = source.slice(bodyStart, bodyEnd);
  if (/\n\s+metadata\s*:\s*/u.test(`\n${classBody}`)) {
    return { repaired: false };
  }

  const metadataLine = "    metadata: Dict[str, Any] = field(default_factory=dict)\n";
  let nextBody: string;
  if (/\n\s+comparison_contract\s*:\s*/u.test(`\n${classBody}`)) {
    nextBody = classBody.replace(/\n(\s+comparison_contract\s*:)/u, `\n${metadataLine}$1`);
  } else {
    nextBody = `${classBody}${metadataLine}`;
  }

  const nextSource = `${source.slice(0, bodyStart)}${nextBody}${source.slice(bodyEnd)}`;
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added an ExperimentConfig.metadata compatibility field to ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonRecipeSpecPeftTypeSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!source.includes("class RecipeSpec:") || !/\n\s+peft_type\s*:/u.test(source)) {
    return { repaired: false };
  }
  if (!/\ndef\s+make_recipe_spec\s*\(/u.test(`\n${source}`)) {
    return { repaired: false };
  }
  if (/\n\s+peft_type\s*=\s*peft_method\s*,/u.test(source)) {
    return { repaired: false };
  }

  const adapterAliasPattern = /\n(\s+adapter_type\s*=\s*peft_method\s*,)/u;
  const methodAliasPattern = /\n(\s+peft_method\s*=\s*peft_method\s*,)/u;
  let nextSource: string;
  if (adapterAliasPattern.test(source)) {
    nextSource = source.replace(adapterAliasPattern, "\n$1\n        peft_type=peft_method,");
  } else if (methodAliasPattern.test(source)) {
    nextSource = source.replace(methodAliasPattern, "\n$1\n        peft_type=peft_method,");
  } else {
    return { repaired: false };
  }

  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added a RecipeSpec.peft_type compatibility alias to ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonMissingPeftRecipeSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (pythonSourceDefinesOrImportsName(source, "PEFTRecipe")) {
    return { repaired: false };
  }
  if (!/\bPEFTRecipe\b/u.test(source) || !/\bPEFTRecipe\s*\(\s*\*\*init_kwargs\s*\)/u.test(source)) {
    return { repaired: false };
  }
  if (!/\bdataclasses\.fields\s*\(\s*PEFTRecipe\s*\)/u.test(source)) {
    return { repaired: false };
  }
  if (!source.includes("@dataclass") || !source.includes("from dataclasses import")) {
    return { repaired: false };
  }

  const insertionAnchor = source.match(/\ndef\s+_make_recipe\s*\(/u);
  const insertionIndex = insertionAnchor?.index;
  if (insertionIndex === undefined || insertionIndex < 0) {
    return { repaired: false };
  }

  const compatibilityClass = [
    "",
    "@dataclass(frozen=True)",
    "class PEFTRecipe:",
    "    recipe_id: str",
    "    display_name: str",
    "    peft_type: str",
    "    rank: Optional[int] = None",
    "    alpha: Optional[int] = None",
    "    dropout: float = 0.0",
    "    target_modules: Tuple[str, ...] = field(default_factory=tuple)",
    "    train_steps: int = 0",
    "    learning_rate: float = 0.0",
    "    batch_size: int = 1",
    "    gradient_accumulation_steps: int = 1",
    "    extra: Dict[str, Any] = field(default_factory=dict)",
    "",
    "    @property",
    "    def name(self) -> str:",
    "        return self.recipe_id",
    "",
    "    @property",
    "    def method(self) -> str:",
    "        return self.peft_type",
    "",
    "    @property",
    "    def r(self) -> Optional[int]:",
    "        return self.rank",
    "",
    "    @property",
    "    def lora_alpha(self) -> Optional[int]:",
    "        return self.alpha",
    "",
    "    @property",
    "    def lora_dropout(self) -> float:",
    "        return self.dropout",
    "",
    "    @property",
    "    def peft_kwargs(self) -> Dict[str, Any]:",
    "        return dict(self.extra)",
    ""
  ].join("\n");

  const nextSource = `${source.slice(0, insertionIndex)}${compatibilityClass}${source.slice(insertionIndex)}`;
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added a PEFTRecipe compatibility dataclass to ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonRecipeSpecAdapterTypeSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }
  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }
  if (!source.includes("class RecipeSpec:") || !/\n\s+adapter_type\s*:/u.test(source)) {
    return { repaired: false };
  }
  if (/\n\s+adapter_type\s*=\s*peft_method\s*,/u.test(source) || /["']adapter_type["']\s*:/u.test(source)) {
    return { repaired: false };
  }

  let nextSource = source;
  const methodAliasPattern = /\n(\s+peft_method\s*=\s*peft_method\s*,)/u;
  if (methodAliasPattern.test(nextSource)) {
    nextSource = nextSource.replace(methodAliasPattern, "\n$1\n        adapter_type=peft_method,");
  } else {
    const peftTypeAliasPattern = /\n(\s+peft_type\s*=\s*peft_method\s*,)/u;
    if (peftTypeAliasPattern.test(nextSource)) {
      nextSource = nextSource.replace(peftTypeAliasPattern, "\n$1\n        adapter_type=peft_method,");
    }
  }

  if (nextSource === source) {
    const aliasDictPattern = /\n(\s+["']task_type["']\s*:\s*PEFT_TASK_TYPE\s*,)/u;
    if (aliasDictPattern.test(nextSource)) {
      nextSource = nextSource.replace(aliasDictPattern, "\n        \"adapter_type\": \"lora\",\n$1");
    }
  }

  if (nextSource === source) {
    return { repaired: false };
  }
  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added a RecipeSpec.adapter_type compatibility alias to ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonRecipeSpecNameSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!source.includes("class RecipeSpec:") || !/\.name\b/u.test(source)) {
    return { repaired: false };
  }

  const classStart = source.indexOf("class RecipeSpec:\n");
  if (classStart < 0) {
    return { repaired: false };
  }
  const bodyStart = classStart + "class RecipeSpec:\n".length;
  const bodyEnd = findPythonClassBodyEnd(source, bodyStart);
  const classBody = source.slice(bodyStart, bodyEnd);
  if (/\n\s+name\s*:/u.test(`\n${classBody}`) || /\n\s+def\s+name\s*\(/u.test(`\n${classBody}`)) {
    return { repaired: false };
  }

  const returnCandidates = ["recipe_id", "display_name", "recipe_type", "peft_type"];
  const returnField = returnCandidates.find((field) => new RegExp(`\\n\\s+${escapeRegex(field)}\\s*:`, "u").test(`\n${classBody}`));
  if (!returnField) {
    return { repaired: false };
  }

  const propertyBlock = [
    "",
    "    @property",
    "    def name(self) -> str:",
    `        return str(self.${returnField})`,
    ""
  ].join("\n");
  const nextSource = `${source.slice(0, bodyEnd)}${propertyBlock}${source.slice(bodyEnd)}`;
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added a RecipeSpec.name compatibility property to ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonObjectRecipeSubscriptSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!/\bPEFT_RECIPES\b/u.test(source) || !/\brecipe\s*\[\s*["'][A-Za-z_][A-Za-z0-9_]*["']\s*\]/u.test(source)) {
    return { repaired: false };
  }

  const registryMatch = source.match(
    /\bPEFT_RECIPES\b\s*(?::[^\n=]+)?=\s*(?:\(|\[)\s*([A-Z][A-Za-z0-9_]*(?:Recipe|Spec))\s*\(/u
  );
  const className = registryMatch?.[1];
  if (!className || !source.includes(`class ${className}:`)) {
    return { repaired: false };
  }

  const classStart = source.indexOf(`class ${className}:\n`);
  if (classStart < 0) {
    return { repaired: false };
  }
  const bodyStart = classStart + `class ${className}:\n`.length;
  const bodyEnd = findPythonClassBodyEnd(source, bodyStart);
  const classBody = source.slice(bodyStart, bodyEnd);
  if (/\n\s+def\s+__getitem__\s*\(/u.test(`\n${classBody}`)) {
    return { repaired: false };
  }

  const helper = [
    "",
    "    def __getitem__(self, key):",
    "        return getattr(self, key)",
    ""
  ].join("\n");
  const nextSource = `${source.slice(0, bodyEnd)}${helper}${source.slice(bodyEnd)}`;
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added ${className}.__getitem__ compatibility for dict-style recipe access in ${path.basename(scriptPath)} before handoff.`
  };
}

async function repairPythonEntrypointTypeErrorFallbackSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  const unsafeFallbackPattern = /(\n[ \t]*)try:\n([ \t]*)payload\s*=\s*orchestrator\(args\)\n[ \t]*except\s+TypeError:\n[ \t]*payload\s*=\s*orchestrator\(\)[ \t]*(?:#.*)?/u;
  if (!unsafeFallbackPattern.test(source)) {
    return { repaired: false };
  }

  const nextSource = source.replace(
    unsafeFallbackPattern,
    (_match, outerIndentWithNewline: string) => {
      const outerIndent = outerIndentWithNewline.replace(/^\n/u, "");
      return [
      "",
      `${outerIndent}import inspect as _autolabos_entrypoint_inspect`,
      `${outerIndent}_signature = _autolabos_entrypoint_inspect.signature(orchestrator)`,
      `${outerIndent}_required_positional = [`,
      `${outerIndent}    parameter`,
      `${outerIndent}    for parameter in _signature.parameters.values()`,
      `${outerIndent}    if parameter.default is _autolabos_entrypoint_inspect.Parameter.empty`,
      `${outerIndent}    and parameter.kind in (`,
      `${outerIndent}        _autolabos_entrypoint_inspect.Parameter.POSITIONAL_ONLY,`,
      `${outerIndent}        _autolabos_entrypoint_inspect.Parameter.POSITIONAL_OR_KEYWORD,`,
      `${outerIndent}    )`,
      `${outerIndent}]`,
      `${outerIndent}if len(_required_positional) == 0:`,
      `${outerIndent}    payload = orchestrator()`,
      `${outerIndent}else:`,
      `${outerIndent}    payload = orchestrator(args)`,
      ""
      ].join("\n");
    }
  );
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Replaced broad entrypoint TypeError fallback in ${path.basename(scriptPath)} with signature-aware orchestration dispatch before handoff.`
  };
}

function findPythonClassBodyEnd(source: string, bodyStart: number): number {
  const tail = source.slice(bodyStart);
  let offset = 0;
  for (const line of tail.split(/(?<=\n)/u)) {
    if (line.trim().length > 0 && !/^\s/u.test(line)) {
      return bodyStart + offset;
    }
    offset += line.length;
  }
  return source.length;
}

async function repairPythonOrchestrationCandidateSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!source.includes("def _invoke_experiment_orchestration(") || !source.includes("candidate_names")) {
    return { repaired: false };
  }

  const safeDefinedEntrypoints = [
    "execute_locked_recipe_plan",
    "orchestrate_locked_recipe_plan",
    "run_locked_recipe_plan"
  ].filter((name) => new RegExp(`\\ndef\\s+${escapeRegex(name)}\\s*\\(`, "u").test(`\n${source}`));

  const missingEntrypoints = safeDefinedEntrypoints.filter((name) => !source.includes(`"${name}"`) && !source.includes(`'${name}'`));
  if (missingEntrypoints.length === 0) {
    return { repaired: false };
  }

  const candidateListPattern = /(\bcandidate_names\s*=\s*\[\s*\n)/u;
  if (!candidateListPattern.test(source)) {
    return { repaired: false };
  }

  const insertedLines = missingEntrypoints.map((name) => `        "${name}",`).join("\n");
  const nextSource = source.replace(candidateListPattern, `$1${insertedLines}\n`);
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added orchestration candidate(s) ${missingEntrypoints.join(", ")} to ${path.basename(
      scriptPath
    )} before handoff.`
  };
}

async function repairPythonBaselineFirstExecutionCandidateSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (
    !source.includes("def _invoke_baseline_first_execution(") ||
    !source.includes("No baseline-first execution helper was found")
  ) {
    return { repaired: false };
  }

  const safeDefinedEntrypoints = [
    "run_baseline_first_execution",
    "execute_baseline_first_execution",
    "run_baseline_first_workflow",
    "execute_baseline_first_workflow",
    "run_baseline_first_recipe_execution",
    "execute_baseline_first_recipe_execution",
    "run_ordered_recipe_evaluations",
    "execute_ordered_recipe_evaluations"
  ].filter((name) => new RegExp(`\\ndef\\s+${escapeRegex(name)}\\s*\\(`, "u").test(`\n${source}`));

  const missingEntrypoints = safeDefinedEntrypoints.filter((name) => !source.includes(`"${name}"`) && !source.includes(`'${name}'`));
  if (missingEntrypoints.length === 0) {
    return { repaired: false };
  }

  const invokerPattern = /(def\s+_invoke_baseline_first_execution\s*\([^)]*\)\s*(?:->\s*[^:\n]+)?\s*:\n[\s\S]*?\bcandidate_names\s*=\s*\(\s*\n)/u;
  if (!invokerPattern.test(source)) {
    return { repaired: false };
  }

  const insertedLines = missingEntrypoints.map((name) => `        "${name}",`).join("\n");
  const nextSource = source.replace(invokerPattern, `$1${insertedLines}\n`);
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Added baseline-first execution candidate(s) ${missingEntrypoints.join(", ")} to ${path.basename(
      scriptPath
    )} before handoff.`
  };
}

async function repairPythonBaselineFirstRecipeOrderSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!/COMPARISON_MODE\s*=\s*["']baseline_first_locked["']/u.test(source) && !/BASELINE_FIRST_REQUIRED\s*=\s*True/u.test(source)) {
    return { repaired: false };
  }
  if (!source.includes("def _candidate_sort_key(") || !source.includes("def _get_locked_recipe_sequence(")) {
    return { repaired: false };
  }
  if (!source.includes("Locked comparison contract requires the untuned reference candidate to run first.")) {
    return { repaired: false };
  }

  const sortKeyPattern =
    /def _candidate_sort_key\(recipe: Any\) -> Tuple\[int, str\]:\n(?:    .*\n)+?(?=\ndef _get_locked_recipe_sequence\()/u;
  const nextSortKey = [
    "def _candidate_sort_key(recipe: Any) -> Tuple[int, str]:",
    "    recipe_id = _recipe_identifier(recipe)",
    "    standard_id = _standard_lora_id().lower()",
    "    recipe_id_lower = recipe_id.lower()",
    "    if recipe_id_lower == standard_id or (\"standard\" in recipe_id_lower and \"lora\" in recipe_id_lower):",
    "        return (0, recipe_id)",
    "    if _recipe_is_reference(recipe):",
    "        return (1, recipe_id)",
    "    return (2, recipe_id)",
    ""
  ].join("\n");

  const sequenceValidationPattern =
    /    recipes = sorted\(recipes, key=_candidate_sort_key\)\n    if not _recipe_is_reference\(recipes\[0\]\):\n        raise RuntimeError\(\n            "Locked comparison contract requires the untuned reference candidate to run first\."\n        \)\n    if len\(recipes\) > 1:\n        second_id = _recipe_identifier\(recipes\[1\]\)\.lower\(\)\n        expected_lora = _standard_lora_id\(\)\.lower\(\)\n        if second_id != expected_lora and not \("standard" in second_id and "lora" in second_id\):\n            raise RuntimeError\(\n                "Locked comparison contract requires the standard LoRA tuned baseline to run immediately after the reference\."\n            \)\n    return recipes/u;
  const nextSequenceValidation = [
    "    recipes = sorted(recipes, key=_candidate_sort_key)",
    "    first_id = _recipe_identifier(recipes[0]).lower()",
    "    expected_lora = _standard_lora_id().lower()",
    "    if first_id != expected_lora and not (\"standard\" in first_id and \"lora\" in first_id):",
    "        raise RuntimeError(",
    "            \"Locked baseline-first contract requires the standard LoRA tuned baseline to run first.\"",
    "        )",
    "    if len(recipes) > 1 and not any(_recipe_is_reference(recipe) for recipe in recipes):",
    "        raise RuntimeError(",
    "            \"Locked baseline-first contract requires the untuned reference candidate to remain in the comparison.\"",
    "        )",
    "    return recipes"
  ].join("\n");

  let nextSource = source.replace(sortKeyPattern, nextSortKey);
  nextSource = nextSource.replace(sequenceValidationPattern, nextSequenceValidation);

  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Aligned baseline-first PEFT recipe ordering in ${path.basename(scriptPath)} before handoff.`
  };
}

export async function repairPythonLockedStandardLoraBaselineIdSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  const lockedComparison =
    /COMPARISON_MODE\s*=\s*["']baseline_first_locked["']/u.test(source) ||
    /BASELINE_FIRST_REQUIRED\s*=\s*True/u.test(source) ||
    /LOCKED_COMPARISON_CONTRACT/u.test(source);
  if (!lockedComparison) {
    return { repaired: false };
  }

  const standardIdMatch = source.match(/\bSTANDARD_LORA_BASELINE_ID\s*=\s*["']([^"']+)["']/u);
  const lockedIdMatch = source.match(/\bLOCKED_STANDARD_LORA_BASELINE_ID\s*=\s*["']([^"']+)["']/u);
  if (!standardIdMatch || !lockedIdMatch) {
    return { repaired: false };
  }

  const standardId = standardIdMatch[1];
  const lockedId = lockedIdMatch[1];
  if (!standardId || !lockedId || standardId === lockedId) {
    return { repaired: false };
  }

  const standardIdAppearsAsRecipe =
    new RegExp(`\\b(recipe_id|id|name)\\s*=\\s*["']${escapeRegex(standardId)}["']`, "u").test(source) ||
    new RegExp(`["']${escapeRegex(standardId)}["']`, "u").test(source);
  if (!standardIdAppearsAsRecipe || !/standard[_-]?lora/iu.test(standardId)) {
    return { repaired: false };
  }

  const lockedAssignmentPattern =
    /\bLOCKED_STANDARD_LORA_BASELINE_ID\s*=\s*["'][^"']+["']/u;
  const nextSource = source.replace(
    lockedAssignmentPattern,
    "LOCKED_STANDARD_LORA_BASELINE_ID = STANDARD_LORA_BASELINE_ID"
  );
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Aligned locked standard LoRA baseline id from ${lockedId} to ${standardId} in ${path.basename(
      scriptPath
    )} before handoff.`
  };
}

async function detectPythonBaselineFirstTunedBaselineMismatch(scriptPath?: string): Promise<string | undefined> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return undefined;
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return undefined;
  }

  const lockedComparison =
    /COMPARISON_MODE\s*=\s*["']baseline_first_locked["']/u.test(source) ||
    /BASELINE_FIRST_REQUIRED\s*=\s*True/u.test(source) ||
    /["']comparison_mode["']\s*:\s*["']baseline_first_locked["']/u.test(source) ||
    /["']baseline_first_required["']\s*:\s*True/u.test(source);
  if (!lockedComparison) {
    return undefined;
  }

  const hasUntunedPrimaryBaseline =
    /\bRecipe\s*\(\s*name\s*=\s*["']baseline_no_tuning["'][\s\S]{0,180}\bkind\s*=\s*["']baseline["']/u.test(source) ||
    /\bbaseline\s*=\s*next\s*\([\s\S]{0,400}\.recipe\s*==\s*["']baseline_no_tuning["']/u.test(source) ||
    /\bbaseline_mean_[A-Za-z0-9_]*\s*=\s*baseline\./u.test(source);
  const hasTunedLoraCandidate = /\blora_r(?:8|16|32)\b/u.test(source) || /standard[_-]?lora/iu.test(source);
  if (!hasUntunedPrimaryBaseline || !hasTunedLoraCandidate) {
    return undefined;
  }

  return [
    "Generated baseline_first_locked PEFT runner treats the untuned/no-tuning reference as the primary baseline.",
    "The governed experiment contract requires the tuned standard LoRA baseline to be the primary comparator; untuned/no-tuning may be retained only as a reference row.",
    "Revise the runner so baseline metrics and delta/objective comparisons are computed against the named tuned LoRA baseline, not baseline_no_tuning."
  ].join(" ");
}

async function repairPythonTransformersSetSeedAliasSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  let nextSource: string | undefined;
  const needsSetSeedAlias = /\bset_seed\s*\(/u.test(source) && !/\n\s*set_seed\s*=/u.test(source);
  if (needsSetSeedAlias) {
    if (/\btransformers_set_seed\b/u.test(source)) {
      const aliasInsertionPattern = /(\n\s*transformers_set_seed\s*=\s*None[^\n]*\n[\s\S]*?_record_optional_dependency\(\s*\n\s*OPTIONAL_DEPENDENCIES,\s*\n\s*["']transformers["'],[\s\S]*?\n\s*\)\s*\n)(\ntry:)/u;
      if (aliasInsertionPattern.test(source)) {
        nextSource = source.replace(aliasInsertionPattern, "$1\nset_seed = transformers_set_seed  # compatibility alias for generated seed helpers\n$2");
      } else {
        const seedHelperMatch = source.match(/\ndef\s+seed_everything\s*\(/u);
        if (seedHelperMatch?.index != null) {
          nextSource = `${source.slice(0, seedHelperMatch.index)}\nset_seed = transformers_set_seed  # compatibility alias for generated seed helpers\n${source.slice(seedHelperMatch.index)}`;
        }
      }
    } else {
      const seedHelperMatch = source.match(/\ndef\s+seed_everything\s*\(/u);
      if (seedHelperMatch?.index != null) {
        const shim = [
          "",
          "try:",
          "    from transformers import set_seed",
          "except Exception:",
          "    set_seed = None",
          ""
        ].join("\n");
        nextSource = `${source.slice(0, seedHelperMatch.index)}${shim}${source.slice(seedHelperMatch.index)}`;
      }
    }
  }

  let sourceAfterSeedAliasRepair = nextSource || source;
  for (const aliasName of ["set_global_seed", "set_all_seeds"]) {
    const needsSeedAlias =
      new RegExp(`\\b${escapeRegex(aliasName)}\\s*\\(`, "u").test(sourceAfterSeedAliasRepair) &&
      !new RegExp(`^\\s*def\\s+${escapeRegex(aliasName)}\\s*\\(`, "mu").test(sourceAfterSeedAliasRepair) &&
      !new RegExp(`^\\s*${escapeRegex(aliasName)}\\s*=`, "mu").test(sourceAfterSeedAliasRepair);
    if (!needsSeedAlias) {
      continue;
    }
    const hasSeedFallback =
      /\bdef\s+seed_everything\s*\(/u.test(sourceAfterSeedAliasRepair) ||
      /\bdef\s+set_reproducibility_seed\s*\(/u.test(sourceAfterSeedAliasRepair) ||
      /\bdef\s+set_global_seed\s*\(/u.test(sourceAfterSeedAliasRepair) ||
      /\btransformers_set_seed\b/u.test(sourceAfterSeedAliasRepair) ||
      /\bhf_set_seed\b/u.test(sourceAfterSeedAliasRepair) ||
      /\bset_seed\s*=/u.test(sourceAfterSeedAliasRepair);
    if (hasSeedFallback) {
      const shim = [
        "",
        `def ${aliasName}(seed: int) -> None:`,
        `    seed_helper = globals().get("${aliasName === "set_all_seeds" ? "set_global_seed" : "seed_everything"}") or globals().get("seed_everything") or globals().get("set_reproducibility_seed")`,
        "    if seed_helper is not None:",
        "        seed_helper(seed)",
        "        return",
        "    transformers_seed = globals().get(\"transformers_set_seed\") or globals().get(\"hf_set_seed\") or globals().get(\"set_seed\")",
        "    if transformers_seed is not None:",
        "        transformers_seed(seed)",
        ""
      ].join("\n");
      const insertionMatch =
        sourceAfterSeedAliasRepair.match(/\ndef\s+main\s*\(/u) ||
        sourceAfterSeedAliasRepair.match(/\ndef\s+run_and_write_metrics\s*\(/u) ||
        sourceAfterSeedAliasRepair.match(/\nif\s+__name__\s*==\s*["']__main__["']/u);
      if (insertionMatch?.index != null) {
        nextSource = `${sourceAfterSeedAliasRepair.slice(0, insertionMatch.index)}${shim}${sourceAfterSeedAliasRepair.slice(insertionMatch.index)}`;
        sourceAfterSeedAliasRepair = nextSource;
      }
    }
  }

  if (!nextSource || nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Aligned generated seed helper compatibility in ${path.basename(scriptPath)} before handoff.`
  };
}

function wrapPythonJsonFirstArgumentWithAutolabosSafe(line: string): string {
  const callMatch = line.match(/\bjson\.dumps?\s*\(/u);
  if (!callMatch || callMatch.index == null) {
    return line;
  }

  const openParenIndex = line.indexOf("(", callMatch.index);
  if (openParenIndex < 0) {
    return line;
  }

  let cursor = openParenIndex + 1;
  while (cursor < line.length && /\s/u.test(line[cursor])) {
    cursor += 1;
  }
  if (line.slice(cursor).startsWith("_autolabos_json_safe(")) {
    return line;
  }

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: "'" | "\"" | undefined;
  let escaped = false;
  let firstArgumentEnd = -1;

  for (let index = cursor; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        firstArgumentEnd = index;
        break;
      }
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      firstArgumentEnd = index;
      break;
    }
  }

  if (firstArgumentEnd <= cursor) {
    return line;
  }

  const firstArgument = line.slice(cursor, firstArgumentEnd).trim();
  if (!firstArgument || firstArgument.startsWith("_autolabos_json_safe(")) {
    return line;
  }

  return `${line.slice(0, cursor)}_autolabos_json_safe(${line.slice(cursor, firstArgumentEnd)})${line.slice(firstArgumentEnd)}`;
}

async function repairPythonStrictJsonMetricsSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (!/\bjson\.dumps?\s*\(/u.test(source)) {
    return { repaired: false };
  }

  let nextSource = source;
  if (!/\ndef\s+_autolabos_json_safe\s*\(/u.test(nextSource)) {
    const helper = [
      "",
      "def _autolabos_json_safe(value):",
      "    if isinstance(value, dict):",
      "        return {str(key): _autolabos_json_safe(item) for key, item in value.items()}",
      "    if isinstance(value, (list, tuple)):",
      "        return [_autolabos_json_safe(item) for item in value]",
      "    if hasattr(value, '__fspath__'):",
      "        return str(value)",
      "    module_name = value.__class__.__module__",
      "    if isinstance(value, float) or module_name.startswith(('numpy', 'torch')):",
      "        try:",
      "            numeric = float(value)",
      "        except (TypeError, ValueError):",
      "            return None",
      "        if numeric != numeric or numeric in (float('inf'), float('-inf')):",
      "            return None",
      "        return numeric if module_name.startswith(('numpy', 'torch')) else value",
      "    return value",
      ""
    ].join("\n");
    const writeJsonMatch = nextSource.match(/\ndef\s+write_json\s*\(/u);
    const dumpMatch = nextSource.match(/\bjson\.dumps?\s*\(/u);
    const firstDumpIndex = dumpMatch?.index ?? -1;
    const precedingFunctionMatches =
      firstDumpIndex >= 0
        ? [...nextSource.slice(0, firstDumpIndex).matchAll(/\ndef\s+\w+\s*\(/gu)]
        : [];
    const enclosingFunctionIndex = precedingFunctionMatches.at(-1)?.index;
    const insertionIndex = writeJsonMatch?.index ?? enclosingFunctionIndex ?? (firstDumpIndex >= 0 ? firstDumpIndex : -1);
    if (insertionIndex < 0) {
      return { repaired: false };
    }
    nextSource = `${nextSource.slice(0, insertionIndex)}${helper}${nextSource.slice(insertionIndex)}`;
  }

  const lines = nextSource.split(/\r?\n/u);
  let changedDump = false;
  const repairedLines = lines.map((line) => {
    if (!/\bjson\.dumps?\s*\(/u.test(line)) {
      return line;
    }
    let repaired = wrapPythonJsonFirstArgumentWithAutolabosSafe(line);
    if (!/\ballow_nan\s*=/u.test(repaired) && /\bjson\.dump\s*\(/u.test(repaired) && /\)\s*$/u.test(repaired)) {
      repaired = repaired.replace(/\)\s*$/u, ", allow_nan=False)");
    }
    if (repaired !== line) {
      changedDump = true;
    }
    return repaired;
  });
  nextSource = repairedLines.join("\n");

  if (!changedDump || nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Made metrics JSON serialization strict and non-finite-safe in ${path.basename(scriptPath)} before handoff.`
  };
}

function extractPythonStringListAssignment(lines: string[], variableName: string): string[] | undefined {
  const escapedName = escapeRegex(variableName);
  const startPattern = new RegExp(`\\b${escapedName}\\s*=\\s*\\[`, "u");
  for (let index = 0; index < lines.length; index += 1) {
    if (!startPattern.test(lines[index])) {
      continue;
    }
    const collected: string[] = [];
    let bracketDepth = 0;
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      collected.push(line);
      bracketDepth += countOccurrences(line, "[") - countOccurrences(line, "]");
      if (bracketDepth <= 0) {
        const values = [...collected.join("\n").matchAll(/["']([^"'\\]+)["']/gu)].map((match) => match[1]);
        return values.length > 0 ? values : undefined;
      }
    }
  }
  return undefined;
}

function extractPythonDictWriterFieldnames(lines: string[]): string[] | undefined {
  const seen = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/\bcsv\.DictWriter\s*\([^)]*fieldnames\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/gu)) {
      const variableName = match[1];
      if (seen.has(variableName)) {
        continue;
      }
      seen.add(variableName);
      const values = extractPythonStringListAssignment(lines, variableName);
      if (values && values.length > 0) {
        return values;
      }
    }
  }
  return extractPythonStringListAssignment(lines, "fieldnames");
}

function extractConfigPathFromCommand(command?: string, cwd?: string): string | undefined {
  if (!command) {
    return undefined;
  }
  const match = command.match(/\s--config(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/u);
  const raw = match?.[1] || match?.[2] || match?.[3];
  if (!raw) {
    return undefined;
  }
  const candidate = raw.trim();
  if (!candidate) {
    return undefined;
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(cwd || process.cwd(), candidate);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstPresentRecordString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstPresentRecordNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function firstPresentRecordBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function firstPresentStringArray(record: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const normalized = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }
  return undefined;
}

function normalizeLockedRecipeName(rawName: string, seenNames: Set<string>): string {
  const base = rawName.trim() || "recipe";
  if (!seenNames.has(base)) {
    seenNames.add(base);
    return base;
  }
  let suffix = 2;
  while (seenNames.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const next = `${base}_${suffix}`;
  seenNames.add(next);
  return next;
}

export function normalizeLockedPeftStudyConfigPayloadForCompatibility(
  rawPayload: unknown
): { repaired: boolean; payload?: Record<string, unknown>; message?: string } {
  if (!isPlainObject(rawPayload)) {
    return { repaired: false };
  }
  const payload: Record<string, unknown> = { ...rawPayload };
  const rawConditions = Array.isArray(payload.conditions) ? payload.conditions : undefined;
  if (!rawConditions || rawConditions.length === 0) {
    return { repaired: false, payload };
  }

  const loading = isPlainObject(payload.loading) ? payload.loading : undefined;
  const defaultQuantization =
    firstPresentRecordString(loading || {}, ["quantization", "quantization_mode"]) ||
    (firstPresentRecordBoolean(loading || {}, ["load_in_4bit", "use_quantization_for_tuned_runs"])
      ? "4bit"
      : undefined);

  const recipes: Array<Record<string, unknown>> = [];
  const seenNames = new Set<string>();
  let droppedBaseline = false;
  let changed = false;

  for (const item of rawConditions) {
    if (!isPlainObject(item)) {
      continue;
    }
    const isBaseline =
      firstPresentRecordBoolean(item, ["baseline", "is_baseline"]) === true ||
      ["baseline"].includes(
        (firstPresentRecordString(item, ["kind", "recipe_type", "type", "adapter_type"]) || "").toLowerCase()
      ) ||
      (firstPresentRecordBoolean(item, ["evaluate_only"]) === true &&
        firstPresentRecordBoolean(item, ["train"]) === false);
    if (isBaseline) {
      droppedBaseline = true;
      changed = true;
      continue;
    }
    const requestedAdapterType =
      firstPresentRecordString(item, ["adapter_type", "recipe_type", "type", "peft_method", "peft_type"]) ||
      (firstPresentRecordBoolean(item, ["use_dora"]) ? "dora" : undefined) ||
      "lora";
    const normalizedAdapterType =
      requestedAdapterType.toLowerCase() === "peft" ? "lora" : requestedAdapterType.toLowerCase();

    const recipe: Record<string, unknown> = {
      name: normalizeLockedRecipeName(
        firstPresentRecordString(item, ["name", "label", "id", "recipe_name", "condition_name"]) || "recipe",
        seenNames
      ),
      adapter_type: normalizedAdapterType,
      enabled: firstPresentRecordBoolean(item, ["enabled"]) ?? true
    };
    const r = firstPresentRecordNumber(item, ["r", "lora_r", "rank"]);
    if (r !== undefined) {
      recipe.r = r;
    }
    const alpha = firstPresentRecordNumber(item, ["lora_alpha", "alpha"]);
    if (alpha !== undefined) {
      recipe.lora_alpha = alpha;
    }
    const dropout = firstPresentRecordNumber(item, ["lora_dropout", "dropout"]);
    if (dropout !== undefined) {
      recipe.lora_dropout = dropout;
    }
    const targetModules = firstPresentStringArray(item, ["target_modules"]);
    if (targetModules && targetModules.length > 0) {
      recipe.target_modules = targetModules;
    }
    const quantization =
      firstPresentRecordString(item, ["quantization", "quantization_mode"]) || defaultQuantization;
    if (quantization) {
      recipe.quantization = quantization.toLowerCase();
    }
    if (normalizedAdapterType === "dora") {
      recipe.use_dora = true;
    }
    recipes.push(recipe);
    changed = true;
  }

  if (!changed || recipes.length === 0) {
    return { repaired: false, payload };
  }

  payload.recipes = recipes;
  delete payload.conditions;
  if (payload.require_baseline_first === undefined) {
    payload.require_baseline_first =
      firstPresentRecordBoolean(payload, ["baseline_first_required", "require_baseline_first"]) ?? true;
  }
  if (payload.study_name === undefined) {
    const derivedStudyName =
      firstPresentRecordString(payload, ["study_name", "experiment_name", "run_id"]) ||
      "qwen2_5_1_5b_peft_instruction_study";
    payload.study_name = derivedStudyName;
  }

  return {
    repaired: true,
    payload,
    message: droppedBaseline
      ? "Normalized locked PEFT config to recipes-only schema and removed the baseline entry before handoff."
      : "Normalized locked PEFT config to the recipes-only runtime schema before handoff."
  };
}

export async function repairLockedPeftStudyConfigSurface(configPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!configPath) {
    return { repaired: false };
  }

  const ext = path.extname(configPath).toLowerCase();
  if (![".yaml", ".yml", ".json"].includes(ext)) {
    return { repaired: false };
  }

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    return { repaired: false };
  }

  let parsed: unknown;
  try {
    parsed = ext === ".json" ? JSON.parse(raw) : YAML.parse(raw);
  } catch {
    return { repaired: false };
  }

  const normalized = normalizeLockedPeftStudyConfigPayloadForCompatibility(parsed);
  if (!normalized.repaired || !normalized.payload) {
    return { repaired: false };
  }

  const nextRaw =
    ext === ".json"
      ? `${JSON.stringify(normalized.payload, null, 2)}\n`
      : YAML.stringify(normalized.payload, { indent: 2 });
  if (nextRaw === raw) {
    return { repaired: false };
  }
  await fs.writeFile(configPath, nextRaw, "utf8");
  return {
    repaired: true,
    message: normalized.message || `Normalized ${path.basename(configPath)} to the locked-study runtime schema.`
  };
}

export async function repairPythonLockedConditionCountSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  const exactCheck =
    "    if len(resolved_conditions) != LOCKED_CONDITION_COUNT:\n" +
    "        raise ConfigError(\n" +
    "            f'The locked comparison requires exactly {LOCKED_CONDITION_COUNT} tuned conditions, '\n" +
    "            f'but resolved {len(resolved_conditions)}.'\n" +
    "        )";
  if (!source.includes(exactCheck)) {
    return { repaired: false };
  }

  const replacement =
    "    require_baseline_first = _bool_or(_cfg_get(config, 'require_baseline_first', 'baseline_first_required', default=True), True)\n" +
    "    expected_tuned_conditions = LOCKED_CONDITION_COUNT - (1 if require_baseline_first else 0)\n" +
    "    if len(resolved_conditions) != expected_tuned_conditions:\n" +
    "        raise ConfigError(\n" +
    "            f'The locked comparison requires exactly {expected_tuned_conditions} tuned conditions, '\n" +
    "            f'but resolved {len(resolved_conditions)}.'\n" +
    "        )";

  const nextSource = source.replace(exactCheck, replacement);
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Aligned locked-condition counting in ${path.basename(scriptPath)} with baseline-first PEFT studies before handoff.`
  };
}

export async function repairPythonConditionHelperSurface(scriptPath?: string): Promise<{
  repaired: boolean;
  message?: string;
}> {
  if (!scriptPath || path.extname(scriptPath) !== ".py") {
    return { repaired: false };
  }

  let source: string;
  try {
    source = await fs.readFile(scriptPath, "utf8");
  } catch {
    return { repaired: false };
  }

  if (source.includes("run_root=runs_dir") || !source.includes("def _execute_condition_via_helper(")) {
    return { repaired: false };
  }

  const needle =
    "        public_dir=public_dir,\n" +
    "        output_dir=run_dir,\n" +
    "        run_dir=run_dir,\n" +
    "        artifact_dir=run_dir,\n" +
    "        artifacts_dir=run_dir,\n" +
    "        timeout_sec=timeout_sec,\n";
  if (!source.includes(needle)) {
    return { repaired: false };
  }

  const replacement =
    "        public_dir=public_dir,\n" +
    "        output_dir=run_dir,\n" +
    "        run_dir=run_dir,\n" +
    "        run_root=runs_dir,\n" +
    "        artifact_dir=run_dir,\n" +
    "        artifacts_dir=run_dir,\n" +
    "        deadline_monotonic=(time.monotonic() + float(timeout_sec) if timeout_sec is not None else None),\n" +
    "        timeout_sec=timeout_sec,\n";

  const nextSource = source.replace(needle, replacement);
  if (nextSource === source) {
    return { repaired: false };
  }

  await fs.writeFile(scriptPath, nextSource, "utf8");
  return {
    repaired: true,
    message: `Aligned condition-helper invocation kwargs in ${path.basename(scriptPath)} before handoff.`
  };
}

function extractPythonCallExpression(
  lines: string[],
  startIndex: number
): { text: string; startLine: number } | undefined {
  const collected: string[] = [];
  let parenDepth = 0;
  let sawOpenParen = false;

  for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    collected.push(line);
    const opens = countOccurrences(line, "(");
    const closes = countOccurrences(line, ")");
    if (opens > 0) {
      sawOpenParen = true;
    }
    parenDepth += opens - closes;
    if (sawOpenParen && parenDepth <= 0) {
      return {
        text: collected.join("\n"),
        startLine: startIndex + 1
      };
    }
  }

  return sawOpenParen
    ? {
        text: collected.join("\n"),
        startLine: startIndex + 1
      }
    : undefined;
}

function findPythonDictKeyLine(
  lines: string[],
  variableName: string,
  keyName: string,
  beforeLine?: number
): number | undefined {
  const escapedName = escapeRegex(variableName);
  const startPattern = new RegExp(`\\b${escapedName}\\s*(?::[^=]+)?=\\s*\\{`, "u");
  const keyPattern = new RegExp(`["']${escapeRegex(keyName)}["']\\s*:`, "u");
  const assignmentPattern = new RegExp(`\\b${escapedName}\\s*\\[\\s*["']${escapeRegex(keyName)}["']\\s*\\]\\s*=`, "u");
  const lineLimit = beforeLine ? Math.min(beforeLine - 1, lines.length) : lines.length;

  for (let index = 0; index < lineLimit; index += 1) {
    if (assignmentPattern.test(lines[index])) {
      return index + 1;
    }
  }

  for (let index = 0; index < lineLimit; index += 1) {
    if (!startPattern.test(lines[index])) {
      continue;
    }
    let braceDepth = 0;
    for (let cursor = index; cursor < lineLimit; cursor += 1) {
      const line = lines[cursor];
      braceDepth += countOccurrences(line, "{") - countOccurrences(line, "}");
      if (keyPattern.test(line)) {
        return cursor + 1;
      }
      if (braceDepth <= 0) {
        break;
      }
    }
  }

  return undefined;
}

function removePythonDictKeysBeforeLine(
  lines: string[],
  variableName: string,
  keyNames: string[],
  beforeLine?: number
): boolean {
  const escapedName = escapeRegex(variableName);
  const keyAlternation = keyNames.map((name) => escapeRegex(name)).join("|");
  const startPattern = new RegExp(`\\b${escapedName}\\s*(?::[^=]+)?=\\s*\\{`, "u");
  const keyPattern = new RegExp(`["'](?:${keyAlternation})["']\\s*:`, "u");
  const assignmentPattern = new RegExp(
    `\\b${escapedName}\\s*\\[\\s*["'](?:${keyAlternation})["']\\s*\\]\\s*=`,
    "u"
  );
  const lineLimit = beforeLine ? Math.min(beforeLine - 1, lines.length) : lines.length;
  const removeLine = (index: number): boolean => {
    if (index < 0 || index >= lines.length || lines[index] === "") {
      return false;
    }
    lines[index] = "";
    return true;
  };

  let changed = false;
  for (let index = 0; index < lineLimit; index += 1) {
    if (assignmentPattern.test(lines[index])) {
      changed = removeLine(index) || changed;
    }
  }

  for (let index = 0; index < lineLimit; index += 1) {
    if (!startPattern.test(lines[index])) {
      continue;
    }
    let braceDepth = 0;
    for (let cursor = index; cursor < lineLimit; cursor += 1) {
      const line = lines[cursor];
      braceDepth += countOccurrences(line, "{") - countOccurrences(line, "}");
      if (keyPattern.test(line)) {
        changed = removeLine(cursor) || changed;
      }
      if (braceDepth <= 0) {
        break;
      }
    }
  }

  return changed;
}

function countOccurrences(text: string, token: string): number {
  return [...text].filter((char) => char === token).length;
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

function formatEnvironmentSnapshotBlock(snapshot?: EnvironmentSnapshot): string[] {
  return [
    "## Execution Environment",
    `- Python: ${snapshot?.python_version || "not found"}`,
    `- GPU: ${snapshot?.gpu_available === true ? "available" : "not available"}`,
    `- Disk: ${snapshot?.available_disk_mb != null ? `${snapshot.available_disk_mb} MB free` : "unknown"}`,
    `- Working dir: ${snapshot?.working_directory || process.cwd()}`,
    ""
  ];
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function hasStructuredLlmClient(
  llm: { complete?: unknown } | undefined
): llm is { complete: (...args: unknown[]) => Promise<unknown> } {
  return typeof llm?.complete === "function";
}
