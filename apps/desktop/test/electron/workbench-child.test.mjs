import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";

import { stopWorkbenchChild } from "../../electron/workbench-child.ts";

test("startup timeout waits for the owned Workbench child to exit", async () => {
  const calls = [];
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    calls.push(signal);
    setImmediate(() => child.emit("exit", 0));
  };
  const state = {
    child,
  };

  let settled = false;
  const stopped = stopWorkbenchChild(state).then(() => {
    settled = true;
  });

  assert.equal(settled, false);
  await stopped;
  assert.equal(settled, true);
  assert.equal(state.child, undefined);
  assert.deepEqual(calls, ["SIGTERM"]);
  await stopWorkbenchChild(state);
  assert.deepEqual(calls, ["SIGTERM"]);
});
