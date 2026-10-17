import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyConversationDelta,
  deepEqualPlain,
  diffLiveSnapshots,
} from "../../dist-electron/src/lib/live-update.js";

function message(id, content, extra = {}) {
  return { id, role: "assistant", content, pending: false, ...extra };
}

function snapshot(overrides = {}) {
  const messages = overrides.messages ?? [message(1, "hello")];
  return {
    workspaceRoot: "/tmp/workspace",
    userHomeDirectory: "/tmp/home",
    workspaceBinding: "project",
    availableWorkspaces: [],
    git: { isRepo: true, dirty: false },
    dreams: { settings: { enabled: false } },
    runtimeReady: true,
    config: { activeModel: { providerId: "g", name: "m" }, providers: [], models: [] },
    conversation: {
      revision: 1,
      messages,
      loopEnabled: false,
      approvalLevel: "default",
      pendingImagePaths: [],
      pendingMcpResources: [],
      isBusy: true,
      ...overrides.conversation,
    },
    composerSessionKey: "session-a",
    ...overrides.top,
  };
}

test("deepEqualPlain compares plain data structurally", () => {
  assert.equal(deepEqualPlain(1, 1), true);
  assert.equal(deepEqualPlain("a", "a"), true);
  assert.equal(deepEqualPlain({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] }), true);
  assert.equal(deepEqualPlain({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqualPlain([1], { 0: 1 }), false);
  assert.equal(deepEqualPlain({ a: 1 }, { a: 1, b: 2 }), false);
  // Missing key and explicit undefined are equal (conditional-spread snapshot construction).
  assert.equal(deepEqualPlain({ a: 1 }, { a: 1, b: undefined }), true);
  // Shared references short-circuit.
  const shared = { big: "x".repeat(1000) };
  assert.equal(deepEqualPlain({ s: shared }, { s: shared }), true);
});

test("diffLiveSnapshots returns undefined when the session changes", () => {
  const prev = snapshot();
  const next = snapshot({ top: { composerSessionKey: "session-b" } });
  assert.equal(diffLiveSnapshots(prev, next), undefined);
});

test("diffLiveSnapshots returns undefined on top-level changes outside the conversation", () => {
  const prev = snapshot();
  const next = snapshot({ top: { git: { isRepo: true, dirty: true } } });
  assert.equal(diffLiveSnapshots(prev, next), undefined);
});

test("diffLiveSnapshots emits a tail delta when only the last message grows", () => {
  const prev = snapshot({ messages: [message(1, "hello"), message(2, "partial")] });
  const next = snapshot({
    messages: [message(1, "hello"), message(2, "partial answer")],
    conversation: { revision: 2 },
  });
  const delta = diffLiveSnapshots(prev, next);
  assert.ok(delta);
  assert.equal(delta.fromIndex, 1);
  assert.equal(delta.tailMessages.length, 1);
  assert.equal(delta.tailMessages[0].content, "partial answer");
  assert.equal(delta.totalCount, 2);
  assert.equal(delta.baseRevision, 1);
  assert.equal(delta.revision, 2);
});

test("diffLiveSnapshots emits an empty-tail heartbeat delta when nothing changed", () => {
  const prev = snapshot();
  const next = snapshot();
  const delta = diffLiveSnapshots(prev, next);
  assert.ok(delta);
  assert.equal(delta.fromIndex, 1);
  assert.equal(delta.tailMessages.length, 0);
  assert.equal(delta.totalCount, 1);
});

test("diffLiveSnapshots starts the tail at the first changed message", () => {
  const prev = snapshot({ messages: [message(1, "a"), message(2, "b"), message(3, "c")] });
  const next = snapshot({ messages: [message(1, "a"), message(2, "B"), message(3, "c")] });
  const delta = diffLiveSnapshots(prev, next);
  assert.ok(delta);
  assert.equal(delta.fromIndex, 1);
  assert.equal(delta.tailMessages.length, 2);
});

test("applyConversationDelta replaces the tail and preserves prefix identity", () => {
  const prev = snapshot({ messages: [message(1, "hello"), message(2, "partial")] });
  const next = snapshot({
    messages: [message(1, "hello"), message(2, "partial answer")],
    conversation: { revision: 2 },
  });
  const delta = diffLiveSnapshots(prev, next);
  assert.ok(delta);
  const applied = applyConversationDelta(prev, delta);
  assert.ok(applied);
  // Prefix element identity is preserved, so memoized rows do not re-render.
  assert.equal(applied.conversation.messages[0], prev.conversation.messages[0]);
  assert.equal(applied.conversation.messages[1].content, "partial answer");
  assert.equal(applied.conversation.revision, 2);
  // Round-trip: the applied conversation matches the source snapshot.
  assert.equal(deepEqualPlain(applied.conversation, next.conversation), true);
});

test("applyConversationDelta rejects inapplicable deltas", () => {
  const prev = snapshot();
  const good = diffLiveSnapshots(prev, snapshot({ conversation: { revision: 2 } }));
  assert.ok(good);
  assert.equal(applyConversationDelta(undefined, good), undefined);
  assert.equal(
    applyConversationDelta(snapshot({ top: { composerSessionKey: "other" } }), good),
    undefined,
  );
  assert.equal(
    applyConversationDelta(snapshot({ conversation: { revision: 99 } }), good),
    undefined,
  );
  assert.equal(applyConversationDelta(prev, { ...good, fromIndex: 5, totalCount: 6 }), undefined);
  assert.equal(
    applyConversationDelta(prev, { ...good, tailMessages: [message(9, "x")] }),
    undefined,
  );
});

function withPane(base, panePath, paneConversation) {
  return snapshot({
    ...base,
    top: {
      ...base.top,
      paneSessions: {
        [panePath]: {
          conversation: paneConversation,
          composerSessionKey: panePath,
          isForegroundActive: false,
        },
      },
    },
  });
}

test("diffLiveSnapshots emits per-pane deltas when only pane conversations change", () => {
  const panePath = "/tmp/workspace/session-b.jsonl";
  const prevPaneConversation = { revision: 1, messages: [message(1, "pane")] };
  const nextPaneConversation = { revision: 2, messages: [message(1, "pane"), message(2, "new")] };
  const prev = withPane({}, panePath, prevPaneConversation);
  const next = withPane({}, panePath, nextPaneConversation);
  const delta = diffLiveSnapshots(prev, next);
  assert.ok(delta);
  assert.ok(delta.paneDeltas);
  const paneDelta = delta.paneDeltas[panePath];
  assert.equal(paneDelta.fromIndex, 1);
  assert.equal(paneDelta.tailMessages.length, 1);
  assert.equal(paneDelta.baseRevision, 1);

  const applied = applyConversationDelta(prev, delta);
  assert.ok(applied);
  // Untouched pane message identity is preserved after applying.
  assert.equal(
    applied.paneSessions[panePath].conversation.messages[0],
    prevPaneConversation.messages[0],
  );
  assert.equal(applied.paneSessions[panePath].conversation.messages.length, 2);
});

test("diffLiveSnapshots requires a full push when the pane set or pane fields change", () => {
  const panePath = "/tmp/workspace/session-b.jsonl";
  const conv = { revision: 1, messages: [message(1, "pane")] };
  const prev = withPane({}, panePath, conv);
  // Pane closed.
  assert.equal(diffLiveSnapshots(prev, snapshot()), undefined);
  // Pane opened.
  assert.equal(diffLiveSnapshots(snapshot(), prev), undefined);
  // Non-conversation pane field changed.
  const changedField = snapshot({
    top: {
      paneSessions: {
        [panePath]: {
          conversation: conv,
          composerSessionKey: "other-key",
          isForegroundActive: false,
        },
      },
    },
  });
  assert.equal(diffLiveSnapshots(prev, changedField), undefined);
});

test("applyConversationDelta rejects pane deltas without a matching local pane", () => {
  const prev = snapshot();
  const delta = {
    ...diffLiveSnapshots(prev, snapshot()),
    paneDeltas: {
      "/tmp/workspace/missing.jsonl": {
        baseRevision: 1,
        revision: 2,
        conversationHead: {},
        fromIndex: 0,
        tailMessages: [],
        totalCount: 0,
      },
    },
  };
  assert.equal(applyConversationDelta(prev, delta), undefined);
});
