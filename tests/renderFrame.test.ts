import { afterEach, describe, expect, it } from "vitest";

import { buildFrame } from "../src/tui/renderFrame.js";
import { createDefaultGraphState } from "../src/core/stateGraph/defaults.js";
import { RunRecord, SuggestionItem } from "../src/types.js";
import { applyCodexSurfaceTheme, stripAnsi } from "../src/tui/theme.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = new Date().toISOString();
  const graph = overrides.graph ?? createDefaultGraphState();
  const currentNode = overrides.currentNode ?? graph.currentNode;
  return {
    version: 3,
    workflowVersion: 3,
    id: overrides.id ?? "run-1",
    title: overrides.title ?? "Test run",
    topic: overrides.topic ?? "topic",
    constraints: overrides.constraints ?? [],
    objectiveMetric: overrides.objectiveMetric ?? "metric",
    status: overrides.status ?? "pending",
    currentNode,
    latestSummary: overrides.latestSummary,
    nodeThreads: overrides.nodeThreads ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    graph,
    memoryRefs: overrides.memoryRefs ?? {
      runContextPath: ".autolabos/runs/run-1/memory/run_context.json",
      longTermPath: ".autolabos/runs/run-1/memory/long_term.jsonl",
      episodePath: ".autolabos/runs/run-1/memory/episodes.jsonl"
    }
  };
}

const suggestions: SuggestionItem[] = [
  {
    key: "doctor",
    label: "/doctor",
    description: "Run environment checks",
    applyValue: "/doctor "
  },
  {
    key: "help",
    label: "/help",
    description: "Show command list",
    applyValue: "/help "
  }
];

describe("buildFrame", () => {
  afterEach(() => {
    applyCodexSurfaceTheme(undefined);
  });

  it("applies distinct colors for help sections, warnings, successes, and errors", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["Help", "Usage: /run <run>", "Updated title: A -> B", "Error: bad input"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const helpLine = frame.lines.find((line) => stripAnsi(line) === "• Help") ?? "";
    const usageLine = frame.lines.find((line) => stripAnsi(line) === "! Usage: /run <run>") ?? "";
    const successLine = frame.lines.find((line) => stripAnsi(line) === "+ Updated title: A -> B") ?? "";
    const errorLine = frame.lines.find((line) => stripAnsi(line) === "x Error: bad input") ?? "";

    expect(helpLine).toMatch(/\x1b\[[0-9;]*38;5;110m/);
    expect(usageLine).toMatch(/\x1b\[[0-9;]*38;5;179m/);
    expect(successLine).toMatch(/\x1b\[[0-9;]*38;5;150m/);
    expect(errorLine).toMatch(/\x1b\[[0-9;]*38;5;210m/);
  });

  it("highlights direct answers and numbered titles in white", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["The current run has 20 collected papers.", "1. First paper title"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const answerLine = frame.lines.find((line) => stripAnsi(line) === "• The current run has 20 collected papers.") ?? "";
    const titleLine = frame.lines.find((line) => stripAnsi(line) === "• 1. First paper title") ?? "";

    expect(answerLine).toMatch(/\x1b\[[0-9;]*38;5;255m/);
    expect(titleLine).toMatch(/\x1b\[[0-9;]*38;5;255m/);
  });

  it("renders a Codex-style startup banner above the composer", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("AutoLabOS"))).toBe(true);
    expect(plain.some((line) => line.includes("model:"))).toBe(true);
    expect(plain.some((line) => line.includes("To get started"))).toBe(false);
    expect(plain[frame.inputLineIndex - 1]).toContain("› ");
  });

  it("renders active run insight lines above recent logs", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      runInsight: {
        title: "Result analysis",
        lines: [
          "Objective: met - accuracy reached the configured target.",
          "Top issue: Only one confirmatory configuration was executed.",
          "Recommendation: advance -> review (88%)",
          "Next: Run an additional confirmatory configuration.",
          "Confidence: Overall confidence is moderate."
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
              { label: "Delta", value: "+0.050" },
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
              { label: "Delta", value: "+0.050" },
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
            details: ["Metrics charted: accuracy, f1."]
          },
          {
            kind: "report",
            label: "Analysis report",
            path: "result_analysis.json",
            summary: "Full structured report with the statistical summary and synthesis.",
            facts: [
              { label: "Mean", value: "0.810" },
              { label: "Matched metric", value: "accuracy" },
              { label: "Objective", value: "met" }
            ],
            details: ["The treatment cleared the objective threshold with limited run-to-run variance."]
          }
        ]
      },
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    const insightTitleIndex = plain.indexOf("Result analysis");
    const logsIndex = plain.indexOf("• ready");
    expect(insightTitleIndex).toBeGreaterThanOrEqual(0);
    expect(logsIndex).toBeGreaterThan(insightTitleIndex);
    expect(plain).toContain("• Objective: met - accuracy reached the configured target.");
    expect(plain).toContain("• Recommendation: advance -> review (88%)");
    expect(plain).toContain("• Next: Run an additional confirmatory configuration.");
    expect(plain).toContain("> Run recommendation: /approve");
    expect(plain).toContain("> [COMPARISON] Comparison: Treatment vs baseline: result_analysis.json");
    expect(plain).toContain("  Treatment improved accuracy over the baseline by 0.05.");
    expect(plain).toContain("  Metric accuracy | Delta +0.050 | Support yes");
    expect(plain).toContain("  Hypothesis support: supported by this comparison.");
    expect(plain).toContain("> [STATISTICS] Statistics: accuracy: result_analysis.json");
    expect(plain).toContain("  Metric accuracy | Delta +0.050 | Confidence 95%");
    expect(plain).toContain("  Effect direction: positive for accuracy.");
    expect(plain).toContain("> [FIGURE] Figure: Performance overview: figures/performance.svg");
    expect(plain).toContain("  Primary visualization for the recommendation.");
    expect(plain).toContain("  Matched metric accuracy | Runs 3");
    expect(plain).toContain("> [REPORT] Analysis report: result_analysis.json");
  });

  it("renders compact manuscript-quality digest lines above recent logs", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({
        status: "failed",
        currentNode: "write_paper",
        latestSummary: "write_paper stopped at the manuscript quality gate."
      }),
      runInsight: {
        title: "Manuscript quality",
        lines: [
          "Status: Stopped.",
          "Reason: Policy hard stop.",
          "Review reliability: grounded.",
          "Triggered by: appendix_hygiene."
        ],
        manuscriptQuality: {
          status: "stopped",
          stage: "post_repair_1",
          reasonCategory: "policy_hard_stop",
          displayReasonLabel: "Policy hard stop",
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
            backstopOnly: 2,
            readinessRisks: 1,
            scientificBlockers: 1,
            submissionBlockers: 0,
            reviewerMissedPolicy: 1,
            reviewerCoveredBackstop: 2
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
            submission: []
          },
          artifactRefs: [
            { label: "Manuscript quality gate", path: "paper/manuscript_quality_gate.json" }
          ]
        }
      },
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    const insightTitleIndex = plain.indexOf("Manuscript quality");
    const logsIndex = plain.indexOf("• ready");
    expect(insightTitleIndex).toBeGreaterThanOrEqual(0);
    expect(logsIndex).toBeGreaterThan(insightTitleIndex);
    expect(plain).toContain("• Issue summary: manuscript 1 | hard-stop 1 | backstop 2 | readiness 1.");
    expect(plain).toContain("• Blockers: scientific 1.");
    expect(plain).toContain("• Readiness risks: blocked 0 | warning 1.");
    expect(plain).toContain("• Repairs 1/2 | remaining 0 | improvement no.");
    expect(plain).toContain("• Coverage: reviewer-missed policy 1 | reviewer-covered backstop 2.");
    expect(plain).toContain("• Manuscript quality gate: /artifact paper/manuscript_quality_gate.json");
    expect(plain).toContain("• Status: Stopped.");
  });

  it("renders review-stage readiness-risk digest lines above recent logs", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({
        status: "paused",
        currentNode: "review",
        latestSummary: "Review packet prepared."
      }),
      runInsight: {
        title: "Review packet",
        lines: [
          "Review readiness: blocking (3 ready, 1 warning, 1 blocking, 1 manual)",
          "Objective: met - Objective metric met."
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
          artifactRefs: [
            { label: "Review readiness risks", path: "review/readiness_risks.json" }
          ]
        },
        actions: [
          { label: "Jump to design", command: "/agent jump design_experiments --force" }
        ]
      },
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("• Readiness state: blocked_for_paper_scale.");
    expect(plain).toContain("• Readiness risks: blocked 1 | warning 0.");
    expect(plain.some((line) => line.includes("• Primary risk: Paper scale · Minimum gate: 3 check(s) failed"))).toBe(true);
    expect(plain).toContain("• Review readiness risks: /artifact review/readiness_risks.json");
  });

  it("does not render Busy label", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(frame.lines.map((line) => stripAnsi(line))).not.toContain("Busy");
  });

  it("renders collecting status above the input instead of a header activity line", () => {
    const graph = createDefaultGraphState();
    graph.currentNode = "collect_papers";
    graph.nodeStates.collect_papers.status = "running";

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting...",
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({ graph, currentNode: "collect_papers" }),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).not.toContain("Activity: Collecting...");
    expect(plain).toContain("• Collecting...");
    const promptIndex = frame.inputLineIndex - 1;
    expect(plain[promptIndex]).toContain("› ");
    expect(plain.slice(0, promptIndex).some((line) => line === "• Collecting...")).toBe(true);
  });

  it("renders collecting progress with ETA above the input", () => {
    const graph = createDefaultGraphState();
    graph.currentNode = "collect_papers";
    graph.nodeStates.collect_papers.status = "running";

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting... 199/300 (ETA ~2m 40s)",
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({ graph, currentNode: "collect_papers" }),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("• Collecting... 199/300 (ETA ~2m 40s)");
  });

  it("keeps the composer actionable once the new run already exists during /brief startup", () => {
    const graph = createDefaultGraphState();
    graph.currentNode = "collect_papers";
    graph.nodeStates.collect_papers.status = "pending";

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Starting research...",
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({ graph, currentNode: "collect_papers" }),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    const promptIndex = frame.inputLineIndex - 1;
    expect(plain).toContain("• Starting research...");
    expect(plain[promptIndex]).toContain("Add steering to redirect the current run.");
  });

  it("shows a retry hint when the run is paused without an approval boundary", () => {
    const graph = createDefaultGraphState();
    graph.currentNode = "analyze_papers";
    graph.nodeStates.analyze_papers.status = "pending";
    graph.nodeStates.analyze_papers.note = "Canceled by user";

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun({ status: "paused", graph, currentNode: "analyze_papers" }),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    const promptIndex = frame.inputLineIndex - 1;
    expect(plain[promptIndex]).toContain("Type a command or message");
  });

  it("renders suggestions in a surface below the composer input line", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const inputLine = frame.lines[frame.inputLineIndex - 1];
    expect(stripAnsi(inputLine)).toContain("› /");

    const linesBelowInput = frame.lines.slice(frame.inputLineIndex).map((line) => stripAnsi(line));
    expect(linesBelowInput.some((row) => row.includes("/doctor"))).toBe(true);
  });

  it("does not render contextual guidance as a floating panel when provided", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      guidance: {
        title: "Next actions",
        items: [
          { label: "/new", description: "Create a research brief file" },
          { label: "what should I do next?", description: "Ask for the recommended next step" }
        ]
      }
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("Next actions"))).toBe(false);
    expect(plain.some((line) => line.includes("Create a research brief file"))).toBe(false);
  });

  it("prefixes regular log lines with INFO/WARN/OK/ERR tags", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["Natural query: test", "Canceled pending command: /approve", "Run completed.", "Error: broken"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("• Natural query: test");
    expect(plain).toContain("! Canceled pending command: /approve");
    expect(plain).toContain("+ Run completed.");
    expect(plain).toContain("x Error: broken");
  });

  it("keeps automatic replan logs out of error styling", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [
        "Attempting automatic replan after failed step...",
        "The previous collect step failed. I can retry with a corrected collect command.",
        "Replan matched the failed plan. Not re-arming the same commands.",
        "No revised execution plan was suggested."
      ],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain).toContain("• Attempting automatic replan after failed step...");
    expect(plain).toContain("• The previous collect step failed. I can retry with a corrected collect command.");
    expect(plain).toContain("! Replan matched the failed plan. Not re-arming the same commands.");
    expect(plain).toContain("! No revised execution plan was suggested.");
  });

  it("computes cursor column at the end of '> input'", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "abc",
      inputCursor: 3,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(frame.inputColumn).toBe(6);
  });

  it("computes cursor column with wide characters", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "한글",
      inputCursor: 2,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    expect(frame.inputColumn).toBe(7);
  });

  it("clips transcript to the available viewport while keeping the composer fixed", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      terminalWidth: 80,
      terminalHeight: 12,
      run: makeRun(),
      logs: Array.from({ length: 20 }, (_, idx) => `log ${idx + 1}`),
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      footerItems: ["gpt-5.3-codex", "run-1"]
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("AutoLabOS"))).toBe(false);
    expect(plain.some((line) => line.includes("log 20"))).toBe(true);
    expect(plain[frame.inputLineIndex - 1]).toContain("› ");
    expect(frame.transcriptHiddenLineCountAbove).toBeGreaterThan(0);
  });

  it("shows older transcript lines when a scroll offset is applied", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      terminalWidth: 80,
      terminalHeight: 12,
      run: makeRun(),
      logs: Array.from({ length: 20 }, (_, idx) => `log ${idx + 1}`),
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      transcriptScrollOffset: 4,
      footerItems: ["gpt-5.3-codex", "run-1"]
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("log 20"))).toBe(false);
    expect(plain.some((line) => line.includes("log 16"))).toBe(true);
    expect(frame.transcriptHiddenLineCountBelow).toBe(4);
  });

  it("does not force a composer surface color when the terminal background is unknown", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [],
      input: "steer this run",
      inputCursor: 4,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const inputLine = frame.lines[frame.inputLineIndex - 1] ?? "";
    expect(stripAnsi(inputLine)).toContain("› steer this run");
    expect(inputLine).not.toContain("48;");
    expect(stripAnsi(inputLine)).not.toContain("│");
  });

  it("renders the composer on a Codex-style surface once the terminal background is known", () => {
    applyCodexSurfaceTheme([30, 30, 30]);

    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [],
      input: "steer this run",
      inputCursor: 4,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const inputLine = frame.lines[frame.inputLineIndex - 1] ?? "";
    expect(inputLine).toMatch(/\x1b\[[0-9;]*48;/);
  });

  it("keeps a single-line draft vertically centered inside the three-row composer", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: [],
      input: "brief",
      inputCursor: 5,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect((plain[frame.inputLineIndex - 2] ?? "").trim()).toBe("");
    expect(plain[frame.inputLineIndex - 1]).toContain("› brief");
    expect((plain[frame.inputLineIndex] ?? "").trim()).toBe("");
  });

  it("highlights selected suggestion with the Codex accent color on the same surface", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      run: undefined,
      logs: [],
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const selectedRow = frame.lines.find((line) => stripAnsi(line).includes("/doctor  Run environment checks")) || "";
    expect(selectedRow).toContain("\x1b[");
    expect(selectedRow).toContain("38;5;110");
    expect(selectedRow).not.toContain("48;5;");
  });

  it("renders selection menu rows when active", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      selectionMenu: {
        title: "Select model",
        options: [
          {
            value: "gpt-5.3-codex",
            label: "gpt-5.3-codex",
            description: "Primary Codex model."
          },
          {
            value: "gpt-5.2-codex",
            label: "gpt-5.2-codex"
          }
        ],
        selectedIndex: 1
      }
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("Select model"))).toBe(true);
    expect(plain.some((line) => line.includes("gpt-5.3-codex  Primary Codex model."))).toBe(true);
    expect(plain.some((line) => line.includes("gpt-5.2-codex"))).toBe(true);
  });

  it("highlights selected selection menu row with the Codex accent color", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      run: makeRun(),
      logs: ["ready"],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true,
      selectionMenu: {
        title: "Select reasoning effort",
        options: [
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" }
        ],
        selectedIndex: 2
      }
    });

    const selected = frame.lines.find((line) => stripAnsi(line).includes("high")) || "";
    expect(selected).toContain("\x1b[");
    expect(selected).toContain("38;5;110");
    expect(selected).not.toContain("48;");
  });

  it("renders moving monochrome gradient on Thinking text", () => {
    const a = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: true,
      thinkingFrame: 1,
      run: undefined,
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });
    const b = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      thinking: true,
      thinkingFrame: 8,
      run: undefined,
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const thinkingA = a.lines.find((line) => stripAnsi(line).includes("Thinking...")) || "";
    const thinkingB = b.lines.find((line) => stripAnsi(line).includes("Thinking...")) || "";
    expect(thinkingA).toContain("\x1b[");
    expect(thinkingA).not.toBe(thinkingB);
    expect(a.thinkingLineIndex).toBeDefined();
  });

  it("animates collecting status text above the input line", () => {
    const a = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting...",
      thinking: false,
      thinkingFrame: 1,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });
    const b = buildFrame({
      appVersion: "1.0.0",
      busy: true,
      activityLabel: "Collecting...",
      thinking: false,
      thinkingFrame: 8,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: true
    });

    const statusA = a.lines.find((line) => stripAnsi(line).includes("Collecting...")) || "";
    const statusB = b.lines.find((line) => stripAnsi(line).includes("Collecting...")) || "";
    expect(statusA).toContain("\x1b[");
    expect(statusA).not.toBe(statusB);
    expect(a.thinkingLineIndex).toBeDefined();
  });

  it("wraps long title and log lines to the terminal width instead of letting them overflow", () => {
    const frame = buildFrame({
      appVersion: "1.0.0",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      terminalWidth: 40,
      run: makeRun({
        title: "Multi-agent collaboration in recent papers: five-year state-of-the-art reproducibility benchmark"
      }),
      logs: [
        "Graph nodes: collect_papers, analyze_papers, generate_hypotheses, design_experiments, implement_experiments, run_experiments, analyze_results, review, write_paper"
      ],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false
    });

    const plain = frame.lines.map((line) => stripAnsi(line));
    expect(plain.some((line) => line.includes("Graph nodes:"))).toBe(true);
    expect(
      plain.filter((line) => line.includes("Graph nodes:") || line.includes("generate_hypotheses") || line.includes("review") || line.includes("write_paper")).length
    ).toBeGreaterThan(1);
    expect(plain[frame.inputLineIndex - 1]).toContain("› ");
  });

  it("renders footer metadata with state, model, and version", () => {
    const frame = buildFrame({
      appVersion: "1.2.3",
      busy: true,
      thinking: false,
      thinkingFrame: 0,
      terminalWidth: 120,
      run: makeRun(),
      logs: [],
      input: "",
      inputCursor: 0,
      suggestions: [],
      selectedSuggestion: 0,
      colorEnabled: false,
      modelLabel: "chat gpt-5.4 + low | backend gpt-5.4 + high",
      footerItems: ["running", "collect_papers pending"]
    });

    const footer = stripAnsi(frame.lines.at(-1) ?? "");
    expect(footer.startsWith("running")).toBe(true);
    expect(footer).toContain("running");
    expect(footer).toContain("collect_papers pending");
    expect(footer).toContain("chat gpt-5.4 + low | backend gpt-5.4 + high");
    expect(footer).toContain("v1.2.3");
  });

  it("keeps footer metadata visible under the slash menu", () => {
    const frame = buildFrame({
      appVersion: "1.2.3",
      busy: false,
      thinking: false,
      thinkingFrame: 0,
      terminalWidth: 90,
      run: makeRun(),
      logs: [],
      input: "/",
      inputCursor: 1,
      suggestions,
      selectedSuggestion: 0,
      colorEnabled: false,
      modelLabel: "chat gpt-5.4 + low | backend gpt-5.4 + high",
      footerItems: ["idle"]
    });

    const footer = stripAnsi(frame.lines.at(-1) ?? "");
    expect(footer.startsWith("↑↓ navigate")).toBe(true);
    expect(footer).toContain("↑↓ navigate");
    expect(footer).toContain("Tab complete");
    expect(footer).not.toContain("Enter run");
    expect(footer).toContain("chat gpt-5.4 + low | backend gpt-5.4 + high");
    expect(footer).toContain("v1.2.3");
  });
});
