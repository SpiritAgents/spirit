#!/usr/bin/env node
/**
 * Smoke #5 / #8 driver: approval deny+allow, and client-disconnect release.
 *
 * Runs against the shared Spirit config + keychain (real model). Starts its
 * own daemon on a random port (or attaches to a live one via the registry).
 *
 * Usage: node packages/server/scripts/smoke-interactive.mjs
 */

import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolveSpiritDataDir } from "@spiritagent/host-internal";
import { join } from "node:path";

const DATA_DIR = process.env.SPIRIT_SERVER_DATA_DIR?.trim() || resolveSpiritDataDir();
const ENTRY = new URL("../dist/src/entry.js", import.meta.url).pathname;
const WORKSPACE = process.cwd();

function readToken() {
  return readFileSync(join(DATA_DIR, "server.token"), "utf8").trim();
}

function readLiveInstance() {
  const dir = join(DATA_DIR, "server", "instances");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const record = JSON.parse(readFileSync(join(dir, file), "utf8"));
    try {
      process.kill(record.pid, 0);
      return record;
    } catch {
      // dead pid
    }
  }
  return null;
}

async function ensureDaemon() {
  const live = readLiveInstance();
  if (live) return { instance: live, child: null };
  const logFd = (await import("node:fs")).openSync("/tmp/spirit-server-smoke-daemon.log", "w");
  const child = spawn(process.execPath, [ENTRY, "serve"], {
    stdio: ["ignore", logFd, logFd],
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const record = readLiveInstance();
    if (record && record.pid === child.pid) {
      return { instance: record, child };
    }
  }
  throw new Error("daemon spawn timeout");
}

/** Minimal JSON-RPC over WebSocket client (browser-style global WebSocket). */
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
    ws.addEventListener("open", () => {
      resolve({
        ws,
        call(method, params) {
          const id = nextId++;
          ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
          return new Promise((res, rej) => {
            pending.set(id, (msg) => {
              if (msg.error) rej(new Error(msg.error.message));
              else res(msg.result);
            });
          });
        },
        onNotification(fn) {
          listeners.push(fn);
        },
      });
    });
    ws.addEventListener("error", () => reject(new Error("ws connect failed")));
  });
}

function waitFor(client, predicate, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitFor timeout")), timeoutMs);
    client.onNotification((msg) => {
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

async function main() {
  const { instance, child } = await ensureDaemon();
  console.log(`daemon: ${instance.host}:${instance.port} (pid ${instance.pid})`);

  // ---------------- Smoke #5a: deny a shell approval ----------------
  let client = await connect(instance.port);
  await client.call("server.initialize", { clientKind: "cli", workspaceRoot: WORKSPACE });
  let session = await client.call("session.create", { workspaceRoot: WORKSPACE });
  console.log("session (deny run):", session.sessionId);

  let sawApproval = false;
  let sawShellSuccess = false;
  client.onNotification((msg) => {
    if (msg.method !== "runtime.event" || msg.params?.sessionId !== session.sessionId) return;
    const kind = msg.params.event?.kind;
    if (kind === "approval-requested") sawApproval = true;
    if (kind === "tool-execution-finished" && msg.params.event?.execution?.failed === false) {
      sawShellSuccess = true;
    }
  });

  const denyTurn = waitFor(
    client,
    (msg) => msg.method === "session.turnFinished" && msg.params?.sessionId === session.sessionId,
  );
  await client.call("session.submitUserTurn", {
    sessionId: session.sessionId,
    text: "Run the shell command: echo smoke-approval-ok",
  });
  // Answer the approval with deny as soon as it arrives.
  const approvalArrived = waitFor(client, (msg) => {
    if (msg.method !== "runtime.event" || msg.params?.sessionId !== session.sessionId) return false;
    return msg.params.event?.kind === "approval-requested";
  });
  await approvalArrived;
  await client.call("session.replyPendingApproval", {
    sessionId: session.sessionId,
    decision: { kind: "deny", resultText: "smoke denies this call" },
  });
  await denyTurn;
  if (!sawApproval) throw new Error("expected approval-requested in deny run");
  if (sawShellSuccess) throw new Error("shell must not execute after deny");
  console.log("smoke #5a deny: OK");
  await client.call("session.close", { sessionId: session.sessionId });

  // ---------------- Smoke #5b: allow a shell approval ----------------
  session = await client.call("session.create", { workspaceRoot: WORKSPACE });
  sawApproval = false;
  sawShellSuccess = false;
  client.onNotification((msg) => {
    if (msg.method !== "runtime.event" || msg.params?.sessionId !== session.sessionId) return;
    const kind = msg.params.event?.kind;
    if (kind === "approval-requested") sawApproval = true;
    if (kind === "tool-execution-finished" && msg.params.event?.execution?.failed === false) {
      sawShellSuccess = true;
    }
  });
  const allowTurn = waitFor(
    client,
    (msg) => msg.method === "session.turnFinished" && msg.params?.sessionId === session.sessionId,
  );
  await client.call("session.submitUserTurn", {
    sessionId: session.sessionId,
    text: "Run the shell command: echo smoke-approval-ok",
  });
  await waitFor(client, (msg) => {
    if (msg.method !== "runtime.event" || msg.params?.sessionId !== session.sessionId) return false;
    return msg.params.event?.kind === "approval-requested";
  });
  await client.call("session.replyPendingApproval", {
    sessionId: session.sessionId,
    decision: { kind: "allow" },
  });
  await allowTurn;
  if (!sawApproval) throw new Error("expected approval-requested in allow run");
  if (!sawShellSuccess) throw new Error("shell should execute after allow");
  console.log("smoke #5b allow: OK");
  await client.call("session.close", { sessionId: session.sessionId });

  // ---------------- Smoke #8: disconnect releases a parked approval ----------------
  session = await client.call("session.create", { workspaceRoot: WORKSPACE });
  const approvalAgain = waitFor(client, (msg) => {
    if (msg.method !== "runtime.event" || msg.params?.sessionId !== session.sessionId) return false;
    return msg.params.event?.kind === "approval-requested";
  });
  await client.call("session.submitUserTurn", {
    sessionId: session.sessionId,
    text: "Run the shell command: echo smoke-disconnect-ok",
  });
  await approvalAgain;
  // Abruptly drop the only client without answering.
  client.ws.close();
  await new Promise((r) => setTimeout(r, 800));

  const probe = await connect(instance.port);
  await probe.call("server.initialize", { clientKind: "cli", workspaceRoot: WORKSPACE });
  // The daemon denies the parked approval once no clients remain; the turn
  // then finishes (model answers to the denial) and the session goes idle.
  const deadline = Date.now() + 90_000;
  let snapshot;
  for (;;) {
    const polled = await probe.call("session.poll", { sessionId: session.sessionId });
    snapshot = polled.snapshot;
    if (!snapshot.isBusy && !snapshot.hasPendingApproval) break;
    if (Date.now() > deadline) throw new Error("session stayed parked after disconnect");
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("smoke #8 disconnect release: OK");

  probe.ws.close();
  if (child) {
    child.kill("SIGTERM");
  }
  console.log("ALL INTERACTIVE SMOKES PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  process.exit(1);
});
