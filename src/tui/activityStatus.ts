export interface CollectProgressSample {
  stored: number;
  atMs: number;
}

export interface CollectProgressState {
  targetTotal?: number;
  currentStored: number;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  samples: CollectProgressSample[];
  requestingBatchIndex?: number;
  requestingBatchTotal?: number;
  currentBatchProcessed?: number;
  currentBatchSize?: number;
  enrichmentProcessed?: number;
  enrichmentTotal?: number;
}

export interface AnalyzeProgressSample {
  completed: number;
  atMs: number;
}

export interface AnalyzeProgressState {
  total: number;
  current: number;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  samples: AnalyzeProgressSample[];
  phase: "ranking" | "rerank" | "analyzing";
  candidatePoolSize?: number;
  rerankStage?: number;
  rerankStageTotal?: number;
  rerankPercent?: number;
  rerankLabel?: string;
}

const MAX_SAMPLES = 8;

export function updateCollectProgressFromLog(
  current: CollectProgressState | undefined,
  line: string,
  nowMs = Date.now()
): CollectProgressState | undefined {
  const targetMatch = line.match(/Moving to collect_papers with target total (\d+)\./u);
  if (targetMatch?.[1]) {
    const targetTotal = Number(targetMatch[1]);
    if (Number.isFinite(targetTotal) && targetTotal > 0) {
      return {
        targetTotal,
        currentStored: 0,
        startedAtMs: nowMs,
        lastUpdatedAtMs: nowMs,
        samples: [],
        requestingBatchIndex: 1,
        requestingBatchTotal: undefined,
        currentBatchProcessed: 0,
        currentBatchSize: undefined,
        enrichmentProcessed: undefined,
        enrichmentTotal: undefined
      };
    }
  }

  const requestBatchMatch = line.match(/Requesting Semantic Scholar batch (\d+)\/(\d+)\./u);
  if (requestBatchMatch?.[1] && requestBatchMatch?.[2]) {
    const batchIndex = Number(requestBatchMatch[1]);
    const batchTotal = Number(requestBatchMatch[2]);
    if (!Number.isFinite(batchIndex) || !Number.isFinite(batchTotal)) {
      return current;
    }

    return {
      targetTotal: current?.targetTotal,
      currentStored: current?.currentStored ?? 0,
      startedAtMs: current?.startedAtMs ?? nowMs,
      lastUpdatedAtMs: nowMs,
      samples: current?.samples ? [...current.samples] : [],
      requestingBatchIndex: Math.max(1, batchIndex),
      requestingBatchTotal: Math.max(1, batchTotal),
      currentBatchProcessed: undefined,
      currentBatchSize: undefined,
      enrichmentProcessed: undefined,
      enrichmentTotal: undefined
    };
  }

  const batchProgressMatch = line.match(
    /Collect batch progress: batch (\d+)\/(\d+), processed (\d+)\/(\d+), stored (\d+)\/(\d+)\./u
  );
  if (
    batchProgressMatch?.[1] &&
    batchProgressMatch?.[2] &&
    batchProgressMatch?.[3] &&
    batchProgressMatch?.[4] &&
    batchProgressMatch?.[5] &&
    batchProgressMatch?.[6]
  ) {
    const processed = Number(batchProgressMatch[3]);
    const batchSize = Number(batchProgressMatch[4]);
    const stored = Number(batchProgressMatch[5]);
    const targetTotal = Number(batchProgressMatch[6]);
    if (
      !Number.isFinite(processed) ||
      !Number.isFinite(batchSize) ||
      !Number.isFinite(stored) ||
      !Number.isFinite(targetTotal)
    ) {
      return current;
    }

    return {
      targetTotal: targetTotal > 0 ? targetTotal : current?.targetTotal,
      currentStored: Math.max(0, stored),
      startedAtMs: current?.startedAtMs ?? nowMs,
      lastUpdatedAtMs: nowMs,
      samples: current?.samples ? [...current.samples] : [],
      requestingBatchIndex: undefined,
      requestingBatchTotal: undefined,
      currentBatchProcessed: Math.max(0, processed),
      currentBatchSize: batchSize > 0 ? batchSize : undefined,
      enrichmentProcessed: undefined,
      enrichmentTotal: undefined
    };
  }

  const enrichmentStartMatch = line.match(
    /Starting deferred enrichment for (\d+) paper\(s\) with concurrency \d+\./u
  );
  if (enrichmentStartMatch?.[1]) {
    const total = Number(enrichmentStartMatch[1]);
    if (!Number.isFinite(total)) {
      return current;
    }

    return {
      targetTotal: current?.targetTotal,
      currentStored: current?.currentStored ?? 0,
      startedAtMs: current?.startedAtMs ?? nowMs,
      lastUpdatedAtMs: nowMs,
      samples: current?.samples ? [...current.samples] : [],
      requestingBatchIndex: undefined,
      requestingBatchTotal: undefined,
      currentBatchProcessed: undefined,
      currentBatchSize: undefined,
      enrichmentProcessed: 0,
      enrichmentTotal: total > 0 ? total : undefined
    };
  }

  const enrichmentProgressMatch = line.match(
    /Collect enrichment progress: processed (\d+)\/(\d+), stored (\d+)\/(\d+)\./u
  );
  if (
    enrichmentProgressMatch?.[1] &&
    enrichmentProgressMatch?.[2] &&
    enrichmentProgressMatch?.[3] &&
    enrichmentProgressMatch?.[4]
  ) {
    const processed = Number(enrichmentProgressMatch[1]);
    const total = Number(enrichmentProgressMatch[2]);
    const stored = Number(enrichmentProgressMatch[3]);
    const targetTotal = Number(enrichmentProgressMatch[4]);
    if (
      !Number.isFinite(processed) ||
      !Number.isFinite(total) ||
      !Number.isFinite(stored) ||
      !Number.isFinite(targetTotal)
    ) {
      return current;
    }

    return {
      targetTotal: targetTotal > 0 ? targetTotal : current?.targetTotal,
      currentStored: Math.max(0, stored),
      startedAtMs: current?.startedAtMs ?? nowMs,
      lastUpdatedAtMs: nowMs,
      samples: current?.samples ? [...current.samples] : [],
      requestingBatchIndex: undefined,
      requestingBatchTotal: undefined,
      currentBatchProcessed: undefined,
      currentBatchSize: undefined,
      enrichmentProcessed: Math.max(0, processed),
      enrichmentTotal: total > 0 ? total : undefined
    };
  }

  const progressMatch = line.match(/Collected (\d+) paper\(s\) so far/u);
  if (progressMatch?.[1]) {
    const stored = Number(progressMatch[1]);
    if (!Number.isFinite(stored) || stored < 0) {
      return current;
    }

    const next: CollectProgressState = current
      ? {
          ...current,
          currentStored: stored,
          lastUpdatedAtMs: nowMs,
          samples: [...current.samples],
          requestingBatchIndex: undefined,
          requestingBatchTotal: undefined,
          currentBatchProcessed: undefined,
          currentBatchSize: undefined,
          enrichmentProcessed: undefined,
          enrichmentTotal: undefined
        }
      : {
          targetTotal: undefined,
          currentStored: stored,
          startedAtMs: nowMs,
          lastUpdatedAtMs: nowMs,
          samples: [],
          requestingBatchIndex: undefined,
          requestingBatchTotal: undefined,
          currentBatchProcessed: undefined,
          currentBatchSize: undefined,
          enrichmentProcessed: undefined,
          enrichmentTotal: undefined
        };

    const lastSample = next.samples[next.samples.length - 1];
    if (!lastSample || lastSample.stored !== stored) {
      next.samples.push({ stored, atMs: nowMs });
      if (next.samples.length > MAX_SAMPLES) {
        next.samples = next.samples.slice(-MAX_SAMPLES);
      }
    }

    return next;
  }

  return current;
}

export function isCollectProgressLog(line: string): boolean {
  return (
    /Moving to collect_papers with target total \d+\./u.test(line) ||
    /Requesting Semantic Scholar batch \d+\/\d+\./u.test(line) ||
    /Collect batch progress: batch \d+\/\d+, processed \d+\/\d+, stored \d+\/\d+\./u.test(line) ||
    /Starting deferred enrichment for \d+ paper\(s\) with concurrency \d+\./u.test(line) ||
    /Collect enrichment progress: processed \d+\/\d+, stored \d+\/\d+\./u.test(line) ||
    /Collected \d+ paper\(s\) so far/u.test(line)
  );
}

export function shouldClearCollectProgress(line: string): boolean {
  return (
    /Semantic Scholar stored \d+ papers/u.test(line) ||
    /collect_papers failed:/u.test(line) ||
    /Node collect_papers failed:/u.test(line) ||
    /Cleared paper artifacts:/u.test(line) ||
    /Run reset to collect_papers \(pending\)\./u.test(line) ||
    /Cleared collect_papers artifacts:/u.test(line)
  );
}

export function formatCollectActivityLabel(
  state: CollectProgressState | undefined,
  nowMs = Date.now()
): string {
  const base = "Collecting...";
  if (!state) {
    return base;
  }

  const current = Math.max(0, Math.floor(state.currentStored));
  const effectiveCurrent =
    typeof state.currentBatchProcessed === "number"
      ? Math.max(current, current + Math.max(0, state.currentBatchProcessed))
      : current;
  const target = state.targetTotal && state.targetTotal > 0 ? Math.floor(state.targetTotal) : undefined;
  if (!target) {
    return effectiveCurrent > 0 ? `${base} ${effectiveCurrent}` : base;
  }

  if (effectiveCurrent <= 0) {
    const suffix = formatCollectPhaseSuffix(state);
    return suffix ? `${base} 0/${target} (${suffix})` : `${base} 0/${target}`;
  }

  const eta = estimateRemainingMs(state, nowMs);
  const batchSuffix = formatCollectPhaseSuffix(state);
  if (eta === undefined) {
    return batchSuffix ? `${base} ${effectiveCurrent}/${target} (${batchSuffix})` : `${base} ${effectiveCurrent}/${target}`;
  }
  const details = [batchSuffix, `ETA ~${formatDuration(eta)}`].filter(Boolean).join(", ");
  return `${base} ${effectiveCurrent}/${target} (${details})`;
}

function formatCollectPhaseSuffix(state: CollectProgressState): string | undefined {
  if (typeof state.enrichmentProcessed === "number" && state.enrichmentTotal) {
    return `enrich ${state.enrichmentProcessed}/${state.enrichmentTotal}`;
  }
  if (typeof state.currentBatchProcessed === "number" && state.currentBatchSize) {
    return `batch ${state.currentBatchProcessed}/${state.currentBatchSize}`;
  }
  if (typeof state.requestingBatchIndex === "number" && state.requestingBatchTotal) {
    return `request ${state.requestingBatchIndex}/${state.requestingBatchTotal}`;
  }
  return undefined;
}

function estimateRemainingMs(state: CollectProgressState, nowMs: number): number | undefined {
  const target = state.targetTotal;
  const effectiveCurrent =
    typeof state.currentBatchProcessed === "number"
      ? Math.max(state.currentStored, state.currentStored + Math.max(0, state.currentBatchProcessed))
      : state.currentStored;
  if (!target || effectiveCurrent <= 0 || effectiveCurrent >= target) {
    return undefined;
  }

  let ratePerMs: number | undefined;
  if (state.samples.length >= 2) {
    const first = state.samples[0];
    const last = state.samples[state.samples.length - 1];
    const deltaCount = last.stored - first.stored;
    const deltaMs = last.atMs - first.atMs;
    if (deltaCount > 0 && deltaMs > 0) {
      ratePerMs = deltaCount / deltaMs;
    }
  }

  if (!ratePerMs) {
    const elapsedMs = nowMs - state.startedAtMs;
    if (elapsedMs <= 0) {
      return undefined;
    }
    ratePerMs = effectiveCurrent / elapsedMs;
  }

  if (!ratePerMs || ratePerMs <= 0) {
    return undefined;
  }

  const remaining = target - effectiveCurrent;
  return Math.max(0, Math.round(remaining / ratePerMs));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

export function updateAnalyzeProgressFromLog(
  current: AnalyzeProgressState | undefined,
  line: string,
  nowMs = Date.now()
): AnalyzeProgressState | undefined {
  const rankTopNMatch = line.match(/Ranking \d+ papers and selecting the top (\d+) for analysis\./u);
  if (rankTopNMatch?.[1]) {
    const total = Number(rankTopNMatch[1]);
    if (Number.isFinite(total) && total > 0) {
      return {
        total,
        current: 0,
        startedAtMs: nowMs,
        lastUpdatedAtMs: nowMs,
        samples: [],
        phase: "ranking"
      };
    }
  }

  const analyzeAllMatch = line.match(/Analyzing all (\d+) collected papers\./u);
  if (analyzeAllMatch?.[1]) {
    const total = Number(analyzeAllMatch[1]);
    if (Number.isFinite(total) && total > 0) {
      return {
        total,
        current: 0,
        startedAtMs: nowMs,
        lastUpdatedAtMs: nowMs,
        samples: [],
        phase: "ranking"
      };
    }
  }

  const rerankMatch = line.match(/Preparing LLM rerank for (\d+) candidate\(s\) to choose top (\d+)\./u);
  if (rerankMatch?.[1] && rerankMatch?.[2]) {
    const candidatePoolSize = Number(rerankMatch[1]);
    const total = Number(rerankMatch[2]);
    if (Number.isFinite(total) && total > 0) {
      return {
        total,
        current: current?.current ?? 0,
        startedAtMs: current?.startedAtMs ?? nowMs,
        lastUpdatedAtMs: nowMs,
        samples: current?.samples ? [...current.samples] : [],
        phase: "rerank",
        candidatePoolSize: Number.isFinite(candidatePoolSize) && candidatePoolSize > 0 ? candidatePoolSize : undefined,
        rerankStage: undefined,
        rerankStageTotal: undefined,
        rerankPercent: undefined,
        rerankLabel: undefined
      };
    }
  }

  const rerankProgressMatch = line.match(/Rerank progress: (\d+)\/(\d+) \((\d+)%\) (.+)\./u);
  if (rerankProgressMatch?.[1] && rerankProgressMatch?.[2] && rerankProgressMatch?.[3] && rerankProgressMatch?.[4]) {
    const stage = Number(rerankProgressMatch[1]);
    const stageTotal = Number(rerankProgressMatch[2]);
    const rerankPercent = Number(rerankProgressMatch[3]);
    const rerankLabel = rerankProgressMatch[4].trim();
    if (
      Number.isFinite(stage) &&
      Number.isFinite(stageTotal) &&
      Number.isFinite(rerankPercent) &&
      stage > 0 &&
      stageTotal > 0
    ) {
      return {
        total: current?.total ?? 0,
        current: current?.current ?? 0,
        startedAtMs: current?.startedAtMs ?? nowMs,
        lastUpdatedAtMs: nowMs,
        samples: current?.samples ? [...current.samples] : [],
        phase: "rerank",
        candidatePoolSize: current?.candidatePoolSize,
        rerankStage: stage,
        rerankStageTotal: stageTotal,
        rerankPercent: rerankPercent >= 0 ? Math.min(100, rerankPercent) : undefined,
        rerankLabel
      };
    }
  }

  const paperMatch = line.match(/Analyzing paper (\d+)\/(\d+): /u);
  if (paperMatch?.[1] && paperMatch?.[2]) {
    const currentPaper = Number(paperMatch[1]);
    const total = Number(paperMatch[2]);
    if (!Number.isFinite(currentPaper) || !Number.isFinite(total) || currentPaper <= 0 || total <= 0) {
      return current;
    }

    const next: AnalyzeProgressState = current
      ? {
          ...current,
          total,
          current: currentPaper,
          lastUpdatedAtMs: nowMs,
          phase: "analyzing",
          samples: [...current.samples]
        }
      : {
          total,
          current: currentPaper,
          startedAtMs: nowMs,
          lastUpdatedAtMs: nowMs,
          samples: [],
          phase: "analyzing"
        };

    const lastSample = next.samples[next.samples.length - 1];
    if (!lastSample || lastSample.completed !== currentPaper) {
      next.samples.push({ completed: currentPaper, atMs: nowMs });
      if (next.samples.length > MAX_SAMPLES) {
        next.samples = next.samples.slice(-MAX_SAMPLES);
      }
    }

    return next;
  }

  return current;
}

export function isAnalyzeProgressLog(line: string): boolean {
  return (
    /Ranking \d+ papers and selecting the top \d+ for analysis\./u.test(line) ||
    /Analyzing all \d+ collected papers\./u.test(line) ||
    /Deterministic pre-rank started for \d+ paper\(s\)/u.test(line) ||
    /Deterministic pre-rank completed for \d+ candidate\(s\)\./u.test(line) ||
    /Preparing LLM rerank for \d+ candidate\(s\) to choose top \d+\./u.test(line) ||
    /Rerank progress: \d+\/\d+ \(\d+%\) .+\./u.test(line) ||
    /Analyzing paper \d+\/\d+: /u.test(line)
  );
}

export function shouldClearAnalyzeProgress(line: string): boolean {
  return (
    /Analysis totals:/u.test(line) ||
    /Node analyze_papers finished:/u.test(line) ||
    /Node analyze_papers failed:/u.test(line) ||
    /Cleared analyze_papers artifacts:/u.test(line) ||
    /Run reset to analyze_papers \(pending\)\./u.test(line)
  );
}

export function formatAnalyzeProgressLogLine(
  state: AnalyzeProgressState | undefined,
  nowMs = Date.now()
): string | undefined {
  if (!state) {
    return undefined;
  }

  if (state.phase === "ranking") {
    return `Analyzing... ranking candidates for top ${state.total}`
  }

  if (state.phase === "rerank") {
    const base = state.candidatePoolSize
      ? `Analyzing... reranking ${state.candidatePoolSize} candidates for top ${state.total}`
      : `Analyzing... reranking candidates for top ${state.total}`;
    if (typeof state.rerankPercent === "number" && state.rerankLabel) {
      return `${base} (${state.rerankPercent}%, ${state.rerankLabel})`;
    }
    return base;
  }

  const base = `Analyzing... ${Math.max(0, state.current)}/${state.total}`;
  const eta = estimateAnalyzeRemainingMs(state, nowMs);
  if (eta === undefined) {
    return base;
  }
  return `${base} (ETA ~${formatDuration(eta)})`;
}

function estimateAnalyzeRemainingMs(state: AnalyzeProgressState, nowMs: number): number | undefined {
  if (state.current <= 0 || state.current >= state.total) {
    return undefined;
  }

  let ratePerMs: number | undefined;
  if (state.samples.length >= 2) {
    const first = state.samples[0];
    const last = state.samples[state.samples.length - 1];
    const deltaCount = last.completed - first.completed;
    const deltaMs = last.atMs - first.atMs;
    if (deltaCount > 0 && deltaMs > 0) {
      ratePerMs = deltaCount / deltaMs;
    }
  }

  if (!ratePerMs) {
    const elapsedMs = nowMs - state.startedAtMs;
    if (elapsedMs > 0) {
      ratePerMs = state.current / elapsedMs;
    }
  }

  if (!ratePerMs || ratePerMs <= 0) {
    return undefined;
  }

  return Math.max(0, Math.round((state.total - state.current) / ratePerMs));
}
