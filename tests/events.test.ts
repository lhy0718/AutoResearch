import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { PersistedEventStream, readPersistedRunEvents } from "../src/core/events.js";

describe("persisted event stream", () => {
  it("writes per-run event logs and replays recent events", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "autolabos-events-"));
    const runsDir = path.join(root, ".autolabos", "runs");
    const stream = new PersistedEventStream(runsDir);

    const first = stream.emit({
      type: "OBS_RECEIVED",
      runId: "run-1",
      node: "collect_papers",
      payload: { text: "first" }
    });
    stream.emit({
      type: "OBS_RECEIVED",
      runId: "run-2",
      node: "collect_papers",
      payload: { text: "other" }
    });
    const second = stream.emit({
      type: "OBS_RECEIVED",
      runId: "run-1",
      node: "collect_papers",
      payload: { text: "second" }
    });

    const raw = await fs.readFile(path.join(runsDir, "run-1", "events.jsonl"), "utf8");
    expect(raw).toContain('"runId":"run-1"');
    expect(raw).toContain('"text":"first"');
    expect(raw).toContain('"text":"second"');

    expect(stream.history(10, "run-1").map((event) => event.id)).toEqual([first.id, second.id]);
    expect(readPersistedRunEvents({ runsDir, runId: "run-1", limit: 10 }).map((event) => event.id)).toEqual([
      first.id,
      second.id
    ]);
    expect(readPersistedRunEvents({ runsDir, runId: "run-2", limit: 10 })).toHaveLength(1);
  });
});
