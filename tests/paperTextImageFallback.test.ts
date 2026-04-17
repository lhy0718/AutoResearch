import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}));

afterEach(async () => {
  execFileMock.mockReset();
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function makePaper(overrides: Record<string, unknown> = {}) {
  return {
    paper_id: "paper-image-fallback-1",
    title: "Image fallback paper",
    abstract: "Abstract text",
    authors: ["Alice"],
    pdf_url: "https://example.org/paper.pdf",
    ...overrides
  };
}

describe("paperText image fallback rendering", () => {
  it("keeps supplemental page images when the first PNG render attempt fails but scaled retry succeeds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-image-fallback-"));
    tempDirs.push(root);
    process.chdir(root);

    globalThis.fetch = vi.fn(async () => {
      return new Response(Buffer.from("%PDF-1.4\nmock-pdf", "utf8"), {
        status: 200,
        headers: { "content-type": "application/pdf" }
      });
    }) as typeof fetch;

    execFileMock.mockImplementation((command: string, args: string[], options: unknown, callback: (...cbArgs: unknown[]) => void) => {
      const argv = Array.isArray(args) ? args : [];
      const done = callback;
      if (command === "pdftotext") {
        done(null, { stdout: "", stderr: "" });
        return;
      }
      if (command === "pdfinfo") {
        done(null, { stdout: "Pages:          1\n", stderr: "" });
        return;
      }
      if (command === "pdftoppm") {
        const stem = argv[argv.length - 1];
        const pngPath = `${stem}.png`;
        if (argv.includes("-scale-to")) {
          mkdir(path.dirname(pngPath), { recursive: true })
            .then(() => writeFile(pngPath, "png", "utf8"))
            .then(() => done(null, { stdout: "", stderr: "" }))
            .catch((error) => done(error));
          return;
        }
        done(new Error("pdftoppm_primary_render_failed"));
        return;
      }
      done(new Error(`unexpected_exec:${command}`));
    });

    const { resolvePaperTextSource } = await import("../src/core/analysis/paperText.js");

    const source = await resolvePaperTextSource({
      runId: "run-1",
      paper: makePaper()
    });

    expect(source.sourceType).toBe("abstract");
    expect(source.fallbackReason).toBe("pdf_extract_failed");
    expect(source.pageImagePaths?.length).toBe(1);
    expect(source.pageImagePages).toEqual([1]);
    expect(source.pageImagePaths?.[0]).toContain("page-001.png");
    expect(execFileMock).toHaveBeenCalled();
  });
});
