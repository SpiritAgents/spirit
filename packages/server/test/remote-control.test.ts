import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { HostService } from "../src/host-service.js";
import type { SessionManager } from "../src/session-manager.js";

test("remote RPC exposes pairing without leaking secrets into notifications", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "server-remote-control-"));
  const events: Array<{ method: string; params: unknown }> = [];
  const host = new HostService(dataDir, {} as SessionManager, (method, params) =>
    events.push({ method, params }),
  );
  try {
    await host.handle("remote.registerHost", {
      instanceId: "test-instance",
      pid: process.pid,
      host: "127.0.0.1",
      port: 7788,
    });
    await host.handle("remote.enable");
    const enrollment = (await host.handle("remote.pair", {
      ownerClientId: "desktop-test",
      origin: "http://127.0.0.1:7788",
      output: "svg",
    })) as { token: string };
    const access = (await host.handle("remote.requestAccess", {
      token: enrollment.token,
      userAgent: "Example Browser",
    })) as { code: string };
    assert.equal(access.code, "DEVICE_APPROVAL_REQUIRED");
    const state = (await host.handle("remote.getState")) as {
      pendingPairing: Record<string, unknown>;
    };
    assert.equal(state.pendingPairing.ownerClientId, "desktop-test");
    assert.equal("tokenHash" in state.pendingPairing, false);
    assert.equal("token" in state.pendingPairing, false);
    assert.ok(events.some((event) => event.method === "remote.confirmationRequested"));
    assert.ok(events.every((event) => !JSON.stringify(event.params).includes(enrollment.token)));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
