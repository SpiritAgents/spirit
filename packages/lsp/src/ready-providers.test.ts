import assert from "node:assert/strict";
import { test } from "vitest";

import { LspOrchestrator } from "./orchestrator.js";
import { readyProvidersForToolDefinitions } from "./ready-providers.js";

test("readyProvidersForToolDefinitions returns only enabled sessions", async () => {
  const orchestrator = new LspOrchestrator(process.cwd(), undefined, { enabled: true });
  await orchestrator.probe();
  const summaries = readyProvidersForToolDefinitions(orchestrator);
  for (const summary of summaries) {
    assert.ok(summary.displayName.length > 0);
    assert.ok(summary.extensions.length > 0);
  }
  await orchestrator.dispose();
});
