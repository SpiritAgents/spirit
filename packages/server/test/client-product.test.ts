import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { PRODUCT_BUILD_ID } from "@spiritagent/product";

import { readCurrentToken } from "../src/auth-token.js";
import { connectOrSpawnServer, ProductBuildMismatchError, ServerRpcClient } from "../src/client.js";
import { startDaemon } from "../src/daemon.js";
import type { ServerHealthResult } from "../src/protocol/index.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(() => {
    throw new Error("A product mismatch must not spawn another daemon");
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "product-handshake-"));
  const daemon = await startDaemon({
    dataDir,
    version: "0.0.0-test",
    idleExitGraceMs: null,
    log: () => {},
  });
  const token = await readCurrentToken(dataDir);
  if (!token) throw new Error("Fixture daemon did not create its token");
  return {
    daemon,
    dataDir,
    token,
    async close() {
      await daemon.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("connect verifies the baked identity once before exposing a ready client", async () => {
  const state = await fixture();
  const client = new ServerRpcClient({ url: state.daemon.url, token: state.token });
  try {
    expect(client.isConnected()).toBe(false);
    await Promise.all([client.connect(), client.connect()]);
    expect(client.isConnected()).toBe(true);
    expect(client.instanceId).toBe(state.daemon.instanceId);
    const health = await client.call<ServerHealthResult>("server.health");
    expect(health.productBuildId).toBe(PRODUCT_BUILD_ID);
    expect(health.connections).toBe(1);
  } finally {
    client.close();
    await state.close();
  }
});

test.each([undefined, "different-product-build"])(
  "discovery surfaces product identity %j instead of silently spawning",
  async (productBuildId) => {
    const state = await fixture();
    vi.stubEnv("SPIRIT_SERVER_DATA_DIR", "");
    vi.spyOn(ServerRpcClient.prototype, "call").mockResolvedValueOnce({
      productBuildId,
      instanceId: state.daemon.instanceId,
    });
    try {
      await expect(connectOrSpawnServer({ dataDir: state.dataDir })).rejects.toBeInstanceOf(
        ProductBuildMismatchError,
      );
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await state.close();
    }
  },
);
