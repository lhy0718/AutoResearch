import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildRunLiteratureIndex, writeRunLiteratureIndex } from "../src/core/literatureIndex.js";
import { appendJsonl, writeRunArtifact } from "../src/core/nodes/helpers.js";

describe("literatureIndex", () => {
  it("summarizes corpus, citations, BibTeX, and analysis coverage from run artifacts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-literature-"));
    const runId = "run-1";
    const runDir = path.join(workspace, ".autolabos", "runs", runId);
    await fs.mkdir(runDir, { recursive: true });

    await fs.writeFile(
      path.join(runDir, "corpus.jsonl"),
      [
        JSON.stringify({ paper_id: "p1", title: "Paper one", citation_count: 12, pdf_url: "https://example.com/p1.pdf", bibtex: "@article{p1}", bibtex_source: "doi_content_negotiation", venue: "NeurIPS", year: 2024 }),
        JSON.stringify({ paper_id: "p2", title: "Paper two", citation_count: 8, semantic_scholar_bibtex: "@article{p2}", venue: "ICLR", year: 2025 })
      ].join("\n") + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "collect_result.json"),
      JSON.stringify({ bibtexMode: "hybrid", pdfRecovered: 1, bibtexEnriched: 1, enrichment: { status: "completed" } }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "paper_summaries.jsonl"),
      [
        JSON.stringify({ paper_id: "p1", title: "Paper one", source_type: "full_text", summary: "summary", key_findings: [], limitations: [], datasets: [], metrics: [], novelty: "", reproducibility_notes: [] }),
        JSON.stringify({ paper_id: "p2", title: "Paper two", source_type: "abstract", summary: "summary", key_findings: [], limitations: [], datasets: [], metrics: [], novelty: "", reproducibility_notes: [] })
      ].join("\n") + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "evidence_store.jsonl"),
      JSON.stringify({ evidence_id: "e1", paper_id: "p1", claim: "claim", method_slot: "", result_slot: "", limitation_slot: "", dataset_slot: "", metric_slot: "", evidence_span: "span", source_type: "full_text", confidence: 0.9 }) + "\n",
      "utf8"
    );

    const index = await buildRunLiteratureIndex(workspace, runId);
    expect(index.corpus.paper_count).toBe(2);
    expect(index.corpus.papers_with_pdf).toBe(1);
    expect(index.corpus.papers_with_bibtex).toBe(2);
    expect(index.corpus.enriched_bibtex_count).toBe(1);
    expect(index.citations.total).toBe(20);
    expect(index.citations.top_paper?.title).toBe("Paper one");
    expect(index.analysis.summary_count).toBe(2);
    expect(index.analysis.full_text_summary_count).toBe(1);
    expect(index.analysis.abstract_summary_count).toBe(1);

    const persisted = await writeRunLiteratureIndex(workspace, runId);
    expect(persisted.artifacts.literature_index_path).toBe(`.autolabos/runs/${runId}/literature_index.json`);
    await fs.access(path.join(runDir, "literature_index.json"));

    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("auto-refreshes when collect and analyze artifacts are written through node helpers", async () => {
    const originalCwd = process.cwd();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-literature-auto-"));
    const runId = "run-auto";
    const run = {
      id: runId,
      title: "Auto literature run"
    } as any;

    try {
      process.chdir(workspace);
      await fs.mkdir(path.join(workspace, ".autolabos", "runs", runId), { recursive: true });

      await writeRunArtifact(
        run,
        "collect_result.json",
        JSON.stringify({ bibtexMode: "hybrid", pdfRecovered: 1, bibtexEnriched: 1, enrichment: { status: "completed" } }, null, 2)
      );
      await appendJsonl(run, "corpus.jsonl", [
        {
          paper_id: "p1",
          title: "Paper one",
          citation_count: 5,
          pdf_url: "https://example.com/p1.pdf",
          bibtex: "@article{p1}",
          venue: "ICLR",
          year: 2025
        }
      ]);

      let rawIndex = JSON.parse(
        await fs.readFile(path.join(workspace, ".autolabos", "runs", runId, "literature_index.json"), "utf8")
      );
      expect(rawIndex.corpus.paper_count).toBe(1);
      expect(rawIndex.analysis.summary_count).toBe(0);

      await appendJsonl(run, "paper_summaries.jsonl", [
        {
          paper_id: "p1",
          title: "Paper one",
          source_type: "full_text",
          summary: "summary",
          key_findings: [],
          limitations: [],
          datasets: [],
          metrics: [],
          novelty: "",
          reproducibility_notes: []
        }
      ]);
      await appendJsonl(run, "evidence_store.jsonl", [
        {
          evidence_id: "e1",
          paper_id: "p1",
          claim: "claim",
          method_slot: "",
          result_slot: "",
          limitation_slot: "",
          dataset_slot: "",
          metric_slot: "",
          evidence_span: "span",
          source_type: "full_text",
          confidence: 0.9
        }
      ]);

      rawIndex = JSON.parse(
        await fs.readFile(path.join(workspace, ".autolabos", "runs", runId, "literature_index.json"), "utf8")
      );
      expect(rawIndex.analysis.summary_count).toBe(1);
      expect(rawIndex.analysis.evidence_count).toBe(1);
    } finally {
      process.chdir(originalCwd);
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
