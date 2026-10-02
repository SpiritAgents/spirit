#!/usr/bin/env node
/** Focused Smoke #8 repro: disconnect while an approval is parked. */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, openSync } from "node:fs";
import { resolveSpiritDataDir } from "@spiritagent/host-internal";
import { join } from "node:path";

const DATA_DIR = process.env.SPIRIT_SERVER_DATA_DIR?.trim() || resolveSpiritDataDir();
const ENTRY = new URL("../dist/src/entry.js", import.meta.url).pathname;
const WORKSPACE = process.cwd();

const readToken = () => readFileSync(join(DATA_DIR, "server.token"), "utf8").trim();

function readLiveInstance() {
  const dir = join(DATA_DIR, "server", "instances");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const record = JSON.parse(readFileSync(join(dir, file), "utf8"));
    try {
      process.kill(record.pid, 0);
      return record;
    } catch {
      /* dead */
    }
  }
  return null;
}

async function ensureDaemon() {
  const live = readLiveInstance();
  if (live) return { instance: live, child: null };
  const logFd = openSync("/tmp/spirit-server-smoke8-daemon.log", "w");
  const child = spawn(process.execPath, [ENTRY, "serve"], { stdio: ["ignore", logFd, logFd] });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const record = readLiveInstance();
    if (record && record.pid === child.pid) return { instance: record, child };
  }
  throw new Error("daemon spawn timeout");
}

function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${readToken()}`);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    for (const fn of listeners) fn(msg);
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () =>
      resolve({
        ws,
        call(method, params) {
          const id = nextId++;
          ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
          return new Promise((res, rej) =>
            pending.set(id, (msg) => {
              if (msg.error) rej(new Error(msg.error.message));
              else res(msg.result);
            }),
          );
        },
        onNotification(fn) {
          listeners.push(fn);
        },
      }),
    );
    ws.addEventListener("error", () => reject(new Error("ws connect failed")));
  });
}

async function main() {
  const { instance, child } = await ensureDaemon();
  console.log(`daemon: ${instance.host}:${instance.port} (pid ${instance.pid})`);

  const client = await connect(instance.port);
  await client.call("server.initialize", { clientKind: "cli", workspaceRoot: WORKSPACE });
  const session = await client.call("session.create", { workspaceRoot: WORKSPACE });
  console.log("session:", session.sessionId);

  const approvalSeen = new Promise((resolve) => {
    client.onNotification((msg) => {
      if (
        msg.method === "runtime.event" &&
        msg.params?.sessionId === session.sessionId &&
        msg.params.event?.kind === "approval-requested"
      ) {
        resolve();
      }
    });
  });
  await client.call("session.submitUserTurn", {
    sessionId: session.sessionId,
    text: "Run the shell command: echo smoke-disconnect-ok",
  });
  await approvalSeen;
  console.log("approval parked; disconnecting");
  client.ws.close();
  await new Promise((r) => setTimeout(r, 800));

  const probe = await connect(instance.port);
  await probe.call("server.initialize", { clientKind: "cli", workspaceRoot: WORKSPACE });
  const deadline = Date.now() + 90_000;
  for (;;) {
    const { snapshot } = await probe.call("session.poll", { sessionId: session.sessionId });
    console.log(`poll: busy=${snapshot.isBusy} pendingApproval=${snapshot.hasPendingApproval}`);
    if (!snapshot.isBusy && !snapshot.hasPendingApproval) break;
    if (Date.now() > deadline) throw new Error("session stayed parked after disconnect");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("smoke #8: OK");
  probe.ws.close();
  if (child) child.kill("SIGTERM");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE #8 FAILED:", err.message);
  process.exit(1);
});
