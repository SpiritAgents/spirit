import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import {
  isSplitProvisionalSessionPath,
  parseSplitPaneIdFromSessionPath,
  splitPaneSessionPath,
} from "../../../../packages/sessions/dist/host/storage.js";

test("splitPaneSessionPath is stable for the same pane id", () => {
  assert.equal(splitPaneSessionPath("pane-a"), splitPaneSessionPath("pane-a"));
});

test("splitPaneSessionPath differs across pane ids", () => {
  assert.notEqual(splitPaneSessionPath("pane-a"), splitPaneSessionPath("pane-b"));
});

test("parseSplitPaneIdFromSessionPath round-trips splitPaneSessionPath", () => {
  const paneId = "pane-a";
  const splitPath = splitPaneSessionPath(paneId);
  assert.equal(parseSplitPaneIdFromSessionPath(splitPath), paneId);
});

test("isSplitProvisionalSessionPath detects split provisional chat paths only", () => {
  const splitPath = splitPaneSessionPath("pane-a");
  assert.equal(isSplitProvisionalSessionPath(splitPath), true);
  assert.equal(
    isSplitProvisionalSessionPath(path.join(path.dirname(splitPath), "..", "chat-1.json")),
    false,
  );
});
