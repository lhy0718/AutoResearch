import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { PaperWriterSessionManager } from "../src/core/agents/paperWriterSessionManager.js";
import { CodexCliClient } from "../src/integrations/codex/codexCliClient.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord } from "../src/types.js";

const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.AUTOLABOS_FAKE_CODEX_RESPONSE;
  delete process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE;
  delete process.env.AUTOLABOS_FAKE_CODEX_THREAD_ID;
  delete process.env.AUTOLABOS_PAPER_WRITER_STAGE_TIMEOUT_MS;
});

function makeRun(runId: string): RunRecord {
  return {
    version: 3,
    workflowVersion: 3,
    id: runId,
    title: "Session-backed Paper Writer",
    topic: "agent collaboration",
    constraints: ["formal tone"],
    objectiveMetric: "reproducibility_score >= 0.8",
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

describe("PaperWriterSessionManager", () => {
  it("stores and reuses a codex thread for staged paper writing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-session-"));
    process.chdir(root);

    const runId = "run-paper-session";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");

    process.env.AUTOLABOS_FAKE_CODEX_RESPONSE_SEQUENCE = JSON.stringify([
      {
        title: "Session-backed Paper Writer",
        abstract_focus: ["agent collaboration", "reproducibility"],
        section_headings: ["Introduction", "Method", "Results", "Conclusion"],
        key_claim_themes: ["Structured coordination improves reproducibility."],
        citation_plan: ["paper_1"]
      },
      {
        title: "Session-backed Paper Writer",
        abstract: "A staged paper-writing session grounded in evidence.",
        keywords: ["agent collaboration", "reproducibility"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["This draft studies session-backed paper writing."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Method",
            paragraphs: ["The writer uses staged drafting with a persistent thread."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Results",
            paragraphs: ["The thread is preserved across drafting turns."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Conclusion",
            paragraphs: ["Persistent sessions improve revisability."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ],
        claims: [
          {
            claim_id: "c1",
            statement: "Persistent paper-writing sessions improve revisability.",
            section_heading: "Results",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ]
      },
      {
        summary: "The draft is coherent.",
        revision_notes: ["Preserve the staged-session framing."],
        unsupported_claims: [],
        missing_sections: [],
        missing_citations: []
      },
      {
        title: "Session-backed Paper Writer",
        abstract: "A staged paper-writing session grounded in evidence.",
        keywords: ["agent collaboration", "reproducibility"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["This draft studies session-backed paper writing."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Method",
            paragraphs: ["The writer uses staged drafting with a persistent thread."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Results",
            paragraphs: ["The thread is preserved across drafting turns."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          },
          {
            heading: "Conclusion",
            paragraphs: ["Persistent sessions improve revisability."],
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ],
        claims: [
          {
            claim_id: "c1",
            statement: "Persistent paper-writing sessions improve revisability.",
            section_heading: "Results",
            evidence_ids: ["ev_1"],
            citation_paper_ids: ["paper_1"]
          }
        ]
      }
    ]);

    let storedRun: RunRecord = { ...run, nodeThreads: { ...run.nodeThreads } };
    const manager = new PaperWriterSessionManager({
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only"
        }
      } as any,
      codex: new CodexCliClient(root),
      llm: new MockLLMClient(),
      eventStream: new InMemoryEventStream(),
      runStore: {
        async getRun(id: string) {
          return id === storedRun.id ? storedRun : undefined;
        },
        async updateRun(next: RunRecord) {
          storedRun = { ...next, nodeThreads: { ...next.nodeThreads } };
        }
      } as any,
      workspaceRoot: root
    });

    const result = await manager.run({
      run,
      bundle: {
        runTitle: run.title,
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        constraints: run.constraints,
        paperSummaries: [
          {
            paper_id: "paper_1",
            title: "Schema Bench",
            source_type: "full_text",
            summary: "Schema-backed coordination improves reproducibility.",
            key_findings: ["Structured coordination improves reproducibility."],
            limitations: [],
            datasets: ["AgentBench-mini"],
            metrics: ["reproducibility_score"],
            novelty: "Persistent coordination state",
            reproducibility_notes: ["Repeated trials are reported."]
          }
        ],
        evidenceRows: [
          {
            evidence_id: "ev_1",
            paper_id: "paper_1",
            claim: "Structured coordination improves reproducibility.",
            method_slot: "shared state schema",
            result_slot: "higher reproducibility_score",
            limitation_slot: "small benchmark",
            dataset_slot: "AgentBench-mini",
            metric_slot: "reproducibility_score",
            evidence_span: "Repeated trials improved reproducibility_score.",
            source_type: "full_text",
            confidence: 0.9
          }
        ],
        hypotheses: [
          {
            hypothesis_id: "h_1",
            text: "Persistent coordination improves reproducibility.",
            evidence_links: ["ev_1"]
          }
        ],
        corpus: [
          {
            paper_id: "paper_1",
            title: "Schema Bench",
            abstract: "Schema-backed coordination improves reproducibility.",
            authors: ["Alice Doe"],
            year: 2025,
            venue: "ACL"
          }
        ],
        experimentPlan: {
          selectedTitle: "Schema benchmark",
          selectedSummary: "Compare persistent schemas with a baseline.",
          rawText: ""
        },
        resultAnalysis: {
          objective_metric: {
            evaluation: {
              summary: "Objective metric met: reproducibility_score=0.88 >= 0.8."
            }
          }
        }
      },
      constraintProfile: {
        source: "heuristic_fallback",
        collect: {
          dateRange: null,
          year: null,
          lastYears: null,
          fieldsOfStudy: [],
          venues: [],
          publicationTypes: [],
          minCitationCount: null,
          openAccessPdf: null
        },
        writing: {
          targetVenue: "ACL",
          toneHint: "formal academic",
          lengthHint: "short paper"
        },
        experiment: {
          designNotes: [],
          implementationNotes: [],
          evaluationNotes: []
        },
        assumptions: []
      },
      objectiveMetricProfile: {
        source: "heuristic_fallback",
        raw: run.objectiveMetric,
        primaryMetric: "reproducibility_score",
        preferredMetricKeys: ["reproducibility_score"],
        direction: "maximize",
        comparator: ">=",
        targetValue: 0.8,
        targetDescription: ">= 0.8",
        analysisFocus: ["Center the results analysis on reproducibility_score."],
        paperEmphasis: ["Highlight reproducibility improvements."],
        assumptions: []
      }
    });

    expect(result.source).toBe("codex_session");
    expect(result.threadId).toBe("fake-thread");
    expect(result.trace).toHaveLength(5);
    expect(result.draft.title).toBe("Schema Benchmark: A Reproducibility Study of Agent Collaboration");
    expect(result.draft.title).not.toBe(run.title);
    expect(result.draft.sections[0]?.heading).toBe("Introduction");
    expect(result.manuscript.title).toBe("Schema Benchmark: A Reproducibility Study of Agent Collaboration");
    expect(result.manuscript.title).not.toBe(run.title);
    expect(result.manuscript.sections[0]?.heading).toBe("Introduction");
    expect(storedRun.nodeThreads.write_paper).toBe("fake-thread");

    const memory = new RunContextMemory(run.memoryRefs.runContextPath);
    expect(await memory.get("write_paper.thread_id")).toBe("fake-thread");

    const traceRaw = await readFile(path.join(runDir, "paper", "session_trace.json"), "utf8");
    expect(traceRaw).toContain('"stage": "outline"');
    expect(traceRaw).toContain('"stage": "polish"');
    expect(traceRaw).toContain('"threadId": "fake-thread"');
  });

  it("falls back when a codex-backed stage exceeds the paper-writer timeout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-session-timeout-"));
    process.chdir(root);

    const runId = "run-paper-session-timeout";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");
    process.env.AUTOLABOS_PAPER_WRITER_STAGE_TIMEOUT_MS = "20";

    let callCount = 0;
    const timeoutCodex = {
      async runTurnStream(args: { abortSignal?: AbortSignal }) {
        callCount += 1;
        if (callCount === 1) {
          return {
            finalText: JSON.stringify({
              title: "Timeout-safe Paper Writer",
              abstract_focus: ["agent collaboration"],
              section_headings: ["Introduction", "Method", "Results", "Conclusion"],
              key_claim_themes: ["Fallbacks keep the pipeline moving."],
              citation_plan: ["paper_1"]
            }),
            threadId: "timeout-thread"
          };
        }
        return await new Promise<never>((_, reject) => {
          args.abortSignal?.addEventListener(
            "abort",
            () => reject(args.abortSignal?.reason ?? new Error("aborted")),
            { once: true }
          );
        });
      }
    } satisfies Pick<CodexCliClient, "runTurnStream">;

    const manager = new PaperWriterSessionManager({
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only"
        }
      } as any,
      codex: timeoutCodex as CodexCliClient,
      llm: new MockLLMClient(),
      eventStream: new InMemoryEventStream(),
      runStore: {
        async getRun() {
          return run;
        },
        async updateRun() {}
      } as any,
      workspaceRoot: root
    });

    const result = await manager.run({
      run,
      bundle: {
        runTitle: run.title,
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        constraints: run.constraints,
        paperSummaries: [
          {
            paper_id: "paper_1",
            title: "Schema Bench",
            source_type: "full_text",
            summary: "Schema-backed coordination improves reproducibility.",
            key_findings: ["Structured coordination improves reproducibility."],
            limitations: [],
            datasets: ["AgentBench-mini"],
            metrics: ["reproducibility_score"],
            novelty: "Persistent coordination state",
            reproducibility_notes: ["Repeated trials are reported."]
          }
        ],
        evidenceRows: [
          {
            evidence_id: "ev_1",
            paper_id: "paper_1",
            claim: "Structured coordination improves reproducibility.",
            method_slot: "shared state schema",
            result_slot: "higher reproducibility_score",
            limitation_slot: "small benchmark",
            dataset_slot: "AgentBench-mini",
            metric_slot: "reproducibility_score",
            evidence_span: "Repeated trials improved reproducibility_score.",
            source_type: "full_text",
            confidence: 0.9
          }
        ],
        hypotheses: [
          {
            hypothesis_id: "h_1",
            text: "Persistent coordination improves reproducibility.",
            evidence_links: ["ev_1"]
          }
        ],
        corpus: [
          {
            paper_id: "paper_1",
            title: "Schema Bench",
            abstract: "Schema-backed coordination improves reproducibility.",
            authors: ["Alice Doe"],
            year: 2025,
            venue: "ACL"
          }
        ],
        experimentPlan: {
          selectedTitle: "Schema benchmark",
          selectedSummary: "Compare persistent schemas with a baseline.",
          rawText: ""
        },
        resultAnalysis: {
          objective_metric: {
            evaluation: {
              summary: "Objective metric met: reproducibility_score=0.88 >= 0.8."
            }
          }
        }
      },
      constraintProfile: {
        source: "heuristic_fallback",
        collect: {
          dateRange: null,
          year: null,
          lastYears: null,
          fieldsOfStudy: [],
          venues: [],
          publicationTypes: [],
          minCitationCount: null,
          openAccessPdf: null
        },
        writing: {
          targetVenue: "ACL",
          toneHint: "formal academic",
          lengthHint: "short paper"
        },
        experiment: {
          designNotes: [],
          implementationNotes: [],
          evaluationNotes: []
        },
        assumptions: []
      },
      objectiveMetricProfile: {
        source: "heuristic_fallback",
        raw: run.objectiveMetric,
        primaryMetric: "reproducibility_score",
        preferredMetricKeys: ["reproducibility_score"],
        direction: "maximize",
        comparator: ">=",
        targetValue: 0.8,
        targetDescription: ">= 0.8",
        analysisFocus: ["Center the results analysis on reproducibility_score."],
        paperEmphasis: ["Highlight reproducibility improvements."],
        assumptions: []
      }
    });

    expect(result.stageFallbacks).toBeGreaterThanOrEqual(1);
    expect(result.trace.some((entry) => entry.stage === "draft" && entry.error?.includes("exceeded the 20ms timeout"))).toBe(true);
    expect(result.manuscript.title).toBeTruthy();
    expect(await readFile(path.join(runDir, "paper", "draft.json"), "utf8")).toContain('"sections"');
  });
});
