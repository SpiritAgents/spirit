import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeTimelineSnapshotForPersistence } from "../../dist-electron/src/host/chat-schema.js";
import { DesktopMessageTimeline } from "../../dist-electron/src/host/message-timeline.js";
import {
  buildArchiveMessagesFromConversation,
  buildStoredDesktopSession,
  restoreStoredSessionState,
  sessionListActivityFromBundle,
} from "../../dist-electron/src/host/sessions.js";
import { createDesktopRewindMetadata } from "../../dist-electron/src/host/rewind.js";
import { buildV2StoredSession, buildV2TimelineFromUserMessage } from "./chat-schema-fixture.mjs";

test("restoreStoredSessionState hydrates messages from v2 timeline", () => {
  const loaded = buildV2StoredSession({
    userContent: "Inspect this file",
    sessionDisplayName: "Inspect this file",
  });

  const restored = restoreStoredSessionState({
    filePath: "D:/Spirit/test-session.json",
    loaded,
  });

  assert.equal(restored.messages.length, 1);
  assert.equal(restored.messages[0].content, "Inspect this file");
  assert.equal(restored.desktopMessageTimeline?.length, 1);
});

test("buildStoredDesktopSession and restoreStoredSessionState roundtrip contextUsage", () => {
  const contextUsage = { inputTokens: 1200, contextLength: 128000, percent: 1 };
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("hello");
  const stored = buildStoredDesktopSession({
    llmHistory: [],
    sessionDisplayName: "hello",
    workspaceRoot: "D:/Spirit",
    desktopMessageTimeline: timeline.snapshot(),
    rewind: createDesktopRewindMetadata(),
    loopEnabled: false,
    approvalLevel: "default",
    contextUsage,
  });

  assert.equal(stored.chatSchemaVersion, 2);
  assert.deepEqual(stored.contextUsage, contextUsage);
  assert.equal("messages" in stored, false);

  const restored = restoreStoredSessionState({
    filePath: "D:/Spirit/test-session.json",
    loaded: stored,
  });

  assert.deepEqual(restored.contextUsage, contextUsage);
});

test("buildStoredDesktopSession and restoreStoredSessionState roundtrip pinnedAtUnixMs", () => {
  const pinnedAtUnixMs = 1735689600000;
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("hello");
  const stored = buildStoredDesktopSession({
    llmHistory: [],
    sessionDisplayName: "hello",
    workspaceRoot: "D:/Spirit",
    desktopMessageTimeline: timeline.snapshot(),
    rewind: createDesktopRewindMetadata(),
    loopEnabled: false,
    approvalLevel: "default",
    pinnedAtUnixMs,
  });

  assert.equal(stored.pinnedAtUnixMs, pinnedAtUnixMs);

  const restored = restoreStoredSessionState({
    filePath: "D:/Spirit/test-session.json",
    loaded: stored,
  });

  assert.equal(restored.pinnedAtUnixMs, pinnedAtUnixMs);

  const unpinned = buildStoredDesktopSession({
    llmHistory: [],
    sessionDisplayName: "hello",
    workspaceRoot: "D:/Spirit",
    desktopMessageTimeline: timeline.snapshot(),
    rewind: createDesktopRewindMetadata(),
    loopEnabled: false,
    approvalLevel: "default",
  });

  assert.equal("pinnedAtUnixMs" in unpinned, false);

  const restoredUnpinned = restoreStoredSessionState({
    filePath: "D:/Spirit/test-session.json",
    loaded: unpinned,
  });

  assert.equal("pinnedAtUnixMs" in restoredUnpinned, false);
});

test("sessionListActivityFromBundle maps runtime busy states", () => {
  assert.deepEqual(sessionListActivityFromBundle(undefined), {});

  assert.deepEqual(
    sessionListActivityFromBundle({
      runtime: {
        isBusy: () => true,
        hasPendingApproval() {
          return true;
        },
        hasPendingQuestions() {
          return false;
        },
      },
    }),
    { isBusy: true, isBlocked: true },
  );

  assert.deepEqual(
    sessionListActivityFromBundle({
      runtime: {
        isBusy: () => true,
        hasPendingApproval() {
          return false;
        },
        hasPendingQuestions() {
          return false;
        },
      },
    }),
    { isBusy: true },
  );
});

test("normalizeTimelineSnapshotForPersistence omits empty assistant content on disk", () => {
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("hello");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("hidden reasoning");
  timeline.appendAssistantTextChunk("visible answer");
  timeline.completeActiveAssistantSegment();

  const fromConversation = normalizeTimelineSnapshotForPersistence(timeline.snapshot());
  const thinkingRow = fromConversation[0].segments[0].rows.find(
    (row) => row.kind === "assistant-thinking",
  );
  const textRow = fromConversation[0].segments[0].rows.find((row) => row.kind === "assistant-text");
  assert.equal("content" in thinkingRow, false);
  assert.equal(textRow.content, "visible answer");
  assert.equal(buildV2TimelineFromUserMessage("hello")[0].userRow.content, "hello");
});

test("beginUserTurn chipNavigateMeta survives snapshot restore", () => {
  const chipNavigateMeta = [{ kind: "workspaceFile", sourceTabId: "tab-files-1" }];
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("see file", { chipNavigateMeta });
  const persisted = normalizeTimelineSnapshotForPersistence(timeline.snapshot());
  const restored = restoreStoredSessionState({
    filePath: "D:/Spirit/test-session.json",
    loaded: buildV2StoredSession({ desktopMessageTimeline: persisted }),
  });
  assert.deepEqual(restored.messages[0].chipNavigateMeta, chipNavigateMeta);
});

test("archive projection omits chipNavigateMeta", () => {
  const archive = buildArchiveMessagesFromConversation([
    {
      id: 1,
      role: "user",
      content: "hello",
      pending: false,
      chipNavigateMeta: [{ kind: "workspaceFile", sourceTabId: "tab-a" }],
    },
  ]);
  assert.deepEqual(archive, [{ role: "user", content: "hello" }]);
});
