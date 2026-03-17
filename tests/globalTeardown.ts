/**
 * Vitest globalSetup: cleans up temp workspaces created under test/ after
 * all test files finish. The setup phase removes any leftover dirs from a
 * previous crashed run (keeping smoke/ and .env).
 */
import path from "node:path";
import { readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repoRoot, "test");

// Directories and files that must be preserved inside test/
// .autolabos / outputs / output are kept so live TUI validation
// workspaces survive vitest runs (see LV-027).
const KEEP = new Set(["smoke", ".env", ".autolabos", "outputs", "output"]);

function cleanTestWorkspaces(): void {
  if (!existsSync(testRoot)) return;
  for (const entry of readdirSync(testRoot)) {
    if (KEEP.has(entry)) continue;
    const full = path.join(testRoot, entry);
    if (statSync(full).isDirectory()) {
      rmSync(full, { recursive: true, force: true });
    }
  }
}

export function setup(): void {
  // Remove leftovers from any previous crashed run
  cleanTestWorkspaces();
}

export function teardown(): void {
  cleanTestWorkspaces();
}
