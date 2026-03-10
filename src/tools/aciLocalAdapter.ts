import path from "node:path";
import { exec, spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import { AgentComputerInterface, AciAction, AciObservation } from "./aci.js";
import { evaluateCommandPolicy, formatPolicyBlockMessage } from "./commandPolicy.js";
import { ensureDir } from "../utils/fs.js";

export interface LocalAciAdapterOptions {
  allowNetwork?: boolean;
}

export class LocalAciAdapter implements AgentComputerInterface {
  constructor(private readonly options: LocalAciAdapterOptions = {}) {}

  async perform(action: AciAction): Promise<AciObservation> {
    switch (action.type) {
      case "read_file":
        return this.readFile(String(action.input.path || ""));
      case "write_file":
        return this.writeFile(String(action.input.path || ""), String(action.input.content || ""));
      case "apply_patch":
        return this.applyPatch(String(action.input.diff || ""), asString(action.input.cwd));
      case "run_command":
        return this.runCommand(String(action.input.command || ""), asString(action.input.cwd));
      case "run_tests":
        return this.runTests(String(action.input.command || ""), asString(action.input.cwd));
      case "tail_logs":
        return this.tailLogs(String(action.input.path || ""), Number(action.input.lines || 40));
      case "search_code":
        return this.searchCode(
          String(action.input.query || ""),
          asString(action.input.cwd),
          asNumber(action.input.limit),
          asStringArray(action.input.globs)
        );
      case "find_symbol":
        return this.findSymbol(
          String(action.input.symbol || ""),
          asString(action.input.cwd),
          asNumber(action.input.limit),
          asStringArray(action.input.globs)
        );
      case "list_files":
        return this.listFiles(
          asString(action.input.cwd),
          asNumber(action.input.limit),
          asStringArray(action.input.globs)
        );
      default:
        return {
          status: "error",
          stderr: `Unsupported action: ${action.type}`,
          duration_ms: 0
        };
    }
  }

  async readFile(filePath: string): Promise<AciObservation> {
    const started = Date.now();
    try {
      const text = await fs.readFile(filePath, "utf8");
      return {
        status: "ok",
        stdout: text,
        artifacts: [filePath],
        duration_ms: Date.now() - started
      };
    } catch (error) {
      return {
        status: "error",
        stderr: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - started
      };
    }
  }

  async writeFile(filePath: string, content: string): Promise<AciObservation> {
    const started = Date.now();
    try {
      await ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, "utf8");
      return {
        status: "ok",
        artifacts: [filePath],
        duration_ms: Date.now() - started
      };
    } catch (error) {
      return {
        status: "error",
        stderr: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - started
      };
    }
  }

  async applyPatch(diff: string, cwd?: string): Promise<AciObservation> {
    const started = Date.now();
    if (!diff.trim()) {
      return {
        status: "error",
        stderr: "Empty diff",
        duration_ms: Date.now() - started
      };
    }

    // Minimal local adapter behavior: persist patch file for auditability.
    const patchPath = path.join(cwd || process.cwd(), `.autolabos/tmp_patch_${Date.now()}.diff`);
    await ensureDir(path.dirname(patchPath));
    await fs.writeFile(patchPath, diff, "utf8");
    return {
      status: "ok",
      stdout: "Patch recorded for review",
      artifacts: [patchPath],
      duration_ms: Date.now() - started
    };
  }

  async runCommand(command: string, cwd?: string, signal?: AbortSignal): Promise<AciObservation> {
    const decision = evaluateCommandPolicy(command, {
      scope: "command",
      allowNetwork: this.options.allowNetwork === true
    });
    if (!decision.allowed) {
      return blockedObservation(decision);
    }
    return runShell(command, cwd, signal);
  }

  async runTests(command: string, cwd?: string, signal?: AbortSignal): Promise<AciObservation> {
    const decision = evaluateCommandPolicy(command, {
      scope: "tests",
      allowNetwork: this.options.allowNetwork === true
    });
    if (!decision.allowed) {
      return blockedObservation(decision);
    }
    return runShell(command, cwd, signal);
  }

  async tailLogs(filePath: string, lines = 40): Promise<AciObservation> {
    const started = Date.now();
    try {
      const text = await fs.readFile(filePath, "utf8");
      const out = text.split("\n").slice(-Math.max(1, lines)).join("\n");
      return {
        status: "ok",
        stdout: out,
        artifacts: [filePath],
        duration_ms: Date.now() - started
      };
    } catch (error) {
      return {
        status: "error",
        stderr: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - started
      };
    }
  }

  async searchCode(
    query: string,
    cwd?: string,
    limit = 20,
    globs = defaultCodeGlobs()
  ): Promise<AciObservation> {
    if (!query.trim()) {
      return {
        status: "error",
        stderr: "Empty search query",
        duration_ms: 0
      };
    }

    const obs = await runProcess(
      "rg",
      [
        "--line-number",
        "--no-heading",
        "--hidden",
        "--no-messages",
        "--color",
        "never",
        "--smart-case",
        "--fixed-strings",
        "--max-count",
        "3",
        ...buildGlobArgs(globs),
        query
      ],
      cwd
    );
    return limitLines(obs, limit);
  }

  async findSymbol(
    symbol: string,
    cwd?: string,
    limit = 20,
    globs = defaultCodeGlobs()
  ): Promise<AciObservation> {
    if (!symbol.trim()) {
      return {
        status: "error",
        stderr: "Empty symbol query",
        duration_ms: 0
      };
    }

    const obs = await runProcess(
      "rg",
      [
        "--line-number",
        "--no-heading",
        "--hidden",
        "--no-messages",
        "--color",
        "never",
        "--smart-case",
        "-e",
        buildSymbolPattern(symbol),
        ...buildGlobArgs(globs)
      ],
      cwd
    );
    return limitLines(obs, limit);
  }

  async listFiles(
    cwd?: string,
    limit = 200,
    globs = defaultCodeGlobs()
  ): Promise<AciObservation> {
    const obs = await runProcess(
      "rg",
      [
        "--files",
        "--hidden",
        ...buildGlobArgs(globs)
      ],
      cwd
    );
    return limitLines(obs, limit);
  }
}

function runShell(command: string, cwd?: string, signal?: AbortSignal): Promise<AciObservation> {
  const started = Date.now();
  return new Promise((resolve) => {
    exec(command, {
      cwd: cwd || process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 16,
      signal
    }, (error, stdout, stderr) => {
      resolve({
        status: error ? "error" : "ok",
        stdout,
        stderr,
        exit_code: error && typeof (error as { code?: number }).code === "number"
          ? (error as { code: number }).code
          : 0,
        duration_ms: Date.now() - started
      });
    });
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function defaultCodeGlobs(): string[] {
  return [
    "*.ts",
    "*.tsx",
    "*.js",
    "*.jsx",
    "*.mjs",
    "*.cjs",
    "*.json",
    "*.yaml",
    "*.yml",
    "*.md",
    "*.py",
    "*.sh",
    "!.git",
    "!node_modules",
    "!dist",
    "!.autolabos",
    "!web/dist",
    "!coverage"
  ];
}

function buildGlobArgs(globs: string[]): string[] {
  return globs.flatMap((glob) => ["--glob", glob]);
}

function buildSymbolPattern(symbol: string): string {
  const escaped = escapeRegex(symbol.trim());
  return [
    `\\b(?:class|def|function|interface|type|enum)\\s+${escaped}\\b`,
    `\\b(?:const|let|var)\\s+${escaped}\\b`,
    `\\b${escaped}\\s*[:=]\\s*(?:async\\s*)?\\(`,
    `\\b${escaped}\\b`
  ].join("|");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function limitLines(obs: AciObservation, limit: number): AciObservation {
  if (obs.status !== "ok" || !obs.stdout || limit <= 0) {
    return obs;
  }
  const lines = obs.stdout
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, limit);
  return {
    ...obs,
    stdout: lines.join("\n")
  };
}

function runProcess(
  command: string,
  args: string[],
  cwd?: string,
  signal?: AbortSignal
): Promise<AciObservation> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({
        status: "error",
        stderr: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - started
      });
    });
    child.on("close", (code) => {
      resolve({
        status: code === 0 ? "ok" : "error",
        stdout,
        stderr,
        exit_code: code ?? 1,
        duration_ms: Date.now() - started
      });
    });
  });
}

function blockedObservation(
  decision: ReturnType<typeof evaluateCommandPolicy>
): AciObservation {
  return {
    status: "error",
    stderr: formatPolicyBlockMessage(decision),
    exit_code: 126,
    policy: decision,
    duration_ms: 0
  };
}
