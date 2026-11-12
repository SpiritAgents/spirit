import assert from "node:assert/strict";
import { test } from "vitest";

import {
  GlobalTooltipSwitchStateModel,
  isActiveTooltipAnchorSlot,
  tooltipSwitchSlotKey,
  tooltipSwitchSlotsEqual,
} from "../../src/hooks/tooltip-switch-registry.ts";

test("cross-registration instant-switch keeps open", () => {
  const model = new GlobalTooltipSwitchStateModel();
  const itemA = { id: "a" };
  const itemB = { id: "b" };

  assert.equal(model.onTriggerEnter("reg-a", "a", itemA), "schedule-open");
  assert.equal(
    model.openScheduledItem("reg-a", "a", itemA, tooltipSwitchSlotKey("reg-a", "a")),
    true,
  );
  assert.equal(model.open, true);

  assert.equal(model.onTriggerEnter("reg-b", "b", itemB), "instant-switch");
  assert.equal(model.open, true);
  assert.equal(model.activeSlot?.registrationId, "reg-b");
  assert.equal(model.activeSlot?.itemId, "b");
});

test("beginClose keeps linger anchor slot until cleared", () => {
  const model = new GlobalTooltipSwitchStateModel();
  const itemA = { id: "a" };

  model.onTriggerEnter("reg-a", "a", itemA);
  model.openScheduledItem("reg-a", "a", itemA, tooltipSwitchSlotKey("reg-a", "a"));

  const closingSlot = model.beginClose();
  assert.deepEqual(closingSlot, tooltipSwitchSlotKey("reg-a", "a"));
  assert.equal(model.open, false);
  assert.equal(model.anchorSlot?.registrationId, "reg-a");
  assert.equal(model.contentActiveItem, itemA);

  model.clearLingerAnchor();
  assert.equal(model.anchorSlot, null);
  assert.equal(model.contentActiveItem, itemA);

  model.clearLingerContent();
  assert.equal(model.contentActiveItem, null);
});

test("tooltipSwitchSlotsEqual compares registration and item ids", () => {
  const slotA = tooltipSwitchSlotKey("reg-a", "item-1");
  const slotB = tooltipSwitchSlotKey("reg-b", "item-1");
  const slotC = tooltipSwitchSlotKey("reg-a", "item-1");

  assert.equal(tooltipSwitchSlotsEqual(slotA, slotC), true);
  assert.equal(tooltipSwitchSlotsEqual(slotA, slotB), false);
  assert.equal(tooltipSwitchSlotsEqual(null, slotA), false);
});

test("isActiveTooltipAnchorSlot matches registration and item", () => {
  const anchor = tooltipSwitchSlotKey("reg-a", "item-1");
  assert.equal(isActiveTooltipAnchorSlot(anchor, "reg-a", "item-1"), true);
  assert.equal(isActiveTooltipAnchorSlot(anchor, "reg-b", "item-1"), false);
  assert.equal(isActiveTooltipAnchorSlot(null, "reg-a", "item-1"), false);
});
