import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setupTempRoot.ts"],
    // Many node-side tests switch process.cwd() to isolated temp workspaces.
    // File-level parallelism makes those tests race on global cwd in CI.
    fileParallelism: false
  }
});
