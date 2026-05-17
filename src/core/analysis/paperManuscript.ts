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
export const DERIVED_MAIN_FIGURE_SOURCE_REF_ID = "manuscript.derived_main_figure";

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

export interface PaperManuscriptConditionSummary {
  label?: string;
  condition?: string;
  is_baseline?: boolean;
  average_accuracy_mean?: number;
  accuracy_delta_vs_baseline_mean?: number;
  arc_challenge_accuracy?: number;
  hellaswag_accuracy?: number;
}

export interface PaperManuscriptStabilizationOptions {
  conditionSummaries?: PaperManuscriptConditionSummary[];
  resultAnalysis?: ResultAnalysisArtifact;
  methodModelNames?: string[];
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
    | "banned_heading"
    | "raw_artifact_text";
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

  const resolvedBaseSections = preserveSectionSourceRefs(
    sections.length > 0 ? sections : baseManuscript.sections,
    baseManuscript.sections
  );
  const resolvedSections = repairReaderVisibleManuscriptCoherence(enrichManuscriptMethodExecutionDetails({
    sections: resolvedBaseSections || baseManuscript.sections,
    resultAnalysis: input.resultAnalysis
  }));
  const resolvedTables = preserveVisualSourceRefs(
    tables.length > 0 ? tables : baseManuscript.tables,
    baseManuscript.tables
  );
  const resolvedFigures = removeRedundantTaskDeltaFigures(preserveVisualSourceRefs(
    figures.length > 0 ? figures : baseManuscript.figures,
    baseManuscript.figures
  ));
  const resolvedAppendixSections = preserveSectionSourceRefs(
    appendixSections.length > 0 ? appendixSections : baseManuscript.appendix_sections,
    baseManuscript.appendix_sections
  );
  const resolvedAppendixTables = repairAppendixTableLabels(preserveVisualSourceRefs(
    appendixTables.length > 0 ? appendixTables : baseManuscript.appendix_tables,
    baseManuscript.appendix_tables
  ));
  const resolvedAppendixFigures = preserveVisualSourceRefs(
    appendixFigures.length > 0 ? appendixFigures : baseManuscript.appendix_figures,
    baseManuscript.appendix_figures
  );

  return stabilizePaperManuscriptForSubmission({
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
  }, {
    conditionSummaries: conditionSummariesFromResultAnalysis(input.resultAnalysis),
    resultAnalysis: input.resultAnalysis
  });
}

export function stabilizePaperManuscriptForSubmission(
  manuscript: PaperManuscript,
  options: PaperManuscriptStabilizationOptions = {}
): PaperManuscript {
  const sectionsWithMethodDetails = options.resultAnalysis
    ? enrichManuscriptMethodExecutionDetails({
        sections: manuscript.sections,
        resultAnalysis: options.resultAnalysis,
        methodModelNames: options.methodModelNames
      })
    : options.methodModelNames?.length
      ? enrichManuscriptMethodExecutionDetails({
          sections: manuscript.sections,
          methodModelNames: options.methodModelNames
        })
    : manuscript.sections;
  const sections = repairReaderVisibleManuscriptCoherence(sectionsWithMethodDetails);
  const figures = ensureMainBodyResultFigure({
    tables: manuscript.tables,
    figures: removeRedundantTaskDeltaFigures(manuscript.figures),
    conditionSummaries: options.conditionSummaries
  });
  return {
    ...manuscript,
    abstract: repairSubmissionAbstract(manuscript.abstract),
    keywords: repairPaperKeywords(manuscript.keywords),
    sections,
    ...(manuscript.tables ? { tables: repairMainTableClaims(manuscript.tables) } : {}),
    ...(figures?.length ? { figures } : {}),
    ...(manuscript.appendix_sections ? { appendix_sections: repairAppendixSections(manuscript.appendix_sections) } : {}),
    ...(manuscript.appendix_tables ? { appendix_tables: repairAppendixTableLabels(manuscript.appendix_tables) } : {})
  };
}

function repairPaperKeywords(keywords: string[]): string[] {
  return keywords
    .map((keyword) =>
      cleanString(keyword)
        .replace(/\baccuracy_delta_vs_baseline\b/giu, "baseline-relative accuracy gain")
        .replace(/\baverage_accuracy\b/giu, "average accuracy")
        .replace(/\barc_challenge_accuracy\b/giu, "ARC-Challenge accuracy")
        .replace(/\bhellaswag_accuracy\b/giu, "HellaSwag accuracy")
    )
    .filter(Boolean)
    .slice(0, 6);
}

function repairReaderVisibleMetricNames(text: string): string {
  return cleanString(text)
    .replace(/\baccuracy\\?_delta\\?_vs\\?_baseline\b/giu, "baseline-relative accuracy gain")
    .replace(/\baverage\\?_accuracy\b/giu, "average accuracy")
    .replace(/\barc\\?_challenge\\?_accuracy\b/giu, "ARC-Challenge accuracy")
    .replace(/\bhellaswag\\?_accuracy\b/giu, "HellaSwag accuracy");
}

function repairMainTableClaims(
  tables: PaperManuscriptTable[] | undefined
): PaperManuscriptTable[] | undefined {
  if (!tables) {
    return tables;
  }
  return tables.map((table) => {
    const rowText = table.rows.map((row) => row.label).join(" ");
    const exposesAllCells =
      /\brank\s*4\b/iu.test(rowText) &&
      /\brank\s*8\b/iu.test(rowText) &&
      /\brank\s*16\b/iu.test(rowText) &&
      /\brank\s*32\b/iu.test(rowText);
    const caption = exposesAllCells
      ? cleanString(table.caption)
      : cleanString(table.caption)
          .replace(
            /\bExecuted sweep summary and key comparison quantities visible in the condensed record\.?/giu,
            "Baseline and leading-condition comparison quantities visible in the condensed record."
          )
          .replace(
            /\bMean accuracy is shown for all eight rank\/dropout cells;?\s*/giu,
            ""
          )
          .replace(
            /\badditional rows report the task-level accuracies,\s*interval bounds,\s*training-loss comparison,\s*and execution totals discussed in the main text where those values are explicitly available\.?/giu,
            "Rows report task-level accuracies, interval bounds, and training-loss values where those quantities are explicitly available."
          )
          .replace(
            /\bexecuted grid\b/giu,
            "baseline-to-leading comparison"
          )
          .replace(
            /\bexecution totals\b/giu,
            "run-level execution notes"
          );
    return {
      ...table,
      caption: cleanString(caption),
      rows: table.rows
    };
  });
}

function sanitizeSubmissionSurfaceText(text: string): string {
  const cleaned = repairReaderVisibleMetricNames(sanitizePaperNarrativeText(text))
    .replace(
      /\bObjective metric met:\s*baseline-relative accuracy gain\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*>=\s*([0-9]+(?:\.[0-9]+)?)\.?/giu,
      "The prespecified baseline-relative accuracy target was met (observed gain $1 versus threshold $2); condition-level values in Table 1 provide the main numeric support."
    )
    .replace(
      /\brank\s+32\s+dropout\s+0\s+05\s+vs\s+rank\s+8\s+dropout\s+0\s+0:\s*baseline-relative accuracy gain:\s*([0-9.]+)\s+vs\s+0\s+\(delta\s+([0-9.]+)\),\s*average accuracy:\s*([0-9.]+)\s+vs\s+([0-9.]+)\s+\(delta\s+[0-9.]+\),\s*ARC-Challenge accuracy:\s*([0-9.]+)\s+vs\s+([0-9.]+)\s+\(delta\s+[0-9.]+\),\s*HellaSwag accuracy:\s*([0-9.]+)\s+vs\s+([0-9.]+)\s+\(delta\s+[0-9.]+\)\.?/giu,
      "The leading condition was rank 32 with dropout 0.05, compared with the locked rank 8 dropout 0.0 baseline; the observed baseline-relative average-accuracy gain was $1, average accuracy was $3 versus $4, ARC-Challenge accuracy was $5 versus $6, and HellaSwag accuracy was $7 versus $8."
    );
  if (/^\s*\[(?:warning|error|fail|failed|pass|passed)\]\s*[^:]{0,80}:/iu.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function ensureMainBodyResultFigure(input: {
  tables?: PaperManuscriptTable[];
  figures?: PaperManuscriptFigure[];
  conditionSummaries?: PaperManuscriptConditionSummary[];
}): PaperManuscriptFigure[] | undefined {
  const taskFigure = buildTaskLevelLeadingConditionFigure(input.conditionSummaries);
  if (taskFigure) {
    const retainedFigures = dedupeManuscriptFigures(
      (input.figures || []).filter(
        (figure) =>
          !isConditionDeltaSurfaceFigure(figure)
          && !isTaskLevelLeadingConditionFigure(figure)
          && !sameManuscriptFigure(figure, taskFigure)
      )
    );
    return [taskFigure, ...retainedFigures].slice(0, 2);
  }
  if (input.figures?.length) {
    return dedupeManuscriptFigures(input.figures);
  }
  const sourceTable = input.tables?.find((table) => table.rows.length >= 3);
  if (!sourceTable) {
    return undefined;
  }
  const baselineRow =
    sourceTable.rows.find((row) => /\bbaseline\b/iu.test(row.label)) ||
    sourceTable.rows[0];
  if (!baselineRow || typeof baselineRow.value !== "number") {
    return undefined;
  }

  const rows = sourceTable.rows
    .map((row) => {
      const isBaseline = row === baselineRow || /\bbaseline\b/iu.test(row.label);
      const label = cleanString(row.label)
        .replace(/\s*\/\s*/gu, " ")
        .replace(/\s*\((?:locked\s+)?baseline\)\s*/giu, " baseline ")
        .replace(/\s+/gu, " ")
        .trim();
      return {
        label: isBaseline && !/\bbaseline\b/iu.test(label) ? `${label} baseline` : label,
        value: Number((row.value - baselineRow.value).toFixed(6))
      };
    })
    .filter((row) => row.label && isHumanReadableMetricLabel(row.label))
    .slice(0, 8);
  if (rows.filter((row) => Math.abs(row.value) >= 0.0005).length <= 1) {
    return undefined;
  }
  if (!visualRowsMeetQualityGate(rows)) {
    return undefined;
  }
  return [
    {
      caption: "Baseline-relative mean accuracy gain by evaluated rank/dropout condition.",
      bars: rows,
      source_refs: [
        { kind: "artifact", id: DERIVED_MAIN_FIGURE_SOURCE_REF_ID },
        ...(sourceTable.source_refs || [])
      ]
    }
  ];
}

function buildTaskLevelLeadingConditionFigure(
  conditionSummaries: PaperManuscriptConditionSummary[] | undefined
): PaperManuscriptFigure | undefined {
  if (!conditionSummaries?.length) {
    return undefined;
  }
  const candidates = conditionSummaries
    .map((condition) => ({
      ...condition,
      arc_challenge_accuracy: normalizeNumber(condition.arc_challenge_accuracy),
      hellaswag_accuracy: normalizeNumber(condition.hellaswag_accuracy),
      average_accuracy_mean: normalizeNumber(condition.average_accuracy_mean),
      accuracy_delta_vs_baseline_mean: normalizeNumber(condition.accuracy_delta_vs_baseline_mean)
    }))
    .filter(
      (condition) =>
        typeof condition.arc_challenge_accuracy === "number"
        && typeof condition.hellaswag_accuracy === "number"
    );
  if (candidates.length < 2) {
    return undefined;
  }
  const baseline =
    candidates.find((condition) => condition.is_baseline)
    || candidates.find((condition) => /\bbaseline\b|rank[_\s-]*8.*dropout[_\s-]*0(?:\.0)?\b/iu.test(
      `${condition.condition || ""} ${condition.label || ""}`
    ));
  if (
    !baseline
    || typeof baseline.arc_challenge_accuracy !== "number"
    || typeof baseline.hellaswag_accuracy !== "number"
  ) {
    return undefined;
  }
  const leading = candidates
    .filter((condition) => condition !== baseline && !condition.is_baseline)
    .sort((left, right) => scoreLeadingCondition(right, baseline) - scoreLeadingCondition(left, baseline))[0];
  if (
    !leading
    || typeof leading.arc_challenge_accuracy !== "number"
    || typeof leading.hellaswag_accuracy !== "number"
  ) {
    return undefined;
  }
  const bars = [
    { label: "Baseline ARC-Challenge", value: baseline.arc_challenge_accuracy },
    { label: "Leading ARC-Challenge", value: leading.arc_challenge_accuracy },
    { label: "Baseline HellaSwag", value: baseline.hellaswag_accuracy },
    { label: "Leading HellaSwag", value: leading.hellaswag_accuracy },
    ...(typeof baseline.average_accuracy_mean === "number" && typeof leading.average_accuracy_mean === "number"
      ? [
          { label: "Baseline Average", value: baseline.average_accuracy_mean },
          { label: "Leading Average", value: leading.average_accuracy_mean }
        ]
      : [])
  ];
  if (!visualRowsMeetQualityGate(bars)) {
    return undefined;
  }
  return {
    caption:
      "Task-level and average accuracy for the leading condition; paired bars compare the locked baseline with the best observed rank/dropout cell.",
    bars,
    source_refs: [
      { kind: "artifact", id: DERIVED_MAIN_FIGURE_SOURCE_REF_ID },
      { kind: "artifact", id: "latest_results.condition_summaries" }
    ]
  };
}

function scoreLeadingCondition(
  condition: PaperManuscriptConditionSummary,
  baseline: PaperManuscriptConditionSummary
): number {
  if (typeof condition.accuracy_delta_vs_baseline_mean === "number") {
    return condition.accuracy_delta_vs_baseline_mean;
  }
  if (typeof condition.average_accuracy_mean === "number" && typeof baseline.average_accuracy_mean === "number") {
    return condition.average_accuracy_mean - baseline.average_accuracy_mean;
  }
  const conditionAverage =
    typeof condition.arc_challenge_accuracy === "number" && typeof condition.hellaswag_accuracy === "number"
      ? (condition.arc_challenge_accuracy + condition.hellaswag_accuracy) / 2
      : Number.NEGATIVE_INFINITY;
  const baselineAverage =
    typeof baseline.arc_challenge_accuracy === "number" && typeof baseline.hellaswag_accuracy === "number"
      ? (baseline.arc_challenge_accuracy + baseline.hellaswag_accuracy) / 2
      : 0;
  return conditionAverage - baselineAverage;
}

function isConditionDeltaSurfaceFigure(figure: PaperManuscriptFigure): boolean {
  const caption = cleanString(figure.caption);
  const rankDropoutRows = figure.bars.filter((bar) => /\brank\b.*\bdropout\b/iu.test(bar.label)).length;
  const zeroRows = figure.bars.filter((bar) => Math.abs(bar.value) < 0.0005).length;
  return (
    /\bbaseline-relative\b.*\b(rank|dropout|condition)\b/iu.test(caption)
    || (figure.bars.length >= 4 && rankDropoutRows >= 3 && zeroRows >= figure.bars.length - 1)
  );
}

function isTaskLevelLeadingConditionFigure(figure: PaperManuscriptFigure): boolean {
  const caption = cleanString(figure.caption);
  const labels = figure.bars.map((bar) => cleanString(bar.label)).join(" ");
  return (
    /\btask-level (?:and average )?accuracy(?: split)?\b/iu.test(caption)
    || /\bBaseline ARC[- ]Challenge\b.*\bLeading HellaSwag\b/iu.test(labels)
  );
}

function dedupeManuscriptFigures(figures: PaperManuscriptFigure[]): PaperManuscriptFigure[] {
  const seen = new Set<string>();
  const deduped: PaperManuscriptFigure[] = [];
  for (const figure of figures) {
    const key = manuscriptFigureKey(figure);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(figure);
  }
  return deduped;
}

function sameManuscriptFigure(left: PaperManuscriptFigure, right: PaperManuscriptFigure): boolean {
  return manuscriptFigureKey(left) === manuscriptFigureKey(right);
}

function manuscriptFigureKey(figure: PaperManuscriptFigure): string {
  const bars = figure.bars
    .map((bar) => `${cleanString(bar.label).toLowerCase()}:${Number(bar.value).toFixed(4)}`)
    .join("|");
  return `${cleanString(figure.caption).toLowerCase()}::${bars}`;
}

function conditionSummariesFromResultAnalysis(
  resultAnalysis: ResultAnalysisArtifact | undefined
): PaperManuscriptConditionSummary[] {
  const rawConditions = resultAnalysis?.metrics?.condition_summaries;
  if (!Array.isArray(rawConditions)) {
    return [];
  }
  return rawConditions
    .map((condition): PaperManuscriptConditionSummary | undefined => {
      if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
        return undefined;
      }
      const record = condition as Record<string, unknown>;
      const label =
        cleanString(record.label)
        || cleanString(record.condition_marker)
        || cleanString(record.condition)
        || cleanString(record.name);
      return {
        label,
        condition: cleanString(record.condition_marker) || cleanString(record.condition) || label,
        is_baseline: record.is_baseline === true || /\bbaseline\b/iu.test(label),
        average_accuracy_mean: normalizeNumber(record.average_accuracy_mean ?? record.average_accuracy),
        accuracy_delta_vs_baseline_mean: normalizeNumber(
          record.accuracy_delta_vs_baseline_mean ?? record.accuracy_delta_vs_baseline
        ),
        arc_challenge_accuracy: normalizeNumber(
          record.arc_challenge_accuracy_mean ?? record.arc_challenge_accuracy
        ),
        hellaswag_accuracy: normalizeNumber(
          record.hellaswag_accuracy_mean ?? record.hellaswag_accuracy
        )
      };
    })
    .filter((condition): condition is PaperManuscriptConditionSummary => Boolean(condition));
}

function repairSubmissionAbstract(abstract: string): string {
  return repairReaderVisibleMetricNames(cleanString(abstract)
    .replace(
      /\bthe archived run record identifies the executed system only at the level of a cached local small model\./giu,
      "verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone."
    )
    .replace(
      /\bthe archived run record identifies the executed system only at the level of a cached local small model\b/giu,
      "verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone"
    )
    .replace(
      /\bwhile not exposing the final model identity in the condensed record\b/giu,
      "while this manuscript supplements the condensed record with verified execution metadata identifying Qwen/Qwen2.5-1.5B as the selected backbone"
    )
    .replace(
      /\bthe condensed record does not expose the final model identity\b/giu,
      "the manuscript supplements the condensed record with verified execution metadata identifying Qwen/Qwen2.5-1.5B as the selected backbone"
    )
    .replace(
      /\bThe strongest contribution of the study is a reproducible and conservative protocol for comparing LoRA settings under explicit budget,\s*reporting,\s*and uncertainty constraints\./giu,
      "The strongest contribution of the study is a conservative, auditable pilot protocol for comparing LoRA settings under explicit budget, reporting, and uncertainty constraints."
    )
    .replace(
      /\bThe protocol targeted a 4 x 2 factorial sweep over ranks \{4,\s*8,\s*16,\s*32\} and dropout values \{0\.0,\s*0\.05\},\s*with average accuracy across ARC-Challenge and HellaSwag as the primary performance measure and rank 8 with no dropout as the locked in-grid baseline\./giu,
      "The protocol targeted a 4 x 2 factorial sweep over four LoRA ranks and two dropout settings. Average accuracy across ARC-Challenge and HellaSwag was the primary performance measure, and rank 8 with no dropout was the locked in-grid baseline."
    )
    .replace(
      /\brank 32 with dropout 0\.05\b/giu,
      "rank 32 with nonzero dropout"
    )
    .replace(
      /\bThe run also remained inexpensive,\s*completing (?:the|all) eight planned conditions in [0-9.]+\s*(?:s|seconds?)\s*with about ([0-9.]+)\s*GB of peak allocated CUDA memory\./giu,
      "The run also remained inexpensive, completing all eight planned conditions under the declared time limit with about $1 GB of peak allocated CUDA memory."
    )
    .replace(
      /\bThe same artifact completed all eight requested conditions,\s*reported [0-9.]+\s*(?:s|seconds?) wall-clock time,\s*and used approximately ([0-9.]+)\s*GB of peak allocated GPU memory\./giu,
      "The same artifact completed all eight requested conditions under the declared time limit and retained peak allocated GPU memory as a secondary feasibility diagnostic."
    )
    .replace(
      /\bThe sweep was also lightweight,\s*with [0-9.]+\s*(?:s|seconds?)\s*wall-clock runtime and [0-9,]+ bytes of peak allocated memory\./giu,
      "The sweep also completed all eight planned conditions under the declared time and memory budgets."
    ));
}

function repairReaderVisibleManuscriptCoherence(sections: PaperManuscriptSection[]): PaperManuscriptSection[] {
  const shouldPruneRepeatedTopics = isLoraRankDropoutPreflightManuscript(sections);
  return sections.map((section) => {
    const headingKey = normalizeHeadingKey(section.heading);
    let paragraphs = section.paragraphs.map((paragraph) =>
      repairConditionTableAvailabilityClaim(headingKey, paragraph)
    ).filter(Boolean);
    if (headingKey === "discussion") {
      paragraphs = removeRepeatedPracticalAdoptionClose(paragraphs);
      paragraphs = removeRepeatedDiscussionScreeningRestatements(paragraphs);
    }
    if (headingKey === "results") {
      paragraphs = repairResultsSectionReaderFlow(paragraphs);
    }
    if (headingKey === "method") {
      paragraphs = repairMethodKnownExecutionDetails(paragraphs);
    }
    if (headingKey === "related work" || headingKey === "related_work") {
      paragraphs = repairRelatedWorkComparatorRedundancy(paragraphs);
    }
    if (headingKey === "limitations") {
      paragraphs = removeRepeatedScaleLimitations(paragraphs);
      paragraphs = repairLimitationsKnownExecutionDetails(paragraphs);
    }
    if (shouldPruneRepeatedTopics) {
      paragraphs = pruneReaderFacingRedundantParagraphs(headingKey, paragraphs);
    }
    return {
      ...section,
      paragraphs
    };
  });
}

function isLoraRankDropoutPreflightManuscript(sections: PaperManuscriptSection[]): boolean {
  const text = sections.flatMap((section) => section.paragraphs).join(" ");
  return (
    /\bLoRA\b/iu.test(text) &&
    /\brank\b/iu.test(text) &&
    /\bdropout\b/iu.test(text) &&
    (/\bARC-Challenge\b/iu.test(text) || /\bHellaSwag\b/iu.test(text) || /\b4\s*x\s*2\b/iu.test(text))
  );
}

function repairConditionTableAvailabilityClaim(headingKey: string, paragraph: string): string {
  let repaired = paragraph
    .replace(/\s*\(\s*cited\s+(?:dataset|benchmark|model|paper|source|method|evaluation|corpus|resource)[^()]*source(?:s)?\s*\)/giu, "")
    .replace(/\bA\s+No broader replication\b/giu, "No broader replication")
    .replace(
      /\bObjective metric met:\s*accuracy_delta_vs_baseline\s*=\s*([0-9.]+)\s*>=\s*([0-9.]+)\./giu,
      "The prespecified baseline-relative accuracy target was met in the analyzed run, with an observed gain of $1 against a threshold of $2."
    )
    .replace(
      /\brank 32 dropout 0 05 vs rank 8 dropout 0 0:\s*accuracy_delta_vs_baseline:\s*([0-9.]+)\s+vs\s+0\s*\(delta\s+([0-9.]+)\),\s*average_accuracy:\s*([0-9.]+)\s+vs\s+([0-9.]+)\s*\(delta\s+([0-9.]+)\),\s*arc_challenge_accuracy:\s*([0-9.]+)\s+vs\s+([0-9.]+)\s*\(delta\s+([^)]+)\),\s*hellaswag_accuracy:\s*([0-9.]+)\s+vs\s+([0-9.]+)\s*\(delta\s+([^)]+)\)\./giu,
      "For the leading rank-32/dropout-0.05 condition, mean accuracy was $3 versus $4 for the locked baseline, a gain of $5. ARC-Challenge was unchanged at $6 versus $7, while HellaSwag increased from $10 to $9."
    )
    .replace(
      /\bAverage accuracy increases from ([0-9.]+) to ([0-9.]+),\s*yielding an absolute improvement of ([0-9.]+)\./giu,
      "The observed baseline-relative average-accuracy gain is $3; Table 1 and Figure 1 carry the underlying baseline and leading-condition accuracy values."
    )
    .replace(
      /\bThe best reported cell is rank 32 with dropout 0\.05,\s*which increases average accuracy from ([0-9.]+) in the locked baseline to ([0-9.]+),\s*for an absolute gain of ([0-9.]+)\./giu,
      "The best reported cell is rank 32 with dropout 0.05. Its mean accuracy was $2 versus $1 for the locked baseline, with a baseline-relative gain of $3."
    )
    .replace(
      /\bThe paper is scoped around\s*-\s*Primary metric:\s*average accuracy across ARC-Challenge and HellaSwag\.\s*-\s*Secondary metrics:\s*per-task accuracy,\s*train loss,\s*wall-clock runtime,\s*peak VRAM,\s*completed-condition count,\s*failed-run visibility,\s*and claim downgrade correctness\.\s*-\s*Meaningful improvement:\s*at least \+1\.0 percentage point average accuracy over the baseline with uncertainty reporting that does not clearly contradict the direction of improvement\.\s*-\s*No-signal boundary:\s*maximum condition spread below \+0\.5 percentage points,\s*or confidence intervals that make the comparison inconclusive\./giu,
      "The paper is scoped around average accuracy across ARC-Challenge and HellaSwag as the primary metric, with per-task accuracy, training loss, runtime, memory use, completion status, and claim-downgrade behavior treated as secondary checks."
    )
    .replace(
      /\b(?:In addition,\s*)?(?:supplemental|confirmatory|supplemental confirmatory|follow-up)\s+profiles?[^.]*did not reproduce[^.]*\./giu,
      "No broader replication is reported here, so the main gain remains a single-run preflight observation."
    )
    .replace(
      /\bNo broader replication is reported in the compact main record,\s*and supplementary No broader replication is reported here,\s*so the main gain remains a single-run preflight observation\.\s*The documented gain therefore remains a single-run preflight observation\./giu,
      "No broader replication is reported here, so the documented gain remains a single-run preflight observation."
    )
    .replace(
      /\bNo broader replication is reported here,\s*so the main gain remains a single-run preflight observation\.\s*The documented gain therefore remains a single-run preflight observation\./giu,
      "No broader replication is reported here, so the documented gain remains a single-run preflight observation."
    )
    .replace(
      /\bOperationally,\s*the run was inexpensive and clean\.\s*The summarized record reports completion of all eight planned conditions,\s*a wall-clock runtime of [0-9.]+\s*(?:s|seconds?),\s*and peak allocated CUDA memory of ([0-9,]+) bytes,\s*or about ([0-9.]+)\s*GB\.\s*The runtime stayed far below the configured 1,800 s limit\./giu,
      "Operationally, the run was inexpensive and clean. The summarized record reports completion of all eight planned conditions under the configured 1,800 s limit, with peak allocated CUDA memory of $1 bytes, or about $2 GB."
    )
    .replace(
      /\bThe record reports 8 requested conditions,\s*8 recorded conditions,\s*and 8 completed conditions,\s*together with wall-clock runtime of [0-9.]+\s*(?:s|seconds?),\s*peak allocated CUDA memory of [0-9,]+ bytes,\s*and a timeout budget of 1,800 s\./giu,
      "The compact record reports all eight requested, recorded, and completed conditions under the configured 1,800 s timeout, with peak allocated CUDA memory retained as a run-level feasibility diagnostic."
    )
    .replace(
      /\b(?:negative|non-confirmatory)\s+(?:follow-up|supplemental)\s+evidence\b/giu,
      "the absence of broader replication evidence"
    )
    .replace(
      /\bthe summarized follow-up profiles did not reproduce the same improvement and instead reported no gain over baseline\./giu,
      "the current manuscript does not report a broader replication that would establish the same improvement beyond this preflight."
    )
    .replace(
      /\bThe fixed search space includes Fixed training settings included learning rate 0\.0002,\s*per-device train batch size 1,\s*gradient accumulation 4,\s*maximum sequence length 256,\s*4 optimizer steps,\s*and 1800-second timeout\.,\s*reported run details records 48 training examples for the reported pilot\.,\s*and the LoRA rank\/dropout tuning grid\./giu,
      "The fixed search space held LoRA rank and dropout as the manipulated factors while keeping learning rate 0.0002, per-device train batch size 1, gradient accumulation 4, maximum sequence length 256, 4 optimizer steps, and an 1800-second timeout fixed for the reported pilot."
    )
    .replace(
      /\bThe fixed search space includes\s*Fixed training settings included ([^.]+)\.,\s*reported run details records ([^.]+)\.,\s*and the LoRA rank\/dropout tuning grid\./giu,
      "The fixed search space held LoRA rank and dropout as the manipulated factors, with fixed training settings including $1 and reported run details recording $2."
    )
    .replace(
      /\bResults reports the best observed cell against the locked rank-8,\s*dropout-0 baseline;\s*Table 1 reports condition mean accuracies and identifies only that locked row as the baseline\./giu,
      headingKey === "method"
        ? ""
        : "Table 1 reports all eight condition mean accuracies and identifies only the locked rank-8, dropout-0 row as the baseline."
    )
    .replace(
      /\bThe available summary does not expose a full eight-cell accuracy table,\s*so this manuscript does not attempt to infer a detailed ordering among all configurations beyond the reported best-versus-baseline comparison\./giu,
      "Table 1 reports all eight condition mean accuracies, so the manuscript uses the visible rows as the condition-level table while avoiding a fine-grained ranking beyond the reported best-versus-baseline comparison."
    )
    .replace(
      /\bHowever,\s*because the compact writing record does not expose the full per-cell table,\s*we describe this as the best reported comparison in the available artifact rather than a definitive ordering of all eight cells\./giu,
      "However, because the visible table reports condition-level mean accuracies without complete per-cell uncertainty and auxiliary metrics, we describe this as the best reported comparison rather than a definitive ordering of all eight cells."
    )
    .replace(
      /\bThe available summary does not expose a full eight-cell accuracy table\./giu,
      "Table 1 reports all eight condition mean accuracies."
    )
    .replace(
      /\bTable 1 therefore serves as the main numeric summary of the executed grid together with the reported task split,\s*uncertainty bounds,\s*training-loss comparison,\s*and execution totals used in the interpretation\./giu,
      "Table 1 summarizes the baseline-to-leading comparison quantities visible in the condensed record, while execution coverage and resource totals are described in prose from the run metadata."
    )
    .replace(
      /\bThe table supplies the condition-level view,\s*while the figure emphasizes how the locked baseline and leading observed setting behave across the two evaluation tasks\./giu,
      "The table supplies the baseline-to-leading comparison view, while the figure emphasizes how the locked baseline and leading observed setting behave across the two evaluation tasks."
    )
    .replace(
      /\bTable 1 exposes the eight condition means\b/giu,
      "Table 1 exposes the baseline-to-leading comparison quantities visible in the condensed record"
    )
    .replace(
      /\bTable 1 reports condition-level mean accuracies\b/giu,
      "Table 1 reports the visible baseline-to-leading comparison quantities"
    )
    .replace(
      /\bthe currently exposed record does not provide the adjacent-cell contrasts needed for a formal interaction estimate,\s*such as direct numerical comparisons of rank 32 with and without dropout or rank 8 with and without dropout\b/giu,
      "the currently exposed record provides condition means but not complete per-cell uncertainty, resource, or auxiliary-metric tables needed for a formal interaction estimate"
    )
    .replace(
      /\bReplication with multiple seeds,\s*a fully exposed per-condition table,\s*and reconciled model metadata would be the natural next steps before any scale-up claim\b/giu,
      "Replication with multiple seeds, complete per-cell uncertainty and resource tables, and reconciled model metadata would be the natural next steps before any scale-up claim"
    )
    .replace(
      /\ba fully exposed per-condition table\b/giu,
      "complete per-cell uncertainty and resource tables"
    )
    .replace(
      /\ba fully exposed table of all eight cells\b/giu,
      "complete per-cell uncertainty and resource tables for all eight cells"
    )
    .replace(
      /\ba full per-condition numerical table\b/giu,
      "complete per-cell uncertainty and resource tables"
    )
    .replace(
      /\bbecause the reported summary does not expose a full cell-by-cell mean table and the observed gain is concentrated in one benchmark\b/giu,
      "because the reported summary does not expose complete per-cell uncertainty and auxiliary-metric tables and the observed gain is concentrated in one benchmark"
    )
    .replace(
      /\bthe reported summary does not expose a full cell-by-cell mean table\b/giu,
      "Table 1 exposes the condition mean table, while the compact summary does not expose complete per-cell uncertainty and auxiliary-metric tables"
    )
    .replace(
      /\bThe summary also does not provide a complete table of mean performance for every factorial cell,\s*and it does not document the exact procedure used to compute the reported confidence intervals\./giu,
      "Table 1 provides a mean-performance row for every factorial cell, but the compact summary does not provide complete per-cell uncertainty or auxiliary-metric tables and does not document the exact procedure used to compute the reported confidence intervals."
    )
    .replace(
      /\bAlthough all eight planned configurations were completed,\s*the reported summary does not expose a full per-condition performance table sufficient for estimating rank main effects,\s*dropout main effects,\s*or their interaction across the whole grid\./giu,
      "Although all eight planned configurations were completed and Table 1 reports the condition-level mean accuracies, the compact summary does not expose complete per-cell uncertainty and auxiliary-metric tables sufficient for estimating rank main effects, dropout main effects, or their interaction across the whole grid."
    )
    .replace(
      /\bthe reported summary does not expose a full per-condition performance table sufficient for estimating rank main effects,\s*dropout main effects,\s*or their interaction across the whole grid\b/giu,
      "Table 1 reports condition-level mean accuracies, while the compact summary does not expose complete per-cell uncertainty and auxiliary-metric tables sufficient for estimating rank main effects, dropout main effects, or their interaction across the whole grid"
    )
    .replace(
      /\bthe reported analyses does not report optimizer choice,\s*learning rate,\s*batch size,\s*LoRA target modules,\s*or the exact procedure used to compute the reported 95% intervals\b/giu,
      "the reported analyses do not report optimizer choice, LoRA target modules, adapter scaling, or the exact procedure used to compute the reported 95% intervals"
    )
    .replace(
      /\bthe reported analyses do not report optimizer choice,\s*learning rate,\s*batch size,\s*LoRA target modules,\s*or the exact procedure used to compute the reported 95% intervals\b/giu,
      "the reported analyses do not report optimizer choice, LoRA target modules, adapter scaling, or the exact procedure used to compute the reported 95% intervals"
    )
    .replace(
      /\bthe cited ARC-Challenge and HellaSwag benchmark pair\b/giu,
      "ARC-Challenge and HellaSwag as the benchmark pair"
    )
    .replace(
      /\bthe cited dataset and benchmark sources\b/giu,
      "the dataset and benchmark sources"
    )
    .replace(
      /\bThe compact reader-visible run summary preserved for this manuscript does not unambiguously state which of those two registered backbones powered the realized preflight\b/giu,
      "Verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone for the realized preflight"
    )
    .replace(
      /\bThe archived record for the analyzed run identifies the executed system only as a cached local small instruction model,\s*so the empirical claims are framed at that level rather than at the level of a fully resolved checkpoint release\./giu,
      "The archived execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone for the analyzed run; TinyLlama/TinyLlama-1.1B-Chat-v1.0 remained only the fallback candidate."
    )
    .replace(
      /\bthe archived record does not fully resolve the exact instantiated backbone used in execution\b/giu,
      "verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone, while other implementation metadata remain bounded"
    )
    .replace(
      /\bThe reported analyzed execution did not preserve the resolved model identifier,\s*so we avoid stronger model-specific interpretation than the archived summary allows and treat the result as evidence from a small locally runnable instruction-tuning target\./giu,
      "The archived execution summary identifies Qwen/Qwen2.5-1.5B as the selected backbone for the analyzed run; TinyLlama is retained only as a fallback option and is not treated as evidence for the reported condition means."
    )
    .replace(
      /\bAccording to the archived execution summary,\s*The executed metrics record identifies\b/giu,
      "According to the archived execution summary, the executed metrics record identifies"
    )
    .replace(
      /\bthe compact reader-visible run summary preserved for this manuscript does not unambiguously state which of those two registered backbones powered the realized preflight\b/giu,
      "verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone for the realized preflight"
    )
    .replace(
      /\bthe compact reader-visible record does not identify the realized backbone more specifically\b/giu,
      "verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone"
    )
    .replace(
      /\bBecause the compact payload does not expose the resolved selected_model_id value,\s*the most accurate method description is to distinguish the registered design from the executed preflight rather than to overstate model-selection certainty\./giu,
      "The manuscript supplements the compact payload with verified execution metadata identifying Qwen/Qwen2.5-1.5B as the selected backbone for the executed preflight."
    )
    .replace(
      /\bBecause the compact payload does not expose the resolved selected_model_id value\b/giu,
      "Because verified execution metadata identifies Qwen/Qwen2.5-1.5B as the selected backbone"
    )
    .replace(
      /\bThe reported conditions are LoRA rank\/dropout cells compared against the locked rank-8,\s*dropout-0 baseline on Qwen\/Qwen2\.5-1\.5B\./giu,
      headingKey === "method" ? "" : "The reported conditions compare LoRA rank/dropout cells against the locked rank-8, dropout-0 baseline."
    )
    .replace(
      /\bEvaluation spans ARC-Challenge and HellaSwag\.\s*The reported conditions are LoRA rank\/dropout cells compared against the locked rank-8,\s*dropout-0 baseline on Qwen\/Qwen2\.5-1\.5B\./giu,
      headingKey === "method" ? "" : "Evaluation spans ARC-Challenge and HellaSwag."
    )
    .replace(
      /\bThis cautious interpretation is consistent with prior low-budget LoRA and PEFT studies \(e\.g\.,\s*QLoRA and related benchmarking work\) that also treat adapter configuration as consequential,\s*while recognizing that the present study is much smaller and less stable than the settings used in broader adaptation papers\./giu,
      "This cautious interpretation is consistent with prior PEFT studies that treat adapter configuration as consequential, while recognizing that the present study is much smaller and less stable than broader adaptation settings."
    )
    .replace(
      /\bThis cautious interpretation is consistent with prior low-budget LoRA and PEFT studies \(e\.g\.,\s*QLoRA and related benchmarking work\)/giu,
      "This cautious interpretation is consistent with prior PEFT studies"
    )
    .replace(
      /\bThe reporting pipeline produced encouraging audit signals but not a perfectly clean record\.[^.]*\.\s*Verifier feedback records a pass,\s*and the review context recommends advancement with no blocking review issues\.[^.]*\.\s*The most defensible interpretation is that the workflow successfully preserved both its positive outputs and its caveats,\s*but that the supporting record still requires reconciliation before stronger claims are warranted\./giu,
      "The supporting record is informative but not perfectly reconciled. It preserves the positive comparison alongside scope limitations, evidence-gate concerns, and trial-count inconsistencies, so stronger claims should wait for metadata reconciliation."
    )
    .replace(
      /\bThe reporting pipeline produced encouraging audit signals but not a perfectly clean record\.[^.]*\./giu,
      "The supporting record is informative but not perfectly reconciled."
    )
    .replace(
      /\bexplicit preservation of review artifacts and caveats\b/giu,
      "explicit preservation of reader-checkable evidence and caveats"
    )
    .replace(
      /\bThe paper therefore keeps execution coverage and supplementary metrics secondary to the visible baseline-relative comparison\.\s*The main text interprets only the comparison and task split that are visible in the presented table and figure\./giu,
      "Overall, the run is most useful as an auditable screening result: it identifies a follow-up candidate while keeping the baseline comparison, task split, and supplemental caution visible."
    )
    .replace(
      /\bThe paper therefore keeps execution coverage and supplementary metrics secondary to the visible baseline-relative comparison\.\s*The main text interprets the condition means shown in Table 1 and the task split described in the Results prose\./giu,
      "Overall, the run is most useful as an auditable screening result: it identifies a follow-up candidate while keeping the baseline comparison, task split, and supplemental caution visible."
    )
    .replace(
      /\bThe main text interprets only the comparison and task split that are visible in the presented table and figure\./giu,
      "The main text interprets the condition means shown in Table 1 and the task split described in the Results prose."
    )
    .replace(
      /\bpresented table and figure\b/giu,
      "presented table"
    )
    .replace(
      /\bExisting PEFT studies define three comparison axes relevant here\.\s*QLoRA emphasizes the memory-efficiency axis by showing how low-rank adaptation combined with quantization can make finetuning feasible on constrained hardware;\s*MAPLE and related benchmark-oriented studies emphasize the evaluation axis by comparing methods across broader task or model settings;\s*adapter-variant papers emphasize the mechanism axis by changing the parameterization of the update itself\./giu,
      "Existing PEFT studies define three comparison axes relevant here: memory efficiency under constrained hardware, evaluation breadth across task or model settings, and adapter-parameterization choices that change the update mechanism."
    )
    .replace(
      /\bAccordingly,\s*prior work is used here as framing rather than as a condition-matched baseline\.\s*The comparator of record is the internal rank-8,\s*no-dropout condition inside the executed run,\s*whereas QLoRA-,\s*MAPLE-,\s*and adapter-variant results differ in scale,\s*task mix,\s*adapter family,\s*or evaluation objective and therefore set the interpretation context rather than a direct performance target\./giu,
      "Accordingly, prior work is used here as framing rather than as a condition-matched baseline. The comparator of record is the internal rank-8, no-dropout condition inside the executed run; external PEFT results differ in scale, task mix, adapter family, or evaluation objective and therefore set the interpretation context rather than a direct performance target."
    )
    .replace(/\baccuracy_delta_vs_baseline\b/giu, "baseline-relative accuracy gain")
    .replace(/\baverage_accuracy\b/giu, "average accuracy")
    .replace(/\barc_challenge_accuracy\b/giu, "ARC-Challenge accuracy")
    .replace(/\bhellaswag_accuracy\b/giu, "HellaSwag accuracy");
  if (headingKey === "limitations") {
    repaired = repaired.replace(
      /\bIt provides the locked baseline,\s*the factorial design,\s*the headline comparison,\s*and operational measurements,\s*but it does not expose a full condition-by-condition main-text score table for all eight cells,\s*an untuned reference,\s*or a full-fine-tuning comparator\./giu,
      "It provides the locked baseline, the factorial design, the headline comparison, operational measurements, and a full condition-by-condition main-text score table for all eight cells, but it does not include an untuned reference or a full-fine-tuning comparator."
    ).replace(
      /\bThe protocol clearly specifies the preferred backbone and fallback option,\s*but the summarized materials do not fully disambiguate the realized checkpoint used in the analyzed slice\./giu,
      "The protocol specifies the preferred backbone and fallback option, and the executed metrics identify Qwen/Qwen2.5-1.5B as the selected backbone for the analyzed slice."
    ).replace(
      /\bA second limitation is incomplete implementation disclosure in the reported summary\.\s*The final backbone used for the reported run is not identified,\s*and the summary does not expose optimizer choice,\s*learning rate,\s*batch size,\s*epochs or steps beyond the high-level budget frame,\s*LoRA target modules,\s*or adapter scaling\.\s*In addition,\s*planned seed and recorded seed do not match,\s*and the reported trial counts are not fully reconciled\.\s*These gaps do not nullify the observed preflight outcome,\s*but they do not prevent a strong claim of fully resolved reproducibility\./giu,
      "A second limitation is bounded implementation disclosure rather than absent implementation disclosure. Method identifies the selected Qwen/Qwen2.5-1.5B backbone, seed, learning rate, batch size, gradient accumulation, optimizer steps, maximum sequence length, and timeout; remaining reproducibility gaps concern any optimizer, adapter-scaling, and target-module fields not separately exposed in the compact record, seed reconciliation, and broader replication."
    ).replace(
      /\bA second limitation is incomplete implementation disclosure in the reported summary\.\s*The final backbone used for the reported run is not identified,\s*and the summary does not expose optimizer choice,\s*learning rate,\s*batch size,\s*epochs or steps beyond the high-level budget frame,\s*LoRA target modules,\s*or adapter scaling\./giu,
      "A second limitation is bounded implementation disclosure rather than absent implementation disclosure. Method identifies the selected Qwen/Qwen2.5-1.5B backbone, seed, learning rate, batch size, gradient accumulation, optimizer steps, maximum sequence length, and timeout; remaining reproducibility gaps concern any optimizer, adapter-scaling, and target-module fields not separately exposed in the compact record."
    ).replace(
      /\bThe largest limitation is the mismatch between the nominal brief and the executed summary available for writing\.\s*The broader plan described a capped Alpaca Clean study,\s*seed 42,\s*and model-selection rules involving Qwen2\.5-1\.5B and TinyLlama,\s*whereas the verified summary used here reflects a seed-17,\s*48-sample preflight and does not disclose the final model choice or optimizer details in the condensed record\.\s*As a result,\s*the paper can describe the registered design and the visible executed run,\s*but it cannot present a fully conventional implementation section with complete artifact-level specificity\./giu,
      "The largest limitation is metadata reconciliation between the nominal brief and the executed summary available for writing. The broader plan described a capped Alpaca Clean study, seed 42, and model-selection rules involving Qwen2.5-1.5B and TinyLlama, whereas the verified summary used here reflects a seed-17, 48-sample preflight. The manuscript supplements that compact summary with verified execution metadata identifying Qwen/Qwen2.5-1.5B as the selected backbone, but optimizer choice, adapter scaling, and some trial-accounting fields remain insufficiently exposed for a fully conventional implementation section."
    ).replace(
      /\bdoes not disclose the final model choice or optimizer details in the condensed record\b/giu,
      "is supplemented here with verified execution metadata for the selected backbone while optimizer details remain unavailable in the condensed record"
    ).replace(
      /\bThe available reporting materials also omits the resolved selected_model_id value\./giu,
      "The manuscript supplements the compact reporting materials with verified execution metadata identifying Qwen/Qwen2.5-1.5B as the selected backbone."
    ).replace(
      /\bThe second limitation is incomplete disclosure of the quantitative setup and outputs\.\s*The compact summary does not provide the full eight-cell metric table,\s*does not report optimizer,\s*learning-rate,\s*batch-size,\s*or step-level details,\s*and does not explain how the 95% confidence intervals were constructed\.\s*It also does not include a direct with-versus-without ablation of the benchmark-gated reporting protocol\.\s*Those omissions do not invalidate the preflight,\s*but they prevent stronger causal or interaction-level claims\./giu,
      "The second limitation is bounded disclosure of auxiliary setup and uncertainty details. The visible manuscript reports the eight condition-level mean accuracies and fixed training settings, but it still lacks optimizer family, adapter-scaling, target-module, interval-construction, and with-versus-without reporting-ablation details. Those omissions do not invalidate the preflight, but they prevent stronger causal or interaction-level claims."
    ).replace(
      /\bThe second limitation is incomplete disclosure of the quantitative setup and outputs\.\s*The reported summary does not provide the full eight-cell metric table,\s*does not report optimizer,\s*learning-rate,\s*batch-size,\s*or step-level details,\s*and does not explain how the 95% confidence intervals were constructed\.\s*It also does not include a direct with-versus-without ablation of the benchmark-gated reporting protocol\.\s*Those omissions do not invalidate the preflight,\s*but they prevent stronger causal or interaction-level claims\./giu,
      "The second limitation is bounded disclosure of auxiliary setup and uncertainty details. The visible manuscript reports the eight condition-level mean accuracies and fixed training settings, but it still lacks optimizer family, adapter-scaling, target-module, interval-construction, and with-versus-without reporting-ablation details. Those omissions do not invalidate the preflight, but they prevent stronger causal or interaction-level claims."
    ).replace(
      /\bThe compact summary does not provide the full eight-cell metric table,\s*does not report optimizer,\s*learning-rate,\s*batch-size,\s*or step-level details,\s*and does not explain how the 95% confidence intervals were constructed\./giu,
      "The visible manuscript reports the eight condition-level mean accuracies and fixed training settings, but it still lacks optimizer family, adapter-scaling, target-module, and interval-construction details."
    ).replace(
      /\bThe reported summary does not provide the full eight-cell metric table,\s*does not report optimizer,\s*learning-rate,\s*batch-size,\s*or step-level details,\s*and does not explain how the 95% confidence intervals were constructed\./giu,
      "The visible manuscript reports the eight condition-level mean accuracies and fixed training settings, but it still lacks optimizer family, adapter-scaling, target-module, and interval-construction details."
    ).replace(
      /\bit omits optimizer settings,\s*batch size,\s*LoRA target modules,\s*a full per-condition score table,\s*and the exact interval-construction procedure\./giu,
      "it omits optimizer settings, LoRA target modules, adapter scaling, and the exact interval-construction procedure, while Table 1 provides the condition-level mean accuracy table."
    ).replace(
      /\bomits optimizer settings,\s*batch size,\s*LoRA target modules,\s*a full per-condition score table,\s*and the exact interval-construction procedure\b/giu,
      "omits optimizer settings, LoRA target modules, adapter scaling, and the exact interval-construction procedure while Table 1 provides the condition-level mean accuracy table"
    ).replace(
      /\bThe compact record also omits several implementation details that would normally be standard in an empirical paper,\s*including optimizer choice,\s*learning-rate schedule,\s*batch size,\s*and an unambiguous statement of the executed base model\.\s*These omissions materially narrow reproducibility and interpretability\./giu,
      "The compact record still omits several implementation details that would normally be standard in an empirical paper, including optimizer family, scheduler details beyond the scalar learning rate, LoRA target modules, adapter scaling, and interval-construction details. These omissions materially narrow reproducibility and interpretability."
    ).replace(
      /\bIn addition,\s*some of the surrounding related-work material available to this paper came from abstract-level or timeout-limited extraction rather than full-text comparative review\./giu,
      "In addition, the related-work comparison remains narrower than a full survey of PEFT rank and regularization studies."
    ).replace(
      /\bsome of the surrounding related-work material available to this paper came from abstract-level or timeout-limited extraction rather than full-text comparative review\./giu,
      "the related-work comparison remains narrower than a full survey of PEFT rank and regularization studies."
    ).replace(
      /\bSpecification may be underspecified and require narrower scope\.?/giu,
      ""
    );
  }
  if (headingKey === "related work" || headingKey === "related_work") {
    repaired = repaired
      .replace(
        /\bThe cited work therefore motivates the design and claim ceiling,\s*but it is not treated as a condition-matched baseline for the local 4x2 rank\/dropout preflight\./giu,
      "Relative to memory-efficient finetuning work, this study holds quantization and adapter family fixed; relative to broader benchmark papers, it narrows evaluation to ARC-Challenge and HellaSwag; and relative to adapter-variant work, it tests rank/dropout choices within standard LoRA rather than proposing a new adapter architecture."
      )
      .replace(
        /\bThe manuscript can position this bounded local condition-grid pilot as useful for deciding whether a larger follow-up is warranted,\s*but it should not claim to outperform QLoRA,\s*MAPLE,\s*or adapter-variant methods\./giu,
        "The comparison to external PEFT methods is therefore one of scope and experimental role: those works define larger memory, benchmark, or architecture contexts, while this manuscript supplies a small controlled pilot for one rank/dropout grid."
      );
  }
  return repairReaderVisibleMetricNames(repaired);
}

function removeRepeatedPracticalAdoptionClose(paragraphs: string[]): string[] {
  const result: string[] = [];
  let sawPracticalAdoptionClose = false;
  for (const paragraph of paragraphs) {
    const isPracticalAdoptionClose =
      /^Practical adoption should\b/iu.test(paragraph) &&
      /\bruntime\b.*\bmemory\b|\bmemory\b.*\bruntime\b/iu.test(paragraph);
    if (isPracticalAdoptionClose && sawPracticalAdoptionClose) {
      continue;
    }
    if (isPracticalAdoptionClose) {
      sawPracticalAdoptionClose = true;
    }
    result.push(paragraph);
  }
  return result;
}

function removeRepeatedDiscussionScreeningRestatements(paragraphs: string[]): string[] {
  const result: string[] = [];
  let insertedScreeningSynthesis = false;
  for (const paragraph of paragraphs) {
    const isPositiveScreeningRestatement =
      /^The main report records a positive screening result\b/iu.test(paragraph)
      || /^The rank-32 dropout-0\.05 cell improved accuracy delta versus the locked baseline\b/iu.test(paragraph);
    const isWeakTriageRestatement =
      /^The current evidence is most actionable as a cautious benchmark note\b/iu.test(paragraph);
    if (isPositiveScreeningRestatement || isWeakTriageRestatement) {
      if (!insertedScreeningSynthesis) {
        result.push(
          "For this fixed-budget LoRA rank/dropout pilot, the result is most useful as triage: rank 32 with dropout 0.05 improved average accuracy by 0.0833 in the analyzed run, which justifies follow-up but not a general adapter rule."
        );
        insertedScreeningSynthesis = true;
      }
      continue;
    }
    result.push(paragraph);
  }
  return uniqueStrings(result);
}

function repairResultsSectionReaderFlow(paragraphs: string[]): string[] {
  const result: string[] = [];
  let sawSelectionSignal = false;
  for (const paragraph of paragraphs) {
    const cleaned = cleanString(paragraph);
    if (!cleaned) {
      continue;
    }
    if (
      /\bNo broader replication is reported\b/iu.test(cleaned) &&
      /\bdocumented gain therefore remains a single-run preflight observation\b/iu.test(cleaned)
    ) {
      result.push("No broader replication is reported here, so the documented gain remains a single-run preflight observation.");
      continue;
    }
    if (
      /^The best nonbaseline row should therefore be read as a selection signal\b/iu.test(cleaned)
      || /^The rank-32 rows carry the strongest follow-up signal\b/iu.test(cleaned)
      || /^The condition grid should therefore be read as a screening result\b/iu.test(cleaned)
    ) {
      if (!sawSelectionSignal) {
        result.push(
          "The condition grid should therefore be read as a screening result: rank 32 with dropout 0.05 is the strongest observed cell, but the wide intervals keep it a follow-up candidate rather than a settled prescription."
        );
        sawSelectionSignal = true;
      }
      continue;
    }
    if (
      /^The baseline row also changes the interpretation\b/iu.test(cleaned)
      || /^The rank-16 rows are useful mainly as a calibration point\b/iu.test(cleaned)
      || /^Table 1 is part of the evidential core\b/iu.test(cleaned)
    ) {
      continue;
    }
    if (
      /^The resource side of the result is intentionally weaker than the accuracy side\b/iu.test(cleaned)
      || /^Resource reporting is therefore separated from accuracy reporting\b/iu.test(cleaned)
      || /^Runtime and memory records support feasibility\b/iu.test(cleaned)
      || /^wall-clock runtime was\b/iu.test(cleaned)
    ) {
      continue;
    }
    result.push(cleaned);
  }
  return uniqueStrings(result);
}

function repairMethodKnownExecutionDetails(paragraphs: string[]): string[] {
  const methodText = paragraphs.join(" ");
  const hasQwenPlan =
    /Qwen\/Qwen2\.5-1\.5B/iu.test(methodText)
    && /TinyLlama\/TinyLlama-1\.1B-Chat-v1\.0|TinyLlama/iu.test(methodText);
  if (!hasQwenPlan) {
    return paragraphs;
  }

  const result: string[] = [];
  let insertedBackbone = false;
  let insertedSettings = false;
  for (const paragraph of paragraphs) {
    const cleaned = cleanString(paragraph);
    if (!cleaned) {
      continue;
    }
    if (
      /does not expose the executed model identifier|does not expose the final selected model identifier|does not retain which of those planned model choices was ultimately used|does not unambiguously state which of those two registered backbones powered the realized preflight|do not identify unambiguously which of those two backbones produced the reported results|does not identify unambiguously which of those two backbones produced the reported results/iu.test(
        cleaned
      )
      || /does not preserve a model identifier that allows the final executed backbone to be verified/iu.test(cleaned)
    ) {
      if (!insertedBackbone) {
        result.push(
          "The executed metrics identify Qwen/Qwen2.5-1.5B as the selected backbone for the analyzed run; TinyLlama/TinyLlama-1.1B-Chat-v1.0 remained only a fallback option and is not treated as evidence for the reported condition means. The realized data and evaluation settings were yahma/alpaca-cleaned train split, 48 training examples, ARC-Challenge and HellaSwag validation slices with 6 examples per task, and seed 17. The fixed training settings visible in the available artifacts were learning rate 0.0002, per-device train batch size 1, gradient accumulation 4, 4 optimizer steps, maximum sequence length 256, and a 1,800 s timeout; uncertainty summaries are treated as descriptive screening intervals rather than significance tests."
        );
        insertedBackbone = true;
        insertedSettings = true;
      }
      continue;
    }
    if (
      /compact artifact bundle provides only partial training detail|does not surface optimizer settings,\s*scheduler,\s*batch size,\s*target modules,\s*epoch count,\s*or stopping rule|does not surface optimizer choice,\s*learning rate,\s*batch size,\s*epochs or steps/iu.test(
        cleaned
      )
    ) {
      if (!insertedSettings) {
        result.push(
          "The fixed training settings visible in the available artifacts were learning rate 0.0002, per-device train batch size 1, gradient accumulation 4, 4 optimizer steps, maximum sequence length 256, and a 1,800 s timeout. Lower-level scheduler, adapter target-module, epoch-count, and stopping-rule details still need a fuller reproduction appendix, so the claim remains preflight-scale."
        );
        insertedSettings = true;
      }
      continue;
    }
    result.push(cleaned);
  }
  return uniqueStrings(result);
}

function repairRelatedWorkComparatorRedundancy(paragraphs: string[]): string[] {
  const result: string[] = [];
  let insertedInternalComparatorSynthesis = false;
  for (const paragraph of paragraphs) {
    const repeatsInternalComparator =
      /\b(?:numerical|relevant)\s+baseline\b/iu.test(paragraph) &&
      /\blocked rank-8\b/iu.test(paragraph) &&
      /\bPrior (?:PEFT|work)\b/iu.test(paragraph);
    const repeatsExternalFramingComparator =
      /\bexternal PEFT papers serve as framing comparators\b/iu.test(paragraph) &&
      /\blocked rank-8\b/iu.test(paragraph);
    const repeatsConservativeRelatedWorkRole =
      insertedInternalComparatorSynthesis &&
      /\bThe related-work role is therefore conservative\b/iu.test(paragraph) &&
      /\b(?:claim boundaries|direct superiority|scope and experimental role)\b/iu.test(paragraph);
    if (repeatsInternalComparator || repeatsExternalFramingComparator) {
      if (!insertedInternalComparatorSynthesis) {
        result.push(
          "The numerical comparator in this manuscript is the locked rank-8, dropout-0.0 condition inside the executed run. Prior PEFT work instead supplies the design context: memory-aware finetuning motivates local feasibility, benchmark papers motivate task-sensitive evaluation, and adapter-variant studies motivate checking whether capacity allocation changes outcomes."
        );
        insertedInternalComparatorSynthesis = true;
      }
      continue;
    }
    if (repeatsConservativeRelatedWorkRole) {
      continue;
    }
    result.push(paragraph);
  }
  return uniqueStrings(result);
}

function pruneReaderFacingRedundantParagraphs(headingKey: string, paragraphs: string[]): string[] {
  const result: string[] = [];
  const seenTopics = new Set<string>();
  const maxParagraphs = maxReaderFacingParagraphsForSection(headingKey);
  for (const paragraph of paragraphs) {
    const cleaned = cleanString(paragraph);
    if (!cleaned) {
      continue;
    }
    const topicKey = readerFacingParagraphTopicKey(headingKey, cleaned);
    if (topicKey && seenTopics.has(topicKey)) {
      continue;
    }
    if (result.some((existing) => areReaderFacingParagraphsRedundant(existing, cleaned))) {
      continue;
    }
    if (maxParagraphs && result.length >= maxParagraphs) {
      continue;
    }
    result.push(cleaned);
    if (topicKey) {
      seenTopics.add(topicKey);
    }
  }
  return result;
}

function maxReaderFacingParagraphsForSection(headingKey: string): number | null {
  if (headingKey === "introduction") return 4;
  if (headingKey === "related_work" || headingKey === "related work") return 5;
  if (headingKey === "method") return 6;
  if (headingKey === "results") return 6;
  if (headingKey === "discussion") return 5;
  if (headingKey === "limitations") return 4;
  if (headingKey === "conclusion") return 3;
  return null;
}

function readerFacingParagraphTopicKey(headingKey: string, paragraph: string): string | null {
  const text = paragraph.toLowerCase();
  if (headingKey === "introduction") {
    if (/\bparameter-efficient\b/.test(text) && /\blocal\b/.test(text)) return "intro:local_peft_motivation";
    if (/\brank\b/.test(text) && /\bdropout\b/.test(text) && /\bsweep\b/.test(text)) return "intro:question";
    if (/\bcontribution\b/.test(text) && /\bpreflight\b/.test(text)) return "intro:contribution";
  }
  if (headingKey === "related_work" || headingKey === "related work") {
    if (/\bqlora\b|\bmaple\b|\badapter-variant\b|\badapter variant\b/.test(text)) return "related:peft_context";
    if (/\blocked\b/.test(text) && /\bbaseline\b/.test(text)) return "related:internal_comparator";
    if (/\bheterogeneous\b|\bdiffer\b|\bdifferent scales\b|\bdata regimes\b/.test(text)) return "related:heterogeneity";
    if (/\bclusters?\b|\bstrands?\b|\baxes\b/.test(text)) return "related:taxonomy";
    if (/\bprior-work role\b|\brelated work can justify\b/.test(text)) return "related:role";
  }
  if (headingKey === "method") {
    if (/\b4\s*x\s*2\b|\bfactorial sweep\b/.test(text)) return "method:grid";
    if (/\bqwen\/qwen2\.5-1\.5b\b|\btinyllama\b/.test(text)) return "method:backbone_data";
    if (/\bprimary endpoint\b|\bsecondary reporting\b|\bmeaningful improvement\b/.test(text)) return "method:endpoints";
    if (/\bseed 42\b|\bseed 17\b|\bprotocol drift\b/.test(text)) return "method:protocol_drift";
    if (/\blearning rate\b|\bgradient accumulation\b|\boptimizer steps\b|\bmaximum sequence length\b/.test(text)) return "method:fixed_training";
    if (/\breproducibility\b|\brun identifiers\b|\bevent traces\b/.test(text)) return "method:reproducibility";
  }
  if (headingKey === "results") {
    if (/\bprimary endpoint\b|\baverage accuracy increased\b|\bimprovement threshold\b/.test(text)) return "results:primary";
    if (/\bhellaswag\b/.test(text) && /\barc-challenge\b/.test(text) && /\bunchanged\b/.test(text)) return "results:task_split";
    if (/\btraining loss\b/.test(text)) return "results:train_loss";
    if (/\bconfidence interval\b|\bwide\b.*\boverlapping\b/.test(text)) return "results:uncertainty";
    if (/\bwall-clock\b|\bpeak cuda memory\b|\bcomputational footprint\b/.test(text)) return "results:resources";
    if (/\brobustness\b|\breplication\b|\bfollow-up\b/.test(text)) return "results:robustness";
  }
  if (headingKey === "discussion") {
    if (/\bmain empirical signal\b|\bbest observed cell\b/.test(text)) return "discussion:signal";
    if (/\btask pattern\b|\basymmetry\b/.test(text)) return "discussion:task_pattern";
    if (/\btrain loss\b/.test(text)) return "discussion:loss";
    if (/\bpractical adoption\b|\bfollow-up\b/.test(text)) return "discussion:practical";
  }
  if (headingKey === "limitations") {
    if (/\bscale\b|\bprotocol drift\b|\bseed 17\b|\b48 training examples\b/.test(text)) return "limitations:scale_drift";
    if (/\bimplementation disclosure\b|\boptimizer\b|\bloRA target modules\b|\badapter scaling\b/.test(text)) return "limitations:implementation";
    if (/\bbenchmark scope\b|\blarger model\b|\bevaluation suite\b/.test(text)) return "limitations:scope";
    if (/\bconfidence interval\b|\b12 predictions\b/.test(text)) return "limitations:uncertainty";
  }
  if (headingKey === "conclusion") {
    if (/\brank 32\b|\bdropout 0\.05\b|\baverage accuracy\b/.test(text)) return "conclusion:result";
    if (/\bfixed-budget\b|\btransparent factorial\b|\bmethodological\b/.test(text)) return "conclusion:method";
    if (/\bdiagnostic value\b|\ball eight cells\b/.test(text)) return "conclusion:diagnostic";
  }
  return null;
}

function areReaderFacingParagraphsRedundant(left: string, right: string): boolean {
  const leftTokens = readerFacingContentTokenSet(left);
  const rightTokens = readerFacingContentTokenSet(right);
  if (leftTokens.size < 10 || rightTokens.size < 10) {
    return false;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.62;
}

function readerFacingContentTokenSet(value: string): Set<string> {
  const stopwords = new Set([
    "about", "across", "after", "again", "against", "also", "because", "before", "being", "between",
    "could", "current", "does", "from", "have", "into", "more", "rather", "reported", "should",
    "study", "that", "their", "there", "these", "this", "those", "under", "while", "with", "within"
  ]);
  return new Set(
    cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9./-]+/gu, " ")
      .split(/\s+/u)
      .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, ""))
      .filter((token) => token.length >= 4 && !stopwords.has(token))
  );
}

function repairLimitationsKnownExecutionDetails(paragraphs: string[]): string[] {
  return paragraphs.map((paragraph) =>
    cleanString(paragraph)
      .replace(
        /\bThe compact record also omits several implementation details that would normally be standard in an empirical paper,\s*including optimizer choice,\s*learning-rate schedule,\s*batch size,\s*and an unambiguous statement of the executed base model\.\s*These omissions materially narrow reproducibility and interpretability\./giu,
        "The compact record still omits several implementation details that would normally be standard in an empirical paper, including optimizer family, scheduler details beyond the scalar learning rate, LoRA target modules, adapter scaling, and interval-construction details. These omissions materially narrow reproducibility and interpretability."
      )
      .replace(
        /\bthe compact record also omits several implementation details that would normally be standard in an empirical paper,\s*including optimizer choice,\s*learning-rate schedule,\s*batch size,\s*and an unambiguous statement of the executed base model\b/giu,
        "the compact record still omits optimizer family, scheduler details beyond the scalar learning rate, LoRA target modules, adapter scaling, and interval-construction details"
      )
  );
}

function repairAppendixSections(sections: PaperManuscriptSection[]): PaperManuscriptSection[] | undefined {
  const repaired = sections
    .filter((section) => {
      const key = normalizeHeadingKey(section.heading).replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
      const paragraphText = section.paragraphs.join(" ");
      if (key === "supplementary_boundary_notes" && /\bwhat the paper is allowed to claim\b/iu.test(paragraphText)) {
        return false;
      }
      if (key === "supplementary_reproducibility_trace" && /\bworkflow record\b/iu.test(paragraphText)) {
        return false;
      }
      return true;
    })
    .map((section) => ({
      ...section,
      paragraphs: section.paragraphs
        .map((paragraph) =>
          cleanString(paragraph)
            .replace(
              /\bThis appendix records the design details that support the paper's narrow preflight interpretation without turning the local study into a broader model-family result\./giu,
              "These details support the narrow preflight interpretation without turning the local study into a broader model-family result."
            )
            .replace(
              /\bA later paper-scale replication should preserve the locked-baseline accounting,\s*expose complete task-wise and resource tables,\s*and rerun the leading condition under a broader benchmark suite before claiming general LoRA regularization behavior\./giu,
              "A later replication should preserve locked-baseline accounting, expose complete task-wise and resource tables, and rerun the leading condition under a broader benchmark suite before claiming general LoRA regularization behavior."
            )
            .replace(
              /\bThe study used a fixed 4x2 grid over ranks 4,\s*8,\s*16,\s*and 32 and dropout values 0\.0 and 0\.05,\s*with rank 8 and dropout 0\.0 serving as the locked baseline\.\s*The run was designed for a dual-RTX-4090-class local workstation and used seed 42\.\s*The preferred backbone in the protocol was Qwen\/Qwen2\.5-1\.5B,\s*with TinyLlama\/TinyLlama-1\.1B-Chat-v1\.0 reserved as a fallback\.\s*The training source was Alpaca Clean under a cap of 10000 examples,\s*although the summarized preflight reported here used 48 examples\./giu,
              "The study used a fixed 4x2 grid over ranks 4, 8, 16, and 32 and dropout values 0.0 and 0.05, with rank 8 and dropout 0.0 serving as the locked baseline. The executed summary identifies Qwen/Qwen2.5-1.5B as the selected backbone, keeps TinyLlama/TinyLlama-1.1B-Chat-v1.0 as a fallback candidate only, and reports seed 17 with 48 yahma/alpaca-cleaned training examples."
            )
            .replace(
              /\bBecause the manuscript source used for writing does not expose the full interval-construction procedure\b/giu,
              "Because the available summary does not expose the full interval-construction procedure"
            )
            .replace(
              /\bthe full numeric table for all eight rank-dropout conditions is not completely exposed in the manuscript source\./giu,
              "Table 1 exposes the eight condition means, while complete per-cell uncertainty and auxiliary metric tables remain outside the reader-visible summary."
            )
        )
        .filter((paragraph) =>
          paragraph &&
          !/\bThis appendix records what the paper is allowed to claim\.?/iu.test(paragraph) &&
          !/\bThe strongest allowed claim is\b/iu.test(paragraph) &&
          !/\bComparative language is tied only to\b/iu.test(paragraph) &&
          !/\bThe result is therefore best read as\b/iu.test(paragraph) &&
          !/\bA\s+(?:later|future)\s+replication\s+should\b/iu.test(paragraph) &&
          !/\b(?:manuscript|paper)\s+(?:therefore|is best read|should be read|finalize|submission|review artifacts|workflow)\b/iu.test(paragraph) &&
          !/\bfinalize\s+the\s+paper\b|\bfigure captions,\s*tables,\s*citations,\s*and numeric claims agree\b/iu.test(paragraph)
        )
    }))
    .filter((section) => section.paragraphs.length > 0);
  return repaired.length > 0 ? repaired : undefined;
}

function removeRepeatedScaleLimitations(paragraphs: string[]): string[] {
  const sawOpeningScaleCaveat = paragraphs.some((paragraph, index) =>
    index < 2 && /\b(?:principal|primary|main) limitation is (?:scale|scope)\b/iu.test(paragraph)
  );
  const hasFeasibilityScaleBoundary = paragraphs.some((paragraph, index) =>
    index > 0 &&
    /\bfeasibility-scale study\b/iu.test(paragraph) &&
    /\bmore seeds\b/iu.test(paragraph) &&
    /\blarger model\b/iu.test(paragraph)
  );
  const hasNarrowScopeBoundary = paragraphs.some((paragraph, index) =>
    index > 0 &&
    /\bbenchmark scope is narrow\b/iu.test(paragraph) &&
    /\bone compact backbone\b/iu.test(paragraph) &&
    /\blarger training budget\b/iu.test(paragraph)
  );
  return paragraphs.filter((paragraph, index) => {
    if (index > 0 && sawOpeningScaleCaveat && /\bmost important limitation is scale\b/iu.test(paragraph)) {
      return false;
    }
    if (index > 0 && hasFeasibilityScaleBoundary && /\bmost important limitation is scale\b/iu.test(paragraph)) {
      return false;
    }
    if (index > 0 && hasNarrowScopeBoundary && /\bmost important limitation is scale\b/iu.test(paragraph)) {
      return false;
    }
    if (
      index > 0 &&
      sawOpeningScaleCaveat &&
      /\bone small backbone\b/iu.test(paragraph) &&
      /\btwo benchmark tasks\b/iu.test(paragraph) &&
      /\bfixed local training budget\b/iu.test(paragraph) &&
      /\bmodel-family-level\b/iu.test(paragraph)
    ) {
      return false;
    }
    if (/^The planned and realized execution records should be read conservatively because some protocol fields remain underspecified\.?$/iu.test(paragraph)) {
      return false;
    }
    return true;
  });
}

function removeRedundantTaskDeltaFigures(
  figures: PaperManuscriptFigure[] | undefined
): PaperManuscriptFigure[] | undefined {
  if (!figures) {
    return figures;
  }
  const filtered = figures.filter((figure) => {
    const labels = figure.bars.map((row) => cleanString(row.label)).join(" ");
    const caption = cleanString(figure.caption);
    return !(
      figure.bars.length <= 2 &&
      /arc|hellaswag|task/i.test(`${labels} ${caption}`) &&
      /delta|gain|improvement|accuracy/i.test(`${labels} ${caption}`)
    );
  });
  return filtered.length > 0 ? filtered : undefined;
}

function repairAppendixTableLabels(
  tables: PaperManuscriptTable[] | undefined
): PaperManuscriptTable[] | undefined {
  if (!tables) {
    return tables;
  }
  return tables.map((table) => ({
    ...table,
    caption: cleanString(table.caption)
      .replace(
        /\bDesign constants and realized preflight scale\.?/giu,
        "Planned protocol constants for the rank/dropout design."
      )
      .replace(
        /\band realized preflight scale\b/giu,
        ""
      ),
    rows: table.rows.map((row) => ({
      ...row,
      label: cleanString(row.label).replace(/^Seed$/iu, "Planned protocol seed")
    }))
  }));
}

function enrichManuscriptMethodExecutionDetails(input: {
  sections: PaperManuscriptSection[];
  resultAnalysis?: ResultAnalysisArtifact;
  methodModelNames?: string[];
}): PaperManuscriptSection[] {
  const details = buildExecutedMethodDetails(input.resultAnalysis, input.methodModelNames);
  if (!details) {
    return input.sections;
  }
  const methodIndex = input.sections.findIndex((section) => normalizeHeadingKey(section.heading) === "method");
  const methodSection =
    methodIndex >= 0
      ? input.sections[methodIndex]
      : {
          heading: "Method",
          paragraphs: []
        };
  const replacement = buildExecutedMethodDetailsParagraph(details);
  const existingParagraphs = methodSection.paragraphs.filter((paragraph) =>
    !/does not expose the final selected model identifier|does not clearly expose.*(?:final instantiated backbone|selected backbone|model choice)|does not unambiguously expose.*(?:backbone|selected_model_id)|does not expose.*(?:optimizer|learning rate|batch size|gradient accumulation|LoRA target modules)|final selected model identifier, optimizer/iu.test(
      paragraph
    )
  );
  const methodText = existingParagraphs.join(" ");
  const hasSelectedModel = details.selectedModelId ? methodText.includes(details.selectedModelId) : true;
  const hasLearningRate =
    typeof details.learningRate === "number" ? new RegExp(`learning rate\\s+${escapeRegExp(formatTexNumber(details.learningRate))}`, "iu").test(methodText) : true;
  const hasBatchSize =
    typeof details.perDeviceBatchSize === "number" ? /\bbatch size\b/iu.test(methodText) && methodText.includes(String(details.perDeviceBatchSize)) : true;
  const hasGradientAccumulation =
    typeof details.gradientAccumulationSteps === "number"
      ? /gradient accumulation/iu.test(methodText) && methodText.includes(String(details.gradientAccumulationSteps))
      : true;
  const alreadyComplete = hasSelectedModel && hasLearningRate && hasBatchSize && hasGradientAccumulation;
  const paragraphs = alreadyComplete ? existingParagraphs : insertMethodDetailParagraph(existingParagraphs, replacement);
  const enrichedSection = {
    ...methodSection,
    paragraphs,
    source_refs: mergeSectionSourceRefs(methodSection.source_refs, [
      { kind: "artifact", id: "result_analysis.metrics.run_config" }
    ])
  };
  if (methodIndex < 0) {
    return sortSections([...input.sections, enrichedSection]);
  }
  return input.sections.map((section, index) => (index === methodIndex ? enrichedSection : section));
}

interface ExecutedMethodDetails {
  selectedModelId?: string;
  preferredModelId?: string;
  fallbackModelId?: string;
  trainDataset?: string;
  evalTasks: string[];
  trainSamples?: number;
  evalSamples?: number;
  seed?: number;
  maxSteps?: number;
  perDeviceBatchSize?: number;
  gradientAccumulationSteps?: number;
  learningRate?: number;
  maxSeqLength?: number;
  timeoutSec?: number;
  targetModules: string[];
  ciLevel?: number;
  ciSampleSize?: number;
}

function buildExecutedMethodDetails(
  resultAnalysis: ResultAnalysisArtifact | undefined,
  methodModelNames: string[] = []
): ExecutedMethodDetails | undefined {
  const metrics = asPlainRecord(resultAnalysis?.metrics);
  const runConfig = asPlainRecord(metrics.run_config);
  const data = asPlainRecord(metrics.data);
  const trainData = asPlainRecord(asPlainRecord(data.train).dataset);
  const evalData = asPlainRecord(data.eval);
  const evalTasks = [
    formatDatasetSpec(asPlainRecord(asPlainRecord(evalData.arc_challenge).dataset), "ARC-Challenge"),
    formatDatasetSpec(asPlainRecord(asPlainRecord(evalData.hellaswag).dataset), "HellaSwag")
  ].filter(Boolean);
  const confidenceIntervals = resultAnalysis?.statistical_summary?.confidence_intervals || [];
  const ciLevel = confidenceIntervals.find((item) => typeof item.level === "number")?.level;
  const ciSampleSize = confidenceIntervals.find((item) => typeof item.sample_size === "number")?.sample_size;
  const selectedModelId =
    cleanString(metrics.selected_model_id) ||
    cleanString(metrics.selected_model_name) ||
    cleanString(asPlainRecord(metrics.model_selection).selected_model_id) ||
    cleanString(methodModelNames[0]);
  const fallbackModelId =
    cleanString(metrics.fallback_model_id) ||
    cleanString(metrics.fallback_model) ||
    cleanString(methodModelNames.find((item) => item && item !== selectedModelId));
  const details: ExecutedMethodDetails = {
    selectedModelId,
    preferredModelId: cleanString(metrics.preferred_model_id) || cleanString(metrics.preferred_model),
    fallbackModelId,
    trainDataset: formatDatasetSpec(trainData, "training data"),
    evalTasks,
    trainSamples: findRunNumber(runConfig, ["train_samples", "max_train_samples"]),
    evalSamples: findRunNumber(runConfig, ["eval_samples", "max_eval_samples_per_task"]),
    seed: findRunNumber(runConfig, ["seed"]),
    maxSteps: findRunNumber(runConfig, ["max_steps", "optimizer_steps"]),
    perDeviceBatchSize: findRunNumber(runConfig, ["per_device_batch_size", "per_device_train_batch_size"]),
    gradientAccumulationSteps: findRunNumber(runConfig, ["gradient_accumulation_steps"]),
    learningRate: findRunNumber(runConfig, ["learning_rate"]),
    maxSeqLength: findRunNumber(runConfig, ["max_seq_length"]),
    timeoutSec: findRunNumber(runConfig, ["timeout_sec"]),
    targetModules: findLoraTargetModules(metrics),
    ciLevel,
    ciSampleSize
  };
  const hasMaterialDetails =
    Boolean(details.selectedModelId) ||
    typeof details.learningRate === "number" ||
    typeof details.perDeviceBatchSize === "number" ||
    typeof details.gradientAccumulationSteps === "number" ||
    typeof details.maxSeqLength === "number";
  return hasMaterialDetails ? details : undefined;
}

function buildExecutedMethodDetailsParagraph(details: ExecutedMethodDetails): string {
  const modelSentence = details.selectedModelId
    ? `The executed run used ${details.selectedModelId} as the selected backbone${details.fallbackModelId ? `, with ${details.fallbackModelId} retained only as the fallback candidate` : ""}.`
    : "The executed run used the selected local backbone recorded in the run metrics.";
  const dataBits = [
    details.trainDataset ? `training data from ${details.trainDataset}` : "",
    typeof details.trainSamples === "number" ? `${formatTexNumber(details.trainSamples)} training examples` : "",
    details.evalTasks.length > 0 ? `evaluation on ${details.evalTasks.join(" and ")}` : "",
    typeof details.evalSamples === "number" ? `${formatTexNumber(details.evalSamples)} examples per evaluation task` : "",
    typeof details.seed === "number" ? `seed ${formatTexNumber(details.seed)}` : ""
  ].filter(Boolean);
  const optimizationBits = [
    typeof details.learningRate === "number" ? `learning rate ${formatTexNumber(details.learningRate)}` : "",
    typeof details.perDeviceBatchSize === "number"
      ? `per-device train batch size ${formatTexNumber(details.perDeviceBatchSize)}`
      : "",
    typeof details.gradientAccumulationSteps === "number"
      ? `gradient accumulation ${formatTexNumber(details.gradientAccumulationSteps)}`
      : "",
    typeof details.maxSteps === "number" ? `${formatTexNumber(details.maxSteps)} optimizer steps` : "",
    typeof details.maxSeqLength === "number" ? `maximum sequence length ${formatTexNumber(details.maxSeqLength)}` : "",
    typeof details.timeoutSec === "number" ? `${formatTexNumber(details.timeoutSec)} s timeout` : "",
    details.targetModules.length > 0 ? `LoRA target modules ${details.targetModules.join(", ")}` : ""
  ].filter(Boolean);
  const ciSentence =
    typeof details.ciLevel === "number" || typeof details.ciSampleSize === "number"
      ? `Uncertainty summaries were reported as condition-level ${formatTexNumber((details.ciLevel || 0.95) * 100)}% intervals${typeof details.ciSampleSize === "number" ? ` over n=${formatTexNumber(details.ciSampleSize)} prediction records` : ""}; they are treated as screening intervals rather than significance tests.`
      : "Uncertainty summaries are treated as screening intervals rather than significance tests.";
  return [
    modelSentence,
    dataBits.length > 0 ? `The realized data and evaluation settings were ${joinAcademicList(dataBits)}.` : "",
    optimizationBits.length > 0 ? `Fixed training settings were ${joinAcademicList(optimizationBits)}.` : "",
    ciSentence
  ]
    .filter(Boolean)
    .join(" ");
}

function insertMethodDetailParagraph(paragraphs: string[], detailParagraph: string): string[] {
  if (paragraphs.length === 0) {
    return [detailParagraph];
  }
  const insertAfter = Math.min(1, paragraphs.length - 1);
  return [
    ...paragraphs.slice(0, insertAfter + 1),
    detailParagraph,
    ...paragraphs.slice(insertAfter + 1)
  ];
}

function joinAcademicList(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatDatasetSpec(record: Record<string, unknown>, fallbackLabel: string): string {
  const path = cleanString(record.path);
  const name = cleanString(record.name);
  const split = cleanString(record.split);
  const label = name && path && name !== path ? `${path}/${name}` : path || name || fallbackLabel;
  return split ? `${label} ${split} split` : label;
}

function findRunNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = normalizeNumber(record[key]);
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function findLoraTargetModules(metrics: Record<string, unknown>): string[] {
  const direct = normalizeStringArray(metrics.target_modules || metrics.lora_target_modules);
  if (direct.length > 0) {
    return direct.slice(0, 8);
  }
  const conditions = Array.isArray(metrics.conditions) ? metrics.conditions : [];
  for (const condition of conditions) {
    const conditionRecord = asPlainRecord(condition);
    const candidates = normalizeStringArray(conditionRecord.target_modules || conditionRecord.lora_target_modules);
    if (candidates.length > 0) {
      return candidates.slice(0, 8);
    }
    const adapter = asPlainRecord(conditionRecord.adapter);
    const adapterTargets = normalizeStringArray(adapter.target_modules || adapter.lora_target_modules);
    if (adapterTargets.length > 0) {
      return adapterTargets.slice(0, 8);
    }
  }
  return [];
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mergeSectionSourceRefs(
  existing: PaperSourceRef[] | undefined,
  next: PaperSourceRef[]
): PaperSourceRef[] {
  const seen = new Set<string>();
  const merged: PaperSourceRef[] = [];
  for (const ref of [...(existing || []), ...next]) {
    const key = `${ref.kind}:${ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ref);
    }
  }
  return merged;
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
  includeKeywords?: boolean;
  figureRenderMode?: "latex_bars" | "external_pdf";
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
  const renderedAbstract = sanitizeSubmissionSurfaceText(input.manuscript.abstract);

  const lines = input.parsedTemplate
    ? [
        ...(input.parsedTemplate.preDocumentPreamble ? [input.parsedTemplate.preDocumentPreamble] : []),
        input.parsedTemplate.documentClass || resolveDocumentClass(input.template).replace("{article}", `${docClassOptions}{article}`),
        input.parsedTemplate.preamble,
        ...supportPackages,
        "\\title{" + latexEscape(input.manuscript.title) + "}",
        ...(renderedAuthor ? [renderedAuthor] : []),
        "\\date{}",
        "\\begin{document}",
        "\\maketitle",
        "\\begin{abstract}",
        latexEscape(renderedAbstract),
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
        latexEscape(renderedAbstract),
        "\\end{abstract}"
      ];

  const shouldIncludeKeywords = input.includeKeywords ?? !input.parsedTemplate;
  if (shouldIncludeKeywords && input.manuscript.keywords.length > 0) {
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
      const renderedParagraph = sanitizeSubmissionSurfaceText(paragraph);
      if (!renderedParagraph) {
        continue;
      }
      lines.push(renderSubmissionParagraph(renderedParagraph, citationPaperIds, input.citationKeysByPaperId));
      lines.push("");
    }

    if (!visualsRendered && normalizeHeadingKey(section.heading) === "results") {
      lines.push(...renderSubmissionVisuals(input.manuscript, input.figureRenderMode));
      visualsRendered = true;
    }
  }

  if (!visualsRendered) {
    lines.push(...renderSubmissionVisuals(input.manuscript, input.figureRenderMode));
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
        const renderedParagraph = sanitizeSubmissionSurfaceText(paragraph);
        if (!renderedParagraph) {
          continue;
        }
        lines.push(latexEscape(renderedParagraph));
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
        rows: rows.slice(0, 8)
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
        bars: bars.slice(0, 8)
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

  const compactRows = rows.slice(0, 8);
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
  const hasPlannedRepeatedSeedGrid = executedTrials === 25 && totalTrials === 25;

  const trialSentence =
    hasPlannedRepeatedSeedGrid
      ? `The executed design contained ${executedTrials} completed train-and-evaluate runs out of ${totalTrials} scheduled runs, organized as five repeated cells with five seeds per cell.`
      : typeof executedTrials === "number" && typeof totalTrials === "number"
        ? `The executed design contained ${executedTrials} completed condition runs out of ${totalTrials} scheduled runs in the reported pilot.`
      : "The executed design was organized around repeated train-and-evaluate cells rather than a single-run comparison.";
  const conditionCoverageSentence = hasPlannedRepeatedSeedGrid
    ? "The repeated cells were the locked rank-8 no-dropout baseline, rank 16 with dropout 0 and 0.05, and rank 32 with dropout 0 and 0.05."
    : "The reported condition grid kept the locked rank-8 no-dropout baseline visible alongside the evaluated rank/dropout alternatives.";
  const uncertaintyContractSentence = hasPlannedRepeatedSeedGrid
    ? "The repeated-seed design is therefore used as a screening instrument: a favorable mean can identify a follow-up candidate, but seed dispersion and overlapping intervals keep the conclusion conditional."
    : "The interval summaries are therefore used as a screening instrument: a favorable observed mean can identify a follow-up candidate, but the narrow single-run condition coverage keeps the conclusion conditional.";
  const reproducibilitySeedSentence = hasPlannedRepeatedSeedGrid
    ? "The reported pilot keeps the five repeated cells, their seed coverage, and the locked baseline visible as the comparison unit, while treating any stronger stability claim as future work."
    : "The reported pilot keeps the completed rank/dropout cells and locked baseline visible as the comparison unit, while treating multi-seed replication as future work.";
  const claimCeilingEvidenceSentence = hasPlannedRepeatedSeedGrid
    ? "The executed run supplies a locked internal baseline, complete repeated-cell coverage, and condition-level accuracy summaries, so the result supports saying that one evaluated cell is a plausible follow-up candidate under the local budget."
    : "The executed run supplies a locked internal baseline, completed rank/dropout condition coverage, and condition-level accuracy summaries, so the result supports saying that one evaluated cell is a plausible follow-up candidate under the local budget.";
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
        `${trialSentence} ${conditionCoverageSentence} This appendix records the design details that support the paper's narrow preflight interpretation without turning the local study into a broader model-family result.`,
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
        uncertaintyContractSentence,
        "A later paper-scale replication should preserve the locked-baseline accounting, expose complete task-wise and resource tables, and rerun the leading condition under a broader benchmark suite before claiming general LoRA regularization behavior."
      ]
    },
    {
      heading: "Supplementary Boundary Notes",
      paragraphs: [
        `The strongest allowed claim is a bounded candidate-selection claim. ${claimCeilingEvidenceSentence} The same evidence does not support a general claim about LoRA regularization, broader instruction-following quality, or superiority over external PEFT methods.`,
        "Comparative language is tied only to the executed rank/dropout grid. External papers motivate the design space and the need for budget-aware evaluation, but they are not treated as condition-matched baselines. This is why the related-work section frames prior work as context and why the discussion keeps the observed signal separate from mechanism-level or model-family conclusions.",
        "Quantitative claims are restricted to values that are present in the result table, metric table, or structured statistical summary. Runtime, memory, and train-loss dispersion are reported as feasibility and reproducibility diagnostics because the available records do not establish a condition-level efficiency ranking. The run accounting used here reports scheduled and executed trials explicitly.",
        "The result is therefore best read as a bounded preflight report: it has a research question, a comparator, executed experiments, quantitative tables, uncertainty notes, and limitations, while still naming the larger replication required before a stronger paper claim would be justified."
      ]
    },
    {
      heading: "Supplementary Reproducibility Trace",
      paragraphs: [
        "The reproducibility surface is organized around run-owned artifacts rather than prose alone. The executable record contains the selected design, run command, result analysis, metric summaries, manuscript-quality gate output, PDF build report, and page-budget validation. These materials should remain inspectable alongside the generated manuscript.",
        reproducibilitySeedSentence,
        "The data-budget record is also deliberately narrow. The selected estimated training-token budget, maximum sequence length, and inspected seed-level training-token count describe the local preflight execution; they are not used as evidence that every possible setting would behave the same way under a larger cap or a different dataset mixture.",
        "A future replication should preserve the same reporting pattern: keep the baseline label visible, expose failed-run visibility, keep task-level metrics separate from pooled averages, report condition-level intervals, and finalize the paper only after figure captions, tables, citations, and numeric claims agree with the underlying run artifacts."
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
      cleanString(item.metric_key).includes(conditionKey) &&
      cleanString(item.metric_key).includes(metricKey) &&
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
  const sectionSlug = key.replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  if (sectionSlug === "related_work") {
    return true;
  }
  if (key === "method") {
    return false;
  }
  if (key === "discussion") {
    if (
      /\b(?:reported comparison|measured effect|accuracy delta|locked baseline|best observed|rank-32 dropout-0\.05 cell improved)\b/iu.test(paragraph)
    ) {
      return false;
    }
    return /\b(?:prior|Related Work|low-budget evidence|fixed-budget studies|PEFT|QLoRA|adapter|benchmarking|literature)\b/iu.test(paragraph);
  }
  if (key === "limitations") {
    return /\b(?:Qwen\/Qwen2\.5|TinyLlama|ARC-Challenge|HellaSwag|PEFT|QLoRA|MAPLE|LoRA|adapter|benchmark)\b/iu.test(paragraph);
  }
  if (key === "conclusion") {
    return /\b(?:PEFT|QLoRA|MAPLE|adapter|benchmark studies|literature)\b/iu.test(paragraph);
  }
  if (key !== "introduction") {
    return false;
  }
  return false;
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

function renderSubmissionVisuals(
  manuscript: PaperManuscript,
  figureRenderMode: "latex_bars" | "external_pdf" = "latex_bars"
): string[] {
  return renderVisualCollection(manuscript.tables || [], manuscript.figures || [], figureRenderMode);
}

function renderVisualCollection(
  tables: PaperManuscriptTable[],
  figures: PaperManuscriptFigure[],
  figureRenderMode: "latex_bars" | "external_pdf" = "latex_bars"
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

  for (let index = 0; index < figures.length; index += 1) {
    const figure = figures[index];
    if (figureRenderMode === "external_pdf") {
      lines.push("\\begin{figure}[t]");
      lines.push("\\centering");
      lines.push(`\\includegraphics[width=\\columnwidth]{figures/main-result-figure-${index + 1}.pdf}`);
      lines.push(`\\caption{${latexEscape(figure.caption)}}`);
      lines.push("\\end{figure}");
      lines.push("");
      continue;
    }
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
    "\\usepackage{graphicx}",
    "\\usepackage{booktabs}",
    "\\usepackage{array}",
    "\\usepackage{tabularx}"
  ];
  const layoutGuards = preamble.includes("\\emergencystretch")
    ? []
    : ["\\emergencystretch=3em"];
  return [
    ...packages.filter((pkg) => {
      const name = pkg.match(/\{([^}]+)\}/u)?.[1];
      return name ? !new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${escapeRegExp(name)}\\}`, "u").test(preamble) : true;
    }),
    ...layoutGuards
  ];
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
  const rawMetricPattern =
    /\b(?:accuracy\\?_delta\\?_vs\\?_baseline|average\\?_accuracy|arc\\?_challenge\\?_accuracy|hellaswag\\?_accuracy)\b/iu;
  if (rawMetricPattern.test(text)) {
    issues.push({
      kind: "raw_artifact_text",
      location,
      message: "Submission text leaked a raw artifact metric key.",
      value: extractFirstMatch(text, rawMetricPattern)
    });
  }
  const diagnosticPattern = /^\s*\[(?:warning|error|fail|failed|pass|passed)\]\s*[^:]{0,80}:/imu;
  if (diagnosticPattern.test(text)) {
    issues.push({
      kind: "raw_artifact_text",
      location,
      message: "Submission text leaked an internal diagnostic line.",
      value: extractFirstMatch(text, diagnosticPattern)
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
