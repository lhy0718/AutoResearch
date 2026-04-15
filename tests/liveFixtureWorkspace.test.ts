import path from "node:path";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMinimalLiveFixtureReviewArtifacts,
  createLiveFixtureWorkspaceRoot,
  writeLiveFixtureWorkspace
} from "./helpers/liveFixtureWorkspace.js";
import { VALIDATION_WORKSPACE_ROOT_ENV, resolveValidationWorkspaceRoot } from "../src/validationWorkspace.js";

const createdDirs: string[] = [];
let originalValidationWorkspaceRoot: string | undefined;
let originalValidationWorkspaceRootKnown = false;
let originalValidationEnv: string | undefined;
let originalValidationEnvPath: string | undefined;
let originalValidationEnvKnown = false;

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (originalValidationEnvKnown && originalValidationEnvPath) {
    if (originalValidationEnv === undefined) {
      await rm(originalValidationEnvPath, { force: true });
    } else {
      await writeFile(originalValidationEnvPath, originalValidationEnv, "utf8");
    }
    originalValidationEnv = undefined;
    originalValidationEnvPath = undefined;
    originalValidationEnvKnown = false;
  }
  if (originalValidationWorkspaceRootKnown) {
    if (originalValidationWorkspaceRoot === undefined) {
      delete process.env[VALIDATION_WORKSPACE_ROOT_ENV];
    } else {
      process.env[VALIDATION_WORKSPACE_ROOT_ENV] = originalValidationWorkspaceRoot;
    }
    originalValidationWorkspaceRoot = undefined;
    originalValidationWorkspaceRootKnown = false;
  }
});

describe("liveFixtureWorkspace helper", () => {
  it("creates live fixture workspaces under the configured validation root", async () => {
    const workspaceRoot = await createLiveFixtureWorkspaceRoot("autolabos-live-fixture-root-");
    createdDirs.push(workspaceRoot);

    const relative = path.relative(resolveValidationWorkspaceRoot(), workspaceRoot);
    expect(relative.startsWith("..")).toBe(false);
    expect(relative.startsWith(path.join(".live", "autolabos-live-fixture-root-"))).toBe(true);
  });

  it("copies the validation-root .env into the fixture workspace root when present", async () => {
    originalValidationWorkspaceRoot = process.env[VALIDATION_WORKSPACE_ROOT_ENV];
    originalValidationWorkspaceRootKnown = true;
    const validationRoot = await rmAndCreateTempRoot("autolabos-live-fixture-env-root-");
    process.env[VALIDATION_WORKSPACE_ROOT_ENV] = validationRoot;

    const validationEnvPath = path.join(validationRoot, ".env");
    originalValidationEnvPath = validationEnvPath;
    originalValidationEnv = await readExistingEnv(validationEnvPath);
    originalValidationEnvKnown = true;
    await mkdir(path.dirname(validationEnvPath), { recursive: true });
    await writeFile(validationEnvPath, 'OPENAI_API_KEY="fixture-openai-key"\n', "utf8");

    const workspaceRoot = await createLiveFixtureWorkspaceRoot("autolabos-live-fixture-env-");
    createdDirs.push(validationRoot);
    await writeLiveFixtureWorkspace({
      workspaceRoot,
      runId: "fixture-run",
      includeConfig: false,
      artifacts: buildMinimalLiveFixtureReviewArtifacts("2026-03-28T12:00:00.000Z", "fixture-run"),
      now: "2026-03-28T12:00:00.000Z"
    });

    await expect(access(path.join(workspaceRoot, ".env"), fsConstants.F_OK)).resolves.toBeUndefined();
    await expect(readFile(path.join(workspaceRoot, ".env"), "utf8")).resolves.toContain("fixture-openai-key");
  });

  it("rejects live_fixture workspaces outside the configured validation root", async () => {
    const outsideRoot = path.join(process.cwd(), ".autolabos-live-outside");
    createdDirs.push(outsideRoot);

    await expect(
      writeLiveFixtureWorkspace({
        workspaceRoot: outsideRoot,
        runId: "fixture-run",
        includeConfig: false,
        artifacts: buildMinimalLiveFixtureReviewArtifacts("2026-03-28T12:00:00.000Z", "fixture-run"),
        now: "2026-03-28T12:00:00.000Z"
      })
    ).rejects.toThrow("live_fixture workspaces must live under");
  });

  it("supports an external validation workspace root without hardcoded project paths", async () => {
    originalValidationWorkspaceRoot = process.env[VALIDATION_WORKSPACE_ROOT_ENV];
    originalValidationWorkspaceRootKnown = true;
    const externalRoot = await rmAndCreateTempRoot("autolabos-live-fixture-external-");
    process.env[VALIDATION_WORKSPACE_ROOT_ENV] = externalRoot;

    const workspaceRoot = await createLiveFixtureWorkspaceRoot("autolabos-live-fixture-root-");
    createdDirs.push(externalRoot);
    expect(path.relative(externalRoot, workspaceRoot).startsWith(path.join(".live", "autolabos-live-fixture-root-"))).toBe(true);

    await writeLiveFixtureWorkspace({
      workspaceRoot,
      runId: "fixture-run",
      includeConfig: false,
      artifacts: buildMinimalLiveFixtureReviewArtifacts("2026-03-28T12:00:00.000Z", "fixture-run"),
      now: "2026-03-28T12:00:00.000Z"
    });

    await expect(access(path.join(workspaceRoot, ".autolabos", "runs", "fixture-run", "run_record.json"), fsConstants.F_OK)).resolves.toBeUndefined();
  });
});

async function readExistingEnv(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function rmAndCreateTempRoot(prefix: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
