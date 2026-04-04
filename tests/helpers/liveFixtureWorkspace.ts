import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ensureScaffold, resolveAppPaths, saveConfig } from "../../src/config.js";
import { buildReadinessRiskArtifact } from "../../src/core/readinessRisks.js";
import {
  RUN_COMPLETENESS_CHECKLIST_RELATIVE_PATH,
  buildRunCompletenessChecklist
} from "../../src/core/runs/runCompletenessChecklist.js";
import { RUN_STATUS_RELATIVE_PATH, buildRunOperatorStatus } from "../../src/core/runs/runStatus.js";
import {
  AppConfig,
  ExecutionApprovalMode,
  ExperimentNetworkPolicy,
  ExperimentNetworkPurpose,
  GraphNodeId,
  NodeState,
  NodeStatus,
  RunLifecycleStatus,
  RunRecord,
  RunStatus,
  RunValidationScope,
  WorkflowApprovalMode
} from "../../src/types.js";

const FIXED_NODE_ORDER: GraphNodeId[] = [
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "figure_audit",
  "review",
  "write_paper"
];

export interface LiveFixtureArtifactSpec {
  path: string;
  content: string | unknown;
}

export interface LiveFixtureWorkspaceOptions {
  workspaceRoot: string;
  runId: string;
  title?: string;
  topic?: string;
  constraints?: string[];
  objectiveMetric?: string;
  currentNode?: GraphNodeId;
  lifecycleStatus?: RunLifecycleStatus;
  runStatus?: RunStatus;
  approvalMode?: WorkflowApprovalMode;
  executionApprovalMode?: ExecutionApprovalMode;
  validationScope?: RunValidationScope;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
  includeConfig?: boolean;
  latestSummary?: string;
  nodeStatusOverrides?: Partial<Record<GraphNodeId, NodeStatus>>;
  artifacts?: LiveFixtureArtifactSpec[];
  now?: string;
  inheritTestEnv?: boolean;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonicalLiveValidationRoot = path.join(repoRoot, "test");
const canonicalLiveFixtureDir = path.join(canonicalLiveValidationRoot, ".live");

export async function createLiveFixtureWorkspaceRoot(prefix = "autolabos-live-fixture-"): Promise<string> {
  await mkdir(canonicalLiveFixtureDir, { recursive: true });
  return mkdtemp(path.join(canonicalLiveFixtureDir, prefix));
}

export async function writeLiveFixtureWorkspace(
  options: LiveFixtureWorkspaceOptions
): Promise<{
  paths: ReturnType<typeof resolveAppPaths>;
  runDir: string;
  run: RunRecord;
}> {
  const now = options.now || new Date().toISOString();
  assertLiveFixtureWorkspaceRoot(options.workspaceRoot, options.validationScope || "live_fixture");
  const paths = resolveAppPaths(options.workspaceRoot);
  await ensureScaffold(paths);
  if (options.inheritTestEnv !== false) {
    await copyTestEnvIfPresent(options.workspaceRoot);
  }
  if (options.includeConfig) {
    await saveConfig(
      paths,
      buildMinimalFixtureConfig({
        approvalMode: options.approvalMode || "minimal",
        executionApprovalMode: options.executionApprovalMode || "manual",
        networkPolicy: options.networkPolicy,
        networkPurpose: options.networkPurpose
      })
    );
  }

  const currentNode = options.currentNode || "review";
  const lifecycleStatus = options.lifecycleStatus || "needs_approval";
  const run = buildLiveFixtureRunRecord({
    runId: options.runId,
    title: options.title || "Live fixture validation run",
    topic: options.topic || "Live fixture validation",
    constraints: options.constraints || ["fixture"],
    objectiveMetric: options.objectiveMetric || "operator clarity",
    currentNode,
    lifecycleStatus,
    runStatus: options.runStatus,
    latestSummary: options.latestSummary,
    nodeStatusOverrides: options.nodeStatusOverrides,
    now
  });

  const runs = await readRunsFile(paths.runsFile);
  const nextRuns = [...runs.filter((item) => item.id !== run.id), run];
  await writeJson(paths.runsFile, { version: 3, runs: nextRuns });

  const runDir = path.join(paths.runsDir, run.id);
  await mkdir(runDir, { recursive: true });
  await writeJson(path.join(runDir, "run_record.json"), run);

  for (const artifact of options.artifacts || []) {
    await writeArtifact(path.join(runDir, artifact.path), artifact.content);
  }

  const runStatus = await buildRunOperatorStatus({
    workspaceRoot: options.workspaceRoot,
    run,
    approvalMode: options.approvalMode || "minimal",
    networkPolicy: options.networkPolicy,
    networkPurpose: options.networkPurpose,
    validationScope: options.validationScope || "live_fixture",
    currentNode,
    lifecycleStatus
  });
  await writeJson(path.join(runDir, RUN_STATUS_RELATIVE_PATH), runStatus);

  const checklist = await buildRunCompletenessChecklist({
    workspaceRoot: options.workspaceRoot,
    run,
    currentNode,
    validationScope: options.validationScope || "live_fixture"
  });
  await writeJson(path.join(runDir, RUN_COMPLETENESS_CHECKLIST_RELATIVE_PATH), checklist);

  return {
    paths,
    runDir,
    run
  };
}

function assertLiveFixtureWorkspaceRoot(workspaceRoot: string, validationScope: RunValidationScope): void {
  if (validationScope !== "live_fixture") {
    return;
  }
  const relative = path.relative(canonicalLiveValidationRoot, workspaceRoot);
  const insideTestRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!insideTestRoot) {
    throw new Error(
      `live_fixture workspaces must live under ${canonicalLiveValidationRoot}; received ${workspaceRoot}`
    );
  }
}

async function copyTestEnvIfPresent(workspaceRoot: string): Promise<void> {
  if (path.resolve(workspaceRoot) === canonicalLiveValidationRoot) {
    return;
  }
  const testEnvPath = path.join(canonicalLiveValidationRoot, ".env");
  try {
    const envRaw = await readFile(testEnvPath, "utf8");
    const destination = path.join(workspaceRoot, ".env");
    await writeFile(destination, envRaw, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function buildMinimalLiveFixtureReviewArtifacts(
  now = new Date().toISOString(),
  runId = "fixture-run"
): LiveFixtureArtifactSpec[] {
  const readinessArtifact = buildReadinessRiskArtifact({
    paperReady: false,
    readinessState: "blocked_for_paper_scale",
    risks: [
      {
        risk_code: "review_minimum_gate_blocked_for_paper_scale",
        severity: "blocked",
        category: "paper_scale",
        status: "blocked",
        message: "Minimum gate checks remain incomplete, so the run stays blocked for paper scale.",
        triggered_by: ["minimum_gate"],
        affected_claim_ids: [],
        affected_citation_ids: [],
        recommended_action: "Resolve the missing review gate evidence before re-entering paper drafting.",
        recheck_condition: "The review minimum gate passes with paper-scale evidence."
      }
    ]
  });
  return [
    ...buildMinimalAnalyzeResultsPrerequisiteArtifacts(runId, now),
    {
      path: "review/minimum_gate.json",
      content: {
        passed: false,
        ceiling_type: "blocked_for_paper_scale",
        failed_checks: ["baseline_missing", "result_table_missing", "claim_evidence_missing"]
      }
    },
    {
      path: "review/paper_critique.json",
      content: {
        stage: "pre_draft_review",
        manuscript_type: "blocked_for_paper_scale",
        paper_readiness_state: "blocked_for_paper_scale",
        blocking_issues_count: 1,
        non_blocking_issues_count: 0
      }
    },
    {
      path: "review/readiness_risks.json",
      content: {
        ...readinessArtifact,
        generated_at: now
      }
    }
  ];
}

export function buildMinimalLiveFixturePaperArtifacts(
  now = new Date().toISOString(),
  runId = "fixture-run"
): LiveFixtureArtifactSpec[] {
  const readinessArtifact = buildReadinessRiskArtifact({
    paperReady: false,
    readinessState: "research_memo",
    risks: [
      {
        risk_code: "paper_post_draft_research_memo",
        severity: "blocked",
        category: "paper_scale",
        status: "blocked",
        message: "Post-draft critique downgraded the manuscript to research_memo.",
        triggered_by: ["paper_critique"],
        affected_claim_ids: [],
        affected_citation_ids: [],
        recommended_action: "Strengthen the evidence or lower the output genre explicitly before claiming paper readiness.",
        recheck_condition: "The post-draft critique upgrades the manuscript above research_memo."
      }
    ]
  });
  return [
    ...buildMinimalAnalyzeResultsPrerequisiteArtifacts(runId, now),
    {
      path: "paper/paper_readiness.json",
      content: {
        generated_at: now,
        paper_ready: false,
        readiness_state: "research_memo",
        reason: "paper_ready remains research_memo after post-draft critique."
      }
    },
    {
      path: "paper/readiness_risks.json",
      content: {
        ...readinessArtifact,
        generated_at: now
      }
    }
  ];
}

function buildMinimalAnalyzeResultsPrerequisiteArtifacts(runId: string, now: string): LiveFixtureArtifactSpec[] {
  return [
    {
      path: "experiment_portfolio.json",
      content: {
        version: 1,
        run_id: runId,
        execution_model: "single_run",
        primary_trial_group_id: "primary",
        trial_groups: [{ id: "primary", label: "Primary run", role: "primary" }]
      }
    },
    {
      path: "run_manifest.json",
      content: {
        version: 1,
        run_id: runId,
        execution_model: "single_run",
        portfolio: {
          primary_trial_group_id: "primary"
        },
        trial_groups: [{ id: "primary", status: "pass" }]
      }
    },
    {
      path: "metrics.json",
      content: {
        accuracy: 0.81
      }
    },
    {
      path: "objective_evaluation.json",
      content: {
        status: "met"
      }
    },
    {
      path: "result_analysis.json",
      content: {
        generated_at: now,
        overview: {
          objective_status: "met",
          objective_summary: "Fixture run met the target objective."
        }
      }
    },
    {
      path: "transition_recommendation.json",
      content: {
        action: "advance",
        targetNode: "figure_audit",
        reason: "Fixture run is ready for figure audit."
      }
    }
  ];
}

async function readRunsFile(runsFile: string): Promise<RunRecord[]> {
  try {
    const raw = await readFile(runsFile, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; runs?: RunRecord[] };
    return parsed.version === 3 && Array.isArray(parsed.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

function buildLiveFixtureRunRecord(input: {
  runId: string;
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
  currentNode: GraphNodeId;
  lifecycleStatus: RunLifecycleStatus;
  runStatus?: RunStatus;
  latestSummary?: string;
  nodeStatusOverrides?: Partial<Record<GraphNodeId, NodeStatus>>;
  now: string;
}): RunRecord {
  const nodeStates = buildLiveFixtureNodeStates({
    currentNode: input.currentNode,
    lifecycleStatus: input.lifecycleStatus,
    overrides: input.nodeStatusOverrides,
    now: input.now
  });
  return {
    version: 3,
    workflowVersion: 3,
    id: input.runId,
    title: input.title,
    topic: input.topic,
    constraints: input.constraints,
    objectiveMetric: input.objectiveMetric,
    status: input.runStatus || deriveRunStatus(input.lifecycleStatus),
    currentNode: input.currentNode,
    latestSummary: input.latestSummary,
    nodeThreads: {},
    createdAt: input.now,
    updatedAt: input.now,
    graph: {
      currentNode: input.currentNode,
      nodeStates,
      retryCounters: {},
      rollbackCounters: {},
      researchCycle: 1,
      transitionHistory: [],
      checkpointSeq: countCompletedNodes(nodeStates),
      retryPolicy: {
        maxAttemptsPerNode: 3,
        maxAutoRollbacksPerNode: 2,
        maxAutoBackwardJumps: 4
      }
    },
    memoryRefs: {
      runContextPath: "memory/run_context.json",
      longTermPath: "memory/long_term.jsonl",
      episodePath: "memory/episodes.jsonl"
    }
  };
}

function buildLiveFixtureNodeStates(input: {
  currentNode: GraphNodeId;
  lifecycleStatus: RunLifecycleStatus;
  overrides?: Partial<Record<GraphNodeId, NodeStatus>>;
  now: string;
}): Record<GraphNodeId, NodeState> {
  const currentIndex = FIXED_NODE_ORDER.indexOf(input.currentNode);
  const currentStatus = deriveCurrentNodeStatus(input.lifecycleStatus);
  return FIXED_NODE_ORDER.reduce<Record<GraphNodeId, NodeState>>((acc, node, index) => {
    let status: NodeStatus;
    if (index < currentIndex) {
      status = "completed";
    } else if (index === currentIndex) {
      status = currentStatus;
    } else {
      status = "pending";
    }
    const override = input.overrides?.[node];
    acc[node] = {
      status: override || status,
      updatedAt: input.now
    };
    return acc;
  }, {} as Record<GraphNodeId, NodeState>);
}

function deriveRunStatus(lifecycleStatus: RunLifecycleStatus): RunStatus {
  switch (lifecycleStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "needs_approval":
    case "paused":
      return "paused";
    default:
      return "running";
  }
}

function deriveCurrentNodeStatus(lifecycleStatus: RunLifecycleStatus): NodeStatus {
  switch (lifecycleStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "needs_approval":
      return "needs_approval";
    case "paused":
      return "pending";
    default:
      return "running";
  }
}

function countCompletedNodes(nodeStates: Record<GraphNodeId, NodeState>): number {
  return Object.values(nodeStates).filter((state) => state.status === "completed").length;
}

function buildMinimalFixtureConfig(input: {
  approvalMode: WorkflowApprovalMode;
  executionApprovalMode: ExecutionApprovalMode;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
}): AppConfig {
  const networkPolicy = input.networkPolicy || "blocked";
  const allowNetwork = networkPolicy !== "blocked";
  return {
    version: 1,
    project_name: "AutoLabOS Live Fixture",
    providers: {
      llm_mode: "codex_chatgpt_only",
      codex: {
        model: "gpt-5.3-codex",
        chat_model: "gpt-5.3-codex",
        experiment_model: "gpt-5.3-codex",
        reasoning_effort: "xhigh",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "xhigh",
        command_reasoning_effort: "low",
        fast_mode: false,
        chat_fast_mode: false,
        experiment_fast_mode: false,
        auth_required: true
      },
      openai: {
        model: "gpt-5.4",
        chat_model: "gpt-5.4",
        experiment_model: "gpt-5.4",
        reasoning_effort: "medium",
        chat_reasoning_effort: "low",
        experiment_reasoning_effort: "medium",
        command_reasoning_effort: "low",
        api_key_required: true
      }
    },
    papers: {
      max_results: 200,
      per_second_limit: 1
    },
    research: {
      default_topic: "Live fixture validation",
      default_constraints: ["fixture"],
      default_objective_metric: "operator clarity"
    },
    workflow: {
      mode: "agent_approval",
      wizard_enabled: true,
      approval_mode: input.approvalMode,
      execution_approval_mode: input.executionApprovalMode
    },
    experiments: {
      runner: "local_python",
      timeout_sec: 3600,
      allow_network: allowNetwork,
      network_policy: networkPolicy,
      network_purpose: allowNetwork ? input.networkPurpose || "other" : undefined
    },
    paper: {
      template: "acl",
      build_pdf: true,
      latex_engine: "auto_install"
    },
    paths: {
      runs_dir: ".autolabos/runs",
      logs_dir: ".autolabos/logs"
    }
  };
}

async function writeArtifact(filePath: string, content: string | unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (typeof content === "string") {
    await writeFile(filePath, content, "utf8");
    return;
  }
  await writeJson(filePath, content);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
