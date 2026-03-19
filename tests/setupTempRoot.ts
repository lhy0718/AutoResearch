import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = process.env.TMPDIR || path.join(repoRoot, "test", ".tmp");

mkdirSync(testRoot, { recursive: true });

// Route os.tmpdir() into the canonical test temp root.
process.env.TMPDIR = testRoot;
process.env.TMP = testRoot;
process.env.TEMP = testRoot;
