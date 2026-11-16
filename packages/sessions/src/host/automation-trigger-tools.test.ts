import assert from "node:assert/strict";
import { test } from "vitest";

import { DesktopToolExecutor } from "./tool-executor.js";

test("lazy create_automation schema follows the current trigger registry", () => {
  let contributions = [
    {
      kind: "extension:personal/demo/activity",
      inputSchema: { type: "object" as const },
    },
  ];
  const executor = new DesktopToolExecutor("/tmp", {
    hostContributedToolsEnabled: true,
    automationTriggerContributions: () => contributions,
  });
  const index = () =>
    (
      executor as unknown as {
        builtInLazyToolIndex(): Array<{
          inputSchema: { properties: { trigger: { oneOf: unknown[] } } };
        }>;
      }
    ).builtInLazyToolIndex();

  assert.equal(index()[0]?.inputSchema.properties.trigger.oneOf.length, 2);
  contributions = [];
  assert.equal(index()[0]?.inputSchema.properties.trigger.oneOf.length, 1);
});
