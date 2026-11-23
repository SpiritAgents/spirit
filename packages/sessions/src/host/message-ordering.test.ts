import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ToolBlockSnapshot } from "@spiritagent/api";
import { normalizeToolBlockSnapshot } from "./message-ordering.js";

describe("normalizeToolBlockSnapshot mcpApp handling", () => {
  it("preserves valid mcpApp metadata and drops invalid non-ui:// schemes", () => {
    const valid: ToolBlockSnapshot = {
      toolCallId: "call_1",
      toolName: "mcp_demo_dashboard",
      phase: "succeeded",
      headline: "Called demo dashboard",
      detailLines: [],
      mcpApp: {
        server: "demo",
        displayName: "Demo",
        toolName: "show_dashboard",
        resourceUri: "ui://demo/dashboard",
        argumentsJson: JSON.stringify({ project: "spirit" }),
        toolResult: { content: [{ type: "text", text: "ok" }] },
      },
    };
    const normalized = normalizeToolBlockSnapshot(valid);
    assert.deepEqual(normalized?.mcpApp, valid.mcpApp);

    const invalidScheme: ToolBlockSnapshot = {
      ...valid,
      mcpApp: {
        server: "demo",
        displayName: "Demo",
        toolName: "show_dashboard",
        resourceUri: "https://evil.example/app",
      },
    };
    const cleaned = normalizeToolBlockSnapshot(invalidScheme);
    assert.equal(cleaned?.mcpApp, undefined);
  });

  it("drops oversized mcpApp.toolResult above 2 MiB while keeping metadata", () => {
    const oversized: ToolBlockSnapshot = {
      toolCallId: "call_big",
      toolName: "mcp_demo_big",
      phase: "succeeded",
      headline: "Called demo big",
      detailLines: [],
      mcpApp: {
        server: "demo",
        displayName: "Demo",
        toolName: "show_big",
        resourceUri: "ui://demo/big",
        argumentsJson: JSON.stringify({ id: 1 }),
        toolResult: { payload: "x".repeat(2 * 1024 * 1024 + 1024) },
      },
    };
    const normalized = normalizeToolBlockSnapshot(oversized);
    assert.equal(normalized?.mcpApp?.resourceUri, "ui://demo/big");
    assert.equal(normalized?.mcpApp?.argumentsJson, JSON.stringify({ id: 1 }));
    assert.equal(normalized?.mcpApp?.toolResult, undefined);
  });
});
