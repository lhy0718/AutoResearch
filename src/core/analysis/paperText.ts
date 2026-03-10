import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureDir, fileExists } from "../../utils/fs.js";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_CHARS = 16_000;
const THUMBNAIL_SCALE = 160;

export interface AnalysisCorpusRow {
  paper_id: string;
  title: string;
  abstract: string;
  year?: number;
  venue?: string;
  url?: string;
  pdf_url?: string;
  authors: string[];
  citation_count?: number;
  influential_citation_count?: number;
  publication_date?: string;
  publication_types?: string[];
  fields_of_study?: string[];
}

export interface ResolvedPaperSource {
  sourceType: "full_text" | "abstract";
  text: string;
  fullTextAvailable: boolean;
  pdfUrl?: string;
  pdfCachePath?: string;
  textCachePath?: string;
  pageImagePaths?: string[];
  pageImagePages?: number[];
  fallbackReason?: string;
}

interface BinaryLineStats {
  inkCount: number;
  runCount: number;
  longestRun: number;
}

interface ThumbnailVisualMetrics {
  inkRatio: number;
  edgeRatio: number;
  activeRows: number;
  textLikeRows: number;
  graphicsRows: number;
  horizontalRuleRows: number;
  verticalRuleCols: number;
  denseBlocks: number;
}

export async function resolvePaperTextSource(args: {
  runId: string;
  paper: AnalysisCorpusRow;
  includePageImages?: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<ResolvedPaperSource> {
  const fallback = buildAbstractFallbackText(args.paper);
  const pdfUrl = resolvePaperPdfUrl(args.paper);
  const includePageImages = args.includePageImages !== false;
  if (!pdfUrl) {
    args.onProgress?.("No PDF URL found. Using abstract fallback.");
    return {
      sourceType: "abstract",
      text: fallback,
      fullTextAvailable: false,
      fallbackReason: "no_pdf_url"
    };
  }

  const cacheDir = path.join(".autolabos", "runs", args.runId, "analysis_cache");
  const pdfCachePath = path.join(cacheDir, "pdfs", `${sanitizeFileStem(args.paper.paper_id)}.pdf`);
  const textCachePath = path.join(cacheDir, "texts", `${sanitizeFileStem(args.paper.paper_id)}.txt`);
  const pageImageDir = path.join(cacheDir, "page_images", sanitizeFileStem(args.paper.paper_id));

  const cachedText = await readCachedText(textCachePath);
  const cachedPageImages = includePageImages ? await readCachedPageImages(pageImageDir) : emptyCachedPageImages();
  const cachedPdfPageCount =
    includePageImages && (await fileExists(pdfCachePath)) ? await readPdfPageCount(pdfCachePath, args.abortSignal) : 0;
  if (cachedText) {
    args.onProgress?.("Reusing cached extracted full text.");
    if (
      !includePageImages ||
      (cachedPageImages.paths.length > 0 &&
        (cachedPdfPageCount === 0 || hasCompletePageImageSet(cachedPageImages.pages, cachedPdfPageCount)))
    ) {
      return {
        sourceType: "full_text",
        text: cachedText,
        fullTextAvailable: true,
        pdfUrl,
        pdfCachePath,
        textCachePath,
        pageImagePaths: cachedPageImages.paths,
        pageImagePages: cachedPageImages.pages
      };
    }
  }

  try {
    args.onProgress?.(
      (await fileExists(pdfCachePath))
        ? "Reusing cached PDF for hybrid analysis."
        : "Downloading PDF for text/image extraction."
    );
    await downloadPdf(pdfUrl, pdfCachePath, args.abortSignal);
  } catch (error) {
    if (cachedText) {
      args.onProgress?.(
        `Unable to refresh the PDF for image rendering (${error instanceof Error ? error.message : String(error)}). Reusing cached text only.`
      );
      return {
        sourceType: "full_text",
        text: cachedText,
        fullTextAvailable: true,
        pdfUrl,
        pdfCachePath,
        textCachePath
      };
    }

    args.onProgress?.(
      `PDF resolution failed (${error instanceof Error ? error.message : String(error)}). Falling back to abstract.`
    );
    return {
      sourceType: "abstract",
      text: fallback,
      fullTextAvailable: false,
      pdfUrl,
      pdfCachePath,
      textCachePath,
      fallbackReason: error instanceof Error ? error.message : String(error)
    };
  }

  try {
    const pageTexts = await extractPdfPageTexts(pdfCachePath, args.abortSignal);
    let extracted = cachedText;
    if (!cachedText) {
      args.onProgress?.("Extracting text from downloaded PDF.");
      extracted = truncateText(pageTexts.filter(Boolean).join("\n\n"), MAX_SOURCE_CHARS) || undefined;
      if (extracted) {
        await ensureDir(path.dirname(textCachePath));
        await fs.writeFile(textCachePath, extracted, "utf8");
        args.onProgress?.("PDF text extraction completed.");
      }
    }

    let pageImages = cachedPageImages;
    if (includePageImages) {
      const pageCount = Math.max(pageTexts.length, await readPdfPageCount(pdfCachePath, args.abortSignal));
      if (!hasCompletePageImageSet(pageImages.pages, pageCount)) {
        const selectedPages = selectHybridPdfPageNumbers({
          pageTexts,
          pageCount
        });
        args.onProgress?.(`Rendering all ${selectedPages.length} PDF page image(s) for hybrid analysis.`);
        pageImages = await renderPdfPageImages({
          pdfPath: pdfCachePath,
          imageDir: pageImageDir,
          pages: selectedPages,
          abortSignal: args.abortSignal
        });
      }
    }

    if (extracted) {
      return {
        sourceType: "full_text",
        text: extracted,
        fullTextAvailable: true,
        pdfUrl,
        pdfCachePath,
        textCachePath,
        pageImagePaths: pageImages.paths,
        pageImagePages: pageImages.pages
      };
    }

    args.onProgress?.(
      pageImages.paths.length > 0
        ? "PDF extraction produced no usable text. Falling back to abstract with supplemental page images."
        : "PDF extraction produced no usable text. Falling back to abstract."
    );
    return {
      sourceType: "abstract",
      text: fallback,
      fullTextAvailable: false,
      pdfUrl,
      pdfCachePath,
      textCachePath,
      pageImagePaths: pageImages.paths,
      pageImagePages: pageImages.pages,
      fallbackReason: "pdf_extract_failed"
    };
  } catch (error) {
    args.onProgress?.(
      `PDF resolution failed (${error instanceof Error ? error.message : String(error)}). Falling back to abstract.`
    );
    return {
      sourceType: "abstract",
      text: fallback,
      fullTextAvailable: false,
      pdfUrl,
      pdfCachePath,
      textCachePath,
      pageImagePaths: cachedPageImages.paths,
      pageImagePages: cachedPageImages.pages,
      fallbackReason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function selectHybridPdfPageNumbers(args: {
  pageTexts?: string[];
  pageCount?: number;
  thumbnailVisualPages?: number[];
  maxImages?: number;
}): number[] {
  const totalPages = Math.max(args.pageCount ?? 0, args.pageTexts?.length ?? 0, 1);
  return Array.from({ length: totalPages }, (_, index) => index + 1);
}

export function resolvePaperPdfUrl(paper: AnalysisCorpusRow): string | undefined {
  return toNonEmptyString(paper.pdf_url) || extractPdfLikeUrl(paper.url);
}

export function buildAbstractFallbackText(paper: AnalysisCorpusRow): string {
  const parts = [
    `Title: ${paper.title || "Untitled"}`,
    paper.year ? `Year: ${paper.year}` : undefined,
    paper.venue ? `Venue: ${paper.venue}` : undefined,
    paper.authors.length > 0 ? `Authors: ${paper.authors.join(", ")}` : undefined,
    paper.citation_count !== undefined ? `Citation count: ${paper.citation_count}` : undefined,
    paper.abstract ? `Abstract:\n${paper.abstract}` : "Abstract unavailable."
  ].filter(Boolean);

  return truncateText(parts.join("\n"), MAX_SOURCE_CHARS);
}

async function readCachedText(filePath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed ? truncateText(trimmed, MAX_SOURCE_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

async function readCachedPageImages(
  dirPath: string
): Promise<{ paths: string[]; pages: number[] }> {
  try {
    const entries = await fs.readdir(dirPath);
    const parsed = entries
      .map((entry) => {
        const match = entry.match(/^page-(\d{3})\.png$/u);
        if (!match) {
          return undefined;
        }
        const page = Number.parseInt(match[1], 10);
        return Number.isFinite(page)
          ? {
              page,
              path: path.join(dirPath, entry)
            }
          : undefined;
      })
      .filter((value): value is { page: number; path: string } => Boolean(value))
      .sort((left, right) => left.page - right.page);

    return {
      paths: parsed.map((entry) => entry.path),
      pages: parsed.map((entry) => entry.page)
    };
  } catch {
    return emptyCachedPageImages();
  }
}

async function downloadPdf(url: string, filePath: string, abortSignal?: AbortSignal): Promise<void> {
  if (await fileExists(filePath)) {
    return;
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf,*/*;q=0.8",
      "User-Agent": "AutoLabOS/1.0.0"
    },
    signal: abortSignal
  });
  if (!response.ok) {
    throw new Error(`pdf_download_failed:${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
}

async function extractPdfPageTexts(filePath: string, abortSignal?: AbortSignal): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], {
      signal: abortSignal,
      maxBuffer: 16 * 1024 * 1024
    });
    return stdout
      .replace(/\r/g, "")
      .split("\f")
      .map((page) => normalizeWhitespace(page))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readPdfPageCount(filePath: string, abortSignal?: AbortSignal): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [filePath], {
      signal: abortSignal,
      maxBuffer: 512 * 1024
    });
    const match = stdout.match(/^Pages:\s+(\d+)/mu);
    const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function renderPdfPageImages(args: {
  pdfPath: string;
  imageDir: string;
  pages: number[];
  abortSignal?: AbortSignal;
}): Promise<{ paths: string[]; pages: number[] }> {
  await ensureDir(args.imageDir);
  const rendered: Array<{ page: number; path: string }> = [];

  for (const page of args.pages) {
    const stem = path.join(args.imageDir, `page-${String(page).padStart(3, "0")}`);
    const pngPath = `${stem}.png`;
    if (!(await fileExists(pngPath))) {
      try {
        await execFileAsync(
          "pdftoppm",
          ["-f", String(page), "-l", String(page), "-singlefile", "-png", args.pdfPath, stem],
          {
            signal: args.abortSignal,
            maxBuffer: 8 * 1024 * 1024
          }
        );
      } catch {
        continue;
      }
    }
    if (await fileExists(pngPath)) {
      rendered.push({ page, path: pngPath });
    }
  }

  return {
    paths: rendered.map((entry) => entry.path),
    pages: rendered.map((entry) => entry.page)
  };
}

async function detectVisualThumbnailPages(args: {
  pdfPath: string;
  pageCount: number;
  thumbnailDir: string;
  abortSignal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<number[]> {
  if (args.pageCount <= 0) {
    return [];
  }

  await ensureDir(args.thumbnailDir);
  const missingPages: number[] = [];
  for (let page = 1; page <= args.pageCount; page += 1) {
    if (!(await fileExists(buildThumbnailPath(args.thumbnailDir, page)))) {
      missingPages.push(page);
    }
  }

  if (missingPages.length > 0) {
    args.onProgress?.(`Rendering ${args.pageCount} low-res page thumbnail(s) for visual-page detection.`);
    await renderPdfPageThumbnails({
      pdfPath: args.pdfPath,
      thumbnailDir: args.thumbnailDir,
      pageCount: args.pageCount,
      abortSignal: args.abortSignal
    });
  }

  const visualPages: number[] = [];
  for (let page = 1; page <= args.pageCount; page += 1) {
    try {
      const buffer = await fs.readFile(buildThumbnailPath(args.thumbnailDir, page));
      if (isLikelyVisualPdfThumbnail(buffer)) {
        visualPages.push(page);
      }
    } catch {
      continue;
    }
  }

  return visualPages;
}

async function renderPdfPageThumbnails(args: {
  pdfPath: string;
  thumbnailDir: string;
  pageCount: number;
  abortSignal?: AbortSignal;
}): Promise<void> {
  await execFileAsync(
    "pdftoppm",
    [
      "-f",
      "1",
      "-l",
      String(args.pageCount),
      "-gray",
      "-scale-to",
      String(THUMBNAIL_SCALE),
      args.pdfPath,
      path.join(args.thumbnailDir, "page")
    ],
    {
      signal: args.abortSignal,
      maxBuffer: 8 * 1024 * 1024
    }
  );
}

export function isLikelyVisualPdfThumbnail(buffer: Buffer): boolean {
  const metrics = analyzePdfThumbnail(buffer);
  return (
    (metrics.horizontalRuleRows >= 3 && metrics.verticalRuleCols >= 2) ||
    metrics.graphicsRows >= 10 ||
    (metrics.denseBlocks >= 10 &&
      metrics.edgeRatio >= 0.015 &&
      metrics.graphicsRows >= Math.max(4, Math.floor(metrics.activeRows * 0.12))) ||
    (metrics.edgeRatio >= 0.028 &&
      metrics.inkRatio >= 0.05 &&
      metrics.denseBlocks >= 7 &&
      metrics.graphicsRows >= 4 &&
      metrics.textLikeRows < Math.max(10, Math.floor(metrics.activeRows * 0.7)))
  );
}

function analyzePdfThumbnail(buffer: Buffer): ThumbnailVisualMetrics {
  const image = parsePortableGraymap(buffer);
  const pixels = image.pixels;
  const binary = new Uint8Array(pixels.length);
  let inkCount = 0;
  for (let index = 0; index < pixels.length; index += 1) {
    const ink = pixels[index] < 235 ? 1 : 0;
    binary[index] = ink;
    inkCount += ink;
  }

  let edgeCount = 0;
  for (let y = 0; y < image.height - 1; y += 1) {
    for (let x = 0; x < image.width - 1; x += 1) {
      const index = y * image.width + x;
      const rightDelta = Math.abs(pixels[index] - pixels[index + 1]);
      const downDelta = Math.abs(pixels[index] - pixels[index + image.width]);
      if (rightDelta >= 28 || downDelta >= 28) {
        edgeCount += 1;
      }
    }
  }

  let activeRows = 0;
  let textLikeRows = 0;
  let graphicsRows = 0;
  let horizontalRuleRows = 0;
  for (let row = 0; row < image.height; row += 1) {
    const stats = computeBinaryLineStats(binary, row * image.width, image.width, 1);
    const inkRatio = stats.inkCount / Math.max(1, image.width);
    if (inkRatio >= 0.01) {
      activeRows += 1;
    }
    if (inkRatio >= 0.01 && inkRatio <= 0.16 && stats.runCount >= 5 && stats.longestRun <= image.width * 0.42) {
      textLikeRows += 1;
    }
    if (inkRatio >= 0.05 && stats.longestRun >= image.width * 0.32 && stats.runCount <= 4) {
      graphicsRows += 1;
    }
    if (inkRatio >= 0.01 && inkRatio <= 0.08 && stats.longestRun >= image.width * 0.75 && stats.runCount <= 2) {
      horizontalRuleRows += 1;
    }
  }

  let verticalRuleCols = 0;
  for (let col = 0; col < image.width; col += 1) {
    const stats = computeBinaryLineStats(binary, col, image.height, image.width);
    const inkRatio = stats.inkCount / Math.max(1, image.height);
    if (inkRatio >= 0.01 && inkRatio <= 0.08 && stats.longestRun >= image.height * 0.55 && stats.runCount <= 3) {
      verticalRuleCols += 1;
    }
  }

  const denseBlocks = countDenseThumbnailBlocks(binary, image.width, image.height);

  return {
    inkRatio: inkCount / Math.max(1, image.width * image.height),
    edgeRatio: edgeCount / Math.max(1, (image.width - 1) * (image.height - 1)),
    activeRows,
    textLikeRows,
    graphicsRows,
    horizontalRuleRows,
    verticalRuleCols,
    denseBlocks
  };
}

function parsePortableGraymap(buffer: Buffer): { width: number; height: number; pixels: Uint8Array } {
  let offset = 0;
  const nextToken = () => {
    while (offset < buffer.length) {
      const value = buffer[offset];
      if (value === 35) {
        while (offset < buffer.length && buffer[offset] !== 10) {
          offset += 1;
        }
      } else if (value === 9 || value === 10 || value === 13 || value === 32) {
        offset += 1;
      } else {
        break;
      }
    }

    const start = offset;
    while (offset < buffer.length) {
      const value = buffer[offset];
      if (value === 9 || value === 10 || value === 13 || value === 32 || value === 35) {
        break;
      }
      offset += 1;
    }
    return buffer.toString("ascii", start, offset);
  };

  const magic = nextToken();
  const width = Number.parseInt(nextToken(), 10);
  const height = Number.parseInt(nextToken(), 10);
  const maxValue = Number.parseInt(nextToken(), 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxValue)) {
    throw new Error("invalid_pgm_header");
  }

  while (offset < buffer.length && (buffer[offset] === 9 || buffer[offset] === 10 || buffer[offset] === 13 || buffer[offset] === 32)) {
    offset += 1;
  }

  if (magic === "P5") {
    if (maxValue > 255) {
      const pixels = new Uint8Array(width * height);
      for (let index = 0; index < pixels.length; index += 1) {
        pixels[index] = Math.round(((buffer[offset + index * 2] << 8) | buffer[offset + index * 2 + 1]) / 257);
      }
      return { width, height, pixels };
    }
    return {
      width,
      height,
      pixels: new Uint8Array(buffer.subarray(offset, offset + width * height))
    };
  }

  if (magic === "P2") {
    const pixels = new Uint8Array(width * height);
    for (let index = 0; index < pixels.length; index += 1) {
      const value = Number.parseInt(nextToken(), 10);
      pixels[index] = Math.round((value / Math.max(1, maxValue)) * 255);
    }
    return { width, height, pixels };
  }

  throw new Error(`unsupported_pgm_format:${magic}`);
}

function computeBinaryLineStats(
  binary: Uint8Array,
  start: number,
  length: number,
  stride: number
): BinaryLineStats {
  let inkCount = 0;
  let runCount = 0;
  let longestRun = 0;
  let currentRun = 0;

  for (let index = 0; index < length; index += 1) {
    const value = binary[start + index * stride];
    if (value === 1) {
      inkCount += 1;
      currentRun += 1;
      if (currentRun === 1) {
        runCount += 1;
      }
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  return {
    inkCount,
    runCount,
    longestRun
  };
}

function countDenseThumbnailBlocks(
  binary: Uint8Array,
  width: number,
  height: number
): number {
  const rowBlocks = 8;
  const colBlocks = 8;
  let denseBlocks = 0;

  for (let rowBlock = 0; rowBlock < rowBlocks; rowBlock += 1) {
    const rowStart = Math.floor((rowBlock * height) / rowBlocks);
    const rowEnd = Math.floor(((rowBlock + 1) * height) / rowBlocks);
    for (let colBlock = 0; colBlock < colBlocks; colBlock += 1) {
      const colStart = Math.floor((colBlock * width) / colBlocks);
      const colEnd = Math.floor(((colBlock + 1) * width) / colBlocks);
      let inkCount = 0;
      let total = 0;
      for (let y = rowStart; y < rowEnd; y += 1) {
        for (let x = colStart; x < colEnd; x += 1) {
          inkCount += binary[y * width + x];
          total += 1;
        }
      }
      if (total > 0 && inkCount / total >= 0.18) {
        denseBlocks += 1;
      }
    }
  }

  return denseBlocks;
}

function truncateText(text: string, maxChars: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}\n[TRUNCATED]`;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isVisualPdfPage(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    /\bfigure\s*\d+/u,
    /\bfig\.\s*\d+/u,
    /\btable\s*\d+/u,
    /\bchart\s*\d+/u,
    /\bplot\s*\d+/u,
    /\bgraph\s*\d+/u,
    /\bdiagram\s*\d+/u,
    /\bheatmap\b/u,
    /\bconfusion matrix\b/u,
    /\bablation\b/u
  ].some((pattern) => pattern.test(lower));
}

function buildSpreadPages(totalPages: number, maxImages: number): number[] {
  if (totalPages <= 1 || maxImages <= 1) {
    return [1];
  }

  const result = new Set<number>();
  for (let index = 0; index < maxImages; index += 1) {
    const page = Math.round((index * (totalPages - 1)) / (maxImages - 1)) + 1;
    result.add(page);
  }
  return Array.from(result).sort((left, right) => left - right);
}

function buildThumbnailPath(dirPath: string, page: number): string {
  return path.join(dirPath, `page-${page}.pgm`);
}

function sanitizeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extractPdfLikeUrl(url: string | undefined): string | undefined {
  if (!url || !/\.pdf($|[?#])/i.test(url)) {
    return undefined;
  }
  return url;
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function emptyCachedPageImages(): { paths: string[]; pages: number[] } {
  return {
    paths: [],
    pages: []
  };
}

function hasCompletePageImageSet(pages: number[], pageCount: number): boolean {
  if (pageCount <= 0 || pages.length !== pageCount) {
    return false;
  }
  return pages.every((page, index) => page === index + 1);
}
