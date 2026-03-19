import { spawn } from "node:child_process";
import path from "node:path";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const testTmpRoot = path.join(repoRoot, "test", ".tmp");

mkdirSync(testTmpRoot, { recursive: true });
for (const entry of readdirSync(testTmpRoot)) {
  rmSync(path.join(testTmpRoot, entry), { recursive: true, force: true });
}

process.env.TMPDIR = testTmpRoot;
process.env.TMP = testTmpRoot;
process.env.TEMP = testTmpRoot;

const rawArgs = process.argv.slice(2);
const rootArgs = rawArgs.filter((arg) => arg !== "--runInBand");
const hasFilteredArgs = rootArgs.length > 0;

if (rawArgs.includes("--runInBand")) {
  console.warn("[test] Ignoring unsupported --runInBand for Vitest.");
}

const vitestExit = await runCommand("vitest", ["run", ...rootArgs]);
if (vitestExit !== 0) {
  process.exit(vitestExit);
}

if (hasFilteredArgs) {
  process.exit(0);
}

const webExit = await runCommand("npm", ["--prefix", "web", "run", "test"]);
process.exit(webExit);

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(resolveCommand(command), args, {
      stdio: "inherit",
      env: process.env
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });

    child.on("error", () => resolve(1));
  });
}

function resolveCommand(command) {
  if (process.platform === "win32") {
    return `${command}.cmd`;
  }
  return command;
}
