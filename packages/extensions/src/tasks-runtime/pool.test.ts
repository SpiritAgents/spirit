import assert from "node:assert/strict";
import { test } from "vitest";

import { TaskTerminalPool } from "./pool.js";

const KEY = "/repo/.spirit/tasks.json#build";
const OTHER_KEY = "/repo/.spirit/tasks.json#test";

test("shared claims an idle same-key terminal, otherwise creates", () => {
  const pool = new TaskTerminalPool();
  assert.deepEqual(pool.claim(KEY, "shared"), { create: true });
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "shared"), { reuse: "t1" });
});

test("dedicated claims an idle same-key terminal, otherwise creates", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "dedicated"), { reuse: "t1" });
  assert.deepEqual(pool.claim(KEY, "dedicated"), { create: true });
});

test("new always creates even when an idle terminal exists", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "new"), { create: true });
  assert.equal(pool.idleCount(KEY), 1);
});

test("idle terminals of other keys are not claimed", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(OTHER_KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "shared"), { create: true });
  assert.deepEqual(pool.claim(OTHER_KEY, "shared"), { reuse: "t1" });
});

test("a claimed terminal leaves the idle set and cannot be claimed twice", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "shared"), { reuse: "t1" });
  assert.deepEqual(pool.claim(KEY, "shared"), { create: true });
  assert.equal(pool.idleCount(KEY), 0);
});

test("duplicate offers of the same terminal are ignored", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  pool.offerIdle(KEY, "t1");
  assert.equal(pool.idleCount(KEY), 1);
});

test("one terminal id belongs to at most one key", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  pool.offerIdle(OTHER_KEY, "t1");
  assert.equal(pool.idleCount(OTHER_KEY), 0);
  assert.deepEqual(pool.claim(OTHER_KEY, "shared"), { create: true });
  assert.deepEqual(pool.claim(KEY, "shared"), { reuse: "t1" });
});

test("remove drops an idle terminal and tolerates unknown ids", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  pool.remove("t1");
  assert.equal(pool.idleCount(KEY), 0);
  assert.deepEqual(pool.claim(KEY, "shared"), { create: true });
  pool.remove("never-seen");

  // A removed terminal can be offered again later.
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "shared"), { reuse: "t1" });
});

test("remove on a busy terminal is a no-op until it is offered again", () => {
  const pool = new TaskTerminalPool();
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "shared"), { reuse: "t1" });
  pool.remove("t1");
  pool.offerIdle(KEY, "t1");
  assert.deepEqual(pool.claim(KEY, "shared"), { reuse: "t1" });
});
