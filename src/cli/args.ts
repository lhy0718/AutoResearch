import { GovernanceBenchmarkConditionName } from "../core/benchmark/governanceCondition.js";
import { NodeOptionPackageName } from "../types.js";

export type CliAction =
  | { kind: "run"; packageName?: NodeOptionPackageName; benchmarkCondition?: GovernanceBenchmarkConditionName }
  | { kind: "web"; host?: string; port?: number; benchmarkCondition?: GovernanceBenchmarkConditionName }
  | { kind: "compare-analysis"; runId: string; limit: number; judge: boolean }
  | { kind: "eval-harness"; runIds: string[]; limit: number; outputPath?: string; noHistory?: boolean }
  | { kind: "evolve"; maxCycles: number; target: "skills" | "prompts" | "all"; dryRun: boolean }
  | { kind: "governance-benchmark-seed"; sourcePath: string; taskId?: string; outDir?: string; referenceOnly: boolean }
  | { kind: "governance-benchmark-dry-run"; seedPath: string; taskId?: string; outDir?: string; conditions: GovernanceBenchmarkConditionName[] }
  | { kind: "governance-benchmark-batch"; seedsRoot: string; taskIds: string[]; outDir?: string; conditions: GovernanceBenchmarkConditionName[] }
  | { kind: "governance-benchmark-export-bundles"; publicOutputRoots: string[]; outDir?: string; maxBundles?: number }
  | { kind: "audit"; runRoot?: string; seedId?: string; outDir?: string }
  | { kind: "audit-help" }
  | {
      kind: "meta-harness";
      runs: number;
      nodes: ("analyze_results" | "review")[];
      externalRunRoots: string[];
      noApply: boolean;
      dryRun: boolean;
    }
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
    let benchmarkCondition: GovernanceBenchmarkConditionName | undefined;
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
      if (token === "--benchmark-condition") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --benchmark-condition." };
        }
        benchmarkCondition = parseGovernanceBenchmarkCondition(value);
        if (!benchmarkCondition) {
          return { kind: "error", message: `Unsupported governance benchmark condition: ${value}.` };
        }
        index += 1;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported web argument: ${token}`
      };
    }
    return {
      kind: "web",
      ...(host ? { host } : {}),
      ...(port ? { port } : {}),
      ...(benchmarkCondition ? { benchmarkCondition } : {})
    };
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

  if (first === "audit") {
    if (args[1] === "--help" || args[1] === "-h") {
      return { kind: "audit-help" };
    }
    let runRoot: string | undefined;
    let seedId: string | undefined;
    let outDir: string | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--run") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --run." };
        }
        runRoot = value;
        index += 1;
        continue;
      }
      if (token === "--seed") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --seed." };
        }
        seedId = value;
        index += 1;
        continue;
      }
      if (token === "--out-dir") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --out-dir." };
        }
        outDir = value;
        index += 1;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported audit argument: ${token}`
      };
    }
    if (Boolean(runRoot) === Boolean(seedId)) {
      return {
        kind: "error",
        message: "Usage: audit (--run <run-artifact-root> | --seed AGB-001|AGB-003|AGB-010) [--out-dir outputs/audit]."
      };
    }
    return { kind: "audit", runRoot, seedId, outDir };
  }

  if (first === "governance-benchmark") {
    const subcommand = args[1];
    if (subcommand !== "seed" && subcommand !== "dry-run" && subcommand !== "batch" && subcommand !== "export-bundles") {
      return {
        kind: "error",
        message:
          "Usage: governance-benchmark seed --source <path> [--task <id>] [--out-dir outputs/governance-benchmark/seeds] [--reference-only] | governance-benchmark dry-run --seed <path> [--task <id>] [--condition gated|ungated] [--out-dir outputs/governance-benchmark/<task>] | governance-benchmark batch --seeds <path> [--task <id>] [--condition gated|ungated] [--out-dir outputs/governance-benchmark/batch] | governance-benchmark export-bundles --source <outputs/run> [--source <outputs/run>] [--max 3] [--out-dir outputs/governance-benchmark/demo-bundles]."
      };
    }
    if (subcommand === "export-bundles") {
      const publicOutputRoots: string[] = [];
      let outDir: string | undefined;
      let maxBundles: number | undefined;
      for (let index = 2; index < args.length; index += 1) {
        const token = args[index];
        if (token === "--source" || token === "--public-output") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: `Missing value for ${token}.` };
          }
          publicOutputRoots.push(value);
          index += 1;
          continue;
        }
        if (token === "--max") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --max." };
          }
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return { kind: "error", message: `Invalid max: ${value}` };
          }
          maxBundles = Math.floor(parsed);
          index += 1;
          continue;
        }
        if (token === "--out-dir") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --out-dir." };
          }
          outDir = value;
          index += 1;
          continue;
        }
        return {
          kind: "error",
          message: `Unsupported governance-benchmark export-bundles argument: ${token}`
        };
      }
      if (publicOutputRoots.length === 0) {
        return { kind: "error", message: "Missing required argument: --source <outputs/run>." };
      }
      return { kind: "governance-benchmark-export-bundles", publicOutputRoots, outDir, maxBundles };
    }
    if (subcommand === "batch") {
      let seedsRoot: string | undefined;
      let outDir: string | undefined;
      const taskIds: string[] = [];
      const conditions: GovernanceBenchmarkConditionName[] = [];
      for (let index = 2; index < args.length; index += 1) {
        const token = args[index];
        if (token === "--seeds" || token === "--source") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: `Missing value for ${token}.` };
          }
          seedsRoot = value;
          index += 1;
          continue;
        }
        if (token === "--task") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --task." };
          }
          taskIds.push(value);
          index += 1;
          continue;
        }
        if (token === "--condition") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --condition." };
          }
          const condition = parseGovernanceBenchmarkCondition(value);
          if (!condition) {
            return {
              kind: "error",
              message: `Unsupported governance benchmark condition: ${value}.`
            };
          }
          conditions.push(condition);
          index += 1;
          continue;
        }
        if (token === "--out-dir") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --out-dir." };
          }
          outDir = value;
          index += 1;
          continue;
        }
        return {
          kind: "error",
          message: `Unsupported governance-benchmark batch argument: ${token}`
        };
      }
      if (!seedsRoot) {
        return { kind: "error", message: "Missing required argument: --seeds <path>." };
      }
      return { kind: "governance-benchmark-batch", seedsRoot, taskIds, outDir, conditions };
    }
    if (subcommand === "dry-run") {
      let seedPath: string | undefined;
      let taskId: string | undefined;
      let outDir: string | undefined;
      const conditions: GovernanceBenchmarkConditionName[] = [];
      for (let index = 2; index < args.length; index += 1) {
        const token = args[index];
        if (token === "--seed" || token === "--source") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: `Missing value for ${token}.` };
          }
          seedPath = value;
          index += 1;
          continue;
        }
        if (token === "--task") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --task." };
          }
          taskId = value;
          index += 1;
          continue;
        }
        if (token === "--condition") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --condition." };
          }
          const condition = parseGovernanceBenchmarkCondition(value);
          if (!condition) {
            return {
              kind: "error",
              message: `Unsupported governance benchmark condition: ${value}.`
            };
          }
          conditions.push(condition);
          index += 1;
          continue;
        }
        if (token === "--out-dir") {
          const value = args[index + 1];
          if (!value) {
            return { kind: "error", message: "Missing value for --out-dir." };
          }
          outDir = value;
          index += 1;
          continue;
        }
        return {
          kind: "error",
          message: `Unsupported governance-benchmark dry-run argument: ${token}`
        };
      }
      if (!seedPath) {
        return { kind: "error", message: "Missing required argument: --seed <path>." };
      }
      return { kind: "governance-benchmark-dry-run", seedPath, taskId, outDir, conditions };
    }
    let sourcePath: string | undefined;
    let taskId: string | undefined;
    let outDir: string | undefined;
    let referenceOnly = false;
    for (let index = 2; index < args.length; index += 1) {
      const token = args[index];
      if (token === "--source") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --source." };
        }
        sourcePath = value;
        index += 1;
        continue;
      }
      if (token === "--task") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --task." };
        }
        taskId = value;
        index += 1;
        continue;
      }
      if (token === "--out-dir") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --out-dir." };
        }
        outDir = value;
        index += 1;
        continue;
      }
      if (token === "--reference-only") {
        referenceOnly = true;
        continue;
      }
      return {
        kind: "error",
        message: `Unsupported governance-benchmark seed argument: ${token}`
      };
    }
    if (!sourcePath) {
      return { kind: "error", message: "Missing required argument: --source <path>." };
    }
    return { kind: "governance-benchmark-seed", sourcePath, taskId, outDir, referenceOnly };
  }

  if (first === "meta-harness") {
    let runs = 5;
    let runsProvided = false;
    const nodes: ("analyze_results" | "review")[] = [];
    const externalRunRoots: string[] = [];
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
        runsProvided = true;
        index += 1;
        continue;
      }
      if (token === "--external-run") {
        const value = args[index + 1];
        if (!value) {
          return { kind: "error", message: "Missing value for --external-run." };
        }
        externalRunRoots.push(value);
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
    if (externalRunRoots.length > 0 && !noApply) {
      return {
        kind: "error",
        message: "meta-harness --external-run is read-only in this slice; pass --no-apply."
      };
    }
    if (externalRunRoots.length > 0 && dryRun) {
      return {
        kind: "error",
        message: "meta-harness --external-run does not support --dry-run in the read-only context slice."
      };
    }
    if (externalRunRoots.length > 0 && runsProvided) {
      return {
        kind: "error",
        message: "meta-harness --external-run cannot be combined with --runs in the first external context slice."
      };
    }
    return {
      kind: "meta-harness",
      runs: externalRunRoots.length > 0 ? 0 : runs,
      nodes: nodes.length > 0 ? nodes : ["analyze_results", "review"],
      externalRunRoots,
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

function parseGovernanceBenchmarkCondition(value: string): GovernanceBenchmarkConditionName | undefined {
  if (
    value === "gated"
    || value === "ungated"
    || value === "no_claim_ceiling"
    || value === "no_review_gate"
    || value === "no_figure_audit"
  ) {
    return value;
  }
  return undefined;
}

const VALID_NODE_OPTION_PACKAGES: NodeOptionPackageName[] = ["fast", "thorough", "paper_scale"];

function parseRunPackageArgs(args: string[]): CliAction | undefined {
  if (args[0] !== "--package" && args[0] !== "--benchmark-condition") {
    return undefined;
  }

  let packageName: NodeOptionPackageName | undefined;
  let benchmarkCondition: GovernanceBenchmarkConditionName | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--package") {
      const value = args[index + 1];
      if (!value) {
        return { kind: "error", message: "Missing value for --package." };
      }
      if (!isNodeOptionPackageName(value)) {
        return {
          kind: "error",
          message: `Unsupported package: ${value}. Expected one of ${VALID_NODE_OPTION_PACKAGES.join(", ")}.`
        };
      }
      packageName = value;
      index += 1;
      continue;
    }
    if (token === "--benchmark-condition") {
      const value = args[index + 1];
      if (!value) {
        return { kind: "error", message: "Missing value for --benchmark-condition." };
      }
      benchmarkCondition = parseGovernanceBenchmarkCondition(value);
      if (!benchmarkCondition) {
        return { kind: "error", message: `Unsupported governance benchmark condition: ${value}.` };
      }
      index += 1;
      continue;
    }
    return {
      kind: "error",
      message: `Unsupported run argument: ${token}`
    };
  }

  return {
    kind: "run",
    ...(packageName ? { packageName } : {}),
    ...(benchmarkCondition ? { benchmarkCondition } : {})
  };
}

function isNodeOptionPackageName(value: string): value is NodeOptionPackageName {
  return VALID_NODE_OPTION_PACKAGES.includes(value as NodeOptionPackageName);
}
