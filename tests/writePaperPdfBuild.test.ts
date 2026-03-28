import path from "node:path";
import { tmpdir } from "node:os";
import { appendFile, mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { LLMClient, LLMCompleteOptions, MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createWritePaperNode, validateCompiledPdfPageBudget } from "../src/core/nodes/writePaper.js";
import { buildPublicAnalysisDir, buildPublicPaperDir, buildPublicRunManifestPath } from "../src/core/publicArtifacts.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

class SequencedLLMClient extends MockLLMClient implements LLMClient {
  private index = 0;

  constructor(private readonly responses: string[]) {
    super();
  }

  override async complete(_prompt: string, _opts?: LLMCompleteOptions): Promise<{ text: string }> {
    const text = this.responses[Math.min(this.index, this.responses.length - 1)] ?? "";
    this.index += 1;
    return { text };
  }
}

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "PDF-backed Paper Writer",
    topic: "agent collaboration",
    constraints: [],
    objectiveMetric: "",
    status: "running",
    currentNode: "write_paper",
    latestSummary: undefined,
    nodeThreads: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    graph: createDefaultGraphState(),
    memoryRefs: {
      runContextPath: `.autolabos/runs/${runId}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${runId}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${runId}/memory/episodes.jsonl`
    }
  };
}

async function seedRun(root: string, run: RunRecord): Promise<string> {
  const runDir = path.join(root, ".autolabos", "runs", run.id);
  await mkdir(path.join(runDir, "memory"), { recursive: true });
  await writeFile(
    path.join(runDir, "memory", "run_context.json"),
    JSON.stringify({ version: 1, items: [] }),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "paper_summaries.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Schema Bench",
      source_type: "full_text",
      summary: "Persistent state improves revisability.",
      key_findings: ["Persistent state improves revisability."],
      limitations: [],
      datasets: ["AgentBench-mini"],
      metrics: ["reproducibility_score"],
      novelty: "Thread-backed drafting",
      reproducibility_notes: ["Includes repeated drafting runs."]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "evidence_store.jsonl"),
    `${JSON.stringify({
      evidence_id: "ev_1",
      paper_id: "paper_1",
      claim: "Persistent state improves revisability.",
      method_slot: "thread-backed drafting",
      result_slot: "higher revision stability",
      limitation_slot: "small benchmark",
      dataset_slot: "AgentBench-mini",
      metric_slot: "reproducibility_score",
      evidence_span: "Repeated drafting runs remained stable across revisions.",
      source_type: "full_text",
      confidence: 0.92,
      confidence_reason: "The evidence comes from one benchmark, so external validity remains limited."
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "hypotheses.jsonl"),
    `${JSON.stringify({
      hypothesis_id: "h_1",
      text: "Thread-backed drafting improves revisability.",
      evidence_links: ["ev_1"]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "corpus.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Schema Bench",
      abstract: "Persistent state improves revisability.",
      authors: ["Alice Doe"],
      year: 2025,
      venue: "ACL"
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "experiment_plan.yaml"),
    [
      "selected_design:",
      '  title: "Thread-backed drafting benchmark"',
      '  summary: "Compare persistent drafting support across repeated revisions."'
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "result_analysis.json"),
    JSON.stringify(
      {
        overview: {
          objective_status: "observed",
          selected_design_title: "Thread-backed drafting benchmark"
        },
        execution_summary: {
          observation_count: 1
        },
        statistical_summary: {
          notes: ["Stability remained consistent across repeated runs."]
        }
      },
      null,
      2
    ),
    "utf8"
  );
  return runDir;
}

function buildSessionResponses(): string[] {
  const outline = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract_focus: ["persistent drafting", "revisability"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["Thread-backed drafting improves revisability."],
    citation_plan: ["paper_1"]
  });
  const draft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with PDF compilation and repair support.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: ["Persistent drafting support improved revision stability in repeated runs."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["PDF build feedback turns the writer into a submission-ready agent."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent and grounded.",
    revision_notes: ["Keep the PDF-compilation framing explicit."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  return [outline, draft, review, draft];
}

function buildExternalCitationResponses(): string[] {
  const outline = JSON.stringify({
    title: "Externally Verified Citation Paper",
    abstract_focus: ["persistent drafting", "citation verification"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["External citation verification repairs missing corpus references."],
    citation_plan: ["Recovered External Title"]
  });
  const draft = JSON.stringify({
    title: "Externally Verified Citation Paper",
    abstract: "A paper-writing workflow that can recover missing citations through bounded external verification.",
    keywords: ["agent collaboration", "citation verification"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper grounds its framing in an externally recovered citation."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["Recovered External Title"]
      },
      {
        heading: "Method",
        paragraphs: ["The manuscript cites a missing reference and lets the registry repair it conservatively."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["Recovered External Title"]
      },
      {
        heading: "Results",
        paragraphs: ["Bounded external verification restored the missing citation without broadening the claim ceiling."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["Recovered External Title"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["External citation repair stays local to bibliography support rather than changing the evidence bar."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["Recovered External Title"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Bounded external verification restored the missing citation without broadening the claim ceiling.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["Recovered External Title"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent and keeps the citation repair bounded.",
    revision_notes: ["Keep the citation repair strictly bibliographic."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  return [outline, draft, review, draft];
}

function buildValidationRepairResponses(): string[] {
  const outline = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract_focus: ["persistent drafting", "revisability"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["Thread-backed drafting improves revisability."],
    citation_plan: ["paper_1"]
  });
  const flawedDraft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with validation-aware repair support.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: [
          {
            text: "Persistent drafting support improved revision stability in repeated runs.",
            evidence_ids: [],
            citation_paper_ids: []
          }
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Validation-aware repair makes the writer more self-correcting."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: [],
        citation_paper_ids: []
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent but should make evidence links explicit.",
    revision_notes: ["Keep the PDF-compilation framing explicit."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: ["Results"]
  });
  const repairedDraft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with validation-aware repair support.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: [
          {
            text: "Persistent drafting support improved revision stability in repeated runs.",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Validation-aware repair makes the writer more self-correcting."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  return [outline, flawedDraft, review, flawedDraft, repairedDraft];
}

function buildRelatedWorkScoutResponses(): string[] {
  const outline = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract_focus: ["persistent drafting", "related work coverage"],
    section_headings: ["Introduction", "Related Work", "Method", "Results", "Conclusion"],
    key_claim_themes: ["Thread-backed drafting improves revisability."],
    citation_plan: ["paper_1", "paper_scout_1"]
  });
  const draft = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A paper-writing workflow with related-work scouting support.",
    keywords: ["agent collaboration", "paper writing", "related work"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paper studies PDF-backed drafting for agent collaboration workflows."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Related Work",
        paragraphs: [
          {
            text: "Recent related-work scouting highlights complementary literature on revision stability and related evidence synthesis.",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1", "paper_scout_1", "paper_scout_2"]
          }
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_scout_1", "paper_scout_2"]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: ["Persistent drafting support improved revision stability in repeated runs."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Scoped literature scouting helps the writer place results in context."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_scout_1", "paper_scout_2"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "Persistent drafting support improved revision stability in repeated runs.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is coherent and now cites related work more explicitly.",
    revision_notes: ["Keep the related-work framing concise."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  return [outline, draft, review, draft];
}

function buildSubmissionValidationFailureResponses(): string[] {
  const manuscript = JSON.stringify({
    title: "PDF-backed Paper Writer",
    abstract: "A submission draft that should fail validation before PDF build.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["This paragraph incorrectly exposes ev_1 inside the submission manuscript."]
      },
      {
        heading: "Method",
        paragraphs: ["The workflow stages outline, drafting, review, and finalization before compiling LaTeX."]
      },
      {
        heading: "Results",
        paragraphs: ["Persistent drafting support improved revision stability in repeated runs."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["Validation should stop PDF generation when the manuscript leaks raw trace tokens."]
      }
    ]
  });
  return [...buildSessionResponses(), manuscript];
}

function buildManuscriptReviewResponse(input: {
  decision: "pass" | "repair" | "stop";
  issues?: Array<{
    code: string;
    severity?: "warning" | "fail";
    section: string;
    repairable?: boolean;
    message: string;
    fix_recommendation: string;
    supporting_spans?: Array<{
      section: string;
      paragraph_index: number;
      excerpt: string;
      reason?: string;
    }>;
    visual_targets?: Array<{
      kind: "table" | "figure" | "appendix_table" | "appendix_figure";
      index: number;
      rationale?: string;
    }>;
  }>;
}): string {
  const status = input.decision === "pass" ? "pass" : input.decision === "repair" ? "warn" : "fail";
  return JSON.stringify({
    overall_decision: input.decision,
    summary: input.decision === "pass" ? "The polished manuscript reads like a paper." : "The polished manuscript needs local revision.",
    checks: {
      section_completeness: { status, note: "Checked." },
      paragraph_redundancy: { status, note: "Checked." },
      related_work_quality: { status, note: "Checked." },
      section_transition: { status, note: "Checked." },
      visual_redundancy: { status, note: "Checked." },
      appendix_hygiene: { status, note: "Checked." },
      citation_hygiene: { status, note: "Checked." },
      alignment: { status, note: "Checked." },
      rhetorical_overreach: { status, note: "Checked." }
    },
    issues: input.issues || []
  });
}

function buildManuscriptReviewAuditResponse(input?: {
  ok?: boolean;
  artifact_reliability?: "grounded" | "partially_grounded" | "degraded";
  retry_recommended?: boolean;
  summary?: string;
  issues?: Array<{
    severity?: "warning" | "fail";
    code: "unsupported_issue" | "missing_major_issue" | "check_issue_mismatch" | "insufficient_grounding";
    section: string;
    message: string;
    fix_recommendation: string;
  }>;
}): string {
  return JSON.stringify({
    ok: input?.ok ?? true,
    artifact_reliability: input?.artifact_reliability ?? "grounded",
    retry_recommended: input?.retry_recommended ?? false,
    summary: input?.summary ?? "The manuscript review artifact is sufficiently grounded.",
    issues: input?.issues || []
  });
}

function buildPolishedManuscriptResponse(overrides?: Partial<any>): string {
  return JSON.stringify({
    title: "Thread-Backed Drafting for More Stable Manuscript Revision",
    abstract:
      "We study the problem of manuscript generation for agent collaboration workflows. We evaluate a thread-backed drafting pipeline against a stateless baseline on AgentBench-mini. Across repeated runs, the thread-backed pipeline improves revision stability by 0.05. These results suggest that persistent drafting support can improve revisability within the tested workflow setting.",
    keywords: ["agent collaboration", "paper writing"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [
          "The central problem in manuscript generation for agent collaboration workflows is that revisions often drift away from grounded evidence and earlier decisions.",
          "This paper evaluates whether thread-backed drafting can stabilize revision behavior while preserving evidence-grounded writing.",
          "The main gap is that current artifacts often expose headline outcomes without a venue-aware writing structure that separates core claims from supporting detail. The working hypothesis is that thread-backed drafting improves revisability.."
        ]
      },
      {
        heading: "Related Work",
        paragraphs: [
          "Prior work studies collaborative revision stability, while workflow benchmarking studies orchestration quality at the system level.",
          "Compared with those strands, this study focuses on whether persistent drafting state improves revisability under the same workflow setting."
        ]
      },
      {
        heading: "Method",
        paragraphs: [
          "We compare a thread-backed drafting workflow with a stateless baseline on the AgentBench-mini benchmark dataset.",
          "Both conditions use the same staged paper-writing pipeline within the same evaluation setup, and revision stability is the primary metric.",
          "Preprocessing details remain limited in the current artifacts and should be read conservatively. Model selection and reporting metrics remain partially specified in the current artifacts.",
          "Cross-validation and repetition details remain partially specified in the current artifacts."
        ]
      },
      {
        heading: "Results",
        paragraphs: [
          "On AgentBench-mini, the thread-backed condition improves revision stability by 0.05 relative to the stateless baseline.",
          "The main table preserves the exact dataset-level comparison and keeps the claim conservative.",
          "Stability remained consistent across repeated runs."
        ]
      },
      {
        heading: "Discussion",
        paragraphs: [
          "The result suggests that persistent drafting state reduces avoidable revision drift without implying broad generalization beyond the tested workflow.",
          "This interpretation matters because the gain is useful even though the evaluation setting remains narrow."
        ]
      },
      {
        heading: "Limitations",
        paragraphs: [
          "The evaluation is limited to one workflow benchmark and a small comparator set, so broader claims would require additional tasks and baselines."
        ]
      },
      {
        heading: "Conclusion",
        paragraphs: [
          "Within the tested workflow setting, thread-backed drafting improves revision stability and supports more consistent manuscript revision.",
          "The paper therefore reports a dense but cautious empirical narrative grounded in the available artifacts. Detailed protocol and repeat-level evidence are routed to the appendix so the main paper can retain its central logic."
        ]
      }
    ],
    tables: [
      {
        caption: "Exact numeric comparison for revision stability.",
        rows: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ],
    appendix_sections: [],
    appendix_tables: [],
    appendix_figures: [],
    ...(overrides || {})
  });
}

function buildWrappedRepairResponse(manuscript: Record<string, unknown>, overrides?: Partial<{
  resolved_target_anchor_ids: string[];
  changed_location_keys: string[];
  unchanged_anchor_ids_sample: string[];
  notes: string;
}>): string {
  return JSON.stringify({
    revised_manuscript: manuscript,
    resolved_target_anchor_ids: overrides?.resolved_target_anchor_ids || [],
    changed_location_keys: overrides?.changed_location_keys || [],
    unchanged_anchor_ids_sample: overrides?.unchanged_anchor_ids_sample || [],
    notes: overrides?.notes || "Applied only the requested local manuscript edits."
  });
}

function buildManuscriptRepairOnceResponses(): string[] {
  const initial = JSON.parse(buildPolishedManuscriptResponse()) as any;
  initial.sections[4].paragraphs[0] = initial.sections[0].paragraphs[0];
  const repaired = JSON.parse(buildPolishedManuscriptResponse()) as any;
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "paragraph_redundancy",
          severity: "warning",
          section: "Discussion",
          repairable: true,
          message: "Discussion repeats the opening framing from Introduction.",
          fix_recommendation: "Rewrite the Discussion opening to interpret the results instead of repeating the setup.",
          supporting_spans: [
            {
              section: "Discussion",
              paragraph_index: 0,
              excerpt: initial.sections[4].paragraphs[0],
              reason: "Repeated setup language appears in the discussion opening."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["paragraph:discussion:0"]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildSectionTransitionAdjacentRepairResponses(): string[] {
  const initial = JSON.parse(buildPolishedManuscriptResponse()) as any;
  initial.sections[3].paragraphs[0] =
    "The thread-backed condition improves revision stability by 0.05 relative to the stateless baseline on AgentBench-mini, using the same evaluation setup as the baseline.";
  initial.sections[3].paragraphs[1] =
    "The next results paragraph repeats setup details instead of moving into interpretation, so the local transition currently feels abrupt.";
  const repaired = JSON.parse(buildPolishedManuscriptResponse()) as any;
  repaired.sections[3].paragraphs[0] =
    "The thread-backed condition improves revision stability by 0.05 relative to the stateless baseline on AgentBench-mini, establishing the quantitative comparison before interpretation.";
  repaired.sections[3].paragraphs[1] =
    "This local transition matters because the next paragraph can now interpret the modest gain without reintroducing the setup.";
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "section_transition",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "The results opening does not transition naturally into the following interpretation paragraph.",
          fix_recommendation: "Revise the local bridge between the two results paragraphs without rewriting the section.",
          supporting_spans: [
            {
              section: "Results",
              paragraph_index: 0,
              excerpt: initial.sections[3].paragraphs[0],
              reason: "This paragraph needs a cleaner bridge into the next results paragraph."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["paragraph:results:0", "paragraph:results:1"]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildIntroductionAlignmentAdjacentRepairResponses(): string[] {
  const initial = JSON.parse(buildPolishedManuscriptResponse()) as any;
  initial.sections[0].paragraphs[0] =
    "Manuscript generation for agent collaboration workflows is difficult because revisions can drift away from grounded evidence and leave the overall story misaligned.";
  initial.sections[0].paragraphs[1] =
    "This paper evaluates whether thread-backed drafting can stabilize revision behavior, but the local framing does not yet line up tightly with the abstract and conclusion.";
  const repaired = JSON.parse(buildPolishedManuscriptResponse()) as any;
  repaired.sections[0].paragraphs[0] =
    "Manuscript generation for agent collaboration workflows is difficult because revisions can drift away from grounded evidence and obscure the tested contribution.";
  repaired.sections[0].paragraphs[1] =
    "This paper therefore evaluates whether thread-backed drafting stabilizes revision behavior within the tested workflow setting, matching the abstract and conclusion without broadening the claim.";
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "alignment",
          severity: "warning",
          section: "Introduction",
          repairable: true,
          message: "The introduction framing needs tighter alignment with the abstract and conclusion.",
          fix_recommendation: "Revise the local introduction framing without rewriting the whole section.",
          supporting_spans: [
            {
              section: "Introduction",
              paragraph_index: 1,
              excerpt: initial.sections[0].paragraphs[1],
              reason: "This framing paragraph should align more closely with the abstract and conclusion."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["paragraph:introduction:0", "paragraph:introduction:1"]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildVisualRedundancyPairRepairResponses(): string[] {
  const sharedTableRows = [
    { label: "Stateless baseline", value: 0.71 },
    { label: "Thread-backed drafting", value: 0.76 },
    { label: "Observed delta", value: 0.05 }
  ];
  const preservedTradeoffBars = [
    { label: "Latency-optimized", value: 0.52 },
    { label: "Accuracy-optimized", value: 0.61 },
    { label: "Balanced operating point", value: 0.57 }
  ];
  const initial = JSON.parse(
    buildPolishedManuscriptResponse({
      tables: [
        {
          caption: "Exact numeric comparison for revision stability.",
          rows: sharedTableRows
        }
      ],
      figures: [
        {
          caption: "A redundant bar chart restating the exact revision-stability comparison.",
          bars: sharedTableRows
        },
        {
          caption: "A separate tradeoff figure that should remain unchanged.",
          bars: preservedTradeoffBars
        }
      ]
    })
  ) as any;
  const repaired = JSON.parse(
    buildPolishedManuscriptResponse({
      tables: [
        {
          caption: "Exact numeric comparison for revision stability.",
          rows: sharedTableRows
        }
      ]
    })
  ) as any;
  repaired.figures = [
    {
      caption: "A trend-focused figure highlighting the relative stability gap without restating the full table.",
      bars: [
        { label: "Relative stability gap", value: 0.05 },
        { label: "Thread-backed drafting", value: 0.76 },
        { label: "Stateless baseline", value: 0.71 }
      ]
    },
    {
      caption: "A separate tradeoff figure that should remain unchanged.",
      bars: preservedTradeoffBars
    }
  ];
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      summary: "The manuscript reads well overall, but one visual pair is redundant.",
      issues: [
        {
          code: "visual_redundancy",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "Figure 1 restates Table 1 instead of adding a distinct visual pattern.",
          fix_recommendation: "Keep the exact table and revise Figure 1 so it communicates a narrower trend-focused takeaway.",
          visual_targets: [
            {
              kind: "table",
              index: 0,
              rationale: "Table 1 is one half of the redundant pair and should remain numerically precise."
            },
            {
              kind: "figure",
              index: 0,
              rationale: "Figure 1 is the redundant visual that should be revised into a distinct trend-focused figure."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["figure:0"]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildVisualCaptionOverclaimStopResponses(): string[] {
  const sharedTableRows = [
    { label: "Stateless baseline", value: 0.71 },
    { label: "Thread-backed drafting", value: 0.76 },
    { label: "Observed delta", value: 0.05 }
  ];
  const preservedTradeoffBars = [
    { label: "Latency-optimized", value: 0.52 },
    { label: "Accuracy-optimized", value: 0.61 },
    { label: "Balanced operating point", value: 0.57 }
  ];
  const initial = JSON.parse(
    buildPolishedManuscriptResponse({
      tables: [
        {
          caption: "Exact numeric comparison for revision stability.",
          rows: sharedTableRows
        }
      ],
      figures: [
        {
          caption: "A redundant bar chart restating the exact revision-stability comparison.",
          bars: sharedTableRows
        },
        {
          caption: "A separate tradeoff figure that should remain unchanged.",
          bars: preservedTradeoffBars
        }
      ]
    })
  ) as any;
  const repaired = JSON.parse(
    buildPolishedManuscriptResponse({
      tables: [
        {
          caption: "Exact numeric comparison for revision stability.",
          rows: sharedTableRows
        }
      ]
    })
  ) as any;
  repaired.figures = [
    {
      caption: "This figure clearly demonstrates broad applicability across domains.",
      bars: [
        { label: "Relative stability gap", value: 0.05 },
        { label: "Thread-backed drafting", value: 0.76 },
        { label: "Stateless baseline", value: 0.71 }
      ]
    },
    {
      caption: "A separate tradeoff figure that should remain unchanged.",
      bars: preservedTradeoffBars
    }
  ];
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      summary: "The manuscript reads well overall, but one visual pair is redundant.",
      issues: [
        {
          code: "visual_redundancy",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "Figure 1 restates Table 1 instead of adding a distinct visual pattern.",
          fix_recommendation: "Keep the exact table and revise Figure 1 so it communicates a narrower trend-focused takeaway.",
          visual_targets: [
            { kind: "table", index: 0, rationale: "Table 1 is one half of the redundant pair." },
            { kind: "figure", index: 0, rationale: "Figure 1 is the redundant visual that should be revised." }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["figure:0"]
    }),
    buildManuscriptReviewResponse({
      decision: "stop",
      issues: [
        {
          code: "rhetorical_overreach",
          severity: "fail",
          section: "Results",
          repairable: false,
          message: "The changed figure caption now claims broad applicability beyond the tested workflow setting.",
          fix_recommendation: "Constrain the figure caption to the observed workflow setting and the specific visual takeaway.",
          visual_targets: [
            {
              kind: "figure",
              index: 0,
              rationale: "Figure 1 caption is the local overclaiming surface after repair."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildAppendixHardStopResponses(): string[] {
  const contaminated = JSON.parse(
    buildPolishedManuscriptResponse({
      appendix_sections: [
        {
          heading: "Appendix. Notes",
          paragraphs: [
            "TODO: keep topic fixed and inspect .autolabos/runs/run-1/result_analysis.json before finalizing."
          ]
        }
      ]
    })
  ) as any;
  return [
    ...buildSessionResponses(),
    JSON.stringify(contaminated),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildAppendixBackstopRepairResponses(): string[] {
  const contaminated = JSON.parse(
    buildPolishedManuscriptResponse({
      appendix_sections: [
        {
          heading: "Appendix. Notes",
          paragraphs: [
            "TODO: keep topic fixed and inspect .autolabos/runs/run-1/result_analysis.json before finalizing."
          ]
        }
      ]
    })
  ) as any;
  const repaired = JSON.parse(
    buildPolishedManuscriptResponse({
      appendix_sections: [
        {
          heading: "Appendix. Notes",
          paragraphs: [
            "Supplementary protocol notes summarize the repeated-run setup without internal workflow residue."
          ]
        }
      ]
    })
  ) as any;
  return [
    ...buildSessionResponses(),
    JSON.stringify(contaminated),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "appendix_hygiene",
          severity: "fail",
          section: "Appendix",
          repairable: true,
          message: "The appendix contains internal planning language and raw artifact references.",
          fix_recommendation: "Replace the contaminated appendix note with reader-facing supplementary detail.",
          supporting_spans: [
            {
              section: "Appendix. Notes",
              paragraph_index: 0,
              excerpt: contaminated.appendix_sections[0].paragraphs[0],
              reason: "This appendix paragraph contains internal/meta residue."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["appendix_paragraph:appendix._notes:0"]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildTableCaptionOverclaimStopResponses(): string[] {
  const sharedTableRows = [
    { label: "Stateless baseline", value: 0.71 },
    { label: "Thread-backed drafting", value: 0.76 },
    { label: "Observed delta", value: 0.05 }
  ];
  const initial = JSON.parse(
    buildPolishedManuscriptResponse({
      tables: [
        {
          caption: "Exact numeric comparison for revision stability.",
          rows: sharedTableRows
        }
      ]
    })
  ) as any;
  const repaired = JSON.parse(
    buildPolishedManuscriptResponse({
      tables: [
        {
          caption: "This table clearly demonstrates broad applicability across domains.",
          rows: sharedTableRows
        }
      ]
    })
  ) as any;
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "visual_redundancy",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "Table 1 caption should be narrowed to a scoped numeric comparison.",
          fix_recommendation: "Keep the numeric table but constrain the caption to the tested setting.",
          visual_targets: [{ kind: "table", index: 0, rationale: "The table caption is the local repair surface." }]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["table:0"]
    }),
    buildManuscriptReviewResponse({
      decision: "stop",
      issues: [
        {
          code: "rhetorical_overreach",
          severity: "fail",
          section: "Results",
          repairable: false,
          message: "The changed table caption now claims broad applicability beyond the tested workflow setting.",
          fix_recommendation: "Constrain the table caption to the observed numeric comparison within the tested setting.",
          visual_targets: [{ kind: "table", index: 0, rationale: "Table 1 caption is now the overclaiming surface." }]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildVisualLabelOverclaimStopResponses(): string[] {
  const initial = JSON.parse(
    buildPolishedManuscriptResponse({
      figures: [
        {
          caption: "A trend-focused figure highlighting the relative stability gap.",
          bars: [
            { label: "Relative stability gap", value: 0.05 },
            { label: "Thread-backed drafting", value: 0.76 },
            { label: "Stateless baseline", value: 0.71 }
          ]
        }
      ]
    })
  ) as any;
  const repaired = JSON.parse(
    buildPolishedManuscriptResponse({
      figures: [
        {
          caption: "A trend-focused figure highlighting the relative stability gap.",
          bars: [
            { label: "Broad applicability across domains", value: 0.05 },
            { label: "Thread-backed drafting", value: 0.76 },
            { label: "Stateless baseline", value: 0.71 }
          ]
        }
      ]
    })
  ) as any;
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "visual_redundancy",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "Figure 1 should keep a scoped label for the changed trend bar.",
          fix_recommendation: "Keep the figure focused on the observed stability pattern within the tested setting.",
          visual_targets: [{ kind: "figure", index: 0, rationale: "Figure 1 is the local repair surface." }]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repaired, {
      changed_location_keys: ["figure:0"]
    }),
    buildManuscriptReviewResponse({
      decision: "stop",
      issues: [
        {
          code: "rhetorical_overreach",
          severity: "fail",
          section: "Results",
          repairable: false,
          message: "The changed figure label now overstates the scope of the observed pattern.",
          fix_recommendation: "Replace the changed label with a descriptive, scoped pattern label.",
          visual_targets: [{ kind: "figure", index: 0, rationale: "Figure 1 label is the local overclaiming surface." }]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildPartiallyGroundedRepairStopResponses(): string[] {
  const repair1 = JSON.parse(buildPolishedManuscriptResponse()) as any;
  repair1.sections[0].paragraphs[1] =
    "The introduction now frames the contribution around revision stability in the tested workflow setting.";
  return [
    ...buildSessionResponses(),
    buildPolishedManuscriptResponse(),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "paragraph_redundancy",
          severity: "warning",
          section: "Introduction",
          repairable: true,
          message: "Introduction framing overlaps with the abstract.",
          fix_recommendation: "Make the introduction's contribution framing more local and distinct.",
          supporting_spans: [
            {
              section: "Introduction",
              paragraph_index: 1,
              excerpt: "This paper evaluates whether thread-backed drafting can stabilize revision behavior while preserving evidence-grounded writing.",
              reason: "This paragraph repeats the abstract framing too closely."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repair1, {
      changed_location_keys: ["paragraph:introduction:1"]
    }),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "related_work_quality",
          severity: "warning",
          section: "Related Work",
          repairable: true,
          message: "Related Work still needs a sharper comparison axis.",
          fix_recommendation: "State the comparison axis more explicitly.",
          supporting_spans: [
            {
              section: "Related Work",
              paragraph_index: 1,
              excerpt: "Compared with those strands, this study focuses on whether persistent drafting state improves revisability under the same workflow setting.",
              reason: "The comparison axis is still usable but underspecified."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse({
      ok: true,
      artifact_reliability: "partially_grounded",
      retry_recommended: false,
      summary: "The follow-up review is usable, but one warning-level grounding mismatch remains.",
      issues: [
        {
          severity: "warning",
          code: "insufficient_grounding",
          section: "Related Work",
          message: "The surviving Related Work issue is directionally useful but not fully grounded enough for another repair pass.",
          fix_recommendation: "Do not spend a second repair pass on a partially grounded review artifact."
        }
      ]
    })
  ];
}

function buildManuscriptRepairTwiceResponses(options?: { unresolvedAfterSecond?: boolean }): string[] {
  const repair1 = JSON.parse(buildPolishedManuscriptResponse()) as any;
  repair1.sections[0].paragraphs[1] =
    "The introduction frames the contribution around revision stability in the tested workflow setting, rather than repeating the abstract framing.";
  const repair2 = JSON.parse(buildPolishedManuscriptResponse()) as any;
  repair2.sections[0].paragraphs[1] = repair1.sections[0].paragraphs[1];
  repair2.sections[1].paragraphs = [
    "Prior work studies collaborative revision stability, while workflow benchmarking studies orchestration quality at the system level.",
    "Compared with those strands, the current study isolates persistent drafting state within a single workflow setting, making the comparison axis explicit rather than leaving it implied."
  ];
  const finalDecision = options?.unresolvedAfterSecond
    ? buildManuscriptReviewResponse({
        decision: "repair",
        issues: [
          {
            code: "alignment",
            severity: "warning",
            section: "Conclusion",
            repairable: true,
            message: "Conclusion still needs a slightly tighter alignment with the abstract.",
            fix_recommendation: "Tighten the conclusion to mirror the abstract's scope."
          }
        ]
      })
    : buildManuscriptReviewResponse({ decision: "pass" });
  return [
    ...buildSessionResponses(),
    buildPolishedManuscriptResponse(),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "paragraph_redundancy",
          severity: "warning",
          section: "Introduction",
          repairable: true,
          message: "Introduction and abstract use overlapping framing.",
          fix_recommendation: "Make the introduction's second paragraph contribution-oriented.",
          supporting_spans: [
            {
              section: "Introduction",
              paragraph_index: 1,
              excerpt: "This paper evaluates whether thread-backed drafting can stabilize revision behavior while preserving evidence-grounded writing.",
              reason: "The contribution framing is too close to the abstract."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repair1, {
      changed_location_keys: ["paragraph:introduction:1"]
    }),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "related_work_quality",
          severity: "warning",
          section: "Related Work",
          repairable: true,
          message: "Related Work still needs a sharper comparison axis.",
          fix_recommendation: "State the comparison axis explicitly and contrast prior strands with the current study.",
          supporting_spans: [
            {
              section: "Related Work",
              paragraph_index: 1,
              excerpt: repair1.sections[1].paragraphs[1],
              reason: "The comparison axis is still underspecified."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(repair2, {
      changed_location_keys: ["paragraph:related_work:0", "paragraph:related_work:1"]
    }),
    finalDecision,
    buildManuscriptReviewAuditResponse()
  ];
}

function buildRepeatedLintRepairResponses(): string[] {
  const contaminated = JSON.parse(buildPolishedManuscriptResponse({
    abstract:
      "We study the problem of manuscript generation for agent collaboration workflows. We evaluate a thread-backed drafting pipeline against a stateless baseline on AgentBench-mini. Across repeated runs, the thread-backed pipeline improves revision stability by 0.05. These results clearly demonstrate broad applicability beyond the tested workflow setting."
  })) as any;
  return [
    ...buildSessionResponses(),
    JSON.stringify(contaminated),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "rhetorical_overreach",
          severity: "fail",
          section: "Abstract",
          repairable: true,
          message: "Abstract overstates the scope of the evidence.",
          fix_recommendation: "Constrain the abstract to the tested workflow setting.",
          supporting_spans: [
            {
              section: "Abstract",
              paragraph_index: 0,
              excerpt: "These results clearly demonstrate broad applicability beyond the tested workflow setting.",
              reason: "This sentence exceeds the available evidence scope."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    JSON.stringify(contaminated),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "rhetorical_overreach",
          severity: "fail",
          section: "Abstract",
          repairable: true,
          message: "Abstract still overstates the scope of the evidence.",
          fix_recommendation: "Constrain the abstract to the tested workflow setting.",
          supporting_spans: [
            {
              section: "Abstract",
              paragraph_index: 0,
              excerpt: "These results clearly demonstrate broad applicability beyond the tested workflow setting.",
              reason: "The same unsupported generalization remains."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildOutOfScopeRepairResponses(): string[] {
  const initial = JSON.parse(buildPolishedManuscriptResponse()) as any;
  initial.sections[4].paragraphs[0] = initial.sections[0].paragraphs[0];
  const overbroad = JSON.parse(buildPolishedManuscriptResponse()) as any;
  overbroad.sections[0].paragraphs[0] = "This unrelated introduction rewrite should violate bounded local repair scope.";
  overbroad.sections[4].paragraphs[0] =
    "The discussion now interprets the result instead of repeating the introduction framing.";
  return [
    ...buildSessionResponses(),
    JSON.stringify(initial),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "paragraph_redundancy",
          severity: "warning",
          section: "Discussion",
          repairable: true,
          message: "Discussion repeats the introduction framing.",
          fix_recommendation: "Rewrite only the discussion opening so it interprets the result.",
          supporting_spans: [
            {
              section: "Discussion",
              paragraph_index: 0,
              excerpt: initial.sections[4].paragraphs[0],
              reason: "This is the duplicated discussion opening."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewAuditResponse(),
    buildWrappedRepairResponse(overbroad, {
      changed_location_keys: ["paragraph:introduction:0", "paragraph:discussion:0"]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

function buildReviewRetryResponses(): string[] {
  return [
    ...buildSessionResponses(),
    buildPolishedManuscriptResponse(),
    buildManuscriptReviewResponse({
      decision: "repair",
      issues: [
        {
          code: "alignment",
          severity: "warning",
          section: "Abstract",
          repairable: true,
          message: "Abstract and conclusion need tighter scope alignment.",
          fix_recommendation: "Keep both sections scoped to the tested workflow setting.",
          supporting_spans: [
            {
              section: "Abstract",
              paragraph_index: 9,
              excerpt: "This span points to a paragraph that does not exist.",
              reason: "Malformed grounding from the first review."
            }
          ]
        }
      ]
    }),
    buildManuscriptReviewResponse({ decision: "pass" }),
    buildManuscriptReviewAuditResponse()
  ];
}

async function overwriteRunArtifacts(run: RunRecord, files: Record<string, string>): Promise<void> {
  const runDir = path.join(process.cwd(), ".autolabos", "runs", run.id);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(runDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
}

async function writeLatestResults(run: RunRecord, payload: Record<string, unknown>): Promise<void> {
  const analysisDir = buildPublicAnalysisDir(process.cwd(), run);
  await mkdir(analysisDir, { recursive: true });
  await writeFile(path.join(analysisDir, "latest_results.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildWeakScientificResponses(): string[] {
  const outline = JSON.stringify({
    title: "Weak Benchmark Note",
    abstract_focus: ["weak evidence", "cautious benchmark framing"],
    section_headings: ["Introduction", "Method", "Results", "Conclusion"],
    key_claim_themes: ["The benchmark suggests a small positive delta."],
    citation_plan: ["paper_1"]
  });
  const draft = JSON.stringify({
    title: "Weak Benchmark Note",
    abstract: "A short benchmark note.",
    keywords: ["benchmark"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["We study a small benchmark run."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Method",
        paragraphs: ["We compare two workflows on one public dataset."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Results",
        paragraphs: ["The method demonstrates significant improvement."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The benchmark is promising."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "The method demonstrates significant improvement.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is cautious but still terse.",
    revision_notes: ["Keep the benchmark framing explicit."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  const manuscript = JSON.stringify({
    title: "Weak Benchmark Note",
    abstract: "This study demonstrates significant improvement on the benchmark.",
    keywords: ["benchmark"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["We study a small benchmark run."]
      },
      {
        heading: "Method",
        paragraphs: ["We compare two workflows on one public dataset."]
      },
      {
        heading: "Results",
        paragraphs: ["The benchmark suggests a positive delta under this benchmark."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The evidence remains limited but encouraging."]
      }
    ]
  });
  return [outline, draft, review, manuscript];
}

function buildMediumScientificResponses(): string[] {
  const outline = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract_focus: ["nested evaluation", "resource-aware results", "appendix-aware paper"],
    section_headings: ["Introduction", "Related Work", "Method", "Results", "Discussion", "Limitations", "Conclusion"],
    key_claim_themes: ["The benchmark suggests small positive deltas under repeated evaluation."],
    citation_plan: ["paper_1", "paper_2", "paper_3"]
  });
  const sharedParagraph =
    "The manuscript keeps claims scoped to the available repeated-evaluation artifacts while still describing protocol choices, resource measurements, and dataset-specific behavior in enough detail for a full paper.";
  const draft = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract: "A richer benchmark manuscript with appendix-aware reporting.",
    keywords: ["benchmark", "tabular", "reproducibility"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [
          "We study repeated tabular benchmarking under constrained compute settings.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2"]
      },
      {
        heading: "Related Work",
        paragraphs: [
          "Prior work spans nested validation, CPU-only tree baselines, and reproducibility notes for repeated evaluation.",
          "The closest prior work reports smaller empirical scopes, while the present study emphasizes cautious positioning rather than broad novelty."
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2", "paper_3"]
      },
      {
        heading: "Method",
        paragraphs: [
          "We evaluate breast_cancer and iris with explicit preprocessing, nested cross-validation, and fixed seeds.",
          "The protocol fits preprocessing within each fold and records runtime and peak memory for the compared workflows.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2"]
      },
      {
        heading: "Results",
        paragraphs: [
          "The strongest workflow yields a small positive macro-F1 delta over logistic regression.",
          "Dataset-level behavior varies, so the study reports uncertainty, runtime, and memory together with the main score.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_3"]
      },
      {
        heading: "Discussion",
        paragraphs: [
          "The outcome is best framed as a benchmark note with bounded empirical scope.",
          sharedParagraph
        ],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_3"]
      },
      {
        heading: "Limitations",
        paragraphs: ["The dataset scope is narrow and repeated CV does not justify broad inferential language."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_3"]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The paper keeps its central logic in the main body while routing detailed repeat-level artifacts to the appendix."],
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_2", "paper_3"]
      }
    ],
    claims: [
      {
        claim_id: "c1",
        statement: "The strongest workflow suggests a small positive delta under repeated evaluation.",
        section_heading: "Results",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1", "paper_3"]
      }
    ]
  });
  const review = JSON.stringify({
    summary: "The draft is grounded and uses the appendix appropriately.",
    revision_notes: ["Keep the discussion cautious and preserve the main-body result table."],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: []
  });
  const manuscript = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract: "A richer benchmark manuscript with appendix-aware reporting.",
    keywords: ["benchmark", "tabular", "reproducibility"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [
          "We study repeated tabular benchmarking under constrained compute settings.",
          sharedParagraph
        ]
      },
      {
        heading: "Related Work",
        paragraphs: [
          "Prior work spans nested validation, CPU-only tree baselines, and reproducibility notes for repeated evaluation.",
          "The closest prior work reports smaller empirical scopes, while the present study emphasizes cautious positioning rather than broad novelty."
        ]
      },
      {
        heading: "Method",
        paragraphs: [
          "We evaluate breast_cancer and iris with explicit preprocessing, nested cross-validation, and fixed seeds.",
          "The protocol fits preprocessing within each fold and records runtime and peak memory for the compared workflows.",
          sharedParagraph
        ]
      },
      {
        heading: "Results",
        paragraphs: [
          "The strongest workflow yields a small positive macro-F1 delta over logistic regression.",
          "Dataset-level behavior varies, so the study reports uncertainty, runtime, and memory together with the main score.",
          sharedParagraph
        ]
      },
      {
        heading: "Discussion",
        paragraphs: [
          "The outcome is best framed as a benchmark note with bounded empirical scope.",
          sharedParagraph
        ]
      },
      {
        heading: "Limitations",
        paragraphs: ["The dataset scope is narrow and repeated CV does not justify broad inferential language."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The paper keeps its central logic in the main body while routing detailed repeat-level artifacts to the appendix."]
      }
    ]
  });
  return [outline, draft, review, manuscript];
}

function buildInconsistentScientificResponses(): string[] {
  const base = buildMediumScientificResponses();
  const inconsistentManuscript = JSON.stringify({
    title: "Repeated Tabular Benchmark",
    abstract: "We improve macro-F1 by 0.2 across 8 datasets.",
    keywords: ["benchmark", "tabular", "reproducibility"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: ["We study repeated tabular benchmarking under constrained compute settings."]
      },
      {
        heading: "Method",
        paragraphs: ["We evaluate 2 datasets with outer 5-fold CV, inner 3-fold tuning, and 3 repeats."]
      },
      {
        heading: "Results",
        paragraphs: ["The strongest workflow yields a macro-F1 delta of 0.026 across 2 datasets."]
      },
      {
        heading: "Conclusion",
        paragraphs: ["The study shows significant improvement across 8 datasets."]
      }
    ]
  });
  return [...base.slice(0, 3), inconsistentManuscript];
}

function buildMediumResultAnalysis(): Record<string, unknown> {
  return {
    objective_metric: {
      evaluation: {
        summary: "Observed a small positive macro-F1 delta over logistic regression on the strongest workflow."
      },
      profile: {
        preferred_metric_keys: ["macro_f1_delta_vs_logreg"]
      }
    },
    metric_table: [
      { key: "macro_f1_delta_vs_logreg", value: 0.026 },
      { key: "pairwise_ranking_agreement", value: 0.885 },
      { key: "runtime_seconds_mean", value: 1.05 },
      { key: "peak_memory_mb_mean", value: 149 }
    ],
    primary_findings: [
      "The strongest workflow suggests a small positive macro-F1 delta over logistic regression.",
      "Runtime and memory remain close across the compared workflows."
    ],
    limitations: [
      "The delta is small and varies by dataset.",
      "Repeated CV does not justify strong inferential language."
    ],
    statistical_summary: {
      notes: [
        "Dispersion across repeated runs is moderate rather than negligible.",
        "Heterogeneity remains visible across datasets."
      ],
      confidence_intervals: [
        {
          metric_key: "macro_f1_delta_vs_logreg",
          label: "Macro-F1 delta",
          lower: 0.015,
          upper: 0.036,
          level: 0.95,
          source: "metrics",
          summary: "The 95% interval for the macro-F1 delta spans 0.015 to 0.036."
        }
      ],
      effect_estimates: [
        {
          comparison_id: "non_nested_vs_nested",
          metric_key: "macro_f1_delta_vs_logreg",
          delta: 0.026,
          direction: "positive",
          summary: "The estimated macro-F1 delta remains positive but modest."
        }
      ]
    },
    figure_specs: [
      {
        id: "delta_overview",
        title: "Dataset-level macro-F1 deltas",
        path: "figures/delta.svg",
        metric_keys: ["macro_f1_delta_vs_logreg"],
        summary: "Dataset-level macro-F1 deltas with uncertainty-aware interpretation."
      }
    ],
    synthesis: {
      source: "fallback",
      discussion_points: [
        "The observed gain is consistent with a benchmark note rather than a broad method claim."
      ],
      failure_analysis: [],
      follow_up_actions: [],
      confidence_statement: "Confidence is moderate because repeated evaluations exist, but dataset scope remains narrow."
    }
  };
}

function buildMediumLatestResults(): Record<string, unknown> {
  return {
    protocol: {
      dataset_source: "OpenML",
      datasets: ["breast_cancer", "iris"],
      models: ["logreg", "extra_trees"],
      workflows: ["nested", "non_nested"],
      repeats: 3,
      seed_schedule: [100, 101, 102],
      n_samples: 569,
      n_features: 30,
      n_classes: 2
    },
    dataset_summaries: [
      {
        dataset: "breast_cancer",
        workflows: {
          non_nested: {
            models: {
              logreg: { mean_test_macro_f1: 0.91 },
              extra_trees: { mean_test_macro_f1: 0.944, mean_delta_vs_logreg: 0.034 }
            },
            pairwise_ranking_agreement: 0.9,
            winner_consistency: 1,
            runtime_seconds_mean: 0.95,
            peak_memory_mb_mean: 151
          }
        }
      },
      {
        dataset: "iris",
        workflows: {
          non_nested: {
            models: {
              logreg: { mean_test_macro_f1: 0.89 },
              extra_trees: { mean_test_macro_f1: 0.918, mean_delta_vs_logreg: 0.028 }
            },
            pairwise_ranking_agreement: 0.88,
            winner_consistency: 1,
            runtime_seconds_mean: 0.82,
            peak_memory_mb_mean: 150
          }
        }
      }
    ],
    repeat_records: [
      {
        repeat_index: 0,
        datasets: [
          {
            dataset: "breast_cancer",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.91 },
                  extra_trees: { test_macro_f1: 0.945 }
                }
              }
            }
          },
          {
            dataset: "iris",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.89 },
                  extra_trees: { test_macro_f1: 0.919 }
                }
              }
            }
          }
        ]
      },
      {
        repeat_index: 1,
        datasets: [
          {
            dataset: "breast_cancer",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.91 },
                  extra_trees: { test_macro_f1: 0.944 }
                }
              }
            }
          },
          {
            dataset: "iris",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.89 },
                  extra_trees: { test_macro_f1: 0.918 }
                }
              }
            }
          }
        ]
      },
      {
        repeat_index: 2,
        datasets: [
          {
            dataset: "breast_cancer",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.91 },
                  extra_trees: { test_macro_f1: 0.943 }
                }
              }
            }
          },
          {
            dataset: "iris",
            workflows: {
              non_nested: {
                models: {
                  logreg: { test_macro_f1: 0.89 },
                  extra_trees: { test_macro_f1: 0.917 }
                }
              }
            }
          }
        ]
      }
    ]
  };
}

async function seedMediumScientificRun(run: RunRecord): Promise<void> {
  await overwriteRunArtifacts(run, {
    "paper_summaries.jsonl": [
      {
        paper_id: "paper_1",
        title: "Nested Validation for Tabular Baselines",
        source_type: "full_text",
        summary: "Nested validation stabilizes model selection in small tabular benchmarks.",
        key_findings: ["Nested validation reduces selection optimism."],
        limitations: ["Compute cost rises with repeated evaluation."],
        datasets: ["breast_cancer", "iris"],
        metrics: ["macro_f1"],
        novelty: "Evaluation and benchmarking for small tabular datasets",
        reproducibility_notes: ["Explicit seeds and folds are reported."]
      },
      {
        paper_id: "paper_2",
        title: "CPU-Only Tree Baselines",
        source_type: "full_text",
        summary: "Tree ensembles offer small gains over logistic regression on public datasets.",
        key_findings: ["Extra trees produce small positive deltas on some datasets."],
        limitations: ["Gains vary by dataset."],
        datasets: ["breast_cancer", "iris"],
        metrics: ["macro_f1_delta_vs_logreg"],
        novelty: "Classical model comparison under CPU-only constraints",
        reproducibility_notes: ["OpenML datasets and seed schedules are listed."]
      },
      {
        paper_id: "paper_3",
        title: "Reproducibility Notes for Repeated CV",
        source_type: "full_text",
        summary: "Repeated CV supports cautious, not universal, claims about ranking stability.",
        key_findings: ["Repeated evaluation exposes heterogeneity."],
        limitations: ["Repeated CV does not justify strong inferential language."],
        datasets: ["OpenML tabular suites"],
        metrics: ["pairwise_ranking_agreement"],
        novelty: "Reproducibility framing for repeated evaluation",
        reproducibility_notes: ["Intervals and heterogeneity are emphasized."]
      }
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "corpus.jsonl": [
      {
        paper_id: "paper_1",
        title: "Nested Validation for Tabular Baselines",
        abstract: "Nested validation stabilizes model selection in small tabular benchmarks.",
        authors: ["Alice Doe"],
        year: 2025,
        venue: "ACL Findings"
      },
      {
        paper_id: "paper_2",
        title: "CPU-Only Tree Baselines",
        abstract: "Tree ensembles offer small gains over logistic regression on public datasets.",
        authors: ["Bob Doe"],
        year: 2024,
        venue: "EMNLP"
      },
      {
        paper_id: "paper_3",
        title: "Reproducibility Notes for Repeated CV",
        abstract: "Repeated CV supports cautious, not universal, claims about ranking stability.",
        authors: ["Cara Doe"],
        year: 2024,
        venue: "TMLR"
      }
    ].map((row) => JSON.stringify(row)).join("\n") + "\n",
    "experiment_plan.yaml": [
      "selected_design:",
      '  title: "Repeated CPU-only tabular baseline comparison"',
      "  datasets:",
      '    - "breast_cancer"',
      '    - "iris"',
      "  metrics:",
      '    - "macro_f1_delta_vs_logreg"',
      '    - "pairwise_ranking_agreement"',
      "  baselines:",
      '    - "logistic regression"',
      '    - "extra trees"',
      "  implementation_notes:",
      '    - "OpenML datasets with 569 samples, 30 features, and 2 classes are used."',
      '    - "Standardize numeric columns, impute missing values, and fit preprocessing within each fold."',
      '    - "Class imbalance is tracked explicitly."',
      "  evaluation_steps:",
      '    - "Run outer 5-fold CV with inner 3-fold tuning."',
      '    - "Use stratified splits and repeat each workflow across fixed random seeds."',
      "  resource_notes:",
      '    - "Hyperparameter grid includes max_depth, n_estimators, and C."'
    ].join("\n"),
    "result_analysis.json": `${JSON.stringify(buildMediumResultAnalysis(), null, 2)}\n`
  });
  await writeLatestResults(run, buildMediumLatestResults());
}

function createPdfBuildAci(options?: { failFirstCompile?: boolean; failAllCompiles?: boolean; pdfPageCount?: number }) {
  const commands: string[] = [];
  let firstCompileFailed = false;

  return {
    commands,
    api: {
      async runCommand(command: string, cwd?: string) {
        commands.push(command);
        if (!cwd) {
          throw new Error("Expected cwd for paper compilation.");
        }
        if (options?.failAllCompiles && command.startsWith("pdflatex")) {
          return {
            status: "error" as const,
            stdout: "",
            stderr: "main.tex:42: Undefined control sequence \\badcommand",
            exit_code: 1,
            duration_ms: 5
          };
        }
        if (options?.failFirstCompile && !firstCompileFailed && command.startsWith("pdflatex")) {
          firstCompileFailed = true;
          return {
            status: "error" as const,
            stdout: "",
            stderr: "main.tex:42: Undefined control sequence \\badcommand",
            exit_code: 1,
            duration_ms: 5
          };
        }
        if (command.startsWith("pdflatex")) {
          await writeFile(path.join(cwd, "main.pdf"), "%PDF-1.4 mock\n", "utf8");
          return {
            status: "ok" as const,
            stdout: "Output written on main.pdf",
            stderr: "",
            exit_code: 0,
            duration_ms: 5
          };
        }
        if (command === "bibtex main") {
          return {
            status: "ok" as const,
            stdout: "This is BibTeX, Version 0.99d",
            stderr: "",
            exit_code: 0,
            duration_ms: 2
          };
        }
        if (command === "pdfinfo main.pdf") {
          return {
            status: "ok" as const,
            stdout: `Title: mock\nPages: ${options?.pdfPageCount ?? 8}\n`,
            stderr: "",
            exit_code: 0,
            duration_ms: 1
          };
        }
        return {
          status: "error" as const,
          stdout: "",
          stderr: `Unexpected command: ${command}`,
          exit_code: 1,
          duration_ms: 1
        };
      }
    }
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("writePaper PDF build", () => {
  it("runs a related-work scout and allows the writer to cite scout-only papers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-related-work-scout-"));
    process.chdir(root);

    const run = makeRun("run-paper-related-work-scout");
    const runDir = await seedRun(root, run);
    const requests: Array<{ query: string; limit: number }> = [];
    const semanticScholar = {
      async searchPapers(request: { query: string; limit: number }) {
        requests.push({ query: request.query, limit: request.limit });
        const paperIndex = requests.length;
        return [
          {
            paperId: `paper_scout_${paperIndex}`,
            title: paperIndex === 1 ? "Scout Results for Related Work" : "Coverage Backfill for Related Work",
            abstract: "A lightweight scouting pass can expand related-work coverage during drafting.",
            year: 2024,
            venue: paperIndex === 1 ? "EMNLP" : "NAACL",
            authors: ["Sam Scout"],
            citationCount: 17 + paperIndex,
            url: `https://example.org/scout-results-${paperIndex}`,
            openAccessPdfUrl: `https://example.org/scout-results-${paperIndex}.pdf`
          }
        ];
      }
    };

    const node = createWritePaperNode({
      config: {
        providers: {
          llm_mode: "openai_api"
        },
        paper: {
          build_pdf: false
        },
        analysis: {
          responses_model: "gpt-5.4"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildRelatedWorkScoutResponses()),
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: semanticScholar as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => true,
        analyzePdf: async ({ pdfUrl }: { pdfUrl: string }) => ({
          text: JSON.stringify({
            summary: `Full-text summary for ${pdfUrl}.`,
            key_findings: ["Full-text related-work analysis recovered a grounded positioning signal."],
            limitations: ["The PDF analysis focuses on related-work positioning rather than experimental reproduction."],
            datasets: ["AgentBench-mini"],
            metrics: ["reproducibility_score"],
            novelty: "Full-text scout enrichment for related work",
            reproducibility_notes: ["The PDF source was read directly during write_paper."],
            evidence_items: [
              {
                claim: "The paper frames revision stability as a coordination problem.",
                method_slot: "related-work framing",
                result_slot: "positioning evidence",
                limitation_slot: "bounded enrichment",
                dataset_slot: "AgentBench-mini",
                metric_slot: "reproducibility_score",
                evidence_span: "The full paper highlights revision stability and coordination tradeoffs.",
                confidence: 0.78,
                confidence_reason: "The enrichment is grounded in the full PDF input."
              }
            ]
          })
        })
      } as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.query).toContain("agent collaboration");
    expect(requests[0]?.query).toContain("Thread-backed drafting benchmark");
    expect(requests[1]?.query).toContain("agent collaboration");

    const scoutRequest = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "request.json"), "utf8")
    ) as { query: string; planned_queries: Array<{ id: string }> };
    expect(scoutRequest.query).toContain("agent collaboration");
    expect(scoutRequest.planned_queries.length).toBeGreaterThanOrEqual(2);

    const scoutPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "plan.json"), "utf8")
    ) as { planned_queries: Array<{ id: string }> };
    expect(scoutPlan.planned_queries.length).toBeGreaterThanOrEqual(2);

    const scoutResult = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "result.json"), "utf8")
    ) as { status: string; paper_count: number };
    expect(scoutResult).toMatchObject({
      status: "collected",
      paper_count: 2
    });

    const coverageAudit = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "coverage_audit.json"), "utf8")
    ) as { status: string; executed_queries: Array<{ query: string }>; stop_reason: string };
    expect(coverageAudit.status).toBe("sufficient");
    expect(coverageAudit.executed_queries).toHaveLength(2);
    expect(coverageAudit.stop_reason).toMatch(/venue diversity|citation gap|target additional paper count/i);

    expect(await exists(path.join(runDir, "paper", "related_work_scout", "corpus.jsonl"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "related_work_scout", "bibtex.bib"))).toBe(true);
    const enrichmentResult = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_scout", "enrichment_result.json"), "utf8")
    ) as { status: string; analyzed_paper_count: number; full_text_count: number };
    expect(enrichmentResult).toMatchObject({
      status: "completed",
      analyzed_paper_count: 2,
      full_text_count: 2
    });
    const enrichmentSummaries = await readFile(
      path.join(runDir, "paper", "related_work_scout", "enrichment_summaries.jsonl"),
      "utf8"
    );
    expect(enrichmentSummaries).toContain('"paper_id":"paper_scout_1"');
    expect(enrichmentSummaries).toContain('"source_type":"full_text"');

    const relatedWorkNotes = JSON.parse(
      await readFile(path.join(runDir, "paper", "related_work_notes.json"), "utf8")
    ) as { note_count: number; comparison_axes: string[]; paragraph_plan: Array<{ role: string }> };
    expect(relatedWorkNotes.note_count).toBeGreaterThanOrEqual(3);
    expect(relatedWorkNotes.comparison_axes.length).toBeGreaterThan(0);
    expect(relatedWorkNotes.paragraph_plan).toHaveLength(2);

    const draft = JSON.parse(await readFile(path.join(runDir, "paper", "draft.json"), "utf8")) as {
      sections: Array<{ heading: string; paragraphs: Array<{ text: string }>; citation_paper_ids: string[] }>;
    };
    const relatedWorkSection = draft.sections.find((section) => section.heading === "Related Work");
    expect(relatedWorkSection?.citation_paper_ids).toContain("paper_scout_1");
    expect(relatedWorkSection?.paragraphs.length).toBe(2);
    expect(relatedWorkSection?.paragraphs[1]?.text).toMatch(/current study|present study/i);

    const references = await readFile(path.join(runDir, "paper", "references.bib"), "utf8");
    expect(references).toContain("Scout Results for Related Work");
    expect(references).toContain("Coverage Backfill for Related Work");

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.cited_paper_ids")).toContain("paper_scout_1");
    expect(await memory.get("write_paper.related_work_scout")).toMatchObject({
      status: "collected",
      paper_count: 2,
      planned_query_count: 3,
      executed_query_count: 2,
      coverage_status: "sufficient"
    });
    expect(await memory.get("write_paper.related_work_notes")).toMatchObject({
      note_count: 3
    });
    expect(await memory.get("write_paper.related_work_enrichment")).toMatchObject({
      analyzed_paper_count: 2,
      full_text_count: 2
    });
  });

  it("recovers missing citations through bounded external verification before building references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-external-citation-"));
    process.chdir(root);

    const run = makeRun("run-paper-external-citation");
    const runDir = await seedRun(root, run);
    await appendFile(
      path.join(runDir, "paper_summaries.jsonl"),
      `${JSON.stringify({
        paper_id: "Recovered External Title",
        title: "Recovered External Title",
        source_type: "full_text",
        summary: "A placeholder summary keeps the citation id alive through draft normalization.",
        key_findings: ["The missing citation should be recovered externally before bibliography generation."],
        limitations: ["This summary exists only to exercise the bounded external citation-repair path."],
        datasets: [],
        metrics: [],
        novelty: "External citation verification",
        reproducibility_notes: []
      })}\n`,
      "utf8"
    );
    const node = createWritePaperNode({
      config: {
        providers: {
          llm_mode: "openai_api"
        },
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildExternalCitationResponses()),
      pdfTextLlm: {} as any,
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {
        async searchPapers(request: { query: string; limit: number }) {
          expect(request.query).toBe("Recovered External Title");
          expect(request.limit).toBe(5);
          return [
            {
              paperId: "s2_recovered_external",
              title: "Recovered External Title",
              abstract: "Recovered from bounded external verification.",
              authors: ["Eve Resolver"],
              year: 2025,
              venue: "ACL",
              doi: "10.1000/recovered-external",
              url: "https://example.org/recovered-external",
              citationStylesBibtex:
                "@article{recovered_external,title={Recovered External Title},doi={10.1000/recovered-external},url={https://example.org/recovered-external}}"
            }
          ];
        }
      } as any,
      responsesPdfAnalysis: {
        hasApiKey: async () => false
      } as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");

    const verifiedRegistry = JSON.parse(
      await readFile(path.join(runDir, "paper", "verified_registry.json"), "utf8")
    ) as {
      counts: Record<string, number>;
      entries: Array<{
        citation_paper_id: string;
        status: string;
        resolved_via?: string;
        provider?: string;
      }>;
    };
    expect(verifiedRegistry.counts.unverified).toBe(1);
    const externalEntry = verifiedRegistry.entries.find(
      (entry) => entry.citation_paper_id === "Recovered External Title"
    );
    expect(externalEntry).toMatchObject({
      citation_paper_id: "Recovered External Title",
      status: "unverified",
      resolved_via: "external_provider",
      provider: "semantic_scholar"
    });

    const references = await readFile(path.join(runDir, "paper", "references.bib"), "utf8");
    expect(references).toContain("Recovered External Title");
    expect(references).toContain("10.1000/recovered-external");

    const readinessRisks = JSON.parse(
      await readFile(path.join(runDir, "paper", "readiness_risks.json"), "utf8")
    ) as {
      risks: Array<{ category: string; affected_citation_ids: string[]; status: string }>;
    };
    expect(readinessRisks.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "citation_source",
          status: "unverified",
          affected_citation_ids: ["Recovered External Title"]
        })
      ])
    );
  });

  it("runs one validation repair pass before rendering when warnings accumulate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-validation-repair-"));
    process.chdir(root);

    const run = makeRun("run-paper-validation-repair");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildValidationRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("after one automatic validation repair (1 -> 0)");

    const validation = JSON.parse(await readFile(path.join(runDir, "paper", "validation.json"), "utf8")) as {
      issues: Array<{ message: string }>;
    };
    expect(validation.issues).toHaveLength(0);

    const repairReport = JSON.parse(
      await readFile(path.join(runDir, "paper", "validation_repair_report.json"), "utf8")
    ) as {
      attempted: boolean;
      applied: boolean;
      initial_warning_count: number;
      final_warning_count: number;
    };
    expect(repairReport).toMatchObject({
      attempted: true,
      applied: true,
      initial_warning_count: 1,
      final_warning_count: 0
    });

    const traceRaw = await readFile(path.join(runDir, "paper", "session_trace.json"), "utf8");
    expect(traceRaw).toContain('"stage": "validation_repair"');

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.validation_repair")).toMatchObject({
      attempted: true,
      applied: true,
      initial_warning_count: 1,
      final_warning_count: 0
    });
  });

  it("builds a paper PDF and publishes the compiled artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-success");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci();

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          latex_engine: "auto_install"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("PDF: built successfully");
    expect(aci.commands).toEqual([
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "bibtex main",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdfinfo main.pdf"
    ]);

    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compile_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "traceability.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "submission_validation.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compiled_page_validation.json"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "build.log"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "manuscript.json"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "traceability.json"))).toBe(true);

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ status: string }>;
    };
    expect(report.status).toBe("success");
    expect(report.repaired).toBe(false);
    expect(report.attempts).toHaveLength(1);
    const submissionValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "submission_validation.json"), "utf8")
    ) as { ok: boolean; issues: unknown[] };
    expect(submissionValidation.ok).toBe(true);
    expect(submissionValidation.issues).toHaveLength(0);
    const compiledPageValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "compiled_page_validation.json"), "utf8")
    ) as {
      status: string;
      compiled_pdf_page_count: number;
      minimum_main_pages: number;
      target_main_pages: number;
      main_page_limit: number;
    };
    expect(compiledPageValidation.status).toBe("pass");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(8);
    expect(compiledPageValidation.minimum_main_pages).toBe(8);
    expect(compiledPageValidation.target_main_pages).toBe(8);
    expect(compiledPageValidation.main_page_limit).toBe(8);

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("success");
    expect(await memory.get("write_paper.pdf_path")).toBe(
      path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
    );
  });

  it("fails before PDF build when submission validation catches raw evidence ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-submission-validation-"));
    process.chdir(root);

    const run = makeRun("run-paper-submission-validation");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci();

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: true
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSubmissionValidationFailureResponses()),
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("submission-quality validation failed");
    expect(result.error).toContain("raw evidence identifier");
    expect(aci.commands).toHaveLength(0);
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(false);

    const submissionValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "submission_validation.json"), "utf8")
    ) as { ok: boolean; issues: Array<{ kind: string; value?: string }> };
    expect(submissionValidation.ok).toBe(false);
    expect(
      submissionValidation.issues.some(
        (issue) => issue.kind === "evidence_id" && issue.value?.includes("ev_1")
      )
    ).toBe(true);

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe(null);
    expect(await memory.get("write_paper.pdf_path")).toBe(null);
  });

  it("omits auto-generated visuals when metrics are uninformative", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-visual-gate-"));
    process.chdir(root);

    const run = makeRun("run-paper-visual-gate");
    const runDir = await seedRun(root, run);
    await writeFile(
      path.join(runDir, "result_analysis.json"),
      JSON.stringify(
        {
          objective_metric: {
            evaluation: {
              summary: "Objective metric met: reproducibility_score=1.0."
            }
          },
          metric_table: [
            { key: "confirmatory_metrics.json", value: 1 },
            { key: "quick_check_metrics.json", value: 1 },
            { key: "metrics.json", value: 1 }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const tex = await readFile(path.join(runDir, "paper", "main.tex"), "utf8");
    expect(tex).not.toContain("\\begin{table}[t]");
    expect(tex).not.toContain("\\begin{figure}[t]");
  });

  it("repairs LaTeX once after a failed compile and retries the PDF build", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-repair-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-repair");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci({ failFirstCompile: true });
    const llm = new SequencedLLMClient([
      ...buildSessionResponses(),
      "\\documentclass{article}\n\\begin{document}\nRepaired paper draft.\n\\end{document}\n"
    ]);

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          latex_engine: "auto_install"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm,
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("after one automatic repair");
    expect(aci.commands).toEqual([
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "bibtex main",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdfinfo main.pdf"
    ]);

    const repairedTex = await readFile(path.join(runDir, "paper", "latex_repair.tex"), "utf8");
    expect(repairedTex).toContain("Repaired paper draft.");
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(true);
    expect(await readFile(path.join(buildPublicPaperDir(root, run), "main.tex"), "utf8")).toContain(
      "\\documentclass{article}"
    );

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ repaired: boolean; status: string }>;
    };
    expect(report.status).toBe("repaired_success");
    expect(report.repaired).toBe(true);
    expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0]).toMatchObject({ repaired: false, status: "failed" });
    expect(report.attempts[1]).toMatchObject({ repaired: true, status: "success" });

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("repaired_success");
    expect(await memory.get("write_paper.pdf_path")).toBe(
      path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
    );
    const manifest = JSON.parse(await readFile(buildPublicRunManifestPath(root, run), "utf8")) as {
      generated_files: string[];
      sections?: {
        paper?: {
          generated_files: string[];
        };
      };
    };
    expect(manifest.generated_files).toEqual(
      expect.arrayContaining([
        "paper/main.tex",
        "paper/references.bib",
        "paper/evidence_links.json",
        "paper/claim_evidence_table.json",
        "paper/verified_registry.json",
        "paper/claim_status_table.json",
        "paper/evidence_gate_decision.json",
        "paper/paper_readiness.json",
        "paper/paper_critique.json",
        "paper/readiness_risks.json",
        "paper/main.pdf",
        "results/operator_summary.md",
        "results/run_status.json",
        "results/operator_history/0003-paper.md"
      ])
    );
    expect(manifest.sections?.paper?.generated_files).toEqual(
      expect.arrayContaining([
        "paper/main.tex",
        "paper/references.bib",
        "paper/evidence_links.json",
        "paper/claim_evidence_table.json",
        "paper/verified_registry.json",
        "paper/claim_status_table.json",
        "paper/evidence_gate_decision.json",
        "paper/paper_readiness.json",
        "paper/paper_critique.json",
        "paper/readiness_risks.json",
        "paper/main.pdf"
      ])
    );
    expect(await readFile(path.join(root, "outputs", "results", "operator_summary.md"), "utf8")).toContain(
      "Paper readiness:"
    );
    expect(await readFile(path.join(root, "outputs", "results", "operator_summary.md"), "utf8")).toContain(
      "Venue:"
    );
    expect(await readFile(path.join(runDir, "run_status.json"), "utf8")).toContain('"current_node": "write_paper"');
    expect(await readFile(path.join(root, "outputs", "results", "run_status.json"), "utf8")).toContain(
      '"operator_label": "Research memo"'
    );
    expect(await readFile(path.join(root, "outputs", "results", "operator_history", "0003-paper.md"), "utf8")).toContain(
      "# Operator Stage Note"
    );
  });

  it("warns in default mode when the compiled PDF remains below main_page_limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-short-default-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-short-default");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci({ pdfPageCount: 3 });

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const compiledPageValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "compiled_page_validation.json"), "utf8")
    ) as {
      status: string;
      outcome: string;
      compiled_pdf_page_count: number;
      minimum_main_pages: number;
      target_main_pages: number;
      main_page_limit: number;
      message: string;
    };
    expect(compiledPageValidation.status).toBe("warn");
    expect(compiledPageValidation.outcome).toBe("under_limit");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(3);
    expect(compiledPageValidation.minimum_main_pages).toBe(8);
    expect(compiledPageValidation.target_main_pages).toBe(8);
    expect(compiledPageValidation.main_page_limit).toBe(8);
    expect(compiledPageValidation.message).toContain("below the configured minimum_main_pages");
    expect(await exists(path.join(buildPublicPaperDir(root, run), "compiled_page_validation.json"))).toBe(true);
  });

  it("fails compiled page-budget validation in strict-paper mode when the PDF remains below main_page_limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-short-strict-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-short-strict");
    const compiledPageValidation = await validateCompiledPdfPageBudget({
      deps: {
        aci: {
          async runCommand(command: string) {
            expect(command).toBe("pdfinfo main.pdf");
            return {
              status: "ok" as const,
              stdout: "Title: mock\nPages: 0\n",
              stderr: "",
              exit_code: 0,
              duration_ms: 1
            };
          }
        }
      } as any,
      run,
      compileResult: {
        enabled: true,
        status: "success",
        repaired: false,
        toolCallsUsed: 0,
        attempts: [],
        warnings: [],
        pdf_path: path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
      },
      validationMode: "strict_paper",
      minimumMainPages: 1,
      targetMainPages: 1
    });

    expect(compiledPageValidation.status).toBe("fail");
    expect(compiledPageValidation.outcome).toBe("under_limit");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(0);
    expect(compiledPageValidation.minimum_main_pages).toBe(1);
    expect(compiledPageValidation.target_main_pages).toBe(1);
    expect(compiledPageValidation.main_page_limit).toBe(1);
  });

  it("passes compiled page-budget validation when the PDF exceeds the target page budget", async () => {
    const run = makeRun("run-paper-pdf-over-target");

    const compiledPageValidation = await validateCompiledPdfPageBudget({
      deps: {
        aci: {
          async runCommand(command: string) {
            expect(command).toBe("pdfinfo main.pdf");
            return {
              status: "ok" as const,
              stdout: "Title: mock\nPages: 10\n",
              stderr: "",
              exit_code: 0,
              duration_ms: 1
            };
          }
        }
      } as any,
      run,
      compileResult: {
        enabled: true,
        status: "success",
        repaired: false,
        toolCallsUsed: 0,
        attempts: [],
        warnings: [],
        pdf_path: path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
      },
      validationMode: "strict_paper",
      minimumMainPages: 8,
      targetMainPages: 8
    });

    expect(compiledPageValidation.status).toBe("pass");
    expect(compiledPageValidation.outcome).toBe("ok");
    expect(compiledPageValidation.compiled_pdf_page_count).toBe(10);
    expect(compiledPageValidation.minimum_main_pages).toBe(8);
    expect(compiledPageValidation.target_main_pages).toBe(8);
    expect(compiledPageValidation.message).toContain("meeting the configured minimum_main_pages");
  });

  it("fails the node when PDF compilation still fails after repair", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-pdf-fail-"));
    process.chdir(root);

    const run = makeRun("run-paper-pdf-fail");
    const runDir = await seedRun(root, run);
    const aci = createPdfBuildAci({ failAllCompiles: true });
    const eventStream = new InMemoryEventStream();
    const llm = new SequencedLLMClient([
      ...buildSessionResponses(),
      "\\documentclass{article}\n\\begin{document}\nStill broken.\n\\end{document}\n"
    ]);

    const node = createWritePaperNode({
      config: {
        paper: {
          template: "acl",
          build_pdf: true,
          latex_engine: "auto_install"
        }
      } as any,
      runStore: {} as any,
      eventStream,
      llm,
      codex: {} as any,
      aci: aci.api as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("configured PDF build failed");
    expect(result.error).toContain("Undefined control sequence");
    expect(aci.commands).toEqual([
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex",
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex"
    ]);

    expect(await exists(path.join(runDir, "paper", "main.tex"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compile_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(false);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(false);

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ repaired: boolean; status: string; error?: string }>;
    };
    expect(report.status).toBe("failed");
    expect(report.repaired).toBe(true);
    expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0]).toMatchObject({ repaired: false, status: "failed" });
    expect(report.attempts[1]).toMatchObject({ repaired: true, status: "failed" });

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("failed");
    expect(await memory.get("write_paper.pdf_path")).toBe(null);
    expect(await memory.get("write_paper.last_error")).toMatch(/configured PDF build failed/i);

    expect(eventStream.history().some((event) => event.type === "NODE_COMPLETED")).toBe(false);
    expect(eventStream.history().some((event) => event.type === "TEST_FAILED")).toBe(true);
  });

  it("surfaces weak scientific results as a warning in default mode and rewrites strong claims", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-weak-default-"));
    process.chdir(root);

    const run = makeRun("run-paper-weak-default");
    const runDir = await seedRun(root, run);
    await overwriteRunArtifacts(run, {
      "experiment_plan.yaml": [
        "selected_design:",
        '  title: "Small benchmark note"',
        "  datasets:",
        '    - "AgentBench-mini"'
      ].join("\n"),
      "result_analysis.json": JSON.stringify(
        {
          objective_metric: {
            evaluation: {
              summary: "Observed a small positive delta on a single benchmark artifact."
            }
          },
          metric_table: [{ key: "macro_f1_delta_vs_logreg", value: 0.01 }],
          statistical_summary: {
            notes: ["Only a single weak artifact is available."]
          }
        },
        null,
        2
      ) + "\n"
    });
    await writeLatestResults(run, {
      protocol: {
        datasets: ["AgentBench-mini"],
        models: ["baseline", "method"]
      },
      dataset_summaries: [
        {
          dataset: "AgentBench-mini",
          models: {
            baseline: { macro_f1: 0.71 },
            method: { macro_f1: 0.72, macro_f1_delta_vs_logreg: 0.01 }
          }
        }
      ]
    });

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["per_fold_results", "environment_dump"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildWeakScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(result.summary).toContain("Scientific gate: warn");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      status: string;
      issues: Array<{ code: string; message: string; outcome?: string }>;
      evidence_summary: { blocked_by_evidence_insufficiency: boolean; thin_sections: string[] };
    };
    expect(gateDecision.status).toBe("warn");
    expect(gateDecision.issues.some((issue) => issue.code.includes("page_budget"))).toBe(true);
    expect(gateDecision.evidence_summary.blocked_by_evidence_insufficiency).toBe(true);
    expect(gateDecision.evidence_summary.thin_sections.length).toBeGreaterThan(0);
    const scientificValidation = JSON.parse(
      await readFile(path.join(runDir, "paper", "scientific_validation.json"), "utf8")
    ) as {
      auto_repairs: { claim_rewrite_count: number };
      evidence_diagnostics: { blocked_by_evidence_insufficiency: boolean; missing_evidence_categories: string[] };
    };
    expect(scientificValidation.auto_repairs.claim_rewrite_count).toBeGreaterThanOrEqual(0);
    expect(scientificValidation.evidence_diagnostics.blocked_by_evidence_insufficiency).toBe(true);
    expect(scientificValidation.evidence_diagnostics.missing_evidence_categories.length).toBeGreaterThan(0);
    const manuscript = JSON.parse(await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8")) as {
      abstract: string;
      sections: Array<{ heading: string; paragraphs: string[] }>;
    };
    expect(manuscript.abstract).not.toMatch(/significant improvement/i);
    expect(manuscript.sections.find((section) => section.heading === "Results")?.paragraphs.join(" ")).not.toMatch(/significant improvement/i);
  });

  it("fails weak scientific results in strict-paper mode while preserving artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-weak-strict-"));
    process.chdir(root);

    const run = makeRun("run-paper-weak-strict");
    const runDir = await seedRun(root, run);
    await overwriteRunArtifacts(run, {
      "experiment_plan.yaml": [
        "selected_design:",
        '  title: "Small benchmark note"',
        "  datasets:",
        '    - "AgentBench-mini"'
      ].join("\n")
    });
    await writeLatestResults(run, {
      protocol: {
        datasets: ["AgentBench-mini"],
        models: ["baseline", "method"]
      },
      dataset_summaries: []
    });

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "strict_paper"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["per_fold_results", "environment_dump"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildWeakScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("scientific quality gate failed");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      mode: string;
      status: string;
      failure_reasons: string[];
      evidence_summary: { blocked_by_evidence_insufficiency: boolean };
    };
    expect(gateDecision.mode).toBe("strict_paper");
    expect(gateDecision.status).toBe("fail");
    expect(gateDecision.failure_reasons.length).toBeGreaterThan(0);
    expect(gateDecision.evidence_summary.blocked_by_evidence_insufficiency).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "provenance_map.json"))).toBe(true);
    const readinessRisks = JSON.parse(
      await readFile(path.join(runDir, "paper", "readiness_risks.json"), "utf8")
    ) as {
      readiness_state: string;
      risks: Array<{ category: string; status: string; severity: string }>;
    };
    expect(readinessRisks.readiness_state).toBe("blocked_for_paper_scale");
    expect(readinessRisks.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "scientific_validation",
          status: "blocked",
          severity: "blocked"
        })
      ])
    );
  });

  it("routes medium-quality runs through main paper plus appendix without failing the default gate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-medium-quality-"));
    process.chdir(root);

    const run = makeRun("run-paper-medium-quality");
    const runDir = await seedRun(root, run);
    await seedMediumScientificRun(run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["hyperparameter_grids", "per_fold_results", "environment_dump", "extended_error_analysis"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildMediumScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      status: string;
      classification_summary: { auto_repair_count: number };
    };
    expect(gateDecision.status).not.toBe("fail");
    expect(gateDecision.classification_summary.auto_repair_count).toBeGreaterThan(0);
    const manuscript = JSON.parse(await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8")) as {
      sections: Array<{ heading: string; paragraphs: string[] }>;
      appendix_sections?: Array<{ heading: string }>;
    };
    expect(manuscript.sections.find((section) => section.heading === "Method")?.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(manuscript.sections.find((section) => section.heading === "Results")?.paragraphs.length).toBeGreaterThanOrEqual(4);
    expect((manuscript.appendix_sections || []).length).toBeGreaterThan(0);
    const traceability = JSON.parse(await readFile(path.join(runDir, "paper", "traceability.json"), "utf8")) as {
      paragraphs: Array<{ source_refs?: Array<{ kind: string; id: string }> }>;
    };
    expect(traceability.paragraphs.some((paragraph) => (paragraph.source_refs || []).length > 0)).toBe(true);
    const provenanceMap = JSON.parse(await readFile(path.join(runDir, "paper", "provenance_map.json"), "utf8")) as {
      paragraph_anchors: Array<{ anchor_id: string; numeric_fact_ids: string[] }>;
      numeric_anchors: Array<{ support_status: string }>;
    };
    expect(provenanceMap.paragraph_anchors.length).toBeGreaterThan(0);
    expect(provenanceMap.numeric_anchors.some((anchor) => anchor.support_status === "supported")).toBe(true);
  });

  it("hard-fails inconsistent manuscripts when abstract/results/conclusion numbers diverge", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-inconsistent-"));
    process.chdir(root);

    const run = makeRun("run-paper-inconsistent");
    const runDir = await seedRun(root, run);
    await seedMediumScientificRun(run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        },
        paper_profile: {
          venue_style: "acl_long",
          main_page_limit: 8,
          references_counted: false,
          appendix_allowed: true,
          appendix_format: "double_column",
          prefer_appendix_for: ["hyperparameter_grids", "per_fold_results", "environment_dump", "extended_error_analysis"],
          estimated_words_per_page: 420
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildInconsistentScientificResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("scientific quality gate failed");
    const gateDecision = JSON.parse(await readFile(path.join(runDir, "paper", "gate_decision.json"), "utf8")) as {
      status: string;
      failure_reasons: string[];
      classification_summary: { contradiction_count: number };
    };
    expect(gateDecision.status).toBe("fail");
    expect(gateDecision.failure_reasons.some((message) => /structured results|datasets|significant improvement/i.test(message))).toBe(true);
    expect(gateDecision.classification_summary.contradiction_count).toBeGreaterThan(0);
    const consistency = JSON.parse(await readFile(path.join(runDir, "paper", "consistency_lint.json"), "utf8")) as {
      manuscript: { issues: Array<{ kind: string; involved_sections?: string[] }> };
    };
    expect(consistency.manuscript.issues.some((issue) => issue.kind === "numeric_inconsistency")).toBe(true);
    expect(consistency.manuscript.issues.some((issue) => issue.kind === "count_inconsistency")).toBe(true);
    expect(
      consistency.manuscript.issues.some(
        (issue) => issue.kind === "numeric_inconsistency" && (issue.involved_sections || []).length > 0
      )
    ).toBe(true);
  });

  it("fails fast before drafting when the brief evidence gate blocks paper progression", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-eligibility-"));
    process.chdir(root);

    const run = makeRun("run-paper-eligibility");
    const runDir = await seedRun(root, run);
    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    await memory.put("analyze_results.brief_evidence_assessment", {
      generated_at: new Date().toISOString(),
      enabled: true,
      status: "fail",
      summary: "Brief evidence gate failed — repeated runs and comparator coverage are still below the declared minimum.",
      ceiling_type: "research_memo",
      recommended_action: "backtrack_to_design",
      requirements: {
        minimum_runs_or_folds: 3,
        minimum_baseline_count: 2,
        requires_confidence_intervals: true
      },
      actual: {
        executed_trials: 1,
        baseline_count: 1,
        confidence_interval_count: 0,
        evidence_gap_count: 1,
        scope_limit_count: 0
      },
      checks: [],
      failures: ["Executed evidence meets the brief run/fold floor"],
      warnings: []
    });
    await memory.put("review.paper_critique", {
      stage: "pre_draft_review",
      manuscript_type: "research_memo",
      overall_decision: "backtrack_to_design",
      target_venue_style: "generic_cs_paper",
      confidence: 0.9
    });
    await mkdir(path.join(runDir, "review"), { recursive: true });
    await writeFile(
      path.join(runDir, "review", "paper_critique.json"),
      JSON.stringify(
        {
          stage: "pre_draft_review",
          generated_at: new Date().toISOString(),
          target_venue_style: "generic_cs_paper",
          manuscript_type: "research_memo",
          overall_decision: "backtrack_to_design",
          overall_score: 2.4,
          confidence: 0.9,
          blocking_issues_count: 2,
          non_blocking_issues_count: 0,
          category_scores: [],
          blocking_issues: [],
          non_blocking_issues: [],
          transition_recommendation: "backtrack_to_design",
          paper_readiness_state: "research_memo",
          downgrade_reason: "Evidence remained below the brief floor.",
          manuscript_claim_risk_summary: "Evidence is still too thin for paper-scale drafting.",
          needs_additional_experiments: true,
          needs_additional_statistics: true,
          needs_additional_related_work: false,
          needs_design_revision: true,
          venue_style_notes: "",
          style_mismatches: [],
          style_repairable_locally: true
        },
        null,
        2
      ),
      "utf8"
    );

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false,
          validation_mode: "default"
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSessionResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("write_paper blocked by brief evidence gate");
    const eligibility = JSON.parse(await readFile(path.join(runDir, "paper", "write_paper_eligibility.json"), "utf8")) as {
      allowed: boolean;
      brief_evidence_status?: string;
      manuscript_type?: string;
    };
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.brief_evidence_status).toBe("fail");
    expect(eligibility.manuscript_type).toBe("research_memo");
  });

  it("runs manuscript review after polish and records manuscript-quality artifacts for a clean manuscript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-quality-clean-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-quality-clean");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient([
        ...buildSessionResponses(),
        buildPolishedManuscriptResponse(),
        buildManuscriptReviewResponse({ decision: "pass" }),
        buildManuscriptReviewAuditResponse()
      ]),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(await exists(path.join(runDir, "paper", "manuscript_review.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_review_validation.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_review_audit.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_style_lint.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_quality_gate.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "claim_evidence_table.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "verified_registry.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "claim_status_table.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "evidence_gate_decision.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "paper_readiness.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "readiness_risks.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_1_report.json"))).toBe(false);
    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as { action: string; summary_lines: string[] };
    expect(gate.action).toBe("pass");
    expect(gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Action:\s+pass/i),
        expect.stringMatching(/Decision stage:\s+initial manuscript-quality gate/i),
        expect.stringMatching(/Review reliability:/i)
      ])
    );

    const traceRaw = await readFile(path.join(runDir, "paper", "session_trace.json"), "utf8");
    expect(traceRaw.indexOf('"stage": "polish"')).toBeGreaterThanOrEqual(0);
    expect(traceRaw.indexOf('"stage": "manuscript_review"')).toBeGreaterThan(traceRaw.indexOf('"stage": "polish"'));
    expect(traceRaw.indexOf('"stage": "manuscript_review_audit"')).toBeGreaterThan(
      traceRaw.indexOf('"stage": "manuscript_review"')
    );

    const claimStatus = JSON.parse(
      await readFile(path.join(runDir, "paper", "claim_status_table.json"), "utf8")
    ) as { counts: { verified: number } };
    expect(claimStatus.counts.verified).toBeGreaterThan(0);

    const verifiedRegistry = JSON.parse(
      await readFile(path.join(runDir, "paper", "verified_registry.json"), "utf8")
    ) as { counts: { verified: number; inferred: number; blocked: number } };
    expect(verifiedRegistry.counts.verified + verifiedRegistry.counts.inferred).toBeGreaterThan(0);
    expect(verifiedRegistry.counts.blocked).toBe(0);

    const paperReadiness = JSON.parse(
      await readFile(path.join(runDir, "paper", "paper_readiness.json"), "utf8")
    ) as { paper_ready: boolean; evidence_gate_status: string };
    expect(typeof paperReadiness.paper_ready).toBe("boolean");
    expect(paperReadiness.evidence_gate_status).toBe("pass");
    const readinessRisks = JSON.parse(
      await readFile(path.join(runDir, "paper", "readiness_risks.json"), "utf8")
    ) as { risk_count: number; summary_lines: string[] };
    expect(readinessRisks.risk_count).toBeGreaterThanOrEqual(0);
    expect(readinessRisks.summary_lines.length).toBeGreaterThan(0);
  });

  it("retries manuscript review once when supporting-span validation fails and records validation plus audit artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-review-retry-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-review-retry");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildReviewRetryResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const validation = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_review_validation.json"), "utf8")
    ) as { ok: boolean; retry_requested: boolean; artifact_reliability: string };
    expect(validation.ok).toBe(true);
    expect(validation.retry_requested).toBe(false);
    expect(validation.artifact_reliability).toBe("grounded");

    const audit = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_review_audit.json"), "utf8")
    ) as { ok: boolean; artifact_reliability: string };
    expect(audit.ok).toBe(true);
    expect(audit.artifact_reliability).toBe("grounded");

    const traceRaw = await readFile(path.join(runDir, "paper", "session_trace.json"), "utf8");
    expect(traceRaw).toContain('"stage": "manuscript_review_retry"');
    expect(traceRaw).toContain('"stage": "manuscript_review_audit"');
  });

  it("runs one manuscript repair pass for repairable manuscript issues and records artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-quality-repair1-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-quality-repair1");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildManuscriptRepairOnceResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_plan_1.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_verification_1.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_1_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_2_report.json"))).toBe(false);

    const repairPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_plan_1.json"), "utf8")
    ) as { targets: Array<{ section: string; paragraph_index?: number; location_key: string }> };
    expect(repairPlan.targets.some((target) => target.section === "Discussion" && target.paragraph_index === 0)).toBe(true);

    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as { locality_ok: boolean; out_of_scope_changes: string[] };
    expect(verification.locality_ok).toBe(true);
    expect(verification.out_of_scope_changes).toHaveLength(0);

    const repairReport = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_1_report.json"), "utf8")
    ) as {
      pass_index: number;
      improvement_detected: boolean;
      verification_summary: string;
      verification_findings: Array<{ code: string }>;
      stop_or_continue_reason: string;
    };
    expect(repairReport.pass_index).toBe(1);
    expect(repairReport.improvement_detected).toBe(true);
    expect(repairReport.verification_summary).toMatch(/bounded-local changes/i);
    expect(repairReport.verification_findings).toEqual([]);
    expect(repairReport.stop_or_continue_reason).toMatch(/resolved|non-blocking|repair/i);

    const round0Review = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_review_round_0.json"), "utf8")
    ) as {
      issues: Array<{ supporting_spans?: Array<{ section: string; paragraph_index: number; excerpt: string }> }>;
    };
    expect(round0Review.issues[0]?.supporting_spans?.[0]?.section).toBe("Discussion");

    const round0Gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate_round_0.json"), "utf8")
    ) as { triggered_by: string[]; summary_lines: string[] };
    expect(round0Gate.triggered_by).toContain("paragraph_redundancy");
    expect(round0Gate.triggered_by).not.toContain("duplicate_sentence_pattern");
    expect(round0Gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Action:\s+repair/i),
        expect.stringMatching(/Triggered by:\s+.*paragraph_redundancy/i)
      ])
    );

    const round0Lint = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_style_lint_round_0.json"), "utf8")
    ) as {
      summary: string[];
      issues: Array<{ code: string; coverage_status?: string; covered_by_review_issue_code?: string }>;
    };
    expect(round0Lint.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_sentence_pattern",
          coverage_status: "backstop_only",
          covered_by_review_issue_code: "paragraph_redundancy"
        })
      ])
    );
    expect(round0Lint.summary.some((line) => /backstop-only/i.test(line))).toBe(true);
  });

  it("allows a bounded local adjacent-two-paragraph repair for section transitions in one section", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-transition-repair-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-transition-repair");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildSectionTransitionAdjacentRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const repairPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_plan_1.json"), "utf8")
    ) as { targets: Array<{ section: string; edit_scope: string; allowed_location_keys: string[] }> };
    expect(
      repairPlan.targets.some(
        (target) =>
          target.section === "Results"
          && target.edit_scope === "adjacent_two_paragraphs"
          && target.allowed_location_keys.includes("paragraph:results:0")
          && target.allowed_location_keys.includes("paragraph:results:1")
      )
    ).toBe(true);

    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as { locality_ok: boolean; scope_respected: boolean; changed_location_keys: string[] };
    expect(verification.locality_ok).toBe(true);
    expect(verification.scope_respected).toBe(true);
    expect(verification.changed_location_keys).toEqual(
      expect.arrayContaining(["paragraph:results:0", "paragraph:results:1"])
    );
  });

  it("allows a bounded local adjacent-two-paragraph repair for introduction alignment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-alignment-repair-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-alignment-repair");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildIntroductionAlignmentAdjacentRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const repairPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_plan_1.json"), "utf8")
    ) as { targets: Array<{ section: string; edit_scope: string; allowed_location_keys: string[] }> };
    expect(
      repairPlan.targets.some(
        (target) =>
          target.section === "Introduction"
          && target.edit_scope === "adjacent_two_paragraphs"
          && target.allowed_location_keys.includes("paragraph:introduction:0")
          && target.allowed_location_keys.includes("paragraph:introduction:1")
      )
    ).toBe(true);

    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as { locality_ok: boolean; scope_respected: boolean; changed_location_keys: string[] };
    expect(verification.locality_ok).toBe(true);
    expect(verification.scope_respected).toBe(true);
    expect(verification.changed_location_keys).toEqual(
      expect.arrayContaining(["paragraph:introduction:0", "paragraph:introduction:1"])
    );
  });

  it("narrows visual redundancy repair targets to the redundant table/figure pair only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-visual-pair-repair-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-visual-pair-repair");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildVisualRedundancyPairRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const sessionManuscript = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript.session.json"), "utf8")
    ) as { tables?: Array<{ rows: Array<{ label: string }> }>; figures?: Array<{ bars: Array<{ label: string }> }> };
    expect(sessionManuscript.tables?.[0]?.rows).toHaveLength(3);
    expect(sessionManuscript.figures?.[0]?.bars).toHaveLength(3);
    expect(sessionManuscript.figures?.[1]?.bars).toHaveLength(3);

    const styleLint = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_style_lint_round_0.json"), "utf8")
    ) as {
      summary: string[];
      issues: Array<{
        code: string;
        coverage_status?: string;
        covered_by_review_issue_code?: string;
        redundant_visual_pair?: { table_index: number; figure_index: number };
      }>;
    };
    expect(styleLint.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "visual_redundancy",
          coverage_status: "backstop_only",
          covered_by_review_issue_code: "visual_redundancy",
          redundant_visual_pair: expect.objectContaining({ table_index: 0, figure_index: 0 })
        })
      ])
    );
    expect(styleLint.summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/visual-redundancy finding\(s\).*backstop-only/i)
      ])
    );

    const round0Review = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_review_round_0.json"), "utf8")
    ) as {
      issues: Array<{
        code: string;
        visual_targets?: Array<{ kind: string; index: number }>;
      }>;
    };
    expect(round0Review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "visual_redundancy",
          visual_targets: expect.arrayContaining([
            expect.objectContaining({ kind: "table", index: 0 }),
            expect.objectContaining({ kind: "figure", index: 0 })
          ])
        })
      ])
    );

    const repairPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_plan_1.json"), "utf8")
    ) as { targets: Array<{ kind: string; location_key: string; allowed_location_keys: string[] }> };
    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "table", location_key: "table:0", allowed_location_keys: ["table:0"] }),
        expect.objectContaining({ kind: "figure", location_key: "figure:0", allowed_location_keys: ["figure:0"] })
      ])
    );
    expect(repairPlan.targets.some((target) => target.location_key === "figure:1")).toBe(false);

    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as {
      locality_ok: boolean;
      changed_location_keys: string[];
      out_of_scope_changes: string[];
      visual_caption_conservatism_ok: boolean;
      visual_caption_checks: Array<{ location_key: string; conservative: boolean; concerns: string[] }>;
    };
    expect(verification.locality_ok).toBe(true);
    expect(verification.changed_location_keys).toEqual(expect.arrayContaining(["figure:0"]));
    expect(verification.out_of_scope_changes).toHaveLength(0);
    expect(verification.visual_caption_conservatism_ok).toBe(true);
    expect(verification.visual_caption_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location_key: "figure:0",
          conservative: true,
          concerns: []
        })
      ])
    );

    const finalManuscript = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript.json"), "utf8")
    ) as { figures?: Array<{ caption: string; bars: Array<{ label: string }> }> };
    expect(finalManuscript.figures).toHaveLength(2);
    expect(finalManuscript.figures?.[0]?.caption).toContain("trend-focused");
    expect(finalManuscript.figures?.[0]?.bars).toHaveLength(3);
    expect(finalManuscript.figures?.[1]?.caption).toContain("remain unchanged");
    expect(finalManuscript.figures?.[1]?.bars).toHaveLength(3);
  });

  it("stops after visual repair when the changed figure caption overclaims beyond the evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-visual-caption-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-visual-caption-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildVisualCaptionOverclaimStopResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("manuscript-quality gate failed");
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_2_report.json"))).toBe(false);

    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as {
      visual_caption_conservatism_ok: boolean;
      visual_caption_checks: Array<{ location_key: string; conservative: boolean; concerns: string[] }>;
    };
    expect(verification.visual_caption_conservatism_ok).toBe(false);
    expect(verification.visual_caption_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location_key: "figure:0",
          conservative: false,
          concerns: expect.arrayContaining([
            "The visual wording claims broad applicability beyond the tested setting."
          ])
        })
      ])
    );

    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as { stop_or_continue_reason: string; summary_lines: string[] };
    expect(gate.stop_or_continue_reason).toMatch(/visual caption|bounded local repair loop/i);
    expect(gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Action:\s+stop/i),
        expect.stringMatching(/Decision stage:\s+post-repair gate after pass 1/i),
        expect.stringMatching(/Triggered by:/i)
      ])
    );

    const round1Review = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_review_round_1.json"), "utf8")
    ) as {
      issues: Array<{
        code: string;
        visual_targets?: Array<{ kind: string; index: number }>;
      }>;
    };
    expect(round1Review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "rhetorical_overreach",
          visual_targets: expect.arrayContaining([expect.objectContaining({ kind: "figure", index: 0 })])
        })
      ])
    );

    const repairReport = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_1_report.json"), "utf8")
    ) as {
      verification_summary: string;
      verification_findings: Array<{ code: string; location_keys: string[]; concerns?: string[] }>;
      stop_or_continue_reason: string;
    };
    expect(repairReport.verification_summary).toMatch(/changed visual surfaces/i);
    expect(repairReport.verification_findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "visual_caption_overclaim",
          location_keys: ["figure:0"],
          concerns: expect.arrayContaining([
            "The visual wording claims broad applicability beyond the tested setting."
          ])
        })
      ])
    );
    expect(repairReport.stop_or_continue_reason).toMatch(/visual caption|bounded local repair loop/i);

    const failureArtifact = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_failure.json"), "utf8")
    ) as {
      summary_lines: string[];
      lint_findings: Array<{ code: string; gate_role?: string }>;
      reviewer_missed_policy_findings: Array<{ code: string }>;
      reviewer_covered_backstop_findings: Array<{ code: string; covered_by_review_issue_code?: string }>;
    };
    expect(failureArtifact.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Stop reason:/i),
        expect.stringMatching(/Review reliability:/i),
        expect.stringMatching(/Triggered by:/i)
      ])
    );
    expect(Array.isArray(failureArtifact.lint_findings)).toBe(true);
    expect(failureArtifact.reviewer_missed_policy_findings).toEqual([]);
    expect(Array.isArray(failureArtifact.reviewer_covered_backstop_findings)).toBe(true);
    expect(
      failureArtifact.reviewer_covered_backstop_findings.every((issue) => issue.gate_role === "backstop_only")
    ).toBe(true);
  });

  it("stops immediately when appendix contamination is missed by the reviewer and remains a hard-stop policy finding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-appendix-hard-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-appendix-hard-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildAppendixHardStopResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_1_report.json"))).toBe(false);

    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as {
      action: string;
      decision_digest: { stop_reason_category: string };
      summary_lines: string[];
    };
    expect(gate.action).toBe("stop");
    expect(gate.decision_digest.stop_reason_category).toBe("policy_hard_stop");
    expect(gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Reason category:\s+policy_hard_stop/i)
      ])
    );

    const round0Lint = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_style_lint_round_0.json"), "utf8")
    ) as {
      issues: Array<{ code: string; gate_role?: string; coverage_status?: string }>;
    };
    expect(round0Lint.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "appendix_meta_text",
          gate_role: "hard_stop",
          coverage_status: "primary"
        })
      ])
    );

    const failureArtifact = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_failure.json"), "utf8")
    ) as {
      decision_digest: { stop_reason_category: string };
      reviewer_missed_policy_findings: Array<{ code: string; gate_role?: string }>;
    };
    expect(failureArtifact.decision_digest.stop_reason_category).toBe("policy_hard_stop");
    expect(failureArtifact.reviewer_missed_policy_findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "appendix_meta_text",
          gate_role: "hard_stop"
        })
      ])
    );
  });

  it("treats appendix contamination as backstop-only when manuscript review already covers the same appendix-local issue", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-appendix-backstop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-appendix-backstop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildAppendixBackstopRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("success");
    const round0Lint = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_style_lint_round_0.json"), "utf8")
    ) as {
      issues: Array<{ code: string; gate_role?: string; coverage_status?: string; covered_by_review_issue_code?: string }>;
    };
    expect(round0Lint.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "appendix_meta_text",
          gate_role: "backstop_only",
          coverage_status: "backstop_only",
          covered_by_review_issue_code: "appendix_hygiene"
        })
      ])
    );

    const repairPlan = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_plan_1.json"), "utf8")
    ) as { targets: Array<{ kind: string; location_key: string }> };
    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "appendix_paragraph",
          location_key: "appendix_paragraph:appendix._notes:0"
        })
      ])
    );
  });

  it("stops after repair when a changed table caption overclaims beyond the evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-table-caption-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-table-caption-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildTableCaptionOverclaimStopResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as {
      visual_caption_conservatism_ok: boolean;
      visual_caption_checks: Array<{ location_key: string; conservative: boolean; concerns: string[] }>;
      visual_conservatism_ok: boolean;
    };
    expect(verification.visual_caption_conservatism_ok).toBe(false);
    expect(verification.visual_conservatism_ok).toBe(false);
    expect(verification.visual_caption_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location_key: "table:0",
          conservative: false,
          concerns: expect.arrayContaining([
            "The visual wording claims broad applicability beyond the tested setting."
          ])
        })
      ])
    );
  });

  it("stops after repair when a changed visual label overclaims beyond the evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-visual-label-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-visual-label-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildVisualLabelOverclaimStopResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as {
      visual_label_conservatism_ok: boolean;
      visual_label_checks: Array<{ location_key: string; conservative: boolean; concerns: string[]; labels: string[] }>;
      visual_conservatism_ok: boolean;
    };
    expect(verification.visual_label_conservatism_ok).toBe(false);
    expect(verification.visual_conservatism_ok).toBe(false);
    expect(verification.visual_label_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location_key: "figure:0",
          conservative: false,
          labels: expect.arrayContaining(["Broad Applicability Across Domains"]),
          concerns: expect.arrayContaining([
            "The visual wording claims broad applicability beyond the tested setting."
          ])
        })
      ])
    );

    const repairReport = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_1_report.json"), "utf8")
    ) as { verification_findings: Array<{ code: string; location_keys: string[] }> };
    expect(repairReport.verification_findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "visual_label_overclaim",
          location_keys: ["figure:0"]
        })
      ])
    );
  });

  it("does not allow a second repair when the follow-up review is only partially grounded", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-partially-grounded-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-partially-grounded-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildPartiallyGroundedRepairStopResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_2_report.json"))).toBe(false);

    const reviewAudit = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_review_audit.json"), "utf8")
    ) as { artifact_reliability: string; metrics: { retry_used: boolean } };
    expect(reviewAudit.artifact_reliability).toBe("partially_grounded");
    expect(reviewAudit.metrics.retry_used).toBe(false);

    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as {
      action: string;
      stop_or_continue_reason: string;
      decision_digest: { stop_reason_category: string; review_reliability: string };
    };
    expect(gate.action).toBe("stop");
    expect(gate.stop_or_continue_reason).toMatch(/partially grounded|second manuscript repair is not allowed/i);
    expect(gate.decision_digest.stop_reason_category).toBe("review_reliability");
    expect(gate.decision_digest.review_reliability).toBe("partially_grounded");
  });

  it("stops when a repair changes out-of-scope sections outside the bounded local repair plan", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-quality-locality-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-quality-locality-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildOutOfScopeRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("manuscript-quality gate failed");
    const verification = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_repair_verification_1.json"), "utf8")
    ) as { locality_ok: boolean; unexpected_changed_sections: string[] };
    expect(verification.locality_ok).toBe(false);
    expect(verification.unexpected_changed_sections).toContain("introduction");

    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as { stop_or_continue_reason: string };
    expect(gate.stop_or_continue_reason).toMatch(/out-of-scope locations|bounded local repair loop/i);
  });

  it("allows a second manuscript repair only after improvement and never runs a third repair", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-quality-repair2-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-quality-repair2");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildManuscriptRepairTwiceResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(await exists(path.join(runDir, "paper", "manuscript_repair_1_report.json"))).toBe(true);
    const round1Gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate_round_1.json"), "utf8")
    ) as { action: string; stop_or_continue_reason: string; allowed_max_passes: number; summary_lines: string[] };
    expect(round1Gate.action, round1Gate.stop_or_continue_reason).toBe("repair");
    expect(round1Gate.allowed_max_passes).toBe(2);
    expect(round1Gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Action:\s+repair/i),
        expect.stringMatching(/Decision stage:\s+post-repair gate after pass 1/i),
        expect.stringMatching(/Allowed max repairs:\s+2;\s+remaining allowed repairs:\s+1/i)
      ])
    );
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_2_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_3_report.json"))).toBe(false);

    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as { allowed_max_passes: number; summary_lines: string[] };
    expect(gate.allowed_max_passes).toBe(2);
    expect(gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Action:\s+pass/i),
        expect.stringMatching(/Decision stage:\s+post-repair gate after pass 2/i)
      ])
    );

    const traceRaw = await readFile(path.join(runDir, "paper", "session_trace.json"), "utf8");
    expect(traceRaw).toContain('"stage": "manuscript_repair_1"');
    expect(traceRaw).toContain('"stage": "manuscript_repair_2"');
    expect(traceRaw).not.toContain("manuscript_repair_3");
  });

  it("stops after the first repair when the same manuscript-quality issue code repeats and does not run a second repair", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-manuscript-quality-repeat-stop-"));
    process.chdir(root);

    const run = makeRun("run-manuscript-quality-repeat-stop");
    const runDir = await seedRun(root, run);

    const node = createWritePaperNode({
      config: {
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new SequencedLLMClient(buildRepeatedLintRepairResponses()),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    } as any);

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("manuscript-quality gate failed");
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_1_report.json"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "manuscript_repair_2_report.json"))).toBe(false);

    const gate = JSON.parse(
      await readFile(path.join(runDir, "paper", "manuscript_quality_gate.json"), "utf8")
    ) as { stop_or_continue_reason: string; summary_lines: string[] };
    expect(gate.stop_or_continue_reason).toMatch(/manuscript-quality issue code/i);
    expect(gate.summary_lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Action:\s+stop/i),
        expect.stringMatching(/Improvement detected:\s+no/i)
      ])
    );
  });
});
