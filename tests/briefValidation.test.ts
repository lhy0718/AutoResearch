import { describe, expect, it } from "vitest";

import {
  buildBriefCompletenessArtifact,
  buildResearchBriefTemplate,
  validateResearchBriefDraftMarkdown,
  validateResearchBriefMarkdown
} from "../src/core/runs/researchBriefFiles.js";
import { parseMarkdownRunBriefSections } from "../src/core/runs/runBriefParser.js";

function fullBrief(): string {
  return [
    "# Research Brief",
    "",
    "## Topic",
    "Efficient test-time reasoning for small language models under constrained inference budgets.",
    "",
    "## Objective Metric",
    "- Primary metric: GSM8K accuracy.",
    "- Secondary metrics (if any): decoded tokens per answer, wall-clock latency.",
    "- What counts as meaningful improvement: at least +2 accuracy points over greedy decoding without more than 2x latency.",
    "",
    "## Constraints",
    "- compute/time budget: keep the full experiment runnable on a single workstation in under 6 hours.",
    "- dataset or environment limits: use public benchmarks with a reproducible split.",
    "- provider/tooling constraints: local Python runner only.",
    "- reproducibility constraints: persist scripts, configs, and result tables under test/output/.",
    "- forbidden shortcuts: no fabricated metrics or workflow-only evidence.",
    "",
    "## Plan",
    "1. collect related work on adaptive test-time reasoning 2. lock a greedy baseline 3. implement an adaptive reasoning condition 4. run both conditions on GSM8K 5. analyze accuracy, cost, and latency 6. draft only if evidence clears the gate.",
    "",
    "## Research Question",
    "Can adaptive test-time reasoning improve GSM8K accuracy for a 3B-scale language model under a fixed inference budget compared with greedy decoding?",
    "",
    "## Why This Can Be Tested With A Small Real Experiment",
    "- accessible dataset/task: GSM8K has a standard, public evaluation set.",
    "- feasible implementation scope: both conditions can share the same model and differ only at inference time.",
    "- feasible baseline: greedy decoding is already supported.",
    "- realistic run budget: evaluate a bounded sample before scaling to the full split.",
    "- expected signal size or decision rule: stop if accuracy gains vanish once token cost is normalized.",
    "",
    "## Baseline / Comparator",
    "- baseline name: greedy decoding.",
    "- why it is relevant: it is the simplest default inference policy for small language models.",
    "- expected comparison dimension: answer accuracy versus inference cost.",
    "",
    "## Dataset / Task / Bench",
    "- dataset(s): GSM8K.",
    "- task type: grade-school math word problem solving.",
    "- train/eval protocol: no training; compare inference-time conditions on a held-out evaluation set.",
    "- split or validation discipline: fixed evaluation subset first, then full evaluation if promising.",
    "- known limitations: one dataset is not enough for a paper-ready general claim.",
    "",
    "## Target Comparison",
    "- proposed method or condition: adaptive gated reasoning.",
    "- comparator or baseline: greedy decoding.",
    "- comparison dimension: accuracy, token count, and latency.",
    "- direction of expected improvement: higher accuracy at similar or moderately higher cost.",
    "",
    "## Minimum Acceptable Evidence",
    "- minimum effect size or decision boundary: at least +2 accuracy points or a clear cost-accuracy tradeoff win.",
    "- minimum number of runs or folds: run the baseline and proposal on the same evaluation slice, then repeat on the full slice if promising.",
    "- what counts as no signal vs weak signal: no signal if accuracy is flat; weak signal if gains vanish after accounting for token cost.",
    "",
    "## Disallowed Shortcuts",
    "- Do not use workflow smoke artifacts as experimental evidence.",
    "- Do not cherry-pick a single favorable subset and omit failures.",
    "- Do not fabricate or interpolate missing metric values.",
    "- Do not claim statistical significance without running the test.",
    "",
    "## Allowed Budgeted Passes",
    "- permitted extra pass(es) within budget: one verifier pass for ambiguous answers.",
    "- total budget guardrail: keep the full comparison within the stated workstation budget.",
    "",
    "## Paper Ceiling If Evidence Remains Weak",
    "Cap the output at research_memo if the comparator set or quantitative evidence remains too weak.",
    "",
    "## Minimum Experiment Plan",
    "- one baseline run: greedy decoding on GSM8K.",
    "- one proposed or alternative condition: adaptive gated reasoning on the same prompts.",
    "- one result table: accuracy, latency, and token count by condition.",
    "- one limitation note: single-model and single-dataset scope.",
    "- one claim->evidence mapping: link each conclusion to the result table or cited literature.",
    "",
    "## Paper-worthiness Gate",
    "- Is the research question explicit? yes.",
    "- Is the related work sufficient to position the study? yes, if paper collection yields comparator families.",
    "- Is there at least one explicit baseline? yes.",
    "- Is there at least one real executed experiment? yes.",
    "- Is there at least one quantitative comparison? yes.",
    "- Can major claims be traced to evidence? yes.",
    "- Are limitations stated? yes.",
    "",
    "## Failure Conditions",
    "- No usable public benchmark can be run within budget.",
    "- No meaningful baseline can be implemented fairly.",
    "- The experiment only proves the pipeline runs.",
    "- Results are too weak to support the intended claim.",
    "",
    "## Manuscript Format",
    "- Columns: 2",
    "- Main body pages: 8",
    "- References excluded from page limit: yes",
    "- Appendices excluded from page limit: yes",
    "",
    "## Notes",
    "Keep the broad topic fixed while allowing the hypothesis to evolve.",
    "",
    "## Questions / Risks",
    "- Will a simpler self-consistency baseline dominate the proposed policy?"
  ].join("\n");
}

function minimalBrief(): string {
  return [
    "# Research Brief",
    "",
    "## Topic",
    "Some research topic here.",
    "",
    "## Objective Metric",
    "macro-F1"
  ].join("\n");
}

function partialBrief(): string {
  return [
    "# Research Brief",
    "",
    "## Topic",
    "Adaptive inference policies for small language models.",
    "",
    "## Objective Metric",
    "- Primary metric: exact-match accuracy.",
    "- What counts as meaningful improvement: +1 point over baseline.",
    "",
    "## Constraints",
    "- compute/time budget: keep evaluation within one workstation session.",
    "",
    "## Plan",
    "Compare a greedy baseline against one adaptive policy on a small public benchmark.",
    "",
    "## Research Question",
    "Can adaptive reasoning outperform greedy decoding under a fixed budget?",
    "",
    "## Baseline / Comparator",
    "- baseline name: greedy decoding.",
    "",
    "## Dataset / Task / Bench",
    "- dataset(s): GSM8K.",
    "",
    "## Target Comparison",
    "- proposed method or condition: adaptive reasoning.",
    "- comparator or baseline: greedy decoding.",
    "",
    "## Minimum Acceptable Evidence",
    "- minimum effect size or decision boundary: +1 point.",
    "",
    "## Failure Conditions",
    "- The experiment only proves the pipeline runs."
  ].join("\n");
}

function malformedBrief(): string {
  return "This is just plain text with no headings at all.";
}

describe("validateResearchBriefDraftMarkdown", () => {
  it("allows a topic-only working draft", () => {
    const result = validateResearchBriefDraftMarkdown([
      "# Research Brief",
      "",
      "## Topic",
      "Budget-aware test-time reasoning for small language models."
    ].join("\n"));
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("requires a substantive topic before a draft is considered usable", () => {
    const result = validateResearchBriefDraftMarkdown(buildResearchBriefTemplate());
    expect(result.errors).toEqual([
      'Replace the placeholder text in "## Topic" before using the brief as a working draft.'
    ]);
  });
});

describe("validateResearchBriefMarkdown", () => {
  it("validates a full paper-scale brief with no errors", () => {
    const result = validateResearchBriefMarkdown(fullBrief());
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("blocks a minimal brief that omits required paper-scale sections", () => {
    const result = validateResearchBriefMarkdown(minimalBrief());
    expect(result.errors).not.toHaveLength(0);
    expect(result.errors.some((error) => error.includes("Constraints"))).toBe(true);
    expect(result.errors.some((error) => error.includes("Research Question"))).toBe(true);
    expect(result.errors.some((error) => error.includes("Baseline / Comparator"))).toBe(true);
    expect(result.errors.some((error) => error.includes("Failure Conditions"))).toBe(true);
  });

  it("blocks the generated template until placeholder sections are replaced", () => {
    const result = validateResearchBriefMarkdown(buildResearchBriefTemplate());
    expect(result.errors.some((error) => error.includes("Replace the placeholder text"))).toBe(true);
    expect(result.errors.some((error) => error.includes("Topic"))).toBe(true);
    expect(result.errors.some((error) => error.includes("Objective Metric"))).toBe(true);
    expect(result.errors.some((error) => error.includes("Minimum Experiment Plan"))).toBe(true);
  });

  it("produces errors for malformed brief", () => {
    const result = validateResearchBriefMarkdown(malformedBrief());
    expect(result.errors.length).toBeGreaterThanOrEqual(10);
  });

  it("accepts heading variations for the new paper-scale sections", () => {
    const brief = [
      "# Research Brief",
      "",
      "## Topic",
      "A substantive topic for a small real experiment.",
      "",
      "## Objective",
      "A metric with a real threshold.",
      "",
      "## Constraints",
      "A reproducible workstation budget.",
      "",
      "## Plan",
      "Compare one proposal against one baseline.",
      "",
      "## Research Question",
      "Can the proposal outperform the baseline?",
      "",
      "## Why This Can Be Tested With A Small Experiment",
      "The task is public and the comparison is small.",
      "",
      "## Baseline Comparator",
      "Greedy decoding versus one adaptive policy.",
      "",
      "## Dataset / Task / Benchmark",
      "GSM8K exact-match evaluation.",
      "",
      "## Comparison",
      "Proposal versus baseline on accuracy.",
      "",
      "## Minimum Evidence",
      "One shared evaluation slice plus a quantitative threshold.",
      "",
      "## Forbidden Shortcuts",
      "No cherry-picking.",
      "",
      "## Budgeted Passes",
      "One verifier pass.",
      "",
      "## Paper Ceiling",
      "Cap at research_memo if evidence is weak.",
      "",
      "## Minimum Experiment Plan",
      "Run baseline and proposal, then emit a result table.",
      "",
      "## Paper Readiness Gate",
      "Yes, once evidence exists and limitations are stated.",
      "",
      "## Failure Conditions",
      "Fail if the run only validates the workflow."
    ].join("\n");

    const result = validateResearchBriefMarkdown(brief);
    expect(result.errors).toHaveLength(0);
  });
});

describe("parseMarkdownRunBriefSections", () => {
  it("parses the full paper-scale section set", () => {
    const sections = parseMarkdownRunBriefSections(fullBrief());
    expect(sections).toBeDefined();
    expect(sections!.researchQuestion).toContain("adaptive test-time reasoning");
    expect(sections!.whySmallExperiment).toContain("GSM8K");
    expect(sections!.baselineComparator).toContain("greedy decoding");
    expect(sections!.datasetTaskBench).toContain("GSM8K");
    expect(sections!.targetComparison).toContain("adaptive gated reasoning");
    expect(sections!.minimumExperimentPlan).toContain("one baseline run");
    expect(sections!.paperWorthinessGate).toContain("quantitative comparison");
    expect(sections!.failureConditions).toContain("pipeline runs");
  });

  it("returns undefined for missing extended sections in a minimal brief", () => {
    const sections = parseMarkdownRunBriefSections(minimalBrief());
    expect(sections).toBeDefined();
    expect(sections!.researchQuestion).toBeUndefined();
    expect(sections!.baselineComparator).toBeUndefined();
    expect(sections!.datasetTaskBench).toBeUndefined();
    expect(sections!.minimumExperimentPlan).toBeUndefined();
    expect(sections!.paperWorthinessGate).toBeUndefined();
    expect(sections!.failureConditions).toBeUndefined();
  });
});

describe("buildBriefCompletenessArtifact", () => {
  it("grades a full brief as complete", () => {
    const artifact = buildBriefCompletenessArtifact(fullBrief());
    expect(artifact.grade).toBe("complete");
    expect(artifact.paper_scale_ready).toBe(true);
    expect(artifact.missing_sections).toHaveLength(0);
    expect(artifact.sections.researchQuestion.substantive).toBe(true);
    expect(artifact.sections.minimumExperimentPlan.substantive).toBe(true);
  });

  it("grades a minimal brief as minimal and lists incomplete required sections", () => {
    const artifact = buildBriefCompletenessArtifact(minimalBrief());
    expect(artifact.grade).toBe("minimal");
    expect(artifact.paper_scale_ready).toBe(false);
    expect(artifact.missing_sections).toEqual(
      expect.arrayContaining([
        "Constraints",
        "Research Question",
        "Baseline / Comparator",
        "Minimum Experiment Plan",
        "Failure Conditions"
      ])
    );
  });

  it("grades a partial brief correctly", () => {
    const artifact = buildBriefCompletenessArtifact(partialBrief());
    expect(artifact.grade).toBe("partial");
    expect(artifact.paper_scale_ready).toBe(false);
    expect(artifact.sections.targetComparison.substantive).toBe(true);
    expect(artifact.sections.minimumAcceptableEvidence.substantive).toBe(true);
    expect(artifact.sections.paperWorthinessGate.present).toBe(false);
  });

  it("treats the generated template as non-substantive", () => {
    const artifact = buildBriefCompletenessArtifact(buildResearchBriefTemplate());
    expect(artifact.sections.topic.present).toBe(true);
    expect(artifact.sections.topic.substantive).toBe(false);
    expect(artifact.sections.objectiveMetric.present).toBe(true);
    expect(artifact.sections.objectiveMetric.substantive).toBe(false);
    expect(artifact.grade).toBe("minimal");
    expect(artifact.paper_scale_ready).toBe(false);
  });

  it("handles malformed input gracefully", () => {
    const artifact = buildBriefCompletenessArtifact(malformedBrief());
    expect(artifact.grade).toBe("minimal");
    expect(artifact.paper_scale_ready).toBe(false);
    expect(artifact.missing_sections.length).toBeGreaterThanOrEqual(10);
  });
});
