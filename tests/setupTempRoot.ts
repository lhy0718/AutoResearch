import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getDefaultValidationWorkspaceRoot } from "../src/validationWorkspace.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationRoot = process.env.AUTOLABOS_VALIDATION_WORKSPACE_ROOT || getDefaultValidationWorkspaceRoot(repoRoot);
const testRoot = path.join(validationRoot, ".tmp");

mkdirSync(testRoot, { recursive: true });

// Route os.tmpdir() into the canonical test temp root.
process.env.TMPDIR = testRoot;
process.env.TMP = testRoot;
process.env.TEMP = testRoot;
