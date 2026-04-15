import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { getDefaultValidationWorkspaceRoot } from "../src/validationWorkspace.js";

describe("test temp root setup", () => {
  it("routes os.tmpdir under the default external validation root", () => {
    expect(tmpdir()).toBe(path.join(getDefaultValidationWorkspaceRoot(process.cwd()), ".tmp"));
  });
});
