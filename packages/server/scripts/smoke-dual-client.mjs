#!/usr/bin/env node
/**
 * Smoke #6: two clients share one daemon session — client A submits a turn,
 * client B receives the streaming chunks in real time.
 *
 * Usage: node packages/server/scripts/smoke-dual-client.mjs
 */
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
  const logFd = openSync("/tmp/spirit-server-smoke6-daemon.log", "w");
  const child = spawn(process.execPath, [ENTRY, "serve"], { stdio: ["ignore", logFd, logFd] });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const record = readLiveInstance();
    if (record && record.pid === child.pid) return { instance: record, child };
  }
  throw new Error("daemon spawn timeout");
}

function connect(port, label) {
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
        label,
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
    ws.addEventListener("error", () => reject(new Error(`ws connect failed (${label})`)));
  });
}

async function main() {
  const { instance, child } = await ensureDaemon();
  console.log(`daemon: ${instance.host}:${instance.port} (pid ${instance.pid})`);

  // Client A owns the session; client B attaches by conversationKey.
  const conversationKey = join(WORKSPACE, ".spirit-smoke6-chat.json");
  const a = await connect(instance.port, "A");
  await a.call("server.initialize", {
    clientKind: "cli",
    clientId: "smoke-a",
    workspaceRoot: WORKSPACE,
  });
  const session = await a.call("session.create", { workspaceRoot: WORKSPACE, conversationKey });
  await a.call("session.attach", { conversationKey });
  console.log("session:", session.sessionId);

  const b = await connect(instance.port, "B");
  await b.call("server.initialize", {
    clientKind: "desktop",
    clientId: "smoke-b",
    workspaceRoot: WORKSPACE,
  });
  const attached = await b.call("session.attach", { conversationKey });
  if (attached.session.sessionId !== session.sessionId) {
    throw new Error("attach returned a different sessionId than create");
  }
  console.log("B attached:", attached.session.sessionId);

  // B sees the session in the shared list.
  const listForB = await b.call("session.list", {});
  if (!listForB.sessions.some((s) => s.sessionId === session.sessionId)) {
    throw new Error("client B does not see the session created by A");
  }
  console.log("session visible to B: OK");

  // B collects streaming chunks for A's turn.
  let bChunks = 0;
  let bSawBegin = false;
  let bSawFinished = false;
  let aText = "";
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("turn timeout")), 90_000);
    b.onNotification((msg) => {
      if (msg.params?.sessionId !== session.sessionId) return;
      if (msg.method === "runtime.event") {
        const kind = msg.params.event?.kind;
        if (kind === "begin-assistant-response") bSawBegin = true;
        if (kind === "assistant-chunk") bChunks += 1;
      }
      if (msg.method === "session.turnFinished") {
        bSawFinished = true;
        clearTimeout(timer);
        resolve();
      }
    });
    a.onNotification((msg) => {
      if (msg.params?.sessionId !== session.sessionId) return;
      if (msg.method === "runtime.event" && msg.params.event?.kind === "assistant-chunk") {
        aText += msg.params.event.text;
      }
    });
  });

  await a.call("session.submitUserTurn", {
    sessionId: session.sessionId,
    text: "Reply with exactly: dual-client-ok",
  });
  await done;

  if (!bSawBegin) throw new Error("B never saw begin-assistant-response");
  if (bChunks === 0) throw new Error("B received no streaming chunks");
  if (!bSawFinished) throw new Error("B never saw session.turnFinished");
  if (!aText.includes("dual-client-ok")) throw new Error(`unexpected assistant text: ${aText}`);
  console.log(`B received ${bChunks} chunks; A text: ${aText.trim()}`);
  console.log("smoke #6 dual-client: OK");

  a.ws.close();
  b.ws.close();
  if (child) child.kill("SIGTERM");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE #6 FAILED:", err.message);
  process.exit(1);
});
