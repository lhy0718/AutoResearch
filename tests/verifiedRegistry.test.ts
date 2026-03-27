import { describe, expect, it } from "vitest";

import {
  buildVerifiedRegistry,
  buildVerifiedRegistryWithExternalLookup
} from "../src/core/analysis/verifiedRegistry.js";

describe("buildVerifiedRegistry", () => {
  it("accepts directly matched corpus rows with stable locators as verified", () => {
    const artifact = buildVerifiedRegistry({
      citedPaperIds: ["paper_1"],
      corpus: [
        {
          paper_id: "paper_1",
          title: "Structured Coordination for Agents",
          abstract: "Test abstract.",
          authors: ["Alice Doe"],
          year: 2025,
          venue: "ACL",
          doi: "10.1000/coordination",
          bibtex: "@article{coordination2025,title={Structured Coordination for Agents}}"
        }
      ]
    });

    expect(artifact.counts.verified).toBe(1);
    expect(artifact.entries[0]).toMatchObject({
      citation_paper_id: "paper_1",
      resolved_paper_id: "paper_1",
      status: "verified",
      repaired: false,
      bibtex_mode: "stored"
    });
  });

  it("records a bounded repair when a citation can only be recovered by title match and generated bibtex", () => {
    const artifact = buildVerifiedRegistry({
      citedPaperIds: ["Structured Coordination for Agents"],
      corpus: [
        {
          paper_id: "paper_1",
          title: "Structured Coordination for Agents",
          abstract: "Test abstract.",
          authors: ["Alice Doe"],
          year: 2025,
          venue: "ACL"
        }
      ]
    });

    expect(artifact.counts.unverified + artifact.counts.inferred).toBe(1);
    expect(artifact.entries[0]).toMatchObject({
      citation_paper_id: "Structured Coordination for Agents",
      resolved_paper_id: "paper_1",
      repaired: true,
      bibtex_mode: "generated"
    });
    expect(artifact.entries[0]?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "lookup_by_paper_id", outcome: "rejected" }),
        expect.objectContaining({ action: "lookup_by_title", outcome: "repaired" }),
        expect.objectContaining({ action: "repair_with_generated_bibtex", outcome: "repaired" })
      ])
    );
  });

  it("blocks citations that cannot be resolved from stored source metadata", () => {
    const artifact = buildVerifiedRegistry({
      citedPaperIds: ["missing_paper"],
      corpus: []
    });

    expect(artifact.counts.blocked).toBe(1);
    expect(artifact.blocked_citation_paper_ids).toEqual(["missing_paper"]);
    expect(artifact.entries[0]?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "lookup_by_paper_id", outcome: "rejected" }),
        expect.objectContaining({ action: "lookup_by_title", outcome: "rejected" })
      ])
    );
  });

  it("recovers blocked title citations through a bounded external lookup and returns supplemental corpus rows", async () => {
    const result = await buildVerifiedRegistryWithExternalLookup({
      citedPaperIds: ["Recovered External Title"],
      corpus: [],
      externalProviders: {
        semanticScholar: {
          async searchPapers() {
            return [
              {
                paperId: "s2_recovered",
                title: "Recovered External Title",
                abstract: "Recovered from Semantic Scholar.",
                authors: ["Eve Resolver"],
                year: 2025,
                venue: "ACL",
                doi: "10.1000/recovered",
                url: "https://example.org/recovered",
                citationStylesBibtex: "@article{recovered,title={Recovered External Title}}"
              }
            ];
          }
        }
      }
    });

    expect(result.artifact.counts.unverified).toBe(1);
    expect(result.artifact.entries[0]).toMatchObject({
      citation_paper_id: "Recovered External Title",
      resolved_via: "external_provider",
      provider: "semantic_scholar",
      bibtex_mode: "stored",
      status: "unverified"
    });
    expect(result.supplemental_corpus_rows).toHaveLength(1);
    expect(result.supplemental_corpus_rows[0]).toMatchObject({
      title: "Recovered External Title",
      doi: "10.1000/recovered"
    });
  });

  it("promotes exact DOI matches from bounded external lookup to verified", async () => {
    const result = await buildVerifiedRegistryWithExternalLookup({
      citedPaperIds: ["10.1000/exact-doi"],
      corpus: [],
      externalProviders: {
        crossref: {
          async searchPapers() {
            return [
              {
                provider: "crossref",
                providerId: "10.1000/exact-doi",
                title: "Exact DOI Match",
                authors: ["Dana DOI"],
                year: 2024,
                doi: "10.1000/exact-doi",
                url: "https://doi.org/10.1000/exact-doi"
              }
            ];
          }
        }
      }
    });

    expect(result.artifact.counts.verified).toBe(1);
    expect(result.artifact.entries[0]).toMatchObject({
      citation_paper_id: "10.1000/exact-doi",
      status: "verified",
      resolved_via: "external_provider",
      provider: "crossref"
    });
  });

  it("keeps blocked citations blocked after two failed external repair attempts", async () => {
    const result = await buildVerifiedRegistryWithExternalLookup({
      citedPaperIds: ["Still Missing Title"],
      corpus: [],
      externalProviders: {
        semanticScholar: {
          async searchPapers() {
            return [];
          }
        },
        openAlex: {
          async searchPapers() {
            return [];
          }
        },
        crossref: {
          async searchPapers() {
            return [];
          }
        }
      }
    });

    expect(result.artifact.counts.blocked).toBe(1);
    expect(
      result.artifact.entries[0]?.attempts.filter((attempt) => attempt.action.startsWith("lookup_external_"))
    ).toHaveLength(2);
    expect(result.supplemental_corpus_rows).toEqual([]);
  });
});
