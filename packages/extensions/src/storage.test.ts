import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

import { createKeyringExtensionStateStore } from "./storage.js";

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
