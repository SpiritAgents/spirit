import assert from "node:assert/strict";
import { test } from "vitest";

import { WorkspaceTasksTrustPromptQueue } from "../../dist-electron/src/host/tasks-trust-prompt.js";

function createHarness() {
  const harness = {
    pending: undefined,
    tail: Promise.resolve(),
    applied: [],
    emitCount: 0,
  };
  const queue = new WorkspaceTasksTrustPromptQueue({
    getPending: () => harness.pending,
    setPending: (request) => {
      harness.pending = request;
    },
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
    const handled = await queue.handleReply(decision);
    harness.pending = undefined;
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
