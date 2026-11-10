import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createConfigStore } from "./store.js";

test("section updates preserve unrelated fields from the latest document", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-config-store-"));
  try {
    const store = createConfigStore({ dataDir });
    await store.updateSection(
      "webHost",
      () => ({ devices: [] as string[] }),
      (current) => ({
        ...current,
        enabled: true,
      }),
    );
    await store.updateSection(
      "agents",
      () => ({}),
      () => ({ lsp: { enabled: true } }),
    );
    const raw = JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(raw.webHost, { devices: [], enabled: true });
    assert.deepEqual(raw.agents, { lsp: { enabled: true } });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
