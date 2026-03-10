import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders onboarding when the workspace is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/bootstrap")) {
          return new Response(
            JSON.stringify({
              configured: false,
              setupDefaults: {
                projectName: "AutoResearchV2",
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
  });

  it("renders result analysis insight actions and runs the suggested command", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/bootstrap")) {
        return new Response(
          JSON.stringify({
            configured: true,
            setupDefaults: {
              projectName: "AutoResearchV2",
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
                  "Recommendation: advance -> write_paper (88%)",
                  "Next: Approve the transition into paper writing."
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
                  budget: {
                    toolCallsUsed: 4,
                    wallClockMsUsed: 120000,
                    usdUsed: 0,
                    policy: {
                      maxToolCalls: 20,
                      maxWallClockMinutes: 60,
                      maxUsd: 5
                    }
                  },
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                  },
                  pendingTransition: {
                    action: "advance",
                    targetNode: "write_paper",
                    reason: "The objective is met and the paper can be drafted.",
                    confidence: 0.88,
                    autoExecutable: true,
                    evidence: ["accuracy reached the configured target."],
                    suggestedCommands: ["/approve"],
                    generatedAt: "2026-03-10T10:00:00.000Z"
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
                budget: {
                  toolCallsUsed: 4,
                  wallClockMsUsed: 120000,
                  usdUsed: 0,
                  policy: {
                    maxToolCalls: 20,
                    maxWallClockMinutes: 60,
                    maxUsd: 5
                  }
                },
                nodeStates: {
                  collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                  write_paper: { status: "pending", updatedAt: "2026-03-10T10:00:00.000Z" }
                },
                pendingTransition: {
                  action: "advance",
                  targetNode: "write_paper",
                  reason: "The objective is met and the paper can be drafted.",
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
      expect(screen.getByText("Recommendation: advance -> write_paper (88%)")).toBeInTheDocument();
      expect(screen.getByText("Comparison")).toBeInTheDocument();
      expect(screen.getByText("Statistics")).toBeInTheDocument();
      expect(screen.getByText("Treatment improved accuracy over the baseline by 0.05.")).toBeInTheDocument();
      expect(screen.getAllByText("Metric accuracy").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Delta +0.05").length).toBeGreaterThan(0);
      expect(screen.getByText("Confidence 95%")).toBeInTheDocument();
      expect(screen.getByText("Full structured report with grounded analysis details.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /analysis report/i })).toBeInTheDocument();
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
                projectName: "AutoResearchV2",
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
                    budget: {
                      toolCallsUsed: 4,
                      wallClockMsUsed: 120000,
                      usdUsed: 0,
                      policy: {
                        maxToolCalls: 20,
                        maxWallClockMinutes: 60,
                        maxUsd: 5
                      }
                    },
                    nodeStates: {
                      collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                      analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
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
                  budget: {
                    toolCallsUsed: 4,
                    wallClockMsUsed: 120000,
                    usdUsed: 0,
                    policy: {
                      maxToolCalls: 20,
                      maxWallClockMinutes: 60,
                      maxUsd: 5
                    }
                  },
                  nodeStates: {
                    collect_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_papers: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    generate_hypotheses: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    design_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    implement_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    run_experiments: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
                    analyze_results: { status: "completed", updatedAt: "2026-03-10T10:00:00.000Z" },
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
});
