export type CliAction =
  | { kind: "run" }
  | { kind: "web"; host?: string; port?: number }
  | { kind: "compare-analysis"; runId: string; limit: number; judge: boolean }
  | { kind: "eval-harness"; runIds: string[]; limit: number; outputPath?: string }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export function resolveCliAction(args: string[]): CliAction {
  if (args.length === 0) {
    return { kind: "run" };
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
      return {
        kind: "error",
        message: `Unsupported eval-harness argument: ${token}`
      };
    }
    return { kind: "eval-harness", runIds, limit, outputPath };
  }

  return {
    kind: "error",
    message:
      "Unsupported CLI arguments. Run `autolabos`, `autolabos web`, `autolabos compare-analysis`, `autolabos eval-harness`, or use slash commands inside the TUI."
  };
}
