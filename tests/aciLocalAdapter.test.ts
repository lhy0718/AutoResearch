import { describe, expect, it } from "vitest";

import { LocalAciAdapter } from "../src/tools/aciLocalAdapter.js";

describe("LocalAciAdapter", () => {
  it("applies conservative execution env caps to local shell commands", async () => {
    const adapter = new LocalAciAdapter();

    const obs = await adapter.runCommand(
      "printf '%s' \"$OMP_NUM_THREADS,$MKL_NUM_THREADS,$OPENBLAS_NUM_THREADS,$NUMEXPR_NUM_THREADS,$TOKENIZERS_PARALLELISM,$MALLOC_ARENA_MAX\""
    );

    expect(obs.status).toBe("ok");
    expect(obs.stdout?.trim()).toBe("1,1,1,1,false,2");
  });
});
