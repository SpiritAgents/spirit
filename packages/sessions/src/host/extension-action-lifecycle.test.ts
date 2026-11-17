import assert from "node:assert/strict";
import { test } from "vitest";
import { invokeExtensionActionCommand } from "./host-extension-commands.js";

test("authorization waits outside the shared mutation queue", async () => {
  let tail: Promise<unknown> = Promise.resolve();
  const runSerialized = <T>(work: () => Promise<T>) => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshed = false;
  const context = {
    runSerialized,
    async ensureInitialized() {},
    extensionManager: () => ({
      async invokeAction() {
        started();
        await gate;
        return "done";
      },
    }),
    requireExtensionHostAdapter: () => ({}),
    async refreshRuntimeAfterExtensionMutation() {
      refreshed = true;
    },
  } as unknown as Parameters<typeof invokeExtensionActionCommand>[0];
  const action = invokeExtensionActionCommand(context, {
    id: "personal/demo",
    actionId: "authorize",
  });
  await waiting;
  assert.equal(
    await runSerialized(async () => "queue remains available"),
    "queue remains available",
  );
  assert.equal(refreshed, false);
  release();
  assert.equal(await action, "done");
  assert.equal(refreshed, true);
});
