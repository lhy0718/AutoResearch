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

export interface GenerateHypothesesRequest {
  topK: number;
  branchCount: number;
}

const DEFAULT_TOP_K = 2;
const DEFAULT_BRANCH_COUNT = 6;

export function createGenerateHypothesesNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "generate_hypotheses",
    async execute({ run }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const evidencePath = path.join(".autoresearch", "runs", run.id, "evidence_store.jsonl");
      const evidenceRows = parseEvidenceSeeds(await safeRead(evidencePath));
      const request = normalizeGenerateHypothesesRequest(
        await runContextMemory.get<{ topK?: unknown; branchCount?: unknown }>("generate_hypotheses.request")
      );
      await runContextMemory.put("generate_hypotheses.request", request);

      const emitLog = (text: string) => {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "generate_hypotheses",
          payload: { text }
        });
      };

      emitLog(
        `Generating hypotheses from ${evidenceRows.length} evidence item(s) with branchCount=${request.branchCount} and topK=${request.topK}.`
      );
      const planning = await generateHypothesesFromEvidence({
        llm: deps.llm,
        runTitle: run.title,
        runTopic: run.topic,
        objectiveMetric: run.objectiveMetric,
        evidenceSeeds: evidenceRows,
        branchCount: request.branchCount,
        topK: request.topK,
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

export function normalizeGenerateHypothesesRequest(
  raw?: { topK?: unknown; branchCount?: unknown } | null
): GenerateHypothesesRequest {
  const topK = normalizePositiveInt(raw?.topK, DEFAULT_TOP_K);
  const branchCount = Math.max(normalizePositiveInt(raw?.branchCount, DEFAULT_BRANCH_COUNT), topK);
  return {
    topK,
    branchCount
  };
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
