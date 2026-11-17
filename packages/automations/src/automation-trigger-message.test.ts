import assert from "node:assert/strict";
import { test } from "vitest";

import {
  AUTOMATION_TRIGGER_CLOSE,
  AUTOMATION_TRIGGER_OPEN,
  buildAutomationTriggerMessage,
} from "./automation-trigger-message.js";

test("buildAutomationTriggerMessage wraps a contributed event with meta block", () => {
  const message = buildAutomationTriggerMessage({
    overview: "Summarize the PR.",
    trigger: {
      kind: "extension:personal/demo/activity",
      config: {},
      label: "Repository Activity",
    },
    context: {
      kind: "extension",
      summary: "Repository activity (https://example.test/events/12).",
      context: { number: 12 },
    },
  });
  assert.match(message, new RegExp(`^${AUTOMATION_TRIGGER_OPEN}`));
  assert.match(
    message,
    /Event: Repository activity \(https:\/\/example\.test\/events\/12\)\. {"number":12}/,
  );
  assert.match(message, new RegExp(`${AUTOMATION_TRIGGER_CLOSE}\\n\\nSummarize the PR\\.$`));
});

test("buildAutomationTriggerMessage wraps scheduled time trigger", () => {
  const message = buildAutomationTriggerMessage({
    overview: "Daily digest",
    trigger: { kind: "time", schedule: { kind: "daily", hour: 20, minute: 0 } },
    context: { kind: "time" },
  });
  assert.match(message, /Event: Scheduled run \(daily 20:00\)\./);
  assert.match(message, /Daily digest$/);
});
