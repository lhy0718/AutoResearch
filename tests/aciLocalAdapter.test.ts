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

  it("forces huggingface tooling offline when network is disabled", async () => {
    const adapter = new LocalAciAdapter({ allowNetwork: false });

    const obs = await adapter.runCommand(
      "printf '%s' \"$HF_HUB_OFFLINE,$TRANSFORMERS_OFFLINE,$HF_DATASETS_OFFLINE\""
    );

    expect(obs.status).toBe("ok");
    expect(obs.stdout?.trim()).toBe("1,1,1");
  });

  it("does not force huggingface tooling offline when network is enabled", async () => {
    const adapter = new LocalAciAdapter({ allowNetwork: true });

    const obs = await adapter.runCommand(
      "printf '%s' \"${HF_HUB_OFFLINE-unset},${TRANSFORMERS_OFFLINE-unset},${HF_DATASETS_OFFLINE-unset}\""
    );

    expect(obs.status).toBe("ok");
    expect(obs.stdout?.trim()).toBe("unset,unset,unset");
  });
});
