#!/usr/bin/env node
/**
 * Smoke: desktop timeline sync protocol — client A pushes a timeline snapshot,
 * client B attaches the same live session and pulls it via exportArchive /
 * getDesktopTimeline, and receives session.desktopTimelineUpdated on re-push.
 *
 * No LLM calls: sessions are created but no turn is submitted.
 *
 * Usage: node packages/server/scripts/smoke-desktop-timeline.mjs
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
  const logFd = openSync("/tmp/spirit-server-smoke-timeline-daemon.log", "w");
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

const TIMELINE_V1 = [
  {
    turnId: 1,
    createdOrder: 0,
    userRow: {
      rowId: "row-1",
      messageId: 1,
      turnId: 1,
      kind: "user",
      createdOrder: 0,
      content: "hello from desktop",
      pending: false,
    },
    segments: [
      {
        segmentId: 1,
        turnId: 1,
        kind: "initial",
        status: "completed",
        createdOrder: 1,
        rows: [
          {
            rowId: "row-2",
            messageId: 2,
            turnId: 1,
            segmentId: 1,
            kind: "assistant-text",
            section: "after-tools",
            createdOrder: 2,
            content: "timeline-v1",
            pending: false,
          },
        ],
      },
    ],
  },
];

const TIMELINE_V2 = [
  {
    ...TIMELINE_V1[0],
    segments: [
      {
        ...TIMELINE_V1[0].segments[0],
        rows: [{ ...TIMELINE_V1[0].segments[0].rows[0], content: "timeline-v2" }],
      },
    ],
  },
];

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

async function main() {
  const { instance, child } = await ensureDaemon();
  console.log(`daemon: ${instance.host}:${instance.port} (pid ${instance.pid})`);

  const conversationKey = join(WORKSPACE, ".spirit-smoke-timeline-chat.json");
  const a = await connect(instance.port, "A(desktop)");
  await a.call("server.initialize", {
    clientKind: "desktop",
    clientId: "smoke-timeline-a",
    workspaceRoot: WORKSPACE,
  });
  const session = await a.call("session.create", { workspaceRoot: WORKSPACE, conversationKey });
  await a.call("session.attach", { conversationKey });
  console.log("session:", session.sessionId);

  // First push: revision 1.
  const pushed = await a.call("session.pushDesktopTimeline", {
    sessionId: session.sessionId,
    timeline: TIMELINE_V1,
  });
  if (pushed.revision !== 1) throw new Error(`expected revision 1, got ${pushed.revision}`);
  console.log("A pushed timeline v1 (revision 1)");

  // Client B attaches the same live session and pulls the timeline.
  const b = await connect(instance.port, "B(cli)");
  await b.call("server.initialize", {
    clientKind: "cli",
    clientId: "smoke-timeline-b",
    workspaceRoot: WORKSPACE,
  });
  const attached = await b.call("session.attach", { conversationKey });
  if (attached.session.sessionId !== session.sessionId) {
    throw new Error("attach returned a different sessionId than create");
  }

  const archive = await b.call("session.exportArchive", {
    sessionId: session.sessionId,
    messages: [],
    assistantAux: [],
  });
  assertDeepEqual(
    archive.desktopMessageTimeline,
    TIMELINE_V1,
    "exportArchive desktopMessageTimeline",
  );
  if (archive.desktopMessageTimelineRevision !== 1) {
    throw new Error(
      `exportArchive revision: expected 1, got ${archive.desktopMessageTimelineRevision}`,
    );
  }
  console.log("B exportArchive carries desktopMessageTimeline: OK");

  const pulled = await b.call("session.getDesktopTimeline", { sessionId: session.sessionId });
  if (pulled.revision !== 1)
    throw new Error(`getDesktopTimeline revision: expected 1, got ${pulled.revision}`);
  assertDeepEqual(pulled.timeline, TIMELINE_V1, "getDesktopTimeline timeline");
  console.log("B getDesktopTimeline: OK");

  // B observes the update notification on A's second push.
  const notified = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("desktopTimelineUpdated timeout")), 10_000);
    b.onNotification((msg) => {
      if (
        msg.method === "session.desktopTimelineUpdated" &&
        msg.params?.sessionId === session.sessionId
      ) {
        clearTimeout(timer);
        resolve(msg.params.revision);
      }
    });
  });
  const pushedV2 = await a.call("session.pushDesktopTimeline", {
    sessionId: session.sessionId,
    timeline: TIMELINE_V2,
  });
  if (pushedV2.revision !== 2) throw new Error(`expected revision 2, got ${pushedV2.revision}`);
  const notifiedRevision = await notified;
  if (notifiedRevision !== 2)
    throw new Error(`notification revision: expected 2, got ${notifiedRevision}`);
  const pulledV2 = await b.call("session.getDesktopTimeline", { sessionId: session.sessionId });
  assertDeepEqual(pulledV2.timeline, TIMELINE_V2, "getDesktopTimeline after re-push");
  console.log("B received session.desktopTimelineUpdated (revision 2): OK");

  // Non-array payloads are rejected.
  let rejected = false;
  try {
    await a.call("session.pushDesktopTimeline", {
      sessionId: session.sessionId,
      timeline: { nope: true },
    });
  } catch (error) {
    rejected = /must be an array/.test(error.message);
  }
  if (!rejected) throw new Error("non-array timeline push was not rejected");
  console.log("non-array push rejected: OK");

  // A session without any push exposes no timeline.
  const other = await a.call("session.create", { workspaceRoot: WORKSPACE });
  const empty = await a.call("session.getDesktopTimeline", { sessionId: other.sessionId });
  if (empty !== null) throw new Error("fresh session should have no desktop timeline");
  const emptyArchive = await a.call("session.exportArchive", {
    sessionId: other.sessionId,
    messages: [],
    assistantAux: [],
  });
  if ("desktopMessageTimeline" in emptyArchive) {
    throw new Error("fresh session exportArchive must not include desktopMessageTimeline");
  }
  console.log("session without push exposes no timeline: OK");

  console.log("smoke desktop-timeline: OK");

  a.ws.close();
  b.ws.close();
  if (child) child.kill("SIGTERM");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE desktop-timeline FAILED:", err.message);
  process.exit(1);
});
