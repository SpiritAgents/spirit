import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const remote = vi.hoisted(() => ({
  clients: [],
}));

vi.mock("../../../../packages/sessions/dist/host/remote-runtime.js", () => ({
  sharedDesktopServerClient: async () => remote.clients.at(-1),
}));

import { subscribeDesktopRemoteControl } from "../../../../packages/sessions/dist/host/remote-control-client.js";

function createClient() {
  const notifications = new Set();
  const disconnects = new Set();
  const client = {
    notifications,
    disconnects,
    onNotification(listener) {
      notifications.add(listener);
      return () => notifications.delete(listener);
    },
    onDisconnect(listener) {
      disconnects.add(listener);
      return () => disconnects.delete(listener);
    },
  };
  remote.clients.push(client);
  return client;
}

afterEach(() => {
  remote.clients.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("remote control notifications resubscribe after daemon reconnect", async () => {
  vi.useFakeTimers();
  createClient();
  const onUpdated = vi.fn();
  const onConfirmationRequested = vi.fn();
  const stop = await subscribeDesktopRemoteControl("/tmp/spirit-test", {
    onUpdated,
    onConfirmationRequested,
  });
  const first = remote.clients[0];
  const firstNotification = [...first.notifications][0];
  firstNotification({ method: "remote.updated" });
  assert.equal(onUpdated.mock.calls.length, 1);

  const second = createClient();
  for (const listener of first.disconnects) listener();
  await vi.advanceTimersByTimeAsync(250);

  assert.equal(remote.clients.length, 2);
  assert.equal(first.notifications.size, 0);
  assert.equal(second.notifications.size, 1);
  [...second.notifications][0]({ method: "remote.confirmationRequested" });
  assert.equal(onConfirmationRequested.mock.calls.length, 1);

  stop();
  for (const listener of second.disconnects) listener();
  await vi.advanceTimersByTimeAsync(500);
  assert.equal(remote.clients.length, 2);
  assert.equal(second.notifications.size, 0);
});
