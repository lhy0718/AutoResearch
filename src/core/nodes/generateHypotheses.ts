import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, safeRead } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import {
  generateHypothesesFromEvidence,
  HypothesisCandidate,
  HypothesisEvidenceSeed
} from "../analysis/researchPlanning.js";

export function createGenerateHypothesesNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "generate_hypotheses",
    async execute({ run }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const evidencePath = path.join(".autoresearch", "runs", run.id, "evidence_store.jsonl");
      const evidenceRows = parseEvidenceSeeds(await safeRead(evidencePath));

      const emitLog = (text: string) => {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "generate_hypotheses",
          payload: { text }
        });
      };

      emitLog(`Generating hypotheses from ${evidenceRows.length} evidence item(s).`);
      const planning = await generateHypothesesFromEvidence({
        llm: deps.llm,
        runTitle: run.title,
        runTopic: run.topic,
        objectiveMetric: run.objectiveMetric,
        evidenceSeeds: evidenceRows,
        branchCount: 6,
        topK: 2,
        onProgress: emitLog
      });

      const hypotheses = planning.selected.map((candidate, idx) => ({
        hypothesis_id: `h_${idx + 1}`,
        candidate_id: candidate.id,
        text: candidate.text,
        score: scoreCandidate(candidate),
        evidence_links: candidate.evidence_links,
        rationale: candidate.rationale,
        source: planning.source,
        novelty: candidate.novelty,
        feasibility: candidate.feasibility,
        testability: candidate.testability,
        cost: candidate.cost,
        expected_gain: candidate.expected_gain
      }));

      await appendJsonl(run, "hypotheses.jsonl", hypotheses);
      await runContextMemory.put("generate_hypotheses.top_k", hypotheses.length);
      await runContextMemory.put("generate_hypotheses.branch_count", planning.candidates.length);
      await runContextMemory.put("generate_hypotheses.source", planning.source);
      await runContextMemory.put("generate_hypotheses.summary", planning.summary);

      deps.eventStream.emit({
        type: "PLAN_CREATED",
        runId: run.id,
        node: "generate_hypotheses",
        payload: {
          branchCount: planning.candidates.length,
          topK: hypotheses.length,
          source: planning.source,
          fallbackReason: planning.fallbackReason
        }
      });

      emitLog(
        `Selected ${hypotheses.length} hypothesis/hypotheses from ${planning.candidates.length} candidate(s) using ${planning.source}.`
      );

      return {
        status: "success",
        summary: planning.fallbackReason
          ? `${planning.summary} Falling back after: ${planning.fallbackReason}`
          : planning.summary,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

function parseEvidenceSeeds(raw: string): HypothesisEvidenceSeed[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as HypothesisEvidenceSeed;
        return parsed;
      } catch {
        return undefined;
      }
    })
    .filter((item): item is HypothesisEvidenceSeed => Boolean(item));
}

function scoreCandidate(candidate: HypothesisCandidate): number {
  return candidate.novelty + candidate.feasibility + candidate.testability + candidate.expected_gain - candidate.cost;
}
