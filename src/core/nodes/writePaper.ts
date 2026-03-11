import path from "node:path";
import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { resolveConstraintProfile } from "../constraintProfile.js";
import { ensureDir, fileExists } from "../../utils/fs.js";
import { buildPublicPaperDir } from "../publicArtifacts.js";
import {
  ObjectiveMetricEvaluation,
  resolveObjectiveMetricProfile
} from "../objectiveMetric.js";
import {
  buildPaperBibtex,
  buildPaperEvidenceMap,
  collectPaperCitationIds,
  PaperWritingBundle,
  parseCorpusRows,
  parseEvidenceRows,
  parseExperimentPlan,
  parseHypotheses,
  parsePaperSummaries,
  parseResultAnalysis,
  renderPaperTex,
  validatePaperDraft
} from "../analysis/paperWriting.js";
import { PaperWriterSessionManager } from "../agents/paperWriterSessionManager.js";

interface PaperCompileCommandResult {
  step: string;
  command: string;
  status: "ok" | "error";
  exit_code?: number;
  duration_ms: number;
  optional?: boolean;
  stdout?: string;
  stderr?: string;
}

interface PaperCompileAttempt {
  attempt: number;
  repaired: boolean;
  status: "success" | "failed";
  commands: PaperCompileCommandResult[];
  warnings: string[];
  error?: string;
  build_log_path: string;
  pdf_exists: boolean;
}

interface PaperCompileResult {
  enabled: boolean;
  status: "skipped" | "success" | "repaired_success" | "failed";
  repaired: boolean;
  toolCallsUsed: number;
  attempts: PaperCompileAttempt[];
  warnings: string[];
  pdf_path?: string;
  build_log_path?: string;
  repair_error?: string;
}

interface PaperInputValidationIssue {
  artifact: string;
  path: string;
  reason: string;
}

interface PaperInputValidationReport {
  ok: boolean;
  issues: PaperInputValidationIssue[];
}

interface PaperDraftValidationRepairReport {
  threshold: number;
  attempted: boolean;
  applied: boolean;
  source?: string;
  error?: string;
  reason?: string;
  initial_warning_count: number;
  candidate_warning_count?: number;
  final_warning_count: number;
}

const VALIDATION_REPAIR_WARNING_THRESHOLD = 1;

export function createWritePaperNode(deps: NodeExecutionDeps): GraphNodeHandler {
  const sessions = new PaperWriterSessionManager({
    config: deps.config,
    codex: deps.codex,
    llm: deps.llm,
    eventStream: deps.eventStream,
    runStore: deps.runStore,
    workspaceRoot: process.cwd()
  });

  return {
    id: "write_paper",
    async execute({ run, abortSignal }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const emitLog = (text: string) => {
        deps.eventStream.emit({
          type: "OBS_RECEIVED",
          runId: run.id,
          node: "write_paper",
          payload: { text }
        });
      };
      const bundleResult = await loadValidatedPaperBundle(run);
      await writeRunArtifact(
        run,
        "paper/input_validation.json",
        `${JSON.stringify(bundleResult.report, null, 2)}\n`
      );
      await runContextMemory.put("write_paper.input_validation", bundleResult.report);
      if (!bundleResult.bundle) {
        emitLog(bundleResult.error);
        await runContextMemory.put("write_paper.last_error", bundleResult.error);
        await runContextMemory.put("write_paper.compile_status", null);
        await runContextMemory.put("write_paper.compile_report", null);
        await runContextMemory.put("write_paper.pdf_path", null);
        return {
          status: "failure",
          error: bundleResult.error,
          summary: bundleResult.error,
          toolCallsUsed: 0
        };
      }
      await runContextMemory.put("write_paper.last_error", null);

      const constraintProfile = await resolveConstraintProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "write_paper"
      });
      const objectiveMetricProfile = await resolveObjectiveMetricProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "write_paper"
      });
      const objectiveEvaluation = await loadObjectiveEvaluation(runContextMemory, run.id);
      const bundle = bundleResult.bundle;

      emitLog(
        `Preparing paper draft from ${bundle.paperSummaries.length} summaries, ${bundle.evidenceRows.length} evidence items, and ${bundle.hypotheses.length} hypotheses.`
      );

      const sessionResult = await sessions.run({
        run,
        bundle,
        constraintProfile,
        objectiveMetricProfile,
        objectiveEvaluation,
        abortSignal
      });
      let paperDraft = sessionResult.draft;
      emitLog(`Structured paper draft prepared with ${paperDraft.sections.length} sections via ${sessionResult.source}.`);

      let validation = validatePaperDraft({
        draft: paperDraft,
        bundle
      });
      paperDraft = validation.draft;
      if (validation.issues.length > 0) {
        emitLog(`Validated paper draft and recorded ${validation.issues.length} evidence-alignment warning(s).`);
      }
      const validationRepair: PaperDraftValidationRepairReport = {
        threshold: VALIDATION_REPAIR_WARNING_THRESHOLD,
        attempted: false,
        applied: false,
        initial_warning_count: validation.issues.length,
        final_warning_count: validation.issues.length
      };
      if (shouldAttemptValidationRepair(validation)) {
        emitLog(
          `Validation accumulated ${validation.issues.length} warning(s); attempting one automatic repair pass before rendering.`
        );
        const repairResult = await sessions.reviseAfterValidation({
          run,
          bundle,
          constraintProfile,
          objectiveMetricProfile,
          objectiveEvaluation,
          outline: sessionResult.outline,
          draft: paperDraft,
          review: sessionResult.review,
          validationIssues: validation.issues,
          abortSignal
        });
        validationRepair.attempted = repairResult.attempted;
        validationRepair.source = repairResult.source;
        validationRepair.error = repairResult.error;
        if (repairResult.applied) {
          const repairedValidation = validatePaperDraft({
            draft: repairResult.draft,
            bundle
          });
          validationRepair.candidate_warning_count = repairedValidation.issues.length;
          if (repairedValidation.issues.length <= validation.issues.length) {
            paperDraft = repairedValidation.draft;
            validation = repairedValidation;
            validationRepair.applied = true;
            validationRepair.final_warning_count = repairedValidation.issues.length;
            emitLog(
              `Automatic validation repair ${repairedValidation.issues.length < validationRepair.initial_warning_count ? "reduced" : "stabilized"} warnings at ${repairedValidation.issues.length}.`
            );
          } else {
            validationRepair.reason = "repair did not improve warning count";
            emitLog(
              `Automatic validation repair was discarded because warnings increased from ${validation.issues.length} to ${repairedValidation.issues.length}.`
            );
          }
        } else if (repairResult.error) {
          validationRepair.reason = "repair pass failed";
          emitLog(`Automatic validation repair failed: ${repairResult.error}`);
        }
      }

      const citedPaperIds = collectPaperCitationIds(paperDraft, bundle);
      const bibtex = buildPaperBibtex(bundle.corpus, citedPaperIds);
      const tex = renderPaperTex({
        runTitle: run.title,
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        draft: paperDraft,
        constraintProfile,
        objectiveMetricProfile,
        objectiveEvaluation,
        resultAnalysis: bundle.resultAnalysis,
        constraints: run.constraints,
        citationKeysByPaperId: bibtex.citationKeysByPaperId
      });
      const evidenceMap = JSON.stringify(buildPaperEvidenceMap(paperDraft), null, 2);

      await writeRunArtifact(run, "paper/main.tex", tex);
      await writeRunArtifact(run, "paper/references.bib", bibtex.references);
      await writeRunArtifact(run, "paper/evidence_links.json", evidenceMap);
      await writeRunArtifact(run, "paper/draft.json", `${JSON.stringify(paperDraft, null, 2)}\n`);
      await writeRunArtifact(run, "paper/validation.json", `${JSON.stringify(validation, null, 2)}\n`);
      await writeRunArtifact(
        run,
        "paper/validation_repair_report.json",
        `${JSON.stringify(validationRepair, null, 2)}\n`
      );

      const publicPaperDir = buildPublicPaperDir(process.cwd(), run);
      await ensureDir(publicPaperDir);
      await fs.writeFile(path.join(publicPaperDir, "main.tex"), tex, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "references.bib"), bibtex.references, "utf8");
      await fs.writeFile(path.join(publicPaperDir, "evidence_links.json"), evidenceMap, "utf8");

      const compileResult = await maybeBuildPaperPdf({
        deps,
        sessions,
        run,
        abortSignal,
        emitLog,
        publicPaperDir
      });
      const toolCallsUsed =
        Math.max(1, 4 - sessionResult.stageFallbacks) +
        compileResult.toolCallsUsed +
        (validationRepair.attempted ? 1 : 0);

      await runContextMemory.put("write_paper.public_dir", publicPaperDir);
      await runContextMemory.put("write_paper.source", sessionResult.source);
      await runContextMemory.put("write_paper.section_count", paperDraft.sections.length);
      await runContextMemory.put("write_paper.cited_paper_ids", bibtex.usedPaperIds);
      await runContextMemory.put("write_paper.last_draft", paperDraft);
      await runContextMemory.put("write_paper.validation", validation);
      await runContextMemory.put("write_paper.validation_repair", validationRepair);
      await runContextMemory.put("write_paper.compile_status", compileResult.status);
      await runContextMemory.put("write_paper.compile_report", compileResult);
      await runContextMemory.put("write_paper.pdf_path", compileResult.pdf_path || null);
      if (compileResult.status === "failed") {
        const compileError = buildCompileFailureError(compileResult);
        emitLog(compileError);
        await runContextMemory.put("write_paper.last_error", compileError);
        return {
          status: "failure",
          error: compileError,
          summary: compileError,
          toolCallsUsed
        };
      }
      await runContextMemory.put("write_paper.last_error", sessionResult.errors[0] || null);

      deps.eventStream.emit({
        type: "NODE_COMPLETED",
        runId: run.id,
        node: "write_paper",
        payload: {
          artifacts: [
            "paper/main.tex",
            "paper/references.bib",
            ...(compileResult.pdf_path ? ["paper/main.pdf"] : []),
            publicPaperDir
          ]
        }
      });

      return {
        status: "success",
        summary:
          sessionResult.source === "fallback"
            ? `Paper draft generated in LaTeX using staged fallbacks. Validation warnings: ${validation.issues.length}${describeValidationRepair(validationRepair)}. PDF: ${describeCompileStatus(compileResult)}.`
            : `Paper draft generated in LaTeX from ${paperDraft.sections.length} structured section(s) via ${sessionResult.source} with ${validation.issues.length} validation warning(s)${describeValidationRepair(validationRepair)}. PDF: ${describeCompileStatus(compileResult)}.`,
        needsApproval: true,
        toolCallsUsed
      };
    }
  };
}

async function loadValidatedPaperBundle(
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"]
): Promise<{
  bundle?: PaperWritingBundle;
  report: PaperInputValidationReport;
  error: string;
}> {
  const runRoot = path.join(".autolabos", "runs", run.id);
  const issues: PaperInputValidationIssue[] = [];
  const paperSummariesPath = path.join(runRoot, "paper_summaries.jsonl");
  const evidenceStorePath = path.join(runRoot, "evidence_store.jsonl");
  const hypothesesPath = path.join(runRoot, "hypotheses.jsonl");
  const corpusPath = path.join(runRoot, "corpus.jsonl");
  const experimentPlanPath = path.join(runRoot, "experiment_plan.yaml");
  const resultAnalysisPath = path.join(runRoot, "result_analysis.json");
  const reviewDecisionPath = path.join(runRoot, "review", "decision.json");
  const reviewFindingsPath = path.join(runRoot, "review", "findings.jsonl");

  const [
    paperSummariesRaw,
    evidenceRowsRaw,
    hypothesesRaw,
    corpusRaw,
    experimentPlanRaw,
    resultAnalysisRaw,
    reviewDecisionRaw,
    reviewFindingsRaw
  ] = await Promise.all([
    readRequiredRunArtifact(paperSummariesPath, "paper_summaries.jsonl", issues),
    readRequiredRunArtifact(evidenceStorePath, "evidence_store.jsonl", issues),
    readRequiredRunArtifact(hypothesesPath, "hypotheses.jsonl", issues),
    readRequiredRunArtifact(corpusPath, "corpus.jsonl", issues),
    readRequiredRunArtifact(experimentPlanPath, "experiment_plan.yaml", issues),
    readRequiredRunArtifact(resultAnalysisPath, "result_analysis.json", issues),
    safeRead(reviewDecisionPath),
    safeRead(reviewFindingsPath)
  ]);

  const paperSummaries = paperSummariesRaw ? parsePaperSummaries(paperSummariesRaw) : [];
  if (paperSummariesRaw && paperSummaries.length === 0) {
    issues.push({
      artifact: "paper_summaries.jsonl",
      path: paperSummariesPath,
      reason: "no valid paper summaries were found"
    });
  }

  const evidenceRows = evidenceRowsRaw ? parseEvidenceRows(evidenceRowsRaw) : [];
  if (evidenceRowsRaw && evidenceRows.length === 0) {
    issues.push({
      artifact: "evidence_store.jsonl",
      path: evidenceStorePath,
      reason: "no valid evidence rows were found"
    });
  }

  const hypotheses = hypothesesRaw ? parseHypotheses(hypothesesRaw) : [];
  if (hypothesesRaw && hypotheses.length === 0) {
    issues.push({
      artifact: "hypotheses.jsonl",
      path: hypothesesPath,
      reason: "no valid hypotheses were found"
    });
  }

  const corpus = corpusRaw ? parseCorpusRows(corpusRaw) : [];
  if (corpusRaw && corpus.length === 0) {
    issues.push({
      artifact: "corpus.jsonl",
      path: corpusPath,
      reason: "no valid corpus rows were found"
    });
  }

  const experimentPlan = experimentPlanRaw ? parseExperimentPlan(experimentPlanRaw) : undefined;
  if (experimentPlanRaw && !experimentPlan) {
    issues.push({
      artifact: "experiment_plan.yaml",
      path: experimentPlanPath,
      reason: "the experiment plan could not be parsed"
    });
  }

  const resultAnalysis = resultAnalysisRaw ? parseResultAnalysis(resultAnalysisRaw) : undefined;
  if (resultAnalysisRaw && !resultAnalysis) {
    issues.push({
      artifact: "result_analysis.json",
      path: resultAnalysisPath,
      reason: "the result analysis could not be parsed"
    });
  }
  const reviewContext = parseReviewContext(reviewDecisionRaw, reviewFindingsRaw);

  const report: PaperInputValidationReport = {
    ok: issues.length === 0,
    issues
  };

  if (issues.length > 0) {
    const artifactList = [...new Set(issues.map((item) => item.artifact))].join(", ");
    return {
      report,
      error: `write_paper requires valid upstream artifacts before drafting. Missing or invalid inputs: ${artifactList}.`
    };
  }

  return {
    bundle: {
      runTitle: run.title,
      topic: run.topic,
      objectiveMetric: run.objectiveMetric,
      constraints: run.constraints,
      paperSummaries,
      evidenceRows,
      hypotheses,
      corpus,
      experimentPlan,
      resultAnalysis,
      reviewContext
    },
    report,
    error: ""
  };
}

function parseReviewContext(
  reviewDecisionRaw: string,
  reviewFindingsRaw: string
): PaperWritingBundle["reviewContext"] | undefined {
  if (!reviewDecisionRaw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(reviewDecisionRaw) as {
      outcome?: unknown;
      summary?: unknown;
      required_actions?: unknown;
    };
    if (typeof parsed.outcome !== "string" || typeof parsed.summary !== "string") {
      return undefined;
    }

    const topFindings = reviewFindingsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const finding = JSON.parse(line) as { title?: unknown; detail?: unknown };
          const title = typeof finding.title === "string" ? finding.title.trim() : "";
          const detail = typeof finding.detail === "string" ? finding.detail.trim() : "";
          return title && detail ? `${title}: ${detail}` : title || detail;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .slice(0, 4);

    return {
      outcome: parsed.outcome,
      summary: parsed.summary,
      requiredActions: Array.isArray(parsed.required_actions)
        ? parsed.required_actions.filter((item): item is string => typeof item === "string").slice(0, 4)
        : [],
      topFindings
    };
  } catch {
    return undefined;
  }
}

function describeValidationRepair(report: PaperDraftValidationRepairReport): string {
  if (!report.attempted) {
    return "";
  }
  if (report.applied) {
    return ` after one automatic validation repair (${report.initial_warning_count} -> ${report.final_warning_count})`;
  }
  if (report.error) {
    return ` after one failed validation repair attempt`;
  }
  return ` after one discarded validation repair attempt`;
}

function shouldAttemptValidationRepair(validation: {
  issues: Array<{ message: string }>;
}): boolean {
  return (
    validation.issues.length >= VALIDATION_REPAIR_WARNING_THRESHOLD &&
    validation.issues.some((issue) => isValidationRepairableIssue(issue.message))
  );
}

function isValidationRepairableIssue(message: string): boolean {
  return /\bborrowed\b/iu.test(message);
}

async function loadObjectiveEvaluation(
  runContextMemory: RunContextMemory,
  runId: string
): Promise<ObjectiveMetricEvaluation | undefined> {
  const cached = await runContextMemory.get<ObjectiveMetricEvaluation>("objective_metric.last_evaluation");
  if (cached) {
    return cached;
  }
  try {
    const raw = await safeRead(`.autolabos/runs/${runId}/objective_evaluation.json`);
    return raw ? (JSON.parse(raw) as ObjectiveMetricEvaluation) : undefined;
  } catch {
    return undefined;
  }
}

async function readRequiredRunArtifact(
  filePath: string,
  artifact: string,
  issues: PaperInputValidationIssue[]
): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      issues.push({
        artifact,
        path: filePath,
        reason: "file is empty"
      });
      return undefined;
    }
    return raw;
  } catch (error) {
    issues.push({
      artifact,
      path: filePath,
      reason: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

async function maybeBuildPaperPdf(input: {
  deps: NodeExecutionDeps;
  sessions: PaperWriterSessionManager;
  run: Parameters<GraphNodeHandler["execute"]>[0]["run"];
  abortSignal?: AbortSignal;
  emitLog: (text: string) => void;
  publicPaperDir: string;
}): Promise<PaperCompileResult> {
  const buildPdf = input.deps.config?.paper?.build_pdf === true;
  if (!buildPdf) {
    return {
      enabled: false,
      status: "skipped",
      repaired: false,
      toolCallsUsed: 0,
      attempts: [],
      warnings: []
    };
  }

  const runPaperDir = path.join(".autolabos", "runs", input.run.id, "paper");
  const compileWarnings: string[] = [];
  const attempts: PaperCompileAttempt[] = [];
  let toolCallsUsed = 0;
  let repaired = false;
  let repairError: string | undefined;

  input.emitLog("PDF build is enabled; starting LaTeX compilation.");

  const firstAttempt = await runLatexCompileAttempt({
    deps: input.deps,
    runId: input.run.id,
    paperDir: runPaperDir,
    attempt: 1,
    repaired: false,
    abortSignal: input.abortSignal,
    emitLog: input.emitLog
  });
  attempts.push(firstAttempt.attempt);
  compileWarnings.push(...firstAttempt.attempt.warnings);
  toolCallsUsed += firstAttempt.toolCallsUsed;

  let finalAttempt = firstAttempt.attempt;
  if (firstAttempt.ok) {
    await finalizeCompiledArtifacts(runPaperDir, input.publicPaperDir, finalAttempt);
    const pdfPath = path.join(runPaperDir, "main.pdf");
    const buildLogPath = path.join(runPaperDir, "build.log");
    const report: PaperCompileResult = {
      enabled: true,
      status: "success",
      repaired: false,
      toolCallsUsed,
      attempts,
      warnings: compileWarnings,
      pdf_path: pdfPath,
      build_log_path: buildLogPath
    };
    await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  if (!firstAttempt.repairable) {
    input.emitLog(`LaTeX compilation failed without repair attempt: ${firstAttempt.attempt.error || "unknown error"}`);
    const report: PaperCompileResult = {
      enabled: true,
      status: "failed",
      repaired: false,
      toolCallsUsed,
      attempts,
      warnings: compileWarnings,
      build_log_path: path.join(runPaperDir, "build.log")
    };
    await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const texPath = path.join(runPaperDir, "main.tex");
  const currentTex = await safeRead(texPath);
  const buildLog = await safeRead(firstAttempt.attempt.build_log_path);
  const repair = await input.sessions.repairLatex({
    run: input.run,
    tex: currentTex,
    buildLog,
    abortSignal: input.abortSignal
  });
  if (repair.tex) {
    repaired = true;
    await fs.writeFile(texPath, repair.tex, "utf8");
    await fs.writeFile(path.join(input.publicPaperDir, "main.tex"), repair.tex, "utf8");
    input.emitLog("Applied one automatic LaTeX repair pass and retrying PDF compilation.");
    const secondAttempt = await runLatexCompileAttempt({
      deps: input.deps,
      runId: input.run.id,
      paperDir: runPaperDir,
      attempt: 2,
      repaired: true,
      abortSignal: input.abortSignal,
      emitLog: input.emitLog
    });
    attempts.push(secondAttempt.attempt);
    compileWarnings.push(...secondAttempt.attempt.warnings);
    toolCallsUsed += secondAttempt.toolCallsUsed;
    finalAttempt = secondAttempt.attempt;
    if (secondAttempt.ok) {
      await finalizeCompiledArtifacts(runPaperDir, input.publicPaperDir, finalAttempt);
      const pdfPath = path.join(runPaperDir, "main.pdf");
      const buildLogPath = path.join(runPaperDir, "build.log");
      const report: PaperCompileResult = {
        enabled: true,
        status: "repaired_success",
        repaired: true,
        toolCallsUsed,
        attempts,
        warnings: compileWarnings,
        pdf_path: pdfPath,
        build_log_path: buildLogPath
      };
      await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    repairError = secondAttempt.attempt.error;
  } else {
    repairError = repair.error || "latex repair produced no replacement source";
    input.emitLog(`Automatic LaTeX repair failed: ${repairError}`);
  }

  const report: PaperCompileResult = {
    enabled: true,
    status: "failed",
    repaired,
    toolCallsUsed,
    attempts,
    warnings: compileWarnings,
    build_log_path: path.join(runPaperDir, "build.log"),
    repair_error: repairError
  };
  await writeRunArtifact(input.run, "paper/compile_report.json", `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function runLatexCompileAttempt(input: {
  deps: NodeExecutionDeps;
  runId: string;
  paperDir: string;
  attempt: number;
  repaired: boolean;
  abortSignal?: AbortSignal;
  emitLog: (text: string) => void;
}): Promise<{ ok: boolean; repairable: boolean; toolCallsUsed: number; attempt: PaperCompileAttempt }> {
  const commands = [
    { step: "pdflatex-pass-1", command: "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex" },
    { step: "bibtex", command: "bibtex main", optional: true },
    { step: "pdflatex-pass-2", command: "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex" },
    { step: "pdflatex-pass-3", command: "pdflatex -interaction=nonstopmode -halt-on-error -file-line-error main.tex" }
  ];

  const results: PaperCompileCommandResult[] = [];
  const warnings: string[] = [];
  const logChunks: string[] = [];
  let repairable = true;

  for (const item of commands) {
    input.deps.eventStream.emit({
      type: "TOOL_CALLED",
      runId: input.runId,
      node: "write_paper",
      payload: {
        command: item.command,
        cwd: input.paperDir,
        source: "paper_pdf_build"
      }
    });
    const obs = await input.deps.aci.runCommand(item.command, input.paperDir, input.abortSignal);
    const result: PaperCompileCommandResult = {
      step: item.step,
      command: item.command,
      status: obs.status,
      exit_code: obs.exit_code,
      duration_ms: obs.duration_ms,
      optional: item.optional,
      stdout: obs.stdout,
      stderr: obs.stderr
    };
    results.push(result);
    logChunks.push(`$ ${item.command}`, obs.stdout || "", obs.stderr || "", "");

    if (obs.status !== "ok") {
      if (item.optional && isMissingBinaryObservation(obs)) {
        warnings.push(`${item.step} unavailable: ${(obs.stderr || "").trim() || "missing binary"}`);
        input.emitLog(`Optional LaTeX step "${item.step}" failed; continuing with warnings.`);
        continue;
      }
      input.deps.eventStream.emit({
        type: "TEST_FAILED",
        runId: input.runId,
        node: "write_paper",
        payload: {
          command: item.command,
          stderr: obs.stderr || `${item.step} failed`
        }
      });
      if (isMissingBinaryObservation(obs) || isPolicyBlockedObservation(obs)) {
        repairable = false;
      }
      const buildLogPath = path.join(input.paperDir, `build.attempt_${input.attempt}.log`);
      await fs.writeFile(buildLogPath, logChunks.join("\n"), "utf8");
      await fs.writeFile(path.join(input.paperDir, "build.log"), logChunks.join("\n"), "utf8");
      return {
        ok: false,
        repairable,
        toolCallsUsed: results.length,
        attempt: {
          attempt: input.attempt,
          repaired: input.repaired,
          status: "failed",
          commands: results,
          warnings,
          error: obs.stderr || `${item.step} failed`,
          build_log_path: buildLogPath,
          pdf_exists: await fileExists(path.join(input.paperDir, "main.pdf"))
        }
      };
    }
  }

  const buildLogPath = path.join(input.paperDir, `build.attempt_${input.attempt}.log`);
  await fs.writeFile(buildLogPath, logChunks.join("\n"), "utf8");
  await fs.writeFile(path.join(input.paperDir, "build.log"), logChunks.join("\n"), "utf8");
  const pdfExists = await fileExists(path.join(input.paperDir, "main.pdf"));
  if (!pdfExists) {
    return {
      ok: false,
      repairable: true,
      toolCallsUsed: results.length,
      attempt: {
        attempt: input.attempt,
        repaired: input.repaired,
        status: "failed",
        commands: results,
        warnings,
        error: "pdflatex sequence completed without producing main.pdf",
        build_log_path: buildLogPath,
        pdf_exists: false
      }
    };
  }

  return {
    ok: true,
    repairable: true,
    toolCallsUsed: results.length,
    attempt: {
      attempt: input.attempt,
      repaired: input.repaired,
      status: "success",
      commands: results,
      warnings,
      build_log_path: buildLogPath,
      pdf_exists: true
    }
  };
}

async function finalizeCompiledArtifacts(
  runPaperDir: string,
  publicPaperDir: string,
  attempt: PaperCompileAttempt
): Promise<void> {
  const pdfPath = path.join(runPaperDir, "main.pdf");
  const publicPdfPath = path.join(publicPaperDir, "main.pdf");
  const buildLogSource = attempt.build_log_path;
  const publicBuildLogPath = path.join(publicPaperDir, "build.log");
  if (await fileExists(pdfPath)) {
    await fs.copyFile(pdfPath, publicPdfPath);
  }
  if (await fileExists(buildLogSource)) {
    await fs.copyFile(buildLogSource, path.join(runPaperDir, "build.log"));
    await fs.copyFile(buildLogSource, publicBuildLogPath);
  }
}

function describeCompileStatus(result: PaperCompileResult): string {
  switch (result.status) {
    case "success":
      return "built successfully";
    case "repaired_success":
      return "built successfully after one automatic repair";
    case "failed":
      return "build failed";
    default:
      return "build skipped";
  }
}

function buildCompileFailureError(result: PaperCompileResult): string {
  const latestAttempt = [...result.attempts].reverse().find((item) => item.status === "failed");
  const detail = (result.repair_error || latestAttempt?.error || "unknown LaTeX compilation error").trim();
  const normalizedDetail = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  const buildLogHint = result.build_log_path ? ` See ${result.build_log_path}.` : "";
  return `write_paper generated LaTeX artifacts but the configured PDF build failed: ${normalizedDetail}${buildLogHint}`;
}

function isMissingBinaryObservation(obs: { stderr?: string; exit_code?: number }): boolean {
  const text = `${obs.stderr || ""}`.toLowerCase();
  return obs.exit_code === 127 || text.includes("not found") || text.includes("enoent");
}

function isPolicyBlockedObservation(obs: { exit_code?: number; stderr?: string }): boolean {
  return obs.exit_code === 126 && `${obs.stderr || ""}`.includes("Policy blocked");
}
