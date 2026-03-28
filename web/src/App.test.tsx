import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectVisibleText(text: string): void {
  expect(screen.getByText(text)).toBeInTheDocument();
}

describe("App", () => {
  it("renders onboarding without a PDF mode prompt when the workspace is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/bootstrap")) {
          return new Response(
            JSON.stringify({
              configured: false,
              setupDefaults: {
                projectName: "AutoLabOS",
                defaultTopic: "Multi-agent collaboration",
                defaultConstraints: ["recent papers", "last 5 years"],
                defaultObjectiveMetric: "state-of-the-art reproducibility"
              },
              session: {
                busy: false,
                logs: [],
                canCancel: false
              },
              runs: []
            }),
            { status: 200 }
          );
        }
        if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
          return new Response(JSON.stringify({ entries: [] }), { status: 200 });
        }
        if (url.includes("/api/runs/") && url.includes("/literature")) {
          return new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 });
        }
        return new Response(JSON.stringify({ configured: false, checks: [] }), { status: 200 });
      })
    );
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Initial setup")).toBeInTheDocument();
      expect(screen.getByText("Initialize workspace")).toBeInTheDocument();
    });

    const codexChatSection = screen.getByText("Codex chat").closest("section");
    expect(codexChatSection).not.toBeNull();
    expect(screen.queryByText("OpenAI chat")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("PDF mode")).not.toBeInTheDocument();
    expect(within(codexChatSection as HTMLElement).getAllByRole("combobox")[0]).toHaveValue("gpt-5.3-codex-spark");
    expect(within(codexChatSection as HTMLElement).getAllByRole("combobox")[1]).toHaveValue("medium");
  });

  it("switches the onboarding form to the selected provider's model sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/bootstrap")) {
          return new Response(
            JSON.stringify({
              configured: false,
              setupDefaults: {
                projectName: "AutoLabOS",
                defaultTopic: "Multi-agent collaboration",
                defaultConstraints: ["recent papers", "last 5 years"],
                defaultObjectiveMetric: "state-of-the-art reproducibility"
              },
              session: {
                busy: false,
                logs: [],
                canCancel: false
              },
              runs: []
            }),
            { status: 200 }
          );
        }
        if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
          return new Response(JSON.stringify({ entries: [] }), { status: 200 });
        }
        if (url.includes("/api/runs/") && url.includes("/literature")) {
          return new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 });
        }
        return new Response(JSON.stringify({ configured: false, checks: [] }), { status: 200 });
      })
    );
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Initial setup")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Primary provider"), {
      target: { value: "openai_api" }
    });

    await waitFor(() => {
      expectVisibleText("OpenAI chat");
      expectVisibleText("OpenAI research backend");
      expectVisibleText("Research backend model and reasoning for API mode.");
    });

    expect(screen.queryByText("OpenAI PDF")).not.toBeInTheDocument();
    expect(screen.queryByText("Responses PDF")).not.toBeInTheDocument();

    expect(screen.queryByText("Codex chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex research backend")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Primary provider"), {
      target: { value: "ollama" }
    });

    await waitFor(() => {
      expectVisibleText("Ollama chat");
      expectVisibleText("Ollama research backend");
      expectVisibleText("Ollama experiment");
      expectVisibleText("Ollama vision");
      expect(screen.getByDisplayValue("http://127.0.0.1:11434")).toBeInTheDocument();
    });

    expect(screen.queryByText("OpenAI chat")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("OpenAI API key")).not.toBeInTheDocument();
  });

  it("shows Ollama settings and submits Ollama-specific fields", async () => {
    const bootstrapPayload = {
      configured: true,
      setupDefaults: {
        projectName: "AutoLabOS",
        defaultTopic: "Multi-agent collaboration",
        defaultConstraints: ["recent papers", "last 5 years"],
        defaultObjectiveMetric: "state-of-the-art reproducibility"
      },
      session: {
        busy: false,
        logs: [],
        canCancel: false
      },
      runs: [],
      configSummary: {
        projectName: "AutoLabOS",
        workflowMode: "agent_approval",
        approvalMode: "minimal",
        llmMode: "ollama",
        pdfMode: "ollama_vision",
        researchBackendModel: "qwen3.5:35b-a3b",
        chatModel: "qwen3.5:27b",
        experimentModel: "qwen2.5-coder:32b",
        researchBackendReasoning: undefined,
        chatReasoning: undefined,
        experimentReasoning: undefined
      },
      configForm: {
        projectName: "AutoLabOS",
        defaultTopic: "Multi-agent collaboration",
        defaultConstraints: "recent papers, last 5 years",
        defaultObjectiveMetric: "state-of-the-art reproducibility",
        llmMode: "ollama",
        codexChatModelChoice: "gpt-5.3-codex",
        codexChatReasoningEffort: "low",
        codexResearchBackendModelChoice: "gpt-5.4",
        codexResearchBackendReasoningEffort: "xhigh",
        codexExperimentModelChoice: "gpt-5.4",
        codexExperimentReasoningEffort: "xhigh",
        openAiChatModel: "gpt-5.4",
        openAiChatReasoningEffort: "low",
        openAiResearchBackendModel: "gpt-5.4",
        openAiResearchBackendReasoningEffort: "medium",
        openAiExperimentModel: "gpt-5.4",
        openAiExperimentReasoningEffort: "medium",
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaChatModel: "qwen3.5:27b",
        ollamaResearchModel: "qwen3.5:35b-a3b",
        ollamaExperimentModel: "qwen2.5-coder:32b",
        ollamaVisionModel: "qwen3.5:35b-a3b",
        networkPolicy: "blocked",
        networkPurpose: ""
      }
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/") && url.includes("/literature")) {
        return new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 });
      }
      if (url.includes("/api/setup")) {
        const body = JSON.parse(String(init?.body));
        expect(body.llmMode).toBe("ollama");
        expect(body.ollamaBaseUrl).toBe("http://127.0.0.1:22434");
        expect(body.ollamaChatModel).toBeDefined();
        expect(body.ollamaResearchModel).toBeDefined();
        expect(body.ollamaExperimentModel).toBeDefined();
        expect(body.ollamaVisionModel).toBeDefined();
        expect(body.openAiApiKey).toBe("");
        expect(body.networkPolicy).toBe("blocked");
        expect(body.networkPurpose).toBe("");
        return new Response(JSON.stringify({ bootstrap: bootstrapPayload }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    await waitFor(() => {
      expectVisibleText("Ollama chat");
      expectVisibleText("Ollama research backend");
      expectVisibleText("Ollama experiment");
      expectVisibleText("Ollama vision");
      expect(screen.getByLabelText("Ollama base URL")).toBeInTheDocument();
    });

    const ollamaExperimentSection = screen.getByText("Ollama experiment").closest("section");
    expect(ollamaExperimentSection).not.toBeNull();
    expect(within(ollamaExperimentSection as HTMLElement).getByRole("combobox", { name: "Model" })).toHaveValue(
      "qwen2.5-coder:32b"
    );

    fireEvent.change(screen.getByLabelText("Ollama base URL"), {
      target: { value: "http://127.0.0.1:22434" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/setup",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
  });

  it("shows per-slot model and reasoning selectors in workspace settings and submits them", async () => {
    const bootstrapPayload = {
      configured: true,
      setupDefaults: {
        projectName: "AutoLabOS",
        defaultTopic: "Multi-agent collaboration",
        defaultConstraints: ["recent papers", "last 5 years"],
        defaultObjectiveMetric: "state-of-the-art reproducibility"
      },
      session: {
        busy: false,
        logs: [],
        canCancel: false
      },
      runs: [],
      configSummary: {
        projectName: "AutoLabOS",
        workflowMode: "agent_approval",
        approvalMode: "minimal",
        llmMode: "codex_chatgpt_only",
        pdfMode: "codex_text_image_hybrid",
        researchBackendModel: "gpt-5.4",
        chatModel: "gpt-5.3-codex",
        experimentModel: "gpt-5.4",
        researchBackendReasoning: "xhigh",
        chatReasoning: "low",
        experimentReasoning: "xhigh"
      },
      configForm: {
        projectName: "AutoLabOS",
        defaultTopic: "Multi-agent collaboration",
        defaultConstraints: "recent papers, last 5 years",
        defaultObjectiveMetric: "state-of-the-art reproducibility",
        llmMode: "codex_chatgpt_only",
        codexChatModelChoice: "gpt-5.3-codex",
        codexChatReasoningEffort: "low",
        codexResearchBackendModelChoice: "gpt-5.4",
        codexResearchBackendReasoningEffort: "xhigh",
        codexExperimentModelChoice: "gpt-5.4",
        codexExperimentReasoningEffort: "xhigh",
        openAiChatModel: "gpt-5.4",
        openAiChatReasoningEffort: "low",
        openAiResearchBackendModel: "gpt-5.4",
        openAiResearchBackendReasoningEffort: "medium",
        openAiExperimentModel: "gpt-5.4",
        openAiExperimentReasoningEffort: "medium",
        networkPolicy: "blocked",
        networkPurpose: ""
      }
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(JSON.stringify(bootstrapPayload), { status: 200 });
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/") && url.includes("/literature")) {
        return new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 });
      }
      if (url.includes("/api/setup")) {
        const body = JSON.parse(String(init?.body));
        expect(body.pdfAnalysisMode).toBeUndefined();
        expect(body.codexChatModelChoice).toBe("gpt-5.4");
        expect(body.codexChatReasoningEffort).toBe("high");
        expect(body.codexResearchBackendModelChoice).toBeDefined();
        expect(body.codexExperimentModelChoice).toBeDefined();
        expect(body.openAiChatModel).toBeDefined();
        expect(body.openAiResearchBackendModel).toBeDefined();
        expect(body.openAiExperimentModel).toBeDefined();
        expect(body.responsesPdfModel).toBeUndefined();
        expect(body.codexPdfModelChoice).toBeUndefined();
        expect(body.openAiPdfModel).toBeUndefined();
        expect(body.networkPolicy).toBe("blocked");
        expect(body.networkPurpose).toBe("");
        return new Response(JSON.stringify({ bootstrap: bootstrapPayload }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
    });

    expectVisibleText("Research backend: gpt-5.4 · xhigh");

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    await waitFor(() => {
      expectVisibleText("Workspace settings");
      expectVisibleText("Model and reasoning by slot");
      expectVisibleText("Codex chat");
      expectVisibleText("Codex research backend");
      expectVisibleText("Research backend, analysis, and planning tasks.");
    });

    const codexChatSection = screen.getByText("Codex chat").closest("section");
    expect(codexChatSection).not.toBeNull();
    expect(screen.queryByText("OpenAI experiment")).not.toBeInTheDocument();
    expect(screen.queryByText("Responses PDF")).not.toBeInTheDocument();

    fireEvent.change(within(codexChatSection as HTMLElement).getAllByRole("combobox")[0], {
      target: { value: "gpt-5.4" }
    });
    fireEvent.change(within(codexChatSection as HTMLElement).getAllByRole("combobox")[1], {
      target: { value: "high" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/setup",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
  });

  it("renders warning-aware doctor checks for declared networked runs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              busy: false,
              logs: [],
              canCancel: false
            },
            runs: []
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(
          JSON.stringify({
            configured: true,
            checks: [
              {
                name: "experiment-web-restriction",
                ok: true,
                status: "warning",
                detail: "Code execution declares a network dependency for logging; keep the run in manual or risk_ack mode and treat the result as network-assisted."
              }
            ],
            readiness: {
              blocked: false,
              approvalMode: "minimal",
              executionApprovalMode: "risk_ack",
              dependencyMode: "local",
              sessionMode: "fresh",
              networkPolicy: "declared",
              networkPurpose: "logging",
              networkDeclarationPresent: true,
              networkApprovalSatisfied: true,
              warningChecks: ["experiment-web-restriction"],
              failedChecks: []
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ artifacts: [], checkpoints: [], literature: emptyLiterature("run-1") }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Doctor" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Doctor" }));

    await waitFor(() => {
      expect(screen.getByText("experiment-web-restriction")).toBeInTheDocument();
      expect(screen.getByText("WARN")).toBeInTheDocument();
      expect(screen.getByText(/network dependency for logging/i)).toBeInTheDocument();
    });
  });

  it("renders stronger emphasis for required network doctor checks", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              busy: false,
              logs: [],
              canCancel: false
            },
            runs: []
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(
          JSON.stringify({
            configured: true,
            checks: [
              {
                name: "experiment-web-restriction",
                ok: true,
                status: "warning",
                detail: "Code execution declares a network-critical dependency for remote_inference; reproducibility caveats and explicit operator review remain required."
              }
            ],
            readiness: {
              blocked: false,
              approvalMode: "minimal",
              executionApprovalMode: "risk_ack",
              dependencyMode: "remote_gpu",
              sessionMode: "fresh",
              networkPolicy: "required",
              networkPurpose: "remote_inference",
              networkDeclarationPresent: true,
              networkApprovalSatisfied: true,
              warningChecks: ["experiment-web-restriction"],
              failedChecks: []
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ artifacts: [], checkpoints: [], literature: emptyLiterature("run-1") }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Doctor" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Doctor" }));

    await waitFor(() => {
      expect(screen.getByText("experiment-web-restriction")).toBeInTheDocument();
      expect(screen.getByText("REQUIRED")).toBeInTheDocument();
      expect(screen.getByText(/network-critical dependency for remote_inference/i)).toBeInTheDocument();
      expect(screen.getByText(/Network is required for this run/i)).toBeInTheDocument();
    });
  });

  it("renders repository knowledge in the inspector tab", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: [],
              canCancel: false
            },
            runs: [
              {
                id: "run-1",
                title: "Run one",
                topic: "topic",
                constraints: ["recent papers"],
                objectiveMetric: "accuracy",
                status: "paused",
                currentNode: "review",
                latestSummary: "Review ready.",
                updatedAt: "2026-03-10T10:00:00.000Z",
                graph: {
                  currentNode: "review",
                  checkpointSeq: 4,
                  retryCounters: {},
                  rollbackCounters: {},
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    review: { status: "needs_approval", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                  }
                }
              }
            ],
            jobs: {
              generated_at: "2026-03-10T10:00:00.000Z",
              runs: [
                {
                  run_id: "run-1",
                  title: "Run one",
                  current_node: "analyze_results",
                  lifecycle_status: "paused",
                  approval_mode: "minimal",
                  last_event_at: "2026-03-10T10:00:00.000Z",
                  recommended_next_action: "resume_review",
                  analysis_ready: true,
                  review_ready: false,
                  paper_ready: false
                }
              ],
              top_failures: [
                {
                  key: "analysis:transition",
                  reason: "Review has not started yet for the analyzed run.",
                  occurrence_count: 1,
                  recurrence_probability: 1,
                  remediation: "Resume review from the analyze_results recommendation."
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                run_id: "run-1",
                title: "Run one",
                topic: "topic",
                objective_metric: "accuracy",
                latest_summary: "Review ready.",
                latest_published_section: "review",
                updated_at: "2026-03-10T10:00:00.000Z",
                public_output_root: "outputs/run-1",
                public_manifest: "outputs/run-1/manifest.json",
                knowledge_note: ".autolabos/knowledge/runs/run-1.md",
                research_question: "Does the treatment outperform the baseline?",
                analysis_summary: "Treatment improved accuracy over baseline.",
                manuscript_type: "paper_scale_candidate",
                sections: [
                  {
                    name: "analysis",
                    generated_files: ["analysis/summary.md"],
                    updated_at: "2026-03-10T10:00:00.000Z"
                  },
                  {
                    name: "review",
                    generated_files: ["review/review_packet.json"],
                    updated_at: "2026-03-10T10:00:00.000Z"
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/knowledge/file?path=.autolabos%2Fknowledge%2Fruns%2Frun-1.md")) {
        return new Response(
          JSON.stringify({
            path: ".autolabos/knowledge/runs/run-1.md",
            content: "# Run one\n\n## Research Question\n\nDoes the treatment outperform the baseline?\n"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/knowledge/file?path=outputs%2Frun-1%2Fmanifest.json") || url.includes("/api/knowledge/file?path=outputs%2Fmanifest.json")) {
        return new Response(
          JSON.stringify({
            path: "outputs/run-1/manifest.json",
            content: '{\n  "version": 1\n}\n'
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/knowledge/file?path=.autolabos%2Fruns%2Frun-1%2Fliterature_index.json")) {
        return new Response(
          JSON.stringify({
            path: ".autolabos/runs/run-1/literature_index.json",
            content: '{\n  "version": 1,\n  "run_id": "run-1"\n}\n'
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/runs/run-1/literature")) {
        return new Response(JSON.stringify({ literature: populatedLiterature("run-1") }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fcollect_result.json")) {
        return new Response('{"status":"completed","paper_count":40}\n', { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fcorpus.jsonl")) {
        return new Response('{"paper_id":"p1","title":"Corpus paper"}\n', { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fbibtex.bib")) {
        return new Response('@article{p1,title={Corpus paper}}\n', { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fpaper_summaries.jsonl")) {
        return new Response('{"paper_id":"p1","summary":"Summary row"}\n', { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fevidence_store.jsonl")) {
        return new Response('{"paper_id":"p1","quote":"Evidence row"}\n', { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifacts")) {
        return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/checkpoints")) {
        return new Response(JSON.stringify({ checkpoints: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1") && !url.includes("/actions")) {
        return new Response(
          JSON.stringify({
            run: {
              id: "run-1",
              title: "Run one",
              topic: "topic",
              constraints: ["recent papers"],
              objectiveMetric: "accuracy",
              status: "paused",
              currentNode: "review",
              latestSummary: "Review ready.",
              updatedAt: "2026-03-10T10:00:00.000Z",
              graph: {
                currentNode: "review",
                checkpointSeq: 4,
                retryCounters: {},
                rollbackCounters: {},
                nodeStates: {
                  collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  review: { status: "needs_approval", updatedAt: "2026-03-10T10:00:00.000Z" },
                  write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Knowledge" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Knowledge" }));

    await waitFor(() => {
      expect(screen.getByText("Does the treatment outperform the baseline?")).toBeInTheDocument();
      expect(screen.getAllByText("Treatment improved accuracy over baseline.").length).toBeGreaterThan(0);
      expect(screen.getByText("paper_scale_candidate")).toBeInTheDocument();
      expect(screen.getByText("outputs/run-1/manifest.json")).toBeInTheDocument();
      expect(screen.getByText("40 papers")).toBeInTheDocument();
      expect(screen.getByText("32 with PDF / 8 missing")).toBeInTheDocument();
      expect(screen.getByText("35 with BibTeX / 12 enriched")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview note" }));

    await waitFor(() => {
      expect(screen.getAllByText(".autolabos/knowledge/runs/run-1.md").length).toBeGreaterThan(0);
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/api/knowledge/file?path=.autolabos%2Fknowledge%2Fruns%2Frun-1.md")
        )
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview literature index" }));

    await waitFor(() => {
      expect(screen.getByText(".autolabos/runs/run-1/literature_index.json")).toBeInTheDocument();
      expect(screen.getAllByText(/"run_id": "run-1"/i).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Open collect result" }));

    await waitFor(() => {
      expect(screen.getByText('{"status":"completed","paper_count":40}')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fcollect_result.json"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Knowledge" }));

    fireEvent.click(screen.getByRole("button", { name: "Open corpus" }));

    await waitFor(() => {
      expect(screen.getByText('{"paper_id":"p1","title":"Corpus paper"}')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fcorpus.jsonl"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Knowledge" }));
    fireEvent.click(screen.getByRole("button", { name: "Open bibtex" }));

    await waitFor(() => {
      expect(screen.getByText("@article{p1,title={Corpus paper}}")).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fbibtex.bib"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Knowledge" }));
    fireEvent.click(screen.getByRole("button", { name: "Open summaries" }));

    await waitFor(() => {
      expect(screen.getByText('{"paper_id":"p1","summary":"Summary row"}')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fpaper_summaries.jsonl"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Knowledge" }));
    fireEvent.click(screen.getByRole("button", { name: "Open evidence" }));

    await waitFor(() => {
      expect(screen.getByText('{"paper_id":"p1","quote":"Evidence row"}')).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/runs/run-1/artifact?path=.autolabos%2Fruns%2Frun-1%2Fevidence_store.jsonl"))).toBe(true);
    });
  });

  it("renders result analysis insight actions and runs the suggested command", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: [],
              canCancel: false,
              activeRunInsight: {
                title: "Result analysis",
                lines: [
                  "Objective: met - accuracy reached the configured target.",
                  "Recommendation: advance -> review (88%)",
                  "Next: Approve the transition into review."
                ],
                actions: [{ label: "Run recommendation", command: "/approve" }],
                references: [
                  {
                    kind: "comparison",
                    label: "Comparison: Treatment vs baseline",
                    path: "result_analysis.json",
                    summary: "Treatment improved accuracy over the baseline by 0.05.",
                    facts: [
                      { label: "Metric", value: "accuracy" },
                      { label: "Delta", value: "+0.05" },
                      { label: "Support", value: "yes" }
                    ],
                    details: [
                      "Hypothesis support: supported by this comparison.",
                      "accuracy: primary 0.81 vs baseline 0.76 (+0.05)."
                    ]
                  },
                  {
                    kind: "statistics",
                    label: "Statistics: accuracy",
                    path: "result_analysis.json",
                    summary: "The treatment delivered a positive effect estimate of +0.05 accuracy versus baseline.",
                    facts: [
                      { label: "Metric", value: "accuracy" },
                      { label: "Delta", value: "+0.05" },
                      { label: "Confidence", value: "95%" }
                    ],
                    details: [
                      "Effect direction: positive for accuracy.",
                      "Sampling profile: 3 total, 3 executed."
                    ]
                  },
                  {
                    kind: "figure",
                    label: "Figure: Performance overview",
                    path: "figures/performance.svg",
                    summary: "Primary visualization for the recommendation.",
                    facts: [
                      { label: "Matched metric", value: "accuracy" },
                      { label: "Runs", value: "3" }
                    ],
                    details: [
                      "Metrics charted: accuracy, f1.",
                      "Top observed metric: accuracy=0.81."
                    ]
                  },
                  {
                    kind: "report",
                    label: "Analysis report",
                    path: "result_analysis.json",
                    summary: "Full structured report with grounded analysis details.",
                    facts: [
                      { label: "Mean", value: "0.81" },
                      { label: "Matched metric", value: "accuracy" },
                      { label: "Objective", value: "met" }
                    ],
                    details: [
                      "The treatment cleared the objective threshold with limited run-to-run variance.",
                      "Limitation: Only one confirmatory configuration was executed."
                    ]
                  }
                ]
              }
            },
            runs: [
              {
                id: "run-1",
                title: "Run one",
                topic: "topic",
                constraints: ["recent papers"],
                objectiveMetric: "accuracy",
                status: "paused",
                currentNode: "analyze_results",
                latestSummary: "Analysis complete.",
                updatedAt: "2026-03-10T10:00:00.000Z",
                graph: {
                  currentNode: "analyze_results",
                  checkpointSeq: 3,
                  retryCounters: {},
                  rollbackCounters: {},
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    review: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                  },
                  pendingTransition: {
                    action: "advance",
                    targetNode: "review",
                    reason: "The objective is met and the run can move into review before paper writing.",
                    confidence: 0.88,
                    autoExecutable: true,
                    evidence: ["accuracy reached the configured target."],
                    suggestedCommands: ["/approve"],
                    generatedAt: "2026-03-10T10:00:00.000Z"
                  }
                }
              }
            ],
            jobs: {
              generated_at: "2026-03-10T10:00:00.000Z",
              runs: [
                {
                  run_id: "run-1",
                  title: "Run one",
                  current_node: "analyze_results",
                  lifecycle_status: "paused",
                  approval_mode: "minimal",
                  last_event_at: "2026-03-10T10:00:00.000Z",
                  recommended_next_action: "resume_review",
                  analysis_ready: true,
                  review_ready: false,
                  paper_ready: false,
                  blocker_summary: "Review has not started yet; inspect the review packet inputs before approving the transition."
                }
              ],
              top_failures: [
                {
                  key: "review-gap",
                  reason: "Review is still pending after analysis completed.",
                  recurrence_probability: 0.67,
                  remediation: "Resume review and inspect the review packet before moving forward."
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/") && url.includes("/literature")) {
        return new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifacts")) {
        return new Response(
          JSON.stringify({
            artifacts: [
              {
                path: "figures/performance.svg",
                kind: "image",
                size: 128,
                modifiedAt: "2026-03-10T10:00:00.000Z",
                previewable: true
              },
              {
                path: "result_analysis.json",
                kind: "json",
                size: 512,
                modifiedAt: "2026-03-10T10:00:00.000Z",
                previewable: true
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/runs/run-1/checkpoints")) {
        return new Response(JSON.stringify({ checkpoints: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1") && !url.includes("/actions")) {
        return new Response(
          JSON.stringify({
            run: {
              id: "run-1",
              title: "Run one",
              topic: "topic",
              constraints: ["recent papers"],
              objectiveMetric: "accuracy",
              status: "paused",
              currentNode: "analyze_results",
              latestSummary: "Analysis complete.",
              updatedAt: "2026-03-10T10:00:00.000Z",
              graph: {
                currentNode: "analyze_results",
                checkpointSeq: 3,
                retryCounters: {},
                rollbackCounters: {},
                nodeStates: {
                  collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  review: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" },
                  write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                },
                pendingTransition: {
                  action: "advance",
                  targetNode: "review",
                  reason: "The objective is met and the run can move into review before paper writing.",
                  confidence: 0.88,
                  autoExecutable: true,
                  evidence: ["accuracy reached the configured target."],
                  suggestedCommands: ["/approve"],
                  generatedAt: "2026-03-10T10:00:00.000Z"
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/session/input")) {
        expect(JSON.parse(String(init?.body))).toEqual({ text: "/approve" });
        return new Response(
          JSON.stringify({
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: ["Approved transition."],
              canCancel: false,
                  activeRunInsight: {
                    title: "Result analysis",
                    lines: ["Objective: met - accuracy reached the configured target."],
                    actions: [{ label: "Run recommendation", command: "/approve" }],
                    references: [
                      {
                        kind: "comparison",
                        label: "Comparison: Treatment vs baseline",
                        path: "result_analysis.json",
                        summary: "Treatment improved accuracy over the baseline by 0.05.",
                        facts: [
                          { label: "Metric", value: "accuracy" },
                          { label: "Delta", value: "+0.05" },
                          { label: "Support", value: "yes" }
                        ],
                        details: [
                          "Hypothesis support: supported by this comparison.",
                          "accuracy: primary 0.81 vs baseline 0.76 (+0.05)."
                        ]
                      },
                      {
                        kind: "statistics",
                        label: "Statistics: accuracy",
                        path: "result_analysis.json",
                        summary: "The treatment delivered a positive effect estimate of +0.05 accuracy versus baseline.",
                        facts: [
                          { label: "Metric", value: "accuracy" },
                          { label: "Delta", value: "+0.05" },
                          { label: "Confidence", value: "95%" }
                        ],
                        details: [
                          "Effect direction: positive for accuracy.",
                          "Sampling profile: 3 total, 3 executed."
                        ]
                      },
                      {
                        kind: "figure",
                        label: "Figure: Performance overview",
                        path: "figures/performance.svg",
                        summary: "Primary visualization for the recommendation.",
                        facts: [
                          { label: "Matched metric", value: "accuracy" },
                          { label: "Runs", value: "3" }
                        ],
                        details: [
                          "Metrics charted: accuracy, f1.",
                          "Top observed metric: accuracy=0.81."
                        ]
                      },
                      {
                        kind: "report",
                        label: "Analysis report",
                        path: "result_analysis.json",
                        summary: "Full structured report with grounded analysis details.",
                        facts: [
                          { label: "Mean", value: "0.81" },
                          { label: "Matched metric", value: "accuracy" },
                          { label: "Objective", value: "met" }
                        ],
                        details: [
                          "The treatment cleared the objective threshold with limited run-to-run variance.",
                          "Limitation: Only one confirmatory configuration was executed."
                        ]
                      }
                    ]
                  }
                }
              }),
              { status: 200 }
            );
          }
      if (url.includes("/api/runs/run-1/artifact?path=result_analysis.json")) {
        return new Response('{"analysis_version":1}', { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Result analysis")).toBeInTheDocument();
      expect(screen.getByText("Recommendation: advance -> review (88%)")).toBeInTheDocument();
      expect(screen.getByText("Comparison")).toBeInTheDocument();
      expect(screen.getByText("Statistics")).toBeInTheDocument();
      expect(screen.getByText("Treatment improved accuracy over the baseline by 0.05.")).toBeInTheDocument();
      expect(screen.getAllByText("Metric accuracy").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Delta +0.05").length).toBeGreaterThan(0);
      expect(screen.getByText("Confidence 95%")).toBeInTheDocument();
      expect(screen.getByText("Full structured report with grounded analysis details.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /analysis report/i })).toBeInTheDocument();
      expect(screen.getByText("Top failures")).toBeInTheDocument();
      expect(screen.getByText("Next: Resume review")).toBeInTheDocument();
      expect(screen.getByText("A/R/P: yes/no/no")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /comparison: treatment vs baseline/i }));

    await waitFor(() => {
      expect(screen.getByText("Hypothesis support: supported by this comparison.")).toBeInTheDocument();
      expect(screen.getByText("accuracy: primary 0.81 vs baseline 0.76 (+0.05).")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /open artifact for comparison: treatment vs baseline/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /run recommendation/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/session/input",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "/approve" })
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /open artifact for comparison: treatment vs baseline/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === "/api/runs/run-1/artifact?path=result_analysis.json")
      ).toBe(true);
    });
  });

  it("renders the manuscript quality summary with separated issue groups and artifact links", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: [],
              canCancel: false,
              activeRunInsight: {
                title: "Manuscript quality",
                lines: [
                  "Status: Stopped.",
                  "Reason category: Policy Hard Stop.",
                  "Review reliability: grounded.",
                  "Triggered by: appendix_hygiene."
                ],
                manuscriptQuality: {
                  status: "stopped",
                  stage: "post_repair_1",
                  reasonCategory: "policy_hard_stop",
                  reviewReliability: "grounded",
                  triggeredBy: ["appendix_hygiene"],
                  repairAttempts: {
                    attempted: 1,
                    allowedMax: 2,
                    remaining: 0,
                    improvementDetected: false
                  },
                  issueCounts: {
                    manuscript: 1,
                    hardStopPolicy: 1,
                    backstopOnly: 1,
                    readinessRisks: 1,
                    scientificBlockers: 1,
                    submissionBlockers: 1,
                    reviewerMissedPolicy: 1,
                    reviewerCoveredBackstop: 1
                  },
                  issueGroups: {
                    manuscript: [
                      {
                        code: "appendix_hygiene",
                        section: "Appendix",
                        severity: "fail",
                        message: "Appendix still contains internal workflow language.",
                        source: "review"
                      }
                    ],
                    hardStopPolicy: [
                      {
                        code: "appendix_internal_text",
                        section: "Appendix",
                        severity: "fail",
                        message: "Deterministic hard-stop policy finding remained uncovered in Appendix.",
                        source: "style_lint"
                      }
                    ],
                    backstopOnly: [
                      {
                        code: "duplicate_sentence_pattern",
                        section: "Discussion",
                        severity: "warning",
                        message: "Deterministic backstop finding remains recorded for Discussion.",
                        source: "style_lint"
                      }
                    ],
                    readiness: [
                      {
                        code: "paper_scale_paper_scale_candidate",
                        section: "Paper scale",
                        severity: "warning",
                        message: "The post-draft critique still classifies the run as paper_scale_candidate, not paper_ready.",
                        source: "paper_readiness"
                      }
                    ],
                    scientific: [
                      {
                        code: "missing_baseline",
                        section: "Results",
                        severity: "fail",
                        message: "Baseline comparison is still missing.",
                        source: "scientific_validation"
                      }
                    ],
                    submission: [
                      {
                        code: "citation",
                        section: "Conclusion",
                        severity: "fail",
                        message: "A comparative claim in the conclusion is uncited.",
                        source: "submission_validation"
                      }
                    ]
                  },
                  artifactRefs: [
                    { label: "Manuscript quality gate", path: "paper/manuscript_quality_gate.json" },
                    { label: "Manuscript quality failure", path: "paper/manuscript_quality_failure.json" },
                    { label: "Readiness risks", path: "paper/readiness_risks.json" },
                    { label: "Manuscript review", path: "paper/manuscript_review.json" }
                  ]
                }
              }
            },
            runs: [
              {
                id: "run-1",
                title: "Run one",
                topic: "topic",
                constraints: ["recent papers"],
                objectiveMetric: "accuracy",
                status: "failed",
                currentNode: "write_paper",
                latestSummary: "write_paper stopped at the manuscript quality gate.",
                updatedAt: "2026-03-10T10:00:00.000Z",
                graph: {
                  currentNode: "write_paper",
                  checkpointSeq: 7,
                  retryCounters: {},
                  rollbackCounters: {},
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    review: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "failed", updatedAt: "2026-03-10T10:00:00.000Z" }
                  }
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/") && url.includes("/literature")) {
        return new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifacts")) {
        return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/checkpoints")) {
        return new Response(JSON.stringify({ checkpoints: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1") && !url.includes("/actions")) {
        return new Response(
          JSON.stringify({
            run: {
              id: "run-1",
              title: "Run one",
              topic: "topic",
              constraints: ["recent papers"],
              objectiveMetric: "accuracy",
              status: "failed",
              currentNode: "write_paper",
              latestSummary: "write_paper stopped at the manuscript quality gate.",
              updatedAt: "2026-03-10T10:00:00.000Z",
              graph: {
                currentNode: "write_paper",
                checkpointSeq: 7,
                retryCounters: {},
                rollbackCounters: {},
                nodeStates: {
                  collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  review: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  write_paper: { status: "failed", updatedAt: "2026-03-10T10:00:00.000Z" }
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Manuscript quality")).toBeInTheDocument();
      expect(screen.getByText("Stopped")).toBeInTheDocument();
      expect(screen.getByText("Policy Hard Stop")).toBeInTheDocument();
      expect(screen.getByText("Repairable manuscript issues")).toBeInTheDocument();
      expect(screen.getByText("Hard-stop policy findings")).toBeInTheDocument();
      expect(screen.getByText("Paper readiness risks")).toBeInTheDocument();
      expect(screen.getByText("Scientific blockers")).toBeInTheDocument();
      expect(screen.getByText("Submission blockers")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manuscript quality gate" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manuscript quality failure" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Readiness risks" })).toBeInTheDocument();
    });
  });

  it("renders review-stage readiness risks in the selected-run insight panel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: [],
              canCancel: false,
              activeRunInsight: {
                title: "Review packet",
                lines: [
                  "Review packet refreshed.",
                  "Paper readiness risks: blocked 1, warning 0, state blocked_for_paper_scale."
                ],
                readinessRisks: {
                  stage: "review",
                  readinessState: "blocked_for_paper_scale",
                  paperReady: false,
                  riskCounts: {
                    total: 1,
                    blocked: 1,
                    warning: 0
                  },
                  risks: [
                    {
                      code: "review_minimum_gate_blocked_for_paper_scale",
                      section: "Paper scale",
                      severity: "fail",
                      message: "Minimum gate: 3 check(s) failed — ceiling: blocked_for_paper_scale.",
                      source: "review_readiness"
                    }
                  ],
                  artifactRefs: [{ label: "Review readiness risks", path: "review/readiness_risks.json" }]
                }
              }
            },
            runs: [
              {
                id: "run-1",
                title: "Run one",
                topic: "topic",
                constraints: ["recent papers"],
                objectiveMetric: "accuracy",
                status: "paused",
                currentNode: "review",
                latestSummary: "Review packet prepared.",
                updatedAt: "2026-03-10T10:00:00.000Z",
                graph: {
                  currentNode: "review",
                  checkpointSeq: 4,
                  retryCounters: {},
                  rollbackCounters: {},
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    review: { status: "needs_approval", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                  }
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifacts")) {
        return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/checkpoints")) {
        return new Response(JSON.stringify({ checkpoints: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1") && !url.includes("/actions")) {
        return new Response(
          JSON.stringify({
            run: {
              id: "run-1",
              title: "Run one",
              topic: "topic",
              constraints: ["recent papers"],
              objectiveMetric: "accuracy",
              status: "paused",
              currentNode: "review",
              latestSummary: "Review packet prepared.",
              updatedAt: "2026-03-10T10:00:00.000Z",
              graph: {
                currentNode: "review",
                checkpointSeq: 4,
                retryCounters: {},
                rollbackCounters: {},
                nodeStates: {
                  collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  review: { status: "needs_approval", updatedAt: "2026-03-10T10:00:00.000Z" },
                  write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/runs/run-1/artifact?path=review%2Freadiness_risks.json")) {
        return new Response(
          JSON.stringify({
            generated_at: "2026-03-10T10:00:00.000Z",
            paper_ready: false,
            readiness_state: "blocked_for_paper_scale",
            risk_count: 1,
            blocked_count: 1,
            warning_count: 0,
            risks: [
              {
                risk_code: "review_minimum_gate_blocked_for_paper_scale",
                severity: "blocked",
                category: "paper_scale",
                status: "blocked",
                message: "Minimum gate: 3 check(s) failed — ceiling: blocked_for_paper_scale.",
                triggered_by: ["minimum_gate"],
                affected_claim_ids: [],
                affected_citation_ids: [],
                recommended_action: "Backtrack and raise the review minimum gate before drafting.",
                recheck_condition: "Minimum gate passes with the required evidence floor."
              }
            ],
            summary_lines: ["Readiness risks: blocked=1, warning=0, readiness_state=blocked_for_paper_scale."]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Review packet")).toBeInTheDocument();
      expect(screen.getByText("Paper readiness risks")).toBeInTheDocument();
      expect(screen.getByText("Readiness State")).toBeInTheDocument();
      expect(screen.getByText("blocked_for_paper_scale")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Review readiness risks" })).toBeInTheDocument();
    });
  });

  it("renders a structured review packet preview and runs the refresh command", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: [],
              canCancel: false
            },
            runs: [
              {
                id: "run-1",
                title: "Run one",
                topic: "topic",
                constraints: ["recent papers"],
                objectiveMetric: "accuracy",
                status: "paused",
                currentNode: "review",
                latestSummary: "Review packet prepared.",
                updatedAt: "2026-03-10T10:00:00.000Z",
                graph: {
                  currentNode: "review",
                  checkpointSeq: 4,
                  retryCounters: {},
                  rollbackCounters: {},
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    review: { status: "needs_approval", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                  }
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1/artifacts")) {
        return new Response(
          JSON.stringify({
            artifacts: [
              {
                path: "review/review_packet.json",
                kind: "json",
                size: 1024,
                modifiedAt: "2026-03-10T10:00:00.000Z",
                previewable: true
              },
              {
                path: "review/checklist.md",
                kind: "text",
                size: 512,
                modifiedAt: "2026-03-10T10:00:00.000Z",
                previewable: true
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/runs/run-1/checkpoints")) {
        return new Response(JSON.stringify({ checkpoints: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-1") && !url.includes("/actions")) {
        return new Response(
          JSON.stringify({
            run: {
              id: "run-1",
              title: "Run one",
              topic: "topic",
              constraints: ["recent papers"],
              objectiveMetric: "accuracy",
              status: "paused",
              currentNode: "review",
              latestSummary: "Review packet prepared.",
              updatedAt: "2026-03-10T10:00:00.000Z",
              graph: {
                currentNode: "review",
                checkpointSeq: 4,
                retryCounters: {},
                rollbackCounters: {},
                nodeStates: {
                  collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  review: { status: "needs_approval", updatedAt: "2026-03-10T10:00:00.000Z" },
                  write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/runs/run-1/artifact?path=review%2Freview_packet.json")) {
        return new Response(
          JSON.stringify(
            {
              generated_at: "2026-03-10T10:00:00.000Z",
              readiness: {
                status: "blocking",
                ready_checks: 3,
                warning_checks: 2,
                blocking_checks: 1,
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
                  id: "evidence_bundle",
                  label: "Evidence bundle",
                  status: "blocking",
                  detail: "Missing required paper inputs: evidence_store.jsonl."
                },
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
              suggested_actions: ["/agent apply", "/agent jump analyze_results"]
            },
            null,
            2
          ),
          { status: 200 }
        );
      }
      if (url.includes("/api/session/input")) {
        expect(JSON.parse(String(init?.body))).toEqual({ text: "/agent review" });
        return new Response(
          JSON.stringify({
            session: {
              activeRunId: "run-1",
              busy: false,
              logs: ["Review packet refreshed."],
              canCancel: false
            }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Selected run")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Artifacts" }));
    fireEvent.click(screen.getByRole("button", { name: /review\/review_packet\.json/i }));

    await waitFor(() => {
      expect(screen.getByText("Review readiness")).toBeInTheDocument();
      expect(screen.getAllByText("Blocking").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /refresh review/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh review/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/session/input",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: "/agent review" })
        })
      );
    });
  });

  it("shows a live activity banner immediately while a command request is in flight", async () => {
    let resolveSessionInput: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configured: true,
              setupDefaults: {
                projectName: "AutoLabOS",
                defaultTopic: "Multi-agent collaboration",
                defaultConstraints: ["recent papers", "last 5 years"],
                defaultObjectiveMetric: "state-of-the-art reproducibility"
              },
              session: {
                activeRunId: "run-1",
                busy: false,
                logs: [],
                canCancel: false
              },
              runs: [
                {
                  id: "run-1",
                  title: "Run one",
                  topic: "topic",
                  constraints: ["recent papers"],
                  objectiveMetric: "accuracy",
                  status: "paused",
                  currentNode: "analyze_results",
                  latestSummary: "Analysis complete.",
                  updatedAt: "2026-03-10T10:00:00.000Z",
                  graph: {
                    currentNode: "analyze_results",
                    checkpointSeq: 3,
                    retryCounters: {},
                    rollbackCounters: {},
                    nodeStates: {
                      collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      review: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" },
                      write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                    }
                  }
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("/api/doctor")) {
        return Promise.resolve(new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 }));
      }
      if (url.includes("/api/knowledge") && !url.includes("/api/knowledge/file")) {
        return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
      }
      if (url.includes("/api/runs/") && url.includes("/literature")) {
        return Promise.resolve(new Response(JSON.stringify({ literature: emptyLiterature("run-1") }), { status: 200 }));
      }
      if (url.includes("/api/runs/run-1/artifacts")) {
        return Promise.resolve(new Response(JSON.stringify({ artifacts: [] }), { status: 200 }));
      }
      if (url.includes("/api/runs/run-1/checkpoints")) {
        return Promise.resolve(new Response(JSON.stringify({ checkpoints: [] }), { status: 200 }));
      }
      if (url.includes("/api/runs/run-1") && !url.includes("/actions")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              run: {
                id: "run-1",
                title: "Run one",
                topic: "topic",
                constraints: ["recent papers"],
                objectiveMetric: "accuracy",
                status: "paused",
                currentNode: "analyze_results",
                latestSummary: "Analysis complete.",
                updatedAt: "2026-03-10T10:00:00.000Z",
                graph: {
                  currentNode: "analyze_results",
                  checkpointSeq: 3,
                  retryCounters: {},
                  rollbackCounters: {},
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    review: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                  }
                }
              }
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes("/api/session/input")) {
        expect(JSON.parse(String(init?.body))).toEqual({ text: "/agent status" });
        return new Promise<Response>((resolve) => {
          resolveSessionInput = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Selected run")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "/agent status" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Runtime activity")).toBeInTheDocument();
      expect(screen.getAllByText("Running /agent status").length).toBeGreaterThan(0);
      expect(screen.getByText("Run one · Analyze Results")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Running..." })).toBeInTheDocument();
    });

    resolveSessionInput?.(
      new Response(
        JSON.stringify({
          session: {
            activeRunId: "run-1",
            busy: false,
            logs: ["Status checked."],
            canCancel: false
          }
        }),
        { status: 200 }
      )
    );

    await waitFor(() => {
      expect(screen.queryByText("Runtime activity")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    });
  });

  it("submits a natural-language research brief and auto-start preference when creating a run", async () => {
    let createdRun:
      | {
          id: string;
          title: string;
          topic: string;
          constraints: string[];
          objectiveMetric: string;
          status: string;
          currentNode: string;
          latestSummary?: string;
          updatedAt: string;
          graph: {
            currentNode: string;
            checkpointSeq: number;
            retryCounters: Record<string, number>;
            rollbackCounters: Record<string, number>;
            nodeStates: Record<string, { status: string; updatedAt: string }>;
          };
        }
      | undefined;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoLabOS",
              defaultTopic: "Multi-agent collaboration",
              defaultConstraints: ["recent papers", "last 5 years"],
              defaultObjectiveMetric: "state-of-the-art reproducibility"
            },
            session: {
              activeRunId: createdRun?.id,
              busy: false,
              logs: [],
              canCancel: false
            },
            runs: createdRun ? [createdRun] : []
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/doctor")) {
        return new Response(JSON.stringify({ configured: true, checks: [] }), { status: 200 });
      }
      if (url.includes("/api/knowledge")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/") && url.includes("/literature")) {
        return new Response(JSON.stringify({ literature: emptyLiterature(createdRun?.id || "run-brief-1") }), { status: 200 });
      }
      if (url === "/api/runs") {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          brief: "주제: 멀티에이전트 실험 자동화\n목표: accuracy >= 0.9\n제약: 최근 5년, 오픈소스만",
          autoStart: true
        });
        createdRun = {
          id: "run-brief-1",
          title: "Run brief",
          topic: "멀티에이전트 실험 자동화",
          constraints: ["최근 5년", "오픈소스만"],
          objectiveMetric: "accuracy >= 0.9",
          status: "running",
          currentNode: "collect_papers",
          latestSummary: "collect_papers started",
          updatedAt: "2026-03-11T10:00:00.000Z",
          graph: {
            currentNode: "collect_papers",
            checkpointSeq: 0,
            retryCounters: {},
            rollbackCounters: {},
            nodeStates: {
              collect_papers: { status: "running", updatedAt: "2026-03-11T10:00:00.000Z" },
              analyze_papers: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              generate_hypotheses: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              design_experiments: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              implement_experiments: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              run_experiments: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              analyze_results: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              review: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" },
              write_paper: { status: "pending", updatedAt: "2026-03-11T10:00:00.000Z" }
            }
          }
        };
        return new Response(
          JSON.stringify({
            run: createdRun,
            session: {
              activeRunId: createdRun.id,
              busy: false,
              logs: ["Created from brief."],
              canCancel: false
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/api/runs/run-brief-1/artifacts")) {
        return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-brief-1/checkpoints")) {
        return new Response(JSON.stringify({ checkpoints: [] }), { status: 200 });
      }
      if (url.includes("/api/runs/run-brief-1") && !url.includes("/actions")) {
        return new Response(JSON.stringify({ run: createdRun }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New run" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.change(screen.getByLabelText("Research brief"), {
      target: {
        value: "주제: 멀티에이전트 실험 자동화\n목표: accuracy >= 0.9\n제약: 최근 5년, 오픈소스만"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    expect(screen.getAllByText("Run brief").length).toBeGreaterThan(0);
    expect(screen.getByText("collect_papers started")).toBeInTheDocument();
  });
});

function emptyLiterature(runId: string) {
  return {
    version: 1,
    run_id: runId,
    updated_at: "2026-03-10T10:00:00.000Z",
    corpus: {
      paper_count: 0,
      papers_with_pdf: 0,
      missing_pdf_count: 0,
      papers_with_bibtex: 0,
      enriched_bibtex_count: 0,
      top_venues: []
    },
    citations: {
      total: 0,
      average: 0
    },
    enrichment: {
      pdf_recovered: 0,
      bibtex_enriched: 0
    },
    analysis: {
      summary_count: 0,
      evidence_count: 0,
      covered_paper_count: 0,
      full_text_summary_count: 0,
      abstract_summary_count: 0
    },
    artifacts: {
      literature_index_path: `.autolabos/runs/${runId}/literature_index.json`,
      corpus_path: `.autolabos/runs/${runId}/corpus.jsonl`,
      bibtex_path: `.autolabos/runs/${runId}/bibtex.bib`,
      collect_result_path: `.autolabos/runs/${runId}/collect_result.json`,
      summaries_path: `.autolabos/runs/${runId}/paper_summaries.jsonl`,
      evidence_path: `.autolabos/runs/${runId}/evidence_store.jsonl`
    },
    warnings: []
  };
}

function populatedLiterature(runId: string) {
  return {
    ...emptyLiterature(runId),
    corpus: {
      paper_count: 40,
      papers_with_pdf: 32,
      missing_pdf_count: 8,
      papers_with_bibtex: 35,
      enriched_bibtex_count: 12,
      top_venues: ["NeurIPS (8)", "ICLR (5)", "ACL (4)"],
      year_range: {
        min: 2021,
        max: 2026
      }
    },
    citations: {
      total: 800,
      average: 20,
      top_paper: {
        title: "Top cited paper",
        citation_count: 180
      }
    },
    enrichment: {
      bibtex_mode: "hybrid",
      pdf_recovered: 7,
      bibtex_enriched: 12,
      status: "completed"
    },
    analysis: {
      summary_count: 18,
      evidence_count: 126,
      covered_paper_count: 18,
      full_text_summary_count: 14,
      abstract_summary_count: 4
    },
    warnings: ["8 collected paper(s) are still missing PDF links."]
  };
}
