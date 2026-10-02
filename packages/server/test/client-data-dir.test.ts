import { afterEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { readCurrentToken } from "../src/auth-token.js";
import { connectOrSpawnServer } from "../src/client.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn(), pid: 4321, stderr: null })),
}));
vi.mock("../src/auth-token.js", () => ({ readCurrentToken: vi.fn(async () => undefined) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test.each([
  ["/daemon-root", "/daemon-root"],
  ["  ", "/client-root"],
])("daemon override %j is consistent for discovery and spawn", async (override, expected) => {
  vi.stubEnv("SPIRIT_SERVER_DATA_DIR", override);
  await expect(
    connectOrSpawnServer({
      dataDir: "/client-root",
      connectTimeoutMs: 0,
    }),
  ).rejects.toThrow(/timed out/);
  expect(readCurrentToken).toHaveBeenCalledWith(expected);
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    expect.any(Array),
    expect.objectContaining({
      env: expect.objectContaining({ SPIRIT_SERVER_DATA_DIR: expected }),
    }),
  );
});
