import assert from "node:assert/strict";
import { create as createQrCode } from "qrcode";
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
  const svg = await createRemoteControlQrCode(url, "svg");
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes('r="0.42"'));
  assert.equal(svg.match(/width="6" height="6" rx="1.25"/g)?.length, 3);
  assert.equal(svg.match(/r="1.5"\/>/g)?.length, 3);
  const { modules } = createQrCode(url, { errorCorrectionLevel: "M" });
  const darkModuleCount = modules.data.reduce((count, value) => count + value, 0);
  assert.equal(svg.match(/r="0.42"\/>/g)?.length, darkModuleCount - 3 * 33);
  assert.ok(svg.includes(`viewBox="0 0 ${modules.size + 2} ${modules.size + 2}"`));
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
