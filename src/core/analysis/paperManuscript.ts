import { ObjectiveMetricEvaluation, ObjectiveMetricProfile } from "../objectiveMetric.js";
import { ConstraintProfile } from "../runConstraints.js";
import type { PaperProfileConfig } from "../../types.js";
import type { ParsedLatexTemplate } from "../latex/latexTemplateLoader.js";
import {
  buildSuggestedPaperTitle,
  choosePaperTitle,
  ExperimentPlanArtifact,
  PaperDraft,
  PaperDraftClaim,
  PaperWritingBundle,
  ResultAnalysisArtifact,
  sanitizePaperNarrativeText
} from "./paperWriting.js";

const STANDARD_SECTION_HEADINGS = [
  "Introduction",
  "Related Work",
  "Method",
  "Results",
  "Discussion",
  "Limitations",
  "Conclusion"
] as const;

const BANNED_HEADINGS = [
  "Research Context",
  "Writing Constraints",
  "Results Overview",
  "Claim Trace"
] as const;

const INTERNAL_ARTIFACT_FILENAMES = [
  "confirmatory_metrics.json",
  "quick_check_metrics.json",
  "metrics.json",
  "result_analysis.json"
] as const;

export const AUTHORED_MAIN_TABLE_SOURCE_REF_ID = "manuscript.authored_main_table";
export const AUTHORED_MAIN_FIGURE_SOURCE_REF_ID = "manuscript.authored_main_figure";
export const AUTHORED_APPENDIX_TABLE_SOURCE_REF_ID = "manuscript.authored_appendix_table";
export const AUTHORED_APPENDIX_FIGURE_SOURCE_REF_ID = "manuscript.authored_appendix_figure";

export interface PaperManuscriptSection {
  heading: string;
  paragraphs: string[];
  source_refs?: PaperSourceRef[];
}

export interface PaperManuscriptVisualRow {
  label: string;
  value: number;
}

export interface PaperManuscriptTable {
  caption: string;
  rows: PaperManuscriptVisualRow[];
  source_refs?: PaperSourceRef[];
}

export interface PaperManuscriptFigure {
  caption: string;
  bars: PaperManuscriptVisualRow[];
  source_refs?: PaperSourceRef[];
}

export interface PaperAuthorMetadata {
  authors: string[];
  affiliations?: string[];
  anonymous?: boolean;
}

export interface PaperSourceRef {
  kind: "evidence" | "claim" | "citation" | "artifact";
  id: string;
  label?: string;
}

export interface PaperManuscript {
  title: string;
  abstract: string;
  keywords: string[];
  sections: PaperManuscriptSection[];
  tables?: PaperManuscriptTable[];
  figures?: PaperManuscriptFigure[];
  appendix_sections?: PaperManuscriptSection[];
  appendix_tables?: PaperManuscriptTable[];
  appendix_figures?: PaperManuscriptFigure[];
}

export interface PaperTraceabilityEntry {
  anchor_id?: string;
  manuscript_section: string;
  paragraph_index: number;
  source_draft_section: string;
  evidence_ids: string[];
  citation_paper_ids: string[];
  claim_ids?: string[];
  source_refs?: PaperSourceRef[];
}

export interface PaperTraceabilityReport {
  paragraphs: PaperTraceabilityEntry[];
}

export interface PaperSubmissionValidationIssue {
  kind:
    | "citation"
    | "placeholder_citation"
    | "evidence_id"
    | "absolute_path"
    | "artifact_filename"
    | "banned_heading";
  location: string;
  message: string;
  value?: string;
}

export interface PaperSubmissionValidationReport {
  ok: boolean;
  citedPaperIds: string[];
  unresolvedCitationPaperIds: string[];
  issues: PaperSubmissionValidationIssue[];
}

export interface CuratedPaperResultHighlights {
  objectiveSummary?: string;
  selectedDesignTitle?: string;
  topFindings: string[];
  comparisonTakeaways: string[];
  limitations: string[];
  discussionPoints: string[];
  confidenceStatement?: string;
}

interface RawPaperManuscript {
  title?: unknown;
  abstract?: unknown;
  keywords?: unknown;
  sections?: unknown;
  tables?: unknown;
  figures?: unknown;
  appendix_sections?: unknown;
  appendix_tables?: unknown;
  appendix_figures?: unknown;
}

interface RawPaperManuscriptSection {
  heading?: unknown;
  paragraphs?: unknown;
}

interface RawPaperManuscriptParagraph {
  text?: unknown;
}

interface RawPaperManuscriptTable {
  caption?: unknown;
  rows?: unknown;
}

interface RawPaperManuscriptFigure {
  caption?: unknown;
  bars?: unknown;
}

interface RawPaperManuscriptEnvelope {
  revised_manuscript?: unknown;
}

interface RawPaperManuscriptVisualRow {
  label?: unknown;
  value?: unknown;
}

export function parsePaperManuscriptJson(text: string): RawPaperManuscript {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_paper_manuscript_output");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  const candidate = fenced || extractFirstJsonObject(trimmed);
  const parsed = JSON.parse(candidate) as RawPaperManuscript | RawPaperManuscriptEnvelope;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_paper_manuscript_json");
  }
  const record = parsed as RawPaperManuscriptEnvelope;
  const manuscriptCandidate = record.revised_manuscript;
  if (manuscriptCandidate && typeof manuscriptCandidate === "object" && !Array.isArray(manuscriptCandidate)) {
    return manuscriptCandidate as RawPaperManuscript;
  }
  return parsed as RawPaperManuscript;
}

export function buildPaperPolishPrompt(input: {
  bundle: PaperWritingBundle;
  draft: PaperDraft;
  constraintProfile: ConstraintProfile;
  paperProfile?: PaperProfileConfig;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
}): string {
  const highlights = curatePaperResultHighlights({
    resultAnalysis: input.bundle.resultAnalysis,
    objectiveEvaluation: input.objectiveEvaluation,
    objectiveMetricProfile: input.objectiveMetricProfile,
    experimentPlan: input.bundle.experimentPlan
  });

  const citationLibrary = uniqueStrings(
    input.draft.sections.flatMap((section) => section.citation_paper_ids)
  )
    .map((paperId) => input.bundle.corpus.find((item) => item.paper_id === paperId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 10)
    .map((item) => ({
      paper_id: item.paper_id,
      title: item.title,
      year: item.year,
      venue: item.venue
    }));

  const promptPayload = {
    run: {
      title: input.bundle.runTitle,
      topic: input.bundle.topic,
      objective_metric: input.bundle.objectiveMetric,
      constraints: input.bundle.constraints.map((item) => sanitizePaperNarrativeText(item))
    },
    title_guidance: {
      suggested_paper_title: input.draft.title || buildSuggestedPaperTitle(input.bundle),
      note: "Do not reuse the workflow run title as the paper title. Prefer a method, benchmark, or empirical-study title."
    },
    writing_profile: {
      target_venue: input.constraintProfile.writing.targetVenue,
      tone_hint: input.constraintProfile.writing.toneHint,
      length_hint: input.constraintProfile.writing.lengthHint
    },
    paper_profile: input.paperProfile,
    objective_profile: {
      primary_metric: input.objectiveMetricProfile.primaryMetric,
      target_description: input.objectiveMetricProfile.targetDescription,
      paper_emphasis: input.objectiveMetricProfile.paperEmphasis
    },
    curated_result_highlights: highlights,
    citation_library: citationLibrary,
    grounded_draft: input.draft
  };

  return [
    "Convert the grounded draft into a human-facing submission manuscript.",
    "Return one JSON object with this shape:",
    "{",
    '  "title": "string",',
    '  "abstract": "string",',
    '  "keywords": ["string"],',
    '  "sections": [',
    "    {",
    '      "heading": "Introduction | Related Work | Method | Results | Discussion | Limitations | Conclusion",',
    '      "paragraphs": ["string"]',
    "    }",
    "  ],",
    '  "tables": [{"caption": "string", "rows": [{"label": "string", "value": 0.0}]}],',
    '  "figures": [{"caption": "string", "bars": [{"label": "string", "value": 0.0}]}],',
    '  "appendix_sections": [{"heading": "string", "paragraphs": ["string"]}],',
    '  "appendix_tables": [{"caption": "string", "rows": [{"label": "string", "value": 0.0}]}],',
    '  "appendix_figures": [{"caption": "string", "bars": [{"label": "string", "value": 0.0}]}]',
    "}",
    "",
    "Requirements:",
    "- Choose a title that reads like a human-written methods, benchmark, or empirical study paper title.",
    "- Do not copy the workflow run title verbatim or with only cosmetic edits.",
    "- Write plain academic prose that reads like a human-authored submission draft.",
    "- Preserve the grounded draft's claims conservatively; do not add new results.",
    "- Evidence-first does not mean short-by-default: maintain enough detail in Method, Results, Discussion, and Limitations to read like a full scientific paper rather than a summary.",
    "- Keep cautious claim strength and explanatory density separate: weaken overstated claims, but do not collapse sections into one-liners.",
    "- Keep the problem framing, related-work positioning, method, main results, and core limitations in the main paper.",
    "- Each major section must play a distinct rhetorical role; do not reuse the same framing sentence across sections.",
    "- Related Work must organize prior work around comparison axes, not just summarize papers one by one.",
    "- Discussion must interpret the results rather than restating the Results section.",
    "- Limitations must name concrete scope limits or evaluation constraints.",
    "- Tables and figures must be informative and non-redundant. If a figure only restates a table more vaguely, omit the figure.",
    "- If you include appendix content, limit it to reader-relevant supporting scientific material such as reproducibility details, supplementary setup details, extended metrics, ablations, additional qualitative examples, or a paper-appropriate prompt/template summary.",
    "- Do not include internal workflow instructions, planning directives, raw artifact references, system prompts, TODO notes, or unresolved author notes anywhere in the manuscript or appendix.",
    "- Downstream routing may move supporting detail such as repeat-level raw metrics, search-space grids, or environment notes into the appendix.",
    "- Do not include evidence IDs, claim IDs, paper IDs, file paths, JSON field names, or internal artifact names in the prose.",
    "- Do not put raw DOI strings, Semantic Scholar hashes, bracketed paper identifiers, evidence identifiers, or citation tokens in paragraph text. Use the manuscript source_refs/citation structure; the renderer will format citations.",
    "- Method must name the executed model/backbone and fixed training settings when they are present in the run artifacts. Do not say exact values are unavailable when the context exposes them.",
    "- Avoid repeated caveat boilerplate such as 'direct supporting evidence is currently limited'; state scope limitations once in Limitations or Discussion instead.",
    "- Do not use the headings Research Context, Writing Constraints, Results Overview, or Claim Trace.",
    "- Keep section headings academic and conventional.",
    "- Avoid log-speak, checklist phrasing, and repeated template language.",
    "- Do not repeat the same framing sentence in multiple sections.",
    "- Do not emit both a table and a figure for nearly identical information unless the figure adds a distinct trend, distribution, or tradeoff insight.",
    "- Do not include internal run instructions, TODO language, or meta commentary.",
    "- Do not inflate claims beyond the available evidence.",
    "- Include at least one informative result table or figure when the payload supports it.",
    "",
    "Context JSON:",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}

export function normalizePaperManuscript(input: {
  raw?: RawPaperManuscript;
  draft: PaperDraft;
  runTitle?: string;
  resultAnalysis?: ResultAnalysisArtifact;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
  experimentPlan?: ExperimentPlanArtifact;
  fallbackManuscript?: PaperManuscript;
}): PaperManuscript {
  const fallback = buildFallbackPaperManuscript({
    draft: input.draft,
    resultAnalysis: input.resultAnalysis,
    objectiveEvaluation: input.objectiveEvaluation,
    objectiveMetricProfile: input.objectiveMetricProfile,
    experimentPlan: input.experimentPlan
  });
  const baseManuscript = input.fallbackManuscript || fallback;
  const sections = normalizeManuscriptSections(
    Array.isArray(input.raw?.sections) ? (input.raw?.sections as RawPaperManuscriptSection[]) : []
  );
  const tables = markVisualsAsAuthored(
    normalizeManuscriptTables(
      Array.isArray(input.raw?.tables) ? (input.raw?.tables as RawPaperManuscriptTable[]) : []
    ),
    AUTHORED_MAIN_TABLE_SOURCE_REF_ID
  );
  const figures = markVisualsAsAuthored(
    normalizeManuscriptFigures(
      Array.isArray(input.raw?.figures) ? (input.raw?.figures as RawPaperManuscriptFigure[]) : []
    ),
    AUTHORED_MAIN_FIGURE_SOURCE_REF_ID
  );
  const appendixTables = markVisualsAsAuthored(
    normalizeManuscriptTables(
      Array.isArray(input.raw?.appendix_tables) ? (input.raw?.appendix_tables as RawPaperManuscriptTable[]) : []
    ),
    AUTHORED_APPENDIX_TABLE_SOURCE_REF_ID
  );
  const appendixFigures = markVisualsAsAuthored(
    normalizeManuscriptFigures(
      Array.isArray(input.raw?.appendix_figures) ? (input.raw?.appendix_figures as RawPaperManuscriptFigure[]) : []
    ),
    AUTHORED_APPENDIX_FIGURE_SOURCE_REF_ID
  );
  const appendixSections = normalizeManuscriptSections(
    Array.isArray(input.raw?.appendix_sections) ? (input.raw?.appendix_sections as RawPaperManuscriptSection[]) : [],
    { sanitizeNarrative: false }
  );

  const resolvedSections = preserveSectionSourceRefs(
    sections.length > 0 ? sections : baseManuscript.sections,
    baseManuscript.sections
  );
  const resolvedTables = preserveVisualSourceRefs(
    tables.length > 0 ? tables : baseManuscript.tables,
    baseManuscript.tables
  );
  const resolvedFigures = preserveVisualSourceRefs(
    figures.length > 0 ? figures : baseManuscript.figures,
    baseManuscript.figures
  );
  const resolvedAppendixSections = preserveSectionSourceRefs(
    appendixSections.length > 0 ? appendixSections : baseManuscript.appendix_sections,
    baseManuscript.appendix_sections
  );
  const resolvedAppendixTables = preserveVisualSourceRefs(
    appendixTables.length > 0 ? appendixTables : baseManuscript.appendix_tables,
    baseManuscript.appendix_tables
  );
  const resolvedAppendixFigures = preserveVisualSourceRefs(
    appendixFigures.length > 0 ? appendixFigures : baseManuscript.appendix_figures,
    baseManuscript.appendix_figures
  );

  return {
    title: choosePaperTitle({
      candidateTitle: input.raw?.title,
      runTitle: input.runTitle || input.draft.title,
      fallbackTitle: baseManuscript.title
    }),
    abstract: sanitizePaperNarrativeText(input.raw?.abstract) || baseManuscript.abstract,
    keywords:
      normalizeStringArray(input.raw?.keywords).slice(0, 6).length > 0
        ? normalizeStringArray(input.raw?.keywords).slice(0, 6)
        : baseManuscript.keywords,
    sections: resolvedSections || baseManuscript.sections,
    ...(resolvedTables?.length ? { tables: resolvedTables } : {}),
    ...(resolvedFigures?.length ? { figures: resolvedFigures } : {}),
    ...(resolvedAppendixSections?.length ? { appendix_sections: resolvedAppendixSections } : {}),
    ...(resolvedAppendixTables?.length ? { appendix_tables: resolvedAppendixTables } : {}),
    ...(resolvedAppendixFigures?.length ? { appendix_figures: resolvedAppendixFigures } : {})
  };
}

export function buildFallbackPaperManuscript(input: {
  draft: PaperDraft;
  resultAnalysis?: ResultAnalysisArtifact;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
  experimentPlan?: ExperimentPlanArtifact;
}): PaperManuscript {
  const highlights = curatePaperResultHighlights({
    resultAnalysis: input.resultAnalysis,
    objectiveEvaluation: input.objectiveEvaluation,
    objectiveMetricProfile: input.objectiveMetricProfile,
    experimentPlan: input.experimentPlan
  });

  const sections = input.draft.sections
    .map((section) => ({
      heading: cleanString(section.heading),
      paragraphs: section.paragraphs
        .map((paragraph) => cleanString(paragraph.text))
        .filter(Boolean)
        .slice(0, 2)
    }))
    .filter((section) => section.heading && section.paragraphs.length > 0)
    .map((section) => ({
      heading: section.heading,
      paragraphs:
        normalizeHeadingKey(section.heading) === "results"
          ? enrichResultsParagraphs(section.paragraphs, highlights)
          : section.paragraphs
    }));

  const normalizedSections = sections.length > 0 ? sections : buildDefaultSections(highlights);
  const discussionSection = buildFallbackDiscussionSection(normalizedSections, highlights);
  const withDiscussion =
    discussionSection &&
    !normalizedSections.some(
      (section) => normalizeHeadingKey(section.heading) === normalizeHeadingKey(discussionSection.heading)
    )
      ? [...normalizedSections, discussionSection]
      : normalizedSections;
  const visuals = buildAutomaticManuscriptVisuals(input.resultAnalysis, highlights);
  const appendix = buildAutomaticManuscriptAppendix(input.resultAnalysis, highlights);

  return {
    title: input.draft.title,
    abstract: input.draft.abstract,
    keywords: input.draft.keywords.slice(0, 6),
    sections: sortSections(withDiscussion),
    ...(visuals.tables.length > 0 ? { tables: visuals.tables } : {}),
    ...(visuals.figures.length > 0 ? { figures: visuals.figures } : {}),
    ...(appendix.sections.length > 0 ? { appendix_sections: appendix.sections } : {}),
    ...(appendix.tables.length > 0 ? { appendix_tables: appendix.tables } : {})
  };
}

export function buildPaperTraceability(input: {
  draft: PaperDraft;
  manuscript: PaperManuscript;
}): PaperTraceabilityReport {
  const sectionByHeading = new Map(
    input.draft.sections.map((section) => [normalizeHeadingKey(section.heading), section] as const)
  );
  const aggregateGrounding = buildAggregateDraftGrounding(input.draft);

  return {
    paragraphs: [
      {
        anchor_id: buildParagraphAnchorId("Title", 0),
        manuscript_section: "Title",
        paragraph_index: 0,
        source_draft_section: "",
        evidence_ids: aggregateGrounding.evidenceIds,
        citation_paper_ids: aggregateGrounding.citationPaperIds,
        ...(aggregateGrounding.sourceRefs ? { source_refs: aggregateGrounding.sourceRefs } : {}),
        ...(aggregateGrounding.claimIds.length > 0 ? { claim_ids: aggregateGrounding.claimIds } : {})
      },
      {
        anchor_id: buildParagraphAnchorId("Abstract", 0),
        manuscript_section: "Abstract",
        paragraph_index: 0,
        source_draft_section: "",
        evidence_ids: aggregateGrounding.evidenceIds,
        citation_paper_ids: aggregateGrounding.citationPaperIds,
        ...(aggregateGrounding.sourceRefs ? { source_refs: aggregateGrounding.sourceRefs } : {}),
        ...(aggregateGrounding.claimIds.length > 0 ? { claim_ids: aggregateGrounding.claimIds } : {})
      },
      ...buildTraceabilityEntriesForSectionCollection({
        sections: input.manuscript.sections,
        draft: input.draft,
        sectionByHeading,
        anchorNamespace: "main"
      }),
      ...buildTraceabilityEntriesForSectionCollection({
        sections: input.manuscript.appendix_sections || [],
        draft: input.draft,
        sectionByHeading,
        anchorNamespace: "appendix"
      })
    ]
  };
}

export function buildPaperSubmissionValidation(input: {
  manuscript: PaperManuscript;
  tex: string;
  traceability: PaperTraceabilityReport;
  citationKeysByPaperId: Map<string, string>;
  unresolvedCitationPaperIds?: string[];
}): PaperSubmissionValidationReport {
  const issues: PaperSubmissionValidationIssue[] = [];
  const citedPaperIds = uniqueStrings(
    input.traceability.paragraphs.flatMap((paragraph) => paragraph.citation_paper_ids)
  );
  const unresolvedCitationPaperIds = uniqueStrings([
    ...citedPaperIds.filter((paperId) => !input.citationKeysByPaperId.has(paperId)),
    ...(input.unresolvedCitationPaperIds || [])
  ]);

  for (const heading of input.manuscript.sections.map((section) => section.heading)) {
    if (isBannedHeading(heading)) {
      issues.push({
        kind: "banned_heading",
        location: "manuscript.section.heading",
        message: "Final manuscript uses a banned debug-style heading.",
        value: heading
      });
    }
  }

  validateSubmissionChunk(input.manuscript.title, "manuscript.title", issues);
  validateSubmissionChunk(input.manuscript.abstract, "manuscript.abstract", issues);
  for (const section of input.manuscript.sections) {
    for (let index = 0; index < section.paragraphs.length; index += 1) {
      validateSubmissionChunk(
        section.paragraphs[index],
        `manuscript.sections.${section.heading}.paragraphs.${index}`,
        issues
      );
    }
  }
  for (const section of input.manuscript.appendix_sections || []) {
    for (let index = 0; index < section.paragraphs.length; index += 1) {
      validateSubmissionChunk(
        section.paragraphs[index],
        `manuscript.appendix_sections.${section.heading}.paragraphs.${index}`,
        issues
      );
    }
  }
  validateSubmissionChunk(input.tex, "paper.main.tex", issues);

  for (const paperId of unresolvedCitationPaperIds) {
    issues.push({
      kind: "citation",
      location: "traceability",
      message: "A cited paper ID does not resolve to a bibliography key.",
      value: paperId
    });
  }

  return {
    ok: issues.length === 0,
    citedPaperIds,
    unresolvedCitationPaperIds,
    issues
  };
}

export function renderSubmissionPaperTex(input: {
  manuscript: PaperManuscript;
  traceability: PaperTraceabilityReport;
  citationKeysByPaperId: Map<string, string>;
  template?: string;
  paperProfile?: PaperProfileConfig;
  parsedTemplate?: ParsedLatexTemplate | null;
  authorMetadata?: PaperAuthorMetadata | null;
}): string {
  const sectionCitationMap = new Map<string, string[]>();
  for (const item of input.traceability.paragraphs) {
    sectionCitationMap.set(
      buildTraceabilityKey(item.manuscript_section, item.paragraph_index),
      item.citation_paper_ids
    );
  }

  const columnCount = input.parsedTemplate?.columnLayout ?? (input.paperProfile?.column_count ?? 2);
  const docClassOptions = columnCount === 2 ? "[twocolumn]" : "";
  const renderedAuthor = renderAuthorCommand(input.authorMetadata);
  const supportPackages = buildSubmissionSupportPackages(input.parsedTemplate);

  const lines = input.parsedTemplate
    ? [
        input.parsedTemplate.documentClass || resolveDocumentClass(input.template).replace("{article}", `${docClassOptions}{article}`),
        input.parsedTemplate.preamble,
        ...supportPackages,
        "\\title{" + latexEscape(input.manuscript.title) + "}",
        ...(renderedAuthor ? [renderedAuthor] : []),
        "\\date{}",
        "\\begin{document}",
        "\\maketitle",
        "\\begin{abstract}",
        latexEscape(input.manuscript.abstract),
        "\\end{abstract}"
      ]
    : [
        resolveDocumentClass(input.template).replace("{article}", `${docClassOptions}{article}`),
        "\\usepackage[T1]{fontenc}",
        columnCount === 2
          ? "\\usepackage[margin=0.75in]{geometry}"
          : "\\usepackage[margin=1in]{geometry}",
        "\\usepackage{graphicx}",
        ...supportPackages,
        "\\title{" + latexEscape(input.manuscript.title) + "}",
        ...(renderedAuthor ? [renderedAuthor] : []),
        "\\date{}",
        "\\begin{document}",
        "\\maketitle",
        "\\begin{abstract}",
        latexEscape(input.manuscript.abstract),
        "\\end{abstract}"
      ];

  if (input.manuscript.keywords.length > 0) {
    lines.push(`\\noindent\\textbf{Keywords:} ${latexEscape(input.manuscript.keywords.join(", "))}`);
    lines.push("");
  }

  let visualsRendered = false;
  for (const section of input.manuscript.sections) {
    lines.push(`\\section{${latexEscape(section.heading)}}`);
    for (let index = 0; index < section.paragraphs.length; index += 1) {
      const paragraph = section.paragraphs[index];
      const citationPaperIds = shouldRenderSubmissionCitationsForParagraph(section.heading, paragraph, index)
        ? sectionCitationMap.get(buildTraceabilityKey(section.heading, index)) || []
        : [];
      lines.push(renderSubmissionParagraph(paragraph, citationPaperIds, input.citationKeysByPaperId));
      lines.push("");
    }

    if (!visualsRendered && normalizeHeadingKey(section.heading) === "results") {
      lines.push(...renderSubmissionVisuals(input.manuscript));
      visualsRendered = true;
    }
  }

  if (!visualsRendered) {
    lines.push(...renderSubmissionVisuals(input.manuscript));
  }

  lines.push("\\bibliographystyle{plain}");
  lines.push("\\bibliography{references}");
  if (
    (input.manuscript.appendix_sections || []).length > 0 ||
    (input.manuscript.appendix_tables || []).length > 0 ||
    (input.manuscript.appendix_figures || []).length > 0
  ) {
    lines.push("\\appendix");
    lines.push("");
    for (const section of input.manuscript.appendix_sections || []) {
      lines.push(`\\section{${latexEscape(section.heading)}}`);
      for (const paragraph of section.paragraphs) {
        lines.push(latexEscape(paragraph));
        lines.push("");
      }
    }
    lines.push(
      ...renderVisualCollection(
        input.manuscript.appendix_tables || [],
        input.manuscript.appendix_figures || []
      )
    );
  }
  lines.push("\\end{document}");
  return lines.join("\n");
}

export function curatePaperResultHighlights(input: {
  resultAnalysis?: ResultAnalysisArtifact;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  objectiveMetricProfile?: ObjectiveMetricProfile;
  experimentPlan?: ExperimentPlanArtifact;
}): CuratedPaperResultHighlights {
  const objectiveSummary =
    cleanString(input.objectiveEvaluation?.summary) ||
    cleanString(input.resultAnalysis?.objective_metric?.evaluation?.summary) ||
    cleanString(input.objectiveMetricProfile?.targetDescription);
  const comparisonTakeaways = takeSafeStrings(
    [
      ...(input.resultAnalysis?.condition_comparisons || []).map((item) => cleanString(item?.summary)),
      ...(input.resultAnalysis?.external_comparisons || []).map((item) => cleanString(item?.summary))
    ],
    2
  );

  return {
    objectiveSummary,
    selectedDesignTitle:
      cleanString(input.resultAnalysis?.plan_context?.selected_design?.title) ||
      cleanString(input.experimentPlan?.selectedTitle),
    topFindings: takeSafeStrings(input.resultAnalysis?.primary_findings || [], 3),
    comparisonTakeaways,
    limitations: takeSafeStrings(input.resultAnalysis?.limitations || [], 2),
    discussionPoints: takeSafeStrings(input.resultAnalysis?.synthesis?.discussion_points || [], 2),
    confidenceStatement: cleanString(input.resultAnalysis?.synthesis?.confidence_statement)
  };
}

function normalizeManuscriptSections(
  sections: RawPaperManuscriptSection[],
  options: { sanitizeNarrative?: boolean } = {}
): PaperManuscriptSection[] {
  return sections
    .map((section) => {
      const heading = cleanString(section?.heading);
      const paragraphs = normalizeManuscriptParagraphs(section?.paragraphs, options);
      if (!heading || paragraphs.length === 0) {
        return undefined;
      }
      return {
        heading,
        paragraphs
      };
    })
    .filter((section): section is PaperManuscriptSection => Boolean(section))
    .slice(0, 10);
}

function normalizeManuscriptParagraphs(
  value: unknown,
  options: { sanitizeNarrative?: boolean } = {}
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitizeNarrative = options.sanitizeNarrative !== false;
  return value
    .map((paragraph) => {
      if (typeof paragraph === "string") {
        return sanitizeNarrative ? sanitizePaperNarrativeText(paragraph) : cleanString(paragraph);
      }
      if (!paragraph || typeof paragraph !== "object" || Array.isArray(paragraph)) {
        return "";
      }
      const text = (paragraph as RawPaperManuscriptParagraph).text;
      return sanitizeNarrative ? sanitizePaperNarrativeText(text) : cleanString(text);
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeManuscriptTables(
  tables: RawPaperManuscriptTable[]
): PaperManuscriptTable[] {
  return tables
    .map((table) => {
      const caption = cleanString(table?.caption);
      const rows = normalizeVisualRows(table?.rows);
      if (!caption || !visualRowsMeetQualityGate(rows)) {
        return undefined;
      }
      return {
        caption,
        rows: rows.slice(0, 6)
      };
    })
    .filter((table): table is PaperManuscriptTable => Boolean(table))
    .slice(0, 2);
}

function normalizeManuscriptFigures(
  figures: RawPaperManuscriptFigure[]
): PaperManuscriptFigure[] {
  return figures
    .map((figure) => {
      const caption = cleanString(figure?.caption);
      const bars = normalizeVisualRows(figure?.bars);
      if (!caption || !visualRowsMeetQualityGate(bars)) {
        return undefined;
      }
      return {
        caption,
        bars: bars.slice(0, 5)
      };
    })
    .filter((figure): figure is PaperManuscriptFigure => Boolean(figure))
    .slice(0, 2);
}

function preserveSectionSourceRefs<T extends PaperManuscriptSection>(
  sections: T[] | undefined,
  fallbackSections: PaperManuscriptSection[] | undefined
): T[] | undefined {
  if (!sections?.length) {
    return sections;
  }
  const fallbackByHeading = new Map(
    (fallbackSections || []).map((section) => [normalizeHeadingKey(section.heading), section] as const)
  );
  return sections.map((section) => {
    const fallback = fallbackByHeading.get(normalizeHeadingKey(section.heading));
    return fallback?.source_refs?.length ? { ...section, source_refs: fallback.source_refs } : section;
  });
}

function preserveVisualSourceRefs<T extends PaperManuscriptTable | PaperManuscriptFigure>(
  items: T[] | undefined,
  fallbackItems: Array<PaperManuscriptTable | PaperManuscriptFigure> | undefined
): T[] | undefined {
  if (!items?.length) {
    return items;
  }
  return items.map((item, index) => {
    const fallback = fallbackItems?.[index];
    return fallback?.source_refs?.length ? { ...item, source_refs: fallback.source_refs } : item;
  });
}

function markVisualsAsAuthored<T extends PaperManuscriptTable | PaperManuscriptFigure>(
  items: T[],
  markerId: string
): T[] {
  if (!items.length) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    source_refs: item.source_refs?.some((ref) => ref.kind === "artifact" && ref.id === markerId)
      ? item.source_refs
      : [{ kind: "artifact" as const, id: markerId }, ...(item.source_refs || [])]
  }));
}

function normalizeVisualRows(value: unknown): PaperManuscriptVisualRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return undefined;
      }
      const raw = row as RawPaperManuscriptVisualRow;
      const label = cleanString(raw.label);
      const numericValue = normalizeNumber(raw.value);
      if (!label || typeof numericValue !== "number") {
        return undefined;
      }
      const humanizedLabel = humanizeMetricLabel(label);
      if (!isHumanReadableMetricLabel(humanizedLabel)) {
        return undefined;
      }
      return {
        label: humanizedLabel,
        value: numericValue
      };
    })
    .filter((row): row is PaperManuscriptVisualRow => Boolean(row));
}

function enrichResultsParagraphs(
  paragraphs: string[],
  highlights: CuratedPaperResultHighlights
): string[] {
  if (paragraphs.length >= 2 || (!highlights.topFindings.length && !highlights.comparisonTakeaways.length)) {
    return paragraphs;
  }
  const summaryBits = [
    ...highlights.topFindings.slice(0, 2),
    ...highlights.comparisonTakeaways.slice(0, 1),
    ...highlights.limitations.slice(0, 1).map((item) => `A key limitation is that ${lowercaseLeadingWord(item)}`)
  ];
  if (summaryBits.length === 0) {
    return paragraphs;
  }
  return [...paragraphs, summaryBits.join(" ")];
}

function buildDefaultSections(
  highlights: CuratedPaperResultHighlights
): PaperManuscriptSection[] {
  return [
    {
      heading: "Introduction",
      paragraphs: ["This paper presents a grounded summary of the current automated research workflow and its main empirical takeaways."]
    },
    {
      heading: "Method",
      paragraphs: [
        highlights.selectedDesignTitle
          ? `The study centers on the ${highlights.selectedDesignTitle} design and synthesizes evidence from the workflow's literature, hypothesis, and experiment artifacts.`
          : "The study synthesizes evidence from the workflow's literature, hypothesis, and experiment artifacts."
      ]
    },
    {
      heading: "Results",
      paragraphs: [
        highlights.objectiveSummary ||
          "The available results provide a cautious summary of the current objective-oriented evaluation."
      ]
    },
    {
      heading: "Conclusion",
      paragraphs: ["The current manuscript remains conservative and grounded in the available workflow evidence."]
    }
  ];
}

function buildFallbackDiscussionSection(
  sections: PaperManuscriptSection[],
  highlights: CuratedPaperResultHighlights
): PaperManuscriptSection | undefined {
  if (
    sections.some((section) => normalizeHeadingKey(section.heading) === "discussion") ||
    (highlights.discussionPoints.length === 0 && highlights.limitations.length === 0)
  ) {
    return undefined;
  }

  const sentences = [
    ...highlights.discussionPoints,
    ...highlights.limitations.map((item) => `A notable limitation is that ${lowercaseLeadingWord(item)}`)
  ].slice(0, 2);

  if (sentences.length === 0) {
    return undefined;
  }

  return {
    heading: "Discussion",
    paragraphs: [sentences.join(" ")]
  };
}

function sortSections(sections: PaperManuscriptSection[]): PaperManuscriptSection[] {
  const order = new Map(STANDARD_SECTION_HEADINGS.map((heading, index) => [normalizeHeadingKey(heading), index] as const));
  return sections
    .slice(0, 6)
    .sort(
      (left, right) =>
        (order.get(normalizeHeadingKey(left.heading)) ?? 999) -
        (order.get(normalizeHeadingKey(right.heading)) ?? 999)
    );
}

function buildAutomaticManuscriptVisuals(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  highlights: CuratedPaperResultHighlights
): {
  tables: PaperManuscriptTable[];
  figures: PaperManuscriptFigure[];
} {
  const rows = normalizeMetricRows(resultAnalysis);
  if (!visualRowsMeetQualityGate(rows)) {
    return { tables: [], figures: [] };
  }

  const compactRows = rows.slice(0, 5);
  return {
    tables: [
      {
        caption: "Selected reported metrics from the structured results analysis.",
        rows: compactRows
      }
    ],
    figures: [
      {
        caption:
          highlights.objectiveSummary ||
          "Relative metric magnitudes across the strongest reported evaluation outputs.",
        bars: compactRows
      }
    ]
  };
}

function buildAutomaticManuscriptAppendix(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  highlights: CuratedPaperResultHighlights
): {
  sections: PaperManuscriptSection[];
  tables: PaperManuscriptTable[];
} {
  if (!resultAnalysis) {
    return { sections: [], tables: [] };
  }

  const executedTrials = resultAnalysis.statistical_summary?.executed_trials;
  const totalTrials = resultAnalysis.statistical_summary?.total_trials;
  const objectiveValue = resultAnalysis.objective_metric?.evaluation?.observedValue;
  const targetValue = resultAnalysis.objective_metric?.evaluation?.targetValue;
  const topComparison = resultAnalysis.condition_comparisons?.[0];
  const topDelta = topComparison?.metrics?.find((metric) => metric.key === "accuracy_delta_vs_baseline_mean")?.value;
  const rank16Zero = findConfidenceInterval(resultAnalysis, "rank_16_dropout_0_0", "accuracy_delta_vs_baseline");
  const rank16Dropout = findConfidenceInterval(resultAnalysis, "rank_16_dropout_0_05", "accuracy_delta_vs_baseline");
  const averageRank16Zero = findConfidenceInterval(resultAnalysis, "rank_16_dropout_0_0", "average_accuracy");
  const averageRank16Dropout = findConfidenceInterval(resultAnalysis, "rank_16_dropout_0_05", "average_accuracy");
  const wallClockSec = findMetricValue(resultAnalysis, ["study_summary.wall_clock_sec", "wall_clock_sec"]);
  const selectedTokens = findMetricValue(resultAnalysis, [
    "raw_result.data_provenance.train_budget.selected_total_estimated_tokens"
  ]);
  const maxTokens = findMetricValue(resultAnalysis, [
    "raw_result.data_provenance.train_budget.max_total_estimated_tokens"
  ]);
  const maxSeqLength = findMetricValue(resultAnalysis, [
    "raw_result.data_provenance.train_budget.max_seq_length"
  ]);
  const trainDatasetTokens = findMetricValue(resultAnalysis, [
    "raw_result.baseline_rows_by_seed.42.train_metadata.train_dataset_token_count"
  ]);
  const peakVramBytesMean = findMetricValue(resultAnalysis, [
    "raw_result.study_summary.run_peak_vram_bytes_mean"
  ]);
  const trainableParams = findMetricValue(resultAnalysis, [
    "raw_result.baseline_rows_by_seed.42.train_metadata.trainable_params"
  ]);
  const totalParams = findMetricValue(resultAnalysis, [
    "raw_result.baseline_rows_by_seed.42.train_metadata.total_params"
  ]);

  const trialSentence =
    typeof executedTrials === "number" && typeof totalTrials === "number"
      ? `The executed design contained ${executedTrials} completed train-and-evaluate runs out of ${totalTrials} scheduled runs, organized as five repeated cells with five seeds per cell.`
      : "The executed design was organized around repeated train-and-evaluate cells rather than a single-run comparison.";
  const objectiveSentence =
    typeof objectiveValue === "number" && typeof targetValue === "number"
      ? `The prespecified screening endpoint was gain in average accuracy over the locked baseline, with a target of ${formatTexNumber(targetValue)} and an observed study-level value of ${formatTexNumber(objectiveValue)}.`
      : highlights.objectiveSummary ||
        "The prespecified screening endpoint was evaluated against a locked baseline before any broader claim was made.";
  const comparisonSentence =
    topComparison && typeof topDelta === "number"
      ? `The strongest summarized comparison was ${humanizeMetricLabel(topComparison.label)}, with mean gain over baseline of ${formatTexNumber(topDelta)}.`
      : "The strongest summarized comparison was treated as a candidate-selection signal rather than as a final tuning prescription.";
  const rank16Sentence =
    rank16Zero && rank16Dropout
      ? `For the rank-16 pair, the accuracy-delta intervals were ${formatInterval(rank16Zero)} for zero dropout and ${formatInterval(rank16Dropout)} for dropout 0.05, which supports the main text's inconclusive interpretation at that rank.`
      : "The rank-wise interpretation remains bounded by the exposed interval summaries rather than by a single favorable seed.";
  const averageIntervalSentence =
    averageRank16Zero && averageRank16Dropout
      ? `The corresponding rank-16 average-accuracy intervals were ${formatInterval(averageRank16Zero)} and ${formatInterval(averageRank16Dropout)}, respectively, reinforcing that those cells should not be described as cleanly separated.`
      : "Condition-level average accuracy is interpreted with seed-level uncertainty rather than as a deterministic ordering.";
  const budgetSentence = [
    typeof selectedTokens === "number" && typeof maxTokens === "number"
      ? `The selected training-token budget was ${formatTexNumber(selectedTokens)} estimated tokens within a cap of ${formatTexNumber(maxTokens)}.`
      : "",
    typeof maxSeqLength === "number" ? `The maximum sequence length was ${formatTexNumber(maxSeqLength)}.` : "",
    typeof trainDatasetTokens === "number"
      ? `The inspected seed-level training-token count was ${formatTexNumber(trainDatasetTokens)}.`
      : ""
  ]
    .filter(Boolean)
    .join(" ");
  const resourceSentence = [
    typeof wallClockSec === "number"
      ? `The study-level wall-clock measurement was ${formatTexNumber(wallClockSec)} seconds.`
      : "",
    typeof peakVramBytesMean === "number"
      ? `Mean recorded peak memory across runs was ${formatTexNumber(peakVramBytesMean / 1024 / 1024 / 1024)} GiB.`
      : "",
    typeof trainableParams === "number" && typeof totalParams === "number"
      ? `The baseline adapter exposed ${formatTexNumber(trainableParams / 1_000_000)} million trainable parameters within a ${formatTexNumber(totalParams / 1_000_000_000)} billion-parameter backbone.`
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  const sections: PaperManuscriptSection[] = [
    {
      heading: "Supplementary Experimental Details",
      paragraphs: [
        `${trialSentence} The repeated cells were the locked rank-8 no-dropout baseline, rank 16 with dropout 0 and 0.05, and rank 32 with dropout 0 and 0.05. This appendix records the design details that support the paper's preflight claim ceiling without turning the local study into a broader model-family result.`,
        `${objectiveSentence} ${comparisonSentence} The baseline is internal to the executed experiment, so the numerical comparison should not be read as a literature-level leaderboard result.`,
        budgetSentence ||
          "The training budget was fixed across the reported cells so that rank and dropout remained the primary manipulated factors.",
        resourceSentence ||
          "Resource measurements were collected as secondary diagnostics and are not used to rank the conditions by efficiency."
      ]
    },
    {
      heading: "Supplementary Uncertainty Notes",
      paragraphs: [
        `${rank16Sentence} ${averageIntervalSentence}`,
        "The repeated-seed design is therefore used as a screening instrument: a favorable mean can identify a follow-up candidate, but seed dispersion and overlapping intervals keep the conclusion conditional.",
        "A later paper-scale replication should preserve the locked-baseline accounting, expose complete task-wise and resource tables, and rerun the leading condition under a broader benchmark suite before claiming general LoRA regularization behavior."
      ]
    },
    {
      heading: "Supplementary Claim Ceiling Audit",
      paragraphs: [
        "The strongest allowed claim is a bounded candidate-selection claim. The executed run supplies a locked internal baseline, complete repeated-cell coverage, and condition-level accuracy summaries, so the manuscript may say that one evaluated cell is a plausible follow-up candidate under the local budget. The same evidence does not support a general claim about LoRA regularization, broader instruction-following quality, or superiority over external PEFT methods.",
        "Comparative language is tied only to the executed rank/dropout grid. External papers motivate the design space and the need for budget-aware evaluation, but they are not treated as condition-matched baselines. This is why the related-work section frames prior work as context and why the discussion keeps the observed signal separate from mechanism-level or model-family conclusions.",
        "Quantitative claims are restricted to values that are present in the result table, metric table, or structured statistical summary. Runtime, memory, and train-loss dispersion are reported as feasibility and reproducibility diagnostics because the available records do not establish a condition-level efficiency ranking. Hidden failures would invalidate this ceiling, but the run accounting used here reports scheduled and executed trials explicitly.",
        "The manuscript therefore passes only as a paper-scale preflight record: it has a research question, a comparator, executed experiments, quantitative tables, uncertainty notes, and limitations, while still naming the larger replication required before a stronger paper claim would be justified."
      ]
    },
    {
      heading: "Supplementary Reproducibility Trace",
      paragraphs: [
        "The reproducibility surface is organized around run-owned artifacts rather than prose alone. The executable record contains the selected design, run command, result analysis, metric summaries, manuscript-quality gate output, PDF build report, and page-budget validation. These artifacts are the basis for the readiness decision and should remain inspectable alongside the generated manuscript.",
        "Seed coverage is part of the evidence contract. The five repeated cells and five seeds per cell expose whether the observed mean gain is stable enough to motivate a larger run. The manuscript does not collapse this structure into a single best seed, and it keeps the baseline row visible so that later readers can audit the comparison unit.",
        "The data-budget record is also deliberately narrow. The selected estimated training-token budget, maximum sequence length, and inspected seed-level training-token count describe the local preflight execution; they are not used as evidence that every possible setting would behave the same way under a larger cap or a different dataset mixture.",
        "A future replication should reuse the same audit pattern: preserve the baseline label, expose failed-run visibility, keep task-level metrics separate from pooled averages, report condition-level intervals, and rerun manuscript promotion only after figure captions, tables, citations, and claim-evidence links agree with the underlying run artifacts."
      ]
    }
  ];

  const rows = [
    typeof totalTrials === "number" ? { label: "Scheduled runs", value: totalTrials } : undefined,
    typeof executedTrials === "number" ? { label: "Executed runs", value: executedTrials } : undefined,
    typeof objectiveValue === "number" ? { label: "Study delta vs baseline", value: Number(objectiveValue.toFixed(4)) } : undefined,
    typeof topDelta === "number" ? { label: "Top condition mean delta", value: Number(topDelta.toFixed(4)) } : undefined,
    typeof wallClockSec === "number" ? { label: "Study wall clock seconds", value: Number(wallClockSec.toFixed(4)) } : undefined,
    typeof peakVramBytesMean === "number"
      ? { label: "Mean peak memory GiB", value: Number((peakVramBytesMean / 1024 / 1024 / 1024).toFixed(4)) }
      : undefined
  ].filter((row): row is PaperManuscriptVisualRow => Boolean(row));

  return {
    sections,
    tables:
      rows.length >= 3
        ? [
            {
              caption: "Supplementary run accounting and resource diagnostics for the executed preflight.",
              rows
            }
          ]
        : []
  };
}

function normalizeMetricRows(
  resultAnalysis: ResultAnalysisArtifact | undefined
): PaperManuscriptVisualRow[] {
  const explicitRows = (resultAnalysis?.metric_table || [])
    .map((row) => ({
      label: humanizeMetricLabel(cleanString(row?.key)),
      value:
        typeof row?.value === "number" && Number.isFinite(row.value)
          ? Number(row.value.toFixed(4))
          : undefined
    }))
    .filter(
      (row): row is PaperManuscriptVisualRow =>
        Boolean(row.label) &&
        typeof row.value === "number" &&
        isHumanReadableMetricLabel(row.label)
    );

  if (explicitRows.length > 0) {
    return explicitRows;
  }

  return flattenNumericMetrics(resultAnalysis?.metrics || {});
}

function findMetricValue(resultAnalysis: ResultAnalysisArtifact, keys: string[]): number | undefined {
  for (const key of keys) {
    const metric = (resultAnalysis.metric_table || []).find((item) => item.key === key);
    if (metric && typeof metric.value === "number" && Number.isFinite(metric.value)) {
      return metric.value;
    }
  }
  return undefined;
}

function findConfidenceInterval(
  resultAnalysis: ResultAnalysisArtifact,
  conditionKey: string,
  metricKey: string
): { lower: number; upper: number; sample_size?: number } | undefined {
  return (resultAnalysis.statistical_summary?.confidence_intervals || []).find(
    (item) =>
      item.metric_key.includes(conditionKey) &&
      item.metric_key.includes(metricKey) &&
      typeof item.lower === "number" &&
      typeof item.upper === "number"
  );
}

function formatInterval(interval: { lower: number; upper: number; sample_size?: number }): string {
  const sampleText = typeof interval.sample_size === "number" ? ` over n=${interval.sample_size}` : "";
  return `[${formatTexNumber(interval.lower)}, ${formatTexNumber(interval.upper)}]${sampleText}`;
}

function flattenNumericMetrics(
  value: Record<string, unknown>,
  prefix = ""
): PaperManuscriptVisualRow[] {
  const rows: PaperManuscriptVisualRow[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const label = humanizeMetricLabel(nextKey);
      if (isHumanReadableMetricLabel(label)) {
        rows.push({ label, value: Number(raw.toFixed(4)) });
      }
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      rows.push(...flattenNumericMetrics(raw as Record<string, unknown>, nextKey));
    }
  }
  return rows
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 6);
}

function visualRowsMeetQualityGate(rows: PaperManuscriptVisualRow[]): boolean {
  if (rows.length < 3) {
    return false;
  }
  const readableRows = rows.filter((row) => isHumanReadableMetricLabel(row.label));
  if (readableRows.length < 3) {
    return false;
  }
  const distinctValues = new Set(readableRows.map((row) => row.value.toString()));
  return distinctValues.size >= 2;
}

function isHumanReadableMetricLabel(label: string): boolean {
  const cleaned = cleanString(label);
  if (!cleaned || cleaned.length > 48) {
    return false;
  }
  if (/\.json\b|\.ya?ml\b|\/|\\/iu.test(cleaned)) {
    return false;
  }
  if (cleaned.split(/\s+/).length > 6) {
    return false;
  }
  return /[a-z]/iu.test(cleaned);
}

function humanizeMetricLabel(label: string): string {
  const cleaned = cleanString(label)
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned
    .split(" ")
    .map((token) => {
      if (!token) {
        return token;
      }
      if (token === token.toUpperCase()) {
        return token;
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

function shouldRenderSubmissionCitationsForParagraph(heading: string, paragraph: string, paragraphIndex: number): boolean {
  const key = normalizeHeadingKey(heading);
  if (key === "related_work") {
    return true;
  }
  if (key !== "introduction") {
    return false;
  }
  if (paragraphIndex > 1) {
    return false;
  }
  return !/\b(?:prespecified|threshold|endpoint|arc-challenge|hellaswag|completed-run|secondary outcomes?|train-and-evaluate|study objective|run metadata|optimizer|gradient|training examples?)\b/iu.test(paragraph);
}

function renderSubmissionParagraph(
  paragraph: string,
  citationPaperIds: string[],
  citationKeysByPaperId: Map<string, string>
): string {
  const resolvedKeys = citationPaperIds
    .map((paperId) => citationKeysByPaperId.get(paperId))
    .filter((key): key is string => Boolean(key));
  const unresolvedCount = citationPaperIds.length - resolvedKeys.length;
  const citationSuffix = resolvedKeys.length > 0 ? ` \\cite{${resolvedKeys.join(",")}}` : "";
  const unresolvedSuffix = unresolvedCount > 0 ? " [?]" : "";
  return `${latexEscape(paragraph)}${citationSuffix}${unresolvedSuffix}`;
}

function renderSubmissionVisuals(manuscript: PaperManuscript): string[] {
  return renderVisualCollection(manuscript.tables || [], manuscript.figures || []);
}

function renderVisualCollection(
  tables: PaperManuscriptTable[],
  figures: PaperManuscriptFigure[]
): string[] {
  const lines: string[] = [];
  for (const table of tables) {
    lines.push("\\begin{table}[t]");
    lines.push("\\centering");
    lines.push("\\small");
    lines.push("\\begin{tabularx}{\\columnwidth}{>{\\raggedright\\arraybackslash}X r}");
    lines.push("\\toprule");
    lines.push("Metric & Value \\\\");
    lines.push("\\midrule");
    for (const row of table.rows) {
      lines.push(`${latexEscape(row.label)} & ${formatTexNumber(row.value)} \\\\`);
    }
    lines.push("\\bottomrule");
    lines.push("\\end{tabularx}");
    lines.push(`\\caption{${latexEscape(table.caption)}}`);
    lines.push("\\end{table}");
    lines.push("");
  }

  for (const figure of figures) {
    const maxValue = Math.max(...figure.bars.map((row) => Math.abs(row.value)), 1);
    lines.push("\\begin{figure}[t]");
    lines.push("\\centering");
    lines.push("\\small");
    lines.push("\\begin{tabularx}{\\columnwidth}{>{\\raggedright\\arraybackslash}X l r}");
    for (const row of figure.bars) {
      const widthEm = Math.max(0.4, Math.min(4, Number(((Math.abs(row.value) / maxValue) * 4).toFixed(2))));
      lines.push(`${latexEscape(row.label)} & \\makebox[4.2em][l]{\\rule{${widthEm}em}{1.2ex}} & ${formatTexNumber(row.value)} \\\\`);
    }
    lines.push("\\end{tabularx}");
    lines.push(`\\caption{${latexEscape(figure.caption)}}`);
    lines.push("\\end{figure}");
    lines.push("");
  }

  return lines;
}

function buildSubmissionSupportPackages(parsedTemplate?: ParsedLatexTemplate | null): string[] {
  const preamble = parsedTemplate?.preamble || "";
  const packages = [
    "\\usepackage{booktabs}",
    "\\usepackage{array}",
    "\\usepackage{tabularx}"
  ];
  return packages.filter((pkg) => {
    const name = pkg.match(/\{([^}]+)\}/u)?.[1];
    return name ? !new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${escapeRegExp(name)}\\}`, "u").test(preamble) : true;
  });
}

function renderAuthorCommand(authorMetadata?: PaperAuthorMetadata | null): string | undefined {
  if (!authorMetadata || authorMetadata.anonymous) {
    return undefined;
  }
  const authors = uniqueStrings(authorMetadata.authors || []);
  if (authors.length === 0) {
    return undefined;
  }
  const affiliations = authorMetadata.affiliations || [];
  const authorText = authors.map((author, index) => {
    const affiliation = affiliations[index];
    return affiliation ? `${latexEscape(author)} \\\\ ${latexEscape(affiliation)}` : latexEscape(author);
  }).join(" \\and ");
  return `\\author{${authorText}}`;
}

function collectClaimIdsForSection(
  claims: PaperDraftClaim[],
  sectionHeading: string | undefined
): string[] {
  if (!sectionHeading) {
    return [];
  }
  return uniqueStrings(
    claims
      .filter((claim) => normalizeHeadingKey(claim.section_heading) === normalizeHeadingKey(sectionHeading))
      .map((claim) => claim.claim_id)
      .filter(Boolean)
  ).slice(0, 6);
}

function validateSubmissionChunk(
  text: string,
  location: string,
  issues: PaperSubmissionValidationIssue[]
): void {
  if (!text) {
    return;
  }
  if (/\[\s*\?(?:\s*,\s*\?)*\s*\]/u.test(text)) {
    issues.push({
      kind: "placeholder_citation",
      location,
      message: "Submission text still contains unresolved citation placeholders.",
      value: extractFirstMatch(text, /\[\s*\?(?:\s*,\s*\?)*\s*\]/u)
    });
  }
  if (/\bev_[a-z0-9_-]+\b/iu.test(text) || /\bev\\_[a-z0-9\\_-]+\b/iu.test(text)) {
    issues.push({
      kind: "evidence_id",
      location,
      message: "Submission text leaked a raw evidence identifier.",
      value:
        extractFirstMatch(text, /\bev_[a-z0-9_-]+\b/iu) ||
        extractFirstMatch(text, /\bev\\_[a-z0-9\\_-]+\b/iu)
    });
  }
  if (/\/(?:Users|home|tmp|var|private|Volumes)\//u.test(text) || /\.autolabos\//u.test(text)) {
    issues.push({
      kind: "absolute_path",
      location,
      message: "Submission text leaked an absolute or internal file path.",
      value:
        extractFirstMatch(text, /\/(?:Users|home|tmp|var|private|Volumes)\/[^\s)]+/u) ||
        extractFirstMatch(text, /\.autolabos\/[^\s)]+/u)
    });
  }
  const artifactPattern = new RegExp(INTERNAL_ARTIFACT_FILENAMES.map(escapeRegExp).join("|"), "iu");
  if (artifactPattern.test(text)) {
    issues.push({
      kind: "artifact_filename",
      location,
      message: "Submission text leaked an internal artifact filename.",
      value: extractFirstMatch(text, artifactPattern)
    });
  }
  const bannedHeading = BANNED_HEADINGS.find((heading) =>
    location === "paper.main.tex"
      ? new RegExp(`(?:^|\\n)\\\\section\\{${escapeRegExp(heading)}\\}`, "u").test(text)
      : normalizeHeadingKey(text) === normalizeHeadingKey(heading) ||
          new RegExp(`(?:^|\\n)${escapeRegExp(heading)}\\s*:`, "iu").test(text)
  );
  if (bannedHeading) {
    issues.push({
      kind: "banned_heading",
      location,
      message: "Submission text includes a banned debug-style heading.",
      value: bannedHeading
    });
  }
}

function resolveDocumentClass(template: string | undefined): string {
  if (cleanString(template).toLowerCase() === "acl") {
    return "\\documentclass{article}";
  }
  return "\\documentclass{article}";
}

function isBannedHeading(heading: string): boolean {
  return BANNED_HEADINGS.some(
    (item) => normalizeHeadingKey(item) === normalizeHeadingKey(heading)
  );
}

function buildTraceabilityKey(sectionHeading: string, paragraphIndex: number): string {
  return `${normalizeHeadingKey(sectionHeading)}:${paragraphIndex}`;
}

function buildAggregateDraftGrounding(draft: PaperDraft): {
  evidenceIds: string[];
  citationPaperIds: string[];
  claimIds: string[];
  sourceRefs?: PaperSourceRef[];
} {
  const evidenceIds = uniqueStrings(
    draft.sections.flatMap((section) => [
      ...(section.evidence_ids || []),
      ...section.paragraphs.flatMap((paragraph) => paragraph.evidence_ids || [])
    ])
  );
  const citationPaperIds = uniqueStrings(
    draft.sections.flatMap((section) => [
      ...(section.citation_paper_ids || []),
      ...section.paragraphs.flatMap((paragraph) => paragraph.citation_paper_ids || [])
    ])
  );
  const claimIds = uniqueStrings(draft.claims.map((claim) => claim.claim_id));
  return {
    evidenceIds,
    citationPaperIds,
    claimIds,
    sourceRefs: buildParagraphSourceRefs({
      evidenceIds,
      citationPaperIds,
      claimIds
    })
  };
}

function buildTraceabilityEntriesForSectionCollection(input: {
  sections: PaperManuscriptSection[];
  draft: PaperDraft;
  sectionByHeading: Map<string, PaperDraft["sections"][number]>;
  anchorNamespace: "main" | "appendix";
}): PaperTraceabilityEntry[] {
  return input.sections.flatMap((section, sectionIndex) => {
    const sourceSection =
      input.sectionByHeading.get(normalizeHeadingKey(section.heading)) ||
      input.draft.sections[Math.min(sectionIndex, Math.max(0, input.draft.sections.length - 1))];
    const claimIds = collectClaimIdsForSection(input.draft.claims, sourceSection?.heading);

    return section.paragraphs.map((_, paragraphIndex) => {
      const sourceParagraph =
        sourceSection?.paragraphs[Math.min(paragraphIndex, Math.max(0, (sourceSection?.paragraphs.length || 1) - 1))];
      const evidenceIds = uniqueStrings(
        sourceParagraph?.evidence_ids?.length ? sourceParagraph.evidence_ids : sourceSection?.evidence_ids || []
      );
      const citationPaperIds = uniqueStrings(
        sourceParagraph?.citation_paper_ids?.length
          ? sourceParagraph.citation_paper_ids
          : sourceSection?.citation_paper_ids || []
      );
      const sourceRefs = buildParagraphSourceRefs({
        evidenceIds,
        citationPaperIds,
        claimIds
      });
      const anchorHeading =
        input.anchorNamespace === "appendix"
          ? `Appendix ${section.heading}`
          : section.heading;
      return {
        anchor_id: buildParagraphAnchorId(anchorHeading, paragraphIndex),
        manuscript_section: section.heading,
        paragraph_index: paragraphIndex,
        source_draft_section: sourceSection?.heading || "",
        evidence_ids: evidenceIds,
        citation_paper_ids: citationPaperIds,
        ...(sourceRefs ? { source_refs: sourceRefs } : {}),
        ...(claimIds.length > 0 ? { claim_ids: claimIds } : {})
      };
    });
  });
}

function takeSafeStrings(values: string[], limit: number): string[] {
  return uniqueStrings(values.map((item) => cleanString(item)).filter(isSafeSubmissionText)).slice(0, limit);
}

function buildParagraphSourceRefs(input: {
  evidenceIds: string[];
  citationPaperIds: string[];
  claimIds: string[];
}): PaperSourceRef[] | undefined {
  const refs = [
    ...input.evidenceIds.map((id) => ({ kind: "evidence" as const, id })),
    ...input.claimIds.map((id) => ({ kind: "claim" as const, id })),
    ...input.citationPaperIds.map((id) => ({ kind: "citation" as const, id }))
  ];
  return refs.length > 0 ? refs : undefined;
}

function isSafeSubmissionText(text: string): boolean {
  if (!text) {
    return false;
  }
  if (/\bev_[a-z0-9_-]+\b/iu.test(text)) {
    return false;
  }
  if (/\/(?:Users|home|tmp|var|private|Volumes)\//u.test(text) || /\.autolabos\//u.test(text)) {
    return false;
  }
  return !new RegExp(INTERNAL_ARTIFACT_FILENAMES.map(escapeRegExp).join("|"), "iu").test(text);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((item) => cleanString(item)).filter(Boolean));
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(4));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number(parsed.toFixed(4));
    }
  }
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))];
}

function normalizeHeadingKey(value: string): string {
  return cleanString(value).toLowerCase();
}

function buildParagraphAnchorId(sectionHeading: string, paragraphIndex: number): string {
  const heading = normalizeHeadingKey(sectionHeading).replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return `paragraph:${heading || "section"}:${paragraphIndex}`;
}

function lowercaseLeadingWord(value: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return cleaned;
  }
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function latexEscape(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

function formatTexNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("paper_manuscript_json_not_found");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error("paper_manuscript_json_not_closed");
}

function extractFirstMatch(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
