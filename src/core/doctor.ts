import path from "node:path";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import { resolveAppPaths } from "../config.js";
import {
  DoctorCheck,
  DoctorCheckStatus,
  ExecutionApprovalMode,
  ExperimentNetworkPolicy,
  ExperimentNetworkPurpose
} from "../types.js";
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
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  harness?: HarnessValidationReport;
  readiness: DoctorReadinessSnapshot;
}

export type DoctorAggregateStatus = "ok" | "warn" | "fail";

export interface DoctorReadinessSnapshot {
  generatedAt: string;
  workspaceRoot: string;
  workspaceProbePath: string;
  blocked: boolean;
  llmMode?: "codex_chatgpt_only" | "openai_api" | "ollama";
  pdfAnalysisMode?: "codex_text_image_hybrid" | "responses_api_pdf" | "ollama_vision";
  approvalMode: "manual" | "minimal";
  executionApprovalMode: "manual" | "risk_ack" | "full_auto";
  dependencyMode: "local" | "docker" | "remote_gpu" | "plan_only";
  sessionMode: "fresh" | "existing";
  candidateIsolation?: "attempt_snapshot_restore" | "attempt_worktree";
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
  networkDeclarationPresent: boolean;
  networkApprovalSatisfied: boolean;
  containerizationRequired: boolean;
  webRestrictionRequired: boolean;
  manualOverride: boolean;
  warningChecks: string[];
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

const MINIMUM_DOCTOR_FREE_SPACE_BYTES = 500 * 1024 * 1024;

export async function runDoctorReport(
  codex: CodexCliClient,
  opts?: DoctorRunOptions
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const workspaceRoot = opts?.workspaceRoot || process.cwd();
  const paths = resolveAppPaths(workspaceRoot);
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
  const networkPolicy = normalizeDoctorNetworkPolicy(opts?.networkPolicy, allowNetwork);
  const networkPurpose = normalizeDoctorNetworkPurpose(opts?.networkPurpose);
  const networkDeclarationPresent = !allowNetwork || Boolean(networkPolicy && networkPurpose);
  const networkApprovalSatisfied =
    !allowNetwork || executionApprovalMode === "manual" || executionApprovalMode === "risk_ack";
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

  checks.push(await runConfigExistsCheck(paths.configFile));

  const runsDirWriteProbe = await probeRunsDirectoryWriteability(paths.runsDir);
  checks.push({
    name: "runs-dir-write",
    ok: runsDirWriteProbe.ok,
    detail: runsDirWriteProbe.ok
      ? `Run store write probe succeeded at ${runsDirWriteProbe.probePath}`
      : `Run store write probe failed at ${runsDirWriteProbe.probePath}: ${runsDirWriteProbe.detail}`
  });

  checks.push(await runDiskFreeSpaceCheck(workspaceRoot));
  checks.push(runNodeVersionCheck(readCurrentNodeVersion()));

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
      ok: !webRestrictionRequired || !allowNetwork || (networkDeclarationPresent && networkApprovalSatisfied),
      status: resolveExperimentWebRestrictionStatus({
        webRestrictionRequired,
        allowNetwork,
        networkPolicy,
        networkPurpose,
        networkDeclarationPresent,
        networkApprovalSatisfied
      }),
      detail: buildExperimentWebRestrictionDetail({
        webRestrictionRequired,
        allowNetwork,
        networkPolicy,
        networkPurpose,
        networkDeclarationPresent,
        executionApprovalMode
      })
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

  const normalizedChecks = checks.map(normalizeDoctorCheck);
  const failedChecks = normalizedChecks
    .filter((check) => getDoctorCheckStatus(check) === "fail")
    .map((check) => check.name);
  const warningChecks = normalizedChecks
    .filter((check) => getDoctorCheckStatus(check) === "warning")
    .map((check) => check.name);
  return {
    checks: normalizedChecks,
    harness,
    readiness: {
      generatedAt: new Date().toISOString(),
      workspaceRoot,
      workspaceProbePath: workspaceWriteProbe.probePath,
      blocked: failedChecks.length > 0 || harness?.status === "fail",
      llmMode: opts?.llmMode,
      pdfAnalysisMode: opts?.pdfAnalysisMode,
      approvalMode,
      executionApprovalMode,
      dependencyMode,
      sessionMode,
      candidateIsolation: opts?.candidateIsolation,
      networkPolicy,
      networkPurpose,
      networkDeclarationPresent,
      networkApprovalSatisfied,
      containerizationRequired,
      webRestrictionRequired,
      manualOverride,
      warningChecks,
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

function normalizeDoctorNetworkPolicy(
  value: DoctorRunOptions["networkPolicy"],
  allowNetwork: boolean
): ExperimentNetworkPolicy | undefined {
  if (!allowNetwork) {
    return "blocked";
  }
  if (value === "declared" || value === "required") {
    return value;
  }
  return undefined;
}

function normalizeDoctorNetworkPurpose(
  value: DoctorRunOptions["networkPurpose"]
): ExperimentNetworkPurpose | undefined {
  if (
    value === "logging"
    || value === "artifact_upload"
    || value === "model_download"
    || value === "dataset_fetch"
    || value === "remote_inference"
    || value === "other"
  ) {
    return value;
  }
  return undefined;
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

async function probeRunsDirectoryWriteability(
  runsDir: string
): Promise<{ ok: boolean; probePath: string; detail: string }> {
  const probePath = path.join(runsDir, `.autolabos-doctor-runs-write-probe-${process.pid}.tmp`);
  try {
    const stat = await fs.stat(runsDir);
    if (!stat.isDirectory()) {
      return { ok: false, probePath, detail: `${runsDir} is not a directory` };
    }
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

async function runConfigExistsCheck(configFile: string): Promise<DoctorCheck> {
  try {
    await fs.access(configFile);
    return {
      name: "workspace-config",
      ok: true,
      detail: `Workspace config detected at ${configFile}`
    };
  } catch {
    return {
      name: "workspace-config",
      ok: false,
      detail: "workspace not initialized – run setup first"
    };
  }
}

async function runDiskFreeSpaceCheck(workspaceRoot: string): Promise<DoctorCheck> {
  try {
    const stats = await fs.statfs(workspaceRoot);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const availableMb = Math.floor(availableBytes / (1024 * 1024));
    if (availableBytes < MINIMUM_DOCTOR_FREE_SPACE_BYTES) {
      return {
        name: "disk-free-space",
        ok: true,
        status: "warn",
        detail: `Low disk space: ${availableMb} MB available (minimum recommended: 500 MB).`
      };
    }
    return {
      name: "disk-free-space",
      ok: true,
      detail: `Disk space looks healthy: ${availableMb} MB available.`
    };
  } catch (error) {
    return {
      name: "disk-free-space",
      ok: false,
      detail: `Could not determine available disk space: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function readCurrentNodeVersion(): string {
  return process.versions.node;
}

function runNodeVersionCheck(nodeVersion: string): DoctorCheck {
  const majorVersion = Number.parseInt(nodeVersion.split(".")[0] || "0", 10);
  if (!Number.isFinite(majorVersion) || majorVersion < 18) {
    return {
      name: "node-version",
      ok: true,
      status: "warn",
      detail: `Node.js ${nodeVersion} detected. Upgrade to Node.js 18 or newer before running research workflows.`
    };
  }
  return {
    name: "node-version",
    ok: true,
    detail: `Node.js ${nodeVersion} detected.`
  };
}

export function buildDoctorHighlightLines(report: DoctorReport): string[] {
  const lines: string[] = [];
  const profileMark = report.readiness.blocked
    ? "[ATTN]"
    : report.readiness.warningChecks.length > 0
      ? "[WARN]"
      : "[OK]";
  const isolationLabel = report.readiness.candidateIsolation || "not-configured";
  lines.push(
    `${profileMark} profile: llm=${report.readiness.llmMode || "unknown"}, `
      + `pdf=${report.readiness.pdfAnalysisMode || "unknown"}, `
      + `dependency=${report.readiness.dependencyMode}, isolation=${isolationLabel}.`
  );
  const networkCheck = report.checks.find((check) => check.name === "experiment-web-restriction");
  const networkStatus = networkCheck ? getDoctorCheckStatus(networkCheck) : undefined;
  if (networkStatus === "warning") {
    if (report.readiness.networkPolicy === "required") {
      lines.push(
        `[ATTN] required network dependency: ${report.readiness.networkPurpose || "unspecified"}. ` +
        "Treat this run as network-assisted and keep explicit operator review in the loop."
      );
    } else if (report.readiness.networkPolicy === "declared") {
      lines.push(
        `[WARN] declared network dependency: ${report.readiness.networkPurpose || "unspecified"}. ` +
        "Results should remain auditable as a network-assisted run."
      );
    }
  }
  const providerFailures = report.readiness.failedChecks.filter((check) =>
    check === "openai-api-key"
      || check === "codex-cli"
      || check === "codex-login"
      || check.startsWith("ollama-")
      || check === "python"
      || check === "pip"
      || check === "latex"
      || check === "pdftotext"
      || check === "pdfinfo"
      || check === "pdftoppm"
  );
  if (providerFailures.length > 0) {
    lines.push(`[ATTN] provider/runtime blockers: ${providerFailures.join(", ")}.`);
  }
  const degradedChecks = report.readiness.warningChecks.filter((check) => check !== "experiment-web-restriction");
  if (degradedChecks.length > 0) {
    lines.push(`[WARN] degraded checks: ${degradedChecks.join(", ")}.`);
  }
  const pageBudgetCheck = report.checks.find((check) => check.name === "paper-page-budget");
  if (pageBudgetCheck) {
    lines.push(
      `${pageBudgetCheck.ok ? "[OK]" : "[ATTN]"} paper page budget: ${pageBudgetCheck.detail}`
    );
  }
  return lines;
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

export function getDoctorCheckStatus(check: { ok: boolean; status?: DoctorCheckStatus }): DoctorCheckStatus {
  if (check.status === "warn") {
    return "warning";
  }
  return check.status || (check.ok ? "ok" : "fail");
}

function normalizeDoctorCheck(check: DoctorCheck): DoctorCheck {
  const status = getDoctorCheckStatus(check);
  return {
    ...check,
    status,
    ok: status !== "fail",
    check: check.check || check.name,
    message: check.message || check.detail
  };
}

export function mapDoctorCheckForApi(check: DoctorCheck): DoctorCheck {
  const normalizedStatus = getDoctorCheckStatus(check);
  return {
    ...check,
    status: normalizedStatus === "warning" ? "warn" : normalizedStatus,
    ok: normalizedStatus !== "fail",
    check: check.check || check.name,
    message: check.message || check.detail
  };
}

export function getDoctorAggregateStatus(input: {
  checks: DoctorCheck[];
  harness?: HarnessValidationReport;
}): DoctorAggregateStatus {
  const mappedChecks = input.checks.map((check) => mapDoctorCheckForApi(check));
  if (mappedChecks.some((check) => check.status === "fail") || input.harness?.status === "fail") {
    return "fail";
  }
  if (mappedChecks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "ok";
}

function resolveExperimentWebRestrictionStatus(input: {
  webRestrictionRequired: boolean;
  allowNetwork: boolean;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
  networkDeclarationPresent: boolean;
  networkApprovalSatisfied: boolean;
}): DoctorCheckStatus {
  if (!input.webRestrictionRequired || !input.allowNetwork) {
    return "ok";
  }
  if (!input.networkDeclarationPresent || !input.networkPolicy || !input.networkPurpose) {
    return "fail";
  }
  if (!input.networkApprovalSatisfied) {
    return "fail";
  }
  return "warning";
}

function buildExperimentWebRestrictionDetail(input: {
  webRestrictionRequired: boolean;
  allowNetwork: boolean;
  networkPolicy?: ExperimentNetworkPolicy;
  networkPurpose?: ExperimentNetworkPurpose;
  networkDeclarationPresent: boolean;
  executionApprovalMode: ExecutionApprovalMode;
}): string {
  if (!input.webRestrictionRequired) {
    return "Code execution is not expected to need web restriction.";
  }
  if (!input.allowNetwork) {
    return "Code execution is expected and network access remains disabled.";
  }
  if (!input.networkDeclarationPresent || !input.networkPolicy || !input.networkPurpose) {
    return "Code execution is expected and allow_network is enabled, but the run is missing a declared network_policy/network_purpose contract.";
  }
  if (input.executionApprovalMode === "full_auto") {
    return `Code execution declares a ${input.networkPolicy} network dependency for ${input.networkPurpose}, but execution approval mode full_auto is not allowed for network-enabled runs.`;
  }
  if (input.networkPolicy === "required") {
    return `Code execution declares a network-critical dependency for ${input.networkPurpose}; reproducibility caveats and explicit operator review remain required.`;
  }
  return `Code execution declares a network dependency for ${input.networkPurpose}; keep the run in manual or risk_ack mode and treat the result as network-assisted.`;
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
