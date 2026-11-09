import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildRemoteControlUrl,
  createRemoteControlQrCode,
  createRemoteControlToken,
  hashRemoteControlToken,
} from "./devices.js";
import { inferRemoteControlDevicePresentation } from "./presentation.js";
import { normalizeRemoteControlConfig } from "./config.js";

test("creates independent high-entropy tokens and safe enrollment URLs", async () => {
  const first = createRemoteControlToken();
  const second = createRemoteControlToken();
  assert.ok(first !== second);
  assert.match(hashRemoteControlToken(first), /^[a-f0-9]{64}$/);
  const url = buildRemoteControlUrl("http://127.0.0.1:7788", "fake-token");
  assert.equal(url, "http://127.0.0.1:7788/?token=fake-token");
  assert.ok((await createRemoteControlQrCode(url, "svg")).includes("<svg"));
  assert.ok((await createRemoteControlQrCode(url, "terminal")).length > 0);
});

test("normalizes active devices but drops legacy pending or invalid records", () => {
  const config = normalizeRemoteControlConfig({
    enabled: true,
    devices: [{ id: "invalid" }],
    pendingPairing: { tokenHash: "not-exposed" },
  });
  assert.equal(config.devices.length, 0);
  assert.equal(config.hasCompletedPairing, false);
  assert.equal(config.pendingPairing, undefined);
});

test("infers mobile before system and avoids speculative browser labels", () => {
  assert.deepEqual(
    inferRemoteControlDevicePresentation(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1",
    ),
    { mobile: "iPhone", browser: "Safari" },
  );
  assert.deepEqual(inferRemoteControlDevicePresentation("unknown"), {});
});
