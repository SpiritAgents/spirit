import assert from "node:assert/strict";
import { test } from "vitest";

import {
  arePaneHostsAdjacent,
  effectiveRepositionZone,
  hiddenPaneDropZonesForTwoPaneDrag,
  paneDropIndicatorRect,
  paneDropZoneRect,
  visiblePaneDropZonesForDrag,
  visiblePaneDropZonesForSidebarSessionDrag,
} from "../../src/lib/conversation-pane-drop-preview.ts";
import {
  createLeafNode,
  createSinglePaneLayout,
  repositionPane,
  splitPaneAt,
  swapAdjacentPanes,
} from "../../src/lib/conversation-split-layout.ts";

function rect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

test("hiddenPaneDropZonesForTwoPaneDrag hides right edge when source is on the right", () => {
  const target = rect(0, 0, 400, 400);
  const source = rect(420, 0, 400, 400);
  const hidden = hiddenPaneDropZonesForTwoPaneDrag(source, target);
  assert.deepEqual([...hidden].sort(), ["after", "below"]);
});

test("visiblePaneDropZonesForDrag exposes swap row for horizontal adjacency", () => {
  const target = rect(0, 0, 400, 400);
  const source = rect(400, 0, 400, 400);
  const visible = visiblePaneDropZonesForDrag({
    paneCount: 2,
    sourcePaneHost: { getBoundingClientRect: () => source },
    targetPaneHost: { getBoundingClientRect: () => target },
  });
  assert.deepEqual(visible, ["above", "swap", "below"]);
});

test("visiblePaneDropZonesForDrag exposes swap column for vertical adjacency", () => {
  const target = rect(0, 400, 400, 400);
  const source = rect(0, 0, 400, 400);
  const visible = visiblePaneDropZonesForDrag({
    paneCount: 2,
    sourcePaneHost: { getBoundingClientRect: () => source },
    targetPaneHost: { getBoundingClientRect: () => target },
  });
  assert.deepEqual(visible, ["before", "swap", "after"]);
});

test("paneDropIndicatorRect expands swap to full target pane", () => {
  const host = rect(10, 20, 400, 300);
  const visible = ["above", "swap", "below"];
  const indicator = paneDropIndicatorRect(host, "swap", visible);
  assert.deepEqual(indicator, { x: 10, y: 20, width: 400, height: 300 });
  const edge = paneDropIndicatorRect(host, "above", visible);
  assert.equal(edge.height, 120);
  assert.equal(edge.width, 400);
});

test("paneDropZoneRect keeps swap hit target in a narrow center band", () => {
  const host = rect(0, 0, 400, 400);
  const visible = ["above", "swap", "below"];
  const swapHit = paneDropZoneRect(host, "swap", visible);
  assert.equal(swapHit.height, 80);
  assert.equal(swapHit.y, 160);
  assert.equal(swapHit.width, 400);
});

test("effectiveRepositionZone maps collapsed left-right below to after", () => {
  const visible = ["before", "below"];
  assert.equal(effectiveRepositionZone("below", visible), "after");
  assert.equal(effectiveRepositionZone("before", visible), "before");
});

test("repositionPane converts vertical split to horizontal when dropping top onto bottom-right", () => {
  const split = splitPaneAt(
    createSinglePaneLayout("top", "/sessions/top.json"),
    "top",
    "vertical",
    createLeafNode("bottom", "/sessions/bottom.json"),
  );
  const visible = ["before", "swap", "after"];
  const zone = effectiveRepositionZone("after", visible);
  assert.equal(zone, "after");
  const moved = repositionPane(split, "top", "bottom", zone);
  assert.ok(moved);
  assert.equal(moved.kind, "split");
  if (moved.kind !== "split") {
    return;
  }
  assert.equal(moved.direction, "horizontal");
});

test("visiblePaneDropZonesForSidebarSessionDrag uses edge columns and center above/below", () => {
  const visible = visiblePaneDropZonesForSidebarSessionDrag();
  assert.deepEqual(visible, ["before", "above", "after", "below"]);
});

test("paneDropIndicatorRect tiles full halves for sidebar session split", () => {
  const host = rect(0, 0, 400, 400);
  const visible = visiblePaneDropZonesForSidebarSessionDrag();
  const above = paneDropIndicatorRect(host, "above", visible);
  assert.deepEqual(above, { x: 0, y: 0, width: 400, height: 200 });
  const before = paneDropIndicatorRect(host, "before", visible);
  assert.deepEqual(before, { x: 0, y: 0, width: 200, height: 400 });
  const after = paneDropIndicatorRect(host, "after", visible);
  assert.deepEqual(after, { x: 200, y: 0, width: 200, height: 400 });
  const below = paneDropIndicatorRect(host, "below", visible);
  assert.deepEqual(below, { x: 0, y: 200, width: 400, height: 200 });
});

test("paneDropZoneRect keeps sidebar above/below hits in the center column band", () => {
  const host = rect(0, 0, 400, 400);
  const visible = visiblePaneDropZonesForSidebarSessionDrag();
  const aboveHit = paneDropZoneRect(host, "above", visible);
  assert.equal(aboveHit.width, 80);
  assert.equal(aboveHit.x, 160);
  assert.equal(aboveHit.height, 200);
  const beforeHit = paneDropZoneRect(host, "before", visible);
  assert.equal(beforeHit.width, 160);
  assert.equal(beforeHit.height, 400);
});

test("visiblePaneDropZonesForDrag uses full quadrants when panes are not adjacent", () => {
  const target = rect(0, 0, 400, 400);
  const source = rect(500, 500, 400, 400);
  const visible = visiblePaneDropZonesForDrag({
    paneCount: 5,
    sourcePaneHost: { getBoundingClientRect: () => source },
    targetPaneHost: { getBoundingClientRect: () => target },
  });
  assert.deepEqual(visible, ["above", "after", "before", "below"]);
});

test("arePaneHostsAdjacent detects horizontally touching panes", () => {
  const left = rect(0, 0, 400, 400);
  const right = rect(400, 0, 400, 400);
  assert.equal(arePaneHostsAdjacent(right, left), true);
  assert.equal(arePaneHostsAdjacent(left, right), true);
});

test("arePaneHostsAdjacent rejects diagonally separated panes", () => {
  const target = rect(0, 0, 400, 400);
  const source = rect(500, 500, 400, 400);
  assert.equal(arePaneHostsAdjacent(source, target), false);
});

test("swapAdjacentPanes swaps horizontal siblings", () => {
  const split = splitPaneAt(
    createSinglePaneLayout("left", "/sessions/left.json"),
    "left",
    "horizontal",
    createLeafNode("right", "/sessions/right.json"),
  );
  assert.equal(split.kind, "split");
  if (split.kind !== "split") {
    return;
  }
  assert.equal(split.first.paneId, "left");
  assert.equal(split.second.paneId, "right");
  const swapped = swapAdjacentPanes(split, "right", "left");
  assert.equal(swapped.kind, "split");
  if (swapped.kind !== "split") {
    return;
  }
  assert.equal(swapped.first.paneId, "right");
  assert.equal(swapped.second.paneId, "left");
});
