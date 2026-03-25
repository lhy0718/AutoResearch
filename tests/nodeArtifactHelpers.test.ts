import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({
    mtime: new Date("2026-03-25T00:00:00.000Z"),
    size: 16
  }))
}));

const fsUtilMocks = vi.hoisted(() => ({
  ensureDir: vi.fn(async () => undefined),
  normalizeFsPath: vi.fn((value: string) => value)
}));

const runIndexMocks = vi.hoisted(() => ({
  upsertRunArtifact: vi.fn(() => undefined),
  getRunArtifactByPath: vi.fn(() => undefined),
  close: vi.fn(() => undefined)
}));

vi.mock("node:fs", () => ({
  promises: {
    writeFile: fsMocks.writeFile,
    rename: fsMocks.rename,
    rm: fsMocks.rm,
    stat: fsMocks.stat
  }
}));

vi.mock("../src/utils/fs.js", () => ({
  ensureDir: fsUtilMocks.ensureDir,
  normalizeFsPath: fsUtilMocks.normalizeFsPath
}));

vi.mock("../src/core/runs/runIndexDatabase.js", () => ({
  buildRunsDbFile: (runsDir: string) => path.join(runsDir, "runs.sqlite"),
  toRunArtifactType: (relativePath: string) => relativePath.replace(/\.[^.]+$/u, "").replace(/[\\/.-]+/g, "_"),
  RunIndexDatabase: class {
    upsertRunArtifact = runIndexMocks.upsertRunArtifact;
    getRunArtifactByPath = runIndexMocks.getRunArtifactByPath;
    close = runIndexMocks.close;
  }
}));

import { appendJsonl, writeRunArtifact } from "../src/core/nodes/helpers.js";

describe("node artifact helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsUtilMocks.normalizeFsPath.mockImplementation((value: string) => value);
    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.rename.mockResolvedValue(undefined);
    fsMocks.rm.mockResolvedValue(undefined);
    fsMocks.stat.mockResolvedValue({
      mtime: new Date("2026-03-25T00:00:00.000Z"),
      size: 16
    });
    fsUtilMocks.ensureDir.mockResolvedValue(undefined);
    runIndexMocks.upsertRunArtifact.mockReset();
    runIndexMocks.getRunArtifactByPath.mockReset();
    runIndexMocks.getRunArtifactByPath.mockReturnValue(undefined);
    runIndexMocks.close.mockReset();
  });

  it("writes run artifacts via a temp file and rename", async () => {
    await writeRunArtifact({ id: "run-123" } as any, "collect_request.json", '{"ok":true}');

    expect(fsUtilMocks.ensureDir).toHaveBeenCalledWith(path.join(".autolabos", "runs", "run-123"));
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);

    const tempPath = fsMocks.writeFile.mock.calls[0]?.[0] as string;
    expect(tempPath).toContain(path.join(".autolabos", "runs", "run-123", "collect_request.json.tmp-"));
    expect(fsMocks.writeFile).toHaveBeenCalledWith(tempPath, '{"ok":true}', "utf8");
    expect(fsMocks.rename).toHaveBeenCalledWith(tempPath, path.join(".autolabos", "runs", "run-123", "collect_request.json"));
    expect(fsMocks.rm).not.toHaveBeenCalled();
  });

  it("writes jsonl snapshots through the same atomic path", async () => {
    await appendJsonl({ id: "run-123" } as any, "collect_enrichment.jsonl", [{ paperId: "p1" }, { paperId: "p2" }]);

    const tempPath = fsMocks.writeFile.mock.calls[0]?.[0] as string;
    expect(tempPath).toContain(path.join(".autolabos", "runs", "run-123", "collect_enrichment.jsonl.tmp-"));
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      tempPath,
      '{"paperId":"p1"}\n{"paperId":"p2"}\n',
      "utf8"
    );
    expect(fsMocks.rename).toHaveBeenCalledWith(
      tempPath,
      path.join(".autolabos", "runs", "run-123", "collect_enrichment.jsonl")
    );
  });

  it("cleans up the temp file when rename fails", async () => {
    fsMocks.rename.mockRejectedValueOnce(new Error("rename failed"));

    await expect(writeRunArtifact({ id: "run-123" } as any, "collect_request.json", '{"ok":true}')).rejects.toThrow(
      "rename failed"
    );

    const tempPath = fsMocks.writeFile.mock.calls[0]?.[0] as string;
    expect(fsMocks.rm).toHaveBeenCalledWith(tempPath, { force: true });
  });
});
