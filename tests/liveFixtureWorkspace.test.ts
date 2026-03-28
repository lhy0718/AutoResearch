import path from "node:path";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMinimalLiveFixtureReviewArtifacts,
  createLiveFixtureWorkspaceRoot,
  writeLiveFixtureWorkspace
} from "./helpers/liveFixtureWorkspace.js";

const createdDirs: string[] = [];
const repoTestEnvPath = path.join(process.cwd(), "test", ".env");
let originalTestEnv: string | undefined;
let originalTestEnvKnown = false;

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (originalTestEnvKnown) {
    if (originalTestEnv === undefined) {
      await rm(repoTestEnvPath, { force: true });
    } else {
      await writeFile(repoTestEnvPath, originalTestEnv, "utf8");
    }
    originalTestEnv = undefined;
    originalTestEnvKnown = false;
  }
});

describe("liveFixtureWorkspace helper", () => {
  it("creates live fixture workspaces under test/.live", async () => {
    const workspaceRoot = await createLiveFixtureWorkspaceRoot("autolabos-live-fixture-root-");
    createdDirs.push(workspaceRoot);

    const relative = path.relative(path.join(process.cwd(), "test"), workspaceRoot);
    expect(relative.startsWith("..")).toBe(false);
    expect(relative.startsWith(path.join(".live", "autolabos-live-fixture-root-"))).toBe(true);
  });

  it("copies test/.env into the fixture workspace root when present", async () => {
    originalTestEnv = await readExistingTestEnv();
    originalTestEnvKnown = true;
    await mkdir(path.dirname(repoTestEnvPath), { recursive: true });
    await writeFile(repoTestEnvPath, 'OPENAI_API_KEY="fixture-openai-key"\n', "utf8");

    const workspaceRoot = await createLiveFixtureWorkspaceRoot("autolabos-live-fixture-env-");
    createdDirs.push(workspaceRoot);
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

  it("rejects live_fixture workspaces outside test/", async () => {
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
});

async function readExistingTestEnv(): Promise<string | undefined> {
  try {
    return await readFile(repoTestEnvPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
