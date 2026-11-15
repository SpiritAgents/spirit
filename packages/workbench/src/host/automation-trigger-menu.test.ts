import assert from "node:assert/strict";
import { test } from "vitest";

import { invokeDesktopHostCommand } from "./service.js";
import { assertAutomationMenuConfig } from "./automation-menu-values.js";

test("GitHub trigger validation preserves its existing persisted shape", async () => {
  const result = await invokeDesktopHostCommand("validateAutomationTrigger", {
    request: {
      kind: "github",
      config: { owner: "spirit", repo: "demo", event: "pull_request_created" },
    },
  });
  assert.deepEqual(result, {
    kind: "github",
    owner: "spirit",
    repo: "demo",
    event: "pull_request_created",
  });
});

test("GitHub nested menu returns event configs without repository API calls", async () => {
  const result = await invokeDesktopHostCommand("resolveAutomationTriggerMenu", {
    request: { kind: "github", sessionId: "test", path: ["spirit/demo"], page: 1 },
  });
  assert.deepEqual(result, {
    items: [
      {
        action: "select",
        id: "pull_request_created",
        label: "PR created",
        config: { owner: "spirit", repo: "demo", event: "pull_request_created" },
      },
      {
        action: "select",
        id: "issue_created",
        label: "Issue created",
        config: { owner: "spirit", repo: "demo", event: "issue_created" },
      },
    ],
  });
});

test("menu configs reject arrays and non-JSON values", () => {
  assert.throws(() => assertAutomationMenuConfig([]), /must be an object/);
  assert.throws(() => assertAutomationMenuConfig({ value: Number.NaN }), /finite number/);
});
