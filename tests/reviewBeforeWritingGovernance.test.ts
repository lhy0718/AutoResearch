import path from "node:path";
import { tmpdir } from "node:os";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { createWritePaperNode } from "../src/core/nodes/writePaper.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import type { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

describe("review-before-writing governance", () => {
  it("blocks write_paper before drafting when governed workflow config has no pre-draft critique", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-review-before-writing-"));
    process.chdir(root);
    const run = makeRun("run-review-before-writing");
    const runDir = path.join(root, ".autolabos", "runs", run.id);
    await seedValidWritePaperInputs(runDir);

    const node = createWritePaperNode({
      config: {
        workflow: {
          mode: "agent_approval",
          wizard_enabled: true,
          approval_mode: "minimal",
          execution_approval_mode: "manual"
        },
        paper: {
          build_pdf: false
        }
      } as any,
      runStore: {} as any,
      eventStream: new InMemoryEventStream(),
      llm: new MockLLMClient(),
      codex: {} as any,
      aci: {} as any,
      semanticScholar: {} as any
    });

    const result = await node.execute({ run, graph: run.graph });

    expect(result.status).toBe("failure");
    expect(result.error).toContain("review/paper_critique.json is required before drafting");
    const eligibility = JSON.parse(
      await readFile(path.join(runDir, "paper", "write_paper_eligibility.json"), "utf8")
    ) as { allowed: boolean; reason: string };
    expect(eligibility.allowed).toBe(false);
    await expect(access(path.join(runDir, "paper", "main.tex"))).rejects.toThrow();
  });
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Review Before Writing",
    topic: "governed research workflow",
    constraints: [],
    objectiveMetric: "accuracy",
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

async function seedValidWritePaperInputs(runDir: string): Promise<void> {
  await mkdir(path.join(runDir, "memory"), { recursive: true });
  await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
  await writeFile(
    path.join(runDir, "paper_summaries.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Governed Writing",
      source_type: "full_text",
      summary: "Review gates prevent unsupported paper-ready claims.",
      key_findings: ["Review gates prevent unsupported paper-ready claims."],
      limitations: ["Small fixture."],
      datasets: ["fixture"],
      metrics: ["accuracy"],
      novelty: "governed workflow",
      reproducibility_notes: ["fixture"]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "evidence_store.jsonl"),
    `${JSON.stringify({
      evidence_id: "ev_1",
      paper_id: "paper_1",
      claim: "Review gates prevent unsupported paper-ready claims.",
      evidence_span: "Review gates prevent unsupported paper-ready claims.",
      source_type: "full_text",
      confidence: 0.8
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "hypotheses.jsonl"),
    `${JSON.stringify({
      hypothesis_id: "h_1",
      text: "Review-before-writing improves claim discipline.",
      evidence_links: ["ev_1"]
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "corpus.jsonl"),
    `${JSON.stringify({
      paper_id: "paper_1",
      title: "Governed Writing",
      abstract: "Review gates prevent unsupported paper-ready claims.",
      authors: ["Test Author"],
      year: 2026,
      venue: "TestConf"
    })}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runDir, "experiment_plan.yaml"),
    ["selected_design:", '  title: "Review gate fixture"', '  summary: "Check review-before-writing enforcement."'].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(runDir, "result_analysis.json"),
    JSON.stringify({
      overview: {
        objective_status: "met",
        objective_summary: "Fixture objective met.",
        execution_runs: 1
      },
      primary_findings: [
        {
          id: "f1",
          title: "Review gate fixture",
          finding: "Review gate fixture generated.",
          confidence: 0.8,
          source: "fixture"
        }
      ],
      condition_comparisons: [],
      paper_claims: [],
      limitations: [],
      warnings: [],
      shortlisted_designs: [],
      recommendations: []
    }),
    "utf8"
  );
}
