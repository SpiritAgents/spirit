import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildWindowsToastXml,
  escapeToastXml,
  parseWindowsToastActivation,
  resolveNotificationActionIndex,
  shouldUseWindowsToastXml,
} from "../../src/lib/windows-toast-xml.ts";

test("escapeToastXml escapes reserved characters", () => {
  assert.equal(escapeToastXml(`a&b<c>d"e`), "a&amp;b&lt;c&gt;d&quot;e");
});

test("buildWindowsToastXml uses background COM action arguments", () => {
  const xml = buildWindowsToastXml({
    title: "[Session] Pending",
    body: "line one\nline two",
    tag: "spirit-approval",
    actions: [
      { type: "button", text: "Allow" },
      { type: "button", text: "Deny" },
    ],
  });
  assert.match(xml, /<toast launch="type=click" activationType="background"/);
  assert.match(xml, /<action content="Allow"/);
  assert.match(xml, /arguments="type=action&amp;action=0" activationType="background"/);
  assert.match(xml, /<action content="Deny"/);
  assert.match(xml, /arguments="type=action&amp;action=1" activationType="background"/);
  assert.doesNotMatch(xml, /spirit:\/\/notification-approval/);
  assert.doesNotMatch(xml, /activationType="protocol"/);
});

test("shouldUseWindowsToastXml when actions present", () => {
  assert.equal(
    shouldUseWindowsToastXml({ title: "t", actions: [{ type: "button", text: "OK" }] }),
    true,
  );
  assert.equal(shouldUseWindowsToastXml({ title: "t" }), false);
});

test("parseWindowsToastActivation reads action index from activation details", () => {
  assert.deepEqual(parseWindowsToastActivation({ type: "action", actionIndex: 0 }), {
    kind: "action",
    actionIndex: 0,
  });
});

test("parseWindowsToastActivation reads action index from arguments", () => {
  assert.deepEqual(
    parseWindowsToastActivation({
      type: "click",
      arguments: "type=action&actionIndex=1",
    }),
    { kind: "action", actionIndex: 1 },
  );
});

test("parseWindowsToastActivation reads native action argument", () => {
  assert.deepEqual(
    parseWindowsToastActivation({
      arguments: "type=action&action=0",
    }),
    { kind: "action", actionIndex: 0 },
  );
});

test("resolveNotificationActionIndex prefers event.actionIndex", () => {
  assert.equal(resolveNotificationActionIndex({ actionIndex: 0 }, 1), 0);
  assert.equal(resolveNotificationActionIndex({}, 1), 1);
});
