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

test("resolveThinkingSwitchState uses the declared default and temporarily overrides blocked off states", () => {
  const thinkingSwitch = { defaultState: "off" as const, offBlockedEfforts: ["xhigh", "max"] };
  assert.equal(resolveThinkingSwitchState({ thinkingSwitch }), "off");
  assert.equal(resolveThinkingSwitchState({ thinkingSwitch, vendorExtendedThinking: true }), "on");
  assert.equal(
    resolveThinkingSwitchState({ thinkingSwitch, vendorExtendedThinking: false, effort: "high" }),
    "off",
  );
  assert.equal(
    resolveThinkingSwitchState({ thinkingSwitch, vendorExtendedThinking: false, effort: "max" }),
    "on",
  );
  assert.equal(
    resolveThinkingSwitchState({ thinkingSwitch, vendorExtendedThinking: false, effort: "high" }),
    "off",
  );
});

test("resolveThinkingSwitchWirePatch applies the same blocked-effort state resolution", () => {
  const thinkingSwitch = {
    defaultState: "off" as const,
    offBlockedEfforts: ["max"],
    on: { body: { thinking: { type: "adaptive" } } },
    off: "omit" as const,
  };
  assert.equal(resolveThinkingSwitchWirePatch({ thinkingSwitch, effort: "high" }), "omit");
  assert.deepEqual(
    resolveThinkingSwitchWirePatch({ thinkingSwitch, effort: "max" }),
    thinkingSwitch.on,
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
