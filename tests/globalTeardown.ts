/**
 * Vitest globalSetup: cleans up temp workspaces created under test/ after
 * all test files finish. The setup phase removes any leftover dirs from a
 * previous crashed run (keeping smoke/ and .env).
 */
import path from "node:path";
import { readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getDefaultValidationWorkspaceRoot } from "../src/validationWorkspace.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationRoot = process.env.AUTOLABOS_VALIDATION_WORKSPACE_ROOT || getDefaultValidationWorkspaceRoot(repoRoot);

// Directories and files that must be preserved inside the validation root
// .autolabos / outputs / output are kept so live TUI validation
// workspaces survive vitest runs (see LV-027).
const KEEP = new Set(["smoke", ".env", ".autolabos", "outputs", "output", ".tmp"]);

function cleanTestWorkspaces(): void {
  if (!existsSync(validationRoot)) return;
  for (const entry of readdirSync(validationRoot)) {
    if (KEEP.has(entry)) continue;
    const full = path.join(validationRoot, entry);
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
