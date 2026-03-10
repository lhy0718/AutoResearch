#!/usr/bin/env node
import { runAutoresearchApp } from "../app.js";
import { resolveCliAction } from "./args.js";
import { runAutoresearchWebServer } from "../web/server.js";

function printHelp(): void {
  process.stdout.write([
    "autoresearch",
    "",
    "Single entrypoint for the AutoResearch slash-first TUI.",
    "All operations are available inside the app via /commands.",
    "",
    "Usage:",
    "  autoresearch",
    "  autoresearch web [--host 127.0.0.1] [--port 4317]",
    "  autoresearch --help",
    "  autoresearch --version"
  ].join("\n") + "\n");
}

async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));

  if (action.kind === "help") {
    printHelp();
    return;
  }

  if (action.kind === "version") {
    process.stdout.write("autoresearch 1.0.0\n");
    return;
  }

  if (action.kind === "error") {
    process.stderr.write(`${action.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (action.kind === "web") {
    await runAutoresearchWebServer({
      cwd: process.cwd(),
      host: action.host,
      port: action.port
    });
    return;
  }

  await runAutoresearchApp();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
