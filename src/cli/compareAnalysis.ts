import path from "node:path";

import { promises as fs } from "node:fs";

import { bootstrapAutoLabOSRuntime } from "../runtime/createRuntime.js";
import { resolveOpenAiApiKey } from "../config.js";
import { ResponsesPdfAnalysisClient } from "../integrations/openai/responsesPdfAnalysisClient.js";
import { CodexLLMClient } from "../core/llm/client.js";
import {
  analyzePaperWithLlm,
  analyzePaperWithResponsesPdf,
  PaperAnalysisResult
} from "../core/analysis/paperAnalyzer.js";
import {
  AnalysisCorpusRow,
  resolvePaperPdfUrl,
  resolvePaperTextSource
} from "../core/analysis/paperText.js";
import {
  AnalysisJudgeResult,
  AnalysisResultDigest,
  buildAnalysisResultDigest,
  buildJudgeCandidateOrder,
  buildPaperAnalysisComparisonJudgePrompt,
  computeAnalysisResultStats,
  parsePaperAnalysisComparisonJudgeJson,
  selectPapersForComparison
} from "../core/analysis/paperAnalysisComparison.js";
import { EvalHarnessRunReport, generateEvalHarnessReport } from "../core/evaluation/evalHarness.js";
import { writeRunArtifact, safeRead } from "../core/nodes/helpers.js";
import { RunRecord } from "../types.js";

interface CompareAnalysisCliOptions {
  cwd: string;
  runId: string;
  limit: number;
  judge: boolean;
}

interface ComparisonArtifactPaper {
  paper_id: string;
  title: string;
  pdf_url: string;
  codex: {
    ok: boolean;
    error?: string;
    digest?: AnalysisResultDigest;
    stats?: ReturnType<typeof computeAnalysisResultStats>;
  };
  api: {
    ok: boolean;
    error?: string;
    digest?: AnalysisResultDigest;
    stats?: ReturnType<typeof computeAnalysisResultStats>;
  };
  judge?: {
    ok: boolean;
    error?: string;
    winner?: AnalysisJudgeResult["winner"];
    result?: AnalysisJudgeResult;
  };
}

export interface ComparisonEvaluationContext {
  present: boolean;
  overall_score?: number;
  implementation_status?: EvalHarnessRunReport["statuses"]["implement"];
  run_verifier_status?: EvalHarnessRunReport["statuses"]["run_verifier"];
  objective_status?: string;
  implementation_policy_blocked?: boolean;
  run_verifier_policy_blocked?: boolean;
  policy_blocked?: boolean;
  implement_policy_rule_id?: string;
  run_verifier_policy_rule_id?: string;
  findings: string[];
}

export interface ComparisonArtifactPayload {
  version: number;
  createdAt: string;
  runId: string;
  selection: {
    source: string;
    requestedLimit: number;
    comparedPaperIds: string[];
    skipped: Array<{ paper_id: string; title: string; reason: string }>;
  };
  judge: { enabled: boolean; model?: string };
  aggregate: ReturnType<typeof buildAggregate>;
  evaluation_context: ComparisonEvaluationContext;
  papers: ComparisonArtifactPaper[];
}

export async function runCompareAnalysisCli(options: CompareAnalysisCliOptions): Promise<void> {
  const bootstrap = await bootstrapAutoLabOSRuntime({
    cwd: options.cwd,
    allowInteractiveSetup: false
  });
  if (!bootstrap.runtime || !bootstrap.config) {
    throw new Error("AutoLabOS is not configured in this workspace yet.");
  }

  const run = await bootstrap.runtime.runStore.getRun(options.runId);
  if (!run) {
    throw new Error(`Run not found: ${options.runId}`);
  }
  const evaluationContext = await buildComparisonEvaluationContext(options.cwd, run.id);

  const cliCheck = await bootstrap.runtime.codex.checkCliAvailable();
  if (!cliCheck.ok) {
    throw new Error(`Codex CLI is not available: ${cliCheck.detail}`);
  }
  const loginCheck = await bootstrap.runtime.codex.checkLoginStatus();
  if (!loginCheck.ok) {
    throw new Error(`Codex login is required for comparison: ${loginCheck.detail}`);
  }

  const responsesClient = new ResponsesPdfAnalysisClient(() => resolveOpenAiApiKey(bootstrap.paths.cwd));
  if (!(await responsesClient.hasApiKey())) {
    throw new Error("OPENAI_API_KEY is required to compare analysis quality against Responses API.");
  }

  const corpusRows = await readCorpusRows(run.id);
  const selectedPaperIds = await readSelectedPaperIds(run);
  const selection = selectPapersForComparison({
    corpusRows,
    selectedPaperIds,
    limit: options.limit
  });

  if (selection.papers.length === 0) {
    throw new Error("No comparable papers with PDF URLs were found for this run.");
  }

  const codexPdfLlm = new CodexLLMClient(bootstrap.runtime.codex, {
    model: bootstrap.config.providers.codex.pdf_model || bootstrap.config.providers.codex.model,
    reasoningEffort:
      bootstrap.config.providers.codex.pdf_reasoning_effort || bootstrap.config.providers.codex.reasoning_effort,
    fastMode: bootstrap.config.providers.codex.pdf_fast_mode
  });

  const results: ComparisonArtifactPaper[] = [];
  let judgeWins = { codex: 0, api: 0, tie: 0 };

  process.stdout.write(
    [
      `Comparing analysis quality for run ${run.id}`,
      `Selection source: ${selection.selectionSource}`,
      `Papers selected: ${selection.papers.length}`,
      `Judge enabled: ${options.judge ? "yes" : "no"}`,
      `Codex PDF model: ${bootstrap.config.providers.codex.pdf_model || bootstrap.config.providers.codex.model}`,
      `Responses PDF model: ${bootstrap.config.analysis.responses_model}`,
      ""
    ].join("\n")
  );

  for (const paper of selection.papers) {
    const pdfUrl = resolvePaperPdfUrl(paper);
    if (!pdfUrl) {
      continue;
    }

    process.stdout.write(`- ${paper.paper_id}: ${paper.title}\n`);

    const comparison: ComparisonArtifactPaper = {
      paper_id: paper.paper_id,
      title: paper.title,
      pdf_url: pdfUrl,
      codex: { ok: false },
      api: { ok: false }
    };

    let codexResult: PaperAnalysisResult | undefined;
    let apiResult: PaperAnalysisResult | undefined;

    try {
      const source = await resolvePaperTextSource({
        runId: run.id,
        paper,
        includePageImages: true
      });
      codexResult = await analyzePaperWithLlm({
        llm: codexPdfLlm,
        paper,
        source,
        maxAttempts: 2
      });
      comparison.codex = {
        ok: true,
        digest: buildAnalysisResultDigest(codexResult),
        stats: computeAnalysisResultStats(codexResult)
      };
    } catch (error) {
      comparison.codex = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    try {
      apiResult = await analyzePaperWithResponsesPdf({
        client: responsesClient,
        paper,
        pdfUrl,
        model: bootstrap.config.analysis.responses_model,
        reasoningEffort: bootstrap.config.analysis.responses_reasoning_effort,
        maxAttempts: 2
      });
      comparison.api = {
        ok: true,
        digest: buildAnalysisResultDigest(apiResult),
        stats: computeAnalysisResultStats(apiResult)
      };
    } catch (error) {
      comparison.api = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    if (options.judge && codexResult && apiResult) {
      try {
        const judgeOrder = buildJudgeCandidateOrder(paper.paper_id);
        const candidateA = judgeOrder.candidateA === "codex"
          ? buildAnalysisResultDigest(codexResult)
          : buildAnalysisResultDigest(apiResult);
        const candidateB = judgeOrder.candidateB === "codex"
          ? buildAnalysisResultDigest(codexResult)
          : buildAnalysisResultDigest(apiResult);
        const judgeRaw = await responsesClient.analyzePdf({
          model: bootstrap.config.analysis.responses_model,
          pdfUrl,
          reasoningEffort: bootstrap.config.analysis.responses_reasoning_effort,
          prompt: buildPaperAnalysisComparisonJudgePrompt({
            paper,
            candidateA,
            candidateB
          })
        });
        const judgeResult = parsePaperAnalysisComparisonJudgeJson(judgeRaw.text, judgeOrder);
        judgeWins = {
          ...judgeWins,
          [judgeResult.winner]: judgeWins[judgeResult.winner] + 1
        };
        comparison.judge = {
          ok: true,
          winner: judgeResult.winner,
          result: judgeResult
        };
      } catch (error) {
        comparison.judge = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    results.push(comparison);
  }

  const aggregate = buildAggregate(results, judgeWins);
  const payload: ComparisonArtifactPayload = {
    version: 1,
    createdAt: new Date().toISOString(),
    runId: run.id,
    selection: {
      source: selection.selectionSource,
      requestedLimit: options.limit,
      comparedPaperIds: results.map((item) => item.paper_id),
      skipped: selection.skipped
    },
    judge: {
      enabled: options.judge,
      model: options.judge ? bootstrap.config.analysis.responses_model : undefined
    },
    aggregate,
    evaluation_context: evaluationContext,
    papers: results
  };

  await writeRunArtifact(run, "analysis_mode_comparison.json", `${JSON.stringify(payload, null, 2)}\n`);
  await writeRunArtifact(run, "analysis_mode_comparison.md", buildMarkdownReport(run, payload));

  process.stdout.write(
    [
      "",
      `Compared papers: ${aggregate.comparedCount}`,
      `Successful Codex analyses: ${aggregate.codexSuccessCount}`,
      `Successful API analyses: ${aggregate.apiSuccessCount}`,
      evaluationContext.present
        ? `Run policy context: blocked=${evaluationContext.policy_blocked ? "yes" : "no"}, implement=${evaluationContext.implementation_status}, run_verifier=${evaluationContext.run_verifier_status}`
        : "Run policy context: unavailable",
      options.judge
        ? `Judge wins -> codex: ${aggregate.judgeWins.codex}, api: ${aggregate.judgeWins.api}, tie: ${aggregate.judgeWins.tie}`
        : "Judge skipped",
      `Artifact: .autolabos/runs/${run.id}/analysis_mode_comparison.json`,
      `Report: .autolabos/runs/${run.id}/analysis_mode_comparison.md`
    ].join("\n") + "\n"
  );
}

function buildAggregate(
  papers: ComparisonArtifactPaper[],
  judgeWins: { codex: number; api: number; tie: number }
) {
  const codexStats = papers
    .map((paper) => paper.codex.stats)
    .filter((stats): stats is NonNullable<ComparisonArtifactPaper["codex"]["stats"]> => Boolean(stats));
  const apiStats = papers
    .map((paper) => paper.api.stats)
    .filter((stats): stats is NonNullable<ComparisonArtifactPaper["api"]["stats"]> => Boolean(stats));
  const judged = papers
    .map((paper) => paper.judge?.result)
    .filter((item): item is AnalysisJudgeResult => Boolean(item));

  return {
    comparedCount: papers.length,
    codexSuccessCount: papers.filter((paper) => paper.codex.ok).length,
    apiSuccessCount: papers.filter((paper) => paper.api.ok).length,
    judgeWins,
    averageEvidenceCount: {
      codex: average(codexStats.map((stats) => stats.evidenceCount)),
      api: average(apiStats.map((stats) => stats.evidenceCount))
    },
    averageOverallJudgeScore: {
      codex: average(judged.map((item) => item.codex.overall)),
      api: average(judged.map((item) => item.api.overall))
    }
  };
}

export function buildMarkdownReport(
  run: RunRecord,
  payload: ComparisonArtifactPayload
): string {
  const lines = [
    `# Analysis Mode Comparison`,
    ``,
    `Run: \`${run.id}\``,
    `Selection source: ${payload.selection.source}`,
    `Requested limit: ${payload.selection.requestedLimit}`,
    `Judge enabled: ${payload.judge.enabled ? `yes (${payload.judge.model})` : "no"}`,
    ``,
    `## Aggregate`,
    ``,
    `- Compared papers: ${payload.aggregate.comparedCount}`,
    `- Codex successes: ${payload.aggregate.codexSuccessCount}`,
    `- API successes: ${payload.aggregate.apiSuccessCount}`,
    `- Judge wins: codex=${payload.aggregate.judgeWins.codex}, api=${payload.aggregate.judgeWins.api}, tie=${payload.aggregate.judgeWins.tie}`,
    `- Avg evidence count: codex=${payload.aggregate.averageEvidenceCount.codex}, api=${payload.aggregate.averageEvidenceCount.api}`,
    `- Avg judge overall: codex=${payload.aggregate.averageOverallJudgeScore.codex}, api=${payload.aggregate.averageOverallJudgeScore.api}`,
    ``
  ];

  lines.push(`## Evaluation Context`, ``);
  if (payload.evaluation_context.present) {
    lines.push(`- Overall run score: ${payload.evaluation_context.overall_score ?? 0}`);
    lines.push(`- Implementation verifier: ${payload.evaluation_context.implementation_status || "unknown"}`);
    lines.push(`- Run verifier: ${payload.evaluation_context.run_verifier_status || "unknown"}`);
    lines.push(`- Objective status: ${payload.evaluation_context.objective_status || "unknown"}`);
    lines.push(`- Policy blocked: ${payload.evaluation_context.policy_blocked ? "yes" : "no"}`);
    if (payload.evaluation_context.implement_policy_rule_id) {
      lines.push(`- Implement policy rule: ${payload.evaluation_context.implement_policy_rule_id}`);
    }
    if (payload.evaluation_context.run_verifier_policy_rule_id) {
      lines.push(`- Run verifier policy rule: ${payload.evaluation_context.run_verifier_policy_rule_id}`);
    }
    if (payload.evaluation_context.findings.length > 0) {
      lines.push(`- Key findings:`);
      for (const finding of payload.evaluation_context.findings.slice(0, 3)) {
        lines.push(`  - ${finding}`);
      }
    }
  } else {
    lines.push(`- Eval harness context was unavailable for this run.`);
  }
  lines.push(``);

  if (payload.selection.skipped.length > 0) {
    lines.push(`## Skipped`, ``);
    for (const skipped of payload.selection.skipped) {
      lines.push(`- ${skipped.paper_id}: ${skipped.reason}`);
    }
    lines.push(``);
  }

  lines.push(`## Papers`, ``);
  for (const paper of payload.papers) {
    lines.push(`### ${paper.paper_id} - ${paper.title}`, ``);
    lines.push(`- PDF: ${paper.pdf_url}`);
    lines.push(
      `- Codex: ${paper.codex.ok ? `ok (evidence=${paper.codex.stats?.evidenceCount ?? 0})` : `failed (${paper.codex.error})`}`
    );
    lines.push(
      `- API: ${paper.api.ok ? `ok (evidence=${paper.api.stats?.evidenceCount ?? 0})` : `failed (${paper.api.error})`}`
    );
    if (paper.judge) {
      lines.push(
        `- Judge: ${paper.judge.ok ? `winner=${paper.judge.winner}` : `failed (${paper.judge.error})`}`
      );
      if (paper.judge.result?.rationale) {
        lines.push(`- Rationale: ${paper.judge.result.rationale}`);
      }
    }
    lines.push(``);
  }

  return `${lines.join("\n").trim()}\n`;
}

export function normalizeComparisonEvaluationContext(
  runReport: EvalHarnessRunReport | undefined
): ComparisonEvaluationContext {
  if (!runReport) {
    return {
      present: false,
      findings: []
    };
  }

  return {
    present: true,
    overall_score: runReport.scores.overall,
    implementation_status: runReport.statuses.implement,
    run_verifier_status: runReport.statuses.run_verifier,
    objective_status: runReport.statuses.objective,
    implementation_policy_blocked: runReport.metrics.implement_failure_type === "policy",
    run_verifier_policy_blocked: runReport.metrics.run_verifier_stage === "policy",
    policy_blocked: runReport.metrics.policy_blocked,
    implement_policy_rule_id: runReport.metrics.implement_policy_rule_id,
    run_verifier_policy_rule_id: runReport.metrics.run_verifier_policy_rule_id,
    findings: runReport.findings
  };
}

async function buildComparisonEvaluationContext(
  cwd: string,
  runId: string
): Promise<ComparisonEvaluationContext> {
  const report = await generateEvalHarnessReport({
    cwd,
    runIds: [runId],
    limit: 1
  });
  return normalizeComparisonEvaluationContext(report.runs[0]);
}

async function readCorpusRows(runId: string): Promise<AnalysisCorpusRow[]> {
  const corpusPath = path.join(".autolabos", "runs", runId, "corpus.jsonl");
  const corpusText = await safeRead(corpusPath);
  return corpusText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as AnalysisCorpusRow;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is AnalysisCorpusRow => Boolean(row?.paper_id));
}

async function readSelectedPaperIds(run: RunRecord): Promise<string[] | undefined> {
  const manifestPath = path.join(".autolabos", "runs", run.id, "analysis_manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { selectedPaperIds?: unknown };
    return Array.isArray(parsed.selectedPaperIds)
      ? parsed.selectedPaperIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;
  } catch {
    return undefined;
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}
