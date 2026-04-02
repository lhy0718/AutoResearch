import fs from "node:fs";
import path from "node:path";

import type { StoredCorpusRow } from "../collection/types.js";

export interface CitationReport {
  orphan_citations: string[];
  unchecked_sources: string[];
  status: "pass" | "fail";
}

interface EvidenceLinksClaimLike {
  citation_paper_ids?: unknown;
}

interface EvidenceLinksArtifactLike {
  claims?: unknown;
}

const CITATION_REGEX = new RegExp(String.raw`\\cite[a-zA-Z*]*(?:\[[^\]]*\]){0,2}\{([^}]+)\}`, "gu");
const BIB_ENTRY_REGEX = /@\w+\s*\{\s*([^,\s]+)\s*,/gu;

export function checkCitationConsistency(runDir: string): CitationReport {
  const paperDir = path.join(runDir, "paper");
  const mainTex = safeReadFile(path.join(paperDir, "main.tex"));
  const referencesBib = safeReadFile(path.join(paperDir, "references.bib"));
  const evidenceLinks = safeReadJson<EvidenceLinksArtifactLike>(path.join(paperDir, "evidence_links.json"));
  const corpusRows = parseCorpusRows(path.join(runDir, "corpus.jsonl"));

  const citedKeys = extractCitationKeys(mainTex);
  const bibKeys = extractBibKeys(referencesBib);
  const orphanCitations = uniqueStrings(
    citedKeys.filter((key) => !bibKeys.has(key))
  );
  const uncheckedSources = resolveUncheckedSources(evidenceLinks, corpusRows);

  return {
    orphan_citations: orphanCitations,
    unchecked_sources: uncheckedSources,
    status: orphanCitations.length > 0 ? "fail" : "pass"
  };
}

function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractCitationKeys(mainTex: string | null): string[] {
  if (!mainTex) {
    return [];
  }
  const keys: string[] = [];
  for (const match of mainTex.matchAll(CITATION_REGEX)) {
    const rawKeys = match[1]?.split(",") ?? [];
    for (const key of rawKeys) {
      const trimmed = key.trim();
      if (trimmed) {
        keys.push(trimmed);
      }
    }
  }
  return uniqueStrings(keys);
}

function extractBibKeys(referencesBib: string | null): Set<string> {
  const keys = new Set<string>();
  if (!referencesBib) {
    return keys;
  }
  for (const match of referencesBib.matchAll(BIB_ENTRY_REGEX)) {
    const key = match[1]?.trim();
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function parseCorpusRows(corpusPath: string): Map<string, StoredCorpusRow> {
  const rows = new Map<string, StoredCorpusRow>();
  const raw = safeReadFile(corpusPath);
  if (!raw) {
    return rows;
  }
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as StoredCorpusRow;
      if (parsed.paper_id) {
        rows.set(parsed.paper_id, parsed);
      }
    } catch {
      // Ignore malformed corpus rows and rely on the remaining parseable records.
    }
  }
  return rows;
}

function resolveUncheckedSources(
  evidenceLinks: EvidenceLinksArtifactLike | null,
  corpusRows: Map<string, StoredCorpusRow>
): string[] {
  const claims = Array.isArray(evidenceLinks?.claims)
    ? evidenceLinks.claims as EvidenceLinksClaimLike[]
    : [];
  const citationPaperIds = uniqueStrings(
    claims.flatMap((claim) =>
      Array.isArray(claim.citation_paper_ids)
        ? claim.citation_paper_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : []
    )
  );

  return citationPaperIds.filter((paperId) => {
    const row = corpusRows.get(paperId);
    if (!row) {
      return true;
    }
    return !Boolean(row.doi || row.url || row.landing_url || row.pdf_url);
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
