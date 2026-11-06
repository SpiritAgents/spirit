import assert from "node:assert/strict";
import { test } from "vitest";
import {
  RemoteDesktopRuntime,
  resolveRemoteUserSessionTarget,
} from "../../dist-electron/src/host/remote-runtime.js";
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

test("native session archives refresh independently and retain their latest summaries", async () => {
  let listener;
  let listedSessions = [];
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const nativeArchive = {
    summary: {
      sessionId,
      parentToolCallId: "delegate-native",
      title: "Native continuation",
      status: "running",
      startedAtUnixMs: 1,
      updatedAtUnixMs: 1,
    },
    llmHistory: [
      {
        role: "user",
        content: "<user_message_at>2026-11-06T01:00:00.000+08:00</user_message_at>\nNative prompt",
      },
    ],
  };
  const runtime = new RemoteDesktopRuntime(
    {
      onNotification(callback) {
        listener = callback;
        return () => {};
      },
      async call(method) {
        if (method === "session.exportArchive")
          return { messages: [], llmHistory: [], assistantAux: [] };
        if (method === "session.subagentSessionArchive") return nativeArchive;
        if (method === "session.list") return { sessions: listedSessions };
        return { ok: true };
      },
    },
    "parent",
    { messages: [], llmHistory: [], assistantAux: [] },
  );
  await runtime.initializeFromSnapshot({
    childSessions: [nativeArchive.summary],
    isBusy: false,
  });
  await runtime.ensureChildSessionArchivesFresh();
  assert.equal(runtime.childSessionArchives()[0]?.summary.sessionId, sessionId);
  assert.equal(runtime.drainEvents().length, 0);
  assert.equal(await resolveRemoteUserSessionTarget(runtime, "delegate-native"), undefined);
  listedSessions = [
    {
      sessionId,
      sessionKind: "default",
      conversationKey: "/sessions/user.json",
      workspaceRoot: "/workspace",
    },
  ];
  assert.deepEqual(await resolveRemoteUserSessionTarget(runtime, "delegate-native"), {
    conversationKey: "/sessions/user.json",
    workspaceRoot: "/workspace",
  });
  listedSessions = [];

  nativeArchive.llmHistory.push({ role: "assistant", content: "Native reply" });
  listener({
    method: "session.subagentEvents",
    params: {
      sessionId: "parent",
      drains: [
        {
          sessionId,
          parentToolCallId: "delegate-native",
          archive: nativeArchive,
          events: [{ kind: "assistant-chunk", text: "Native reply" }],
        },
      ],
    },
  });
  assert.equal(runtime.drainEvents().length, 0);
  assert.equal(runtime.drainActiveChildSessionEvents().length, 1);

  nativeArchive.summary = {
    ...nativeArchive.summary,
    status: "completed",
    finalOutput: "Native reply",
    completedAtUnixMs: 2,
    updatedAtUnixMs: 2,
  };
  listener({
    method: "session.snapshot",
    params: {
      sessionId: "parent",
      snapshot: { childSessions: [nativeArchive.summary], isBusy: false },
    },
  });
  assert.equal(runtime.childSessionArchives()[0]?.summary.status, "completed");
  await runtime.ensureChildSessionArchivesFresh();
  assert.equal(runtime.childSessionArchives().length, 1);
  assert.equal(runtime.childSessionArchives()[0]?.summary.status, "completed");
  assert.equal(runtime.childSessionArchives()[0]?.llmHistory.length, 2);
});

test("native archives retain separate parent links for continued sessions", async () => {
  const sessionId = "00000000-0000-4000-8000-000000000002";
  const summaries = ["delegate-first", "delegate-second"].map((parentToolCallId) => ({
    sessionId,
    parentToolCallId,
    title: "Shared native session",
    status: "completed",
    startedAtUnixMs: 1,
    updatedAtUnixMs: 1,
  }));
  const runtime = new RemoteDesktopRuntime(
    {
      onNotification: () => () => {},
      async call(method, params) {
        if (method === "session.exportArchive")
          return { messages: [], llmHistory: [], assistantAux: [] };
        if (method === "session.subagentSessionArchive") {
          const summary = summaries.find(
            (candidate) => candidate.parentToolCallId === params.parentToolCallId,
          );
          return {
            summary,
            llmHistory: [{ role: "user", content: "Shared prompt" }],
          };
        }
        return { ok: true };
      },
    },
    "parent",
    { messages: [], llmHistory: [], assistantAux: [] },
  );
  await runtime.initializeFromSnapshot({ childSessions: summaries, isBusy: false });
  await runtime.ensureChildSessionArchivesFresh();
  assert.equal(runtime.childSessionArchives().length, 2);
  assert.deepEqual(
    runtime.childSessionArchives().map((entry) => entry.summary.parentToolCallId),
    ["delegate-first", "delegate-second"],
  );
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
