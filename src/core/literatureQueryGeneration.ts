import { createHash } from "node:crypto";

import { AutoLabOSEvent, EventStream } from "./events.js";
import { LLMClient } from "./llm/client.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import {
  extractResearchBriefTopic,
  hasSemanticScholarSpecialSyntax,
  sanitizeSemanticScholarQueryList
} from "./runConstraints.js";
import { parseMarkdownRunBriefSections } from "./runs/runBriefParser.js";
import { RunRecord } from "../types.js";

const QUERY_PLAN_CACHE_KEY = "collect_papers.llm_query_plan";
const PLACEHOLDER_QUERY_TOKENS = new Set([
  "array",
  "assumption",
  "assumptions",
  "boolean",
  "null",
  "number",
  "numbers",
  "object",
  "query",
  "queries",
  "string",
  "strings"
]);
const SMALL_QUERY_FILLER_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "been",
  "being",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "how",
  "if",
  "improve",
  "improves",
  "improved",
  "improving",
  "in",
  "is",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "under",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "within",
  "would"
]);

interface StoredLiteratureQueryPlan {
  fingerprint: string;
  plan: GeneratedLiteratureQueries;
  updatedAt: string;
}

export interface GeneratedLiteratureQueries {
  source: "llm";
  queries: string[];
  assumptions: string[];
}

interface ResolveGeneratedLiteratureQueriesInput {
  run: RunRecord;
  rawBrief?: string;
  extractedBriefTopic?: string;
  runContextMemory: RunContextMemory;
  llm: LLMClient;
  eventStream?: EventStream;
  node?: AutoLabOSEvent["node"];
  abortSignal?: AbortSignal;
}

export async function resolveGeneratedLiteratureQueries(
  input: ResolveGeneratedLiteratureQueriesInput
): Promise<GeneratedLiteratureQueries | undefined> {
  const explicitBriefTopic = extractResearchBriefTopic(input.rawBrief);
  const topicSeed = explicitBriefTopic || input.extractedBriefTopic || input.run.topic;
  if (!topicSeed.trim()) {
    return undefined;
  }

  const fingerprint = buildLiteratureQueryFingerprint(input.run, input.rawBrief, input.extractedBriefTopic);
  const cached = await input.runContextMemory.get<StoredLiteratureQueryPlan>(QUERY_PLAN_CACHE_KEY);
  if (cached?.fingerprint === fingerprint && cached.plan?.queries?.length) {
    return normalizeGeneratedLiteratureQueries(cached.plan);
  }

  try {
    const completion = await input.llm.complete(
      buildLiteratureQueryPrompt(input.run, input.rawBrief, input.extractedBriefTopic),
      {
        systemPrompt: buildLiteratureQuerySystemPrompt(),
        abortSignal: input.abortSignal
      }
    );
    const plan = parseGeneratedLiteratureQueries(completion.text);
    await input.runContextMemory.put(QUERY_PLAN_CACHE_KEY, {
      fingerprint,
      plan,
      updatedAt: new Date().toISOString()
    });
    return plan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.eventStream?.emit({
      type: "OBS_RECEIVED",
      runId: input.run.id,
      node: input.node,
      payload: {
        text: `LLM literature-query fallback: ${message}`
      }
    });
    return undefined;
  }
}

function buildLiteratureQuerySystemPrompt(): string {
  return [
    "You are the AutoLabOS literature query planner.",
    "Generate Semantic Scholar paper-search queries from a research topic.",
    "Prefer Semantic Scholar bulk-search syntax when it sharpens retrieval.",
    "Use + for required terms, | for alternatives, and - for exclusions when helpful.",
    "Return JSON only.",
    "Do not invent methods, datasets, venues, or claims that are not explicit or strongly implied."
  ].join("\n");
}

function buildLiteratureQueryPrompt(
  run: RunRecord,
  rawBrief: string | undefined,
  extractedBriefTopic: string | undefined
): string {
  const sections = rawBrief ? parseMarkdownRunBriefSections(rawBrief) : undefined;
  const explicitBriefTopic = extractResearchBriefTopic(rawBrief);
  return [
    "Return one JSON object with this shape:",
    "{",
    '  "queries": ["string"],',
    '  "assumptions": ["string"]',
    "}",
    "",
    "Rules:",
    "- Return 2 to 4 queries when possible, ordered from most precise to broader fallback.",
    "- Each query should be a concise Semantic Scholar search expression, not a full sentence or research question.",
    "- Prefer 1 to 3 focused concept groups per query instead of a long bag of words.",
    "- Use quoted phrases, parentheses, +, |, and - when they make the query more precise.",
    "- If you naturally think in AND/OR/NOT, convert them into Semantic Scholar bulk-search syntax using +, |, and -.",
    "- Do NOT use field prefixes like title:, abstract:, author:, venue:, or year:.",
    "- Do NOT use wildcard syntax or unsupported advanced search operators beyond quoted phrases, parentheses, +, |, and -.",
    "- Prefer paper-title/abstract terms: method family, task, modality, domain, and benchmark family only when central.",
    "- Avoid generic meta words like research, study, literature review, survey, benchmark plan, reproducible, or pipeline.",
    "- Avoid resource/execution qualifiers such as CPU-only, runtime, memory, local, lightweight, or public datasets unless they are central to the actual paper topic.",
    "- Drop sentence glue such as can, improve, under, and similar question words whenever they are not core search terms.",
    "- If the explicit brief topic is already a good search seed, preserve its core terms but rewrite them into tighter search expressions.",
    "",
    `Run topic: ${run.topic}`,
    `Explicit brief topic: ${explicitBriefTopic || "none"}`,
    `LLM-extracted brief topic: ${extractedBriefTopic || "none"}`,
    `Objective metric: ${run.objectiveMetric || "none"}`,
    "Constraints:",
    ...(run.constraints.length > 0 ? run.constraints.map((constraint, index) => `${index + 1}. ${constraint}`) : ["none"]),
    sections?.researchQuestion ? `Research question: ${sections.researchQuestion}` : "Research question: none",
    sections?.baselineComparator ? `Baseline / comparator: ${sections.baselineComparator}` : "Baseline / comparator: none"
  ].join("\n");
}

function parseGeneratedLiteratureQueries(raw: string): GeneratedLiteratureQueries {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new Error("LLM returned no JSON object for literature queries.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Literature query JSON parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Literature query JSON must decode to an object.");
  }

  const candidateQueries = expandSmallKeywordBundles(
    sanitizeSemanticScholarQueryList(
      Array.isArray((parsed as { queries?: unknown }).queries)
        ? ((parsed as { queries?: unknown[] }).queries ?? []).map((value) => String(value))
        : []
    )
  )
    .filter(isUsableSemanticScholarQuery)
    .slice(0, 4);

  if (candidateQueries.length === 0) {
    throw new Error("LLM returned no usable Semantic Scholar queries.");
  }

  return {
    source: "llm",
    queries: candidateQueries,
    assumptions: normalizeStringArray((parsed as { assumptions?: unknown }).assumptions).slice(0, 4)
  };
}

function normalizeGeneratedLiteratureQueries(value: GeneratedLiteratureQueries): GeneratedLiteratureQueries | undefined {
  const queries = expandSmallKeywordBundles(sanitizeSemanticScholarQueryList(value.queries))
    .filter(isUsableSemanticScholarQuery)
    .slice(0, 4);
  if (queries.length === 0) {
    return undefined;
  }
  return {
    source: "llm",
    queries,
    assumptions: normalizeStringArray(value.assumptions).slice(0, 4)
  };
}

function buildLiteratureQueryFingerprint(
  run: RunRecord,
  rawBrief: string | undefined,
  extractedBriefTopic: string | undefined
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        constraints: run.constraints,
        rawBrief: rawBrief || "",
        extractedBriefTopic: extractedBriefTopic || ""
      })
    )
    .digest("hex");
}

function extractJsonObject(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced?.[1] || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => cleanText(item)).filter(Boolean))];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function expandSmallKeywordBundles(queries: string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    if (hasSemanticScholarSpecialSyntax(query)) {
      const normalizedStructured = query.trim();
      if (!normalizedStructured) {
        continue;
      }
      const structuredKey = normalizedStructured.toLowerCase();
      if (seen.has(structuredKey)) {
        continue;
      }
      seen.add(structuredKey);
      results.push(normalizedStructured);
      continue;
    }
    const variants = toSmallKeywordBundles(query);
    for (const variant of variants.length > 0 ? variants : [query]) {
      const normalized = variant.trim();
      if (!normalized) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(normalized);
    }
  }
  return results;
}

function toSmallKeywordBundles(query: string): string[] {
  const tokens = extractKeywordTokens(query);
  if (tokens.length < 2) {
    return [];
  }
  if (tokens.length <= 5) {
    return [tokens.join(" ")];
  }

  const bundles: string[] = [];
  const size = 4;
  const stride = 2;
  for (let start = 0; start < tokens.length && bundles.length < 3; start += stride) {
    const chunk = tokens.slice(start, start + size);
    if (chunk.length < 2) {
      break;
    }
    bundles.push(chunk.join(" "));
    if (start + size >= tokens.length) {
      break;
    }
  }
  return bundles;
}

function extractKeywordTokens(query: string): string[] {
  const matches = query.match(/[a-z0-9]+(?:-[a-z0-9]+)*/giu) || [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const token = match.toLowerCase().trim();
    if (!token) {
      continue;
    }
    if (token.length < 2 && !/\d/u.test(token)) {
      continue;
    }
    if (SMALL_QUERY_FILLER_TOKENS.has(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function isUsableSemanticScholarQuery(query: string): boolean {
  const tokens = extractKeywordTokens(query);
  if (tokens.length < 2) {
    return false;
  }
  return !tokens.every((token) => PLACEHOLDER_QUERY_TOKENS.has(token));
}
