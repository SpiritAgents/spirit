import assert from "node:assert/strict";
import { test } from "vitest";

import {
  resolveEffectiveEmptySession,
  shouldClearConversationSnapshotStale,
  shouldHideStaleConversationMessages,
  shouldMarkConversationSnapshotStale,
  shouldSuppressStaleConversation,
} from "../../src/lib/conversation-surface-stale.ts";

test("shouldMarkConversationSnapshotStale marks non-conversation surfaces only", () => {
  assert.equal(shouldMarkConversationSnapshotStale("conversation"), false);
  assert.equal(shouldMarkConversationSnapshotStale("marketplace"), true);
  assert.equal(shouldMarkConversationSnapshotStale("settings"), true);
});

test("shouldClearConversationSnapshotStale clears on settled conversation surface", () => {
  assert.equal(
    shouldClearConversationSnapshotStale({
      activeSurface: "marketplace",
      sessionNavigationBusy: false,
      newChatBusy: false,
    }),
    false,
  );
  assert.equal(
    shouldClearConversationSnapshotStale({
      activeSurface: "conversation",
      sessionNavigationBusy: true,
      newChatBusy: false,
    }),
    false,
  );
  assert.equal(
    shouldClearConversationSnapshotStale({
      activeSurface: "conversation",
      sessionNavigationBusy: false,
      newChatBusy: false,
    }),
    true,
  );
});

test("shouldSuppressStaleConversation suppresses only stale in-flight conversation nav", () => {
  const base = {
    conversationSnapshotStale: true,
    activeSurface: "conversation",
    sessionNavigationBusy: false,
    newChatBusy: true,
  };
  assert.equal(shouldSuppressStaleConversation(base), true);
  assert.equal(
    shouldSuppressStaleConversation({ ...base, conversationSnapshotStale: false }),
    false,
  );
  assert.equal(shouldSuppressStaleConversation({ ...base, activeSurface: "marketplace" }), false);
  assert.equal(
    shouldSuppressStaleConversation({
      ...base,
      newChatBusy: false,
      sessionNavigationBusy: false,
    }),
    false,
  );
});

test("resolveEffectiveEmptySession treats pending reset as empty even with stale messages", () => {
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 4,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      newChatBusy: true,
    }),
    true,
  );
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 4,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      newChatBusy: false,
    }),
    false,
  );
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 0,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      newChatBusy: false,
    }),
    true,
  );
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 0,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: true,
      newChatBusy: false,
    }),
    false,
  );
});

test("shouldHideStaleConversationMessages hides list while opening another session", () => {
  assert.equal(
    shouldHideStaleConversationMessages({
      suppressStaleConversation: true,
      sessionNavigationBusy: true,
    }),
    true,
  );
  assert.equal(
    shouldHideStaleConversationMessages({
      suppressStaleConversation: true,
      sessionNavigationBusy: false,
    }),
    false,
  );
});
