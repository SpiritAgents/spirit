/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import { isPointerOverTooltipCompanionOverlays } from "../../src/hooks/tooltip-switch-registry.ts";

afterEach(() => {
  document.body.replaceChildren();
});

test("isPointerOverTooltipCompanionOverlays uses geometry when hit-testing is blocked", () => {
  const tooltip = document.createElement("div");
  tooltip.setAttribute("data-slot", "tooltip-content");
  tooltip.getBoundingClientRect = () => ({
    x: 100,
    y: 100,
    left: 100,
    top: 100,
    right: 300,
    bottom: 300,
    width: 200,
    height: 200,
    toJSON() {},
  });
  document.body.append(tooltip);

  const originalElementsFromPoint = document.elementsFromPoint;
  document.elementsFromPoint = () => [document.documentElement];

  try {
    assert.equal(isPointerOverTooltipCompanionOverlays(150, 150), true);
    assert.equal(isPointerOverTooltipCompanionOverlays(10, 10), false);
  } finally {
    document.elementsFromPoint = originalElementsFromPoint;
  }
});
