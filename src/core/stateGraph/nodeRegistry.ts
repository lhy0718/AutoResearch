import { GraphNodeId } from "../../types.js";
import { GraphNodeHandler, GraphNodeRegistry } from "./types.js";
import { NodeExecutionDeps } from "../nodes/types.js";
import { createCollectPapersNode } from "../nodes/collectPapers.js";
import { createAnalyzePapersNode } from "../nodes/analyzePapers.js";
import { createGenerateHypothesesNode } from "../nodes/generateHypotheses.js";
import { createDesignExperimentsNode } from "../nodes/designExperiments.js";
import { createImplementExperimentsNode } from "../nodes/implementExperiments.js";
import { createRunExperimentsNode } from "../nodes/runExperiments.js";
import { createAnalyzeResultsNode } from "../nodes/analyzeResults.js";
import { createFigureAuditNode } from "../nodes/figureAudit.js";
import { createReviewNode } from "../nodes/review.js";
import { createWritePaperNode } from "../nodes/writePaper.js";

export class DefaultNodeRegistry implements GraphNodeRegistry {
  private readonly handlers: Record<GraphNodeId, GraphNodeHandler>;

  constructor(deps: NodeExecutionDeps) {
    this.handlers = {
      collect_papers: createCollectPapersNode(deps),
      analyze_papers: createAnalyzePapersNode(deps),
      generate_hypotheses: createGenerateHypothesesNode(deps),
      design_experiments: createDesignExperimentsNode(deps),
      implement_experiments: createImplementExperimentsNode(deps),
      run_experiments: createRunExperimentsNode(deps),
      analyze_results: createAnalyzeResultsNode(deps),
      figure_audit: createFigureAuditNode(deps),
      review: createReviewNode(deps),
      write_paper: createWritePaperNode(deps)
    };
  }

  get(nodeId: GraphNodeId): GraphNodeHandler {
    const handler = this.handlers[nodeId];
    if (!handler) {
      throw new Error(`Unknown graph node: ${nodeId}`);
    }
    return handler;
  }

  list(): GraphNodeHandler[] {
    return Object.values(this.handlers);
  }
}
