import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CODE_DIRS = ["src", "tests", path.join(".codex", "skills")];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md"]);

function walkCodeFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) {
        return [];
      }
      return walkCodeFiles(entryPath);
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      return [];
    }
    return [entryPath];
  });
}

function chars(values: number[]): string {
  return String.fromCharCode(...values);
}

describe("public code sanitization", () => {
  it("does not expose one-off experiment identifiers in public source, tests, or local skills", () => {
    const banned = [
      chars([114, 117, 110, 95, 112, 101, 102, 116, 95, 105, 110, 115, 116, 114, 117, 99, 116, 105, 111, 110, 95, 115, 116, 117, 100, 121]),
      chars([101, 120, 101, 99, 117, 116, 101, 95, 112, 101, 102, 116, 95, 105, 110, 115, 116, 114, 117, 99, 116, 105, 111, 110, 95, 115, 116, 117, 100, 121]),
      chars([114, 117, 110, 95, 108, 111, 114, 97, 95, 114, 97, 110, 107, 95, 100, 114, 111, 112, 111, 117, 116, 95, 115, 116, 117, 100, 121]),
      chars([114, 117, 110, 95, 108, 111, 114, 97, 95, 114, 97, 110, 107, 95, 100, 114, 111, 112, 111, 117, 116, 95, 101, 120, 112, 101, 114, 105, 109, 101, 110, 116, 46, 112, 121]),
      chars([114, 117, 110, 95, 108, 111, 99, 107, 101, 100, 95, 108, 111, 114, 97, 95, 114, 97, 110, 107, 95, 100, 114, 111, 112, 111, 117, 116, 95, 115, 116, 117, 100, 121]),
      chars([101, 120, 101, 99, 117, 116, 101, 95, 108, 111, 99, 107, 101, 100, 95, 108, 111, 114, 97, 95, 114, 97, 110, 107, 95, 100, 114, 111, 112, 111, 117, 116, 95, 115, 116, 117, 100, 121]),
      chars([114, 117, 110, 95, 108, 111, 99, 107, 101, 100, 95, 108, 111, 114, 97, 95, 114, 97, 110, 107, 95, 100, 114, 111, 112, 111, 117, 116, 95, 115, 119, 101, 101, 112]),
      chars([101, 120, 101, 99, 117, 116, 101, 95, 108, 111, 99, 107, 101, 100, 95, 108, 111, 114, 97, 95, 114, 97, 110, 107, 95, 100, 114, 111, 112, 111, 117, 116, 95, 115, 119, 101, 101, 112]),
      chars([108, 111, 114, 97, 45, 114, 97, 110, 107, 45, 100, 114, 111, 112, 111, 117, 116]),
      chars([97, 114, 99, 95, 99, 104, 97, 108, 108, 101, 110, 103, 101]),
      chars([104, 101, 108, 108, 97, 115, 119, 97, 103]),
      chars([65, 82, 67, 45, 67, 104, 97, 108, 108, 101, 110, 103, 101]),
      chars([72, 101, 108, 108, 97, 83, 119, 97, 103]),
      chars([81, 119, 101, 110, 47, 81, 119, 101, 110, 50, 46, 53]),
      chars([81, 119, 101, 110, 50, 46, 53, 45, 49, 46, 53, 66]),
      chars([84, 105, 110, 121, 76, 108, 97, 109, 97]),
      chars([76, 111, 82, 65, 32, 114, 97, 110, 107, 47, 100, 114, 111, 112, 111, 117, 116]),
      chars([114, 97, 110, 107, 95, 56, 95, 100, 114, 111, 112, 111, 117, 116, 95, 48, 95, 48]),
      chars([114, 97, 110, 107, 45, 51, 50]),
      chars([100, 114, 111, 112, 111, 117, 116, 45, 48, 46, 48, 53])
    ];

    const offenders = CODE_DIRS.flatMap(walkCodeFiles).flatMap((relativePath) => {
      const text = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
      return banned
        .filter((pattern) => text.includes(pattern))
        .map((pattern) => ({ relativePath, pattern }));
    });

    expect(offenders).toEqual([]);
  });
});
