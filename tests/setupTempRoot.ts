import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(repoRoot, "test");

mkdirSync(testRoot, { recursive: true });

// Route os.tmpdir() into test/ so all mkdtempSync calls create dirs there.
process.env.TMPDIR = testRoot;
process.env.TMP = testRoot;
process.env.TEMP = testRoot;
