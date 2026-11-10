import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isForegroundProvisionalSessionPath,
  isProvisionalSessionPromotion,
  isSideChatPaneProvisionalSessionPath,
  isStableChatSessionPath,
} from "../../src/lib/session-path-kind.ts";

test("isProvisionalSessionPromotion detects first-send promotion", () => {
  const provisional = "/Users/me/Library/Application Support/Spirit/chats/__provisional__/abc.json";
  const stable = "/Users/me/Library/Application Support/Spirit/chats/chat-1783507820.json";

  assert.equal(isForegroundProvisionalSessionPath(provisional), true);
  assert.equal(isStableChatSessionPath(stable), true);
  assert.equal(isProvisionalSessionPromotion(provisional, stable), true);
});

test("isProvisionalSessionPromotion rejects unrelated path swaps", () => {
  const chatA = "/Users/me/Library/Application Support/Spirit/chats/chat-111.json";
  const chatB = "/Users/me/Library/Application Support/Spirit/chats/chat-222.json";

  assert.equal(isProvisionalSessionPromotion(chatA, chatB), false);
});

test("side-chat provisional paths are not foreground draft slots", () => {
  const sideChat =
    "/Users/me/Library/Application Support/Spirit/chats/__provisional__/side-chat-pane-1.json";

  assert.equal(isSideChatPaneProvisionalSessionPath(sideChat), true);
  assert.equal(isForegroundProvisionalSessionPath(sideChat), false);
});
