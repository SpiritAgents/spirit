import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import {
  instanceFilePath,
  isProcessAlive,
  listInstances,
  registerInstance,
  unregisterInstance,
  type ServerInstanceRecord,
} from "../src/instance-registry.js";

async function freshDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "spirit-server-test-"));
}

function record(overrides: Partial<ServerInstanceRecord>): ServerInstanceRecord {
  return {
    instanceId: "instance-1",
    pid: process.pid,
    host: "127.0.0.1",
    port: 12345,
    startedAt: new Date().toISOString(),
    version: "0.0.0-test",
    ...overrides,
  };
}

describe("instance-registry", () => {
  it("registers and lists live instances", async () => {
    const dir = await freshDataDir();
    await registerInstance(dir, record({ instanceId: "a" }));
    await registerInstance(dir, record({ instanceId: "b", port: 2222 }));
    const instances = await listInstances(dir);
    assert.deepEqual(instances.map((instance) => instance.instanceId).sort(), ["a", "b"]);
  });

  it("prunes records whose pid is dead", async () => {
    const dir = await freshDataDir();
    await registerInstance(dir, record({ instanceId: "alive" }));
    // 2^22 is outside typical pid ranges on macOS/Linux and not our process.
    await registerInstance(dir, record({ instanceId: "dead", pid: 4_194_304 }));
    const instances = await listInstances(dir);
    assert.deepEqual(
      instances.map((instance) => instance.instanceId),
      ["alive"],
    );
    // Second listing confirms the stale file was removed, not just filtered.
    const again = await listInstances(dir, { prune: false });
    assert.deepEqual(
      again.map((instance) => instance.instanceId),
      ["alive"],
    );
  });

  it("unregister removes the record file", async () => {
    const dir = await freshDataDir();
    await registerInstance(dir, record({ instanceId: "gone" }));
    await unregisterInstance(dir, "gone");
    assert.deepEqual(await listInstances(dir), []);
    // Idempotent: removing a missing record does not throw.
    await unregisterInstance(dir, "gone");
  });

  it("ignores malformed record files", async () => {
    const dir = await freshDataDir();
    await registerInstance(dir, record({ instanceId: "ok" }));
    const bad = instanceFilePath(dir, "bad");
    await import("node:fs/promises").then(({ writeFile, mkdir }) =>
      mkdir(join(dir, "server", "instances"), { recursive: true }).then(() =>
        writeFile(bad, "not json", "utf8"),
      ),
    );
    const instances = await listInstances(dir);
    assert.deepEqual(
      instances.map((instance) => instance.instanceId),
      ["ok"],
    );
  });

  it("ignores records that vanish between readdir and readFile", async () => {
    const dir = await freshDataDir();
    await registerInstance(dir, record({ instanceId: "alive" }));
    try {
      // A dangling symlink is returned by readdir and fails readFile with ENOENT,
      // deterministically reproducing a concurrent unregisterInstance race.
      await symlink(join(dir, "missing-target.json"), instanceFilePath(dir, "vanished"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPERM") {
        throw err;
      }
    }
    const instances = await listInstances(dir);
    assert.deepEqual(
      instances.map((instance) => instance.instanceId),
      ["alive"],
    );
  });

  it("propagates non-ENOENT read errors from record entries", async () => {
    const dir = await freshDataDir();
    await mkdir(instanceFilePath(dir, "unreadable-dir"), { recursive: true });
    await assert.rejects(() => listInstances(dir), { code: "EISDIR" });
  });

  it("isProcessAlive detects self and rejects invalid pids", () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(0), false);
    assert.equal(isProcessAlive(-1), false);
    assert.equal(isProcessAlive(Number.NaN), false);
  });
});
