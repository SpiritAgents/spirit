import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import {
  isProvisionalSessionPath,
  isSideChatProvisionalSessionPath,
  parseSideChatPaneIdFromSessionPath,
  provisionalNewSessionPath,
  sideChatPaneSessionPath,
} from "../../../../packages/sessions/dist/host/storage.js";

test("sideChatPaneSessionPath normalizes pane id", () => {
  const sessionPath = sideChatPaneSessionPath("pane/a");
  assert.match(path.basename(sessionPath), /^side-chat-pane-a\.json$/u);
  assert.equal(isSideChatProvisionalSessionPath(sessionPath), true);
  assert.equal(isProvisionalSessionPath(sessionPath), true);
  assert.equal(parseSideChatPaneIdFromSessionPath(sessionPath), "pane-a");
});

test("isProvisionalSessionPath detects provisional chat paths only", () => {
  const provisionalPath = provisionalNewSessionPath("D:/Spirit/repo");
  assert.equal(isProvisionalSessionPath(provisionalPath), true);
  assert.equal(
    isProvisionalSessionPath(path.join(path.dirname(provisionalPath), "..", "chat-1.json")),
    false,
  );
});
