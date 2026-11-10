import { test } from "vitest";
import assert from "node:assert/strict";

import {
  closePane,
  collectSplitLayoutLeaves,
  countPanes,
  createLeafNode,
  createSinglePaneLayout,
  findLeafByPaneId,
  findLeafBySessionPath,
  findWorkspaceToolsAnchorPaneId,
  findSessionSidebarAnchorPaneId,
  repositionPane,
  splitPaneAt,
  splitPaneAtZone,
  updateSplitRatio,
  updateSplitRatios,
  collectSplitJunctions,
} from "../../src/lib/conversation-split-layout.ts";

test("splitPaneAt inserts a horizontal sibling", () => {
  const root = createSinglePaneLayout("a", "/sessions/a.json");
  const next = splitPaneAt(root, "a", "horizontal", createLeafNode("b", "/sessions/b.json"));
  assert.equal(countPanes(next), 2);
  assert.equal(findWorkspaceToolsAnchorPaneId(next), "b");
  assert.equal(findSessionSidebarAnchorPaneId(next), "a");
});

test("vertical split anchors the top pane", () => {
  const root = createSinglePaneLayout("a", "/sessions/a.json");
  const next = splitPaneAt(root, "a", "vertical", createLeafNode("b", "/sessions/b.json"));
  assert.equal(findWorkspaceToolsAnchorPaneId(next), "a");
  assert.equal(findSessionSidebarAnchorPaneId(next), "a");
});

test("closePane collapses back to a single leaf", () => {
  const split = splitPaneAt(
    createSinglePaneLayout("a", "/sessions/a.json"),
    "a",
    "horizontal",
    createLeafNode("b", "/sessions/b.json"),
  );
  const closed = closePane(split, "b");
  assert.ok(closed);
  assert.equal(closed?.kind, "leaf");
  assert.equal(closed.paneId, "a");
});

test("closePane in 4-pane grid removes only the closed leaf", () => {
  const bottomLeft = createLeafNode("bl", "/sessions/bl.json");
  const topRight = createLeafNode("tr", "/sessions/tr.json");
  const bottomRight = createLeafNode("br", "/sessions/br.json");
  const twoColumns = splitPaneAt(
    createSinglePaneLayout("tl", "/sessions/tl.json"),
    "tl",
    "horizontal",
    topRight,
  );
  const leftColumn = splitPaneAt(twoColumns, "tl", "vertical", bottomLeft);
  const grid = splitPaneAt(leftColumn, "tr", "vertical", bottomRight);
  assert.equal(countPanes(grid), 4);

  const closed = closePane(grid, "tl");
  assert.ok(closed);
  assert.equal(countPanes(closed), 3);
  const paneIds = collectSplitLayoutLeaves(closed)
    .map((leaf) => leaf.paneId)
    .sort();
  assert.deepEqual(paneIds, ["bl", "br", "tr"]);
});

test("updateSplitRatio updates the matching split node", () => {
  const split = splitPaneAt(
    createSinglePaneLayout("a", "/sessions/a.json"),
    "a",
    "horizontal",
    createLeafNode("b", "/sessions/b.json"),
  );
  assert.equal(split.kind, "split");
  if (split.kind !== "split") {
    return;
  }
  const updated = updateSplitRatio(split, split.splitId, 0.7);
  assert.equal(updated.kind, "split");
  if (updated.kind !== "split") {
    return;
  }
  assert.equal(updated.ratio, 0.7);
});

test("splitPaneAtZone places incoming before target horizontally", () => {
  const root = createSinglePaneLayout("a", "/sessions/a.json");
  const next = splitPaneAtZone(root, "a", "before", createLeafNode("b", "/sessions/b.json"));
  assert.equal(next.kind, "split");
  if (next.kind !== "split") {
    return;
  }
  assert.equal(next.direction, "horizontal");
  assert.equal(next.first.paneId, "b");
  assert.equal(next.second.paneId, "a");
});

test("splitPaneAtZone places incoming after target horizontally", () => {
  const root = createSinglePaneLayout("a", "/sessions/a.json");
  const next = splitPaneAtZone(root, "a", "after", createLeafNode("b", "/sessions/b.json"));
  assert.equal(next.kind, "split");
  if (next.kind !== "split") {
    return;
  }
  assert.equal(next.direction, "horizontal");
  assert.equal(next.first.paneId, "a");
  assert.equal(next.second.paneId, "b");
});

test("splitPaneAtZone places incoming above target vertically", () => {
  const root = createSinglePaneLayout("a", "/sessions/a.json");
  const next = splitPaneAtZone(root, "a", "above", createLeafNode("b", "/sessions/b.json"));
  assert.equal(next.kind, "split");
  if (next.kind !== "split") {
    return;
  }
  assert.equal(next.direction, "vertical");
  assert.equal(next.first.paneId, "b");
  assert.equal(next.second.paneId, "a");
});

test("splitPaneAtZone places incoming below target vertically", () => {
  const root = createSinglePaneLayout("a", "/sessions/a.json");
  const next = splitPaneAtZone(root, "a", "below", createLeafNode("b", "/sessions/b.json"));
  assert.equal(next.kind, "split");
  if (next.kind !== "split") {
    return;
  }
  assert.equal(next.direction, "vertical");
  assert.equal(next.first.paneId, "a");
  assert.equal(next.second.paneId, "b");
});

test("repositionPane moves a leaf below the target", () => {
  const split = splitPaneAt(
    createSinglePaneLayout("a", "/sessions/a.json"),
    "a",
    "horizontal",
    createLeafNode("b", "/sessions/b.json"),
  );
  const moved = repositionPane(split, "b", "a", "below");
  assert.ok(moved);
  assert.equal(moved.kind, "split");
  if (moved.kind !== "split") {
    return;
  }
  assert.equal(moved.direction, "vertical");
  assert.equal(findWorkspaceToolsAnchorPaneId(moved), "a");
  assert.equal(findSessionSidebarAnchorPaneId(moved), "a");
});

test("splitPaneAt supports more than four panes", () => {
  let layout = createSinglePaneLayout("1", "/sessions/1.json");
  for (let i = 2; i <= 6; i += 1) {
    layout = splitPaneAt(
      layout,
      "1",
      "horizontal",
      createLeafNode(String(i), `/sessions/${i}.json`),
    );
  }
  assert.equal(countPanes(layout), 6);
});

test("repositionPane nests a pane into a target quadrant inside a larger layout", () => {
  let layout = splitPaneAt(
    createSinglePaneLayout("a", "/sessions/a.json"),
    "a",
    "horizontal",
    createLeafNode("b", "/sessions/b.json"),
  );
  layout = splitPaneAt(layout, "b", "vertical", createLeafNode("c", "/sessions/c.json"));
  layout = splitPaneAt(layout, "b", "horizontal", createLeafNode("d", "/sessions/d.json"));
  assert.equal(countPanes(layout), 4);
  const moved = repositionPane(layout, "d", "a", "after");
  assert.ok(moved);
  assert.equal(countPanes(moved), 4);
  assert.equal(findLeafByPaneId(moved, "d")?.paneId, "d");
  assert.equal(findLeafByPaneId(moved, "a")?.paneId, "a");
  assert.equal(findLeafBySessionPath(moved, "/sessions/d.json")?.paneId, "d");
});

test("collectSplitJunctions merges four-pane center into one handle", () => {
  let layout = createSinglePaneLayout("tl", "/sessions/tl.json");
  layout = splitPaneAt(layout, "tl", "horizontal", createLeafNode("tr", "/sessions/tr.json"));
  layout = splitPaneAt(layout, "tl", "vertical", createLeafNode("bl", "/sessions/bl.json"));
  layout = splitPaneAt(layout, "tr", "vertical", createLeafNode("br", "/sessions/br.json"));
  assert.equal(countPanes(layout), 4);
  assert.equal(layout.kind, "split");
  if (layout.kind !== "split") {
    return;
  }
  assert.equal(layout.first.kind, "split");
  assert.equal(layout.second.kind, "split");
  const junctions = collectSplitJunctions(layout);
  assert.equal(junctions.length, 1);
  assert.deepEqual(junctions[0].xSplitIds, [layout.splitId]);
  assert.equal(junctions[0].ySplitIds.length, 2);
  assert.ok(junctions[0].ySplitIds.includes(layout.first.splitId));
  assert.ok(junctions[0].ySplitIds.includes(layout.second.splitId));
});

test("updateSplitRatios applies multiple split updates", () => {
  const split = splitPaneAt(
    createSinglePaneLayout("a", "/sessions/a.json"),
    "a",
    "horizontal",
    createLeafNode("b", "/sessions/b.json"),
  );
  assert.equal(split.kind, "split");
  if (split.kind !== "split") {
    return;
  }
  const nested = splitPaneAt(split.first, "a", "vertical", createLeafNode("c", "/sessions/c.json"));
  const layout = { ...split, first: nested };
  assert.equal(layout.kind, "split");
  if (layout.kind !== "split" || layout.first.kind !== "split") {
    return;
  }
  const updated = updateSplitRatios(layout, [
    { splitId: layout.splitId, ratio: 0.6 },
    { splitId: layout.first.splitId, ratio: 0.4 },
  ]);
  assert.equal(updated.kind, "split");
  if (updated.kind !== "split" || updated.first.kind !== "split") {
    return;
  }
  assert.equal(updated.ratio, 0.6);
  assert.equal(updated.first.ratio, 0.4);
});
