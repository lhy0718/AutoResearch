import { describe, expect, it } from "vitest";

import {
  buildFallbackPaperDraft,
  PaperWritingBundle
} from "../src/core/analysis/paperWriting.js";
import {
  buildFallbackPaperManuscript,
  buildPaperSubmissionValidation,
  buildPaperTraceability,
  renderSubmissionPaperTex
} from "../src/core/analysis/paperManuscript.js";

describe("paper submission sanitization", () => {
  it("removes internal run paths from fallback paper drafting before submission validation", () => {
    const bundle: PaperWritingBundle = {
      runTitle: "Budget-aware run",
      topic: "Efficient test-time reasoning for small language models",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [
        "provider/tooling constraints: keep auditable artifacts under `test/.autolabos/` and `test/output/`."
      ],
      paperSummaries: [
        {
          paper_id: "paper_1",
          title: "Schema Bench",
          source_type: "full_text",
          summary: "Structured coordination improves reproducibility.",
          key_findings: ["Structured coordination improves reproducibility."],
          limitations: [],
          datasets: ["AgentBench-mini"],
          metrics: ["reproducibility_score"],
          novelty: "Persistent coordination state",
          reproducibility_notes: ["Repeated trials are reported."]
        }
      ],
      evidenceRows: [
        {
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Structured coordination improves reproducibility.",
          method_slot: "shared state schema",
          result_slot: "higher reproducibility_score",
          limitation_slot: "small benchmark",
          dataset_slot: "AgentBench-mini",
          metric_slot: "reproducibility_score",
          evidence_span: "Repeated trials improved reproducibility_score.",
          source_type: "full_text",
          confidence: 0.9
        }
      ],
      hypotheses: [
        {
          hypothesis_id: "h_1",
          text: "Persistent coordination improves reproducibility.",
          evidence_links: ["ev_1"]
        }
      ],
      corpus: [
        {
          paper_id: "paper_1",
          title: "Schema Bench",
          abstract: "Structured coordination improves reproducibility.",
          authors: ["Alice Doe"],
          year: 2025,
          venue: "ACL"
        } as any
      ],
      experimentPlan: {
        selectedTitle: "Schema benchmark",
        selectedSummary: "Compare persistent schemas with a baseline.",
        rawText: ""
      },
      resultAnalysis: {
        objective_metric: {
          evaluation: {
            summary: "Objective metric met: reproducibility_score=0.88 >= 0.8."
          }
        }
      } as any
    };

    const draft = buildFallbackPaperDraft(bundle);
    const manuscript = buildFallbackPaperManuscript({
      draft,
      resultAnalysis: bundle.resultAnalysis
    });
    const traceability = buildPaperTraceability({ draft, manuscript });
    const citations = new Map([["paper_1", "paper1"]]);
    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability,
      citationKeysByPaperId: citations
    });
    const validation = buildPaperSubmissionValidation({
      manuscript,
      tex,
      traceability,
      citationKeysByPaperId: citations
    });

    expect(JSON.stringify({ draft, manuscript, tex })).not.toContain(".autolabos/");
    expect(validation.issues.some((issue) => issue.kind === "absolute_path")).toBe(false);
  });
});
