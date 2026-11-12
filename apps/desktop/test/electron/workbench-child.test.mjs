import assert from "node:assert/strict";
import { test } from "vitest";

import { stopWorkbenchChild } from "../../electron/workbench-child.ts";

test("startup timeout stops the owned Workbench child and clears its handle", () => {
  const calls = [];
  const state = {
    child: {
      kill(signal) {
        calls.push(signal);
      },
    },
  };

  stopWorkbenchChild(state);

  assert.equal(state.child, undefined);
  assert.deepEqual(calls, ["SIGTERM"]);
  stopWorkbenchChild(state);
  assert.deepEqual(calls, ["SIGTERM"]);
});
