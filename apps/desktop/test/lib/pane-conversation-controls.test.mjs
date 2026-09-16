import assert from "node:assert/strict";
import { test } from "vitest";

import { resolvePaneCanSend } from "../../src/lib/pane-conversation-controls.ts";

function snapshot(overrides = {}) {
  return {
    runtimeReady: overrides.runtimeReady ?? true,
    config: { activeApiKeyConfigured: overrides.activeApiKeyConfigured ?? true },
    conversation: {
      isBusy: overrides.isBusy ?? false,
      pendingToolApproval: undefined,
      pendingQuestions: undefined,
    },
  };
}

test("resolvePaneCanSend is false when no API key or model is configured", () => {
  assert.equal(resolvePaneCanSend(snapshot({ activeApiKeyConfigured: false })), false);
});

test("resolvePaneCanSend is true when runtime is ready and a model is configured", () => {
  assert.equal(resolvePaneCanSend(snapshot()), true);
});

test("resolvePaneCanSend stays false while the conversation is busy", () => {
  assert.equal(resolvePaneCanSend(snapshot({ isBusy: true })), false);
});
