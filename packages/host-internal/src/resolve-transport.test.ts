import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  NO_ACTIVE_MODEL_ERROR,
  resolveTransportConfig,
  tryResolveTransportConfig,
} from "./resolve-transport.js";

function emptyConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spirit-resolve-transport-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      providerGroups: [],
      activeModel: { groupId: "", name: "" },
    }),
  );
  return dir;
}

test("tryResolveTransportConfig returns a setup error when no active model exists", () => {
  const spiritDataDir = emptyConfigDir();
  const result = tryResolveTransportConfig({
    workspaceRoot: tmpdir(),
    spiritDataDir,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, NO_ACTIVE_MODEL_ERROR);
  }
});

test("tryResolveTransportConfig treats an empty modelRef as no selector", () => {
  const spiritDataDir = emptyConfigDir();
  const result = tryResolveTransportConfig({
    workspaceRoot: tmpdir(),
    spiritDataDir,
    modelRef: { groupId: "", name: "" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, NO_ACTIVE_MODEL_ERROR);
  }
});

test("resolveTransportConfig still throws when no active model exists", () => {
  const spiritDataDir = emptyConfigDir();
  assert.throws(
    () =>
      resolveTransportConfig({
        workspaceRoot: tmpdir(),
        spiritDataDir,
      }),
    (error: unknown) => error instanceof Error && error.message === NO_ACTIVE_MODEL_ERROR,
  );
});
