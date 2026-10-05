import assert from "node:assert/strict";
import { test } from "vitest";

import {
  approvalNotificationBody,
  formatSessionPrefixedTitle,
  truncateNotificationBody,
} from "../../src/lib/desktop-notification-copy.ts";

test("formatSessionPrefixedTitle prefixes session name", () => {
  assert.equal(formatSessionPrefixedTitle("My chat", "Task completed"), "[My chat] Task completed");
  assert.equal(formatSessionPrefixedTitle("  ", "Done"), "[Session] Done");
});

test("truncateNotificationBody shortens long text", () => {
  const long = "x".repeat(300);
  assert.equal(truncateNotificationBody(long, 10).length, 10);
  assert.match(truncateNotificationBody(long, 10), /…$/u);
});

test("approvalNotificationBody shows the bare prompt for a reason-less shell approval", () => {
  const body = approvalNotificationBody("shell", "High-risk tool call: shell\nCommand: ls");
  assert.equal(body, "High-risk tool call: shell\nCommand: ls");
});

test("approvalNotificationBody prefixes the title for other approvals", () => {
  const body = approvalNotificationBody("deploy the branch", "Command: npm run build");
  assert.match(body, /^deploy the branch\n/u);
  assert.match(body, /npm run build/u);
});
