import assert from "node:assert/strict";
import { test } from "vitest";
import { RemoteDesktopRuntime } from "../../dist-electron/src/host/remote-runtime.js";

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
