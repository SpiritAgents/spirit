import assert from "node:assert/strict";
import { test } from "vitest";

import { runInitCommand } from "./cli-init.js";

test("init forwards raw args to the delegated create-extension entry", async () => {
  let forwarded: string[] | undefined;
  const exitCode = await runInitCommand(["my-ext", "--name", "my-ext", "-y"], async () => ({
    runCreateExtensionCli: async (args: string[]) => {
      forwarded = args;
      return 0;
    },
  }));
  assert.equal(exitCode, 0);
  assert.deepEqual(forwarded, ["my-ext", "--name", "my-ext", "-y"]);
});

test("init reports a delegated module without the expected entry", async () => {
  const exitCode = await runInitCommand([], async () => ({}));
  assert.equal(exitCode, 1);
});
