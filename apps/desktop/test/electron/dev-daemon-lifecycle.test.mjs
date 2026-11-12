import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { listInstances } from "../../../../packages/server/dist/src/instance-registry.js";
import { stopRegisteredDaemons } from "../../scripts/dev-daemon-lifecycle.mjs";

const entryPath = fileURLToPath(
  new URL("../../../../packages/server/dist/src/entry.js", import.meta.url),
);

test("dev restart stops and unregisters the previous daemon", async () => {
  const dataDir = await mkdtemp("/tmp/ddl-");
  const child = spawn(process.execPath, [entryPath, "serve"], {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, SPIRIT_SERVER_DATA_DIR: dataDir },
  });
  child.unref();
  try {
    // Contended CI workers can take more than five seconds to load the daemon's dependency graph.
    await expect
      .poll(async () => (await listInstances(dataDir)).length, { timeout: 20_000, interval: 50 })
      .toBe(1);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    await stopRegisteredDaemons(dataDir);
    assert.equal(await exited, 0);
    assert.deepEqual(await listInstances(dataDir), []);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(dataDir, { recursive: true, force: true });
  }
});
