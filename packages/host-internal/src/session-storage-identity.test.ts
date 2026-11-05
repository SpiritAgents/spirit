import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { FileBackgroundTaskStore } from "./background-task-store.js";
import { RuntimeSessionStore, type RuntimePresentationState } from "./runtime-session-store.js";
import {
  bindSessionStorageKey,
  ensureSessionStorageKey,
  readSessionStorageKey,
} from "./session-storage-identity.js";
import { deleteTranscriptSessionDir, resolveTranscriptSessionDir } from "./transcript.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "identity-"));
  directories.push(root);
  return root;
}

it("keeps running task files and runtime recovery stable when a conversation gets its permanent path", async () => {
  const root = await fixture();
  const provisional = "ephemeral-session";
  const permanent = path.join(root, "chat.json");
  const key = await ensureSessionStorageKey(root, provisional);
  expect(await ensureSessionStorageKey(root, provisional)).toBe(key);
  const tasks = new FileBackgroundTaskStore({
    spiritDataDir: root,
    sessionKey: key,
    owner: { id: "owner", pid: process.pid },
  });
  const task = await tasks.create({
    sessionKey: key,
    runtimeId: "main",
    toolCallId: "call",
    kind: "shell",
    input: "build",
    argumentsJson: "{}",
  });
  await tasks.appendOutput(task.id, "before\n");
  const runtimeStore = new RuntimeSessionStore(root, key);
  const state = {
    version: 1 as const,
    sessionKey: key,
    workspaceRoot: root,
    agentMode: "plan" as const,
    initialized: true,
    archive: { messages: [], assistantAux: [], llmHistory: [] },
  };
  await runtimeStore.save(state);
  await mkdir(resolveTranscriptSessionDir(root, permanent), { recursive: true });
  await bindSessionStorageKey(root, permanent, key);
  await tasks.appendOutput(task.id, "after\n");
  expect(await readFile(task.outputPath, "utf8")).toBe("before\nafter\n");
  expect(readSessionStorageKey(root, permanent)).toBe(key);
  expect(resolveTranscriptSessionDir(root, permanent)).toBe(
    resolveTranscriptSessionDir(root, provisional),
  );
  expect(await new RuntimeSessionStore(root, permanent).read()).toEqual(state);
  expect(
    await new FileBackgroundTaskStore({
      spiritDataDir: root,
      sessionKey: key,
      owner: { id: "new-owner", pid: process.pid },
    }).list(),
  ).toHaveLength(1);
  await deleteTranscriptSessionDir(root, permanent);
  await expect(readFile(task.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(readSessionStorageKey(root, permanent)).toBeUndefined();
  expect(readSessionStorageKey(root, provisional)).toBeUndefined();
});

it("does not reassign a conversation or discard existing destination transcript content", async () => {
  const root = await fixture();
  const first = await ensureSessionStorageKey(root, "first");
  const second = await ensureSessionStorageKey(root, "second");
  await expect(bindSessionStorageKey(root, "second", first)).rejects.toThrow("another session");
  expect(readSessionStorageKey(root, "second")).toBe(second);
  const directory = resolveTranscriptSessionDir(root, "unindexed");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "transcript.json"), "existing");
  await expect(bindSessionStorageKey(root, "unindexed", first)).rejects.toThrow(
    "already has transcript data",
  );
  expect(await readFile(path.join(directory, "transcript.json"), "utf8")).toBe("existing");
});

it.each<RuntimePresentationState>([
  { sequence: -1, entries: [] },
  { sequence: 0.5, entries: [] },
  { sequence: 1, entries: [{ sequence: 2, kind: "user", text: "invalid" }] },
  { sequence: 2, entries: [{ sequence: 0, kind: "user", text: "invalid" }] },
  {
    sequence: 2,
    entries: [
      { sequence: 2, kind: "user", text: "second" },
      { sequence: 1, kind: "user", text: "first" },
    ],
  },
])("rejects an invalid persisted presentation cursor or ordering: %j", async (presentation) => {
  const root = await fixture();
  const store = new RuntimeSessionStore(root, "journal");
  await store.save({
    version: 1,
    sessionKey: "journal",
    workspaceRoot: root,
    agentMode: "agent",
    initialized: true,
    archive: { messages: [], assistantAux: [], llmHistory: [] },
    presentation,
  });
  await expect(store.read()).rejects.toThrow("Invalid persisted runtime session");
});
