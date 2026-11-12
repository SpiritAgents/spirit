import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildShardedKeyringPrimary,
  parseShardedKeyringPrimary,
  splitKeyringPassword,
} from "./keyring-secret.js";

test("keyring sharding preserves surrogate pairs and round-trips the primary marker", () => {
  const chunks = splitKeyringPassword("a😀b", 5);
  assert.deepEqual(chunks, ["a", "😀", "b"]);
  assert.equal(
    parseShardedKeyringPrimary(buildShardedKeyringPrimary(chunks.length)),
    chunks.length,
  );
});
