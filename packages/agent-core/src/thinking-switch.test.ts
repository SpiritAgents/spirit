import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveThinkingSwitchState, resolveThinkingSwitchWirePatch } from "./thinking-switch.js";

test("resolveThinkingSwitchState maps vendorExtendedThinking false to off; everything else is on", () => {
  assert.equal(resolveThinkingSwitchState({ vendorExtendedThinking: false }), "off");
  assert.equal(resolveThinkingSwitchState({ vendorExtendedThinking: true }), "on");
  assert.equal(resolveThinkingSwitchState({}), "on");
});

test("resolveThinkingSwitchWirePatch returns the patch for the selected state", () => {
  const thinkingSwitch = {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  };
  assert.deepEqual(resolveThinkingSwitchWirePatch({ thinkingSwitch }), thinkingSwitch.on);
  assert.deepEqual(
    resolveThinkingSwitchWirePatch({ thinkingSwitch, vendorExtendedThinking: false }),
    thinkingSwitch.off,
  );
});

test("resolveThinkingSwitchWirePatch returns undefined without a declaration or state patch", () => {
  assert.equal(resolveThinkingSwitchWirePatch({}), undefined);
  assert.equal(resolveThinkingSwitchWirePatch({ vendorExtendedThinking: false }), undefined);
  // Off state with no off patch: the transport's default disable encoding applies instead.
  assert.equal(
    resolveThinkingSwitchWirePatch({
      thinkingSwitch: { on: { body: { thinking: { type: "enabled" } } } },
      vendorExtendedThinking: false,
    }),
    undefined,
  );
});
