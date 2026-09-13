import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assistantCompactionLive,
  shouldShowAssistantCompactionCollapsible,
} from "../dist-electron/src/lib/conversation-compaction-ui.js";

test("shouldShowAssistantCompactionCollapsible shows Compacting placeholder before summary text", () => {
  const message = {
    id: 2,
    role: "assistant",
    content: "",
    pending: true,
  };

  assert.equal(
    shouldShowAssistantCompactionCollapsible(message, {
      kind: "compressing",
      statusText: "| Compressing…",
    }),
    true,
  );
  assert.equal(
    assistantCompactionLive(message, {
      kind: "compressing",
      statusText: "| Compressing…",
    }),
    true,
  );
});

test("shouldShowAssistantCompactionCollapsible shows finalized compaction summary", () => {
  const message = {
    id: 3,
    role: "assistant",
    content: "",
    pending: false,
    aux: { compaction: "## Context compressed\n\n- dropped 3 turns" },
  };

  assert.equal(shouldShowAssistantCompactionCollapsible(message, undefined), true);
  assert.equal(assistantCompactionLive(message, undefined), false);
});
