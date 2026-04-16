import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryEventStream } from "../src/core/events.js";
import { MockLLMClient } from "../src/core/llm/client.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { PaperWriterSessionManager } from "../src/core/agents/paperWriterSessionManager.js";
import { CodexNativeClient } from "../src/integrations/codex/codexCliClient.js";
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

class RecordingLLMClient extends MockLLMClient {
  public readonly systemPrompts: string[] = [];
  public readonly prompts: string[] = [];
  private index = 0;

  constructor(private readonly responses: string[]) {
    super();
  }

  override async complete(_prompt: string, opts?: { systemPrompt?: string }): Promise<{ text: string }> {
    this.prompts.push(_prompt);
    this.systemPrompts.push(opts?.systemPrompt || "");
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
  it("appends the LaTeX template section order hint to the paper-writer system prompt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-session-template-"));
    process.chdir(root);

    const runId = "run-paper-session-template";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(path.join(runDir, "memory", "run_context.json"), JSON.stringify({ version: 1, items: [] }), "utf8");

    const llm = new RecordingLLMClient([
      JSON.stringify({
        title: "Template-guided Paper Writer",
        abstract_focus: ["agent collaboration", "reproducibility"],
        section_headings: ["Introduction", "Method", "Results"],
        key_claim_themes: ["Structured coordination improves reproducibility."],
        citation_plan: ["paper_1"]
      }),
      JSON.stringify({
        title: "Template-guided Paper Writer",
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
      }),
      JSON.stringify({
        summary: "The draft is coherent.",
        revision_notes: [],
        unsupported_claims: [],
        missing_sections: [],
        missing_citations: []
      }),
      JSON.stringify({
        title: "Template-guided Paper Writer",
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
      }),
      JSON.stringify({
        title: "Template-guided Paper Writer",
        abstract: "A polished manuscript with template order guidance.",
        keywords: ["agent collaboration", "reproducibility"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: ["This draft studies session-backed paper writing."]
          },
          {
            heading: "Method",
            paragraphs: ["The writer uses staged drafting with a persistent thread."]
          },
          {
            heading: "Results",
            paragraphs: ["The thread is preserved across drafting turns."]
          }
        ]
      })
    ]);

    const manager = new PaperWriterSessionManager({
      config: {
        providers: {
          llm_mode: "openai_api"
        }
      } as any,
      codex: {} as any,
      llm,
      eventStream: new InMemoryEventStream(),
      runStore: {
        async getRun() {
          return run;
        },
        async updateRun() {}
      } as any,
      workspaceRoot: root
    });

    await manager.run({
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
        collect: { dateRange: null, year: null, lastYears: null, fieldsOfStudy: [], openAccessOnly: false, minCitationCount: null, limit: 20 },
        experiment: { maxRuns: 1, maxRuntimeMinutes: 30, requireBaseline: true },
        writing: { targetVenue: "generic_ml_conference", toneHint: "formal", lengthHint: "paper" }
      } as any,
      objectiveMetricProfile: {
        primaryMetric: "reproducibility_score",
        targetDescription: "Higher is better",
        paperEmphasis: "prioritize reproducibility gains"
      } as any,
      latexTemplateSectionOrder: ["Introduction", "Method", "Results"],
      appendixKeepInMainBody: ["main_result_tables", "primary_ablation"]
    });

    expect(
      llm.systemPrompts.some((prompt) =>
        prompt.includes("This paper uses a custom LaTeX template. Prefer this section order: Introduction, Method, Results.")
      )
    ).toBe(true);
    expect(
      llm.prompts.some((prompt) =>
        prompt.includes("Keep these items in the main body when possible: main_result_tables, primary_ablation")
      )
    ).toBe(true);
  });

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
      codex: new CodexNativeClient(root),
      llm: {} as any,
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

    expect(result.source).toBe("codex_native");
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
    } satisfies Pick<CodexNativeClient, "runTurnStream">;

    const manager = new PaperWriterSessionManager({
      config: {
        providers: {
          llm_mode: "codex_chatgpt_only"
        }
      } as any,
      codex: timeoutCodex as CodexNativeClient,
      llm: {} as any,
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

  it("LV-017: uses staged_llm mode when llm_mode is ollama (not codex_native)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-ollama-"));
    process.chdir(root);

    const runId = "run-ollama-mode";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(
      path.join(runDir, "memory", "run_context.json"),
      JSON.stringify({ version: 1, items: [] }),
      "utf8"
    );

    const events: string[] = [];
    const eventStream = new InMemoryEventStream();
    eventStream.subscribe((evt: any) => {
      if (typeof evt?.payload?.text === "string") events.push(evt.payload.text);
    });

    const manager = new PaperWriterSessionManager({
      config: {
        providers: {
          llm_mode: "ollama"
        }
      } as any,
      codex: new CodexNativeClient(root),
      llm: new MockLLMClient(),
      eventStream,
      runStore: {
        async getRun(id: string) {
          return id === run.id ? run : undefined;
        },
        async updateRun() {}
      } as any,
      workspaceRoot: root
    });

    // Use a very short timeout to make the test fast — we only care about mode selection
    process.env.AUTOLABOS_PAPER_WRITER_STAGE_TIMEOUT_MS = "50";
    process.env.AUTOLABOS_FAKE_CODEX_RESPONSE = JSON.stringify({
      title: "Test",
      sections: [],
      claims: [],
      abstract: "x",
      keywords: []
    });

    try {
      await manager.run({
        run,
        bundle: {
          runTitle: run.title,
          topic: run.topic,
          objectiveMetric: run.objectiveMetric,
          constraints: run.constraints,
          paperSummaries: [],
          experimentDesign: {
            approach: "test",
            protocol: "test",
            conditions: [],
            successCriteria: "test"
          },
          results: { raw: "none" },
          analysisText: "none",
          reviewNotes: [],
          bibtex: "",
          resultAnalysis: { summaryParagraph: "none" },
          reviewPacket: undefined as any,
          contextHints: {
            researchQuestion: "test",
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
          analysisFocus: [],
          paperEmphasis: [],
          assumptions: []
        }
      });
    } catch {
      // Stage failures are expected — we only test mode selection
    }

    const modeMsg = events.find((m) => m.includes("mode"));
    expect(modeMsg).toContain("staged_llm");
    expect(modeMsg).not.toContain("codex_native");
  });

  it("falls back stage-by-stage when staged_llm paper writing hits fetch failed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-openai-fallback-"));
    process.chdir(root);

    const runId = "run-openai-paper-fallback";
    const run = makeRun(runId);
    const runDir = path.join(root, ".autolabos", "runs", runId);
    await mkdir(path.join(runDir, "memory"), { recursive: true });
    await writeFile(
      path.join(runDir, "memory", "run_context.json"),
      JSON.stringify({ version: 1, items: [] }),
      "utf8"
    );

    const events: string[] = [];
    const eventStream = new InMemoryEventStream();
    eventStream.subscribe((evt: any) => {
      if (typeof evt?.payload?.text === "string") events.push(evt.payload.text);
    });

    const manager = new PaperWriterSessionManager({
      config: {
        providers: {
          llm_mode: "openai_api"
        }
      } as any,
      codex: new CodexNativeClient(root),
      llm: {
        async complete() {
          throw new Error("fetch failed");
        }
      } as any,
      eventStream,
      runStore: {
        async getRun(id: string) {
          return id === run.id ? run : undefined;
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

    expect(result.source).toBe("fallback");
    expect(result.stageFallbacks).toBe(5);
    expect(result.trace).toHaveLength(5);
    expect(result.trace.every((entry) => entry.fallbackUsed)).toBe(true);
    expect(result.errors).toEqual([]);
    expect(events.some((line) => line.includes('failed in staged_llm mode: fetch failed'))).toBe(true);
    expect(await readFile(path.join(runDir, "paper", "draft.json"), "utf8")).toContain('"sections"');
    expect(await readFile(path.join(runDir, "paper", "manuscript.session.json"), "utf8")).toContain('"sections"');
  });
});
