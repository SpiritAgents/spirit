import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, vi } from "vitest";

const keyring = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("@spiritagent/config/keyring-secret", () => ({
  getKeyringPassword(service: string, account: string) {
    return keyring.values.get(`${service}\0${account}`);
  },
  setKeyringPassword(service: string, account: string, value: string) {
    keyring.values.set(`${service}\0${account}`, value);
  },
  deleteKeyringPassword(service: string, account: string) {
    keyring.values.delete(`${service}\0${account}`);
  },
}));

import {
  createAtomicExtensionStateStore,
  createKeyringExtensionStateStore,
  withExtensionSecretLock,
} from "./storage.js";

test("keyring extension state preserves the existing account format and settings behavior", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-keyring-store-"));
  const changed: string[] = [];
  keyring.values.clear();
  try {
    const store = createKeyringExtensionStateStore(
      { spiritDataDir, hostKind: "desktop" },
      (extensionId) => changed.push(extensionId),
    );
    await store.saveSettings?.("personal/demo", { ratio: 0.5 });
    assert.deepEqual(await store.loadSettings("personal/demo"), { ratio: 0.5 });

    await store.saveSecret?.("personal/demo", "credentials", "private-value");
    const account = "Spirit\0extension::personal/demo::secret::credentials";
    assert.equal(keyring.values.get(account), "private-value");
    assert.equal(await store.loadSecret?.("personal/demo", "credentials"), "private-value");
    assert.equal(await store.hasSecret?.("personal/demo", "credentials"), true);

    await store.deleteSecret?.("personal/demo", "credentials");
    assert.equal(keyring.values.has(account), false);
    assert.equal(await store.hasSecret?.("personal/demo", "credentials"), false);
    assert.deepEqual(changed, ["personal/demo", "personal/demo"]);
  } finally {
    keyring.values.clear();
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("atomic Secret updates skip unchanged writes and serialize concurrent rotations", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-atomic-store-"));
  const changed: string[] = [];
  keyring.values.clear();
  try {
    const context = { spiritDataDir, hostKind: "desktop" as const };
    const store = createAtomicExtensionStateStore(
      context,
      createKeyringExtensionStateStore(context, (extensionId) => changed.push(extensionId)),
    );
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        store.updateSecret!("personal/demo", "credentials", async (current) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return String(Number(current ?? "0") + 1);
        }),
      ),
    );
    assert.equal(await store.loadSecret?.("personal/demo", "credentials"), "8");
    assert.equal(maxActive, 1);
    assert.equal(changed.length, 8);

    await store.updateSecret!("personal/demo", "credentials", (current) => current);
    await store.saveSecret?.("personal/demo", "credentials", "8");
    assert.equal(changed.length, 8);

    await store.updateSecret!("personal/demo", "credentials", () => undefined);
    await store.deleteSecret?.("personal/demo", "credentials");
    assert.equal(await store.hasSecret?.("personal/demo", "credentials"), false);
    assert.equal(changed.length, 9);
  } finally {
    keyring.values.clear();
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("the Secret lock serializes independent processes", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-process-lock-"));
  const counterPath = join(spiritDataDir, "counter.json");
  const workerPath = fileURLToPath(
    new URL("./test-fixtures/extension-secret-lock-worker.mjs", import.meta.url),
  );
  try {
    await writeFile(counterPath, "0", "utf8");
    const lockDirectory = join(spiritDataDir, "extensions", "desktop", "extension-state");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      join(lockDirectory, "ext-cGVyc29uYWwvZGVtbw-credentials.lock"),
      JSON.stringify({ pid: 999_999_999, createdAt: 0, token: "dead-owner" }),
    );
    const workers = Array.from({ length: 4 }, () =>
      spawn(process.execPath, [workerPath, spiritDataDir, counterPath], { stdio: "ignore" }),
    );
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve, reject) => {
            worker.once("error", reject);
            worker.once("exit", (code) => {
              if (code === 0) resolve();
              else reject(new Error(`Secret lock worker exited with code ${code}`));
            });
          }),
      ),
    );
    assert.equal(await readFile(counterPath, "utf8"), "4");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("releasing a Secret lock cannot remove another owner's replacement", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-lock-owner-"));
  try {
    const context = { spiritDataDir, hostKind: "desktop" as const };
    const lockPath = join(
      spiritDataDir,
      "extensions",
      "desktop",
      "extension-state",
      "ext-cGVyc29uYWwvZGVtbw-credentials.lock",
    );
    let release!: () => void;
    const entered = withExtensionSecretLock(context, "personal/demo", "credentials", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(lockPath, JSON.stringify({ pid: 123, token: "replacement-owner" }));
    release();
    await entered;
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(owner.token, "replacement-owner");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("a peer process Secret write notifies the other state store", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-peer-secret-"));
  keyring.values.clear();
  try {
    const context = { spiritDataDir, hostKind: "desktop" as const };
    const first = createKeyringExtensionStateStore(context);
    let resolvePeer!: (extensionId: string) => void;
    const peerChanged = new Promise<string>((resolve) => {
      resolvePeer = resolve;
    });
    const second = createKeyringExtensionStateStore(context, resolvePeer);
    assert.ok(first);
    assert.ok(second);
    await first.saveSecret?.("personal/demo", "credentials", "peer-rotated-value");
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("peer Secret notification timed out")), 2_000),
    );
    assert.equal(await Promise.race([peerChanged, timeout]), "personal/demo");
  } finally {
    keyring.values.clear();
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("a revision publish failure still runs the local Secret notification", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-revision-failure-"));
  keyring.values.clear();
  try {
    const changed: string[] = [];
    const store = createKeyringExtensionStateStore(
      { spiritDataDir, hostKind: "desktop" },
      (extensionId) => changed.push(extensionId),
    );
    const revisionDirectory = join(
      spiritDataDir,
      "extensions",
      "desktop",
      "extension-state",
      "ext-cGVyc29uYWwvZGVtbw.secrets-revision.json",
    );
    await mkdir(revisionDirectory, { recursive: true });
    await assert.rejects(async () => {
      await store.saveSecret?.("personal/demo", "credentials", "rotated");
    });
    assert.deepEqual(changed, ["personal/demo"]);
  } finally {
    keyring.values.clear();
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("a closed same-process lock is immediately recoverable", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-same-pid-lock-"));
  try {
    const workerPath = fileURLToPath(
      new URL("./test-fixtures/extension-same-pid-lock-worker.mjs", import.meta.url),
    );
    const worker = spawn(process.execPath, [workerPath, spiritDataDir], { stdio: "ignore" });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", resolve);
    });
    assert.equal(exitCode, 0);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
