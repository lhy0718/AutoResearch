import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureScaffold, resolveAppPaths } from "../src/config.js";
import { RunContextMemory } from "../src/core/memory/runContextMemory.js";
import { RunStore } from "../src/core/runs/runStore.js";
import { TerminalApp } from "../src/tui/TerminalApp.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";

function makeApp(): any {
  const app = new TerminalApp({
    config: {
      papers: { max_results: 100 },
      providers: {
        llm_mode: "codex_chatgpt_only",
        codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
        openai: { model: "gpt-5.4", reasoning_effort: "medium" }
      }
    } as any,
    runStore: {} as any,
    titleGenerator: {} as any,
    codex: {} as any,
    eventStream: { subscribe: () => () => {} } as any,
    orchestrator: {} as any,
    semanticScholarApiKeyConfigured: false,
    onQuit: () => {},
    saveConfig: async () => {}
  });

  app.render = () => {};
  app.updateSuggestions = () => {};
  app.drainQueuedInputs = async () => {};
  return app;
}

function makeRun(id = "run-1"): any {
  const now = new Date().toISOString();
  const graph = createDefaultGraphState();
  return {
    version: 3,
    workflowVersion: 3,
    id,
    title: "Test run",
    topic: "topic",
    constraints: [],
    objectiveMetric: "metric",
    status: "pending",
    currentNode: graph.currentNode,
    nodeThreads: {},
    createdAt: now,
    updatedAt: now,
    graph,
    memoryRefs: {
      runContextPath: `.autolabos/runs/${id}/memory/run_context.json`,
      longTermPath: `.autolabos/runs/${id}/memory/long_term.jsonl`,
      episodePath: `.autolabos/runs/${id}/memory/episodes.jsonl`
    }
  };
}

describe("TerminalApp pending natural plan execution", () => {
  it("uses selection menus for provider and PDF mode in settings", async () => {
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    const app = new TerminalApp({
      config: {
        papers: { max_results: 100 },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium" }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        research: {
          default_topic: "Multi-agent collaboration",
          default_constraints: ["recent papers", "last 5 years"],
          default_objective_metric: "state-of-the-art reproducibility"
        }
      } as any,
      runStore: {} as any,
      titleGenerator: {} as any,
      codex: {} as any,
      eventStream: { subscribe: () => () => {} } as any,
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: false,
      onQuit: () => {},
      saveConfig
    }) as any;

    app.render = () => {};
    app.updateSuggestions = () => {};
    app.drainQueuedInputs = async () => {};
    app.openSelectionMenu = vi
      .fn()
      .mockResolvedValueOnce("codex_chatgpt_only")
      .mockResolvedValueOnce("codex_text_image_hybrid");
    app.selectCodexSlot = vi
      .fn()
      .mockResolvedValueOnce({ selection: "gpt-5.3-codex", effort: "low" })
      .mockResolvedValueOnce({ selection: "gpt-5.3-codex", effort: "xhigh" })
      .mockResolvedValueOnce({ selection: "gpt-5.3-codex", effort: "xhigh" });

    await app.handleSettings();

    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      1,
      "Select primary LLM provider",
      expect.any(Array),
      "codex_chatgpt_only"
    );
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      2,
      "Select research backend PDF mode",
      expect.any(Array),
      "codex_text_image_hybrid"
    );
    expect(app.config.providers.codex.pdf_model).toBe("gpt-5.3-codex");
    expect(app.config.providers.codex.pdf_reasoning_effort).toBe("xhigh");
    expect(app.config.analysis.pdf_mode).toBe("codex_text_image_hybrid");
    expect(app.selectCodexSlot).toHaveBeenCalledTimes(2);
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  it("asks for OpenAI API reasoning effort when selecting a GPT-5 API model", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    const openAiTextClient = { updateDefaults: vi.fn() };
    const app = new TerminalApp({
      config: {
        papers: { max_results: 100 },
        providers: {
          llm_mode: "openai_api",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium", command_reasoning_effort: "low" }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        research: {
          default_topic: "Multi-agent collaboration",
          default_constraints: ["recent papers", "last 5 years"],
          default_objective_metric: "state-of-the-art reproducibility"
        }
      } as any,
      runStore: {} as any,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: openAiTextClient as any,
      eventStream: { subscribe: () => () => {} } as any,
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: false,
      onQuit: () => {},
      saveConfig
    }) as any;

    app.render = () => {};
    app.updateSuggestions = () => {};
    app.drainQueuedInputs = async () => {};
    app.openSelectionMenu = vi.fn().mockResolvedValueOnce("gpt-5-mini").mockResolvedValueOnce("high");

    await app.handleOpenAiApiModelSelection("task");

    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      1,
      "Select analysis/hypothesis model",
      expect.any(Array),
      "gpt-5.4"
    );
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      2,
      "Select analysis/hypothesis reasoning effort",
      expect.any(Array),
      "medium"
    );
    expect(openAiTextClient.updateDefaults).toHaveBeenCalledWith({
      model: "gpt-5-mini",
      reasoningEffort: "high"
    });
    expect(app.config.providers.openai.command_reasoning_effort).toBe("low");
    expect(app.config.providers.openai.reasoning_effort).toBe("high");
    delete process.env.OPENAI_API_KEY;
  });

  it("shows current slot summary and recommendations before /model selection", async () => {
    const app = makeApp();
    app.openSelectionMenu = vi
      .fn()
      .mockResolvedValueOnce("codex_chatgpt_only")
      .mockResolvedValueOnce(undefined);

    await app.handleModel([]);

    expect(app.logs).toContain("Current model backend: Codex CLI");
    expect(app.logs).toContain("Current model slots:");
    expect(
      app.logs.some((line: string) =>
        line.includes("- general chat:") && line.includes("Recommended: gpt-5.3-codex-spark + medium")
      )
    ).toBe(true);
    expect(
      app.logs.some((line: string) =>
        line.includes("- analysis/hypothesis:") && line.includes("Recommended: gpt-5.4 + xhigh")
      )
    ).toBe(true);
    expect(
      app.logs.some((line: string) =>
        line.includes("- PDF analysis:") && line.includes("Recommended: gpt-5.4 + xhigh")
      )
    ).toBe(true);
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      1,
      "Select model backend",
      expect.any(Array),
      "codex_chatgpt_only"
    );
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      2,
      "Select model slot",
      expect.arrayContaining([
        expect.objectContaining({
          value: "chat",
          description: expect.stringContaining("Recommended: gpt-5.3-codex-spark + medium")
        }),
        expect.objectContaining({
          value: "backend",
          description: expect.stringContaining("Codex text + image hybrid")
        }),
        expect.objectContaining({
          value: "task",
          description: expect.stringContaining("Recommended: gpt-5.4 + xhigh")
        }),
        expect.objectContaining({
          value: "pdf",
          description: expect.stringContaining("Recommended: gpt-5.4 + xhigh")
        })
      ]),
      "backend"
    );
  });

  it("lets /model switch the active backend before choosing a slot", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    const openAiTextClient = { updateDefaults: vi.fn() };
    const app = new TerminalApp({
      config: {
        papers: { max_results: 100 },
        providers: {
          llm_mode: "codex_chatgpt_only",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: { model: "gpt-5.4", reasoning_effort: "medium", command_reasoning_effort: "low" }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        research: {
          default_topic: "Multi-agent collaboration",
          default_constraints: ["recent papers", "last 5 years"],
          default_objective_metric: "state-of-the-art reproducibility"
        }
      } as any,
      runStore: {} as any,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: openAiTextClient as any,
      eventStream: { subscribe: () => () => {} } as any,
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: false,
      onQuit: () => {},
      saveConfig
    }) as any;

    app.render = () => {};
    app.updateSuggestions = () => {};
    app.drainQueuedInputs = async () => {};
    app.openSelectionMenu = vi
      .fn()
      .mockResolvedValueOnce("openai_api")
      .mockResolvedValueOnce("backend")
      .mockResolvedValueOnce("gpt-5-mini")
      .mockResolvedValueOnce("high")
      .mockResolvedValueOnce("codex_text_image_hybrid");

    await app.handleModel([]);

    expect(app.config.providers.llm_mode).toBe("openai_api");
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      1,
      "Select model backend",
      expect.any(Array),
      "codex_chatgpt_only"
    );
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      2,
      "Select model slot",
      expect.any(Array),
      "backend"
    );
    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      5,
      "Select research backend PDF mode",
      expect.any(Array),
      "codex_text_image_hybrid"
    );
    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(openAiTextClient.updateDefaults).toHaveBeenCalledWith({
      model: "gpt-5-mini",
      reasoningEffort: "high"
    });
    expect(app.config.providers.openai.pdf_model).toBe("gpt-5-mini");
    expect(app.config.providers.openai.pdf_reasoning_effort).toBe("high");
    expect(app.config.analysis.pdf_mode).toBe("codex_text_image_hybrid");
    expect(app.logs).toContain("Model backend updated to OpenAI API.");
    delete process.env.OPENAI_API_KEY;
  });

  it("marks recommended presets in OpenAI API model menus", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const saveConfig = vi.fn().mockResolvedValue(undefined);
    const openAiTextClient = { updateDefaults: vi.fn() };
    const app = new TerminalApp({
      config: {
        papers: { max_results: 100 },
        providers: {
          llm_mode: "openai_api",
          codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
          openai: {
            model: "gpt-5.4",
            reasoning_effort: "xhigh",
            chat_model: "gpt-5-mini",
            chat_reasoning_effort: "low",
            command_reasoning_effort: "low"
          }
        },
        analysis: {
          pdf_mode: "codex_text_image_hybrid",
          responses_model: "gpt-5.4"
        },
        research: {
          default_topic: "Multi-agent collaboration",
          default_constraints: ["recent papers", "last 5 years"],
          default_objective_metric: "state-of-the-art reproducibility"
        }
      } as any,
      runStore: {} as any,
      titleGenerator: {} as any,
      codex: {} as any,
      openAiTextClient: openAiTextClient as any,
      eventStream: { subscribe: () => () => {} } as any,
      orchestrator: {} as any,
      semanticScholarApiKeyConfigured: false,
      onQuit: () => {},
      saveConfig
    }) as any;

    app.render = () => {};
    app.updateSuggestions = () => {};
    app.drainQueuedInputs = async () => {};
    app.openSelectionMenu = vi.fn().mockResolvedValueOnce(undefined);

    await app.handleOpenAiApiModelSelection("chat");

    expect(app.openSelectionMenu).toHaveBeenNthCalledWith(
      1,
      "Select general chat model",
      expect.arrayContaining([
        expect.objectContaining({
          value: "gpt-5.4",
          description: expect.stringContaining("Recommended preset.")
        })
      ]),
      "gpt-5-mini"
    );
    delete process.env.OPENAI_API_KEY;
  });

  it("answers collected-paper count questions directly instead of arming a collect command", async () => {
    const app = makeApp();
    const run = makeRun("run-count");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.readCorpusInsights = vi.fn().mockResolvedValue({
      totalPapers: 42,
      missingPdfCount: 3,
      titles: [],
      topCitation: undefined
    });

    const handled = await app.handleFastNaturalIntent("수집된 논문은 몇건이지?", new AbortController().signal);

    expect(handled).toBe(true);
    expect(app.logs).toContain("The current run has 42 collected papers.");
    expect(app.pendingNaturalCommand).toBeUndefined();
  });

  it("arms a pending confirmation for clear-collected-papers natural requests", async () => {
    const app = makeApp();
    const run = makeRun("run-clear");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.executeParsedSlash = vi.fn();
    app.codex = {
      runForText: async () =>
        JSON.stringify({
          target_run_id: run.id,
          actions: [{ type: "clear", node: "collect_papers" }]
        })
    };

    const handled = await app.handleFastNaturalIntent("수집된 논문들을 모두 지워줘", new AbortController().signal);

    expect(handled).toBe(true);
    expect(app.logs).toContain("Recognized a clear-artifacts request.");
    expect(app.pendingNaturalCommand?.commands).toEqual([`/agent clear collect_papers ${run.id}`]);
    expect(app.executeParsedSlash).not.toHaveBeenCalled();
  });

  it("arms a pending analyze top-n command from structured action extraction", async () => {
    const app = makeApp();
    const run = makeRun("run-analyze");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    const startThinking = vi.spyOn(app, "startThinking" as never);
    const stopThinking = vi.spyOn(app, "stopThinking" as never);
    app.codex = {
      runForText: async () =>
        JSON.stringify({
          target_run_id: run.id,
          actions: [{ type: "analyze_papers", top_n: 30 }]
        })
    };

    const handled = await app.handleFastNaturalIntent("30편 분석 진행해줘", new AbortController().signal);

    expect(handled).toBe(true);
    expect(startThinking).toHaveBeenCalled();
    expect(stopThinking).toHaveBeenCalled();
    expect(app.logs).toContain("Next step ready: Analyze top 30 papers.");
    expect(app.pendingNaturalCommand?.commands).toEqual([`/agent run analyze_papers ${run.id} --top-n 30`]);
    expect(app.pendingNaturalCommand?.displayCommands).toEqual(["Analyze top 30 papers"]);
  });

  it("arms a pending generate_hypotheses command from a natural hypothesis request", async () => {
    const app = makeApp();
    const run = makeRun("run-hypotheses");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);

    const handled = await app.handleFastNaturalIntent("가설을 10개 뽑아줘", new AbortController().signal);

    expect(handled).toBe(true);
    expect(app.logs).toContain("Preparing to generate 10 hypotheses.");
    expect(app.pendingNaturalCommand?.commands).toEqual([
      `/agent run generate_hypotheses ${run.id} --top-k 10 --branch-count 10`
    ]);
    expect(app.pendingNaturalCommand?.displayCommands).toEqual(["Generate hypotheses (topK=10, branchCount=10)"]);
  });

  it("does not surface structured-action timeout errors in the log", async () => {
    const app = makeApp();
    const run = makeRun("run-timeout");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.readCorpusInsights = vi.fn().mockResolvedValue({
      totalPapers: 0,
      missingPdfCount: 0,
      titles: [],
      topCitation: undefined
    });
    app.codex = {
      runForText: vi.fn().mockRejectedValue(new Error("Action intent timeout after 12s"))
    };

    const handled = await app.handleFastNaturalIntent("지금 나온 가설들을 확인해줘", new AbortController().signal);

    expect(handled).toBe(true);
    expect(app.logs.some((line: string) => line.includes("Structured action extraction failed"))).toBe(false);
  });

  it("answers saved hypothesis list questions from hypotheses.jsonl without mentioning conflicting summaries", async () => {
    const app = makeApp();
    const run = makeRun("run-hypothesis-list");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.readHypothesisInsights = vi.fn().mockResolvedValue({
      totalHypotheses: 3,
      texts: ["Hypothesis A", "Hypothesis B", "Hypothesis C"]
    });

    const handled = await app.handleFastNaturalIntent("지금 나온 가설들을 확인해줘", new AbortController().signal);

    expect(handled).toBe(true);
    expect(app.logs).toContain("Showing 3 of 3 saved hypotheses.");
    expect(app.logs).toContain("1. Hypothesis A");
    expect(app.logs.some((line: string) => line.includes("6개라고"))).toBe(false);
  });

  it("stores top-k and branch-count request for /agent run generate_hypotheses", async () => {
    const app = makeApp();
    const run = makeRun("run-generate-options");
    run.currentNode = "generate_hypotheses";
    run.graph.currentNode = "generate_hypotheses";
    await rm(path.join(".autolabos", "runs", run.id), { recursive: true, force: true });
    await mkdir(path.dirname(run.memoryRefs.runContextPath), { recursive: true });

    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.continueSupervisedRun = vi.fn().mockResolvedValue({
      ...run,
      graph: {
        ...run.graph,
        nodeStates: {
          ...run.graph.nodeStates,
          generate_hypotheses: {
            ...run.graph.nodeStates.generate_hypotheses,
            status: "completed",
            note: "hypotheses generated"
          }
        }
      }
    });
    app.orchestrator = {
      jumpToNode: vi.fn()
    };

    const result = await app.handleAgent(["run", "generate_hypotheses", "--top-k", "3", "--branch-count", "8"]);

    expect(result.ok).toBe(true);
    expect(app.continueSupervisedRun).toHaveBeenCalledWith(run.id, undefined);
    expect(app.orchestrator.jumpToNode).not.toHaveBeenCalled();

    const stored = JSON.parse(await readFile(run.memoryRefs.runContextPath, "utf8"));
    const requestItem = stored.items.find((item: { key: string }) => item.key === "generate_hypotheses.request");
    expect(requestItem?.value).toEqual({ topK: 3, branchCount: 8 });
  });

  it("force-jumps to the requested node before continuing the supervised run", async () => {
    const app = makeApp();
    const run = makeRun("run-force-jump");
    run.currentNode = "analyze_results";
    run.graph.currentNode = "analyze_results";

    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.continueSupervisedRun = vi.fn().mockResolvedValue({
      ...run,
      currentNode: "write_paper",
      graph: {
        ...run.graph,
        currentNode: "write_paper",
        nodeStates: {
          ...run.graph.nodeStates,
          write_paper: {
            ...run.graph.nodeStates.write_paper,
            status: "completed",
            note: "paper generated"
          }
        }
      }
    });
    app.orchestrator = {
      jumpToNode: vi.fn().mockResolvedValue(run)
    };

    const result = await app.handleAgent(["run", "write_paper", run.id]);

    expect(result.ok).toBe(true);
    expect(app.orchestrator.jumpToNode).toHaveBeenCalledWith(run.id, "write_paper", "force", "manual node run");
    expect(app.refreshRunIndex).toHaveBeenCalled();
    expect(app.continueSupervisedRun).toHaveBeenCalledWith(run.id, undefined);
  });

  it("auto-continues after /agent collect recovery advances past collect_papers", async () => {
    const app = makeApp();
    const run = makeRun("run-collect-recovery");
    run.status = "paused";
    run.currentNode = "collect_papers";
    run.graph.currentNode = "collect_papers";
    run.graph.nodeStates.collect_papers.status = "pending";

    const advancedRun = {
      ...run,
      status: "running",
      currentNode: "analyze_papers",
      graph: {
        ...run.graph,
        currentNode: "analyze_papers",
        nodeStates: {
          ...run.graph.nodeStates,
          collect_papers: {
            ...run.graph.nodeStates.collect_papers,
            status: "completed",
            note: "Semantic Scholar stored 20 papers."
          },
          analyze_papers: {
            ...run.graph.nodeStates.analyze_papers,
            status: "pending"
          }
        }
      }
    };

    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.readCorpusCount = vi.fn().mockResolvedValue(12);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.continueSupervisedRun = vi.fn().mockResolvedValue(advancedRun);
    app.runStore = {
      getRun: vi.fn().mockResolvedValue(advancedRun)
    } as any;
    app.orchestrator = {
      jumpToNode: vi.fn().mockResolvedValue(undefined),
      runAgentWithOptions: vi.fn().mockResolvedValue({
        run,
        result: {
          status: "success",
          summary: "Semantic Scholar stored 20 papers."
        }
      })
    };

    const result = await app.handleAgent(["collect", "--limit", "20", "--run", run.id]);

    expect(result).toEqual({ ok: true });
    expect(app.runStore.getRun).toHaveBeenCalledWith(run.id);
    expect(app.continueSupervisedRun).toHaveBeenCalledWith(run.id, undefined);
  });

  it("does not auto-continue after /agent collect when the run remains on collect_papers", async () => {
    const app = makeApp();
    const run = makeRun("run-collect-stays-put");
    run.status = "paused";
    run.currentNode = "collect_papers";
    run.graph.currentNode = "collect_papers";
    run.graph.nodeStates.collect_papers.status = "pending";

    const refreshedRun = {
      ...run,
      status: "paused",
      currentNode: "collect_papers",
      graph: {
        ...run.graph,
        currentNode: "collect_papers",
        nodeStates: {
          ...run.graph.nodeStates,
          collect_papers: {
            ...run.graph.nodeStates.collect_papers,
            status: "needs_approval",
            note: "Review collected corpus before continuing."
          }
        }
      }
    };

    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.readCorpusCount = vi.fn().mockResolvedValue(12);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.continueSupervisedRun = vi.fn();
    app.runStore = {
      getRun: vi.fn().mockResolvedValue(refreshedRun)
    } as any;
    app.orchestrator = {
      jumpToNode: vi.fn().mockResolvedValue(undefined),
      runAgentWithOptions: vi.fn().mockResolvedValue({
        run,
        result: {
          status: "success",
          summary: "Semantic Scholar stored 20 papers."
        }
      })
    };

    const result = await app.handleAgent(["collect", "--limit", "20", "--run", run.id]);

    expect(result).toEqual({ ok: true });
    expect(app.continueSupervisedRun).not.toHaveBeenCalled();
  });

  it("summarizes an existing review packet through /agent review", async () => {
    const app = makeApp();
    const run = makeRun("run-review-command");
    run.status = "paused";
    run.currentNode = "review";
    run.graph.currentNode = "review";
    run.graph.nodeStates.review.status = "pending";

    const reviewDir = path.join(".autolabos", "runs", run.id, "review");
    await rm(path.join(".autolabos", "runs", run.id), { recursive: true, force: true });
    await mkdir(reviewDir, { recursive: true });

    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.refreshActiveRunInsight = vi.fn();
    app.orchestrator = {
      runAgentWithOptions: vi.fn(async () => {
        await writeFile(
          path.join(reviewDir, "review_packet.json"),
          `${JSON.stringify(
            {
              generated_at: "2026-03-10T10:00:00.000Z",
              readiness: {
                status: "warning",
                ready_checks: 4,
                warning_checks: 1,
                blocking_checks: 0,
                manual_checks: 1
              },
              objective_status: "met",
              objective_summary: "Objective metric met: accuracy=0.91 >= 0.9.",
              recommendation: {
                action: "advance",
                target: "review",
                confidence_pct: 88,
                reason: "The run can proceed to manual review before paper writing.",
                evidence: ["accuracy reached the configured target."]
              },
              checks: [
                {
                  id: "paper_narrative",
                  label: "Paper narrative inputs",
                  status: "warning",
                  detail: "Synthesis or grounded paper claims are incomplete."
                },
                {
                  id: "human_signoff",
                  label: "Human sign-off",
                  status: "manual",
                  detail: "Confirm the claims, evidence quality, and next action before approving write_paper."
                }
              ],
              suggested_actions: ["/approve", "/agent run write_paper"]
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        const updated = {
          ...run,
          status: "paused",
          graph: {
            ...run.graph,
            nodeStates: {
              ...run.graph.nodeStates,
              review: {
                ...run.graph.nodeStates.review,
                status: "needs_approval",
                note: "Review packet prepared."
              }
            }
          }
        };
        return {
          run: updated,
          result: { status: "success" as const, summary: "Review packet prepared." }
        };
      })
    };

    const result = await app.handleAgent(["review"]);

    expect(result.ok).toBe(true);
    expect(app.orchestrator.runAgentWithOptions).toHaveBeenCalledWith(run.id, "review", {
      abortSignal: undefined
    });
    expect(app.logs).toContain("review finished: Review packet prepared.");
    expect(app.logs.some((line: string) => line.includes("Review readiness: warning"))).toBe(true);
    expect(app.logs.some((line: string) => line.includes("Manual: Human sign-off"))).toBe(true);
  });

  it("shuts down on ctrl+c while busy instead of replaying queued inputs", async () => {
    const app = makeApp();
    app.busy = true;
    app.cancelCurrentBusyOperation = vi.fn();
    app.shutdown = vi.fn();

    await app.handleKeypress("", { ctrl: true, name: "c" });

    expect(app.shutdown).toHaveBeenCalledTimes(1);
    expect(app.shutdown).toHaveBeenCalledWith({ abortActive: true });
    expect(app.cancelCurrentBusyOperation).not.toHaveBeenCalled();
  });

  it("still shuts down on ctrl+c when idle", async () => {
    const app = makeApp();
    app.busy = false;
    app.cancelCurrentBusyOperation = vi.fn();
    app.shutdown = vi.fn();

    await app.handleKeypress("", { ctrl: true, name: "c" });

    expect(app.shutdown).toHaveBeenCalledTimes(1);
    expect(app.shutdown).toHaveBeenCalledWith({ abortActive: true });
    expect(app.cancelCurrentBusyOperation).not.toHaveBeenCalled();
  });

  it("clears queued slash inputs when shutdown interrupts a busy operation", async () => {
    const app = makeApp();
    const drainQueuedInputs = vi.fn(async () => {});
    app.drainQueuedInputs = drainQueuedInputs;
    app.onQuit = vi.fn();
    app.detachKeyboard = vi.fn();

    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const busyPromise = app.runBusyAction(async (abortSignal: AbortSignal) => {
      resolveStarted();
      await new Promise<void>((resolve, reject) => {
        abortSignal.addEventListener(
          "abort",
          () => reject(new Error("Operation aborted by user")),
          { once: true }
        );
      });
    }, "/brief");

    await started;
    app.queuedInputs.push("/approve");

    await app.shutdown({ abortActive: true });
    await busyPromise;

    expect(app.stopped).toBe(true);
    expect(app.queuedInputs).toEqual([]);
    expect(drainQueuedInputs).not.toHaveBeenCalled();
    expect(app.logs.some((line: string) => line.includes("Running queued input: /approve"))).toBe(false);
  });

  it("removes the bottom composer pane before quitting", async () => {
    const app = makeApp();
    app.onQuit = vi.fn();
    app.detachKeyboard = vi.fn();
    app.lastRenderedFrame = {
      lines: ["• ready", "", "› draft", "", "idle · gpt-5.3-codex"],
      inputLineIndex: 3,
      inputColumn: 3,
      transcriptViewportLineCount: 1,
      totalTranscriptLines: 1,
      maxTranscriptScrollOffset: 0,
      transcriptHiddenLineCountAbove: 0,
      transcriptHiddenLineCountBelow: 0,
      appliedTranscriptScrollOffset: 0
    };

    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await app.shutdown();

    const rendered = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(rendered).toContain("\x1b[2J\x1b[H");
    expect(rendered).toContain("• ready");
    expect(rendered).not.toContain("› draft");
    expect(rendered).not.toContain("idle · gpt-5.3-codex");
  });

  it("queues slash commands instead of treating them as steering while a natural request is active", async () => {
    const app = makeApp();
    app.busy = true;
    app.recordHistory = vi.fn().mockResolvedValue(undefined);
    app.applySteeringInput = vi.fn();
    app.activeNaturalRequest = {
      input: "continue the current natural query",
      steeringHints: [],
      abortController: new AbortController()
    };

    await app.submitInputText("/brief start --latest");

    expect(app.applySteeringInput).not.toHaveBeenCalled();
    expect(app.queuedInputs).toEqual(["/brief start --latest"]);
    expect(app.logs).toContain("Queued turn: /brief start --latest");
  });

  it("fills the first contextual action on tab when the input is empty", async () => {
    const app = makeApp();

    await app.handleKeypress("", { name: "tab" });

    expect(app.input).toBe("/new");
  });

  it("updates contextual guidance language from the last user input", () => {
    const app = makeApp();

    app.updateGuidanceLanguage("현재 상태 보여줘");
    const guidance = app.getContextualGuidance();

    expect(guidance?.title).toBe("Research brief");
    expect(guidance?.items.some((item: { label: string }) => item.label === "new brief")).toBe(true);
  });

  it("fills 'y' on tab when pending guidance exposes run/cancel controls", async () => {
    const app = makeApp();
    app.pendingNaturalCommand = {
      command: "/agent run analyze_papers run-1 --top-n 30",
      commands: ["/agent run analyze_papers run-1 --top-n 30"],
      displayCommands: ["Analyze top 30 papers"],
      sourceInput: "30편 분석 진행해줘",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 1
    };

    await app.handleKeypress("", { name: "tab" });

    expect(app.input).toBe("y");
  });

  it("completes /brief on enter to the default latest-brief start command before execution", async () => {
    const app = makeApp();
    app.input = "/brief";
    app.cursorIndex = 6;
    app.suggestions = [
      {
        key: "brief",
        label: "/brief start <path|--latest>",
        description: "Start research from a brief file",
        applyValue: "/brief start --latest"
      }
    ];
    app.selectedSuggestion = 0;
    app.executeInput = vi.fn();

    await app.handleKeypress("", { name: "return" });

    expect(app.input).toBe("/brief start --latest");
    expect(app.executeInput).not.toHaveBeenCalled();
  });

  it("describes /brief as starting research instead of echoing the slash command", () => {
    const app = makeApp();

    expect(app.describeBusyLabelForSlash("brief", [])).toBe("Starting research...");
  });

  it("does not fall back to the previous run when the active run is missing from the run index", () => {
    const app = makeApp();
    app.runIndex = [makeRun("run-1")];
    app.activeRunId = "run-2";

    expect(app.getActiveIndexedRun()).toBeUndefined();
    expect(app.getRenderableRun()).toBeUndefined();
  });

  it("shows the newly created active run while brief startup work is still finishing", () => {
    const app = makeApp();
    const createdRun = makeRun("run-new");
    app.runIndex = [createdRun, makeRun("run-old")];
    app.activeRunId = createdRun.id;
    app.creatingRunFromBrief = true;
    app.creatingRunTargetId = createdRun.id;
    app.busy = true;
    app.activeBusyLabel = "Starting research...";

    expect(app.getRenderableRun()?.id).toBe(createdRun.id);
    expect(app.buildFooterItems(createdRun)).toEqual(expect.arrayContaining(["running", "creating run"]));
  });

  it("does not surface background run logs as if they belonged to the active run", async () => {
    const app = makeApp();
    const activeRun = makeRun("run-active");
    const backgroundRun = makeRun("run-background");
    app.runIndex = [activeRun, backgroundRun];
    app.activeRunId = activeRun.id;
    app.runStore = {
      getRun: vi.fn(async (runId: string) => (runId === backgroundRun.id ? backgroundRun : activeRun))
    };

    await app.handleStreamEvent({
      type: "OBS_RECEIVED",
      runId: backgroundRun.id,
      node: "analyze_papers",
      payload: {
        text: 'Persisted analysis outputs for "Paper 1" (1 summary row, 4 evidence row(s)).'
      }
    });

    expect(
      app.logs.some((line: string) => line.includes('Persisted analysis outputs for "Paper 1"'))
    ).toBe(false);
  });

  it("inserts a newline on shift+enter instead of submitting", async () => {
    const app = makeApp();
    app.input = "first line";
    app.cursorIndex = app.input.length;
    app.executeInput = vi.fn();

    await app.handleKeypress("", { name: "return", shift: true });

    expect(app.input).toBe("first line\n");
    expect(app.executeInput).not.toHaveBeenCalled();
  });

  it("inserts a newline when the terminal reports the enhanced Shift+Enter sequence", async () => {
    const app = makeApp();
    app.input = "first line";
    app.cursorIndex = app.input.length;
    app.executeInput = vi.fn();

    await app.handleKeypress("", { sequence: "\x1b[13;2u", code: "[13;2u" });

    expect(app.input).toBe("first line\n");
    expect(app.executeInput).not.toHaveBeenCalled();
  });

  it("inserts a newline on ctrl+j instead of submitting", async () => {
    const app = makeApp();
    app.input = "first line";
    app.cursorIndex = app.input.length;
    app.executeInput = vi.fn();

    await app.handleKeypress("\n", { name: "j", ctrl: true });

    expect(app.input).toBe("first line\n");
    expect(app.executeInput).not.toHaveBeenCalled();
  });

  it("inserts a newline from the raw enhanced Shift+Enter sequence before keypress parsing", () => {
    const app = makeApp();
    app.input = "first line";
    app.cursorIndex = app.input.length;

    app.handleRawKeyboardData(Buffer.from("\x1b[13;2u", "utf8"));

    expect(app.input).toBe("first line\n");
  });

  it("inserts a newline when the raw Shift+Enter escape sequence arrives across multiple chunks", () => {
    const app = makeApp();
    app.input = "first line";
    app.cursorIndex = app.input.length;

    app.handleRawKeyboardData(Buffer.from("\x1b[13;", "utf8"));
    expect(app.input).toBe("first line");

    app.handleRawKeyboardData(Buffer.from("2u", "utf8"));
    expect(app.input).toBe("first line\n");
  });

  it("renders with screen clear instead of terminal reset so keyboard enhancement survives", () => {
    const app = makeApp();
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    process.env.COLUMNS = "80";
    process.env.LINES = "24";

    try {
      (TerminalApp.prototype as any).render.call(app);
      const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("\x1b[2J\x1b[H");
      expect(output).not.toContain("\x1Bc");
    } finally {
      writeSpy.mockRestore();
      delete process.env.COLUMNS;
      delete process.env.LINES;
    }
  });

  it("switches the newline hint to ctrl+j when enhanced keys are not available", () => {
    const app = makeApp();
    app.enhancedNewlineSupported = false;
    expect(app.resolveNewlineHintLabel()).toBe("Ctrl+J newline");

    app.enhancedNewlineSupported = true;
    expect(app.resolveNewlineHintLabel()).toBe("Shift+Enter newline");
  });

  it("hides slash suggestions once the draft becomes multiline", () => {
    const app = makeApp();
    app.input = "/brief\nextra";
    app.cursorIndex = app.input.length;

    app.updateSuggestions();

    expect(app.suggestions).toEqual([]);
  });

  it("scrolls transcript with pageup and pagedown", async () => {
    const app = makeApp();
    app.lastRenderedFrame = {
      lines: [],
      inputLineIndex: 1,
      inputColumn: 1,
      transcriptViewportLineCount: 0,
      totalTranscriptLines: 80,
      maxTranscriptScrollOffset: 60,
      transcriptHiddenLineCountAbove: 20,
      transcriptHiddenLineCountBelow: 0,
      appliedTranscriptScrollOffset: 0
    };
    process.env.LINES = "20";

    await app.handleKeypress("", { name: "pageup" });
    expect(app.transcriptScrollOffset).toBe(10);

    await app.handleKeypress("", { name: "pagedown" });
    expect(app.transcriptScrollOffset).toBe(0);

    delete process.env.LINES;
  });

  it("suppresses collect progress transcript lines while thinking is active", () => {
    const app = makeApp();
    const run = makeRun("run-collect");
    run.currentNode = "collect_papers";
    run.graph.currentNode = "collect_papers";
    run.graph.nodeStates.collect_papers.status = "running";
    app.busy = true;
    app.thinking = true;
    app.collectProgress = {
      phase: "collecting",
      processed: 25,
      total: 100
    };

    const logs = app.getRenderableLogs(run);

    expect(logs.some((line: string) => line.includes("Collecting..."))).toBe(false);
  });

  it("suppresses synthesized status lines while thinking is active", () => {
    const app = makeApp();
    const run = makeRun("run-status");
    run.status = "paused";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "pending";
    run.graph.nodeStates.analyze_papers.note = "Canceled by user";
    run.graph.retryCounters.analyze_papers = 1;
    app.thinking = true;

    expect(app.getRenderableLogs(run)).toEqual([]);
  });

  it("cancels an active selection menu on ctrl+c without shutting down", async () => {
    const app = makeApp();
    const resolve = vi.fn();
    app.activeSelectionMenu = {
      title: "Select model slot",
      options: [{ value: "chat", label: "general_chat" }],
      selectedIndex: 0,
      resolve
    };
    app.busy = true;
    app.cancelCurrentBusyOperation = vi.fn();
    app.shutdown = vi.fn();

    await app.handleKeypress("", { ctrl: true, name: "c" });

    expect(resolve).toHaveBeenCalledWith(undefined);
    expect(app.activeSelectionMenu).toBeUndefined();
    expect(app.cancelCurrentBusyOperation).not.toHaveBeenCalled();
    expect(app.shutdown).not.toHaveBeenCalled();
  });

  it("treats a canceled node run as an aborted operation", async () => {
    const app = makeApp();
    const run = makeRun("run-1");
    run.status = "paused";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "pending";
    run.graph.nodeStates.analyze_papers.note = "Canceled by user";
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.continueSupervisedRun = vi.fn().mockResolvedValue(run);
    app.orchestrator = { jumpToNode: vi.fn() };

    await expect(app.handleAgent(["run", "analyze_papers"], new AbortController().signal)).rejects.toThrow(
      "Operation aborted by user"
    );
  });

  it("does not trim successful node summaries at the old 220-character limit", async () => {
    const app = makeApp();
    const run = makeRun("run-long-summary");
    const tailMarker = "TAIL_MARKER_VISIBLE";
    const longSummary = `${"structured communication ".repeat(10)}${tailMarker}`;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.continueSupervisedRun = vi.fn().mockResolvedValue({
      ...run,
      graph: {
        ...run.graph,
        nodeStates: {
          ...run.graph.nodeStates,
          analyze_papers: {
            ...run.graph.nodeStates.analyze_papers,
            status: "completed",
            note: longSummary
          }
        }
      }
    });
    app.orchestrator = { jumpToNode: vi.fn() };

    const result = await app.handleAgent(["run", "analyze_papers"], new AbortController().signal);
    const completionLog = app.logs.find((line: string) => line.startsWith("Node analyze_papers finished:"));

    expect(result.ok).toBe(true);
    expect(completionLog).toContain(tailMarker);
  });

  it("logs the downstream failed node when the failure message names a different node", async () => {
    const app = makeApp();
    const run = makeRun("run-downstream-failure-log");
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "pending";
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.orchestrator = { jumpToNode: vi.fn() };
    app.continueSupervisedRun = vi.fn().mockResolvedValue({
      ...run,
      status: "failed",
      updatedAt: "2026-03-12T12:00:30.000Z",
      currentNode: "analyze_papers",
      graph: {
        ...run.graph,
        currentNode: "analyze_papers",
        nodeStates: {
          ...run.graph.nodeStates,
          analyze_papers: {
            ...run.graph.nodeStates.analyze_papers,
            status: "failed",
            updatedAt: "2026-03-12T12:00:10.000Z",
            lastError: "generate_hypotheses requires at least one evidence item from analyze_papers."
          },
          generate_hypotheses: {
            ...run.graph.nodeStates.generate_hypotheses,
            status: "failed",
            updatedAt: "2026-03-12T12:00:20.000Z",
            lastError: "generate_hypotheses requires at least one evidence item from analyze_papers."
          }
        }
      }
    });

    const result = await app.handleAgent(["run", "analyze_papers"], new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(app.logs).toContain(
      "Node generate_hypotheses failed: generate_hypotheses requires at least one evidence item from analyze_papers."
    );
  });

  it("executes one pending plan step at a time and re-arms the remaining steps", async () => {
    const app = makeApp();
    app.pendingNaturalCommand = {
      command: "/help",
      commands: ["/help", "/agent collect --limit nope", '/title "should not run" --run run-1'],
      sourceInput: "test",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 3
    };

    app.executeParsedSlash = vi.fn().mockResolvedValueOnce({ ok: true });

    await app.handlePendingNaturalConfirmation("y");

    expect(app.executeParsedSlash).toHaveBeenCalledTimes(1);
    expect(app.logs).toContain("Confirmed. Running step 1/3.");
    expect(app.logs).toContain("Step 1/3 completed.");
    expect(app.pendingNaturalCommand?.commands).toEqual([
      "/agent collect --limit nope",
      '/title "should not run" --run run-1'
    ]);
    expect(app.pendingNaturalCommand?.stepIndex).toBe(1);
    expect(app.pendingNaturalCommand?.totalSteps).toBe(3);
  });

  it("arms an automatically replanned command after step failure", async () => {
    const app = makeApp();
    app.runIndex = [makeRun("run-1")];
    app.activeRunId = "run-1";
    app.codex = {
      runForText: async () =>
        JSON.stringify({
          reply_lines: ["I can retry with a corrected collect command."],
          target_run_id: "run-1",
          recommended_command: "/agent collect --limit 20 --run run-1",
          should_offer_execute: true
        })
    };
    app.pendingNaturalCommand = {
      command: "/help",
      commands: ["/help", "/agent collect --limit nope --run run-1"],
      sourceInput: "refresh papers",
      createdAt: new Date().toISOString(),
      stepIndex: 1,
      totalSteps: 2
    };

    app.executeParsedSlash = vi.fn().mockResolvedValueOnce({ ok: false, reason: "invalid collect options" });

    await app.handlePendingNaturalConfirmation("y");

    expect(app.logs).toContain("Attempting automatic replan after failed step...");
    expect(app.logs).toContain("I can retry with a corrected collect command.");
    expect(app.pendingNaturalCommand?.commands).toEqual(["/agent collect --limit 20 --run run-1"]);
  });

  it("advances multi-step plans one step at a time", async () => {
    const app = makeApp();
    app.pendingNaturalCommand = {
      command: "/help",
      commands: ["/help", "/doctor", '/title "done" --run run-1'],
      sourceInput: "test",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 3
    };

    app.executeParsedSlash = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await app.handlePendingNaturalConfirmation("y");

    expect(app.executeParsedSlash).toHaveBeenCalledTimes(1);
    expect(app.logs).toContain("Confirmed. Running step 1/3.");
    expect(app.logs).toContain("Step 1/3 completed.");
    expect(app.logs).toContain("Remaining plan steps (2-3/3):");
    expect(app.pendingNaturalCommand?.commands).toEqual(["/doctor", '/title "done" --run run-1']);
  });

  it("runs all remaining pending plan steps when the user enters a", async () => {
    const app = makeApp();
    app.pendingNaturalCommand = {
      command: "/help",
      commands: ["/help", "/doctor", '/title "done" --run run-1'],
      sourceInput: "test",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 3
    };

    app.executeParsedSlash = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await app.handlePendingNaturalConfirmation("a");

    expect(app.executeParsedSlash).toHaveBeenCalledTimes(3);
    expect(app.logs).toContain("Confirmed. Running all remaining steps from 1/3.");
    expect(app.logs).toContain("Step 1/3: /help");
    expect(app.logs).toContain("Step 2/3: /doctor");
    expect(app.logs).toContain('Step 3/3: /title "done" --run run-1');
    expect(app.logs).toContain("Plan completed after 3 step(s).");
    expect(app.pendingNaturalCommand).toBeUndefined();
  });

  it("does not re-arm the same failed plan during automatic replan", async () => {
    const app = makeApp();
    app.runIndex = [makeRun("run-1")];
    app.activeRunId = "run-1";
    app.codex = {
      runForText: async () =>
        JSON.stringify({
          reply_lines: ["The same plan is still suggested."],
          target_run_id: "run-1",
          recommended_command: "/agent collect --limit nope --run run-1",
          should_offer_execute: true
        })
    };
    app.pendingNaturalCommand = {
      command: "/agent collect --limit nope --run run-1",
      commands: ["/agent collect --limit nope --run run-1"],
      sourceInput: "refresh papers",
      createdAt: new Date().toISOString(),
      stepIndex: 1,
      totalSteps: 2
    };

    app.executeParsedSlash = vi.fn().mockResolvedValueOnce({ ok: false, reason: "invalid collect options" });

    await app.handlePendingNaturalConfirmation("y");

    expect(app.logs).toContain("Replan matched the failed plan. Not re-arming the same commands.");
    expect(app.pendingNaturalCommand).toBeUndefined();
  });

  it("deterministically splits a rate-limited collect request before falling back to LLM", async () => {
    const app = makeApp();
    app.runIndex = [makeRun("run-1")];
    app.activeRunId = "run-1";
    app.runIndex[0].title = "Multi-Agent Collaboration";
    app.runIndex[0].topic = "Multi-Agent Collaboration";
    app.semanticScholarApiKeyConfigured = true;
    app.codex = {
      runForText: vi.fn()
    };
    app.pendingNaturalCommand = {
      command: '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 300 --open-access --run run-1',
      commands: ['/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 300 --open-access --run run-1'],
      sourceInput: "collect papers",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 1
    };

    app.executeParsedSlash = vi.fn().mockResolvedValueOnce({
      ok: false,
      reason:
        'Semantic Scholar rate limited "Multi-Agent Collaboration": Semantic Scholar request failed: 429 (rate limited).'
    });

    await app.handlePendingNaturalConfirmation("y");

    expect(app.codex.runForText).not.toHaveBeenCalled();
    expect(app.logs).toContain("Attempting automatic replan after failed step...");
    expect(app.logs).toContain(
      "Deterministic collect replan: splitting the failed request into 6 smaller step(s) of up to 50 papers."
    );
    expect(app.logs).toContain("Recovery collect plan prepared with 6 smaller step(s).");
    expect(app.logs).not.toContain("Execution plan detected. Pending 6-step plan:");
    expect(
      app.logs.some((line: string) =>
        line.includes('- [1/6] /agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 50 --open-access --run run-1')
      )
    ).toBe(false);
    expect(app.pendingNaturalCommand?.commands).toEqual([
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 50 --open-access --run run-1',
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --additional 50 --open-access --run run-1',
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --additional 50 --open-access --run run-1',
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --additional 50 --open-access --run run-1',
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --additional 50 --open-access --run run-1',
      '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --additional 50 --open-access --run run-1'
    ]);
    expect(app.pendingNaturalCommand?.presentation).toBe("collect_replan_summary");
  });

  it("keeps deterministic collect replans summarized during reminders and continuations", async () => {
    const app = makeApp();
    app.pendingNaturalCommand = {
      command: '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 50 --open-access --run run-1',
      commands: [
        '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --limit 50 --open-access --run run-1',
        '/agent collect "Multi-Agent Collaboration" --last-years 5 --sort relevance --additional 50 --open-access --run run-1'
      ],
      sourceInput: "collect papers",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 2,
      presentation: "collect_replan_summary"
    };

    app.executeParsedSlash = vi.fn().mockResolvedValueOnce({ ok: true });

    await app.handlePendingNaturalConfirmation("later");
    await app.handlePendingNaturalConfirmation("y");

    expect(app.logs).toContain("Pending recovery collect plan from step 1/2.");
    expect(app.logs).toContain("Next recovery collect step ready (2/2).");
    expect(
      app.logs.some((line: string) => line.includes('Pending plan from step 1/2: /agent collect "Multi-Agent Collaboration"'))
    ).toBe(false);
    expect(
      app.logs.some((line: string) => line.includes('Remaining plan steps (2-2/2):'))
    ).toBe(false);
    expect(app.pendingNaturalCommand?.presentation).toBe("collect_replan_summary");
  });

  it("renders collect progress as a single transient log line", () => {
    const app = makeApp();
    const run = makeRun("run-collect");
    run.currentNode = "collect_papers";
    run.graph.currentNode = "collect_papers";
    run.graph.nodeStates.collect_papers.status = "running";
    app.busy = true;

    app.pushLog("Moving to collect_papers with target total 300.");
    app.pushLog('Collected 100 paper(s) so far (100 new) for "topic".');

    expect(app.logs).toEqual([]);
    expect(app.getRenderableLogs(run)).toHaveLength(1);
    expect(app.getRenderableLogs(run)[0]).toContain("Collecting... 100/300");
  });

  it("renders analyze progress as a single transient log line", () => {
    const app = makeApp();
    const run = makeRun("run-analyze-progress");
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.graph.nodeStates.analyze_papers.status = "running";
    app.busy = true;

    app.pushLog("Ranking 300 papers and selecting the top 30 for analysis.");
    app.pushLog("Preparing LLM rerank for 150 candidate(s) to choose top 30.");

    expect(app.logs).toEqual([]);
    expect(app.getRenderableLogs(run)).toEqual(["Analyzing... reranking 150 candidates for top 30"]);

    app.pushLog('Analyzing paper 5/30: "Paper 5".');
    expect(app.logs).toEqual([]);
    expect(app.getRenderableLogs(run)[0]).toContain("Analyzing... 5/30");
  });

  it("adds synthesized paused-analysis status lines when runs.json is stale", () => {
    const app = makeApp();
    const run = makeRun("run-paused-analyze");
    run.status = "paused";
    run.currentNode = "analyze_papers";
    run.graph.currentNode = "analyze_papers";
    run.latestSummary = 'Semantic Scholar stored 200 papers for "topic". Deferred enrichment continues for 173 paper(s).';
    run.graph.retryCounters.analyze_papers = 1;
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.analyze_papers.status = "pending";
    run.graph.nodeStates.analyze_papers.note = "Canceled by user";
    run.graph.nodeStates.analyze_papers.lastError = "Analysis incomplete: 1 paper(s) failed validation or LLM extraction.";

    app.runProjectionHints.set(run.id, {
      collect: {
        enrichmentStatus: "completed"
      },
      analyze: {
        selectedCount: 1,
        totalCandidates: 200,
        summaryCount: 0,
        evidenceCount: 0,
        rerankApplied: false,
        rerankFallbackReason: "You've hit your usage limit for GPT-5.3-Codex-Spark.",
        selectedPaperLastError: "You've hit your usage limit for GPT-5.3-Codex-Spark."
      }
    });

    const lines = app.getRenderableLogs(run);

    expect(lines[0]).toBe("Status: analyze_papers is paused after retry 1/3 because a model usage limit blocked progress.");
    expect(lines[1]).toContain("Selected 1/200 paper(s) for analysis.");
    expect(lines[1]).toContain("LLM rerank failed before a top-N shortlist was accepted.");
    expect(lines[1]).toContain("GPT-5.3-Codex-Spark usage limit");
    expect(lines[1]).toContain("Ignoring stale top-level summary");
  });

  it("does not flash stale collect-summary detail during same-session handoff into analyze_papers", () => {
    const app = makeApp();
    const run = makeRun("run-handoff-flash");
    run.status = "running";
    run.currentNode = "collect_papers";
    run.graph.currentNode = "collect_papers";
    run.updatedAt = "2026-03-12T12:37:36.434Z";
    run.latestSummary =
      'Semantic Scholar stored 200 papers for "topic". Deferred enrichment scheduled in background for 171 paper(s).';
    run.graph.nodeStates.collect_papers.status = "completed";
    run.graph.nodeStates.collect_papers.updatedAt = "2026-03-12T12:37:36.434Z";
    run.graph.nodeStates.collect_papers.note = run.latestSummary;

    app.runIndex = [run];

    app.applyProjectedRunEvent({
      id: "evt-handoff-analyze",
      type: "NODE_STARTED",
      timestamp: "2026-03-12T12:37:37.000Z",
      runId: run.id,
      node: "analyze_papers",
      payload: {}
    } as any);

    expect(app.runIndex[0].currentNode).toBe("analyze_papers");
    expect(app.getRenderableLogs(app.runIndex[0]).join(" ")).not.toContain("Ignoring stale top-level summary");
    expect(app.getRenderableLogs(app.runIndex[0]).join(" ")).not.toContain("Semantic Scholar stored 200 papers");
  });

  it("refreshes a live run from the store so stale top-level summaries disappear after persisted analyze progress", async () => {
    const app = makeApp();
    const staleRun = makeRun("run-live-refresh");
    staleRun.status = "running";
    staleRun.currentNode = "analyze_papers";
    staleRun.graph.currentNode = "analyze_papers";
    staleRun.updatedAt = "2026-03-12T12:37:36.434Z";
    staleRun.latestSummary = 'Semantic Scholar stored 200 papers for "topic". Deferred enrichment scheduled in background for 171 paper(s).';
    staleRun.graph.nodeStates.collect_papers.status = "completed";
    staleRun.graph.nodeStates.collect_papers.note = staleRun.latestSummary;
    staleRun.graph.nodeStates.collect_papers.updatedAt = "2026-03-12T12:37:36.434Z";
    staleRun.graph.nodeStates.analyze_papers.status = "running";
    staleRun.graph.nodeStates.analyze_papers.updatedAt = "2026-03-12T12:37:36.434Z";

    app.runIndex = [staleRun];
    app.runProjectionHints.set(staleRun.id, {
      analyze: {
        selectedCount: 30,
        totalCandidates: 200,
        summaryCount: 3,
        evidenceCount: 12
      }
    });

    expect(app.getRenderableLogs(staleRun).join(" ")).toContain("Ignoring stale top-level summary");

    const freshRun = makeRun("run-live-refresh");
    freshRun.status = "running";
    freshRun.currentNode = "analyze_papers";
    freshRun.graph.currentNode = "analyze_papers";
    freshRun.updatedAt = "2026-03-12T12:40:23.186Z";
    freshRun.latestSummary =
      "Analyzed top 30/200 ranked papers into 12 evidence item(s); 0 full-text and 3 abstract fallback (mode=codex_text_image_hybrid).";
    freshRun.graph.nodeStates.collect_papers.status = "completed";
    freshRun.graph.nodeStates.collect_papers.note =
      'Semantic Scholar stored 200 papers for "topic". Deferred enrichment scheduled in background for 171 paper(s).';
    freshRun.graph.nodeStates.collect_papers.updatedAt = "2026-03-12T12:39:54.428Z";
    freshRun.graph.nodeStates.analyze_papers.status = "running";
    freshRun.graph.nodeStates.analyze_papers.updatedAt = "2026-03-12T12:40:23.180Z";
    freshRun.graph.nodeStates.analyze_papers.note = freshRun.latestSummary;

    app.runStore = {
      getRun: vi.fn().mockResolvedValue(freshRun)
    } as any;

    await app.refreshRunFromStore(staleRun.id);

    expect(app.runIndex[0].latestSummary).toBe(freshRun.latestSummary);
    expect(app.runIndex[0].graph.nodeStates.analyze_papers.note).toBe(freshRun.latestSummary);
    expect(app.getRenderableLogs(app.runIndex[0]).join(" ")).not.toContain("Ignoring stale top-level summary");
    expect(app.getRenderableLogs(app.runIndex[0])[0]).toContain("Analyzed top 30/200 ranked papers into 12 evidence item(s)");
  });

  it("renders rollback recovery status without borrowing analyze evidence counts", () => {
    const app = makeApp();
    const run = makeRun("run-rollback");
    run.status = "running";
    run.currentNode = "design_experiments";
    run.graph.currentNode = "design_experiments";
    run.graph.nodeStates.design_experiments.status = "running";
    run.graph.nodeStates.design_experiments.note =
      "Auto rollback from implement_experiments after 4/3 retries (rollback 2/2).";
    run.graph.nodeStates.implement_experiments.status = "failed";
    run.graph.nodeStates.implement_experiments.lastError =
      "Local verification failed via python -m py_compile outputs/example/experiment/run.py (environment): [Errno 2] No such file or directory.";

    app.runProjectionHints.set(run.id, {
      analyze: {
        selectedCount: 30,
        totalCandidates: 200,
        summaryCount: 30,
        evidenceCount: 119
      }
    });

    const lines = app.getRenderableLogs(run);

    expect(lines[0]).toBe("Status: Auto rollback from implement_experiments after 4/3 retries (rollback 2/2).");
    expect(lines.join(" ")).not.toContain("implement_experiments has 119 evidence item(s)");
    expect(lines.join(" ")).not.toContain("Persisted 30 summary row(s) and 119 evidence row(s).");
  });

  it("creates a Markdown brief file when /new is used without an editor", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-new-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const paths = resolveAppPaths(cwd);
      await ensureScaffold(paths);
      const app = makeApp();
      app.openResearchBriefInEditor = vi.fn().mockResolvedValue(false);

      await app.handleNewRun();

      const briefsDir = path.join(cwd, ".autolabos", "briefs");
      const files = await readdir(briefsDir);
      expect(files).toHaveLength(1);
      const raw = await readFile(path.join(briefsDir, files[0]), "utf8");
      expect(raw).toContain("# Research Brief");
      expect(raw).toContain("## Topic");
      expect(app.logs.some((line: string) => line.includes("Created research brief:"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("starts a run from the latest brief file, snapshots it, and auto-starts execution", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-start-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const paths = resolveAppPaths(cwd);
      await ensureScaffold(paths);
      const runStore = new RunStore(paths);
      const orchestrator = {
        runCurrentAgentWithOptions: vi.fn(async (runId: string) => {
          const run = await runStore.getRun(runId);
          if (!run) {
            throw new Error("expected run");
          }
          run.status = "completed";
          run.latestSummary = "research completed";
          run.graph.nodeStates.write_paper.status = "completed";
          run.currentNode = "write_paper";
          run.graph.currentNode = "write_paper";
          await runStore.updateRun(run);
          return {
            run,
            result: {
              status: "success" as const,
              summary: "research completed"
            }
          };
        })
      };
      const app = new TerminalApp({
        config: {
          papers: { max_results: 100 },
          providers: {
            llm_mode: "codex_chatgpt_only",
            codex: {
              model: "gpt-5.3-codex",
              chat_model: "gpt-5.3-codex",
              reasoning_effort: "medium",
              chat_reasoning_effort: "medium",
              fast_mode: false,
              chat_fast_mode: false
            },
            openai: { model: "gpt-5.4", reasoning_effort: "medium" }
          },
          analysis: {
            pdf_mode: "codex_text_image_hybrid",
            responses_model: "gpt-5.4"
          },
          research: {
            default_topic: "Multi-agent collaboration",
            default_constraints: ["recent papers"],
            default_objective_metric: "reproducibility"
          }
        } as any,
        runStore,
        titleGenerator: {
          generateTitle: vi.fn().mockResolvedValue("Brief-driven run")
        } as any,
        codex: {
          runTurnStream: vi.fn(async () => {
            throw new Error("llm unavailable");
          })
        } as any,
        eventStream: { subscribe: () => () => {} } as any,
        orchestrator: orchestrator as any,
        semanticScholarApiKeyConfigured: false,
        onQuit: () => {},
        saveConfig: async () => {}
      }) as any;
      app.render = () => {};
      app.updateSuggestions = () => {};
      app.drainQueuedInputs = async () => {};

      const briefDir = path.join(cwd, ".autolabos", "briefs");
      await mkdir(briefDir, { recursive: true });
      const briefPath = path.join(briefDir, "20260311-190000-agent-study.md");
      await writeFile(
        briefPath,
        [
          "# Research Brief",
          "",
          "## Topic",
          "",
          "Multi-agent code repair on SWE-bench",
          "",
          "## Objective Metric",
          "",
          "pass@1 >= 0.4",
          "",
          "## Constraints",
          "",
          "- recent papers",
          "- 6 hour time limit",
          "",
          "## Plan",
          "",
          "Run baseline, ablation, and confirmatory evaluations."
        ].join("\n"),
        "utf8"
      );

      await app.handleBriefCommand(["start", "--latest"]);

      const runs = await runStore.listRuns();
      expect(runs).toHaveLength(1);
      const run = runs[0];
      expect(run.title).toBe("Brief-driven run");
      expect(orchestrator.runCurrentAgentWithOptions).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({ abortSignal: undefined })
      );
      const snapshot = await readFile(path.join(cwd, ".autolabos", "runs", run.id, "brief", "source_brief.md"), "utf8");
      expect(snapshot).toContain("Multi-agent code repair on SWE-bench");
      const runContext = new RunContextMemory(path.join(cwd, run.memoryRefs.runContextPath));
      expect(await runContext.get("run_brief.source_path")).toBe(await realpath(briefPath));
      expect(await runContext.get("run_brief.snapshot_path")).toBe(`.autolabos/runs/${run.id}/brief/source_brief.md`);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("starts the latest research brief from typed slash input while another run is active", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-keypress-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const paths = resolveAppPaths(cwd);
      await ensureScaffold(paths);
      const runStore = new RunStore(paths);
      const existingRun = await runStore.createRun({
        title: "Existing run",
        topic: "topic",
        constraints: [],
        objectiveMetric: "metric"
      });
      existingRun.status = "paused";
      existingRun.currentNode = "collect_papers";
      existingRun.graph.currentNode = "collect_papers";
      existingRun.graph.nodeStates.collect_papers.status = "pending";
      await runStore.updateRun(existingRun);

      const orchestrator = {
        runCurrentAgentWithOptions: vi.fn(async (runId: string) => {
          const run = await runStore.getRun(runId);
          if (!run) {
            throw new Error("expected run to exist");
          }
          run.status = "paused";
          run.latestSummary = "collect_papers started";
          run.graph.nodeStates.collect_papers = {
            status: "running",
            updatedAt: new Date().toISOString(),
            note: "Collecting papers."
          };
          await runStore.updateRun(run);
          return {
            run,
            result: {
              status: "success" as const,
              summary: "collect_papers started"
            }
          };
        })
      };

      const app = new TerminalApp({
        config: {
          papers: { max_results: 100 },
          providers: {
            llm_mode: "codex_chatgpt_only",
            codex: {
              model: "gpt-5.3-codex",
              chat_model: "gpt-5.3-codex",
              reasoning_effort: "medium",
              chat_reasoning_effort: "medium",
              fast_mode: false,
              chat_fast_mode: false
            },
            openai: { model: "gpt-5.4", reasoning_effort: "medium" }
          },
          analysis: {
            pdf_mode: "codex_text_image_hybrid",
            responses_model: "gpt-5.4"
          },
          research: {
            default_topic: "Multi-agent collaboration",
            default_constraints: ["recent papers"],
            default_objective_metric: "reproducibility"
          }
        } as any,
        runStore,
        titleGenerator: {
          generateTitle: vi.fn().mockResolvedValue("Brief-driven run")
        } as any,
        codex: {
          runTurnStream: vi.fn(async () => {
            throw new Error("llm unavailable");
          })
        } as any,
        eventStream: { subscribe: () => () => {} } as any,
        orchestrator: orchestrator as any,
        semanticScholarApiKeyConfigured: false,
        onQuit: () => {},
        saveConfig: async () => {}
      }) as any;
      app.render = () => {};
      app.updateSuggestions = () => {};
      app.drainQueuedInputs = async () => {};
      const originalSetActiveRunId = app.setActiveRunId.bind(app);
      const activationSnapshots: Array<{ runId?: string; visibleInRunIndex: boolean }> = [];
      app.setActiveRunId = vi.fn(async (runId?: string) => {
        activationSnapshots.push({
          runId,
          visibleInRunIndex:
            typeof runId === "string" ? app.runIndex.some((candidate: { id: string }) => candidate.id === runId) : false
        });
        return originalSetActiveRunId(runId);
      });

      const briefDir = path.join(cwd, ".autolabos", "briefs");
      await mkdir(briefDir, { recursive: true });
      const briefPath = path.join(briefDir, "20260313-190000-agent-study.md");
      await writeFile(
        briefPath,
        [
          "# Research Brief",
          "",
          "## Topic",
          "",
          "Multi-agent code repair on SWE-bench",
          "",
          "## Objective Metric",
          "",
          "pass@1 >= 0.4",
          "",
          "## Constraints",
          "",
          "- recent papers",
          "- 6 hour time limit",
          "",
          "## Plan",
          "",
          "Run baseline, ablation, and confirmatory evaluations."
        ].join("\n"),
        "utf8"
      );

      await app.refreshRunIndex();
      await app.setActiveRunId(existingRun.id);

      for (const char of "/brief start --latest") {
        await app.handleKeypress(char, { sequence: char, name: char === " " ? "space" : undefined });
      }

      expect(app.input).toBe("/brief start --latest");

      await app.handleKeypress("", { name: "return" });

      const runs = await runStore.listRuns();
      expect(runs).toHaveLength(2);
      const run = runs.find((candidate) => candidate.id !== existingRun.id);
      expect(run?.title).toBe("Brief-driven run");
      expect(activationSnapshots.filter((snapshot) => snapshot.runId === run?.id)[0]).toEqual({
        runId: run?.id,
        visibleInRunIndex: true
      });
      expect(orchestrator.runCurrentAgentWithOptions).toHaveBeenCalledWith(
        run?.id,
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
      );
      expect(app.activeRunId).toBe(run?.id);
      const snapshot = await readFile(path.join(cwd, ".autolabos", "runs", run!.id, "brief", "source_brief.md"), "utf8");
      expect(snapshot).toContain("Multi-agent code repair on SWE-bench");
      expect(app.logs.some((line: string) => line.includes(`Created run ${run?.id}`))).toBe(true);
      expect(app.logs.some((line: string) => line.includes("Auto-starting research"))).toBe(true);
      const runContext = new RunContextMemory(path.join(cwd, run!.memoryRefs.runContextPath));
      expect(await runContext.get("run_brief.source_path")).toBe(await realpath(briefPath));
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("hides the previous active run in the footer while /brief start is still creating a new run", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "autolabos-brief-busy-footer-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const paths = resolveAppPaths(cwd);
      await ensureScaffold(paths);
      const runStore = new RunStore(paths);
      const existingRun = await runStore.createRun({
        title: "Existing run",
        topic: "topic",
        constraints: [],
        objectiveMetric: "metric"
      });
      existingRun.status = "paused";
      existingRun.currentNode = "analyze_papers";
      existingRun.graph.currentNode = "analyze_papers";
      existingRun.graph.nodeStates.analyze_papers.status = "pending";
      await runStore.updateRun(existingRun);

      const briefDir = path.join(cwd, ".autolabos", "briefs");
      await mkdir(briefDir, { recursive: true });
      await writeFile(
        path.join(briefDir, "20260313-191500-agent-study.md"),
        [
          "# Research Brief",
          "",
          "## Topic",
          "",
          "Multi-agent code repair on SWE-bench",
          "",
          "## Objective Metric",
          "",
          "pass@1 >= 0.4",
          "",
          "## Constraints",
          "",
          "- recent papers",
          "- 6 hour time limit",
          "",
          "## Plan",
          "",
          "Run baseline, ablation, and confirmatory evaluations."
        ].join("\n"),
        "utf8"
      );

      let resolveTitle: ((value: string) => void) | undefined;
      const titlePromise = new Promise<string>((resolve) => {
        resolveTitle = resolve;
      });

      const app = new TerminalApp({
        config: {
          papers: { max_results: 100 },
          providers: {
            llm_mode: "codex_chatgpt_only",
            codex: {
              model: "gpt-5.3-codex",
              chat_model: "gpt-5.3-codex",
              reasoning_effort: "medium",
              chat_reasoning_effort: "medium",
              fast_mode: false,
              chat_fast_mode: false
            },
            openai: { model: "gpt-5.4", reasoning_effort: "medium" }
          },
          analysis: {
            pdf_mode: "codex_text_image_hybrid",
            responses_model: "gpt-5.4"
          },
          research: {
            default_topic: "Multi-agent collaboration",
            default_constraints: ["recent papers"],
            default_objective_metric: "reproducibility"
          }
        } as any,
        runStore,
        titleGenerator: {
          generateTitle: vi.fn().mockImplementation(() => titlePromise)
        } as any,
        codex: {
          runTurnStream: vi.fn(async () => {
            throw new Error("llm unavailable");
          })
        } as any,
        eventStream: { subscribe: () => () => {} } as any,
        orchestrator: {
          runCurrentAgentWithOptions: vi.fn(async (runId: string) => {
            const run = await runStore.getRun(runId);
            if (!run) {
              throw new Error("expected run to exist");
            }
            run.status = "paused";
            run.latestSummary = "collect_papers started";
            run.graph.nodeStates.collect_papers = {
              status: "running",
              updatedAt: new Date().toISOString(),
              note: "Collecting papers."
            };
            await runStore.updateRun(run);
            return {
              run,
              result: {
                status: "success" as const,
                summary: "collect_papers started"
              }
            };
          })
        } as any,
        semanticScholarApiKeyConfigured: false,
        onQuit: () => {},
        saveConfig: async () => {}
      }) as any;
      app.render = () => {};
      app.updateSuggestions = () => {};
      app.drainQueuedInputs = async () => {};

      await app.refreshRunIndex();
      await app.setActiveRunId(existingRun.id);

      const pending = app.submitInputText("/brief start --latest");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (app.buildFooterItems(existingRun).includes("creating run")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(app.activeRunId).toBe(existingRun.id);
      expect(app.getRenderableRun()).toBeUndefined();
      expect(app.buildFooterItems(existingRun)).toEqual(expect.arrayContaining(["running", "creating run"]));
      expect(app.buildFooterItems(existingRun)).not.toContain("analyze_papers pending");

      resolveTitle?.("Brief-driven run");
      await pending;

      const runs = await runStore.listRuns();
      expect(runs).toHaveLength(2);
      const createdRun = runs.find((candidate) => candidate.id !== existingRun.id);
      expect(app.activeRunId).toBe(createdRun?.id);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("restores a pending human intervention request for the active run", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "autolabos-human-restore-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const paths = resolveAppPaths(cwd);
      await ensureScaffold(paths);
      const runStore = new RunStore(paths);
      const run = await runStore.createRun({
        title: "Pending question run",
        topic: "topic",
        constraints: [],
        objectiveMetric: "metric"
      });
      run.status = "paused";
      run.currentNode = "analyze_results";
      run.graph.currentNode = "analyze_results";
      run.graph.nodeStates.analyze_results.status = "needs_approval";
      await runStore.updateRun(run);

      const runContext = new RunContextMemory(path.join(cwd, run.memoryRefs.runContextPath));
      await runContext.put("human_intervention.pending", {
        id: "request-1",
        sourceNode: "analyze_results",
        kind: "objective_metric_clarification",
        title: "Clarify the objective metric",
        question: "Which metric should count as the objective?",
        context: ["Available metrics: accuracy, pass_at_1."],
        inputMode: "free_text",
        resumeAction: "retry_current",
        createdAt: new Date().toISOString()
      });

      const app = new TerminalApp({
        config: {
          papers: { max_results: 100 },
          providers: {
            llm_mode: "codex_chatgpt_only",
            codex: { model: "gpt-5.3-codex", reasoning_effort: "xhigh", fast_mode: false },
            openai: { model: "gpt-5.4", reasoning_effort: "medium" }
          },
          analysis: {
            pdf_mode: "codex_text_image_hybrid",
            responses_model: "gpt-5.4"
          },
          research: {
            default_topic: "topic",
            default_constraints: ["recent papers"],
            default_objective_metric: "metric"
          }
        } as any,
        runStore,
        titleGenerator: {} as any,
        codex: {} as any,
        eventStream: { subscribe: () => () => {} } as any,
        orchestrator: {} as any,
        initialRunId: run.id,
        semanticScholarApiKeyConfigured: false,
        onQuit: () => {},
        saveConfig: async () => {}
      }) as any;
      app.render = () => {};
      app.updateSuggestions = () => {};
      app.drainQueuedInputs = async () => {};

      await app.refreshRunIndex();

      expect(app.pendingHumanIntervention?.request.id).toBe("request-1");
      expect(app.logs.some((line: string) => line.includes("Human input required"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
