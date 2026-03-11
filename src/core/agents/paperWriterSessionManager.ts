import { AppConfig, RunRecord } from "../../types.js";
import { EventStream } from "../events.js";
import { LLMClient } from "../llm/client.js";
import { RunStore } from "../runs/runStore.js";
import { CodexCliClient } from "../../integrations/codex/codexCliClient.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import {
  buildSuggestedPaperTitle,
  buildFallbackPaperDraft,
  buildPaperWriterPrompt,
  choosePaperTitle,
  PaperDraft,
  PaperDraftValidationIssue,
  PaperWritingBundle,
  parsePaperDraftJson,
  normalizePaperDraft
} from "../analysis/paperWriting.js";
import {
  buildFallbackPaperManuscript,
  buildPaperPolishPrompt,
  PaperManuscript,
  parsePaperManuscriptJson,
  normalizePaperManuscript
} from "../analysis/paperManuscript.js";
import { ConstraintProfile } from "../runConstraints.js";
import { ObjectiveMetricEvaluation, ObjectiveMetricProfile } from "../objectiveMetric.js";
import { mapCodexEventToAutoLabOSEvents } from "../../integrations/codex/codexEventMapper.js";
import { createPaperWriterRole } from "./roles/paperWriter.js";
import { createReviewerRole } from "./roles/reviewer.js";
import { writeRunArtifact } from "../nodes/helpers.js";

interface PaperWriterOutline {
  title: string;
  abstract_focus: string[];
  section_headings: string[];
  key_claim_themes: string[];
  citation_plan: string[];
}

interface PaperWriterReview {
  summary: string;
  revision_notes: string[];
  unsupported_claims: Array<{ claim_id: string; reason: string }>;
  missing_sections: string[];
  missing_citations: string[];
}

interface SessionTraceEntry {
  stage: "outline" | "draft" | "review" | "finalize" | "polish" | "validation_repair";
  mode: "codex_session" | "staged_llm";
  threadId?: string;
  fallbackUsed: boolean;
  startedAt: string;
  completedAt: string;
  preview: string;
  error?: string;
}

export interface PaperWriterSessionResult {
  draft: PaperDraft;
  manuscript: PaperManuscript;
  source: "codex_session" | "staged_llm" | "fallback";
  threadId?: string;
  outline: PaperWriterOutline;
  review: PaperWriterReview;
  trace: SessionTraceEntry[];
  stageFallbacks: number;
  errors: string[];
}

export interface PaperWriterValidationRepairResult {
  attempted: boolean;
  applied: boolean;
  draft: PaperDraft;
  source: "codex_session" | "staged_llm" | "fallback";
  threadId?: string;
  error?: string;
}

interface PaperWriterSessionDeps {
  config: AppConfig;
  codex: CodexCliClient;
  llm: LLMClient;
  eventStream: EventStream;
  runStore: RunStore;
  workspaceRoot: string;
}

interface PaperWriterSessionInput {
  run: RunRecord;
  bundle: PaperWritingBundle;
  constraintProfile: ConstraintProfile;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  abortSignal?: AbortSignal;
}

export interface LatexRepairResult {
  tex?: string;
  threadId?: string;
  source: "codex_session" | "staged_llm";
  error?: string;
}

export class PaperWriterSessionManager {
  private readonly writerRole;
  private readonly reviewerRole;

  constructor(private readonly deps: PaperWriterSessionDeps) {
    this.writerRole = createPaperWriterRole(deps.llm);
    this.reviewerRole = createReviewerRole(deps.llm);
  }

  async run(input: PaperWriterSessionInput): Promise<PaperWriterSessionResult> {
    const runContext = new RunContextMemory(input.run.memoryRefs.runContextPath);
    let activeThreadId =
      input.run.nodeThreads.write_paper ||
      (await runContext.get<string>("write_paper.thread_id"));
    const useCodexSession =
      typeof this.deps.codex?.runTurnStream === "function" &&
      this.deps.config?.providers?.llm_mode !== "openai_api";
    const mode: "codex_session" | "staged_llm" = useCodexSession ? "codex_session" : "staged_llm";
    const trace: SessionTraceEntry[] = [];
    const errors: string[] = [];
    let stageFallbacks = 0;

    this.emit(input.run, `Paper writer session starting in ${mode} mode.`);

    let outline = buildFallbackOutline(input.bundle);
    const outlineStage = await this.runStage({
      run: input.run,
      runContext,
      stage: "outline",
      mode,
      threadId: activeThreadId,
      systemPrompt: buildRoleSystemPrompt("paper_writer", this.writerRole.sop),
      prompt: buildOutlinePrompt(input.bundle),
      agentRole: "paper_writer",
      abortSignal: input.abortSignal,
      trace
    });
    activeThreadId = outlineStage.threadId || activeThreadId;
    if (outlineStage.text) {
      try {
        outline = normalizeOutline(parseJsonObject(outlineStage.text), input.bundle);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`outline: ${message}`);
        stageFallbacks += 1;
        this.attachTraceError(trace, "outline", message);
      }
    } else {
      stageFallbacks += 1;
    }
    await this.persistStageArtifacts(input.run, "outline", outline, outlineStage.text);

    let draft = buildFallbackPaperDraft(input.bundle);
    const draftStage = await this.runStage({
      run: input.run,
      runContext,
      stage: "draft",
      mode,
      threadId: activeThreadId,
      systemPrompt: buildRoleSystemPrompt("paper_writer", this.writerRole.sop),
      prompt: buildDraftPrompt({
        bundle: input.bundle,
        constraintProfile: input.constraintProfile,
        objectiveMetricProfile: input.objectiveMetricProfile,
        objectiveEvaluation: input.objectiveEvaluation,
        outline
      }),
      agentRole: "paper_writer",
      abortSignal: input.abortSignal,
      trace
    });
    activeThreadId = draftStage.threadId || activeThreadId;
    if (draftStage.text) {
      try {
        draft = normalizePaperDraft({
          raw: parsePaperDraftJson(draftStage.text),
          bundle: input.bundle
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`draft: ${message}`);
        stageFallbacks += 1;
        this.attachTraceError(trace, "draft", message);
      }
    } else {
      stageFallbacks += 1;
    }
    await this.persistStageArtifacts(input.run, "draft", draft, draftStage.text);

    let review = buildFallbackReview(draft);
    const reviewStage = await this.runStage({
      run: input.run,
      runContext,
      stage: "review",
      mode,
      threadId: activeThreadId,
      systemPrompt: buildRoleSystemPrompt("reviewer", this.reviewerRole.sop),
      prompt: buildReviewPrompt({
        bundle: input.bundle,
        draft,
        outline
      }),
      agentRole: "reviewer",
      abortSignal: input.abortSignal,
      trace
    });
    activeThreadId = reviewStage.threadId || activeThreadId;
    if (reviewStage.text) {
      try {
        review = normalizeReview(parseJsonObject(reviewStage.text), draft);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`review: ${message}`);
        stageFallbacks += 1;
        this.attachTraceError(trace, "review", message);
      }
    } else {
      stageFallbacks += 1;
    }
    await this.persistStageArtifacts(input.run, "review", review, reviewStage.text);

    let finalDraft = draft;
    const finalStage = await this.runStage({
      run: input.run,
      runContext,
      stage: "finalize",
      mode,
      threadId: activeThreadId,
      systemPrompt: buildRoleSystemPrompt("paper_writer", this.writerRole.sop),
      prompt: buildRevisionPrompt({
        bundle: input.bundle,
        constraintProfile: input.constraintProfile,
        objectiveMetricProfile: input.objectiveMetricProfile,
        objectiveEvaluation: input.objectiveEvaluation,
        outline,
        draft,
        review
      }),
      agentRole: "paper_writer",
      abortSignal: input.abortSignal,
      trace
    });
    activeThreadId = finalStage.threadId || activeThreadId;
    if (finalStage.text) {
      try {
        finalDraft = normalizePaperDraft({
          raw: parsePaperDraftJson(finalStage.text),
          bundle: input.bundle
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`finalize: ${message}`);
        stageFallbacks += 1;
        this.attachTraceError(trace, "finalize", message);
      }
    } else {
      stageFallbacks += 1;
    }
    await this.persistStageArtifacts(input.run, "finalize", finalDraft, finalStage.text);

    let manuscript = buildFallbackPaperManuscript({
      draft: finalDraft,
      resultAnalysis: input.bundle.resultAnalysis,
      objectiveEvaluation: input.objectiveEvaluation,
      objectiveMetricProfile: input.objectiveMetricProfile,
      experimentPlan: input.bundle.experimentPlan
    });
    const polishStage = await this.runStage({
      run: input.run,
      runContext,
      stage: "polish",
      mode,
      threadId: activeThreadId,
      systemPrompt: buildRoleSystemPrompt("paper_writer", this.writerRole.sop),
      prompt: buildPaperPolishPrompt({
        bundle: input.bundle,
        draft: finalDraft,
        constraintProfile: input.constraintProfile,
        objectiveMetricProfile: input.objectiveMetricProfile,
        objectiveEvaluation: input.objectiveEvaluation
      }),
      agentRole: "paper_writer",
      abortSignal: input.abortSignal,
      trace
    });
    activeThreadId = polishStage.threadId || activeThreadId;
    if (polishStage.text) {
      try {
        manuscript = normalizePaperManuscript({
          raw: parsePaperManuscriptJson(polishStage.text),
          draft: finalDraft,
          runTitle: input.bundle.runTitle,
          resultAnalysis: input.bundle.resultAnalysis,
          objectiveEvaluation: input.objectiveEvaluation,
          objectiveMetricProfile: input.objectiveMetricProfile,
          experimentPlan: input.bundle.experimentPlan
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`polish: ${message}`);
        stageFallbacks += 1;
        this.attachTraceError(trace, "polish", message);
      }
    } else {
      stageFallbacks += 1;
    }
    await this.persistPolishArtifacts(input.run, manuscript, polishStage.text);

    await writeRunArtifact(input.run, "paper/session_trace.json", `${JSON.stringify(trace, null, 2)}\n`);
    await runContext.put("write_paper.thread_id", activeThreadId || null);
    await runContext.put("write_paper.session_outline", outline);
    await runContext.put("write_paper.session_review", review);
    await runContext.put("write_paper.session_manuscript", manuscript);
    await runContext.put("write_paper.session_trace", trace);
    await runContext.put("write_paper.session_errors", errors);
    await runContext.put("write_paper.stage_fallbacks", stageFallbacks);
    await this.persistThreadToRunStore(input.run, activeThreadId);

    this.emit(
      input.run,
      `Paper writer session completed with ${stageFallbacks} stage fallback(s).`
    );

    return {
      draft: finalDraft,
      manuscript,
      source:
        mode === "codex_session"
          ? "codex_session"
          : stageFallbacks < 5
            ? "staged_llm"
            : "fallback",
      threadId: activeThreadId,
      outline,
      review,
      trace,
      stageFallbacks,
      errors
    };
  }

  async repairLatex(input: {
    run: RunRecord;
    tex: string;
    buildLog: string;
    abortSignal?: AbortSignal;
  }): Promise<LatexRepairResult> {
    const runContext = new RunContextMemory(input.run.memoryRefs.runContextPath);
    let activeThreadId =
      input.run.nodeThreads.write_paper ||
      (await runContext.get<string>("write_paper.thread_id"));
    const useCodexSession =
      typeof this.deps.codex?.runTurnStream === "function" &&
      this.deps.config?.providers?.llm_mode !== "openai_api";
    const mode: "codex_session" | "staged_llm" = useCodexSession ? "codex_session" : "staged_llm";

    this.emit(input.run, `Paper writer LaTeX repair started in ${mode} mode.`);

    try {
      let text = "";
      if (mode === "codex_session") {
        const result = await this.deps.codex.runTurnStream({
          prompt: buildLatexRepairPrompt(input.tex, input.buildLog),
          threadId: activeThreadId,
          agentId: `paper_writer:${input.run.id}`,
          systemPrompt: buildLatexRepairSystemPrompt(this.writerRole.sop),
          sandboxMode: "read-only",
          approvalPolicy: "never",
          workingDirectory: this.deps.workspaceRoot,
          abortSignal: input.abortSignal,
          onEvent: (event) => {
            const mapped = mapCodexEventToAutoLabOSEvents({
              event,
              runId: input.run.id,
              node: "write_paper",
              agentRole: "paper_writer",
              workspaceRoot: this.deps.workspaceRoot
            });
            for (const item of mapped) {
              this.deps.eventStream.emit(item);
            }
          }
        });
        text = result.finalText;
        activeThreadId = result.threadId || activeThreadId;
      } else {
        const completion = await this.deps.llm.complete(buildLatexRepairPrompt(input.tex, input.buildLog), {
          systemPrompt: buildLatexRepairSystemPrompt(this.writerRole.sop),
          abortSignal: input.abortSignal,
          onProgress: (event) => {
            const line = event.text.trim();
            if (line) {
              this.emit(input.run, event.type === "delta" ? `LLM> ${line}` : line);
            }
          }
        });
        text = completion.text;
      }

      const repairedTex = extractLatexResponse(text);
      await writeRunArtifact(input.run, "paper/latex_repair.raw.txt", `${text}\n`);
      await writeRunArtifact(input.run, "paper/latex_repair.tex", repairedTex);
      await runContext.put("write_paper.thread_id", activeThreadId || null);
      await runContext.put("write_paper.latex_repair_preview", previewText(repairedTex));
      await this.persistThreadToRunStore(input.run, activeThreadId);
      this.emit(input.run, "Paper writer LaTeX repair completed.");
      return {
        tex: repairedTex,
        threadId: activeThreadId,
        source: mode
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunArtifact(input.run, "paper/latex_repair.raw.txt", `${message}\n`);
      this.emit(input.run, `Paper writer LaTeX repair failed: ${message}`);
      return {
        threadId: activeThreadId,
        source: mode,
        error: message
      };
    }
  }

  async reviseAfterValidation(input: {
    run: RunRecord;
    bundle: PaperWritingBundle;
    constraintProfile: ConstraintProfile;
    objectiveMetricProfile: ObjectiveMetricProfile;
    objectiveEvaluation?: ObjectiveMetricEvaluation;
    outline: PaperWriterOutline;
    draft: PaperDraft;
    review: PaperWriterReview;
    validationIssues: PaperDraftValidationIssue[];
    abortSignal?: AbortSignal;
  }): Promise<PaperWriterValidationRepairResult> {
    const runContext = new RunContextMemory(input.run.memoryRefs.runContextPath);
    let activeThreadId =
      input.run.nodeThreads.write_paper ||
      (await runContext.get<string>("write_paper.thread_id"));
    const useCodexSession =
      typeof this.deps.codex?.runTurnStream === "function" &&
      this.deps.config?.providers?.llm_mode !== "openai_api";
    const mode: "codex_session" | "staged_llm" = useCodexSession ? "codex_session" : "staged_llm";
    const trace = (await runContext.get<SessionTraceEntry[]>("write_paper.session_trace")) || [];

    if (input.validationIssues.length === 0) {
      return {
        attempted: false,
        applied: false,
        draft: input.draft,
        source: mode
      };
    }

    this.emit(
      input.run,
      `Paper writer validation repair started in ${mode} mode for ${input.validationIssues.length} warning(s).`
    );

    try {
      const mergedReview = mergeReviewWithValidationIssues(input.review, input.validationIssues);
      const repairStage = await this.runStage({
        run: input.run,
        runContext,
        stage: "validation_repair",
        mode,
        threadId: activeThreadId,
        systemPrompt: buildRoleSystemPrompt("paper_writer", this.writerRole.sop),
        prompt: buildRevisionPrompt({
          bundle: input.bundle,
          constraintProfile: input.constraintProfile,
          objectiveMetricProfile: input.objectiveMetricProfile,
          objectiveEvaluation: input.objectiveEvaluation,
          outline: input.outline,
          draft: input.draft,
          review: mergedReview,
          validationIssues: input.validationIssues
        }),
        agentRole: "paper_writer",
        abortSignal: input.abortSignal,
        trace
      });
      activeThreadId = repairStage.threadId || activeThreadId;
      const repairedDraft = repairStage.text
        ? normalizePaperDraft({
            raw: parsePaperDraftJson(repairStage.text),
            bundle: input.bundle
          })
        : input.draft;
      await this.persistStageArtifacts(
        input.run,
        "validation_repair",
        repairedDraft,
        repairStage.text
      );
      await writeRunArtifact(input.run, "paper/session_trace.json", `${JSON.stringify(trace, null, 2)}\n`);
      await runContext.put("write_paper.thread_id", activeThreadId || null);
      await runContext.put("write_paper.session_trace", trace);
      await this.persistThreadToRunStore(input.run, activeThreadId);
      this.emit(input.run, "Paper writer validation repair completed.");
      return {
        attempted: true,
        applied: true,
        draft: repairedDraft,
        source: mode,
        threadId: activeThreadId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeRunArtifact(input.run, "paper/validation_repair.raw.txt", `${message}\n`);
      this.emit(input.run, `Paper writer validation repair failed: ${message}`);
      return {
        attempted: true,
        applied: false,
        draft: input.draft,
        source: "fallback",
        threadId: activeThreadId,
        error: message
      };
    }
  }

  private async runStage(input: {
    run: RunRecord;
    runContext: RunContextMemory;
    stage: "outline" | "draft" | "review" | "finalize" | "polish" | "validation_repair";
    mode: "codex_session" | "staged_llm";
    threadId?: string;
    systemPrompt: string;
    prompt: string;
    agentRole: "paper_writer" | "reviewer";
    abortSignal?: AbortSignal;
    trace?: SessionTraceEntry[];
  }): Promise<{ text: string; threadId?: string }> {
    const startedAt = new Date().toISOString();
    this.emit(input.run, `Paper writer stage "${input.stage}" started.`);

    if (input.mode === "codex_session") {
      const result = await this.deps.codex.runTurnStream({
        prompt: input.prompt,
        threadId: input.threadId,
        agentId: `${input.agentRole}:${input.run.id}`,
        systemPrompt: input.systemPrompt,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        workingDirectory: this.deps.workspaceRoot,
        abortSignal: input.abortSignal,
        onEvent: (event) => {
          const mapped = mapCodexEventToAutoLabOSEvents({
            event,
            runId: input.run.id,
            node: "write_paper",
            agentRole: input.agentRole,
            workspaceRoot: this.deps.workspaceRoot
          });
          for (const item of mapped) {
            this.deps.eventStream.emit(item);
          }
        }
      });
      const completedAt = new Date().toISOString();
      input.trace?.push({
        stage: input.stage,
        mode: input.mode,
        threadId: result.threadId || input.threadId,
        fallbackUsed: false,
        startedAt,
        completedAt,
        preview: previewText(result.finalText)
      });
      this.emit(input.run, `Paper writer stage "${input.stage}" completed.`);
      return {
        text: result.finalText,
        threadId: result.threadId || input.threadId
      };
    }

    const completion = await this.deps.llm.complete(input.prompt, {
      systemPrompt: input.systemPrompt,
      abortSignal: input.abortSignal,
      onProgress: (event) => {
        const text = event.text.trim();
        if (!text) {
          return;
        }
        this.emit(input.run, event.type === "delta" ? `LLM> ${text}` : text);
      }
    });
    const completedAt = new Date().toISOString();
    input.trace?.push({
      stage: input.stage,
      mode: input.mode,
      threadId: input.threadId,
      fallbackUsed: false,
      startedAt,
      completedAt,
      preview: previewText(completion.text)
    });
    this.emit(input.run, `Paper writer stage "${input.stage}" completed.`);
    return {
      text: completion.text,
      threadId: input.threadId
    };
  }

  private async persistStageArtifacts(
    run: RunRecord,
    stage: "outline" | "draft" | "review" | "finalize" | "validation_repair",
    parsed: unknown,
    rawText: string
  ): Promise<void> {
    await writeRunArtifact(run, `paper/${stage}.json`, `${JSON.stringify(parsed, null, 2)}\n`);
    await writeRunArtifact(run, `paper/${stage}.raw.txt`, `${rawText || ""}\n`);
  }

  private async persistPolishArtifacts(
    run: RunRecord,
    manuscript: PaperManuscript,
    rawText: string
  ): Promise<void> {
    await writeRunArtifact(run, "paper/manuscript.session.json", `${JSON.stringify(manuscript, null, 2)}\n`);
    await writeRunArtifact(run, "paper/polish.raw.txt", `${rawText || ""}\n`);
  }

  private async persistThreadToRunStore(run: RunRecord, threadId: string | undefined): Promise<void> {
    if (!threadId) {
      return;
    }
    if (
      typeof this.deps.runStore?.getRun !== "function" ||
      typeof this.deps.runStore?.updateRun !== "function"
    ) {
      return;
    }
    const latestRun = (await this.deps.runStore.getRun(run.id)) || run;
    if (latestRun.nodeThreads.write_paper === threadId) {
      return;
    }
    latestRun.nodeThreads.write_paper = threadId;
    await this.deps.runStore.updateRun(latestRun);
  }

  private attachTraceError(
    trace: SessionTraceEntry[],
    stage: SessionTraceEntry["stage"],
    error: string
  ): void {
    const entry = [...trace].reverse().find((item) => item.stage === stage);
    if (entry) {
      entry.fallbackUsed = true;
      entry.error = error;
    }
  }

  private emit(run: RunRecord, text: string): void {
    this.deps.eventStream.emit({
      type: "OBS_RECEIVED",
      runId: run.id,
      node: "write_paper",
      payload: { text }
    });
  }
}

function buildRoleSystemPrompt(
  roleId: "paper_writer" | "reviewer",
  sop: string[]
): string {
  return [
    `Role: ${roleId}`,
    "Follow SOP:",
    ...sop.map((step, index) => `${index + 1}. ${step}`),
    "Return JSON only."
  ].join("\n");
}

function buildLatexRepairSystemPrompt(sop: string[]): string {
  return [
    "Role: paper_writer",
    "Task: repair a LaTeX document so that it compiles.",
    "Preserve the paper's claims, human-facing prose, and bibliography structure.",
    "Do not add new experimental results.",
    "Return the full corrected LaTeX source only.",
    "Relevant SOP:",
    ...sop.map((step, index) => `${index + 1}. ${step}`)
  ].join("\n");
}

function buildOutlinePrompt(bundle: PaperWritingBundle): string {
  const fallbackDraft = buildFallbackPaperDraft(bundle);
  return [
    "Return one JSON object with this shape:",
    "{",
    '  "title": "string",',
    '  "abstract_focus": ["string"],',
    '  "section_headings": ["Introduction", "Related Work", "Method", "Results", "Conclusion"],',
    '  "key_claim_themes": ["string"],',
    '  "citation_plan": ["string"]',
    "}",
    "",
    "Base the outline only on the provided workflow outputs.",
    `Workflow run title (context only, do not copy literally as the paper title): ${bundle.runTitle}`,
    `Topic: ${bundle.topic}`,
    `Objective metric: ${bundle.objectiveMetric}`,
    `Constraints: ${bundle.constraints.join(", ") || "none"}`,
    `Related-work scout papers: ${bundle.relatedWorkScout?.papers.length || 0}`,
    `Suggested paper title: ${buildSuggestedPaperTitle(bundle)}`,
    `Fallback section order: ${fallbackDraft.sections.map((item) => item.heading).join(", ")}`
  ].join("\n");
}

function buildLatexRepairPrompt(tex: string, buildLog: string): string {
  return [
    "Repair the following LaTeX document using the compile log.",
    "Return the full corrected LaTeX source only.",
    "",
    "Compile log:",
    buildLog,
    "",
    "Current LaTeX:",
    tex
  ].join("\n");
}

function buildDraftPrompt(input: {
  bundle: PaperWritingBundle;
  constraintProfile: ConstraintProfile;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  outline: PaperWriterOutline;
}): string {
  return [
    buildPaperWriterPrompt({
      bundle: input.bundle,
      constraintProfile: input.constraintProfile,
      objectiveMetricProfile: input.objectiveMetricProfile,
      objectiveEvaluation: input.objectiveEvaluation
    }),
    "",
    "Outline JSON:",
    JSON.stringify(input.outline, null, 2),
    "",
    "Write the first complete structured paper draft JSON."
  ].join("\n");
}

function buildReviewPrompt(input: {
  bundle: PaperWritingBundle;
  outline: PaperWriterOutline;
  draft: PaperDraft;
}): string {
  return [
    "Review the structured paper draft for unsupported claims, missing sections, weak evidence links, and text that would read like a system log instead of a paper.",
    "Return one JSON object with this shape:",
    "{",
    '  "summary": "string",',
    '  "revision_notes": ["string"],',
    '  "unsupported_claims": [{"claim_id": "c1", "reason": "string"}],',
    '  "missing_sections": ["string"],',
    '  "missing_citations": ["string"]',
    "}",
    "",
    "Flag any section that relies on log-speak, repeated template phrasing, inline evidence IDs, internal paths, or debug-style headings.",
    "The final manuscript should not use the headings Research Context, Writing Constraints, Results Overview, or Claim Trace.",
    "",
    `Topic: ${input.bundle.topic}`,
    `Objective metric: ${input.bundle.objectiveMetric}`,
    "Outline JSON:",
    JSON.stringify(input.outline, null, 2),
    "",
    "Draft JSON:",
    JSON.stringify(input.draft, null, 2),
    "",
    "Review context JSON:",
    JSON.stringify(input.bundle.reviewContext || {}, null, 2)
  ].join("\n");
}

function buildRevisionPrompt(input: {
  bundle: PaperWritingBundle;
  constraintProfile: ConstraintProfile;
  objectiveMetricProfile: ObjectiveMetricProfile;
  objectiveEvaluation?: ObjectiveMetricEvaluation;
  outline: PaperWriterOutline;
  draft: PaperDraft;
  review: PaperWriterReview;
  validationIssues?: PaperDraftValidationIssue[];
}): string {
  return [
    buildPaperWriterPrompt({
      bundle: input.bundle,
      constraintProfile: input.constraintProfile,
      objectiveMetricProfile: input.objectiveMetricProfile,
      objectiveEvaluation: input.objectiveEvaluation
    }),
    "",
    "Outline JSON:",
    JSON.stringify(input.outline, null, 2),
    "",
    "Current draft JSON:",
    JSON.stringify(input.draft, null, 2),
    "",
    "Reviewer JSON:",
    JSON.stringify(input.review, null, 2),
    "",
    ...(input.validationIssues?.length
      ? [
          "Validation issues JSON:",
          JSON.stringify(input.validationIssues, null, 2),
          "",
          "Address the validation issues directly.",
          "Do not invent new evidence IDs, paper IDs, or experimental results.",
          "If a statement lacks support, make it more conservative instead of overstating it.",
          ""
        ]
      : []),
    "Revise toward human-readable academic prose.",
    "Do not introduce log-speak, repeated template language, inline evidence IDs, internal paths, or the headings Research Context, Writing Constraints, Results Overview, or Claim Trace.",
    "Return the revised final structured paper draft JSON."
  ].join("\n");
}

function buildFallbackOutline(bundle: PaperWritingBundle): PaperWriterOutline {
  const fallbackDraft = buildFallbackPaperDraft(bundle);
  return {
    title: fallbackDraft.title,
    abstract_focus: [
      bundle.topic,
      bundle.objectiveMetric,
      bundle.resultAnalysis?.objective_metric?.evaluation?.summary || "Ground results in available evidence."
    ].filter(Boolean),
    section_headings: fallbackDraft.sections.map((item) => item.heading),
    key_claim_themes: fallbackDraft.claims.map((item) => item.statement).slice(0, 4),
    citation_plan: fallbackDraft.sections
      .flatMap((item) => item.citation_paper_ids)
      .filter(Boolean)
      .slice(0, 6)
  };
}

function buildFallbackReview(draft: PaperDraft): PaperWriterReview {
  return {
    summary: "Apply conservative revisions where evidence links are weak.",
    revision_notes: [
      "Keep unsupported statements tentative.",
      "Ensure each results claim names evidence or cited papers."
    ],
    unsupported_claims: [],
    missing_sections: [],
    missing_citations: draft.sections
      .filter((item) => item.evidence_ids.length > 0 && item.citation_paper_ids.length === 0)
      .map((item) => item.heading)
      .slice(0, 4)
  };
}

function normalizeOutline(raw: Record<string, unknown>, bundle: PaperWritingBundle): PaperWriterOutline {
  const fallback = buildFallbackOutline(bundle);
  const sectionHeadings = normalizeStringArray(raw.section_headings).slice(0, 6);
  return {
    title: choosePaperTitle({
      candidateTitle: raw.title,
      runTitle: bundle.runTitle,
      fallbackTitle: fallback.title
    }),
    abstract_focus: normalizeStringArray(raw.abstract_focus).slice(0, 6),
    section_headings: sectionHeadings.length > 0 ? sectionHeadings : fallback.section_headings,
    key_claim_themes: normalizeStringArray(raw.key_claim_themes).slice(0, 6),
    citation_plan: normalizeStringArray(raw.citation_plan).slice(0, 8)
  };
}

function normalizeReview(raw: Record<string, unknown>, draft: PaperDraft): PaperWriterReview {
  const unsupported = Array.isArray(raw.unsupported_claims)
    ? raw.unsupported_claims
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return undefined;
          }
          const value = item as Record<string, unknown>;
          const claimId = cleanString(value.claim_id);
          const reason = cleanString(value.reason);
          if (!claimId || !reason) {
            return undefined;
          }
          return { claim_id: claimId, reason };
        })
        .filter((item): item is { claim_id: string; reason: string } => Boolean(item))
        .slice(0, 8)
    : [];

  return {
    summary: cleanString(raw.summary) || "Review completed.",
    revision_notes: normalizeStringArray(raw.revision_notes).slice(0, 8),
    unsupported_claims: unsupported,
    missing_sections: normalizeStringArray(raw.missing_sections).slice(0, 6),
    missing_citations: normalizeStringArray(raw.missing_citations).slice(0, 6).length > 0
      ? normalizeStringArray(raw.missing_citations).slice(0, 6)
      : draft.sections
          .filter((item) => item.evidence_ids.length > 0 && item.citation_paper_ids.length === 0)
          .map((item) => item.heading)
          .slice(0, 6)
  };
}

function mergeReviewWithValidationIssues(
  review: PaperWriterReview,
  validationIssues: PaperDraftValidationIssue[]
): PaperWriterReview {
  const revisionNotes = normalizeStringArray([
    ...review.revision_notes,
    ...validationIssues.slice(0, 8).map((issue) => formatValidationIssueAsRevisionNote(issue))
  ]).slice(0, 10);
  const missingCitations = normalizeStringArray([
    ...review.missing_citations,
    ...validationIssues
      .filter((issue) => issue.citation_paper_ids.length === 0 || /citation/i.test(issue.message))
      .map((issue) => issue.section_heading || issue.claim_id || "")
      .filter(Boolean)
  ]).slice(0, 8);

  return {
    ...review,
    summary: review.summary
      ? `${review.summary} Resolve the validation warnings without inventing support.`
      : "Resolve the validation warnings without inventing support.",
    revision_notes: revisionNotes,
    missing_citations: missingCitations
  };
}

function formatValidationIssueAsRevisionNote(issue: PaperDraftValidationIssue): string {
  const scope =
    issue.kind === "claim"
      ? `claim ${issue.claim_id || "unknown"}`
      : issue.kind === "paragraph"
        ? `paragraph ${typeof issue.paragraph_index === "number" ? issue.paragraph_index + 1 : "unknown"} of ${issue.section_heading || "unknown section"}`
        : `section ${issue.section_heading || "unknown section"}`;
  return `${scope}: ${issue.message}`;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("json_object_not_found");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json_object_invalid");
  }
  return parsed;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))];
}

function previewText(text: string): string {
  return cleanString(text).slice(0, 220);
}

function extractLatexResponse(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:tex|latex)?\s*([\s\S]+?)```/iu)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("\\documentclass");
  const source = start >= 0 ? candidate.slice(start).trim() : candidate.trim();
  if (!source.includes("\\documentclass") || !source.includes("\\begin{document}") || !source.includes("\\end{document}")) {
    throw new Error("latex_repair_response_missing_full_document");
  }
  return `${source}\n`;
}
