import {
  GRAPH_NODE_ORDER,
  GraphNodeId,
  NodeUsageSummary,
  RunUsageSummary,
  RunUsageTotals
} from "../../types.js";

export interface RunUsageDelta extends RunUsageTotals {
  executions: number;
  lastUpdatedAt?: string;
}

export function createEmptyRunUsageTotals(): RunUsageTotals {
  return {
    costUsd: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    wallTimeMs: 0
  };
}

export function createEmptyNodeUsageSummary(): NodeUsageSummary {
  return {
    ...createEmptyRunUsageTotals(),
    executions: 0
  };
}

export function createEmptyRunUsageSummary(): RunUsageSummary {
  return {
    totals: createEmptyRunUsageTotals(),
    byNode: {}
  };
}

export function normalizeRunUsageSummary(usage: RunUsageSummary | undefined): RunUsageSummary | undefined {
  if (!usage) {
    return undefined;
  }

  const byNode = Object.fromEntries(
    Object.entries(usage.byNode ?? {})
      .filter(([node]) => isGraphNodeId(node))
      .map(([node, summary]) => [node, normalizeNodeUsageSummary(summary)])
  ) as Partial<Record<GraphNodeId, NodeUsageSummary>>;

  return {
    totals: normalizeRunUsageTotals(usage.totals),
    byNode,
    lastUpdatedAt: normalizeTimestamp(usage.lastUpdatedAt)
  };
}

export function applyRunUsageDelta(
  usage: RunUsageSummary | undefined,
  node: GraphNodeId,
  delta: RunUsageDelta
): RunUsageSummary {
  const normalized = normalizeRunUsageSummary(usage) ?? createEmptyRunUsageSummary();
  const timestamp = normalizeTimestamp(delta.lastUpdatedAt) ?? new Date().toISOString();
  const currentNode = normalizeNodeUsageSummary(normalized.byNode[node]);

  return {
    totals: addTotals(normalized.totals, delta),
    byNode: {
      ...normalized.byNode,
      [node]: {
        ...addTotals(currentNode, delta),
        executions: currentNode.executions + coerceNonNegativeInteger(delta.executions),
        lastUpdatedAt: timestamp
      }
    },
    lastUpdatedAt: timestamp
  };
}

export function formatRunUsageSummary(usage: RunUsageSummary | undefined): string | undefined {
  const normalized = normalizeRunUsageSummary(usage);
  if (!normalized) {
    return undefined;
  }

  const { totals } = normalized;
  const parts: string[] = [];
  if (totals.toolCalls > 0) {
    parts.push(`${formatRoundedCount(totals.toolCalls)} tool call(s)`);
  }
  if (totals.wallTimeMs > 0) {
    parts.push(`wall ${formatDuration(totals.wallTimeMs)}`);
  }
  if (totals.costUsd > 0) {
    parts.push(`$${formatUsd(totals.costUsd)}`);
  }
  if (totals.inputTokens > 0 || totals.outputTokens > 0) {
    parts.push(`${formatRoundedCount(totals.inputTokens)} in / ${formatRoundedCount(totals.outputTokens)} out tok`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return `Usage: ${parts.join(", ")}.`;
}

function normalizeNodeUsageSummary(summary: Partial<NodeUsageSummary> | undefined): NodeUsageSummary {
  return {
    ...normalizeRunUsageTotals(summary),
    executions: coerceNonNegativeInteger(summary?.executions),
    lastUpdatedAt: normalizeTimestamp(summary?.lastUpdatedAt)
  };
}

function normalizeRunUsageTotals(totals: Partial<RunUsageTotals> | undefined): RunUsageTotals {
  return {
    costUsd: coerceNonNegativeNumber(totals?.costUsd),
    toolCalls: coerceNonNegativeNumber(totals?.toolCalls),
    inputTokens: coerceNonNegativeNumber(totals?.inputTokens),
    outputTokens: coerceNonNegativeNumber(totals?.outputTokens),
    wallTimeMs: coerceNonNegativeNumber(totals?.wallTimeMs)
  };
}

function addTotals(base: RunUsageTotals, delta: RunUsageTotals): RunUsageTotals {
  return {
    costUsd: base.costUsd + coerceNonNegativeNumber(delta.costUsd),
    toolCalls: base.toolCalls + coerceNonNegativeNumber(delta.toolCalls),
    inputTokens: base.inputTokens + coerceNonNegativeNumber(delta.inputTokens),
    outputTokens: base.outputTokens + coerceNonNegativeNumber(delta.outputTokens),
    wallTimeMs: base.wallTimeMs + coerceNonNegativeNumber(delta.wallTimeMs)
  };
}

function coerceNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function coerceNonNegativeInteger(value: unknown): number {
  return Math.trunc(coerceNonNegativeNumber(value));
}

function normalizeTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isGraphNodeId(value: string): value is GraphNodeId {
  return GRAPH_NODE_ORDER.includes(value as GraphNodeId);
}

function formatRoundedCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.max(1, Math.round(ms))}ms`;
  }

  const totalSeconds = Math.round(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatUsd(value: number): string {
  const rounded =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return rounded.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}
