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
        samples: []
      };
    }
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
          samples: [...current.samples]
        }
      : {
          targetTotal: undefined,
          currentStored: stored,
          startedAtMs: nowMs,
          lastUpdatedAtMs: nowMs,
          samples: []
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
  const target = state.targetTotal && state.targetTotal > 0 ? Math.floor(state.targetTotal) : undefined;
  if (!target) {
    return current > 0 ? `${base} ${current}` : base;
  }

  if (current <= 0) {
    return `${base} 0/${target}`;
  }

  const eta = estimateRemainingMs(state, nowMs);
  if (eta === undefined) {
    return `${base} ${current}/${target}`;
  }
  return `${base} ${current}/${target} (ETA ~${formatDuration(eta)})`;
}

function estimateRemainingMs(state: CollectProgressState, nowMs: number): number | undefined {
  const target = state.targetTotal;
  if (!target || state.currentStored <= 0 || state.currentStored >= target) {
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
    ratePerMs = state.currentStored / elapsedMs;
  }

  if (!ratePerMs || ratePerMs <= 0) {
    return undefined;
  }

  const remaining = target - state.currentStored;
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
