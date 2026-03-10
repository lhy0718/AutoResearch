import { describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

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
      runContextPath: `.autoresearch/runs/${id}/memory/run_context.json`,
      longTermPath: `.autoresearch/runs/${id}/memory/long_term.jsonl`,
      episodePath: `.autoresearch/runs/${id}/memory/episodes.jsonl`
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
    app.askWithinTui = vi
      .fn()
      .mockResolvedValueOnce("Pilot topic")
      .mockResolvedValueOnce("recent papers,last 5 years")
      .mockResolvedValueOnce("reproducibility");
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
      "Select PDF analysis mode",
      expect.any(Array),
      "codex_text_image_hybrid"
    );
    expect(app.selectCodexSlot).toHaveBeenCalledTimes(3);
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
        line.includes("- general chat:") && line.includes("Recommended: gpt-5.4 + low")
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
          description: expect.stringContaining("Recommended: gpt-5.4 + low")
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
      "task"
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
      .mockResolvedValueOnce("task")
      .mockResolvedValueOnce("gpt-5-mini")
      .mockResolvedValueOnce("high");

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
      "task"
    );
    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(openAiTextClient.updateDefaults).toHaveBeenCalledWith({
      model: "gpt-5-mini",
      reasoningEffort: "high"
    });
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
    expect(app.logs).toContain("현재 수집된 논문은 42편입니다.");
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
    expect(app.logs).toContain("산출물 정리 요청을 인식했습니다.");
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
    expect(app.logs).toContain(`Resolved slash command: /agent run analyze_papers ${run.id} --top-n 30`);
    expect(app.logs).toContain("Execution intent detected. Pending command: 상위 30개 논문 분석");
    expect(app.pendingNaturalCommand?.commands).toEqual([`/agent run analyze_papers ${run.id} --top-n 30`]);
    expect(app.pendingNaturalCommand?.displayCommands).toEqual(["상위 30개 논문 분석"]);
  });

  it("arms a pending generate_hypotheses command from a natural hypothesis request", async () => {
    const app = makeApp();
    const run = makeRun("run-hypotheses");
    app.runIndex = [run];
    app.activeRunId = run.id;
    app.resolveTargetRun = vi.fn().mockResolvedValue(run);

    const handled = await app.handleFastNaturalIntent("가설을 10개 뽑아줘", new AbortController().signal);

    expect(handled).toBe(true);
    expect(app.logs).toContain("가설 10개 생성을 준비합니다.");
    expect(app.logs).toContain(
      `Resolved slash command: /agent run generate_hypotheses ${run.id} --top-k 10 --branch-count 10`
    );
    expect(app.pendingNaturalCommand?.commands).toEqual([
      `/agent run generate_hypotheses ${run.id} --top-k 10 --branch-count 10`
    ]);
    expect(app.pendingNaturalCommand?.displayCommands).toEqual(["가설 생성 (topK=10, branchCount=10)"]);
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
    expect(app.logs).toContain("현재 저장된 가설 3개 중 3개를 보여드립니다.");
    expect(app.logs).toContain("1. Hypothesis A");
    expect(app.logs.some((line: string) => line.includes("6개라고"))).toBe(false);
  });

  it("stores top-k and branch-count request for /agent run generate_hypotheses", async () => {
    const app = makeApp();
    const run = makeRun("run-generate-options");
    await rm(path.join(".autoresearch", "runs", run.id), { recursive: true, force: true });
    await mkdir(path.dirname(run.memoryRefs.runContextPath), { recursive: true });

    app.resolveTargetRun = vi.fn().mockResolvedValue(run);
    app.setActiveRunId = vi.fn();
    app.refreshRunIndex = vi.fn();
    app.orchestrator = {
      runAgentWithOptions: vi.fn().mockResolvedValue({
        run,
        result: { status: "success", summary: "hypotheses generated" }
      })
    };

    const result = await app.handleAgent(["run", "generate_hypotheses", "--top-k", "3", "--branch-count", "8"]);

    expect(result.ok).toBe(true);
    expect(app.orchestrator.runAgentWithOptions).toHaveBeenCalledWith(run.id, "generate_hypotheses", {
      abortSignal: undefined
    });

    const stored = JSON.parse(await readFile(run.memoryRefs.runContextPath, "utf8"));
    const requestItem = stored.items.find((item: { key: string }) => item.key === "generate_hypotheses.request");
    expect(requestItem?.value).toEqual({ topK: 3, branchCount: 8 });
  });

  it("treats ctrl+c like escape while busy", async () => {
    const app = makeApp();
    app.busy = true;
    app.cancelCurrentBusyOperation = vi.fn();
    app.shutdown = vi.fn();

    await app.handleKeypress("", { ctrl: true, name: "c" });

    expect(app.cancelCurrentBusyOperation).toHaveBeenCalledTimes(1);
    expect(app.shutdown).not.toHaveBeenCalled();
  });

  it("still shuts down on ctrl+c when idle", async () => {
    const app = makeApp();
    app.busy = false;
    app.cancelCurrentBusyOperation = vi.fn();
    app.shutdown = vi.fn();

    await app.handleKeypress("", { ctrl: true, name: "c" });

    expect(app.shutdown).toHaveBeenCalledTimes(1);
    expect(app.cancelCurrentBusyOperation).not.toHaveBeenCalled();
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

    expect(guidance?.title).toBe("시작 가이드");
    expect(guidance?.items.some((item: { label: string }) => item.label === "지원되는 자연어 입력을 보여줘")).toBe(true);
  });

  it("fills the executable command on tab even when pending guidance shows a display label", async () => {
    const app = makeApp();
    app.pendingNaturalCommand = {
      command: "/agent run analyze_papers run-1 --top-n 30",
      commands: ["/agent run analyze_papers run-1 --top-n 30"],
      displayCommands: ["상위 30개 논문 분석"],
      sourceInput: "30편 분석 진행해줘",
      createdAt: new Date().toISOString(),
      stepIndex: 0,
      totalSteps: 1
    };

    await app.handleKeypress("", { name: "tab" });

    expect(app.input).toBe("/agent run analyze_papers run-1 --top-n 30");
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
    app.refreshRunIndex = vi.fn();
    app.orchestrator = {
      runAgentWithOptions: vi.fn().mockResolvedValue({
        run,
        result: { status: "success", summary: "Canceled by user" }
      })
    };

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
    app.orchestrator = {
      runAgentWithOptions: vi.fn().mockResolvedValue({
        run,
        result: { status: "success", summary: longSummary }
      })
    };

    const result = await app.handleAgent(["run", "analyze_papers"], new AbortController().signal);
    const completionLog = app.logs.find((line: string) => line.startsWith("Node analyze_papers finished:"));

    expect(result.ok).toBe(true);
    expect(completionLog).toContain(tailMarker);
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
    expect(app.logs).toContain("Confirmed. Running step 1/3: /help");
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

  it("runs all remaining plan steps when confirmed with 'a'", async () => {
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
    expect(app.logs).toContain("Step 1/3 completed.");
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
});
