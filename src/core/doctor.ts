import path from "node:path";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import { DoctorCheck } from "../types.js";
import { CodexCliClient } from "../integrations/codex/codexCliClient.js";
import { RECOMMENDED_CODEX_MODEL } from "../integrations/codex/modelCatalog.js";
import { OllamaClient } from "../integrations/ollama/ollamaClient.js";
import {
  HarnessValidationReport,
  runHarnessValidation
} from "./validation/harnessValidationService.js";

export interface DoctorRunOptions {
  llmMode?: "codex_chatgpt_only" | "openai_api" | "ollama";
  pdfAnalysisMode?: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  openAiApiKeyConfigured?: boolean;
  codexResearchModel?: string;
  ollamaBaseUrl?: string;
  ollamaChatModel?: string;
  ollamaResearchModel?: string;
  ollamaVisionModel?: string;
  workspaceRoot?: string;
  includeHarnessValidation?: boolean;
  includeHarnessTestRecords?: boolean;
  maxHarnessFindings?: number;
  approvalMode?: "manual" | "minimal";
  executionApprovalMode?: "manual" | "risk_ack" | "full_auto";
  dependencyMode?: "local" | "docker" | "remote_gpu" | "plan_only";
  sessionMode?: "fresh" | "existing";
  codeExecutionExpected?: boolean;
  candidateIsolation?: "attempt_snapshot_restore" | "attempt_worktree";
  manualOverride?: boolean;
  allowNetwork?: boolean;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  harness?: HarnessValidationReport;
  readiness: DoctorReadinessSnapshot;
}

export interface DoctorReadinessSnapshot {
  generatedAt: string;
  workspaceRoot: string;
  workspaceProbePath: string;
  blocked: boolean;
  approvalMode: "manual" | "minimal";
  executionApprovalMode: "manual" | "risk_ack" | "full_auto";
  dependencyMode: "local" | "docker" | "remote_gpu" | "plan_only";
  sessionMode: "fresh" | "existing";
  containerizationRequired: boolean;
  webRestrictionRequired: boolean;
  manualOverride: boolean;
  failedChecks: string[];
}

interface RunsFileSnapshot {
  runs?: Array<{ id?: string; updatedAt?: string }>;
}

interface CompiledPageValidationSnapshot {
  status?: string;
  minimum_main_pages?: number;
  target_main_pages?: number;
  main_page_limit?: number;
  compiled_pdf_page_count?: number | null;
  message?: string;
}

export async function runDoctorReport(
  codex: CodexCliClient,
  opts?: DoctorRunOptions
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const workspaceRoot = opts?.workspaceRoot || process.cwd();
  const approvalMode = opts?.approvalMode === "manual" ? "manual" : "minimal";
  const executionApprovalMode = normalizeExecutionApprovalMode(opts?.executionApprovalMode);
  const dependencyMode = normalizeDependencyMode(opts?.dependencyMode);
  const sessionMode = opts?.sessionMode === "existing" ? "existing" : "fresh";
  const localIsolationConfigured = Boolean(opts?.candidateIsolation);
  const containerizationRequired = Boolean(
    opts?.codeExecutionExpected && (dependencyMode === "docker" || dependencyMode === "remote_gpu")
  );
  const webRestrictionRequired = Boolean(opts?.codeExecutionExpected && dependencyMode !== "plan_only");
  const allowNetwork = opts?.allowNetwork === true;
  const manualOverride = opts?.manualOverride === true;
  const requiresCodexChecks =
    !opts ||
    opts.llmMode === "codex_chatgpt_only" ||
    opts.pdfAnalysisMode === "codex_text_image_hybrid";

  if (requiresCodexChecks) {
    const cli = await codex.checkCliAvailable();
    checks.push({ name: "codex-cli", ok: cli.ok, detail: cli.detail });

    const login = await codex.checkLoginStatus();
    checks.push({ name: "codex-login", ok: login.ok, detail: login.detail });

    if (typeof codex.checkEnvironmentReadiness === "function") {
      const codexEnvironmentChecks = await codex.checkEnvironmentReadiness();
      checks.push(
        ...codexEnvironmentChecks.map((check) => ({
          name: check.name,
          ok: check.ok,
          detail: check.detail
        }))
      );
    }
  }

  if (opts?.llmMode === "codex_chatgpt_only" && opts.codexResearchModel) {
    checks.push(buildCodexModelCheck("codex-research-backend-model", "research backend", opts.codexResearchModel));
  }

  const workspaceWriteProbe = await probeWorkspaceWriteability(workspaceRoot);
  checks.push({
    name: "workspace-write",
    ok: workspaceWriteProbe.ok,
    detail: workspaceWriteProbe.ok
      ? `Workspace write probe succeeded at ${workspaceWriteProbe.probePath}`
      : `Workspace write probe failed at ${workspaceWriteProbe.probePath}: ${workspaceWriteProbe.detail}`
  });
  checks.push({
    name: "web-access",
    ok: dependencyMode !== "plan_only",
    detail:
      dependencyMode !== "plan_only"
        ? `Web access is expected for dependency mode ${dependencyMode}.`
        : "Plan-only mode selected; external web access is not required."
  });
  checks.push({
    name: "dependency-mode",
    ok: true,
    detail: `Run dependency mode: ${dependencyMode}`
  });
  checks.push({
    name: "session-mode",
    ok: true,
    detail: `Session mode: ${sessionMode}`
  });
  checks.push({
    name: "approval-mode",
    ok: true,
    detail: `Workflow approval mode: ${approvalMode}`
  });
  checks.push({
    name: "execution-approval-mode",
    ok: !(executionApprovalMode === "full_auto" && dependencyMode !== "plan_only"),
    detail:
      executionApprovalMode === "full_auto" && dependencyMode !== "plan_only"
        ? "Execution approval mode full_auto is only valid for smoke/plan-only work; use manual or risk_ack here."
        : `Execution approval mode: ${executionApprovalMode}`
  });
  if (opts?.codeExecutionExpected) {
    checks.push({
      name: "experiment-containerization",
      ok: containerizationRequired || localIsolationConfigured,
      detail: containerizationRequired
        ? `Code execution is expected and dependency mode ${dependencyMode} requires containerized/high-risk isolation.`
        : localIsolationConfigured
          ? `Code execution is expected and local repository isolation is configured via ${opts?.candidateIsolation}.`
          : "Code execution is expected but no candidate isolation strategy is configured."
    });
    checks.push({
      name: "experiment-web-restriction",
      ok: !webRestrictionRequired || !allowNetwork,
      detail: !webRestrictionRequired
        ? "Code execution is not expected to need web restriction."
        : allowNetwork
          ? "Code execution is expected but allow_network is enabled; disable it unless the run explicitly justifies network access."
          : "Code execution is expected and network access remains disabled."
    });
  }
  checks.push({
    name: "manual-override",
    ok: !manualOverride,
    detail: manualOverride
      ? "manual_override is enabled for this workspace/run. Revalidate before treating the run as ready."
      : "No manual override is active."
  });

  checks.push(await runBinaryCheck("python3", ["--version"], "python"));
  checks.push(await runBinaryCheck("pip3", ["--version"], "pip"));
  checks.push(await runBinaryCheck("pdflatex", ["--version"], "latex"));
  if (opts?.pdfAnalysisMode === "codex_text_image_hybrid" || opts?.pdfAnalysisMode === "ollama_vision") {
    checks.push(await runBinaryCheck("pdftotext", ["-v"], "pdftotext"));
    checks.push(await runBinaryCheck("pdfinfo", ["-v"], "pdfinfo"));
    checks.push(await runBinaryCheck("pdftoppm", ["-v"], "pdftoppm"));
  }
  if (opts?.llmMode === "openai_api" || opts?.pdfAnalysisMode === "responses_api_pdf") {
    checks.push({
      name: "openai-api-key",
      ok: opts.openAiApiKeyConfigured === true,
      detail:
        opts.openAiApiKeyConfigured === true
          ? "OPENAI_API_KEY detected"
          : opts?.llmMode === "openai_api"
            ? "OPENAI_API_KEY missing (required for OpenAI API provider mode)"
            : "OPENAI_API_KEY missing (required for Responses API PDF analysis)"
    });
  }

  if (opts?.llmMode === "ollama" || opts?.pdfAnalysisMode === "ollama_vision") {
    const ollamaUrl = opts?.ollamaBaseUrl || "http://127.0.0.1:11434";
    checks.push({
      name: "ollama-base-url",
      ok: Boolean(ollamaUrl),
      detail: `Ollama base URL: ${ollamaUrl}`
    });

    const ollamaClient = new OllamaClient(ollamaUrl);
    const health = await ollamaClient.checkHealth();
    checks.push({
      name: "ollama-server",
      ok: health.reachable,
      detail: health.reachable
        ? `Ollama server reachable${health.version ? ` (${health.version})` : ""}`
        : `Ollama server unreachable at ${ollamaUrl}: ${health.error || "unknown error"}. Run 'ollama serve' to start.`
    });

    if (health.reachable) {
      try {
        const models = await ollamaClient.listModels();
        const modelNames = models.map((m) => m.name);
        const modelsToCheck = [
          { name: "ollama-chat-model", model: opts?.ollamaChatModel, label: "chat" },
          { name: "ollama-research-model", model: opts?.ollamaResearchModel, label: "research" },
          { name: "ollama-vision-model", model: opts?.ollamaVisionModel, label: "vision" }
        ];
        for (const { name, model, label } of modelsToCheck) {
          if (!model) continue;
          const found = modelNames.some(
            (n) => n === model || n === `${model}:latest` || n.startsWith(`${model}:`)
          );
          checks.push({
            name,
            ok: found,
            detail: found
              ? `Ollama ${label} model '${model}' is available`
              : `Ollama ${label} model '${model}' not found. Run 'ollama pull ${model}' to install.`
          });
        }
      } catch (err) {
        checks.push({
          name: "ollama-models",
          ok: false,
          detail: `Could not list Ollama models: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }
  }

  const pageBudgetCheck = await loadLatestPaperPageBudgetCheck(opts?.workspaceRoot || process.cwd());
  if (pageBudgetCheck) {
    checks.push(pageBudgetCheck);
  }

  const includeHarnessValidation = opts?.includeHarnessValidation !== false;
  const harness = includeHarnessValidation
    ? await runHarnessValidation({
        workspaceRoot,
        includeWorkspaceRuns: true,
        includeTestRunStores: opts?.includeHarnessTestRecords === true,
        maxFindings: opts?.maxHarnessFindings || 60
      })
    : undefined;

  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    checks,
    harness,
    readiness: {
      generatedAt: new Date().toISOString(),
      workspaceRoot,
      workspaceProbePath: workspaceWriteProbe.probePath,
      blocked: failedChecks.length > 0 || harness?.status === "fail",
      approvalMode,
      executionApprovalMode,
      dependencyMode,
      sessionMode,
      containerizationRequired,
      webRestrictionRequired,
      manualOverride,
      failedChecks: [
        ...failedChecks,
        ...(harness?.status === "fail" ? ["harness-validation"] : [])
      ]
    }
  };
}

export async function runDoctor(
  codex: CodexCliClient,
  opts?: DoctorRunOptions
): Promise<DoctorCheck[]> {
  const report = await runDoctorReport(codex, opts);
  return report.checks;
}

function normalizeExecutionApprovalMode(
  value: DoctorRunOptions["executionApprovalMode"]
): "manual" | "risk_ack" | "full_auto" {
  if (value === "risk_ack" || value === "full_auto") {
    return value;
  }
  return "manual";
}

function normalizeDependencyMode(
  value: DoctorRunOptions["dependencyMode"]
): "local" | "docker" | "remote_gpu" | "plan_only" {
  if (value === "docker" || value === "remote_gpu" || value === "plan_only") {
    return value;
  }
  return "local";
}

async function probeWorkspaceWriteability(
  workspaceRoot: string
): Promise<{ ok: boolean; probePath: string; detail: string }> {
  const candidateProbeDir = path.join(workspaceRoot, "test");
  const probeDir = await directoryExists(candidateProbeDir) ? candidateProbeDir : workspaceRoot;
  const probePath = path.join(probeDir, `.autolabos-doctor-write-probe-${process.pid}.tmp`);
  try {
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(probePath, "ok\n", "utf8");
    await fs.rm(probePath, { force: true });
    return { ok: true, probePath, detail: "write probe succeeded" };
  } catch (error) {
    return {
      ok: false,
      probePath,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function buildDoctorHighlightLines(report: DoctorReport): string[] {
  const pageBudgetCheck = report.checks.find((check) => check.name === "paper-page-budget");
  if (!pageBudgetCheck) {
    return [];
  }
  return [
    `${pageBudgetCheck.ok ? "[OK]" : "[ATTN]"} paper page budget: ${pageBudgetCheck.detail}`
  ];
}

function buildCodexModelCheck(name: string, label: string, model: string): DoctorCheck {
  const normalized = model.trim();
  if (normalized.toLowerCase().includes("spark")) {
    return {
      name,
      ok: false,
      detail:
        `Configured Codex ${label} model ${normalized} is a short-run Spark profile. ` +
        `Switch ${label} work to ${RECOMMENDED_CODEX_MODEL} before rerank or paper analysis.`
    };
  }
  return {
    name,
    ok: true,
    detail: `Configured Codex ${label} model ${normalized} is suitable for rerank and paper analysis.`
  };
}

async function loadLatestPaperPageBudgetCheck(workspaceRoot: string): Promise<DoctorCheck | undefined> {
  const runsFilePath = path.join(workspaceRoot, ".autolabos", "runs", "runs.json");
  let runsFile: RunsFileSnapshot;
  try {
    runsFile = JSON.parse(await fs.readFile(runsFilePath, "utf8")) as RunsFileSnapshot;
  } catch {
    return undefined;
  }

  const latestRun = [...(runsFile.runs || [])]
    .filter((run) => typeof run.id === "string" && run.id.trim().length > 0)
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))[0];
  if (!latestRun?.id) {
    return undefined;
  }

  const validationPath = path.join(
    workspaceRoot,
    ".autolabos",
    "runs",
    latestRun.id,
    "paper",
    "compiled_page_validation.json"
  );
  let validation: CompiledPageValidationSnapshot;
  try {
    validation = JSON.parse(await fs.readFile(validationPath, "utf8")) as CompiledPageValidationSnapshot;
  } catch {
    return undefined;
  }

  const status = validation.status === "pass" ? "pass" : validation.status === "warn" ? "warn" : "fail";
  const pageCount =
    typeof validation.compiled_pdf_page_count === "number" ? String(validation.compiled_pdf_page_count) : "unknown";
  const minimumMainPages = typeof validation.minimum_main_pages === "number"
    ? String(validation.minimum_main_pages)
    : typeof validation.main_page_limit === "number"
      ? String(validation.main_page_limit)
      : "unknown";
  const targetMainPages = typeof validation.target_main_pages === "number"
    ? String(validation.target_main_pages)
    : typeof validation.main_page_limit === "number"
      ? String(validation.main_page_limit)
      : "unknown";
  return {
    name: "paper-page-budget",
    ok: status === "pass",
    detail:
      `Latest compiled paper page-budget check for run ${latestRun.id}: ${status}. ` +
      `pages=${pageCount}, minimum_main_pages=${minimumMainPages}, target_main_pages=${targetMainPages}. ` +
      `${validation.message || ""}`.trim()
  };
}

async function runBinaryCheck(bin: string, args: string[], name: string): Promise<DoctorCheck> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: process.env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (err) => {
      resolve({
        name,
        ok: false,
        detail: err.message
      });
    });

    child.once("close", (code) => {
      const out = (stdout || stderr).trim();
      resolve({
        name,
        ok: code === 0,
        detail: out || `${bin} exited with ${code ?? 1}`
      });
    });
  });
}
