import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnalysisCorpusRow,
  isLikelyVisualPdfThumbnail,
  resolvePaperTextSource,
  selectHybridPdfPageNumbers
} from "../src/core/analysis/paperText.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function makePaper(overrides: Partial<AnalysisCorpusRow> = {}): AnalysisCorpusRow {
  return {
    paper_id: overrides.paper_id ?? "paper-1",
    title: overrides.title ?? "Paper One",
    abstract: overrides.abstract ?? "Abstract text",
    authors: overrides.authors ?? ["Alice"],
    year: overrides.year,
    venue: overrides.venue,
    pdf_url: overrides.pdf_url,
    url: overrides.url,
    citation_count: overrides.citation_count
  };
}

describe("paperText", () => {
  it("falls back to abstract when no PDF URL exists", async () => {
    const source = await resolvePaperTextSource({
      runId: "run-1",
      paper: makePaper()
    });

    expect(source.sourceType).toBe("abstract");
    expect(source.fallbackReason).toBe("no_pdf_url");
    expect(source.text).toContain("Abstract:");
  });

  it("uses cached extracted text when present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-text-"));
    tempDirs.push(root);
    process.chdir(root);

    const textPath = path.join(
      ".autolabos",
      "runs",
      "run-1",
      "analysis_cache",
      "texts",
      "paper-1.txt"
    );
    await mkdir(path.dirname(textPath), { recursive: true });
    await writeFile(textPath, "Full text from cache", "utf8");

    const source = await resolvePaperTextSource({
      runId: "run-1",
      paper: makePaper({ pdf_url: "https://example.org/paper-1.pdf" })
    });

    expect(source.sourceType).toBe("full_text");
    expect(source.text).toBe("Full text from cache");
  });

  it("reuses cached hybrid page images when they already exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-text-images-"));
    tempDirs.push(root);
    process.chdir(root);

    const textPath = path.join(
      ".autolabos",
      "runs",
      "run-1",
      "analysis_cache",
      "texts",
      "paper-1.txt"
    );
    const imageDir = path.join(
      ".autolabos",
      "runs",
      "run-1",
      "analysis_cache",
      "page_images",
      "paper-1"
    );
    await mkdir(path.dirname(textPath), { recursive: true });
    await mkdir(imageDir, { recursive: true });
    await writeFile(textPath, "Full text from cache", "utf8");
    await writeFile(path.join(imageDir, "page-001.png"), "png", "utf8");
    await writeFile(path.join(imageDir, "page-003.png"), "png", "utf8");

    const source = await resolvePaperTextSource({
      runId: "run-1",
      paper: makePaper({ pdf_url: "https://example.org/paper-1.pdf" })
    });

    expect(source.sourceType).toBe("full_text");
    expect(source.pageImagePages).toEqual([1, 3]);
    expect(source.pageImagePaths?.map((filePath) => path.basename(filePath))).toEqual([
      "page-001.png",
      "page-003.png"
    ]);
  });

  it("falls back to abstract when PDF download fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "autolabos-paper-text-fallback-"));
    tempDirs.push(root);
    process.chdir(root);
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 404 })) as typeof fetch;

    const source = await resolvePaperTextSource({
      runId: "run-1",
      paper: makePaper({ pdf_url: "https://example.org/missing.pdf" })
    });

    expect(source.sourceType).toBe("abstract");
    expect(source.fallbackReason).toContain("pdf_download_failed:404");
  });

  it("selects all pages for hybrid image attachment", () => {
    const pages = selectHybridPdfPageNumbers({
      pageTexts: [
        "Title and abstract page.",
        "Method details with Figure 1.",
        "Results with Figure 2 and Table 1.",
        "Appendix with Table 3."
      ]
    });

    expect(pages).toEqual([1, 2, 3, 4]);
  });

  it("uses page count when selecting all pages", () => {
    const pages = selectHybridPdfPageNumbers({
      pageTexts: [
        "Title and abstract page.",
        "Method details.",
        "Discussion."
      ],
      pageCount: 5
    });

    expect(pages).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a single page when page count is unavailable", () => {
    const pages = selectHybridPdfPageNumbers({
      pageTexts: []
    });

    expect(pages).toEqual([1]);
  });

  it("classifies a chart-like thumbnail as visual", () => {
    const width = 96;
    const height = 96;
    const buffer = createPgm(width, height, (x, y) => {
      if ((x >= 16 && x <= 18 && y >= 14 && y <= 80) || (y >= 78 && y <= 80 && x >= 16 && x <= 82)) {
        return 0;
      }
      if (x >= 26 && x <= 78 && y >= 24 && y <= 64) {
        return 40;
      }
      return 255;
    });

    expect(isLikelyVisualPdfThumbnail(buffer)).toBe(true);
  });

  it("does not classify a text-like thumbnail as visual", () => {
    const width = 96;
    const height = 96;
    const buffer = createPgm(width, height, (x, y) => {
      const lineIndex = Math.floor((y - 10) / 6);
      if (lineIndex >= 0 && lineIndex < 10 && y >= 10 + lineIndex * 6 && y <= 12 + lineIndex * 6) {
        const segment = Math.floor((x - 8) / 8);
        if (segment >= 0 && segment < 9 && segment % 2 === 0 && x <= 78) {
          return 0;
        }
      }
      return 255;
    });

    expect(isLikelyVisualPdfThumbnail(buffer)).toBe(false);
  });
});

function createPgm(
  width: number,
  height: number,
  getPixel: (x: number, y: number) => number
): Buffer {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.alloc(width * height, 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = getPixel(x, y);
    }
  }
  return Buffer.concat([header, pixels]);
}
