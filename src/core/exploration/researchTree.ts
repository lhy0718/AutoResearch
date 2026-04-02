import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ResearchTreeNode } from "./types.js";

const EXPERIMENT_TREE_DIR = "experiment_tree";
const TREE_FILE = "tree.json";

export interface ResearchTree {
  run_id: string;
  nodes: Record<string, ResearchTreeNode>;
  root_id: string | null;
  created_at: string;
  updated_at: string;
}

function buildExperimentTreeDir(runDir: string): string {
  return path.join(runDir, EXPERIMENT_TREE_DIR);
}

function buildResearchTreePath(runDir: string): string {
  return path.join(buildExperimentTreeDir(runDir), TREE_FILE);
}

export function initResearchTree(runId: string, _runDir: string): ResearchTree {
  const timestamp = new Date().toISOString();
  return {
    run_id: runId,
    nodes: {},
    root_id: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function loadResearchTree(runDir: string): ResearchTree | null {
  const targetPath = buildResearchTreePath(runDir);
  if (!existsSync(targetPath)) {
    return null;
  }
  return JSON.parse(readFileSync(targetPath, "utf8")) as ResearchTree;
}

export function saveResearchTree(runDir: string, tree: ResearchTree): void {
  const treeDir = buildExperimentTreeDir(runDir);
  mkdirSync(treeDir, { recursive: true });
  writeFileSync(buildResearchTreePath(runDir), `${JSON.stringify(tree, null, 2)}\n`, "utf8");
}

export function addNode(tree: ResearchTree, node: ResearchTreeNode): ResearchTree {
  const timestamp = new Date().toISOString();
  const normalizedNode: ResearchTreeNode = {
    ...node,
    root_id: node.parent_id === null ? node.node_id : node.root_id,
    updated_at: node.updated_at || timestamp
  };
  return {
    ...tree,
    root_id: tree.root_id ?? normalizedNode.root_id,
    updated_at: timestamp,
    nodes: {
      ...tree.nodes,
      [normalizedNode.node_id]: normalizedNode
    }
  };
}

export function updateNode(
  tree: ResearchTree,
  nodeId: string,
  patch: Partial<ResearchTreeNode>
): ResearchTree {
  const existing = tree.nodes[nodeId];
  if (!existing) {
    return tree;
  }
  const timestamp = new Date().toISOString();
  return {
    ...tree,
    updated_at: timestamp,
    nodes: {
      ...tree.nodes,
      [nodeId]: {
        ...existing,
        ...patch,
        updated_at: patch.updated_at ?? timestamp
      }
    }
  };
}

export function getNode(tree: ResearchTree, nodeId: string): ResearchTreeNode | null {
  return tree.nodes[nodeId] ?? null;
}

export function getChildren(tree: ResearchTree, parentId: string): ResearchTreeNode[] {
  return Object.values(tree.nodes).filter((node) => node.parent_id === parentId);
}

export function getDepth(tree: ResearchTree, nodeId: string): number {
  const node = tree.nodes[nodeId];
  if (!node) {
    return 0;
  }
  if (node.parent_id === null) {
    return node.depth;
  }
  const parent = tree.nodes[node.parent_id];
  if (!parent) {
    return node.depth;
  }
  return getDepth(tree, parent.node_id) + 1;
}
