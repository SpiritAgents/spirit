import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { PRODUCT_BUILD_ID } from "@spiritagent/product";

import { readCurrentToken } from "../src/auth-token.js";
import { ServerRpcClient } from "../src/client.js";
import { startDaemon, type RunningDaemon } from "../src/daemon.js";
import { listInstances } from "../src/instance-registry.js";
import {
  JSON_RPC_METHOD_NOT_FOUND,
  PROTOCOL_VERSION,
  SERVER_CONNECTED,
} from "../src/protocol/index.js";

interface RpcReply {
  id?: number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Thin promise wrapper over Node's built-in WebSocket client for tests.
 * Browser-style clients cannot set Authorization headers, so the daemon
 * also accepts `?token=` — this client exercises that path.
 */
class TestWsClient {
  private readonly ws: WebSocket;
  private readonly queue: RpcReply[] = [];
  private waiters: Array<(reply: RpcReply) => void> = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (event: MessageEvent) => {
      const reply = JSON.parse(String(event.data)) as RpcReply;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(reply);
      } else {
        this.queue.push(reply);
      }
    });
    this.closed = new Promise((resolve) => {
      this.ws.addEventListener("close", (event: CloseEvent) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });
  }

  async open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("ws connect failed")), {
        once: true,
      });
    });
  }

  nextMessage(): Promise<RpcReply> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  send(payload: unknown): void {
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    this.ws.close();
  }
}

async function startTestDaemon(options?: {
  idleExitGraceMs?: number | null;
  onIdleExit?: () => void;
}): Promise<{ daemon: RunningDaemon; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-server-test-"));
  const daemon = await startDaemon({
    dataDir,
    version: "0.0.0-test",
    port: 0,
    log: () => {},
    // Existing tests assert disconnect/approval behavior without wanting the process to self-exit.
    idleExitGraceMs: options?.idleExitGraceMs === undefined ? null : options.idleExitGraceMs,
    ...(options?.onIdleExit ? { onIdleExit: options.onIdleExit } : {}),
  });
  return { daemon, dataDir };
}

describe("daemon lifecycle (smoke #1)", () => {
  it("starts on a random port, registers, serves health/initialize, unregisters on close", async () => {
    const { daemon, dataDir } = await startTestDaemon();
    try {
      assert.ok(daemon.port > 0, "OS assigned a free port");

      const instances = await listInstances(dataDir);
      assert.deepEqual(
        instances.map((instance) => instance.instanceId),
        [daemon.instanceId],
      );
      assert.equal(instances[0]!.port, daemon.port);
      assert.equal(instances[0]!.pid, process.pid);

      const token = await readCurrentToken(dataDir);
      assert.ok(token, "token file created");

      const client = new TestWsClient(`ws://127.0.0.1:${daemon.port}/?token=${token}`);
      await client.open();

      const connected = await client.nextMessage();
      assert.equal(connected.method, SERVER_CONNECTED);
      assert.equal(connected.result, undefined);

      client.send({ jsonrpc: "2.0", id: 1, method: "server.health" });
      const health = await client.nextMessage();
      assert.equal(health.id, 1);
      assert.equal(health.result?.["ok"], true);
      assert.equal(health.result?.["productBuildId"], PRODUCT_BUILD_ID);
      assert.equal(health.result?.["instanceId"], daemon.instanceId);

      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "server.initialize",
        params: { clientKind: "cli", clientId: "test-client" },
      });
      const initialized = await client.nextMessage();
      assert.equal(initialized.id, 2);
      assert.equal(initialized.result?.["protocolVersion"], PROTOCOL_VERSION);
      assert.equal(initialized.result?.["instanceId"], daemon.instanceId);

      client.send({ jsonrpc: "2.0", id: 3, method: "no.such.method" });
      const unknown = await client.nextMessage();
      assert.equal(unknown.error?.code, JSON_RPC_METHOD_NOT_FOUND);

      client.close();
    } finally {
      await daemon.close();
    }
    assert.deepEqual(await listInstances(dataDir), []);
  });

  it("rejects connections without a valid token", async () => {
    const { daemon, dataDir } = await startTestDaemon();
    try {
      const client = new TestWsClient(`ws://127.0.0.1:${daemon.port}/?token=wrong-token`);
      const { code } = await client.closed;
      // Server rejected the upgrade with HTTP 401, so no WS close frame exists.
      assert.ok(code === 1006 || code === 1000);
      // The daemon itself is unaffected and still registered.
      assert.equal((await listInstances(dataDir)).length, 1);
    } finally {
      await daemon.close();
    }
  });

  it("rotate-token takes effect for new handshakes without restart", async () => {
    const { daemon, dataDir } = await startTestDaemon();
    try {
      const { rotateToken } = await import("../src/auth-token.js");
      const rotated = await rotateToken(dataDir);

      const stale = new TestWsClient(`ws://127.0.0.1:${daemon.port}/?token=${rotated}-stale`);
      await stale.closed;

      const fresh = new TestWsClient(`ws://127.0.0.1:${daemon.port}/?token=${rotated}`);
      await fresh.open();
      const connected = await fresh.nextMessage();
      assert.equal(connected.method, SERVER_CONNECTED);
      fresh.close();
    } finally {
      await daemon.close();
    }
  });

  it("notifies shared clients when the daemon disconnects", async () => {
    const { daemon, dataDir } = await startTestDaemon();
    const token = await readCurrentToken(dataDir);
    assert.ok(token);
    const client = new ServerRpcClient({
      url: `ws://127.0.0.1:${daemon.port}`,
      token,
    });
    await client.connect();
    const disconnected = new Promise<Error>((resolve) => {
      client.onDisconnect(resolve);
    });
    await daemon.close();
    assert.match((await disconnected).message, /connection closed/iu);
  });

  it("idle-exits after client process hard-exits (TCP half-close / CLOSE_WAIT)", async () => {
    const idleExits: number[] = [];
    const { daemon, dataDir } = await startTestDaemon({
      idleExitGraceMs: 150,
      onIdleExit: () => {
        idleExits.push(Date.now());
      },
    });
    const token = await readCurrentToken(dataDir);
    assert.ok(token);

    const { spawn } = await import("node:child_process");
    const client = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
const url = new URL('ws://127.0.0.1:${daemon.port}/');
url.searchParams.set('token', ${JSON.stringify(token)});
const ws = new WebSocket(url);
ws.addEventListener('open', () => setTimeout(() => process.exit(0), 50));
ws.addEventListener('error', () => process.exit(1));
`,
      ],
      { stdio: "ignore" },
    );
    assert.equal(await new Promise<number | null>((resolve) => client.on("exit", resolve)), 0);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(idleExits.length, 1, "hard client exit must still trigger idle-exit");
    assert.equal((await listInstances(dataDir)).length, 0);
  });

  it("idle-exits after the last client disconnects (grace), cancelled by a new client", async () => {
    const idleExits: number[] = [];
    const { daemon, dataDir } = await startTestDaemon({
      idleExitGraceMs: 200,
      onIdleExit: () => {
        idleExits.push(Date.now());
      },
    });
    const token = await readCurrentToken(dataDir);
    assert.ok(token);

    const first = new TestWsClient(`ws://127.0.0.1:${daemon.port}/?token=${token}`);
    await first.open();
    assert.equal((await first.nextMessage()).method, SERVER_CONNECTED);
    first.close();
    await first.closed;

    // Reconnect inside grace — must cancel idle-exit.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = new TestWsClient(`ws://127.0.0.1:${daemon.port}/?token=${token}`);
    await second.open();
    assert.equal((await second.nextMessage()).method, SERVER_CONNECTED);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(idleExits.length, 0, "idle-exit must not fire while a client is connected");

    second.close();
    await second.closed;
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(idleExits.length, 1, "idle-exit fires after last client + grace");

    const instances = await listInstances(dataDir);
    assert.equal(instances.length, 0, "registry entry removed on idle-exit");
  });
});
