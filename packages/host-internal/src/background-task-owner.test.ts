import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createBackgroundTaskOwner, isBackgroundTaskOwnerAlive } from "./background-task-owner.js";

it("checks a unique local IPC owner rather than treating a reusable PID as identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "o-"));
  const owner = await createBackgroundTaskOwner(directory);
  try {
    expect(await isBackgroundTaskOwnerAlive(directory, owner.owner)).toBe(true);
    expect(
      await isBackgroundTaskOwnerAlive(directory, { id: "0000000000000000", pid: process.pid }),
    ).toBe(false);
    await expect(
      isBackgroundTaskOwnerAlive(directory, { ...owner.owner, pid: process.pid + 1 }),
    ).rejects.toThrow("identity mismatch");
  } finally {
    await owner.close();
  }
  try {
    expect(await isBackgroundTaskOwnerAlive(directory, owner.owner)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")(
  "explains an unsupported local IPC path without creating an owner",
  async () => {
    await expect(createBackgroundTaskOwner(path.join(tmpdir(), "x".repeat(120)))).rejects.toThrow(
      "Choose a shorter data directory",
    );
  },
);
