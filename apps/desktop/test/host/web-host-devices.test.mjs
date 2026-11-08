import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeWebHostConfig } from "../../dist-electron/src/host/storage.js";
import { buildWebHostSnapshot } from "../../dist-electron/src/host/service-utils.js";

function device(id, hashCharacter, metadata = {}) {
  return {
    id,
    tokenHash: hashCharacter.repeat(64),
    name: `Device ${id}`,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...metadata,
  };
}

test("normalizes multiple device records and discards the legacy shared credential", () => {
  const config = normalizeWebHostConfig({
    enabled: true,
    host: "127.0.0.1",
    port: 7788,
    authTokenHash: "f".repeat(64),
    devices: [
      device("device-a", "a", {
        lastConnectedAt: "2026-01-03T03:04:05.000Z",
        lastUserAgent: "Example Agent",
        lastIp: "127.0.0.1",
      }),
      device("device-b", "b"),
    ],
  });

  assert.equal(config.authTokenHash, undefined);
  assert.equal(config.devices.length, 2);
  assert.equal(config.devices[0].lastUserAgent, "Example Agent");
  assert.equal(config.devices[1].lastConnectedAt, undefined);
});

test("rejects malformed device records without accepting plaintext token fields", () => {
  const config = normalizeWebHostConfig({
    devices: [
      device("valid-device", "a", { token: "not-a-real-credential" }),
      device("missing-hash", ""),
      { id: "missing-record-shape" },
    ],
  });

  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0].id, "valid-device");
  assert.equal("token" in config.devices[0], false);
});

test("projects device metadata without token hashes or enrollment secrets", () => {
  const config = normalizeWebHostConfig({
    devices: [device("device-a", "a"), device("device-b", "b")],
  });
  const snapshot = buildWebHostSnapshot(config);

  assert.equal(snapshot.devices.length, 2);
  assert.equal(snapshot.config.paired, true);
  for (const projected of snapshot.devices) {
    assert.equal(projected.status, "offline");
    assert.equal("tokenHash" in projected, false);
    assert.equal("token" in projected, false);
    assert.equal("url" in projected, false);
    assert.equal("qrCodeSvg" in projected, false);
  }
});
