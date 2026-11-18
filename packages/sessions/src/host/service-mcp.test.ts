import assert from "node:assert/strict";
import { test } from "vitest";

import type { McpService } from "@spiritagent/agent-core";
import { refreshMcpServices } from "./service-mcp.js";

test("extension secret changes refresh every cached workspace MCP service", async () => {
  const calls: string[] = [];
  const service = (name: string) =>
    ({
      async refreshConfig() {
        calls.push(`${name}:refresh`);
      },
      startBackgroundRefreshInBackground(force: boolean) {
        calls.push(`${name}:background:${force}`);
      },
    }) as McpService;
  const first = service("first");
  const second = service("second");
  await refreshMcpServices(new Set([first, second]));
  assert.deepEqual(calls.sort(), [
    "first:background:true",
    "first:refresh",
    "second:background:true",
    "second:refresh",
  ]);
});
