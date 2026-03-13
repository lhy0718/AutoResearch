import { spawn } from "node:child_process";

import { DoctorCheck } from "../types.js";
import { CodexCliClient } from "../integrations/codex/codexCliClient.js";
import { RECOMMENDED_CODEX_MODEL } from "../integrations/codex/modelCatalog.js";

export async function runDoctor(
  codex: CodexCliClient,
  opts?: {
    llmMode?: "codex_chatgpt_only" | "openai_api";
    pdfAnalysisMode?: "codex_text_image_hybrid" | "responses_api_pdf";
    openAiApiKeyConfigured?: boolean;
    codexResearchModel?: string;
    codexPdfModel?: string;
  }
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

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

  if (opts?.llmMode === "codex_chatgpt_only" && opts.codexResearchModel) {
    checks.push(buildCodexModelCheck("codex-research-model", "research", opts.codexResearchModel));
  }
  if (opts?.pdfAnalysisMode === "codex_text_image_hybrid" && opts.codexPdfModel) {
    checks.push(buildCodexModelCheck("codex-pdf-model", "PDF analysis", opts.codexPdfModel));
  }

  checks.push(await runBinaryCheck("python3", ["--version"], "python"));
  checks.push(await runBinaryCheck("pip3", ["--version"], "pip"));
  checks.push(await runBinaryCheck("pdflatex", ["--version"], "latex"));
  if (opts?.pdfAnalysisMode === "codex_text_image_hybrid") {
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

  return checks;
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
