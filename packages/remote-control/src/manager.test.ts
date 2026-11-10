import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { RemoteControlManager } from "./manager.js";

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "remote-control-manager-"));
  const confirmations: unknown[] = [];
  const manager = new RemoteControlManager({
    dataDir,
    onConfirmationRequested: (pairing) => confirmations.push(pairing),
  });
  await manager.registerHost("test-instance", process.pid, "127.0.0.1", 7788);
  await manager.enable();
  return { dataDir, manager, confirmations };
}

test("requires approval before a pending token becomes an active device", async () => {
  const { dataDir, manager, confirmations } = await fixture();
  try {
    const enrollment = await manager.pair({
      ownerClientId: "desktop-owner",
      origin: "http://127.0.0.1:7788",
      output: "svg",
    });
    const pending = await manager.requestAccess(enrollment.token, {
      userAgent: "Example Browser",
      ip: "127.0.0.1",
    });
    assert.equal(pending.code, "DEVICE_APPROVAL_REQUIRED");
    await manager.requestAccess(enrollment.token, { userAgent: "Example Browser" });
    assert.equal(confirmations.length, 1);

    const pendingState = await manager.getState();
    const pendingProjection = pendingState.pendingPairing;
    assert.ok(pendingProjection);
    assert.equal("tokenHash" in pendingProjection, false);
    assert.equal("token" in pendingProjection, false);
    await assert.rejects(manager.approvePairing(enrollment.pairingId, "other-owner"));

    const approved = await manager.approvePairing(enrollment.pairingId, "desktop-owner");
    assert.equal(approved.devices.length, 1);
    assert.equal(approved.hasCompletedPairing, true);
    const access = await manager.requestAccess(enrollment.token, { recordConnection: true });
    assert.equal(access.code, "OK");
    const renamed = await manager.renameDevice(approved.devices[0]!.id, "My Device");
    assert.equal(renamed.devices[0]!.name, "My Device");
    assert.equal(renamed.devices[0]!.customName, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("rejection rotates enrollment and startup removes stale pending state", async () => {
  const { dataDir, manager } = await fixture();
  try {
    const first = await manager.pair({
      ownerClientId: "cli-owner",
      origin: "http://127.0.0.1:7788",
      output: "terminal",
    });
    await manager.requestAccess(first.token, {});
    const replacement = await manager.rejectPairing(first.pairingId, "cli-owner", "terminal");
    assert.ok(first.token !== replacement.token);
    assert.equal((await manager.requestAccess(first.token, {})).code, "TOKEN_REQUIRED");

    const restarted = new RemoteControlManager({ dataDir });
    await restarted.initialize();
    assert.equal((await restarted.getState()).pendingPairing, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("enable persists desired state before a Workbench Host attaches", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "remote-control-no-host-"));
  const manager = new RemoteControlManager({ dataDir });
  try {
    await manager.enable();
    assert.equal((await manager.getState()).enabled, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
