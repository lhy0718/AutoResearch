import { NodeOptionPackageName } from "../types.js";

export type CliAction =
  | { kind: "run"; packageName?: NodeOptionPackageName }
  | { kind: "web"; host?: string; port?: number }
  | { kind: "compare-analysis"; runId: string; limit: number; judge: boolean }
  | { kind: "eval-harness"; runIds: string[]; limit: number; outputPath?: string; noHistory?: boolean }
  | { kind: "evolve"; maxCycles: number; target: "skills" | "prompts" | "all"; dryRun: boolean }
  | { kind: "meta-harness"; runs: number; nodes: ("analyze_results" | "review")[]; noApply: boolean; dryRun: boolean }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export function resolveCliAction(args: string[]): CliAction {
  if (args.length === 0) {
    return { kind: "run" };
  }

  const packageParse = parseRunPackageArgs(args);
  if (packageParse) {
    return packageParse;
  }

  const first = args[0];
  if (first === "--help" || first === "-h") {
    return { kind: "help" };
  }

  if (first === "--version" || first === "-v") {
    return { kind: "version" };
  }

  if (first === "web") {
    let host: string | undefined;
    let port: number | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--host") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --host." };
        }
        host = value;
        index += 1;
        continue;
      }
      if (token === "--port") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --port." };
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return { kind: "error", message: `Invalid port: ${value}` };
        }
        port = Math.floor(parsed);
        index += 1;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported web argument: ${token}`
      };
    }
    return { kind: "web", host, port };
  }

  if (first === "compare-analysis") {
    let runId: string | undefined;
    let limit = 3;
    let judge = true;
    for (let index = 1; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--run") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --run." };
        }
        runId = value;
        index += 1;
        continue;
      }
      if (token === "--limit") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --limit." };
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return { kind: "error", message: `Invalid limit: ${value}` };
        }
        limit = Math.floor(parsed);
        index += 1;
        continue;
      }
      if (token === "--no-judge") {
        judge = false;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported compare-analysis argument: ${token}`
      };
    }
    if (!runId) {
      return { kind: "error", message: "Missing required argument: --run <run-id>." };
    }
    return { kind: "compare-analysis", runId, limit, judge };
  }

  if (first === "eval-harness") {
    const runIds: string[] = [];
    let limit = 10;
    let outputPath: string | undefined;
    let noHistory = false;
    for (let index = 1; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--run") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --run." };
        }
        runIds.push(value);
        index += 1;
        continue;
      }
      if (token === "--limit") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --limit." };
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return { kind: "error", message: `Invalid limit: ${value}` };
        }
        limit = Math.floor(parsed);
        index += 1;
        continue;
      }
      if (token === "--output") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --output." };
        }
        outputPath = value;
        index += 1;
        continue;
      }
      if (token === "--no-history") {
        noHistory = true;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported eval-harness argument: ${token}`
      };
    }
    return { kind: "eval-harness", runIds, limit, outputPath, noHistory };
  }

  if (first === "evolve") {
    let maxCycles = 3;
    let target: "skills" | "prompts" | "all" = "all";
    let dryRun = false;
    for (let index = 1; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--max-cycles") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --max-cycles." };
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return { kind: "error", message: `Invalid max cycle count: ${value}` };
        }
        maxCycles = Math.floor(parsed);
        index += 1;
        continue;
      }
      if (token === "--target") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --target." };
        }
        if (value !== "skills" && value !== "prompts" && value !== "all") {
          return {
            kind: "error",
            message: `Unsupported evolve target: ${value}. Expected one of skills, prompts, all.`
          };
        }
        target = value;
        index += 1;
        continue;
      }
      if (token === "--dry-run") {
        dryRun = true;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported evolve argument: ${token}`
      };
    }
    return { kind: "evolve", maxCycles, target, dryRun };
  }

  if (first === "meta-harness") {
    let runs = 5;
    const nodes: ("analyze_results" | "review")[] = [];
    let noApply = false;
    let dryRun = false;
    for (let index = 1; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--runs") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --runs." };
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return { kind: "error", message: `Invalid run count: ${value}` };
        }
        runs = Math.floor(parsed);
        index += 1;
        continue;
      }
      if (token === "--node") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --node." };
        }
        if (value !== "analyze_results" && value !== "review") {
          return {
            kind: "error",
            message: `Unsupported meta-harness node: ${value}. Expected analyze_results or review.`
          };
        }
        nodes.push(value);
        index += 1;
        continue;
      }
      if (token === "--no-apply") {
        noApply = true;
        continue;
      }
      if (token === "--dry-run") {
        dryRun = true;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported meta-harness argument: ${token}`
      };
    }
    return {
      kind: "meta-harness",
      runs,
      nodes: nodes.length > 0 ? nodes : ["analyze_results", "review"],
      noApply,
      dryRun
    };
  }

  return {
    kind: "error",
    message:
      "Unsupported CLI arguments. Run `autolabos`, `autolabos web`, `autolabos compare-analysis`, `autolabos eval-harness`, `autolabos evolve`, `autolabos meta-harness`, or use slash commands inside the TUI."
  };
}

const VALID_NODE_OPTION_PACKAGES: NodeOptionPackageName[] = ["fast", "thorough", "paper_scale"];

function parseRunPackageArgs(args: string[]): CliAction | undefined {
  if (args[0] !== "--package") {
    return undefined;
  }

  const packageName = args[1];
  if (!packageName) {
    return { kind: "error", message: "Missing value for --package." };
  }

  if (!isNodeOptionPackageName(packageName)) {
    return {
      kind: "error",
      message: `Unsupported package: ${packageName}. Expected one of ${VALID_NODE_OPTION_PACKAGES.join(", ")}.`
    };
  }

  if (args.length > 2) {
    return {
      kind: "error",
      message: `Unsupported run argument: ${args[2]}`
    };
  }

  return { kind: "run", packageName };
}

function isNodeOptionPackageName(value: string): value is NodeOptionPackageName {
  return VALID_NODE_OPTION_PACKAGES.includes(value as NodeOptionPackageName);
}
