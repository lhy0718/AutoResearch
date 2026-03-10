import path from "node:path";
import { promises as fs } from "node:fs";

import { EventStream } from "../events.js";
import { RunStore } from "../runs/runStore.js";
import { AppConfig, RunRecord } from "../../types.js";
import { CodexCliClient, CodexEvent } from "../../integrations/codex/codexCliClient.js";
import { mapCodexEventToAutoLabOSEvents } from "../../integrations/codex/codexEventMapper.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { EpisodeMemory, EpisodeRecord } from "../memory/episodeMemory.js";
import { LongTermEntry, LongTermStore } from "../memory/longTermStore.js";
import { ensureDir, fileExists, writeJsonFile } from "../../utils/fs.js";
import { safeRead } from "../nodes/helpers.js";
import { buildPublicExperimentDir } from "../publicArtifacts.js";
import { resolveExperimentLlmProfile } from "../experimentLlmProfile.js";
import { supportsRealExecutionBundle, writeRealExecutionBundle } from "../experiments/realExecutionBundle.js";
import { RunVerifierReport } from "../experiments/runVerifierFeedback.js";
import { AgentComputerInterface, AciObservation } from "../../tools/aci.js";
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
    resolved_constraint_profile?: CachedConstraintProfile["profile"];
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
}

interface PreparedImplementAttempt {
  threadId?: string;
  branchPlan: BranchPlan;
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
    const rawEvents: CodexEvent[] = [];
    await ensureDir(defaultPublicDir);
    const longTermMemory = await loadImplementationLongTermMemory(longTermStore, run);
    const taskSpec = await this.buildTaskSpec(
      run,
      runDir,
      defaultPublicDir,
      metricsPath,
      runContext,
      longTermMemory
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
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: `Loaded ${longTermMemory.retrieved.length} long-term implementation hint(s).`
        }
      });
    }
    if (taskSpec.context.runner_feedback) {
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: `Loaded runner feedback from run_experiments: ${taskSpec.context.runner_feedback.summary}`
        }
      });
    }

    let activeThreadId = currentThreadId;
    let finalAttempt: PreparedImplementAttempt | undefined;
    const attemptRecords: AttemptRecord[] = [];
    let latestSearchLocalization: LocalizationResult | undefined;
    let recentReflections = await episodeMemory.recent(run.id, "implement_experiments", 3);

    for (let attempt = 1; attempt <= MAX_IMPLEMENT_ATTEMPTS; attempt += 1) {
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: `Implementation attempt ${attempt}/${MAX_IMPLEMENT_ATTEMPTS} started.`
        }
      });

      const searchLocalization = await this.localizer.localize(
        this.buildLocalizerInput(taskSpec, attemptRecords.at(-1), [...changedFiles])
      );
      latestSearchLocalization = searchLocalization;
      const branchPlan = chooseBranchPlan(searchLocalization, attemptRecords, [...changedFiles]);

      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: `Search-backed localization: ${formatLocalizationSummary(searchLocalization)}`
        }
      });
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: `Branch focus ${branchPlan.branch_id}: ${branchPlan.focus_files.join(", ") || "(no explicit file focus)"}`
        }
      });

      const streamProgress = createCodexProgressEmitter((text) => {
        this.deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "implement_experiments",
          agentRole: "implementer",
          payload: {
            text
          }
        });
      });

      const result = await this.deps.codex.runTurnStream({
        prompt: this.buildAttemptPrompt({
          taskSpec,
          searchLocalization,
          branchPlan,
          recentReflections,
          attempt,
          previousAttempt: attemptRecords.at(-1),
          existingChangedFiles: [...changedFiles]
        }),
        threadId: activeThreadId,
        agentId: `implementer:${run.id}`,
        systemPrompt: this.buildSystemPrompt(runDir, defaultPublicDir, metricsPath, experimentLlmProfile),
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        workingDirectory: this.deps.workspaceRoot,
        abortSignal,
        onEvent: (event) => {
          rawEvents.push(event);
          streamProgress.onEvent(event);
          const mapped = mapCodexEventToAutoLabOSEvents({
            event,
            runId: run.id,
            node: "implement_experiments",
            agentRole: "implementer",
            workspaceRoot: this.deps.workspaceRoot
          });
          for (const item of mapped) {
            this.deps.eventStream.emit(item);
            const fileValue = typeof item.payload.file === "string" ? item.payload.file : undefined;
            if (fileValue) {
              changedFiles.add(fileValue);
              artifacts.add(fileValue);
            }
          }
        }
      });
      streamProgress.flush();

      activeThreadId = result.threadId || activeThreadId;
      const prepared = await this.prepareAttemptResult({
        run,
        runDir,
        defaultPublicDir,
        metricsPath,
        branchPlan,
        result,
        changedFiles,
        artifacts,
        publicArtifacts,
        experimentLlmProfile
      });
      prepared.localization = mergeLocalizationResults(
        searchLocalization,
        prepared.localization,
        inferLocalizationFromArtifacts({
          changedFiles: prepared.changedFiles,
          scriptPath: prepared.scriptPath,
          publicDir: prepared.publicDir
        })
      );

      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: formatLocalizationSummary(prepared.localization)
        }
      });

      const verifyReport = await this.verifyAttempt(prepared, abortSignal, run.id, attempt);
      prepared.verifyReport = verifyReport;
      finalAttempt = prepared;
      attemptRecords.push({
        attempt,
        summary: prepared.summary,
        branch_plan: branchPlan,
        localization: prepared.localization,
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
                prepared,
                searchLocalization
              })
            : undefined,
        changed_files: prepared.changedFiles,
        artifacts: prepared.artifacts,
        public_artifacts: prepared.publicArtifacts,
        raw_response: prepared.rawResponse
      });
      recentReflections = await episodeMemory.recent(run.id, "implement_experiments", 3);

      if (verifyReport.status !== "fail") {
        break;
      }

      if (verifyReport.next_action === "stop_for_environment" || verifyReport.next_action === "stop_for_policy") {
        break;
      }
    }

    if (!finalAttempt) {
      throw new Error("Codex implementation session did not return an implementation attempt.");
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
    const autoHandoffToRunExperiments = shouldAutoHandoffToRunExperiments(finalVerifyReport);
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
      this.deps.eventStream.emit({
        type: "OBS_RECEIVED",
        runId: run.id,
        node: "implement_experiments",
        agentRole: "implementer",
        payload: {
          text: `Saved long-term implementation lesson ${savedLongTermMemory.id}.`
        }
      });
    }

    await runContext.put("implement_experiments.thread_id", activeThreadId);
    await runContext.put("implement_experiments.task_spec", taskSpec);
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
    await runContext.put("implement_experiments.mode", finalAttempt.experimentMode);
    await runContext.put("implement_experiments.llm_profile", experimentLlmProfile);
    await runContext.put("implement_experiments.metrics_path", finalAttempt.metricsPath);
    await runContext.put("implement_experiments.script", publishedScriptPath);
    await runContext.put("implement_experiments.cwd", finalAttempt.workingDir);
    await runContext.put("implement_experiments.last_summary", summary);
    await runContext.put("implement_experiments.raw_response", finalAttempt.rawResponse);
    await runContext.put("implement_experiments.assumptions", finalAttempt.assumptions);

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
    return [
      "You are the AutoLabOS implementer role.",
      "Work directly in the workspace using Codex tools.",
      "Prefer concrete, runnable changes over prose.",
      "Do not modify git history or perform destructive cleanup.",
      `Private AutoLabOS run artifact directory: ${runDir}`,
      `Preferred public experiment directory: ${publicDir}`,
      `The experiment execution must produce JSON metrics at: ${metricsPath}`,
      `Configured real-execution LLM: provider=${experimentLlmProfile.provider}, model=${experimentLlmProfile.model}, reasoning=${experimentLlmProfile.reasoningEffort}, fast_mode=${experimentLlmProfile.fastMode ? "true" : "false"}`,
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
    const hypotheses = trimBlock(await safeRead(path.join(runDir, "hypotheses.jsonl")), 12_000);
    const previousSummary = await runContext.get<string>("implement_experiments.last_summary");
    const previousRunCommand = await runContext.get<string>("implement_experiments.run_command");
    const previousScript = await runContext.get<string>("implement_experiments.script");
    const runnerFeedback =
      (await runContext.get<RunVerifierReport>("implement_experiments.runner_feedback")) ||
      (await runContext.get<RunVerifierReport>("run_experiments.feedback_for_implementer"));
    const cachedConstraintProfile = await runContext.get<CachedConstraintProfile>("constraints.profile");
    const repoListing = await topLevelWorkspaceListing(this.deps.workspaceRoot);

    return {
      goal: `Implement a runnable experiment for "${run.topic}" and produce metrics for ${run.objectiveMetric}.`,
      acceptance_criteria: [
        "Return a runnable command for the experiment.",
        `Ensure the workflow can write metrics JSON to ${metricsPath}.`,
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
        `required_metrics_path=${metricsPath}`
      ],
      workspace: {
        root: this.deps.workspaceRoot,
        run_dir: runDir,
        public_dir: publicDir,
        metrics_path: metricsPath
      },
      context: {
        topic: run.topic,
        objective_metric: run.objectiveMetric,
        plan_excerpt: plan || "(missing)",
        hypotheses_excerpt: hypotheses || "(missing)",
        repo_listing: repoListing,
        previous_summary: previousSummary,
        previous_run_command: previousRunCommand,
        previous_script: previousScript,
        long_term_memory: longTermMemory,
        runner_feedback: runnerFeedback,
        resolved_constraint_profile: cachedConstraintProfile?.profile
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
  }): string {
    const lines = [
      `Implementation attempt ${params.attempt}/${MAX_IMPLEMENT_ATTEMPTS}.`,
      "Task spec:",
      JSON.stringify(params.taskSpec, null, 2),
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
      "Reuse long-term implementation memory when it directly applies to the current branch focus."
    ];

    lines.push("", "Search-backed localization hints:", JSON.stringify(params.searchLocalization, null, 2));
    lines.push("", "Branch focus:", JSON.stringify(params.branchPlan, null, 2));
    if (params.taskSpec.context.long_term_memory.retrieved.length > 0) {
      lines.push(
        "",
        "Long-term implementation memory:",
        JSON.stringify(params.taskSpec.context.long_term_memory, null, 2)
      );
    }
    if (params.taskSpec.context.runner_feedback) {
      lines.push(
        "",
        "Runner feedback from run_experiments:",
        JSON.stringify(params.taskSpec.context.runner_feedback, null, 2)
      );
    }

    if (params.recentReflections.length > 0) {
      lines.push(
        "",
        "Recent failure reflections:",
        JSON.stringify(
          params.recentReflections.map((item) => ({
            attempt: item.attempt,
            error_class: item.error_class,
            lesson: item.lesson,
            next_try_instruction: item.next_try_instruction
          })),
          null,
          2
        )
      );
    }

    if (params.existingChangedFiles.length > 0) {
      lines.push("", "Files already changed in this workspace:", params.existingChangedFiles.join("\n"));
    }

    if (params.previousAttempt) {
      lines.push(
        "",
        "Previous local verification:",
        JSON.stringify(params.previousAttempt.verify_report, null, 2),
        "",
        "Previous localization:",
        JSON.stringify(params.previousAttempt.localization, null, 2),
        "",
        "Previous summary:",
        params.previousAttempt.summary
      );
      if (params.previousAttempt.verify_report.failure_type === "localization") {
        lines.push("Revisit which files you edit before making another patch.");
      } else if (params.previousAttempt.verify_report.failure_type === "implementation") {
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
    run: RunRecord;
    runDir: string;
    defaultPublicDir: string;
    metricsPath: string;
    branchPlan: BranchPlan;
    result: { threadId?: string; finalText: string };
    changedFiles: Set<string>;
    artifacts: Set<string>;
    publicArtifacts: Set<string>;
    experimentLlmProfile: ReturnType<typeof resolveExperimentLlmProfile>;
  }): Promise<PreparedImplementAttempt> {
    const parsed = parseStructuredResponse(params.result.finalText);
    const normalizedPublicDir =
      normalizeStoredPath(parsed.public_dir, this.deps.workspaceRoot) || params.defaultPublicDir;
    const normalizedMetricsPath =
      normalizeStoredPath(parsed.metrics_path, this.deps.workspaceRoot) || params.metricsPath;
    let normalizedWorkingDir =
      normalizeStoredPath(parsed.working_dir, this.deps.workspaceRoot) || normalizedPublicDir;
    const originalScriptPath =
      normalizeStoredPath(parsed.script_path, this.deps.workspaceRoot) ||
      (await inferScriptPath(params.runDir, normalizedPublicDir, this.deps.workspaceRoot, parsed.run_command));
    let normalizedScriptPath = originalScriptPath;
    let experimentMode = normalizeExperimentMode(parsed.experiment_mode, parsed.summary);

    for (const filePath of parsed.changed_files || []) {
      const normalized = normalizeStoredPath(filePath, this.deps.workspaceRoot);
      if (normalized) {
        params.changedFiles.add(normalized);
        params.artifacts.add(normalized);
      }
    }
    for (const filePath of parsed.artifacts || []) {
      const normalized = normalizeStoredPath(filePath, this.deps.workspaceRoot);
      if (normalized) {
        params.artifacts.add(normalized);
      }
    }
    for (const filePath of parsed.public_artifacts || []) {
      const normalized = normalizeStoredPath(filePath, this.deps.workspaceRoot);
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
      parsed.run_command?.trim() || inferRunCommand(normalizedScriptPath, this.deps.workspaceRoot, params.run.id);
    let testCommand = parsed.test_command?.trim() || deriveFallbackTestCommand(normalizedScriptPath);
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

    const localization =
      normalizeLocalizationResult(parsed.localization, this.deps.workspaceRoot) ||
      emptyLocalizationResult();

    return {
      threadId: params.result.threadId,
      branchPlan: params.branchPlan,
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
      verifyReport: {
        status: "not_run",
        next_action: "handoff_to_run_experiments",
        summary: "Local verification has not run yet."
      }
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
    attemptNumber: number
  ): Promise<VerifyReport> {
    const command = attempt.testCommand?.trim() || deriveFallbackTestCommand(attempt.scriptPath);
    if (!command) {
      return {
        status: "not_run",
        next_action: "handoff_to_run_experiments",
        summary: "No lightweight local verification command was available."
      };
    }

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

    const obs = await this.deps.aci.runTests(command, attempt.workingDir, abortSignal);
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
      return baseReport;
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
    return baseReport;
  }
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

function parseStructuredResponse(text: string): StructuredImplementResponse {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  return {
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
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(workspaceRoot, filePath);
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

function isSubpath(filePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
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

function chooseBranchPlan(
  searchLocalization: LocalizationResult,
  attemptRecords: AttemptRecord[],
  changedFiles: string[]
): BranchPlan {
  const focusPool = dedupeStrings([
    ...searchLocalization.selected_files,
    ...searchLocalization.candidates.map((candidate) => candidate.path),
    ...changedFiles
  ]).filter(isLikelyBranchFocusFile);
  const triedPaths = new Set(
    attemptRecords.flatMap((record) => record.branch_plan.focus_files)
  );
  const primaryPool = focusPool.length > 0
    ? focusPool
    : dedupeStrings([
        ...searchLocalization.selected_files,
        ...searchLocalization.candidates.map((candidate) => candidate.path),
        ...changedFiles
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
  if (verifyReport.status === "fail") {
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
