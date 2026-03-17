import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

describe("test temp root setup", () => {
  it("routes os.tmpdir under the repository test directory", () => {
    expect(tmpdir()).toBe(path.join(process.cwd(), "test"));
  });
});
