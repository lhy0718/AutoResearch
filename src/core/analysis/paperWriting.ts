import YAML from "yaml";

import { StoredCorpusRow } from "../collection/types.js";
import {
  ObjectiveMetricEvaluation,
  ObjectiveMetricProfile
} from "../objectiveMetric.js";
import { AnalysisReport, parseAnalysisReport } from "../resultAnalysis.js";
import { ConstraintProfile } from "../runConstraints.js";
import { buildBibtexEntry } from "../collection/bibtex.js";

export interface PaperSummaryArtifact {
  paper_id: string;
  title: string;
  source_type: "full_text" | "abstract";
  summary: string;
  key_findings: string[];
  limitations: string[];
  datasets: string[];
  metrics: string[];
  novelty: string;
  reproducibility_notes: string[];
}

export interface PaperEvidenceArtifact {
  evidence_id: string;
  paper_id: string;
  claim: string;
  method_slot: string;
  result_slot: string;
  limitation_slot: string;
  dataset_slot: string;
  metric_slot: string;
  evidence_span: string;
  source_type: "full_text" | "abstract";
  confidence: number;
  confidence_reason?: string;
}

export interface HypothesisArtifact {
  hypothesis_id: string;
  text: string;
  evidence_links: string[];
  rationale?: string;
  measurement_hint?: string;
}

export type ResultAnalysisArtifact = AnalysisReport;

export interface ExperimentPlanArtifact {
  selectedTitle?: string;
  selectedSummary?: string;
  rawText?: string;
}

export interface RelatedWorkScoutPaperArtifact {
  paper_id: string;
  title: string;
  summary: string;
  source_type: "semantic_scholar_scout";
  year?: number;
  venue?: string;
  citation_count?: number;
}

export interface RelatedWorkScoutArtifact {
  query: string;
  rationale: string;
  papers: RelatedWorkScoutPaperArtifact[];
}

export interface RelatedWorkNoteArtifact {
  paper_id: string;
  title: string;
  source_type: "analyzed_paper" | "semantic_scholar_scout";
  comparison_role: "closest" | "supporting" | "background";
  method_family: string;
  problem_focus: string;
  setting_focus: string;
  contribution_focus: string;
  limitation_or_caveat: string;
  relation_to_study: string;
  year?: number;
  venue?: string;
  citation_count?: number;
}

export interface RelatedWorkParagraphPlanArtifact {
  role: "taxonomy" | "comparison" | "positioning";
  focus: string;
  citation_paper_ids: string[];
}

export interface RelatedWorkBriefArtifact {
  comparison_axes: string[];
  notes: RelatedWorkNoteArtifact[];
  paragraph_plan: RelatedWorkParagraphPlanArtifact[];
}

export interface PaperWritingBundle {
  runTitle: string;
  topic: string;
  objectiveMetric: string;
  constraints: string[];
  paperSummaries: PaperSummaryArtifact[];
  evidenceRows: PaperEvidenceArtifact[];
  hypotheses: HypothesisArtifact[];
  corpus: StoredCorpusRow[];
  experimentPlan?: ExperimentPlanArtifact;
  resultAnalysis?: ResultAnalysisArtifact;
  latestResults?: Record<string, unknown>;
  relatedWorkScout?: RelatedWorkScoutArtifact;
  relatedWorkNotes?: RelatedWorkNoteArtifact[];
  reviewContext?: {
    outcome: string;
    summary: string;
    requiredActions: string[];
    topFindings: string[];
  };
  gateWarnings?: GateWarningItem[];
}

export interface GateWarningItem {
  severity: string;
  category: string;
  message: string;
  outcome?: string;
}

export interface PaperDraftParagraph {
  text: string;
  evidence_ids: string[];
  citation_paper_ids: string[];
}

export interface PaperDraftSection {
  heading: string;
  paragraphs: PaperDraftParagraph[];
  evidence_ids: string[];
  citation_paper_ids: string[];
}

export interface PaperDraftClaim {
  claim_id: string;
  statement: string;
  section_heading: string;
  evidence_ids: string[];
  citation_paper_ids: string[];
}

export interface PaperDraft {
  title: string;
  abstract: string;
  keywords: string[];
  sections: PaperDraftSection[];
  claims: PaperDraftClaim[];
}

export interface PaperDraftValidationIssue {
  kind: "section" | "paragraph" | "claim";
  severity: "warning";
  message: string;
  claim_id?: string;
  section_heading?: string;
  paragraph_index?: number;
  evidence_ids: string[];
  citation_paper_ids: string[];
}

export interface PaperDraftValidationResult {
  draft: PaperDraft;
  issues: PaperDraftValidationIssue[];
}

interface RawPaperDraft {
  title?: unknown;
  abstract?: unknown;
  keywords?: unknown;
  sections?: unknown;
  claims?: unknown;
}

interface RawPaperDraftSection {
  heading?: unknown;
  paragraphs?: unknown;
  evidence_ids?: unknown;
  citation_paper_ids?: unknown;
}

interface RawPaperDraftParagraph {
  text?: unknown;
  evidence_ids?: unknown;
  citation_paper_ids?: unknown;
}

interface RawPaperDraftClaim {
  claim_id?: unknown;
  statement?: unknown;
  section_heading?: unknown;
  evidence_ids?: unknown;
  citation_paper_ids?: unknown;
}

export const PAPER_WRITER_SYSTEM_PROMPT = [
  "You are the AutoLabOS paper writing agent.",
  "Write an evidence-grounded scientific paper draft from structured workflow artifacts.",
  "Return JSON only.",
  "Do not invent evidence IDs, paper IDs, metrics, venues, or experiment outcomes.",
  "Use only the provided evidence IDs and paper IDs.",
  "If evidence is weak or incomplete, write cautiously and say so.",
  "Cautious claim strength does not justify summary-like sections; keep each core section information-dense."
].join("\n");

export function parsePaperDraftJson(text: string): RawPaperDraft {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty_paper_draft_output");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  const candidate = fenced || extractFirstJsonObject(trimmed);
  const parsed = JSON.parse(candidate) as RawPaperDraft;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_paper_draft_json");
  }
  return parsed;
}

export function buildPaperWriterPrompt(input: {
  bundle: PaperWritingBundle;
  constraintProfile: ConstraintProfile;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
}): string {
  const allowedEvidenceIds = input.bundle.evidenceRows.map((item) => item.evidence_id);
  const allowedPaperIds = input.bundle.corpus.map((item) => item.paper_id);
  const relatedWorkBrief = buildRelatedWorkBrief(input.bundle);
  const promptPayload = {
    run: {
      title: input.bundle.runTitle,
      topic: input.bundle.topic,
      objective_metric: input.bundle.objectiveMetric,
      constraints: input.bundle.constraints
    },
    title_guidance: {
      suggested_paper_title: buildSuggestedPaperTitle(input.bundle),
      note: "Treat the workflow run title as background context only. The paper title should sound like a methods, benchmark, or empirical study title."
    },
    writing_profile: {
      target_venue: input.constraintProfile.writing.targetVenue,
      tone_hint: input.constraintProfile.writing.toneHint,
      length_hint: input.constraintProfile.writing.lengthHint
    },
    experiment_guidance: {
      design_notes: input.constraintProfile.experiment.designNotes,
      evaluation_notes: input.constraintProfile.experiment.evaluationNotes
    },
    objective_profile: {
      primary_metric: input.objectiveMetricProfile.primaryMetric,
      target_description: input.objectiveMetricProfile.targetDescription,
      paper_emphasis: input.objectiveMetricProfile.paperEmphasis
    },
    objective_evaluation: input.objectiveEvaluation
      ? {
          summary: input.objectiveEvaluation.summary,
          status: input.objectiveEvaluation.status,
          observed_value: input.objectiveEvaluation.observedValue,
          target_value: input.objectiveEvaluation.targetValue
        }
      : undefined,
    experiment_plan: {
      selected_title: input.bundle.experimentPlan?.selectedTitle,
      selected_summary: input.bundle.experimentPlan?.selectedSummary,
      excerpt: truncateText(input.bundle.experimentPlan?.rawText || "", 1400)
    },
    result_analysis: input.bundle.resultAnalysis || undefined,
    detailed_results:
      input.bundle.latestResults && typeof input.bundle.latestResults === "object"
        ? {
            protocol: (() => {
              const protocol = (input.bundle.latestResults as Record<string, unknown>).protocol;
              if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) {
                return undefined;
              }
              const protocolRecord = protocol as Record<string, unknown>;
              return {
                datasets: Array.isArray(protocolRecord.datasets)
                  ? (protocolRecord.datasets as unknown[])
                      .map((item) => cleanString(item))
                      .filter(Boolean)
                      .slice(0, 6)
                  : undefined,
                models: Array.isArray(protocolRecord.models)
                  ? (protocolRecord.models as unknown[])
                      .map((item) => cleanString(item))
                      .filter(Boolean)
                      .slice(0, 6)
                  : undefined,
                workflows: Array.isArray(protocolRecord.workflows)
                  ? (protocolRecord.workflows as unknown[])
                      .map((item) => cleanString(item))
                      .filter(Boolean)
                      .slice(0, 4)
                  : undefined,
                repeats:
                  typeof protocolRecord.repeats === "number" && Number.isFinite(protocolRecord.repeats)
                    ? protocolRecord.repeats
                    : undefined
              };
            })(),
            repeat_record_count: Array.isArray((input.bundle.latestResults as Record<string, unknown>).repeat_records)
              ? ((input.bundle.latestResults as Record<string, unknown>).repeat_records as unknown[]).length
              : undefined,
            dataset_summaries: Array.isArray((input.bundle.latestResults as Record<string, unknown>).dataset_summaries)
              ? ((input.bundle.latestResults as Record<string, unknown>).dataset_summaries as Array<Record<string, unknown>>)
                  .slice(0, 4)
                  .map((item) => ({
                    dataset: cleanString(item.dataset),
                    workflows: Object.keys(
                      item.workflows && typeof item.workflows === "object" && !Array.isArray(item.workflows)
                        ? (item.workflows as Record<string, unknown>)
                        : {}
                    ),
                    models: Object.keys(
                      item.models && typeof item.models === "object" && !Array.isArray(item.models)
                        ? (item.models as Record<string, unknown>)
                        : {}
                    )
                  }))
              : undefined
          }
        : undefined,
    review_context: input.bundle.reviewContext
      ? {
          outcome: input.bundle.reviewContext.outcome,
          summary: input.bundle.reviewContext.summary,
          required_actions: input.bundle.reviewContext.requiredActions.slice(0, 4),
          top_findings: input.bundle.reviewContext.topFindings.slice(0, 4)
        }
      : undefined,
    related_work_scout: input.bundle.relatedWorkScout
      ? {
          query: input.bundle.relatedWorkScout.query,
          rationale: input.bundle.relatedWorkScout.rationale,
          papers: input.bundle.relatedWorkScout.papers.slice(0, 6).map((item) => ({
            paper_id: item.paper_id,
            title: item.title,
            summary: truncateText(item.summary, 220),
            year: item.year,
            venue: item.venue,
            citation_count: item.citation_count
          }))
        }
      : undefined,
    related_work_brief:
      relatedWorkBrief.notes.length > 0
        ? {
            comparison_axes: relatedWorkBrief.comparison_axes,
            paragraph_plan: relatedWorkBrief.paragraph_plan,
            notes: relatedWorkBrief.notes.slice(0, 8).map((item) => ({
              paper_id: item.paper_id,
              title: item.title,
              source_type: item.source_type,
              comparison_role: item.comparison_role,
              method_family: item.method_family,
              problem_focus: item.problem_focus,
              setting_focus: item.setting_focus,
              contribution_focus: item.contribution_focus,
              limitation_or_caveat: item.limitation_or_caveat,
              relation_to_study: item.relation_to_study,
              year: item.year,
              venue: item.venue,
              citation_count: item.citation_count
            }))
          }
        : undefined,
    analyzed_papers: input.bundle.paperSummaries.slice(0, 6).map((item) => ({
      paper_id: item.paper_id,
      title: item.title,
      summary: truncateText(item.summary, 240),
      key_findings: item.key_findings.slice(0, 3),
      limitations: item.limitations.slice(0, 2),
      metrics: item.metrics.slice(0, 3),
      novelty: truncateText(item.novelty, 160),
      reproducibility_notes: item.reproducibility_notes.slice(0, 2)
    })),
    hypotheses: input.bundle.hypotheses.slice(0, 4).map((item) => ({
      hypothesis_id: item.hypothesis_id,
      text: truncateText(item.text, 220),
      evidence_links: item.evidence_links.slice(0, 4),
      rationale: truncateText(item.rationale || "", 160),
      measurement_hint: truncateText(item.measurement_hint || "", 160)
    })),
    evidence_bank: input.bundle.evidenceRows
      .slice()
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 14)
      .map((item) => ({
        evidence_id: item.evidence_id,
        paper_id: item.paper_id,
        claim: truncateText(item.claim, 180),
        result_slot: truncateText(item.result_slot, 180),
        metric_slot: truncateText(item.metric_slot, 120),
        evidence_span: truncateText(item.evidence_span, 220),
        confidence: item.confidence,
        confidence_reason: truncateText(item.confidence_reason || "", 160)
      })),
    allowed_ids: {
      paper_ids: allowedPaperIds,
      evidence_ids: allowedEvidenceIds
    }
  };

  return [
    "Return one JSON object with this shape:",
    "{",
    '  "title": "string",',
    '  "abstract": "string",',
    '  "keywords": ["string"],',
    '  "sections": [',
    "    {",
    '      "heading": "string",',
    '      "paragraphs": [',
    "        {",
    '          "text": "string",',
    '          "evidence_ids": ["ev_x"],',
    '          "citation_paper_ids": ["paper_x"]',
    "        }",
    "      ],",
    '      "evidence_ids": ["ev_x"],',
    '      "citation_paper_ids": ["paper_x"]',
    "    }",
    "  ],",
    '  "claims": [',
    "    {",
    '      "claim_id": "c1",',
    '      "statement": "string",',
    '      "section_heading": "string",',
    '      "evidence_ids": ["ev_x"],',
    '      "citation_paper_ids": ["paper_x"]',
    "    }",
    "  ]",
    "}",
    "",
    "Requirements:",
    "- Choose a paper title that reads like an academic methods, benchmark, or empirical study title.",
    "- Do not copy the workflow run title verbatim or with only cosmetic edits.",
    "- Prefer a title centered on the selected design, method, comparison, or study framing when available.",
    "- Write 6 to 7 sections in this general order: Introduction, Related Work, Method, Results, Discussion, Limitations, Conclusion.",
    "- Introduction, Related Work, Method, Results, and Discussion must not collapse into one-liners.",
    "- Target at least 2 paragraphs for Introduction, Related Work, and Discussion; at least 3 paragraphs for Method; at least 4 paragraphs for Results when the payload supports it.",
    "- Each paragraph must carry the evidence_ids and/or citation_paper_ids that support that paragraph.",
    "- Section-level evidence_ids and citation_paper_ids should summarize the union of the paragraph-level grounding.",
    "- Results must mention the objective metric, the observed outcome when available, dataset-level analysis, uncertainty or CI if available, and runtime or memory discussion when available.",
    "- Method must describe datasets, protocol, metrics, and reproducibility-relevant setup when those details exist in the payload.",
    "- If evidence is weak, weaken the claim language instead of shortening the section.",
    "- Use only provided paper_ids and evidence_ids.",
    "- When related_work_brief has at least 3 notes, write Related Work as two paragraphs: one taxonomy/comparison paragraph and one positioning paragraph.",
    "- Use the related_work_brief comparison axes to compare strands of prior work instead of listing paper titles one by one.",
    "- Each Related Work paragraph should cite at least 2 papers when that many relevant notes are available.",
    "- The last Related Work paragraph should explicitly position the current study against the closest prior work or gaps.",
    "- Related-work scout papers may be cited conservatively for broad literature framing, especially in Related Work.",
    "- Do not treat related-work scout papers as direct experimental evidence unless they also appear in analyzed_papers or the evidence bank.",
    "- Keep core logic in the main paper; reserve only supporting detail such as repeat-level raw metrics, search-space grids, or environment dumps for appendix-style routing handled downstream.",
    "- Keep claims aligned with cited papers and evidence IDs.",
    "- If a section has no direct evidence, keep it conservative and omit unsupported claims.",
    "",
    "Context JSON:",
    JSON.stringify(promptPayload, null, 2)
  ].join("\n");
}

export function normalizePaperDraft(input: {
  raw?: RawPaperDraft;
  bundle: PaperWritingBundle;
}): PaperDraft {
  const fallback = buildFallbackPaperDraft(input.bundle);
  const evidenceIds = new Set(input.bundle.evidenceRows.map((item) => item.evidence_id));
  const paperIds = new Set(input.bundle.corpus.map((item) => item.paper_id));
  const evidenceToPaper = new Map(
    input.bundle.evidenceRows.map((item) => [item.evidence_id, item.paper_id] as const)
  );

  const raw = input.raw;
  const normalizedSections = normalizeSections(
    Array.isArray(raw?.sections) ? (raw?.sections as RawPaperDraftSection[]) : [],
    evidenceIds,
    paperIds,
    evidenceToPaper
  );
  const sections = normalizedSections.length > 0 ? normalizedSections : fallback.sections;
  const claims = normalizeClaims(
    Array.isArray(raw?.claims) ? (raw?.claims as RawPaperDraftClaim[]) : [],
    sections,
    evidenceIds,
    paperIds,
    evidenceToPaper
  );

  return {
    title: choosePaperTitle({
      candidateTitle: raw?.title,
      runTitle: input.bundle.runTitle,
      fallbackTitle: fallback.title
    }),
    abstract: cleanString(raw?.abstract) || fallback.abstract,
    keywords:
      normalizeStringArray(raw?.keywords).slice(0, 6).length > 0
        ? normalizeStringArray(raw?.keywords).slice(0, 6)
        : fallback.keywords,
    sections,
    claims: claims.length > 0 ? claims : fallback.claims
  };
}

export function buildFallbackPaperDraft(bundle: PaperWritingBundle): PaperDraft {
  const topEvidence = bundle.evidenceRows
    .slice()
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 4);
  const relatedWorkBrief = buildRelatedWorkBrief(bundle);
  const citedPaperIds = uniqueStrings(
    [
      ...bundle.paperSummaries.slice(0, 4).map((item) => item.paper_id),
      ...topEvidence.map((item) => item.paper_id)
    ].filter(Boolean)
  );
  const introductionParagraph = [
    `This draft studies ${bundle.topic}.`,
    bundle.paperSummaries.length > 0
      ? `It synthesizes ${bundle.paperSummaries.length} analyzed paper summaries and ${bundle.evidenceRows.length} extracted evidence items.`
      : "It is grounded in the configured research workflow outputs.",
    bundle.constraints.length > 0
      ? `The writing is scoped by these constraints: ${bundle.constraints.join(", ")}.`
      : ""
  ].filter(Boolean).join(" ");
  const fallbackRelatedWorkSection = buildFallbackRelatedWorkSection(
    bundle,
    relatedWorkBrief,
    topEvidence.slice(0, 2).map((item) => item.evidence_id)
  );
  const methodParagraph = [
    bundle.experimentPlan?.selectedSummary
      ? `The selected experimental design is ${bundle.experimentPlan.selectedTitle || "the current plan"}: ${bundle.experimentPlan.selectedSummary}.`
      : "The method section is based on the current experiment plan and implementation artifacts.",
    bundle.hypotheses.length > 0
      ? `Key hypothesis focus: ${bundle.hypotheses[0]?.text}.`
      : ""
  ].filter(Boolean).join(" ");
  const resultsParagraph = [
    `Primary objective: ${describeObjectiveMetricForNarrative(bundle.objectiveMetric)}.`,
    bundle.resultAnalysis?.objective_metric?.evaluation?.summary ||
      "Results are summarized from the latest experiment outputs.",
    typeof bundle.resultAnalysis?.mean_score === "number"
      ? `Mean numeric score across reported metrics is ${bundle.resultAnalysis.mean_score}.`
      : ""
  ].filter(Boolean).join(" ");
  const conclusionParagraph =
    "The current workflow provides a traceable draft tied to collected literature, generated hypotheses, and experimental evidence.";

  const sections: PaperDraftSection[] = [
    {
      heading: "Introduction",
      paragraphs: [
        buildDraftParagraph(
          introductionParagraph,
          topEvidence.slice(0, 2).map((item) => item.evidence_id),
          citedPaperIds.slice(0, 2)
        )
      ],
      evidence_ids: topEvidence.slice(0, 2).map((item) => item.evidence_id),
      citation_paper_ids: citedPaperIds.slice(0, 2)
    },
    {
      heading: "Related Work",
      paragraphs: fallbackRelatedWorkSection.paragraphs,
      evidence_ids: fallbackRelatedWorkSection.evidence_ids,
      citation_paper_ids: fallbackRelatedWorkSection.citation_paper_ids
    },
    {
      heading: "Method",
      paragraphs: [
        buildDraftParagraph(
          methodParagraph,
          bundle.hypotheses[0]?.evidence_links?.slice(0, 3) || topEvidence.slice(0, 2).map((item) => item.evidence_id),
          uniqueStrings([
            ...(bundle.hypotheses[0]?.evidence_links || [])
              .map((item) => bundle.evidenceRows.find((row) => row.evidence_id === item)?.paper_id || ""),
            ...citedPaperIds.slice(0, 2)
          ]).filter(Boolean)
        )
      ],
      evidence_ids: bundle.hypotheses[0]?.evidence_links?.slice(0, 3) || topEvidence.slice(0, 2).map((item) => item.evidence_id),
      citation_paper_ids: uniqueStrings([
        ...(bundle.hypotheses[0]?.evidence_links || [])
          .map((item) => bundle.evidenceRows.find((row) => row.evidence_id === item)?.paper_id || ""),
        ...citedPaperIds.slice(0, 2)
      ]).filter(Boolean)
    },
    {
      heading: "Results",
      paragraphs: [
        buildDraftParagraph(
          resultsParagraph,
          topEvidence.slice(0, 3).map((item) => item.evidence_id),
          uniqueStrings(topEvidence.map((item) => item.paper_id)).slice(0, 3)
        )
      ],
      evidence_ids: topEvidence.slice(0, 3).map((item) => item.evidence_id),
      citation_paper_ids: uniqueStrings(topEvidence.map((item) => item.paper_id)).slice(0, 3)
    },
    {
      heading: "Conclusion",
      paragraphs: [
        buildDraftParagraph(
          conclusionParagraph,
          topEvidence.slice(0, 2).map((item) => item.evidence_id),
          citedPaperIds.slice(0, 2)
        )
      ],
      evidence_ids: topEvidence.slice(0, 2).map((item) => item.evidence_id),
      citation_paper_ids: citedPaperIds.slice(0, 2)
    }
  ];

  return {
    title: buildSuggestedPaperTitle(bundle),
    abstract: [
      `We study ${bundle.topic}.`,
      `The draft integrates literature analysis, hypothesis generation, experiment design, and experimental results around the objective metric ${describeObjectiveMetricForNarrative(bundle.objectiveMetric)}.`,
      bundle.resultAnalysis?.objective_metric?.evaluation?.summary || ""
    ].filter(Boolean).join(" "),
    keywords: uniqueStrings([
      bundle.topic,
      bundle.objectiveMetric,
      bundle.experimentPlan?.selectedTitle || ""
    ]).slice(0, 5),
    sections,
    claims: sections.map((section, index) => ({
      claim_id: `c${index + 1}`,
      statement: firstSentence(getParagraphText(section.paragraphs[0])) || `${section.heading} summary.`,
      section_heading: section.heading,
      evidence_ids: section.evidence_ids,
      citation_paper_ids: section.citation_paper_ids
    }))
  };
}

export function validatePaperDraft(input: {
  draft: PaperDraft;
  bundle: PaperWritingBundle;
}): PaperDraftValidationResult {
  const evidenceById = new Map(
    input.bundle.evidenceRows.map((item) => [item.evidence_id, item] as const)
  );
  const validPaperIds = new Set(input.bundle.corpus.map((item) => item.paper_id));
  const issues: PaperDraftValidationIssue[] = [];

  const normalizedSections = input.draft.sections.map((section) => {
    const sectionEvidenceIds = uniqueStrings(section.evidence_ids.filter((item) => evidenceById.has(item))).slice(0, 6);
    const sectionExplicitCitations = uniqueStrings(
      section.citation_paper_ids.filter((item) => validPaperIds.has(item))
    ).slice(0, 6);
    const sectionInferredCitations = inferCitationPaperIds(sectionEvidenceIds, evidenceById, validPaperIds);
    const normalizedSectionCitations = uniqueStrings([...sectionExplicitCitations, ...sectionInferredCitations]).slice(0, 6);

    const paragraphs = section.paragraphs
      .slice(0, 6)
      .map((paragraph, index) => {
        let evidenceIds = uniqueStrings(paragraph.evidence_ids.filter((item) => evidenceById.has(item))).slice(0, 4);
        let citationPaperIds = uniqueStrings(
          paragraph.citation_paper_ids.filter((item) => validPaperIds.has(item))
        ).slice(0, 4);

        if (evidenceIds.length === 0 && sectionEvidenceIds.length > 0) {
          evidenceIds = sectionEvidenceIds.slice(0, 4);
          issues.push({
            kind: "paragraph",
            severity: "warning",
            message: "Paragraph borrowed evidence anchors from its section because no direct paragraph evidence remained after validation.",
            section_heading: section.heading,
            paragraph_index: index,
            evidence_ids: evidenceIds,
            citation_paper_ids: normalizedSectionCitations.slice(0, 4)
          });
        }

        const inferredCitations = inferCitationPaperIds(evidenceIds, evidenceById, validPaperIds);
        if (citationPaperIds.length === 0 && normalizedSectionCitations.length > 0) {
          citationPaperIds = normalizedSectionCitations.slice(0, 4);
          issues.push({
            kind: "paragraph",
            severity: "warning",
            message: "Paragraph borrowed citations from its section because no direct paragraph citations remained after validation.",
            section_heading: section.heading,
            paragraph_index: index,
            evidence_ids: evidenceIds,
            citation_paper_ids: citationPaperIds
          });
        }
        citationPaperIds = uniqueStrings([...citationPaperIds, ...inferredCitations]).slice(0, 4);

        let text = cleanString(paragraph.text);
        if (!text) {
          return undefined;
        }
        if (evidenceIds.length === 0 && citationPaperIds.length === 0 && isEvidenceSensitiveSection(section.heading)) {
          issues.push({
            kind: "paragraph",
            severity: "warning",
            message: "Paragraph has no retained evidence or citations after validation; keep its language conservative.",
            section_heading: section.heading,
            paragraph_index: index,
            evidence_ids: [],
            citation_paper_ids: []
          });
          text = ensureConservativeParagraphText(text);
        }

        return {
          text,
          evidence_ids: evidenceIds,
          citation_paper_ids: citationPaperIds
        };
      })
      .filter((item): item is PaperDraftParagraph => Boolean(item));

    const evidenceIds = uniqueStrings([
      ...sectionEvidenceIds,
      ...paragraphs.flatMap((item) => item.evidence_ids)
    ]).slice(0, 6);
    const citationPaperIds = uniqueStrings([
      ...normalizedSectionCitations,
      ...paragraphs.flatMap((item) => item.citation_paper_ids)
    ]).slice(0, 6);

    if (evidenceIds.length === 0 && citationPaperIds.length === 0 && isEvidenceSensitiveSection(section.heading)) {
      issues.push({
        kind: "section",
        severity: "warning",
        message: "Section has no retained evidence or citations after validation; keep its language conservative.",
        section_heading: section.heading,
        evidence_ids: [],
        citation_paper_ids: []
      });
      if (!paragraphs.some((item) => /direct supporting evidence is currently limited/i.test(item.text))) {
        paragraphs.push(
          buildDraftParagraph(
            "This section is written conservatively because direct supporting evidence is currently limited.",
            [],
            []
          )
        );
      }
    }

    return {
      heading: section.heading,
      paragraphs,
      evidence_ids: evidenceIds,
      citation_paper_ids: citationPaperIds
    };
  });

  const sections = applyRelatedWorkQualityControls({
    sections: normalizedSections,
    bundle: input.bundle,
    issues
  });

  const sectionByHeading = new Map(
    sections.map((section) => [normalizeHeadingKey(section.heading), section] as const)
  );

  const claims = input.draft.claims.map((claim) => {
    const claimId = cleanString(claim.claim_id) || "claim";
    const sectionHeading = cleanString(claim.section_heading) || "Results";
    const section = sectionByHeading.get(normalizeHeadingKey(sectionHeading));
    let evidenceIds = uniqueStrings(claim.evidence_ids.filter((item) => evidenceById.has(item))).slice(0, 6);
    let citationPaperIds = uniqueStrings(
      claim.citation_paper_ids.filter((item) => validPaperIds.has(item))
    ).slice(0, 6);

    if (evidenceIds.length === 0 && section?.evidence_ids.length) {
      evidenceIds = section.evidence_ids.slice(0, 4);
      issues.push({
        kind: "claim",
        severity: "warning",
        message: "Claim borrowed evidence anchors from its section because direct claim evidence was missing or invalid.",
        claim_id: claimId,
        section_heading: sectionHeading,
        evidence_ids: evidenceIds,
        citation_paper_ids: section.citation_paper_ids
      });
    }

    const inferredCitations = inferCitationPaperIds(evidenceIds, evidenceById, validPaperIds);
    if (citationPaperIds.length === 0 && section?.citation_paper_ids.length) {
      citationPaperIds = section.citation_paper_ids.slice(0, 4);
    }
    citationPaperIds = uniqueStrings([...citationPaperIds, ...inferredCitations]).slice(0, 6);

    const evidenceSupport = evidenceIds
      .map((item) => evidenceById.get(item))
      .filter((item): item is PaperEvidenceArtifact => Boolean(item));
    const maxConfidence = evidenceSupport.reduce((best, item) => Math.max(best, item.confidence), 0);
    let statement = cleanString(claim.statement);

    if (!statement) {
      statement = section ? firstSentence(getParagraphText(section.paragraphs[0])) : "Tentative claim";
    }

    if (evidenceIds.length === 0) {
      const weakened = weakenClaimStatement(statement, "unsupported");
      if (weakened !== statement) {
        issues.push({
          kind: "claim",
          severity: "warning",
          message: "Claim was weakened because no direct supporting evidence remained after validation.",
          claim_id: claimId,
          section_heading: sectionHeading,
          evidence_ids: evidenceIds,
          citation_paper_ids: citationPaperIds
        });
        statement = weakened;
      }
    } else if (maxConfidence < 0.6) {
      const weakened = weakenClaimStatement(statement, "low_confidence");
      if (weakened !== statement) {
        issues.push({
          kind: "claim",
          severity: "warning",
          message: "Claim was weakened because its strongest linked evidence had low confidence.",
          claim_id: claimId,
          section_heading: sectionHeading,
          evidence_ids: evidenceIds,
          citation_paper_ids: citationPaperIds
        });
        statement = weakened;
      }
    }

    return {
      claim_id: claimId,
      statement,
      section_heading: section?.heading || sectionHeading,
      evidence_ids: evidenceIds,
      citation_paper_ids: citationPaperIds
    };
  });

  return {
    draft: {
      ...input.draft,
      sections,
      claims
    },
    issues
  };
}

export function buildPaperEvidenceMap(draft: PaperDraft): {
  sections: Array<{
    heading: string;
    paragraphs: Array<{
      paragraph_index: number;
      text: string;
      evidence_ids: string[];
      citation_paper_ids: string[];
    }>;
  }>;
  claims: PaperDraftClaim[];
} {
  return {
    sections: draft.sections.map((section) => ({
      heading: section.heading,
      paragraphs: section.paragraphs.map((paragraph, index) => ({
        paragraph_index: index,
        text: paragraph.text,
        evidence_ids: paragraph.evidence_ids,
        citation_paper_ids: paragraph.citation_paper_ids
      }))
    })),
    claims: draft.claims.map((item) => ({
      claim_id: item.claim_id,
      statement: item.statement,
      section_heading: item.section_heading,
      evidence_ids: item.evidence_ids,
      citation_paper_ids: item.citation_paper_ids
    }))
  };
}

export function buildRelatedWorkNotes(bundle: PaperWritingBundle): RelatedWorkNoteArtifact[] {
  if (bundle.relatedWorkNotes && bundle.relatedWorkNotes.length > 0) {
    return uniqueRelatedWorkNotes(bundle.relatedWorkNotes).slice(0, 8);
  }

  const corpusById = new Map(bundle.corpus.map((item) => [item.paper_id, item] as const));
  const studyKeywords = extractRelatedWorkKeywords([
    bundle.topic,
    bundle.objectiveMetric,
    bundle.experimentPlan?.selectedTitle,
    bundle.experimentPlan?.selectedSummary,
    ...bundle.hypotheses.slice(0, 3).map((item) => item.text),
    ...bundle.hypotheses.slice(0, 3).map((item) => item.measurement_hint || "")
  ]);
  const ranked: Array<RelatedWorkNoteArtifact & { _score: number; _sourceRank: number }> = [];

  for (const summary of bundle.paperSummaries) {
    const corpusRow = corpusById.get(summary.paper_id);
    const combinedText = [
      summary.title,
      summary.summary,
      summary.novelty,
      ...summary.key_findings,
      ...summary.datasets,
      ...summary.metrics
    ].join(" ");
    const score = scoreRelatedWorkMatch(studyKeywords, combinedText);
    ranked.push({
      paper_id: summary.paper_id,
      title: summary.title,
      source_type: "analyzed_paper",
      comparison_role: classifyRelatedWorkRole(score, true),
      method_family: inferMethodFamily(combinedText),
      problem_focus: truncateText(firstSentence(summary.summary) || summary.title, 180),
      setting_focus: buildSettingFocus(summary.datasets, summary.metrics, corpusRow),
      contribution_focus: truncateText(
        summary.novelty || summary.key_findings[0] || firstSentence(summary.summary) || summary.title,
        180
      ),
      limitation_or_caveat: truncateText(
        summary.limitations[0]
          || summary.reproducibility_notes[0]
          || "The available summary exposes only part of the experimental scope.",
        180
      ),
      relation_to_study: describeRelationToStudy(score, true),
      year: corpusRow?.year,
      venue: cleanString(corpusRow?.venue),
      citation_count: corpusRow?.citation_count,
      _score: score,
      _sourceRank: 0
    });
  }

  for (const scout of bundle.relatedWorkScout?.papers || []) {
    const combinedText = [scout.title, scout.summary].join(" ");
    const score = scoreRelatedWorkMatch(studyKeywords, combinedText);
    ranked.push({
      paper_id: scout.paper_id,
      title: scout.title,
      source_type: "semantic_scholar_scout",
      comparison_role: classifyRelatedWorkRole(score, false),
      method_family: inferMethodFamily(combinedText),
      problem_focus: truncateText(firstSentence(scout.summary) || scout.title, 180),
      setting_focus: buildSettingFocus([], [], {
        paper_id: scout.paper_id,
        title: scout.title,
        venue: scout.venue,
        year: scout.year
      } as StoredCorpusRow),
      contribution_focus: truncateText(firstSentence(scout.summary) || scout.title, 180),
      limitation_or_caveat:
        "Only scout-level metadata is available, so this paper should provide broad framing rather than detailed claim matching.",
      relation_to_study: describeRelationToStudy(score, false),
      year: scout.year,
      venue: scout.venue,
      citation_count: scout.citation_count,
      _score: score,
      _sourceRank: 1
    });
  }

  return uniqueRelatedWorkNotes(
    ranked
      .sort((left, right) => {
        if (left._score !== right._score) {
          return right._score - left._score;
        }
        if (left.comparison_role !== right.comparison_role) {
          return compareRelatedWorkRole(left.comparison_role, right.comparison_role);
        }
        if (left._sourceRank !== right._sourceRank) {
          return left._sourceRank - right._sourceRank;
        }
        if ((left.citation_count || 0) !== (right.citation_count || 0)) {
          return (right.citation_count || 0) - (left.citation_count || 0);
        }
        return (right.year || 0) - (left.year || 0);
      })
      .map(({ _score: _ignoredScore, _sourceRank: _ignoredSourceRank, ...note }) => note)
  ).slice(0, 8);
}

export function buildRelatedWorkBrief(bundle: PaperWritingBundle): RelatedWorkBriefArtifact {
  const notes = buildRelatedWorkNotes(bundle);
  const methodFamilies = uniqueStrings(notes.map((item) => item.method_family)).slice(0, 3);
  const settingFocuses = uniqueStrings(
    notes
      .map((item) => item.setting_focus)
      .filter((item) => item && !/^venue context/i.test(item))
  ).slice(0, 3);
  const comparisonAxes = uniqueStrings(
    [
      methodFamilies.length > 1 ? `method families such as ${joinHumanList(methodFamilies)}` : "",
      settingFocuses.length > 1 ? `evaluation settings such as ${joinHumanList(settingFocuses)}` : "",
      notes.some((item) => item.comparison_role === "closest")
        ? "closest baselines versus broader framing papers"
        : "",
      notes.some((item) => item.limitation_or_caveat)
        ? "reported limitations and remaining coverage gaps"
        : ""
    ].filter(Boolean)
  ).slice(0, 3);

  const taxonomyCitations = notes
    .filter((item) => item.comparison_role !== "background")
    .slice(0, 4)
    .map((item) => item.paper_id);
  const positioningNotes = selectPositioningNotes(notes).slice(0, 3);
  const paragraphPlan: RelatedWorkParagraphPlanArtifact[] = [];
  if (notes.length > 0) {
    paragraphPlan.push({
      role: "taxonomy",
      focus:
        comparisonAxes[0]
        || `Organize prior work around ${joinHumanList(methodFamilies.length > 0 ? methodFamilies : notes.slice(0, 2).map((item) => item.method_family))}.`,
      citation_paper_ids: taxonomyCitations.length > 0 ? taxonomyCitations : notes.slice(0, 3).map((item) => item.paper_id)
    });
  }
  if (notes.length >= 3) {
    paragraphPlan.push({
      role: "positioning",
      focus:
        positioningNotes.length > 0
          ? `Position the current study against ${joinHumanList(positioningNotes.map((item) => item.title))}.`
          : "Explain how the current study differs from the closest prior work.",
      citation_paper_ids:
        positioningNotes.length > 0
          ? positioningNotes.map((item) => item.paper_id)
          : notes.slice(0, 3).map((item) => item.paper_id)
    });
  }

  return {
    comparison_axes: comparisonAxes.length > 0 ? comparisonAxes : ["problem framing and evaluation scope"],
    notes,
    paragraph_plan: paragraphPlan
  };
}

function applyRelatedWorkQualityControls(input: {
  sections: PaperDraftSection[];
  bundle: PaperWritingBundle;
  issues: PaperDraftValidationIssue[];
}): PaperDraftSection[] {
  const brief = buildRelatedWorkBrief(input.bundle);
  if (brief.notes.length < 3) {
    return input.sections;
  }

  const fallbackSection = buildFallbackRelatedWorkSection(
    input.bundle,
    brief,
    input.bundle.evidenceRows
      .slice()
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 2)
      .map((item) => item.evidence_id)
  );
  const relatedIndex = input.sections.findIndex((section) => isRelatedWorkHeading(section.heading));
  if (relatedIndex < 0) {
    input.issues.push({
      kind: "section",
      severity: "warning",
      message: "Related Work section was reconstructed from related-work notes because the draft omitted it.",
      section_heading: fallbackSection.heading,
      evidence_ids: fallbackSection.evidence_ids,
      citation_paper_ids: fallbackSection.citation_paper_ids
    });
    return [...input.sections, fallbackSection];
  }

  const sections = [...input.sections];
  const relatedSection = sections[relatedIndex];
  let paragraphs = relatedSection.paragraphs.map((item) => ({ ...item }));
  if (paragraphs.length === 0) {
    paragraphs = fallbackSection.paragraphs;
    input.issues.push({
      kind: "section",
      severity: "warning",
      message: "Related Work section was rebuilt from related-work notes because it had no usable paragraphs.",
      section_heading: relatedSection.heading,
      evidence_ids: fallbackSection.evidence_ids,
      citation_paper_ids: fallbackSection.citation_paper_ids
    });
  } else if (paragraphs.length < fallbackSection.paragraphs.length) {
    paragraphs = [...paragraphs, ...fallbackSection.paragraphs.slice(paragraphs.length)];
    input.issues.push({
      kind: "section",
      severity: "warning",
      message: "Related Work gained a positioning paragraph because enough literature was available to compare strands and position the current study.",
      section_heading: relatedSection.heading,
      evidence_ids: relatedSection.evidence_ids,
      citation_paper_ids: fallbackSection.citation_paper_ids
    });
  }

  const fallbackCitationIds = fallbackSection.citation_paper_ids;
  paragraphs = paragraphs.map((paragraph, index) => {
    let text = cleanString(paragraph.text);
    let citationPaperIds = uniqueStrings(paragraph.citation_paper_ids);
    if (fallbackCitationIds.length >= 2 && citationPaperIds.length < 2) {
      citationPaperIds = uniqueStrings([
        ...citationPaperIds,
        ...(index === paragraphs.length - 1 && fallbackSection.paragraphs[index]
          ? fallbackSection.paragraphs[index].citation_paper_ids
          : fallbackCitationIds)
      ]).slice(0, 4);
      input.issues.push({
        kind: "paragraph",
        severity: "warning",
        message: "Related Work paragraph citations were expanded to support comparison instead of a single-paper mention.",
        section_heading: relatedSection.heading,
        paragraph_index: index,
        evidence_ids: paragraph.evidence_ids,
        citation_paper_ids: citationPaperIds
      });
    }

    if (!hasComparisonLanguage(text)) {
      text = `${stripTrailingPunctuation(text)}. Across prior work, the clearest contrasts concern ${brief.comparison_axes[0]}.`;
      input.issues.push({
        kind: "paragraph",
        severity: "warning",
        message: "Related Work paragraph was sharpened with an explicit comparison axis.",
        section_heading: relatedSection.heading,
        paragraph_index: index,
        evidence_ids: paragraph.evidence_ids,
        citation_paper_ids: citationPaperIds
      });
    }

    if (index === paragraphs.length - 1 && !hasPositioningLanguage(text)) {
      text = `${stripTrailingPunctuation(text)}. The current study uses these baselines to position ${cleanString(input.bundle.topic) || "the present study"} around ${describeObjectiveMetricForNarrative(input.bundle.objectiveMetric)}.`;
      input.issues.push({
        kind: "paragraph",
        severity: "warning",
        message: "Related Work paragraph was extended with explicit study positioning.",
        section_heading: relatedSection.heading,
        paragraph_index: index,
        evidence_ids: paragraph.evidence_ids,
        citation_paper_ids: citationPaperIds
      });
    }

    return {
      text,
      evidence_ids: paragraph.evidence_ids.length > 0 ? paragraph.evidence_ids : fallbackSection.evidence_ids,
      citation_paper_ids: citationPaperIds
    };
  });

  sections[relatedIndex] = {
    ...relatedSection,
    paragraphs,
    evidence_ids: uniqueStrings([
      ...relatedSection.evidence_ids,
      ...paragraphs.flatMap((item) => item.evidence_ids),
      ...fallbackSection.evidence_ids
    ]).slice(0, 6),
    citation_paper_ids: uniqueStrings([
      ...relatedSection.citation_paper_ids,
      ...paragraphs.flatMap((item) => item.citation_paper_ids),
      ...fallbackSection.citation_paper_ids
    ]).slice(0, 6)
  };
  return sections;
}

function buildFallbackRelatedWorkSection(
  bundle: PaperWritingBundle,
  brief: RelatedWorkBriefArtifact,
  defaultEvidenceIds: string[]
): PaperDraftSection {
  const notes = brief.notes;
  if (notes.length === 0) {
    const paragraph = buildDraftParagraph(
      "Related work will need to be expanded once more literature summaries are available.",
      defaultEvidenceIds,
      []
    );
    return {
      heading: "Related Work",
      paragraphs: [paragraph],
      evidence_ids: paragraph.evidence_ids,
      citation_paper_ids: []
    };
  }

  const taxonomyNotes = notes.slice(0, Math.min(4, notes.length));
  const positioningNotes = selectPositioningNotes(notes).slice(0, Math.min(3, notes.length));
  const methodFamilies = uniqueStrings(taxonomyNotes.map((item) => item.method_family)).slice(0, 3);
  const problemFocuses = uniqueStrings(
    taxonomyNotes.map((item) => lowercaseLeadingWord(stripTrailingPunctuation(item.problem_focus))).filter(Boolean)
  ).slice(0, 2);
  const taxonomyText = [
    methodFamilies.length > 1
      ? `Prior work in this area spans ${joinHumanList(methodFamilies)}.`
      : `Prior work mainly clusters around ${methodFamilies[0] || "closely related empirical studies"}.`,
    problemFocuses.length > 0
      ? `Across these strands, studies focus on ${joinHumanList(problemFocuses)}.`
      : "",
    brief.comparison_axes[0]
      ? `The main comparison axis is ${brief.comparison_axes[0]}.`
      : ""
  ].filter(Boolean).join(" ");
  const taxonomyParagraph = buildDraftParagraph(
    taxonomyText,
    defaultEvidenceIds,
    taxonomyNotes.map((item) => item.paper_id)
  );

  const paragraphs = [taxonomyParagraph];
  if (notes.length >= 3) {
    const contributionFocuses = uniqueStrings(
      positioningNotes
        .map((item) => lowercaseLeadingWord(stripTrailingPunctuation(item.contribution_focus)))
        .filter(Boolean)
    ).slice(0, 2);
    const caveats = uniqueStrings(
      positioningNotes
        .map((item) => lowercaseLeadingWord(stripTrailingPunctuation(item.limitation_or_caveat)))
        .filter(Boolean)
    ).slice(0, 2);
    const positioningText = [
      contributionFocuses.length > 0
        ? `The closest prior studies emphasize ${joinHumanList(contributionFocuses)}.`
        : "The closest prior studies provide strong baselines for comparison.",
      caveats.length > 0
        ? `However, the available literature still leaves open ${joinHumanList(caveats)}.`
        : "However, the surrounding literature still leaves open coverage and evaluation gaps.",
      `The current study therefore positions itself around ${cleanString(bundle.topic) || "the present topic"} with emphasis on ${describeObjectiveMetricForNarrative(bundle.objectiveMetric)}.`
    ].join(" ");
    paragraphs.push(
      buildDraftParagraph(
        positioningText,
        defaultEvidenceIds,
        positioningNotes.map((item) => item.paper_id)
      )
    );
  }

  return {
    heading: "Related Work",
    paragraphs,
    evidence_ids: uniqueStrings([
      ...defaultEvidenceIds,
      ...paragraphs.flatMap((item) => item.evidence_ids)
    ]).slice(0, 6),
    citation_paper_ids: uniqueStrings(paragraphs.flatMap((item) => item.citation_paper_ids)).slice(0, 6)
  };
}

function uniqueRelatedWorkNotes(notes: RelatedWorkNoteArtifact[]): RelatedWorkNoteArtifact[] {
  const seen = new Set<string>();
  const unique: RelatedWorkNoteArtifact[] = [];
  for (const note of notes) {
    if (!note.paper_id || seen.has(note.paper_id)) {
      continue;
    }
    seen.add(note.paper_id);
    unique.push(note);
  }
  return unique;
}

function compareRelatedWorkRole(
  left: RelatedWorkNoteArtifact["comparison_role"],
  right: RelatedWorkNoteArtifact["comparison_role"]
): number {
  const rank = { closest: 0, supporting: 1, background: 2 } as const;
  return rank[left] - rank[right];
}

function classifyRelatedWorkRole(score: number, analyzed: boolean): RelatedWorkNoteArtifact["comparison_role"] {
  if (score >= (analyzed ? 3 : 4)) {
    return "closest";
  }
  if (score >= 2) {
    return "supporting";
  }
  return "background";
}

function describeRelationToStudy(score: number, analyzed: boolean): string {
  if (score >= (analyzed ? 3 : 4)) {
    return analyzed
      ? "Closest analyzed baseline for the current study framing."
      : "Closest scout-level citation for framing the current study topic.";
  }
  if (score >= 2) {
    return analyzed
      ? "Provides a nearby comparison point for the current study objective."
      : "Provides supporting context for nearby literature directions.";
  }
  return analyzed
    ? "Offers broader background for the surrounding literature."
    : "Offers broader scout-level background for the surrounding literature.";
}

function inferMethodFamily(text: string): string {
  const lower = cleanString(text).toLowerCase();
  if (/survey|review|overview/.test(lower)) {
    return "survey and synthesis";
  }
  if (/benchmark|evaluation|empirical|reproduc|robust|stability/.test(lower)) {
    return "evaluation and benchmarking";
  }
  if (/memory|state|session|thread|context/.test(lower)) {
    return "stateful coordination";
  }
  if (/agent|multi-agent|coordination|collaboration|orchestration|workflow/.test(lower)) {
    return "agent coordination workflows";
  }
  if (/retriev|search|discovery|collect|scout/.test(lower)) {
    return "literature discovery and retrieval";
  }
  if (/prompt|instruction|policy/.test(lower)) {
    return "prompting and control";
  }
  if (/plan|planner|decomposition/.test(lower)) {
    return "planning and decomposition";
  }
  const keywords = extractRelatedWorkKeywords([text]).slice(0, 2);
  return keywords.length > 0 ? `${joinHumanList(keywords)} methods` : "closely related methods";
}

function buildSettingFocus(
  datasets: string[],
  metrics: string[],
  corpusRow?: Pick<StoredCorpusRow, "venue" | "year">
): string {
  const parts = uniqueStrings([
    datasets[0] || "",
    metrics[0] ? `${metrics[0]}-centric evaluation` : "",
    cleanString(corpusRow?.venue),
    typeof corpusRow?.year === "number" ? String(corpusRow.year) : ""
  ]).filter(Boolean);
  if (parts.length === 0) {
    return "venue context not specified";
  }
  return parts.slice(0, 3).join(", ");
}

function extractRelatedWorkKeywords(values: Array<string | undefined>): string[] {
  const stopwords = new Set([
    "about",
    "across",
    "agent",
    "agents",
    "analysis",
    "approach",
    "approaches",
    "around",
    "based",
    "between",
    "current",
    "empirical",
    "evaluation",
    "evidence",
    "from",
    "into",
    "literature",
    "method",
    "methods",
    "paper",
    "papers",
    "results",
    "study",
    "their",
    "these",
    "this",
    "using",
    "with",
    "work",
    "workflow"
  ]);
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const token of cleanString(value).toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/gu) || []) {
      if (stopwords.has(token)) {
        continue;
      }
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([token]) => token)
    .slice(0, 8);
}

function scoreRelatedWorkMatch(studyKeywords: string[], text: string): number {
  if (studyKeywords.length === 0) {
    return 0;
  }
  const textKeywords = new Set(extractRelatedWorkKeywords([text]));
  let score = 0;
  for (const keyword of studyKeywords) {
    if (textKeywords.has(keyword)) {
      score += 1;
    }
  }
  return score;
}

function selectPositioningNotes(notes: RelatedWorkNoteArtifact[]): RelatedWorkNoteArtifact[] {
  const closest = notes.filter((item) => item.comparison_role === "closest");
  if (closest.length > 0) {
    return closest;
  }
  const supporting = notes.filter((item) => item.comparison_role === "supporting");
  if (supporting.length > 0) {
    return supporting;
  }
  return notes;
}

function isRelatedWorkHeading(heading: string): boolean {
  return /\brelated\b|\bprior work\b|\bbackground\b/iu.test(cleanString(heading));
}

function hasComparisonLanguage(text: string): boolean {
  return /\bwhile\b|\bwhereas\b|\bhowever\b|\bcontrast\b|\bcompared?\b|\bdiffer\b|\bsimilar\b|\bboth\b|\bstrand\b/iu.test(
    cleanString(text)
  );
}

function hasPositioningLanguage(text: string): boolean {
  return /\bcurrent study\b|\bour study\b|\bthis study\b|\bwe position\b|\bwe focus\b|\bthe present study\b/iu.test(
    cleanString(text)
  );
}

function joinHumanList(items: string[]): string {
  const cleaned = uniqueStrings(items.map((item) => cleanString(item)).filter(Boolean));
  if (cleaned.length === 0) {
    return "";
  }
  if (cleaned.length === 1) {
    return cleaned[0];
  }
  if (cleaned.length === 2) {
    return `${cleaned[0]} and ${cleaned[1]}`;
  }
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

export function collectPaperCitationIds(
  draft: PaperDraft,
  bundle: PaperWritingBundle
): string[] {
  const cited = uniqueStrings(
    [
      ...draft.sections.flatMap((item) => item.citation_paper_ids),
      ...draft.sections.flatMap((item) => item.paragraphs.flatMap((paragraph) => paragraph.citation_paper_ids)),
      ...draft.claims.flatMap((item) => item.citation_paper_ids)
    ].filter(Boolean)
  );
  if (cited.length > 0) {
    return cited;
  }

  const evidenceToPaper = new Map(
    bundle.evidenceRows.map((item) => [item.evidence_id, item.paper_id] as const)
  );
  const inferred = uniqueStrings(
    [...draft.sections.flatMap((item) => item.evidence_ids), ...draft.sections.flatMap((item) => item.paragraphs.flatMap((paragraph) => paragraph.evidence_ids))]
      .map((item) => evidenceToPaper.get(item) || "")
      .filter(Boolean)
  );
  if (inferred.length > 0) {
    return inferred;
  }

  return uniqueStrings(bundle.paperSummaries.slice(0, 4).map((item) => item.paper_id)).filter(Boolean);
}

export function buildPaperBibtex(corpus: StoredCorpusRow[], citedPaperIds: string[]): {
  references: string;
  citationKeysByPaperId: Map<string, string>;
  usedPaperIds: string[];
  unresolvedPaperIds: string[];
} {
  const corpusById = new Map(corpus.map((item) => [item.paper_id, item] as const));
  const usedPaperIds: string[] = [];
  const unresolvedPaperIds: string[] = [];
  const citationKeysByPaperId = new Map<string, string>();
  const entries: string[] = [];

  for (const paperId of uniqueStrings(citedPaperIds).filter(Boolean)) {
    const paper = corpusById.get(paperId);
    if (!paper) {
      unresolvedPaperIds.push(paperId);
      continue;
    }
    const entry = buildBibtexEntry(paper, "hybrid").trim();
    const key = extractBibtexKey(entry);
    if (!entry || !key || citationKeysByPaperId.has(paperId)) {
      if (!citationKeysByPaperId.has(paperId)) {
        unresolvedPaperIds.push(paperId);
      }
      continue;
    }
    citationKeysByPaperId.set(paperId, key);
    usedPaperIds.push(paperId);
    entries.push(entry);
  }

  if (entries.length > 0) {
    return {
      references: entries.join("\n\n"),
      citationKeysByPaperId,
      usedPaperIds,
      unresolvedPaperIds: uniqueStrings(unresolvedPaperIds)
    };
  }

  return {
    references: [
      "@article{autoref1,",
      "  title={AutoLabOS generated reference},",
      "  author={AutoLabOS},",
      "  year={2026}",
      "}"
    ].join("\n"),
    citationKeysByPaperId,
    usedPaperIds,
    unresolvedPaperIds: uniqueStrings(unresolvedPaperIds)
  };
}

export function renderPaperTex(input: {
  runTitle: string;
  topic: string;
  objectiveMetric: string;
  draft: PaperDraft;
  constraintProfile: ConstraintProfile;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  resultAnalysis?: ResultAnalysisArtifact;
  constraints: string[];
  citationKeysByPaperId: Map<string, string>;
}): string {
  const lines = [
    "\\documentclass{article}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{graphicx}",
    "\\title{" + latexEscape(input.draft.title || input.runTitle) + "}",
    "\\begin{document}",
    "\\maketitle",
    "\\begin{abstract}",
    latexEscape(input.draft.abstract),
    "\\end{abstract}",
    "\\section{Research Context}",
    `Topic: ${latexEscape(input.topic)}.`,
    `Objective metric: ${latexEscape(input.objectiveMetric)}.`,
    "\\section{Writing Constraints}",
    ...renderConstraintLines(input.constraints, input.constraintProfile),
    "\\section{Results Overview}",
    ...renderResultsLines(
      input.objectiveMetric,
      input.objectiveMetricProfile,
      input.objectiveEvaluation,
      input.resultAnalysis
    ),
    ...renderResultMetricTable(input.resultAnalysis),
    ...renderResultFigure(input.resultAnalysis)
  ];

  for (const section of input.draft.sections) {
    lines.push(`\\section{${latexEscape(section.heading)}}`);
    for (const paragraph of section.paragraphs) {
      lines.push(renderGroundedParagraph(paragraph, input.citationKeysByPaperId));
      lines.push("");
    }
    const paragraphEvidenceIds = uniqueStrings(section.paragraphs.flatMap((paragraph) => paragraph.evidence_ids));
    const uncoveredEvidenceIds = section.evidence_ids.filter((item) => !paragraphEvidenceIds.includes(item));
    if (uncoveredEvidenceIds.length > 0) {
      lines.push(`Section evidence coverage: \\texttt{${uncoveredEvidenceIds.map((item) => latexEscape(item)).join(", ")}}.`);
      lines.push("");
    }
  }

  if (input.draft.claims.length > 0) {
    lines.push("\\section{Claim Trace}");
    for (const claim of input.draft.claims) {
      const claimKeys = claim.citation_paper_ids
        .map((item) => input.citationKeysByPaperId.get(item))
        .filter((item): item is string => Boolean(item));
      const evidenceText =
        claim.evidence_ids.length > 0
          ? ` Evidence: \\texttt{${claim.evidence_ids.map((item) => latexEscape(item)).join(", ")}}.`
          : "";
      const citationText = claimKeys.length > 0 ? ` Citations: \\cite{${claimKeys.join(",")}}.` : "";
      lines.push(
        `\\textbf{${latexEscape(claim.claim_id)}} (${latexEscape(claim.section_heading)}): ${latexEscape(claim.statement)}.${evidenceText}${citationText}`
      );
      lines.push("");
    }
  }

  lines.push("\\bibliographystyle{plain}");
  lines.push("\\bibliography{references}");
  lines.push("\\end{document}");
  return lines.join("\n");
}

function renderGroundedParagraph(
  paragraph: PaperDraftParagraph,
  citationKeysByPaperId: Map<string, string>
): string {
  const citationKeys = paragraph.citation_paper_ids
    .map((item) => citationKeysByPaperId.get(item))
    .filter((item): item is string => Boolean(item));
  const citationSuffix = citationKeys.length > 0 ? ` \\cite{${citationKeys.join(",")}}` : "";
  const evidenceSuffix =
    paragraph.evidence_ids.length > 0
      ? ` \\textit{(Evidence anchors: \\texttt{${paragraph.evidence_ids.map((item) => latexEscape(item)).join(", ")}}.)}`
      : "";
  return `${latexEscape(paragraph.text)}${citationSuffix}${evidenceSuffix}`;
}

export function parsePaperSummaries(raw: string): PaperSummaryArtifact[] {
  return parseJsonl(raw)
    .map((item) => normalizePaperSummary(item))
    .filter((item): item is PaperSummaryArtifact => Boolean(item));
}

export function parseEvidenceRows(raw: string): PaperEvidenceArtifact[] {
  return parseJsonl(raw)
    .map((item) => normalizeEvidenceRow(item))
    .filter((item): item is PaperEvidenceArtifact => Boolean(item));
}

export function parseHypotheses(raw: string): HypothesisArtifact[] {
  return parseJsonl(raw)
    .map((item) => normalizeHypothesis(item))
    .filter((item): item is HypothesisArtifact => Boolean(item));
}

export function parseCorpusRows(raw: string): StoredCorpusRow[] {
  return parseJsonl(raw)
    .map((item) => normalizeCorpusRow(item))
    .filter((item): item is StoredCorpusRow => Boolean(item));
}

export function parseResultAnalysis(raw: string): ResultAnalysisArtifact | undefined {
  return parseAnalysisReport(raw);
}

export function parseExperimentPlan(raw: string): ExperimentPlanArtifact | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = YAML.parse(trimmed) as { selected_design?: { title?: unknown; summary?: unknown } };
    return {
      selectedTitle: cleanString(parsed?.selected_design?.title),
      selectedSummary: cleanString(parsed?.selected_design?.summary),
      rawText: trimmed
    };
  } catch {
    return {
      rawText: trimmed
    };
  }
}

function inferCitationPaperIds(
  evidenceIds: string[],
  evidenceById: Map<string, PaperEvidenceArtifact>,
  validPaperIds: Set<string>
): string[] {
  return uniqueStrings(
    evidenceIds
      .map((item) => evidenceById.get(item)?.paper_id || "")
      .filter((item): item is string => Boolean(item) && validPaperIds.has(item))
  );
}

function normalizeHeadingKey(value: string): string {
  return cleanString(value).toLowerCase();
}

function isEvidenceSensitiveSection(heading: string): boolean {
  return /related|method|results|discussion|conclusion|ablation|analysis/iu.test(cleanString(heading));
}

function weakenClaimStatement(
  statement: string,
  mode: "unsupported" | "low_confidence"
): string {
  const cleaned = stripTrailingPunctuation(cleanString(statement));
  if (!cleaned) {
    return statement;
  }
  if (/^tentative claim:/iu.test(cleaned) || /^preliminary evidence suggests/iu.test(cleaned)) {
    return cleaned;
  }
  if (mode === "unsupported") {
    return `Tentative claim: ${cleaned}; direct supporting evidence is currently limited`;
  }
  return `Preliminary evidence suggests ${lowercaseLeadingWord(cleaned)}`;
}

function ensureConservativeParagraphText(text: string): string {
  const cleaned = stripTrailingPunctuation(cleanString(text));
  if (!cleaned) {
    return text;
  }
  if (/direct supporting evidence is currently limited/iu.test(cleaned)) {
    return cleaned;
  }
  if (/^tentative|^preliminary evidence suggests/iu.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}. Direct supporting evidence is currently limited`;
}

function buildDraftParagraph(
  text: string,
  evidenceIds: string[],
  citationPaperIds: string[]
): PaperDraftParagraph {
  return {
    text,
    evidence_ids: uniqueStrings(evidenceIds).slice(0, 4),
    citation_paper_ids: uniqueStrings(citationPaperIds).slice(0, 4)
  };
}

function getParagraphText(paragraph: PaperDraftParagraph | undefined): string {
  return cleanString(paragraph?.text);
}

function normalizeParagraphs(
  paragraphs: unknown[],
  defaults: { evidence_ids: string[]; citation_paper_ids: string[] },
  evidenceIds: Set<string>,
  paperIds: Set<string>,
  evidenceToPaper: Map<string, string>
): PaperDraftParagraph[] {
  return paragraphs
    .map((paragraph) =>
      normalizeParagraph(paragraph, defaults, evidenceIds, paperIds, evidenceToPaper)
    )
    .filter((item): item is PaperDraftParagraph => Boolean(item))
    .slice(0, 6);
}

function normalizeParagraph(
  paragraph: unknown,
  defaults: { evidence_ids: string[]; citation_paper_ids: string[] },
  evidenceIds: Set<string>,
  paperIds: Set<string>,
  evidenceToPaper: Map<string, string>
): PaperDraftParagraph | undefined {
  if (typeof paragraph === "string") {
    const text = cleanString(paragraph);
    if (!text) {
      return undefined;
    }
    const inferredCitations = defaults.evidence_ids
      .map((item) => evidenceToPaper.get(item) || "")
      .filter((item): item is string => Boolean(item) && paperIds.has(item));
    return buildDraftParagraph(
      text,
      defaults.evidence_ids,
      uniqueStrings([...defaults.citation_paper_ids, ...inferredCitations])
    );
  }

  if (!paragraph || typeof paragraph !== "object" || Array.isArray(paragraph)) {
    return undefined;
  }

  const raw = paragraph as RawPaperDraftParagraph;
  const text = cleanString(raw.text);
  if (!text) {
    return undefined;
  }
  const explicitEvidence = uniqueStrings(
    normalizeStringArray(raw.evidence_ids).filter((item) => evidenceIds.has(item))
  ).slice(0, 4);
  const resolvedEvidence = explicitEvidence.length > 0 ? explicitEvidence : defaults.evidence_ids.slice(0, 4);
  const explicitCitations = uniqueStrings(
    normalizeStringArray(raw.citation_paper_ids).filter((item) => paperIds.has(item))
  ).slice(0, 4);
  const inferredCitations = resolvedEvidence
    .map((item) => evidenceToPaper.get(item) || "")
    .filter((item): item is string => Boolean(item) && paperIds.has(item));

  return buildDraftParagraph(
    text,
    resolvedEvidence,
    uniqueStrings([
      ...(explicitCitations.length > 0 ? explicitCitations : defaults.citation_paper_ids.slice(0, 4)),
      ...inferredCitations
    ])
  );
}

function normalizeSections(
  sections: RawPaperDraftSection[],
  evidenceIds: Set<string>,
  paperIds: Set<string>,
  evidenceToPaper: Map<string, string>
): PaperDraftSection[] {
  return sections
    .map((section) => {
      const evidence = uniqueStrings(
        normalizeStringArray(section.evidence_ids).filter((item) => evidenceIds.has(item))
      ).slice(0, 6);
      const explicitCitations = uniqueStrings(
        normalizeStringArray(section.citation_paper_ids).filter((item) => paperIds.has(item))
      ).slice(0, 6);
      const inferredCitations = evidence
        .map((item) => evidenceToPaper.get(item) || "")
        .filter((item): item is string => Boolean(item) && paperIds.has(item));
      const paragraphDefaults = {
        evidence_ids: evidence,
        citation_paper_ids: uniqueStrings([...explicitCitations, ...inferredCitations]).slice(0, 6)
      };
      const paragraphs = normalizeParagraphs(
        Array.isArray(section.paragraphs) ? section.paragraphs : [],
        paragraphDefaults,
        evidenceIds,
        paperIds,
        evidenceToPaper
      );
      if (!cleanString(section.heading) || paragraphs.length === 0) {
        return undefined;
      }
      const paragraphEvidenceIds = uniqueStrings(paragraphs.flatMap((item) => item.evidence_ids)).slice(0, 6);
      const paragraphCitationIds = uniqueStrings(paragraphs.flatMap((item) => item.citation_paper_ids)).slice(0, 6);
      return {
        heading: cleanString(section.heading) || "Section",
        paragraphs,
        evidence_ids: uniqueStrings([...evidence, ...paragraphEvidenceIds]).slice(0, 6),
        citation_paper_ids: uniqueStrings([...explicitCitations, ...inferredCitations, ...paragraphCitationIds]).slice(0, 6)
      };
    })
    .filter((item): item is PaperDraftSection => Boolean(item))
    .slice(0, 8);
}

function normalizeClaims(
  claims: RawPaperDraftClaim[],
  sections: PaperDraftSection[],
  evidenceIds: Set<string>,
  paperIds: Set<string>,
  evidenceToPaper: Map<string, string>
): PaperDraftClaim[] {
  const normalized = claims
    .map((claim, index) => {
      const evidence = normalizeStringArray(claim.evidence_ids).filter((item) => evidenceIds.has(item));
      const explicitCitations = normalizeStringArray(claim.citation_paper_ids).filter((item) => paperIds.has(item));
      const inferredCitations = evidence
        .map((item) => evidenceToPaper.get(item) || "")
        .filter((item): item is string => Boolean(item) && paperIds.has(item));
      const statement = cleanString(claim.statement);
      if (!statement) {
        return undefined;
      }
      return {
        claim_id: cleanString(claim.claim_id) || `c${index + 1}`,
        statement,
        section_heading: cleanString(claim.section_heading) || sections[index % Math.max(1, sections.length)]?.heading || "Results",
        evidence_ids: uniqueStrings(evidence).slice(0, 6),
        citation_paper_ids: uniqueStrings([...explicitCitations, ...inferredCitations]).slice(0, 6)
      };
    })
    .filter((item): item is PaperDraftClaim => Boolean(item))
    .slice(0, 8);

  if (normalized.length > 0) {
    return normalized;
  }

  return sections.slice(0, 6).map((section, index) => ({
    claim_id: `c${index + 1}`,
    statement: firstSentence(getParagraphText(section.paragraphs[0])) || `${section.heading} summary.`,
    section_heading: section.heading,
    evidence_ids: section.evidence_ids,
    citation_paper_ids: section.citation_paper_ids
  }));
}

function renderConstraintLines(
  constraints: string[],
  profile: ConstraintProfile
): string[] {
  const lines: string[] = [];

  if (profile.writing.targetVenue) {
    lines.push(`Target venue: ${latexEscape(profile.writing.targetVenue)}.`);
  }
  if (profile.writing.toneHint) {
    lines.push(`Tone: ${latexEscape(profile.writing.toneHint)}.`);
  }
  if (profile.writing.lengthHint) {
    lines.push(`Length target: ${latexEscape(profile.writing.lengthHint)}.`);
  }
  if (profile.experiment.designNotes.length > 0) {
    lines.push("Design guidance:");
    for (const note of profile.experiment.designNotes) {
      lines.push(`- ${latexEscape(note)}`);
    }
  }
  if (profile.experiment.evaluationNotes.length > 0) {
    lines.push("Evaluation guidance:");
    for (const note of profile.experiment.evaluationNotes) {
      lines.push(`- ${latexEscape(note)}`);
    }
  }
  if (profile.assumptions.length > 0) {
    lines.push("Constraint assumptions:");
    for (const note of profile.assumptions) {
      lines.push(`- ${latexEscape(note)}`);
    }
  }

  if (constraints.length === 0) {
    lines.push("No additional run constraints were provided.");
    return lines;
  }

  lines.push("Run constraints:");
  for (const constraint of constraints) {
    lines.push(`- ${latexEscape(constraint)}`);
  }
  return lines;
}

function renderResultsLines(
  objectiveMetric: string,
  objectiveMetricProfile: ObjectiveMetricProfile,
  objectiveEvaluation: ObjectiveMetricEvaluation | undefined,
  resultAnalysis: ResultAnalysisArtifact | undefined
): string[] {
  const lines = [`Primary objective: ${latexEscape(objectiveMetric)}.`];
  const resolvedEvaluation =
    objectiveEvaluation || resultAnalysis?.objective_metric?.evaluation;

  if (resolvedEvaluation?.summary) {
    lines.push(`Objective evaluation: ${latexEscape(resolvedEvaluation.summary)}.`);
  } else if (objectiveMetricProfile.primaryMetric) {
    lines.push(`Primary metric of interest: ${latexEscape(objectiveMetricProfile.primaryMetric)}.`);
  }

  if (resultAnalysis?.plan_context?.selected_design?.title) {
    lines.push(`Selected experiment design: ${latexEscape(resultAnalysis.plan_context.selected_design.title)}.`);
  }

  if ((resultAnalysis?.primary_findings || []).length > 0) {
    lines.push("Key findings:");
    for (const finding of (resultAnalysis?.primary_findings || []).slice(0, 4)) {
      lines.push(`- ${latexEscape(finding)}`);
    }
  }

  if ((resultAnalysis?.condition_comparisons || []).length > 0) {
    lines.push("Comparative findings:");
    for (const comparison of (resultAnalysis?.condition_comparisons || []).slice(0, 2)) {
      if (comparison?.summary) {
        lines.push(`- ${latexEscape(comparison.summary)}`);
      }
    }
  }

  if (resultAnalysis?.verifier_feedback?.summary) {
    lines.push("Verifier feedback:");
    lines.push(`- ${latexEscape(resultAnalysis.verifier_feedback.summary)}`);
  }

  if ((resultAnalysis?.supplemental_runs || []).length > 0) {
    lines.push("Supplemental runs:");
    for (const supplemental of (resultAnalysis?.supplemental_runs || []).slice(0, 2)) {
      if (supplemental?.summary) {
        lines.push(`- ${latexEscape(supplemental.summary)}`);
      }
    }
  }

  if ((resultAnalysis?.external_comparisons || []).length > 0) {
    lines.push("External comparisons:");
    for (const comparison of (resultAnalysis?.external_comparisons || []).slice(0, 2)) {
      if (comparison?.summary) {
        lines.push(`- ${latexEscape(comparison.summary)}`);
      }
    }
  }

  if ((resultAnalysis?.statistical_summary?.notes || []).length > 0) {
    lines.push("Statistical summary:");
    for (const note of (resultAnalysis?.statistical_summary?.notes || []).slice(0, 4)) {
      lines.push(`- ${latexEscape(note)}`);
    }
  }

  if ((resultAnalysis?.failure_taxonomy || []).length > 0) {
    lines.push("Failure taxonomy:");
    for (const item of (resultAnalysis?.failure_taxonomy || []).slice(0, 3)) {
      lines.push(`- ${latexEscape(`[${item.severity}/${item.status}] ${item.summary}`)}`);
    }
  }

  if ((resultAnalysis?.synthesis?.discussion_points || []).length > 0) {
    lines.push("Discussion cues:");
    for (const point of (resultAnalysis?.synthesis?.discussion_points || []).slice(0, 3)) {
      lines.push(`- ${latexEscape(point)}`);
    }
  }

  if ((resultAnalysis?.synthesis?.failure_analysis || []).length > 0) {
    lines.push("Failure analysis:");
    for (const point of (resultAnalysis?.synthesis?.failure_analysis || []).slice(0, 2)) {
      lines.push(`- ${latexEscape(point)}`);
    }
  }

  if (resultAnalysis?.synthesis?.confidence_statement) {
    lines.push(`Confidence statement: ${latexEscape(resultAnalysis.synthesis.confidence_statement)}.`);
  }

  if (objectiveMetricProfile.paperEmphasis.length > 0) {
    lines.push("Result emphasis:");
    for (const note of objectiveMetricProfile.paperEmphasis) {
      lines.push(`- ${latexEscape(note)}`);
    }
  } else if ((resultAnalysis?.paper_claims || []).length > 0) {
    lines.push("Draft claims:");
    for (const claim of (resultAnalysis?.paper_claims || []).slice(0, 2)) {
      if (claim?.claim) {
        lines.push(`- ${latexEscape(claim.claim)}`);
      }
    }
  } else {
    lines.push("Metrics are linked with evidence IDs in metadata.");
  }

  if ((resultAnalysis?.limitations || []).length > 0) {
    lines.push("Limitations:");
    for (const limitation of (resultAnalysis?.limitations || []).slice(0, 3)) {
      lines.push(`- ${latexEscape(limitation)}`);
    }
  }

  if ((resultAnalysis?.figure_specs || []).length > 0) {
    lines.push("Generated figure artifacts:");
    for (const figure of (resultAnalysis?.figure_specs || []).slice(0, 2)) {
      const label = [figure?.title, figure?.path].filter(Boolean).join(": ");
      if (label) {
        lines.push(`- ${latexEscape(label)}`);
      }
    }
  }

  return lines;
}

function renderResultMetricTable(resultAnalysis: ResultAnalysisArtifact | undefined): string[] {
  const rows = normalizeMetricTable(resultAnalysis).slice(0, 6);
  if (rows.length === 0) {
    return [];
  }

  const lines = [
    "\\begin{table}[t]",
    "\\centering",
    "\\begin{tabular}{lr}",
    "\\hline",
    "Metric & Value \\\\",
    "\\hline"
  ];

  for (const row of rows) {
    lines.push(`${latexEscape(shortenMetricLabel(row.key, 42))} & ${formatTexNumber(row.value)} \\\\`);
  }

  lines.push("\\hline");
  lines.push("\\end{tabular}");
  lines.push("\\caption{Top reported metrics from the structured result analysis.}");
  lines.push("\\end{table}");
  lines.push("");
  return lines;
}

function renderResultFigure(resultAnalysis: ResultAnalysisArtifact | undefined): string[] {
  const rows = normalizeMetricTable(resultAnalysis)
    .filter((row) => Number.isFinite(row.value) && row.value >= 0)
    .slice(0, 5);
  if (rows.length === 0) {
    return [];
  }

  const maxValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const lines = [
    "\\begin{figure}[t]",
    "\\centering",
    "\\begin{tabular}{l l r}"
  ];

  for (const row of rows) {
    const widthEm = Math.max(1.5, Math.min(12, Number(((Math.abs(row.value) / maxValue) * 12).toFixed(2))));
    lines.push(
      `${latexEscape(shortenMetricLabel(row.key, 24))} & \\rule{${widthEm}em}{1.2ex} & ${formatTexNumber(row.value)} \\\\`
    );
  }

  lines.push("\\end{tabular}");
  lines.push(`\\caption{${latexEscape(buildResultFigureCaption(resultAnalysis))}}`);
  lines.push("\\end{figure}");
  lines.push("");
  return lines;
}

function normalizeMetricTable(
  resultAnalysis: ResultAnalysisArtifact | undefined
): Array<{ key: string; value: number }> {
  const explicit = (resultAnalysis?.metric_table || [])
    .map((row) => ({
      key: cleanString(row?.key),
      value: typeof row?.value === "number" && Number.isFinite(row.value) ? Number(row.value.toFixed(4)) : undefined
    }))
    .filter((row): row is { key: string; value: number } => Boolean(row.key) && typeof row.value === "number");

  if (explicit.length > 0) {
    return explicit;
  }

  const flattened = flattenNumericMetrics(resultAnalysis?.metrics || {});
  return flattened.slice(0, 6);
}

function flattenNumericMetrics(
  value: Record<string, unknown>,
  prefix = ""
): Array<{ key: string; value: number }> {
  const rows: Array<{ key: string; value: number }> = [];
  for (const [key, raw] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      rows.push({ key: nextKey, value: Number(raw.toFixed(4)) });
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

function buildResultFigureCaption(resultAnalysis: ResultAnalysisArtifact | undefined): string {
  const artifactLabel = resultAnalysis?.figure_specs?.[0]
    ? [resultAnalysis.figure_specs[0].title, resultAnalysis.figure_specs[0].path].filter(Boolean).join(" ")
    : "";
  const objectiveSummary = cleanString(resultAnalysis?.objective_metric?.evaluation?.summary);
  const base = objectiveSummary || "Normalized metric snapshot derived from the structured result analysis.";
  return artifactLabel ? `${base} Artifact: ${artifactLabel}.` : base;
}

function formatTexNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function shortenMetricLabel(text: string, maxLength: number): string {
  const cleaned = cleanString(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function normalizePaperSummary(input: unknown): PaperSummaryArtifact | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const item = input as Record<string, unknown>;
  const paperId = cleanString(item.paper_id);
  const title = cleanString(item.title);
  const sourceType = item.source_type === "abstract" ? "abstract" : "full_text";
  const summary = cleanString(item.summary);
  if (!paperId || !title || !summary) {
    return undefined;
  }
  return {
    paper_id: paperId,
    title,
    source_type: sourceType,
    summary,
    key_findings: normalizeStringArray(item.key_findings),
    limitations: normalizeStringArray(item.limitations),
    datasets: normalizeStringArray(item.datasets),
    metrics: normalizeStringArray(item.metrics),
    novelty: cleanString(item.novelty) || title,
    reproducibility_notes: normalizeStringArray(item.reproducibility_notes)
  };
}

function normalizeEvidenceRow(input: unknown): PaperEvidenceArtifact | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const item = input as Record<string, unknown>;
  const evidenceId = cleanString(item.evidence_id);
  const paperId = cleanString(item.paper_id);
  const claim = cleanString(item.claim);
  if (!evidenceId || !paperId || !claim) {
    return undefined;
  }
  return {
    evidence_id: evidenceId,
    paper_id: paperId,
    claim,
    method_slot: cleanString(item.method_slot) || "Not specified.",
    result_slot: cleanString(item.result_slot) || claim,
    limitation_slot: cleanString(item.limitation_slot) || "Not specified.",
    dataset_slot: cleanString(item.dataset_slot) || "Not specified.",
    metric_slot: cleanString(item.metric_slot) || "Not specified.",
    evidence_span: cleanString(item.evidence_span) || claim,
    source_type: item.source_type === "abstract" ? "abstract" : "full_text",
    confidence: normalizeNumber(item.confidence, 0.5),
    confidence_reason: cleanString(item.confidence_reason)
  };
}

function normalizeHypothesis(input: unknown): HypothesisArtifact | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const item = input as Record<string, unknown>;
  const hypothesisId = cleanString(item.hypothesis_id);
  const text = cleanString(item.text);
  if (!hypothesisId || !text) {
    return undefined;
  }
  return {
    hypothesis_id: hypothesisId,
    text,
    evidence_links: normalizeStringArray(item.evidence_links).slice(0, 6),
    rationale: cleanString(item.rationale),
    measurement_hint: cleanString(item.measurement_hint)
  };
}

function normalizeCorpusRow(input: unknown): StoredCorpusRow | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const item = input as Record<string, unknown>;
  const paperId = cleanString(item.paper_id);
  const title = cleanString(item.title);
  if (!paperId || !title) {
    return undefined;
  }
  return {
    paper_id: paperId,
    title,
    abstract: cleanString(item.abstract),
    year: typeof item.year === "number" ? item.year : undefined,
    venue: cleanString(item.venue),
    url: cleanString(item.url),
    landing_url: cleanString(item.landing_url),
    pdf_url: cleanString(item.pdf_url),
    pdf_url_source: cleanString(item.pdf_url_source),
    authors: normalizeStringArray(item.authors),
    citation_count: typeof item.citation_count === "number" ? item.citation_count : undefined,
    influential_citation_count:
      typeof item.influential_citation_count === "number" ? item.influential_citation_count : undefined,
    publication_date: cleanString(item.publication_date),
    publication_types: normalizeStringArray(item.publication_types),
    fields_of_study: normalizeStringArray(item.fields_of_study),
    doi: cleanString(item.doi),
    arxiv_id: cleanString(item.arxiv_id),
    semantic_scholar_bibtex: cleanString(item.semantic_scholar_bibtex),
    bibtex: cleanString(item.bibtex),
    bibtex_source:
      typeof item.bibtex_source === "string"
        ? (item.bibtex_source as StoredCorpusRow["bibtex_source"])
        : undefined,
    bibtex_richness: typeof item.bibtex_richness === "number" ? item.bibtex_richness : undefined
  };
}

function parseJsonl(raw: string): unknown[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter((item) => item !== undefined);
}

function cleanString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function describeObjectiveMetricForNarrative(value: unknown): string {
  const cleaned = cleanString(value)
    .replace(/\bstate[- ]of[- ]the[- ]art\b/giu, "")
    .replace(/\bsignificant(?:ly)?\b/giu, "")
    .replace(/\bsubstantial\b/giu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "the stated evaluation objective";
}

export function buildSuggestedPaperTitle(bundle: PaperWritingBundle): string {
  const designTitle = cleanTitleFragment(bundle.experimentPlan?.selectedTitle);
  const topicFocus = buildPaperTopicFocus(bundle);
  const studyDescriptor = buildStudyDescriptor(bundle.objectiveMetric);

  if (designTitle) {
    return composePaperTitle(toTitleCase(designTitle), studyDescriptor, topicFocus);
  }

  const noveltyTitle = cleanTitleFragment(bundle.paperSummaries[0]?.novelty);
  if (noveltyTitle && !isTitleTooClose(noveltyTitle, bundle.runTitle)) {
    return composePaperTitle(toTitleCase(noveltyTitle), studyDescriptor, topicFocus);
  }

  return limitPaperTitle(`${studyDescriptor} of ${topicFocus}`);
}

export function choosePaperTitle(input: {
  candidateTitle?: unknown;
  runTitle: string;
  fallbackTitle: string;
}): string {
  const candidateTitle = cleanString(input.candidateTitle);
  if (!candidateTitle) {
    return input.fallbackTitle;
  }
  if (candidateTitle.length < 12) {
    return input.fallbackTitle;
  }
  if (isTitleTooClose(candidateTitle, input.runTitle)) {
    return input.fallbackTitle;
  }
  return candidateTitle;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((item) => cleanString(item)).filter(Boolean));
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(3));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Number(parsed.toFixed(3));
    }
  }
  return fallback;
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("paper_draft_json_not_found");
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

  throw new Error("paper_draft_json_incomplete");
}

function truncateText(text: string, maxLength: number): string {
  const cleaned = cleanString(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function firstSentence(text: string): string {
  const cleaned = cleanString(text);
  if (!cleaned) {
    return "";
  }
  const match = cleaned.match(/(.+?[.!?])(?:\s|$)/u);
  return match?.[1]?.trim() || cleaned;
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?;:]+$/u, "").trim();
}

function lowercaseLeadingWord(text: string): string {
  if (!text) {
    return text;
  }
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function buildStudyDescriptor(objectiveMetric: string): string {
  const metric = cleanString(objectiveMetric).toLowerCase();
  if (metric.includes("reproduc")) {
    return "A Reproducibility Study";
  }
  if (metric.includes("robust")) {
    return "A Robustness Study";
  }
  if (metric.includes("benchmark")) {
    return "An Empirical Benchmark";
  }
  return "An Empirical Study";
}

function buildPaperTopicFocus(bundle: PaperWritingBundle): string {
  const topic = cleanTitleFragment(bundle.topic) || cleanTitleFragment(bundle.runTitle);
  const normalized =
    topic ||
    cleanTitleFragment(bundle.paperSummaries[0]?.title) ||
    "Multi-Agent Collaboration";
  return toTitleCase(normalized);
}

function cleanTitleFragment(value: unknown): string {
  const cleaned = cleanString(value)
    .replace(/\bstate[- ]of[- ]the[- ]art\b/giu, "")
    .replace(/\breproducibility\b/giu, "")
    .replace(/\brecent research\b/giu, "")
    .replace(/\bin recent (?:research|papers?)\b/giu, "")
    .replace(/\bresearch workflows?\b/giu, "workflows")
    .replace(/\s*[:;,-]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "";
}

function limitPaperTitle(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 120) {
    return cleaned;
  }
  const slice = cleaned.slice(0, 120);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace >= 72 ? slice.slice(0, lastSpace) : slice).trim();
}

function composePaperTitle(lead: string, studyDescriptor: string, topicFocus: string): string {
  const fullTitle = `${lead}: ${studyDescriptor} of ${topicFocus}`;
  if (fullTitle.length <= 120) {
    return fullTitle;
  }
  const shorterTitle = `${lead}: ${studyDescriptor}`;
  if (shorterTitle.length <= 120) {
    return shorterTitle;
  }
  return limitPaperTitle(shorterTitle);
}

function normalizeTitleForComparison(value: string): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, " ")
    .trim();
}

function isTitleTooClose(candidate: string, reference: string): boolean {
  const candidateNormalized = normalizeTitleForComparison(candidate);
  const referenceNormalized = normalizeTitleForComparison(reference);
  if (!candidateNormalized || !referenceNormalized) {
    return false;
  }
  if (candidateNormalized === referenceNormalized) {
    return true;
  }
  if (
    candidateNormalized.startsWith(referenceNormalized) ||
    referenceNormalized.startsWith(candidateNormalized)
  ) {
    return true;
  }

  const candidateTokens = new Set(candidateNormalized.split(" ").filter(Boolean));
  const referenceTokens = new Set(referenceNormalized.split(" ").filter(Boolean));
  if (referenceTokens.size < 5) {
    return false;
  }
  const sharedCount = [...candidateTokens].filter((token) => referenceTokens.has(token)).length;
  const overlap = sharedCount / Math.min(candidateTokens.size, referenceTokens.size);
  return overlap >= 0.8;
}

function toTitleCase(value: string): string {
  const lowerCaseWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "for",
    "of",
    "in",
    "on",
    "to",
    "vs",
    "versus",
    "with",
    "by",
    "from"
  ]);

  return cleanString(value)
    .split(" ")
    .map((word, index, words) => {
      const lower = word.toLowerCase();
      const parts = word.split("-");
      const formatted = parts
        .map((part) => {
          if (!part) {
            return part;
          }
          if (/^[A-Z0-9]{2,}$/u.test(part)) {
            return part;
          }
          const normalizedPart = part.toLowerCase();
          return normalizedPart.charAt(0).toUpperCase() + normalizedPart.slice(1);
        })
        .join("-");
      if (index > 0 && index < words.length - 1 && lowerCaseWords.has(lower)) {
        return lower;
      }
      return formatted;
    })
    .join(" ");
}

function latexEscape(text: string): string {
  return cleanString(text)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

function extractBibtexKey(entry: string): string | undefined {
  const match = entry.match(/^@\w+\{([^,]+),/u);
  return match?.[1]?.trim();
}
