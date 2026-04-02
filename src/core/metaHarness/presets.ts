import type { HarnessCandidate } from "./types.js";

export const BASE_HARNESS: HarnessCandidate = {
  id: "base",
  description: "현재 production 노드 동작과 동일한 기준선",
  targetNodes: ["analyze_papers", "design_experiments", "review"],
  artifactPolicy: {
    include: [],
    exclude: [],
    maxTokenBudget: null
  },
  skillPolicy: {
    enabled: []
  },
  promptPolicy: {
    templateFile: null,
    appendix: null
  },
  compressionPolicy: {
    strategy: "none",
    maxLinesPerArtifact: null
  },
  failureAware: false,
  reviewHeavy: false
};

export const COMPACT_HARNESS: HarnessCandidate = {
  id: "compact",
  description: "artifact를 요약/압축해 token 사용량을 줄인 후보",
  targetNodes: ["analyze_papers", "design_experiments", "review"],
  artifactPolicy: {
    include: ["evidence_store.jsonl", "paper_summaries.jsonl"],
    exclude: ["corpus.jsonl"],
    maxTokenBudget: 8000
  },
  skillPolicy: {
    enabled: []
  },
  promptPolicy: {
    templateFile: null,
    appendix: null
  },
  compressionPolicy: {
    strategy: "truncate",
    maxLinesPerArtifact: 50
  },
  failureAware: false,
  reviewHeavy: false
};

export const FAILURE_AWARE_HARNESS: HarnessCandidate = {
  id: "failure-aware",
  description: "과거 실패 패턴을 context에 포함해 반복 실패를 줄이는 후보",
  targetNodes: ["analyze_papers", "design_experiments", "review"],
  artifactPolicy: {
    include: [],
    exclude: [],
    maxTokenBudget: null
  },
  skillPolicy: {
    enabled: ["tui-validation-loop-automation"]
  },
  promptPolicy: {
    templateFile: null,
    appendix: "## 과거 실패 패턴\n아래 failure memory를 참고해 동일한 실수를 반복하지 마라."
  },
  compressionPolicy: {
    strategy: "none",
    maxLinesPerArtifact: null
  },
  failureAware: true,
  reviewHeavy: false
};

export const REVIEW_HEAVY_HARNESS: HarnessCandidate = {
  id: "review-heavy",
  description: "review packet과 quality bar를 context 앞부분에 배치해 품질 판단을 강화하는 후보",
  targetNodes: ["analyze_papers", "design_experiments", "review"],
  artifactPolicy: {
    include: [],
    exclude: [],
    maxTokenBudget: null
  },
  skillPolicy: {
    enabled: ["paper-scale-research-loop"]
  },
  promptPolicy: {
    templateFile: null,
    appendix: "## 품질 기준\ndocs/paper-quality-bar.md의 기준을 먼저 확인하고 판단하라."
  },
  compressionPolicy: {
    strategy: "none",
    maxLinesPerArtifact: null
  },
  failureAware: false,
  reviewHeavy: true
};

export const BUILTIN_HARNESS_PRESETS: HarnessCandidate[] = [
  BASE_HARNESS,
  COMPACT_HARNESS,
  FAILURE_AWARE_HARNESS,
  REVIEW_HEAVY_HARNESS
];
