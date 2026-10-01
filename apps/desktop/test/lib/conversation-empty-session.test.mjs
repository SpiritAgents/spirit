import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveEffectiveEmptySession } from "../../src/lib/conversation-empty-session.ts";

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
