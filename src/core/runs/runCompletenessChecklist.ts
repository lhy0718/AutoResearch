import path from "node:path";

import {
  GraphNodeId,
  RunCompletenessChecklistArtifact,
  RunRecord,
  RunValidationScope
} from "../../types.js";
import { fileExists } from "../../utils/fs.js";
import { buildPublicSectionDir } from "../publicArtifacts.js";

export const RUN_COMPLETENESS_CHECKLIST_RELATIVE_PATH = "run_completeness_checklist.json";

const NODE_ARTIFACT_SETS: Record<GraphNodeId, string[]> = {
  collect_papers: ["corpus.jsonl", "collect_result.json"],
  analyze_papers: ["analysis_manifest.json", "evidence_store.jsonl", "paper_summaries.jsonl"],
  generate_hypotheses: ["hypotheses.jsonl"],
  design_experiments: [
    "design_experiments_panel/candidates.json",
    "design_experiments_panel/selection.json"
  ],
  implement_experiments: ["experiment_portfolio.json", "execution_plan.json"],
  run_experiments: ["run_manifest.json", "metrics.json"],
  analyze_results: ["result_analysis.json", "transition_recommendation.json"],
  figure_audit: ["figure_audit/figure_audit_summary.json"],
  review: ["review/review_packet.json", "review/paper_critique.json", "review/minimum_gate.json"],
  write_paper: ["paper/main.tex", "paper/paper_readiness.json", "paper/readiness_risks.json"]
};

export async function buildRunCompletenessChecklist(input: {
  workspaceRoot: string;
  run: RunRecord;
  validationScope?: RunValidationScope;
  currentNode?: GraphNodeId;
}): Promise<RunCompletenessChecklistArtifact> {
  const runDir = path.join(input.workspaceRoot, ".autolabos", "runs", input.run.id);
  const validationScope = input.validationScope || "full_run";
  const currentNode = input.currentNode || input.run.currentNode;
  const publicResultsDir = buildPublicSectionDir(input.workspaceRoot, input.run, "results");

  const runRecordPresent = await fileExists(path.join(runDir, "run_record.json"));
  const eventsPresent = await fileExists(path.join(runDir, "events.jsonl"));
  const checkpointsPresent = await fileExists(path.join(runDir, "checkpoints"));
  const latestCheckpointPresent = await fileExists(path.join(runDir, "checkpoints", "latest.json"));
  const publicResultsMirrorPresent = await fileExists(publicResultsDir);

  const nodeArtifactPresenceEntries = await Promise.all(
    (Object.entries(NODE_ARTIFACT_SETS) as Array<[GraphNodeId, string[]]>).map(async ([nodeId, paths]) => {
      const present = await hasAllArtifacts(runDir, paths);
      return [nodeId, present] as const;
    })
  );
  const nodeArtifactPresence = Object.fromEntries(nodeArtifactPresenceEntries);

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  addPresence(
    validationScope === "full_run",
    runRecordPresent,
    "run_record.json",
    missingRequired,
    missingOptional
  );
  addPresence(
    validationScope === "full_run",
    eventsPresent,
    "events.jsonl",
    missingRequired,
    missingOptional
  );
  addPresence(
    validationScope === "full_run",
    checkpointsPresent,
    "checkpoints/",
    missingRequired,
    missingOptional
  );
  addPresence(
    validationScope === "full_run",
    latestCheckpointPresent,
    "checkpoints/latest.json",
    missingRequired,
    missingOptional
  );
  addPresence(
    validationScope === "full_run",
    publicResultsMirrorPresent,
    "outputs/results/",
    missingRequired,
    missingOptional
  );

  for (const relativePath of getNodeSpecificRequiredArtifacts(currentNode, validationScope)) {
    const present = await fileExists(path.join(runDir, relativePath));
    addPresence(true, present, relativePath, missingRequired, missingOptional);
  }

  for (const relativePath of getNodeSpecificOptionalArtifacts(currentNode, validationScope)) {
    const present = await fileExists(path.join(runDir, relativePath));
    addPresence(false, present, relativePath, missingRequired, missingOptional);
  }

  const requiredTotal = countRequiredChecks(currentNode, validationScope);
  const requiredPresent = Math.max(0, requiredTotal - missingRequired.length);
  const summary =
    `${requiredPresent}/${requiredTotal} required completeness checks present; ` +
    `${missingOptional.length} optional gap(s).`;

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    run_id: input.run.id,
    validation_scope: validationScope,
    run_record_present: runRecordPresent,
    events_present: eventsPresent,
    checkpoints_present: checkpointsPresent,
    latest_checkpoint_present: latestCheckpointPresent,
    public_results_mirror_present: publicResultsMirrorPresent,
    node_artifact_presence: nodeArtifactPresence,
    missing_required: missingRequired,
    missing_optional: missingOptional,
    summary
  };
}

function addPresence(
  required: boolean,
  present: boolean,
  label: string,
  missingRequired: string[],
  missingOptional: string[]
): void {
  if (present) {
    return;
  }
  if (required) {
    missingRequired.push(label);
  } else {
    missingOptional.push(label);
  }
}

async function hasAllArtifacts(runDir: string, paths: string[]): Promise<boolean> {
  for (const relativePath of paths) {
    if (!(await fileExists(path.join(runDir, relativePath)))) {
      return false;
    }
  }
  return true;
}

function getNodeSpecificRequiredArtifacts(
  currentNode: GraphNodeId,
  validationScope: RunValidationScope
): string[] {
  switch (currentNode) {
    case "analyze_results":
      return ["result_analysis.json", "transition_recommendation.json"];
    case "review":
      return validationScope === "live_fixture"
        ? ["review/minimum_gate.json", "review/paper_critique.json", "review/readiness_risks.json"]
        : [
            "review/review_packet.json",
            "review/decision.json",
            "review/revision_plan.json",
            "review/minimum_gate.json",
            "review/paper_critique.json",
            "review/readiness_risks.json"
          ];
    case "figure_audit":
      return ["figure_audit/figure_audit_summary.json"];
    case "write_paper":
      return validationScope === "live_fixture"
        ? ["paper/paper_readiness.json", "paper/readiness_risks.json"]
        : ["paper/main.tex", "paper/references.bib", "paper/paper_readiness.json", "paper/readiness_risks.json"];
    default:
      return [];
  }
}

function getNodeSpecificOptionalArtifacts(
  currentNode: GraphNodeId,
  validationScope: RunValidationScope
): string[] {
  if (currentNode === "review" && validationScope === "live_fixture") {
    return ["review/review_packet.json", "review/decision.json"];
  }
  if (currentNode === "write_paper" && validationScope === "live_fixture") {
    return ["paper/main.tex", "paper/references.bib"];
  }
  return [];
}

function countRequiredChecks(currentNode: GraphNodeId, validationScope: RunValidationScope): number {
  const baseRequired = validationScope === "full_run" ? 5 : 0;
  return baseRequired + getNodeSpecificRequiredArtifacts(currentNode, validationScope).length;
}
