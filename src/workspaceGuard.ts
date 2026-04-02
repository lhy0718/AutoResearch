import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

export function isProjectRootWorkspace(cwd: string): boolean {
  return path.resolve(cwd) === PROJECT_ROOT;
}

export function assertNotProjectRootWorkspace(cwd: string, operation = "AutoLabOS"): void {
  if (!isProjectRootWorkspace(cwd)) {
    return;
  }
  throw new Error(
    `${operation} must not run from the repository root (${PROJECT_ROOT}). Use test/ or another workspace directory instead.`
  );
}
