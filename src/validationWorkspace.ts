import path from "node:path";

import { getProjectRoot } from "./workspaceGuard.js";

export const VALIDATION_WORKSPACE_ROOT_ENV = "AUTOLABOS_VALIDATION_WORKSPACE_ROOT";

export function getDefaultValidationWorkspaceRoot(projectRoot = getProjectRoot()): string {
  return path.join(path.dirname(projectRoot), ".autolabos-validation");
}

export function resolveValidationWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = getProjectRoot()
): string {
  const configured = env[VALIDATION_WORKSPACE_ROOT_ENV]?.trim();
  if (!configured) {
    return getDefaultValidationWorkspaceRoot(projectRoot);
  }
  return path.resolve(configured);
}

export function resolveValidationFixtureRoot(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = getProjectRoot()
): string {
  return path.join(resolveValidationWorkspaceRoot(env, projectRoot), ".live");
}

export function isPathInsideOrEqual(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
