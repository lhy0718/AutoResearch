import http, { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildCodexModelSelectionChoices,
  DEFAULT_CODEX_MODEL,
  getCurrentCodexModelSelectionValue,
  getReasoningEffortChoicesForModel
} from "../integrations/codex/modelCatalog.js";
import {
  buildOpenAiResponsesModelChoices,
  buildOpenAiResponsesReasoningChoices
} from "../integrations/openai/modelCatalog.js";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_RESEARCH_MODEL,
  DEFAULT_OLLAMA_EXPERIMENT_MODEL,
  DEFAULT_OLLAMA_VISION_MODEL,
  buildOllamaChatModelChoices,
  buildOllamaResearchModelChoices,
  buildOllamaExperimentModelChoices,
  buildOllamaVisionModelChoices
} from "../integrations/ollama/modelCatalog.js";
import {
  DEFAULT_CODEX_CHAT_SETUP_MODEL,
  DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT,
  DEFAULT_PRIMARY_LLM_MODE,
  getPdfAnalysisModeForConfig,
  ensureScaffold,
  hasOpenAiApiKey,
  resolveOpenAiApiKey,
  resolveSemanticScholarApiKey,
  resolveAppPaths,
  runNonInteractiveSetup
} from "../config.js";
import { runDoctorReport } from "../core/doctor.js";
import { writeRunLiteratureIndex } from "../core/literatureIndex.js";
import { readRepositoryKnowledgeIndex } from "../core/repositoryKnowledge.js";
import { buildRunJobsSnapshot } from "../core/runs/jobsProjection.js";
import { bootstrapAutoLabOSRuntime, AutoLabOSRuntime } from "../runtime/createRuntime.js";
import { GraphNodeId, PendingPlan, RunJobsSnapshot, RunRecord, WebSessionState } from "../types.js";
import { InteractionSession } from "../interaction/InteractionSession.js";
import { listRunArtifacts, readRunArtifact } from "./artifacts.js";
import {
  BootstrapResponse,
  ConfigSummary,
  DoctorResponse,
  KnowledgeFileResponse,
  KnowledgeResponse,
  LiteratureResponse,
  SessionInputResponse,
  WebConfigFormData,
  WebConfigOptions
} from "./contracts.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_DIST_DIR = path.join(PACKAGE_ROOT, "web", "dist");

interface WebServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
}

interface SetupRequestBody {
  projectName?: string;
  defaultTopic?: string;
  defaultConstraints?: string[];
  defaultObjectiveMetric?: string;
  llmMode?: "codex_chatgpt_only" | "openai_api" | "ollama";
  codexChatModelChoice?: string;
  codexChatReasoningEffort?: string;
  codexResearchBackendModelChoice?: string;
  codexResearchBackendReasoningEffort?: string;
  codexExperimentModelChoice?: string;
  codexExperimentReasoningEffort?: string;
  openAiChatModel?: string;
  openAiChatReasoningEffort?: string;
  openAiResearchBackendModel?: string;
  openAiResearchBackendReasoningEffort?: string;
  openAiExperimentModel?: string;
  openAiExperimentReasoningEffort?: string;
  ollamaBaseUrl?: string;
  ollamaChatModel?: string;
  ollamaResearchModel?: string;
  ollamaExperimentModel?: string;
  ollamaVisionModel?: string;
  networkPolicy?: "blocked" | "declared" | "required";
  networkPurpose?: "logging" | "artifact_upload" | "model_download" | "dataset_fetch" | "remote_inference" | "other" | "";
  semanticScholarApiKey?: string;
  openAiApiKey?: string;
}

interface JsonBody {
  [key: string]: unknown;
}

export async function runAutoLabOSWebServer(opts?: WebServerOptions): Promise<void> {
  const controller = new AutoLabOSWebController(opts);
  await controller.start();
}

class AutoLabOSWebController {
  private readonly cwd: string;
  private readonly host: string;
  private readonly port: number;
  private readonly paths;
  private runtime?: AutoLabOSRuntime;
  private session?: InteractionSession;
  private sessionUnsubscribe?: () => void;
  private eventUnsubscribe?: () => void;
  private readonly sseClients = new Set<ServerResponse>();

  constructor(opts?: WebServerOptions) {
    this.cwd = opts?.cwd || process.cwd();
    this.host = opts?.host || "127.0.0.1";
    this.port = opts?.port || 4317;
    this.paths = resolveAppPaths(this.cwd);
  }

  async start(): Promise<void> {
    const bootstrap = await bootstrapAutoLabOSRuntime({
      cwd: this.cwd,
      allowInteractiveSetup: false
    });
    if (bootstrap.runtime) {
      await this.attachRuntime(bootstrap.runtime);
    }

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    process.stdout.write(`AutoLabOS web UI: http://${this.host}:${this.port}\n`);
    await new Promise<void>(() => undefined);
  }

  private async attachRuntime(runtime: AutoLabOSRuntime): Promise<void> {
    this.runtime = runtime;
    this.session?.dispose();
    this.sessionUnsubscribe?.();
    this.eventUnsubscribe?.();

    const session = new InteractionSession({
      workspaceRoot: this.cwd,
      config: runtime.config,
      runStore: runtime.runStore,
      titleGenerator: runtime.titleGenerator,
      codex: runtime.codex,
      openAiTextClient: runtime.openAiTextClient,
      eventStream: runtime.eventStream,
      orchestrator: runtime.orchestrator,
      semanticScholarApiKeyConfigured: runtime.semanticScholarApiKeyConfigured
    });
    await session.start();
    this.session = session;
    this.sessionUnsubscribe = session.subscribe(() => {
      this.broadcast("session_state", session.snapshot());
    });
    this.eventUnsubscribe = runtime.eventStream.subscribe((event) => {
      this.broadcast("runtime_event", event);
    });
    this.broadcast("bootstrap", await this.buildBootstrapResponse());
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", `http://${req.headers.host || `${this.host}:${this.port}`}`);
      const pathname = url.pathname;

      if (pathname === "/api/bootstrap" && method === "GET") {
        return jsonResponse(res, 200, await this.buildBootstrapResponse());
      }

      if (pathname === "/api/setup" && method === "POST") {
        const body = (await readJsonBody(req)) as SetupRequestBody;
        const semanticScholarApiKey =
          body.semanticScholarApiKey?.trim() || (await resolveSemanticScholarApiKey(this.cwd));
        const openAiApiKey = body.openAiApiKey?.trim() || (await resolveOpenAiApiKey(this.cwd));
        if (!semanticScholarApiKey) {
          return jsonResponse(res, 400, { error: "semanticScholarApiKey is required." });
        }
        if (body.llmMode === "openai_api" && !openAiApiKey) {
          return jsonResponse(res, 400, { error: "openAiApiKey is required for the selected provider/mode." });
        }
        if (
          (body.networkPolicy === "declared" || body.networkPolicy === "required")
          && !body.networkPurpose?.trim()
        ) {
          return jsonResponse(res, 400, {
            error: "networkPurpose is required when experiment network policy is declared or required."
          });
        }
        const config = await runNonInteractiveSetup(this.paths, {
          projectName: body.projectName,
          defaultTopic: body.defaultTopic,
          defaultConstraints: body.defaultConstraints,
          defaultObjectiveMetric: body.defaultObjectiveMetric,
          llmMode: body.llmMode,
          semanticScholarApiKey,
          openAiApiKey,
          codexChatModelChoice: body.codexChatModelChoice,
          codexChatReasoningEffort: body.codexChatReasoningEffort as any,
          codexResearchBackendModelChoice: body.codexResearchBackendModelChoice,
          codexResearchBackendReasoningEffort: body.codexResearchBackendReasoningEffort as any,
          codexExperimentModelChoice: body.codexExperimentModelChoice,
          codexExperimentReasoningEffort: body.codexExperimentReasoningEffort as any,
          openAiChatModel: body.openAiChatModel,
          openAiChatReasoningEffort: body.openAiChatReasoningEffort as any,
          openAiResearchBackendModel: body.openAiResearchBackendModel,
          openAiResearchBackendReasoningEffort: body.openAiResearchBackendReasoningEffort as any,
          openAiExperimentModel: body.openAiExperimentModel,
          openAiExperimentReasoningEffort: body.openAiExperimentReasoningEffort as any,
          ollamaBaseUrl: body.ollamaBaseUrl,
          ollamaChatModel: body.ollamaChatModel,
          ollamaResearchModel: body.ollamaResearchModel,
          ollamaExperimentModel: body.ollamaExperimentModel,
          ollamaVisionModel: body.ollamaVisionModel,
          networkPolicy: body.networkPolicy,
          networkPurpose: body.networkPurpose?.trim()
            ? (body.networkPurpose as "logging" | "artifact_upload" | "model_download" | "dataset_fetch" | "remote_inference" | "other")
            : undefined
        });
        await ensureScaffold(this.paths);
        const runtime = (
          await bootstrapAutoLabOSRuntime({
            cwd: this.cwd,
            allowInteractiveSetup: false
          })
        ).runtime;
        if (!runtime) {
          throw new Error("Runtime did not initialize after setup.");
        }
        await this.attachRuntime(runtime);
        return jsonResponse(res, 200, {
          configSummary: summarizeConfig(config),
          bootstrap: await this.buildBootstrapResponse()
        });
      }

      if (pathname === "/api/doctor" && method === "GET") {
        if (!this.runtime) {
          return jsonResponse(res, 200, { configured: false, checks: [], harness: undefined } satisfies DoctorResponse);
        }
        const report = await runDoctorReport(this.runtime.codex, {
          llmMode: this.runtime.config.providers.llm_mode,
          pdfAnalysisMode: getPdfAnalysisModeForConfig(this.runtime.config),
          openAiApiKeyConfigured: await hasOpenAiApiKey(this.cwd),
          codexResearchModel: this.runtime.config.providers.codex.model,
          ollamaBaseUrl: this.runtime.config.providers.ollama?.base_url,
          ollamaChatModel: this.runtime.config.providers.ollama?.chat_model,
          ollamaResearchModel: this.runtime.config.providers.ollama?.research_model,
          ollamaVisionModel: this.runtime.config.providers.ollama?.vision_model,
          workspaceRoot: this.cwd,
          approvalMode: this.runtime.config.workflow.approval_mode,
          executionApprovalMode: this.runtime.config.workflow.execution_approval_mode,
          dependencyMode: "local",
          sessionMode: "fresh",
          codeExecutionExpected: true,
          candidateIsolation: this.runtime.config.experiments.candidate_isolation,
          allowNetwork: this.runtime.config.experiments.allow_network,
          networkPolicy: this.runtime.config.experiments.network_policy,
          networkPurpose: this.runtime.config.experiments.network_purpose,
          includeHarnessValidation: true,
          includeHarnessTestRecords: false,
          maxHarnessFindings: 40
        });
        return jsonResponse(
          res,
          200,
          {
            configured: true,
            checks: report.checks,
            harness: report.harness,
            readiness: {
              blocked: report.readiness.blocked,
              approvalMode: report.readiness.approvalMode,
              executionApprovalMode: report.readiness.executionApprovalMode,
              dependencyMode: report.readiness.dependencyMode,
              sessionMode: report.readiness.sessionMode,
              networkPolicy: report.readiness.networkPolicy,
              networkPurpose: report.readiness.networkPurpose,
              networkDeclarationPresent: report.readiness.networkDeclarationPresent,
              networkApprovalSatisfied: report.readiness.networkApprovalSatisfied,
              warningChecks: report.readiness.warningChecks,
              failedChecks: report.readiness.failedChecks
            }
          } satisfies DoctorResponse
        );
      }

      if (pathname === "/api/knowledge" && method === "GET") {
        const knowledge = await readRepositoryKnowledgeIndex(this.cwd);
        return jsonResponse(res, 200, { entries: knowledge.entries } satisfies KnowledgeResponse);
      }

      if (pathname === "/api/knowledge/file" && method === "GET") {
        const relativePath = url.searchParams.get("path") || "";
        const preview = await readKnowledgeWorkspaceFile(this.cwd, relativePath);
        return jsonResponse(res, 200, preview satisfies KnowledgeFileResponse);
      }

      if (pathname === "/api/runs" && method === "GET") {
        const runtime = this.requireRuntime(res);
        if (!runtime) {
          return;
        }
        return jsonResponse(res, 200, { runs: await runtime.runStore.listRuns() });
      }

      if (pathname === "/api/runs" && method === "POST") {
        const runtime = this.requireRuntime(res);
        const session = this.requireSession(res);
        if (!runtime || !session) {
          return;
        }
        const body = (await readJsonBody(req)) as JsonBody;
        const brief = asTrimmedString(body.brief);
        const autoStart = body.autoStart === true;
        const topic = asTrimmedString(body.topic) || runtime.config.research.default_topic;
        const objectiveMetric =
          asTrimmedString(body.objectiveMetric) || runtime.config.research.default_objective_metric;
        const constraints = Array.isArray(body.constraints)
          ? body.constraints.map((item) => String(item).trim()).filter(Boolean)
          : runtime.config.research.default_constraints;
        const run = brief
          ? await session.createRunFromBrief({
              brief,
              topic,
              constraints,
              objectiveMetric,
              autoStart
            })
          : autoStart
            ? await session
                .createRun({
                  topic,
                  constraints,
                  objectiveMetric
                })
                .then((created) => session.startRun(created.id))
            : await session.createRun({
                topic,
                constraints,
                objectiveMetric
              });
        return jsonResponse(res, 200, {
          run,
          session: session.snapshot(),
          runs: session.runs()
        });
      }

      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/u);
      if (runMatch && method === "GET") {
        const runtime = this.requireRuntime(res);
        if (!runtime) {
          return;
        }
        const runId = decodeURIComponent(runMatch[1] || "");
        const run = await runtime.runStore.getRun(runId);
        if (!run) {
          return jsonResponse(res, 404, { error: "Run not found." });
        }
        return jsonResponse(res, 200, { run });
      }

      const literatureMatch = pathname.match(/^\/api\/runs\/([^/]+)\/literature$/u);
      if (literatureMatch && method === "GET") {
        const runtime = this.requireRuntime(res);
        if (!runtime) {
          return;
        }
        const runId = decodeURIComponent(literatureMatch[1] || "");
        const run = await runtime.runStore.getRun(runId);
        if (!run) {
          return jsonResponse(res, 404, { error: "Run not found." });
        }
        const literature = await writeRunLiteratureIndex(this.cwd, runId);
        return jsonResponse(res, 200, { literature } satisfies LiteratureResponse);
      }

      const checkpointsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/checkpoints$/u);
      if (checkpointsMatch && method === "GET") {
        const runtime = this.requireRuntime(res);
        if (!runtime) {
          return;
        }
        const runId = decodeURIComponent(checkpointsMatch[1] || "");
        const checkpoints = await runtime.checkpointStore.list(runId);
        return jsonResponse(res, 200, {
          checkpoints: checkpoints.map((item) => ({
            seq: item.seq,
            node: item.node,
            phase: item.phase,
            createdAt: item.createdAt,
            reason: item.reason
          }))
        });
      }

      const artifactsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/u);
      if (artifactsMatch && method === "GET") {
        const runtime = this.requireRuntime(res);
        if (!runtime) {
          return;
        }
        const runId = decodeURIComponent(artifactsMatch[1] || "");
        return jsonResponse(res, 200, {
          artifacts: await listRunArtifacts(this.paths, runId)
        });
      }

      const artifactMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifact$/u);
      if (artifactMatch && method === "GET") {
        const runtime = this.requireRuntime(res);
        if (!runtime) {
          return;
        }
        const runId = decodeURIComponent(artifactMatch[1] || "");
        const relativePath = url.searchParams.get("path") || "";
        try {
          const artifact = await readRunArtifact(this.paths, runId, relativePath);
          res.statusCode = 200;
          res.setHeader("Content-Type", artifact.contentType);
          res.setHeader("Cache-Control", "no-store");
          res.end(artifact.data);
        } catch (error) {
          return jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      const actionMatch = pathname.match(/^\/api\/runs\/([^/]+)\/actions\/([^/]+)$/u);
      if (actionMatch && method === "POST") {
        const session = this.requireSession(res);
        if (!session) {
          return;
        }
        const runId = decodeURIComponent(actionMatch[1] || "");
        const action = decodeURIComponent(actionMatch[2] || "");
        const body = (await readJsonBody(req)) as JsonBody;
        await session.selectRun(runId);
        if (action === "run-node") {
          const node = asTrimmedString(body.node);
          if (!node) {
            return jsonResponse(res, 400, { error: "node is required." });
          }
          const extraArgs: string[] = [];
          if (typeof body.topN === "number") {
            extraArgs.push("--top-n", String(body.topN));
          }
          if (typeof body.topK === "number") {
            extraArgs.push("--top-k", String(body.topK));
          }
          if (typeof body.branchCount === "number") {
            extraArgs.push("--branch-count", String(body.branchCount));
          }
          const command = ["/agent", "run", node, runId, ...extraArgs].join(" ");
          const result = await session.submitInput(command);
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        if (action === "approve") {
          const result = await session.submitInput("/approve");
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        if (action === "retry") {
          const node = asTrimmedString(body.node);
          const command = node ? `/agent retry ${node} ${runId}` : `/retry`;
          const result = await session.submitInput(command);
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        if (action === "apply-transition") {
          const result = await session.submitInput(`/agent apply ${runId}`);
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        if (action === "overnight") {
          const result = await session.submitInput(`/agent overnight ${runId}`);
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        if (action === "autonomous") {
          const result = await session.submitInput(`/agent autonomous ${runId}`);
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        if (action === "jump") {
          const node = asTrimmedString(body.node);
          if (!node) {
            return jsonResponse(res, 400, { error: "node is required." });
          }
          const force = body.force === true ? " --force" : "";
          const result = await session.submitInput(`/agent jump ${node} ${runId}${force}`);
          return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
        }
        return jsonResponse(res, 404, { error: "Unknown action." });
      }

      if (pathname === "/api/session/input" && method === "POST") {
        const session = this.requireSession(res);
        if (!session) {
          return;
        }
        const body = (await readJsonBody(req)) as JsonBody;
        const text = asTrimmedString(body.text);
        if (!text) {
          return jsonResponse(res, 400, { error: "text is required." });
        }
        const result = await session.submitInput(text);
        return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
      }

      if (pathname === "/api/session/pending" && method === "POST") {
        const session = this.requireSession(res);
        if (!session) {
          return;
        }
        const body = (await readJsonBody(req)) as JsonBody;
        const action = asTrimmedString(body.action) as "next" | "all" | "cancel" | undefined;
        if (!action || !["next", "all", "cancel"].includes(action)) {
          return jsonResponse(res, 400, { error: "action must be next, all, or cancel." });
        }
        const result = await session.respondToPending(action);
        return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
      }

      if (pathname === "/api/session/cancel" && method === "POST") {
        const session = this.requireSession(res);
        if (!session) {
          return;
        }
        const result = await session.cancelActive();
        return jsonResponse(res, 200, buildSessionInputResponse(result, session.getActiveRunId()));
      }

      if (pathname === "/api/events/stream" && method === "GET") {
        return this.handleSse(res);
      }

      return this.serveStatic(pathname, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jsonResponse(res, 500, { error: message });
    }
  }

  private async buildBootstrapResponse(): Promise<BootstrapResponse> {
    const config = this.runtime?.config;
    const runs = this.runtime ? await this.runtime.runStore.listRuns() : [];
    const jobs = this.runtime
      ? await buildRunJobsSnapshot({
          workspaceRoot: this.cwd,
          runs,
          approvalMode: this.runtime.config.workflow.approval_mode || "minimal"
        })
      : emptyJobsSnapshot();
    return {
      configured: Boolean(this.runtime && this.session),
      setupDefaults: {
        projectName: path.basename(this.cwd),
        defaultTopic: config?.research.default_topic || "Multi-agent collaboration",
        defaultConstraints: config?.research.default_constraints || ["recent papers", "last 5 years"],
        defaultObjectiveMetric:
          config?.research.default_objective_metric || "state-of-the-art reproducibility"
      },
      session: this.session?.snapshot() || emptySessionState(),
      runs,
      jobs,
      activeRunId: this.session?.getActiveRunId(),
      configSummary: config ? summarizeConfig(config) : undefined,
      configForm: buildConfigFormData(config, this.cwd),
      configOptions: buildConfigOptions(config)
    };
  }

  private requireRuntime(res: ServerResponse): AutoLabOSRuntime | undefined {
    if (!this.runtime) {
      jsonResponse(res, 409, { error: "AutoLabOS is not configured yet." });
      return undefined;
    }
    return this.runtime;
  }

  private requireSession(res: ServerResponse): InteractionSession | undefined {
    if (!this.session) {
      jsonResponse(res, 409, { error: "AutoLabOS is not configured yet." });
      return undefined;
    }
    return this.session;
  }

  private handleSse(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    this.sseClients.add(res);
    writeSseEvent(res, "connected", { ok: true });
    if (this.session) {
      writeSseEvent(res, "session_state", this.session.snapshot());
    }
    res.on("close", () => {
      this.sseClients.delete(res);
    });
  }

  private broadcast(event: string, data: unknown): void {
    for (const client of this.sseClients) {
      writeSseEvent(client, event, data);
    }
  }

  private async serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = path.resolve(WEB_DIST_DIR, requested);
    const distRoot = path.resolve(WEB_DIST_DIR);
    if (!candidate.startsWith(distRoot)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        res.statusCode = 200;
        res.setHeader("Content-Type", contentTypeForStatic(candidate));
        res.end(await fs.readFile(candidate));
        return;
      }
    } catch {
      // fall through
    }

    try {
      const indexPath = path.join(WEB_DIST_DIR, "index.html");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await fs.readFile(indexPath));
    } catch {
      res.statusCode = 503;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        `Installed AutoLabOS web assets are missing. If you're using a repository checkout, build them once from the package root (${PACKAGE_ROOT}) with \`npm --prefix web run build\`.`
      );
    }
  }
}

function buildSessionInputResponse(
  session: WebSessionState,
  activeRunId?: string
): SessionInputResponse {
  return {
    session,
    activeRunId,
    pendingPlan: session.pendingPlan as PendingPlan | undefined
  };
}

function summarizeConfig(config: AutoLabOSRuntime["config"]): ConfigSummary {
  const pdfMode = getPdfAnalysisModeForConfig(config);
  const researchBackendModel =
    config.providers.llm_mode === "openai_api"
      ? config.providers.openai.model
      : config.providers.llm_mode === "ollama"
        ? config.providers.ollama?.research_model || config.providers.ollama?.chat_model || "ollama"
        : config.providers.codex.model;
  const researchBackendReasoning =
    config.providers.llm_mode === "openai_api"
      ? config.providers.openai.reasoning_effort
      : config.providers.llm_mode === "ollama"
        ? undefined
        : config.providers.codex.reasoning_effort;
  return {
    projectName: config.project_name,
    workflowMode: config.workflow.mode,
    approvalMode: config.workflow.approval_mode || "minimal",
    executionApprovalMode: config.workflow.execution_approval_mode || "manual",
    llmMode: config.providers.llm_mode,
    pdfMode,
    researchBackendModel,
    chatModel:
      config.providers.llm_mode === "openai_api"
        ? config.providers.openai.chat_model || config.providers.openai.model
        : config.providers.llm_mode === "ollama"
          ? config.providers.ollama?.chat_model || "ollama"
          : config.providers.codex.chat_model || config.providers.codex.model,
    experimentModel:
      config.providers.llm_mode === "openai_api"
        ? config.providers.openai.experiment_model || config.providers.openai.model
        : config.providers.llm_mode === "ollama"
          ? config.providers.ollama?.experiment_model || config.providers.ollama?.research_model || "ollama"
          : config.providers.codex.experiment_model || config.providers.codex.model,
    researchBackendReasoning,
    chatReasoning:
      config.providers.llm_mode === "openai_api"
        ? config.providers.openai.chat_reasoning_effort || config.providers.openai.reasoning_effort
        : config.providers.llm_mode === "ollama"
          ? undefined
          : config.providers.codex.chat_reasoning_effort || config.providers.codex.reasoning_effort,
    experimentReasoning:
      config.providers.llm_mode === "openai_api"
        ? config.providers.openai.experiment_reasoning_effort || config.providers.openai.reasoning_effort
        : config.providers.llm_mode === "ollama"
          ? undefined
          : config.providers.codex.experiment_reasoning_effort || config.providers.codex.reasoning_effort,
    networkPolicy: config.experiments.network_policy || (config.experiments.allow_network ? undefined : "blocked"),
    networkPurpose: config.experiments.network_purpose
  };
}

function buildConfigFormData(
  config?: AutoLabOSRuntime["config"],
  cwd = process.cwd()
): WebConfigFormData {
  const codexModel = config?.providers.codex.model || DEFAULT_CODEX_MODEL;
  const codexChatModel = config?.providers.codex.chat_model || DEFAULT_CODEX_CHAT_SETUP_MODEL;
  const codexExperimentModel = config?.providers.codex.experiment_model || codexModel;
  const openAiModel = config?.providers.openai.model || "gpt-5.4";
  const openAiChatModel = config?.providers.openai.chat_model || openAiModel;
  const openAiExperimentModel = config?.providers.openai.experiment_model || openAiModel;

  return {
    projectName: config?.project_name || path.basename(cwd),
    defaultTopic: config?.research.default_topic || "Multi-agent collaboration",
    defaultConstraints: (config?.research.default_constraints || ["recent papers", "last 5 years"]).join(", "),
    defaultObjectiveMetric: config?.research.default_objective_metric || "state-of-the-art reproducibility",
    llmMode: config?.providers.llm_mode || DEFAULT_PRIMARY_LLM_MODE,
    codexChatModelChoice: getCurrentCodexModelSelectionValue(codexChatModel, config?.providers.codex.chat_fast_mode),
    codexChatReasoningEffort:
      config?.providers.codex.chat_reasoning_effort ||
      config?.providers.codex.reasoning_effort ||
      DEFAULT_CODEX_CHAT_SETUP_REASONING_EFFORT,
    codexResearchBackendModelChoice: getCurrentCodexModelSelectionValue(
      codexModel,
      config?.providers.codex.fast_mode
    ),
    codexResearchBackendReasoningEffort: config?.providers.codex.reasoning_effort || "xhigh",
    codexExperimentModelChoice: getCurrentCodexModelSelectionValue(
      codexExperimentModel,
      config?.providers.codex.experiment_fast_mode
    ),
    codexExperimentReasoningEffort:
      config?.providers.codex.experiment_reasoning_effort || config?.providers.codex.reasoning_effort || "xhigh",
    openAiChatModel,
    openAiChatReasoningEffort:
      config?.providers.openai.chat_reasoning_effort || config?.providers.openai.reasoning_effort || "low",
    openAiResearchBackendModel: openAiModel,
    openAiResearchBackendReasoningEffort: config?.providers.openai.reasoning_effort || "medium",
    openAiExperimentModel,
    openAiExperimentReasoningEffort:
      config?.providers.openai.experiment_reasoning_effort || config?.providers.openai.reasoning_effort || "medium",
    ollamaBaseUrl: config?.providers.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL,
    ollamaChatModel: config?.providers.ollama?.chat_model || DEFAULT_OLLAMA_CHAT_MODEL,
    ollamaResearchModel: config?.providers.ollama?.research_model || DEFAULT_OLLAMA_RESEARCH_MODEL,
    ollamaExperimentModel: config?.providers.ollama?.experiment_model || DEFAULT_OLLAMA_EXPERIMENT_MODEL,
    ollamaVisionModel: config?.providers.ollama?.vision_model || DEFAULT_OLLAMA_VISION_MODEL,
    networkPolicy:
      config?.experiments.network_policy
      || (config?.experiments.allow_network ? "declared" : "blocked"),
    networkPurpose: config?.experiments.network_purpose || ""
  };
}

function buildConfigOptions(config?: AutoLabOSRuntime["config"]): WebConfigOptions {
  const codexModels = buildCodexModelSelectionChoices(config?.providers.codex.model);
  const codexReasoningByModel = Object.fromEntries(
    codexModels.map((modelChoice) => {
      const normalized = modelChoice === "gpt-5.4 (fast)" ? "gpt-5.4" : modelChoice;
      return [modelChoice, [...getReasoningEffortChoicesForModel(normalized)]];
    })
  );
  const openAiModels = buildOpenAiResponsesModelChoices();
  const openAiReasoningByModel = Object.fromEntries(
    openAiModels.map((model) => [model, [...buildOpenAiResponsesReasoningChoices(model)]])
  );
  return {
    codexModels,
    codexReasoningByModel,
    openAiModels,
    openAiReasoningByModel,
    ollamaChatModels: buildOllamaChatModelChoices(),
    ollamaResearchModels: buildOllamaResearchModelChoices(),
    ollamaExperimentModels: buildOllamaExperimentModelChoices(),
    ollamaVisionModels: buildOllamaVisionModelChoices()
  };
}

function emptySessionState(): WebSessionState {
  return {
    activeRunId: undefined,
    busy: false,
    busyLabel: undefined,
    pendingPlan: undefined,
    logs: [],
    canCancel: false,
    activeRunInsight: undefined
  };
}

function emptyJobsSnapshot(): RunJobsSnapshot {
  return {
    generated_at: new Date(0).toISOString(),
    runs: [],
    top_failures: []
  };
}


async function readKnowledgeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string
): Promise<KnowledgeFileResponse> {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid knowledge path.");
  }
  const allowedRoots = [".autolabos/knowledge/", "outputs/"];
  if (!allowedRoots.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) {
    throw new Error("Knowledge preview path is outside the allowed roots.");
  }
  const absolutePath = path.resolve(workspaceRoot, normalized);
  const workspaceResolved = path.resolve(workspaceRoot);
  if (!absolutePath.startsWith(`${workspaceResolved}${path.sep}`) && absolutePath !== workspaceResolved) {
    throw new Error("Knowledge preview path escapes the workspace.");
  }
  const raw = await fs.readFile(absolutePath, "utf8");
  const content = normalized.toLowerCase().endsWith(".json") ? `${JSON.stringify(JSON.parse(raw), null, 2)}\n` : raw;
  return { path: normalized, content };
}
async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody;
}

function jsonResponse(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) {
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`${JSON.stringify(payload)}\n`);
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function contentTypeForStatic(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (lower.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (lower.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (lower.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  return "application/octet-stream";
}
