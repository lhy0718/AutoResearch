import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { LLMClient, LLMCompleteOptions, MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { createWritePaperNode } from "../src/core/nodes/writePaper.js";
import { buildPublicPaperDir } from "../src/core/publicArtifacts.js";
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
      confidence: 0.92
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

function createPdfBuildAci(options?: { failFirstCompile?: boolean }) {
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
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex"
    ]);

    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(true);
    expect(await exists(path.join(runDir, "paper", "compile_report.json"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "build.log"))).toBe(true);

    const report = JSON.parse(await readFile(path.join(runDir, "paper", "compile_report.json"), "utf8")) as {
      status: string;
      repaired: boolean;
      attempts: Array<{ status: string }>;
    };
    expect(report.status).toBe("success");
    expect(report.repaired).toBe(false);
    expect(report.attempts).toHaveLength(1);

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.compile_status")).toBe("success");
    expect(await memory.get("write_paper.pdf_path")).toBe(
      path.join(".autolabos", "runs", run.id, "paper", "main.pdf")
    );
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
      "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex"
    ]);

    const repairedTex = await readFile(path.join(runDir, "paper", "latex_repair.tex"), "utf8");
    expect(repairedTex).toContain("Repaired paper draft.");
    expect(await exists(path.join(runDir, "paper", "main.pdf"))).toBe(true);
    expect(await exists(path.join(buildPublicPaperDir(root, run), "main.pdf"))).toBe(true);

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
  });
});
