import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { connectOrSpawnServer } from "../../server/src/client.js";
import { listInstances } from "../../server/src/instance-registry.js";

const entryPath = fileURLToPath(new URL("../dist/entry.js", import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function writeConfig(dataDir: string, enabled: boolean, port: number): Promise<void> {
  await writeFile(
    join(dataDir, "config.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        providers: [],
        activeModel: { providerId: "", name: "" },
        webHost: {
          enabled,
          host: "127.0.0.1",
          port,
          devices: [],
          hasCompletedPairing: false,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function startEntry(dataDir: string, port: number): ChildProcess {
  return spawn(process.execPath, [entryPath, "serve"], {
    env: {
      ...process.env,
      SPIRIT_DATA_DIR: dataDir,
      SPIRIT_SERVER_DATA_DIR: dataDir,
      SPIRIT_WEB_HOST: "127.0.0.1",
      SPIRIT_WEB_PORT: String(port),
    },
    stdio: "ignore",
  });
}

async function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [code] = (await Promise.race([
      once(child, "exit"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workbench did not exit")), timeoutMs);
      }),
    ])) as [number | null];
    return code;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cleanup(dataDir: string, child?: ChildProcess): Promise<void> {
  child?.kill("SIGTERM");
  for (const instance of await listInstances(dataDir)) {
    try {
      process.kill(instance.pid, "SIGTERM");
    } catch {
      // The daemon may already have exited.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(dataDir, { recursive: true, force: true });
}

test(
  "disabled configuration exits before opening the Workbench listener",
  { timeout: 20_000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "workbench-disabled-entry-"));
    const port = await freePort();
    await writeConfig(dataDir, false, port);
    const child = startEntry(dataDir, port);
    try {
      assert.equal(await waitForExit(child), 0);
    } finally {
      await cleanup(dataDir, child);
    }
  },
);

test(
  "disabling Remote Control stops an enabled Workbench process",
  { timeout: 20_000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "workbench-enabled-entry-"));
    const port = await freePort();
    await writeConfig(dataDir, true, port);
    const child = startEntry(dataDir, port);
    try {
      const deadline = Date.now() + 10_000;
      let available = false;
      while (Date.now() < deadline && !available) {
        const { client } = await connectOrSpawnServer({ dataDir });
        const state = await client.call<{ hostAvailable: boolean }>("remote.getState");
        client.close();
        available = state.hostAvailable;
        if (!available) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(available, true);
      const { client } = await connectOrSpawnServer({ dataDir });
      await client.call("remote.disable");
      client.close();
      assert.equal(await waitForExit(child), 0);
    } finally {
      await cleanup(dataDir, child);
    }
  },
);
