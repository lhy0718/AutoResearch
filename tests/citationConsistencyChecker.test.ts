import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { checkCitationConsistency } from "../src/core/analysis/citationConsistencyChecker.js";

async function makeRunDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const runDir = path.join(root, ".autolabos", "runs", "run-1");
  await mkdir(path.join(runDir, "paper"), { recursive: true });
  return runDir;
}

describe("citationConsistencyChecker", () => {
  it("fails when main.tex cites a bibliography key that does not exist in references.bib", async () => {
    const runDir = await makeRunDir("autolabos-citation-orphan-");
    await writeFile(
      path.join(runDir, "paper", "main.tex"),
      "\\section{Intro}\nWe build on prior work \\cite{missing_ref}.",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "paper", "references.bib"),
      "@article{present_ref,\n  title = {Present Ref}\n}\n",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "paper", "evidence_links.json"),
      JSON.stringify({ claims: [] }, null, 2),
      "utf8"
    );

    const report = checkCitationConsistency(runDir);

    expect(report.status).toBe("fail");
    expect(report.orphan_citations).toEqual(["missing_ref"]);
  });

  it("reports unchecked sources when evidence links cite corpus rows without DOI or URL metadata", async () => {
    const runDir = await makeRunDir("autolabos-citation-unchecked-");
    await writeFile(
      path.join(runDir, "paper", "main.tex"),
      "\\section{Intro}\nWe build on prior work \\cite{paper_1}.",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "paper", "references.bib"),
      "@article{paper_1,\n  title = {Paper 1}\n}\n",
      "utf8"
    );
    await writeFile(
      path.join(runDir, "paper", "evidence_links.json"),
      JSON.stringify({
        claims: [
          {
            claim_id: "c1",
            citation_paper_ids: ["paper_1"]
          }
        ]
      }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(runDir, "corpus.jsonl"),
      `${JSON.stringify({
        paper_id: "paper_1",
        title: "Paper 1",
        abstract: "A paper without source metadata.",
        authors: ["Alice"]
      })}\n`,
      "utf8"
    );

    const report = checkCitationConsistency(runDir);

    expect(report.status).toBe("pass");
    expect(report.orphan_citations).toEqual([]);
    expect(report.unchecked_sources).toEqual(["paper_1"]);
  });
});
