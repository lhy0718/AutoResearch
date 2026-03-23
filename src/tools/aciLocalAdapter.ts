import path from "node:path";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { setPriority as setProcessPriority } from "node:os";

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
    return runShell(command, cwd, signal, this.options.allowNetwork === true);
  }

  async runTests(command: string, cwd?: string, signal?: AbortSignal): Promise<AciObservation> {
    const decision = evaluateCommandPolicy(command, {
      scope: "tests",
      allowNetwork: this.options.allowNetwork === true
    });
    if (!decision.allowed) {
      return blockedObservation(decision);
    }
    return runShell(command, cwd, signal, this.options.allowNetwork === true);
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
    if (isMissingCommand(obs, "rg")) {
      return fallbackSearchCode(query, cwd, limit, globs);
    }
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
    if (isMissingCommand(obs, "rg")) {
      return fallbackFindSymbol(symbol, cwd, limit, globs);
    }
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
    if (isMissingCommand(obs, "rg")) {
      return fallbackListFiles(cwd, limit, globs);
    }
    return limitLines(obs, limit);
  }
}

function runShell(
  command: string,
  cwd?: string,
  signal?: AbortSignal,
  allowNetwork = false
): Promise<AciObservation> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", command], {
      cwd: cwd || process.cwd(),
      env: buildManagedExecutionEnv(process.env, allowNetwork),
      stdio: ["ignore", "pipe", "pipe"],
      signal
    });
    lowerChildPriority(child.pid);

    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        status: "error",
        stderr: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - started
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
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

function buildManagedExecutionEnv(baseEnv: NodeJS.ProcessEnv, allowNetwork: boolean): NodeJS.ProcessEnv {
  const managedEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    OMP_NUM_THREADS: baseEnv.OMP_NUM_THREADS || "1",
    MKL_NUM_THREADS: baseEnv.MKL_NUM_THREADS || "1",
    OPENBLAS_NUM_THREADS: baseEnv.OPENBLAS_NUM_THREADS || "1",
    NUMEXPR_NUM_THREADS: baseEnv.NUMEXPR_NUM_THREADS || "1",
    TOKENIZERS_PARALLELISM: baseEnv.TOKENIZERS_PARALLELISM || "false",
    MALLOC_ARENA_MAX: baseEnv.MALLOC_ARENA_MAX || "2"
  };

  if (!allowNetwork) {
    managedEnv.HF_HUB_OFFLINE = baseEnv.HF_HUB_OFFLINE || "1";
    managedEnv.TRANSFORMERS_OFFLINE = baseEnv.TRANSFORMERS_OFFLINE || "1";
    managedEnv.HF_DATASETS_OFFLINE = baseEnv.HF_DATASETS_OFFLINE || "1";
  }

  return managedEnv;
}

function lowerChildPriority(pid?: number): void {
  if (typeof pid !== "number" || pid <= 0) {
    return;
  }
  try {
    setProcessPriority(pid, 10);
  } catch {
    // Best-effort only: command execution should continue even when niceness cannot be changed.
  }
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

function isMissingCommand(obs: AciObservation, command: string): boolean {
  return obs.status === "error" && typeof obs.stderr === "string" && obs.stderr.includes(`spawn ${command} ENOENT`);
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

async function fallbackSearchCode(
  query: string,
  cwd?: string,
  limit = 20,
  globs = defaultCodeGlobs()
): Promise<AciObservation> {
  const started = Date.now();
  try {
    const workspaceRoot = cwd || process.cwd();
    const files = await collectFallbackFiles(workspaceRoot, globs);
    const matches: string[] = [];
    const artifacts = new Set<string>();
    const matcher = buildFixedStringMatcher(query);

    for (const relativePath of files) {
      const filePath = path.join(workspaceRoot, relativePath);
      const text = await safeReadText(filePath);
      if (text === undefined) {
        continue;
      }
      let matchesInFile = 0;
      for (const [index, line] of text.split(/\r?\n/u).entries()) {
        if (!matcher(line)) {
          continue;
        }
        matches.push(`${relativePath}:${index + 1}:${line.slice(0, 220)}`);
        artifacts.add(filePath);
        matchesInFile += 1;
        if (matches.length >= limit || matchesInFile >= 3) {
          break;
        }
      }
      if (matches.length >= limit) {
        break;
      }
    }

    return {
      status: "ok",
      stdout: matches.join("\n"),
      artifacts: [...artifacts],
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

async function fallbackFindSymbol(
  symbol: string,
  cwd?: string,
  limit = 20,
  globs = defaultCodeGlobs()
): Promise<AciObservation> {
  const started = Date.now();
  try {
    const workspaceRoot = cwd || process.cwd();
    const files = await collectFallbackFiles(workspaceRoot, globs);
    const matches: string[] = [];
    const artifacts = new Set<string>();
    const regex = new RegExp(buildSymbolPattern(symbol), hasUppercase(symbol) ? "u" : "iu");

    for (const relativePath of files) {
      const filePath = path.join(workspaceRoot, relativePath);
      const text = await safeReadText(filePath);
      if (text === undefined) {
        continue;
      }
      for (const [index, line] of text.split(/\r?\n/u).entries()) {
        if (!regex.test(line)) {
          continue;
        }
        matches.push(`${relativePath}:${index + 1}:${line.slice(0, 220)}`);
        artifacts.add(filePath);
        if (matches.length >= limit) {
          break;
        }
      }
      if (matches.length >= limit) {
        break;
      }
    }

    return {
      status: "ok",
      stdout: matches.join("\n"),
      artifacts: [...artifacts],
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

async function fallbackListFiles(
  cwd?: string,
  limit = 200,
  globs = defaultCodeGlobs()
): Promise<AciObservation> {
  const started = Date.now();
  try {
    const workspaceRoot = cwd || process.cwd();
    const files = await collectFallbackFiles(workspaceRoot, globs);
    return {
      status: "ok",
      stdout: files.slice(0, Math.max(0, limit)).join("\n"),
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

async function collectFallbackFiles(workspaceRoot: string, globs: string[]): Promise<string[]> {
  const includeGlobs = globs.filter((glob) => !glob.startsWith("!"));
  const excludeGlobs = globs
    .filter((glob) => glob.startsWith("!"))
    .map((glob) => glob.slice(1));
  const files: string[] = [];

  async function walk(relativeDir = ""): Promise<void> {
    const currentDir = relativeDir ? path.join(workspaceRoot, relativeDir) : workspaceRoot;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = normalizeRelativePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
      if (entry.isDirectory()) {
        if (matchesAnyGlob(relativePath, excludeGlobs)) {
          continue;
        }
        await walk(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (matchesAnyGlob(relativePath, excludeGlobs)) {
        continue;
      }
      if (includeGlobs.length > 0 && !matchesAnyGlob(relativePath, includeGlobs)) {
        continue;
      }
      files.push(relativePath);
    }
  }

  await walk();
  return files;
}

function matchesAnyGlob(relativePath: string, globs: string[]): boolean {
  return globs.some((glob) => matchesGlob(relativePath, glob));
}

function matchesGlob(relativePath: string, glob: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedGlob = normalizeRelativePath(glob);

  if (!normalizedGlob.includes("*")) {
    return (
      normalizedPath === normalizedGlob ||
      normalizedPath.startsWith(`${normalizedGlob}/`) ||
      normalizedPath.split("/").includes(normalizedGlob)
    );
  }

  const target = normalizedGlob.includes("/") ? normalizedPath : path.posix.basename(normalizedPath);
  return globToRegExp(normalizedGlob).test(target);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`, "u");
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function buildFixedStringMatcher(query: string): (line: string) => boolean {
  if (hasUppercase(query)) {
    return (line) => line.includes(query);
  }
  const lowerQuery = query.toLowerCase();
  return (line) => line.toLowerCase().includes(lowerQuery);
}

function hasUppercase(value: string): boolean {
  return /[A-Z]/u.test(value);
}

async function safeReadText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
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
