import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testTmpRoot = path.join(repoRoot, "test", ".tmp");

mkdirSync(testTmpRoot, { recursive: true });

process.env.TMPDIR = testTmpRoot;
process.env.TMP = testTmpRoot;
process.env.TEMP = testTmpRoot;
