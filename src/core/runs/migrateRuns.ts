import {
  GRAPH_NODE_ORDER,
  GraphNodeId,
  NodeState,
  RunRecord,
  RunsFile
} from "../../types.js";
import { createDefaultGraphState } from "../stateGraph/defaults.js";

type StageIdV1 =
  | "collect"
  | "analyze"
  | "hypothesize"
  | "design"
  | "implement"
  | "execute"
  | "results"
  | "write";

interface StageStateV1 {
  status: "pending" | "running" | "needs_approval" | "completed" | "failed";
  updatedAt: string;
  note?: string;
}

interface RunRecordV1 {
  id: string;
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  currentStage: StageIdV1;
  latestSummary?: string;
  implementThreadId?: string;
  createdAt: string;
  updatedAt: string;
  stages: Record<StageIdV1, StageStateV1>;
}

interface RunsFileV1 {
  version: 1;
  runs: RunRecordV1[];
}

type AgentIdV2 =
  | "literature"
  | "idea"
  | "hypothesis"
  | "experiment_designer"
  | "experiment_runner"
  | "result_analyzer"
  | "paper_writer";

interface AgentStateV2 {
  status: "pending" | "running" | "needs_approval" | "completed" | "failed";
  updatedAt: string;
  note?: string;
}

interface RunRecordV2 {
  version: 2;
  id: string;
  title: string;
  topic: string;
  constraints: string[];
  objectiveMetric: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  currentAgent: AgentIdV2;
  latestSummary?: string;
  agentThreads?: Partial<Record<AgentIdV2, string>>;
  createdAt: string;
  updatedAt: string;
  agents: Record<AgentIdV2, AgentStateV2>;
}

interface RunsFileV2 {
  version: 2;
  runs: RunRecordV2[];
}

export function isRunsFileV1(input: unknown): input is RunsFileV1 {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as { version?: unknown; runs?: unknown };
  return value.version === 1 && Array.isArray(value.runs);
}

export function isRunsFileV2(input: unknown): input is RunsFileV2 {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as { version?: unknown; runs?: unknown };
  return value.version === 2 && Array.isArray(value.runs);
}

export function isRunsFileV3(input: unknown): input is RunsFile {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as { version?: unknown; runs?: unknown };
  return value.version === 3 && Array.isArray(value.runs);
}

export function migrateRunsFileV1ToV2(v1: RunsFileV1): RunsFileV2 {
  return {
    version: 2,
    runs: v1.runs.map((run) => ({
      version: 2,
      id: run.id,
      title: run.title,
      topic: run.topic,
      constraints: run.constraints,
      objectiveMetric: run.objectiveMetric,
      status: run.status,
      currentAgent: mapStageToAgentV2(run.currentStage),
      latestSummary: run.latestSummary,
      agentThreads: run.implementThreadId ? { experiment_runner: run.implementThreadId } : {},
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      agents: {
        literature: toAgentState(run.stages.collect),
        idea: toAgentState(run.stages.analyze),
        hypothesis: toAgentState(run.stages.hypothesize),
        experiment_designer: toAgentState(run.stages.design),
        experiment_runner: toAgentState(run.stages.execute || run.stages.implement),
        result_analyzer: toAgentState(run.stages.results),
        paper_writer: toAgentState(run.stages.write)
      }
    }))
  };
}

export function migrateRunsFileV2ToV3(v2: RunsFileV2): RunsFile {
  return {
    version: 3,
    runs: v2.runs.map((run) => migrateRunV2ToV3(run))
  };
}

export function migrateAnyRunsFileToV3(input: RunsFileV1 | RunsFileV2 | RunsFile): RunsFile {
  if ((input as { version: number }).version === 3) {
    return normalizeRunsV3(input as RunsFile);
  }
  if ((input as { version: number }).version === 2) {
    return migrateRunsFileV2ToV3(input as RunsFileV2);
  }
  return migrateRunsFileV2ToV3(migrateRunsFileV1ToV2(input as RunsFileV1));
}

function migrateRunV2ToV3(run: RunRecordV2): RunRecord {
  const graph = createDefaultGraphState();

  graph.nodeStates.collect_papers = toNodeState(run.agents.literature);
  graph.nodeStates.analyze_papers = toNodeState(run.agents.idea);
  graph.nodeStates.generate_hypotheses = toNodeState(run.agents.hypothesis);
  graph.nodeStates.design_experiments = toNodeState(run.agents.experiment_designer);
  graph.nodeStates.implement_experiments = toNodeState(run.agents.experiment_runner);
  graph.nodeStates.run_experiments = defaultNodeState(run.updatedAt);
  graph.nodeStates.analyze_results = toNodeState(run.agents.result_analyzer);
  graph.nodeStates.write_paper = toNodeState(run.agents.paper_writer);

  const currentNode = mapAgentToNodeV3(run.currentAgent);
  graph.currentNode = currentNode;

  const nodeThreads: Partial<Record<GraphNodeId, string>> = {};
  if (run.agentThreads?.literature) nodeThreads.collect_papers = run.agentThreads.literature;
  if (run.agentThreads?.idea) nodeThreads.analyze_papers = run.agentThreads.idea;
  if (run.agentThreads?.hypothesis) nodeThreads.generate_hypotheses = run.agentThreads.hypothesis;
  if (run.agentThreads?.experiment_designer) nodeThreads.design_experiments = run.agentThreads.experiment_designer;
  if (run.agentThreads?.experiment_runner) {
    nodeThreads.implement_experiments = run.agentThreads.experiment_runner;
    nodeThreads.run_experiments = run.agentThreads.experiment_runner;
  }
  if (run.agentThreads?.result_analyzer) nodeThreads.analyze_results = run.agentThreads.result_analyzer;
  if (run.agentThreads?.paper_writer) nodeThreads.write_paper = run.agentThreads.paper_writer;

  return {
    version: 3,
    workflowVersion: 3,
    id: run.id,
    title: run.title,
    topic: run.topic,
    constraints: run.constraints,
    objectiveMetric: run.objectiveMetric,
    status: normalizeStatus(run.status),
    currentNode,
    latestSummary: run.latestSummary,
    nodeThreads,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    graph,
    memoryRefs: {
      runContextPath: `.autolabos/runs/${run.id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${run.id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${run.id}/memory/episodes.jsonl`
    }
  };
}

function normalizeRunsV3(file: RunsFile): RunsFile {
  return {
    version: 3,
    runs: file.runs.map((run) => ({
      ...run,
      version: 3,
      workflowVersion: 3,
      nodeThreads: run.nodeThreads ?? {},
      graph: {
        ...createDefaultGraphState(),
        ...run.graph,
        nodeStates: run.graph?.nodeStates ?? createDefaultGraphState().nodeStates,
        retryCounters: run.graph?.retryCounters ?? {},
        rollbackCounters: run.graph?.rollbackCounters ?? {},
        researchCycle: run.graph?.researchCycle ?? 0,
        transitionHistory: run.graph?.transitionHistory ?? []
      },
      memoryRefs: run.memoryRefs ?? {
        runContextPath: `.autolabos/runs/${run.id}/memory/run_context.json`,
        longTermPath: `.autolabos/runs/${run.id}/memory/long_term.jsonl`,
        episodePath: `.autolabos/runs/${run.id}/memory/episodes.jsonl`
      }
    }))
  };
}

function toAgentState(state: StageStateV1): AgentStateV2 {
  return {
    status: state?.status ?? "pending",
    updatedAt: state?.updatedAt ?? new Date().toISOString(),
    note: state?.note
  };
}

function toNodeState(state: AgentStateV2): NodeState {
  return {
    status: state?.status ?? "pending",
    updatedAt: state?.updatedAt ?? new Date().toISOString(),
    note: state?.note
  };
}

function defaultNodeState(updatedAt: string): NodeState {
  return {
    status: "pending",
    updatedAt
  };
}

function normalizeStatus(status: RunRecordV2["status"]): RunRecord["status"] {
  return status;
}

function mapStageToAgentV2(stage: StageIdV1): AgentIdV2 {
  const table: Record<StageIdV1, AgentIdV2> = {
    collect: "literature",
    analyze: "idea",
    hypothesize: "hypothesis",
    design: "experiment_designer",
    implement: "experiment_runner",
    execute: "experiment_runner",
    results: "result_analyzer",
    write: "paper_writer"
  };
  return table[stage];
}

function mapAgentToNodeV3(agent: AgentIdV2): GraphNodeId {
  const table: Record<AgentIdV2, GraphNodeId> = {
    literature: "collect_papers",
    idea: "analyze_papers",
    hypothesis: "generate_hypotheses",
    experiment_designer: "design_experiments",
    experiment_runner: "implement_experiments",
    result_analyzer: "analyze_results",
    paper_writer: "write_paper"
  };
  return table[agent];
}

export function isGraphNodeId(value: string): value is GraphNodeId {
  return GRAPH_NODE_ORDER.includes(value as GraphNodeId);
}
