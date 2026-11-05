import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileBackgroundTaskStore } from "./background-task-store.js";
import { backgroundTaskOutputKind } from "./background-task-path.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(sessionKey = "conversation") {
  const spiritDataDir = await mkdtemp(path.join(tmpdir(), "spirit-background-store-"));
  directories.push(spiritDataDir);
  const store = new FileBackgroundTaskStore({
    spiritDataDir,
    sessionKey,
    owner: { id: "test-owner", pid: process.pid },
  });
  return {
    store,
    spiritDataDir,
    create: (kind: "shell" | "subagent" = "shell") =>
      store.create({
        sessionKey,
        runtimeId: "main",
        toolCallId: "call-one",
        kind,
        input: "Inspect the workspace",
        argumentsJson: "{}",
      }),
  };
}

describe("background task storage", () => {
  it("allocates distinct task IDs for identical tool call IDs and separates output types", async () => {
    const { store, create } = await fixture();
    const records = await Promise.all([create(), create("subagent")]);
    expect(records[0]!.id).not.toBe(records[1]!.id);
    expect(backgroundTaskOutputKind(records[0]!.outputPath)).toBe("shell");
    expect(backgroundTaskOutputKind(records[1]!.outputPath)).toBe("subagent");
    expect(await store.list()).toHaveLength(2);
    expect((await readdir(store.directory)).some((name) => name.endsWith(".lock"))).toBe(false);
  });

  it("serializes live output and keeps the full file beyond the returned tail", async () => {
    const { store, create } = await fixture();
    const record = await create();
    await Promise.all(
      Array.from({ length: 100 }, (_, index) => store.appendOutput(record.id, `${index} 阅读\n`)),
    );
    const fullOutput = Array.from({ length: 100 }, (_, index) => `${index} 阅读\n`).join("");
    expect(await readFile(record.outputPath, "utf8")).toBe(fullOutput);
    expect(await store.readOutputTail(record.id, 8)).toBe(
      Array.from(fullOutput).slice(-8).join(""),
    );
    await store.appendOutput(record.id, "🙂完成");
    expect(await store.readOutputTail(record.id, 3)).toBe("🙂完成");
  });

  it("flushes output before recording a terminal state and forbids resurrection", async () => {
    const { store, create } = await fixture();
    const record = await create();
    const terminal = {
      ...record,
      status: "completed" as const,
      terminalEventId: `${record.id}:completed`,
      elapsedMs: 3500,
    };
    await Promise.all([store.appendOutput(record.id, "result"), store.save(terminal)]);
    expect(await readFile(record.outputPath, "utf8")).toBe("result");
    expect((await store.list())[0]).toMatchObject({ status: "completed", elapsedMs: 3500 });
    await expect(store.save(record)).rejects.toThrow("already completed");
    await expect(store.appendOutput(record.id, "late")).rejects.toThrow("has finished");
    await store.save({ ...terminal, notificationDelivered: true });
    await expect(store.save(terminal)).rejects.toThrow("cannot become pending");
  });

  it("reports output and corrupt metadata errors without success-shaped fallbacks", async () => {
    const { store, create } = await fixture();
    const record = await create();
    await rm(record.outputPath);
    await expect(store.appendOutput(record.id, "lost")).rejects.toThrow();
    await expect(store.readOutputTail(record.id, 10)).rejects.toThrow();
    await writeFile(path.join(store.directory, `${record.id}.json`), "{invalid");
    await expect(store.list()).rejects.toThrow();
  });

  it("does not accept path traversal or record identity changes", async () => {
    const { store, create } = await fixture();
    const record = await create();
    await expect(store.readOutputTail("../outside", 10)).rejects.toThrow("Invalid task ID");
    await expect(store.save({ ...record, outputPath: "/outside.log" })).rejects.toThrow(
      "path mismatch",
    );
    await expect(store.save({ ...record, runtimeId: "another-runtime" })).rejects.toThrow(
      "identity",
    );
  });

  it("recovers only dead owners without counting downtime or duplicating terminal events", async () => {
    const { store, create, spiritDataDir } = await fixture();
    const record = await create();
    await store.save({
      ...record,
      status: "running",
      background: true,
      elapsedMs: 12000,
      updatedAtUnixMs: record.startedAtUnixMs + 12000,
    });
    const restored = new FileBackgroundTaskStore({
      spiritDataDir,
      sessionKey: "conversation",
      owner: { id: "new-owner", pid: process.pid },
    });
    expect(await restored.recoverInterrupted(async () => true)).toEqual([]);
    const records = await restored.recoverInterrupted(async () => false);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: record.id,
      status: "interrupted",
      elapsedMs: 12000,
      elapsedApproximate: true,
      endedAtUnixMs: record.startedAtUnixMs + 12000,
      outputPath: record.outputPath,
      notificationDelivered: false,
    });
    expect(records[0]!.exitCode).toBeUndefined();
    expect(await restored.recoverInterrupted(async () => false)).toEqual([]);
  });

  it("returns no tasks for a new session while retaining isolation between sessions", async () => {
    const { create, spiritDataDir } = await fixture();
    const record = await create();
    const other = new FileBackgroundTaskStore({
      spiritDataDir,
      sessionKey: "other-conversation",
      owner: { id: "same-owner", pid: process.pid },
    });
    expect(await other.list()).toEqual([]);
    await expect(other.readOutputTail(record.id, 10)).rejects.toThrow();
  });
});
