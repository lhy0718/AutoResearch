import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TUNABLE_NODE_NAMES = [
  "generate_hypotheses",
  "design_experiments",
  "analyze_results"
] as const;

export type TunableNodeName = (typeof TUNABLE_NODE_NAMES)[number];
type PromptNodeName = TunableNodeName | "review";

interface PromptSectionDefaults {
  path: string;
  sections: Record<string, string>;
}

const DEFAULT_PROMPT_SECTIONS: Record<PromptNodeName, PromptSectionDefaults> = {
  generate_hypotheses: {
    path: "node-prompts/generate_hypotheses.md",
    sections: {
      system: [
        "You are the AutoLabOS hypothesis agent.",
        "Generate multiple research hypotheses from structured evidence.",
        "Return one JSON object only.",
        "No markdown, no prose outside JSON.",
        "Keep hypotheses specific, testable, and grounded in the supplied evidence."
      ].join(" "),
      axes_system: [
        "You are the AutoLabOS evidence synthesizer.",
        "Map evidence into a small set of mechanism-oriented axes for better hypothesis generation.",
        "Return one JSON object only.",
        "No markdown, no prose outside JSON.",
        "Prefer axes that can be turned into interventions and evaluated for reproducibility."
      ].join(" "),
      review_system: [
        "You are the AutoLabOS skeptical reviewer.",
        "Critique hypothesis drafts for groundedness, causal clarity, falsifiability, experimentability, and objective-metric alignment.",
        "Apply hard gates: hypotheses with too few evidence links, ignored limitations/counterexamples, or no operational measurement plan should not survive review.",
        "When the objective is reproducibility, penalize performance-only hypotheses that do not specify a repeated-run or stability-based outcome.",
        "Penalize hypotheses that rely mostly on abstract-only or heavily caveated evidence when stronger full-text evidence is available.",
        "Revise weak wording instead of praising it.",
        "Return one JSON object only.",
        "No markdown, no prose outside JSON."
      ].join(" ")
    }
  },
  design_experiments: {
    path: "node-prompts/design_experiments.md",
    sections: {
      system: [
        "You are the AutoLabOS experiment designer.",
        "Convert shortlisted hypotheses into executable experiment plans.",
        "Return one JSON object only.",
        "No markdown, no prose outside JSON.",
        "Plans must be concrete, measurable, and implementable."
      ].join(" ")
    }
  },
  analyze_results: {
    path: "node-prompts/analyze_results.md",
    sections: {
      system: [
        "You are the AutoLabOS result analysis discussion agent.",
        "Write conservative, evidence-grounded synthesis from a structured experiment report.",
        "Return JSON only.",
        "Use only facts explicitly present in the payload.",
        "Do not invent metrics, thresholds, failure causes, or comparisons.",
        "If a failure cause is uncertain, label it as a risk or remaining uncertainty."
      ].join("\n")
    }
  },
  review: {
    path: "node-prompts/review.md",
    sections: {
      reviewer_system_template: [
        "You are the AutoLabOS {{reviewer_label}}.",
        "Return JSON only.",
        "Use only facts explicitly present in the payload.",
        "Be conservative: if evidence is incomplete, say so instead of guessing.",
        "Keep the review concise and actionable.",
        "Allowed recommendations: advance, revise_in_place, backtrack_to_hypotheses, backtrack_to_design, backtrack_to_implement, manual_block."
      ].join("\n")
    }
  }
};

const promptCache = new Map<PromptNodeName, Record<string, string>>();

function repoRootPromptPath(relativePath: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const distRelativeRoot = path.resolve(moduleDir, "../../");
  return path.join(distRelativeRoot, relativePath);
}

function candidatePromptPaths(nodeName: PromptNodeName): string[] {
  const relativePath = DEFAULT_PROMPT_SECTIONS[nodeName].path;
  return [
    path.join(process.cwd(), relativePath),
    repoRootPromptPath(relativePath)
  ];
}

function parsePromptSections(raw: string): Record<string, string> {
  const normalized = raw.replace(/\r\n/g, "\n");
  const matches = [...normalized.matchAll(/^##\s+([A-Za-z0-9_]+)\s*$/gm)];
  if (matches.length === 0) {
    return {};
  }

  const sections: Record<string, string> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const sectionName = match[1]?.trim().toLowerCase();
    const contentStart = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[index + 1];
    const contentEnd = nextMatch?.index ?? normalized.length;
    if (!sectionName) {
      continue;
    }
    const content = normalized.slice(contentStart, contentEnd).trim();
    if (content) {
      sections[sectionName] = content;
    }
  }

  return sections;
}

function loadPromptSections(nodeName: PromptNodeName): Record<string, string> {
  const cached = promptCache.get(nodeName);
  if (cached) {
    return cached;
  }

  const defaults = DEFAULT_PROMPT_SECTIONS[nodeName].sections;
  for (const candidate of candidatePromptPaths(nodeName)) {
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const raw = fs.readFileSync(candidate, "utf8");
      const sections = parsePromptSections(raw);
      const merged = {
        ...defaults,
        ...sections
      };
      promptCache.set(nodeName, merged);
      return merged;
    } catch {
      break;
    }
  }

  promptCache.set(nodeName, defaults);
  return defaults;
}

export function getNodePromptPath(nodeName: TunableNodeName): string {
  return path.join(process.cwd(), DEFAULT_PROMPT_SECTIONS[nodeName].path);
}

export function getReviewPromptPath(): string {
  return path.join(process.cwd(), DEFAULT_PROMPT_SECTIONS.review.path);
}

export function loadGenerateHypothesesPromptSections(): {
  system: string;
  axesSystem: string;
  reviewSystem: string;
} {
  const sections = loadPromptSections("generate_hypotheses");
  return {
    system: sections.system,
    axesSystem: sections.axes_system,
    reviewSystem: sections.review_system
  };
}

export function loadDesignExperimentsPromptSections(): {
  system: string;
} {
  const sections = loadPromptSections("design_experiments");
  return {
    system: sections.system
  };
}

export function loadAnalyzeResultsPromptSections(): {
  system: string;
} {
  const sections = loadPromptSections("analyze_results");
  return {
    system: sections.system
  };
}

export function loadReviewPromptSections(): {
  reviewerSystemTemplate: string;
} {
  const sections = loadPromptSections("review");
  return {
    reviewerSystemTemplate: sections.reviewer_system_template
  };
}

export function buildSelfCritiqueRetryPromptVariant(originalPrompt: string): string {
  return [
    originalPrompt.trim(),
    "",
    "Self-critique and retry block:",
    "- Before finalizing, critique whether the draft is specific, testable, and traceable to explicit evidence.",
    "- If the first draft is vague, missing a baseline/comparator, or underspecified for measurement, revise it once before returning.",
    "- Prefer a narrower, evidence-grounded answer over a broader but weakly supported one."
  ].join("\n");
}
