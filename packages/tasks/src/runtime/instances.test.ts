import assert from "node:assert/strict";
import { test } from "vitest";

import { TaskInstanceRegistry } from "./instances.js";

const KEY = "/repo/.spirit/tasks.json#build";

test("serial rerun after release produces the byte-identical base key", () => {
  const registry = new TaskInstanceRegistry();
  const first = registry.tryAcquire(KEY, 1);
  assert.deepEqual(first, { status: "acquired", instanceKey: KEY });
  registry.release(KEY);
  const second = registry.tryAcquire(KEY, 1);
  assert.deepEqual(second, { status: "acquired", instanceKey: KEY });
});

test("parallel instances get the lowest free suffix starting at 2", () => {
  const registry = new TaskInstanceRegistry();
  assert.deepEqual(registry.tryAcquire(KEY, 3), { status: "acquired", instanceKey: KEY });
  assert.deepEqual(registry.tryAcquire(KEY, 3), {
    status: "acquired",
    instanceKey: `${KEY}|2`,
  });
  assert.deepEqual(registry.tryAcquire(KEY, 3), {
    status: "acquired",
    instanceKey: `${KEY}|3`,
  });
  registry.release(`${KEY}|2`);
  assert.deepEqual(registry.tryAcquire(KEY, 3), {
    status: "acquired",
    instanceKey: `${KEY}|2`,
  });
});

test("reports overLimit with the ordered active instance list once the limit is reached", () => {
  const registry = new TaskInstanceRegistry();
  registry.tryAcquire(KEY, 1);
  const result = registry.tryAcquire(KEY, 1);
  assert.equal(result.status, "overLimit");
  if (result.status !== "overLimit") {
    return;
  }
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0]?.instanceKey, KEY);
  assert.equal(result.active[0]?.instance, 1);
});

test("active instances carry instance numbers matching the key suffix rule", () => {
  const registry = new TaskInstanceRegistry();
  registry.tryAcquire(KEY, 3);
  registry.tryAcquire(KEY, 3);
  registry.tryAcquire(KEY, 3);
  assert.deepEqual(
    registry.activeInstances(KEY).map((entry) => [entry.instanceKey, entry.instance]),
    [
      [KEY, 1],
      [`${KEY}|2`, 2],
      [`${KEY}|3`, 3],
    ],
  );
  registry.release(`${KEY}|2`);
  assert.deepEqual(
    registry.activeInstances(KEY).map((entry) => entry.instance),
    [1, 3],
  );
});

test("acquire stamps startedAt", () => {
  const registry = new TaskInstanceRegistry();
  const before = Date.now();
  registry.tryAcquire(KEY, 1);
  const after = Date.now();
  const entry = registry.activeInstances(KEY)[0];
  assert.ok(entry);
  assert.ok(entry.startedAt >= before && entry.startedAt <= after);
});

test("releasing the base key while a parallel instance lives frees the base slot", () => {
  const registry = new TaskInstanceRegistry();
  registry.tryAcquire(KEY, 3);
  registry.tryAcquire(KEY, 3);
  registry.release(KEY);
  assert.deepEqual(
    registry.activeInstances(KEY).map((entry) => entry.instanceKey),
    [`${KEY}|2`],
  );
  assert.deepEqual(registry.tryAcquire(KEY, 3), { status: "acquired", instanceKey: KEY });
});

test("oldestActive follows insertion order", () => {
  const registry = new TaskInstanceRegistry();
  registry.tryAcquire(KEY, 3);
  registry.tryAcquire(KEY, 3);
  registry.tryAcquire(KEY, 3);
  assert.equal(registry.oldestActive(KEY), KEY);
  registry.release(KEY);
  assert.equal(registry.oldestActive(KEY), `${KEY}|2`);
});

test("release of unknown keys is a no-op and counts stay consistent", () => {
  const registry = new TaskInstanceRegistry();
  registry.release("never-acquired");
  assert.equal(registry.activeCount(KEY), 0);
  registry.tryAcquire(KEY, 2);
  assert.equal(registry.activeCount(KEY), 1);
  registry.release(KEY);
  registry.release(KEY);
  assert.equal(registry.activeCount(KEY), 0);
  assert.equal(registry.oldestActive(KEY), undefined);
});
