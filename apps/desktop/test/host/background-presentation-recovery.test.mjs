import assert from "node:assert/strict";
import { test } from "vitest";
import { RemoteDesktopRuntime } from "../../dist-electron/src/host/remote-runtime.js";
import { replyPendingApprovalCommand } from "../../dist-electron/src/host/session-turn-orchestrator.js";

test("remote replies preserve the displayed input identity rather than the latest snapshot", async () => {
  const calls = [];
  const runtime = new RemoteDesktopRuntime(
    {
      onNotification: () => () => {},
      call: async (method, params) => {
        if (method === "session.exportArchive")
          return { messages: [], llmHistory: [], assistantAux: [] };
        calls.push({ method, params });
        if (!params.requestId) throw new Error("missing requestId");
        return { ok: true };
      },
    },
    "session",
    { messages: [], llmHistory: [], assistantAux: [] },
  );
  await runtime.initializeFromSnapshot({
    currentPendingApproval: { requestId: "new-approval" },
    currentPendingQuestions: { requestId: "new-questions" },
  });
  await runtime.continuePendingApproval({ kind: "allow" }, "shown-approval");
  await runtime.continuePendingQuestions({ status: "skipped" }, "shown-questions");
  assert.equal(calls[0].params.requestId, "shown-approval");
  assert.equal(calls[1].params.requestId, "shown-questions");
  await assert.rejects(runtime.continuePendingApproval({ kind: "allow" }), /missing requestId/);
});

test("a stale guidance reply does not insert a user bubble before the daemon accepts it", async () => {
  const messages = [];
  const ctx = {
    runSerialized: (action) => action(),
    ensureInitialized: async () => {},
    requireRuntime: () => ({
      currentPendingApproval: () => ({ requestId: "new-approval" }),
      continuePendingApproval: async (_decision, requestId) => {
        assert.equal(requestId, "shown-approval");
        throw new Error("This approval is no longer pending.");
      },
    }),
    normalizeApprovalDecision: (decision) => decision,
    insertUserApprovalReplyMessage: (message) => messages.push(message),
  };
  await assert.rejects(
    replyPendingApprovalCommand(
      ctx,
      { kind: "guidance", userMessage: "Use the other option." },
      "shown-approval",
    ),
    /no longer pending/,
  );
  assert.deepEqual(messages, []);
});

test("reconnect recovers offline replies and deduplicates notifications racing with archive export", async () => {
  let listener;
  let release;
  const calls = [];
  const archive = {
    messages: [],
    llmHistory: [],
    assistantAux: [],
    desktopMessageTimeline: [],
    presentation: {
      sequence: 12,
      entries: [
        { sequence: 10, kind: "runtime", event: { kind: "begin-assistant-response" } },
        {
          sequence: 11,
          kind: "runtime",
          event: { kind: "assistant-chunk", text: "Offline reply." },
        },
        { sequence: 12, kind: "runtime", event: { kind: "assistant-response-completed" } },
      ],
    },
  };
  const client = {
    onNotification: (callback) => {
      listener = callback;
      return () => {};
    },
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "session.exportArchive") {
        await new Promise((resolve) => {
          release = resolve;
        });
        return archive;
      }
      return { ok: true };
    },
  };
  const runtime = new RemoteDesktopRuntime(client, "session", {
    messages: [],
    llmHistory: [],
    assistantAux: [],
  });
  const initialized = runtime.initializeFromSnapshot({ isBusy: false }, true);
  listener({
    method: "runtime.event",
    params: {
      sessionId: "session",
      presentationSequence: 11,
      event: { kind: "assistant-chunk", text: "Offline reply." },
    },
  });
  release();
  await initialized;
  const projection = runtime.takeRestoredPresentation();
  assert.equal(
    projection.entries.filter((entry) => entry.event.kind === "assistant-chunk").length,
    1,
  );
  assert.deepEqual(runtime.drainEvents(), []);
  listener({
    method: "runtime.event",
    params: {
      sessionId: "session",
      presentationSequence: 13,
      event: { kind: "begin-assistant-response" },
    },
  });
  runtime.pushDesktopTimeline([]);
  await runtime.dispose();
  assert.equal(calls.at(-1).params.presentationSequence, 12);
  assert.equal(runtime.drainEvents().length, 1);
});

test("live remote user turns are projected between their surrounding runtime event batches", () => {
  let listener;
  const users = [];
  const runtime = new RemoteDesktopRuntime(
    {
      onNotification: (callback) => {
        listener = callback;
        return () => {};
      },
    },
    "session",
    { messages: [], llmHistory: [], assistantAux: [] },
    undefined,
    undefined,
    undefined,
    (input) => users.push(input.text),
  );
  listener({
    method: "runtime.event",
    params: {
      sessionId: "session",
      presentationSequence: 1,
      event: { kind: "assistant-chunk", text: "Prior reply" },
    },
  });
  listener({
    method: "session.userTurnSubmitted",
    params: {
      sessionId: "session",
      presentationSequence: 2,
      text: "Next request",
    },
  });
  listener({
    method: "runtime.event",
    params: {
      sessionId: "session",
      presentationSequence: 3,
      event: { kind: "begin-assistant-response" },
    },
  });
  assert.deepEqual(runtime.drainEvents(), [{ kind: "assistant-chunk", text: "Prior reply" }]);
  assert.deepEqual(users, []);
  assert.deepEqual(runtime.drainEvents(), [{ kind: "begin-assistant-response" }]);
  assert.deepEqual(users, ["Next request"]);
});

test("child events never enter the parent's event drain", () => {
  let listener;
  const runtime = new RemoteDesktopRuntime(
    {
      onNotification(callback) {
        listener = callback;
        return () => {};
      },
    },
    "session",
    { messages: [], llmHistory: [], assistantAux: [] },
  );
  listener({
    method: "session.subagentEvents",
    params: {
      sessionId: "session",
      drains: [
        {
          sessionId: "child",
          parentToolCallId: "delegate",
          events: [{ kind: "assistant-chunk", text: "Child reply." }],
        },
      ],
    },
  });
  listener({
    method: "runtime.event",
    params: {
      sessionId: "session",
      presentationSequence: 1,
      event: { kind: "assistant-chunk", text: "Parent reply." },
    },
  });
  assert.deepEqual(runtime.drainEvents(), [{ kind: "assistant-chunk", text: "Parent reply." }]);
  assert.deepEqual(runtime.drainActiveChildSessionEvents(), [
    {
      sessionId: "child",
      parentToolCallId: "delegate",
      events: [{ kind: "assistant-chunk", text: "Child reply." }],
    },
  ]);
});

test("archive import sends its UI baseline with the matching model history", async () => {
  const calls = [];
  const timeline = [{ turnId: 1, createdOrder: 0, segments: [] }];
  const archive = {
    messages: [],
    assistantAux: [],
    llmHistory: [{ role: "user", content: "Imported context." }],
    desktopMessageTimeline: timeline,
  };
  const runtime = new RemoteDesktopRuntime(
    {
      onNotification: () => () => {},
      async call(method, params) {
        calls.push({ method, params });
        return method === "session.exportArchive" ? archive : { snapshot: { isBusy: false } };
      },
    },
    "session",
    archive,
  );
  await runtime.initialize(false, true);
  assert.deepEqual(calls[0].params.archive.desktopMessageTimeline, timeline);
  assert.deepEqual(runtime.takeRestoredPresentation().timeline, timeline);
  await runtime.dispose();
});
