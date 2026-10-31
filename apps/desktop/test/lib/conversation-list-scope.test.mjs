import assert from "node:assert/strict";
import { test } from "vitest";

import {
  conversationMessageStableId,
  resolveConversationListScopeKey,
} from "../../src/lib/conversation-list-scope.ts";

test("resolveConversationListScopeKey isolates subagent viewer from main list", () => {
  assert.equal(
    resolveConversationListScopeKey({
      subagentViewActive: true,
      subagentToolCallId: "call_abc",
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      approvalPreviewDemoActive: false,
    }),
    "subagent:call_abc",
  );
  assert.equal(
    resolveConversationListScopeKey({
      subagentViewActive: false,
      subagentToolCallId: "call_abc",
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      approvalPreviewDemoActive: false,
    }),
    "main",
  );
});

test("resolveConversationListScopeKey isolates long list perf demo", () => {
  assert.equal(
    resolveConversationListScopeKey({
      subagentViewActive: false,
      subagentToolCallId: null,
      compactionDemoActive: false,
      longConversationListDemoActive: true,
      approvalPreviewDemoActive: false,
    }),
    "long-list-demo",
  );
});

test("resolveConversationListScopeKey isolates approval preview demo", () => {
  assert.equal(
    resolveConversationListScopeKey({
      subagentViewActive: false,
      subagentToolCallId: null,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      approvalPreviewDemoActive: true,
    }),
    "approval-preview-demo",
  );
});

test("conversationMessageStableId namespaces ids across list scopes", () => {
  const message = { id: 1, role: "assistant", content: "hi", pending: false };
  const sessionKey = "session-1";
  const mainKey = conversationMessageStableId(message, sessionKey, "main");
  const subagentKey = conversationMessageStableId(message, sessionKey, "subagent:call_abc");
  assert.notEqual(mainKey, subagentKey);
  assert.match(mainKey, /:main:message-1-/);
  assert.match(subagentKey, /:subagent:call_abc:message-1-/);
});
