import assert from "node:assert/strict";
import { test } from "vitest";

import { WorkspaceTasksTrustPromptQueue } from "../../dist-electron/src/host/tasks-trust-prompt.js";

function createHarness() {
  const harness = {
    pending: undefined,
    tail: Promise.resolve(),
    applied: [],
    emitCount: 0,
    shown: false,
  };
  const queue = new WorkspaceTasksTrustPromptQueue({
    getPending: () => harness.pending,
    setPending: (request) => {
      harness.pending = request;
    },
    isPromptShown: () => harness.shown,
    getTail: () => harness.tail,
    setTail: (next) => {
      harness.tail = next;
    },
    emit: () => {
      harness.emitCount += 1;
    },
    apply: async (waiter, decision) => {
      harness.applied.push({
        waiter: { workspaceRoot: waiter.workspaceRoot, contentHash: waiter.contentHash },
        decision,
      });
    },
  });
  const reply = async (decision) => {
    const answered = harness.pending;
    const handled = await queue.handleReply(decision, answered);
    harness.pending = undefined;
    harness.shown = false;
    return handled;
  };
  return { harness, queue, reply };
}

function payload(contentHash, items = [{ label: "a", command: "make", sourcePath: "/x" }]) {
  return { contentHash, hashChanged: false, items };
}

function hooksPending(root) {
  return {
    workspaceRoot: root,
    contentHash: "hooks-hash",
    hashChanged: false,
    hooks: [
      { event: "sessionStart", command: "hooks/x.sh", resolvedPath: `${root}/.spirit/hooks/x.sh` },
    ],
  };
}

// The tail's open slot is held until the reply; flushing microtasks twice runs the queued
// open() without awaiting the held slot.
async function flushTail() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("a standalone tasks prompt opens a pending request and a reply applies the waiter", async () => {
  const { harness, queue, reply } = createHarness();
  queue.request(payload("t1"), "/repo");
  await flushTail();

  assert.equal(harness.pending?.workspaceRoot, "/repo");
  assert.deepEqual(harness.pending?.hooks, []);
  assert.equal(harness.pending?.tasks?.contentHash, "t1");
  assert.equal(harness.emitCount, 1);

  const handled = await reply("alwaysTrust");
  assert.equal(handled, true);
  assert.deepEqual(harness.applied, [
    { waiter: { workspaceRoot: "/repo", contentHash: "t1" }, decision: "alwaysTrust" },
  ]);
});

test("a tasks prompt merges into an open same-root hooks prompt and one reply covers both", async () => {
  const { harness, queue, reply } = createHarness();
  harness.pending = hooksPending("/repo");

  queue.request(payload("t1"), "/repo");
  await flushTail();

  // One pending request carries both sections.
  assert.equal(harness.pending?.hooks?.length, 1);
  assert.equal(harness.pending?.tasks?.contentHash, "t1");
  assert.equal(harness.emitCount, 1);

  const handled = await reply("allowOnce");
  assert.equal(handled, true);
  assert.deepEqual(harness.applied, [
    { waiter: { workspaceRoot: "/repo", contentHash: "t1" }, decision: "allowOnce" },
  ]);
});

test("an identical tasks prompt for the same root is not enqueued twice", async () => {
  const { harness, queue } = createHarness();
  harness.pending = hooksPending("/repo");
  queue.request(payload("t1"), "/repo");
  await flushTail();
  const merged = harness.pending;
  const emits = harness.emitCount;

  queue.request(payload("t1"), "/repo");
  await flushTail();
  assert.equal(harness.pending, merged);
  assert.equal(harness.emitCount, emits);
});

test("a different workspace root queues a separate prompt", async () => {
  const { harness, queue, reply } = createHarness();
  queue.request(payload("t1"), "/repo-a");
  queue.request(payload("t2"), "/repo-b");
  await flushTail();
  assert.equal(harness.pending?.workspaceRoot, "/repo-a");

  await reply("deny");
  await flushTail();
  assert.equal(harness.pending?.workspaceRoot, "/repo-b");
  assert.equal(harness.pending?.tasks?.contentHash, "t2");
  assert.deepEqual(harness.applied, [
    { waiter: { workspaceRoot: "/repo-a", contentHash: "t1" }, decision: "deny" },
  ]);
});

test("a reply to a prompt whose tasks section no longer matches does not apply the waiter", async () => {
  const { harness, queue, reply } = createHarness();
  queue.request(payload("t1"), "/repo");
  await flushTail();

  // The pending request was replaced by different content before the reply arrived.
  harness.pending = { ...harness.pending, tasks: payload("t2") };
  const handled = await reply("alwaysTrust");
  assert.equal(handled, false);
  assert.deepEqual(harness.applied, []);

  // The tail slot still released: a queued request opens afterwards.
  queue.request(payload("t3"), "/repo");
  await flushTail();
  assert.equal(harness.pending?.tasks?.contentHash, "t3");
});

test("a tasks request never merges into an already-displayed prompt", async () => {
  const { harness, queue, reply } = createHarness();
  // Model the real host: a displayed remote prompt holds its tail slot until the reply.
  let releaseRemoteSlot = () => {};
  harness.tail = new Promise((resolve) => {
    releaseRemoteSlot = resolve;
  });
  harness.pending = hooksPending("/repo");
  harness.shown = true;

  queue.request(payload("t1"), "/repo");
  await flushTail();
  // Not merged: the open prompt keeps its hooks-only content.
  assert.equal(harness.pending.tasks, undefined);

  await reply("deny");
  releaseRemoteSlot();
  await flushTail();
  // The queued standalone tasks prompt opens after the displayed one is answered.
  assert.equal(harness.pending?.tasks?.contentHash, "t1");
  assert.deepEqual(harness.pending?.hooks, []);
});

test("a tasks request merges while the same-root prompt is queued but not displayed", async () => {
  const { harness, queue } = createHarness();
  harness.pending = hooksPending("/repo");
  harness.shown = false;

  queue.request(payload("t1"), "/repo");
  await flushTail();
  assert.equal(harness.pending.hooks.length, 1);
  assert.equal(harness.pending.tasks?.contentHash, "t1");
});

test("a second reply while the first apply is in flight no-ops and cannot reorder", async () => {
  const { harness, queue } = createHarness();
  queue.request(payload("t1"), "/repo");
  await flushTail();
  const answered = harness.pending;

  const first = queue.handleReply("deny", answered);
  // The waiter was consumed synchronously: a re-entrant second reply finds nothing.
  const second = await queue.handleReply("alwaysTrust", answered);
  assert.equal(second, false);
  await first;
  assert.deepEqual(
    harness.applied.map((entry) => entry.decision),
    ["deny"],
  );
});
