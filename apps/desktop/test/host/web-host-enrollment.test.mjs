import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  createWebHostDeviceCommand,
  renameWebHostDeviceCommand,
  revokeWebHostDeviceCommand,
} from "../../dist-electron/src/host/host-workspace-git-commands.js";
import {
  buildDesktopWebDeviceUrl,
  createDesktopWebDeviceQrCodeSvg,
  createDesktopWebDeviceToken,
  hashDesktopWebDeviceToken,
} from "../../dist-electron/src/host/web-host-devices.js";
import {
  normalizeWebHostConfig,
  setSpiritDataDirOverride,
} from "../../dist-electron/src/host/storage.js";
import { buildWebHostSnapshot } from "../../dist-electron/src/host/service-utils.js";
import {
  isDesktopWebHostDeviceOnline,
  registerDesktopWebHostDeviceConnection,
} from "../../dist-electron/src/host/web-host-state.js";

test("builds direct enrollment URLs and generates SVG QR content", async () => {
  const url = buildDesktopWebDeviceUrl("http://127.0.0.1:7788", "fake-device-token");
  assert.equal(url, "http://127.0.0.1:7788/?token=fake-device-token");
  const svg = await createDesktopWebDeviceQrCodeSvg(url);
  assert.ok(svg.includes("<svg"));

  for (const invalid of [
    "ftp://127.0.0.1:7788",
    "http://127.0.0.1:7788/path",
    "http://127.0.0.1:7788/?existing=true",
    "http://user:password@127.0.0.1:7788",
  ]) {
    assert.throws(() => buildDesktopWebDeviceUrl(invalid, "fake-device-token"));
  }
});

test("creates high-entropy tokens and stores only their hashes", () => {
  const first = createDesktopWebDeviceToken();
  const second = createDesktopWebDeviceToken();
  assert.ok(first.length >= 40);
  assert.ok(first !== second);
  const hash = hashDesktopWebDeviceToken(first);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(hash !== first);
});

test("creates, renames, and revokes independent devices without exposing secrets in config", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-device-enrollment-"));
  setSpiritDataDirOverride(dir);
  const state = {
    config: {
      webHost: normalizeWebHostConfig({ enabled: false, host: "127.0.0.1", port: 7788 }),
    },
  };
  const ctx = {
    runSerialized: (work) => work(),
    ensureInitialized: async () => {},
    requireState: () => state,
    buildSnapshot: () => ({ webHost: buildWebHostSnapshot(state.config.webHost) }),
  };

  try {
    const first = await createWebHostDeviceCommand(ctx, {
      name: "First Device",
      origin: "http://127.0.0.1:7788",
    });
    const second = await createWebHostDeviceCommand(ctx, {
      origin: "http://127.0.0.1:7788",
    });
    assert.equal(state.config.webHost.devices.length, 2);
    assert.ok(first.device.id !== second.device.id);
    assert.ok(first.token !== second.token);
    assert.ok(first.qrCodeSvg.includes("<svg"));
    assert.equal(first.device.status, "offline");
    for (const record of state.config.webHost.devices) {
      assert.equal("token" in record, false);
      assert.equal("url" in record, false);
      assert.equal("qrCodeSvg" in record, false);
    }

    const persisted = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
    assert.equal(persisted.webHost.devices.length, 2);
    assert.equal("token" in persisted.webHost.devices[0], false);
    assert.equal("tokenHash" in persisted.webHost.devices[0], true);

    let firstCloseCount = 0;
    registerDesktopWebHostDeviceConnection(first.device.id, () => {
      firstCloseCount += 1;
    });
    registerDesktopWebHostDeviceConnection(second.device.id, () => {});

    const renamed = await renameWebHostDeviceCommand(ctx, {
      deviceId: first.device.id,
      name: "Renamed Device",
    });
    assert.equal(renamed.webHost.devices[0].name, "Renamed Device");

    const revoked = await revokeWebHostDeviceCommand(ctx, { deviceId: first.device.id });
    assert.equal(revoked.webHost.devices.length, 1);
    assert.equal(revoked.webHost.devices[0].id, second.device.id);
    assert.equal(firstCloseCount, 1);
    assert.equal(isDesktopWebHostDeviceOnline(first.device.id), false);
    assert.equal(isDesktopWebHostDeviceOnline(second.device.id), true);
    await revokeWebHostDeviceCommand(ctx, { deviceId: second.device.id });
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
