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
      approvalPreviewDemoActive: false,
      newThreadBusy: true,
    }),
    true,
  );
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 4,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      approvalPreviewDemoActive: false,
      newThreadBusy: false,
    }),
    false,
  );
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 0,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      approvalPreviewDemoActive: false,
      newThreadBusy: false,
    }),
    true,
  );
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 0,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: true,
      approvalPreviewDemoActive: false,
      newThreadBusy: false,
    }),
    false,
  );
});

test("resolveEffectiveEmptySession treats the approval preview demo as non-empty", () => {
  assert.equal(
    resolveEffectiveEmptySession({
      sessionMessageCount: 0,
      subagentViewActive: false,
      compactionDemoActive: false,
      longConversationListDemoActive: false,
      approvalPreviewDemoActive: true,
      newThreadBusy: false,
    }),
    false,
  );
});
