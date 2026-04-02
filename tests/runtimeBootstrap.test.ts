import { describe, expect, it } from "vitest";

import { bootstrapAutoLabOSRuntime } from "../src/runtime/createRuntime.js";
import { getProjectRoot } from "../src/workspaceGuard.js";

describe("runtime bootstrap workspace guard", () => {
  it("refuses to bootstrap from the repository root", async () => {
    await expect(
      bootstrapAutoLabOSRuntime({
        cwd: getProjectRoot(),
        allowInteractiveSetup: false
      })
    ).rejects.toThrow("must not run from the repository root");
  });
});
