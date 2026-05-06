#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const validationRoot = process.env.AUTOLABOS_VALIDATION_WORKSPACE_ROOT
  ? resolve(process.env.AUTOLABOS_VALIDATION_WORKSPACE_ROOT)
  : resolve(repoRoot, "..", ".autolabos-validation");
const workspaceRoot = resolve(process.env.AUTOLABOS_P6_WORKSPACE || join(validationRoot, "p6-paper-ready-live"));
const outDir = resolve(process.env.AUTOLABOS_P6_PREFLIGHT_OUT || join(repoRoot, "outputs", "p6-preflight"));
const briefSource = join(repoRoot, "docs", "status", "p6-paper-ready-validation-brief.md");
const briefRelativePath = join("briefs", "p6-paper-ready-validation-brief.md");
const briefTarget = join(workspaceRoot, briefRelativePath);

const requiredPythonModules = ["torch", "transformers", "datasets", "peft", "trl", "accelerate"];
const optionalPythonModules = ["lm_eval"];
const preferredModelCache = join(
  process.env.HF_HOME || join(process.env.HOME || "", ".cache", "huggingface"),
  "hub",
  "models--Qwen--Qwen2.5-1.5B"
);
const fallbackModelCache = join(
  process.env.HF_HOME || join(process.env.HOME || "", ".cache", "huggingface"),
  "hub",
  "models--TinyLlama--TinyLlama-1.1B-Chat-v1.0"
);
const datasetCacheRoot = join(
  process.env.HF_HOME || join(process.env.HOME || "", ".cache", "huggingface"),
  "datasets"
);
const expectedDatasets = [
  "yahma___alpaca-cleaned",
  "allenai___ai2_arc",
  "ai2_arc",
  "hellaswag",
  "Rowan___hellaswag"
];

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd || repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout || 30_000,
      env: { ...process.env, ...(options.env || {}) }
    });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error.stdout === "string" ? error.stdout.trim() : "",
      stderr: typeof error.stderr === "string" ? error.stderr.trim() : error.message
    };
  }
}

function existsDirectory(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function ensureWorkspace() {
  mkdirSync(join(workspaceRoot, ".autolabos", "runs"), { recursive: true });
  mkdirSync(join(workspaceRoot, ".autolabos", "logs"), { recursive: true });
  mkdirSync(join(workspaceRoot, "briefs"), { recursive: true });
  mkdirSync(outDir, { recursive: true });
  if (!existsSync(join(workspaceRoot, "ISSUES.md"))) {
    writeFileSync(join(workspaceRoot, "ISSUES.md"), "## Active issues\n\nnone\n", "utf8");
  }
  if (!existsSync(briefSource)) {
    throw new Error(`Missing P6 brief source: ${briefSource}`);
  }
  copyFileSync(briefSource, briefTarget);
  writeFileSync(
    join(workspaceRoot, ".autolabos", "config.yaml"),
    [
      "version: 1",
      "project_name: p6-paper-ready-validation",
      "providers:",
      "  llm_mode: codex_chatgpt_only",
      "  codex:",
      "    model: gpt-5.4",
      "    chat_model: gpt-5.4",
      "    experiment_model: gpt-5.4",
      "    reasoning_effort: high",
      "    chat_reasoning_effort: medium",
      "    experiment_reasoning_effort: high",
      "    auth_required: true",
      "    fast_mode: false",
      "  openai:",
      "    model: gpt-5.4",
      "    chat_model: gpt-5.4",
      "    experiment_model: gpt-5.4",
      "    reasoning_effort: medium",
      "    chat_reasoning_effort: medium",
      "    experiment_reasoning_effort: high",
      "    api_key_required: true",
      "analysis:",
      "  responses_model: gpt-5.4",
      "papers:",
      "  max_results: 80",
      "  per_second_limit: 1",
      "research:",
      "  default_topic: PEFT LoRA rank dropout interaction",
      "  default_constraints:",
      "    - fixed instruction-tuning budget",
      "    - explicit baseline and comparator result table",
      "  default_objective_metric: ARC-Challenge and HellaSwag average accuracy",
      "workflow:",
      "  mode: agent_approval",
      "  wizard_enabled: true",
      "  approval_mode: manual",
      "  execution_approval_mode: manual",
      "experiments:",
      "  runner: local_python",
      "  timeout_sec: 14400",
      "  network_policy: declared",
      "  network_purpose: model_download",
      "  candidate_isolation: attempt_snapshot_restore",
      "paper:",
      "  template: acl",
      "  build_pdf: true",
      "  latex_engine: auto_install",
      "  validation_mode: strict_paper",
      "paths:",
      "  runs_dir: .autolabos/runs",
      "  logs_dir: .autolabos/logs",
      ""
    ].join("\n"),
    "utf8"
  );
}

function pythonModuleReport() {
  const code = `
import importlib.util, json
mods = ${JSON.stringify([...requiredPythonModules, ...optionalPythonModules])}
report = {m: bool(importlib.util.find_spec(m)) for m in mods}
try:
    import torch
    report["torch_cuda_available"] = bool(torch.cuda.is_available())
    report["torch_cuda_device_count"] = int(torch.cuda.device_count())
    report["torch_cuda_names"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
except Exception as exc:
    report["torch_cuda_error"] = str(exc)
print(json.dumps(report, sort_keys=True))
`;
  const result = run("python3", ["-c", code], { timeout: 60_000 });
  if (!result.ok) {
    return { ok: false, error: result.stderr || result.stdout };
  }
  try {
    return { ok: true, ...(JSON.parse(result.stdout) || {}) };
  } catch (error) {
    return { ok: false, error: error.message, raw: result.stdout };
  }
}

async function doctorReport() {
  const doctorModulePath = join(repoRoot, "dist", "core", "doctor.js");
  if (!existsSync(doctorModulePath)) {
    return { available: false, status: "fail", reason: "dist/core/doctor.js is missing; run npm run build first." };
  }
  const { runDoctorReport, getDoctorAggregateStatus, mapDoctorCheckForApi } = await import(doctorModulePath);
  const report = await runDoctorReport(
    {},
    {
      llmMode: "codex_chatgpt_only",
      pdfAnalysisMode: "codex_text_image_hybrid",
      codexResearchModel: "gpt-5.4",
      workspaceRoot,
      approvalMode: "manual",
      executionApprovalMode: "manual",
      dependencyMode: "local_python",
      sessionMode: "fresh",
      codeExecutionExpected: true,
      candidateIsolation: "attempt_snapshot_restore",
      networkPolicy: "declared",
      networkPurpose: "model_download",
      includeHarnessValidation: true,
      includeHarnessTestRecords: false,
      maxHarnessFindings: 30,
      researchBriefPath: briefRelativePath
    }
  );
  const checks = report.checks.map((check) => mapDoctorCheckForApi(check));
  return {
    available: true,
    status: getDoctorAggregateStatus({ checks: report.checks, harness: report.harness }),
    readiness: report.readiness,
    checks,
    harness: report.harness
  };
}

function buildChecks({ pythonReport, doctor }) {
  const preferredModelCached = existsDirectory(preferredModelCache);
  const fallbackModelCached = existsDirectory(fallbackModelCache);
  const datasetDirs = expectedDatasets.filter((name) => existsDirectory(join(datasetCacheRoot, name)));
  const alpacaCached = datasetDirs.includes("yahma___alpaca-cleaned");
  const arcCached = datasetDirs.includes("allenai___ai2_arc") || datasetDirs.includes("ai2_arc");
  const hellaswagCached = datasetDirs.includes("hellaswag") || datasetDirs.includes("Rowan___hellaswag");
  const commands = {
    node: run("node", ["--version"]),
    npm: run("npm", ["--version"]),
    python3: run("python3", ["--version"]),
    pip3: run("pip3", ["--version"]),
    nvidiaSmi: run("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"]),
    expect: run("expect", ["-v"]),
    disk: run("df", ["-h", workspaceRoot]),
    memory: run("free", ["-h"])
  };
  const requiredModulesOk = requiredPythonModules.every((name) => pythonReport[name] === true);
  const cudaOk = pythonReport.torch_cuda_available === true && Number(pythonReport.torch_cuda_device_count || 0) >= 1;
  const checks = [
    {
      id: "validation_workspace_writable",
      ok: existsDirectory(workspaceRoot) && existsDirectory(join(workspaceRoot, ".autolabos", "runs")),
      detail: workspaceRoot
    },
    {
      id: "governed_brief_frozen",
      ok: existsSync(briefTarget),
      detail: briefRelativePath
    },
    {
      id: "node_runtime",
      ok: commands.node.ok,
      detail: commands.node.stdout || commands.node.stderr
    },
    {
      id: "python_runtime",
      ok: commands.python3.ok,
      detail: commands.python3.stdout || commands.python3.stderr
    },
    {
      id: "required_python_modules",
      ok: requiredModulesOk,
      detail: requiredPythonModules.map((name) => `${name}=${pythonReport[name] === true ? "yes" : "no"}`).join(", ")
    },
    {
      id: "cuda_visible",
      ok: cudaOk,
      detail: pythonReport.torch_cuda_names ? pythonReport.torch_cuda_names.join("; ") : pythonReport.torch_cuda_error || "unknown"
    },
    {
      id: "preferred_or_fallback_model_cached",
      ok: preferredModelCached || fallbackModelCached,
      detail: `preferred=${preferredModelCached ? "yes" : "no"}, fallback=${fallbackModelCached ? "yes" : "no"}`
    },
    {
      id: "datasets_cached",
      ok: alpacaCached && arcCached && hellaswagCached,
      detail: `alpaca=${alpacaCached ? "yes" : "no"}, arc=${arcCached ? "yes" : "no"}, hellaswag=${hellaswagCached ? "yes" : "no"}`
    },
    {
      id: "evaluator_available",
      ok: pythonReport.lm_eval === true,
      severity: pythonReport.lm_eval === true ? "ok" : "warn",
      detail: pythonReport.lm_eval === true
        ? "lm_eval module available"
        : "lm_eval is not installed; P6 must use a node-owned local evaluator or install the external harness before a paper-ready claim."
    },
    {
      id: "tty_automation_available",
      ok: commands.expect.ok,
      severity: commands.expect.ok ? "ok" : "warn",
      detail: commands.expect.ok
        ? commands.expect.stdout || commands.expect.stderr
        : "expect is unavailable; Python PTY fallback is required for automated TUI validation."
    },
    {
      id: "doctor_engine",
      ok: doctor.available === true && doctor.status !== "fail",
      detail: doctor.available ? `doctor status=${doctor.status}` : doctor.reason
    }
  ];
  return { checks, commands };
}

function markdownReport(summary) {
  const requiredBlockers = summary.checks
    .filter((check) => check.ok !== true && check.severity !== "warn")
    .map((check) => check.id);
  const warnings = summary.checks
    .filter((check) => check.ok !== true && check.severity === "warn")
    .map((check) => check.id);
  return [
    "# P6 Preflight Report",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Verdict",
    "",
    `- Ready for full live run: ${summary.readyForFullLiveRun ? "yes" : "no"}`,
    `- Required blockers: ${requiredBlockers.length ? requiredBlockers.join(", ") : "none"}`,
    `- Warnings: ${warnings.length ? warnings.join(", ") : "none"}`,
    "",
    "## Workspace",
    "",
    `- Validation workspace: <validation-workspace>/p6-paper-ready-live`,
    `- Brief: ${summary.briefRelativePath}`,
    "",
    "## Checks",
    "",
    ...summary.checks.map((check) => `- ${check.ok ? "PASS" : check.severity === "warn" ? "WARN" : "FAIL"} ${check.id}: ${check.detail}`),
    "",
    "## Doctor",
    "",
    `- Status: ${summary.doctor.status || "unavailable"}`,
    `- Blocked: ${summary.doctor.readiness?.blocked === true ? "yes" : summary.doctor.readiness?.blocked === false ? "no" : "unknown"}`,
    "",
    "## Next Action",
    "",
    summary.readyForFullLiveRun
      ? "Start the P6 live run from the validation workspace after running the TUI `/doctor` surface."
      : "Resolve required blockers before starting the full live run. Warnings may be accepted only if the brief and audit ceiling explicitly account for them.",
    ""
  ].join("\n");
}

async function main() {
  ensureWorkspace();
  const pythonReport = pythonModuleReport();
  const doctor = await doctorReport();
  const { checks, commands } = buildChecks({ pythonReport, doctor });
  const requiredBlockers = checks.filter((check) => check.ok !== true && check.severity !== "warn");
  const summary = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    validationRoot,
    workspaceRoot,
    outDir,
    briefSource,
    briefRelativePath,
    briefTarget,
    pythonReport,
    commands,
    doctor,
    checks,
    readyForFullLiveRun: requiredBlockers.length === 0
  };
  writeFileSync(join(outDir, "preflight-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "preflight-report.md"), markdownReport(summary), "utf8");
  process.stdout.write(`P6 preflight ready=${summary.readyForFullLiveRun ? "yes" : "no"}\n`);
  process.stdout.write(`Report: outputs/p6-preflight/preflight-report.md\n`);
  if (requiredBlockers.length > 0) {
    process.stdout.write(`Blockers: ${requiredBlockers.map((check) => check.id).join(", ")}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
