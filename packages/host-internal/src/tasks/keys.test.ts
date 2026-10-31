import assert from "node:assert/strict";
import { test } from "vitest";

import { parseTaskKey, taskKey, taskKeyWithInstance } from "./keys.js";

test("taskKey joins file path and label with #", () => {
  assert.equal(taskKey("/repo/.spirit/tasks.json", "build"), "/repo/.spirit/tasks.json#build");
});

test("taskKeyWithInstance appends the suffix only for instance greater than 1", () => {
  const key = taskKey("/repo/.spirit/tasks.json", "build");
  assert.equal(taskKeyWithInstance(key, 1), "/repo/.spirit/tasks.json#build");
  assert.equal(taskKeyWithInstance(key, 2), "/repo/.spirit/tasks.json#build|2");
  assert.equal(taskKeyWithInstance(key, 3), "/repo/.spirit/tasks.json#build|3");
});

test("parseTaskKey round-trips keys with and without instance suffix", () => {
  const plain = parseTaskKey(taskKey("/repo/.spirit/tasks.json", "build"));
  assert.deepEqual(plain, {
    filePath: "/repo/.spirit/tasks.json",
    label: "build",
    instance: 1,
  });

  const withInstance = parseTaskKey(
    taskKeyWithInstance(taskKey("/repo/.spirit/tasks.json", "build"), 2),
  );
  assert.deepEqual(withInstance, {
    filePath: "/repo/.spirit/tasks.json",
    label: "build",
    instance: 2,
  });
});

test("parseTaskKey keeps # characters inside labels", () => {
  const parsed = parseTaskKey(taskKey("/repo/.spirit/tasks.json", "build #2"));
  assert.deepEqual(parsed, {
    filePath: "/repo/.spirit/tasks.json",
    label: "build #2",
    instance: 1,
  });
});

test("parseTaskKey tolerates malformed keys", () => {
  assert.deepEqual(parseTaskKey("no-separator"), {
    filePath: "",
    label: "no-separator",
    instance: 1,
  });
});
