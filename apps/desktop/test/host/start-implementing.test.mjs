import assert from "node:assert/strict";
import { test } from "vitest";
import { RemoteDesktopRuntime } from "../../dist-electron/src/host/remote-runtime.js";

test("Desktop implementation approval uses the daemon action and normal turn bookkeeping", async () => {
  const calls = [];
  const client = {
    onNotification: () => () => {},
    call: async (method, params) => {
      calls.push({ method, params });
      return { accepted: true };
    },
  };
  const runtime = new RemoteDesktopRuntime(client, "session", {
    messages: [],
    llmHistory: [],
    assistantAux: [],
  });
  await runtime.startImplementing();
  assert.equal(runtime.isBusy(), true);
  assert.equal(calls[0].method, "session.startImplementing");
  assert.equal(calls[0].params.sessionId, "session");
  assert.equal(typeof calls[0].params.clientTurnId, "string");
  assert.equal("text" in calls[0].params, false);
  await runtime.startUserTurnStreaming("Ordinary request.");
  assert.equal(calls[1].method, "session.submitUserTurn");
  assert.equal(calls[1].params.text, "Ordinary request.");
});
