import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders onboarding when the workspace is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/bootstrap")) {
          return new Response(
            JSON.stringify({
              configured: false,
              setupDefaults: {
                projectName: "AutoResearchV2",
                defaultTopic: "Multi-agent collaboration",
                defaultConstraints: ["recent papers", "last 5 years"],
                defaultObjectiveMetric: "state-of-the-art reproducibility"
              },
              session: {
                busy: false,
                logs: [],
                canCancel: false
              },
              runs: []
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ configured: false, checks: [] }), { status: 200 });
      })
    );
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      } as unknown as typeof EventSource
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Initial setup")).toBeInTheDocument();
      expect(screen.getByText("Initialize workspace")).toBeInTheDocument();
    });
  });
});
