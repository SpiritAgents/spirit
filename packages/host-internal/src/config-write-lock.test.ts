import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { withSpiritConfigWriteLock } from "./credentials/config-write-lock.js";
import { emptyModelRef, saveSpiritConfig, SPIRIT_CONFIG_SCHEMA_VERSION } from "./config.js";

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
