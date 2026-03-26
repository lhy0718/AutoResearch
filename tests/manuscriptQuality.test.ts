import { describe, expect, it } from "vitest";

import type { PaperManuscript, PaperTraceabilityReport } from "../src/core/analysis/paperManuscript.js";
import {
  buildManuscriptRepairPlan,
  buildManuscriptRepairVerificationArtifact,
  buildFallbackManuscriptReview,
  buildManuscriptStyleLint,
  collectManuscriptQualityIssues,
  normalizeManuscriptReview,
  reconcileManuscriptStyleLintWithReview,
  validateManuscriptReviewArtifact
} from "../src/core/analysis/manuscriptQuality.js";

function makeTraceability(manuscript: PaperManuscript): PaperTraceabilityReport {
  return {
    paragraphs: [
      {
        anchor_id: "paragraph:title_0",
        manuscript_section: "Title",
        paragraph_index: 0,
        source_draft_section: "Title",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"],
        source_refs: [{ kind: "evidence", id: "ev_1" }]
      },
      {
        anchor_id: "paragraph:abstract_0",
        manuscript_section: "Abstract",
        paragraph_index: 0,
        source_draft_section: "Abstract",
        evidence_ids: ["ev_1"],
        citation_paper_ids: ["paper_1"],
        source_refs: [{ kind: "citation", id: "paper_1" }]
      },
      ...manuscript.sections.flatMap((section, sectionIndex) =>
        section.paragraphs.map((_, paragraphIndex) => ({
          anchor_id: `${sectionIndex}:${paragraphIndex}`,
          manuscript_section: section.heading,
          paragraph_index: paragraphIndex,
          source_draft_section: section.heading,
          evidence_ids: ["ev_1"],
          citation_paper_ids: ["paper_1"],
          source_refs: [{ kind: "evidence", id: "ev_1" }]
        }))
      )
    ]
  };
}

function makeCleanManuscript(): PaperManuscript {
  return {
    title: "Thread-Backed Drafting for More Stable Manuscript Revision",
    abstract:
      "We study manuscript generation for agent collaboration workflows. We evaluate a thread-backed drafting pipeline against a stateless baseline on AgentBench-mini. Across repeated runs, the thread-backed pipeline improves revision stability by 0.05. These results suggest that persistent drafting support can improve revisability within the tested workflow setting.",
    keywords: ["agent collaboration", "manuscript generation"],
    sections: [
      {
        heading: "Introduction",
        paragraphs: [
          "Manuscript generation for agent collaboration workflows is difficult because revisions often drift away from grounded evidence and earlier decisions.",
          "This paper evaluates whether thread-backed drafting can stabilize revision behavior while preserving evidence-grounded writing in a constrained workflow setting."
        ]
      },
      {
        heading: "Related Work",
        paragraphs: [
          "Prior work on collaborative agents studies revision stability, while workflow benchmarking studies orchestration quality at the system level.",
          "Compared with those strands, our study focuses on whether persistent drafting state improves revisability under the same workflow and task setting."
        ]
      },
      {
        heading: "Method",
        paragraphs: [
          "We compare a thread-backed drafting workflow with a stateless baseline on the AgentBench-mini benchmark dataset.",
          "Both conditions use the same staged paper-writing pipeline within the same evaluation setup, and revision stability is the primary metric.",
          "The evaluation tracks repeated runs so that the comparison reflects stable behavior rather than a single example."
        ]
      },
      {
        heading: "Results",
        paragraphs: [
          "The thread-backed condition improves revision stability by 0.05 relative to the stateless baseline on AgentBench-mini.",
          "The main table preserves the exact comparison, and the result remains modest rather than dramatic."
        ]
      },
      {
        heading: "Discussion",
        paragraphs: [
          "The result suggests that persistent drafting state reduces avoidable revision drift, but the effect remains specific to the tested workflow.",
          "This interpretation matters because the gain is useful without implying broad generalization beyond the observed setting."
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
          "Within the tested workflow setting, thread-backed drafting improves revision stability and supports more consistent manuscript revision."
        ]
      }
    ],
    tables: [
      {
        caption: "Exact numeric comparison for the main revision-stability result.",
        rows: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ]
  };
}

describe("manuscriptQuality style lint", () => {
  it("normalizes valid supporting spans and drops malformed ones", () => {
    const manuscript = makeCleanManuscript();

    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The manuscript needs local revision.",
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
                excerpt: "Across repeated runs, the thread-backed pipeline improves revision stability by 0.05.",
                reason: "This is the relevant abstract sentence."
              },
              {
                section: "Discussion",
                paragraph_index: 9,
                excerpt: "This does not exist."
              }
            ]
          }
        ]
      },
      manuscript
    );

    expect(review.issues).toHaveLength(1);
    expect(review.issues[0]?.supporting_spans).toEqual([
      {
        section: "Abstract",
        paragraph_index: 0,
        excerpt: "Across repeated runs, the thread-backed pipeline improves revision stability by 0.05.",
        reason: "This is the relevant abstract sentence."
      }
    ]);
  });

  it("fallback review emits empty supporting spans", () => {
    const manuscript = makeCleanManuscript();
    manuscript.sections = manuscript.sections.filter((section) => section.heading !== "Method");

    const fallback = buildFallbackManuscriptReview(manuscript);

    expect(fallback.issues[0]?.supporting_spans).toEqual([]);
  });

  it("validates supporting spans into traceability anchors and source refs", () => {
    const manuscript = makeCleanManuscript();
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The manuscript needs one local fix.",
        issues: [
          {
            code: "alignment",
            severity: "warning",
            section: "Abstract",
            repairable: true,
            message: "Abstract and conclusion need slightly tighter scope alignment.",
            fix_recommendation: "Keep the abstract scoped to the tested workflow setting.",
            supporting_spans: [
              {
                section: "Abstract",
                paragraph_index: 0,
                excerpt: "We study manuscript generation for agent collaboration workflows.",
                reason: "This is the abstract opening."
              }
            ]
          }
        ]
      },
      manuscript
    );

    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    expect(validated.validation.ok).toBe(true);
    expect(validated.review.issues[0]?.supporting_spans[0]).toMatchObject({
      section: "Abstract",
      paragraph_index: 0,
      anchor_id: "paragraph:abstract_0"
    });
    expect(validated.review.issues[0]?.supporting_spans[0]?.source_refs).toEqual([
      { kind: "citation", id: "paper_1" }
    ]);
  });

  it("marks warning-only review grounding gaps as partially grounded and records validation metrics", () => {
    const manuscript = makeCleanManuscript();
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The manuscript review remains usable but one span is unanchored.",
        issues: [
          {
            code: "alignment",
            severity: "warning",
            section: "Abstract",
            repairable: true,
            message: "Abstract and conclusion need tighter local alignment.",
            fix_recommendation: "Keep the abstract scoped to the tested workflow setting.",
            supporting_spans: [
              {
                section: "Abstract",
                paragraph_index: 0,
                excerpt: "We study manuscript generation for agent collaboration workflows.",
                reason: "This span is textually valid but will be unanchored."
              }
            ]
          }
        ]
      },
      manuscript
    );

    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: { paragraphs: [] }
    });

    expect(validated.validation.ok).toBe(true);
    expect(validated.validation.artifact_reliability).toBe("partially_grounded");
    expect(validated.validation.metrics).toMatchObject({
      issue_count: 1,
      valid_span_count: 1,
      invalid_span_count: 0,
      visual_target_only_issue_count: 0,
      mismatch_count: 1,
      retry_used: false
    });
  });

  it("builds a bounded-local repair plan from validated review spans", () => {
    const manuscript = makeCleanManuscript();
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The discussion opening should be revised locally.",
        issues: [
          {
            code: "paragraph_redundancy",
            severity: "warning",
            section: "Discussion",
            repairable: true,
            message: "Discussion repeats the introduction framing.",
            fix_recommendation: "Rewrite only the discussion opening.",
            supporting_spans: [
              {
                section: "Discussion",
                paragraph_index: 0,
                excerpt: "The result suggests that persistent drafting state reduces avoidable revision drift, but the effect remains specific to the tested workflow.",
                reason: "This is the local discussion paragraph."
              }
            ]
          }
        ]
      },
      manuscript
    );
    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    const repairPlan = buildManuscriptRepairPlan({
      passIndex: 1,
      manuscript,
      review: validated.review,
      lint: buildManuscriptStyleLint({ manuscript, traceability: makeTraceability(manuscript) }),
      mustImproveIssues: [
        {
          source: "review",
          code: "paragraph_redundancy",
          severity: "warning",
          section: "Discussion",
          repairable: true,
          message: "Discussion repeats the introduction framing.",
          anchor_ids: validated.review.issues[0]?.supporting_spans.map((span) => span.anchor_id).filter(Boolean) as string[]
        }
      ]
    });

    expect(repairPlan.blocked_targets).toHaveLength(0);
    expect(repairPlan.repair_scope).toBe("bounded_local");
    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "Discussion",
          paragraph_index: 0,
          edit_scope: "paragraph_local",
          allowed_location_keys: ["paragraph:discussion:0"]
        })
      ])
    );
  });

  it("builds visual-local repair targets from reviewer-emitted visual targets", () => {
    const manuscript = makeCleanManuscript();
    manuscript.tables = [
      {
        caption: "Exact numeric comparison for the main revision-stability result.",
        rows: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ];
    manuscript.figures = [
      {
        caption: "A redundant figure that should be revised into a distinct visual takeaway.",
        bars: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ];

    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "One visual pair is redundant.",
        issues: [
          {
            code: "visual_redundancy",
            severity: "warning",
            section: "Results",
            repairable: true,
            message: "Figure 1 restates Table 1 rather than adding a distinct visual pattern.",
            fix_recommendation: "Revise Figure 1 into a trend-focused visual and keep the exact table.",
            visual_targets: [
              { kind: "table", index: 0, rationale: "Table 1 is one half of the redundant pair." },
              { kind: "figure", index: 0, rationale: "Figure 1 is the redundant visual that should change." }
            ]
          }
        ]
      },
      manuscript
    );

    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    expect(validated.validation.ok).toBe(true);
    expect(validated.review.issues[0]?.visual_targets).toEqual([
      { kind: "table", index: 0, rationale: "Table 1 is one half of the redundant pair." },
      { kind: "figure", index: 0, rationale: "Figure 1 is the redundant visual that should change." }
    ]);

    const repairPlan = buildManuscriptRepairPlan({
      passIndex: 1,
      manuscript,
      review: validated.review,
      lint: { mode: "hard_policy_only", checked_rules: [], ok: true, issues: [], summary: [] },
      mustImproveIssues: [
        {
          source: "review",
          code: "visual_redundancy",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "Figure 1 restates Table 1 rather than adding a distinct visual pattern."
        }
      ]
    });

    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "review", kind: "table", location_key: "table:0" }),
        expect.objectContaining({ source: "review", kind: "figure", location_key: "figure:0" })
      ])
    );
  });

  it("allows an adjacent-two-paragraph repair scope for section transitions within one section", () => {
    const manuscript = makeCleanManuscript();
    manuscript.sections[3] = {
      heading: "Results",
      paragraphs: [
        "The thread-backed condition improves revision stability by 0.05 relative to the stateless baseline on AgentBench-mini.",
        "However, the next paragraph repeats setup details instead of transitioning into interpretation."
      ]
    };
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The results transition needs a local repair.",
        issues: [
          {
            code: "section_transition",
            severity: "warning",
            section: "Results",
            repairable: true,
            message: "The first results paragraph does not transition naturally into the interpretation paragraph.",
            fix_recommendation: "Revise the local transition between the two results paragraphs.",
            supporting_spans: [
              {
                section: "Results",
                paragraph_index: 0,
                excerpt: manuscript.sections[3]!.paragraphs[0]!,
                reason: "This paragraph needs a cleaner bridge into the next results paragraph."
              }
            ]
          }
        ]
      },
      manuscript
    );
    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    const repairPlan = buildManuscriptRepairPlan({
      passIndex: 1,
      manuscript,
      review: validated.review,
      lint: buildManuscriptStyleLint({ manuscript, traceability: makeTraceability(manuscript) }),
      mustImproveIssues: [
        {
          source: "review",
          code: "section_transition",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: "The first results paragraph does not transition naturally into the interpretation paragraph.",
          anchor_ids: validated.review.issues[0]?.supporting_spans.map((span) => span.anchor_id).filter(Boolean) as string[]
        }
      ]
    });

    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "Results",
          paragraph_index: 0,
          edit_scope: "adjacent_two_paragraphs",
          allowed_location_keys: ["paragraph:results:0", "paragraph:results:1"]
        })
      ])
    );
  });

  it("allows an adjacent-two-paragraph repair scope for introduction alignment fixes", () => {
    const manuscript = makeCleanManuscript();
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The introduction framing needs a local alignment repair.",
        issues: [
          {
            code: "alignment",
            severity: "warning",
            section: "Introduction",
            repairable: true,
            message: "The introduction framing should align more closely with the abstract and conclusion.",
            fix_recommendation: "Revise the local introduction framing without rewriting the full section.",
            supporting_spans: [
              {
                section: "Introduction",
                paragraph_index: 1,
                excerpt: manuscript.sections[0]!.paragraphs[1]!,
                reason: "This contribution-framing paragraph should align with the abstract and conclusion."
              }
            ]
          }
        ]
      },
      manuscript
    );
    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    const repairPlan = buildManuscriptRepairPlan({
      passIndex: 1,
      manuscript,
      review: validated.review,
      lint: buildManuscriptStyleLint({ manuscript, traceability: makeTraceability(manuscript) }),
      mustImproveIssues: [
        {
          source: "review",
          code: "alignment",
          severity: "warning",
          section: "Introduction",
          repairable: true,
          message: "The introduction framing should align more closely with the abstract and conclusion.",
          anchor_ids: validated.review.issues[0]?.supporting_spans.map((span) => span.anchor_id).filter(Boolean) as string[]
        }
      ]
    });

    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "Introduction",
          paragraph_index: 1,
          edit_scope: "adjacent_two_paragraphs",
          allowed_location_keys: ["paragraph:introduction:1", "paragraph:introduction:0"]
        })
      ])
    );
  });

  it("flags locality violations when repair changes untargeted sections", () => {
    const before = makeCleanManuscript();
    const after = makeCleanManuscript();
    after.sections[0] = {
      heading: "Introduction",
      paragraphs: ["This unrelated introduction rewrite should not have happened.", before.sections[0]!.paragraphs[1]!]
    };
    after.sections[4] = {
      heading: "Discussion",
      paragraphs: ["The discussion now interprets the result instead of repeating the setup.", before.sections[4]!.paragraphs[1]!]
    };

    const verification = buildManuscriptRepairVerificationArtifact({
      passIndex: 1,
      before,
      after,
      repairPlan: {
        pass_index: 1,
        repair_scope: "bounded_local",
        targets: [
          {
            source: "review",
            issue_code: "paragraph_redundancy",
            severity: "warning",
            kind: "paragraph",
            section: "Discussion",
            location_key: "paragraph:discussion:0",
            paragraph_index: 0,
            excerpt: before.sections[4]!.paragraphs[0]!,
            source_refs: [],
            edit_scope: "paragraph_local",
            allowed_location_keys: ["paragraph:discussion:0"],
            scope_reason: "Repair is limited to the targeted manuscript paragraph."
          }
        ],
        blocked_targets: [],
        preservation_rules: [],
        summary: "One discussion paragraph should change."
      },
      reviewAfter: buildFallbackManuscriptReview(after)
    });

    expect(verification.locality_ok).toBe(false);
    expect(verification.scope_respected).toBe(false);
    expect(verification.out_of_scope_changes).toContain("paragraph:introduction:0");
    expect(verification.unexpected_changed_sections).toContain("introduction");
  });

  it("flags overclaiming changed visual captions in repair verification artifacts", () => {
    const before = makeCleanManuscript();
    before.tables = [
      {
        caption: "Exact numeric comparison for the main revision-stability result.",
        rows: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ];
    before.figures = [
      {
        caption: "A trend-focused figure highlighting the local revision-stability gap.",
        bars: [
          { label: "Relative stability gap", value: 0.05 },
          { label: "Thread-backed drafting", value: 0.76 },
          { label: "Stateless baseline", value: 0.71 }
        ]
      }
    ];

    const after = structuredClone(before);
    after.figures = [
      {
        caption: "This figure clearly demonstrates broad applicability across domains.",
        bars: [
          { label: "Relative stability gap", value: 0.05 },
          { label: "Thread-backed drafting", value: 0.76 },
          { label: "Stateless baseline", value: 0.71 }
        ]
      }
    ];

    const verification = buildManuscriptRepairVerificationArtifact({
      passIndex: 1,
      before,
      after,
      repairPlan: {
        pass_index: 1,
        repair_scope: "bounded_local",
        targets: [
          {
            source: "style_lint",
            issue_code: "visual_redundancy",
            severity: "warning",
            kind: "figure",
            section: "Results",
            location_key: "figure:0",
            visual_index: 0,
            excerpt: before.figures[0]!.caption,
            source_refs: [],
            edit_scope: "visual_local",
            allowed_location_keys: ["figure:0"],
            scope_reason: "Visual redundancy repair is limited to the first figure."
          }
        ],
        blocked_targets: [],
        preservation_rules: [],
        summary: "One figure should change."
      },
      reviewAfter: buildFallbackManuscriptReview(after)
    });

    expect(verification.locality_ok).toBe(true);
    expect(verification.visual_caption_conservatism_ok).toBe(false);
    expect(verification.visual_conservatism_ok).toBe(false);
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
  });

  it("flags overclaiming changed visual labels in repair verification artifacts", () => {
    const before = makeCleanManuscript();
    before.figures = [
      {
        caption: "A trend-focused figure highlighting the local revision-stability gap.",
        bars: [
          { label: "Relative stability gap", value: 0.05 },
          { label: "Thread-backed drafting", value: 0.76 },
          { label: "Stateless baseline", value: 0.71 }
        ]
      }
    ];

    const after = structuredClone(before);
    after.figures = [
      {
        caption: "A trend-focused figure highlighting the local revision-stability gap.",
        bars: [
          { label: "Broad applicability across domains", value: 0.05 },
          { label: "Thread-backed drafting", value: 0.76 },
          { label: "Stateless baseline", value: 0.71 }
        ]
      }
    ];

    const verification = buildManuscriptRepairVerificationArtifact({
      passIndex: 1,
      before,
      after,
      repairPlan: {
        pass_index: 1,
        repair_scope: "bounded_local",
        targets: [
          {
            source: "review",
            issue_code: "visual_redundancy",
            severity: "warning",
            kind: "figure",
            section: "Results",
            location_key: "figure:0",
            visual_index: 0,
            excerpt: before.figures[0]!.caption,
            source_refs: [],
            edit_scope: "visual_local",
            allowed_location_keys: ["figure:0"],
            scope_reason: "Visual wording repair is limited to the first figure."
          }
        ],
        blocked_targets: [],
        preservation_rules: [],
        summary: "One figure should change."
      },
      reviewAfter: buildFallbackManuscriptReview(after)
    });

    expect(verification.visual_label_conservatism_ok).toBe(false);
    expect(verification.visual_conservatism_ok).toBe(false);
    expect(verification.visual_label_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location_key: "figure:0",
          conservative: false,
          labels: expect.arrayContaining(["Broad applicability across domains"]),
          concerns: expect.arrayContaining([
            "The visual wording claims broad applicability beyond the tested setting."
          ])
        })
      ])
    );
  });

  it("flags duplicated section phrasing", () => {
    const manuscript = makeCleanManuscript();
    manuscript.sections[4] = {
      heading: "Discussion",
      paragraphs: [
        manuscript.sections[0]!.paragraphs[0]!,
        "This repeated framing makes the discussion read like a second introduction."
      ]
    };

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    expect(lint.mode).toBe("hard_policy_only");
    expect(lint.issues.some((issue) => issue.code === "duplicate_sentence_pattern")).toBe(true);
    expect(lint.issues.find((issue) => issue.code === "duplicate_sentence_pattern")?.location_keys).toEqual(
      expect.arrayContaining(["paragraph:discussion:0", "paragraph:introduction:0"])
    );
  });

  it("prefers reviewer paragraph-redundancy coverage over duplicate-sentence style lint for the same paragraph", () => {
    const manuscript = makeCleanManuscript();
    manuscript.sections[4] = {
      heading: "Discussion",
      paragraphs: [
        manuscript.sections[0]!.paragraphs[0]!,
        "This repeated framing makes the discussion read like a second introduction."
      ]
    };

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });
    expect(lint.issues.some((issue) => issue.code === "duplicate_sentence_pattern")).toBe(true);

    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The discussion opening repeats the introduction framing.",
        issues: [
          {
            code: "paragraph_redundancy",
            severity: "warning",
            section: "Discussion",
            repairable: true,
            message: "Discussion repeats the introduction framing instead of interpreting the result.",
            fix_recommendation: "Rewrite the discussion opening so it performs a distinct interpretive role.",
            supporting_spans: [
              {
                section: "Discussion",
                paragraph_index: 0,
                excerpt: manuscript.sections[4]!.paragraphs[0]!,
                reason: "This is the duplicated discussion opening."
              }
            ]
          }
        ]
      },
      manuscript
    );

    const validated = validateManuscriptReviewArtifact({
      review,
      manuscript,
      traceability: makeTraceability(manuscript)
    });
    const issues = collectManuscriptQualityIssues({
      review: validated.review,
      lint
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "review",
          code: "paragraph_redundancy",
          section: "Discussion"
        })
      ])
    );
    expect(issues.some((issue) => issue.code === "duplicate_sentence_pattern")).toBe(false);
  });

  it("marks reviewer-covered duplicate sentence findings as backstop-only in the lint artifact", () => {
    const manuscript = makeCleanManuscript();
    manuscript.sections[4] = {
      heading: "Discussion",
      paragraphs: [
        manuscript.sections[0]!.paragraphs[0]!,
        "This repeated framing makes the discussion read like a second introduction."
      ]
    };

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "The discussion opening repeats the introduction framing.",
        issues: [
          {
            code: "paragraph_redundancy",
            severity: "warning",
            section: "Discussion",
            repairable: true,
            message: "Discussion repeats the introduction framing instead of interpreting the result.",
            fix_recommendation: "Rewrite the discussion opening so it performs a distinct interpretive role.",
            supporting_spans: [
              {
                section: "Discussion",
                paragraph_index: 0,
                excerpt: manuscript.sections[4]!.paragraphs[0]!,
                reason: "This is the duplicated discussion opening."
              }
            ]
          }
        ]
      },
      manuscript
    );

    const reconciled = reconcileManuscriptStyleLintWithReview({
      lint,
      review
    });
    const duplicateIssue = reconciled.issues.find((issue) => issue.code === "duplicate_sentence_pattern");

    expect(duplicateIssue?.coverage_status).toBe("backstop_only");
    expect(duplicateIssue?.covered_by_review_issue_code).toBe("paragraph_redundancy");
    expect(reconciled.summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/duplicate-sentence finding\(s\).*backstop-only/i)
      ])
    );
  });

  it("marks reviewer-covered visual redundancy findings as backstop-only in the lint artifact", () => {
    const manuscript = makeCleanManuscript();
    manuscript.tables = [
      {
        caption: "Exact numeric comparison for the main revision-stability result.",
        rows: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ];
    manuscript.figures = [
      {
        caption: "A redundant figure that should be revised into a distinct visual takeaway.",
        bars: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      }
    ];

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "One visual pair is redundant.",
        issues: [
          {
            code: "visual_redundancy",
            severity: "warning",
            section: "Results",
            repairable: true,
            message: "Figure 1 restates Table 1 rather than adding a distinct visual pattern.",
            fix_recommendation: "Revise Figure 1 into a trend-focused visual and keep the exact table.",
            visual_targets: [
              { kind: "table", index: 0, rationale: "Table 1 is one half of the redundant pair." },
              { kind: "figure", index: 0, rationale: "Figure 1 is the redundant visual that should change." }
            ]
          }
        ]
      },
      manuscript
    );

    const reconciled = reconcileManuscriptStyleLintWithReview({
      lint,
      review
    });
    const visualIssue = reconciled.issues.find((issue) => issue.code === "visual_redundancy");

    expect(visualIssue?.coverage_status).toBe("backstop_only");
    expect(visualIssue?.covered_by_review_issue_code).toBe("visual_redundancy");
    expect(reconciled.summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/visual-redundancy finding\(s\).*backstop-only/i)
      ])
    );
  });

  it("flags redundant figure and table pairs", () => {
    const manuscript = makeCleanManuscript();
    manuscript.tables = [
      {
        caption: "Exact numeric comparison for the main revision-stability result.",
        rows: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      },
      {
        caption: "A separate calibration table that should not be targeted.",
        rows: [
          { label: "Calibration baseline", value: 0.41 },
          { label: "Calibrated variant", value: 0.45 }
        ]
      }
    ];
    manuscript.figures = [
      {
        caption: "Dataset-level outcome summary retained in the main paper.",
        bars: [
          { label: "Stateless baseline", value: 0.71 },
          { label: "Thread-backed drafting", value: 0.76 }
        ]
      },
      {
        caption: "A distinct tradeoff figure that should remain untouched.",
        bars: [
          { label: "Latency-optimized", value: 0.52 },
          { label: "Accuracy-optimized", value: 0.61 }
        ]
      }
    ];

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    const visualIssue = lint.issues.find((issue) => issue.code === "visual_redundancy");
    expect(visualIssue).toBeDefined();
    expect(visualIssue?.redundant_visual_pair).toEqual({
      table_index: 0,
      figure_index: 0,
      shared_labels: ["Stateless baseline", "Thread-backed drafting"]
    });

    const repairPlan = buildManuscriptRepairPlan({
      passIndex: 1,
      manuscript,
      review: buildFallbackManuscriptReview(manuscript),
      lint,
      mustImproveIssues: [
        {
          source: "style_lint",
          code: "visual_redundancy",
          severity: "warning",
          section: "Results",
          repairable: true,
          message: visualIssue?.message || "A redundant visual pair remains."
        }
      ]
    });

    expect(repairPlan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "table", location_key: "table:0" }),
        expect.objectContaining({ kind: "figure", location_key: "figure:0" })
      ])
    );
    expect(repairPlan.targets.some((target) => target.location_key === "table:1")).toBe(false);
    expect(repairPlan.targets.some((target) => target.location_key === "figure:1")).toBe(false);
  });

  it("rejects appendix internal and meta text", () => {
    const manuscript = makeCleanManuscript();
    manuscript.appendix_sections = [
      {
        heading: "Appendix. Notes",
        paragraphs: ["TODO: keep topic fixed and inspect .autolabos/runs/run-1/result_analysis.json before finalizing."]
      }
    ];

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    expect(lint.ok).toBe(false);
    expect(lint.issues.some((issue) => issue.code === "appendix_meta_text")).toBe(true);
    expect(lint.issues.some((issue) => issue.code === "appendix_raw_artifact_reference")).toBe(true);
    expect(lint.issues.find((issue) => issue.code === "appendix_meta_text")?.location_keys).toEqual(
      expect.arrayContaining([expect.stringMatching(/^appendix_paragraph:.*:0$/)])
    );
  });

  it("marks uncovered appendix contamination as a hard-stop policy finding in the reconciled lint artifact", () => {
    const manuscript = makeCleanManuscript();
    manuscript.appendix_sections = [
      {
        heading: "Appendix. Notes",
        paragraphs: ["TODO: keep topic fixed and inspect .autolabos/runs/run-1/result_analysis.json before finalizing."]
      }
    ];

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });
    const reconciled = reconcileManuscriptStyleLintWithReview({
      lint,
      review: buildFallbackManuscriptReview(manuscript)
    });

    const appendixMetaIssue = reconciled.issues.find((issue) => issue.code === "appendix_meta_text");
    expect(appendixMetaIssue?.gate_role).toBe("hard_stop");
    expect(appendixMetaIssue?.coverage_status).toBe("primary");
    expect(reconciled.summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/appendix-contamination finding\(s\).*hard-stop/i)
      ])
    );

    const issues = collectManuscriptQualityIssues({
      review: buildFallbackManuscriptReview(manuscript),
      lint: reconciled
    });
    expect(issues.find((issue) => issue.code === "appendix_meta_text")?.repairable).toBe(false);
  });

  it("marks reviewer-covered appendix contamination as backstop-only in the reconciled lint artifact", () => {
    const manuscript = makeCleanManuscript();
    manuscript.appendix_sections = [
      {
        heading: "Appendix. Notes",
        paragraphs: ["TODO: keep topic fixed and inspect .autolabos/runs/run-1/result_analysis.json before finalizing."]
      }
    ];

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });
    const review = normalizeManuscriptReview(
      {
        overall_decision: "repair",
        summary: "Appendix contamination should be removed locally.",
        issues: [
          {
            code: "appendix_hygiene",
            severity: "fail",
            section: "Appendix",
            repairable: true,
            message: "The appendix contains internal planning language and raw artifact references.",
            fix_recommendation: "Remove the internal/meta appendix paragraph.",
            supporting_spans: [
              {
                section: "Appendix. Notes",
                paragraph_index: 0,
                excerpt: manuscript.appendix_sections[0]!.paragraphs[0]!,
                reason: "This appendix paragraph contains internal/meta text."
              }
            ]
          }
        ]
      },
      manuscript
    );

    const reconciled = reconcileManuscriptStyleLintWithReview({
      lint,
      review
    });
    const appendixMetaIssue = reconciled.issues.find((issue) => issue.code === "appendix_meta_text");

    expect(appendixMetaIssue?.gate_role).toBe("backstop_only");
    expect(appendixMetaIssue?.covered_by_review_issue_code).toBe("appendix_hygiene");
    expect(reconciled.summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/appendix-contamination finding\(s\).*backstop-only/i)
      ])
    );
  });

  it("leaves soft section adequacy judgments to manuscript review", () => {
    const manuscript = makeCleanManuscript();
    manuscript.sections = manuscript.sections.map((section) =>
      section.heading === "Results"
        ? { heading: "Results", paragraphs: ["We report one result."] }
        : section
    );

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    expect(lint.issues.some((issue) => issue.code === "results_section_thin")).toBe(false);
  });

  it("passes a clean manuscript without findings", () => {
    const manuscript = makeCleanManuscript();

    const lint = buildManuscriptStyleLint({
      manuscript,
      traceability: makeTraceability(manuscript)
    });

    expect(lint.ok).toBe(true);
    expect(lint.issues.filter((issue) => issue.severity === "fail")).toHaveLength(0);
  });
});
