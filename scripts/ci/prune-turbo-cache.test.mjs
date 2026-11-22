import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneTurboCache } from "./prune-turbo-cache.mjs";

function writeCacheEntry(cacheDir, hash) {
  fs.writeFileSync(path.join(cacheDir, `${hash}.tar.zst`), "archive");
  fs.writeFileSync(path.join(cacheDir, `${hash}-meta.json`), "{}");
  fs.writeFileSync(path.join(cacheDir, `${hash}-manifest.json`), "{}");
}

test("retains active hashes across multiple run summaries and prunes stale entries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-turbo-prune-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const runsDir = path.join(root, ".turbo", "runs");
  const cacheDir = path.join(root, ".turbo", "cache");
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(runsDir, "run-build.json"),
    JSON.stringify({ tasks: [{ taskId: "@spiritagent/api#build", hash: "aaaa1111bbbb2222" }] }),
  );
  fs.writeFileSync(
    path.join(runsDir, "run-typecheck.json"),
    JSON.stringify({
      tasks: [{ taskId: "@spiritagent/api#typecheck", hash: "cccc3333dddd4444" }],
    }),
  );

  writeCacheEntry(cacheDir, "aaaa1111bbbb2222");
  writeCacheEntry(cacheDir, "cccc3333dddd4444");
  writeCacheEntry(cacheDir, "deadbeef00000000");

  const result = pruneTurboCache(root);
  assert.deepEqual(result, { skipped: false, activeHashes: 2, keptFiles: 6, prunedFiles: 3 });

  const remaining = fs.readdirSync(cacheDir).sort();
  assert.deepEqual(remaining, [
    "aaaa1111bbbb2222-manifest.json",
    "aaaa1111bbbb2222-meta.json",
    "aaaa1111bbbb2222.tar.zst",
    "cccc3333dddd4444-manifest.json",
    "cccc3333dddd4444-meta.json",
    "cccc3333dddd4444.tar.zst",
  ]);
  assert.equal(fs.existsSync(runsDir), false);
});

test("skips pruning without deleting cache entries when no run summaries exist", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spirit-turbo-prune-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const cacheDir = path.join(root, ".turbo", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  writeCacheEntry(cacheDir, "1111222233334444");

  const result = pruneTurboCache(root);
  assert.deepEqual(result, { skipped: true, activeHashes: 0, keptFiles: 0, prunedFiles: 0 });
  assert.equal(fs.readdirSync(cacheDir).length, 3);
});
