import { AGENT_ORDER, GraphNodeId } from "../types.js";

export function shouldSurfaceAnalyzeResultsInsight(currentNode?: GraphNodeId): boolean {
  if (!currentNode) {
    return false;
  }
  return AGENT_ORDER.indexOf(currentNode) >= AGENT_ORDER.indexOf("analyze_results");
}

export function shouldSurfaceReviewInsight(currentNode?: GraphNodeId): boolean {
  return currentNode === "review" || currentNode === "write_paper";
}
