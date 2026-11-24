import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { withSpiritConfigWriteLock } from "./write-lock.js";
import { emptyModelRef, saveSpiritConfig, SPIRIT_CONFIG_SCHEMA_VERSION } from "./schema.js";

test("serializes config writers across the shared lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spirit-config-lock-"));
  try {
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withSpiritConfigWriteLock(dir, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    assert.equal(maxActive, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("does not break a freshly created empty lock file before its owner writes metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spirit-config-lock-fresh-"));
  const lockPath = join(dir, "config.json.lock");
  try {
    // Simulate another writer between open("wx") and handle.writeFile(): 0-byte file with fresh mtime.
    await writeFile(lockPath, "");
    let enteredBeforeRelease = false;
    let released = false;

    const contender = withSpiritConfigWriteLock(dir, async () => {
      if (!released) {
        enteredBeforeRelease = true;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    released = true;
    await rm(lockPath, { force: true });
    await contender;

    assert.equal(enteredBeforeRelease, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reclaims an expired empty lock file after the stale threshold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spirit-config-lock-stale-"));
  const lockPath = join(dir, "config.json.lock");
  try {
    await writeFile(lockPath, "");
    const expiredAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, expiredAt, expiredAt);

    let ran = false;
    await withSpiritConfigWriteLock(dir, async () => {
      ran = true;
    });
    assert.equal(ran, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ordinary config saves preserve the latest Remote Control section", async () => {
  const dir = await mkdtemp(join(tmpdir(), "spirit-config-web-host-"));
  const path = join(dir, "config.json");
  const webHost = { enabled: true, host: "127.0.0.1", port: 7788, devices: [] };
  try {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
        providers: [],
        activeModel: emptyModelRef(),
        webHost,
      }),
    );
    await saveSpiritConfig(dir, {
      schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
      providers: [],
      activeModel: emptyModelRef(),
      uiLocale: "en",
    });
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(saved.webHost, webHost);
    assert.equal(saved.uiLocale, "en");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
