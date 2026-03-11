import path from "node:path";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { appendJsonl, safeRead, writeRunArtifact } from "./helpers.js";
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

interface EvidenceRow extends HypothesisEvidenceSeed {
  evidence_span?: string;
}

const DEFAULT_TOP_K = 2;
const DEFAULT_BRANCH_COUNT = 6;

export function createGenerateHypothesesNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "generate_hypotheses",
    async execute({ run }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const evidencePath = path.join(".autolabos", "runs", run.id, "evidence_store.jsonl");
      const evidenceRows = parseEvidenceSeeds(await safeRead(evidencePath));
      const evidenceById = new Map(evidenceRows.map((item) => [item.evidence_id || "", item] as const));
      const paperTitlesById = parseCorpusTitleMap(await safeRead(path.join(".autolabos", "runs", run.id, "corpus.jsonl")));
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

      if (evidenceRows.length === 0) {
        const message =
          "No evidence is available for hypothesis generation. Run analyze_papers first and confirm evidence_store.jsonl contains evidence items.";
        emitLog(message);
        await runContextMemory.put("generate_hypotheses.top_k", 0);
        await runContextMemory.put("generate_hypotheses.candidate_count", 0);
        await runContextMemory.put("generate_hypotheses.source", "missing_evidence");
        await runContextMemory.put("generate_hypotheses.pipeline", "missing_evidence");
        await runContextMemory.put("generate_hypotheses.summary", message);
        return {
          status: "failure",
          summary: message,
          error: "generate_hypotheses requires at least one evidence item from analyze_papers.",
          toolCallsUsed: 0
        };
      }

      const weakEvidenceCount = evidenceRows.filter((item) => isWeakEvidenceSeed(item)).length;
      if (weakEvidenceCount > 0) {
        emitLog(
          `Evidence-quality guardrail: ${weakEvidenceCount}/${evidenceRows.length} evidence item(s) are abstract-only or caveated, so hypothesis selection will down-weight them.`
        );
      }

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

      const selectionScores = new Map(
        planning.artifacts.selection.scores.map((item) => [item.candidate_id, item] as const)
      );
      const selectionRanks = new Map(
        planning.selected.map((candidate, index) => [candidate.id, index + 1] as const)
      );
      const hypotheses = planning.selected.map((candidate, idx) => ({
        hypothesis_id: `h_${idx + 1}`,
        candidate_id: candidate.id,
        selection_rank: selectionRanks.get(candidate.id) || idx + 1,
        base_score: selectionScores.get(candidate.id)?.base_score,
        diversity_penalty: selectionScores.get(candidate.id)?.diversity_penalty,
        final_score: selectionScores.get(candidate.id)?.final_score,
        text: candidate.text,
        score: selectionScores.get(candidate.id)?.base_score ?? scoreCandidate(candidate, evidenceById),
        evidence_links: candidate.evidence_links,
        evidence_quality_adjustment: selectionScores.get(candidate.id)?.evidence_quality_adjustment,
        evidence_quality_notes: selectionScores.get(candidate.id)?.evidence_quality_notes,
        evidence_snippets: uniqueStrings(
          candidate.evidence_links
            .map((evidenceId) => buildEvidenceSnippet(evidenceById.get(evidenceId)))
            .filter((value): value is string => Boolean(value))
        ),
        paper_titles: uniqueStrings(
          candidate.evidence_links
            .map((evidenceId) => evidenceById.get(evidenceId)?.paper_id)
            .map((paperId) => (paperId ? paperTitlesById.get(paperId) : undefined))
            .filter((value): value is string => Boolean(value))
        ),
        rationale: candidate.rationale,
        source: planning.source,
        novelty: candidate.novelty,
        feasibility: candidate.feasibility,
        testability: candidate.testability,
        cost: candidate.cost,
        expected_gain: candidate.expected_gain,
        generator_kind: candidate.generator_kind,
        axis_ids: candidate.axis_ids,
        groundedness: candidate.groundedness,
        causal_clarity: candidate.causal_clarity,
        falsifiability: candidate.falsifiability,
        experimentability: candidate.experimentability,
        reproducibility_specificity: candidate.reproducibility_specificity,
        reproducibility_signals: candidate.reproducibility_signals,
        measurement_hint: candidate.measurement_hint,
        boundary_condition: candidate.boundary_condition,
        limitation_reflection: candidate.limitation_reflection,
        measurement_readiness: candidate.measurement_readiness,
        critique_summary: candidate.critique_summary
      }));

      await appendJsonl(run, "hypotheses.jsonl", hypotheses);
      if (planning.artifacts.evidence_axes.length > 0) {
        await writeRunArtifact(
          run,
          "hypothesis_generation/evidence_axes.json",
          JSON.stringify(planning.artifacts.evidence_axes, null, 2)
        );
      }
      if (planning.artifacts.drafts.length > 0) {
        await appendJsonl(run, "hypothesis_generation/drafts.jsonl", planning.artifacts.drafts);
      }
      if (planning.artifacts.reviews.length > 0) {
        await appendJsonl(run, "hypothesis_generation/reviews.jsonl", planning.artifacts.reviews);
      }
      await writeRunArtifact(
        run,
        "hypothesis_generation/llm_trace.json",
        JSON.stringify(planning.artifacts.llm_trace, null, 2)
      );
      await writeRunArtifact(
        run,
        "hypothesis_generation/selection.json",
        JSON.stringify(planning.artifacts.selection, null, 2)
      );
      await runContextMemory.put("generate_hypotheses.top_k", hypotheses.length);
      await runContextMemory.put("generate_hypotheses.candidate_count", planning.candidates.length);
      await runContextMemory.put("generate_hypotheses.source", planning.source);
      await runContextMemory.put("generate_hypotheses.summary", planning.summary);
      await runContextMemory.put("generate_hypotheses.pipeline", planning.artifacts.pipeline);

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
        toolCallsUsed: Math.max(1, planning.toolCallsUsed)
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

function parseEvidenceSeeds(raw: string): EvidenceRow[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as EvidenceRow;
        return parsed;
      } catch {
        return undefined;
      }
    })
    .filter((item): item is EvidenceRow => Boolean(item));
}

function parseCorpusTitleMap(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { paper_id?: unknown; title?: unknown };
      if (typeof parsed.paper_id === "string" && typeof parsed.title === "string" && parsed.title.trim()) {
        out.set(parsed.paper_id, parsed.title.trim());
      }
    } catch {
      // ignore malformed corpus rows
    }
  }
  return out;
}

function buildEvidenceSnippet(evidence: EvidenceRow | undefined): string | undefined {
  if (!evidence) {
    return undefined;
  }
  const raw =
    typeof evidence.evidence_span === "string" && evidence.evidence_span.trim()
      ? evidence.evidence_span.trim()
      : typeof evidence.claim === "string" && evidence.claim.trim()
        ? evidence.claim.trim()
        : "";
  if (!raw) {
    return undefined;
  }
  return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
}

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function scoreCandidate(
  candidate: HypothesisCandidate,
  evidenceById: Map<string, EvidenceRow>
): number {
  const evidenceAdjustment = averageEvidenceAdjustment(candidate, evidenceById);
  return (
    candidate.novelty +
    candidate.feasibility +
    candidate.testability +
    candidate.expected_gain +
    (candidate.groundedness ?? 0) +
    (candidate.causal_clarity ?? 0) +
    (candidate.falsifiability ?? 0) +
    (candidate.experimentability ?? 0) -
    candidate.cost +
    (candidate.reproducibility_specificity ?? 0) +
    (candidate.limitation_reflection ?? 0) +
    (candidate.measurement_readiness ?? 0) +
    evidenceAdjustment
  );
}

function averageEvidenceAdjustment(
  candidate: HypothesisCandidate,
  evidenceById: Map<string, EvidenceRow>
): number {
  const linkedEvidence = uniqueStrings(candidate.evidence_links)
    .map((evidenceId) => evidenceById.get(evidenceId))
    .filter((item): item is EvidenceRow => Boolean(item));
  if (linkedEvidence.length === 0) {
    return -0.75;
  }
  const average =
    linkedEvidence.reduce((sum, item) => sum + estimateEvidenceAdjustment(item), 0) / linkedEvidence.length;
  return Number(average.toFixed(3));
}

function estimateEvidenceAdjustment(evidence: EvidenceRow): number {
  let adjustment = 0;
  if (evidence.source_type === "full_text") {
    adjustment += 0.4;
  } else if (evidence.source_type === "abstract") {
    adjustment -= 0.85;
  }

  const confidence = typeof evidence.confidence === "number" && Number.isFinite(evidence.confidence)
    ? evidence.confidence
    : 0.5;
  if (confidence < 0.55) {
    adjustment -= 1.1;
  } else if (confidence < 0.7) {
    adjustment -= 0.45;
  } else if (confidence >= 0.9) {
    adjustment += 0.2;
  }

  const reason = typeof evidence.confidence_reason === "string" ? evidence.confidence_reason.toLowerCase() : "";
  if (/(could not be grounded|not be grounded|fallback evidence|no structured evidence|synthesi[sz]ed)/.test(reason)) {
    adjustment -= 1.6;
  } else if (/(only the abstract|abstract-level|abstract only|indirect|supplemental)/.test(reason)) {
    adjustment -= 0.9;
  }
  if (/(single benchmark|external validity|limited|tentative|weak|caveat|partial support)/.test(reason)) {
    adjustment -= 0.3;
  }

  return Number(adjustment.toFixed(3));
}

function isWeakEvidenceSeed(evidence: EvidenceRow): boolean {
  return evidence.source_type === "abstract" || estimateEvidenceAdjustment(evidence) <= -0.75;
}
